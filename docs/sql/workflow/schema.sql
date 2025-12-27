-- FUSOU-WORKFLOW D1 Schema
-- Create tables and indexes for buffer, archived files, and block indexes

-- Hot buffer (recent writes)
CREATE TABLE IF NOT EXISTS buffer_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  period_tag TEXT NOT NULL DEFAULT 'latest',
  schema_version TEXT NOT NULL DEFAULT 'v1',
  timestamp INTEGER NOT NULL,
  data BLOB NOT NULL,
  uploaded_by TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_buffer_dataset_table_ts
  ON buffer_logs(dataset_id, table_name, period_tag, schema_version, timestamp);

-- Archived files metadata
CREATE TABLE IF NOT EXISTS archived_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL UNIQUE,
  file_size INTEGER NOT NULL,
  schema_version TEXT NOT NULL DEFAULT 'v1',
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
  schema_version TEXT NOT NULL DEFAULT 'v1',
  period_tag TEXT NOT NULL,
  file_id INTEGER NOT NULL,
  start_byte INTEGER NOT NULL,
  length INTEGER NOT NULL,
  record_count INTEGER NOT NULL,
  start_timestamp INTEGER NOT NULL,
  end_timestamp INTEGER NOT NULL,
  FOREIGN KEY(file_id) REFERENCES archived_files(id)
);

CREATE INDEX IF NOT EXISTS idx_block_dataset_table_ts
  ON block_indexes(dataset_id, table_name, schema_version, period_tag, start_timestamp, end_timestamp);

CREATE INDEX IF NOT EXISTS idx_block_file_offset
  ON block_indexes(file_id, start_byte);

-- View: hot_cold_summary (Added from hot-cold-schema.sql)
CREATE VIEW IF NOT EXISTS hot_cold_summary AS
SELECT
    'Hot (Buffer)' AS storage_type,
    dataset_id,
    table_name,
    period_tag,
    COUNT(*) AS record_count,
    SUM(LENGTH(data)) AS total_bytes,
    MIN(timestamp) AS earliest_timestamp,
    MAX(timestamp) AS latest_timestamp
FROM buffer_logs
GROUP BY dataset_id, table_name, period_tag

UNION ALL

SELECT
    'Cold (Archived)' AS storage_type,
    bi.dataset_id,
    bi.table_name,
    bi.period_tag,
    SUM(bi.record_count) AS record_count,
    SUM(bi.length) AS total_bytes,
    MIN(bi.start_timestamp) AS earliest_timestamp,
    MAX(bi.end_timestamp) AS latest_timestamp
FROM block_indexes bi
GROUP BY bi.dataset_id, bi.table_name, bi.period_tag;

-- View: archive_efficiency (Added from hot-cold-schema.sql)
CREATE VIEW IF NOT EXISTS archive_efficiency AS
SELECT
    af.file_path,
    af.compression_codec,
    af.file_size,
    COUNT(bi.id) AS block_count,
    SUM(bi.length) AS total_indexed_bytes,
    ROUND(CAST(SUM(bi.length) AS REAL) / af.file_size * 100, 2) AS utilization_percent,
    CASE
        WHEN af.compression_codec IS NOT NULL
        THEN ROUND(CAST(af.file_size AS REAL) / SUM(bi.length), 2)
        ELSE NULL
    END AS compression_ratio,
    af.created_at
FROM archived_files af
LEFT JOIN block_indexes bi ON af.id = bi.file_id
GROUP BY af.id;
