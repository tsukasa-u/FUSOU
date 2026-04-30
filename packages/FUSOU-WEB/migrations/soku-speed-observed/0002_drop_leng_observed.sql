-- ============================================================================
-- Migration: Remove leng_observed column from soku_speed_observations
-- Date: 2026-04-29
-- Reason: Range (leng) bonuses are fully computable from game client code via
--         SlotItemEffectUtil (leng is in STAT_KEYS of equip_synergy_detector).
--         Collecting the value from the live API added no information beyond
--         what can be derived, so the column is removed.
-- Method: SQLite does not support DROP COLUMN for NOT NULL columns; recreate
--         the table without leng_observed, preserving all other data.
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
	PRIMARY KEY (master_id, slots_json)
);

INSERT INTO soku_speed_observations_new
	(period_tag, master_id, lv, soku_observed, slots_json, exslot_json, table_version, updated_at)
	SELECT period_tag, master_id, lv, soku_observed, slots_json, exslot_json, table_version, updated_at
	FROM soku_speed_observations;

DROP TABLE soku_speed_observations;

ALTER TABLE soku_speed_observations_new RENAME TO soku_speed_observations;

CREATE INDEX idx_slo_master ON soku_speed_observations(master_id);
CREATE INDEX idx_slo_updated_at ON soku_speed_observations(updated_at);

PRAGMA foreign_keys = ON;