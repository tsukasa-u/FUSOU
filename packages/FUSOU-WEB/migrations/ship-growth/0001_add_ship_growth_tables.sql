-- ============================================================================
-- Migration: Add ship-growth tables to SHIP_GROWTH_DB
-- Date: 2026-04-08
-- ============================================================================

CREATE TABLE IF NOT EXISTS ship_growth_ingest_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id      TEXT NOT NULL,
  payload_hash    TEXT NOT NULL,
  dataset_id      TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  period_tag      TEXT NOT NULL,
  table_version   TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE(request_id, payload_hash)
);
CREATE INDEX IF NOT EXISTS idx_sgingest_dataset_period
  ON ship_growth_ingest_events(dataset_id, period_tag);

CREATE TABLE IF NOT EXISTS ship_level_exp_pairs (
  period_tag    TEXT NOT NULL,
  lv            INTEGER NOT NULL,
  exp_current   INTEGER NOT NULL,
  PRIMARY KEY (lv)
);

CREATE TABLE IF NOT EXISTS ship_growth_bounds (
  period_tag      TEXT NOT NULL,
  master_id       INTEGER NOT NULL,
  lv              INTEGER NOT NULL,
  kaihi_naked     INTEGER NOT NULL,
  taisen_naked    INTEGER NOT NULL,
  sakuteki_naked  INTEGER NOT NULL,
  table_version   TEXT NOT NULL,
  PRIMARY KEY (master_id, lv)
);
CREATE INDEX IF NOT EXISTS idx_sgbounds_master_lv
  ON ship_growth_bounds(master_id, lv);

CREATE TABLE IF NOT EXISTS ship_growth_caps (
  period_tag      TEXT NOT NULL,
  master_id       INTEGER NOT NULL,
  kaihi_max       INTEGER NOT NULL,
  taisen_max      INTEGER NOT NULL,
  sakuteki_max    INTEGER NOT NULL,
  table_version   TEXT NOT NULL,
  PRIMARY KEY (master_id)
);
CREATE INDEX IF NOT EXISTS idx_sgcaps_master
  ON ship_growth_caps(master_id);

CREATE TABLE IF NOT EXISTS ship_growth_archive (
  period_tag_old      TEXT NOT NULL,
  period_tag_new      TEXT NOT NULL,
  master_id           INTEGER NOT NULL,
  lv                  INTEGER NOT NULL,
  kaihi_naked_old     INTEGER,
  taisen_naked_old    INTEGER,
  sakuteki_naked_old  INTEGER,
  kaihi_max_old       INTEGER,
  taisen_max_old      INTEGER,
  sakuteki_max_old    INTEGER,
  archived_at         INTEGER NOT NULL,
  PRIMARY KEY (period_tag_old, master_id, lv)
);
CREATE INDEX IF NOT EXISTS idx_sgarchive_period_old
  ON ship_growth_archive(period_tag_old, master_id);
