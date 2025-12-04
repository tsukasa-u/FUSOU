use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub(crate) static KCS_USE_ITEMS: Lazy<Mutex<UseItems>> = Lazy::new(|| {
    Mutex::new(UseItems {
        use_items: HashMap::new(),
    })
});
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "require_info.ts")]
pub struct UseItems {
    pub use_items: HashMap<i64, UseItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "require_info.ts")]
pub struct UseItem {
    pub id: i64,
    pub count: i64  ,
}


impl UseItems {
    pub fn load() -> Self {
        let use_item_map: std::sync::MutexGuard<'_, _> = KCS_USE_ITEMS.lock().unwrap();
        use_item_map.clone()
    }

    pub fn restore(&self) {
        let mut use_item_map = KCS_USE_ITEMS.lock().unwrap();
        *use_item_map = self.clone();
    }
}
