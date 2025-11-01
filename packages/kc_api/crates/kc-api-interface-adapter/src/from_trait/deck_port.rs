use crate::InterfaceWrapper;
use kc_api_dto::main as kcapi_main;
use kc_api_interface::deck_port::{DeckPort, DeckPorts};
use std::collections::HashMap;

impl From<Vec<kcapi_main::api_port::port::ApiDeckPort>> for InterfaceWrapper<DeckPorts> {
    fn from(deck_ports: Vec<kcapi_main::api_port::port::ApiDeckPort>) -> Self {
        let mut deck_port_list = HashMap::with_capacity(4);
        for deck_port in deck_ports {
            deck_port_list.insert(
                deck_port.api_id,
                InterfaceWrapper::<DeckPort>::from(deck_port).unwrap(),
            );
        }
        Self(DeckPorts {
            deck_ports: deck_port_list,
            combined_flag: None,
        })
    }
}

impl From<kcapi_main::api_port::port::ApiDeckPort> for InterfaceWrapper<DeckPort> {
    fn from(deck_port: kcapi_main::api_port::port::ApiDeckPort) -> Self {
        Self(DeckPort {
            id: deck_port.api_id,
            name: deck_port.api_name,
            mission: deck_port.api_mission,
            ship: Some(deck_port.api_ship),
        })
    }
}

impl From<kcapi_main::api_port::port::ApiData> for InterfaceWrapper<DeckPorts> {
    fn from(api_data: kcapi_main::api_port::port::ApiData) -> Self {
        let mut deck_ports =
            InterfaceWrapper::<DeckPorts>::from(api_data.api_deck_port.clone()).unwrap();
        deck_ports.combined_flag = api_data.api_combined_flag;
        if deck_ports.combined_flag.is_some_and(|flag| flag > 0) {
            if let Some(deck_port) = deck_ports.deck_ports.get_mut(&1) {
                deck_port.ship = Some(
                    [
                        api_data.api_deck_port[0].api_ship.clone(),
                        api_data.api_deck_port[1].api_ship.clone(),
                    ]
                    .concat(),
                );
            }
        }
        Self(deck_ports)
    }
}
