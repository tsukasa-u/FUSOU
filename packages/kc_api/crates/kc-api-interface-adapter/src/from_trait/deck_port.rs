use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;

use crate::kcapi_main;

use serde::{Deserialize, Serialize};

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

impl From<Vec<kcapi_main::api_port::port::ApiDeckPort>> for DeckPorts {
    fn from(deck_ports: Vec<kcapi_main::api_port::port::ApiDeckPort>) -> Self {
        let mut deck_port_list = HashMap::with_capacity(4);
        for deck_port in deck_ports {
            deck_port_list.insert(deck_port.api_id, deck_port.into());
        }
        Self {
            deck_ports: deck_port_list,
            combined_flag: None,
        }
    }
}

impl From<kcapi_main::api_port::port::ApiDeckPort> for DeckPort {
    fn from(deck_port: kcapi_main::api_port::port::ApiDeckPort) -> Self {
        Self {
            id: deck_port.api_id,
            name: deck_port.api_name,
            mission: deck_port.api_mission,
            ship: Some(deck_port.api_ship),
        }
    }
}

impl From<kcapi_main::api_port::port::ApiData> for DeckPorts {
    fn from(api_data: kcapi_main::api_port::port::ApiData) -> Self {
        let mut deck_ports: DeckPorts = api_data.api_deck_port.clone().into();
        deck_ports.combined_flag = api_data.api_combined_flag;
        if deck_ports.combined_flag.is_some_and(|flag| flag > 0) {
            if let Some(deck_port) = deck_ports.deck_ports.get_mut(&1) {
                deck_port.ship = Some(
                    [
                        api_data.api_deck_port[0].api_ship.clone(),
                        api_data.api_deck_port[1].api_ship.clone(),
                    ]
                    .concat()
                    .to_vec(),
                )
            }
        }
        deck_ports
    }
}
