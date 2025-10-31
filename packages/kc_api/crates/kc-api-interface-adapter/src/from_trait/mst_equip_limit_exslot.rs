use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

struct MstEquipLimitExslotType(Vec<i64>);

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
