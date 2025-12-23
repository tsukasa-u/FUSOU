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
}

interface BufferLogRecord {
  dataset_id: string;
  table_name: string;
  timestamp: number;  // milliseconds
  data: unknown;       // JSON payload (will be serialized to BLOB)
  uploaded_by?: string;
}

interface QueueMessage {
  dataset_id: string;
  table: string;
  records: any[];
  uploaded_by?: string;
}

/**
 * Generate bulk INSERT SQL with placeholders
 * Example: INSERT INTO buffer_logs (dataset_id, table_name, timestamp, data, uploaded_by) 
 *          VALUES (?,?,?,?,?), (?,?,?,?,?)
 */
function buildBulkInsertSQL(recordCount: number): string {
  const placeholder = '(?,?,?,?,?)';
  const placeholders = Array(recordCount).fill(placeholder).join(',');
  return `INSERT INTO buffer_logs (dataset_id, table_name, timestamp, data, uploaded_by) VALUES ${placeholders}`;
}

/**
 * Flatten records into bind parameter array
 * Order: [dataset_id, table_name, timestamp, data_blob, uploaded_by, ...]
 */
function flattenRecords(records: BufferLogRecord[]): (string | number | ArrayBuffer | null)[] {
  const params: (string | number | ArrayBuffer | null)[] = [];
  
  for (const record of records) {
    params.push(
      record.dataset_id,
      record.table_name,
      record.timestamp,
      new TextEncoder().encode(JSON.stringify(record.data)), // Convert to BLOB
      record.uploaded_by ?? null
    );
  }
  
  return params;
}

/**
 * Normalize queue message to buffer log records
 */
function normalizeMessage(msg: QueueMessage): BufferLogRecord[] {
  const now = Date.now();
  
  return msg.records.map(record => ({
    dataset_id: msg.dataset_id,
    table_name: msg.table,
    timestamp: record.timestamp ?? now,  // Use record timestamp or fallback to now
    data: record,
    uploaded_by: msg.uploaded_by
  }));
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
  
  // Step 1: Flatten all messages into single record array
  for (const message of batch.messages) {
    try {
      const normalized = normalizeMessage(message.body);
      allRecords.push(...normalized);
    } catch (err) {
      console.error('Failed to normalize message:', err);
      // Optionally: send to DLQ or log for manual review
      message.retry(); // Retry this specific message
    }
  }
  
  if (allRecords.length === 0) {
    console.log('No valid records to buffer');
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
    
    // Step 3: ACK all messages (fast return)
    batch.ackAll();
    
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
  
  for (const message of batch.messages) {
    try {
      const normalized = normalizeMessage(message.body);
      allRecords.push(...normalized);
    } catch (err) {
      console.error('Failed to normalize message:', err);
      message.retry();
    }
  }
  
  if (allRecords.length === 0) {
    console.log('No valid records to buffer');
    return;
  }
  
  // Chunk records into manageable batches
  const chunks: BufferLogRecord[][] = [];
  for (let i = 0; i < allRecords.length; i += chunkSize) {
    chunks.push(allRecords.slice(i, i + chunkSize));
  }
  
  console.log(`Processing ${allRecords.length} records in ${chunks.length} chunks`);
  
  // Insert each chunk sequentially (D1 doesn't support parallel writes well)
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const sql = buildBulkInsertSQL(chunk.length);
    const params = flattenRecords(chunk);
    
    try {
      const result = await env.BATTLE_INDEX_DB.prepare(sql)
        .bind(...params)
        .run();
      
      console.log(`✅ Chunk ${i + 1}/${chunks.length}: ${chunk.length} records (success: ${result.success})`);
      
    } catch (err) {
      console.error(`❌ Chunk ${i + 1}/${chunks.length} failed:`, err);
      // Retry entire batch if any chunk fails (atomic operation)
      batch.retryAll();
      return;
    }
  }
  
  // All chunks succeeded
  batch.ackAll();
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
