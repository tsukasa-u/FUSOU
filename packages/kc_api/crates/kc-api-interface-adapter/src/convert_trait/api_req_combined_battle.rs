use kc_api_interface::battle::Battle;
use kc_api_interface::interface::{Add, EmitData};

use kc_api_dto::main::api_req_combined_battle::*;

use crate::{InterfaceWrapper, TraitForConvert};

impl TraitForConvert for ec_battle::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let battle = InterfaceWrapper::<Battle>::from(self.api_data.clone()).unwrap();
        Some(vec![EmitData::Add(Add::Battle(battle))])
    }
}

impl TraitForConvert for ec_midnight_battle::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let battle = InterfaceWrapper::<Battle>::from(self.api_data.clone()).unwrap();
        Some(vec![EmitData::Add(Add::Battle(battle))])
    }
}
