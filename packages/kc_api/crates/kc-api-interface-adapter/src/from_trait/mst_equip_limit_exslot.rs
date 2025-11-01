use crate::InterfaceWrapper;
use kc_api_dto::main as kcapi_main;
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
                    ship_id,
                    InterfaceWrapper::<MstEquipLimitExslot>::from(equip).unwrap(),
                )
            })
            .collect::<HashMap<i64, MstEquipLimitExslot>>();

        Self(MstEquipLimitExslots {
            mst_equip_limit_exslots: equip_limit_map,
        })
    }
}

impl From<Vec<i64>> for InterfaceWrapper<MstEquipLimitExslot> {
    fn from(equip: Vec<i64>) -> Self {
        Self(MstEquipLimitExslot { equip })
    }
}
