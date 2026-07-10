-- Enforce the requested key basis: secretary/weekday/remodel_level/slotitem.
-- Keep existing remodel_id/remodel_step_id columns for compatibility during migration.

CREATE UNIQUE INDEX IF NOT EXISTS uq_rslot_level_key
ON remodel_slotlist_entries (
  dataset_id,
  period_tag,
  table_version,
  secretary_ship_master_id,
  weekday_jst,
  slotitem_master_id,
  remodel_level
)
WHERE remodel_level IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rdetail_level_key
ON remodel_detail_entries (
  dataset_id,
  period_tag,
  table_version,
  slotitem_master_id,
  remodel_level
)
WHERE remodel_level IS NOT NULL;

-- Hard-stop inserts/updates that do not provide a valid remodel_level key.
CREATE TRIGGER IF NOT EXISTS trg_rslot_require_level_insert
BEFORE INSERT ON remodel_slotlist_entries
FOR EACH ROW
WHEN NEW.remodel_level IS NULL OR NEW.remodel_level < 0 OR NEW.remodel_level > 10
BEGIN
  SELECT RAISE(ABORT, 'remodel_slotlist_entries.remodel_level must be 0..10');
END;

CREATE TRIGGER IF NOT EXISTS trg_rslot_require_level_update
BEFORE UPDATE ON remodel_slotlist_entries
FOR EACH ROW
WHEN NEW.remodel_level IS NULL OR NEW.remodel_level < 0 OR NEW.remodel_level > 10
BEGIN
  SELECT RAISE(ABORT, 'remodel_slotlist_entries.remodel_level must be 0..10');
END;

CREATE TRIGGER IF NOT EXISTS trg_rdetail_require_level_insert
BEFORE INSERT ON remodel_detail_entries
FOR EACH ROW
WHEN NEW.remodel_level IS NULL OR NEW.remodel_level < 0 OR NEW.remodel_level > 10
BEGIN
  SELECT RAISE(ABORT, 'remodel_detail_entries.remodel_level must be 0..10');
END;

CREATE TRIGGER IF NOT EXISTS trg_rdetail_require_level_update
BEFORE UPDATE ON remodel_detail_entries
FOR EACH ROW
WHEN NEW.remodel_level IS NULL OR NEW.remodel_level < 0 OR NEW.remodel_level > 10
BEGIN
  SELECT RAISE(ABORT, 'remodel_detail_entries.remodel_level must be 0..10');
END;
