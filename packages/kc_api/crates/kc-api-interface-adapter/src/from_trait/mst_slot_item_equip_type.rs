use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

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
