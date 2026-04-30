-- ============================================================================
-- Migration: Add index on (period_tag, table_version) for speed-upgrade reads
-- Date: 2026-04-30
-- Reason: GET /speed-upgrade filters WHERE period_tag = ? AND table_version = ?
--         which requires a full table scan without this index.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_slo_period_table
	ON soku_speed_observations(period_tag, table_version);