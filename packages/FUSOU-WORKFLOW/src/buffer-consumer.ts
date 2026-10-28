// Note: Full Avro validation is performed at FUSOU-WEB upload endpoint
// Here we only do lightweight header check for defense-in-depth

import { insertBufferLogs } from "./db";
import { QueueMessageSchema } from "./schemas";
import type { QueueMessage } from "./schemas";
import { inspectAvroFrames } from "./avro-integrity";
export { QueueMessageSchema } from "./schemas";
export type { QueueMessage } from "./schemas";
/**
 * Lightweight Avro header validation (DoS prevention)
 */
function validateAvroHeader(
  data: Uint8Array,
  maxBytes: number,
): { valid: boolean; error?: string } {
  if (data.byteLength > maxBytes) {
    return { valid: false, error: `File too large: ${data.byteLength} bytes` };
  }
  if (
    data.byteLength < 4 ||
    data[0] !== 0x4f ||
    data[1] !== 0x62 ||
    data[2] !== 0x6a ||
    data[3] !== 0x01
  ) {
    return { valid: false, error: "Invalid Avro magic bytes" };
  }
  return { valid: true };
}

interface Env {
  BATTLE_INDEX_DB: D1Database;
  // Optional tuning: chunk size for bulk inserts (<= 500)
  BUFFER_CHUNK_SIZE?: string;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
}

interface BufferLogRecord {
  dataset_id: string;
  table_name: string;
  period_tag: string;
  table_version: string;
  timestamp: number; // milliseconds
  data: ArrayBuffer; // Avro binary BLOB
  uploaded_by?: string;
  trust_tag?: string;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}

function normalizeTrustTag(value: unknown): string {
  return value === "hw_verified" ||
    value === "sw_verified" ||
    value === "unverified" ||
    value === "suspicious"
    ? value
    : "unverified";
}

// Note: buildBulkInsertSQL and flattenRecords have been removed.
// buffer_logs inserts now use insertBufferLogs from ./db

/**
 * Normalize queue message to buffer log records
 * Supports both legacy (single table) and batched (all tables) message formats
 *
 * Note: Full decode validation is done at FUSOU-WEB upload endpoint
 * Here we only do lightweight header check (defense-in-depth)
 */
async function normalizeMessage(msg: QueueMessage): Promise<BufferLogRecord[]> {
  const now = Date.now();
  const tableVersion = msg.tableVersion;
  const timestamp = msg.triggeredAt ? new Date(msg.triggeredAt).getTime() : now;
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error("Invalid triggeredAt in queue message");
  }

  if (!tableVersion) {
    throw new Error("Missing table_version in queue message");
  }

  // Check if this is a batched message (all tables in one)
  if ("batched" in msg && msg.batched === true) {
    // New batched format: split payload by offsets
    const payload = decodeBase64ToBytes(msg.payload_base64);
    const records: BufferLogRecord[] = [];
    let previousEnd = 0;

    for (const offset of [...msg.table_offsets].sort((a, b) => a.start_byte - b.start_byte)) {
      const end = offset.start_byte + offset.byte_length;
      if (!Number.isSafeInteger(end) || offset.start_byte < previousEnd || end > payload.byteLength) {
        throw new Error(`Invalid or overlapping table offset for ${offset.table_name}`);
      }
      previousEnd = end;
      const slice = payload.subarray(
        offset.start_byte,
        offset.start_byte + offset.byte_length,
      );

      // Defense-in-depth: lightweight header check per table
      const headerCheck = validateAvroHeader(slice, 1048576); // 1MB cap
      if (!headerCheck.valid) {
        console.error(
          `[Consumer] Avro header validation failed for ${offset.table_name}: ${headerCheck.error}`,
        );
        throw new Error(
          `Avro header validation failed for ${offset.table_name}: ${headerCheck.error}`,
        );
      }
      const framing = inspectAvroFrames(slice);
      if (framing.codec !== "null" && framing.codec !== "deflate") throw new Error("Unsupported Avro codec");
      if (!framing.recordCount) continue;

      console.log(
        `[Consumer] Accepted ${offset.table_name}: ${slice.length} bytes, table_version=${tableVersion}`,
      );

      records.push({
        dataset_id: msg.datasetId,
        table_name: offset.table_name,
        period_tag: msg.periodTag ?? "latest",
        table_version: tableVersion,
        timestamp,
        data: toArrayBuffer(slice),
        ...(msg.userId !== undefined ? { uploaded_by: msg.userId } : {}),
        ...(normalizeTrustTag(msg.trust_tag) !== undefined
          ? { trust_tag: normalizeTrustTag(msg.trust_tag) }
          : {}),
      });
    }

    console.log(
      `[Consumer] Processed batched message with ${records.length} tables`,
    );
    return records;
  }

  // Legacy format: single table per message
  const legacyMsg = msg;
  const avroBytes = decodeBase64ToBytes(legacyMsg.avro_base64);

  // Defense-in-depth: lightweight header check (magic bytes + size)
  const headerCheck = validateAvroHeader(avroBytes, 1048576); // 1MB cap
  if (!headerCheck.valid) {
    throw new Error(`Avro header validation failed: ${headerCheck.error}`);
  }
  const framing = inspectAvroFrames(avroBytes);
  if (framing.codec !== "null" && framing.codec !== "deflate") throw new Error("Unsupported Avro codec");
  if (!framing.recordCount) return [];

  console.log(
    `[Consumer] Accepted ${legacyMsg.table}: ${avroBytes.length} bytes, table_version=${tableVersion}`,
  );

  return [
    {
      dataset_id: legacyMsg.datasetId,
      table_name: legacyMsg.table,
      period_tag: legacyMsg.periodTag ?? "latest",
      table_version: tableVersion,
      timestamp,
      data: toArrayBuffer(avroBytes),
      ...(legacyMsg.userId !== undefined
        ? { uploaded_by: legacyMsg.userId }
        : {}),
      ...(normalizeTrustTag(legacyMsg.trust_tag) !== undefined
        ? { trust_tag: normalizeTrustTag(legacyMsg.trust_tag) }
        : {}),
    },
  ];
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
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  // Keep each message's records and receipt in one transaction, and bound live buffers.
  for (const message of batch.messages) {
    try {
      const parsedMessage = QueueMessageSchema.safeParse(message.body);
      if (!parsedMessage.success) {
        throw new Error(`Invalid queue message: ${parsedMessage.error.message}`);
      }
      const normalized = await normalizeMessage(parsedMessage.data);
      const result = await insertBufferLogs(env, normalized, `${batch.queue}:${message.id}`);
      console.log(`[Buffer Consumer] Buffered ${result.insertedCount} records for ${message.id}`);
      message.ack();
    } catch (err) {
      console.error(`[Buffer Consumer] Failed message ${message.id}:`, err);
      message.retry();
    }
  }
}

/**
 * Chunked Bulk Insert (for very large batches > 1000 records)
 * D1 has query size limits, so split into smaller chunks if needed
 */
export async function handleBufferConsumerChunked(
  batch: MessageBatch<unknown>,
  env: Env,
  _chunkSize: number = 500,
): Promise<void> {
  await handleBufferConsumer(batch, env);
}

/**
 * Export for integration into main Worker
 */
export default {
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    // Use chunked handler for safety (handles large batches)
    await handleBufferConsumerChunked(batch, env);
  },
};
