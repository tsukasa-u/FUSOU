import type { EnvBindings, IngestRecord, QueueSendBatchItem } from './types';
import { buildAvroContainerFromRecords } from './utils/avro';

export default {
  async fetch(request: Request, env: EnvBindings): Promise<Response> {
    if (request.method !== 'POST') return new Response('Not Found', { status: 404 });
    let body: any;
    try { body = await request.json(); } catch (e) { return new Response('Invalid JSON', { status: 400 }); }

    // Normalize payload: allow { tables: [{table, records}] } or [{table, data}]
    const batches: Array<{ table: string; records: any[] }> = [];
    if (Array.isArray(body)) {
      for (const item of body) {
        if (item && item.table && (item.records || item.data)) {
          batches.push({ table: item.table, records: item.records ?? item.data });
        }
      }
    } else if (body && Array.isArray(body.tables)) {
      for (const t of body.tables) if (t.table && Array.isArray(t.records)) batches.push({ table: t.table, records: t.records });
    } else {
      return new Response('Unsupported payload', { status: 400 });
    }

    // Build queue batch items. We must send a single sendBatch subrequest to avoid subrequest limits.
    const messages: QueueSendBatchItem[] = [];
    for (const b of batches) {
      // further split per-table into reasonable chunks (avoid huge messages)
      // heuristic: 200 records per message
      const CHUNK = 200;
      for (let i = 0; i < b.records.length; i += CHUNK) {
        messages.push({ body: { table: b.table, records: b.records.slice(i, i + CHUNK) } });
      }
    }

    try {
      if (!env.COMPACTION_QUEUE) throw new Error('Queue binding missing');
      // sendBatch is a single subrequest covering all messages
      await (env.COMPACTION_QUEUE as any).sendBatch(messages);
      return new Response(JSON.stringify({ status: 'accepted', messages: messages.length }), { status: 202, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }
};
