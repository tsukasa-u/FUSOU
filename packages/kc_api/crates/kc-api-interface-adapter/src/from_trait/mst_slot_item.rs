use crate::InterfaceWrapper;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::mst_slot_item::{MstSlotItem, MstSlotItems};
use std::collections::HashMap;

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstSlotitem>>
    for InterfaceWrapper<MstSlotItems>
{
    fn from(slot_items: Vec<kcapi_main::api_start2::get_data::ApiMstSlotitem>) -> Self {
        let mut slot_item_map = HashMap::<i32, MstSlotItem>::with_capacity(slot_items.len());
        for slot_item in slot_items {
            slot_item_map.insert(
                slot_item.api_id as i32,
                InterfaceWrapper::<MstSlotItem>::from(slot_item).unwrap(),
            );
        }
        Self(MstSlotItems {
            mst_slot_items: slot_item_map,
        })
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstSlotitem> for InterfaceWrapper<MstSlotItem> {
    fn from(slot_item: kcapi_main::api_start2::get_data::ApiMstSlotitem) -> Self {
        let mut kaihi = slot_item.api_houk;
        let mut meityu = slot_item.api_houm;
        let mut taibaku = 0;
        let mut geigeki = 0;
        if slot_item.api_type[2] == 48 {
            geigeki = kaihi;
            kaihi = 0;
            taibaku = meityu;
            meityu = 0;
        }
        Self(MstSlotItem {
            id: slot_item.api_id as i32,
            sortno: slot_item.api_sortno as i32,
            name: slot_item.api_name,
            r#type: slot_item
                .api_type
                .into_iter()
                .map(|value| value as i32)
                .collect(),
            taik: slot_item.api_taik as i32,
            souk: slot_item.api_souk as i32,
            houg: slot_item.api_houg as i32,
            raig: slot_item.api_raig as i32,
            soku: slot_item.api_soku as i32,
            baku: slot_item.api_baku as i32,
            tyku: slot_item.api_tyku as i32,
            tais: slot_item.api_tais as i32,
            atap: slot_item.api_atap as i32,
            houm: meityu as i32,
            raim: slot_item.api_raim as i32,
            houk: kaihi as i32,
            raik: slot_item.api_raik as i32,
            bakk: slot_item.api_bakk as i32,
            saku: slot_item.api_saku as i32,
            sakb: slot_item.api_sakb as i32,
            luck: slot_item.api_luck as i32,
            leng: slot_item.api_leng as i32,
            rare: slot_item.api_rare as i32,
            taibaku: taibaku as i32,
            geigeki: geigeki as i32,
            broken: slot_item
                .api_broken
                .into_iter()
                .map(|value| value as i32)
                .collect(),
            usebull: slot_item.api_usebull,
            version: slot_item.api_version.map(|value| value as i32),
            cost: slot_item.api_cost.map(|value| value as i32),
            distance: slot_item.api_distance.map(|value| value as i32),
        })
    }
}
