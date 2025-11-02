use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub static KCS_DECKS: Lazy<Mutex<DeckPorts>> = Lazy::new(|| {
    Mutex::new(DeckPorts {
        deck_ports: HashMap::new(),
        combined_flag: None,
    })
});

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "port.ts")]
pub struct DeckPorts {
    pub deck_ports: HashMap<i64, DeckPort>,
    pub combined_flag: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "port.ts")]
pub struct DeckPort {
    pub id: i64,
    pub name: String,
    pub mission: Vec<i64>,
    pub ship: Option<Vec<i64>>,
}

impl DeckPorts {
    pub fn load() -> Self {
        let deck_ports = KCS_DECKS.lock().unwrap();
        deck_ports.clone()
    }

    pub fn restore(&self) {
        let mut deck_ports = KCS_DECKS.lock().unwrap();
        *deck_ports = self.clone();
    }
}
