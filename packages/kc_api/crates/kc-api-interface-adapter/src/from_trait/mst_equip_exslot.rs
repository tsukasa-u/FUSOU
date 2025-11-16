use crate::InterfaceWrapper;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::mst_equip_exslot::{MstEquipExslot, MstEquipExslots};
use std::collections::HashMap;

impl From<kcapi_main::api_start2::get_data::ApiData> for InterfaceWrapper<MstEquipExslots> {
    fn from(data: kcapi_main::api_start2::get_data::ApiData) -> Self {
        let equip_exslot_map = data
            .api_mst_equip_exslot
            .iter()
            .copied()
            .enumerate()
            .map(|(idx, equip)| {
                (
                    idx as i32,
                    InterfaceWrapper::<MstEquipExslot>::from(equip).unwrap(),
                )
            })
            .collect::<HashMap<i32, MstEquipExslot>>();

        Self(MstEquipExslots {
            mst_equip_exslots: equip_exslot_map,
        })
    }
}

impl From<i64> for InterfaceWrapper<MstEquipExslot> {
    fn from(equip: i64) -> Self {
        Self(MstEquipExslot { equip: equip as i32 })
    }
}
