use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

pub(crate) static KCS_MST_EQUIP_LIMIT_EXSLOT: Lazy<Mutex<MstEquipLimitExslots>> = Lazy::new(|| {
    Mutex::new(MstEquipLimitExslots {
        mst_equip_limit_exslots: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstEquipLimitExslots {
    pub mst_equip_limit_exslots: HashMap<i32, MstEquipLimitExslot>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstEquipLimitExslot {
    pub equip: Vec<i32>,
}

impl MstEquipLimitExslots {
    pub fn load() -> Self {
        let equip_limit_exslot_map = KCS_MST_EQUIP_LIMIT_EXSLOT.lock().unwrap();
        equip_limit_exslot_map.clone()
    }

    pub fn restore(&self) {
        let mut equip_limit_exslot_map = KCS_MST_EQUIP_LIMIT_EXSLOT.lock().unwrap();
        *equip_limit_exslot_map = self.clone();
    }
}
