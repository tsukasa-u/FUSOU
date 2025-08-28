use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::TraitForEncode;

struct MstEquipLimitExslotType(Vec<i64>);

pub(crate) static KCS_MST_EQUIP_LIMIT_EXSLOT: Lazy<Mutex<MstEquipLimitExslots>> = Lazy::new(|| {
    Mutex::new(MstEquipLimitExslots {
        mst_equip_limit_exslots: HashMap::new(),
    })
});

use crate::kcapi_main;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstEquipLimitExslots {
    pub mst_equip_limit_exslots: HashMap<i64, MstEquipLimitExslot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode, TS)]
#[ts(export, export_to = "get_data.ts")]
pub struct MstEquipLimitExslot {
    pub equip: Vec<i64>,
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

impl From<kcapi_main::api_start2::get_data::ApiData> for MstEquipLimitExslots {
    fn from(data: kcapi_main::api_start2::get_data::ApiData) -> Self {
        Self {
            mst_equip_limit_exslots: data
                .api_mst_equip_limit_exslot
                .clone()
                .map(|x| {
                    x.iter()
                        .map(|(ship_id, equip)| {
                            (*ship_id, MstEquipLimitExslotType(equip.clone()).into())
                        })
                        .collect::<HashMap<i64, MstEquipLimitExslot>>()
                })
                .unwrap_or_default(),
        }
    }
}

impl From<MstEquipLimitExslotType> for MstEquipLimitExslot {
    fn from(equip: MstEquipLimitExslotType) -> Self {
        Self {
            equip: equip.0.clone(),
        }
    }
}
