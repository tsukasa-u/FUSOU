use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};

use register_trait::TraitForEncode;

pub(crate) static KCS_MST_USEITEMS: Lazy<Mutex<MstUseItems>> = Lazy::new(|| {
    Mutex::new(MstUseItems {
        mst_use_items: HashMap::new(),
    })
});

use crate::kcapi_main;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MstUseItems {
    pub mst_use_items: HashMap<i64, MstUseItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode)]
pub struct MstUseItem {
    pub id: i64,
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

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstUseitem>> for MstUseItems {
    fn from(use_items: Vec<kcapi_main::api_start2::get_data::ApiMstUseitem>) -> Self {
        let mut item_map = HashMap::<i64, MstUseItem>::with_capacity(use_items.len());
        // let mut ship_map = HashMap::new();
        for use_item in use_items {
            item_map.insert(use_item.api_id, use_item.into());
        }
        Self {
            mst_use_items: item_map,
        }
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstUseitem> for MstUseItem {
    fn from(use_item: kcapi_main::api_start2::get_data::ApiMstUseitem) -> Self {
        Self {
            id: use_item.api_id,
            name: use_item.api_name,
        }
    }
}
