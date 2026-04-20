use std::future::Future;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use tokio::time::sleep;

use crate::pending_store::{PendingMeta, PendingStore};
use crate::uploader::{UploadContext, UploadRequest, Uploader};
use configs::get_user_configs;
use fusou_auth::{AuthManager, FileStorage};

pub trait RetryHandler: Send + Sync {
    fn handle<'a>(
        &'a self,
        context: &'a serde_json::Value,
        data: &'a [u8],
    ) -> Pin<Box<dyn Future<Output = Result<(), Box<dyn std::error::Error>>> + Send + 'a>>;
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
        custom_handler: Option<Arc<dyn RetryHandler>>,
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
        self.trigger_retry_internal(false).await;
    }

    pub async fn trigger_retry_force(&self) {
        self.trigger_retry_internal(true).await;
    }

    async fn trigger_retry_internal(&self, force: bool) {
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
            tracing::info!(force, "Starting upload retry process");

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

                let client = reqwest::Client::builder()
                    .connect_timeout(std::time::Duration::from_secs(10))
                    .timeout(std::time::Duration::from_secs(60))
                    .build()
                    .unwrap_or_default();

                // Track processed hashes to avoid retrying exact duplicates in single batch
                let mut processed_hashes = std::collections::HashSet::new();

                for mut meta in pending_items {
                    // Skip if we already retried this content hash in this batch
                    if let Some(hash) = meta.headers.get("content-hash") {
                        if processed_hashes.contains(hash) {
                            tracing::info!("Removing redundant duplicate for content-hash {}, already processed in this batch", hash);
                            // Delete from store so it does not reappear in every future cycle
                            let _ = store.delete_pending(&meta.id);
                            continue;
                        }
                        processed_hashes.insert(hash.clone());
                    }

                    if meta.attempt_count >= retry_config.get_max_attempts() {
                        tracing::warn!(
                            "Max attempts ({}) reached for {}, deleting",
                            retry_config.get_max_attempts(),
                            meta.id
                        );
                        let _ = store.delete_pending(&meta.id);
                        continue;
                    }

                    if !force && !Self::is_due_for_retry(&meta, retry_config.get_interval_seconds())
                    {
                        continue;
                    }

                    tracing::info!(
                        "Retrying upload {} (attempt {}/{})",
                        meta.id,
                        meta.attempt_count + 1,
                        retry_config.get_max_attempts()
                    );

                    let retry_result = Self::retry_one(
                        &store,
                        &mut meta,
                        &client,
                        &auth_manager,
                        custom_handler.as_deref(),
                    )
                    .await
                    .map_err(|e| e.to_string());

                    if let Err(error_text) = retry_result {
                        let is_auth_error = Self::is_auth_related_error(&error_text);

                        if is_auth_error {
                            tracing::warn!(
                                "Authentication-related retry failure for {}. Backing off for {} seconds before next retry cycle: {}",
                                meta.id,
                                retry_config.get_auth_backoff_seconds(),
                                error_text
                            );
                        } else {
                            tracing::error!("Failed to retry upload {}: {}", meta.id, error_text);
                            meta.increment_attempt(Self::now_epoch_seconds());
                            let _ = store.update_meta(&meta);
                        }

                        if is_auth_error {
                            sleep(Duration::from_secs(retry_config.get_auth_backoff_seconds()))
                                .await;
                            break;
                        }
                    } else {
                        tracing::info!("Successfully retried upload {}", meta.id);
                        let _ = store.delete_pending(&meta.id);
                    }

                    let item_interval = retry_config.get_item_interval_seconds();
                    if item_interval > 0 {
                        sleep(Duration::from_secs(item_interval)).await;
                    }
                }

                let mut running = is_running.lock().await;
                *running = false;
                tracing::info!("Upload retry process finished");
            }
        });
    }

    pub fn now_epoch_seconds() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    fn exponential_delay_seconds(base_interval_seconds: u64, attempt_count: u32) -> u64 {
        let shift = attempt_count.min(20);
        let multiplier = 1u64 << shift;
        base_interval_seconds.saturating_mul(multiplier)
    }

    fn jittered_delay_seconds(base_delay_seconds: u64, id: &str, attempt_count: u32) -> u64 {
        if base_delay_seconds == 0 {
            return 0;
        }

        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        id.hash(&mut hasher);
        attempt_count.hash(&mut hasher);
        let hash = hasher.finish();

        // Deterministic jitter in range [-20.00%, +20.00%]
        let jitter_bp = (hash % 4001) as i64 - 2000;
        let factor_bp = (10_000i64 + jitter_bp).max(1);
        let adjusted = (base_delay_seconds as u128)
            .saturating_mul(factor_bp as u128)
            .saturating_div(10_000u128);
        adjusted.max(1) as u64
    }

    pub fn next_due_epoch_seconds(meta: &PendingMeta, base_interval_seconds: u64) -> u64 {
        let reference = meta.last_attempt_at.unwrap_or(meta.created_at);
        let base_wait = Self::exponential_delay_seconds(base_interval_seconds, meta.attempt_count);
        let jittered_wait = Self::jittered_delay_seconds(base_wait, &meta.id, meta.attempt_count);
        reference.saturating_add(jittered_wait)
    }

    fn is_due_for_retry(meta: &PendingMeta, base_interval_seconds: u64) -> bool {
        let now = Self::now_epoch_seconds();
        now >= Self::next_due_epoch_seconds(meta, base_interval_seconds)
    }

    fn is_auth_related_error(message: &str) -> bool {
        let normalized = message.to_ascii_lowercase();
        // Use specific prefixes only; substring-matching "401"/"403" risks false-positive
        // matches against response bodies that happen to contain those digit sequences.
        // All UploadError::AuthenticationError variants already produce "authentication error" prefix.
        normalized.contains("authentication error")
            || normalized.contains("failed to obtain access token")
    }

    async fn retry_one(
        store: &PendingStore,
        meta: &mut PendingMeta,
        client: &reqwest::Client,
        auth_manager: &AuthManager<FileStorage>,
        custom_handler: Option<&dyn RetryHandler>,
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
            UploadContext::Asset {
                relative_path,
                key,
                file_size,
                dataset_id,
                content_type,
            } => {
                let resolved_dataset_id = if dataset_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                    .is_some()
                {
                    dataset_id.clone()
                } else {
                    auth_manager.resolve_dataset_id_for_upload(None).await
                };

                if dataset_id.is_none() && resolved_dataset_id.is_some() {
                    tracing::info!(
                        original = ?dataset_id,
                        resolved = ?resolved_dataset_id,
                        "retry service filled missing asset dataset_id from latest auth-linked value"
                    );
                }

                let filename = Path::new(&relative_path)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "asset.bin".to_string());

                let handshake_body = Uploader::build_asset_sync_handshake(
                    &key,
                    &relative_path,
                    file_size,
                    Some(&filename),
                    resolved_dataset_id.as_deref(),
                );

                let request = UploadRequest {
                    endpoint: &meta.target_url,
                    handshake_body,
                    data,
                    headers: meta.headers.clone(),
                    context: UploadContext::Asset {
                        relative_path,
                        key,
                        file_size,
                        dataset_id: resolved_dataset_id,
                        content_type,
                    },
                };

                Uploader::upload(client, auth_manager, request, None)
                    .await
                    .map(|_| ())
                    .map_err(|e| e.into())
            }
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
            }
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
