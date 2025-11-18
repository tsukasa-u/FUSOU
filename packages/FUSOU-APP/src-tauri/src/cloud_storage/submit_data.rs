use kc_api::{
    database::table::{GetDataTable, PortTable},
    interface::cells::Cells,
};

use crate::{
    auth::supabase,
    cloud_storage::service::{acquire_port_table_guard, StorageService},
    util::get_user_env_id,
};

pub fn submit_get_data_table() {
    let Some(storage_service) = StorageService::resolve() else {
        return;
    };

    let get_data_table = GetDataTable::new();
    tokio::task::spawn(async move {
        match get_data_table.encode() {
            Ok(get_data_table_encode) => {
                let pariod_tag = supabase::get_period_tag().await;
                storage_service
                    .write_get_data_table(&pariod_tag, get_data_table_encode)
                    .await;
            }
            Err(e) => {
                tracing::error!("Failed to encode get data table: {}", e);
            }
        }
    });
}

pub fn submit_port_table() {
    let Some(storage_service) = StorageService::resolve() else {
        return;
    };

    if !Cells::reset_flag() {
        let cells = Cells::load();
        let maparea_id = cells.maparea_id;
        let mapinfo_no = cells.mapinfo_no;
        tokio::task::spawn(async move {
            let _guard = acquire_port_table_guard().await;

            let user_env = get_user_env_id().await;
            let timestamp = chrono::Utc::now().timestamp();
            let port_table = PortTable::new(cells, user_env, timestamp);
            Cells::reset();
            match port_table.encode() {
                Ok(port_table_encode) => {
                    let pariod_tag = supabase::get_period_tag().await;
                    storage_service
                        .write_port_table(&pariod_tag, port_table_encode, maparea_id, mapinfo_no)
                        .await;
                }
                Err(e) => {
                    tracing::error!("Failed to encode port table: {}", e);
                }
            }
        });
    }
}
