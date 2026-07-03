CREATE TABLE IF NOT EXISTS buffer_logs_active (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  period_tag TEXT NOT NULL DEFAULT 'latest',
  table_version TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  data BLOB NOT NULL,
  uploaded_by TEXT,
  trust_tag TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS buffer_logs_processing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  period_tag TEXT NOT NULL DEFAULT 'latest',
  table_version TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  data BLOB NOT NULL,
  uploaded_by TEXT,
  trust_tag TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_bla_ordering
  ON buffer_logs_active(table_version, table_name, period_tag, dataset_id, id);
CREATE INDEX IF NOT EXISTS idx_bla_hot
  ON buffer_logs_active(dataset_id, table_name, timestamp);

CREATE INDEX IF NOT EXISTS idx_blp_ordering
  ON buffer_logs_processing(table_version, table_name, period_tag, dataset_id, id);
CREATE INDEX IF NOT EXISTS idx_blp_hot
  ON buffer_logs_processing(dataset_id, table_name, timestamp);
