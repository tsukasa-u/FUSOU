use crate::InterfaceWrapper;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::use_items::{PayItem, PayItems, UseItem, UseItems};
use std::collections::HashMap;

fn normalize_item_description(raw: String) -> String {
    raw.replace("<br />", "\n")
        .replace("<br/>", "\n")
        .replace("<br>", "\n")
}

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

impl From<Vec<kcapi_main::api_get_member::useitem::ApiData>> for InterfaceWrapper<UseItems> {
    fn from(use_items: Vec<kcapi_main::api_get_member::useitem::ApiData>) -> Self {
        let mut use_item_map = HashMap::<i64, UseItem>::with_capacity(use_items.len());
        for use_item in use_items {
            use_item_map.insert(
                use_item.api_id,
                InterfaceWrapper::<UseItem>::from(use_item).unwrap(),
            );
        }
        Self(UseItems {
            use_items: use_item_map,
        })
    }
}

impl From<kcapi_main::api_get_member::useitem::ApiData> for InterfaceWrapper<UseItem> {
    fn from(use_item: kcapi_main::api_get_member::useitem::ApiData) -> Self {
        Self(UseItem {
            id: use_item.api_id,
            count: use_item.api_count,
        })
    }
}

impl From<Vec<kcapi_main::api_get_member::payitem::ApiData>> for InterfaceWrapper<PayItems> {
    fn from(pay_items: Vec<kcapi_main::api_get_member::payitem::ApiData>) -> Self {
        let mut pay_item_map = HashMap::<i64, PayItem>::with_capacity(pay_items.len());
        for pay_item in pay_items {
            let item = InterfaceWrapper::<PayItem>::from(pay_item).unwrap();
            pay_item_map.insert(item.payitem_id, item);
        }
        Self(PayItems {
            pay_items: pay_item_map,
        })
    }
}

impl From<kcapi_main::api_get_member::payitem::ApiData> for InterfaceWrapper<PayItem> {
    fn from(pay_item: kcapi_main::api_get_member::payitem::ApiData) -> Self {
        Self(PayItem {
            payitem_id: pay_item.api_payitem_id.trim().parse::<i64>().unwrap_or(0),
            item_type: pay_item.api_type,
            name: pay_item.api_name,
            description: normalize_item_description(pay_item.api_description),
            price: pay_item.api_price,
            count: pay_item.api_count,
        })
    }
}
