use kc_api::database::table::{GetDataTableEncode, PortTableEncode};
use std::{future::Future, pin::Pin, sync::Arc};
use tokio::sync::{Mutex, OnceCell};

use crate::storage::providers::{CloudTableStorageProvider, LocalFileSystemProvider, R2StorageProvider};
use fusou_upload::{PendingStore, UploadRetryService};

pub type StorageFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug)]
pub enum StorageError {
    Io(std::io::Error),
    Operation(String),
    #[allow(dead_code)]
    Authentication,
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StorageError::Io(err) => write!(f, "io error: {err}"),
            StorageError::Operation(reason) => write!(f, "{reason}"),
            StorageError::Authentication => write!(f, "authentication failed"),
        }
    }
}

impl std::error::Error for StorageError {}

impl From<std::io::Error> for StorageError {
    fn from(value: std::io::Error) -> Self {
        StorageError::Io(value)
    }
}

pub trait StorageProvider: Send + Sync {
    fn name(&self) -> &'static str;

    fn write_get_data_table<'a>(
        &'a self,
        period_tag: &'a str,
        table: &'a GetDataTableEncode,
    ) -> StorageFuture<'a, Result<(), StorageError>>;

    fn write_port_table<'a>(
        &'a self,
        period_tag: &'a str,
        table: &'a PortTableEncode,
        maparea_id: i64,
        mapinfo_no: i64,
    ) -> StorageFuture<'a, Result<(), StorageError>>;

    fn integrate_port_table<'a>(
        &'a self,
        period_tag: &'a str,
        page_size: i32,
    ) -> StorageFuture<'a, Result<(), StorageError>>;
}

static PORT_TABLE_ACCESS_GUARD: OnceCell<Mutex<()>> = OnceCell::const_new();

pub async fn acquire_port_table_guard() -> tokio::sync::MutexGuard<'static, ()> {
    PORT_TABLE_ACCESS_GUARD
        .get_or_init(|| async { Mutex::new(()) })
        .await
        .lock()
        .await
}

#[derive(Clone)]
pub struct StorageService {
    providers: Arc<Vec<Arc<dyn StorageProvider>>>,
}

impl StorageService {
    pub fn resolve(
        pending_store: Arc<PendingStore>,
        retry_service: Arc<UploadRetryService>
    ) -> Option<StorageService> {
        let app_configs = configs::get_user_configs_for_app();
        let database_config = app_configs.database;
        let mut providers: Vec<Arc<dyn StorageProvider>> = Vec::new();

        tracing::info!("Resolving storage providers: cloud={}, local={}, shared_cloud={}", 
            database_config.get_allow_data_to_cloud(),
            database_config.get_allow_data_to_local(),
            database_config.get_allow_data_to_shared_cloud()
        );

        if database_config.get_allow_data_to_cloud() {
            tracing::info!("Attempting to initialize Google Drive storage provider");
            match CloudTableStorageProvider::try_new_google(pending_store.clone(), retry_service.clone()) {
                Ok(provider) => {
                    tracing::info!("Google Drive storage provider initialized successfully");
                    providers.push(Arc::new(provider));
                },
                Err(err) => tracing::error!("Failed to initialize cloud storage provider (google): {err}"),
            }
        }

        if database_config.get_allow_data_to_local() {
            tracing::info!("Attempting to initialize local filesystem storage provider");
            match LocalFileSystemProvider::try_new(database_config.local.get_output_directory()) {
                Ok(provider) => {
                    tracing::info!("Local filesystem storage provider initialized successfully");
                    providers.push(Arc::new(provider));
                },
                Err(err) => {
                    tracing::error!("Failed to initialize local storage provider: {err}");
                }
            }
        }

        // Add R2 storage provider when shared cloud sync is enabled
        if database_config.get_allow_data_to_shared_cloud() && database_config.r2.get_enable() {
            tracing::info!("Initializing R2 storage provider");
            providers.push(Arc::new(R2StorageProvider::new(pending_store, retry_service)));
        }

        if providers.is_empty() {
            tracing::warn!("No storage providers initialized - storage disabled");
            None
        } else {
            tracing::info!("Storage service initialized with {} provider(s)", providers.len());
            Some(StorageService {
                providers: Arc::new(providers),
            })
        }
    }

    pub async fn write_get_data_table(&self, period_tag: &str, table: GetDataTableEncode) {
        let mut handles = Vec::new();
        for provider in self.providers.iter().cloned() {
            let table_clone = table.clone();
            let period_clone = period_tag.to_string();
            let provider_name = provider.name().to_string();
            let handle = tokio::spawn(async move {
                if let Err(err) = provider
                    .write_get_data_table(&period_clone, &table_clone)
                    .await
                {
                    tracing::warn!(
                        "{} storage failed to write get_data_table: {}",
                        provider_name,
                        err
                    );
                }
            });
            handles.push(handle);
        }
        for handle in handles {
            let _ = handle.await;
        }
    }

    pub async fn write_port_table(
        &self,
        period_tag: &str,
        table: PortTableEncode,
        maparea_id: i64,
        mapinfo_no: i64,
    ) {
        let mut handles = Vec::new();
        for provider in self.providers.iter().cloned() {
            let table_clone = table.clone();
            let period_clone = period_tag.to_string();
            let provider_name = provider.name().to_string();
            let handle = tokio::spawn(async move {
                if let Err(err) = provider
                    .write_port_table(&period_clone, &table_clone, maparea_id, mapinfo_no)
                    .await
                {
                    tracing::warn!(
                        "{} storage failed to write port_table: {}",
                        provider_name,
                        err
                    );
                }
            });
            handles.push(handle);
        }
        for handle in handles {
            let _ = handle.await;
        }
    }

    pub async fn integrate_port_table(&self, period_tag: &str, page_size: i32) {
        let mut handles = Vec::new();
        for provider in self.providers.iter().cloned() {
            let period_clone = period_tag.to_string();
            let provider_name = provider.name().to_string();
            let handle = tokio::spawn(async move {
                if let Err(err) = provider
                    .integrate_port_table(&period_clone, page_size)
                    .await
                {
                    tracing::warn!(
                        "{} storage failed to integrate port_table: {}",
                        provider_name,
                        err
                    );
                }
            });
            handles.push(handle);
        }
        for handle in handles {
            let _ = handle.await;
        }
    }
}
