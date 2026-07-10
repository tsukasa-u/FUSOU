use serde::{Deserialize, Serialize};

// --- slotlist 一覧（バルクアップロード） ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemodelSlotListEntryUpload {
    pub remodel_id: i64,
    pub remodel_step_id: i64,
    pub remodel_level: Option<i64>,
    pub slotitem_master_id: i64,
    pub sp_type: i64,
    pub req_fuel: i64,
    pub req_bull: i64,
    pub req_steel: i64,
    pub req_bauxite: i64,
    pub req_buildkit: i64,
    pub req_remodelkit: i64,
    pub req_slot_id: i64,
    pub req_slot_num: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemodelSlotListUpload {
    pub secretary_ship_master_id: i64,
    pub weekday_jst: i64,
    pub entries: Vec<RemodelSlotListEntryUpload>,
}

// --- detail（確実改修固有コスト + 特殊消費のみ） ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemodelDetailUpload {
    pub slotitem_master_id: i64,
    pub remodel_id: i64,
    pub remodel_step_id: i64,
    pub remodel_level: Option<i64>,
    pub certain_buildkit: i64,
    pub certain_remodelkit: i64,
    pub req_slot_id: i64,
    pub req_slot_num: i64,
    pub change_flag: i64,
    pub req_useitem_id: Option<i64>,
    pub req_useitem_id2: Option<i64>,
    pub req_useitem_num: Option<i64>,
    pub req_useitem_num2: Option<i64>,
}

// --- From trait ---

impl From<kc_api_interface::remodel::RemodelSlotList> for RemodelSlotListUpload {
    fn from(v: kc_api_interface::remodel::RemodelSlotList) -> Self {
        Self {
            secretary_ship_master_id: v.secretary_ship_master_id,
            weekday_jst: v.weekday_jst,
            entries: v
                .entries
                .into_iter()
                .map(|e| RemodelSlotListEntryUpload {
                    remodel_id: e.remodel_id,
                    remodel_step_id: e.remodel_step_id,
                    remodel_level: e.remodel_level,
                    slotitem_master_id: e.slotitem_master_id,
                    sp_type: e.sp_type,
                    req_fuel: e.req_fuel,
                    req_bull: e.req_bull,
                    req_steel: e.req_steel,
                    req_bauxite: e.req_bauxite,
                    req_buildkit: e.req_buildkit,
                    req_remodelkit: e.req_remodelkit,
                    req_slot_id: e.req_slot_id,
                    req_slot_num: e.req_slot_num,
                })
                .collect(),
        }
    }
}

impl From<kc_api_interface::remodel::RemodelDetail> for RemodelDetailUpload {
    fn from(v: kc_api_interface::remodel::RemodelDetail) -> Self {
        Self {
            slotitem_master_id: v.slotitem_master_id,
            remodel_id: v.remodel_id,
            remodel_step_id: v.remodel_step_id,
            remodel_level: v.remodel_level,
            certain_buildkit: v.certain_buildkit,
            certain_remodelkit: v.certain_remodelkit,
            req_slot_id: v.req_slot_id,
            req_slot_num: v.req_slot_num,
            change_flag: v.change_flag,
            req_useitem_id: v.req_useitem_id,
            req_useitem_id2: v.req_useitem_id2,
            req_useitem_num: v.req_useitem_num,
            req_useitem_num2: v.req_useitem_num2,
        }
    }
}
