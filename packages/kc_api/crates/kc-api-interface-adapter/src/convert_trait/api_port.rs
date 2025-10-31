use kc_api_interface::deck_port::DeckPorts;
use kc_api_interface::interface::{EmitData, Identifier, Set};
use kc_api_interface::logs::Logs;
use kc_api_interface::material::Materials;
use kc_api_interface::n_dock::NDocks;
use kc_api_interface::ship::Ships;

use kc_api_dto::main::api_port::*;

use crate::TraitForConvert;

impl TraitForConvert for port::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let materials: Materials = self.api_data.api_material.clone().into();
        let ships: Ships = self.api_data.api_ship.clone().into();
        let ndocks: NDocks = self.api_data.api_ndock.clone().into();
        let logs: Logs = self.api_data.api_log.clone().into();
        // let deck_ports: DeckPorts = self.api_data.api_deck_port.clone().into();
        let deck_ports: DeckPorts = self.api_data.clone().into();

        Some(vec![
            EmitData::Set(Set::Materials(materials)),
            EmitData::Set(Set::Ships(ships)),
            EmitData::Set(Set::NDocks(ndocks)),
            EmitData::Set(Set::Logs(logs)),
            EmitData::Set(Set::DeckPorts(deck_ports)),
            EmitData::Identifier(Identifier::Port(())),
        ])
    }
}
