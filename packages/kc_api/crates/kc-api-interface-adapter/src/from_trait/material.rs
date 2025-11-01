use crate::InterfaceWrapper;
use kc_api_dto::main as kcapi_main;
use kc_api_interface::material::Materials;
use std::collections::HashMap;

impl From<Vec<kcapi_main::api_port::port::ApiMaterial>> for InterfaceWrapper<Materials> {
    fn from(materials: Vec<kcapi_main::api_port::port::ApiMaterial>) -> Self {
        let mut ret = HashMap::with_capacity(8);
        for (idx, material) in materials.iter().enumerate() {
            ret.insert(idx, material.api_value);
        }
        Self(Materials { materials: ret })
    }
}

impl From<kcapi_main::api_req_hokyu::charge::ApiData> for InterfaceWrapper<Materials> {
    fn from(data: kcapi_main::api_req_hokyu::charge::ApiData) -> Self {
        let mut ret = HashMap::with_capacity(8);
        for (idx, material) in data.api_material.iter().enumerate() {
            ret.insert(idx, *material);
        }
        Self(Materials { materials: ret })
    }
}
