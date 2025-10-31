use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstMaparea>> for MstMapAreas {
    fn from(map_areas: Vec<kcapi_main::api_start2::get_data::ApiMstMaparea>) -> Self {
        let mut map_area_map = HashMap::<i64, MstMapArea>::with_capacity(map_areas.len());
        // let mut ship_map = HashMap::new();
        for map_area in map_areas {
            map_area_map.insert(map_area.api_id, map_area.into());
        }
        Self {
            mst_map_areas: map_area_map,
        }
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstMaparea> for MstMapArea {
    fn from(map_info: kcapi_main::api_start2::get_data::ApiMstMaparea) -> Self {
        Self {
            api_id: map_info.api_id,
            api_name: map_info.api_name,
            api_type: map_info.api_type,
        }
    }
}
