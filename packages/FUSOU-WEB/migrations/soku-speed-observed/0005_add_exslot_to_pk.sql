-- ============================================================================
-- Migration: Add exslot_json to PRIMARY KEY of soku_speed_observations
-- Date: 2026-05-05
-- Reason: The previous PRIMARY KEY (period_tag, table_version, master_id, slots_json)
--         did not include exslot_json. This caused rows with the same main-slot
--         composition but different extra-slot equipment to conflict and overwrite
--         each other, silently losing one observation.
-- Example: Ship A with main=[Turbine, Boiler] exslot=null (soku=15) and
--          Ship A with main=[Turbine, Boiler] exslot=ImprovedBoiler (soku=20)
--          both serialize to the same slots_json → second INSERT clobbered the first.
-- Fix: Make exslot_json NOT NULL DEFAULT '' (empty string = no extra slot equipped)
--      and include it in the PRIMARY KEY.
-- Method: SQLite does not support ALTER COLUMN; recreate the table.
-- ============================================================================

PRAGMA foreign_keys = OFF;

CREATE TABLE soku_speed_observations_new (
  period_tag    TEXT    NOT NULL,
  master_id     INTEGER NOT NULL,
  lv            INTEGER NOT NULL,
  soku_observed INTEGER NOT NULL,
  slots_json    TEXT    NOT NULL,
  exslot_json   TEXT    NOT NULL DEFAULT '',  -- empty string means no extra-slot equipment
  table_version TEXT    NOT NULL,
  updated_at    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (period_tag, table_version, master_id, slots_json, exslot_json)
);

-- Migrate existing data: convert NULL exslot_json to '' (the new sentinel for "no exslot").
INSERT INTO soku_speed_observations_new
  (period_tag, table_version, master_id, lv, soku_observed, slots_json, exslot_json, updated_at)
  SELECT period_tag, table_version, master_id, lv, soku_observed,
         slots_json, COALESCE(exslot_json, ''), updated_at
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
