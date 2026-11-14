use kc_api::{
    database::table::{GetDataTable, PortTable, PortTableEncode},
    interface::cells::Cells,
};

use crate::{
    auth::supabase,
    storage::service::{acquire_port_table_guard, StorageService},
    util::get_local_fallback_id,
};

use fusou_auth::{AuthManager, FileStorage};
use fusou_upload::{PendingStore, UploadContext, UploadRetryService};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

type StorageDeps = (Arc<PendingStore>, Arc<UploadRetryService>);

static STORAGE_DEPS: Lazy<Mutex<Option<StorageDeps>>> = Lazy::new(|| Mutex::new(None));

pub async fn initialize_storage_deps(
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
) {
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

        let Some(storage_service) =
            StorageService::get_instance(pending_store, retry_service).await
        else {
            return;
        };

        let get_data_table = GetDataTable::new();
        match get_data_table.encode() {
            Ok(get_data_table_encode) => {
                let Some(pariod_tag) = supabase::get_period_tag().await else {
                    tracing::warn!("submit_get_data_table: kc-period tag is unavailable; skipping upload to protect data integrity");
                    return;
                };
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct DeferredPortTablePayload {
    pub cells: Cells,
    pub timestamp: i64,
}

#[derive(Debug, PartialEq, Eq)]
enum PortTableDispatchOutcome {
    Uploaded,
    SkippedEmpty,
    StorageDisabled,
    DeferredTemporary(&'static str),
    Failed(String),
}

fn is_any_storage_provider_configured() -> bool {
    let database = configs::get_user_configs_for_app().database;
    database.get_allow_data_to_cloud()
        || database.get_allow_data_to_local()
        || database.get_allow_data_to_shared_cloud()
}

fn save_deferred_port_table(
    pending_store: &PendingStore,
    cells: &Cells,
    timestamp: i64,
) -> Result<(), String> {
    let payload = DeferredPortTablePayload {
        cells: cells.clone(),
        timestamp,
    };
    let payload_bytes = serde_json::to_vec(&payload)
        .map_err(|e| format!("Failed to serialize deferred port table payload: {e}"))?;
    let context_json = serde_json::to_string(&UploadContext::Custom(serde_json::json!({
        "operation": "deferred_port_table",
        "timestamp": timestamp,
        "maparea_id": cells.maparea_id,
        "mapinfo_no": cells.mapinfo_no,
    })))
    .map_err(|e| format!("Failed to serialize deferred port table context: {e}"))?;

    pending_store
        .save_pending(
            "deferred_port_table",
            &HashMap::new(),
            &payload_bytes,
            Some(context_json),
        )
        .map(|_| ())
        .map_err(|e| format!("Failed to save deferred port table to pending store: {e}"))
}

async fn attempt_port_table_upload(
    storage_service_opt: Option<&StorageService>,
    storage_configured: bool,
    period_tag_opt: Option<String>,
    cells: &Cells,
    timestamp: i64,
    auth_manager: &AuthManager<FileStorage>,
) -> PortTableDispatchOutcome {
    let Some(storage_service) = storage_service_opt else {
        if storage_configured {
            return PortTableDispatchOutcome::DeferredTemporary(
                "storage service temporarily unavailable",
            );
        }
        return PortTableDispatchOutcome::StorageDisabled;
    };

    let Some(period_tag) = period_tag_opt else {
        return PortTableDispatchOutcome::DeferredTemporary("kc-period tag unavailable");
    };

    let _guard = acquire_port_table_guard().await;

    let user_env = crate::util::resolve_dataset_id_for_current_member(auth_manager)
        .await
        .unwrap_or_default();
    let user_env = if user_env.trim().is_empty() {
        get_local_fallback_id().await
    } else {
        user_env
    };

    let maparea_id = cells.maparea_id;
    let mapinfo_no = cells.mapinfo_no;
    let port_table = PortTable::new(cells.clone(), user_env, timestamp);

    match port_table.encode_non_empty_tables() {
        Ok(tables) => {
            if tables.is_empty() {
                tracing::info!("submit_port_table: all tables empty — skipping upload");
                return PortTableDispatchOutcome::SkippedEmpty;
            }

            let encode: PortTableEncode = tables.into();
            let upload_success = storage_service
                .write_port_table(&period_tag, encode, maparea_id, mapinfo_no)
                .await;
            if !upload_success {
                tracing::warn!(
                    "submit_port_table: upload failed for all providers; retry pipeline will handle pending uploads"
                );
            }
            PortTableDispatchOutcome::Uploaded
        }
        Err(e) => PortTableDispatchOutcome::Failed(format!(
            "Failed to encode port table (non-empty): {e}"
        )),
    }
}

async fn process_captured_port_table(
    cells: Cells,
    timestamp: i64,
    deps_opt: Option<StorageDeps>,
) {
    let Some((pending_store, retry_service)) = deps_opt else {
        if Cells::reset_flag() {
            cells.restore();
            tracing::warn!(
                "Storage dependencies not initialized for submit_port_table; restored captured Cells"
            );
        } else {
            tracing::warn!(
                "Storage dependencies not initialized for submit_port_table and newer sortie already started; skipping restore to avoid clobbering active sortie"
            );
        }
        return;
    };

    let storage_service = StorageService::get_instance(pending_store.clone(), retry_service.clone()).await;
    let period_tag = if storage_service.is_some() {
        supabase::get_period_tag().await
    } else {
        None
    };

    let auth_manager = retry_service.auth_manager();
    match attempt_port_table_upload(
        storage_service,
        is_any_storage_provider_configured(),
        period_tag,
        &cells,
        timestamp,
        auth_manager.as_ref(),
    )
    .await
    {
        PortTableDispatchOutcome::DeferredTemporary(reason) => {
            tracing::warn!(
                "submit_port_table: {reason}; persisting deferred payload to PendingStore"
            );
            if let Err(err) = save_deferred_port_table(&pending_store, &cells, timestamp) {
                tracing::error!("{err}");
            }
        }
        PortTableDispatchOutcome::Failed(err) => {
            tracing::error!("{err}");
        }
        PortTableDispatchOutcome::Uploaded
        | PortTableDispatchOutcome::SkippedEmpty
        | PortTableDispatchOutcome::StorageDisabled => {}
    }
}

pub(crate) async fn retry_deferred_port_table(
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
    data: &[u8],
    auth_manager: &AuthManager<FileStorage>,
) -> Result<(), String> {
    let payload: DeferredPortTablePayload = serde_json::from_slice(data)
        .map_err(|e| format!("Invalid deferred_port_table payload: {e}"))?;

    let storage_service = StorageService::get_instance(pending_store, retry_service).await;
    let period_tag = if storage_service.is_some() {
        supabase::get_period_tag().await
    } else {
        None
    };

    match attempt_port_table_upload(
        storage_service,
        is_any_storage_provider_configured(),
        period_tag,
        &payload.cells,
        payload.timestamp,
        auth_manager,
    )
    .await
    {
        PortTableDispatchOutcome::Uploaded
        | PortTableDispatchOutcome::SkippedEmpty
        | PortTableDispatchOutcome::StorageDisabled => Ok(()),
        PortTableDispatchOutcome::DeferredTemporary(reason) => Err(reason.to_string()),
        PortTableDispatchOutcome::Failed(err) => Err(err),
    }
}

pub fn submit_port_table() {
    if !Cells::reset_flag() {
        let cells = Cells::load();
        // Reset synchronously before spawning so a new sortie starting concurrently is never wiped.
        Cells::reset();
        let timestamp = chrono::Utc::now().timestamp();
        tracing::info!(
            "submit_port_table: preparing upload map={}-,{} cells={}, battles={}, event_map_present={}",
            cells.maparea_id,
            cells.mapinfo_no,
            cells.cells.len(),
            cells.battles.len(),
            cells.event_map.is_some()
        );
        tokio::task::spawn(async move {
            let deps_opt = {
                let deps = STORAGE_DEPS.lock().await;
                deps.clone()
            };
            process_captured_port_table(cells, timestamp, deps_opt).await;
        });
    } else {
        tracing::info!("submit_port_table: skipped (Cells reset_flag true, no accumulated data)");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fusou_auth::{manager::AuthConfig, AuthManager, FileStorage};
    use uuid::Uuid;

    static CELLS_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[tokio::test]
    async fn deferred_port_table_persists_when_period_tag_missing_and_isolates_next_sortie() {
        let _test_guard = CELLS_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        Cells::reset();

        let mut sortie1 = Cells::load();
        sortie1.maparea_id = 1;
        sortie1.mapinfo_no = 5;
        sortie1.restore();

        let captured = Cells::load();
        Cells::reset();
        assert!(Cells::reset_flag());

        // Simulate a new sortie starting before the deferred upload attempt finishes.
        let mut sortie2 = Cells::load();
        sortie2.maparea_id = 2;
        sortie2.mapinfo_no = 3;
        sortie2.restore();

        let temp_dir = std::env::temp_dir().join(format!("fusou-submit-data-{}", Uuid::new_v4()));
        let pending_store = Arc::new(PendingStore::new(temp_dir.join("pending")));
        let auth_manager = AuthManager::new(
            AuthConfig {
                supabase_url: "http://127.0.0.1:9".to_string(),
                api_key: "test-key".to_string(),
                refresh_path: "/auth/v1/token".to_string(),
                refresh_margin_secs: 30,
            },
            Arc::new(FileStorage::new(temp_dir.join("session.json"))),
        );

        let timestamp = 1_793_180_000_i64;
        let outcome = attempt_port_table_upload(
            None,
            true,
            None,
            &captured,
            timestamp,
            &auth_manager,
        )
        .await;
        assert_eq!(
            outcome,
            PortTableDispatchOutcome::DeferredTemporary("storage service temporarily unavailable")
        );

        save_deferred_port_table(&pending_store, &captured, timestamp)
            .expect("saves deferred payload to PendingStore");

        let pending = pending_store.list_pending();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].target_url, "deferred_port_table");

        let stored_bytes = pending_store
            .read_data(&pending[0])
            .expect("reads deferred payload bytes");
        let decoded: DeferredPortTablePayload =
            serde_json::from_slice(&stored_bytes).expect("deserializes DeferredPortTablePayload");
        assert_eq!(decoded.cells.maparea_id, 1);
        assert_eq!(decoded.cells.mapinfo_no, 5);
        assert_eq!(decoded.timestamp, timestamp);

        // Sortie 2 must remain intact in global KCS_CELLS.
        let active_cells = Cells::load();
        assert_eq!(active_cells.maparea_id, 2);
        assert_eq!(active_cells.mapinfo_no, 3);

        // Missing deps early-startup restore must not overwrite an active sortie 2,
        // and must restore if KCS_CELLS is still reset.
        process_captured_port_table(captured.clone(), timestamp, None).await;
        assert_eq!(Cells::load().maparea_id, 2);

        Cells::reset();
        process_captured_port_table(captured, timestamp, None).await;
        assert_eq!(Cells::load().maparea_id, 1);
        assert_eq!(Cells::load().mapinfo_no, 5);

        Cells::reset();
        let _ = std::fs::remove_dir_all(temp_dir);
    }
}
