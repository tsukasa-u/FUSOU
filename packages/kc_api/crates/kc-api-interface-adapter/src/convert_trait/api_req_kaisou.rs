use kc_api_interface::interface::EmitData;

use kc_api_dto::endpoints::api_req_kaisou::*;

use crate::{register_trait, TraitForConvert};

register_trait!(
    Req,
    (
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
    )
);
register_trait!(
    Res,
    (
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
    )
);
