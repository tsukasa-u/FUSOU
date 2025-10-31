use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstSlotitem>> for MstSlotItems {
    fn from(slot_items: Vec<kcapi_main::api_start2::get_data::ApiMstSlotitem>) -> Self {
        let mut slot_item_map = HashMap::<i64, MstSlotItem>::with_capacity(slot_items.len());
        // let mut ship_map = HashMap::new();
        for slot_item in slot_items {
            slot_item_map.insert(slot_item.api_id, slot_item.into());
        }
        Self {
            mst_slot_items: slot_item_map,
        }
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstSlotitem> for MstSlotItem {
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
        Self {
            id: slot_item.api_id,
            sortno: slot_item.api_sortno,
            name: slot_item.api_name,
            r#type: slot_item.api_type,
            taik: slot_item.api_taik,
            souk: slot_item.api_souk,
            houg: slot_item.api_houg,
            raig: slot_item.api_raig,
            soku: slot_item.api_soku,
            baku: slot_item.api_baku,
            tyku: slot_item.api_tyku,
            tais: slot_item.api_tais,
            atap: slot_item.api_atap,
            houm: meityu,
            raim: slot_item.api_raim,
            houk: kaihi,
            raik: slot_item.api_raik,
            bakk: slot_item.api_bakk,
            saku: slot_item.api_saku,
            sakb: slot_item.api_sakb,
            luck: slot_item.api_luck,
            leng: slot_item.api_leng,
            rare: slot_item.api_rare,
            taibaku,
            geigeki,
            broken: slot_item.api_broken,
            usebull: slot_item.api_usebull,
            version: slot_item.api_version,
            cost: slot_item.api_cost,
            distance: slot_item.api_distance,
        }
    }
}
