use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

// Is it better to use onecell::sync::Lazy or std::sync::Lazy?
pub(crate) static KCS_MST_EQUIPTYPES: LazyLock<Mutex<MstSlotItemEquipTypes>> = LazyLock::new(|| {
    Mutex::new(MstSlotItemEquipTypes {
        mst_equip_types: HashMap::new()
    })
});

use crate::kcapi;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MstSlotItemEquipTypes {
    mst_equip_types: HashMap<i64, MstSlotItemEquipType>
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MstSlotItemEquipType {
    pub id: i64,
    pub name: String,
}

impl MstSlotItemEquipTypes {
    pub fn load() -> Self {
        let equip_type_map = KCS_MST_EQUIPTYPES.lock().unwrap();
        equip_type_map.clone()
    }

    pub fn restore(&self) {
        let mut equip_type_map = KCS_MST_EQUIPTYPES.lock().unwrap();
        *equip_type_map = self.clone();
    }
}

impl From<Vec<kcapi::api_start2::get_data::ApiMstSlotitemEquiptype>> for MstSlotItemEquipTypes {
    fn from(equip_types: Vec<kcapi::api_start2::get_data::ApiMstSlotitemEquiptype>) -> Self {
        let mut equip_type_map = HashMap::<i64, MstSlotItemEquipType>::with_capacity(equip_types.len());
        // let mut ship_map = HashMap::new();
        for equip_type in equip_types {
            equip_type_map.insert(equip_type.api_id, equip_type.into());
        }
        Self {
            mst_equip_types: equip_type_map
        }
    }
}

impl From<kcapi::api_start2::get_data::ApiMstSlotitemEquiptype> for MstSlotItemEquipType {
    fn from(equip_type: kcapi::api_start2::get_data::ApiMstSlotitemEquiptype) -> Self {
        Self {
            id: equip_type.api_id,
            name: equip_type.api_name,
        }
    }
}

