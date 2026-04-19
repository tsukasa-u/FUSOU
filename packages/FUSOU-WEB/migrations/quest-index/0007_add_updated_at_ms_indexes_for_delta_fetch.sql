-- ============================================================================
-- Migration: Add updated_at_ms indexes for quest delta fetch
-- Date: 2026-04-19
-- Purpose:
--   Optimize updated_at_ms watermark queries used by /quest-tree/rules and
--   /quest-tree/graph delta snapshot refresh.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_qruleedge_target_period_updated
  ON quest_rule_edges(target_quest_id, period_tag, table_version, updated_at_ms);

CREATE INDEX IF NOT EXISTS idx_qruleedge_period_updated
  ON quest_rule_edges(period_tag, table_version, updated_at_ms);
