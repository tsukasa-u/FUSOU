use std::future::Future;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
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
    is_running: Arc<AtomicBool>,
    auth_manager: Arc<AuthManager<FileStorage>>,
    custom_handler: Option<Arc<dyn RetryHandler>>,
}

struct RunningFlagGuard {
    is_running: Arc<AtomicBool>,
}

impl Drop for RunningFlagGuard {
    fn drop(&mut self) {
        self.is_running.store(false, Ordering::Release);
    }
}

#[derive(Default)]
struct RetryBatchStats {
    total_pending: usize,
    due_now: usize,
    deferred: usize,
    attempted: usize,
    succeeded: usize,
    failed: usize,
    duplicate_removed: usize,
    exhausted_removed: usize,
    auth_blocked: bool,
    next_due_at: Option<u64>,
}

impl RetryBatchStats {
    fn note_deferred(&mut self, next_due_at: u64) {
        self.deferred += 1;
        self.next_due_at = Some(match self.next_due_at {
            Some(existing) => existing.min(next_due_at),
            None => next_due_at,
        });
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RetryKind {
    DatasetBound,
    Other,
}

impl UploadRetryService {
    pub fn new(
        store: Arc<PendingStore>,
        auth_manager: Arc<AuthManager<FileStorage>>,
        custom_handler: Option<Arc<dyn RetryHandler>>,
    ) -> Self {
        Self {
            store,
            is_running: Arc::new(AtomicBool::new(false)),
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
        if self
            .is_running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            tracing::debug!("Retry process already running, skipping duplicate trigger");
            return;
        }

        let store = self.store.clone();
        let is_running = self.is_running.clone();
        let auth_manager = self.auth_manager.clone();
        let custom_handler = self.custom_handler.clone();

        tokio::spawn(async move {
            let _running_guard = RunningFlagGuard { is_running };
            tracing::info!(force, "Starting upload retry process");

            let configs = get_user_configs();
            let retry_config = &configs.app.asset_sync.retry;

            {
                // Cleanup expired first
                store.cleanup_expired(retry_config.get_ttl_seconds());

                let pending_items = store.list_pending();
                if pending_items.is_empty() {
                    tracing::info!("No pending uploads to retry");
                    return;
                }

                let mut stats = RetryBatchStats {
                    total_pending: pending_items.len(),
                    ..RetryBatchStats::default()
                };
                let batch_started_at = Self::now_epoch_seconds();
                let dataset_id_ready = auth_manager
                    .resolve_dataset_id_for_upload(None)
                    .await
                    .is_some();

                if !dataset_id_ready {
                    tracing::info!(
                        "dataset_id is not ready; retry loop will defer dataset-bound pending items"
                    );
                }

                tracing::info!(
                    total_pending = stats.total_pending,
                    force,
                    "Loaded pending upload batch"
                );

                let client = reqwest::Client::builder()
                    .connect_timeout(std::time::Duration::from_secs(10))
                    .timeout(std::time::Duration::from_secs(60))
                    .build()
                    .unwrap_or_default();

                // Track processed hashes to avoid retrying exact duplicates in single batch
                let mut processed_hashes = std::collections::HashSet::new();

                for mut meta in pending_items {
                    if !dataset_id_ready
                        && Self::classify_retry_kind(&meta) == RetryKind::DatasetBound
                    {
                        let current_now = Self::now_epoch_seconds();
                        let next_due_at =
                            current_now.saturating_add(retry_config.get_interval_seconds());
                        stats.note_deferred(next_due_at);
                        tracing::debug!(
                            pending_id = %meta.id,
                            "dataset_id not ready; deferring dataset-bound pending retry"
                        );
                        continue;
                    }

                    if meta.attempt_count >= retry_config.get_max_attempts() {
                        tracing::warn!(
                            "Max attempts ({}) reached for {}, deleting",
                            retry_config.get_max_attempts(),
                            meta.id
                        );
                        let _ = store.delete_pending(&meta.id);
                        stats.exhausted_removed += 1;
                        continue;
                    }

                    if !force {
                        let current_now = Self::now_epoch_seconds();
                        let next_due_at = Self::next_due_epoch_seconds(
                            &meta,
                            retry_config.get_interval_seconds(),
                        );
                        if current_now < next_due_at {
                            stats.note_deferred(next_due_at);
                            continue;
                        }
                    }

                    // Deduplicate only among items we are actually attempting this cycle.
                    if let Some(duplicate_key) = Self::duplicate_key(&meta) {
                        if processed_hashes.contains(&duplicate_key) {
                            tracing::info!(
                                pending_id = %meta.id,
                                "Removing redundant pending upload already covered in this batch"
                            );
                            let _ = store.delete_pending(&meta.id);
                            stats.duplicate_removed += 1;
                            continue;
                        }
                        processed_hashes.insert(duplicate_key);
                    }

                    stats.due_now += 1;
                    stats.attempted += 1;

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
                            stats.auth_blocked = true;
                        } else {
                            tracing::error!("Failed to retry upload {}: {}", meta.id, error_text);
                            meta.increment_attempt(Self::now_epoch_seconds());
                            let _ = store.update_meta(&meta);
                            stats.failed += 1;
                        }

                        if is_auth_error {
                            sleep(Duration::from_secs(retry_config.get_auth_backoff_seconds()))
                                .await;
                            break;
                        }
                    } else {
                        tracing::info!("Successfully retried upload {}", meta.id);
                        let _ = store.delete_pending(&meta.id);
                        stats.succeeded += 1;
                    }

                    let item_interval = retry_config.get_item_interval_seconds();
                    if item_interval > 0 {
                        sleep(Duration::from_secs(item_interval)).await;
                    }
                }

                if stats.attempted == 0 && stats.deferred > 0 {
                    let seconds_until_next_due = stats
                        .next_due_at
                        .map(|next_due_at| next_due_at.saturating_sub(batch_started_at))
                        .unwrap_or_default();
                    tracing::info!(
                        total_pending = stats.total_pending,
                        deferred = stats.deferred,
                        seconds_until_next_due,
                        next_due_at = stats.next_due_at,
                        "Pending uploads exist but none are due yet"
                    );
                }
                tracing::info!(
                    total_pending = stats.total_pending,
                    due_now = stats.due_now,
                    deferred = stats.deferred,
                    attempted = stats.attempted,
                    succeeded = stats.succeeded,
                    failed = stats.failed,
                    duplicate_removed = stats.duplicate_removed,
                    exhausted_removed = stats.exhausted_removed,
                    auth_blocked = stats.auth_blocked,
                    "Upload retry process finished"
                );
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

    fn is_auth_related_error(message: &str) -> bool {
        let normalized = message.to_ascii_lowercase();
        // Use specific prefixes only; substring-matching "401"/"403" risks false-positive
        // matches against response bodies that happen to contain those digit sequences.
        // All UploadError::AuthenticationError variants already produce "authentication error" prefix.
        normalized.contains("authentication error")
            || normalized.contains("failed to obtain access token")
    }

    fn duplicate_key(meta: &PendingMeta) -> Option<String> {
        let content_hash = meta.headers.get("content-hash")?;
        let remote_path = meta
            .headers
            .get("remote-path")
            .map(String::as_str)
            .unwrap_or_default();
        let context = meta.context.as_deref().unwrap_or_default();
        Some(format!(
            "{}|{}|{}|{}",
            meta.target_url, content_hash, remote_path, context
        ))
    }

    fn classify_retry_kind(meta: &PendingMeta) -> RetryKind {
        if meta.target_url == "localfs" {
            return RetryKind::Other;
        }

        let Some(context_str) = meta.context.as_deref() else {
            return RetryKind::Other;
        };

        let Ok(context_json) = serde_json::from_str::<serde_json::Value>(context_str) else {
            return RetryKind::Other;
        };

        if context_json.get("provider").and_then(|v| v.as_str()) == Some("r2") {
            return RetryKind::DatasetBound;
        }

        let operation = context_json.get("operation").and_then(|v| v.as_str());
        if operation == Some("localfs_write") {
            return RetryKind::Other;
        }

        RetryKind::Other
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
