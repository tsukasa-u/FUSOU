use kc_api_interface::interface::EmitData;

use kc_api_dto::main::api_req_nyukyo::*;

use crate::{register_trait, TraitForConvert};

register_trait!(Req, (speedchange, start));
register_trait!(Res, (speedchange, start));
