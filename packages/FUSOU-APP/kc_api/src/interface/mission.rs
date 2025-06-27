// use crate::kcapi;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mission {
    pub mission_id: i64,
    pub complete_time: u64,
    pub counter: u64,
}

// impl From<kcapi::api_port::port::ApiMaterial> for Material {
//     fn from(mission: kcapi::api_port::port::ApiDeckPort) -> Self {
//         Self {
//         }
//     }
// }
