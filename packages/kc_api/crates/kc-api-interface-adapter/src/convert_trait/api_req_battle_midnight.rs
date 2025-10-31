use kc_api_interface::battle::Battle;
use kc_api_interface::interface::{Add, EmitData};

use kc_api_dto::main::api_req_battle_midnight::*;

use register_trait::TraitForConvert;

impl TraitForConvert for battle::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        // let ships: Ships = self.api_data.clone().into();
        let battle: Battle = self.api_data.clone().into();
        Some(vec![
            // EmitData::Add(Add::Ships(ships)),
            EmitData::Add(Add::Battle(battle)),
        ])
    }
}

impl TraitForConvert for sp_midnight::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        // let ships: Ships = self.api_data.clone().into();
        let battle: Battle = self.api_data.clone().into();
        Some(vec![
            // EmitData::Add(Add::Ships(ships)),
            EmitData::Add(Add::Battle(battle)),
        ])
    }
}
