use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use super::battle::{AirDamage, Battle};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "cells.ts")]
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
        cells.maparea_id == 0
            && cells.mapinfo_no == 0
            && cells.bosscell_no == 0
            && cells.bosscomp == 0
            && cells.cells.is_empty()
            && cells.cell_index.is_empty()
            && cells.event_map.is_none()
            && cells.cell_data.is_empty()
            && cells.battles.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "cells.ts")]
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "cells.ts")]
pub struct CellData {
    pub id: i64,
    pub no: i64,
    pub color_no: i64,
    pub passed: i64,
    pub distance: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "cells.ts")]
pub struct Eventmap {
    pub max_maphp: i64,
    pub now_maphp: i64,
    pub dmg: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "cells.ts")]
pub struct Happening {
    // type: i64,
    pub count: i64,
    // usemst: i64,
    pub mst_id: i64,
    // icon_id: i64,
    pub dentan: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "cells.ts")]
pub struct EDeckInfo {
    pub kind: i64,
    pub ship_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "cells.ts")]
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "cells.ts")]
pub struct AirBaseAttack {
    pub air_superiority: Option<i64>,
    pub plane_from: Vec<Option<Vec<i64>>>,
    pub f_damage: AirDamage,
    pub e_damage: AirDamage,
    pub stage_flag: Vec<i64>,
    pub map_squadron_plane: Option<HashMap<String, Vec<i64>>>,
}
