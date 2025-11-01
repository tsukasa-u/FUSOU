use kc_api_interface::interface::EmitData;

use kc_api_dto::endpoints::api_req_ranking::*;

use crate::{register_trait, TraitForConvert};

register_trait!(Req, (ranking));
register_trait!(Res, (ranking));
