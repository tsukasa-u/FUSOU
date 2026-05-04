-- ============================================================================
-- Migration: Add unique constraint to quest_collection_sessions
-- Database: dev_kc_battle_index
-- Date: 2026-04-12
-- Purpose:
--   Prevent duplicate sessions from being created for the same dataset at the
--   same millisecond timestamp due to concurrent requests (TOCTOU race).
--
--   With this index in place, the application code uses INSERT OR IGNORE and
--   re-queries for the canonically winning session when changes = 0.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_qsess_dataset_started_unique
  ON quest_collection_sessions(dataset_id, started_at_ms);
