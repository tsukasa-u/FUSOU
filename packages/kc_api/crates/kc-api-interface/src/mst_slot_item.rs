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
    pub mst_slot_items: HashMap<i64, MstSlotItem>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstSlotItem {
    pub id: i64,
    pub sortno: i64,
    pub name: String,
    pub r#type: Vec<i64>,
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
    pub taibaku: i64,
    pub geigeki: i64,
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
