use kc_api_interface::interface::{Add, EmitData, Identifier, Set};

use kc_api_dto::main::api_req_kousyou::*;

use crate::{register_trait, InterfaceWrapper, TraitForConvert};

register_trait!(
    createitem,
    createship,
    destroyitem2,
    destroyship,
    getship,
    remodel_slot,
    remodel_slotlist,
    remodel_slotlist_detail
);
