-- ============================================================================
-- Migration: Rename schema_version → table_version (battle_index DB)
-- Database: dev_kc_battle_index
-- Date: 2026-02-17
-- Purpose: Unify to table_version across all tables
-- ============================================================================

-- Step 1: Rename columns
ALTER TABLE buffer_logs RENAME COLUMN schema_version TO table_version;
ALTER TABLE archived_files RENAME COLUMN schema_version TO table_version;
ALTER TABLE block_indexes RENAME COLUMN schema_version TO table_version;

-- Step 2: Drop old indexes that reference schema_version
DROP INDEX IF EXISTS idx_archived_schema;
DROP INDEX IF EXISTS idx_block_dataset_table_ts;
DROP INDEX IF EXISTS idx_block_search;
DROP INDEX IF EXISTS idx_buffer_schema_version;

-- Step 3: Recreate indexes with table_version
CREATE INDEX idx_archived_table_version
  ON archived_files (table_version);

CREATE INDEX idx_block_dataset_table_ts
  ON block_indexes(dataset_id, table_name, table_version, period_tag, start_timestamp, end_timestamp);

CREATE INDEX idx_block_search
  ON block_indexes (dataset_id, table_name, table_version, start_timestamp, end_timestamp);

CREATE INDEX idx_buffer_table_version
  ON buffer_logs (table_version, table_name, period_tag);
