use crate::InterfaceWrapper;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::mst_slot_item_equip_type::{MstSlotItemEquipType, MstSlotItemEquipTypes};
use std::collections::HashMap;

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstSlotitemEquiptype>>
    for InterfaceWrapper<MstSlotItemEquipTypes>
{
    fn from(equip_types: Vec<kcapi_main::api_start2::get_data::ApiMstSlotitemEquiptype>) -> Self {
        let mut equip_type_map =
            HashMap::<i32, MstSlotItemEquipType>::with_capacity(equip_types.len());
        for equip_type in equip_types {
            equip_type_map.insert(
                equip_type.api_id as i32,
                InterfaceWrapper::<MstSlotItemEquipType>::from(equip_type).unwrap(),
            );
        }
        Self(MstSlotItemEquipTypes {
            mst_slotitem_equip_types: equip_type_map,
        })
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstSlotitemEquiptype>
    for InterfaceWrapper<MstSlotItemEquipType>
{
    fn from(equip_type: kcapi_main::api_start2::get_data::ApiMstSlotitemEquiptype) -> Self {
        Self(MstSlotItemEquipType {
            id: equip_type.api_id as i32,
            name: equip_type.api_name,
        })
    }
}
