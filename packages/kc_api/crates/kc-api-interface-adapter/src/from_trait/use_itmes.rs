use crate::InterfaceWrapper;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::use_items::{UseItems, UseItem};
use std::collections::HashMap;

impl From<Vec<kcapi_main::api_get_member::require_info::ApiUseitem>>
    for InterfaceWrapper<UseItems>
{
    fn from(slot_items: Vec<kcapi_main::api_get_member::require_info::ApiUseitem>) -> Self {
        let mut slot_item_map = HashMap::<i64, UseItem>::with_capacity(slot_items.len());
        for slot_item in slot_items {
            slot_item_map.insert(
                slot_item.api_id,
                InterfaceWrapper::<UseItem>::from(slot_item).unwrap(),
            );
        }
        Self(UseItems {
            use_items: slot_item_map,
        })
    }
}

impl From<kcapi_main::api_get_member::require_info::ApiUseitem> for InterfaceWrapper<UseItem> {
    fn from(slot_item: kcapi_main::api_get_member::require_info::ApiUseitem) -> Self {
        Self(UseItem {
            id: slot_item.api_id,
            count: slot_item.api_count,
        })
    }
}
