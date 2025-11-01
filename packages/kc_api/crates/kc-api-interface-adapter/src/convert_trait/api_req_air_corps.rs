use kc_api_interface::interface::EmitData;

use kc_api_dto::main::api_req_air_corps::*;

use crate::{register_trait, TraitForConvert};

register_trait!(
    Req,
    (cond_recovery, expand_base, set_action, set_plane, supply)
);
register_trait!(
    Res,
    (cond_recovery, expand_base, set_action, set_plane, supply)
);
