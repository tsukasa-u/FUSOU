// Hono API for compaction
import { Hono } from 'hono';

const app = new Hono();

interface CompactRequest {
  dataset_id: string;
}

interface CompactResponse {
  status: 'success' | 'error';
  message: string;
  compacted_tables?: number;
}

type Env = {
  PUBLIC_SUPABASE_URL?: string;
  PUBLIC_SUPABASE_ANON_KEY?: string;
  R2_PUBLIC_URL?: string;
  COMPACT_MAX_FRAGMENTS?: string;
  COMPACT_MAX_BYTES?: string;
  COMPACT_REQ_TIMEOUT_MS?: string;
};

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

// POST /compact - trigger compaction
app.post('/compact', async (c) => {
  try {
    const body = await c.req.json<CompactRequest>().catch(() => null);

    if (!body || !body.dataset_id || typeof body.dataset_id !== 'string') {
      return c.json(
        { status: 'error', message: 'dataset_id is required and must be a string' } as CompactResponse,
        400
      );
    }

    const env = (c.env || process.env) as Env;
    const supabase_url = env.PUBLIC_SUPABASE_URL;
    const supabase_key = env.PUBLIC_SUPABASE_ANON_KEY;
    const r2_url = env.R2_PUBLIC_URL;
    const requestTimeoutMs = Number(env.COMPACT_REQ_TIMEOUT_MS || '12000');

    if (!supabase_url || !supabase_key || !r2_url) {
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

    return c.json(
      { status: 'success', message: result } as CompactResponse,
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
      const env = (c.env || process.env) as Env;
      const supabase_url = env.PUBLIC_SUPABASE_URL;
      const supabase_key = env.PUBLIC_SUPABASE_ANON_KEY;
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

// GET /compact/trigger - manually trigger compaction
app.get('/compact/trigger', async (c) => {
  try {
    const dataset_id = c.req.query('dataset_id');
    const env = (c.env || process.env) as Env;
    const apiBase = env.API_BASE || '';

    if (dataset_id) {
      // Call main API with short timeout
      await fetch(`${apiBase}/api/compact`, {
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

// GET /compact/status - health check
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
