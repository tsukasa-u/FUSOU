import { Hono } from 'hono';
import type { Bindings } from '../types';
import { CORS_HEADERS, MAX_UPLOAD_BYTES } from '../constants';
import { validateJWT, createEnvContext } from '../utils';
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
 * Three endpoints for managing data compaction:
 * 
 * 1. POST /sanitize-state - Manual dataset compaction trigger
 *    Purpose: Manually trigger compaction for specific dataset
 *    Priority: 'manual'
 *    Flow: Validation → Queue → Workflow
 *    Use case: User manually requests compaction (e.g., cleanup, optimization)
 * 
 * 2. POST /trigger-scheduled - Batch scheduled compaction
 *    Purpose: Periodic batch compaction (called by GitHub Actions cron)
 *    Priority: 'scheduled'
 *    Flow: Fetch pending → Queue → Workflows
 *    Use case: Nightly/periodic cleanup of all datasets needing compaction
 * 
 * 3. POST /run-now - Synchronous compaction fallback
 *    Purpose: Direct execution (for development/emergency use)
 *    Priority: N/A (no queue)
 *    Flow: Direct execution of compaction logic
 *    Use case: Testing, debugging, or when Queue consumer is unavailable
 */

// OPTIONS (CORS)
app.options('*', (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }));

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
    const env = createEnvContext(c);
    const db = env.runtime.BATTLE_INDEX_DB;

    if (!db) {
      return c.json({ error: 'Server misconfiguration: BATTLE_INDEX_DB binding missing' }, 500);
    }

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
      console.error('[compact] Invalid JSON in /sanitize-state', { error });
      return c.json({ error: 'Invalid JSON format' }, 400);
    }

    const { datasetId } = body;

    if (!datasetId) {
      return c.json({ error: 'datasetId is required' }, 400);
    }

    // Verify ownership of dataset (from D1)
    const queryResult = await db.prepare(
      'SELECT id, user_id, dataset_name FROM datasets WHERE id = ?'
    ).bind(datasetId).first();
    
    if (!queryResult) {
      return c.json({ error: 'Dataset not found' }, 404);
    }
    
    const ds = queryResult as { id: string; user_id: string; dataset_name: string };
    if (ds.user_id !== supabaseUser.id) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Enqueue to compaction queue (with retry)
    console.info(`[compact-sanitize] About to enqueue dataset`, {
      datasetId,
      datasetName: ds.dataset_name,
      queueExists: !!env.runtime.COMPACTION_QUEUE,
    });

    try {
      if (!env.runtime.COMPACTION_QUEUE) {
        console.warn('[compact-sanitize] COMPACTION_QUEUE binding not available');
        return c.json({ error: 'Server misconfiguration: COMPACTION_QUEUE binding missing' }, 500);
      }
      await withRetry(async () => {
        console.info(`[compact-sanitize] Calling env.runtime.COMPACTION_QUEUE.send()...`);
        const sendResult = await env.runtime.COMPACTION_QUEUE.send({
          datasetId,
          triggeredAt: new Date().toISOString(),
          priority: 'manual',
          userId: supabaseUser.id,
        });
        console.info(`[compact-sanitize] Queue send result:`, { sendResult });
        return sendResult;
      });
      console.info(`[compact-sanitize] Successfully enqueued dataset`, { datasetId, datasetName: ds.dataset_name });
    } catch (queueError) {
      console.error(`[compact-sanitize] FAILED to enqueue dataset`, {
        datasetId,
        error: String(queueError),
        errorMessage: (queueError as any)?.message,
      });
      // Log failure but continue - will retry in next scheduled compaction
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
 * Flow: Fetch datasets → Batch queue → Parallel workflows
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
    const env = createEnvContext(c);
    const db = env.runtime.BATTLE_INDEX_DB;

    if (!db) {
      return c.json({ error: 'Server misconfiguration: BATTLE_INDEX_DB binding missing' }, 500);
    }

    console.info('[compact-scheduled] Starting scheduled compaction');

    // Fetch datasets that need compaction (not currently in progress)
    const datasets = await db.prepare(
      'SELECT id, user_id, dataset_name FROM datasets WHERE compaction_needed = 1 AND compaction_in_progress = 0 ORDER BY created_at ASC LIMIT 10'
    ).all();

    if (!datasets.results || datasets.results.length === 0) {
      console.info('[compact-scheduled] No pending datasets found');
      return c.json({
        success: true,
        message: 'No pending datasets to process',
        enqueued: 0,
        datasets: [],
      });
    }

    // ===== Batch queue operations with retry logic =====
    console.info(`[compact-scheduled] Step: About to enqueue ${datasets.results.length} datasets`, {
      datasetIds: (datasets.results as Array<{ id: string }>).map((d) => d.id),
      queueExists: !!env.runtime.COMPACTION_QUEUE,
    });

    if (!env.runtime.COMPACTION_QUEUE) {
      console.warn('[compact-scheduled] COMPACTION_QUEUE binding not available');
      return c.json({ error: 'Server misconfiguration: COMPACTION_QUEUE binding missing' }, 500);
    }

    const enqueueResults: Array<{ datasetId: string; status: 'success' | 'failed'; error?: string }> = [];

    const enqueuePromises = (datasets.results as Array<{ id: string; user_id: string; dataset_name: string }>).map((dataset) =>
      withRetry(() =>
        Promise.resolve(
          env.runtime.COMPACTION_QUEUE.send({
            datasetId: dataset.id,
            triggeredAt: new Date().toISOString(),
            priority: 'scheduled',
            userId: dataset.user_id,
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
      total: datasets.results.length,
      successful: successCount,
      failed: failureCount,
      failures: enqueueResults.filter((r) => r.status === 'failed'),
      timestamp: new Date().toISOString(),
    });

    const datasetIds = (datasets.results as Array<{ id: string }>).map((d) => d.id);
    console.info('[compact-scheduled] Enqueued datasets', {
      count: datasets.results.length,
      datasetIds,
      timestamp: new Date().toISOString(),
    });

    return c.json({
      success: true,
      message: `Enqueued ${datasets.results.length} datasets for compaction`,
      enqueued: datasets.results.length,
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
    const env = createEnvContext(c);
    const db = env.runtime.BATTLE_INDEX_DB;

    if (!db) {
      return c.json({ error: 'Server misconfiguration: BATTLE_INDEX_DB binding missing' }, 500);
    }

    const queryResult = await db.prepare(
      'SELECT id, user_id FROM datasets WHERE id = ?'
    ).bind(datasetId).first();
    
    if (!queryResult) {
      return c.json({ error: 'Dataset not found' }, 404);
    }
    
    const ds = queryResult as { id: string; user_id: string };
    if (ds.user_id !== supabaseUser.id) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const result = await runCompactionJob(c.env, datasetId, table, periodTag, supabaseUser.id);

    return c.json({ success: true, datasetId, table, periodTag, result });
  } catch (error) {
    console.error('[Run Now API] Unexpected error', { error });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;
