use std::sync::atomic::{AtomicI64, Ordering};

use kc_api_dto::endpoints::api_req_nyukyo::*;
use kc_api_interface::interface::{EmitData, Set};
use kc_api_interface::n_dock::NDocks;

use crate::{register_trait, TraitForConvert};

static PENDING_SPEEDCHANGE_NDOCK_ID: AtomicI64 = AtomicI64::new(0);

register_trait!(Req, (start));
register_trait!(Res, (start));

impl TraitForConvert for speedchange::Req {
    type Output = EmitData;

    fn convert(&self) -> Option<Vec<EmitData>> {
        PENDING_SPEEDCHANGE_NDOCK_ID.store(self.api_ndock_id, Ordering::Relaxed);
        None
    }
}

impl TraitForConvert for speedchange::Res {
    type Output = EmitData;

    fn convert(&self) -> Option<Vec<EmitData>> {
        let ndock_id = PENDING_SPEEDCHANGE_NDOCK_ID.swap(0, Ordering::Relaxed);
        if self.api_result != 1 || ndock_id <= 0 {
            return None;
        }
        let mut ndocks = NDocks::load();
        let mut updated = false;
        for dock in &mut ndocks.n_docks {
            if dock.id == ndock_id {
                dock.state = 0;
                dock.ship_id = 0;
                dock.complete_time = 0;
                dock.counter = 0;
                dock.item1 = 0;
                dock.item2 = 0;
                dock.item3 = 0;
                dock.item4 = 0;
                updated = true;
                break;
            }
        }
        if !updated {
            return None;
        }
        Some(vec![EmitData::Set(Set::NDocks(ndocks))])
    }
}
