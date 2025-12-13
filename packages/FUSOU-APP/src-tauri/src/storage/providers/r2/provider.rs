use std::sync::Arc;
use kc_api::database::table::{GetDataTableEncode, PortTableEncode};
use base64::Engine;

use crate::storage::service::{StorageError, StorageFuture, StorageProvider};
use crate::storage::common::get_all_port_tables;
// JWT取得は環境や認証状態に依存するため、ここでは省略し、
// アップロード時に未認証の場合はサーバ側で401が返る運用とする。

use fusou_upload::{PendingStore, UploadRetryService};
use fusou_auth::{AuthManager, FileStorage};
use std::path::PathBuf;
use serde_json::Value;
use sha2::{Sha256, Digest};

const R2_STORAGE_PROVIDER_NAME: &str = "r2";

#[derive(Clone)]
pub struct R2StorageProvider {
    _pending_store: Arc<PendingStore>,
    _retry_service: Arc<UploadRetryService>,
}

impl R2StorageProvider {
    pub fn new(pending_store: Arc<PendingStore>, retry_service: Arc<UploadRetryService>) -> Self {
        Self {
            _pending_store: pending_store,
            _retry_service: retry_service,
        }
    }

    /// Upload a single .bin file with tag-based identification
    /// The file will be stored as: user_id/periods/{period_tag}/data/{tag}.bin
    async fn upload_to_r2(&self, tag: &str, data: Vec<u8>, jwt_token: &str, user_id: &str) -> Result<(), StorageError> {
        // Use FUSOU-WEB's /api/fleet/snapshot endpoint for 2-stage upload
        // This ensures JWT authentication + signed token validation
        
        let file_size = data.len();
        tracing::debug!("Uploading to R2: tag={}, user={}, size={}", tag, user_id, file_size);

        let configs = configs::get_user_configs_for_app();
        let db_config = configs.database;
        let r2_config = &db_config.r2;

        if !(db_config.get_allow_data_to_shared_cloud() && r2_config.get_enable()) {
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

        // Compute SHA-256 hash of data
        let mut hasher = Sha256::new();
        hasher.update(&data);
        let hash_bytes = hasher.finalize();
        let content_hash = hex::encode(hash_bytes);

        // Stage 1: Get signing token from server (preparation phase)
        let prep_client = reqwest::Client::new();
        let prep_response = prep_client
            .post(&endpoint)
            .bearer_auth(&jwt_token)
            .json(&serde_json::json!({
                "path": format!("{}.bin", tag),
                "binary": true,
                "content_hash": content_hash,
            }))
            .send()
            .await
            .map_err(|e| StorageError::Operation(format!("Preparation request failed: {}", e)))?;

        if !prep_response.status().is_success() {
            let status = prep_response.status();
            let text = prep_response.text().await.unwrap_or_default();
            return Err(StorageError::Operation(format!(
                "Preparation request failed: {} - {}",
                status, text
            )));
        }

        let prep_data: serde_json::Value = prep_response
            .json()
            .await
            .map_err(|e| StorageError::Operation(format!("Failed to parse preparation response: {}", e)))?;

        let upload_url = prep_data
            .get("uploadUrl")
            .and_then(|v| v.as_str())
            .ok_or_else(|| StorageError::Operation("No uploadUrl in response".into()))?;

        // Stage 2: Execute upload with signed token (send raw binary data)
        let upload_client = reqwest::Client::new();
        let upload_response = upload_client
            .post(upload_url)
            .bearer_auth(&jwt_token)
            .header("content-type", "application/octet-stream")
            .body(data.clone())
            .send()
            .await
            .map_err(|e| StorageError::Operation(format!("Upload request failed: {}", e)))?;

        if !upload_response.status().is_success() {
            let status = upload_response.status();
            let text = upload_response.text().await.unwrap_or_default();
            return Err(StorageError::Operation(format!(
                "Upload request failed: {} - {}",
                status, text
            )));
        }

        let upload_data: serde_json::Value = upload_response
            .json()
            .await
            .map_err(|e| StorageError::Operation(format!("Failed to parse upload response: {}", e)))?;

        let stored_path = upload_data
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        tracing::info!(
            "Successfully uploaded to R2: tag={}, user={}, size={}, path={}",
            tag, user_id, file_size, stored_path
        );
        Ok(())
    }

    async fn get_jwt_and_user(&self) -> Result<(String, String), StorageError> {
        // Acquire JWT via fusou-auth
        let storage_path = PathBuf::from("./.fusou/session.json");
        let storage = FileStorage::new(storage_path);
        let auth = AuthManager::from_env(Arc::new(storage))
            .map_err(|e| StorageError::Operation(format!("Auth init failed: {e}")))?;
        let jwt_token = auth
            .get_access_token()
            .await
            .map_err(|e| StorageError::Operation(format!("Auth token error: {e}")))?;

        let user_id = Self::extract_user_id_from_jwt(&jwt_token)?;
        Ok((jwt_token, user_id))
    }

    fn extract_user_id_from_jwt(jwt: &str) -> Result<String, StorageError> {
        let parts: Vec<&str> = jwt.split('.').collect();
        if parts.len() < 2 {
            return Err(StorageError::Operation("Invalid JWT format".into()));
        }

        let payload_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(parts[1])
            .or_else(|_| base64::engine::general_purpose::STANDARD.decode(parts[1]))
            .map_err(|e| StorageError::Operation(format!("Failed to decode JWT payload: {e}")))?;

        let payload: Value = serde_json::from_slice(&payload_bytes)
            .map_err(|e| StorageError::Operation(format!("Failed to parse JWT payload: {e}")))?;

        if let Some(sub) = payload.get("sub").and_then(|v| v.as_str()) {
            return Ok(sub.to_string());
        }

        if let Some(uid) = payload.get("user_id").and_then(|v| v.as_str()) {
            return Ok(uid.to_string());
        }

        Err(StorageError::Operation(
            "JWT payload missing 'sub' or 'user_id' claim".into(),
        ))
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
            let (jwt_token, user_id) = self.get_jwt_and_user().await?;

            // Combine all port_tables into a single .bin file
            let mut combined_data = Vec::new();
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
                combined_data.extend_from_slice(&bytes);
            }

            if combined_data.is_empty() {
                tracing::warn!(
                    "No port_table data to upload for map {}-{}",
                    maparea_id,
                    mapinfo_no
                );
                return Ok(());
            }

            // Upload as single .bin file with map identifier
            let tag = format!("{}-port-{}-{}", period_tag, maparea_id, mapinfo_no);
            let size = combined_data.len();
            self.upload_to_r2(&tag, combined_data, &jwt_token, &user_id).await?;

            tracing::info!(
                "Uploaded port table to R2: period={}, map={}-{}, user={}, size={}",
                period_tag, maparea_id, mapinfo_no, user_id, size
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

