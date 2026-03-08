use kc_api_interface::battle::Battle;
use kc_api_interface::interface::{Add, EmitData};

use kc_api_dto::endpoints::api_req_combined_battle::*;

use crate::{register_trait, InterfaceWrapper, TraitForConvert};

register_trait!(
    Req,
    (
        battle_water,
        battle,
        battleresult,
        each_battle_water,
        each_battle,
        ec_battle,
        ec_midnight_battle,
        goback_port,
        ld_airbattle,
        midnight_battle,
        sp_midnight
    )
);
register_trait!(Res, (goback_port));

impl TraitForConvert for battleresult::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let battle = InterfaceWrapper::<Battle>::from(self.api_data.clone()).unwrap();
        Some(vec![EmitData::Add(Add::Battle(battle))])
    }
}

impl TraitForConvert for ld_airbattle::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let battle = InterfaceWrapper::<Battle>::from(self.api_data.clone()).unwrap();
        Some(vec![EmitData::Add(Add::Battle(battle))])
    }
}

impl TraitForConvert for midnight_battle::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let battle = InterfaceWrapper::<Battle>::from(self.api_data.clone()).unwrap();
        Some(vec![EmitData::Add(Add::Battle(battle))])
    }
}

impl TraitForConvert for sp_midnight::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let battle = InterfaceWrapper::<Battle>::from(self.api_data.clone()).unwrap();
        Some(vec![EmitData::Add(Add::Battle(battle))])
    }
}


impl TraitForConvert for each_battle_water::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let battle = InterfaceWrapper::<Battle>::from(self.api_data.clone()).unwrap();
        Some(vec![EmitData::Add(Add::Battle(battle))])
    }
}

impl TraitForConvert for each_battle::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let battle = InterfaceWrapper::<Battle>::from(self.api_data.clone()).unwrap();
        Some(vec![EmitData::Add(Add::Battle(battle))])
    }
}

impl TraitForConvert for battle_water::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let battle = InterfaceWrapper::<Battle>::from(self.api_data.clone()).unwrap();
        Some(vec![EmitData::Add(Add::Battle(battle))])
    }
}

impl TraitForConvert for battle::Res {
    type Output = EmitData;
    fn convert(&self) -> Option<Vec<EmitData>> {
        let battle = InterfaceWrapper::<Battle>::from(self.api_data.clone()).unwrap();
        Some(vec![
            EmitData::Add(Add::Battle(battle)),
        ])
    }
}

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
