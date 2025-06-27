use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};

use register_trait::TraitForEncode;

pub(crate) static KCS_MST_MAP_INFO: Lazy<Mutex<MstMapInfos>> = Lazy::new(|| {
    Mutex::new(MstMapInfos {
        mst_map_infos: HashMap::new(),
    })
});

use crate::kcapi_main;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MstMapInfos {
    pub mst_map_infos: HashMap<i64, MstMapInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode)]
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

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstMapinfo>> for MstMapInfos {
    fn from(map_infos: Vec<kcapi_main::api_start2::get_data::ApiMstMapinfo>) -> Self {
        let mut map_info_map = HashMap::<i64, MstMapInfo>::with_capacity(map_infos.len());
        // let mut ship_map = HashMap::new();
        for map_info in map_infos {
            map_info_map.insert(map_info.api_id, map_info.into());
        }
        Self {
            mst_map_infos: map_info_map,
        }
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstMapinfo> for MstMapInfo {
    fn from(map_info: kcapi_main::api_start2::get_data::ApiMstMapinfo) -> Self {
        Self {
            id: map_info.api_id,
            maparea_id: map_info.api_maparea_id,
            no: map_info.api_no,
            name: map_info.api_name,
            level: map_info.api_level,
            opetext: map_info.api_opetext,
            infotext: map_info.api_infotext,
            item: map_info.api_item,
            max_maphp: map_info.api_max_maphp,
            required_defeat_count: map_info.api_required_defeat_count,
            sally_flag: map_info.api_sally_flag,
        }
    }
}
