use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use chrono::Local;

use crate::kcapi_common;
use crate::kcapi_main;

use super::battle::calc_air_damage;
use super::battle::{AirDamage, Battle};

use serde::{Deserialize, Serialize};

pub static KCS_CELLS_INDEX: Lazy<Mutex<Vec<i64>>> = Lazy::new(|| Mutex::new(Vec::new()));
pub static KCS_CELLS: Lazy<Mutex<Cells>> = Lazy::new(|| {
    Mutex::new(Cells {
        maparea_id: 0,
        mapinfo_no: 0,
        bosscell_no: 0,
        bosscomp: 0,
        cells: HashMap::new(),
        cell_index: Vec::new(),
        event_map: None,
        cell_data: Vec::new(),
        battles: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize)]
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

impl Cells {
    pub fn load() -> Self {
        let cells = KCS_CELLS.lock().unwrap();
        cells.clone()
    }

    pub fn restore(&self) {
        let mut cells = KCS_CELLS.lock().unwrap();
        *cells = self.clone();
    }

    pub fn reset() {
        let mut cells = KCS_CELLS.lock().unwrap();
        cells.cells.clear();
        cells.cell_index.clear();
        cells.event_map = None;
        cells.cell_data.clear();
        cells.battles.clear();
        cells.maparea_id = 0;
        cells.mapinfo_no = 0;
        cells.bosscell_no = 0;
        cells.bosscomp = 0;
    }

    pub fn reset_flag() -> bool {
        let cells = KCS_CELLS.lock().unwrap();
        return cells.maparea_id == 0
            && cells.mapinfo_no == 0
            && cells.bosscell_no == 0
            && cells.bosscomp == 0
            && cells.cells.is_empty()
            && cells.cell_index.is_empty()
            && cells.event_map.is_none()
            && cells.cell_data.is_empty()
            && cells.battles.is_empty();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

impl Cell {
    pub fn add_or(&self) {
        let mut cells = KCS_CELLS.lock().unwrap();
        cells.cells.insert(self.no, self.clone());
        cells.cell_index.push(self.no);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellData {
    pub id: i64,
    pub no: i64,
    pub color_no: i64,
    pub passed: i64,
    pub distance: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Eventmap {
    pub max_maphp: i64,
    pub now_maphp: i64,
    pub dmg: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Happening {
    // type: i64,
    pub count: i64,
    // usemst: i64,
    pub mst_id: i64,
    // icon_id: i64,
    pub dentan: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EDeckInfo {
    pub kind: i64,
    pub ship_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub f_total_damages: Option<Vec<i64>>,
    pub e_total_damages: Option<Vec<i64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AirBaseAttack {
    pub air_superiority: Option<i64>,
    pub plane_from: Vec<Option<Vec<i64>>>,
    pub f_damage: AirDamage,
    pub e_damage: AirDamage,
    pub stage_flag: Vec<i64>,
    pub map_squadron_plane: Option<HashMap<String, Vec<i64>>>,
}

impl From<kcapi_main::api_req_map::next::ApiAirBaseAttack> for AirBaseAttack {
    fn from(air_base_attack: kcapi_main::api_req_map::next::ApiAirBaseAttack) -> Self {
        // let (f_damage, e_damage) = TupledAirStages(Some(air_base_attack.api_plane_from.clone()), air_base_attack.api_stage1.clone(), air_base_attack.api_stage2.clone(), air_base_attack.api_stage3.clone(), None).into();
        let (f_damage, e_damage) = calc_air_damage(
            Some(air_base_attack.api_plane_from.clone()),
            air_base_attack.api_stage1.clone(),
            air_base_attack.api_stage2.clone(),
            air_base_attack.api_stage3.clone(),
            None,
        );

        Self {
            air_superiority: air_base_attack
                .api_stage1
                .clone()
                .and_then(|stage1| stage1.api_disp_seiku),
            plane_from: air_base_attack.api_plane_from,
            f_damage,
            e_damage,
            stage_flag: air_base_attack.api_stage_flag,
            map_squadron_plane: air_base_attack.api_map_squadron_plane.map(|map_plane| {
                map_plane
                    .iter()
                    .map(|(k, v)| {
                        (
                            k.clone(),
                            v.iter().map(|plane| plane.api_mst_id).collect::<Vec<i64>>(),
                        )
                    })
                    .collect::<HashMap<String, Vec<i64>>>()
            }),
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

impl From<kcapi_main::api_req_map::next::ApiDestructionBattle> for DestructionBattle {
    fn from(destruction_battle: kcapi_main::api_req_map::next::ApiDestructionBattle) -> Self {
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
            f_total_damages: None,
            e_total_damages: None,
        }
    }
}

impl From<kcapi_main::api_req_map::next::ApiData> for Cell {
    fn from(cells: kcapi_main::api_req_map::next::ApiData) -> Self {
        let enemy_deck_info: Option<Vec<EDeckInfo>> = cells.api_e_deck_info.map(|e_deck_info| {
            e_deck_info
                .into_iter()
                .map(|e_deck_info| e_deck_info.into())
                .collect()
        });

        // let happening: Option<Happening> = cells.api_happening.map(|happening| happening.into());
        let happening: Option<Happening> = cells.api_happening.map(|happening| happening.into());

        let destruction_battle: Option<DestructionBattle> =
            cells.api_destruction_battle.map(|destruction_battle| {
                let mut destruction_battle: DestructionBattle = destruction_battle.into();
                calc_dmg(&mut destruction_battle);
                destruction_battle
            });

        {
            KCS_CELLS_INDEX.lock().unwrap().push(cells.api_no);
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
            destruction_battle,
            happening,
        }
    }
}

impl From<kcapi_main::api_req_map::start::ApiCellData> for CellData {
    fn from(cell_data: kcapi_main::api_req_map::start::ApiCellData) -> Self {
        Self {
            id: cell_data.api_id,
            no: cell_data.api_no,
            color_no: cell_data.api_color_no,
            passed: cell_data.api_passed,
            distance: cell_data.api_distance,
        }
    }
}

impl From<kcapi_main::api_req_map::start::ApiData> for Cell {
    fn from(cells: kcapi_main::api_req_map::start::ApiData) -> Self {
        let enemy_deck_info: Option<Vec<EDeckInfo>> = cells.api_e_deck_info.map(|e_deck_info| {
            e_deck_info
                .into_iter()
                .map(|e_deck_info| e_deck_info.into())
                .collect()
        });

        {
            KCS_CELLS_INDEX.lock().unwrap().push(cells.api_no);
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

impl From<kcapi_main::api_req_map::start::ApiData> for Cells {
    fn from(cells: kcapi_main::api_req_map::start::ApiData) -> Self {
        let cell: Cell = cells.clone().into();
        let cell_data: Vec<CellData> = cells
            .api_cell_data
            .into_iter()
            .map(|cell_data| cell_data.into())
            .collect();

        Self {
            maparea_id: cells.api_maparea_id,
            mapinfo_no: cells.api_mapinfo_no,
            bosscell_no: cells.api_bosscell_no,
            bosscomp: cells.api_bosscomp,
            cells: vec![(cell.no, cell.clone())].into_iter().collect(),
            cell_index: vec![cell.no],
            event_map: cells.api_eventmap.map(|eventmap| eventmap.into()),
            cell_data,
            battles: HashMap::new(),
        }
    }
}

pub fn calc_dmg(destruction_battle: &mut DestructionBattle) {
    let mut f_total_damages: Vec<i64> = vec![0; 6];
    let mut e_total_damages: Vec<i64> = vec![0; 6];

    let f_nowhps: Vec<i64> = destruction_battle.f_nowhps.clone();
    let e_nowhps: Vec<i64> = destruction_battle.e_nowhps.clone();

    f_nowhps.iter().enumerate().for_each(|(idx, &f_nowhp)| {
        destruction_battle.air_base_attack.f_damage.now_hps[idx] = f_nowhp - f_total_damages[idx];
    });

    e_nowhps.iter().enumerate().for_each(|(idx, &e_nowhp)| {
        destruction_battle.air_base_attack.e_damage.now_hps[idx] = e_nowhp - e_total_damages[idx];
    });

    destruction_battle
        .air_base_attack
        .f_damage
        .damages
        .clone()
        .unwrap_or(vec![0_f32; 0])
        .iter()
        .enumerate()
        .for_each(|(idx, &x)| {
            f_total_damages[idx] += x as i64;
        });

    destruction_battle
        .air_base_attack
        .e_damage
        .damages
        .clone()
        .unwrap_or(vec![0_f32; 0])
        .iter()
        .enumerate()
        .for_each(|(idx, &x)| {
            e_total_damages[idx] += x as i64;
        });

    destruction_battle.f_total_damages = Some(f_total_damages);
    destruction_battle.e_total_damages = Some(e_total_damages);
}
