use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub(crate) static KCS_SLOT_ITEMS: Lazy<Mutex<SlotItems>> = Lazy::new(|| {
    Mutex::new(SlotItems {
        slot_items: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "require_info.ts")]
pub struct SlotItems {
    pub slot_items: HashMap<i64, SlotItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "require_info.ts")]
pub struct SlotItem {
    pub id: i64,
    pub slotitem_id: i64,
    pub locked: i64,
    pub level: i64,
    pub alv: Option<i64>,
}

impl SlotItems {
    pub fn load() -> Self {
        let slot_item_map: std::sync::MutexGuard<'_, _> = KCS_SLOT_ITEMS.lock().unwrap();
        slot_item_map.clone()
    }

    pub fn restore(&self) {
        let mut slot_item_map = KCS_SLOT_ITEMS.lock().unwrap();
        *slot_item_map = self.clone();
    }
}
