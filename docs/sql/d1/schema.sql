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
