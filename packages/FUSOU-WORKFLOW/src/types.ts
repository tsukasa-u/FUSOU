import type { QueueMessage } from "./buffer-consumer";

export interface IngestRecord {
  table: string;
  data: Record<string, unknown>;
}

export type { QueueMessage };

export type QueueMessageBody = QueueMessage;

export type QueueSendBatchItem = { body: QueueMessageBody };

export interface EnvBindings {
  BATTLE_DATA_BUCKET: R2Bucket;
  COMPACTION_QUEUE: Queue;
  COMPACTION_DLQ?: Queue;
  BATTLE_INDEX_DB?: D1Database;
}
