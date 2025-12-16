import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import type { Bindings } from '../types';
import { CORS_HEADERS } from '../constants';

const app = new Hono<{ Bindings: Bindings }>();

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
 */
app.post('/upload', async (c) => {
  try {
    const env = c.env;
    
    const formData = await c.req.formData();
    const datasetId = formData.get('datasetId') as string;
    const tableId = formData.get('tableId') as string;
    const file = formData.get('file') as File;

    if (!datasetId || !tableId || !file) {
      return c.json({ error: 'Missing required fields: datasetId, tableId, file' }, 400);
    }

    const supabase = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

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

    const r2Result = await env.ASSETS_BUCKET.put(bucketKey, buffer, {
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
    const { data, error: insertError } = await supabase
      .from('datasets')
      .insert({
        dataset_id: datasetId,
        table_id: tableId,
        file_name: file.name,
        file_size: buffer.byteLength,
        status: 'pending',
        uploaded_at: new Date().toISOString(),
      })
      .select();

    if (insertError) {
      console.error(`[Upload API] Supabase insert failed`, { error: insertError });
      return c.json({ error: 'Failed to create dataset record', details: insertError.message }, 500);
    }

    console.info(`[Upload API] Supabase record created`, { data });

    // ===== Step 3: Queue に投入 =====
    await env.COMPACTION_QUEUE.send({
      datasetId,
      triggeredAt: new Date().toISOString(),
      priority: 'realtime',
    });

    console.info(`[Upload API] Enqueued to compaction queue`, { datasetId });

    return c.json({
      success: true,
      datasetId,
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
    const { datasetId } = await c.req.json();

    if (!datasetId) {
      return c.json({ error: 'datasetId is required' }, 400);
    }

    const supabase = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

    // Verify dataset exists
    const { data, error } = await supabase
      .from('datasets')
      .select('dataset_id, status')
      .eq('dataset_id', datasetId)
      .single();

    if (error || !data) {
      return c.json({ error: 'Dataset not found' }, 404);
    }

    // Enqueue to compaction queue
    await env.COMPACTION_QUEUE.send({
      datasetId,
      triggeredAt: new Date().toISOString(),
      priority: 'manual',
    });

    console.info(`[Sanitize State API] Enqueued dataset`, { datasetId });

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
 */
app.post('/trigger-scheduled', async (c) => {
  try {
    const env = c.env;
    const supabase = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

    console.info('[Trigger Scheduled] Starting scheduled compaction');

    // Fetch pending datasets
    const { data: datasets, error } = await supabase
      .from('datasets')
      .select('dataset_id')
      .eq('status', 'pending')
      .order('uploaded_at', { ascending: true })
      .limit(10);

    if (error) {
      console.error('[Trigger Scheduled] Failed to fetch datasets', { error });
      return c.json({ error: 'Failed to fetch pending datasets', details: error.message }, 500);
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

    // Enqueue all pending datasets
    const enqueuePromises = datasets.map((dataset) =>
      env.COMPACTION_QUEUE.send({
        datasetId: dataset.dataset_id,
        triggeredAt: new Date().toISOString(),
        priority: 'scheduled',
      })
    );

    await Promise.all(enqueuePromises);

    const datasetIds = datasets.map((d) => d.dataset_id);
    console.info('[Trigger Scheduled] Enqueued datasets', {
      count: datasets.length,
      datasetIds,
    });

    return c.json({
      success: true,
      message: `Enqueued ${datasets.length} datasets for compaction`,
      enqueued: datasets.length,
      datasets: datasetIds,
    });
  } catch (error) {
    console.error('[Trigger Scheduled] Unexpected error', { error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /dlq-status
 * Get Dead Letter Queue status
 */
app.get('/dlq-status', async (c) => {
  try {
    const env = c.env;
    const supabase = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

    const { data, error } = await supabase
      .from('compaction_failures')
      .select('*')
      .order('failed_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[DLQ Status API] Supabase query failed', { error });
      return c.json({ error: 'Failed to fetch DLQ status', details: error.message }, 500);
    }

    return c.json({
      success: true,
      failures: data || [],
      count: data?.length || 0,
    });
  } catch (error) {
    console.error('[DLQ Status API] Unexpected error', { error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;
