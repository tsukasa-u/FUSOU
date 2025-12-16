// Load .env variables automatically (dotenvx for Cloudflare Workers)
import '@dotenvx/dotenvx/config';

import { WorkflowEntrypoint, WorkflowStep } from 'cloudflare:workers';
import { createClient } from '@supabase/supabase-js';
import { 
  parseParquetMetadata, 
  compactFragmentedRowGroups,
  RowGroupInfo 
} from './parquet-compactor';

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  DATA_COMPACTION: Workflow;
  COMPACTION_QUEUE: Queue;
  COMPACTION_DLQ: Queue;
  PUBLIC_SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
}

interface CompactionParams {
  datasetId: string;
  bucketKey: string;
  metricId?: string;
}

interface StepMetrics {
  stepName: string;
  startTime: number;
  endTime: number;
  duration: number;
  status: 'success' | 'error';
  errorMessage?: string;
  details?: Record<string, any>;
}

interface CompactionResult {
  success: boolean;
  datasetId: string;
  originalSize: number;
  compactedSize: number;
  compressionRatio: number;
  timestamp: string;
  message?: string;
}

export class DataCompactionWorkflow extends WorkflowEntrypoint<Env, CompactionParams> {
  async run(event: any, step: WorkflowStep) {
    const { datasetId, bucketKey, metricId } = event.params;
    const workflowStartTime = Date.now();
    const stepMetrics: StepMetrics[] = [];

    console.info(`[Workflow] Started for ${datasetId}`, {
      bucketKey,
      metricId,
      timestamp: new Date().toISOString(),
    });

    try {
      // ===== Step 1: Validate Dataset =====
      const step1Start = Date.now();

      const validation = await step.do('validate-dataset', {
        retries: {
          limit: 3,
          delay: '5 seconds',
          backoff: 'exponential'
        }
      }, async () => {
        const supabase = createClient(
          this.env.PUBLIC_SUPABASE_URL,
          this.env.SUPABASE_SECRET_KEY
        );

        const { data, error } = await supabase
          .from('datasets')
          .select('id, compaction_needed, compaction_in_progress')
          .eq('id', datasetId)
          .single();

        if (error || !data) {
          throw new Error(`Dataset validation failed: ${error?.message || 'not found'}`);
        }

        return data;
      });

      const step1Duration = Date.now() - step1Start;
      stepMetrics.push({
        stepName: 'validate-dataset',
        startTime: step1Start,
        endTime: step1Start + step1Duration,
        duration: step1Duration,
        status: 'success',
        details: {
          compaction_needed: validation.compaction_needed,
          compaction_in_progress: validation.compaction_in_progress,
        },
      });

      console.info(`[Workflow] Step 1 completed: validate-dataset`, {
        datasetId,
        duration: `${step1Duration}ms`,
      });

      // ===== Step 2: Get File Metadata =====
      const step2Start = Date.now();

      const fileMetadata = await step.do('get-file-metadata', {
        retries: {
          limit: 3,
          delay: '3 seconds',
          backoff: 'exponential'
        },
        timeout: '30 seconds'
      }, async () => {
        const object = await this.env.BATTLE_DATA_BUCKET.head(bucketKey);
        
        if (!object) {
          throw new Error(`File not found in R2: ${bucketKey}`);
        }
        
        return {
          size: object.size,
          etag: object.etag,
          uploaded: object.uploaded.toISOString(),
          contentType: object.httpMetadata?.contentType,
          customMetadata: object.customMetadata
        };
      });

      const step2Duration = Date.now() - step2Start;
      stepMetrics.push({
        stepName: 'get-file-metadata',
        startTime: step2Start,
        endTime: step2Start + step2Duration,
        duration: step2Duration,
        status: 'success',
        details: {
          fileSize: fileMetadata.size,
          etag: fileMetadata.etag,
        },
      });

      console.info(`[Workflow] Step 2 completed: get-file-metadata`, {
        datasetId,
        duration: `${step2Duration}ms`,
        fileSize: `${fileMetadata.size} bytes`,
      });

      // ===== Step 3: Compact with WASM/TypeScript =====
      const step3Start = Date.now();

      const compactionResult = await step.do('compact-with-wasm', {
        retries: {
          limit: 2,
          delay: '10 seconds',
          backoff: 'linear'
        },
        timeout: '5 minutes'
      }, async () => {
        try {
          const stats = await analyzeAndCompactParquet(
            this.env.BATTLE_DATA_BUCKET,
            bucketKey,
            fileMetadata.size
          );
          
          return {
            originalSize: fileMetadata.size,
            compactedSize: stats.newFileSize,
            rowGroupsBefore: stats.rowGroupsBefore,
            rowGroupsAfter: stats.rowGroupsAfter,
            compressionRatio: stats.compressionRatio,
            etag: stats.etag
          };
        } catch (error) {
          throw error;
        }
      });

      const step3Duration = Date.now() - step3Start;
      stepMetrics.push({
        stepName: 'compact-with-wasm',
        startTime: step3Start,
        endTime: step3Start + step3Duration,
        duration: step3Duration,
        status: 'success',
        details: {
          originalSize: compactionResult.originalSize,
          compressedSize: compactionResult.compactedSize,
          compressionRatio: `${compactionResult.compressionRatio}%`,
        },
      });

      console.info(`[Workflow] Step 3 completed: compact-with-wasm`, {
        datasetId,
        duration: `${step3Duration}ms`,
        compressionRatio: `${compactionResult.compressionRatio}%`,
      });

      // ===== Step 4: Update Metadata =====
      const step4Start = Date.now();

      await step.do('update-metadata', {
        retries: {
          limit: 3,
          delay: '3 seconds',
          backoff: 'linear'
        }
      }, async () => {
        const supabase = createClient(
          this.env.PUBLIC_SUPABASE_URL,
          this.env.SUPABASE_SECRET_KEY
        );

        const now = new Date().toISOString();
        const { error } = await supabase
          .from('datasets')
          .update({
            compaction_in_progress: false,
            compaction_needed: false,
            last_compacted_at: now,
            file_size_bytes: compactionResult.compactedSize,
            file_etag: compactionResult.etag,
            compression_ratio: compactionResult.compressionRatio,
            row_count: compactionResult.rowGroupsAfter || 0,
            updated_at: now,
          })
          .eq('id', datasetId);

        if (error) {
          throw new Error(`Metadata update failed: ${error.message}`);
        }
      });

      const step4Duration = Date.now() - step4Start;
      stepMetrics.push({
        stepName: 'update-metadata',
        startTime: step4Start,
        endTime: step4Start + step4Duration,
        duration: step4Duration,
        status: 'success',
      });

      console.info(`[Workflow] Step 4 completed: update-metadata`, {
        datasetId,
        duration: `${step4Duration}ms`,
      });

      // ===== Workflow Completion =====
      const totalDuration = Date.now() - workflowStartTime;

      console.info(`[Workflow] Completed successfully for ${datasetId}`, {
        totalDuration: `${totalDuration}ms`,
        stepBreakdown: stepMetrics.map((m) => ({
          step: m.stepName,
          duration: `${m.duration}ms`,
        })),
        compression: {
          originalSize: `${compactionResult.originalSize} bytes`,
          compressedSize: `${compactionResult.compactedSize} bytes`,
          ratio: `${compactionResult.compressionRatio}%`,
        },
      });

      // === Metrics更新（Workflow完了） ===
      if (metricId) {
        const supabase = createClient(
          this.env.PUBLIC_SUPABASE_URL,
          this.env.SUPABASE_SECRET_KEY
        );

        const workflowCompletedAt = new Date().toISOString();

        const { error: updateMetricsError } = await supabase
          .from('processing_metrics')
          .update({
            status: 'success',
            step1_validate_duration_ms: stepMetrics[0]?.duration || 0,
            step2_metadata_duration_ms: stepMetrics[1]?.duration || 0,
            step3_compact_duration_ms: stepMetrics[2]?.duration || 0,
            step4_update_metadata_duration_ms: stepMetrics[3]?.duration || 0,
            workflow_total_duration_ms: totalDuration,
            original_size_bytes: compactionResult.originalSize,
            compressed_size_bytes: compactionResult.compactedSize,
            compression_ratio: compactionResult.compressionRatio,
            workflow_completed_at: workflowCompletedAt,
            updated_at: workflowCompletedAt,
          })
          .eq('id', metricId);

        if (updateMetricsError) {
          console.warn(`[Workflow] Failed to update metrics: ${updateMetricsError.message}`);
        }
      }

      return {
        success: true,
        datasetId,
        originalSize: compactionResult.originalSize,
        compressedSize: compactionResult.compactedSize,
        compressionRatio: compactionResult.compressionRatio,
        rowCount: compactionResult.rowGroupsAfter || 0,
        totalDuration,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      const failureDuration = Date.now() - workflowStartTime;
      const errorMessage = String(error);
      const failedStep = stepMetrics[stepMetrics.length - 1]?.stepName || 'unknown';

      console.error(`[Workflow] Failed for ${datasetId}`, {
        error: errorMessage,
        duration: `${failureDuration}ms`,
        failedStep,
        completedSteps: stepMetrics.length,
      });

      // === フラグリセット ===
      try {
        const supabase = createClient(
          this.env.PUBLIC_SUPABASE_URL,
          this.env.SUPABASE_SECRET_KEY
        );

        await supabase
          .from('datasets')
          .update({ compaction_in_progress: false })
          .eq('id', datasetId);
      } catch (resetError) {
        console.error(`[Workflow] Failed to reset flag: ${resetError}`);
      }

      // === Metricsレコード更新（エラー） ===
      if (metricId) {
        const supabase = createClient(
          this.env.PUBLIC_SUPABASE_URL,
          this.env.SUPABASE_SECRET_KEY
        );

        const workflowFailedAt = new Date().toISOString();

        const { error: updateMetricsError } = await supabase
          .from('processing_metrics')
          .update({
            status: 'failure',
            error_message: errorMessage,
            error_step: failedStep,
            workflow_completed_at: workflowFailedAt,
            updated_at: workflowFailedAt,
          })
          .eq('id', metricId);

        if (updateMetricsError) {
          console.warn(`[Workflow] Failed to update failure metrics: ${updateMetricsError.message}`);
        }
      }

      throw error;
    }
  }
}

// HTTP handler for triggering workflows and checking status
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // POST /compact - trigger new workflow instance
    if (path === '/compact' && request.method === 'POST') {
      try {
        const body = await request.json<CompactionParams>();
        
        if (!body.datasetId || !body.bucketKey) {
          return new Response(
            JSON.stringify({ error: 'Missing datasetId or bucketKey' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const instance = await env.DATA_COMPACTION.create({
          params: body
        });

        return new Response(
          JSON.stringify({
            instanceId: instance.id,
            status: 'started',
            datasetId: body.datasetId
          }),
          { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return new Response(
          JSON.stringify({ error: message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // GET /status/:instanceId - check workflow status
    if (path.startsWith('/status/') && request.method === 'GET') {
      try {
        const instanceId = path.split('/')[2];
        
        if (!instanceId) {
          return new Response(
            JSON.stringify({ error: 'Missing instanceId' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const instance = await env.DATA_COMPACTION.get(instanceId);
        const status = await instance.status();

        return new Response(
          JSON.stringify({
            instanceId,
            status: status.status,
            output: status.output,
            error: status.error
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return new Response(
          JSON.stringify({ error: message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // GET / - health check
    if (path === '/' && request.method === 'GET') {
      return new Response(
        JSON.stringify({ status: 'ok', service: 'fusou-compaction-workflow' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};

/**
 * Parquet バイナリの解析と compaction
 * 
 * Parquet フォーマット：
 * - Header: "PAR1" (4 bytes)
 * - Data pages with Row Groups
 * - Footer metadata
 * - Footer size (4 bytes, little-endian)
 * - Magic: "PAR1" (4 bytes)
 */
interface ParquetStats {
  newFileSize: number;
  rowGroupsBefore: number;
  rowGroupsAfter: number;
  compressionRatio: number;
  compacted: boolean;
  etag: string;
}

async function analyzeAndCompactParquet(
  bucket: R2Bucket,
  bucketKey: string,
  fileSize: number
): Promise<ParquetStats> {
  const FOOTER_SIZE_BYTES = 8; // 4 bytes for size + 4 bytes for magic
  const MIN_ROW_GROUP_SIZE = 2 * 1024 * 1024; // 2MB threshold for fragmentation
  
  // Step 1: Read Parquet footer (last 8 bytes)
  const footerBuffer = await readRange(bucket, bucketKey, fileSize - FOOTER_SIZE_BYTES, FOOTER_SIZE_BYTES);
  
  if (!isParquetFile(footerBuffer)) {
    throw new Error('File does not have valid Parquet magic number');
  }
  
  // Step 2: Extract footer metadata size
  const view = new DataView(footerBuffer.buffer, footerBuffer.byteOffset, footerBuffer.byteLength);
  const metadataSize = view.getUint32(0, true); // little-endian
  
  console.log(`[Parquet] Metadata size: ${metadataSize} bytes`);
  
  if (metadataSize > 100 * 1024 * 1024) {
    throw new Error(`Metadata too large: ${metadataSize} bytes`);
  }
  
  // Step 3: Read full footer metadata
  const footerStart = fileSize - metadataSize - FOOTER_SIZE_BYTES;
  const footerData = await readRange(bucket, bucketKey, footerStart, metadataSize);
  
  // Step 4: Parse footer to extract Row Group information
  const rowGroups = parseParquetMetadata(footerData);
  
  console.log(`[Parquet] Found ${rowGroups.length} Row Groups`);
  
  // Step 5: Identify fragmented Row Groups (< 2MB)
  const fragmentedIndices = rowGroups
    .map((rg, idx) => ({ idx, size: rg.totalByteSize }))
    .filter(rg => rg.size < MIN_ROW_GROUP_SIZE)
    .map(rg => rg.idx);
  
  console.log(`[Parquet] Found ${fragmentedIndices.length} fragmented Row Groups`);
  
  // Step 6: Decision: Compact or keep as-is
  const shouldCompact = fragmentedIndices.length > 0;
  
  if (!shouldCompact) {
    console.log(`[Parquet] File is already well-compacted`);
    return {
      newFileSize: fileSize,
      rowGroupsBefore: rowGroups.length,
      rowGroupsAfter: rowGroups.length,
      compressionRatio: 1.0,
      compacted: false,
      etag: ''
    };
  }
  
  // Step 7: Compact fragmented Row Groups
  console.log(`[Parquet] Compacting ${fragmentedIndices.length} fragmented Row Groups...`);
  
  const compactionResult = await compactFragmentedRowGroups(
    bucket,
    bucketKey,
    footerStart,
    rowGroups,
    fragmentedIndices,
    readRange
  );
  
  return {
    newFileSize: compactionResult.newFileSize,
    rowGroupsBefore: rowGroups.length,
    rowGroupsAfter: compactionResult.newRowGroupCount,
    compressionRatio: compactionResult.newFileSize / fileSize,
    compacted: true,
    etag: compactionResult.etag
  };
}

/**
 * Range request を使ってバイナリ範囲を読み込む
 */
async function readRange(
  bucket: R2Bucket,
  bucketKey: string,
  offset: number,
  length: number
): Promise<Uint8Array> {
  const object = await bucket.get(bucketKey, {
    range: { offset, length }
  });
  
  if (!object) {
    throw new Error(`Failed to read range [${offset}, ${offset + length}) from ${bucketKey}`);
  }
  
  return new Uint8Array(await object.arrayBuffer());
}

/**
 * Parquet magic number チェック
 */
function isParquetFile(footerBuffer: Uint8Array): boolean {
  if (footerBuffer.length < 4) return false;
  
  const magic = footerBuffer.slice(-4);
  const magicStr = new TextDecoder().decode(magic);
  
  if (magicStr !== 'PAR1') {
    console.warn(`[Parquet] Invalid magic number: ${magicStr}`);
    return false;
  }
  
  return true;
}

/**
 * Queue Consumer Handler
 * Processes messages from COMPACTION_QUEUE and dispatches to Workflow
 */
interface CompactionQueueMessage {
  datasetId: string;
  triggeredAt: string;
  priority?: 'scheduled' | 'realtime' | 'manual';
  metricId?: string;
}

export const queue = {
  async queue(batch: MessageBatch<any>, env: Env) {
    console.info(`[Consumer] Processing ${batch.messages.length} messages`, {
      timestamp: new Date().toISOString(),
    });

    for (const message of batch.messages) {
      try {
        const { datasetId, triggeredAt, priority = 'scheduled', metricId } = message.body as CompactionQueueMessage;

        console.info(`[Consumer] Processing message`, {
          datasetId,
          priority,
          triggeredAt,
          metricId,
          messageId: message.id,
        });

        // Dispatch to Workflow
        const workflowInstance = await env.DATA_COMPACTION.create({
          params: {
            datasetId,
            bucketKey: datasetId,
            metricId,
          },
        });

        console.info(`[Consumer] Workflow dispatched`, {
          datasetId,
          workflowInstanceId: workflowInstance.id,
        });

        // Acknowledge message on success
        message.ack();

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        console.error(`[Consumer] Message processing failed`, {
          messageId: message.id,
          body: message.body,
          error: errorMsg,
        });

        // Retry logic (max 3 retries via wrangler config)
        // If max retries exceeded, message goes to DLQ automatically
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * DLQ Handler
 * Processes messages that failed 3 times and moved to Dead Letter Queue
 */
export const queueDLQ = {
  async queue(batch: MessageBatch<any>, env: Env) {
    console.warn(`[DLQ Handler] Processing ${batch.messages.length} failed messages`, {
      timestamp: new Date().toISOString(),
    });

    for (const message of batch.messages) {
      try {
        const { datasetId, triggeredAt, priority, metricId } = message.body as CompactionQueueMessage;

        // Log detailed failure information
        console.error(`[DLQ Handler] Message in DLQ`, {
          datasetId,
          triggeredAt,
          priority,
          metricId,
          messageId: message.id,
          timestamp: new Date().toISOString(),
        });

        // ===== Future: Record to metrics table =====
        // Example: Insert into processing_metrics table
        // await recordDLQMetric(datasetId, error, metricId);

        // ===== Future: Send alert notification =====
        // Example: Send to monitoring system (Slack, PagerDuty, etc.)
        // await notifyDLQFailure(datasetId);

        // Acknowledge DLQ message (don't retry indefinitely)
        message.ack();

      } catch (error) {
        console.error(`[DLQ Handler] Error processing DLQ message`, {
          error: error instanceof Error ? error.message : String(error),
          messageId: message.id,
        });

        // For DLQ handler errors, ack anyway to prevent infinite loop
        message.ack();
      }
    }
  },
} satisfies ExportedHandler<Env>;
