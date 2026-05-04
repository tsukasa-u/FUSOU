use std::collections::HashMap;
use std::sync::Arc;

use crate::storage::root_validator;
use fusou_auth::{AuthManager, FileStorage};
use fusou_upload::retry_service::RetryHandler;
use fusou_upload::{UploadContext, UploadRequest, Uploader};
use kc_api::database::DATABASE_TABLE_VERSION;

#[cfg(feature = "gdrive")]
use crate::storage::cloud_provider_trait::CloudProviderFactory;

type RetryResult = Result<(), Box<dyn std::error::Error>>;

pub struct AppUploadRetryHandler {
    auth_manager: Arc<AuthManager<FileStorage>>,
}

#[derive(Clone, Copy)]
enum PayloadHashMode {
    ContextPayloadHash,
    ComputedContentHash,
}

impl AppUploadRetryHandler {
    pub fn new(auth_manager: Arc<AuthManager<FileStorage>>) -> Self {
        Self { auth_manager }
    }

    fn build_client() -> reqwest::Client {
        reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .unwrap_or_default()
    }

    async fn upload_request(&self, request: UploadRequest<'_>) -> RetryResult {
        let client = Self::build_client();
        Uploader::upload(&client, &self.auth_manager, request, None)
            .await
            .map(|_| ())
            .map_err(|e| e.into())
    }

    fn endpoint_from_context<'a>(
        &self,
        context: &'a serde_json::Value,
    ) -> Result<&'a str, Box<dyn std::error::Error>> {
        context
            .get("endpoint")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "missing endpoint".into())
    }

    fn upload_request_with_custom_context<'a>(
        &self,
        endpoint: &'a str,
        handshake_body: serde_json::Value,
        data: &'a [u8],
        headers: HashMap<String, String>,
        context: &'a serde_json::Value,
    ) -> UploadRequest<'a> {
        UploadRequest {
            endpoint,
            handshake_body,
            data: data.to_vec(),
            headers,
            context: UploadContext::Custom(context.clone()),
        }
    }

    async fn handle_context(&self, context: &serde_json::Value, data: &[u8]) -> RetryResult {
        if let Some(provider) = context.get("provider").and_then(|v| v.as_str()) {
            return self.handle_provider_retry(provider, context, data).await;
        }

        if let Some(operation) = context.get("operation").and_then(|v| v.as_str()) {
            return self.handle_operation_retry(operation, context, data).await;
        }

        Err("unknown retry context".into())
    }

    async fn handle_provider_retry(
        &self,
        provider: &str,
        context: &serde_json::Value,
        data: &[u8],
    ) -> RetryResult {
        match provider {
            "r2" => {
                if context.get("operation").and_then(|v| v.as_str()) == Some("master_data_bulk") {
                    return self.handle_master_data_bulk_retry(context, data).await;
                }
                self.handle_r2_retry(context, data).await
            }
            _ => Err("unsupported provider".into()),
        }
    }

    async fn handle_r2_retry(&self, context: &serde_json::Value, data: &[u8]) -> RetryResult {
        let path_tag = context
            .get("tag")
            .and_then(|v| v.as_str())
            .ok_or("missing tag")?;
        let period_tag = context
            .get("period_tag")
            .and_then(|v| v.as_str())
            .unwrap_or("0");
        let dataset_id = match context
            .get("dataset_id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            Some(dataset_id) => dataset_id.to_string(),
            None => self
                .auth_manager
                .resolve_dataset_id_for_upload(None)
                .await
                .ok_or("dataset_id not ready for r2 retry")?,
        };
        let table = context
            .get("table")
            .and_then(|v| v.as_str())
            .unwrap_or("port_table");
        let table_offsets = context
            .get("table_offsets")
            .and_then(|v| v.as_str())
            .ok_or("missing table_offsets")?;

        let endpoint = configs::get_user_configs_for_app()
            .database
            .r2
            .get_upload_endpoint()
            .ok_or("r2 upload endpoint not configured")?;

        let table_version = context
            .get("table_version")
            .and_then(|v| v.as_str())
            .unwrap_or(DATABASE_TABLE_VERSION);

        let handshake_body = Uploader::build_battle_data_handshake(
            period_tag,
            path_tag,
            &dataset_id,
            table,
            data.len() as u64,
            table_offsets,
            table_version,
        );

        let mut headers = HashMap::new();
        headers.insert(
            "Content-Type".to_string(),
            "application/octet-stream".to_string(),
        );

        let request = self.upload_request_with_custom_context(
            &endpoint,
            handshake_body,
            data,
            headers,
            context,
        );
        self.upload_request(request).await
    }

    async fn handle_master_data_bulk_retry(
        &self,
        context: &serde_json::Value,
        data: &[u8],
    ) -> RetryResult {
        let endpoint = self.endpoint_from_context(context)?;
        let period_tag = context
            .get("period_tag")
            .and_then(|v| v.as_str())
            .ok_or("missing period_tag")?;
        let table_offsets = context
            .get("table_offsets")
            .and_then(|v| v.as_str())
            .ok_or("missing table_offsets")?;
        let table_version = context
            .get("table_version")
            .and_then(|v| v.as_str())
            .unwrap_or(DATABASE_TABLE_VERSION);
        let dataset_id = self.resolve_dataset_id_for_master_data(context).await?;

        let handshake_body = serde_json::json!({
            "kc_period_tag": period_tag,
            "dataset_id": dataset_id,
            "file_size": data.len().to_string(),
            "table_offsets": table_offsets,
            "table_version": table_version,
        });

        let mut headers = HashMap::new();
        headers.insert(
            "Content-Type".to_string(),
            "application/octet-stream".to_string(),
        );

        let request = self.upload_request_with_custom_context(
            endpoint,
            handshake_body,
            data,
            headers,
            context,
        );
        self.upload_request(request).await
    }

    async fn resolve_dataset_id_for_master_data(
        &self,
        context: &serde_json::Value,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let from_context = context
            .get("dataset_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        let dataset_id = if !from_context.is_empty() {
            from_context
        } else {
            let from_member_id = crate::util::get_user_member_id().await;
            let trimmed = from_member_id.trim();
            if !trimmed.is_empty() {
                trimmed.to_string()
            } else {
                self.auth_manager
                    .resolve_dataset_id_for_upload(None)
                    .await
                    .ok_or("dataset_id not ready for master_data_bulk retry (auth unresolved)")?
            }
        };

        if dataset_id.trim().is_empty() {
            Err("dataset_id not ready for master_data_bulk retry".into())
        } else {
            Ok(dataset_id)
        }
    }

    async fn handle_operation_retry(
        &self,
        operation: &str,
        context: &serde_json::Value,
        data: &[u8],
    ) -> RetryResult {
        match operation {
            "quest_ingest" => {
                self.handle_payload_retry(context, data, PayloadHashMode::ContextPayloadHash)
                    .await
            }
            "ship_growth_ingest" | "remodel_data_ingest" | "soku_speed_ingest" => {
                self.handle_payload_retry(context, data, PayloadHashMode::ComputedContentHash)
                    .await
            }
            "localfs_write" => self.handle_localfs_write_retry(context, data).await,
            #[cfg(feature = "gdrive")]
            "upload" => self.handle_gdrive_retry(context, data).await,
            _ => Err("unsupported operation".into()),
        }
    }

    async fn handle_localfs_write_retry(
        &self,
        context: &serde_json::Value,
        data: &[u8],
    ) -> RetryResult {
        let configured_root = root_validator::resolve_root_from_config();
        let relative_path = context
            .get("relative_path")
            .and_then(|v| v.as_str())
            .ok_or("missing relative_path")?
            .to_owned();

        // Open the root as a cap-std Dir — this uses openat internally and
        // enforces containment at the kernel level.  TOCTOU between check and
        // write is structurally impossible because both operate on the same FD.
        let root_dir = std::sync::Arc::new(
            root_validator::open_root_dir(&configured_root)
                .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?,
        );
        let data_vec = data.to_vec();
        root_validator::write_at_relative_async(root_dir, relative_path, data_vec)
            .await
            .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
        Ok(())
    }

    async fn handle_payload_retry(
        &self,
        context: &serde_json::Value,
        data: &[u8],
        hash_mode: PayloadHashMode,
    ) -> RetryResult {
        let endpoint = self.endpoint_from_context(context)?;
        let mut handshake_body: serde_json::Value = serde_json::from_slice(data)?;

        if let Some(obj) = handshake_body.as_object_mut() {
            obj.insert(
                "file_size".to_string(),
                serde_json::Value::Number(serde_json::Number::from(data.len() as u64)),
            );
        }

        let headers = self.headers_for_payload_retry(context, data, hash_mode);
        let request = self.upload_request_with_custom_context(
            endpoint,
            handshake_body,
            data,
            headers,
            context,
        );
        self.upload_request(request).await
    }

    fn headers_for_payload_retry(
        &self,
        context: &serde_json::Value,
        data: &[u8],
        hash_mode: PayloadHashMode,
    ) -> HashMap<String, String> {
        let mut headers = HashMap::new();

        match hash_mode {
            PayloadHashMode::ContextPayloadHash => {
                if let Some(hash) = context.get("payload_hash").and_then(|v| v.as_str()) {
                    headers.insert("content-hash".to_string(), hash.to_string());
                }
            }
            PayloadHashMode::ComputedContentHash => {
                headers.insert("content-hash".to_string(), self.compute_content_hash(data));
            }
        }

        headers
    }

    fn compute_content_hash(&self, data: &[u8]) -> String {
        use sha2::{Digest, Sha256};

        let mut hasher = Sha256::new();
        hasher.update(data);
        format!("{:x}", hasher.finalize())
    }

    #[cfg(feature = "gdrive")]
    async fn handle_gdrive_retry(&self, context: &serde_json::Value, data: &[u8]) -> RetryResult {
        let remote_path = context
            .get("remote_path")
            .and_then(|v| v.as_str())
            .ok_or("missing remote_path")?;

        let cloud = CloudProviderFactory::create("google")
            .map_err(|e| format!("cloud provider init failed: {}", e))?;

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

                tokio::fs::set_permissions(&temp_path, std::fs::Permissions::from_mode(0o600))
                    .await?;
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
}

impl RetryHandler for AppUploadRetryHandler {
    fn handle<'a>(
        &'a self,
        context: &'a serde_json::Value,
        data: &'a [u8],
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<(), Box<dyn std::error::Error>>> + Send + 'a>,
    > {
        Box::pin(async move { self.handle_context(context, data).await })
    }
}
