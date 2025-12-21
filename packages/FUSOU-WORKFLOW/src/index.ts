import { buildAvroContainer, getAvroHeaderLength, getAvroHeaderLengthFromPrefix } from './avro-manual';

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

// Default maximum payload per queue message (bytes). Adjust to Cloudflare Queue limits.
const MAX_BYTES_PER_MESSAGE = 256 * 1024; // 256 KB
const MAX_RECORDS_PER_MESSAGE = 200; // fallback maximum count

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

    // Chunk by byte-size using buildAvroContainer to measure exact serialized size.
    // This is conservative and may cost CPU; it's safer than relying solely on record counts.
    let current: any[] = [];
    for (const record of batch.records) {
      current.push(record);
      let ok = true;
      try {
        const buf = buildAvroContainer(current);
        if (buf.length > MAX_BYTES_PER_MESSAGE || current.length > MAX_RECORDS_PER_MESSAGE) {
          // If current only contains this record and it still exceeds limit,
          // we must emit it alone to avoid infinite loop.
          if (current.length === 1) {
            messages.push({ body: { table: batch.table, records: current } });
            current = [];
            ok = false;
          } else {
            // emit all but last record
            const last = current.pop();
            messages.push({ body: { table: batch.table, records: current } });
            current = [last];
            ok = false;
          }
        }
      } catch (err) {
        // If Avro build fails for current chunk, fallback: emit previous chunk if any
        if (current.length === 1) {
          messages.push({ body: { table: batch.table, records: current } });
          current = [];
        } else {
          const last = current.pop();
          messages.push({ body: { table: batch.table, records: current } });
          current = [last];
        }
        ok = false;
      }
      // continue accumulating if ok
    }
    if (current.length) {
      messages.push({ body: { table: batch.table, records: current } });
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
            // Subsequent files: fetch header prefix to compute header length.
            // Retry with increasing prefix size if header not fully contained.
            const MAX_HEADER_PREFIX = 64 * 1024; // 64KB
            let prefixLen = 8 * 1024; // 8KB initial
            let headerLen: number | null = null;
            let prefixBuf: Uint8Array | null = null;
            while (prefixLen <= MAX_HEADER_PREFIX) {
              const headResp = await env.BATTLE_DATA_BUCKET.get(obj.key, {
                range: { offset: 0, length: prefixLen },
              });
              if (!headResp) {
                console.warn('[Reader] Missing object for header', { key: obj.key });
                break;
              }
              const prefix = new Uint8Array(await headResp.arrayBuffer());
              try {
                const parsed = getAvroHeaderLengthFromPrefix(prefix);
                headerLen = parsed;
                prefixBuf = prefix;
                break;
              } catch (err) {
                // likely truncated header; increase prefix and retry
                if (prefixLen >= MAX_HEADER_PREFIX) {
                  console.error('[Reader] Avro header too large or malformed', { key: obj.key, error: String(err) });
                  break;
                }
                prefixLen = Math.min(prefixLen * 2, MAX_HEADER_PREFIX);
                continue;
              }
            }
            if (!headerLen || !prefixBuf) continue;

            const fullSize = obj.size ?? prefixBuf.length;
            const remainingLength = Math.max(0, fullSize - headerLen);
            if (remainingLength === 0) continue; // nothing to stream

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
    type Group = { slices: Uint8Array[]; messages: Message<unknown>[] };
    const grouped = new Map<string, Group>();

    console.log('[Queue] Batch received', { size: batch.messages.length });

    for (const message of batch.messages) {
      try {
        const body = message.body as any;
        const table = body?.table;
        const b64 = body?.avro_base64;
        if (!table || typeof b64 !== 'string') {
          console.warn('[Queue] Invalid message payload', { id: message.id });
          message.ack();
          continue;
        }
        if (!grouped.has(table)) grouped.set(table, { slices: [], messages: [] });
        const arr = Uint8Array.from((globalThis as any).Buffer ? (globalThis as any).Buffer.from(b64, 'base64') : atobToU8(b64));
        grouped.get(table)!.slices.push(arr);
        grouped.get(table)!.messages.push(message as Message<unknown>);
      } catch (err) {
        console.error('[Queue] Failed to parse message', { id: message.id, error: String(err) });
        message.retry();
      }
    }

    for (const [table, group] of grouped) {
      if (!group.slices.length) {
        group.messages.forEach((m) => m.ack());
        continue;
      }
      try {
        const baseKeyName = (env as any).OUTPUT_KEY_NAME || 'latest.avro';
        const key = `${table}/${typeof baseKeyName === 'string' ? baseKeyName.replace('.parquet', '.avro') : 'latest.avro'}`;

        // Fetch existing file
        const existing = await env.BATTLE_DATA_BUCKET.get(key);
        let existingBuf = existing?.body ? new Uint8Array(await existing.arrayBuffer()) : null;

        // If no existing: take first slice as initial file, append remaining without headers
        const outChunks: Uint8Array[] = [];
        if (!existingBuf) {
          outChunks.push(group.slices[0]);
          for (let i = 1; i < group.slices.length; i++) {
            const slice = group.slices[i];
            const headerLen = safeHeaderLen(slice);
            outChunks.push(slice.subarray(headerLen));
          }
          console.info('[Queue] Creating new Avro file', { table, key, initialBytes: group.slices[0].length });
        } else {
          outChunks.push(existingBuf);
          for (const slice of group.slices) {
            const headerLen = safeHeaderLen(slice);
            outChunks.push(slice.subarray(headerLen));
          }
          console.info('[Queue] Appending slices', { table, key, appendCount: group.slices.length, baseBytes: existingBuf.length });
        }

        const totalLen = outChunks.reduce((s, c) => s + c.length, 0);
        const finalBuf = new Uint8Array(totalLen);
        let off = 0;
        for (const c of outChunks) { finalBuf.set(c, off); off += c.length; }

        await env.BATTLE_DATA_BUCKET.put(key, finalBuf, { httpMetadata: { contentType: 'application/avro' } });
        console.info('[Queue] Stored Avro file', { table, key, bytes: finalBuf.length });
        group.messages.forEach((m) => m.ack());
      } catch (err) {
        console.error('[Queue] Failed to append Avro', { table, error: String(err) });
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

function atobToU8(b64: string): Uint8Array {
  const bin = (globalThis as any).atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function safeHeaderLen(prefix: Uint8Array): number {
  try {
    // Use a prefix up to 64KB to find header length
    const max = Math.min(prefix.length, 64 * 1024);
    const head = prefix.subarray(0, max);
    return getAvroHeaderLengthFromPrefix(head);
  } catch {
    // Fallback: assume 4 + small metadata + 16 sync (unsafe default)
    return 4 + 1024 + 16;
  }
}

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
