use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::air_base::{AirBase, AirBases, PlaneInfo};
use std::collections::HashMap;

use crate::InterfaceWrapper;

impl From<Vec<kcapi_main::api_get_member::mapinfo::ApiAirBase>> for InterfaceWrapper<AirBases> {
    fn from(bases: Vec<kcapi_main::api_get_member::mapinfo::ApiAirBase>) -> Self {
        let mut base_list = HashMap::new();
        for base in bases {
            base_list.insert(
                ((base.api_area_id << 16) | base.api_rid).to_string(),
                InterfaceWrapper::<AirBase>::from(base).unwrap(),
            );
        }
        Self(AirBases { bases: base_list })
    }
}

impl From<kcapi_main::api_get_member::mapinfo::ApiAirBase> for InterfaceWrapper<AirBase> {
    fn from(base: kcapi_main::api_get_member::mapinfo::ApiAirBase) -> Self {
        Self(AirBase {
            rid: base.api_rid,
            action_kind: base.api_action_kind,
            area_id: base.api_area_id,
            name: base.api_name,
            distance: base.api_distance.api_base + base.api_distance.api_bonus,
            plane_info: base
                .api_plane_info
                .into_iter()
                .map(|info| InterfaceWrapper::<PlaneInfo>::from(info).unwrap())
                .collect(),
        })
    }
}

impl From<kcapi_main::api_get_member::mapinfo::ApiPlaneInfo> for InterfaceWrapper<PlaneInfo> {
    fn from(info: kcapi_main::api_get_member::mapinfo::ApiPlaneInfo) -> Self {
        Self(PlaneInfo {
            cond: info.api_cond,
            state: info.api_state,
            max_count: info.api_max_count,
            count: info.api_count,
            slotid: info.api_slotid,
            squadron_id: info.api_squadron_id,
        })
    }
}
