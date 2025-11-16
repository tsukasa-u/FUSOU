use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

// Is it better to use onecell::sync::Lazy or std::sync::Lazy?
pub(crate) static KCS_MST_SLOT_ITEMS: Lazy<Mutex<MstSlotItems>> = Lazy::new(|| {
    Mutex::new(MstSlotItems {
        mst_slot_items: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstSlotItems {
    pub mst_slot_items: HashMap<i32, MstSlotItem>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstSlotItem {
    pub id: i32,
    pub sortno: i32,
    pub name: String,
    pub r#type: Vec<i32>,
    pub taik: i32,
    pub souk: i32,
    pub houg: i32,
    pub raig: i32,
    pub soku: i32,
    pub baku: i32,
    pub tyku: i32,
    pub tais: i32,
    pub atap: i32,
    pub houm: i32,
    pub raim: i32,
    pub houk: i32,
    pub raik: i32,
    pub bakk: i32,
    pub saku: i32,
    pub sakb: i32,
    pub luck: i32,
    pub leng: i32,
    pub rare: i32,
    pub taibaku: i32,
    pub geigeki: i32,
    pub broken: Vec<i32>,
    pub usebull: String,
    pub version: Option<i32>,
    pub cost: Option<i32>,
    pub distance: Option<i32>,
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
