-- ============================================================================
-- Migration: Add table_version to master_data tables
-- Database: dev_kc_master_data_index
-- Date: 2026-02-17
-- Purpose: Support multi-version master data coexistence
-- ============================================================================
-- NOTE: UNIQUE constraint change deferred to a separate migration (0003)
--       because D1 has foreign_keys=ON and table recreation would cascade-delete
--       master_data_tables rows via ON DELETE CASCADE. Current UNIQUE(period_tag)
--       is MORE restrictive than UNIQUE(period_tag, table_version), so app code
--       will still work correctly.
-- ============================================================================

-- Step 1: Add table_version column to master_data_index
-- Default '0.4' for existing data (pre-versioning era)
ALTER TABLE master_data_index ADD COLUMN table_version TEXT NOT NULL DEFAULT '0.4';

-- Step 2: Add index on table_version for master_data_index
CREATE INDEX idx_master_data_by_version
  ON master_data_index(table_version);

-- Step 3: Add table_version column to master_data_tables
ALTER TABLE master_data_tables ADD COLUMN table_version TEXT NOT NULL DEFAULT '0.4';

-- Step 4: Add index on table_version for master_data_tables
CREATE INDEX idx_master_data_tables_by_version
  ON master_data_tables(table_version);
