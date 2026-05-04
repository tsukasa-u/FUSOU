-- ============================================================================
-- Migration: Add quest master entries table
-- Database: dev_kc_battle_index
-- Date: 2026-04-07
-- Purpose:
--   - Persist quest master metadata (title/detail and static fields)
--   - Update only on content change via master_hash
-- ============================================================================

CREATE TABLE IF NOT EXISTS quest_master_entries (
  quest_id INTEGER NOT NULL,
  period_tag TEXT NOT NULL,
  table_version TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  quest_type INTEGER NOT NULL,
  category INTEGER NOT NULL,
  label_type INTEGER NOT NULL,
  master_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (quest_id, period_tag, table_version)
);

CREATE INDEX IF NOT EXISTS idx_qmaster_period_table
  ON quest_master_entries(period_tag, table_version, quest_id);
