use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

pub(crate) static KCS_MST_MAP_INFO: Lazy<Mutex<MstMapInfos>> = Lazy::new(|| {
    Mutex::new(MstMapInfos {
        mst_map_infos: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstMapInfos {
    pub mst_map_infos: HashMap<i64, MstMapInfo>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstMapInfo {
    pub id: i64,
    pub maparea_id: i64,
    pub no: i64,
    pub name: String,
    pub level: i64,
    pub opetext: String,
    pub infotext: String,
    pub item: Vec<i64>,
    pub max_maphp: Option<i64>,
    pub required_defeat_count: Option<i64>,
    pub sally_flag: Vec<i64>,
}

impl MstMapInfos {
    pub fn load() -> Self {
        let map_info_map = KCS_MST_MAP_INFO.lock().unwrap();
        map_info_map.clone()
    }

    pub fn restore(&self) {
        let mut map_info_map = KCS_MST_MAP_INFO.lock().unwrap();
        *map_info_map = self.clone();
    }
}
