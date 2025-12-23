import { handleRead as handleHybridRead } from './reader.js';
import { handleCron } from './cron.js';
import { handleBufferConsumerChunked } from './buffer-consumer.js';

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  BATTLE_INDEX_DB: D1Database;
  OUTPUT_KEY_NAME?: string;
  COMPACTION_QUEUE?: Queue<any>;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Hybrid reader: delegate to reader.ts (buffer_logs + block_indexes)
async function handleRead(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  // Allow backward-compatible params: table or table_name
  const url = new URL(request.url);
  if (!url.searchParams.get('table_name') && url.searchParams.get('table')) {
    url.searchParams.set('table_name', url.searchParams.get('table')!);
  }
  return handleHybridRead(new Request(url.toString(), request), env);
}

const queueConsumer = {
  async queue(batch: MessageBatch<unknown>, env: Env, _ctx: ExecutionContext) {
    console.log('[Queue] Batch received', { size: batch.messages.length });
    if (!env.BATTLE_INDEX_DB) {
      console.error('[Queue] Missing BATTLE_INDEX_DB binding');
      batch.messages.forEach((m) => m.retry());
      return;
    }
    // Delegate to chunked bulk-insert consumer for performance and consistency
    await handleBufferConsumerChunked(batch as unknown as MessageBatch<any>, env as any);
  },
};

const queueDLQ = {
  async queue(batch: MessageBatch<unknown>, _env: Env, _ctx: ExecutionContext) {
    for (const message of batch.messages) {
      console.error('[DLQ] Unhandled message', { id: message.id, body: message.body });
      message.ack();
    }
  },
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    console.info('[Worker/fetch] Request received', { method: request.method, path: new URL(request.url).pathname });
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (path === '/battle-data/upload' && request.method === 'POST') {
      // Inline upload handler: accept base64 Avro slices and enqueue
      try {
        const payload: any = await request.json();
        const dataset_id = payload?.dataset_id ?? payload?.datasetId;
        const table = payload?.table;
        const period_tag = payload?.period_tag ?? payload?.periodTag ?? 'latest';
        const slices: string[] = Array.isArray(payload?.slices) ? payload.slices : [];
        if (!dataset_id || !table || !slices.length) {
          return new Response(JSON.stringify({ error: 'Missing dataset_id, table, or slices' }), {
            status: 400,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }
        if (!env.COMPACTION_QUEUE) {
          return new Response(JSON.stringify({ error: 'Queue binding COMPACTION_QUEUE is missing' }), {
            status: 500,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }
        const messages = slices.map((b64) => ({ body: { dataset_id, table, period_tag, avro_base64: b64 } }));
        await (env.COMPACTION_QUEUE as any).sendBatch(messages as any);
        return new Response(JSON.stringify({ status: 'accepted', enqueued: messages.length }), {
          status: 202,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
    }

    if (path === '/read' && request.method === 'GET') {
      return handleRead(request, env, ctx);
    }

    if (path === '/' && request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok', service: 'fusou-ingest' }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  },
  async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext): Promise<void> {
    console.info('[Worker/queue] Queue handler invoked', { messageCount: batch.messages.length, batched: true });
    const queueName = (batch as { queue?: string }).queue as string | undefined;
    const target = queueName && queueName.toLowerCase().includes('dlq') ? 'dlq' : 'main';
    console.info('[Worker/queue] Routing to target', { queueName, target });
    if (target === 'dlq') {
      return queueDLQ.queue(batch, env, ctx);
    }
    return queueConsumer.queue(batch, env, ctx);
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Delegate scheduled archiving to cron.ts
    ctx.waitUntil(handleCron(env));
  },
};

// Export a placeholder Workflow object so Wrangler can detect the workflow
// declared in `wrangler.toml`. The real workflow definition (steps) lives
// in the Cloudflare dashboard or a separate workflow builder; here we export
// a minimal symbol so `wrangler versions upload` succeeds.
// Minimal typed declaration for the exported workflow symbol. Wrangler only
// needs the symbol to exist in the entrypoint; define a small interface to
// avoid `any` and keep type-checking strict.
export interface DataCompactionWorkflowDeclaration {
  /** Optional human-friendly name */
  name?: string;
  /** Optional steps metadata; exact runtime shape is managed by Cloudflare */
  steps?: Record<string, unknown>[];
}

export const DataCompactionWorkflow: DataCompactionWorkflowDeclaration = {
  name: 'data-compaction-workflow',
  steps: [],
};
