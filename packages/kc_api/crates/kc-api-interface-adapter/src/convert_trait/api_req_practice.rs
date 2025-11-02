use kc_api_interface::interface::EmitData;

use kc_api_dto::endpoints::api_req_practice::*;

use crate::{register_trait, TraitForConvert};

register_trait!(Req, (battle, battle_result, midnight_battle));
register_trait!(Res, (battle, battle_result, midnight_battle));
