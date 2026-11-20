use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub(crate) static KCS_MST_MISSIONS: Lazy<Mutex<MstMissions>> = Lazy::new(|| {
    Mutex::new(MstMissions {
        mst_missions: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstMissions {
    pub mst_missions: HashMap<i32, MstMission>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstMission {
    pub id: i32,
    pub disp_no: String,
    pub maparea_id: i32,
    pub name: String,
    pub time: i64,
    pub reset_type: i64,
}

impl MstMissions {
    pub fn load() -> Self {
        let mission_map = KCS_MST_MISSIONS.lock().unwrap();
        mission_map.clone()
    }

    pub fn restore(&self) {
        let mut mission_map = KCS_MST_MISSIONS.lock().unwrap();
        *mission_map = self.clone();
    }
}
