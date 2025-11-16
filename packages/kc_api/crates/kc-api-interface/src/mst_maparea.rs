use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

pub(crate) static KCS_MST_MAP_AREA: Lazy<Mutex<MstMapAreas>> = Lazy::new(|| {
    Mutex::new(MstMapAreas {
        mst_map_areas: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstMapAreas {
    pub mst_map_areas: HashMap<i32, MstMapArea>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstMapArea {
    pub api_id: i32,
    pub api_name: String,
    pub api_type: i32,
}

impl MstMapAreas {
    pub fn load() -> Self {
        let map_info_map = KCS_MST_MAP_AREA.lock().unwrap();
        map_info_map.clone()
    }

    pub fn restore(&self) {
        let mut map_info_map = KCS_MST_MAP_AREA.lock().unwrap();
        *map_info_map = self.clone();
    }
}
