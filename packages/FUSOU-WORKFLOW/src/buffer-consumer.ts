// Note: Full Avro validation is performed at FUSOU-WEB upload endpoint
// Here we only do lightweight header check for defense-in-depth

import {
  insertBufferLogsWithFallback,
  UnifiedDbEnv,
} from './db';
/**
 * Lightweight Avro header validation (DoS prevention)
 */
function validateAvroHeader(data: Uint8Array, maxBytes: number): { valid: boolean; error?: string } {
  if (data.byteLength > maxBytes) {
    return { valid: false, error: `File too large: ${data.byteLength} bytes` };
  }
  if (data.byteLength < 4 || data[0] !== 0x4F || data[1] !== 0x62 || data[2] !== 0x6A || data[3] !== 0x01) {
    return { valid: false, error: 'Invalid Avro magic bytes' };
  }
  return { valid: true };
}

interface Env {
  BATTLE_INDEX_DB: D1Database;
  // Optional tuning: chunk size for bulk inserts (<= 500)
  BUFFER_CHUNK_SIZE?: string;
  // TiDB Cloud Serverless connection URL (optional - falls back to D1 if not set)
  TIDB_KC_DB_URL?: string;
}

interface BufferLogRecord {
  dataset_id: string;
  table_name: string;
  period_tag: string;
  schema_version: string;
  timestamp: number;  // milliseconds
  data: ArrayBuffer;   // Avro binary BLOB
  uploaded_by?: string;
}

// Legacy queue message format (single table per message)
interface LegacyQueueMessage {
  batched?: false;
  table: string;
  avro_base64: string;
  datasetId: string;
  periodTag: string;
  schemaVersion?: string;  // v1, v2, etc.
  triggeredAt?: string;
  userId?: string;
}

// Table offset info for batched messages
interface TableOffset {
  table_name: string;
  start_byte: number;
  byte_length: number;
  record_count?: number;
}

// New batched message format (all tables in single message)
interface BatchedQueueMessage {
  batched: true;
  datasetId: string;
  periodTag: string;
  schemaVersion?: string;
  triggeredAt?: string;
  userId?: string;
  payload_base64: string;  // Full concatenated payload
  table_offsets: TableOffset[];  // Offsets for each table
}

// Union type for queue messages
type QueueMessage = LegacyQueueMessage | BatchedQueueMessage;

// Note: buildBulkInsertSQL and flattenRecords have been removed.
// buffer_logs inserts now use insertBufferLogsWithFallback from ./db

/**
 * Normalize queue message to buffer log records
 * Supports both legacy (single table) and batched (all tables) message formats
 * 
 * Note: Full decode validation is done at FUSOU-WEB upload endpoint
 * Here we only do lightweight header check (defense-in-depth)
 */
async function normalizeMessage(msg: QueueMessage): Promise<BufferLogRecord[]> {
  const now = Date.now();
  const schemaVersion = msg.schemaVersion || 'v1';
  const timestamp = msg.triggeredAt ? new Date(msg.triggeredAt).getTime() : now;

  // Check if this is a batched message (all tables in one)
  if ('batched' in msg && msg.batched === true) {
    // New batched format: split payload by offsets
    const payload = decodeBase64ToBytes(msg.payload_base64);
    const records: BufferLogRecord[] = [];

    for (const offset of msg.table_offsets) {
      const slice = payload.subarray(offset.start_byte, offset.start_byte + offset.byte_length);

      // Defense-in-depth: lightweight header check per table
      const headerCheck = validateAvroHeader(slice, 1048576); // 1MB cap
      if (!headerCheck.valid) {
        console.error(`[Consumer] Avro header validation failed for ${offset.table_name}: ${headerCheck.error}`);
        throw new Error(`Avro header validation failed for ${offset.table_name}: ${headerCheck.error}`);
      }

      console.log(`[Consumer] Accepted ${offset.table_name}: ${slice.length} bytes, schema=${schemaVersion}`);

      records.push({
        dataset_id: msg.datasetId,
        table_name: offset.table_name,
        period_tag: msg.periodTag ?? 'latest',
        schema_version: schemaVersion,
        timestamp,
        data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
        uploaded_by: msg.userId
      });
    }

    console.log(`[Consumer] Processed batched message with ${records.length} tables`);
    return records;
  }

  // Legacy format: single table per message
  const legacyMsg = msg as LegacyQueueMessage;
  const avroBytes = decodeBase64ToBytes(legacyMsg.avro_base64);

  // Defense-in-depth: lightweight header check (magic bytes + size)
  const headerCheck = validateAvroHeader(avroBytes, 1048576); // 1MB cap
  if (!headerCheck.valid) {
    throw new Error(`Avro header validation failed: ${headerCheck.error}`);
  }

  console.log(`[Consumer] Accepted ${legacyMsg.table}: ${avroBytes.length} bytes, schema=${schemaVersion}`);

  return [{
    dataset_id: legacyMsg.datasetId,
    table_name: legacyMsg.table,
    period_tag: legacyMsg.periodTag ?? 'latest',
    schema_version: schemaVersion,
    timestamp,
    data: avroBytes.buffer,
    uploaded_by: legacyMsg.userId
  }];
}

/**
 * Decode base64 string to Uint8Array
 */
function decodeBase64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Main Queue Consumer Handler
 * Triggered by Cloudflare Queue with batched messages
 */
export async function handleBufferConsumer(
  batch: MessageBatch<QueueMessage>,
  env: Env
): Promise<void> {
  const allRecords: BufferLogRecord[] = [];
  const failedMessages: Message<QueueMessage>[] = [];

  // Step 1: Flatten all messages into single record array (with async validation)
  for (const message of batch.messages) {
    try {
      const normalized = await normalizeMessage(message.body);
      allRecords.push(...normalized);
    } catch (err) {
      console.error('Failed to normalize/validate message:', err);
      failedMessages.push(message);
    }
  }

  if (allRecords.length === 0) {
    console.log('No valid records to buffer');
    // Retry failed messages
    failedMessages.forEach(msg => msg.retry());
    return;
  }

  // Step 2: Insert with TiDB -> D1 fallback
  try {
    const recordsForInsert = allRecords.map(r => ({
      dataset_id: r.dataset_id,
      table_name: r.table_name,
      period_tag: r.period_tag,
      schema_version: r.schema_version,
      timestamp: r.timestamp,
      data: r.data,
      uploaded_by: r.uploaded_by,
    }));
    
    const { source, insertedCount } = await insertBufferLogsWithFallback(env, recordsForInsert);

    console.log(`✅ Buffered ${insertedCount} records to ${source}`);

    // Step 3: ACK successful messages only
    batch.messages.forEach(msg => {
      if (!failedMessages.includes(msg)) {
        msg.ack();
      } else {
        msg.retry();
      }
    });

  } catch (err) {
    console.error('❌ Insert failed (both TiDB and D1):', err);
    // Retry entire batch (Queue will re-deliver)
    batch.retryAll();
  }
}

/**
 * Chunked Bulk Insert (for very large batches > 1000 records)
 * D1 has query size limits, so split into smaller chunks if needed
 */
export async function handleBufferConsumerChunked(
  batch: MessageBatch<QueueMessage>,
  env: Env,
  chunkSize: number = 500  // Adjust based on D1 limits
): Promise<void> {
  const allRecords: BufferLogRecord[] = [];
  const failedMessages: Message<QueueMessage>[] = [];

  for (const message of batch.messages) {
    try {
      const normalized = await normalizeMessage(message.body);
      allRecords.push(...normalized);
    } catch (err) {
      console.error('Failed to normalize/validate message:', err);
      failedMessages.push(message);
    }
  }

  if (allRecords.length === 0) {
    console.log('No valid records to buffer');
    failedMessages.forEach(msg => msg.retry());
    return;
  }

  // Insert with automatic TiDB -> D1 fallback on error
  try {
    const recordsForInsert = allRecords.map(r => ({
      dataset_id: r.dataset_id,
      table_name: r.table_name,
      period_tag: r.period_tag,
      schema_version: r.schema_version,
      timestamp: r.timestamp,
      data: r.data,
      uploaded_by: r.uploaded_by,
    }));
    
    const { source, insertedCount } = await insertBufferLogsWithFallback(env, recordsForInsert);
    
    // ACK successful messages
    batch.messages.forEach(msg => {
      if (!failedMessages.includes(msg)) {
        msg.ack();
      } else {
        msg.retry();
      }
    });
    
    console.log(`[Buffer Consumer] ${insertedCount} records inserted to ${source} (${failedMessages.length} skipped)`);
  } catch (err) {
    console.error('[Buffer Consumer] Insert failed (both TiDB and D1):', err instanceof Error ? err.message : String(err));
    batch.retryAll();
  }
}

/**
 * Export for integration into main Worker
 */
export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    // Use chunked handler for safety (handles large batches)
    await handleBufferConsumerChunked(batch, env);
  }
};
