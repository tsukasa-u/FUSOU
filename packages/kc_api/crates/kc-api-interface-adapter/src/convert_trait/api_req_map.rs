use kc_api_interface::cells::Cell;
use kc_api_interface::cells::Cells;
use kc_api_interface::interface::{EmitData, Identifier, Set};

use kc_api_dto::main::api_req_map::*;

impl TraitForConvert for next::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let cell: Cell = self.api_data.clone().into();
        Some(vec![EmitData::Add(Add::Cell(cell))])
    }
}

impl TraitForConvert for start::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let cells: Cells = self.api_data.clone().into();
        Some(vec![
            EmitData::Set(Set::Cells(cells)),
            EmitData::Identifier(Identifier::MapStart(())),
        ])
    }
}
