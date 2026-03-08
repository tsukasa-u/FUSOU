-- ============================================================================
-- Migration: Rename schema_version → table_version (TiDB buffer_logs)
-- Database: TiDB Cloud Serverless (kc_db)
-- Date: 2026-02-17
-- Purpose: Unify to table_version across all tables
-- ============================================================================

-- Step 1: Rename column
ALTER TABLE buffer_logs CHANGE COLUMN schema_version table_version VARCHAR(20) NOT NULL;

-- Step 2: Drop old index (if exists)
-- Note: Check existing indexes with SHOW INDEX FROM buffer_logs first
-- DROP INDEX idx_buffer_schema_version ON buffer_logs;

-- Step 3: Create new index on table_version
CREATE INDEX idx_buffer_table_version ON buffer_logs (table_version, table_name, period_tag);
