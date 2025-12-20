import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { pickFragmentsForBucket } from './parquet-merge';
import { streamMergeParquetFragments, streamMergeExtractedFragments } from './parquet-stream-merge';
import { groupFragmentsBySchema, groupExtractedFragmentsBySchema, processSchemaGroups, SchemaGroupOutput } from './parquet-schema';
import { validateParquetFile, formatValidationReport, validateParquetBatch } from './parquet-validator';
import { extractTableSafe, validateOffsetMetadata, parseTableOffsets, filterEmptyTables } from './table-offset-extractor';

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  BATTLE_INDEX_DB: D1Database;
  DATA_COMPACTION: Workflow;
  COMPACTION_QUEUE: Queue;
  COMPACTION_DLQ: Queue;
}

/**
 * Parameters for DataCompactionWorkflow
 * Fragments are located via D1 database lookup using datasetId, not bucketKey.
 */
interface CompactionParams {
  datasetId: string;
  table?: string;
  periodTag?: string;
  userId: string;  // Required: all workflow steps need user validation
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
 * Standard retry configuration for D1 operations
 * Uses exponential backoff with max 3 retries
 */

export class DataCompactionWorkflow extends WorkflowEntrypoint<Env, CompactionParams> {
  async run(event: Readonly<WorkflowEvent<CompactionParams>>, step: WorkflowStep) {
    const { datasetId, table, periodTag, userId } = event.payload;
    const workflowStartTime = Date.now();
    const stepMetrics: StepMetrics[] = [];

    console.info(`[Workflow] Started for ${datasetId}`, {
      timestamp: new Date().toISOString(),
    });

    try {
      // ===== Step 1: Ensure Dataset Exists (create if missing) - D1 Database =====
      const step1Start = Date.now();

      type ValidationResult = {
        id: string | number;
        user_id: string;
        compaction_needed: number | boolean;
        compaction_in_progress: number | boolean;
      };

      const validation = await step.do('ensure-dataset', {
        retries: {
          limit: 3,
          delay: 1000,
          backoff: 'exponential' as const,
        }
      }, async (): Promise<ValidationResult> => {
        if (!userId) {
          throw new Error('userId is required for dataset validation');
        }

        // Query D1 for existing dataset
        const existing = await this.env.BATTLE_INDEX_DB.prepare(
          `SELECT id, user_id, compaction_needed, compaction_in_progress
           FROM datasets
           WHERE id = ?`
        ).bind(datasetId).first<ValidationResult>();

        if (existing) {
          // Verify ownership
          if (existing.user_id !== userId) {
            throw new Error(`Dataset ${datasetId} belongs to different user`);
          }
          console.info(`[Workflow] Dataset exists in D1`, { datasetId, userId });
          return {
            id: existing.id,
            user_id: existing.user_id,
            compaction_needed: existing.compaction_needed,
            compaction_in_progress: existing.compaction_in_progress,
          };
        }

        // Create new dataset in D1
        // Note: User existence is validated by application layer, D1 has no FK constraint
        await this.env.BATTLE_INDEX_DB.prepare(
          `INSERT INTO datasets (id, user_id, dataset_name, dataset_ref, compaction_needed, compaction_in_progress, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, 0, datetime('now'), datetime('now'))`
        ).bind(datasetId, userId, table || 'unknown', datasetId).run();

        console.info(`[Workflow] Created dataset in D1`, { datasetId, userId });
        return {
          id: datasetId,
          user_id: userId,
          compaction_needed: 1,
          compaction_in_progress: 0,
        } as ValidationResult;
      });

      const step1Duration = Date.now() - step1Start;
      stepMetrics.push({
        stepName: 'ensure-dataset',
        startTime: step1Start,
        endTime: step1Start + step1Duration,
        duration: step1Duration,
        status: 'success',
        details: {
          compaction_needed: (validation as ValidationResult)?.compaction_needed,
          compaction_in_progress: (validation as ValidationResult)?.compaction_in_progress,
        },
      });

      // ===== Set compaction_in_progress flag - D1 Database =====
      const setFlagStart = Date.now();
      await step.do('set-in-progress-flag', {
        retries: {
          limit: 3,
          delay: 1000,
          backoff: 'exponential' as const,
        }
      }, async () => {
        if (!userId) {
          throw new Error('userId is required to set in-progress flag');
        }

        // Atomic UPDATE with user verification
        const result = await this.env.BATTLE_INDEX_DB.prepare(
          `UPDATE datasets
           SET compaction_in_progress = 1, updated_at = datetime('now')
           WHERE id = ? AND user_id = ?`
        ).bind(datasetId, userId).run();

        if (!result.success || result.meta.changes === 0) {
          throw new Error('Cannot set in-progress flag: dataset not found for this user or already in progress');
        }
      });

      const setFlagDuration = Date.now() - setFlagStart;
      stepMetrics.push({
        stepName: 'set-in-progress-flag',
        startTime: setFlagStart,
        endTime: setFlagStart + setFlagDuration,
        duration: setFlagDuration,
        status: 'success',
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
      const fragments = await step.do('list-fragments', { retries: { limit: 3, delay: 1000, backoff: 'exponential' as const } }, async (): Promise<D1Fragment[]> => {
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

      // ===== Step 2.5: Extract target table from concatenated files (substep) =====
      const extractStart = Date.now();
      const targetTable = table || filtered[0]?.table || 'unknown';
      
      console.log(`[Workflow] Extracting table "${targetTable}" from ${filtered.length} fragments`);
      console.log(`[Workflow] Fragment details:`);
      for (const frag of filtered) {
        console.log(`  - ${frag.key}: size=${frag.size}, table=${frag.table}, has_table_offsets=${!!frag.table_offsets}, offsets_content=${frag.table_offsets ? frag.table_offsets.substring(0, 100) : 'null'}`);
      }
      
      const extractedFragments: Array<{ key: string; data: ArrayBuffer; size: number }> = [];
      
      for (const frag of filtered) {
        try {
          if (!frag.table_offsets) {
            console.warn(`[Workflow] CRITICAL: Fragment ${frag.key} has NO table_offsets (NULL/undefined) - will download full file which may be multi-table concatenated and cause memory errors`);
          }
          
          if (frag.table_offsets) {
            // Parse offset metadata
            const offsets = parseTableOffsets(frag.table_offsets);
            console.info(`[Workflow] Fragment ${frag.key} has table_offsets: ${frag.table_offsets}`);
            console.info(`[Workflow] Parsed offsets for ${frag.key}: ${offsets ? JSON.stringify(offsets.map(o => o.table_name)) : 'null'}`);
            if (!offsets) {
              console.warn(`[Workflow] Failed to parse offset metadata in ${frag.key}, downloading full file`);
              // Treat as legacy fragment
              const fullFile = await this.env.BATTLE_DATA_BUCKET.get(frag.key);
              if (fullFile) {
                const data = await fullFile.arrayBuffer();
                console.warn(`[Workflow] CRITICAL: Downloading full concatenated file ${frag.key} (${data.byteLength} bytes) because table_offsets parsing failed - this may cause memory errors in streamMerge`);
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
            const { valid, errors } = validateOffsetMetadata(offsets, frag.size);
            if (!valid) {
              console.warn(`[Workflow] Invalid offset metadata in ${frag.key}: ${errors.join(', ')}, downloading full file`);
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
            
            // Modern fragment with offset metadata
            // Special case: when targetTable is the container 'port_table', extract ALL tables by offsets
            if ((targetTable || '').toLowerCase() === 'port_table') {
              // Filter out empty tables (numRows=0) to avoid extraction errors
              const { valid: validOffsets, empty: emptyTables } = filterEmptyTables(offsets);
              
              if (emptyTables.length > 0) {
                console.info(`[Workflow] Filtered out ${emptyTables.length} empty tables from ${frag.key}: ${emptyTables.map(t => t.table_name).join(', ')}`);
              }
              
              for (const off of validOffsets) {
                if (off.format !== 'parquet') continue;
                const perTableExtract = await extractTableSafe(
                  this.env.BATTLE_DATA_BUCKET,
                  frag.key,
                  off.table_name,
                  frag.table_offsets
                );
                if (!perTableExtract) {
                  console.warn(`[Workflow] Failed to extract ${off.table_name} from ${frag.key}; skipping this table`);
                  continue;
                }
                const dataView = new Uint8Array(perTableExtract.data);
                if (dataView.length < 12) {
                  console.warn(`[Workflow] Extracted data too small from ${frag.key}#${off.table_name}, skipping`);
                  continue;
                }
                const magic = new TextDecoder().decode(dataView.slice(-4));
                if (magic !== 'PAR1') {
                  console.warn(`[Workflow] Extracted data invalid Parquet magic from ${frag.key}#${off.table_name}, skipping`);
                  continue;
                }
                // Ensure unique key per extracted table to avoid merge mapping collisions
                extractedFragments.push({
                  key: `${frag.key}#${off.table_name}`,
                  data: perTableExtract.data,
                  size: perTableExtract.size,
                });
              }
            } else {
              // Extract only the requested target table
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
                  key: `${frag.key}#${targetTable}`,
                  data: extracted.data,
                  size: extracted.size,
                });
              } else {
                // Fallback: treat as legacy single-table fragment if extraction failed
                console.warn(`[Workflow] Failed to extract ${targetTable} from ${frag.key}, skipping fallback to full-file to avoid multi-table parse errors`);
                // Intentionally skip to avoid hyparquet failures on concatenated files
              }
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

      // ===== Step 3: Schema grouping + Stream merge (fetch-and-merge) =====
      const step3Start = Date.now();
      const THRESHOLD = 256 * 1024 * 1024;
      const period = periodTag || filtered[0]?.period_tag || 'unknown';
      const baseTable = table || filtered[0]?.table || 'unknown';
      const tbl = (baseTable || '').toLowerCase() === 'port_table' ? 'mixed' : baseTable;
      let outputs: Array<{ key: string; size: number; etag: string }> = [];
      const totalOriginal = extractedFragments.reduce((sum, r) => sum + r.size, 0);

      // Filter out empty Parquet files (0 row groups) before schema grouping
      const validFragments = extractedFragments.filter((frag) => {
        const data = new Uint8Array(frag.data);
        // Check if this looks like a valid Parquet file
        // Minimum Parquet: 4 bytes magic PAR1 + some metadata + 4 bytes magic at end = 8+ bytes
        if (data.length < 12) {
          console.info(`[Workflow] Filtering out empty fragment ${frag.key} (size: ${frag.size} bytes)`);
          return false;
        }
        
        // Check for Parquet magic bytes
        const magic = new TextDecoder().decode(data.slice(-4));
        if (magic !== 'PAR1') {
          console.info(`[Workflow] Filtering out invalid Parquet fragment ${frag.key} (no PAR1 magic)`);
          return false;
        }
        
        return true;
      });

      console.info(`[Workflow] Filtered ${extractedFragments.length - validFragments.length} empty/invalid fragments, ${validFragments.length} valid fragments remain`);

      // 抽出済みデータでスキーマグルーピング実行
      const schemaGroups = await groupExtractedFragmentsBySchema(validFragments);
      
      // Filter out groups with "unknown" schema (empty Parquet files that have no row groups)
      const validSchemaGroups = new Map<string, typeof validFragments>();
      let unknownCount = 0;
      for (const [schemaHash, groupFrags] of schemaGroups.entries()) {
        if (schemaHash === 'unknown') {
          unknownCount += groupFrags.length;
          console.info(`[Workflow] Filtering out ${groupFrags.length} fragments with unknown schema (empty Parquet)`);
        } else {
          validSchemaGroups.set(schemaHash, groupFrags);
        }
      }

      if (unknownCount > 0) {
        console.info(`[Workflow] Filtered ${unknownCount} total empty Parquet fragments before compaction`);
      }
      
      let globalIndex = 0;
      for (const [schemaHash, groupFrags] of validSchemaGroups.entries()) {
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
          
          // DETAILED LOGGING before stream merge
          console.log(`[Workflow] About to merge schema group ${schemaHash}`, {
            fragmentCount: pickedWithData.length,
            fragments: pickedWithData.map(f => ({ key: f.key, size: f.size, hasData: !!f.data }))
          });
          
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
              outKey,
              threshold: THRESHOLD,
              pickedFragments: pickedWithData.map(p => ({
                key: p.key,
                size: p.size,
                dataLength: p.data?.byteLength
              })),
              error: error instanceof Error ? error.message : String(error),
              errorStack: error instanceof Error ? error.stack : undefined,
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

      // ===== Step 4: Update Metadata (update-metadata) =====
      const step4Start = Date.now();

      await step.do('update-metadata', {
        retries: {
          limit: 3,
          delay: 3000,
          backoff: 'linear'
        }
      }, async () => {
        // SECURITY: Verify ownership via UPDATE with user_id check
        if (!userId) {
          throw new Error('userId is required to update dataset metadata');
        }

        // Atomic finalization: set flags and update metadata in one transaction
        const result = await this.env.BATTLE_INDEX_DB.prepare(
          `UPDATE datasets
           SET compaction_needed = 0,
               compaction_in_progress = 0,
               file_size_bytes = ?,
               compression_ratio = ?,
               last_compacted_at = datetime('now'),
               updated_at = datetime('now')
           WHERE id = ? AND user_id = ?`
        ).bind(
          totalCompacted,
          totalOriginal > 0 ? totalCompacted / totalOriginal : 1.0,
          datasetId,
          userId
        ).run();

        if (!result.success || result.meta.changes === 0) {
          throw new Error('Metadata finalization failed: dataset not found or ownership check failed');
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

      // Record success metrics to D1 (non-fatal on error)
      try {
        await this.env.BATTLE_INDEX_DB.prepare(
          `INSERT INTO compaction_metrics (
             dataset_id, status, workflow_total_duration_ms, compression_ratio, original_size_bytes, created_at
           ) VALUES (?, 'success', ?, ?, ?, datetime('now'))`
        ).bind(
          datasetId,
          totalDuration,
          totalOriginal > 0 ? totalCompacted / totalOriginal : 1.0,
          totalOriginal
        ).run();
      } catch (metricsErr) {
        console.warn('[Workflow] Failed to write success metrics', { error: String(metricsErr) });
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

      // === フラグリセット（D1） ===
      try {
        if (userId) {
          await this.env.BATTLE_INDEX_DB.prepare(
            `UPDATE datasets
             SET compaction_in_progress = 0, updated_at = datetime('now')
             WHERE id = ? AND user_id = ?`
          ).bind(datasetId, userId).run();
        } else {
          console.warn('[Workflow] Cannot reset flag: userId not available');
        }
      } catch (resetError) {
        console.error(`[Workflow] Failed to reset flag: ${resetError}`);
      }

      // Record failure metrics to D1 (non-fatal)
      try {
        await this.env.BATTLE_INDEX_DB.prepare(
          `INSERT INTO compaction_metrics (
             dataset_id, status, workflow_total_duration_ms, error_step, error_message, created_at
           ) VALUES (?, 'failure', ?, ?, ?, datetime('now'))`
        ).bind(
          datasetId,
          failureDuration,
          failedStep,
          errorMessage
        ).run();
      } catch (metricsErr) {
        console.warn('[Workflow] Failed to write failure metrics', { error: String(metricsErr) });
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

        const userId = body.userId;
        if (!userId) {
          return new Response(
            JSON.stringify({ error: 'Missing userId' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const instance = await env.DATA_COMPACTION.create({
          params: {
            datasetId,
            table: body.table,
            periodTag: body.periodTag,
            userId,
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

        if (!body.userId) {
          return new Response(
            JSON.stringify({ error: 'Missing userId' }),
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
      return new Response(
        JSON.stringify({
          injected: true,
          database: 'D1',
          buckets: ['BATTLE_DATA_BUCKET'],
          queues: ['dev-kc-compaction-queue'],
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
 */
interface CompactionQueueMessage {
  /** Required. Dataset ID to process. Used to locate fragments in D1. */
  datasetId: string;
  
  /** Required. ISO8601 timestamp when this message was triggered. */
  triggeredAt: string;
  
  /** Optional. Processing priority level. Defaults to 'scheduled'. */
  priority?: 'scheduled' | 'realtime' | 'manual';

  /** Optional. Specific table to process. Only set by upload endpoints. */
  table?: string;
  
  /** Optional. Time period tag. Only set by upload endpoints. */
  periodTag?: string;
  
  /** Required. User ID who owns the dataset. All workflow steps require user validation. */
  userId: string;
}

export const queue = {
  async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext) {
    for (const message of batch.messages) {
      try {
        const { datasetId, triggeredAt, priority = 'scheduled', table, periodTag, userId } = message.body as CompactionQueueMessage;

        // Validate required fields
        if (!datasetId) {
          throw new Error('Missing required field: datasetId');
        }
        if (!userId) {
          throw new Error('Missing required field: userId');
        }

        // Dispatch to Workflow
        const workflowInstance = await env.DATA_COMPACTION.create({
          params: {
            datasetId,
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
 * Resets compaction_in_progress flag to allow retry in next scheduled run
 */
export const queueDLQ = {
  async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext) {
    console.warn(`[DLQ Handler] Processing ${batch.messages.length} failed messages`, {
      timestamp: new Date().toISOString(),
    });

    for (const message of batch.messages) {
      try {
        const { datasetId, triggeredAt, priority, userId } = message.body as CompactionQueueMessage;

        // Log detailed failure information
        console.error(`[DLQ Handler] Message in DLQ`, {
          datasetId,
          userId,
          triggeredAt,
          priority,
          messageId: message.id,
          timestamp: new Date().toISOString(),
        });

        // SECURITY: Reset compaction_in_progress flag with user verification (D1)
        // Only reset if we have userId (required for ownership check)
        if (datasetId && userId) {
          try {
            await env.BATTLE_INDEX_DB.prepare(
              `UPDATE datasets
               SET compaction_in_progress = 0, updated_at = datetime('now')
               WHERE id = ? AND user_id = ?`
            ).bind(datasetId, userId).run();
            console.info(`[DLQ Handler] Reset in-progress flag in D1`, { datasetId, userId });
          } catch (resetError) {
            console.error(`[DLQ Handler] Failed to reset flag in D1`, {
              datasetId,
              error: resetError,
            });
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
