use crate::InterfaceWrapper;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::mst_mission::{MstMission, MstMissions};
use std::collections::HashMap;

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstMission>> for InterfaceWrapper<MstMissions> {
    fn from(missions: Vec<kcapi_main::api_start2::get_data::ApiMstMission>) -> Self {
        let mut mission_map = HashMap::<i32, MstMission>::with_capacity(missions.len());
        for mission in missions {
            mission_map.insert(
                mission.api_id as i32,
                InterfaceWrapper::<MstMission>::from(mission).unwrap(),
            );
        }
        Self(MstMissions {
            mst_missions: mission_map,
        })
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstMission> for InterfaceWrapper<MstMission> {
    fn from(mission: kcapi_main::api_start2::get_data::ApiMstMission) -> Self {
        Self(MstMission {
            id: mission.api_id as i32,
            disp_no: mission.api_disp_no,
            maparea_id: mission.api_maparea_id as i32,
            name: mission.api_name,
            time: mission.api_time,
            reset_type: mission.api_reset_type,
            return_flag: mission.api_return_flag,
        })
    }
}
