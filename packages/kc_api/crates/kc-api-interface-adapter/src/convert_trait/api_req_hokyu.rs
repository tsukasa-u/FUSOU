use kc_api_interface::interface::{Add, EmitData, Identifier, Set};

use kc_api_dto::main::api_req_hokyu::*;

use crate::{register_trait, InterfaceWrapper, TraitForConvert};

impl TraitForConvert for charge::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        // let materials: Materials = Materials::from(self.api_data.clone());
        // let ships: Ships = Ships::from(self.api_data.clone());
        // Some(vec![
        //     EmitData::Add(Add::Ships(ships)),
        //     EmitData::Add(Add::Materials(materials))])
        Some(vec![])
    }
}
