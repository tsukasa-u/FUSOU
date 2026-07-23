export type CompactionTier = "hourly" | "daily" | "weekly" | "period";

export type SourceBlock = {
  id: number;
  dataset_id: string;
  table_name: string;
  table_version: string;
  period_tag: string;
  start_byte: number;
  length: number;
  record_count: number;
  start_timestamp: number;
  end_timestamp: number;
  compaction_tier: CompactionTier;
  window_start_ms: number | null;
  window_end_ms: number | null;
  file_id: number;
  file_path: string;
  file_size: number;
};

export type CompactionJobInput = {
  run_key: string;
  tier: CompactionTier;
  source_tier: CompactionTier;
  output_group_key?: string;
  table_name: string;
  period_tag: string;
  table_version: string;
  window_start_ms: number;
  window_end_ms: number;
  chunk_limit?: number;
};

export type RegisterOutputBlock = {
  dataset_id: string;
  table_name: string;
  period_tag: string;
  start_byte: number;
  length: number;
  record_count: number;
  start_timestamp: number;
  end_timestamp: number;
  source_file_count: number;
};

export type RegisterOutputPayload = {
  file_path: string;
  lock_token: string;
  table_version: string;
  compaction_tier: string;
  source_tier: string;
  window_start_ms: number;
  window_end_ms: number;
  file_size: number;
  compression_codec: string;
  blocks: RegisterOutputBlock[];
};

export type CleanupConsumedSourcesPayload = {
  source_file_ids: number[];
  source_tier: CompactionTier;
  table_name: string;
  period_tag: string;
  table_version: string;
  window_start_ms: number;
  window_end_ms: number;
};
