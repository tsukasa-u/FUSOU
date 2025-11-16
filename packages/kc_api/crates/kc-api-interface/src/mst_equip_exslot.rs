use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

pub(crate) static KCS_MST_EQUIP_EXSLOT: Lazy<Mutex<MstEquipExslots>> = Lazy::new(|| {
    Mutex::new(MstEquipExslots {
        mst_equip_exslots: HashMap::new(),
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstEquipExslots {
    pub mst_equip_exslots: HashMap<i32, MstEquipExslot>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstEquipExslot {
    pub equip: i32,
}

impl MstEquipExslots {
    pub fn load() -> Self {
        let equip_limit_exslot_map = KCS_MST_EQUIP_EXSLOT.lock().unwrap();
        equip_limit_exslot_map.clone()
    }

    pub fn restore(&self) {
        let mut equip_limit_exslot_map = KCS_MST_EQUIP_EXSLOT.lock().unwrap();
        *equip_limit_exslot_map = self.clone();
    }
}
