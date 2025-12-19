use kc_api::{
    database::table::{GetDataTable, PortTable},
    interface::cells::Cells,
};

use crate::{
    auth::supabase,
    storage::service::{acquire_port_table_guard, StorageService},
    util::get_user_member_id,
};

use fusou_upload::{PendingStore, UploadRetryService};
use std::sync::Arc;
use once_cell::sync::Lazy;
use tokio::sync::Mutex;

static STORAGE_DEPS: Lazy<Mutex<Option<(Arc<PendingStore>, Arc<UploadRetryService>)>>> = Lazy::new(|| Mutex::new(None));

pub async fn initialize_storage_deps(pending_store: Arc<PendingStore>, retry_service: Arc<UploadRetryService>) {
    let mut deps = STORAGE_DEPS.lock().await;
    *deps = Some((pending_store, retry_service));
}

pub fn submit_get_data_table() {
    let deps_opt = STORAGE_DEPS.try_lock().ok().and_then(|d| d.clone());
    let Some((pending_store, retry_service)) = deps_opt else {
        tracing::warn!("Storage dependencies not initialized for submit_get_data_table");
        return;
    };

    tokio::task::spawn(async move {
        let Some(storage_service) = StorageService::get_instance(pending_store, retry_service).await else {
            return;
        };

        let get_data_table = GetDataTable::new();
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
    let deps_opt = STORAGE_DEPS.try_lock().ok().and_then(|d| d.clone());
    let Some((pending_store, retry_service)) = deps_opt else {
        tracing::warn!("Storage dependencies not initialized for submit_port_table");
        return;
    };

    if !Cells::reset_flag() {
        let cells = Cells::load();
        let maparea_id = cells.maparea_id;
        let mapinfo_no = cells.mapinfo_no;
        tracing::info!(
            "submit_port_table: preparing upload map={}-,{} cells={}, battles={}, event_map_present={}",
            maparea_id,
            mapinfo_no,
            cells.cells.len(),
            cells.battles.len(),
            cells.event_map.is_some()
        );
        tokio::task::spawn(async move {
            let Some(storage_service) = StorageService::get_instance(pending_store, retry_service).await else {
                return;
            };

            let _guard = acquire_port_table_guard().await;

            let user_env = get_user_member_id().await;
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
    } else {
        tracing::info!("submit_port_table: skipped (Cells reset_flag true, no accumulated data)");
    }
}
