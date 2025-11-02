use kc_api_interface::interface::EmitData;

use kc_api_dto::endpoints::api_req_hensei::*;

use crate::{register_trait, TraitForConvert};

register_trait!(
    Req,
    (
        change,
        combined,
        lock,
        preset_delete,
        preset_lock,
        preset_register,
        preset_select
    )
);
register_trait!(
    Res,
    (
        change,
        combined,
        lock,
        preset_delete,
        preset_lock,
        preset_register,
        preset_select
    )
);
