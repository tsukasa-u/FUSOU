import { DurableObject } from 'cloudflare:workers';
import { createClient } from '@supabase/supabase-js';
import type { Bindings } from '../types';

interface CompactJobRequest {
  dataset_id: string;
  supabase_url: string;
  supabase_key: string;
}

interface CompactJobStatus {
  dataset_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number; // 0-100
  compacted_tables?: number;
  error?: string;
  started_at?: string;
  completed_at?: string;
}

/**
 * Durable Object for handling large file compaction
 * - Bypasses Worker 10ms CPU time limit
 * - Handles 100MB+ files with chunked streaming
 * - Maintains processing state across requests
 */
export class CompactorDO extends DurableObject<Bindings> {
  private currentJob: CompactJobStatus | null = null;

  constructor(state: DurableObjectState, env: Bindings) {
    super(state, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // ルーティング
    if (path === '/compact' && request.method === 'POST') {
      return this.handleCompact(request);
    }

    if (path === '/status' && request.method === 'GET') {
      return this.handleStatus();
    }

    return new Response('Not Found', { status: 404 });
  }

  /**
   * 圧縮ジョブを開始
   */
  private async handleCompact(request: Request): Promise<Response> {
    try {
      const job = await request.json<CompactJobRequest>();

      // 既に処理中の場合は拒否
      if (this.currentJob?.status === 'processing') {
        return Response.json(
          {
            status: 'error',
            message: 'A compaction job is already in progress',
            current_job: this.currentJob,
          },
          { status: 409 }
        );
      }

      // ジョブステータスを初期化
      this.currentJob = {
        dataset_id: job.dataset_id,
        status: 'processing',
        progress: 0,
        started_at: new Date().toISOString(),
      };

      // 永続化（状態復元用）
      await this.ctx.storage.put('currentJob', this.currentJob);

      // バックグラウンドで処理を実行
      this.ctx.waitUntil(
        this.processCompaction(job).catch((error) => {
          console.error('[CompactorDO] Job failed:', error);
          this.currentJob = {
            ...this.currentJob!,
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
            completed_at: new Date().toISOString(),
          };
          this.ctx.storage.put('currentJob', this.currentJob);
        })
      );

      // 即座に202を返す
      return Response.json(
        {
          status: 'accepted',
          message: 'Compaction job started',
          dataset_id: job.dataset_id,
        },
        { status: 202 }
      );
    } catch (error) {
      return Response.json(
        {
          status: 'error',
          message: error instanceof Error ? error.message : 'Invalid request',
        },
        { status: 400 }
      );
    }
  }

  /**
   * ジョブステータスを返す
   */
  private async handleStatus(): Promise<Response> {
    // 永続化された状態を復元
    const storedJob = await this.ctx.storage.get<CompactJobStatus>('currentJob');
    const job = this.currentJob || storedJob || null;

    if (!job) {
      return Response.json(
        {
          status: 'idle',
          message: 'No active or recent compaction job',
        },
        { status: 200 }
      );
    }

    return Response.json(job, { status: 200 });
  }

  /**
   * 実際の圧縮処理（バックグラウンド実行）
   */
  private async processCompaction(job: CompactJobRequest): Promise<void> {
    const { dataset_id, supabase_url, supabase_key } = job;
    const bucket = this.env.BATTLE_DATA_BUCKET;
    const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks

    console.log(`[CompactorDO] Starting compaction: ${dataset_id}`);

    try {
      // Supabase クライアント初期化
      const supabase = createClient(supabase_url, supabase_key);

      // Step 1: Supabase でフラグを設定
      this.updateProgress(5, 'Setting compaction flag');
      await supabase
        .from('datasets')
        .update({ compaction_in_progress: true })
        .eq('id', dataset_id);

      // Step 2: R2 からメタデータを取得
      this.updateProgress(10, 'Fetching file metadata');
      const r2Object = await bucket.head(dataset_id);
      if (!r2Object) {
        throw new Error(`File not found: ${dataset_id}`);
      }

      const fileSize = r2Object.size;
      console.log(`[CompactorDO] File size: ${fileSize} bytes`);

      // Step 3: チャンク単位で読み込み
      this.updateProgress(20, 'Reading file in chunks');
      const chunks: Uint8Array[] = [];
      let offset = 0;

      while (offset < fileSize) {
        const chunkEnd = Math.min(offset + CHUNK_SIZE, fileSize);
        const range = { offset, length: chunkEnd - offset };

        // R2 から Range リクエストでチャンク読み込み
        const r2Response = await bucket.get(dataset_id, { range });
        if (!r2Response) {
          throw new Error(`Failed to read chunk at offset ${offset}`);
        }

        const chunkData = new Uint8Array(await r2Response.arrayBuffer());
        chunks.push(chunkData);

        offset = chunkEnd;

        // 進捗更新
        const progress = 20 + Math.floor((offset / fileSize) * 30); // 20-50%
        this.updateProgress(progress, `Reading: ${offset}/${fileSize} bytes`);

        console.log(`[CompactorDO] Read chunk: ${offset}/${fileSize} bytes`);
      }

      // Step 4: チャンクを結合
      this.updateProgress(55, 'Merging chunks');
      const fullBinary = this.mergeChunks(chunks);
      console.log(`[CompactorDO] Merged binary: ${fullBinary.length} bytes`);

      // Step 5: WASM で処理
      this.updateProgress(60, 'Processing with WASM');
      
      // WASM モジュールを動的にインポート
      const wasmModule = await import('../../wasm/compactor/pkg/fusou_compactor_wasm.js');
      const compactFn = wasmModule.compact_single_dataset as unknown as (
        datasetId: string,
        supabaseUrl: string,
        supabaseKey: string,
        data: Uint8Array
      ) => Promise<number | string>;

      const compactedResult = await compactFn(
        dataset_id,
        supabase_url,
        supabase_key,
        fullBinary
      );
      const compacted = Number(compactedResult);

      console.log(`[CompactorDO] WASM processing completed: ${compacted} tables`);

      // Step 6: R2 に書き戻し
      this.updateProgress(80, 'Writing to R2');
      await bucket.put(dataset_id, fullBinary, {
        customMetadata: {
          'compacted-at': new Date().toISOString(),
          'compacted-tables': String(compacted),
        },
      });

      // Step 7: Supabase メタデータを更新
      this.updateProgress(90, 'Updating metadata');
      await supabase
        .from('datasets')
        .update({
          compaction_in_progress: false,
          last_compacted_at: new Date().toISOString(),
          compaction_needed: false,
        })
        .eq('id', dataset_id);

      // Step 8: 完了
      this.currentJob = {
        dataset_id,
        status: 'completed',
        progress: 100,
        compacted_tables: compacted,
        started_at: this.currentJob?.started_at,
        completed_at: new Date().toISOString(),
      };

      await this.ctx.storage.put('currentJob', this.currentJob);
      console.log(`[CompactorDO] Compaction completed: ${dataset_id}`);

    } catch (error) {
      console.error('[CompactorDO] Compaction failed:', error);

      // エラー時もフラグをリセット
      const supabase = createClient(supabase_url, supabase_key);
      await supabase
        .from('datasets')
        .update({
          compaction_in_progress: false,
        })
        .eq('id', dataset_id);

      // エラー状態を保存
      this.currentJob = {
        dataset_id,
        status: 'failed',
        progress: this.currentJob?.progress || 0,
        error: error instanceof Error ? error.message : 'Unknown error',
        started_at: this.currentJob?.started_at,
        completed_at: new Date().toISOString(),
      };

      await this.ctx.storage.put('currentJob', this.currentJob);
      throw error;
    }
  }

  /**
   * 進捗を更新
   */
  private updateProgress(progress: number, message?: string): void {
    if (this.currentJob) {
      this.currentJob.progress = progress;
      console.log(`[CompactorDO] Progress: ${progress}% - ${message || ''}`);
    }
  }

  /**
   * チャンクを結合
   */
  private mergeChunks(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Uint8Array(totalLength);

    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    return merged;
  }
}
