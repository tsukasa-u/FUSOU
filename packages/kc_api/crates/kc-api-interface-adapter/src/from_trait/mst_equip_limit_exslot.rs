use crate::InterfaceWrapper;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::mst_equip_limit_exslot::{MstEquipLimitExslot, MstEquipLimitExslots};
use std::collections::HashMap;

impl From<kcapi_main::api_start2::get_data::ApiData> for InterfaceWrapper<MstEquipLimitExslots> {
    fn from(data: kcapi_main::api_start2::get_data::ApiData) -> Self {
        let equip_limit_map = data
            .api_mst_equip_limit_exslot
            .unwrap_or_default()
            .into_iter()
            .map(|(ship_id, equip)| {
                (
                    ship_id as i32,
                    InterfaceWrapper::<MstEquipLimitExslot>::from((ship_id, equip)).unwrap(),
                )
            })
            .collect::<HashMap<i32, MstEquipLimitExslot>>();

        Self(MstEquipLimitExslots {
            mst_equip_limit_exslots: equip_limit_map,
        })
    }
}

impl From<(i64, Vec<i64>)> for InterfaceWrapper<MstEquipLimitExslot> {
    fn from((ship_id, equip): (i64, Vec<i64>)) -> Self {
        Self(MstEquipLimitExslot {
            ship_id: ship_id as i32,
            equip: equip.into_iter().map(|value| value as i32).collect(),
        })
    }
}


