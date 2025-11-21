use crate::{
    auth::supabase,
    cloud_storage::service::{acquire_port_table_guard, StorageService},
};
use tokio;

pub fn integrate_port_table() {
    let Some(storage_service) = StorageService::resolve() else {
        return;
    };

    tokio::task::spawn(async move {
        let _guard = acquire_port_table_guard().await;

        tracing::info!("Start to integrate port table in cloud storage");

        let pariod_tag = supabase::get_period_tag().await;
        let page_size = configs::get_user_configs_for_app()
            .database
            .google_drive
            .get_page_size() as i32;
        storage_service
            .integrate_port_table(&pariod_tag, page_size)
            .await;
        tracing::info!("Finished integrate port table tasks");
    });
}
