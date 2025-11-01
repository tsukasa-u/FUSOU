use crate::InterfaceWrapper;
use kc_api_dto::main as kcapi_main;
use kc_api_interface::mst_mapinfo::{MstMapInfo, MstMapInfos};
use std::collections::HashMap;

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstMapinfo>> for InterfaceWrapper<MstMapInfos> {
    fn from(map_infos: Vec<kcapi_main::api_start2::get_data::ApiMstMapinfo>) -> Self {
        let mut map_info_map = HashMap::<i64, MstMapInfo>::with_capacity(map_infos.len());
        for map_info in map_infos {
            map_info_map.insert(
                map_info.api_id,
                InterfaceWrapper::<MstMapInfo>::from(map_info).unwrap(),
            );
        }
        Self(MstMapInfos {
            mst_map_infos: map_info_map,
        })
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstMapinfo> for InterfaceWrapper<MstMapInfo> {
    fn from(map_info: kcapi_main::api_start2::get_data::ApiMstMapinfo) -> Self {
        Self(MstMapInfo {
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
        })
    }
}
