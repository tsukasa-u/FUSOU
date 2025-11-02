// use once_cell::sync::Lazy;
use std::collections::HashMap;
// use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

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
