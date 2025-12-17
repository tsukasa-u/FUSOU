use crate::{
    auth::supabase,
    storage::service::{acquire_port_table_guard, StorageService},
};
use tokio;
use fusou_upload::{PendingStore, UploadRetryService};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use once_cell::sync::Lazy;

// Prevent concurrent integration jobs from running
static INTEGRATION_IN_PROGRESS: Lazy<Arc<AtomicBool>> = Lazy::new(|| Arc::new(AtomicBool::new(false)));

pub fn integrate_port_table(
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>
) {
    // Quick check to prevent redundant integration jobs
    if INTEGRATION_IN_PROGRESS.compare_exchange(
        false,
        true,
        Ordering::SeqCst,
        Ordering::SeqCst,
    ).is_err() {
        tracing::info!("Integration already in progress, skipping this trigger");
        return;
    }

    tokio::task::spawn(async move {
        let Some(storage_service) = StorageService::get_instance(pending_store, retry_service).await else {
            INTEGRATION_IN_PROGRESS.store(false, Ordering::SeqCst);
            return;
        };

        let _guard = acquire_port_table_guard().await;

        tracing::info!("Start to integrate port table in cloud storage");

        let pariod_tag = supabase::get_period_tag().await;
        let page_size = configs::get_user_configs_for_app()
            .database
            .google_drive
            .get_page_size() as i32;
        
        match tokio::time::timeout(
            tokio::time::Duration::from_secs(3600), // 1 hour timeout
            storage_service.integrate_port_table(&pariod_tag, page_size)
        ).await {
            Ok(_) => {
                tracing::info!("Finished integrate port table tasks");
            }
            Err(_) => {
                tracing::error!("Integration timeout after 1 hour");
            }
        }
        
        INTEGRATION_IN_PROGRESS.store(false, Ordering::SeqCst);
    });
}
