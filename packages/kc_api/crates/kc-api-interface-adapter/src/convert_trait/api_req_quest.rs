use kc_api_interface::interface::EmitData;

use kc_api_dto::endpoints::api_req_quest::*;

use crate::{register_trait, TraitForConvert};

register_trait!(Req, (clearitemget, start, stop));
register_trait!(Res, (clearitemget, start, stop));
