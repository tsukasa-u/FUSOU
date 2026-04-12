use std::sync::Arc;

use fusou_auth::{AuthManager, FileStorage};
use fusou_upload::{Uploader, UploadRequest, UploadContext};
use fusou_upload::retry_service::RetryHandler;
use kc_api::database::DATABASE_TABLE_VERSION;

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
                        // Expect fields: tag (path_tag), period_tag, dataset_id, table, table_offsets
                        let path_tag = context.get("tag").and_then(|v| v.as_str()).ok_or("missing tag")?;
                        let period_tag = context.get("period_tag").and_then(|v| v.as_str()).unwrap_or("0");
                        let dataset_id = context.get("dataset_id").and_then(|v| v.as_str()).ok_or("missing dataset_id")?;
                        let table = context.get("table").and_then(|v| v.as_str()).unwrap_or("port_table");
                        let table_offsets = context.get("table_offsets").and_then(|v| v.as_str()).ok_or("missing table_offsets")?;

                        let endpoint = configs::get_user_configs_for_app()
                            .database
                            .r2
                            .get_upload_endpoint()
                            .ok_or("r2 upload endpoint not configured")?;

                        let file_size = data.len() as u64;
                        // Use saved table_version from context to avoid version mismatch after app upgrade
                        let table_version = context.get("table_version")
                            .and_then(|v| v.as_str())
                            .unwrap_or(DATABASE_TABLE_VERSION);
                        let handshake_body = Uploader::build_battle_data_handshake(
                            period_tag,
                            path_tag,
                            dataset_id,
                            table,
                            file_size,
                            table_offsets,
                            table_version,
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

                        let client = reqwest::Client::builder()
                            .connect_timeout(std::time::Duration::from_secs(10))
                            .timeout(std::time::Duration::from_secs(60))
                            .build()
                            .unwrap_or_default();
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
                    "quest_ingest" => {
                        let endpoint = context
                            .get("endpoint")
                            .and_then(|v| v.as_str())
                            .ok_or("missing endpoint")?;
                        let mut handshake_body: serde_json::Value = serde_json::from_slice(data)?;
                        if let Some(obj) = handshake_body.as_object_mut() {
                            obj.insert(
                                "file_size".to_string(),
                                serde_json::Value::Number(serde_json::Number::from(data.len() as u64)),
                            );
                        }

                        let request = UploadRequest {
                            endpoint,
                            handshake_body,
                            data: data.to_vec(),
                            headers: {
                                let mut h = std::collections::HashMap::new();
                                // payload_hash is used as the content-hash header for quest retries
                                // (consistent with the original send path which also uses payload_hash)
                                if let Some(hash) = context.get("payload_hash").and_then(|v| v.as_str()) {
                                    h.insert("content-hash".to_string(), hash.to_string());
                                }
                                h
                            },
                            context: UploadContext::Custom(context.clone()),
                        };

                        let client = reqwest::Client::builder()
                            .connect_timeout(std::time::Duration::from_secs(10))
                            .timeout(std::time::Duration::from_secs(60))
                            .build()
                            .unwrap_or_default();
                        Uploader::upload(&client, &self.auth_manager, request, None)
                            .await
                            .map(|_| ())
                            .map_err(|e| e.into())
                    }
                    "ship_growth_ingest" => {
                        let endpoint = context
                            .get("endpoint")
                            .and_then(|v| v.as_str())
                            .ok_or("missing endpoint")?;
                        let mut handshake_body: serde_json::Value = serde_json::from_slice(data)?;
                        // The persisted data is the raw upload payload (no file_size or
                        // content_hash). Add file_size here; content_hash is injected by the
                        // uploader (sha256 of request.data).
                        if let Some(obj) = handshake_body.as_object_mut() {
                            obj.insert(
                                "file_size".to_string(),
                                serde_json::Value::Number(serde_json::Number::from(data.len() as u64)),
                            );
                        }

                        // content-hash header must match actual upload content, not payload_hash.
                        let content_hash = {
                            use sha2::{Digest, Sha256};
                            let mut h = Sha256::new();
                            h.update(data);
                            format!("{:x}", h.finalize())
                        };

                        let request = UploadRequest {
                            endpoint,
                            handshake_body,
                            data: data.to_vec(),
                            headers: {
                                let mut h = std::collections::HashMap::new();
                                h.insert("content-hash".to_string(), content_hash);
                                h
                            },
                            context: UploadContext::Custom(context.clone()),
                        };

                        let client = reqwest::Client::builder()
                            .connect_timeout(std::time::Duration::from_secs(10))
                            .timeout(std::time::Duration::from_secs(60))
                            .build()
                            .unwrap_or_default();
                        Uploader::upload(&client, &self.auth_manager, request, None)
                            .await
                            .map(|_| ())
                            .map_err(|e| e.into())
                    }
                    // Google Drive re-upload (only available with gdrive feature)
                    #[cfg(feature = "gdrive")]
                    "upload" => {
                        let remote_path = context.get("remote_path").and_then(|v| v.as_str()).ok_or("missing remote_path")?;

                        let cloud = CloudProviderFactory::create("google")
                            .map_err(|e| format!("cloud provider init failed: {}", e))?;

                        // Write data to a temporary file then upload
                        let mut temp_path = std::env::temp_dir();
                        temp_path.push(format!("fusou-retry-{}", uuid::Uuid::new_v4()));
                        {
                            use tokio::io::AsyncWriteExt;
                            let mut file = tokio::fs::OpenOptions::new()
                                .write(true)
                                .create_new(true)
                                .open(&temp_path)
                                .await?;
                            #[cfg(unix)]
                            {
                                use std::os::unix::fs::PermissionsExt;
                                tokio::fs::set_permissions(&temp_path, std::fs::Permissions::from_mode(0o600)).await?;
                            }
                            file.write_all(data).await?;
                        }

                        let upload_result = cloud
                            .upload_file(temp_path.as_path(), remote_path)
                            .await
                            .map_err(|e| format!("cloud upload failed: {}", e));

                        let _ = tokio::fs::remove_file(&temp_path).await;
                        upload_result?;
                        Ok(())
                    }
                    "remodel_data_ingest" => {
                        let endpoint = context
                            .get("endpoint")
                            .and_then(|v| v.as_str())
                            .ok_or("missing endpoint")?;
                        let mut handshake_body: serde_json::Value = serde_json::from_slice(data)?;
                        if let Some(obj) = handshake_body.as_object_mut() {
                            obj.insert(
                                "file_size".to_string(),
                                serde_json::Value::Number(serde_json::Number::from(data.len() as u64)),
                            );
                        }

                        // content-hash header must match actual upload content, not payload_hash
                        // (payload_hash is sha256 of the inner struct, not the full envelope bytes)
                        let content_hash = {
                            use sha2::{Digest, Sha256};
                            let mut h = Sha256::new();
                            h.update(data);
                            format!("{:x}", h.finalize())
                        };

                        let request = UploadRequest {
                            endpoint,
                            handshake_body,
                            data: data.to_vec(),
                            headers: {
                                let mut h = std::collections::HashMap::new();
                                h.insert("content-hash".to_string(), content_hash);
                                h
                            },
                            context: UploadContext::Custom(context.clone()),
                        };

                        let client = reqwest::Client::builder()
                            .connect_timeout(std::time::Duration::from_secs(10))
                            .timeout(std::time::Duration::from_secs(60))
                            .build()
                            .unwrap_or_default();
                        Uploader::upload(&client, &self.auth_manager, request, None)
                            .await
                            .map(|_| ())
                            .map_err(|e| e.into())
                    }
                    _ => Err("unsupported operation".into()),
                }
            } else {
                Err("unknown retry context".into())
            }
        })
    }
}
