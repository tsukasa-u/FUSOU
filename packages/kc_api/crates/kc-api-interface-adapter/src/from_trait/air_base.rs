use kc_api_dto::main as kcapi_main;
use kc_api_interface::air_base::AirBases;
use std::collections::HashMap;

impl From<Vec<kcapi_main::api_get_member::mapinfo::ApiAirBase>> for AirBases {
    fn from(bases: Vec<kcapi_main::api_get_member::mapinfo::ApiAirBase>) -> Self {
        let mut base_list = HashMap::new();
        for base in bases {
            base_list.insert(
                ((base.api_area_id << 16) | base.api_rid).to_string(),
                base.into(),
            );
        }
        Self { bases: base_list }
    }
}

impl From<kcapi_main::api_get_member::mapinfo::ApiAirBase> for AirBase {
    fn from(base: kcapi_main::api_get_member::mapinfo::ApiAirBase) -> Self {
        Self {
            rid: base.api_rid,
            action_kind: base.api_action_kind,
            area_id: base.api_area_id,
            name: base.api_name,
            distance: base.api_distance.api_base + base.api_distance.api_bonus,
            plane_info: base
                .api_plane_info
                .into_iter()
                .map(|info| info.into())
                .collect(),
        }
    }
}

impl From<kcapi_main::api_get_member::mapinfo::ApiPlaneInfo> for PlaneInfo {
    fn from(info: kcapi_main::api_get_member::mapinfo::ApiPlaneInfo) -> Self {
        Self {
            cond: info.api_cond,
            state: info.api_state,
            max_count: info.api_max_count,
            count: info.api_count,
            slotid: info.api_slotid,
            squadron_id: info.api_squadron_id,
        }
    }
}
