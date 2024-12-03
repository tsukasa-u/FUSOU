use std::collections::HashMap;

use serde_json::Value;

use crate::{kcapi, kcapi_common};

use std::sync::{LazyLock, Mutex};

// // Is it better to use onecell::sync::Lazy or std::sync::Lazy?
// pub static KCS_CELLS: LazyLock<Mutex<Battles>> = LazyLock::new(|| {
//     Mutex::new( Battles::new())
// });

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Cells {
    pub maparea_id: i64,
    pub mapinfo_no: i64,
    pub bosscell_no: i64,
    pub bosscomp: i64,
    pub cells: HashMap<String, Cell>,
    pub event_map: Option<Eventmap>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Cell {
    pub rashin_id: i64,
    pub no: i64,
    pub color_no: i64,
    pub event_id: i64,
    pub event_kind: i64,
    pub next: i64,
    // pub event_id: i64,
    // pub event_kind: i64,
    // pub airsearch: Airsearch,
    // pub comment_kind: Option<i64>,
    // pub production_kind: Option<i64>,
    pub e_deck_info: Option<Vec<EDeckInfo>>,
    pub limit_state: i64,
    // pub ration_flag: Option<i64>,
    // pub select_route: Option<SelectRoute>,
    // pub itemget: Option<Vec<Itemget>>,
    pub m1: Option<i64>,
    pub destruction_battle: Option<DestructionBattle>,
    pub happening: Option<Happening>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Eventmap {
    pub max_maphp: i64,
    pub now_maphp: i64,
    pub dmg: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Happening {
    // type: i64,
    count: i64,
    // usemst: i64,
    mst_id: i64,
    // icon_id: i64,
    dentan: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EDeckInfo {
    pub kind: i64,
    pub ship_ids: Vec<i64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DestructionBattle {
    pub formation: Vec<i64>,
    pub ship_ke: Vec<i64>,
    // pub ship_lv: Vec<i64>,
    pub e_nowhps: Vec<i64>,
    pub e_maxhps: Vec<i64>,
    pub e_slot: Vec<Vec<i64>>,
    pub f_nowhps: Vec<i64>,
    pub f_maxhps: Vec<i64>,
    // Need to implement 
    // pub air_base_attack: ApiAirBaseAttack,
    // pub lost_kind: i64,
}
