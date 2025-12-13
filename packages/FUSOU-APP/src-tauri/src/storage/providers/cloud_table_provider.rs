use std::collections::HashMap;
use std::sync::Arc;

use kc_api::database::batch_upload::BatchUploadBuilder;
use kc_api::database::table::{GetDataTableEncode, PortTableEncode, PORT_TABLE_NAMES};
use uuid::Uuid;

use crate::storage::cloud_provider_trait::{CloudProviderFactory, CloudStorageProvider};
use crate::storage::common::{get_all_get_data_tables, get_all_port_tables, generate_master_data_filename, generate_port_table_filename, integrate_by_table_name};
use crate::storage::constants::{GOOGLE_DRIVE_PROVIDER_NAME, MASTER_DATA_FOLDER_NAME, PERIOD_ROOT_FOLDER_NAME, TRANSACTION_DATA_FOLDER_NAME};
use crate::storage::service::{StorageError, StorageFuture, StorageProvider};
use fusou_upload::{PendingStore, UploadContext, UploadRetryService};

/// StorageProvider implementation backed by a CloudStorageProvider.
/// Maintains existing folder/file layout so current consumers remain compatible.
#[derive(Clone)]
pub struct CloudTableStorageProvider {
    provider_name: &'static str,
    cloud: Arc<dyn CloudStorageProvider>,
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
}

impl CloudTableStorageProvider {
    pub fn try_new_google(
        pending_store: Arc<PendingStore>,
        retry_service: Arc<UploadRetryService>,
    ) -> Result<Self, String> {
        // Google is the only concrete cloud target today; factory keeps tokens set at startup.
        let cloud = CloudProviderFactory::create("google")?;
        Ok(Self {
            provider_name: GOOGLE_DRIVE_PROVIDER_NAME,
            cloud: Arc::from(cloud),
            pending_store,
            retry_service,
        })
    }

    async fn ensure_folder(&self, remote_path: &str) -> Result<(), StorageError> {
        self.cloud
            .create_folder(remote_path)
            .await
            .map(|_| ())
            .map_err(|e| StorageError::Operation(format!("failed to create folder {remote_path}: {e}")))
    }

    async fn upload_bytes(&self, remote_path: &str, bytes: &[u8]) -> Result<(), StorageError> {
        let mut temp_path = std::env::temp_dir();
        temp_path.push(format!("fusou-upload-{}", Uuid::new_v4()));
        tokio::fs::write(&temp_path, bytes)
            .await
            .map_err(|e| StorageError::Io(e))?;

        let result = self
            .cloud
            .upload_file(temp_path.as_path(), remote_path)
            .await
            .map(|_| ())
            .map_err(|e| {
                let msg = format!("{e}");
                // Detect auth errors (401/403 pattern in error message) and save for retry
                if msg.contains("401") || msg.contains("403") || msg.contains("Unauthorized") || msg.contains("Forbidden") {
                    let pending_save = self.pending_store.clone();
                    let retry = self.retry_service.clone();
                    let provider = self.provider_name.to_string();
                    let path = remote_path.to_string();
                    let data = bytes.to_vec();
                    tokio::spawn(async move {
                        let mut headers = HashMap::new();
                        headers.insert("remote-path".to_string(), path.clone());
                        let context = UploadContext::Custom(serde_json::json!({ "operation": "upload", "remote_path": path }));
                        let context_str = serde_json::to_string(&context).unwrap_or_default();
                        if let Err(e) = pending_save.save_pending(&provider, &headers, &data, Some(context_str)) {
                            tracing::warn!(error = %e, "failed to save pending upload");
                        } else {
                            tracing::info!("saved pending upload for retry");
                            retry.trigger_retry().await;
                        }
                    });
                }
                StorageError::Operation(msg)
            });

        let _ = tokio::fs::remove_file(&temp_path).await;
        result
    }

    async fn download_bytes(&self, remote_path: &str) -> Result<Vec<u8>, StorageError> {
        let mut temp_path = std::env::temp_dir();
        temp_path.push(format!("fusou-download-{}", Uuid::new_v4()));

        self
            .cloud
            .download_file(remote_path, temp_path.as_path())
            .await
            .map_err(|e| StorageError::Operation(format!("download failed for {remote_path}: {e}")))?;

        let bytes = tokio::fs::read(&temp_path)
            .await
            .map_err(StorageError::Io)?;

        let _ = tokio::fs::remove_file(&temp_path).await;
        Ok(bytes)
    }

    async fn delete_file(&self, remote_path: &str) {
        if let Err(e) = self.cloud.delete_file(remote_path).await {
            tracing::warn!(remote_path, error = %e, "failed to delete remote file");
        }
    }

    fn master_folder(period_tag: &str) -> String {
        format!(
            "{root}/{period}/{master}",
            root = PERIOD_ROOT_FOLDER_NAME,
            period = period_tag,
            master = MASTER_DATA_FOLDER_NAME
        )
    }

    fn transaction_root(period_tag: &str) -> String {
        format!(
            "{root}/{period}/{txn}",
            root = PERIOD_ROOT_FOLDER_NAME,
            period = period_tag,
            txn = TRANSACTION_DATA_FOLDER_NAME
        )
    }

    /// Upload multiple tables as a single concatenated Parquet file
    ///
    /// # Arguments
    /// * `remote_path` - Path for the concatenated file
    /// * `tables` - HashMap of table_name -> avro_bytes
    ///
    /// # Returns
    /// JSON string containing metadata about table offsets
    async fn upload_batch_tables(
        &self,
        remote_path: &str,
        tables: HashMap<String, Vec<u8>>,
    ) -> Result<String, StorageError> {
        if tables.is_empty() {
            return Err(StorageError::Operation("No tables to upload".to_string()));
        }

        tracing::info!("Building batch upload for {} tables", tables.len());

        // Build batch upload with Avro → Parquet conversion and concatenation
        let mut builder = BatchUploadBuilder::new();
        for (table_name, avro_data) in tables {
            builder.add_table(table_name, avro_data);
        }

        let batch = builder.build().map_err(|e| {
            StorageError::Operation(format!("Failed to build batch upload: {}", e))
        })?;

        tracing::info!(
            "Batch built: {} bytes total, {} tables",
            batch.total_bytes,
            batch.metadata.len()
        );

        // Upload concatenated binary
        self.upload_bytes(remote_path, &batch.data).await?;

        // Return metadata as JSON
        let metadata_json = serde_json::to_string(&batch.metadata).map_err(|e| {
            StorageError::Operation(format!("Failed to serialize metadata: {}", e))
        })?;

        Ok(metadata_json)
    }
}

impl StorageProvider for CloudTableStorageProvider {
    fn name(&self) -> &'static str {
        self.provider_name
    }

    fn write_get_data_table<'a>(
        &'a self,
        period_tag: &'a str,
        table: &'a GetDataTableEncode,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            let master_dir = Self::master_folder(period_tag);
            self.ensure_folder(&master_dir).await?;

            // Collect all tables into HashMap
            let mut tables = HashMap::new();
            for (table_name, bytes) in get_all_get_data_tables(table) {
                if bytes.is_empty() {
                    tracing::warn!(table_name, "Skipping empty master table");
                    continue;
                }
                tables.insert(table_name.to_string(), bytes.to_vec());
            }

            if tables.is_empty() {
                tracing::warn!("No non-empty get_data tables to upload");
                return Ok(());
            }

            // Upload as single concatenated Parquet file
            let file_name = generate_master_data_filename("master");
            let batch_path = format!("{master_dir}/{file_name}.parquet");
            let metadata_json = self.upload_batch_tables(batch_path.as_str(), tables).await?;

            // Save metadata alongside data file
            let metadata_path = format!("{master_dir}/{file_name}.metadata.json");
            self.upload_bytes(&metadata_path, metadata_json.as_bytes()).await?;

            tracing::info!("Uploaded batch master data: period={}, file={}", period_tag, file_name);

            Ok(())
        })
    }

    fn write_port_table<'a>(
        &'a self,
        period_tag: &'a str,
        table: &'a PortTableEncode,
        maparea_id: i64,
        mapinfo_no: i64,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            let txn_root = Self::transaction_root(period_tag);
            self.ensure_folder(&txn_root).await?;

            let map_folder = format!("{}/{}-{}", txn_root, maparea_id, mapinfo_no);
            self.ensure_folder(&map_folder).await?;

            // Collect all non-empty tables into HashMap
            let mut tables = HashMap::new();
            for (table_name, bytes) in get_all_port_tables(table) {
                if bytes.is_empty() {
                    tracing::warn!(table_name, "Skipping empty table");
                    continue;
                }
                tables.insert(table_name.to_string(), bytes.to_vec());
            }

            if tables.is_empty() {
                tracing::warn!("No non-empty port tables to upload");
                return Ok(());
            }

            // Upload as single concatenated Parquet file
            let file_name = generate_port_table_filename();
            let batch_path = format!("{map_folder}/{file_name}.parquet");
            let metadata_json = self.upload_batch_tables(batch_path.as_str(), tables).await?;

            // Save metadata alongside data file
            let metadata_path = format!("{map_folder}/{file_name}.metadata.json");
            self.upload_bytes(&metadata_path, metadata_json.as_bytes()).await?;

            tracing::info!(
                "Uploaded batch port table: map={}-{}, file={}",
                maparea_id,
                mapinfo_no,
                file_name
            );

            Ok(())
        })
    }

    fn integrate_port_table<'a>(
        &'a self,
        period_tag: &'a str,
        page_size: i32,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        // page_size is unused in this implementation because listing is unpaged.
        let _ = page_size;
        Box::pin(async move {
            let txn_root = Self::transaction_root(period_tag);
            // If the root doesn't exist, nothing to integrate.
            if let Err(e) = self.ensure_folder(&txn_root).await {
                tracing::warn!(error = %e, "transaction root missing; skipping integration");
                return Ok(());
            }

            let map_folders = match self.cloud.list_files(&txn_root).await {
                Ok(list) => list,
                Err(e) => {
                    tracing::warn!(error = %e, "failed to list map folders for integration");
                    return Ok(());
                }
            };

            for map_folder_name in map_folders {
                let map_folder = format!("{txn_root}/{map_folder_name}");
                let file_name = generate_port_table_filename();
                let folder_names = PORT_TABLE_NAMES.clone();

                for table_name in folder_names {
                    let table_dir = format!("{map_folder}/{table_name}");
                    let file_list = match self.cloud.list_files(&table_dir).await {
                        Ok(list) => list,
                        Err(e) => {
                            tracing::warn!(table_name, error = %e, "failed to list table folder");
                            continue;
                        }
                    };

                    if file_list.len() <= 1 {
                        continue;
                    }

                    let mut contents = Vec::new();
                    for fname in file_list.iter() {
                        let remote_path = format!("{table_dir}/{fname}");
                        match self.download_bytes(&remote_path).await {
                            Ok(bytes) => contents.push(bytes),
                            Err(e) => {
                                tracing::warn!(remote_path, error = %e, "failed to download for integration");
                                continue;
                            }
                        }
                    }

                    if contents.is_empty() {
                        continue;
                    }

                    match integrate_by_table_name(&table_name, contents) {
                        Ok(integrated) => {
                            if integrated.is_empty() {
                                continue;
                            }
                            let remote_path = format!("{table_dir}/{file_name}");
                            if let Err(e) = self.upload_bytes(&remote_path, &integrated).await {
                                tracing::warn!(table_name, error = %e, "failed to upload integrated file");
                                continue;
                            }
                            for fname in file_list {
                                let remote_path = format!("{table_dir}/{fname}");
                                self.delete_file(&remote_path).await;
                            }
                        }
                        Err(e) => {
                            tracing::warn!(table_name, error = %e, "integration failed");
                            continue;
                        }
                    }
                }
            }
            Ok(())
        })
    }
}
