-- ============================================================================
-- Migration: Add updated_at to ship growth derived tables
-- Date: 2026-04-18
-- Purpose: Enable incremental (delta) fetching on GET /exp, /bounds.
--          updated_at is set to the ingest Unix timestamp (ms) on INSERT and
--          updated whenever the stored value changes (i.e. a better observation).
-- ============================================================================

-- ship_level_exp_pairs
ALTER TABLE ship_level_exp_pairs ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_slep_updated_at
  ON ship_level_exp_pairs(updated_at);

-- ship_growth_bounds
ALTER TABLE ship_growth_bounds ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_sgbounds_updated_at
  ON ship_growth_bounds(updated_at);

-- ship_growth_caps
ALTER TABLE ship_growth_caps ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_sgcaps_updated_at
  ON ship_growth_caps(updated_at);
