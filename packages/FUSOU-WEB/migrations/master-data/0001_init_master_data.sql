-- ============================================================================
-- Migration: Initialize master_data_index database schema
-- Database: dev_kc_master_data_index
-- Date: 2026-04-27
-- Purpose: Create initial tables for master data indexing
-- ============================================================================

-- Master Data Index - Track periods and revisions
CREATE TABLE IF NOT EXISTS master_data_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_tag TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  r2_keys TEXT,
  table_offsets TEXT,
  table_count INTEGER,
  upload_status TEXT DEFAULT 'pending',
  uploaded_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(period_tag)
);

CREATE INDEX IF NOT EXISTS idx_master_data_by_period 
  ON master_data_index(period_tag);
CREATE INDEX IF NOT EXISTS idx_master_data_by_status_created 
  ON master_data_index(upload_status, created_at);

-- Master Data Tables - Track individual tables per period
CREATE TABLE IF NOT EXISTS master_data_tables (
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
  FOREIGN KEY (master_data_id) REFERENCES master_data_index(id) ON DELETE CASCADE,
  UNIQUE(master_data_id, table_name)
);

CREATE INDEX IF NOT EXISTS idx_master_data_tables_by_name 
  ON master_data_tables(table_name);
CREATE INDEX IF NOT EXISTS idx_master_data_tables_by_period_and_name 
  ON master_data_tables(master_data_id, table_name);
