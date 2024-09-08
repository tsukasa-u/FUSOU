use crate::kcapi;
use chrono;

#[derive(Debug)]
pub struct NDocks {
    pub n_docks: Vec<NDock>
}

#[derive(Debug)]
pub struct NDock {
    pub ship_id: i64,
    pub complete_time: i64,
    pub counter: i64,
    pub item1: i64,
    pub item2: i64,
    pub item3: i64,
    pub item4: i64,
}

impl From<Vec<kcapi::api_port::port::ApiNdock>> for NDocks {
    fn from(n_docks: Vec<kcapi::api_port::port::ApiNdock>) -> Self {
        let mut n_dock_list = Vec::with_capacity(4);
        let local_time = chrono::Utc::now().timestamp();
        for n_dock in n_docks {
            n_dock_list.push(n_dock.into());
        }
        Self {
            n_docks: n_dock_list
        }
    }
}

impl From<kcapi::api_port::port::ApiNdock> for NDock {
    fn from(n_dock: kcapi::api_port::port::ApiNdock) -> Self {
        let local_time = chrono::Utc::now().timestamp();
        Self {
            ship_id: n_dock.api_ship_id,
            complete_time: n_dock.api_complete_time.clone(),
            counter: n_dock.api_complete_time - local_time.clone(),
            item1: n_dock.api_item1,
            item2: n_dock.api_item2,
            item3: n_dock.api_item3,
            item4: n_dock.api_item4,
        }
    }
}