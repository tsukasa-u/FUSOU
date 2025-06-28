use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};

use register_trait::TraitForEncode;

struct MstEquipExslotType(i64);

pub(crate) static KCS_MST_EQUIP_EXSLOT: Lazy<Mutex<MstEquipExslots>> = Lazy::new(|| {
    Mutex::new(MstEquipExslots {
        mst_equip_exslots: HashMap::new(),
    })
});

use crate::kcapi_main;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MstEquipExslots {
    pub mst_equip_exslots: HashMap<i64, MstEquipExslot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode)]
pub struct MstEquipExslot {
    pub equip: i64,
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

impl From<kcapi_main::api_start2::get_data::ApiData> for MstEquipExslots {
    fn from(data: kcapi_main::api_start2::get_data::ApiData) -> Self {
        Self {
            mst_equip_exslots: data
                .api_mst_equip_exslot
                .clone()
                .iter()
                .enumerate()
                .map(|(id, equip)| (id as i64, MstEquipExslotType(*equip).into()))
                .collect::<HashMap<i64, MstEquipExslot>>(),
        }
    }
}

impl From<MstEquipExslotType> for MstEquipExslot {
    fn from(equip: MstEquipExslotType) -> Self {
        Self { equip: equip.0 }
    }
}
