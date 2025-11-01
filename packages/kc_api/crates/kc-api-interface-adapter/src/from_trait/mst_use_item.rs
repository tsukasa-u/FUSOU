use crate::InterfaceWrapper;
use kc_api_dto::main as kcapi_main;
use kc_api_interface::mst_use_item::{MstUseItem, MstUseItems};
use std::collections::HashMap;

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstUseitem>> for InterfaceWrapper<MstUseItems> {
    fn from(use_items: Vec<kcapi_main::api_start2::get_data::ApiMstUseitem>) -> Self {
        let mut item_map = HashMap::<i64, MstUseItem>::with_capacity(use_items.len());
        for use_item in use_items {
            item_map.insert(
                use_item.api_id,
                InterfaceWrapper::<MstUseItem>::from(use_item).unwrap(),
            );
        }
        Self(MstUseItems {
            mst_use_items: item_map,
        })
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstUseitem> for InterfaceWrapper<MstUseItem> {
    fn from(use_item: kcapi_main::api_start2::get_data::ApiMstUseitem) -> Self {
        Self(MstUseItem {
            id: use_item.api_id,
            name: use_item.api_name,
        })
    }
}
