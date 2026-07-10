ALTER TABLE remodel_slotlist_entries
  ADD COLUMN remodel_step_id INTEGER;

ALTER TABLE remodel_slotlist_entries
  ADD COLUMN remodel_level INTEGER;

ALTER TABLE remodel_detail_entries
  ADD COLUMN remodel_step_id INTEGER;

ALTER TABLE remodel_detail_entries
  ADD COLUMN remodel_level INTEGER;

UPDATE remodel_slotlist_entries
SET remodel_step_id = remodel_id
WHERE remodel_step_id IS NULL;

UPDATE remodel_detail_entries
SET remodel_step_id = remodel_id
WHERE remodel_step_id IS NULL;
