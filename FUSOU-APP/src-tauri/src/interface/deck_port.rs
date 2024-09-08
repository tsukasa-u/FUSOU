use crate::kcapi;

#[derive(Debug)]
pub struct DeckPorts {
    pub deck_ports: Vec<DeckPort>
}

#[derive(Debug)]
pub struct DeckPort {
    pub id: i64,
    pub mission: Vec<i64>,
    pub ship: Option<Vec<i64>>,
}


impl From<Vec<kcapi::api_port::port::ApiDeckPort>> for DeckPorts {
    fn from(deck_ports: Vec<kcapi::api_port::port::ApiDeckPort>) -> Self {
        let mut deck_port_list = Vec::with_capacity(4);
        for deck_port in deck_ports {
            deck_port_list.push(
                DeckPort {
                    id: deck_port.api_id,
                    mission: deck_port.api_mission,
                    ship: Some(deck_port.api_ship),
                }
            );
        }
        Self {
            deck_ports: deck_port_list
        }
    }
}
