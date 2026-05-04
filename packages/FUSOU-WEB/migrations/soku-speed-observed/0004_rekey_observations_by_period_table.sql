-- ============================================================================
-- Migration: Re-key soku_speed_observations by period/table + ship + slots
-- Date: 2026-05-01
-- Reason: Avoid cross-period overwrite when the same ship+slot composition
--         appears in different master-data periods.
-- ============================================================================

PRAGMA foreign_keys = OFF;

CREATE TABLE soku_speed_observations_new (
  period_tag    TEXT    NOT NULL,
  master_id     INTEGER NOT NULL,
  lv            INTEGER NOT NULL,
  soku_observed INTEGER NOT NULL,
  slots_json    TEXT    NOT NULL,
  exslot_json   TEXT,
  table_version TEXT    NOT NULL,
  updated_at    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (period_tag, table_version, master_id, slots_json)
);

INSERT INTO soku_speed_observations_new
  (period_tag, table_version, master_id, lv, soku_observed, slots_json, exslot_json, updated_at)
  SELECT period_tag, table_version, master_id, lv, soku_observed, slots_json, exslot_json, updated_at
  FROM soku_speed_observations;

DROP TABLE soku_speed_observations;

ALTER TABLE soku_speed_observations_new RENAME TO soku_speed_observations;

CREATE INDEX IF NOT EXISTS idx_slo_master
  ON soku_speed_observations(master_id);
CREATE INDEX IF NOT EXISTS idx_slo_updated_at
  ON soku_speed_observations(updated_at);
CREATE INDEX IF NOT EXISTS idx_slo_period_table
  ON soku_speed_observations(period_tag, table_version);

PRAGMA foreign_keys = ON;
