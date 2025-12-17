import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import type { Bindings } from '../types';
import { CORS_HEADERS, MAX_UPLOAD_BYTES } from '../constants';
import { validateJWT } from '../utils';
import { runCompactionJob } from '../compaction/job';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * Retry utility for handling rate limits and transient errors
 * Implements exponential backoff to respect Supabase Free tier limits
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;
      const isRateLimitError = 
        (error as any)?.message?.includes('429') ||
        (error as any)?.message?.includes('Too Many Requests') ||
        (error as any)?.status === 429;

      if (isLastAttempt || !isRateLimitError) {
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms`, {
        error: (error as any)?.message,
      });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}


/**
 * Compaction service routes (Queue-based implementation)
 * 
 * Three complementary endpoints for managing data compaction:
 * 
 * 1. POST /upload - Metrics-based compaction upload
 *    Purpose: Accept multiple metric datasets and trigger compaction
 *    Priority: 'realtime'
 *    Flow: Upload → Metrics → Queue → Workflow
 *    Use case: User uploads new metrics data that needs immediate compaction
 * 
 * 2. POST /sanitize-state - Manual dataset compaction trigger
 *    Purpose: Manually trigger compaction for specific dataset
 *    Priority: 'manual'
 *    Flow: Validation → Metrics → Queue → Workflow
 *    Use case: User manually requests compaction (e.g., cleanup, optimization)
 * 
 * 3. POST /trigger-scheduled - Batch scheduled compaction
 *    Purpose: Periodic batch compaction for all datasets (called by GitHub Actions)
 *    Priority: 'scheduled'
 *    Flow: Find all datasets → Create metrics → Batch queue → Workflows
 *    Use case: Nightly/periodic compaction of accumulated fragments
 */

// OPTIONS (CORS)
app.options('*', (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }));

/**
 * POST /upload
 * Upload Parquet file to R2 and trigger compaction workflow
 * 
 * Security: Requires valid Supabase JWT token
 */
app.post('/upload', async (c) => {
  try {
    const env = c.env;
    
    // === Security: Validate JWT token first ===
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') 
      ? authHeader.slice(7).trim() 
      : null;

    if (!token) {
      console.warn('[compact-upload] Missing Authorization header');
      return c.json({ error: 'Unauthorized - Missing Authorization header' }, 401);
    }

    const supabaseUser = await validateJWT(token);
    
    if (!supabaseUser) {
      console.warn('[compact-upload] Invalid JWT token');
      return c.json({ error: 'Unauthorized - Invalid or expired token' }, 401);
    }

    const userId = supabaseUser.id;
      console.info('[compact-upload] Authenticated user', { userId });    // === Parse and validate form data ===
    let formData;
    try {
      formData = await c.req.formData();
    } catch (error) {
      console.error('[compact-upload] Invalid FormData', { error });
      return c.json({ error: 'Invalid FormData format' }, 400);
    }

    const datasetId = formData.get('datasetId') as string;
    const tableId = formData.get('tableId') as string;
    const periodTag = (formData.get('periodTag') as string) || '0'; // Default to '0' if not provided
    const file = formData.get('file') as File;

    if (!datasetId || !tableId || !file) {
      return c.json({ error: 'Missing required fields: datasetId, tableId, file' }, 400);
    }

      console.info('[compact-upload] Form data parsed', {
      datasetId,
      tableId,
      periodTag,
      fileSize: file.size,
    });

    // Basic validation: file size and extension
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: `File too large. Max ${MAX_UPLOAD_BYTES} bytes` }, 413);
    }
    if (!file.name.toLowerCase().endsWith('.parquet')) {
      return c.json({ error: 'Only .parquet files are accepted' }, 415);
    }

    const supabase = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false },
    });

    // ===== Step 1: R2 に Parquet ファイル保存 =====
    const bucketKey = `${datasetId}/${tableId}`;
    const buffer = await file.arrayBuffer();

      console.info(`[compact-upload] Uploading file to R2`, {
      datasetId,
      tableId,
      bucketKey,
      periodTag,
      fileSize: buffer.byteLength,
      timestamp: new Date().toISOString(),
    });

    const r2Result = await env.BATTLE_DATA_BUCKET.put(bucketKey, buffer, {
      customMetadata: {
        dataset_id: datasetId,
        table_id: tableId,
        period_tag: periodTag,
        uploaded_at: new Date().toISOString(),
        original_filename: file.name,
      },
    });

    if (!r2Result) {
        console.error(`[compact-upload] R2 upload failed`);
      return c.json({ error: 'Failed to upload file to R2' }, 500);
    }

      console.info(`[compact-upload] R2 upload completed`, {
      bucketKey,
      etag: r2Result.etag,
    });

    // ===== Step 2: Supabase datasets レコードの再利用 or 作成 =====
    // ポリシー: datasetId が既存ならそれを再利用し、常に新規作成しない
    // 1) 既存確認（所有者チェック込み）
    let resolvedDatasetId = datasetId;
    let createdNew = false;

    const { data: existingDs, error: existingErr } = await supabase
      .from('datasets')
      .select('id, user_id')
      .eq('id', datasetId)
      .single();

    if (existingErr || !existingDs) {
      // 2) 見つからない場合のみ作成（レート制限に配慮してリトライ）
      const insertResult = await withRetry(async () => {
        const result = await supabase
          .from('datasets')
          .insert({
            user_id: userId, // From authenticated JWT
            name: `${tableId}-${new Date().getTime()}`,
            file_size_bytes: buffer.byteLength,
            file_etag: `${datasetId}/${tableId}`,
            compaction_needed: true,
            compaction_in_progress: false,
          })
          .select();
        if (result.error) throw result.error;
        return result;
      });

      const { data: created, error: insertError } = insertResult;
      if (insertError || !created || !created[0]) {
        console.error(`[compact-upload] Supabase insert failed`, { error: insertError, data: created });
        return c.json({ error: 'Failed to create dataset record', details: (insertError as any)?.message || 'No data returned' }, 500);
      }
      resolvedDatasetId = created[0].id;
      createdNew = true;
      console.info(`[compact-upload] Supabase record created`, { datasetId: resolvedDatasetId });
    } else {
      // 3) 既存 re-use: 所有者チェック
      if (existingDs.user_id !== userId) {
        return c.json({ error: 'Forbidden - dataset not owned by user' }, 403);
      }
      // 既存データセットを更新してフラグを立てる
      const updateResult = await withRetry(async () => {
        const result = await supabase
          .from('datasets')
          .update({
            file_size_bytes: buffer.byteLength,
            file_etag: `${datasetId}/${tableId}`,
            compaction_needed: true,
            compaction_in_progress: false,
          })
          .eq('id', datasetId)
          .select('id')
          .single();
        if (result.error) throw result.error;
        return result;
      }).catch((error) => {
        console.warn('[compact-upload] Failed to update existing dataset flags', { error });
        return null;
      });
      if (updateResult?.data?.id) {
        resolvedDatasetId = updateResult.data.id;
      }
    }

    // ===== Step 3: Create processing_metrics record for monitoring =====
    const metricsResult = await withRetry(async () => {
      const result = await supabase
        .from('processing_metrics')
        .insert({
          dataset_id: resolvedDatasetId,
          workflow_instance_id: `realtime-${Date.now()}`,
          status: 'pending',
          queued_at: new Date().toISOString(),
        })
        .select()
        .single();
      
      if (result.error) throw result.error;
      return result;
    }).catch((error) => {
      console.warn(`[compact-upload] Failed to create metrics record`, { error });
      // Don't fail the upload if metrics creation fails (graceful degradation)
      return { data: null, error };
    });

    const metricsId = metricsResult.data?.id;
    console.info(`[compact-upload] Metrics record created`, { metricsId });

    // ===== Step 4: Queue に投入（リトライ付き） =====
    console.info(`[compact-upload] Step 4: About to enqueue to COMPACTION_QUEUE`, {
      datasetId: resolvedDatasetId,
      metricsId,
      periodTag,
      queueExists: !!env.COMPACTION_QUEUE,
      timestamp: new Date().toISOString(),
    });

    let queueSuccess = false;
    try {
      await withRetry(async () => {
        console.info(`[compact-upload] Calling env.COMPACTION_QUEUE.send()...`);
        const sendResult = await env.COMPACTION_QUEUE.send({
          datasetId: resolvedDatasetId,
          triggeredAt: new Date().toISOString(),
          priority: 'realtime',
          metricId: metricsId,
          periodTag: periodTag,
          table: tableId,
        });
        console.info(`[compact-upload] Queue send result:`, { sendResult });
        return sendResult;
      });
      queueSuccess = true;
      console.info(`[compact-upload] Successfully enqueued to compaction queue`, { datasetId: resolvedDatasetId, metricsId, periodTag, createdNew });
    } catch (queueError) {
      console.error(`[compact-upload] FAILED to enqueue to compaction queue`, {
        datasetId: resolvedDatasetId,
        metricsId,
        periodTag,
        error: String(queueError),
        errorMessage: (queueError as any)?.message,
        errorStack: (queueError as any)?.stack,
        timestamp: new Date().toISOString(),
      });
      // Don't fail the upload if queue enqueue fails - metrics are already recorded
      console.warn(`[compact-upload] Continuing despite queue failure - R2 upload and metadata are complete`);
    }

    return c.json({
      success: true,
      datasetId: resolvedDatasetId,
      tableId,
      fileName: file.name,
      fileSize: buffer.byteLength,
    });
  } catch (error) {
      console.error('[compact-upload] Unexpected error', { error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * POST /sanitize-state
 * Manual trigger for dataset-wide compaction and state cleaning
 * 
 * Purpose: Allow users to manually request compaction for a dataset
 * Queue priority: 'manual'
 * Use cases:
 *   - User wants to clean up accumulated fragments immediately
 *   - Data integrity check needed
 *   - Manual optimization request
 * 
 * Security: Requires valid Supabase JWT token
 */
app.post('/sanitize-state', async (c) => {
  try {
    const env = c.env;

    // Require JWT authentication
    const authHeader = c.req.header('Authorization');
    const bearer = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : null;
    if (!bearer) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const supabaseUser = await validateJWT(bearer);
    if (!supabaseUser) {
      return c.json({ error: 'Invalid or expired JWT token' }, 401);
    }

    let body;
    try {
      body = await c.req.json();
    } catch (error) {
      console.error('[Sanitize State] Invalid JSON', { error });
      return c.json({ error: 'Invalid JSON format' }, 400);
    }

    const { datasetId } = body;

    if (!datasetId) {
      return c.json({ error: 'datasetId is required' }, 400);
    }

    // Verify ownership of dataset
    const supabase = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false },
    });
    const { data: ds, error: dsError } = await supabase
      .from('datasets')
      .select('id, user_id, compaction_in_progress, compaction_needed')
      .eq('id', datasetId)
      .single();
    if (dsError || !ds) {
      return c.json({ error: 'Dataset not found' }, 404);
    }
    if (ds.user_id !== supabaseUser.id) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Verify dataset exists by id (UUID primary key)
    const { data, error } = await supabase
      .from('datasets')
      .select('id, name, compaction_needed')
      .eq('id', datasetId)
      .single();

    if (error || !data) {
      console.error(`[compact-sanitize] Dataset not found`, { datasetId, error });
      return c.json({ error: 'Dataset not found' }, 404);
    }

    // Create metrics record for this manual trigger with retry logic
    const manualMetricsResult = await withRetry(async () => {
      const result = await supabase
        .from('processing_metrics')
        .insert({
          dataset_id: datasetId,
          workflow_instance_id: `manual-${Date.now()}`,
          status: 'pending',
          queued_at: new Date().toISOString(),
        })
        .select()
        .single();
      
      if (result.error) throw result.error;
      return result;
    }).catch((error) => {
      console.warn(`[compact-sanitize] Failed to create metrics record`, { error });
      // Don't fail if metrics creation fails (graceful degradation)
      return { data: null, error };
    });

    const metricsId = manualMetricsResult.data?.id;

    // Enqueue to compaction queue (with retry)
    console.info(`[compact-sanitize] About to enqueue dataset`, {
      datasetId,
      metricsId,
      queueExists: !!env.COMPACTION_QUEUE,
    });

    try {
      await withRetry(async () => {
        console.info(`[compact-sanitize] Calling env.COMPACTION_QUEUE.send()...`);
        const sendResult = await env.COMPACTION_QUEUE.send({
          datasetId,
          triggeredAt: new Date().toISOString(),
          priority: 'manual',
          metricId: metricsId,
        });
        console.info(`[compact-sanitize] Queue send result:`, { sendResult });
        return sendResult;
      });
      console.info(`[compact-sanitize] Successfully enqueued dataset`, { datasetId, name: data.name });
    } catch (queueError) {
      console.error(`[compact-sanitize] FAILED to enqueue dataset`, {
        datasetId,
        metricsId,
        error: String(queueError),
        errorMessage: (queueError as any)?.message,
      });
      // Don't fail the request - metrics are already recorded
      console.warn(`[compact-sanitize] Continuing despite queue failure`);
    }

    return c.json({
      success: true,
      datasetId,
      message: 'Dataset enqueued for compaction',
    });
  } catch (error) {
    console.error('[compact-sanitize] Unexpected error', { error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * POST /trigger-scheduled
 * Batch scheduled compaction trigger (called by GitHub Actions cron)
 * 
 * Purpose: Periodic batch compaction of all datasets needing compaction
 * Queue priority: 'scheduled'
 * Flow: Fetch datasets → Create metrics → Batch queue → Parallel workflows
 * 
 * Optimization:
 *   - Batch metric insertion (up to 10 datasets at a time)
 *   - Retry logic for transient failures
 *   - Parallel queue operations for efficiency
 * 
 * Use case: Nightly/periodic compaction of accumulated fragments
 * 
 * Note: No authentication required (assumed to be called only from CI/CD)
 *       In production, should add auth or IP whitelist
 */
app.post('/trigger-scheduled', async (c) => {
  try {
    const env = c.env;
    const supabase = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false },
    });

    console.info('[compact-scheduled] Starting scheduled compaction');

    // Fetch datasets that need compaction (not currently in progress)
    const fetchResult = await withRetry(async () => {
      const result = await supabase
        .from('datasets')
        .select('id, name')
        .eq('compaction_needed', true)
        .eq('compaction_in_progress', false)
        .order('created_at', { ascending: true })
        .limit(10);
      
      if (result.error) throw result.error;
      return result;
    });

    const { data: datasets, error } = fetchResult;

    if (error) {
      console.error('[compact-scheduled] Failed to fetch datasets', { error });
      return c.json({ error: 'Failed to fetch pending datasets', details: (error as any)?.message }, 500);
    }

    if (!datasets || datasets.length === 0) {
      console.info('[compact-scheduled] No pending datasets found');
      return c.json({
        success: true,
        message: 'No pending datasets to process',
        enqueued: 0,
        datasets: [],
      });
    }

    // ===== OPTIMIZATION 1: Batch metric insertion =====
    // Insert all metrics records in a single batch to reduce Supabase queries
    const metricsPayload = datasets.map((dataset) => ({
      dataset_id: dataset.id,
      workflow_instance_id: `scheduled-${Date.now()}-${dataset.id}`,
      status: 'pending' as const,
      queued_at: new Date().toISOString(),
    }));

    const metricsInsertResult = await withRetry(async () => {
      const result = await supabase
        .from('processing_metrics')
        .insert(metricsPayload)
        .select('id, dataset_id');
      
      if (result.error) throw result.error;
      return result;
    });

    const { data: metricsResults, error: metricsError } = metricsInsertResult;

    if (metricsError) {
      console.error('[compact-scheduled] Failed to create metrics records', { metricsError });
      return c.json({ 
        error: 'Failed to create metrics records', 
        details: (metricsError as any)?.message 
      }, 500);
    }

    // Create a map of dataset_id -> metricId for quick lookup
    const metricsMap = new Map(
      (metricsResults || []).map((m) => [m.dataset_id, m.id])
    );

    // ===== OPTIMIZATION 2: Batch queue operations with retry logic =====
    console.info(`[compact-scheduled] Step: About to enqueue ${datasets.length} datasets`, {
      datasetIds: datasets.map((d) => d.id),
      queueExists: !!env.COMPACTION_QUEUE,
      metricsCount: metricsResults?.length || 0,
    });

    const enqueueResults: Array<{ datasetId: string; status: 'success' | 'failed'; error?: string }> = [];

    const enqueuePromises = datasets.map((dataset) =>
      withRetry(() =>
        Promise.resolve(
          env.COMPACTION_QUEUE.send({
            datasetId: dataset.id,
            triggeredAt: new Date().toISOString(),
            priority: 'scheduled',
            metricId: metricsMap.get(dataset.id),
          })
        )
      )
        .then(() => {
          console.info(`[compact-scheduled] Successfully enqueued dataset`, { datasetId: dataset.id });
          enqueueResults.push({ datasetId: dataset.id, status: 'success' });
        })
        .catch((err) => {
          console.error(`[compact-scheduled] Failed to enqueue dataset`, {
            datasetId: dataset.id,
            error: String(err),
            errorMessage: (err as any)?.message,
          });
          enqueueResults.push({ datasetId: dataset.id, status: 'failed', error: String(err) });
        })
    );

    await Promise.allSettled(enqueuePromises);

    const successCount = enqueueResults.filter((r) => r.status === 'success').length;
    const failureCount = enqueueResults.filter((r) => r.status === 'failed').length;

    console.info(`[compact-scheduled] Enqueue batch completed`, {
      total: datasets.length,
      successful: successCount,
      failed: failureCount,
      failures: enqueueResults.filter((r) => r.status === 'failed'),
      timestamp: new Date().toISOString(),
    });

    const datasetIds = datasets.map((d) => d.id);
    console.info('[compact-scheduled] Enqueued datasets', {
      count: datasets.length,
      datasetIds,
      timestamp: new Date().toISOString(),
    });

    return c.json({
      success: true,
      message: `Enqueued ${datasets.length} datasets for compaction`,
      enqueued: datasets.length,
      datasets: datasetIds,
    });
  } catch (error) {
    console.error('[compact-scheduled] Unexpected error', { error });
    return c.json({ error: 'Internal server error', details: String(error) }, 500);
  }
});

/**
 * POST /run-now
 * Synchronous compaction runner (fallback when Queue consumer is unavailable)
 * Body: { datasetId: string, table?: string, periodTag?: string }
 */
app.post('/run-now', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');
    const bearer = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : null;
    if (!bearer) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const supabaseUser = await validateJWT(bearer);
    if (!supabaseUser) {
      return c.json({ error: 'Invalid or expired JWT token' }, 401);
    }

    let body: any;
    try {
      body = await c.req.json();
    } catch (error) {
      return c.json({ error: 'Invalid JSON format' }, 400);
    }

    const datasetId = body?.datasetId as string | undefined;
    const table = body?.table as string | undefined;
    const periodTag = body?.periodTag as string | undefined;

    if (!datasetId) {
      return c.json({ error: 'datasetId is required' }, 400);
    }

    // Optional ownership check: ensure dataset belongs to caller
    const supabase = createClient(c.env.PUBLIC_SUPABASE_URL, c.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false },
    });
    const { data: ds, error: dsError } = await supabase
      .from('datasets')
      .select('id, user_id')
      .eq('id', datasetId)
      .single();
    if (dsError || !ds) {
      return c.json({ error: 'Dataset not found' }, 404);
    }
    if (ds.user_id !== supabaseUser.id) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const result = await runCompactionJob(c.env, datasetId, table, periodTag);

    return c.json({ success: true, datasetId, table, periodTag, result });
  } catch (error) {
    console.error('[Run Now API] Unexpected error', { error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /dlq-status
 * Get Dead Letter Queue status (failed compaction records)
 * Includes both workflow failures and DLQ failures
 */
app.get('/dlq-status', async (c) => {
  try {
    const env = c.env;
    const supabase = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false },
    });

    // Fetch failed records from processing_metrics (including dlq_failure)
    const { data, error } = await supabase
      .from('processing_metrics')
      .select('id, dataset_id, workflow_instance_id, status, error_message, error_step, created_at, workflow_completed_at')
      .in('status', ['failure', 'dlq_failure'])
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[DLQ Status API] Supabase query failed', { error });
      return c.json({ error: 'Failed to fetch DLQ status', details: error.message }, 500);
    }

    // Separate by failure type for better monitoring
    const workflowFailures = (data || []).filter(r => r.status === 'failure');
    const dlqFailures = (data || []).filter(r => r.status === 'dlq_failure');

    return c.json({
      success: true,
      total: data?.length || 0,
      workflow_failures: {
        count: workflowFailures.length,
        records: workflowFailures,
      },
      dlq_failures: {
        count: dlqFailures.length,
        records: dlqFailures,
      },
    });
  } catch (error) {
    console.error('[DLQ Status API] Unexpected error', { error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;
