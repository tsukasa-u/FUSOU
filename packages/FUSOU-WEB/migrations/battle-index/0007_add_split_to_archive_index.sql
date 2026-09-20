-- ============================================================================
-- Migration: Add 3-tier data split (train/validation/test) and access logging
-- Date: 2026-09-20
-- Database: dev-kc-battle-index
-- ============================================================================

-- 1. Add split column to archived_files and block_indexes
ALTER TABLE archived_files ADD COLUMN split TEXT NOT NULL DEFAULT 'train';
ALTER TABLE block_indexes ADD COLUMN split TEXT NOT NULL DEFAULT 'train';

-- 2. Index for filtering by split
CREATE INDEX IF NOT EXISTS idx_block_split_period_table
  ON block_indexes(split, period_tag, table_name, table_version, start_timestamp);

-- 3. Audit log table for tracking access to validation/test datasets
CREATE TABLE IF NOT EXISTS dataset_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  period_tag TEXT NOT NULL,
  split TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  accessed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dataset_access_log_audit
  ON dataset_access_log(user_id, split, accessed_at);