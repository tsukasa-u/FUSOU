use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "port.ts")]
pub struct Mission {
    pub mission_id: i64,
    pub complete_time: u64,
    pub counter: u64,
}
