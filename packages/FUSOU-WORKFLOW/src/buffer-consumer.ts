/**
 * Buffer Consumer - Hot Storage Writer
 * 
 * Role: Receives batched messages from Queue and writes to D1 buffer_logs table
 * 
 * Optimizations:
 * - Bulk Insert: Batches multiple records into single SQL statement
 * - Minimal Processing: Stores raw payload without immediate Avro serialization
 * - Fast ACK: Returns quickly to avoid Queue timeout
 * 
 * Performance Target: < 500ms for 100 records
 */

interface Env {
  BATTLE_INDEX_DB: D1Database;
  // Optional tuning: chunk size for bulk inserts (<= 500)
  BUFFER_CHUNK_SIZE?: string;
}

interface BufferLogRecord {
  dataset_id: string;
  table_name: string;
  period_tag: string;
  timestamp: number;  // milliseconds
  data: ArrayBuffer;   // Avro binary BLOB
  uploaded_by?: string;
}

// Queue message format (from /api/battle-data/upload)
interface QueueMessage {
  table: string;
  avro_base64: string;
  datasetId: string;
  periodTag: string;
  triggeredAt?: string;
  userId?: string;
}

/**
 * Generate bulk INSERT SQL with placeholders
 * Single record per message (1 Avro binary per row)
 */
function buildBulkInsertSQL(recordCount: number): string {
  const MAX_SAFE_RECORDS = 500;
  if (recordCount > MAX_SAFE_RECORDS) {
    throw new Error(`Bulk insert too large: ${recordCount} records (max: ${MAX_SAFE_RECORDS})`);
  }
  
  const placeholder = '(?,?,?,?,?,?)';
  const placeholders = Array(recordCount).fill(placeholder).join(',');
  return `INSERT INTO buffer_logs (dataset_id, table_name, period_tag, timestamp, data, uploaded_by) VALUES ${placeholders}`;
}

/**
 * Flatten records into bind parameter array
 * Order: [dataset_id, table_name, period_tag, timestamp, avro_blob, uploaded_by, ...]
 */
function flattenRecords(records: BufferLogRecord[]): (string | number | ArrayBuffer | null)[] {
  const params: (string | number | ArrayBuffer | null)[] = [];
  
  for (const record of records) {
    params.push(
      record.dataset_id,
      record.table_name,
      record.period_tag,
      record.timestamp,
      record.data,  // Already ArrayBuffer (Avro binary)
      record.uploaded_by ?? null
    );
  }
  
  return params;
}

/**
 * Normalize queue message to buffer log record
 * Converts base64 Avro to binary BLOB for storage
 */
function normalizeMessage(msg: QueueMessage): BufferLogRecord[] {
  const now = Date.now();
  
  // Decode base64 to binary
  const avroBytes = Uint8Array.from(atob(msg.avro_base64), c => c.charCodeAt(0));
  
  return [{
    dataset_id: msg.datasetId,
    table_name: msg.table,
    period_tag: msg.periodTag ?? 'latest',
    timestamp: msg.triggeredAt ? new Date(msg.triggeredAt).getTime() : now,
    data: avroBytes.buffer,  // Store as Avro BLOB
    uploaded_by: msg.userId
  }];
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
  
  // Step 1: Flatten all messages into single record array
  for (const message of batch.messages) {
    try {
      const normalized = normalizeMessage(message.body);
      allRecords.push(...normalized);
    } catch (err) {
      console.error('Failed to normalize message:', err);
      failedMessages.push(message);
    }
  }
  
  if (allRecords.length === 0) {
    console.log('No valid records to buffer');
    // Retry failed messages
    failedMessages.forEach(msg => msg.retry());
    return;
  }
  
  // Step 2: Bulk Insert (D1 optimization)
  try {
    const sql = buildBulkInsertSQL(allRecords.length);
    const params = flattenRecords(allRecords);
    
    const result = await env.BATTLE_INDEX_DB.prepare(sql)
      .bind(...params)
      .run();
    
    console.log(`✅ Buffered ${allRecords.length} records (success: ${result.success})`);
    
    // Step 3: ACK successful messages only
    batch.messages.forEach(msg => {
      if (!failedMessages.includes(msg)) {
        msg.ack();
      } else {
        msg.retry();
      }
    });
    
  } catch (err) {
    console.error('❌ Bulk insert failed:', err);
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
      const normalized = normalizeMessage(message.body);
      allRecords.push(...normalized);
    } catch (err) {
      console.error('Failed to normalize message:', err);
      failedMessages.push(message);
    }
  }
  
  if (allRecords.length === 0) {
    console.log('No valid records to buffer');
    failedMessages.forEach(msg => msg.retry());
    return;
  }
  
  // Chunk records into manageable batches
  // Resolve chunk size from env (safe cap at 500)
  const envChunk = Number(env.BUFFER_CHUNK_SIZE ?? chunkSize);
  const safeChunk = Math.min(Number.isFinite(envChunk) && envChunk > 0 ? envChunk : chunkSize, 500);
  const chunks: BufferLogRecord[][] = [];
  for (let i = 0; i < allRecords.length; i += safeChunk) {
    chunks.push(allRecords.slice(i, i + safeChunk));
  }
  
  // Insert each chunk sequentially (D1 doesn't support parallel writes well)
  let successCount = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const sql = buildBulkInsertSQL(chunk.length);
    const params = flattenRecords(chunk);
    
    try {
      await env.BATTLE_INDEX_DB.prepare(sql)
        .bind(...params)
        .run();
      successCount += chunk.length;
    } catch (err) {
      console.error(`[Buffer Consumer] Chunk ${i + 1}/${chunks.length} failed:`, err instanceof Error ? err.message : String(err));
      // Retry entire batch if any chunk fails (atomic operation)
      batch.retryAll();
      return;
    }
  }
  
  // All chunks succeeded - ACK successful messages
  batch.messages.forEach(msg => {
    if (!failedMessages.includes(msg)) {
      msg.ack();
    } else {
      msg.retry();
    }
  });
  
  // Summary log
  console.log(`[Buffer Consumer] ${successCount} records inserted (${chunks.length} chunks, ${failedMessages.length} skipped)`);
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
