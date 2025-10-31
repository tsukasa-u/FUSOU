use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use apache_avro::AvroSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use register_trait::{FieldSizeChecker, TraitForEncode};

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
