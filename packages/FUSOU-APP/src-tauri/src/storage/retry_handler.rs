use std::path::PathBuf;
use std::sync::Arc;

use fusou_auth::{AuthManager, FileStorage};
use fusou_upload::{RetryHandler, Uploader, UploadRequest, UploadContext};

use crate::storage::cloud_provider_trait::CloudProviderFactory;

pub struct AppUploadRetryHandler {
    auth_manager: Arc<AuthManager<FileStorage>>,
}

impl AppUploadRetryHandler {
    pub fn new(auth_manager: Arc<AuthManager<FileStorage>>) -> Self {
        Self { auth_manager }
    }
}

impl RetryHandler for AppUploadRetryHandler {
    fn handle<'a>(&'a self, context: &'a serde_json::Value, data: &'a [u8]) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), Box<dyn std::error::Error>>> + Send + 'a>> {
        Box::pin(async move {
            // Route by provider/operation in context
            if let Some(provider) = context.get("provider").and_then(|v| v.as_str()) {
                match provider {
                    "r2" => {
                        // Expect fields: tag, dataset_id, table, table_offsets
                        let tag = context.get("tag").and_then(|v| v.as_str()).ok_or("missing tag")?;
                        let dataset_id = context.get("dataset_id").and_then(|v| v.as_str()).ok_or("missing dataset_id")?;
                        let table = context.get("table").and_then(|v| v.as_str()).unwrap_or("port_table");
                        let table_offsets = context.get("table_offsets").and_then(|v| v.as_str()).ok_or("missing table_offsets")?;

                        let endpoint = configs::get_user_configs_for_app()
                            .database
                            .r2
                            .get_upload_endpoint()
                            .ok_or("r2 upload endpoint not configured")?;

                        let file_size = data.len() as u64;
                        let handshake_body = Uploader::build_battle_data_handshake(
                            tag,
                            dataset_id,
                            table,
                            file_size,
                            table_offsets,
                        );

                        let mut headers = std::collections::HashMap::new();
                        headers.insert("Content-Type".to_string(), "application/octet-stream".to_string());

                        let request = UploadRequest {
                            endpoint: &endpoint,
                            handshake_body,
                            data: data.to_vec(),
                            headers,
                            context: UploadContext::Custom(context.clone()),
                        };

                        let client = reqwest::Client::new();
                        // Use the same auth manager to obtain token inside Uploader
                        Uploader::upload(&client, &self.auth_manager, request, None)
                            .await
                            .map(|_| ())
                            .map_err(|e| e.into())
                    }
                    _ => Err("unsupported provider".into()),
                }
            } else if let Some(op) = context.get("operation").and_then(|v| v.as_str()) {
                match op {
                    // Google Drive re-upload
                    "upload" => {
                        let remote_path = context.get("remote_path").and_then(|v| v.as_str()).ok_or("missing remote_path")?;

                        let cloud = CloudProviderFactory::create("google")
                            .map_err(|e| format!("cloud provider init failed: {}", e))?;

                        // Write data to a temporary file then upload
                        let mut temp_path = std::env::temp_dir();
                        temp_path.push(format!("fusou-retry-{}", uuid::Uuid::new_v4()));
                        tokio::fs::write(&temp_path, data).await?;

                        cloud
                            .upload_file(temp_path.as_path(), remote_path)
                            .await
                            .map_err(|e| format!("cloud upload failed: {}", e))?;

                        let _ = tokio::fs::remove_file(&temp_path).await;
                        Ok(())
                    }
                    _ => Err("unsupported operation".into()),
                }
            } else {
                Err("unknown retry context".into())
            }
        })
    }
}
