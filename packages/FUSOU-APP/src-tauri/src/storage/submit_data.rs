use kc_api::{
    database::table::{GetDataTable, PortTable, PortTableEncode},
    interface::cells::Cells,
};

use crate::{
    auth::supabase,
    storage::service::{acquire_port_table_guard, StorageService},
    util::get_local_fallback_id,
};

use fusou_upload::{PendingStore, UploadRetryService};
use std::sync::Arc;
use once_cell::sync::Lazy;
use tokio::sync::Mutex;

type StorageDeps = (Arc<PendingStore>, Arc<UploadRetryService>);

static STORAGE_DEPS: Lazy<Mutex<Option<StorageDeps>>> = Lazy::new(|| Mutex::new(None));

pub async fn initialize_storage_deps(pending_store: Arc<PendingStore>, retry_service: Arc<UploadRetryService>) {
    let mut deps = STORAGE_DEPS.lock().await;
    *deps = Some((pending_store, retry_service));
}

pub fn submit_get_data_table() {
    tokio::task::spawn(async move {
        let deps_opt = {
            let deps = STORAGE_DEPS.lock().await;
            deps.clone()
        };

        let Some((pending_store, retry_service)) = deps_opt else {
            tracing::warn!("Storage dependencies not initialized for submit_get_data_table");
            return;
        };

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
            let deps_opt = {
                let deps = STORAGE_DEPS.lock().await;
                deps.clone()
            };

            let Some((pending_store, retry_service)) = deps_opt else {
                tracing::warn!("Storage dependencies not initialized for submit_port_table");
                return;
            };

            let Some(storage_service) = StorageService::get_instance(pending_store, retry_service.clone()).await else {
                return;
            };

            let _guard = acquire_port_table_guard().await;

            let user_env = retry_service
                .auth_manager()
                .resolve_dataset_id_for_upload(None)
                .await
                .unwrap_or_default();
            let user_env = if user_env.trim().is_empty() {
                get_local_fallback_id().await
            } else {
                user_env
            };
            let timestamp = chrono::Utc::now().timestamp();
            let port_table = PortTable::new(cells, user_env, timestamp);

            match port_table.encode_non_empty_tables() {
                Ok(tables) => {
                    if tables.is_empty() {
                        tracing::info!("submit_port_table: all tables empty — skipping upload");
                        Cells::reset();
                        return;
                    }

                    // Build a PortTableEncode with only the present tables filled.
                    // PortTableEncode is now an enum-keyed map, so a wrong assignment
                    // is impossible: each entry is keyed by its `PortTableEnum` variant.
                    let encode: PortTableEncode = tables.into();

                    let pariod_tag = supabase::get_period_tag().await;
                    let upload_success = storage_service
                        .write_port_table(&pariod_tag, encode, maparea_id, mapinfo_no)
                        .await;
                    if !upload_success {
                        tracing::warn!(
                            "submit_port_table: upload failed for all providers; retry pipeline will handle pending uploads"
                        );
                    }
                    Cells::reset();
                }
                Err(e) => {
                    tracing::error!("Failed to encode port table (non-empty): {}", e);
                }
            }
        });
    } else {
        tracing::info!("submit_port_table: skipped (Cells reset_flag true, no accumulated data)");
    }
}
