use std::collections::HashMap;

use crate::kcapi;

use std::sync::{LazyLock, Mutex};

// Is it better to use onecell::sync::Lazy or std::sync::Lazy?
static KC_DECKS: LazyLock<Mutex<DeckPorts>> = LazyLock::new(|| {
    Mutex::new(DeckPorts {
        deck_ports: HashMap::new()
    })
});

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeckPorts {
    pub deck_ports: HashMap<i64, DeckPort>
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeckPort {
    pub id: i64,
    pub mission: Vec<i64>,
    pub ship: Option<Vec<i64>>,
}

impl From<Vec<kcapi::api_port::port::ApiDeckPort>> for DeckPorts {
    fn from(deck_ports: Vec<kcapi::api_port::port::ApiDeckPort>) -> Self {
        let mut deck_port_list = HashMap::with_capacity(4);
        for deck_port in deck_ports {
            deck_port_list.insert(deck_port.api_id, deck_port.into());
        }
        Self {
            deck_ports: deck_port_list
        }
    }
}

impl From<kcapi::api_port::port::ApiDeckPort> for DeckPort {
    fn from(deck_port: kcapi::api_port::port::ApiDeckPort) -> Self {
        Self {
            id: deck_port.api_id,
            mission: deck_port.api_mission,
            ship: Some(deck_port.api_ship),
        }
    }
}
