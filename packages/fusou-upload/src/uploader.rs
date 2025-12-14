use std::collections::HashMap;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use fusou_auth::{AuthManager, FileStorage};
use crate::pending_store::PendingStore;
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
struct HandshakeResponse {
    #[serde(rename = "uploadUrl")]
    upload_url: String,
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
            UploadError::AuthenticationError { status_code, message } => {
                write!(f, "Authentication error ({}): {}", status_code, message)
            }
            UploadError::ClientError { status_code, message } => {
                write!(f, "Client error ({}): {}", status_code, message)
            }
            UploadError::ServerError { status_code, message } => {
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
    pub async fn upload(
        client: &Client,
        auth_manager: &AuthManager<FileStorage>,
        request: UploadRequest<'_>,
        pending_store: Option<&PendingStore>,
    ) -> Result<UploadResult, String> {
        let result = Self::perform_upload(client, auth_manager, &request).await;

        if let Err(err) = &result {
            // Convert to string for compatibility with existing code
            let err_str = String::from(err.clone());
            
            if let Some(store) = pending_store {
                let context_json = serde_json::to_string(&request.context).unwrap_or_default();
                if let Err(e) = store.save_pending(
                    request.endpoint,
                    &request.headers,
                    &request.data,
                    Some(context_json),
                ) {
                    tracing::error!("Failed to save pending upload: {}", e);
                } else {
                    tracing::info!("Saved pending upload due to error: {}", err_str);
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
        // Compute SHA-256 hash of the upload data
        let mut hasher = Sha256::new();
        hasher.update(&request.data);
        let digest = hasher.finalize();
        let content_hash = hex::encode(digest);

        // Merge content_hash into handshake_body
        let mut handshake_body = request.handshake_body.clone();
        if let Some(obj) = handshake_body.as_object_mut() {
            obj.insert("content_hash".to_string(), serde_json::Value::String(content_hash));
        }

        // 1. Handshake
        let mut handshake_req = client
            .post(request.endpoint)
            .json(&handshake_body);

        for (k, v) in &request.headers {
            handshake_req = handshake_req.header(k, v);
        }

        if let Ok(token) = auth_manager.get_access_token().await {
            handshake_req = handshake_req.bearer_auth(token);
        } else {
            return Err(UploadError::AuthenticationError {
                status_code: 401,
                message: "Failed to obtain access token".to_string(),
            });
        }

        let resp = handshake_req.send().await
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

        let handshake_res: HandshakeResponse = resp.json().await
            .map_err(|e| UploadError::TransportError(format!("Invalid handshake response: {}", e)))?;

        // 2. Upload
        let mut upload_req = client
            .post(&handshake_res.upload_url)
            .body(request.data.clone());

        for (k, v) in &request.headers {
            upload_req = upload_req.header(k, v);
        }
        
        if let Ok(token) = auth_manager.get_access_token().await {
            upload_req = upload_req.bearer_auth(token);
        }

        let upload_resp = upload_req.send().await
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
