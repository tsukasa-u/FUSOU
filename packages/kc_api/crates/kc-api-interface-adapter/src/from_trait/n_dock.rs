use crate::InterfaceWrapper;
use chrono::Utc;
use kc_api_dto::endpoints as kcapi_main;
use kc_api_interface::n_dock::{NDock, NDocks};

impl From<Vec<kcapi_main::api_port::port::ApiNdock>> for InterfaceWrapper<NDocks> {
    fn from(n_docks: Vec<kcapi_main::api_port::port::ApiNdock>) -> Self {
        let mut n_dock_list = Vec::with_capacity(4);
        // let local_time = chrono::Utc::now().timestamp();
        for n_dock in n_docks {
            n_dock_list.push(InterfaceWrapper::<NDock>::from(n_dock).unwrap());
        }
        Self(NDocks {
            n_docks: n_dock_list,
        })
    }
}

impl From<kcapi_main::api_port::port::ApiNdock> for InterfaceWrapper<NDock> {
    fn from(n_dock: kcapi_main::api_port::port::ApiNdock) -> Self {
        let local_time = Utc::now().timestamp();
        Self(NDock {
            ship_id: n_dock.api_ship_id,
            complete_time: n_dock.api_complete_time,
            counter: n_dock.api_complete_time - local_time,
            item1: n_dock.api_item1,
            item2: n_dock.api_item2,
            item3: n_dock.api_item3,
            item4: n_dock.api_item4,
        })
    }
}
