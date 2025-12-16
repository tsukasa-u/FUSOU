import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import type { Bindings } from '../types';
import { CORS_HEADERS } from '../constants';
import { 
  createEnvContext, 
  resolveSupabaseConfig,
  getR2ObjectMetadata 
} from '../utils';

const app = new Hono<{ Bindings: Bindings }>();

interface CompactRequest {
  dataset_id: string;
}

interface CompactResponse {
  status: 'success' | 'error' | 'accepted';
  message: string;
  instanceId?: string;
  dataset_id?: string;
}

/**
 * Compaction service routes
 * Triggers Parquet fragment consolidation via Cloudflare Workflows
 * Endpoints:
 *   POST /compact - trigger compaction workflow
 *   GET /compact/status/:instanceId - check workflow instance status
 *   GET /compact/status - health check
 */

// OPTIONS (CORS)
app.options('*', (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }));

// POST /compact - trigger compaction workflow
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
    const bucket = envCtx.runtime.BATTLE_DATA_BUCKET;
    const workflowService = envCtx.runtime.COMPACTION_WORKFLOW;

    if (!supabase_url || !supabase_key) {
      return c.json(
        { status: 'error', message: 'Missing Supabase configuration' } as CompactResponse,
        500
      );
    }

    if (!bucket) {
      return c.json(
        { status: 'error', message: 'R2 bucket not configured' } as CompactResponse,
        500
      );
    }

    if (!workflowService) {
      return c.json(
        { status: 'error', message: 'Compaction Workflow service not configured' } as CompactResponse,
        500
      );
    }

    // Check file exists and get metadata
    const metadata = await getR2ObjectMetadata(bucket, dataset_id);
    if (!metadata) {
      return c.json(
        { status: 'error', message: `Dataset file not found: ${dataset_id}` } as CompactResponse,
        404
      );
    }

    console.log(
      JSON.stringify({
        level: 'info',
        event: 'compact_workflow_trigger',
        dataset_id,
        file_size_bytes: metadata.size,
      })
    );

    // Mark as in progress in Supabase
    const supabase = createClient(supabase_url, supabase_key);
    await supabase
      .from('datasets')
      .update({
        compaction_in_progress: true,
        compaction_needed: false,
      })
      .eq('id', dataset_id);

    // Trigger Workflow via Service Binding
    const workflowResponse = await workflowService.fetch('https://workflow/compact', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        datasetId: dataset_id,
        bucketKey: dataset_id,
      }),
    });

    if (!workflowResponse.ok) {
      throw new Error(`Workflow trigger failed: ${workflowResponse.statusText}`);
    }

    const workflowResult = await workflowResponse.json<{
      instanceId: string;
      status: string;
      datasetId: string;
    }>();

    // Return 202 Accepted with workflow instance ID
    return c.json(
      {
        status: 'accepted',
        message: 'Compaction workflow started',
        instanceId: workflowResult.instanceId,
        dataset_id,
      } as CompactResponse,
      202
    );

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'compact_workflow_failed',
        error: message,
      })
    );

    return c.json(
      { status: 'error', message: `Compaction failed: ${message}` } as CompactResponse,
      500
    );
  }
});

// GET /compact/status/:instanceId - check workflow instance status
app.get('/compact/status/:instanceId', async (c) => {
  try {
    const instanceId = c.req.param('instanceId');
    const envCtx = createEnvContext(c);
    const workflowService = envCtx.runtime.COMPACTION_WORKFLOW;

    if (!workflowService) {
      return c.json(
        { status: 'error', message: 'Workflow service not configured' },
        500
      );
    }

    // Query workflow status via Service Binding
    const workflowResponse = await workflowService.fetch(`https://workflow/status/${instanceId}`, {
      method: 'GET',
    });

    if (!workflowResponse.ok) {
      throw new Error(`Workflow status check failed: ${workflowResponse.statusText}`);
    }

    const statusData = await workflowResponse.json();

    return c.json(statusData, 200);
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
