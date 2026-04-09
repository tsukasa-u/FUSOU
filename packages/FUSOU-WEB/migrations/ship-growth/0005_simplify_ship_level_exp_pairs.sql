-- ============================================================================
-- Migration: Simplify ship_level_exp_pairs to exp_current only
-- Date: 2026-04-09
-- Purpose:
--   - Remove unused exp_prev_current / exp_increment columns
--   - Keep only one exp value per level boundary
-- ============================================================================

PRAGMA foreign_keys = OFF;

ALTER TABLE ship_level_exp_pairs RENAME TO ship_level_exp_pairs_old2;

CREATE TABLE ship_level_exp_pairs (
  period_tag        TEXT NOT NULL,
  table_version     TEXT NOT NULL,
  lv                INTEGER NOT NULL,
  exp_current       INTEGER NOT NULL,
  PRIMARY KEY (period_tag, table_version, lv)
);
CREATE INDEX IF NOT EXISTS idx_sgexp_lv
  ON ship_level_exp_pairs(lv);

INSERT INTO ship_level_exp_pairs (
  period_tag,
  table_version,
  lv,
  exp_current
)
SELECT
  period_tag,
  table_version,
  lv,
  exp_current
FROM ship_level_exp_pairs_old2;

DROP TABLE ship_level_exp_pairs_old2;

PRAGMA foreign_keys = ON;
