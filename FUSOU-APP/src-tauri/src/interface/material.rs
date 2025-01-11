use std::collections::HashMap;

use crate::kcapi;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Materials {
    pub materials: HashMap<usize, i64>,
}

impl From<Vec<kcapi::api_port::port::ApiMaterial>> for Materials {
    fn from(materials: Vec<kcapi::api_port::port::ApiMaterial>) -> Self {
        let mut ret = HashMap::with_capacity(8);
        for idx in 0..8 {
            ret.insert(idx, materials[idx].api_value);
        }

        Self {
            materials: ret
        }
    }
}

impl From<kcapi::api_req_hokyu::charge::ApiData> for Materials {
    fn from(data: kcapi::api_req_hokyu::charge::ApiData) -> Self {
        let mut ret = HashMap::with_capacity(8);
        for idx in 0..4 {
            ret.insert(idx, data.api_material[idx]);
        }

        Self {
            materials: ret
        }
    }
}