import { buildAvroContainer, getAvroHeaderLength, getAvroHeaderLengthFromPrefix } from './avro-manual.js';

interface Env {
  BATTLE_DATA_BUCKET: R2Bucket;
  BATTLE_INDEX_DB: D1Database;
  OUTPUT_KEY_NAME?: string;
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
// Maximum size per stored Avro fragment file in R2 (512 MiB per user-file)
const MAX_FILE_BYTES = 512 * 1024 * 1024; // 512 MB

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
    return new Response(JSON.stringify({ error: 'No valid records to process' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Note: /ingest endpoint is deprecated. FUSOU-WEB sends directly to COMPACTION_QUEUE.
  // This endpoint remains for backward compatibility but does not enqueue.
  return new Response(JSON.stringify({ 
    status: 'deprecated', 
    message: 'This endpoint is deprecated. Use FUSOU-WEB battle_data upload endpoint instead.',
    records: messages.length 
  }), {
    status: 410,
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
    type Group = { slices: Uint8Array[]; messages: Message<unknown>[]; datasetId?: string; periodTag?: string };
    const grouped = new Map<string, Group>();

    console.log('[Queue] Batch received', { size: batch.messages.length });

    for (const message of batch.messages) {
      try {
        const body = message.body as any;
        const table = body?.table as string | undefined;
        const b64 = body?.avro_base64 as string | undefined;
        const datasetId = body?.datasetId ?? body?.dataset_id;
        const periodTag = body?.periodTag ?? body?.period_tag;

        if (!table || typeof b64 !== 'string') {
          console.warn('[Queue] Invalid message payload', { id: message.id });
          message.ack();
          continue;
        }

        // Group by datasetId + table so we can store per-dataset per-table files
        const groupKey = `${String(datasetId ?? 'global')}::${table}`;
        if (!grouped.has(groupKey)) grouped.set(groupKey, { slices: [], messages: [], datasetId: datasetId, periodTag: periodTag });

        const arr = (globalThis as any).Buffer ? (globalThis as any).Buffer.from(b64, 'base64') : atobToU8(b64);
        grouped.get(groupKey)!.slices.push(arr instanceof Uint8Array ? arr : new Uint8Array(arr));
        grouped.get(groupKey)!.messages.push(message as Message<unknown>);
      } catch (err) {
        console.error('[Queue] Failed to parse message', { id: message.id, error: String(err) });
        message.retry();
      }
    }

    for (const [groupKey, group] of grouped) {
      if (!group.slices.length) {
        group.messages.forEach((m) => m.ack());
        continue;
      }
      try {
        const [datasetPart, table] = groupKey.split('::');
        const datasetId = group.datasetId ?? datasetPart ?? 'unknown_dataset';
        const periodTag = group.periodTag ?? 'latest';

        // Determine current active segment index by querying D1
        let currentSegmentIndex = 0;
        let currentSegmentKey = `${datasetId}/${table}/${periodTag}.0.avro`;
        
        if (env.BATTLE_INDEX_DB) {
          try {
            // Find the highest segment number for this dataset/table/period
            const maxSegment = await env.BATTLE_INDEX_DB.prepare(
              `SELECT MAX(segment_number) as max_index 
               FROM avro_segments 
               WHERE parent_file_key = ?`
            ).bind(`${datasetId}/${table}/${periodTag}`).first<{ max_index: number | null }>();
            
            if (maxSegment && maxSegment.max_index != null) {
              currentSegmentIndex = maxSegment.max_index;
              currentSegmentKey = `${datasetId}/${table}/${periodTag}.${currentSegmentIndex}.avro`;
            }
          } catch (dbErr) {
            console.warn('[Queue] Failed to query D1 for max segment index, using default', { error: String(dbErr) });
          }
        }

        // Fetch current active segment file
        const existing = await env.BATTLE_DATA_BUCKET.get(currentSegmentKey);
        let existingBuf = existing?.body ? new Uint8Array(await existing.arrayBuffer()) : null;

        // Calculate bytes to append (strip headers for subsequent slices)
        let appendBytes = 0;
        for (let i = 0; i < group.slices.length; i++) {
          const slice = group.slices[i];
          if (existingBuf || i > 0) {
            appendBytes += slice.length - safeHeaderLen(slice);
          } else {
            appendBytes += slice.length;
          }
        }

        // Determine target segment and prepare chunks
        let targetKey = currentSegmentKey;
        let targetSegmentIndex = currentSegmentIndex;
        let outChunks: Uint8Array[] = [];
        
        if (!existingBuf) {
          // No existing file: create first segment (.0.avro)
          outChunks.push(group.slices[0]);
          for (let i = 1; i < group.slices.length; i++) {
            const slice = group.slices[i];
            const headerLen = safeHeaderLen(slice);
            outChunks.push(slice.subarray(headerLen));
          }
          targetKey = currentSegmentKey;
          targetSegmentIndex = currentSegmentIndex;
          console.info('[Queue] Creating new segment file', { datasetId, table, targetKey, segmentIndex: targetSegmentIndex, bytes: appendBytes });
        } else {
          // Existing segment exists: check if appending would exceed limit
          if (existingBuf.length + appendBytes > MAX_FILE_BYTES) {
            // Current segment would exceed 512MB: move to next segment index
            targetSegmentIndex = currentSegmentIndex + 1;
            targetKey = `${datasetId}/${table}/${periodTag}.${targetSegmentIndex}.avro`;
            
            // Create new segment file with first slice as header
            outChunks.push(group.slices[0]);
            for (let i = 1; i < group.slices.length; i++) {
              const slice = group.slices[i];
              const headerLen = safeHeaderLen(slice);
              outChunks.push(slice.subarray(headerLen));
            }
            console.info('[Queue] Creating next segment (current would exceed 512MB)', { 
              datasetId, 
              table, 
              previousSegment: currentSegmentKey,
              previousBytes: existingBuf.length,
              newSegment: targetKey, 
              segmentIndex: targetSegmentIndex,
              appendBytes 
            });
          } else {
            // Append to current segment
            outChunks.push(existingBuf);
            for (const slice of group.slices) {
              const headerLen = safeHeaderLen(slice);
              outChunks.push(slice.subarray(headerLen));
            }
            targetKey = currentSegmentKey;
            targetSegmentIndex = currentSegmentIndex;
            console.info('[Queue] Appending to current segment', { 
              datasetId, 
              table, 
              targetKey, 
              segmentIndex: targetSegmentIndex,
              existingBytes: existingBuf.length,
              appendBytes,
              totalBytes: existingBuf.length + appendBytes
            });
          }
        }

        const totalLen = outChunks.reduce((s, c) => s + c.length, 0);
        const finalBuf = new Uint8Array(totalLen);
        let off = 0;
        for (const c of outChunks) { finalBuf.set(c, off); off += c.length; }

        const putResult = await env.BATTLE_DATA_BUCKET.put(targetKey, finalBuf, { httpMetadata: { contentType: 'application/avro' } });
        const bytesStored = finalBuf.length;
        const etag = (putResult as any)?.etag ?? '';
        console.info('[Queue] Stored Avro segment file', { datasetId, table, key: targetKey, segmentIndex: targetSegmentIndex, bytes: bytesStored });

        // Record segment metadata in D1
        try {
          if (env.BATTLE_INDEX_DB) {
            const nowTs = Date.now();
            const parentKey = `${datasetId}/${table}/${periodTag}`;
            
            // Check if parent record exists
            const checkParent = await env.BATTLE_INDEX_DB.prepare(
              `SELECT file_key, segment_count FROM avro_files WHERE file_key = ?`
            ).bind(parentKey).first<{ file_key: string; segment_count: number }>();
            
            if (!checkParent) {
              // Create parent record
              await env.BATTLE_INDEX_DB.prepare(
                `INSERT INTO avro_files (
                  file_key, dataset_id, table_name, period_tag,
                  current_size, is_segmented, segment_count,
                  created_at, last_appended_at, last_etag
                ) VALUES (?, ?, ?, ?, 0, TRUE, ?, ?, ?, ?)`
              ).bind(parentKey, datasetId, table, periodTag, targetSegmentIndex + 1, nowTs, nowTs, '').run();
              console.info('[Queue] Created parent record in avro_files', { parent_key: parentKey });
            } else if (targetSegmentIndex + 1 > checkParent.segment_count) {
              // Update parent segment count if we created a new segment
              await env.BATTLE_INDEX_DB.prepare(
                `UPDATE avro_files 
                 SET segment_count = ?,
                     last_appended_at = ?
                 WHERE file_key = ?`
              ).bind(targetSegmentIndex + 1, nowTs, parentKey).run();
              console.info('[Queue] Updated parent segment count', { parent_key: parentKey, new_count: targetSegmentIndex + 1 });
            } else {
              // Just update last_appended_at for existing segment append
              await env.BATTLE_INDEX_DB.prepare(
                `UPDATE avro_files 
                 SET last_appended_at = ?
                 WHERE file_key = ?`
              ).bind(nowTs, parentKey).run();
            }
            
            // Insert or update segment record
            const checkSegment = await env.BATTLE_INDEX_DB.prepare(
              `SELECT segment_key FROM avro_segments WHERE segment_key = ?`
            ).bind(targetKey).first<{ segment_key: string }>();
            
            if (!checkSegment) {
              // Insert new segment
              await env.BATTLE_INDEX_DB.prepare(
                `INSERT INTO avro_segments (
                  segment_key, parent_file_key, segment_number,
                  segment_size, created_at, etag
                ) VALUES (?, ?, ?, ?, ?, ?)`
              ).bind(targetKey, parentKey, targetSegmentIndex, bytesStored, nowTs, etag).run();
              console.info('[Queue] Created segment record', { segment_key: targetKey, segment_number: targetSegmentIndex });
            } else {
              // Update existing segment (append case)
              await env.BATTLE_INDEX_DB.prepare(
                `UPDATE avro_segments 
                 SET segment_size = ?,
                     etag = ?
                 WHERE segment_key = ?`
              ).bind(bytesStored, etag, targetKey).run();
              console.info('[Queue] Updated segment record', { segment_key: targetKey, bytes: bytesStored });
            }
          } else {
            console.warn('[Queue] BATTLE_INDEX_DB not configured; skipping index record');
          }
        } catch (dbErr) {
          console.error('[Queue] Failed to record in D1', { key: targetKey, error: String(dbErr) });
        }

        group.messages.forEach((m) => m.ack());
      } catch (err) {
        console.error('[Queue] Failed to append Avro', { groupKey, error: String(err) });
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
    console.info('[Worker/fetch] Request received', { method: request.method, path: new URL(request.url).pathname });
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
    console.info('[Worker/queue] Queue handler invoked', { messageCount: batch.messages.length, batched: true });
    const queueName = (batch as { queue?: string }).queue as string | undefined;
    const target = queueName && queueName.toLowerCase().includes('dlq') ? 'dlq' : 'main';
    console.info('[Worker/queue] Routing to target', { queueName, target });
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

function cryptoRandomId(): string {
  try {
    if ((globalThis as any).crypto && typeof (globalThis as any).crypto.randomUUID === 'function') {
      return (globalThis as any).crypto.randomUUID();
    }
    // Fallback: generate 12-char random base36
    const arr = new Uint8Array(16);
    (globalThis as any).crypto.getRandomValues(arr);
    let s = '';
    for (let i = 0; i < arr.length; i++) s += arr[i].toString(36);
    return s.slice(0, 12);
  } catch {
    return Math.random().toString(36).slice(2, 14);
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
