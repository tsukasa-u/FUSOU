use kc_api_interface::interface::EmitData;

use kc_api_dto::endpoints::api_dmm_payment::*;

use crate::{register_trait, TraitForConvert};

register_trait!(Req, (paycheck));
register_trait!(Res, (paycheck));
