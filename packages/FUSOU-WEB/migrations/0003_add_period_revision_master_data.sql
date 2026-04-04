-- ============================================================================
-- Migration: Add period_revision and allow multiple revisions per period+version
-- Database: dev_kc_master_data_index
-- Date: 2026-04-04
-- Purpose:
--   - Allow storing minor updates under the same period_tag/table_version
--   - Keep existing data intact
--   - Preserve FK relation from master_data_tables -> master_data_index
-- ============================================================================

PRAGMA foreign_keys = OFF;

-- Backup existing tables by rename
ALTER TABLE master_data_tables RENAME TO master_data_tables_old;
ALTER TABLE master_data_index RENAME TO master_data_index_old;

-- Recreate master_data_index with revision-aware uniqueness
CREATE TABLE master_data_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL DEFAULT '0.4',
  period_revision INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT NOT NULL,
  r2_keys TEXT,
  table_offsets TEXT,
  table_count INTEGER,
  upload_status TEXT DEFAULT 'pending',
  uploaded_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(period_tag, table_version, period_revision)
);

-- Restore existing rows as revision=1
INSERT INTO master_data_index (
  id,
  period_tag,
  table_version,
  period_revision,
  content_hash,
  r2_keys,
  table_offsets,
  table_count,
  upload_status,
  uploaded_by,
  created_at,
  completed_at
)
SELECT
  id,
  period_tag,
  table_version,
  1,
  content_hash,
  r2_keys,
  table_offsets,
  table_count,
  upload_status,
  uploaded_by,
  created_at,
  completed_at
FROM master_data_index_old;

-- Recreate master_data_tables (same columns) so FK points to new parent table
CREATE TABLE master_data_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  master_data_id INTEGER NOT NULL,
  table_name TEXT NOT NULL,
  table_index INTEGER NOT NULL,
  start_byte INTEGER NOT NULL,
  end_byte INTEGER NOT NULL,
  record_count INTEGER,
  r2_key TEXT,
  content_hash TEXT,
  created_at INTEGER NOT NULL,
  table_version TEXT NOT NULL DEFAULT '0.4',
  FOREIGN KEY (master_data_id) REFERENCES master_data_index(id) ON DELETE CASCADE,
  UNIQUE(master_data_id, table_name)
);

INSERT INTO master_data_tables (
  id,
  master_data_id,
  table_name,
  table_index,
  start_byte,
  end_byte,
  record_count,
  r2_key,
  content_hash,
  created_at,
  table_version
)
SELECT
  id,
  master_data_id,
  table_name,
  table_index,
  start_byte,
  end_byte,
  record_count,
  r2_key,
  content_hash,
  created_at,
  table_version
FROM master_data_tables_old;

DROP TABLE master_data_tables_old;
DROP TABLE master_data_index_old;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_master_data_by_period
  ON master_data_index(period_tag);

CREATE INDEX IF NOT EXISTS idx_master_data_by_status_created
  ON master_data_index(upload_status, created_at);

CREATE INDEX IF NOT EXISTS idx_master_data_by_version
  ON master_data_index(table_version);

CREATE INDEX IF NOT EXISTS idx_master_data_by_period_version_revision
  ON master_data_index(period_tag, table_version, period_revision DESC);

CREATE INDEX IF NOT EXISTS idx_master_data_by_period_version_hash
  ON master_data_index(period_tag, table_version, content_hash);

CREATE INDEX IF NOT EXISTS idx_master_data_tables_by_name
  ON master_data_tables(table_name);

CREATE INDEX IF NOT EXISTS idx_master_data_tables_by_period_and_name
  ON master_data_tables(master_data_id, table_name);

CREATE INDEX IF NOT EXISTS idx_master_data_tables_by_version
  ON master_data_tables(table_version);

PRAGMA foreign_keys = ON;
