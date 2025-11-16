use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

pub(crate) static KCS_MST_STYPES: Lazy<Mutex<MstStypes>> = Lazy::new(|| {
    Mutex::new(MstStypes {
        mst_stypes: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstStypes {
    pub mst_stypes: HashMap<i32, MstStype>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstStype {
    pub id: i32,
    pub sortno: i32,
    pub name: String,
    pub equip_type: HashMap<String, i32>,
}

impl MstStypes {
    pub fn load() -> Self {
        let stype_map = KCS_MST_STYPES.lock().unwrap();
        stype_map.clone()
    }

    pub fn restore(&self) {
        let mut stype_map = KCS_MST_STYPES.lock().unwrap();
        *stype_map = self.clone();
    }
}
