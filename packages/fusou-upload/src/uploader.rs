use std::collections::HashMap;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use fusou_auth::{AuthManager, FileStorage};
use crate::pending_store::PendingStore;

#[derive(Deserialize)]
struct HandshakeResponse {
    #[serde(rename = "uploadUrl")]
    upload_url: String,
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
                    tracing::info!("Saved pending upload due to error: {}", err);
                }
            }
        }

        result
    }

    async fn perform_upload(
        client: &Client,
        auth_manager: &AuthManager<FileStorage>,
        request: &UploadRequest<'_>,
    ) -> Result<UploadResult, String> {
        // 1. Handshake
        let mut handshake_req = client
            .post(request.endpoint)
            .json(&request.handshake_body);

        for (k, v) in &request.headers {
            handshake_req = handshake_req.header(k, v);
        }

        if let Ok(token) = auth_manager.get_access_token().await {
            handshake_req = handshake_req.bearer_auth(token);
        } else {
            return Err("Auth failed".to_string());
        }

        let resp = handshake_req.send().await.map_err(|e| format!("Handshake network error: {}", e))?;
        
        if resp.status() == StatusCode::CONFLICT {
            return Ok(UploadResult::Skipped);
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Handshake failed {}: {}", status, body));
        }

        let handshake_res: HandshakeResponse = resp.json().await
            .map_err(|e| format!("Invalid handshake response: {}", e))?;

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

        let upload_resp = upload_req.send().await.map_err(|e| format!("Upload network error: {}", e))?;

        if upload_resp.status() == StatusCode::CONFLICT {
            return Ok(UploadResult::Skipped);
        }

        if !upload_resp.status().is_success() {
            let status = upload_resp.status();
            let body = upload_resp.text().await.unwrap_or_default();
            return Err(format!("Upload failed {}: {}", status, body));
        }

        Ok(UploadResult::Success)
    }
}
