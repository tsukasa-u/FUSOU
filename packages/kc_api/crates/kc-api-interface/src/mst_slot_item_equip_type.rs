use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

pub(crate) static KCS_MST_SLOT_ITEM_EQUIP_TYPES: Lazy<Mutex<MstSlotItemEquipTypes>> =
    Lazy::new(|| {
        Mutex::new(MstSlotItemEquipTypes {
            mst_slotitem_equip_types: HashMap::new(),
        })
    });

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstSlotItemEquipTypes {
    pub mst_slotitem_equip_types: HashMap<i64, MstSlotItemEquipType>,
}

#[derive(
    Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS, FieldSizeChecker,
)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstSlotItemEquipType {
    pub id: i64,
    pub name: String,
}

impl MstSlotItemEquipTypes {
    pub fn load() -> Self {
        let equip_type_map = KCS_MST_SLOT_ITEM_EQUIP_TYPES.lock().unwrap();
        equip_type_map.clone()
    }

    pub fn restore(&self) {
        let mut equip_type_map = KCS_MST_SLOT_ITEM_EQUIP_TYPES.lock().unwrap();
        *equip_type_map = self.clone();
    }
}
