import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const modPath = path.join(__dirname, '../dist/producer.js');
if (!fs.existsSync(modPath)) {
  console.error('Compiled producer module not found at', modPath);
  console.error('Run: npx tsc --outDir dist');
  process.exit(2);
}

const producerModule = await import(modPath);
const producer = producerModule.default;

// Mock Request object
function makeRequest(body) {
  return {
    method: 'POST',
    async json() { return body; },
    text: async () => JSON.stringify(body),
  };
}

async function run() {
  // Prepare payload with 450 small records to force chunking (CHUNK=200 => 3 messages)
  const records = [];
  for (let i = 0; i < 450; i++) records.push({ i, value: 'x' + i });
  const payload = [{ table: 'battle', records }];

  let sent = null;
  const env = {
    COMPACTION_QUEUE: {
      async sendBatch(messages) {
        sent = messages;
        return Promise.resolve();
      }
    }
  };

  const res = await producer.fetch(makeRequest(payload), env);
  console.log('Response status:', res.status || (res && res.statusCode) || 'unknown');
  if (!sent) throw new Error('sendBatch not called');
  console.log('Messages sent:', sent.length);
  if (sent.length !== 3) throw new Error('expected 3 chunked messages for 450 records');
  console.log('Producer chunking test passed');
}

run().catch((err) => { console.error('Producer test failed:', err); process.exit(3); });
