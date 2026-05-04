-- ============================================================================
-- D1 Database Schemas for FUSOU
-- Last updated: 2026-02-17
-- ============================================================================

-- ============================================================================
-- Database: dev_kc_battle_index
-- Purpose: Buffer logs, archived files, and block indexes for battle data
-- ============================================================================

CREATE TABLE buffer_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  data BLOB NOT NULL,
  uploaded_by TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  period_tag TEXT,
  table_version TEXT NOT NULL DEFAULT 'v1'
);

CREATE INDEX idx_buffer_dataset_table_ts
  ON buffer_logs(dataset_id, table_name, timestamp);
CREATE INDEX idx_buffer_logs_dataset
  ON buffer_logs(dataset_id);
CREATE INDEX idx_buffer_logs_upload
  ON buffer_logs(uploaded_by);
CREATE INDEX idx_buffer_table_version
  ON buffer_logs(table_version, table_name, period_tag);

CREATE TABLE archived_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL UNIQUE,
  file_size INTEGER NOT NULL,
  compression_codec TEXT DEFAULT 'none',
  created_at INTEGER NOT NULL,
  last_modified_at INTEGER NOT NULL,
  table_version TEXT NOT NULL DEFAULT 'v1'
);

CREATE INDEX idx_archived_files_path
  ON archived_files(file_path);
CREATE INDEX idx_archived_table_version
  ON archived_files(table_version);

CREATE TABLE block_indexes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  file_id INTEGER NOT NULL,
  start_byte INTEGER NOT NULL,
  length INTEGER NOT NULL,
  record_count INTEGER NOT NULL,
  start_timestamp INTEGER NOT NULL,
  end_timestamp INTEGER NOT NULL,
  table_version TEXT NOT NULL DEFAULT 'v1',
  period_tag TEXT NOT NULL DEFAULT '2025-12-18',
  FOREIGN KEY(file_id) REFERENCES archived_files(id)
);

CREATE INDEX idx_block_file_offset
  ON block_indexes(file_id, start_byte);
CREATE INDEX idx_block_indexes_table_period
  ON block_indexes(table_name, period_tag);
CREATE INDEX idx_block_indexes_time
  ON block_indexes(start_timestamp);
CREATE INDEX idx_block_dataset_table_ts
  ON block_indexes(dataset_id, table_name, table_version, period_tag, start_timestamp, end_timestamp);
CREATE INDEX idx_block_search
  ON block_indexes(dataset_id, table_name, table_version, start_timestamp, end_timestamp);

CREATE TABLE datasets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  compaction_needed INTEGER DEFAULT 0
);

CREATE INDEX idx_datasets_user_id ON datasets(user_id);
CREATE INDEX idx_datasets_compaction ON datasets(compaction_needed) WHERE compaction_needed = 1;

CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  uploader_id TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  finder_tag TEXT
);

CREATE INDEX idx_files_key ON files(key);
CREATE INDEX idx_files_uploader ON files(uploader_id, uploaded_at DESC);
CREATE INDEX idx_files_finder_tag ON files(finder_tag);

-- ============================================================================
-- Database: dev_kc_master_data_index
-- Purpose: Store master data periods and table metadata
-- ============================================================================

-- NOTE: Current UNIQUE constraint is UNIQUE(period_tag) only.
--       Target is UNIQUE(period_tag, table_version) -- requires migration 0003
--       with PRAGMA foreign_keys=OFF to avoid CASCADE delete of master_data_tables.
CREATE TABLE master_data_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL DEFAULT '0.4',
  content_hash TEXT NOT NULL,
  r2_keys TEXT,  -- JSON array of R2 keys (for cleanup on failure)
  upload_status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'failed'
  uploaded_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(period_tag)  -- TODO: migrate to UNIQUE(period_tag, table_version)
);

CREATE INDEX idx_master_data_by_period 
  ON master_data_index(period_tag);
CREATE INDEX idx_master_data_by_status_created 
  ON master_data_index(upload_status, created_at);
CREATE INDEX idx_master_data_by_version
  ON master_data_index(table_version);

-- Master Data Tables - Track individual tables per period
CREATE TABLE master_data_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  master_data_id INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  table_index INTEGER NOT NULL,  -- Order in batch (0-12)
  start_byte INTEGER NOT NULL,
  end_byte INTEGER NOT NULL,
  record_count INTEGER,
  r2_key TEXT,  -- "master_data/{period_tag}/{table_name}.avro"
  content_hash TEXT,
  created_at INTEGER NOT NULL,
  table_version TEXT NOT NULL DEFAULT '0.4',
  FOREIGN KEY (master_data_id) REFERENCES master_data_index(id) ON DELETE CASCADE,
  UNIQUE(master_data_id, table_name)
);

CREATE INDEX idx_master_data_tables_by_name 
  ON master_data_tables(table_name);
CREATE INDEX idx_master_data_tables_by_period_and_name 
  ON master_data_tables(master_data_id, table_name);
CREATE INDEX idx_master_data_tables_by_version
  ON master_data_tables(table_version);

-- ============================================================================
-- Database: dev_kc_battle_index (Quest tree inference)
-- Purpose: Quest ingest events, sessions, occurrence contexts, and inferred rules
-- ============================================================================

CREATE TABLE quest_collection_sessions (
  collection_session_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  start_reason TEXT NOT NULL DEFAULT 'resume',
  has_data_gap INTEGER NOT NULL DEFAULT 0,
  bootstrap_completed_at_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_qsess_dataset_started
  ON quest_collection_sessions(dataset_id, started_at_ms DESC);

CREATE TABLE quest_ingest_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  collection_session_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  event_type TEXT NOT NULL,
  quest_id INTEGER,
  page_no INTEGER,
  timestamp_ms INTEGER NOT NULL,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ingested',
  created_at INTEGER NOT NULL,
  UNIQUE(request_id, payload_hash),
  FOREIGN KEY(collection_session_id) REFERENCES quest_collection_sessions(collection_session_id)
);

CREATE TABLE questlist_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  collection_session_id TEXT NOT NULL,
  page_no INTEGER NOT NULL,
  snapshot_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  visible_quest_ids_json TEXT NOT NULL,
  captured_at_ms INTEGER NOT NULL,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(collection_session_id) REFERENCES quest_collection_sessions(collection_session_id)
);

CREATE TABLE quest_state_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  collection_session_id TEXT NOT NULL,
  quest_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  state_after TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(collection_session_id) REFERENCES quest_collection_sessions(collection_session_id)
);

CREATE TABLE quest_state_latest (
  dataset_id TEXT NOT NULL,
  quest_id INTEGER NOT NULL,
  collection_session_id TEXT NOT NULL,
  state TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  last_event_type TEXT NOT NULL,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  is_claimed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(dataset_id, quest_id),
  FOREIGN KEY(collection_session_id) REFERENCES quest_collection_sessions(collection_session_id)
);

CREATE TABLE quest_appearance_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  collection_session_id TEXT NOT NULL,
  target_quest_id INTEGER NOT NULL,
  appeared_at_ms INTEGER NOT NULL,
  source_endpoint TEXT NOT NULL,
  source_event_id INTEGER,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  is_bootstrap_unknown INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(dataset_id, collection_session_id, target_quest_id, appeared_at_ms),
  FOREIGN KEY(collection_session_id) REFERENCES quest_collection_sessions(collection_session_id)
);

CREATE TABLE quest_inference_tasks (
  task_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  collection_session_id TEXT NOT NULL,
  from_ts INTEGER NOT NULL,
  to_ts INTEGER NOT NULL,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(collection_session_id) REFERENCES quest_collection_sessions(collection_session_id)
);

CREATE TABLE quest_occurrence_contexts (
  occurrence_id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  collection_session_id TEXT NOT NULL,
  target_quest_id INTEGER NOT NULL,
  occurred_at_ms INTEGER NOT NULL,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  is_bootstrap_unknown INTEGER NOT NULL DEFAULT 0,
  has_cross_session_inference INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(collection_session_id) REFERENCES quest_collection_sessions(collection_session_id)
);

CREATE TABLE quest_occurrence_prerequisites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurrence_id TEXT NOT NULL,
  quest_id INTEGER NOT NULL,
  is_recent INTEGER NOT NULL DEFAULT 0,
  is_completed INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE(occurrence_id, quest_id),
  FOREIGN KEY(occurrence_id) REFERENCES quest_occurrence_contexts(occurrence_id)
);

CREATE TABLE quest_rule_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_quest_id INTEGER NOT NULL,
  prereq_set_hash TEXT NOT NULL,
  prereq_set_json TEXT NOT NULL,
  set_size INTEGER NOT NULL,
  support INTEGER NOT NULL,
  exposure INTEGER NOT NULL,
  confidence REAL NOT NULL,
  lift REAL NOT NULL,
  score REAL NOT NULL,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  quality_tier TEXT NOT NULL DEFAULT 'high',
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(target_quest_id, prereq_set_hash, period_tag, table_version)
);

CREATE TABLE quest_rule_edges (
  rule_id TEXT PRIMARY KEY,
  target_quest_id INTEGER NOT NULL,
  prereq_set_json TEXT NOT NULL,
  set_size INTEGER NOT NULL,
  class TEXT NOT NULL,
  support INTEGER NOT NULL,
  confidence REAL NOT NULL,
  lift REAL NOT NULL,
  score REAL NOT NULL,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  quality_tier TEXT NOT NULL DEFAULT 'high',
  updated_at_ms INTEGER NOT NULL,
  UNIQUE(target_quest_id, prereq_set_json, period_tag, table_version)
);
