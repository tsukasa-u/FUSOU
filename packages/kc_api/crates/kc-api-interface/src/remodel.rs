use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;

// --- Req コンテキスト保持 (FIFO キュー) ---

/// remodel_slotlist_detail の Req コンテキスト: (slotitem_master_id, remodel_id)
/// Req と Res は別 tokio::spawn で処理されるため、VecDeque で順序を保証する。
pub static PENDING_DETAIL_REQ: Lazy<Mutex<VecDeque<(i64, i64)>>> =
    Lazy::new(|| Mutex::new(VecDeque::new()));

/// PENDING_DETAIL_REQ の最大長。超過時は古いエントリを破棄する。
pub const PENDING_DETAIL_REQ_CAP: usize = 64;

// --- remodel_slotlist: 改修条件一覧（秘書艦×曜日 → 利用可能レシピ） ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemodelSlotListEntry {
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
pub struct RemodelSlotList {
    pub secretary_ship_master_id: i64,
    pub weekday_jst: i64,
    pub entries: Vec<RemodelSlotListEntry>,
}

// --- remodel_slotlist_detail: 確実改修コスト + 特殊消費アイテム ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemodelDetail {
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
