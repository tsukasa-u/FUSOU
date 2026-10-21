-- ============================================================================
-- Migration: Add composite indexes for dataset_id-filtered and global queries
-- Date: 2026-10-21
-- Database: dev-kc-battle-index / kc-battle-index
-- ============================================================================

-- 1. Composite index for per-user (dataset_id) filtered queries and /detail anchor lookups
CREATE INDEX IF NOT EXISTS idx_block_indexes_dataset_table_time
  ON block_indexes(dataset_id, table_name, period_tag, start_timestamp DESC);

-- 2. Composite index for single-SQL global queries across all compaction tiers
CREATE INDEX IF NOT EXISTS idx_block_indexes_global_time
  ON block_indexes(table_name, table_version, period_tag, start_timestamp DESC, compaction_tier);