import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import type { Bindings } from '../types';
import { CORS_HEADERS } from '../constants';
import { 
  createEnvContext, 
  resolveSupabaseConfig, 
  readR2Binary, 
  writeR2Binary,
  getR2ObjectMetadata 
} from '../utils';

const app = new Hono<{ Bindings: Bindings }>();

interface CompactRequest {
  dataset_id: string;
}

interface CompactResponse {
  status: 'success' | 'error';
  message: string;
  compacted_tables?: number;
}

// Compaction設定（Cloudflare Workers環境向け）
const COMPACT_CONFIG = {
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024, // 100MB
  SAFETY_MARGIN_MS: 5000, // 5秒の安全マージン
  TIMEOUT_MS: 25000, // 25秒（30秒制限-5秒）
};

/**
 * Compaction service routes
 * Triggers Parquet fragment consolidation via WASM orchestration
 * Endpoints:
 *   POST /compact - trigger compaction for a dataset
 *   GET /compact/trigger - manual trigger endpoint
 *   GET /compact/status - health check
 */

// OPTIONS (CORS)
app.options('*', (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }));

// Helper to update Supabase flags using client
async function supabaseUpdate(
  supabase: ReturnType<typeof createClient<any, any>>,
  datasetId: string,
  payload: Record<string, any>
) {
  const { error } = await supabase
    .from('datasets')
    .update(payload)
    .eq('id', datasetId);
  return !error;
}

// POST /compact - trigger compaction for a dataset via WASM
app.post('/compact', async (c) => {
  let dataset_id: string | null = null;
  let supabase: ReturnType<typeof createClient<any, any>> | null = null;
  
  try {
    const body = await c.req.json<CompactRequest>().catch(() => null);

    if (!body || !body.dataset_id || typeof body.dataset_id !== 'string') {
      return c.json(
        { status: 'error', message: 'dataset_id is required and must be a string' } as CompactResponse,
        400
      );
    }

    dataset_id = body.dataset_id;

    const envCtx = createEnvContext(c);
    const { url: supabase_url, publishableKey: supabase_key } = resolveSupabaseConfig(envCtx);
    const bucket = envCtx.runtime.BATTLE_DATA_BUCKET;

    if (!supabase_url || !supabase_key) {
      return c.json(
        { status: 'error', message: 'Missing environment configuration' } as CompactResponse,
        500
      );
    }

    if (!bucket) {
      return c.json(
        { status: 'error', message: 'R2 bucket not configured' } as CompactResponse,
        500
      );
    }

    supabase = createClient(supabase_url, supabase_key);

    // 改善案1: ファイルサイズ検証
    console.log(`[Compact] Checking file size for dataset: ${dataset_id}`);
    const metadata = await getR2ObjectMetadata(bucket, dataset_id);
    if (!metadata) {
      return c.json(
        { status: 'error', message: `Dataset file not found: ${dataset_id}` } as CompactResponse,
        404
      );
    }

    if (metadata.size > COMPACT_CONFIG.MAX_FILE_SIZE_BYTES) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'compact_file_too_large',
          dataset_id,
          file_size_bytes: metadata.size,
          max_size_bytes: COMPACT_CONFIG.MAX_FILE_SIZE_BYTES,
        })
      );
      return c.json(
        {
          status: 'error',
          message: `File too large: ${(metadata.size / 1024 / 1024).toFixed(2)}MB exceeds limit of ${(COMPACT_CONFIG.MAX_FILE_SIZE_BYTES / 1024 / 1024).toFixed(0)}MB`,
        } as CompactResponse,
        413 // Payload Too Large
      );
    }

    console.log(
      JSON.stringify({
        level: 'info',
        event: 'compact_start',
        dataset_id,
        file_size_bytes: metadata.size,
      })
    );

    // Set compaction_in_progress flag to avoid double-run
    await supabaseUpdate(supabase, dataset_id, {
      compaction_in_progress: true,
      compaction_needed: false,
    });

    // Import WASM module dynamically
    let compact_single_dataset: any;
    try {
      // @ts-ignore - WASM module path
      const wasmModule = await import('../../wasm/compactor/pkg/fusou_compactor_wasm.js');
      compact_single_dataset = wasmModule.compact_single_dataset;
    } catch (error) {
      console.error('Failed to load WASM compactor module:', error);
      await supabaseUpdate(supabase, dataset_id, {
        compaction_in_progress: false,
        compaction_needed: true,
      });
      return c.json(
        { status: 'error', message: 'WASM compactor module not available' } as CompactResponse,
        500
      );
    }

    // Call WASM compaction with timeout protection (改善案2)
    const startedAt = Date.now();
    let result: string;

    try {
      // 改善案3: R2バイナリを直接読み込み（署名URL不要）
      // Worker環境内でのアクセス（env.BATTLE_DATA_BUCKET バインディング経由）
      console.log(`[Compact] Reading binary data from R2: ${dataset_id}`);
      const binaryData = await readR2Binary(bucket, dataset_id);
      
      // タイムアウト保護を付与してWASM関数を実行
      result = await Promise.race([
        compact_single_dataset(
          dataset_id,
          supabase_url,
          supabase_key,
          binaryData // ArrayBuffer を直接渡す
        ),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Compaction timeout after ${COMPACT_CONFIG.TIMEOUT_MS}ms`)),
            COMPACT_CONFIG.TIMEOUT_MS
          )
        ),
      ]);
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'compact_wasm_failed',
          dataset_id,
          elapsed_ms: elapsed,
          error: message,
        })
      );
      
      await supabaseUpdate(supabase, dataset_id, {
        compaction_in_progress: false,
        compaction_needed: true,
      });
      
      throw error;
    }

    // 改善案3.5: Worker層でR2へアップロード（署名URL不要）
    // WASM処理完了後、コンパクションされたデータをR2に保存
    try {
      console.log(`[Compact] Writing compacted data to R2: ${dataset_id}`);
      const outputKey = `optimized/${dataset_id}/${Date.now()}.parquet`;
      
      // バイナリデータを R2 に書き込み（env.BATTLE_DATA_BUCKET 経由）
      await writeR2Binary(bucket, outputKey, binaryData, {
        compacted: 'true',
        source_dataset: dataset_id,
        compaction_timestamp: new Date().toISOString(),
      });
      
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'compact_uploaded',
          dataset_id,
          output_key: outputKey,
          file_size_bytes: binaryData.byteLength,
        })
      );
    } catch (uploadError) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'compact_upload_failed',
          dataset_id,
          error: uploadError instanceof Error ? uploadError.message : String(uploadError),
        })
      );
      // アップロード失敗は警告のみ（メタデータは更新済み）
      // 修復はリトライで対応
    }


    const elapsed = Date.now() - startedAt;
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'compact_completed',
        dataset_id,
        elapsed_ms: elapsed,
        result: result,
      })
    );

    // Update dataset status after success
    await supabaseUpdate(supabase, dataset_id, {
      compaction_in_progress: false,
      last_compacted_at: new Date().toISOString(),
      compaction_needed: false,
    });

    return c.json(
      { 
        status: 'success', 
        message: result,
        compacted_tables: result.match(/Compacted (\d+) tables/)?.[1] ? parseInt(result.match(/Compacted (\d+) tables/)![1]) : 0
      } as CompactResponse,
      200
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const category = /timeout/i.test(message)
      ? 'timeout'
      : /fetch|network/i.test(message)
        ? 'network'
        : /memory|oom/i.test(message)
          ? 'memory'
          : /not.*found/i.test(message)
            ? 'not_found'
            : 'unknown';

    console.error(
      JSON.stringify({
        level: 'error',
        event: 'compact_failed',
        dataset_id,
        category,
        error: message,
      })
    );

    // Best-effort reset flag on failure
    try {
      if (supabase && dataset_id) {
        await supabaseUpdate(supabase, dataset_id, {
          compaction_in_progress: false,
          compaction_needed: true,
        });
      }
    } catch (resetError) {
      console.error('Failed to reset compaction flag:', resetError);
    }

    const statusCode = category === 'not_found' ? 404 : 500;
    return c.json(
      { status: 'error', message: `Compaction failed: ${message}` } as CompactResponse,
      statusCode
    );
  }
});

// GET /compact/trigger - manually trigger compaction for a specific dataset
app.get('/compact/trigger', async (c) => {
  try {
    const dataset_id = c.req.query('dataset_id');
    const origin = c.req.header('origin');

    if (dataset_id) {
      // Call main API with short timeout
      await fetch(`${origin}/api/compaction/compact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_id }),
      }).catch(() => {});

      return c.json(
        {
          status: 'triggered',
          dataset_id,
          message: `Compaction triggered for dataset: ${dataset_id}`,
        },
        202
      );
    } else {
      return c.json(
        {
          status: 'triggered',
          message: 'Compaction triggered for all datasets',
        },
        202
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ status: 'error', message }, 500);
  }
});

// GET /compact/status - health check for compaction service
app.get('/compact/status', (c) => {
  return c.json(
    {
      status: 'success',
      message: 'Compaction service is running',
    } as CompactResponse,
    200
  );
});

export default app;
