-- Migration: Add schema_version column to archived_files and block_indexes
-- Date: 2025-12-25
-- Purpose: Track schema version (v1/v2) in archival tables for future compatibility

-- Add schema_version to archived_files
ALTER TABLE archived_files ADD COLUMN schema_version TEXT NOT NULL DEFAULT 'v1';

-- Create index for schema_version queries on archived_files
CREATE INDEX IF NOT EXISTS idx_archived_schema 
    ON archived_files (schema_version, period_tag);

-- Add schema_version to block_indexes
ALTER TABLE block_indexes ADD COLUMN schema_version TEXT NOT NULL DEFAULT 'v1';

-- Drop old index and create new composite index with schema_version
DROP INDEX IF EXISTS idx_block_search;
CREATE INDEX IF NOT EXISTS idx_block_search 
    ON block_indexes (dataset_id, table_name, schema_version, start_timestamp, end_timestamp);
