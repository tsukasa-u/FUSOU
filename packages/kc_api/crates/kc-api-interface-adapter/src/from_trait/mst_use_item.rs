use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

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
