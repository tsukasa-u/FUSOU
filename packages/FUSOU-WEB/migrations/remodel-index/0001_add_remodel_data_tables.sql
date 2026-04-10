-- 改修条件一覧（remodel_slotlist から — 秘書艦×曜日→利用可能レシピ）
-- 改修ツリーの backbone。通常改修コストの正本。
CREATE TABLE IF NOT EXISTS remodel_slotlist_entries (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id                  TEXT    NOT NULL,
    period_tag                  TEXT    NOT NULL,
    table_version               TEXT    NOT NULL,
    secretary_ship_master_id    INTEGER NOT NULL,
    weekday_jst                 INTEGER NOT NULL,  -- 0=月, 6=日
    remodel_id                  INTEGER NOT NULL,
    slotitem_master_id          INTEGER NOT NULL,
    sp_type                     INTEGER NOT NULL DEFAULT 0,
    req_fuel                    INTEGER NOT NULL DEFAULT 0,
    req_bull                    INTEGER NOT NULL DEFAULT 0,
    req_steel                   INTEGER NOT NULL DEFAULT 0,
    req_bauxite                 INTEGER NOT NULL DEFAULT 0,
    req_buildkit                INTEGER NOT NULL DEFAULT 0,
    req_remodelkit              INTEGER NOT NULL DEFAULT 0,
    req_slot_id                 INTEGER NOT NULL DEFAULT 0,
    req_slot_num                INTEGER NOT NULL DEFAULT 0,
    UNIQUE(dataset_id, secretary_ship_master_id, weekday_jst, slotitem_master_id, remodel_id)
);
CREATE INDEX IF NOT EXISTS idx_rslot_secretary_weekday
    ON remodel_slotlist_entries(secretary_ship_master_id, weekday_jst, slotitem_master_id, remodel_id);
CREATE INDEX IF NOT EXISTS idx_rslot_item_step
    ON remodel_slotlist_entries(slotitem_master_id, remodel_id);

-- 改修詳細コスト（remodel_slotlist_detail から）
-- 確実改修固有コスト + 特殊消費アイテムのみ。
-- 通常改修コスト（req_buildkit/remodelkit, req_slot_id/num）は slotlist_entries と同値のため省略。
-- secretary_ship_master_id, weekday_jst もコストに影響しないため slotlist 側のみで保持。
CREATE TABLE IF NOT EXISTS remodel_detail_entries (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    dataset_id                  TEXT    NOT NULL,
    period_tag                  TEXT    NOT NULL,
    table_version               TEXT    NOT NULL,
    slotitem_master_id          INTEGER NOT NULL,
    remodel_id                  INTEGER NOT NULL,
    certain_buildkit            INTEGER NOT NULL,
    certain_remodelkit          INTEGER NOT NULL,
    change_flag                 INTEGER NOT NULL DEFAULT 0,
    req_useitem_id              INTEGER,
    req_useitem_id2             INTEGER,
    req_useitem_num             INTEGER,
    req_useitem_num2            INTEGER,
    UNIQUE(dataset_id, slotitem_master_id, remodel_id)
);
CREATE INDEX IF NOT EXISTS idx_rdetail_item_step
    ON remodel_detail_entries(slotitem_master_id, remodel_id);
