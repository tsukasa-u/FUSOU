use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::sleep;
use std::path::Path;
use std::pin::Pin;
use std::future::Future;

use crate::pending_store::{PendingMeta, PendingStore};
use crate::uploader::{Uploader, UploadRequest, UploadContext};
use configs::get_user_configs;
use fusou_auth::{AuthManager, FileStorage};

pub trait RetryHandler: Send + Sync {
    fn handle<'a>(&'a self, context: &'a serde_json::Value, data: &'a [u8]) -> Pin<Box<dyn Future<Output = Result<(), Box<dyn std::error::Error>>> + Send + 'a>>;
}

pub struct UploadRetryService {
    store: Arc<PendingStore>,
    is_running: Arc<Mutex<bool>>,
    auth_manager: Arc<AuthManager<FileStorage>>,
    custom_handler: Option<Arc<dyn RetryHandler>>,
}

impl UploadRetryService {
    pub fn new(
        store: Arc<PendingStore>, 
        auth_manager: Arc<AuthManager<FileStorage>>,
        custom_handler: Option<Arc<dyn RetryHandler>>
    ) -> Self {
        Self {
            store,
            is_running: Arc::new(Mutex::new(false)),
            auth_manager,
            custom_handler,
        }
    }

    /// Get a clone of the underlying AuthManager used for retries
    pub fn auth_manager(&self) -> Arc<AuthManager<FileStorage>> {
        self.auth_manager.clone()
    }

    pub async fn trigger_retry(&self) {
        let mut running = self.is_running.lock().await;
        if *running {
            tracing::debug!("Retry process already running, skipping duplicate trigger");
            return;
        }
        *running = true;
        drop(running);

        let store = self.store.clone();
        let is_running = self.is_running.clone();
        let auth_manager = self.auth_manager.clone();
        let custom_handler = self.custom_handler.clone();

        tokio::spawn(async move {
            tracing::info!("Starting upload retry process");
            
            let configs = get_user_configs();
            let retry_config = &configs.app.asset_sync.retry;
            
            {
                // Cleanup expired first
                store.cleanup_expired(retry_config.get_ttl_seconds());

                let pending_items = store.list_pending();
                if pending_items.is_empty() {
                    tracing::info!("No pending uploads to retry");
                    let mut running = is_running.lock().await;
                    *running = false;
                    return;
                }

                tracing::info!("Found {} pending uploads to retry", pending_items.len());

                let client = reqwest::Client::new();
                
                // Track processed hashes to avoid retrying exact duplicates in single batch
                let mut processed_hashes = std::collections::HashSet::new();

                for mut meta in pending_items {
                    // Skip if we already retried this content hash in this batch
                    if let Some(hash) = meta.headers.get("content-hash") {
                        if processed_hashes.contains(hash) {
                            tracing::info!("Skipping duplicate retry for content-hash {}, already processed in this batch", hash);
                            continue;
                        }
                        processed_hashes.insert(hash.clone());
                    }

                    if meta.attempt_count >= retry_config.get_max_attempts() {
                        tracing::warn!("Max attempts ({}) reached for {}, deleting", 
                            retry_config.get_max_attempts(), meta.id);
                        let _ = store.delete_pending(&meta.id);
                        continue;
                    }

                    tracing::info!("Retrying upload {} (attempt {}/{})", 
                        meta.id, meta.attempt_count + 1, retry_config.get_max_attempts());

                    if let Err(e) = Self::retry_one(&store, &mut meta, &client, &auth_manager, custom_handler.as_deref()).await {
                        tracing::error!("Failed to retry upload {}: {}", meta.id, e);
                        meta.increment_attempt();
                        let _ = store.update_meta(&meta);
                    } else {
                        tracing::info!("Successfully retried upload {}", meta.id);
                        let _ = store.delete_pending(&meta.id);
                    }
                    
                    sleep(Duration::from_secs(1)).await;
                }

                let mut running = is_running.lock().await;
                *running = false;
                tracing::info!("Upload retry process finished");
            }
        });
    }

    async fn retry_one(
        store: &PendingStore, 
        meta: &mut PendingMeta, 
        client: &reqwest::Client,
        auth_manager: &AuthManager<FileStorage>,
        custom_handler: Option<&dyn RetryHandler>
    ) -> Result<(), Box<dyn std::error::Error>> {
        let data = store.read_data(meta)?;
        
        // Reconstruct context
        let context = if let Some(context_str) = &meta.context {
            if let Ok(ctx) = serde_json::from_str::<UploadContext>(context_str) {
                ctx
            } else {
                return Err("Invalid context".into());
            }
        } else {
            return Err("Missing context".into());
        };

        match context {
            UploadContext::Asset { relative_path, key, file_size } => {
                // Reconstruct Asset Handshake
                let configs = get_user_configs();
                let app_configs = configs.app;
                let finder_tag = app_configs.asset_sync.get_finder_tag();
                
                let filename = Path::new(&relative_path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "asset.bin".to_string());

                let handshake_body = serde_json::json!({
                    "key": key,
                    "relative_path": relative_path,
                    "file_size": file_size.to_string(),
                    "finder_tag": finder_tag,
                    "file_name": filename,
                    "content_type": "application/octet-stream"
                });

                let request = UploadRequest {
                    endpoint: &meta.target_url,
                    handshake_body,
                    data,
                    headers: meta.headers.clone(),
                    context: UploadContext::Asset { relative_path, key, file_size },
                };

                Uploader::upload(client, auth_manager, request, None)
                    .await
                    .map(|_| ())
                    .map_err(|e| e.into())
            },
            UploadContext::Snapshot { is_snapshot: _ } => {
                // Reconstruct Snapshot Handshake
                // Data is the JSON body
                let json_body: serde_json::Value = serde_json::from_slice(&data)?;
                
                let request = UploadRequest {
                    endpoint: &meta.target_url,
                    handshake_body: json_body,
                    data,
                    headers: meta.headers.clone(),
                    context: UploadContext::Snapshot { is_snapshot: true },
                };

                Uploader::upload(client, auth_manager, request, None)
                    .await
                    .map(|_| ())
                    .map_err(|e| e.into())
            },
            UploadContext::Custom(value) => {
                if let Some(handler) = custom_handler {
                    handler.handle(&value, &data).await
                } else {
                    Err("No custom handler registered".into())
                }
            }
        }
    }
}