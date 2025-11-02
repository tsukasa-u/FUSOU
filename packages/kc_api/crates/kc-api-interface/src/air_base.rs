use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;
use ts_rs::TS;

use serde::{Deserialize, Serialize};

pub static KCS_AIR_BASE: Lazy<Mutex<AirBases>> = Lazy::new(|| {
    Mutex::new(AirBases {
        bases: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "map_info.ts")]
pub struct AirBases {
    pub bases: HashMap<String, AirBase>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "map_info.ts")]
pub struct AirBase {
    pub rid: i64,
    pub action_kind: i64,
    pub area_id: i64,
    pub name: String,
    pub distance: i64,
    pub plane_info: Vec<PlaneInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "map_info.ts")]
pub struct PlaneInfo {
    pub cond: Option<i64>,
    pub state: i64,
    pub max_count: Option<i64>,
    pub count: Option<i64>,
    pub slotid: i64,
    pub squadron_id: i64,
}

impl AirBases {
    pub fn load() -> Self {
        let bases = KCS_AIR_BASE.lock().unwrap();
        bases.clone()
    }

    pub fn restore(&self) {
        let mut bases = KCS_AIR_BASE.lock().unwrap();
        *bases = self.clone();
    }
}
