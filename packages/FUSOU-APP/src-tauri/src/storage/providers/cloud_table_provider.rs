use std::collections::HashMap;
use std::sync::Arc;

use kc_api::database::table::{GetDataTableEncode, PortTableEncode};
use uuid::Uuid;

use crate::storage::cloud_provider_trait::{CloudProviderFactory, CloudStorageProvider};
use crate::storage::common::{get_all_get_data_tables, get_all_port_tables, generate_port_table_filename};
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

    /// Upload individual Avro tables to cloud storage
    ///
    /// # Arguments
    /// * `base_path` - Base directory path for uploads
    /// * `tables` - HashMap of table_name -> avro_bytes
    ///
    /// # Returns
    /// Number of successfully uploaded tables
    async fn upload_avro_tables(
        &self,
        base_path: &str,
        tables: HashMap<String, Vec<u8>>,
    ) -> Result<usize, StorageError> {
        if tables.is_empty() {
            return Err(StorageError::Operation("No tables to upload".to_string()));
        }

        let mut uploaded = 0;
        for (table_name, avro_data) in tables {
            let file_path = format!("{}/{}.avro", base_path, table_name);
            match self.upload_bytes(&file_path, &avro_data).await {
                Ok(_) => {
                    tracing::info!(
                        "Saved {} table to Google Drive: {} ({} bytes)",
                        table_name,
                        file_path,
                        avro_data.len()
                    );
                    uploaded += 1;
                }
                Err(e) => {
                    tracing::warn!("Failed to upload {} table to Google Drive: {}", table_name, e);
                    // Continue uploading other tables even if one fails
                }
            }
        }

        Ok(uploaded)
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
                    continue;
                }
                tables.insert(table_name.to_string(), bytes.to_vec());
            }

            if tables.is_empty() {
                return Ok(());
            }

            // Upload Avro files directly (no Parquet conversion for Google Drive)
            self.upload_avro_tables(&master_dir, tables).await?;

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
                    tracing::warn!(
                        "Skipping write of empty {} table for map {}-{}",
                        table_name,
                        maparea_id,
                        mapinfo_no
                    );
                    continue;
                }
                tables.insert(table_name.to_string(), bytes.to_vec());
            }

            if tables.is_empty() {
                return Ok(());
            }

            // Upload Avro files directly (no Parquet conversion for Google Drive)
            self.upload_avro_tables(&map_folder, tables).await?;

            Ok(())
        })
    }

    fn integrate_port_table<'a>(
        &'a self,
        period_tag: &'a str,
        page_size: i32,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            use kc_api::database::table::PORT_TABLE_NAMES;
            use crate::storage::common::integrate_by_table_name;

            tracing::info!(
                "CloudTableStorageProvider: Starting port table integration for period {}",
                period_tag
            );

            let txn_root = Self::transaction_root(period_tag);
            
            // List all map directories (e.g., "1-5", "2-3") in transaction root
            let map_folders = match self.cloud.list_folders(&txn_root).await {
                Ok(folders) => folders,
                Err(e) => {
                    tracing::warn!("Failed to list transaction folders: {}", e);
                    return Ok(());
                }
            };

            for map_folder in map_folders {
                let map_path = format!("{}/{}", txn_root, map_folder);
                
                // Process each table type
                for table_name in PORT_TABLE_NAMES.iter() {
                    let table_path = format!("{}/{}", map_path, table_name);
                    
                    // List all .avro files in this table directory
                    let files = match self.cloud.list_files(&table_path).await {
                        Ok(files) => files,
                        Err(_) => {
                            // Table directory might not exist, skip
                            continue;
                        }
                    };

                    // Filter .avro files
                    let avro_files: Vec<_> = files
                        .into_iter()
                        .filter(|f| f.ends_with(".avro"))
                        .collect();

                    // Need at least 2 files to integrate
                    if avro_files.len() < 2 {
                        continue;
                    }

                    // Limit files per integration batch
                    let files_to_process: Vec<_> = avro_files
                        .into_iter()
                        .take(page_size as usize)
                        .collect();

                    if files_to_process.len() < 2 {
                        continue;
                    }

                    tracing::info!(
                        "Integrating {} files for table {} in map {}",
                        files_to_process.len(),
                        table_name,
                        map_folder
                    );

                    // Download all files
                    let mut file_contents = Vec::new();
                    for file_name in &files_to_process {
                        let file_path = format!("{}/{}", table_path, file_name);
                        match self.download_bytes(&file_path).await {
                            Ok(content) => file_contents.push(content),
                            Err(e) => {
                                tracing::warn!("Failed to download {}: {}", file_path, e);
                                continue;
                            }
                        }
                    }

                    if file_contents.len() < 2 {
                        tracing::warn!(
                            "Insufficient files downloaded for integration: {} (needed >= 2)",
                            file_contents.len()
                        );
                        continue;
                    }

                    // Integrate files
                    match integrate_by_table_name(table_name, file_contents) {
                        Ok(integrated_content) if !integrated_content.is_empty() => {
                            // Generate new filename
                            let integrated_filename = generate_port_table_filename();
                            let integrated_path = format!("{}/{}", table_path, integrated_filename);

                            // Upload integrated file
                            match self.upload_bytes(&integrated_path, &integrated_content).await {
                                Ok(_) => {
                                    tracing::info!(
                                        "Uploaded integrated file: {} ({} bytes)",
                                        integrated_path,
                                        integrated_content.len()
                                    );

                                    // Delete original files
                                    for file_name in &files_to_process {
                                        let file_path = format!("{}/{}", table_path, file_name);
                                        self.delete_file(&file_path).await;
                                    }
                                }
                                Err(e) => {
                                    tracing::error!(
                                        "Failed to upload integrated file {}: {}",
                                        integrated_path,
                                        e
                                    );
                                }
                            }
                        }
                        Ok(_) => {
                            tracing::warn!("Integration resulted in empty content for {}", table_name);
                        }
                        Err(e) => {
                            tracing::error!("Failed to integrate table {}: {}", table_name, e);
                        }
                    }
                }
            }

            tracing::info!(
                "CloudTableStorageProvider: Completed port table integration for period {}",
                period_tag
            );
            Ok(())
        })
    }
}
