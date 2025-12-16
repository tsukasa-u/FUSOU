// Load .env variables automatically (dotenvx for Cloudflare Workers)
import '@dotenvx/dotenvx/config';

import { WorkflowEntrypoint, WorkflowStep } from 'cloudflare:workers';
import { createClient } from '@supabase/supabase-js';
import { pickFragmentsForBucket } from './parquet-merge';
import { streamMergeParquetFragments } from './parquet-stream-merge';
import { groupFragmentsBySchema, processSchemaGroups, SchemaGroupOutput } from './parquet-schema';
import { validateParquetFile, formatValidationReport, validateParquetBatch } from './parquet-validator';

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  BATTLE_INDEX_DB: D1Database;
  DATA_COMPACTION: Workflow;
  COMPACTION_QUEUE: Queue;
  COMPACTION_DLQ: Queue;
  PUBLIC_SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
}

interface CompactionParams {
  datasetId: string;
  bucketKey: string;
  table?: string;
  periodTag?: string;
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

/**
 * Standard retry configuration for Supabase operations
 * Free tier: exponential backoff with max 3 retries
 * Prevents rate limiting issues on shared infrastructure
 */
const SUPABASE_RETRY_CONFIG = {
  limit: 3,
  delay: 2000, // 2 seconds in milliseconds
  backoff: 'exponential' as const,
};

export class DataCompactionWorkflow extends WorkflowEntrypoint<Env, CompactionParams> {
  async run(event: any, step: WorkflowStep) {
    const { datasetId, bucketKey, metricId, table, periodTag } = event.params;
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
        retries: SUPABASE_RETRY_CONFIG
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

      // ===== Set compaction_in_progress flag =====
      const setFlagStart = Date.now();
      await step.do('set-in-progress-flag', {
        retries: SUPABASE_RETRY_CONFIG
      }, async () => {
        const supabase = createClient(
          this.env.PUBLIC_SUPABASE_URL,
          this.env.SUPABASE_SECRET_KEY
        );

        const { error } = await supabase
          .from('datasets')
          .update({ compaction_in_progress: true })
          .eq('id', datasetId);

        if (error) {
          throw new Error(`Failed to set in-progress flag: ${error.message}`);
        }
      });

      const setFlagDuration = Date.now() - setFlagStart;
      console.info(`[Workflow] Set in-progress flag`, {
        datasetId,
        duration: `${setFlagDuration}ms`,
      });

      // ===== Step 2: List fragments from D1 (by dataset/table/periodTag) =====
      interface D1Fragment {
        key: string;
        size: number;
        etag: string | null;
        uploaded_at: string;
        content_hash: string | null;
        table: string;
        period_tag: string;
      }

      const step2Start = Date.now();
      const fragments = await step.do('list-fragments', { retries: SUPABASE_RETRY_CONFIG }, async (): Promise<D1Fragment[]> => {
        const stmt = this.env.BATTLE_INDEX_DB.prepare(
          `SELECT key, size, etag, uploaded_at, content_hash, "table" as table, period_tag
           FROM battle_files
           WHERE dataset_id = ? ${table ? 'AND "table" = ?' : ''} ${periodTag ? 'AND period_tag = ?' : ''}
           ORDER BY uploaded_at ASC`
        );
        const params: unknown[] = [datasetId];
        if (table) params.push(table);
        if (periodTag) params.push(periodTag);
        const res = await stmt.bind(...params).all();
        // Ensure serializable plain objects
        return (res?.results || []).map((row: any) => ({ ...row } as D1Fragment));
      });
      const step2Duration = Date.now() - step2Start;
      stepMetrics.push({
        stepName: 'list-fragments',
        startTime: step2Start,
        endTime: step2Start + step2Duration,
        duration: step2Duration,
        status: 'success',
        details: { count: fragments.length },
      });

      const fragmentsArr = fragments || [];

      if (!fragmentsArr.length) {
        throw new Error('No fragments found for compaction');
      }

      // Deduplicate by content_hash (type-safe)
      const seen = new Set<string>();
      const filtered = fragmentsArr.filter((row) => {
        const h = row.content_hash;
        if (!h) return true;
        if (seen.has(h)) return false;
        seen.add(h);
        return true;
      });

      if (filtered.length === 0) {
        throw new Error('No fragments found after deduplication');
      }

      // ===== Step 3: Schema grouping + Stream merge =====
      const step3Start = Date.now();
      const THRESHOLD = 256 * 1024 * 1024;
      const period = periodTag || filtered[0]?.period_tag || 'unknown';
      const tbl = table || filtered[0]?.table || 'unknown';
      let outputs: Array<{ key: string; size: number; etag: string }> = [];
      const totalOriginal = filtered.reduce((sum, r) => sum + (r.size || 0), 0);

      const frags = filtered.map((r) => ({ key: r.key, size: r.size }));
      
      // スキーマグルーピング実行
      const schemaGroups = await groupFragmentsBySchema(this.env.BATTLE_DATA_BUCKET, frags);
      
      let globalIndex = 0;
      for (const [schemaHash, groupFrags] of schemaGroups.entries()) {
        console.log(`[Workflow] Processing schema group ${schemaHash}: ${groupFrags.length} fragments`);
        
        let cursor = 0;
        while (cursor < groupFrags.length) {
          const { picked, nextIndex } = pickFragmentsForBucket(groupFrags, cursor, THRESHOLD);
          if (picked.length === 0) break;
          
          const outKey = `battle_compacted/${period}/${datasetId}/${tbl}/${globalIndex}.parquet`;
          
          // ストリーミング最適化マージ使用
          const res = await streamMergeParquetFragments(this.env.BATTLE_DATA_BUCKET, outKey, picked, THRESHOLD);
          outputs.push({ key: outKey, size: res.newFileSize, etag: res.etag });
          
          globalIndex += 1;
          cursor = nextIndex;
        }
      }

      const totalCompacted = outputs.reduce((sum, o) => sum + o.size, 0);

      const step3Duration = Date.now() - step3Start;
      stepMetrics.push({
        stepName: 'compact-fragments',
        startTime: step3Start,
        endTime: step3Start + step3Duration,
        duration: step3Duration,
        status: 'success',
        details: {
          outputs: outputs.length,
          totalOriginal,
          totalCompacted,
        },
      });

      // ===== Step 4: Update Metadata =====
      const step4Start = Date.now();

      await step.do('update-metadata', {
        retries: {
          limit: 3,
          delay: 3000,
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
            file_size_bytes: totalCompacted,
            file_etag: outputs[0]?.etag || outputs[0]?.key || null,
            compression_ratio: totalOriginal > 0 ? totalCompacted / totalOriginal : null,
            row_count: null,
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
          originalSize: `${totalOriginal} bytes`,
          compressedSize: `${totalCompacted} bytes`,
          ratio: `${totalOriginal > 0 ? (totalCompacted / totalOriginal) : 1}`,
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
            original_size_bytes: totalOriginal,
            compressed_size_bytes: totalCompacted,
            compression_ratio: totalOriginal > 0 ? totalCompacted / totalOriginal : null,
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
        originalSize: totalOriginal,
        compressedSize: totalCompacted,
        compressionRatio: totalOriginal > 0 ? totalCompacted / totalOriginal : 1,
        rowCount: null,
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
      } else {
        console.warn(`[Workflow] No metricId provided for failure tracking`, { datasetId, errorMessage, failedStep });
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

    // POST /run - trigger new workflow instance (datasetId required; bucketKey optional→defaults to datasetId)
    if (path === '/run' && request.method === 'POST') {
      try {
        const body = await request.json<Partial<CompactionParams>>();

        const datasetId = body.datasetId;
        const bucketKey = body.bucketKey || datasetId;
        if (!datasetId || !bucketKey) {
          return new Response(
            JSON.stringify({ error: 'Missing datasetId or bucketKey' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const instance = await env.DATA_COMPACTION.create({
          params: {
            datasetId,
            bucketKey,
            metricId: body.metricId,
            table: body.table,
            periodTag: body.periodTag,
          },
        });

        return new Response(
          JSON.stringify({
            invocationId: instance.id,
            status: 'started',
            datasetId,
            table: body.table,
            periodTag: body.periodTag,
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

    // POST /compact - trigger new workflow instance (legacy; kept for compatibility)
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

    // POST /validate - Parquet形式検証
    if (path === '/validate' && request.method === 'POST') {
      try {
        const body = await request.json<{ 
          keys: string[];
          deleteOnFailure?: boolean;
          minRowGroups?: number;
          maxFileSize?: number;
        }>();
        if (!body.keys || !Array.isArray(body.keys)) {
          return new Response(
            JSON.stringify({ error: 'Missing or invalid keys array' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const validateOptions = {
          deleteOnFailure: body.deleteOnFailure,
          minRowGroups: body.minRowGroups,
          maxFileSize: body.maxFileSize,
        };
        const results = await validateParquetBatch(env.BATTLE_DATA_BUCKET, body.keys, validateOptions);
        const reports = Array.from(results.entries()).map(([key, info]) => ({
          key,
          valid: info.valid,
          fileSize: info.fileSize,
          rowGroups: info.numRowGroups,
          totalRows: info.totalRows,
          errors: info.errors,
          warnings: info.warnings,
          cleaned: info.cleaned,
        }));

        return new Response(
          JSON.stringify({ results: reports }),
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

    // GET /validate/:key - 単一ファイル検証（キーをパスに埋込）
    if (path.startsWith('/validate/') && request.method === 'GET') {
      try {
        const key = decodeURIComponent(path.slice('/validate/'.length));
        if (!key) {
          return new Response(
            JSON.stringify({ error: 'Missing key' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const info = await validateParquetFile(env.BATTLE_DATA_BUCKET, key);
        const report = formatValidationReport(info, key);

        return new Response(
          JSON.stringify({ key, info, report }),
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

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    // Route to appropriate handler based on queue name
    // MessageBatch.queue property contains the queue name
    const queueName = (batch as any).queue as string | undefined;
    if (queueName && (queueName.includes('dlq') || queueName.includes('DLQ'))) {
      return queueDLQ.queue(batch, env);
    }
    return queue.queue(batch, env);
  }
};

/**
 * Queue Consumer Handler
 * Processes messages from COMPACTION_QUEUE and dispatches to Workflow
 */
interface CompactionQueueMessage {
  datasetId: string;
  triggeredAt: string;
  priority?: 'scheduled' | 'realtime' | 'manual';
  metricId?: string;
  table?: string;
  periodTag?: string;
}

export const queue = {
  async queue(batch: MessageBatch<any>, env: Env) {
    console.info(`[Consumer] Processing ${batch.messages.length} messages`, {
      timestamp: new Date().toISOString(),
    });

    for (const message of batch.messages) {
      try {
        const { datasetId, triggeredAt, priority = 'scheduled', metricId, table, periodTag } = message.body as CompactionQueueMessage;

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
            table,
            periodTag,
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
 * Records failures to processing_metrics for monitoring and alerting
 */
export const queueDLQ = {
  async queue(batch: MessageBatch<any>, env: Env) {
    console.warn(`[DLQ Handler] Processing ${batch.messages.length} failed messages`, {
      timestamp: new Date().toISOString(),
    });

    const supabase = createClient(
      env.PUBLIC_SUPABASE_URL,
      env.SUPABASE_SECRET_KEY
    );

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

        // ===== Record to metrics table =====
        if (metricId) {
          // Update existing metrics record with DLQ failure status
          const { error: updateError } = await supabase
            .from('processing_metrics')
            .update({
              status: 'dlq_failure',
              error_message: 'Message moved to DLQ after max retries',
              error_step: 'consumer',
              workflow_completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', metricId);

          if (updateError) {
            console.error(`[DLQ Handler] Failed to update metrics record`, {
              metricId,
              error: updateError.message,
            });
          } else {
            console.info(`[DLQ Handler] Updated metrics record`, { metricId });
          }
        } else {
          // Create new DLQ failure record if metricId is missing
          const { error: insertError } = await supabase
            .from('processing_metrics')
            .insert({
              dataset_id: datasetId,
              workflow_instance_id: `dlq-${Date.now()}-${datasetId}`,
              status: 'dlq_failure',
              error_message: 'Message in DLQ without metricId',
              error_step: 'consumer',
              queued_at: triggeredAt,
              workflow_completed_at: new Date().toISOString(),
            });

          if (insertError) {
            console.error(`[DLQ Handler] Failed to create DLQ metrics record`, {
              datasetId,
              error: insertError.message,
            });
          } else {
            console.info(`[DLQ Handler] Created DLQ metrics record`, { datasetId });
          }
        }

        // Reset compaction_in_progress flag if dataset is stuck
        if (datasetId) {
          const { error: resetError } = await supabase
            .from('datasets')
            .update({ 
              compaction_in_progress: false,
              updated_at: new Date().toISOString(),
            })
            .eq('id', datasetId)
            .eq('compaction_in_progress', true);

          if (resetError) {
            console.error(`[DLQ Handler] Failed to reset compaction flag`, {
              datasetId,
              error: resetError.message,
            });
          } else {
            console.info(`[DLQ Handler] Reset compaction flag`, { datasetId });
          }
        }

        // ===== Future: Send alert notification =====
        // Example: Send to monitoring system (Slack, PagerDuty, etc.)
        // await notifyDLQFailure(env, datasetId, priority);

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
