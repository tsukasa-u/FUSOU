-- Migration: Add period_tag to block_indexes for time-bucketed queries
-- Date: 2025-12-26
-- Purpose: Align D1 block_indexes with application schema

-- Add period_tag column (default to 'latest' for existing rows)
ALTER TABLE block_indexes ADD COLUMN period_tag TEXT NOT NULL DEFAULT 'latest';

-- Rebuild composite index to include period_tag and schema_version
DROP INDEX IF EXISTS idx_block_dataset_table_ts;
CREATE INDEX IF NOT EXISTS idx_block_dataset_table_ts
  ON block_indexes(dataset_id, table_name, schema_version, period_tag, start_timestamp, end_timestamp);
