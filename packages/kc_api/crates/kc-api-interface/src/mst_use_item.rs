use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

pub(crate) static KCS_MST_USEITEMS: Lazy<Mutex<MstUseItems>> = Lazy::new(|| {
    Mutex::new(MstUseItems {
        mst_use_items: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstUseItems {
    pub mst_use_items: HashMap<i32, MstUseItem>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstUseItem {
    pub id: i32,
    pub name: String,
}

impl MstUseItems {
    pub fn load() -> Self {
        let item_map = KCS_MST_USEITEMS.lock().unwrap();
        item_map.clone()
    }

    pub fn restore(&self) {
        let mut item_map = KCS_MST_USEITEMS.lock().unwrap();
        *item_map = self.clone();
    }
}
