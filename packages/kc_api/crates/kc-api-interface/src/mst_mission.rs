use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

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

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstMission {
    pub id: i32,
    pub disp_no: String,
    pub maparea_id: i32,
    pub name: String,
    pub time: i64,
    pub reset_type: i64,
    pub return_flag: i64,
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

    /// Returns true if `mission_id` represents a KanColle support expedition
    /// (World 5 `33`/`34` or Event `S1`/`S2` support missions).
    ///
    /// In KanColle `api_mst_mission`, support expeditions are uniquely
    /// characterized by `api_return_flag == 0` (cannot be recalled), whereas
    /// all regular expeditions (including `15: 囮機動部隊支援作戦`) have
    /// `api_return_flag == 1`. Falls back to permanent World 5 support IDs
    /// (`33`, `34`) when master data has not been loaded yet.
    pub fn is_support_mission(&self, mission_id: i64) -> bool {
        if mission_id <= 0 {
            return false;
        }
        if let Ok(id) = i32::try_from(mission_id) {
            if let Some(mst) = self.mst_missions.get(&id) {
                return mst.return_flag == 0;
            }
        }
        matches!(mission_id, 33 | 34)
    }
}
