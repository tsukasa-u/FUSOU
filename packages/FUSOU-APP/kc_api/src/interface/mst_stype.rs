use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};

use register_trait::TraitForEncode;

pub(crate) static KCS_MST_STYPES: Lazy<Mutex<MstStypes>> = Lazy::new(|| {
    Mutex::new(MstStypes {
        mst_stypes: HashMap::new(),
    })
});

use crate::kcapi_main;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MstStypes {
    pub mst_stypes: HashMap<i64, MstStype>,
}

#[derive(Debug, Clone, Serialize, Deserialize, AvroSchema, TraitForEncode)]
pub struct MstStype {
    pub id: i64,
    pub sortno: i64,
    pub name: String,
    pub equip_type: HashMap<String, i64>,
}

impl MstStypes {
    pub fn load() -> Self {
        let stype_map = KCS_MST_STYPES.lock().unwrap();
        stype_map.clone()
    }

    pub fn restore(&self) {
        let mut stype_map = KCS_MST_STYPES.lock().unwrap();
        *stype_map = self.clone();
    }
}

impl From<Vec<kcapi_main::api_start2::get_data::ApiMstStype>> for MstStypes {
    fn from(stypes: Vec<kcapi_main::api_start2::get_data::ApiMstStype>) -> Self {
        let mut stype_map = HashMap::<i64, MstStype>::with_capacity(stypes.len());
        // let mut ship_map = HashMap::new();
        for stype in stypes {
            stype_map.insert(stype.api_id, stype.into());
        }
        Self {
            mst_stypes: stype_map,
        }
    }
}

impl From<kcapi_main::api_start2::get_data::ApiMstStype> for MstStype {
    fn from(stype: kcapi_main::api_start2::get_data::ApiMstStype) -> Self {
        Self {
            id: stype.api_id,
            sortno: stype.api_sortno,
            name: stype.api_name,
            equip_type: stype.api_equip_type,
        }
    }
}
