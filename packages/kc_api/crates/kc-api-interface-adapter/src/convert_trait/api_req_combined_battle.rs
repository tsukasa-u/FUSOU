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
register_trait!(
    Res,
    (
        battle_water,
        battle,
        battleresult,
        each_battle_water,
        each_battle,
        goback_port,
        ld_airbattle,
        midnight_battle,
        sp_midnight
    )
);

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
