use crate::InterfaceWrapper;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::mst_use_item::{MstUseItem, MstUseItemMeta, MstUseItemMetas, MstUseItems};
use std::collections::HashMap;

fn normalize_useitem_description(raw: String) -> String {
    raw.replace("<br />", "\n")
        .replace("<br/>", "\n")
        .replace("<br>", "\n")
}

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstUseitem>> for InterfaceWrapper<MstUseItems> {
    fn from(use_items: Vec<kcapi_main::api_start2::get_data::ApiMstUseitem>) -> Self {
        let mut item_map = HashMap::<i32, MstUseItem>::with_capacity(use_items.len());
        for use_item in use_items {
            item_map.insert(
                use_item.api_id as i32,
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
            id: use_item.api_id as i32,
            name: use_item.api_name,
        })
    }
}

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstUseitem>>
    for InterfaceWrapper<MstUseItemMetas>
{
    fn from(use_items: Vec<kcapi_main::api_start2::get_data::ApiMstUseitem>) -> Self {
        let mut item_map = HashMap::<i32, MstUseItemMeta>::with_capacity(use_items.len());
        for use_item in use_items {
            item_map.insert(
                use_item.api_id as i32,
                InterfaceWrapper::<MstUseItemMeta>::from(use_item).unwrap(),
            );
        }
        Self(MstUseItemMetas {
            mst_use_item_metas: item_map,
        })
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstUseitem> for InterfaceWrapper<MstUseItemMeta> {
    fn from(use_item: kcapi_main::api_start2::get_data::ApiMstUseitem) -> Self {
        Self(MstUseItemMeta {
            id: use_item.api_id as i32,
            usetype: use_item.api_usetype,
            category: use_item.api_category,
            name: use_item.api_name,
            description: use_item
                .api_description
                .into_iter()
                .map(normalize_useitem_description)
                .collect(),
            price: use_item.api_price,
        })
    }
}
