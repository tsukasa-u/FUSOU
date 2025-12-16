import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import type { Bindings } from '../types';
import { CORS_HEADERS, MAX_UPLOAD_BYTES } from '../constants';
import { validateJWT } from '../utils';

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
 * Endpoints:
 *   POST /upload - Upload Parquet file to R2 and trigger compaction
 *   POST /sanitize-state - Manual trigger for dataset compaction
 *   POST /trigger-scheduled - Scheduled compaction (called by GitHub Actions)
 *   GET /dlq-status - Dead Letter Queue status
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
      console.warn('[Upload API] Missing Authorization header');
      return c.json({ error: 'Unauthorized - Missing Authorization header' }, 401);
    }

    const supabaseUser = await validateJWT(token);
    
    if (!supabaseUser) {
      console.warn('[Upload API] Invalid JWT token');
      return c.json({ error: 'Unauthorized - Invalid or expired token' }, 401);
    }

    const userId = supabaseUser.id;
    console.info('[Upload API] Authenticated user', { userId });

    // === Parse and validate form data ===
    let formData;
    try {
      formData = await c.req.formData();
    } catch (error) {
      console.error('[Upload API] Invalid FormData', { error });
      return c.json({ error: 'Invalid FormData format' }, 400);
    }

    const datasetId = formData.get('datasetId') as string;
    const tableId = formData.get('tableId') as string;
    const file = formData.get('file') as File;

    if (!datasetId || !tableId || !file) {
      return c.json({ error: 'Missing required fields: datasetId, tableId, file' }, 400);
    }

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

    console.info(`[Upload API] Uploading file to R2`, {
      datasetId,
      tableId,
      bucketKey,
      fileSize: buffer.byteLength,
      timestamp: new Date().toISOString(),
    });

    const r2Result = await env.BATTLE_DATA_BUCKET.put(bucketKey, buffer, {
      customMetadata: {
        dataset_id: datasetId,
        table_id: tableId,
        uploaded_at: new Date().toISOString(),
        original_filename: file.name,
      },
    });

    if (!r2Result) {
      console.error(`[Upload API] R2 upload failed`);
      return c.json({ error: 'Failed to upload file to R2' }, 500);
    }

    console.info(`[Upload API] R2 upload completed`, {
      bucketKey,
      etag: r2Result.etag,
    });

    // ===== Step 2: Supabase レコード挿入 =====
    // Use authenticated user's ID from JWT token
    // Insert dataset record with retry logic for rate limiting
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

    const { data, error: insertError } = insertResult;

    if (insertError || !data || !data[0]) {
      console.error(`[Upload API] Supabase insert failed`, { error: insertError, data });
      return c.json({ error: 'Failed to create dataset record', details: (insertError as any)?.message || 'No data returned' }, 500);
    }

    const createdDataset = data[0];
    console.info(`[Upload API] Supabase record created`, { datasetId: createdDataset.id });

    // ===== Step 3: Create processing_metrics record for monitoring =====
    const metricsResult = await withRetry(async () => {
      const result = await supabase
        .from('processing_metrics')
        .insert({
          dataset_id: createdDataset.id,
          workflow_instance_id: `realtime-${Date.now()}`,
          status: 'pending',
          queued_at: new Date().toISOString(),
        })
        .select()
        .single();
      
      if (result.error) throw result.error;
      return result;
    }).catch((error) => {
      console.warn(`[Upload API] Failed to create metrics record`, { error });
      // Don't fail the upload if metrics creation fails (graceful degradation)
      return { data: null, error };
    });

    const metricsId = metricsResult.data?.id;
    console.info(`[Upload API] Metrics record created`, { metricsId });

    // ===== Step 4: Queue に投入（リトライ付き） =====
    await withRetry(async () =>
      env.COMPACTION_QUEUE.send({
        datasetId: createdDataset.id,
        triggeredAt: new Date().toISOString(),
        priority: 'realtime',
        metricId: metricsId,
      })
    );

    console.info(`[Upload API] Enqueued to compaction queue`, { datasetId: createdDataset.id, metricsId });

    return c.json({
      success: true,
      datasetId: createdDataset.id,
      tableId,
      fileName: file.name,
      fileSize: buffer.byteLength,
    });
  } catch (error) {
    console.error('[Upload API] Unexpected error', { error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * POST /sanitize-state
 * Manual trigger for dataset compaction
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
      console.error(`[Sanitize State API] Dataset not found`, { datasetId, error });
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
      console.warn(`[Sanitize State API] Failed to create metrics record`, { error });
      // Don't fail if metrics creation fails (graceful degradation)
      return { data: null, error };
    });

    const metricsId = manualMetricsResult.data?.id;

    // Enqueue to compaction queue (with retry)
    await withRetry(async () =>
      env.COMPACTION_QUEUE.send({
        datasetId,
        triggeredAt: new Date().toISOString(),
        priority: 'manual',
        metricId: metricsId,
      })
    );

    console.info(`[Sanitize State API] Enqueued dataset`, { datasetId, name: data.name });

    return c.json({
      success: true,
      datasetId,
      message: 'Dataset enqueued for compaction',
    });
  } catch (error) {
    console.error('[Sanitize State API] Unexpected error', { error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * POST /trigger-scheduled
 * Scheduled compaction trigger (called by GitHub Actions cron)
 * Optimized with batch metric insertion and retry logic
 */
app.post('/trigger-scheduled', async (c) => {
  try {
    const env = c.env;
    const supabase = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false },
    });

    console.info('[Trigger Scheduled] Starting scheduled compaction');

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
      console.error('[Trigger Scheduled] Failed to fetch datasets', { error });
      return c.json({ error: 'Failed to fetch pending datasets', details: (error as any)?.message }, 500);
    }

    if (!datasets || datasets.length === 0) {
      console.info('[Trigger Scheduled] No pending datasets found');
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
      console.error('[Trigger Scheduled] Failed to create metrics records', { metricsError });
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
    );

    await Promise.allSettled(enqueuePromises);

    const datasetIds = datasets.map((d) => d.id);
    console.info('[Trigger Scheduled] Enqueued datasets', {
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
    console.error('[Trigger Scheduled] Unexpected error', { error });
    return c.json({ error: 'Internal server error', details: String(error) }, 500);
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
