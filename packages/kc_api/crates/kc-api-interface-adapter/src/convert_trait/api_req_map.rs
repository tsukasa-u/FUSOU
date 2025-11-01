use kc_api_interface::cells::{Cell, Cells};
use kc_api_interface::interface::{Add, EmitData, Identifier, Set};

use kc_api_dto::main::api_req_map::*;

use crate::{InterfaceWrapper, TraitForConvert};

impl TraitForConvert for next::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let cell = InterfaceWrapper::<Cell>::from(self.api_data.clone()).unwrap();
        Some(vec![EmitData::Add(Add::Cell(cell))])
    }
}

impl TraitForConvert for start::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let cells = InterfaceWrapper::<Cells>::from(self.api_data.clone()).unwrap();
        Some(vec![
            EmitData::Set(Set::Cells(cells)),
            EmitData::Identifier(Identifier::MapStart(())),
        ])
    }
}
