use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::TraitForEncode;

pub(crate) static KCS_MST_SLOT_ITEM_EQUIP_TYPES: Lazy<Mutex<MstSlotItemEquipTypes>> =
    Lazy::new(|| {
        Mutex::new(MstSlotItemEquipTypes {
            mst_slotitem_equip_types: HashMap::new(),
        })
    });

use crate::kcapi_main;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstSlotItemEquipTypes {
    pub mst_slotitem_equip_types: HashMap<i64, MstSlotItemEquipType>,
}

#[derive(Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS)]
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

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstSlotitemEquiptype>>
    for MstSlotItemEquipTypes
{
    fn from(equip_types: Vec<kcapi_main::api_start2::get_data::ApiMstSlotitemEquiptype>) -> Self {
        let mut equip_type_map =
            HashMap::<i64, MstSlotItemEquipType>::with_capacity(equip_types.len());
        // let mut ship_map = HashMap::new();
        for equip_type in equip_types {
            equip_type_map.insert(equip_type.api_id, equip_type.into());
        }
        Self {
            mst_slotitem_equip_types: equip_type_map,
        }
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstSlotitemEquiptype> for MstSlotItemEquipType {
    fn from(equip_type: kcapi_main::api_start2::get_data::ApiMstSlotitemEquiptype) -> Self {
        Self {
            id: equip_type.api_id,
            name: equip_type.api_name,
        }
    }
}
