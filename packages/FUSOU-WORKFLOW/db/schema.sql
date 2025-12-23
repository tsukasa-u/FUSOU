-- FUSOU-WORKFLOW D1 Schema
-- Create tables and indexes for buffer, archived files, and block indexes

-- Hot buffer (recent writes)
CREATE TABLE IF NOT EXISTS buffer_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  data BLOB NOT NULL,
  uploaded_by TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_buffer_dataset_table_ts
  ON buffer_logs(dataset_id, table_name, timestamp);

-- Archived files metadata
CREATE TABLE IF NOT EXISTS archived_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL UNIQUE,
  file_size INTEGER NOT NULL,
  compression_codec TEXT DEFAULT 'none',
  created_at INTEGER NOT NULL,
  last_modified_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_archived_files_path
  ON archived_files(file_path);

-- Block indexes (for R2 range reads)
CREATE TABLE IF NOT EXISTS block_indexes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  file_id INTEGER NOT NULL,
  start_byte INTEGER NOT NULL,
  length INTEGER NOT NULL,
  record_count INTEGER NOT NULL,
  start_timestamp INTEGER NOT NULL,
  end_timestamp INTEGER NOT NULL,
  FOREIGN KEY(file_id) REFERENCES archived_files(id)
);

CREATE INDEX IF NOT EXISTS idx_block_dataset_table_ts
  ON block_indexes(dataset_id, table_name, start_timestamp, end_timestamp);

CREATE INDEX IF NOT EXISTS idx_block_file_offset
  ON block_indexes(file_id, start_byte);
