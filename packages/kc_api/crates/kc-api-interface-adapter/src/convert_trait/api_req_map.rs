use kc_api_interface::cells::{Cell, Cells};
use kc_api_interface::interface::{Add, EmitData, Identifier, Set};

use kc_api_dto::main::api_req_map::*;

use crate::{register_trait, InterfaceWrapper, TraitForConvert};

register_trait!(select_eventmap_rank, start_air_base);

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
