use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

// Is it better to use onecell::sync::Lazy or std::sync::Lazy?
pub(crate) static KCS_MST_USEITEMS: LazyLock<Mutex<MstUseItems>> = LazyLock::new(|| {
    Mutex::new(MstUseItems {
        mst_use_items: HashMap::new(),
    })
});

use crate::kcapi;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MstUseItems {
    mst_use_items: HashMap<i64, MstUseItem>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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

impl From<Vec<kcapi::api_start2::get_data::ApiMstUseitem>> for MstUseItems {
    fn from(use_items: Vec<kcapi::api_start2::get_data::ApiMstUseitem>) -> Self {
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

impl From<kcapi::api_start2::get_data::ApiMstUseitem> for MstUseItem {
    fn from(use_item: kcapi::api_start2::get_data::ApiMstUseitem) -> Self {
        Self {
            id: use_item.api_id,
            name: use_item.api_name,
        }
    }
}
