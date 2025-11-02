use kc_api_interface::interface::EmitData;

use kc_api_dto::endpoints::api_req_mission::*;

use crate::{register_trait, TraitForConvert};

register_trait!(Req, (result, return_instruction, start));
register_trait!(Res, (result, return_instruction, start));
