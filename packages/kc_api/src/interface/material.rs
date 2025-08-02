// use once_cell::sync::Lazy;
use std::collections::HashMap;
// use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::kcapi_main;

// pub static KCS_MATERIALS: Lazy<Mutex<Materials>> = Lazy::new(|| {
//     Mutex::new(Materials {
//         materials: HashMap::new(),
//     })
// });

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "port.ts")]
pub struct Materials {
    pub materials: HashMap<usize, i64>,
}

impl From<Vec<kcapi_main::api_port::port::ApiMaterial>> for Materials {
    fn from(materials: Vec<kcapi_main::api_port::port::ApiMaterial>) -> Self {
        let mut ret = HashMap::with_capacity(8);
        for (idx, material) in materials.iter().enumerate() {
            ret.insert(idx, material.api_value);
        }
        // for idx in 0..8 {
        //     ret.insert(idx, materials[idx].api_value);
        // }

        Self { materials: ret }
    }
}

impl From<kcapi_main::api_req_hokyu::charge::ApiData> for Materials {
    fn from(data: kcapi_main::api_req_hokyu::charge::ApiData) -> Self {
        let mut ret = HashMap::with_capacity(8);
        for (idx, material) in data.api_material.iter().enumerate() {
            ret.insert(idx, *material);
        }
        // for idx in 0..4 {
        //     ret.insert(idx, data.api_material[idx]);
        // }

        Self { materials: ret }
    }
}
