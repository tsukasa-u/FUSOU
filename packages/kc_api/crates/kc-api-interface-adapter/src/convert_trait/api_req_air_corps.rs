use kc_api_interface::interface::EmitData;

use kc_api_dto::endpoints::api_req_air_corps::*;

use crate::{register_trait, TraitForConvert};

register_trait!(
    Req,
    (change_name, cond_recovery, expand_base, set_action, set_plane, supply)
);
register_trait!(
    Res,
    (change_name, cond_recovery, expand_base, set_action, set_plane, supply)
);
