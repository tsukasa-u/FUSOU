use kc_api_interface::interface::{Add, EmitData, Identifier, Set};

use kc_api_dto::main::api_req_hensei::*;

use crate::{register_trait, InterfaceWrapper, TraitForConvert};

register_trait!(
    change,
    combined,
    lock,
    preset_delete,
    preset_lock,
    preset_register,
    preset_select
);
