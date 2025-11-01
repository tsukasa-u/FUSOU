use kc_api_interface::interface::{Add, EmitData, Identifier, Set};

use kc_api_dto::main::api_req_kaisou::*;

use crate::{register_trait, InterfaceWrapper, TraitForConvert};

register_trait!(
    can_preset_slot_select,
    lock,
    marriage,
    open_exslot,
    powerup,
    preset_slot_update_lock,
    remodeling,
    slot_deprive,
    slot_exchange_index,
    slotset,
    slotset_ex,
    unsetslot_all
);
