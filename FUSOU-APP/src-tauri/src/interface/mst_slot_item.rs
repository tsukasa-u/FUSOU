use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

// Is it better to use onecell::sync::Lazy or std::sync::Lazy?
pub(crate) static KCS_MST_SLOT_ITEMS: LazyLock<Mutex<MstSlotItems>> = LazyLock::new(|| {
    Mutex::new(MstSlotItems {
        mst_slot_items: HashMap::new()
    })
});

use crate::kcapi;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MstSlotItems {
    mst_slot_items: HashMap<i64, MstSlotItem>
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MstSlotItem {
    pub id: i64,
    pub sortno: i64,
    pub name: String,
    pub _type: Vec<i64>,
    pub taik: i64,
    pub souk: i64,
    pub houg: i64,
    pub raig: i64,
    pub soku: i64,
    pub baku: i64,
    pub tyku: i64,
    pub tais: i64,
    pub atap: i64,
    pub houm: i64,
    pub raim: i64,
    pub houk: i64,
    pub raik: i64,
    pub bakk: i64,
    pub saku: i64,
    pub sakb: i64,
    pub luck: i64,
    pub leng: i64,
    pub rare: i64,
    pub broken: Vec<i64>,
    pub usebull: String,
    pub version: Option<i64>,
    pub cost: Option<i64>,
    pub distance: Option<i64>,
}

impl MstSlotItems {
    pub fn load() -> Self {
        let slot_item_map: std::sync::MutexGuard<'_, _> = KCS_MST_SLOT_ITEMS.lock().unwrap();
        slot_item_map.clone()
    }

    pub fn restore(&self) {
        let mut slot_item_map = KCS_MST_SLOT_ITEMS.lock().unwrap();
        *slot_item_map = self.clone();
    }
}

impl From<Vec<kcapi::api_start2::get_data::ApiMstSlotitem>> for MstSlotItems {
    fn from(slot_items: Vec<kcapi::api_start2::get_data::ApiMstSlotitem>) -> Self {
        
        let mut slot_item_map = HashMap::<i64, MstSlotItem>::with_capacity(slot_items.len());
        // let mut ship_map = HashMap::new();
        for slot_item in slot_items {
            slot_item_map.insert(slot_item.api_id, slot_item.into());
        }
        Self {
            mst_slot_items: slot_item_map
        }
    }
}

impl From<kcapi::api_start2::get_data::ApiMstSlotitem> for MstSlotItem {
    fn from(slot_item: kcapi::api_start2::get_data::ApiMstSlotitem) -> Self {
        Self {
            id: slot_item.api_id,
            sortno: slot_item.api_sortno,
            name: slot_item.api_name,
            _type: slot_item.api_type,
            taik: slot_item.api_taik,
            souk: slot_item.api_souk,
            houg: slot_item.api_houg,
            raig: slot_item.api_raig,
            soku: slot_item.api_soku,
            baku: slot_item.api_baku,
            tyku: slot_item.api_tyku,
            tais: slot_item.api_tais,
            atap: slot_item.api_atap,
            houm: slot_item.api_houm,
            raim: slot_item.api_raim,
            houk: slot_item.api_houk,
            raik: slot_item.api_raik,
            bakk: slot_item.api_bakk,
            saku: slot_item.api_saku,
            sakb: slot_item.api_sakb,
            luck: slot_item.api_luck,
            leng: slot_item.api_leng,
            rare: slot_item.api_rare,
            broken: slot_item.api_broken,
            usebull: slot_item.api_usebull,
            version: slot_item.api_version,
            cost: slot_item.api_cost,
            distance: slot_item.api_distance,
        }
    }
}
