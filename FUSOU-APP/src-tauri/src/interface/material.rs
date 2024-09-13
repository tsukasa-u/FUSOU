use crate::kcapi;
use register_trait::TraitForEmitData;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Materials {
    pub materials: Vec<i64>,
}

impl From<Vec<kcapi::api_port::port::ApiMaterial>> for Materials {
    fn from(materials: Vec<kcapi::api_port::port::ApiMaterial>) -> Self {
        let mut ret = Vec::<i64>::with_capacity(8);
        for material in materials {
            ret.push(material.api_value);
        }

        Self {
            materials: ret
        }
    }
}