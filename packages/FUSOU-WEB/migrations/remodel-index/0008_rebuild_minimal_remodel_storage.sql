-- Development-stage schema reset for minimal storage.
-- Keep only data required for remodel lookup keys and costs.

DROP VIEW IF EXISTS remodel_slotlist_effective_requirements;

DROP TRIGGER IF EXISTS trg_rslot_require_level_insert;
DROP TRIGGER IF EXISTS trg_rslot_require_level_update;
DROP TRIGGER IF EXISTS trg_rdetail_require_level_insert;
DROP TRIGGER IF EXISTS trg_rdetail_require_level_update;

DROP INDEX IF EXISTS uq_rslot_level_key;
DROP INDEX IF EXISTS uq_rdetail_level_key;
DROP INDEX IF EXISTS idx_rslot_secretary_weekday;
DROP INDEX IF EXISTS idx_rslot_item_step;
DROP INDEX IF EXISTS idx_rdetail_item_step;

DROP TABLE IF EXISTS remodel_slotlist_entries;
DROP TABLE IF EXISTS remodel_detail_entries;

CREATE TABLE remodel_slotlist_entries (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  period_tag                  TEXT    NOT NULL,
  secretary_ship_master_id    INTEGER NOT NULL,
  weekday_jst                 INTEGER NOT NULL,
  slotitem_master_id          INTEGER NOT NULL,
  remodel_level               INTEGER NOT NULL CHECK(remodel_level BETWEEN 0 AND 10),
  remodel_id                  INTEGER NOT NULL,
  remodel_step_id             INTEGER NOT NULL,
  sp_type                     INTEGER NOT NULL DEFAULT 0,
  req_fuel                    INTEGER NOT NULL DEFAULT 0,
  req_bull                    INTEGER NOT NULL DEFAULT 0,
  req_steel                   INTEGER NOT NULL DEFAULT 0,
  req_bauxite                 INTEGER NOT NULL DEFAULT 0,
  req_buildkit                INTEGER NOT NULL DEFAULT 0,
  req_remodelkit              INTEGER NOT NULL DEFAULT 0,
  req_slot_id                 INTEGER NOT NULL DEFAULT 0,
  req_slot_num                INTEGER NOT NULL DEFAULT 0,
  updated_at_ms               INTEGER NOT NULL,
  UNIQUE(period_tag, secretary_ship_master_id, weekday_jst, slotitem_master_id, remodel_level)
);

CREATE INDEX idx_rslot_secretary_weekday
  ON remodel_slotlist_entries(period_tag, secretary_ship_master_id, weekday_jst, slotitem_master_id, remodel_level);

CREATE INDEX idx_rslot_item_level
  ON remodel_slotlist_entries(period_tag, slotitem_master_id, remodel_level);

CREATE TABLE remodel_detail_entries (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  period_tag                  TEXT    NOT NULL,
  slotitem_master_id          INTEGER NOT NULL,
  remodel_level               INTEGER NOT NULL CHECK(remodel_level BETWEEN 0 AND 10),
  remodel_id                  INTEGER NOT NULL,
  remodel_step_id             INTEGER NOT NULL,
  certain_buildkit            INTEGER NOT NULL,
  certain_remodelkit          INTEGER NOT NULL,
  change_flag                 INTEGER NOT NULL DEFAULT 0,
  req_slot_id                 INTEGER,
  req_slot_num                INTEGER,
  req_useitem_id              INTEGER,
  req_useitem_id2             INTEGER,
  req_useitem_num             INTEGER,
  req_useitem_num2            INTEGER,
  updated_at_ms               INTEGER NOT NULL,
  UNIQUE(period_tag, slotitem_master_id, remodel_level)
);

CREATE INDEX idx_rdetail_item_level
  ON remodel_detail_entries(period_tag, slotitem_master_id, remodel_level);

CREATE VIEW remodel_slotlist_effective_requirements AS
SELECT
  s.period_tag,
  s.secretary_ship_master_id,
  s.weekday_jst,
  s.slotitem_master_id,
  s.remodel_level,
  s.remodel_id,
  s.remodel_step_id,
  s.sp_type,
  s.req_fuel,
  s.req_bull,
  s.req_steel,
  s.req_bauxite,
  s.req_buildkit,
  s.req_remodelkit,
  s.req_slot_id AS raw_req_slot_id,
  s.req_slot_num AS raw_req_slot_num,
  d.req_slot_id AS detail_req_slot_id,
  d.req_slot_num AS detail_req_slot_num,
  CASE
    WHEN (s.req_slot_id = 0 OR s.req_slot_num = 0)
      AND d.req_slot_id IS NOT NULL
      AND d.req_slot_num IS NOT NULL
      THEN d.req_slot_id
    ELSE s.req_slot_id
  END AS effective_req_slot_id,
  CASE
    WHEN (s.req_slot_id = 0 OR s.req_slot_num = 0)
      AND d.req_slot_id IS NOT NULL
      AND d.req_slot_num IS NOT NULL
      THEN d.req_slot_num
    ELSE s.req_slot_num
  END AS effective_req_slot_num,
  CASE
    WHEN (s.req_slot_id = 0 OR s.req_slot_num = 0)
      AND d.req_slot_id IS NOT NULL
      AND d.req_slot_num IS NOT NULL
      THEN 'detail'
    WHEN s.req_slot_id = 0 OR s.req_slot_num = 0
      THEN 'fallback_zero'
    ELSE 'slotlist'
  END AS req_slot_source,
  s.updated_at_ms
FROM remodel_slotlist_entries AS s
LEFT JOIN remodel_detail_entries AS d
  ON d.period_tag = s.period_tag
  AND d.slotitem_master_id = s.slotitem_master_id
  AND d.remodel_level = s.remodel_level;
