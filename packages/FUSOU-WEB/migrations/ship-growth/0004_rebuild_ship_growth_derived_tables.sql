-- ============================================================================
-- Migration: Rebuild ship-growth derived tables with period-aware keys
-- Date: 2026-04-09
-- Purpose:
--   - Prevent cross-period/table_version overwrites in derived ship-growth tables
--   - Materialize per-level exp increments in addition to cumulative exp_current
-- ============================================================================

PRAGMA foreign_keys = OFF;

ALTER TABLE ship_level_exp_pairs RENAME TO ship_level_exp_pairs_old;
ALTER TABLE ship_growth_bounds RENAME TO ship_growth_bounds_old;
ALTER TABLE ship_growth_caps RENAME TO ship_growth_caps_old;

CREATE TABLE ship_level_exp_pairs (
  period_tag        TEXT NOT NULL,
  table_version     TEXT NOT NULL,
  lv                INTEGER NOT NULL,
  exp_current       INTEGER NOT NULL,
  exp_prev_current  INTEGER,
  exp_increment     INTEGER,
  PRIMARY KEY (period_tag, table_version, lv)
);
CREATE INDEX IF NOT EXISTS idx_sgexp_lv
  ON ship_level_exp_pairs(lv);

WITH legacy_exp AS (
  SELECT
    old.period_tag AS period_tag,
    COALESCE(
      (
        SELECT ev.table_version
        FROM ship_growth_ingest_events ev
        WHERE ev.period_tag = old.period_tag
        ORDER BY ev.created_at DESC, ev.id DESC
        LIMIT 1
      ),
      'legacy'
    ) AS table_version,
    old.lv AS lv,
    old.exp_current AS exp_current
  FROM ship_level_exp_pairs_old old
),
deduped_exp AS (
  SELECT period_tag, table_version, lv, MAX(exp_current) AS exp_current
  FROM legacy_exp
  GROUP BY period_tag, table_version, lv
)
INSERT INTO ship_level_exp_pairs (
  period_tag,
  table_version,
  lv,
  exp_current,
  exp_prev_current,
  exp_increment
)
SELECT
  period_tag,
  table_version,
  lv,
  exp_current,
  LAG(exp_current) OVER (PARTITION BY period_tag, table_version ORDER BY lv) AS exp_prev_current,
  CASE
    WHEN LAG(exp_current) OVER (PARTITION BY period_tag, table_version ORDER BY lv) IS NULL THEN exp_current
    ELSE exp_current - LAG(exp_current) OVER (PARTITION BY period_tag, table_version ORDER BY lv)
  END AS exp_increment
FROM deduped_exp;

CREATE TABLE ship_growth_bounds (
  period_tag      TEXT NOT NULL,
  table_version   TEXT NOT NULL,
  master_id       INTEGER NOT NULL,
  lv              INTEGER NOT NULL,
  kaihi_naked     INTEGER NOT NULL,
  taisen_naked    INTEGER NOT NULL,
  sakuteki_naked  INTEGER NOT NULL,
  PRIMARY KEY (period_tag, table_version, master_id, lv)
);
CREATE INDEX IF NOT EXISTS idx_sgbounds_master_lv
  ON ship_growth_bounds(master_id, lv);
CREATE INDEX IF NOT EXISTS idx_sgbounds_period_version
  ON ship_growth_bounds(period_tag, table_version, master_id, lv);

INSERT INTO ship_growth_bounds (
  period_tag,
  table_version,
  master_id,
  lv,
  kaihi_naked,
  taisen_naked,
  sakuteki_naked
)
SELECT
  old.period_tag,
  COALESCE(
    (
      SELECT ev.table_version
      FROM ship_growth_ingest_events ev
      WHERE ev.period_tag = old.period_tag
      ORDER BY ev.created_at DESC, ev.id DESC
      LIMIT 1
    ),
    old.table_version,
    'legacy'
  ) AS table_version,
  old.master_id,
  old.lv,
  old.kaihi_naked,
  old.taisen_naked,
  old.sakuteki_naked
FROM ship_growth_bounds_old old;

CREATE TABLE ship_growth_caps (
  period_tag      TEXT NOT NULL,
  table_version   TEXT NOT NULL,
  master_id       INTEGER NOT NULL,
  kaihi_max       INTEGER NOT NULL,
  taisen_max      INTEGER NOT NULL,
  sakuteki_max    INTEGER NOT NULL,
  PRIMARY KEY (period_tag, table_version, master_id)
);
CREATE INDEX IF NOT EXISTS idx_sgcaps_master
  ON ship_growth_caps(master_id);
CREATE INDEX IF NOT EXISTS idx_sgcaps_period_version
  ON ship_growth_caps(period_tag, table_version, master_id);

INSERT INTO ship_growth_caps (
  period_tag,
  table_version,
  master_id,
  kaihi_max,
  taisen_max,
  sakuteki_max
)
SELECT
  old.period_tag,
  COALESCE(
    (
      SELECT ev.table_version
      FROM ship_growth_ingest_events ev
      WHERE ev.period_tag = old.period_tag
      ORDER BY ev.created_at DESC, ev.id DESC
      LIMIT 1
    ),
    old.table_version,
    'legacy'
  ) AS table_version,
  old.master_id,
  old.kaihi_max,
  old.taisen_max,
  old.sakuteki_max
FROM ship_growth_caps_old old;

DROP TABLE ship_level_exp_pairs_old;
DROP TABLE ship_growth_bounds_old;
DROP TABLE ship_growth_caps_old;

PRAGMA foreign_keys = ON;