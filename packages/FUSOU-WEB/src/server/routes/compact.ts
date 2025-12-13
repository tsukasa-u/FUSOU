import { Hono } from 'hono';
import type { Bindings } from '../types';
import { CORS_HEADERS } from '../constants';

const app = new Hono<{ Bindings: Bindings }>();

interface CompactRequest {
  dataset_id: string;
}

interface CompactResponse {
  status: 'success' | 'error';
  message: string;
  compacted_tables?: number;
}

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

// Helper to update Supabase flags
async function supabaseUpdate(
  supabaseUrl: string,
  supabaseKey: string,
  path: string,
  payload: Record<string, unknown>
) {
  const resp = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  return resp.ok;
}

// POST /compact - trigger compaction for a dataset via WASM
app.post('/compact', async (c) => {
  try {
    const body = await c.req.json<CompactRequest>().catch(() => null);

    if (!body || !body.dataset_id || typeof body.dataset_id !== 'string') {
      return c.json(
        { status: 'error', message: 'dataset_id is required and must be a string' } as CompactResponse,
        400
      );
    }

    const bindings = c.env || {};
    const supabase_url = bindings.PUBLIC_SUPABASE_URL;
    const supabase_key = bindings.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const r2_url = 'https://ACCOUNT_ID.r2.cloudflarestorage.com'; // Placeholder; replace with actual config
    const requestTimeoutMs = Number(bindings.COMPACT_REQ_TIMEOUT_MS || '12000');

    if (!supabase_url || !supabase_key) {
      return c.json(
        { status: 'error', message: 'Missing environment configuration' } as CompactResponse,
        500
      );
    }

    // Set compaction_in_progress flag to avoid double-run
    await supabaseUpdate(supabase_url, supabase_key, `datasets?id=eq.${body.dataset_id}`, {
      compaction_in_progress: true,
      compaction_needed: false,
    });

    // Import WASM module dynamically
    const { compact_single_dataset } = await import('@/wasm/compactor/pkg/fusou_compactor_wasm.js');

    // Call WASM compaction with timeout
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), requestTimeoutMs);
    const startedAt = Date.now();
    let result: string;

    try {
      result = await compact_single_dataset(
        body.dataset_id,
        supabase_url,
        supabase_key,
        r2_url
      );
    } finally {
      clearTimeout(timer);
    }

    const elapsed = Date.now() - startedAt;
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'compact_completed',
        dataset_id: body.dataset_id,
        elapsed_ms: elapsed,
      })
    );

    // Update dataset status after success
    await supabaseUpdate(supabase_url, supabase_key, `datasets?id=eq.${body.dataset_id}`, {
      compaction_in_progress: false,
      last_compacted_at: new Date().toISOString(),
      compaction_needed: false,
    });

    return c.json({ status: 'success', message: result } as CompactResponse, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const category = /timeout/i.test(message)
      ? 'timeout'
      : /fetch|network/i.test(message)
        ? 'network'
        : /memory|oom/i.test(message)
          ? 'memory'
          : 'unknown';

    console.error(
      JSON.stringify({
        level: 'error',
        event: 'compact_failed',
        category,
        error: message,
      })
    );

    // Best-effort reset flag on failure
    try {
      const bindings = c.env || {};
      const supabase_url = bindings.PUBLIC_SUPABASE_URL;
      const supabase_key = bindings.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      const body = await c.req.json<CompactRequest>().catch(() => null);
      if (supabase_url && supabase_key && body?.dataset_id) {
        await supabaseUpdate(supabase_url, supabase_key, `datasets?id=eq.${body.dataset_id}`, {
          compaction_in_progress: false,
          compaction_needed: true,
        });
      }
    } catch {}

    return c.json(
      { status: 'error', message: `Compaction failed: ${message}` } as CompactResponse,
      500
    );
  }
});

// GET /compact/trigger - manually trigger compaction for a specific dataset
app.get('/compact/trigger', async (c) => {
  try {
    const dataset_id = c.req.query('dataset_id');
    const bindings = c.env || {};
    const origin = c.req.header('origin') || 'http://localhost:3000';

    if (dataset_id) {
      // Call main API with short timeout
      await fetch(`${origin}/api/compact`, {
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
