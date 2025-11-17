use std::{future::Future, pin::Pin, sync::Arc};
use kc_api::database::table::{GetDataTableEncode, PortTableEncode};
use tokio::sync::{Mutex, OnceCell};

use crate::cloud_storage::{
    google_drive::GoogleDriveProvider,
    local_fs::LocalFileSystemProvider,
};

pub type StorageFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug)]
pub enum StorageError {
    ClientUnavailable,
    Io(std::io::Error),
    Operation(String),
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StorageError::ClientUnavailable => write!(f, "storage client is unavailable"),
            StorageError::Io(err) => write!(f, "io error: {err}"),
            StorageError::Operation(reason) => write!(f, "{reason}"),
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
    pub fn resolve() -> Option<StorageService> {
        let app_configs = configs::get_user_configs_for_app();
        let database_config = app_configs.database;
        let mut providers: Vec<Arc<dyn StorageProvider>> = Vec::new();

        if database_config.get_allow_data_to_cloud() {
            providers.push(Arc::new(GoogleDriveProvider::default()));
        }

        if database_config.get_allow_data_to_local() {
            match LocalFileSystemProvider::try_new(database_config.local.get_output_directory()) {
                Ok(provider) => providers.push(Arc::new(provider)),
                Err(err) => {
                    tracing::error!("Failed to initialize local storage provider: {err}");
                }
            }
        }

        if providers.is_empty() {
            None
        } else {
            Some(StorageService {
                providers: Arc::new(providers),
            })
        }
    }

    pub async fn write_get_data_table(
        &self,
        period_tag: &str,
        table: GetDataTableEncode,
    ) {
        for provider in self.providers.iter() {
            if let Err(err) = provider.write_get_data_table(period_tag, &table).await {
                tracing::warn!(
                    "{} storage failed to write get_data_table: {}",
                    provider.name(),
                    err
                );
            }
        }
    }

    pub async fn write_port_table(
        &self,
        period_tag: &str,
        table: PortTableEncode,
    ) {
        for provider in self.providers.iter() {
            if let Err(err) = provider.write_port_table(period_tag, &table).await {
                tracing::warn!(
                    "{} storage failed to write port_table: {}",
                    provider.name(),
                    err
                );
            }
        }
    }

    pub async fn integrate_port_table(
        &self,
        period_tag: &str,
        page_size: i32,
    ) {
        for provider in self.providers.iter() {
            if let Err(err) = provider.integrate_port_table(period_tag, page_size).await {
                tracing::warn!(
                    "{} storage failed to integrate port_table: {}",
                    provider.name(),
                    err
                );
            }
        }
    }
}
