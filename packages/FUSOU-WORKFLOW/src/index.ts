import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { createClient } from '@supabase/supabase-js';
import { pickFragmentsForBucket } from './parquet-merge';
import { streamMergeParquetFragments, streamMergeExtractedFragments } from './parquet-stream-merge';
import { groupFragmentsBySchema, groupExtractedFragmentsBySchema, processSchemaGroups, SchemaGroupOutput } from './parquet-schema';
import { validateParquetFile, formatValidationReport, validateParquetBatch } from './parquet-validator';
import { extractTableSafe, validateOffsetMetadata, parseTableOffsets } from './table-offset-extractor';

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  BATTLE_INDEX_DB: D1Database;
  DATA_COMPACTION: Workflow;
  COMPACTION_QUEUE: Queue;
  COMPACTION_DLQ: Queue;
  PUBLIC_SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
}

/**
 * Parameters for DataCompactionWorkflow
 * Fragments are located via D1 database lookup using datasetId, not bucketKey.
 */
interface CompactionParams {
  datasetId: string;
  table?: string;
  periodTag?: string;
  metricId?: string;
  userId?: string;
}

interface StepMetrics {
  stepName: string;
  startTime: number;
  endTime: number;
  duration: number;
  status: 'success' | 'error';
  errorMessage?: string;
  details?: Record<string, unknown>;
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
  async run(event: Readonly<WorkflowEvent<CompactionParams>>, step: WorkflowStep) {
    const { datasetId, metricId, table, periodTag, userId } = event.payload;
    const workflowStartTime = Date.now();
    const stepMetrics: StepMetrics[] = [];
    let resolvedMetricId = metricId; // Will be set if metricId is missing

    console.info(`[Workflow] Started for ${datasetId}`, {
      metricId,
      timestamp: new Date().toISOString(),
    });

    try {
      // ===== Step 1: Ensure Dataset Exists (create if missing) =====
      const step1Start = Date.now();

      const validation = await step.do('ensure-dataset', {
        retries: SUPABASE_RETRY_CONFIG
      }, async () => {
        const supabase = createClient(
          this.env.PUBLIC_SUPABASE_URL,
          this.env.SUPABASE_SECRET_KEY
        );

        // SECURITY FIX: Check dataset ownership by both id AND user_id
        // This prevents data contamination when multiple users share the same PC
        // (dataset_id is PC-specific, not user-specific)
        if (!userId) {
          throw new Error('userId is required for dataset validation');
        }

        const { data: existing, error: fetchError } = await supabase
          .from('datasets')
          .select('id, user_id, compaction_needed, compaction_in_progress')
          .eq('id', datasetId)
          .eq('user_id', userId)  // CRITICAL: Verify ownership
          .limit(1)
          .maybeSingle();

        if (fetchError) {
          throw new Error(`Dataset fetch failed: ${fetchError.message}`);
        }

        // If exists AND belongs to this user, return it
        if (existing) {
          console.info(`[Workflow] Dataset exists for user`, { datasetId, userId });
          return existing;
        }

        // If not found, create it (idempotent workflow design)
        console.info(`[Workflow] Creating missing dataset record`, { datasetId, table, periodTag, userId });
        
        const { data: created, error: createError } = await supabase
          .from('datasets')
          .insert({
            id: datasetId,
            user_id: userId,
            name: `${table || 'unknown'}-${periodTag || Date.now()}`,
            compaction_needed: true,
            compaction_in_progress: false,
          })
          .select('id, user_id, compaction_needed, compaction_in_progress')
          .single();

        if (createError) {
          throw new Error(`Dataset creation failed: ${createError.message}`);
        }
        if (!created) {
          throw new Error('Dataset creation failed: no data returned');
        }

        console.info(`[Workflow] Dataset created`, { datasetId, userId });
        return created;
      });

      const step1Duration = Date.now() - step1Start;
      stepMetrics.push({
        stepName: 'ensure-dataset',
        startTime: step1Start,
        endTime: step1Start + step1Duration,
        duration: step1Duration,
        status: 'success',
        details: {
          compaction_needed: validation.compaction_needed,
          compaction_in_progress: validation.compaction_in_progress,
        },
      });

      // ===== Step 1.5: Create processing_metrics if not provided =====
      // This happens when triggered from battle-data/upload (no metricId in message)
      // Must be done AFTER ensure-dataset to satisfy FK constraint
      if (!resolvedMetricId) {
        const metricsStart = Date.now();
        try {
          const supabase = createClient(
            this.env.PUBLIC_SUPABASE_URL,
            this.env.SUPABASE_SECRET_KEY
          );

          const { data: metricsData, error: metricsError } = await supabase
            .from('processing_metrics')
            .insert({
              dataset_id: datasetId,
              workflow_instance_id: `workflow-${Date.now()}`,
              status: 'pending',
              queued_at: new Date().toISOString(),
              workflow_started_at: new Date().toISOString(),
            })
            .select('id')
            .single();

          if (metricsError) {
            console.warn(`[Workflow] Failed to create metrics record: ${metricsError.message}`);
          } else if (metricsData?.id) {
            resolvedMetricId = metricsData.id;
            console.info(`[Workflow] Created processing_metrics record`, { metricId: resolvedMetricId });
          }
        } catch (error) {
          console.warn(`[Workflow] Error creating metrics record`, { error });
        }
      }

      // ===== Set compaction_in_progress flag (with race condition check) =====
      const setFlagStart = Date.now();
      await step.do('set-in-progress-flag', {
        retries: SUPABASE_RETRY_CONFIG
      }, async () => {
        const supabase = createClient(
          this.env.PUBLIC_SUPABASE_URL,
          this.env.SUPABASE_SECRET_KEY
        );

        // SECURITY: Atomic check-and-set with user_id verification
        // Prevents race conditions AND cross-user data contamination
        if (!userId) {
          throw new Error('userId is required to set in-progress flag');
        }

        const { data: updated, error } = await supabase
          .from('datasets')
          .update({ compaction_in_progress: true })
          .eq('id', datasetId)
          .eq('user_id', userId)  // CRITICAL: Verify ownership
          .eq('compaction_in_progress', false)
          .select('id');

        if (error) {
          throw new Error(`Failed to set in-progress flag: ${error.message}`);
        }

        // If no rows were updated, either another workflow is running OR user doesn't own this dataset
        if (!updated || updated.length === 0) {
          throw new Error('Cannot set in-progress flag: dataset not found for this user or already in progress');
        }
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
        table_offsets: string | null;
      }

      const step2Start = Date.now();
      const fragments = await step.do('list-fragments', { retries: SUPABASE_RETRY_CONFIG }, async (): Promise<D1Fragment[]> => {
        const stmt = this.env.BATTLE_INDEX_DB.prepare(
          `SELECT key, size, etag, uploaded_at, content_hash, "table", period_tag, table_offsets
           FROM battle_files
           WHERE dataset_id = ? ${table ? 'AND "table" = ?' : ''} ${periodTag ? 'AND period_tag = ?' : ''}
           ORDER BY uploaded_at ASC`
        );
        const params: unknown[] = [datasetId];
        if (table) params.push(table);
        if (periodTag) params.push(periodTag);
        const res = await stmt.bind(...params).all();
        // Cast results to typed fragments; D1 returns plain objects
        return (res?.results || []) as unknown as D1Fragment[];
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

      // ===== Step 3: Extract target table from concatenated files =====
      const extractStart = Date.now();
      const targetTable = table || filtered[0]?.table || 'unknown';
      
      console.log(`[Workflow] Extracting table "${targetTable}" from ${filtered.length} fragments`);
      
      const extractedFragments: Array<{ key: string; data: ArrayBuffer; size: number }> = [];
      
      for (const frag of filtered) {
        try {
          if (frag.table_offsets) {
            // Parse offset metadata
            const offsets = parseTableOffsets(frag.table_offsets);
            if (!offsets) {
              console.warn(`[Workflow] Failed to parse offset metadata in ${frag.key}, downloading full file`);
              // Treat as legacy fragment
              const fullFile = await this.env.BATTLE_DATA_BUCKET.get(frag.key);
              if (fullFile) {
                const data = await fullFile.arrayBuffer();
                extractedFragments.push({
                  key: frag.key,
                  data,
                  size: data.byteLength,
                });
              } else {
                console.warn(`[Workflow] Failed to download ${frag.key}, skipping`);
              }
              continue;
            }
            
            // Validate offset metadata
            const validationError = validateOffsetMetadata(offsets, frag.size);
            if (validationError) {
              console.warn(`[Workflow] Invalid offset metadata in ${frag.key}: ${validationError}, downloading full file`);
              // Treat as legacy fragment
              const fullFile = await this.env.BATTLE_DATA_BUCKET.get(frag.key);
              if (fullFile) {
                const data = await fullFile.arrayBuffer();
                extractedFragments.push({
                  key: frag.key,
                  data,
                  size: data.byteLength,
                });
              } else {
                console.warn(`[Workflow] Failed to download ${frag.key}, skipping`);
              }
              continue;
            }
            
            // Modern fragment with offset metadata - extract target table only
            const extracted = await extractTableSafe(
              this.env.BATTLE_DATA_BUCKET,
              frag.key,
              targetTable,
              frag.table_offsets
            );
            
            if (extracted) {
              // Verify extracted data is valid Parquet
              const data = new Uint8Array(extracted.data);
              if (data.length < 12) {
                console.warn(`[Workflow] Extracted data too small from ${frag.key}, skipping`);
                continue;
              }
              
              const magic = new TextDecoder().decode(data.slice(-4));
              if (magic !== 'PAR1') {
                console.warn(`[Workflow] Extracted data invalid Parquet magic from ${frag.key}, skipping`);
                continue;
              }
              
              extractedFragments.push({
                key: frag.key,
                data: extracted.data,
                size: extracted.size,
              });
            } else {
              console.warn(`[Workflow] Failed to extract ${targetTable} from ${frag.key}, skipping`);
            }
          } else {
            // Legacy fragment without offset metadata - download full file
            const fullFile = await this.env.BATTLE_DATA_BUCKET.get(frag.key);
            
            if (fullFile) {
              const data = await fullFile.arrayBuffer();
              extractedFragments.push({
                key: frag.key,
                data,
                size: data.byteLength,
              });
            } else {
              console.warn(`[Workflow] Failed to download ${frag.key}, skipping`);
            }
          }
        } catch (err) {
          console.error(`[Workflow] Error extracting from ${frag.key}:`, err);
          // Continue processing other fragments
        }
      }
      
      if (extractedFragments.length === 0) {
        throw new Error('No valid fragments after table extraction');
      }
      
      const extractDuration = Date.now() - extractStart;
      stepMetrics.push({
        stepName: 'extract-tables',
        startTime: extractStart,
        endTime: extractStart + extractDuration,
        duration: extractDuration,
        status: 'success',
        details: {
          targetTable,
          totalFragments: filtered.length,
          extractedFragments: extractedFragments.length,
          modernFragments: filtered.filter(f => f.table_offsets).length,
          legacyFragments: filtered.filter(f => !f.table_offsets).length,
        },
      });

      // ===== Step 4: Schema grouping + Stream merge =====
      const step3Start = Date.now();
      const THRESHOLD = 256 * 1024 * 1024;
      const period = periodTag || filtered[0]?.period_tag || 'unknown';
      const tbl = table || filtered[0]?.table || 'unknown';
      let outputs: Array<{ key: string; size: number; etag: string }> = [];
      const totalOriginal = extractedFragments.reduce((sum, r) => sum + r.size, 0);

      // 抽出済みデータでスキーマグルーピング実行
      const schemaGroups = await groupExtractedFragmentsBySchema(extractedFragments);
      
      let globalIndex = 0;
      for (const [schemaHash, groupFrags] of schemaGroups.entries()) {
        let cursor = 0;
        while (cursor < groupFrags.length) {
          const { picked, nextIndex } = pickFragmentsForBucket(
            groupFrags.map((f) => ({ key: f.key, size: f.size })),
            cursor,
            THRESHOLD
          );
          if (picked.length === 0) break;
          
          // 選択されたフラグメントのデータを取得
          const pickedWithData = picked.map((pickedKey) => {
            const frag = groupFrags.find((g) => g.key === pickedKey);
            if (!frag) throw new Error(`Fragment not found: ${pickedKey}`);
            return frag;
          });
          
          const outKey = `battle_compacted/${period}/${datasetId}/${tbl}/${globalIndex}.parquet`;
          
          // 抽出済みデータを使ったストリーミングマージ
          let res;
          try {
            res = await streamMergeExtractedFragments(
              this.env.BATTLE_DATA_BUCKET,
              outKey,
              pickedWithData,
              THRESHOLD
            );
          } catch (error) {
            console.error('[Workflow] Stream merge failed', {
              datasetId,
              period,
              table: tbl,
              schemaHash,
              pickedCount: pickedWithData.length,
              pickedKeys: pickedWithData.map(p => p.key),
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
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
          schemaGroups: schemaGroups.size,
        },
      });

      // ===== Step 5: Update Metadata =====
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

        // SECURITY: Verify ownership before updating dataset metadata
        if (!userId) {
          throw new Error('userId is required to update dataset metadata');
        }

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
          .eq('id', datasetId)
          .eq('user_id', userId);  // CRITICAL: Verify ownership

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

      // ===== Workflow Completion =====
      const totalDuration = Date.now() - workflowStartTime;

      console.info(`[Workflow] Completed ${datasetId} (${totalDuration}ms)`);

      // === Metrics更新（Workflow完了） ===
      if (resolvedMetricId) {
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
          .eq('id', resolvedMetricId);

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

        // SECURITY: Only reset flag if user owns this dataset
        if (userId) {
          await supabase
            .from('datasets')
            .update({ compaction_in_progress: false })
            .eq('id', datasetId)
            .eq('user_id', userId);  // Verify ownership
        } else {
          console.warn('[Workflow] Cannot reset flag: userId not available');
        }
      } catch (resetError) {
        console.error(`[Workflow] Failed to reset flag: ${resetError}`);
      }

      // === Metricsレコード更新（エラー） ===
      if (resolvedMetricId) {
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
          .eq('id', resolvedMetricId);

        if (updateMetricsError) {
          console.warn(`[Workflow] Failed to update failure metrics: ${updateMetricsError.message}`);
        }
      } else {
        console.warn(`[Workflow] No resolvedMetricId available for failure tracking`, { datasetId, errorMessage, failedStep });
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

    // POST /run - trigger new workflow instance (datasetId required)
    if (path === '/run' && request.method === 'POST') {
      try {
        const body = await request.json<Partial<CompactionParams>>();

        const datasetId = body.datasetId;
        if (!datasetId) {
          return new Response(
            JSON.stringify({ error: 'Missing datasetId' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const instance = await env.DATA_COMPACTION.create({
          params: {
            datasetId,
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

        if (!body.datasetId) {
          return new Response(
            JSON.stringify({ error: 'Missing datasetId' }),
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

    // GET /test-env - verify env bindings without leaking secrets
    if (path === '/test-env' && request.method === 'GET') {
      const publicUrl = env.PUBLIC_SUPABASE_URL;
      const secretKey = env.SUPABASE_SECRET_KEY;

      return new Response(
        JSON.stringify({
          injected: Boolean(publicUrl && secretKey),
          supabaseUrlPrefix: publicUrl ? publicUrl.slice(0, 32) : null,
          supabaseKeyLength: secretKey ? secretKey.length : null,
          timestamp: new Date().toISOString(),
        }),
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
  async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext): Promise<void> {
    // Route to appropriate handler based on queue name
    // MessageBatch.queue property contains the queue name
    const queueName = (batch as { queue?: string }).queue as string | undefined;
    
    console.info('[Queue Router] Received batch', {
      batchSize: batch.messages.length,
      queueName,
      timestamp: new Date().toISOString(),
    });
    
    if (queueName && (queueName.includes('dlq') || queueName.includes('DLQ'))) {
      console.info('[Queue Router] Routing to DLQ handler', { queueName });
      return queueDLQ.queue(batch, env, ctx);
    }
    
    console.info('[Queue Router] Routing to main queue handler', { queueName });
    return queue.queue(batch, env, ctx);
  }
};

/**
 * Queue Consumer Handler
 * Processes messages from COMPACTION_QUEUE and dispatches to Workflow
 * 
 * Message format and field requirements:
 * - All endpoints (battle-data/upload, compact/upload, etc.) produce messages with this structure
 * - Fragments are retrieved from D1 database using datasetId, not from R2 directly
 * - metricId enables end-to-end monitoring and processing status tracking
 */
interface CompactionQueueMessage {
  /** Required. Dataset ID to process. Used to locate fragments in D1. */
  datasetId: string;
  
  /** Required. ISO8601 timestamp when this message was triggered. */
  triggeredAt: string;
  
  /** Optional. Processing priority level. Defaults to 'scheduled'. */
  priority?: 'scheduled' | 'realtime' | 'manual';
  
  /** Optional. Processing metrics record ID. Enables workflow monitoring and status updates. */
  metricId?: string;
  
  /** Optional. Specific table to process. Only set by upload endpoints. */
  table?: string;
  
  /** Optional. Time period tag. Only set by upload endpoints. */
  periodTag?: string;
  
  /** Optional. User ID who owns the dataset. Required for creating new dataset records. */
  userId?: string;
}

export const queue = {
  async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext) {
    for (const message of batch.messages) {
      try {
        const { datasetId, triggeredAt, priority = 'scheduled', metricId, table, periodTag, userId } = message.body as CompactionQueueMessage;

        // Validate required fields
        if (!datasetId) {
          throw new Error('Missing required field: datasetId');
        }

        // Dispatch to Workflow
        const workflowInstance = await env.DATA_COMPACTION.create({
          params: {
            datasetId,
            metricId,
            table,
            periodTag,
            userId,
          },
        });

        // Acknowledge message on success
        message.ack();

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        console.error(`[Queue Consumer] Message processing failed`, {
          messageId: message.id,
          body: message.body,
          error: errorMsg,
          stack: error instanceof Error ? error.stack : undefined,
          timestamp: new Date().toISOString(),
        });

        // Retry logic (max 3 retries via wrangler config)
        // If max retries exceeded, message goes to DLQ automatically
        message.retry();
        console.warn(`[Queue Consumer] Message queued for retry`, { messageId: message.id });
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
  async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext) {
    console.warn(`[DLQ Handler] Processing ${batch.messages.length} failed messages`, {
      timestamp: new Date().toISOString(),
    });

    const publicUrl = env.PUBLIC_SUPABASE_URL;
    const secretKey = env.SUPABASE_SECRET_KEY;

    if (!publicUrl || !secretKey) {
      console.error('[DLQ Handler] Missing Supabase environment variables', {
        hasUrl: !!publicUrl,
        hasKey: !!secretKey,
      });
      return;
    }

    const supabase = createClient(publicUrl, secretKey);

    for (const message of batch.messages) {
      try {
        const { datasetId, triggeredAt, priority, metricId, userId } = message.body as CompactionQueueMessage;

        // Log detailed failure information
        console.error(`[DLQ Handler] Message in DLQ`, {
          datasetId,
          userId,
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

        // SECURITY: Reset compaction_in_progress flag with user verification
        // Only reset if we have userId (required for ownership check)
        if (datasetId && userId) {
          const { error: resetError } = await supabase
            .from('datasets')
            .update({ 
              compaction_in_progress: false,
              updated_at: new Date().toISOString(),
            })
            .eq('id', datasetId)
            .eq('user_id', userId)  // Verify ownership
            .eq('compaction_in_progress', true);

          if (resetError) {
            console.error(`[DLQ Handler] Failed to reset compaction flag`, {
              datasetId,
              userId,
              error: resetError.message,
            });
          } else {
            console.info(`[DLQ Handler] Reset compaction flag`, { datasetId, userId });
          }
        } else {
          console.warn(`[DLQ Handler] Cannot reset flag: missing datasetId or userId`, {
            datasetId,
            userId,
            suggestion: 'Manual flag reset required via admin dashboard'
          });
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
