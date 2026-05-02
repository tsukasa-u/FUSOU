-- ============================================================================
-- Migration: Initialize soku_speed_observed DB tables
-- Date: 2026-04-29
-- Purpose: Collect observed speed (soku) and range (leng) class data
--          from actual gameplay with equipped slot compositions.
--          Separate DB from ship_growth to isolate data domains.
-- ============================================================================

-- Ingest event log: one row per upload request (deduplication anchor).
CREATE TABLE IF NOT EXISTS soku_speed_ingest_events (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	request_id    TEXT    NOT NULL,
	payload_hash  TEXT    NOT NULL,
	dataset_id    TEXT    NOT NULL,
	period_tag    TEXT    NOT NULL,
	table_version TEXT    NOT NULL,
	created_at    INTEGER NOT NULL,
	UNIQUE(request_id, payload_hash)
);
CREATE INDEX IF NOT EXISTS idx_slobj_ingest_dataset_period
	ON soku_speed_ingest_events(dataset_id, period_tag);

-- Core observation table: best-known (soku, leng) per ship + slot composition.
-- PRIMARY KEY uniqueness is on (master_id, slots_hash) so the same ship with
-- the same equip set is only recorded once; a new upload for the same key
-- replaces the existing row via INSERT OR REPLACE.
CREATE TABLE IF NOT EXISTS soku_speed_observations (
	period_tag    TEXT    NOT NULL,
	master_id     INTEGER NOT NULL,
	lv            INTEGER NOT NULL,
	soku_observed INTEGER NOT NULL,
	leng_observed INTEGER NOT NULL,
	slots_json    TEXT    NOT NULL,
	exslot_json   TEXT,
	table_version TEXT    NOT NULL,
	updated_at    INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (master_id, slots_json)
);
CREATE INDEX IF NOT EXISTS idx_slo_master
	ON soku_speed_observations(master_id);
CREATE INDEX IF NOT EXISTS idx_slo_updated_at
	ON soku_speed_observations(updated_at);