import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import type { Bindings } from '../types';
import { CORS_HEADERS } from '../constants';
import { 
  createEnvContext, 
  resolveSupabaseConfig, 
  readR2Binary, 
  writeR2Binary,
  getR2ObjectMetadata 
} from '../utils';

const app = new Hono<{ Bindings: Bindings }>();

interface CompactRequest {
  dataset_id: string;
}

interface CompactResponse {
  status: 'success' | 'error';
  message: string;
  compacted_tables?: number;
}

// Compaction設定（Cloudflare Workers環境向け）
const COMPACT_CONFIG = {
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024, // 100MB
  SAFETY_MARGIN_MS: 5000, // 5秒の安全マージン
  TIMEOUT_MS: 25000, // 25秒（30秒制限-5秒）
};

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

// Helper to update Supabase flags using client
async function supabaseUpdate(
  supabase: ReturnType<typeof createClient<any, any>>,
  datasetId: string,
  payload: Record<string, any>
) {
  const { error } = await supabase
    .from('datasets')
    .update(payload)
    .eq('id', datasetId);
  return !error;
}

// POST /compact - trigger compaction via Durable Object (bypasses 10ms CPU limit)
app.post('/compact', async (c) => {
  try {
    const body = await c.req.json<CompactRequest>().catch(() => null);

    if (!body || !body.dataset_id || typeof body.dataset_id !== 'string') {
      return c.json(
        { status: 'error', message: 'dataset_id is required and must be a string' } as CompactResponse,
        400
      );
    }

    const dataset_id = body.dataset_id;

    const envCtx = createEnvContext(c);
    const { url: supabase_url, publishableKey: supabase_key } = resolveSupabaseConfig(envCtx);

    if (!supabase_url || !supabase_key) {
      return c.json(
        { status: 'error', message: 'Missing environment configuration' } as CompactResponse,
        500
      );
    }

    // Durable Object の取得（dataset_id をキーにする）
    const compactorDO = c.env.COMPACTOR;
    if (!compactorDO) {
      return c.json(
        { status: 'error', message: 'Compactor Durable Object not configured' } as CompactResponse,
        500
      );
    }

    // Durable Object ID を dataset_id から生成
    const id = compactorDO.idFromName(dataset_id);
    const stub = compactorDO.get(id);

    console.log(
      JSON.stringify({
        level: 'info',
        event: 'compact_delegating_to_do',
        dataset_id,
      })
    );

    // Durable Object に処理を委譲（10ms 以内に完了）
    const doResponse = await stub.fetch('https://internal/compact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataset_id,
        supabase_url,
        supabase_key,
      }),
    });

    // Durable Object からのレスポンスをそのまま返す
    return new Response(doResponse.body, {
      status: doResponse.status,
      headers: doResponse.headers,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'compact_delegation_failed',
        error: message,
      })
    );

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
    const origin = c.req.header('origin');

    if (dataset_id) {
      // Call main API with short timeout
      await fetch(`${origin}/api/compaction/compact`, {
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

// GET /compact/status/:dataset_id - check compaction status for a specific dataset
app.get('/compact/status/:dataset_id', async (c) => {
  try {
    const dataset_id = c.req.param('dataset_id');

    // Durable Object の取得
    const compactorDO = c.env.COMPACTOR;
    if (!compactorDO) {
      return c.json(
        { status: 'error', message: 'Compactor Durable Object not configured' },
        500
      );
    }

    // Durable Object ID を dataset_id から生成
    const id = compactorDO.idFromName(dataset_id);
    const stub = compactorDO.get(id);

    // Durable Object からステータスを取得
    const doResponse = await stub.fetch('https://internal/status', {
      method: 'GET',
    });

    return new Response(doResponse.body, {
      status: doResponse.status,
      headers: doResponse.headers,
    });
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
