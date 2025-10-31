use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

struct MstEquipExslotType(i64);

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
