export interface IngestRecord {
  table: string;
  data: Record<string, unknown>;
}

export interface QueueMessageBody {
  table: string;
  records: Record<string, unknown>[];
  // optional metadata
  datasetId?: string;
  uploadedBy?: string;
}

export type QueueSendBatchItem = { body: QueueMessageBody };

export interface EnvBindings {
  BATTLE_DATA_BUCKET: R2Bucket;
  COMPACTION_QUEUE: Queue;
  COMPACTION_DLQ?: Queue;
  BATTLE_INDEX_DB?: D1Database;
}
