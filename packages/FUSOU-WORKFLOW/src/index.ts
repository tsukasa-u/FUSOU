import { buildAvroContainer, getAvroHeaderLength, getAvroHeaderLengthFromPrefix } from './avro-append';

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  COMPACTION_QUEUE: Queue;
  COMPACTION_DLQ: Queue;
}

interface IngestTableBatch {
  table: string;
  records: any[];
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_RECORDS_PER_MESSAGE = 200;

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function normalizePayload(body: unknown): IngestTableBatch[] {
  if (!body) {
    throw new Error('Request body is empty');
  }

  // Pattern 1: { tables: [{ table, records }...] }
  if (typeof body === 'object' && body !== null && Array.isArray((body as any).tables)) {
    return (body as any).tables
      .map((t: any) => ({ table: t.table, records: t.records }))
      .filter((t: IngestTableBatch) => t.table && Array.isArray(t.records));
  }

  // Pattern 2: { table, records }
  if (typeof body === 'object' && body !== null && (body as any).table && Array.isArray((body as any).records)) {
    return [{ table: (body as any).table, records: (body as any).records }];
  }

  // Pattern 3: [{ table, record }] -> collapse per table
  if (Array.isArray(body)) {
    const grouped = new Map<string, any[]>();
    for (const item of body) {
      if (item && typeof item === 'object' && (item as any).table) {
        const table = (item as any).table as string;
        const data = (item as any).data ?? (item as any).record ?? (item as any).records;
        if (!grouped.has(table)) grouped.set(table, []);
        if (Array.isArray(data)) {
          grouped.get(table)!.push(...data);
        } else if (data !== undefined) {
          grouped.get(table)!.push(data);
        }
      }
    }
    return Array.from(grouped.entries()).map(([table, records]) => ({ table, records }));
  }

  throw new Error('Unsupported payload format');
}

async function handleIngest(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let batches: IngestTableBatch[];
  try {
    batches = normalizePayload(parsed);
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (!batches.length) {
    return new Response(JSON.stringify({ error: 'No records to enqueue' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const messages: Array<{ body: IngestTableBatch }> = [];
  for (const batch of batches) {
    if (!batch.table || !Array.isArray(batch.records) || batch.records.length === 0) {
      continue;
    }
    const chunks = chunkArray(batch.records, MAX_RECORDS_PER_MESSAGE);
    for (const chunk of chunks) {
      messages.push({ body: { table: batch.table, records: chunk } });
    }
  }

  if (!messages.length) {
    return new Response(JSON.stringify({ error: 'No valid records to enqueue' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  await env.COMPACTION_QUEUE.sendBatch(messages);

  return new Response(JSON.stringify({ status: 'accepted', messages: messages.length }), {
    status: 202,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function handleRead(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const table = url.searchParams.get('table');
  if (!table) {
    return new Response(JSON.stringify({ error: 'Missing table parameter' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const listed = await env.BATTLE_DATA_BUCKET.list({ prefix: `${table}/` });
  if (!listed.objects.length) {
    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  }

  const objects = [...listed.objects].sort((a, b) => {
    const t1 = typeof a.uploaded === 'number' ? a.uploaded : new Date(a.uploaded ?? 0).getTime();
    const t2 = typeof b.uploaded === 'number' ? b.uploaded : new Date(b.uploaded ?? 0).getTime();
    if (t1 !== t2) return t1 - t2;
    return a.key.localeCompare(b.key);
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let idx = 0; idx < objects.length; idx++) {
        const obj = objects[idx];
        try {
          if (idx === 0) {
            // First file: stream whole object (includes header)
            const file = await env.BATTLE_DATA_BUCKET.get(obj.key);
            if (!file?.body) {
              console.warn('[Reader] Missing object', { key: obj.key });
              continue;
            }
            await file.body.pipeTo(new WritableStream({
              write(chunk) {
                controller.enqueue(chunk);
              }
            }));
          } else {
            // Subsequent files: fetch header prefix to compute header length
            const headResp = await env.BATTLE_DATA_BUCKET.get(obj.key, {
              range: { offset: 0, length: 8192 },
            });
            if (!headResp) {
              console.warn('[Reader] Missing object for header', { key: obj.key });
              continue;
            }
            const prefix = new Uint8Array(await headResp.arrayBuffer());
            const headerLen = getAvroHeaderLengthFromPrefix(prefix);

            const fullSize = obj.size ?? prefix.length;
            const remainingLength = Math.max(0, fullSize - headerLen);
            if (remainingLength === 0) {
              continue; // nothing to stream
            }

            const bodyResp = await env.BATTLE_DATA_BUCKET.get(obj.key, {
              range: { offset: headerLen, length: remainingLength },
            });
            if (!bodyResp?.body) {
              console.warn('[Reader] Missing range body', { key: obj.key });
              continue;
            }
            await bodyResp.body.pipeTo(new WritableStream({
              write(chunk) {
                controller.enqueue(chunk);
              }
            }));
          }
        } catch (err) {
          console.error('[Reader] Failed to stream object', { key: obj.key, error: String(err) });
        }
      }
      controller.close();
    }
  });

  const response = new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/avro',
      'Cache-Control': 'public, max-age=300',
    },
  });

  ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

const queueConsumer = {
  async queue(batch: MessageBatch<unknown>, env: Env, _ctx: ExecutionContext) {
    type Group = { records: any[]; messages: Message<unknown>[] };
    const grouped = new Map<string, Group>();

    for (const message of batch.messages) {
      try {
        const body = message.body as Partial<IngestTableBatch>;
        if (!body?.table || !Array.isArray(body.records)) {
          console.warn('[Queue] Invalid message payload', { id: message.id });
          message.ack();
          continue;
        }
        if (!grouped.has(body.table)) {
          grouped.set(body.table, { records: [], messages: [] });
        }
        const group = grouped.get(body.table)!;
        group.records.push(...body.records);
        group.messages.push(message as Message<unknown>);
      } catch (err) {
        console.error('[Queue] Failed to parse message', { id: message.id, error: String(err) });
        message.retry();
      }
    }

    for (const [table, group] of grouped) {
      if (!group.records.length) {
        group.messages.forEach((m) => m.ack());
        continue;
      }
      try {
        const avroBuffer = buildAvroContainer(group.records);
        const key = `${table}/${Date.now()}_${crypto.randomUUID()}.avro`;
        await env.BATTLE_DATA_BUCKET.put(key, avroBuffer, {
          httpMetadata: { contentType: 'application/avro' },
          customMetadata: {
            format: 'avro',
            table,
            record_count: String(group.records.length),
            timestamp: new Date().toISOString(),
          },
        });
        console.info('[Queue] Stored table batch', { table, records: group.records.length, key });
        group.messages.forEach((m) => m.ack());
      } catch (err) {
        console.error('[Queue] Failed to store batch', { table, error: String(err) });
        group.messages.forEach((m) => m.retry());
      }
    }
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
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (path === '/ingest' && request.method === 'POST') {
      return handleIngest(request, env);
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
    const queueName = (batch as { queue?: string }).queue as string | undefined;
    const target = queueName && queueName.toLowerCase().includes('dlq') ? 'dlq' : 'main';
    if (target === 'dlq') {
      return queueDLQ.queue(batch, env, ctx);
    }
    return queueConsumer.queue(batch, env, ctx);
  },
};
