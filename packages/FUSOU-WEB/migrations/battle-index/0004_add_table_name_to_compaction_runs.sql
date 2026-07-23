-- ============================================================================
-- Migration: Add table_name to compaction_runs for per-table period completion
-- Date: 2026-07-12
-- Database: dev-kc-battle-index
-- ============================================================================

ALTER TABLE compaction_runs ADD COLUMN table_name TEXT;

CREATE INDEX idx_compaction_runs_table_tier_period_status
  ON compaction_runs(table_name, tier, period_tag, status);
