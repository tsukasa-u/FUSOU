use kc_api_interface::deck_port::DeckPorts;
use kc_api_interface::interface::{EmitData, Identifier, Set};
use kc_api_interface::logs::Logs;
use kc_api_interface::material::Materials;
use kc_api_interface::n_dock::NDocks;
use kc_api_interface::ship::Ships;

use kc_api_dto::main::api_port::*;

use crate::{register_trait, InterfaceWrapper, TraitForConvert};

register_trait!(air_corps_cond_recovery_with_timer);

impl TraitForConvert for port::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let materials =
            InterfaceWrapper::<Materials>::from(self.api_data.api_material.clone()).unwrap();
        let ships = InterfaceWrapper::<Ships>::from(self.api_data.api_ship.clone()).unwrap();
        let ndocks = InterfaceWrapper::<NDocks>::from(self.api_data.api_ndock.clone()).unwrap();
        let logs = InterfaceWrapper::<Logs>::from(self.api_data.api_log.clone()).unwrap();
        // let deck_ports = InterfaceWrapper::<DeckPorts>::from(self.api_data.api_deck_port.clone()).unwrap();
        let deck_ports = InterfaceWrapper::<DeckPorts>::from(self.api_data.clone()).unwrap();

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
