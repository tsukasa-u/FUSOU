use std::collections::HashMap;

use chrono::Local;

use crate::kcapi;
use crate::kcapi_common;

use std::sync::{LazyLock, Mutex};

use super::battle::{AirDamage, Battle, TupledAirStages};

// Is it better to use onecell::sync::Lazy or std::sync::Lazy?
pub static KCS_CELLS: LazyLock<Mutex<Vec<i64>>> = LazyLock::new(|| {
    Mutex::new(Vec::new())
});

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Cells {
    pub maparea_id: i64,
    pub mapinfo_no: i64,
    pub bosscell_no: i64,
    pub bosscomp: i64,
    pub cells: HashMap<i64, Cell>,
    pub cell_index: Vec<i64>,
    pub event_map: Option<Eventmap>,
    pub cell_data: Vec<CellData>,
    pub battles: HashMap<i64, Battle>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Cell {
    pub timestamp: Option<i64>,
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
pub struct CellData {
    pub id: i64,
    pub no: i64,
    pub color_no: i64,
    pub passed: i64,
    pub distance: Option<i64>,
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
    pub count: i64,
    // usemst: i64,
    pub mst_id: i64,
    // icon_id: i64,
    pub dentan: i64,
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
    pub ship_lv: Vec<i64>,
    pub e_nowhps: Vec<i64>,
    pub e_maxhps: Vec<i64>,
    pub e_slot: Vec<Vec<i64>>,
    pub f_nowhps: Vec<i64>,
    pub f_maxhps: Vec<i64>,
    // Need to implement 
    pub air_base_attack: AirBaseAttack,
    pub lost_kind: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AirBaseAttack {
    pub plane_from: Vec<Option<Vec<i64>>>,
    pub f_damage: AirDamage,
    pub e_damage: AirDamage,
    pub stage_flag: Vec<i64>,
    pub map_squadron_plane: Option<HashMap<String, Vec<i64>>>,
}

impl From<kcapi::api_req_map::next::ApiAirBaseAttack> for AirBaseAttack {
    fn from(air_base_attack: kcapi::api_req_map::next::ApiAirBaseAttack) -> Self {
        let (f_damage, e_damage) = TupledAirStages(Some(air_base_attack.api_plane_from.clone()), air_base_attack.api_stage1.clone(), air_base_attack.api_stage2.clone(), air_base_attack.api_stage3.clone(), None).into();
        Self {
            plane_from: air_base_attack.api_plane_from,
            f_damage: f_damage,
            e_damage: e_damage,
            stage_flag: air_base_attack.api_stage_flag,
            map_squadron_plane: air_base_attack.api_map_squadron_plane.and_then(|map_plane| Some(map_plane.iter().map(|(k, v)| (k.clone(), v.iter().map(|plane| plane.api_mst_id).collect::<Vec<i64>>())).collect::<HashMap<String, Vec<i64>>>())),
        }
    }
}

impl From<kcapi_common::common_map::ApiEDeckInfo> for EDeckInfo {
    fn from(e_deck_info: kcapi_common::common_map::ApiEDeckInfo) -> Self {
        Self {
            kind: e_deck_info.api_kind,
            ship_ids: e_deck_info.api_ship_ids,
        }
    }
}

impl From<kcapi_common::common_map::ApiEventmap> for Eventmap {
    fn from(eventmap: kcapi_common::common_map::ApiEventmap) -> Self {
        Self {
            max_maphp: eventmap.api_max_maphp,
            now_maphp: eventmap.api_now_maphp,
            dmg: eventmap.api_dmg,
        }
    }
}

impl From<kcapi_common::common_map::ApiHappening> for Happening {
    fn from(happening: kcapi_common::common_map::ApiHappening) -> Self {
        Self {
            count: happening.api_count,
            mst_id: happening.api_mst_id,
            dentan: happening.api_dentan,
        }
    }
}

impl From<kcapi::api_req_map::next::ApiDestructionBattle> for DestructionBattle {
    fn from(destruction_battle: kcapi::api_req_map::next::ApiDestructionBattle) -> Self {
        Self {
            formation: destruction_battle.api_formation,
            ship_lv: destruction_battle.api_ship_lv,
            ship_ke: destruction_battle.api_ship_ke,
            e_nowhps: destruction_battle.api_e_nowhps,
            e_maxhps: destruction_battle.api_e_maxhps,
            e_slot: destruction_battle.api_e_slot,
            f_nowhps: destruction_battle.api_f_nowhps,
            f_maxhps: destruction_battle.api_f_maxhps,
            air_base_attack: destruction_battle.api_air_base_attack.into(),
            lost_kind: destruction_battle.api_lost_kind,
        }
    }
}

impl From<kcapi::api_req_map::next::ApiData> for Cell {
    fn from(cells: kcapi::api_req_map::next::ApiData) -> Self {
        
        let enemy_deck_info: Option<Vec<EDeckInfo>> = match cells.api_e_deck_info {
            Some(e_deck_info) => Some(e_deck_info.into_iter().map(|e_deck_info| e_deck_info.into()).collect()),
            None => None,
        };
        
        let happening: Option<Happening> = match cells.api_happening {
            Some(happening) => Some(happening.into()),
            None => None,
        };

        let destruction_battle: Option<DestructionBattle> = match cells.api_destruction_battle {
            Some(destruction_battle) => Some(destruction_battle.into()),
            None => None,
        };

        {
           KCS_CELLS.lock().unwrap().push(cells.api_no.clone());
        }

        Self {
            timestamp: Some(Local::now().timestamp()),
            rashin_id: cells.api_rashin_id,
            no: cells.api_no,
            color_no: cells.api_color_no,
            event_id: cells.api_event_id,
            event_kind: cells.api_event_kind,
            next: cells.api_next,
            e_deck_info: enemy_deck_info,
            limit_state: cells.api_limit_state,
            m1: cells.api_m1,
            destruction_battle: destruction_battle,
            happening: happening,
        }
    }
}

impl From<kcapi::api_req_map::start::ApiCellData> for CellData {
    fn from(cell_data: kcapi::api_req_map::start::ApiCellData) -> Self {
        Self {
            id: cell_data.api_id,
            no: cell_data.api_no,
            color_no: cell_data.api_color_no,
            passed: cell_data.api_passed,
            distance: cell_data.api_distance,
        }
    }
}

impl From<kcapi::api_req_map::start::ApiData> for Cell {
    fn from(cells: kcapi::api_req_map::start::ApiData) -> Self {
        
        let enemy_deck_info: Option<Vec<EDeckInfo>> = match cells.api_e_deck_info {
            Some(e_deck_info) => Some(e_deck_info.into_iter().map(|e_deck_info| e_deck_info.into()).collect()),
            None => None,
        };

        {
            KCS_CELLS.lock().unwrap().push(cells.api_no.clone());
        }

        Self {
            timestamp: Some(Local::now().timestamp()),
            rashin_id: cells.api_rashin_id,
            no: cells.api_no,
            color_no: cells.api_color_no,
            event_id: cells.api_event_id,
            event_kind: cells.api_event_kind,
            next: cells.api_next,
            e_deck_info: enemy_deck_info,
            limit_state: cells.api_limit_state,
            m1: None,
            destruction_battle: None,
            happening: None,
        }
    }
}


impl From<kcapi::api_req_map::start::ApiData> for Cells {
    fn from(cells: kcapi::api_req_map::start::ApiData) -> Self {
        
        let cell: Cell = cells.clone().into();
        let cell_data: Vec<CellData> = cells.api_cell_data.into_iter().map(|cell_data| cell_data.into()).collect();

        Self {
            maparea_id: cells.api_maparea_id,
            mapinfo_no: cells.api_mapinfo_no,
            bosscell_no: cells.api_bosscell_no,
            bosscomp: cells.api_bosscomp,
            cells: vec![(cell.no.clone(), cell.clone())].into_iter().collect(),
            cell_index: vec![cell.no],
            event_map: cells.api_eventmap.map(|eventmap| eventmap.into()),
            cell_data: cell_data,
            battles: HashMap::new(),
        }
    }
}
