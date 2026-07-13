-- ============================================================================
-- Migration: Add tier/window metadata columns for multi-tier compaction
-- Date: 2026-07-11
-- Database: dev-kc-battle-index
-- ============================================================================

ALTER TABLE archived_files ADD COLUMN compaction_tier TEXT NOT NULL DEFAULT 'hourly';
ALTER TABLE archived_files ADD COLUMN window_start_ms INTEGER;
ALTER TABLE archived_files ADD COLUMN window_end_ms INTEGER;
ALTER TABLE archived_files ADD COLUMN source_tier TEXT;

ALTER TABLE block_indexes ADD COLUMN compaction_tier TEXT NOT NULL DEFAULT 'hourly';
ALTER TABLE block_indexes ADD COLUMN window_start_ms INTEGER;
ALTER TABLE block_indexes ADD COLUMN window_end_ms INTEGER;
ALTER TABLE block_indexes ADD COLUMN source_file_count INTEGER NOT NULL DEFAULT 1;

CREATE INDEX idx_block_tier_period_table
  ON block_indexes(compaction_tier, period_tag, table_name, table_version, start_timestamp);
