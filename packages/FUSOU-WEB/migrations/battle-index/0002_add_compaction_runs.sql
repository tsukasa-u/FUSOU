-- ============================================================================
-- Migration: Add compaction_runs table (battle-index)
-- Date: 2026-07-11
-- Purpose: Persist Trigger.dev compaction run state for idempotency/retry
-- ============================================================================

CREATE TABLE compaction_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_key TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL,
  status TEXT NOT NULL,
  period_tag TEXT NOT NULL,
  window_start_ms INTEGER NOT NULL,
  window_end_ms INTEGER NOT NULL,
  triggered_by TEXT NOT NULL,
  source_tier TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  error_message TEXT
);

CREATE INDEX idx_compaction_runs_status_created
  ON compaction_runs(status, created_at_ms DESC);

CREATE INDEX idx_compaction_runs_tier_period_window
  ON compaction_runs(tier, period_tag, window_start_ms, window_end_ms);
