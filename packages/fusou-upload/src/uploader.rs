use crate::pending_store::{PendingSaveOutcome, PendingStore};
use fusou_auth::{AuthManager, FileStorage};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

#[derive(Deserialize)]
struct HandshakeResponse {
    #[serde(rename = "uploadUrl")]
    upload_url: String,
    token: String,
}

/// Structured error type for upload failures
#[derive(Debug, Clone)]
pub enum UploadError {
    /// Authentication-related failures (401 Unauthorized, 403 Forbidden)
    AuthenticationError { status_code: u16, message: String },
    /// Client-side errors (4xx excluding auth errors)
    ClientError { status_code: u16, message: String },
    /// Server-side errors (5xx)
    ServerError { status_code: u16, message: String },
    /// Network or serialization errors
    TransportError(String),
    /// 409 Conflict - resource already exists
    Conflict,
}

impl UploadError {
    /// Check if this is an authentication failure
    pub fn is_auth_error(&self) -> bool {
        matches!(self, UploadError::AuthenticationError { .. })
    }
}

impl std::fmt::Display for UploadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UploadError::AuthenticationError {
                status_code,
                message,
            } => {
                write!(f, "Authentication error ({}): {}", status_code, message)
            }
            UploadError::ClientError {
                status_code,
                message,
            } => {
                write!(f, "Client error ({}): {}", status_code, message)
            }
            UploadError::ServerError {
                status_code,
                message,
            } => {
                write!(f, "Server error ({}): {}", status_code, message)
            }
            UploadError::TransportError(msg) => write!(f, "{}", msg),
            UploadError::Conflict => write!(f, "Resource already exists (409)"),
        }
    }
}

impl From<UploadError> for String {
    fn from(err: UploadError) -> Self {
        err.to_string()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum UploadContext {
    Asset {
        relative_path: String,
        key: String,
        file_size: u64,
        dataset_id: Option<String>,
        content_type: Option<String>,
    },
    Snapshot {
        is_snapshot: bool,
    },
    Custom(serde_json::Value),
}

pub struct UploadRequest<'a> {
    pub endpoint: &'a str,
    pub handshake_body: serde_json::Value,
    pub data: Vec<u8>,
    pub headers: HashMap<String, String>,
    pub context: UploadContext,
}

pub enum UploadResult {
    Success,
    Skipped,
}

pub struct Uploader;

impl Uploader {
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

    fn compute_content_hash(data: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(data);
        let digest = hasher.finalize();
        hex::encode(digest)
    }

    fn extract_dataset_id(handshake_body: &serde_json::Value) -> Option<&str> {
        handshake_body
            .as_object()
            .and_then(|obj| obj.get("dataset_id"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
    }

    /// Helper: build handshake body for battle-data upload
    ///
    /// # Arguments
    /// * `path_tag` - Format: "{period_tag}-port-{maparea_id}-{mapinfo_no}"
    /// * `dataset_id` - User-scoped dataset identifier (hashed member_id)
    /// * `table` - Table name being uploaded (e.g., "port_table")
    /// * `file_size` - Size of the binary data in bytes
    /// * `table_offsets` - JSON string containing offset metadata for concatenated tables
    /// * `table_version` - Table version tag (e.g., "0.4", "0.5")
    pub fn build_battle_data_handshake(
        period_tag: &str,
        path_tag: &str,
        dataset_id: &str,
        table: &str,
        file_size: u64,
        table_offsets: &str,
        table_version: &str,
    ) -> serde_json::Value {
        serde_json::json!({
            "path": format!("{}.bin", path_tag),
            "binary": true,
            "dataset_id": dataset_id,
            "table": table,
            "kc_period_tag": period_tag,
            "file_size": file_size.to_string(),
            "table_offsets": table_offsets,
            "table_version": table_version,
        })
    }
    /// Helper: build handshake body for fleet snapshot upload
    ///
    /// # Arguments
    /// * `tag` - Snapshot tag identifier (e.g., "latest")
    /// * `dataset_id` - User-scoped dataset identifier (hashed member_id)
    pub fn build_snapshot_handshake(tag: &str, dataset_id: &str) -> serde_json::Value {
        serde_json::json!({
            "tag": tag,
            "dataset_id": dataset_id,
        })
    }

    /// Helper: build handshake body for asset-sync upload
    pub fn build_asset_sync_handshake(
        key: &str,
        relative_path: &str,
        declared_size: u64,
        file_name: Option<&str>,
        dataset_id: Option<&str>,
    ) -> serde_json::Value {
        let mut obj = serde_json::json!({
            "key": key,
            "relative_path": relative_path,
            "file_size": declared_size.to_string(),
        });
        if let Some(name) = file_name {
            if let Some(map) = obj.as_object_mut() {
                map.insert(
                    "file_name".to_string(),
                    serde_json::Value::String(name.to_string()),
                );
            }
        }
        if let Some(dataset_id) = dataset_id {
            if let Some(map) = obj.as_object_mut() {
                map.insert(
                    "dataset_id".to_string(),
                    serde_json::Value::String(dataset_id.to_string()),
                );
            }
        }
        obj
    }
    pub async fn upload(
        client: &Client,
        auth_manager: &AuthManager<FileStorage>,
        request: UploadRequest<'_>,
        pending_store: Option<&PendingStore>,
    ) -> Result<UploadResult, String> {
        tracing::info!("upload event started");
        let content_hash = Self::compute_content_hash(&request.data);
        let result = Self::perform_upload(client, auth_manager, &request).await;

        if result.is_err() {
            let mut queued_pending = false;
            let mut pending_already_exists = false;
            if let Some(store) = pending_store {
                let context_json = serde_json::to_string(&request.context).unwrap_or_default();
                let mut pending_headers = request.headers.clone();
                pending_headers
                    .entry("content-hash".to_string())
                    .or_insert(content_hash);
                match store.save_pending(
                    request.endpoint,
                    &pending_headers,
                    &request.data,
                    Some(context_json),
                ) {
                    Ok(PendingSaveOutcome::Created(meta)) => {
                        tracing::warn!(pending_id = %meta.id, "Upload failed, saved to pending store");
                        queued_pending = true;
                    }
                    Ok(PendingSaveOutcome::Existing(meta)) => {
                        tracing::info!(pending_id = %meta.id, "Upload failed, matching pending upload already exists");
                        queued_pending = true;
                        pending_already_exists = true;
                    }
                    Err(e) => {
                        tracing::error!("Failed to save pending upload: {}", e);
                    }
                }
            } else {
                tracing::warn!("Upload failed (no pending store configured)");
            }

            if queued_pending {
                if pending_already_exists {
                    tracing::info!("upload event completed (pending already queued)");
                } else {
                    tracing::info!("upload event completed (queued pending)");
                }
            } else {
                tracing::info!("upload event completed (failed)");
            }
        } else if let Ok(outcome) = &result {
            match outcome {
                UploadResult::Success => {
                    tracing::info!("upload event completed successfully");
                }
                UploadResult::Skipped => {
                    tracing::info!("upload event completed (already exists upstream)");
                }
            }
        }

        result.map_err(|e| e.into())
    }

    async fn perform_upload(
        client: &Client,
        auth_manager: &AuthManager<FileStorage>,
        request: &UploadRequest<'_>,
    ) -> Result<UploadResult, UploadError> {
        let content_hash = Self::compute_content_hash(&request.data);

        // Merge content_hash into handshake_body
        let mut handshake_body = request.handshake_body.clone();
        if let Some(obj) = handshake_body.as_object_mut() {
            obj.insert(
                "content_hash".to_string(),
                serde_json::Value::String(content_hash),
            );
        }

        // 1. Handshake (JSON body)
        // Serialize JSON manually to avoid automatic Content-Type header from .json()
        let handshake_json = serde_json::to_vec(&handshake_body).map_err(|e| {
            UploadError::TransportError(format!("Failed to serialize handshake: {}", e))
        })?;

        let mut handshake_req = client
            .post(request.endpoint)
            .body(handshake_json)
            .header("Content-Type", "application/json");

        // Add custom headers (excluding Content-Type to avoid duplicates)
        for (k, v) in &request.headers {
            if k.to_lowercase() != "content-type" {
                handshake_req = handshake_req.header(k, v);
            }
        }

        // Add X-Dataset-Token header if available.
        // If no local token exists, attempt on-demand refresh via ensure_dataset_token_valid
        // so that a freshly-started device can upload without waiting for background auth.
        let dataset_token_opt = if let Some(dataset_id) = Self::extract_dataset_id(&handshake_body)
        {
            let loaded = auth_manager
                .load_dataset_token_for_dataset(dataset_id)
                .await
                .ok()
                .flatten();

            match loaded {
                Some(token) => {
                    // Check expiry (1-day margin) and refresh if needed
                    let one_day = chrono::Duration::days(1);
                    if token.expires_at <= chrono::Utc::now() + one_day {
                        tracing::info!("dataset_token expiring soon, refreshing before upload");
                        match auth_manager.ensure_dataset_token_valid(dataset_id, Some(&token)).await {
                            Ok(refreshed) => {
                                let _ = auth_manager.save_dataset_token(&refreshed).await;
                                Some(refreshed)
                            }
                            Err(e) => {
                                tracing::warn!("failed to refresh dataset_token, using existing: {}", e);
                                Some(token)
                            }
                        }
                    } else {
                        Some(token)
                    }
                }
                None => {
                    // No token on disk/cache — try to obtain one on-demand
                    tracing::info!(
                        "no dataset_token found for {}, attempting on-demand fetch",
                        Self::mask_identifier(dataset_id)
                    );
                    match auth_manager.ensure_dataset_token_valid(dataset_id, None).await {
                        Ok(fresh) => {
                            let _ = auth_manager.save_dataset_token(&fresh).await;
                            Some(fresh)
                        }
                        Err(e) => {
                            tracing::warn!("on-demand dataset_token fetch failed: {}", e);
                            None
                        }
                    }
                }
            }
        } else {
            None
        };
        if let Some(dataset_token) = &dataset_token_opt {
            handshake_req = handshake_req.header("X-Dataset-Token", &dataset_token.token);
        }

        let access_token = auth_manager.get_access_token().await.ok();
        if let Some(access_token) = access_token.as_ref() {
            handshake_req = handshake_req.bearer_auth(access_token.clone());
        } else if dataset_token_opt.is_none() {
            return Err(UploadError::AuthenticationError {
                status_code: 401,
                message: "No access token or dataset token available for handshake".to_string(),
            });
        }

        let resp = handshake_req
            .send()
            .await
            .map_err(|e| UploadError::TransportError(format!("Handshake network error: {}", e)))?;

        if resp.status() == StatusCode::CONFLICT {
            return Ok(UploadResult::Skipped);
        }

        if !resp.status().is_success() {
            let status_code = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(match status_code {
                401 | 403 => UploadError::AuthenticationError {
                    status_code,
                    message: body,
                },
                400..=499 => UploadError::ClientError {
                    status_code,
                    message: body,
                },
                _ => UploadError::ServerError {
                    status_code,
                    message: body,
                },
            });
        }

        let handshake_res: HandshakeResponse = resp.json().await.map_err(|e| {
            UploadError::TransportError(format!("Invalid handshake response: {}", e))
        })?;

        // 2. Upload (binary body)
        let mut upload_req = client
            .post(&handshake_res.upload_url)
            .body(request.data.clone());

        // Add X-Upload-Token header from handshake response
        upload_req = upload_req.header("X-Upload-Token", &handshake_res.token);

        // Add custom headers first (excluding Content-Type)
        for (k, v) in &request.headers {
            if k.to_lowercase() != "content-type" {
                upload_req = upload_req.header(k, v);
            }
        }

        // Determine Content-Type based on context or fall back to application/octet-stream
        let content_type = match &request.context {
            UploadContext::Asset { content_type, .. } => content_type
                .clone()
                .unwrap_or_else(|| "application/octet-stream".to_string()),
            _ => "application/octet-stream".to_string(),
        };
        upload_req = upload_req.header("Content-Type", &content_type);

        if let Some(access_token) = access_token {
            upload_req = upload_req.bearer_auth(access_token);
        }

        let upload_resp = upload_req
            .send()
            .await
            .map_err(|e| UploadError::TransportError(format!("Upload network error: {}", e)))?;

        if upload_resp.status() == StatusCode::CONFLICT {
            return Ok(UploadResult::Skipped);
        }

        if !upload_resp.status().is_success() {
            let status_code = upload_resp.status().as_u16();
            let body = upload_resp.text().await.unwrap_or_default();
            return Err(match status_code {
                401 | 403 => UploadError::AuthenticationError {
                    status_code,
                    message: body,
                },
                400..=499 => UploadError::ClientError {
                    status_code,
                    message: body,
                },
                _ => UploadError::ServerError {
                    status_code,
                    message: body,
                },
            });
        }

        Ok(UploadResult::Success)
    }
}
