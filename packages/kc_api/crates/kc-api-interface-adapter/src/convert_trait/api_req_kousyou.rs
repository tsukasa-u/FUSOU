use kc_api_interface::interface::EmitData;

use kc_api_dto::main::api_req_kousyou::*;

use crate::{register_trait, TraitForConvert};

register_trait!(
    Req,
    (
        createitem,
        createship,
        destroyitem2,
        destroyship,
        getship,
        remodel_slot,
        remodel_slotlist,
        remodel_slotlist_detail
    )
);
register_trait!(
    Res,
    (
        createitem,
        createship,
        destroyitem2,
        destroyship,
        getship,
        remodel_slot,
        remodel_slotlist,
        remodel_slotlist_detail
    )
);
