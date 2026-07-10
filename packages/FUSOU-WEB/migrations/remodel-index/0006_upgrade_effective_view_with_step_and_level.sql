DROP VIEW IF EXISTS remodel_slotlist_effective_requirements;

CREATE VIEW IF NOT EXISTS remodel_slotlist_effective_requirements AS
SELECT
  s.dataset_id,
  s.period_tag,
  s.table_version,
  s.secretary_ship_master_id,
  s.weekday_jst,
  s.slotitem_master_id,
  s.remodel_id,
  s.remodel_step_id,
  COALESCE(s.remodel_step_id, s.remodel_id) AS effective_remodel_step_id,
  s.remodel_level,
  s.remodel_level AS effective_remodel_level,
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
  ON d.dataset_id = s.dataset_id
  AND d.period_tag = s.period_tag
  AND d.table_version = s.table_version
  AND d.slotitem_master_id = s.slotitem_master_id
  AND d.remodel_level = s.remodel_level;
