use std::sync::Arc;
use kc_api::database::table::{GetDataTableEncode, PortTableEncode};
use kc_api::database::DATABASE_TABLE_VERSION;

use crate::storage::service::{StorageError, StorageFuture, StorageProvider};
use crate::storage::common::get_all_port_tables;

use fusou_upload::{PendingSaveOutcome, PendingStore, UploadRetryService, Uploader, UploadRequest, UploadResult, UploadContext};
use fusou_auth::{AuthManager, FileStorage};
use sha2::{Digest, Sha256};
// use std::path::PathBuf;

const R2_STORAGE_PROVIDER_NAME: &str = "r2";

// Compile-time constant for the expected number of master data tables
// This must match the number of tables in upload_master_data_tables()
const EXPECTED_MASTER_TABLE_COUNT: usize = 13;

#[derive(Clone)]
pub struct R2StorageProvider {
    pending_store: Arc<PendingStore>,
    _retry_service: Arc<UploadRetryService>,
    auth_manager: Arc<AuthManager<FileStorage>>,
}

impl R2StorageProvider {
    fn mask_identifier(input: &str) -> String {
        if cfg!(debug_assertions) {
            return input.to_string();
        }
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return "********".to_string();
        }
        let chars: Vec<char> = trimmed.chars().collect();
        if chars.len() <= 6 {
            return "********".to_string();
        }
        let head: String = chars.iter().take(3).collect();
        let tail: String = chars.iter().rev().take(2).collect::<Vec<_>>().into_iter().rev().collect();
        format!("{}****{}", head, tail)
    }

    pub fn new(pending_store: Arc<PendingStore>, retry_service: Arc<UploadRetryService>) -> Self {
        tracing::debug!("R2StorageProvider::new() called");
        
        let auth_manager = retry_service.auth_manager();

        tracing::debug!("R2StorageProvider initialized");
        
        Self {
            pending_store,
            _retry_service: retry_service,
            auth_manager,
        }
    }

    /// Get the integration batch size for R2
    /// R2 integration is handled server-side, so batch size is not applicable
    pub fn get_integration_batch_size(&self) -> i32 {
        100 // Default, not used for R2
    }

    /// Upload a single .bin file with tag-based identification using common Uploader
    async fn upload_to_r2(
        &self,
        period_tag: &str,
        path_tag: &str,
        dataset_id: &str,
        table_name: &str,
        data: Vec<u8>,
        table_offsets: String,
    ) -> Result<(), StorageError> {
        let file_size = data.len();
        tracing::debug!(
            "Uploading to R2: period={}, path_tag={}, dataset={}, table={}, size={}",
            period_tag,
            path_tag,
            Self::mask_identifier(dataset_id),
            table_name,
            file_size
        );

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
        let handshake_body = fusou_upload::Uploader::build_battle_data_handshake(
            period_tag,
            path_tag,
            dataset_id,
            table_name,
            file_size as u64,
            &table_offsets,
            DATABASE_TABLE_VERSION,
        );

        let mut headers = std::collections::HashMap::new();
        headers.insert("Content-Type".to_string(), "application/octet-stream".to_string());

        let request = UploadRequest {
            endpoint: &endpoint,
            handshake_body,
            data,
            headers,
            context: UploadContext::Custom(serde_json::json!({
                "provider": "r2",
                "tag": path_tag,
                "period_tag": period_tag,
                "dataset_id": dataset_id,
                "table": table_name,
                "table_offsets": table_offsets,
                "table_version": DATABASE_TABLE_VERSION,
            })),
        };

        let client = reqwest::Client::new();
        
        match Uploader::upload(&client, &self.auth_manager, request, Some(&self.pending_store)).await {
            Ok(UploadResult::Success) => {
                tracing::info!("Successfully uploaded to R2: tag={}, size={}", path_tag, file_size);
                Ok(())
            }
            Ok(UploadResult::Skipped) => {
                tracing::info!("R2 upload skipped (already exists): tag={}", path_tag);
                Ok(())
            }
            Err(e) => {
                tracing::debug!("R2 upload failed: tag={}", path_tag);
                // Trigger retry processing for pending items saved by Uploader
                let retry = self._retry_service.clone();
                tokio::spawn(async move {
                    retry.trigger_retry().await;
                });
                Err(StorageError::Operation(format!("Upload failed: {}", e)))
            }
        }
    }

    fn compute_content_hash(data: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(data);
        hex::encode(hasher.finalize())
    }

    async fn resolve_dataset_id_for_cloud_upload(&self) -> Option<String> {
        let member_id_hash = crate::util::get_user_member_id().await;
        let trimmed = member_id_hash.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }

        self.auth_manager.resolve_dataset_id_for_upload(None).await
    }

    fn save_master_data_pending(
        &self,
        period_tag: &str,
        endpoint: &str,
        data: &[u8],
        table_offsets_json: &str,
    ) -> Result<(), StorageError> {
        let mut headers = std::collections::HashMap::new();
        headers.insert(
            "content-hash".to_string(),
            Self::compute_content_hash(data),
        );

        let context = serde_json::json!({
            "provider": "r2",
            "operation": "master_data_bulk",
            "endpoint": endpoint,
            "period_tag": period_tag,
            "table_offsets": table_offsets_json,
            "table_version": DATABASE_TABLE_VERSION,
        });

        self.pending_store
            .save_pending(endpoint, &headers, data, Some(context.to_string()))
            .map(|outcome| match outcome {
                PendingSaveOutcome::Created(meta) => {
                    tracing::warn!(
                        pending_id = %meta.id,
                        "Master data dataset_id not ready; saved upload to pending store"
                    );
                }
                PendingSaveOutcome::Existing(meta) => {
                    tracing::info!(
                        pending_id = %meta.id,
                        "Master data dataset_id not ready; matching pending upload already exists"
                    );
                }
            })
            .map_err(|e| StorageError::Operation(format!("Failed to save pending master data upload: {}", e)))
    }

    fn save_r2_pending(
        &self,
        endpoint: &str,
        period_tag: &str,
        path_tag: &str,
        table_name: &str,
        data: &[u8],
        table_offsets: &str,
    ) -> Result<(), StorageError> {
        let mut headers = std::collections::HashMap::new();
        headers.insert(
            "content-hash".to_string(),
            Self::compute_content_hash(data),
        );

        let context = serde_json::json!({
            "provider": "r2",
            "tag": path_tag,
            "period_tag": period_tag,
            "table": table_name,
            "table_offsets": table_offsets,
            "table_version": DATABASE_TABLE_VERSION,
        });

        self.pending_store
            .save_pending(endpoint, &headers, data, Some(context.to_string()))
            .map(|outcome| match outcome {
                PendingSaveOutcome::Created(meta) => {
                    tracing::warn!(
                        pending_id = %meta.id,
                        table = table_name,
                        "R2 dataset_id not ready; saved upload to pending store"
                    );
                }
                PendingSaveOutcome::Existing(meta) => {
                    tracing::info!(
                        pending_id = %meta.id,
                        table = table_name,
                        "R2 dataset_id not ready; matching pending upload already exists"
                    );
                }
            })
            .map_err(|e| StorageError::Operation(format!("Failed to save pending R2 upload: {}", e)))
    }

}

impl StorageProvider for R2StorageProvider {
    fn name(&self) -> &'static str {
        R2_STORAGE_PROVIDER_NAME
    }

    fn supports_integration(&self) -> bool {
        // R2 integration is handled server-side; client does not run integration here
        false
    }

    fn write_get_data_table<'a>(
        &'a self,
        period_tag: &'a str,
        table: &'a GetDataTableEncode,
    ) -> StorageFuture<'a, Result<(), StorageError>> {
        Box::pin(async move {
            // Master data (get_data_table) upload to master_data endpoint
            tracing::info!(period = period_tag, "master data upload event started");

            // Try to get dataset_id (member_id_hash). If unavailable, we still proceed via
            // pending-store path so upload can be retried automatically once session/game state
            // becomes ready.
            let dataset_id = self.resolve_dataset_id_for_cloud_upload().await;

            // Check if master data upload is enabled
            let configs = configs::get_user_configs_for_app();
            let db_config = configs.database;
            
            if !db_config.get_allow_data_to_shared_cloud() {
                tracing::debug!("Master data upload disabled in config");
                tracing::info!(period = period_tag, "master data upload event completed (disabled)");
                return Ok(());
            }

            let r2_config = &db_config.r2;
            let master_endpoint = r2_config
                .get_master_data_upload_endpoint()
                .unwrap_or_default();

            if master_endpoint.is_empty() {
                tracing::warn!("Master data upload endpoint not configured");
                tracing::info!(period = period_tag, "master data upload event completed (no endpoint)");
                return Ok(());
            }

            // Get all master data tables (MUST match server's ALLOWED_MASTER_TABLES exactly)
            // Server requires all 13 tables that correspond to GetDataTableEncode fields:
            // mst_ship, mst_shipgraph, mst_slotitem, mst_slotitem_equiptype, mst_payitem, mst_equip_exslot,
            // mst_equip_exslot_ship, mst_equip_limit_exslot, mst_equip_ship, mst_stype, mst_map_area, mst_map_info, mst_ship_upgrade
            //
            // [CRITICAL FIX #1] Use Vec instead of HashMap to preserve order
            // HashMap iteration order is non-deterministic, but server expects deterministic offset calculation
            //
            // [CRITICAL FIX #2] Include ALL tables (even empty ones)
            // Server validation requires all 13 tables to be present in table_offsets
            // Empty tables (zero-length slices) are still valid offsets with start == end
            let mut master_tables: Vec<(&str, Vec<u8>)> = Vec::new();
            
            // All 13 required tables from GetDataTableEncode (in consistent order)
            // NOTE: Empty tables MUST be included (as zero-length slices)
            master_tables.push(("mst_ship", table.mst_ship.clone()));
            master_tables.push(("mst_shipgraph", table.mst_ship_graph.clone()));
            master_tables.push(("mst_slotitem", table.mst_slot_item.clone()));
            master_tables.push(("mst_slotitem_equiptype", table.mst_slot_item_equip_type.clone()));
            master_tables.push(("mst_payitem", table.mst_use_item.clone()));
            master_tables.push(("mst_equip_exslot", table.mst_equip_exslot.clone()));
            master_tables.push(("mst_equip_exslot_ship", table.mst_equip_exslot_ship.clone()));
            master_tables.push(("mst_equip_limit_exslot", table.mst_equip_limit_exslot.clone()));
            master_tables.push(("mst_equip_ship", table.mst_equip_ship.clone()));
            master_tables.push(("mst_stype", table.mst_stype.clone()));
            master_tables.push(("mst_map_area", table.mst_map_area.clone()));
            master_tables.push(("mst_map_info", table.mst_map_info.clone()));
            master_tables.push(("mst_ship_upgrade", table.mst_ship_upgrade.clone()));

            // Compile-time check: Ensure we always have exactly 13 tables
            // This assertion will fail at runtime if the table count is incorrect,
            // preventing server-side validation failures due to missing/extra tables
            assert_eq!(
                master_tables.len(),
                EXPECTED_MASTER_TABLE_COUNT,
                "Master data tables count mismatch: expected {}, got {}. \
                 All 13 tables must be present in the correct order for server validation.",
                EXPECTED_MASTER_TABLE_COUNT,
                master_tables.len()
            );

            // All 13 tables are always present (even if empty), so never skip
            tracing::debug!("Uploading {} master data tables for period={}", master_tables.len(), period_tag);

            // Concatenate all tables (including empty ones) and build table_offsets
            // [CRITICAL] Empty tables create zero-length slices (start == end)
            let mut concatenated = Vec::new();
            let mut table_offsets = Vec::new();

            for (table_name, avro_data) in &master_tables {
                let start = concatenated.len();
                let end = start + avro_data.len();

                concatenated.extend_from_slice(avro_data);

                #[derive(serde::Serialize)]
                struct TableOffset {
                    table_name: String,
                    start: usize,
                    end: usize,
                }

                table_offsets.push(TableOffset {
                    table_name: table_name.to_string(),
                    start,
                    end,
                });

                tracing::debug!("Added table {}: offset={}-{}", table_name, start, end);
            }

            let table_offsets_json = serde_json::to_string(&table_offsets)
                .map_err(|e| StorageError::Operation(format!("Failed to serialize table_offsets: {}", e)))?;

            tracing::debug!("Prepared {} tables, total size: {} bytes (may include empty tables)", master_tables.len(), concatenated.len());
            tracing::debug!("Table offsets: {}", table_offsets_json);

            // Upload all master data in one request
            // Note: Even with 13 tables, concatenated may be small if most tables are empty
            let Some(dataset_id) = dataset_id else {
                self.save_master_data_pending(
                    period_tag,
                    &master_endpoint,
                    &concatenated,
                    &table_offsets_json,
                )?;
                tracing::info!(period = period_tag, "master data upload event completed (queued pending)");
                return Ok(());
            };

            match self
                .upload_master_data_bulk(period_tag, concatenated, table_offsets_json, &dataset_id, &master_endpoint)
                .await
            {
                Ok(_) => {
                    tracing::info!("Master data uploaded successfully for period={}", period_tag);
                }
                Err(e) => {
                    // Don't fail entire sync if master data upload fails
                    // Master data is shared, so if another user already uploaded it, that's fine
                    tracing::debug!("Master data upload deferred/failed: {}", e);
                }
            }

            tracing::info!(period = period_tag, "master data upload event completed");

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
            tracing::info!(
                period = period_tag,
                map = format!("{}-{}", maparea_id, mapinfo_no),
                "port table upload event started"
            );
            
            // Collect all non-empty Avro tables into HashMap
            let mut tables = std::collections::HashMap::new();
            let mut empty_tables = Vec::new();
            let mut total_avro_bytes = 0;
            
            for (table_name, bytes) in get_all_port_tables(table) {
                tracing::debug!(
                    "Processing table {}: {} bytes",
                    table_name,
                    bytes.len()
                );
                if bytes.is_empty() {
                    tracing::warn!(
                        "EMPTY TABLE FOUND: {} has 0 bytes for map {}-{}",
                        table_name,
                        maparea_id,
                        mapinfo_no
                    );
                    empty_tables.push(table_name.to_string());
                    continue;
                }
                total_avro_bytes += bytes.len();
                tables.insert(table_name.to_string(), bytes.to_vec());
            }
            
            if !empty_tables.is_empty() {
                tracing::info!(
                    "Empty tables: {:?}",
                    empty_tables
                );
            }
            tracing::info!(
                "Collected {} non-empty tables, {} total Avro bytes for map {}-{}",
                tables.len(),
                total_avro_bytes,
                maparea_id,
                mapinfo_no
            );

            if tables.is_empty() {
                tracing::warn!(
                    "No port_table data to upload for map {}-{} - ALL tables are empty!",
                    maparea_id,
                    mapinfo_no
                );
                tracing::info!(
                    period = period_tag,
                    map = format!("{}-{}", maparea_id, mapinfo_no),
                    "port table upload event completed (empty payload)"
                );
                return Ok(());
            }

            tracing::debug!("Building Avro batch upload for {} tables (with data)", tables.len());

            // NEW: Concatenate Avro files directly without Parquet conversion
            let mut concatenated = Vec::new();
            let mut metadata = Vec::new();

            for (table_name, avro_data) in tables {
                if avro_data.is_empty() {
                    tracing::warn!("Skipping empty table '{}'", table_name);
                    continue;
                }

                let start_byte = concatenated.len();
                let byte_length = avro_data.len();

                concatenated.extend_from_slice(&avro_data);

                // Metadata struct matching server-side expectations
                #[derive(serde::Serialize)]
                struct TableMeta {
                    table_name: String,
                    start_byte: usize,
                    byte_length: usize,
                    format: String,
                }

                metadata.push(TableMeta {
                    table_name: table_name.clone(),
                    start_byte,
                    byte_length,
                    format: "avro".to_string(),
                });

                tracing::debug!(
                    "Added '{}' to batch: offset={}, length={}",
                    table_name, start_byte, byte_length
                );
            }

            let total_bytes = concatenated.len();
            tracing::debug!(
                "Avro batch built: {} bytes total, {} tables",
                total_bytes,
                metadata.len()
            );

            // Serialize table offset metadata to JSON
            let table_offsets = serde_json::to_string(&metadata)
                .map_err(|e| StorageError::Operation(format!("Failed to serialize metadata: {}", e)))?;
            tracing::debug!("table_offsets JSON: {}", table_offsets);
            tracing::debug!("Total metadata entries: {}", metadata.len());

            // Upload concatenated Avro data as single .bin file
            let tag = format!("{}-port-{}-{}", period_tag, maparea_id, mapinfo_no);
            let size = concatenated.len();
            let endpoint = configs::get_user_configs_for_app()
                .database
                .r2
                .get_upload_endpoint()
                .unwrap_or_default();
            if endpoint.is_empty() {
                return Err(StorageError::Operation(
                    "r2 upload endpoint not configured".into(),
                ));
            }

            let dataset_id = self.resolve_dataset_id_for_cloud_upload().await;
            let Some(dataset_id) = dataset_id else {
                self.save_r2_pending(
                    &endpoint,
                    period_tag,
                    &tag,
                    "port_table",
                    &concatenated,
                    &table_offsets,
                )?;
                tracing::info!(
                    period = period_tag,
                    map = format!("{}-{}", maparea_id, mapinfo_no),
                    "port table upload event completed (queued pending)"
                );
                return Ok(());
            };

            if let Err(err) = self
                .upload_to_r2(period_tag, &tag, &dataset_id, "port_table", concatenated, table_offsets)
                .await
            {
                tracing::info!(
                    period = period_tag,
                    map = format!("{}-{}", maparea_id, mapinfo_no),
                    "port table upload event completed (failed)"
                );
                return Err(err);
            }

            tracing::info!(
                "Uploaded Avro batch to R2: period={}, map={}-{}, size={}",
                period_tag, maparea_id, mapinfo_no, size
            );
            tracing::info!(
                period = period_tag,
                map = format!("{}-{}", maparea_id, mapinfo_no),
                "port table upload event completed"
            );
            Ok(())
        })
    }

    fn integrate_port_table<'a>(
        &'a self,
        period_tag: &'a str,
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

// Private implementation methods for R2StorageProvider
impl R2StorageProvider {
    /// Upload master data (all tables in one request)
    async fn upload_master_data_bulk(
        &self,
        period_tag: &str,
        concatenated_data: Vec<u8>,
        table_offsets_json: String,
        dataset_id: &str,
        endpoint: &str,
    ) -> Result<(), StorageError> {
        tracing::debug!("Uploading master data (bulk): period={}, size={} bytes", period_tag, concatenated_data.len());
        let mut headers = std::collections::HashMap::new();
        headers.insert("Content-Type".to_string(), "application/octet-stream".to_string());

        // Keep dataset_id in payload so Uploader can auto-resolve/refresh dataset_token.
        let handshake_body = serde_json::json!({
            "kc_period_tag": period_tag,
            "dataset_id": dataset_id,
            "file_size": concatenated_data.len().to_string(),
            "table_offsets": table_offsets_json,
            "table_version": DATABASE_TABLE_VERSION,
        });

        let request = UploadRequest {
            endpoint,
            handshake_body,
            data: concatenated_data,
            headers,
            context: UploadContext::Custom(serde_json::json!({
                "provider": "r2",
                "operation": "master_data_bulk",
                "endpoint": endpoint,
                "period_tag": period_tag,
                "dataset_id": dataset_id,
                "table_offsets": table_offsets_json,
                "table_version": DATABASE_TABLE_VERSION,
            })),
        };

        let client = reqwest::Client::new();
        match Uploader::upload(&client, &self.auth_manager, request, Some(&self.pending_store)).await {
            Ok(UploadResult::Success) => {
                tracing::info!("Master data upload+finalize completed for period={}", period_tag);
                Ok(())
            }
            Ok(UploadResult::Skipped) => {
                tracing::info!("Master data already uploaded by another user for period={}", period_tag);
                Ok(())
            }
            Err(e) => {
                Err(StorageError::Operation(format!("Master data upload failed: {}", e)))
            }
        }
    }
}
