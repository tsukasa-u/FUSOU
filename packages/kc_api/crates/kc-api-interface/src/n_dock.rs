use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use ts_rs::TS;

pub static KCS_NDOCKS: Lazy<Mutex<NDocks>> = Lazy::new(|| Mutex::new(NDocks { n_docks: vec![] }));

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "port.ts")]
pub struct NDocks {
    pub n_docks: Vec<NDock>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "port.ts")]
pub struct NDock {
    pub id: i64,
    pub state: i64,
    pub ship_id: i64,
    pub complete_time: i64,
    pub counter: i64,
    pub item1: i64,
    pub item2: i64,
    pub item3: i64,
    pub item4: i64,
}

impl NDocks {
    pub fn load() -> Self {
        let n_docks = KCS_NDOCKS.lock().unwrap();
        n_docks.clone()
    }

    pub fn restore(&self) {
        let mut n_docks = KCS_NDOCKS.lock().unwrap();
        *n_docks = self.clone();
    }
}
