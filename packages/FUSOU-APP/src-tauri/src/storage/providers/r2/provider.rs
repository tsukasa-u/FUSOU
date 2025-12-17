use std::sync::Arc;
use kc_api::database::table::{GetDataTableEncode, PortTableEncode};
use kc_api::database::batch_upload::BatchUploadBuilder;

use crate::storage::service::{StorageError, StorageFuture, StorageProvider};
use crate::storage::common::get_all_port_tables;

use fusou_upload::{PendingStore, UploadRetryService, Uploader, UploadRequest, UploadResult, UploadContext};
use fusou_auth::{AuthManager, FileStorage};
use std::path::PathBuf;

const R2_STORAGE_PROVIDER_NAME: &str = "r2";

#[derive(Clone)]
pub struct R2StorageProvider {
    pending_store: Arc<PendingStore>,
    _retry_service: Arc<UploadRetryService>,
    auth_manager: Arc<AuthManager<FileStorage>>,
}

impl R2StorageProvider {
    pub fn new(pending_store: Arc<PendingStore>, retry_service: Arc<UploadRetryService>) -> Self {
        tracing::info!("R2StorageProvider::new() called - initializing provider");
        
        let auth_manager = retry_service.auth_manager();

        tracing::info!("R2StorageProvider initialized successfully");
        
        Self {
            pending_store,
            _retry_service: retry_service,
            auth_manager,
        }
    }

    /// Upload a single .bin file with tag-based identification using common Uploader
    async fn upload_to_r2(&self, tag: &str, dataset_id: &str, table_name: &str, data: Vec<u8>, table_offsets: String) -> Result<(), StorageError> {
        let file_size = data.len();
        tracing::debug!("Uploading to R2: tag={}, dataset={}, table={}, size={}", tag, dataset_id, table_name, file_size);

        let configs = configs::get_user_configs_for_app();
        let db_config = configs.database;
        let r2_config = &db_config.r2;

        if !db_config.get_allow_data_to_shared_cloud() {
            return Err(StorageError::Operation(
                "R2 shared database upload is disabled in config".into(),
            ));
        }

        let endpoint = r2_config
            .get_upload_endpoint()
            .unwrap_or_default();

        if endpoint.is_empty() {
            return Err(StorageError::Operation(
                "r2 upload endpoint not configured".into(),
            ));
        }

        // Build handshake request via common helper
        let handshake_body = fusou_upload::Uploader::build_battle_data_handshake(tag, dataset_id, table_name, file_size as u64, &table_offsets);

        let mut headers = std::collections::HashMap::new();
        headers.insert("Content-Type".to_string(), "application/octet-stream".to_string());

        let request = UploadRequest {
            endpoint: &endpoint,
            handshake_body,
            data,
            headers,
            context: UploadContext::Custom(serde_json::json!({
                "provider": "r2",
                "tag": tag,
                "dataset_id": dataset_id,
                "table": table_name,
                "table_offsets": table_offsets,
            })),
        };

        let client = reqwest::Client::new();
        
        match Uploader::upload(&client, &self.auth_manager, request, Some(&self.pending_store)).await {
            Ok(UploadResult::Success) => {
                tracing::info!("Successfully uploaded to R2: tag={}, size={}", tag, file_size);
                Ok(())
            }
            Ok(UploadResult::Skipped) => {
                tracing::info!("R2 upload skipped (already exists): tag={}", tag);
                Ok(())
            }
            Err(e) => {
                tracing::error!("R2 upload failed: tag={}, error={}", tag, e);
                Err(StorageError::Operation(format!("Upload failed: {}", e)))
            }
        }
    }

}

impl StorageProvider for R2StorageProvider {
    fn name(&self) -> &'static str {
        R2_STORAGE_PROVIDER_NAME
    }

    fn write_get_data_table<'a>(
        &'a self,
        _period_tag: &'a str,
        _table: &'a GetDataTableEncode,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            // R2: get_data_table (master data) is not uploaded to R2
            // Only port_table (transaction data) is uploaded
            tracing::debug!("R2: Skipping get_data_table upload (master data not stored in R2)");
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
               // Get user_env_id (per-installation unique identifier to use as dataset_id)
               let user_env_id = crate::util::get_user_env_id().await;
            tracing::info!(
                "R2StorageProvider::write_port_table CALLED: period={}, map={}-{}",
                period_tag, maparea_id, mapinfo_no
            );
            
            // Collect all non-empty Avro tables into HashMap
            let mut tables = std::collections::HashMap::new();
            for (table_name, bytes) in get_all_port_tables(table) {
                if bytes.is_empty() {
                    tracing::debug!(
                        "Skipping empty {} table for map {}-{}",
                        table_name,
                        maparea_id,
                        mapinfo_no
                    );
                    continue;
                }
                tables.insert(table_name.to_string(), bytes.to_vec());
            }

            if tables.is_empty() {
                tracing::warn!(
                    "No port_table data to upload for map {}-{}",
                    maparea_id,
                    mapinfo_no
                );
                return Ok(());
            }

            tracing::info!("Building Parquet batch upload for {} tables", tables.len());

            // Convert Avro → Parquet using BatchUploadBuilder
            let batch = tokio::task::spawn_blocking(move || {
                let mut builder = BatchUploadBuilder::new();
                for (table_name, avro_data) in tables {
                    builder.add_table(table_name, avro_data);
                }
                builder.build()
            })
            .await
            .map_err(|e| StorageError::Operation(format!("Task join error: {}", e)))?
            .map_err(|e| StorageError::Operation(format!("Failed to build Parquet batch: {}", e)))?;

            tracing::info!(
                "Parquet batch built: {} bytes total, {} tables",
                batch.total_bytes,
                batch.metadata.len()
            );

            // Serialize table offset metadata to JSON
            let table_offsets = serde_json::to_string(&batch.metadata)
                .map_err(|e| StorageError::Operation(format!("Failed to serialize metadata: {}", e)))?;

            // Upload concatenated Parquet data as single .bin file
            let tag = format!("{}-port-{}-{}", period_tag, maparea_id, mapinfo_no);
            let size = batch.data.len();
            self.upload_to_r2(&tag, &user_env_id, "port_table", batch.data, table_offsets).await?;

            tracing::info!(
                "Uploaded Parquet batch to R2: period={}, map={}-{}, size={}",
                period_tag, maparea_id, mapinfo_no, size
            );
            Ok(())
        })
    }

    fn integrate_port_table<'a>(
        &'a self,
        period_tag: &'a str,
        _page_size: i32,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            // For R2, integration happens via server-side scheduled jobs
            // defined in FUSOU-WEB's _scheduled.ts
            // This is a no-op on the client side
            tracing::debug!(
                "R2: Integration processing scheduled on server for period {}",
                period_tag
            );
            Ok(())
        })
    }
}

