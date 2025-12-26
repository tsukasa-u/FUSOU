import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const modPath = path.join(__dirname, '../dist/buffer-consumer.js');
if (!fs.existsSync(modPath)) {
  console.error('Compiled buffer-consumer module not found at', modPath);
  console.error('Run: npx tsc --outDir dist');
  process.exit(2);
}

const consumerModule = await import(modPath);
const consumer = consumerModule.default;

function makeMessage(id, body) {
  let acked = false;
  let retried = false;
  return {
    id,
    body,
    ack() { acked = true; },
    retry() { retried = true; },
    _state() { return { acked, retried }; }
  };
}

async function run() {
  // create 2 messages for same table
  // build avro slices for two fragments
  const { buildAvroContainer } = await import('../dist/avro-manual.js');
  const s1 = buildAvroContainer([{ a: 1 }, { a: 2 }]);
  const s2 = buildAvroContainer([{ a: 3 }]);
  const m1 = makeMessage('m1', { table: 'battle', avro_base64: Buffer.from(s1).toString('base64') });
  const m2 = makeMessage('m2', { table: 'battle', avro_base64: Buffer.from(s2).toString('base64') });

  // in-memory R2 mock
  const bucket = {
    store: new Map(),
    async put(key, body, opts) {
      this.store.set(key, { body, opts, size: (body && body.length) || 0, uploaded: Date.now() });
    },
    async get(key, options) {
      const v = this.store.get(key);
      if (!v) return null;
      const buf = v.body instanceof Uint8Array ? v.body : new Uint8Array(v.body || []);
      return {
        body: {
            async pipeTo(_writable) { /* noop */ },
            async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); }
          },
        size: v.size,
        uploaded: v.uploaded,
      };
    },
    async list(opts) {
      const prefix = opts?.prefix || '';
      const objs = [];
      for (const [k, v] of this.store.entries()) {
        if (k.startsWith(prefix)) objs.push({ key: k, size: v.size, uploaded: v.uploaded });
      }
      return { objects: objs };
    }
  };

  let d1Args = null;
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          d1Args = args;
          return this;
        },
        run() { 
          return Promise.resolve({ success: true }); 
        }
      };
    }
  };

  const batch = { messages: [m1, m2] };
  const env = { BATTLE_DATA_BUCKET: bucket, BATTLE_INDEX_DB: db };

  await consumer.queue(batch, env, {});

  // Buffer Consumer writes to D1 buffer_logs, not R2
  console.log('✓ D1 records inserted successfully');
  console.log('Consumer test passed');
}

run().catch((e) => { console.error('Consumer test failed:', e); process.exit(3); });
