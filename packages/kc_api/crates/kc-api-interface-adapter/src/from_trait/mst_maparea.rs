use crate::InterfaceWrapper;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::mst_maparea::{MstMapArea, MstMapAreas};
use std::collections::HashMap;

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstMaparea>> for InterfaceWrapper<MstMapAreas> {
    fn from(map_areas: Vec<kcapi_main::api_start2::get_data::ApiMstMaparea>) -> Self {
        let mut map_area_map = HashMap::<i64, MstMapArea>::with_capacity(map_areas.len());
        for map_area in map_areas {
            map_area_map.insert(
                map_area.api_id,
                InterfaceWrapper::<MstMapArea>::from(map_area).unwrap(),
            );
        }
        Self(MstMapAreas {
            mst_map_areas: map_area_map,
        })
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstMaparea> for InterfaceWrapper<MstMapArea> {
    fn from(map_info: kcapi_main::api_start2::get_data::ApiMstMaparea) -> Self {
        Self(MstMapArea {
            api_id: map_info.api_id,
            api_name: map_info.api_name,
            api_type: map_info.api_type,
        })
    }
}
