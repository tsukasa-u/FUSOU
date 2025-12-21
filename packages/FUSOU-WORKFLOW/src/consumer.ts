import type { EnvBindings } from './types';
import { getAvroHeaderLengthFromPrefix } from './utils/avro.js';

export default {
  async queue(batch: MessageBatch<unknown>, env: EnvBindings, ctx: ExecutionContext) {
    // Group incoming messages by table. Support two message shapes:
    // - { table, records: [...] }  (legacy)
    // - { table, avro_base64: '...' } (new: pre-sliced avro blobs)
    const grouped = new Map<string, { avroSlices: Uint8Array[]; messages: Message<unknown>[] }>();

    for (const message of batch.messages) {
      try {
        const body = message.body as any;
        if (!body?.table) { message.ack(); continue; }
        if (!grouped.has(body.table)) grouped.set(body.table, { avroSlices: [], messages: [] });
        const g = grouped.get(body.table)!;

        if (Array.isArray(body.records)) {
          // legacy: not handling record arrays here; consumer expects avro_base64 now
          // ack and continue (or optionally convert records->avro here)
          message.ack();
          continue;
        }

        if (typeof body.avro_base64 === 'string') {
          let buf: Uint8Array;
          if (typeof (globalThis as any).Buffer !== 'undefined') {
            buf = Uint8Array.from((globalThis as any).Buffer.from(body.avro_base64, 'base64'));
          } else if (typeof atob === 'function') {
            const bin = atob(body.avro_base64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            buf = arr;
          } else {
            // Last resort: decode base64 via TextDecoder hack
            const b = (globalThis as any).atob ? (globalThis as any).atob(body.avro_base64) : '';
            const arr = new Uint8Array(b.length);
            for (let i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i);
            buf = arr;
          }
          g.avroSlices.push(buf);
          g.messages.push(message as Message<unknown>);
        } else {
          // unknown message shape; ack to avoid poison
          message.ack();
        }
      } catch (err) {
        message.retry();
      }
    }

    // Process each table group: append slices to latest R2 file or create new file
    for (const [table, group] of grouped) {
      if (!group.avroSlices.length) { group.messages.forEach(m => m.ack()); continue; }

      try {
        // Find latest object for this table
        const listed = await env.BATTLE_DATA_BUCKET.list({ prefix: `${table}/` });
        const objects = (listed.objects || []).sort((a, b) => {
          const t1 = typeof a.uploaded === 'number' ? a.uploaded : new Date(a.uploaded ?? 0).getTime();
          const t2 = typeof b.uploaded === 'number' ? b.uploaded : new Date(b.uploaded ?? 0).getTime();
          if (t1 !== t2) return t1 - t2;
          return a.key.localeCompare(b.key);
        });

        let baseBuf: Uint8Array | null = null;
        if (objects.length) {
          const latest = objects[objects.length - 1];
          const obj = await env.BATTLE_DATA_BUCKET.get(latest.key);
          if (obj && obj.body) {
            const ab = await obj.arrayBuffer();
            baseBuf = new Uint8Array(ab);
          }
        }

        // Build combined output: start with baseBuf if present, then append each slice without its header
        const parts: Uint8Array[] = [];
        if (baseBuf) parts.push(baseBuf);

        for (const slice of group.avroSlices) {
          try {
            const headerLen = getAvroHeaderLengthFromPrefix(slice);
            const payload = slice.subarray(headerLen);
            parts.push(payload);
          } catch (e) {
            // If we cannot parse header, assume slice is already raw block data and append as-is
            parts.push(slice);
          }
        }

        // If there was no baseBuf, we must produce a valid Avro container; take the first slice as-is
        let outBuf: Uint8Array;
        if (!baseBuf) {
          // if the first slice contains a header, keep it; then append the remaining slices with header removed
          outBuf = parts.reduce((acc, p) => {
            if (!acc) return p.slice();
            const combined = new Uint8Array(acc.length + p.length);
            combined.set(acc, 0);
            combined.set(p, acc.length);
            return combined;
          }, new Uint8Array());
        } else {
          outBuf = parts.reduce((acc, p) => {
            if (!acc) return p.slice();
            const combined = new Uint8Array(acc.length + p.length);
            combined.set(acc, 0);
            combined.set(p, acc.length);
            return combined;
          }, new Uint8Array());
        }

        // Write combined buffer to R2 under a new timestamped key
        const ts = Date.now();
        const uuid = crypto.randomUUID();
        const key = `${table}/${ts}_${uuid}.avro`;
        await env.BATTLE_DATA_BUCKET.put(key, outBuf, {
          httpMetadata: { contentType: 'application/avro' },
          customMetadata: { table, record_count: String(group.avroSlices.length), timestamp: new Date(ts).toISOString() },
        });

        group.messages.forEach(m => m.ack());
      } catch (err) {
        console.error('[Consumer] failed to append/store batch', String(err));
        group.messages.forEach(m => m.retry());
      }
    }
  }
};
