use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, OnceLock, RwLock,
    },
    time::{Duration, Instant},
};

use fusou_auth::{AuthManager, FileStorage};
use once_cell::sync::Lazy;
use rand::{thread_rng, Rng};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{fs, sync::mpsc, task::JoinHandle, time};
use tracing;

use chrono::{DateTime, Utc};
use configs::ConfigsAppAssetSync;

use fusou_upload::{
    LocalRequestSuppressionCache, PendingStore, UploadContext, UploadRequest, UploadResult,
    UploadRetryService, Uploader,
};
use reqwest::StatusCode;

static ASSET_SYNC_HANDLE: OnceLock<JoinHandle<()>> = OnceLock::new();
// Keep asset notifications non-blocking and non-lossy.
static ASSET_SYNC_QUEUE: OnceLock<mpsc::UnboundedSender<PathBuf>> = OnceLock::new();
static ASSET_REQUEST_CACHE: Lazy<LocalRequestSuppressionCache> =
    Lazy::new(|| LocalRequestSuppressionCache::new(Duration::from_secs(24 * 60 * 60)));
static SUPABASE_AUTH_READY: AtomicBool = AtomicBool::new(false);
static SUPABASE_WAITING_LOGGED: AtomicBool = AtomicBool::new(false);
static SUPABASE_AUTH_FAILED: AtomicBool = AtomicBool::new(false);
static LAST_AUTH_FAIL_EPOCH: AtomicU64 = AtomicU64::new(0);
static SUPABASE_BACKOFF_LOGGED: AtomicBool = AtomicBool::new(false);
static PERIOD_CACHE: Lazy<RwLock<Option<PeriodCache>>> = Lazy::new(|| RwLock::new(None));
static LAST_PERIOD_TAG: Lazy<RwLock<Option<String>>> = Lazy::new(|| RwLock::new(None));
static EXISTING_KEYS_CACHE: Lazy<RwLock<Option<RemoteKeyCache>>> = Lazy::new(|| RwLock::new(None));
static PENDING_STORE: OnceLock<Arc<PendingStore>> = OnceLock::new();
// Counter for monitoring dropped notifications when queue is closed.
static DROPPED_ASSET_COUNT: AtomicU64 = AtomicU64::new(0);
static BLOCKED_EXTENSIONS: OnceLock<Vec<String>> = OnceLock::new();
const ASSET_REQUEST_CACHE_FILE: &str = "asset_request_suppression_cache.json";

const MIN_SCAN_INTERVAL_SECS: u64 = 10;
const PERIOD_CACHE_FALLBACK_SECS: u64 = 24 * 60 * 60;
const REMOTE_KEYS_CACHE_FALLBACK_SECS: u64 = 60 * 60;
const REMOTE_KEYS_REFRESH_MAX_JITTER_MS: u64 = 5_000;
const FIXED_ASSET_KEY_PREFIX: &str = "assets";

fn mask_sensitive(value: &str) -> String {
    if cfg!(debug_assertions) {
        return value.to_string();
    }
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "********".to_string();
    }
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() <= 8 {
        return "********".to_string();
    }
    let head: String = chars.iter().take(4).collect();
    let tail: String = chars
        .iter()
        .rev()
        .take(2)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{}****{}", head, tail)
}

#[derive(Debug, Clone)]
struct ExistingKeysError {
    status: Option<StatusCode>,
    message: String,
}

impl ExistingKeysError {
    fn transport(msg: impl Into<String>) -> Self {
        Self {
            status: None,
            message: msg.into(),
        }
    }

    fn http(status: StatusCode, body: String) -> Self {
        Self {
            status: Some(status),
            message: body,
        }
    }
}

impl std::fmt::Display for ExistingKeysError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.status {
            Some(status) => write!(f, "{}: {}", status, self.message),
            None => write!(f, "{}", self.message),
        }
    }
}

// Removed AssetSyncContext struct as we use UploadContext

struct PeriodCache {
    expires_at: Instant,
}

#[derive(Deserialize)]
struct PeriodApiResponse {
    tag: Option<String>,
    cache_expires_at: Option<String>,
}

struct RemoteKeyCache {
    keys: HashSet<String>,
    hashes: HashMap<String, Option<String>>, // key -> content_hash
    expires_at: Instant,
    last_sync_timestamp: Option<u64>, // ms since epoch from server snapshotUpperMs/refreshedAt
}

/// Persistent cache format for storing asset keys to disk
#[derive(Serialize, Deserialize, Default)]
struct PersistentAssetCache {
    keys: Vec<String>,
    hashes: HashMap<String, Option<String>>,
    last_sync_timestamp: Option<u64>,
    /// ISO8601 timestamp when this cache expires
    cache_expires_at: Option<String>,
}

#[derive(Deserialize)]
struct ExistingKeyItem {
    key: String,
    #[serde(default, alias = "contentHash")]
    content_hash: Option<String>,
    #[serde(default)]
    _size: Option<u64>,
    #[serde(default, rename = "uploadedAt", alias = "uploaded_at")]
    _uploaded_at: Option<u64>,
}

#[derive(Deserialize)]
struct ExistingKeysResponse {
    keys: Vec<String>,
    #[serde(default)]
    items: Vec<ExistingKeyItem>,
    #[serde(default, alias = "cacheExpiresAt")]
    cache_expires_at: Option<String>,
    #[serde(default, rename = "refreshedAt", alias = "refreshed_at")]
    refreshed_at: Option<String>,
    #[serde(default, rename = "snapshotUpperAt", alias = "snapshot_upper_at")]
    snapshot_upper_at: Option<String>,
    #[serde(default, rename = "snapshotUpperMs", alias = "snapshot_upper_ms")]
    snapshot_upper_ms: Option<u64>,
    #[serde(default)]
    incremental: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct AssetSyncInit {
    pub save_root: PathBuf,
    pub cache_root: PathBuf,
    pub api_endpoint: String,
    pub api_origin: String,
    pub key_prefix: Option<String>,
    pub scan_interval: Duration,
    pub require_supabase_auth: bool,
    pub finder_tag: Option<String>,
    pub dataset_id: Option<String>,
    pub period_endpoint: Option<String>,
    pub blocked_extensions: Vec<String>,
    pub existing_keys_endpoint: Option<String>,
    pub auth_backoff_secs: u64,
    pub retry_interval_secs: u64,
}

impl AssetSyncInit {
    pub fn from_configs(
        config: &ConfigsAppAssetSync,
        save_root: String,
        cache_root: String,
        finder_tag: Option<String>,
    ) -> Result<Self, String> {
        if save_root.trim().is_empty() {
            return Err("asset sync save path is empty".to_string());
        }
        if cache_root.trim().is_empty() {
            return Err("asset sync cache path is empty".to_string());
        }
        let api_endpoint = normalize_string(config.get_asset_sync_api_endpoint())
            .ok_or_else(|| "asset_sync.asset_sync_api_endpoint is empty".to_string())?;
        let api_origin = derive_origin(&api_endpoint)?;
        let key_prefix = Some(FIXED_ASSET_KEY_PREFIX.to_string());
        let period_endpoint = config.get_period_endpoint();
        let blocked_extensions = config.get_skip_extensions();
        let existing_keys_endpoint = config.get_existing_keys_endpoint();
        let auth_backoff_secs = config.retry.get_auth_backoff_seconds();
        let retry_interval_secs = config.retry.get_interval_seconds().max(1);

        let scan_interval_seconds = config
            .get_scan_interval_seconds()
            .max(MIN_SCAN_INTERVAL_SECS);
        let scan_interval = Duration::from_secs(scan_interval_seconds);

        Ok(Self {
            save_root: PathBuf::from(save_root),
            cache_root: PathBuf::from(cache_root),
            api_endpoint,
            api_origin,
            key_prefix,
            scan_interval,
            require_supabase_auth: true,
            dataset_id: finder_tag.clone(),
            finder_tag,
            period_endpoint,
            blocked_extensions,
            existing_keys_endpoint,
            auth_backoff_secs,
            retry_interval_secs,
        })
    }
}

fn normalize_string(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let trimmed = v.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

pub fn start(
    init: AssetSyncInit,
    auth_manager: Arc<AuthManager<FileStorage>>,
) -> Result<(), String> {
    if ASSET_SYNC_HANDLE.get().is_some() {
        tracing::debug!("asset sync worker already running");
        return Ok(());
    }

    if !init.require_supabase_auth {
        SUPABASE_AUTH_READY.store(true, Ordering::Relaxed);
        SUPABASE_WAITING_LOGGED.store(false, Ordering::Relaxed);
        SUPABASE_AUTH_FAILED.store(false, Ordering::Relaxed);
    }

    if let Err(err) = std::fs::create_dir_all(&init.save_root) {
        return Err(format!(
            "failed to create asset sync directory {}: {err}",
            init.save_root.display()
        ));
    }

    if let Err(err) =
        ASSET_REQUEST_CACHE.enable_persistence(asset_request_cache_path(&init.cache_root))
    {
        tracing::warn!(error = %err, "failed to enable persistent asset suppression cache");
    }

    // Initialize PendingStore
    let pending_dir = init.save_root.join("pending");
    let pending_store = Arc::new(PendingStore::new(pending_dir));
    let _ = PENDING_STORE.set(pending_store.clone());
    let retry_service = Arc::new(UploadRetryService::new(
        pending_store.clone(),
        auth_manager.clone(),
        None,
    ));

    let _ = BLOCKED_EXTENSIONS.set(init.blocked_extensions.clone());

    // Use unbounded channel: keep notify path lightweight and avoid queue-full drops.
    let (tx, rx) = mpsc::unbounded_channel();
    let _ = ASSET_SYNC_QUEUE.set(tx);

    let settings = Arc::new(init);
    let worker_settings = settings.clone();
    let retry_service_for_worker = retry_service.clone();
    let handle = tokio::spawn(async move {
        if let Err(err) = run_worker(
            worker_settings,
            auth_manager,
            rx,
            pending_store,
            retry_service_for_worker,
        )
        .await
        {
            tracing::error!(error = %err, "asset sync worker stopped");
        }
    });

    let retry_service_for_background = retry_service.clone();
    let retry_interval_secs = settings.retry_interval_secs;
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(retry_interval_secs));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            retry_service_for_background.trigger_retry().await;
        }
    });

    ASSET_SYNC_HANDLE
        .set(handle)
        .map_err(|_| "asset sync worker has already been started".to_string())?;

    tracing::info!(
        root = %settings.save_root.display(),
        cache_root = %settings.cache_root.display(),
        endpoint = %settings.api_endpoint,
        interval_secs = settings.scan_interval.as_secs(),
        "asset sync worker started"
    );

    Ok(())
}

pub fn notify_new_asset(path: PathBuf) {
    // Pre-filter blocked extensions before enqueuing to avoid filling the queue
    // with files that would be discarded anyway in process_path
    if let Some(blocked) = BLOCKED_EXTENSIONS.get() {
        if has_blocked_extension(&path, blocked) {
            tracing::debug!(path = ?path, "skipping blocked extension before queuing");
            return;
        }
    }

    if let Some(queue) = ASSET_SYNC_QUEUE.get() {
        match queue.send(path.clone()) {
            Ok(()) => {
                tracing::debug!(path = ?path, "Asset queued for sync");
            }
            Err(e) => {
                let dropped_count = DROPPED_ASSET_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
                tracing::warn!(
                    path = ?path,
                    dropped_count = dropped_count,
                    error = ?e,
                    "asset sync queue closed; notification dropped"
                );
            }
        }
    }
}

/// Returns the total count of asset notifications dropped because queue was closed.
pub fn get_dropped_asset_count() -> u64 {
    DROPPED_ASSET_COUNT.load(Ordering::Relaxed)
}

async fn run_worker(
    settings: Arc<AssetSyncInit>,
    auth_manager: Arc<AuthManager<FileStorage>>,
    mut rx: mpsc::UnboundedReceiver<PathBuf>,
    pending_store: Arc<PendingStore>,
    retry_service: Arc<UploadRetryService>,
) -> Result<(), String> {
    let client = build_client()
        .map_err(|err| format!("failed to initialize asset sync http client: {err}"))?;

    // In v2 mode, uploader/worker must not invoke legacy anonymous-sync v1 bootstrap.
    // Auth/session bootstrap is handled by the app-level v2 pipeline.
    if let Some(dataset_id) = settings
        .dataset_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        tracing::info!(
            dataset_id,
            "asset sync startup auth bootstrap skipped (v1 path removed; awaiting v2 bootstrap)"
        );
    }

    if let Err(err) = maybe_refresh_period(&client, &settings).await {
        tracing::warn!(error = %err, "failed to refresh asset sync period");
    }

    // Load persistent cache from disk BEFORE checking if refresh is needed.
    // Use spawn_blocking to avoid blocking the async executor on std::fs I/O.
    {
        let cache_root = settings.cache_root.clone();
        tokio::task::spawn_blocking(move || load_persistent_cache(&cache_root))
            .await
            .unwrap_or_else(|e| tracing::warn!("load_persistent_cache task panicked: {e:?}"));
    }

    // Only attempt to refresh existing keys if authentication is ready
    if check_auth_ready(&settings, &auth_manager).await {
        if let Err(err) = maybe_refresh_existing_keys(&client, &settings, &auth_manager).await {
            tracing::warn!(error = %err, "failed to refresh existing asset keys cache");
        }
        retry_service.trigger_retry().await;
    }

    let mut dataset_ready = auth_manager
        .resolve_dataset_id_for_upload(None)
        .await
        .is_some()
        || settings
            .dataset_id
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .is_some();

    while let Some(path) = rx.recv().await {
        let now_ready = auth_manager
            .resolve_dataset_id_for_upload(None)
            .await
            .is_some()
            || settings
                .dataset_id
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .is_some();
        if now_ready && !dataset_ready {
            tracing::info!(
                "dataset_id became available; triggering immediate pending upload retry"
            );
            retry_service.trigger_retry().await;
        }
        dataset_ready = now_ready;

        tracing::info!(file = %path.display(), "received new asset notification, processing...");
        if let Err(err) =
            process_path(&client, &settings, &path, &auth_manager, &pending_store).await
        {
            tracing::warn!(error = %err, file = %path.display(), "asset upload failed");
        }
    }

    tracing::info!("asset sync worker: receiver channel closed; shutting down");
    Ok(())
}

async fn check_auth_ready(
    settings: &AssetSyncInit,
    auth_manager: &AuthManager<FileStorage>,
) -> bool {
    if !settings.require_supabase_auth {
        return true;
    }

    // Cooldown after a recent authentication failure
    let backoff_secs = settings.auth_backoff_secs;
    let last_fail = LAST_AUTH_FAIL_EPOCH.load(Ordering::Relaxed);
    if last_fail > 0 {
        let now = now_epoch_secs();
        let elapsed = now.saturating_sub(last_fail);
        if elapsed < backoff_secs {
            let remaining = backoff_secs - elapsed;
            if !SUPABASE_BACKOFF_LOGGED.swap(true, Ordering::Relaxed) {
                tracing::warn!(
                    elapsed_secs = elapsed,
                    remaining_secs = remaining,
                    "authentication backoff active; waiting before retrying asset sync"
                );
            }
            return false;
        } else {
            SUPABASE_BACKOFF_LOGGED.store(false, Ordering::Relaxed);
        }
    }

    // Return cached result if already authenticated
    if SUPABASE_AUTH_READY.load(Ordering::Relaxed) {
        return true;
    }

    // Check authentication (only when not cached)
    let is_auth = auth_manager.is_authenticated().await;
    if !is_auth {
        if !SUPABASE_WAITING_LOGGED.swap(true, Ordering::Relaxed) {
            tracing::info!("Waiting for Supabase authentication before uploading assets");
        }
        return false;
    }

    // Cache successful authentication
    SUPABASE_AUTH_READY.store(true, Ordering::Relaxed);
    LAST_AUTH_FAIL_EPOCH.store(0, Ordering::Relaxed);
    SUPABASE_BACKOFF_LOGGED.store(false, Ordering::Relaxed);
    SUPABASE_AUTH_FAILED.store(false, Ordering::Relaxed);
    if SUPABASE_WAITING_LOGGED.swap(false, Ordering::Relaxed) {
        tracing::info!("Supabase authentication detected; starting asset uploads");
    }
    true
}

async fn process_path(
    client: &Client,
    settings: &AssetSyncInit,
    path: &Path,
    auth_manager: &AuthManager<FileStorage>,
    pending_store: &PendingStore,
) -> Result<(), String> {
    tracing::info!(file = %path.display(), "processing path started");
    let relative = match path.strip_prefix(&settings.save_root) {
        Ok(rel) => rel,
        Err(_) => return Err("file is outside of configured save root".into()),
    };

    if is_kcsapi(relative) {
        tracing::info!(file = %relative.display(), "skipping kcsapi file");
        tracing::info!(file = %path.display(), "processing path completed (skipped)");
        return Ok(());
    }

    if has_blocked_extension(relative, &settings.blocked_extensions) {
        tracing::info!(
            file = %relative.display(),
            "skipping because of blocked extension"
        );
        tracing::info!(file = %path.display(), "processing path completed (skipped)");
        return Ok(());
    }

    let key = match build_remote_key(relative, &settings.key_prefix) {
        Some(key) => key,
        None => return Err("unable to derive remote key".into()),
    };

    let metadata = fs::metadata(path).await.map_err(|err| err.to_string())?;
    if metadata.len() == 0 {
        tracing::info!(file = %path.display(), "skipping zero-length file");
        return Err("skip zero-length file".into());
    }

    // Compute hash early to compare with remote state
    let bytes = fs::read(path)
        .await
        .map_err(|err| format!("failed to read file for upload: {err}"))?;

    // Phase 4: CPU-bound SHA256 hashing using spawn_blocking for large files
    let local_hash = tokio::task::spawn_blocking({
        let bytes = bytes.clone();
        move || sha256_hex(&bytes)
    })
    .await
    .map_err(|e| format!("spawn_blocking hash computation failed: {}", e))?;

    if ASSET_REQUEST_CACHE.should_skip(&key, &local_hash) {
        tracing::info!(
            key = %mask_sensitive(&key),
            local_hash = %mask_sensitive(&local_hash),
            "skipping because same content hash is cached locally"
        );
        tracing::info!(file = %path.display(), "processing path completed (skipped)");
        return Ok(());
    }

    tracing::info!(check_key = %mask_sensitive(&key), "checking if remote key exists");

    if let Err(err) = maybe_refresh_existing_keys(client, settings, auth_manager).await {
        if matches!(err.status, Some(StatusCode::UNAUTHORIZED)) {
            tracing::warn!(
                key = %mask_sensitive(&key),
                "Authentication failed while checking existing keys; proceeding without remote key cache"
            );
        } else {
            tracing::warn!(
                key = %mask_sensitive(&key),
                error = %err,
                "Failed to refresh existing keys cache; proceeding with upload path"
            );
        }
    }

    // Check if remote has this key with a hash
    if let Some(remote_hash_opt) = remote_content_hash(&key) {
        if let Some(remote_hash) = remote_hash_opt {
            // Remote has hash - compare with local
            if remote_hash == local_hash {
                ASSET_REQUEST_CACHE.mark_processed(key.clone(), local_hash.clone());
                tracing::info!(
                    key = %mask_sensitive(&key),
                    local_hash = %mask_sensitive(&local_hash),
                    "skipping upload; remote content hash matches local"
                );
                return Ok(());
            } else {
                // Hash differs - need to upload updated version
                tracing::info!(
                    key = %mask_sensitive(&key),
                    local_hash = %mask_sensitive(&local_hash),
                    remote_hash = %mask_sensitive(&remote_hash),
                    "content changed, uploading updated version"
                );
            }
        } else {
            // Remote key exists but no hash - upload to populate hash
            tracing::info!(
                key = %mask_sensitive(&key),
                local_hash = %mask_sensitive(&local_hash),
                "remote exists but hash unknown, uploading to update"
            );
        }
    } else {
        // Key doesn't exist remotely - upload
        tracing::info!(
            key = %mask_sensitive(&key),
            local_hash = %mask_sensitive(&local_hash),
            "new file, uploading"
        );
    }

    upload_via_api(
        client,
        settings,
        path,
        relative,
        &key,
        metadata.len(),
        bytes,
        &local_hash,
        auth_manager,
        Some(pending_store),
    )
    .await?;
    ASSET_REQUEST_CACHE.mark_processed(key, local_hash);
    tracing::info!(file = %path.display(), "processing path completed");
    Ok(())
}

fn is_kcsapi(relative: &Path) -> bool {
    match relative.components().next() {
        Some(component) => component.as_os_str() == "kcsapi",
        None => false,
    }
}

fn build_remote_key(relative: &Path, prefix: &Option<String>) -> Option<String> {
    let rel = relative
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/");
    if rel.is_empty() {
        return None;
    }
    match prefix {
        Some(pref) if !pref.is_empty() => Some(format!("{}/{}", pref.trim_end_matches('/'), rel)),
        _ => Some(rel),
    }
}

fn has_blocked_extension(path: &Path, blocked: &[String]) -> bool {
    if blocked.is_empty() {
        return false;
    }
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) => {
            let lower = ext.trim_start_matches('.').to_ascii_lowercase();
            blocked.iter().any(|blocked_ext| blocked_ext == &lower)
        }
        None => false,
    }
}

/// Detect MIME type based on file extension
fn detect_mime_type(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        // Images
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        // Audio
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "aac" => "audio/aac",
        // Video
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        // Web
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" => "application/javascript",
        "json" => "application/json",
        "xml" => "application/xml",
        "wasm" => "application/wasm",
        // Fonts
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        // Other
        "txt" => "text/plain",
        "csv" => "text/csv",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "swf" => "application/x-shockwave-flash",
        _ => "application/octet-stream",
    }
    .to_string()
}
fn build_client() -> Result<Client, reqwest::Error> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
}

fn now_epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn derive_origin(endpoint: &str) -> Result<String, String> {
    let url = Url::parse(endpoint)
        .map_err(|err| format!("invalid asset_sync.asset_sync_api_endpoint: {err}"))?;
    let scheme = url.scheme();
    let host = url
        .host_str()
        .ok_or_else(|| "asset_sync.asset_sync_api_endpoint missing host".to_string())?;
    let origin = match url.port() {
        Some(port) => format!("{}://{}:{}", scheme, host, port),
        None => format!("{}://{}", scheme, host),
    };
    Ok(origin)
}

pub async fn upload_via_api(
    client: &Client,
    settings: &AssetSyncInit,
    path: &Path,
    relative: &Path,
    key: &str,
    file_size: u64,
    file_bytes: Vec<u8>,
    file_hash: &str,
    auth_manager: &AuthManager<FileStorage>,
    pending_store: Option<&PendingStore>,
) -> Result<(), String> {
    tracing::info!(
        key = %mask_sensitive(key),
        file = %path.display(),
        size = file_size,
        "asset upload event started"
    );

    let resolved_dataset_id = auth_manager
        .resolve_dataset_id_for_upload(None)
        .await
        .or_else(|| settings.dataset_id.clone());

    if resolved_dataset_id.as_deref() != settings.dataset_id.as_deref() {
        tracing::info!(
            configured = ?settings.dataset_id,
            resolved = ?resolved_dataset_id,
            "asset sync resolved updated dataset_id from auth state"
        );
    }

    // If dataset_id is not available yet, defer as pending instead of classifying as upload failure.
    if resolved_dataset_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .is_none()
    {
        let content_type = detect_mime_type(path);
        let mut pending_headers = std::collections::HashMap::new();
        pending_headers.insert("Origin".to_string(), settings.api_origin.clone());
        pending_headers.insert("content-hash".to_string(), file_hash.to_string());

        let context = UploadContext::Asset {
            relative_path: relative.to_string_lossy().to_string(),
            key: key.to_string(),
            file_size,
            dataset_id: None,
            content_type: Some(content_type),
        };

        if let Some(store) = pending_store {
            let context_json = serde_json::to_string(&context)
                .map_err(|e| format!("failed to serialize pending context: {e}"))?;
            store
                .save_pending(
                    &settings.api_endpoint,
                    &pending_headers,
                    &file_bytes,
                    Some(context_json),
                )
                .map_err(|e| format!("failed to save pending upload: {e}"))?;

            tracing::warn!(
                key = %mask_sensitive(key),
                "member_id_hash (dataset_id) not ready; queued asset upload as pending"
            );
            tracing::info!(key = %mask_sensitive(key), "asset upload event completed (queued pending)");
            return Ok(());
        }

        return Err("dataset_id is not ready and pending store is unavailable".to_string());
    }

    let filename = relative
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .or_else(|| path.file_name().map(|n| n.to_string_lossy().to_string()))
        .unwrap_or_else(|| "asset.bin".to_string());

    // Step 1: Handshake (build via common helper)
    let handshake_body = fusou_upload::Uploader::build_asset_sync_handshake(
        key,
        &relative.to_string_lossy(),
        file_size,
        Some(&filename),
        resolved_dataset_id.as_deref(),
    );

    let mut headers = std::collections::HashMap::new();
    headers.insert("Origin".to_string(), settings.api_origin.clone());

    // Detect MIME type based on file extension
    let content_type = detect_mime_type(path);

    let request = UploadRequest {
        endpoint: &settings.api_endpoint,
        handshake_body,
        data: file_bytes,
        headers,
        context: UploadContext::Asset {
            relative_path: relative.to_string_lossy().to_string(),
            key: key.to_string(),
            file_size,
            dataset_id: resolved_dataset_id,
            content_type: Some(content_type),
        },
    };

    match Uploader::upload(client, auth_manager, request, pending_store).await {
        Ok(UploadResult::Success) => {
            tracing::info!(
                key = %mask_sensitive(key),
                endpoint = %settings.api_endpoint,
                "asset upload event completed (success)"
            );
            register_remote_key(key, Some(file_hash));
            // Reset auth failure flag on successful upload
            SUPABASE_AUTH_FAILED.store(false, Ordering::Relaxed);
            Ok(())
        }
        Ok(UploadResult::Skipped) => {
            tracing::info!(
                key = %mask_sensitive(key),
                "asset upload event completed (already exists upstream)"
            );
            register_remote_key(key, Some(file_hash));
            Ok(())
        }
        Err(e) => {
            // Improved error detection: Check if error contains "Authentication error" prefix
            // This is safer than pattern matching against fixed strings like "401" or "RequireReauth"
            // because it's explicitly set by UploadError::AuthenticationError variant
            if e.contains("Authentication error") {
                tracing::warn!(
                    key = %mask_sensitive(key),
                    error = %mask_sensitive(&e),
                    "authentication failure detected; resetting auth cache"
                );
                SUPABASE_AUTH_READY.store(false, Ordering::Relaxed);
                SUPABASE_AUTH_FAILED.store(true, Ordering::Relaxed);
                LAST_AUTH_FAIL_EPOCH.store(now_epoch_secs(), Ordering::Relaxed);
                SUPABASE_BACKOFF_LOGGED.store(false, Ordering::Relaxed);
                SUPABASE_WAITING_LOGGED.store(false, Ordering::Relaxed);
            }
            tracing::info!(key = %mask_sensitive(key), "asset upload event completed (failed)");
            Err(e)
        }
    }
}

async fn maybe_refresh_period(client: &Client, settings: &AssetSyncInit) -> Result<(), String> {
    let endpoint = match settings.period_endpoint.as_deref() {
        Some(value) => value,
        None => return Ok(()),
    };

    if !should_refresh_period_cache() {
        return Ok(());
    }

    let response = client
        .get(endpoint)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|err| format!("failed to query period endpoint: {err}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "period endpoint returned {}: {}",
            status,
            body.trim()
        ));
    }

    let payload: PeriodApiResponse = response
        .json()
        .await
        .map_err(|err| format!("failed to decode period endpoint payload: {err}"))?;

    cache_period_value(payload);
    Ok(())
}

fn should_refresh_period_cache() -> bool {
    match PERIOD_CACHE
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        Some(cache) => cache.expires_at <= Instant::now(),
        None => true,
    }
}

fn cache_period_value(payload: PeriodApiResponse) {
    let ttl = parse_cache_ttl(&payload);
    let expires_at = Instant::now() + ttl;
    let tag = payload.tag.clone();

    {
        let mut guard = PERIOD_CACHE.write().unwrap_or_else(|e| e.into_inner());
        *guard = Some(PeriodCache { expires_at });
    }

    apply_period_transition(tag);
}

fn parse_cache_ttl(payload: &PeriodApiResponse) -> Duration {
    if let Some(ref iso) = payload.cache_expires_at {
        if let Some(duration) = duration_until(iso) {
            if duration.is_zero() {
                return Duration::from_secs(1);
            }
            return duration;
        }
    }
    Duration::from_secs(PERIOD_CACHE_FALLBACK_SECS)
}

fn duration_until(iso: &str) -> Option<Duration> {
    let expiry = DateTime::parse_from_rfc3339(iso).ok()?.with_timezone(&Utc);
    let diff = expiry.signed_duration_since(Utc::now());

    // If the expiry time is in the past, return None instead of negative duration
    // This prevents errors when converting to std::time::Duration
    if diff.num_seconds() <= 0 {
        return None;
    }

    diff.to_std().ok()
}

fn apply_period_transition(new_tag: Option<String>) {
    // Assets are content-addressed and cross-period: do NOT clear the suppression cache
    // on period change. Use a fixed scope string so rotate_scope never triggers a clear,
    // regardless of what scope was persisted to disk from a previous run.
    ASSET_REQUEST_CACHE.rotate_scope(Some("asset:global"));

    let mut guard = LAST_PERIOD_TAG.write().unwrap_or_else(|e| e.into_inner());

    let changed = match (&*guard, &new_tag) {
        (Some(prev), Some(curr)) => prev != curr,
        (None, Some(_)) => true,
        (Some(_), None) => true,
        (None, None) => false,
    };

    if changed {
        let label = new_tag.as_deref().unwrap_or("<none>");
        tracing::info!(
            period_tag = label,
            "asset sync period advanced (asset suppression cache preserved across periods)"
        );
        *guard = new_tag;
    }
}

async fn maybe_refresh_existing_keys(
    client: &Client,
    settings: &AssetSyncInit,
    auth_manager: &AuthManager<FileStorage>,
) -> Result<(), ExistingKeysError> {
    let endpoint = match settings.existing_keys_endpoint.as_deref() {
        Some(value) => value,
        None => {
            tracing::warn!(
                "existing_keys_endpoint is not configured; remote key cache is disabled"
            );
            return Ok(());
        }
    };

    if remote_cache_is_fresh() {
        tracing::info!("remote key cache is still fresh; skipping refresh");
        return Ok(());
    }

    tracing::info!(
        "remote key cache is stale or missing; refreshing from API: {}",
        endpoint
    );

    wait_for_remote_cache_jitter().await;

    // Get access token for Authorization header
    tracing::info!("maybe_refresh_existing_keys: requesting access token from auth_manager");
    let access_token = auth_manager.get_access_token().await.map_err(|err| {
        ExistingKeysError::transport(format!(
            "failed to get access token for existing keys API: {err}"
        ))
    })?;

    // Get last sync timestamp for incremental sync
    let last_sync_ts = get_last_sync_timestamp();
    let url = if let Some(ts) = last_sync_ts {
        tracing::info!(
            "maybe_refresh_existing_keys: incremental sync, since={}",
            ts
        );
        format!("{}?since={}", endpoint, ts)
    } else {
        tracing::info!("maybe_refresh_existing_keys: full sync (no previous timestamp)");
        endpoint.to_string()
    };

    tracing::info!(
        endpoint = %url,
        token_len = access_token.len(),
        "maybe_refresh_existing_keys: got access token and calling API"
    );

    let response = client
        .get(&url)
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|err| {
            ExistingKeysError::transport(format!("failed to query existing keys endpoint: {err}"))
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        // Check if it's a 401 (Unauthorized) error - indicates token expiry
        if status == StatusCode::UNAUTHORIZED {
            SUPABASE_AUTH_FAILED.store(true, Ordering::Relaxed);
            SUPABASE_AUTH_READY.store(false, Ordering::Relaxed);
            LAST_AUTH_FAIL_EPOCH.store(now_epoch_secs(), Ordering::Relaxed);
            SUPABASE_BACKOFF_LOGGED.store(false, Ordering::Relaxed);
            tracing::warn!("existing keys endpoint returned 401; marking authentication as failed");
        }

        return Err(ExistingKeysError::http(status, body.trim().to_string()));
    }

    let payload: ExistingKeysResponse = response.json().await.map_err(|err| {
        ExistingKeysError::transport(format!("failed to decode existing keys payload: {err}"))
    })?;

    let is_incremental = payload.incremental.unwrap_or(false);
    cache_remote_keys(payload, is_incremental, &settings.cache_root).await;
    Ok(())
}

async fn wait_for_remote_cache_jitter() {
    if REMOTE_KEYS_REFRESH_MAX_JITTER_MS == 0 {
        return;
    }
    let delay_ms = thread_rng().gen_range(0..=REMOTE_KEYS_REFRESH_MAX_JITTER_MS);
    if delay_ms == 0 {
        return;
    }
    time::sleep(Duration::from_millis(delay_ms)).await;
}

fn remote_cache_is_fresh() -> bool {
    match EXISTING_KEYS_CACHE
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        Some(cache) => cache.expires_at > Instant::now(),
        None => false,
    }
}

async fn cache_remote_keys(payload: ExistingKeysResponse, is_incremental: bool, cache_root: &Path) {
    let ttl = payload
        .cache_expires_at
        .as_deref()
        .and_then(duration_until)
        .filter(|duration| !duration.is_zero())
        .unwrap_or_else(|| Duration::from_secs(REMOTE_KEYS_CACHE_FALLBACK_SECS));

    let expires_at = Instant::now() + ttl;

    // Use snapshotUpperMs as the primary incremental boundary, then fall back.
    let new_sync_ts = payload
        .snapshot_upper_ms
        .or_else(|| {
            payload
                .snapshot_upper_at
                .as_deref()
                .and_then(parse_iso_to_millis)
        })
        .or_else(|| {
            payload
                .refreshed_at
                .as_deref()
                .and_then(parse_iso_to_millis)
        });

    // Build new keys and hashes from payload
    let new_keys: HashSet<String> = payload.keys.iter().cloned().collect();
    let mut new_hashes: HashMap<String, Option<String>> = HashMap::new();
    for item in payload.items.into_iter() {
        new_hashes.insert(item.key.clone(), item.content_hash);
    }
    // Ensure keys from legacy `keys` field are present in hash map (with None if absent)
    for k in &new_keys {
        new_hashes.entry(k.clone()).or_insert(None);
    }

    let (final_keys, final_hashes, final_sync_ts) = if is_incremental {
        // Merge with existing cache
        let existing_guard = EXISTING_KEYS_CACHE
            .read()
            .unwrap_or_else(|e| e.into_inner());

        let (mut merged_keys, mut merged_hashes, _old_ts) = match existing_guard.as_ref() {
            Some(cache) => (
                cache.keys.clone(),
                cache.hashes.clone(),
                cache.last_sync_timestamp,
            ),
            None => (HashSet::new(), HashMap::new(), None),
        };
        drop(existing_guard);

        // Merge new keys into existing
        merged_keys.extend(new_keys.clone());
        for (k, v) in new_hashes {
            merged_hashes.insert(k, v);
        }

        tracing::info!(
            new_count = new_keys.len(),
            total_count = merged_keys.len(),
            "incremental sync: merged {} new keys into cache",
            new_keys.len()
        );
        (merged_keys, merged_hashes, new_sync_ts)
    } else {
        // Full sync - replace entire cache
        tracing::info!(
            count = new_keys.len(),
            "full sync: replacing entire cache with {} keys",
            new_keys.len()
        );
        (new_keys, new_hashes, new_sync_ts)
    };

    let count = final_keys.len();

    tracing::info!(
        count = count,
        expires_in_secs = ttl.as_secs(),
        last_sync_ts = ?final_sync_ts,
        "caching remote keys. sample: {:?}",
        final_keys.iter().take(5).collect::<Vec<_>>()
    );

    {
        let mut guard = EXISTING_KEYS_CACHE
            .write()
            .unwrap_or_else(|e| e.into_inner());
        *guard = Some(RemoteKeyCache {
            keys: final_keys.clone(),
            hashes: final_hashes.clone(),
            expires_at,
            last_sync_timestamp: final_sync_ts,
        });
    }

    // Persist to disk for recovery after restart.
    // Use spawn_blocking to avoid blocking the async executor on std::fs I/O.
    let cache_root_buf = cache_root.to_path_buf();
    tokio::task::spawn_blocking(move || {
        save_persistent_cache(&cache_root_buf, &final_keys, &final_hashes, final_sync_ts)
    })
    .await
    .unwrap_or_else(|e| tracing::warn!("save_persistent_cache task panicked: {e:?}"));

    tracing::debug!(count = count, "existing remote asset key cache refreshed");
}

fn register_remote_key(key: &str, hash: Option<&str>) {
    let mut guard = EXISTING_KEYS_CACHE
        .write()
        .unwrap_or_else(|e| e.into_inner());

    match guard.as_mut() {
        Some(cache) => {
            cache.keys.insert(key.to_string());
            // Always update hash, don't use or_insert which preserves existing values
            cache
                .hashes
                .insert(key.to_string(), hash.map(|s| s.to_string()));
            if cache.expires_at <= Instant::now() {
                cache.expires_at =
                    Instant::now() + Duration::from_secs(REMOTE_KEYS_CACHE_FALLBACK_SECS);
            }
        }
        None => {
            let mut keys = HashSet::new();
            let mut hashes = HashMap::new();
            keys.insert(key.to_string());
            hashes.insert(key.to_string(), hash.map(|s| s.to_string()));
            *guard = Some(RemoteKeyCache {
                keys,
                hashes,
                expires_at: Instant::now() + Duration::from_secs(REMOTE_KEYS_CACHE_FALLBACK_SECS),
                last_sync_timestamp: None,
            });
        }
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest.iter().map(|b| format!("{:02x}", b)).collect()
}

fn remote_content_hash(key: &str) -> Option<Option<String>> {
    EXISTING_KEYS_CACHE
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .and_then(|cache| cache.hashes.get(key).cloned())
}

// ==================== Persistent Cache Helpers ====================

const PERSISTENT_CACHE_FILENAME: &str = "asset_sync_cache.json";

fn asset_request_cache_path(save_root: &Path) -> PathBuf {
    save_root
        .join("cache")
        .join("request_suppression")
        .join("asset_sync")
        .join(ASSET_REQUEST_CACHE_FILE)
}

fn persistent_remote_cache_path(save_root: &Path) -> PathBuf {
    save_root
        .join("cache")
        .join("remote_keys")
        .join("asset_sync")
        .join(PERSISTENT_CACHE_FILENAME)
}

/// Parse ISO8601 datetime string to milliseconds since epoch
fn parse_iso_to_millis(iso: &str) -> Option<u64> {
    DateTime::parse_from_rfc3339(iso)
        .ok()
        .map(|dt| dt.timestamp_millis() as u64)
}

/// Get last sync timestamp from in-memory cache
fn get_last_sync_timestamp() -> Option<u64> {
    EXISTING_KEYS_CACHE
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .and_then(|cache| cache.last_sync_timestamp)
}

/// Load persistent cache from disk into memory
fn load_persistent_cache(save_root: &Path) {
    let cache_path = persistent_remote_cache_path(save_root);

    if !cache_path.exists() {
        tracing::info!(
            "No persistent asset cache found at {:?}; will perform full sync on first API call",
            cache_path
        );
        return;
    }

    match std::fs::read_to_string(&cache_path) {
        Ok(content) => {
            match serde_json::from_str::<PersistentAssetCache>(&content) {
                Ok(persisted) => {
                    let keys: HashSet<String> = persisted.keys.into_iter().collect();
                    let count = keys.len();

                    // Parse cache expiration time from ISO8601
                    let (expires_at, cache_status) = match persisted.cache_expires_at.as_deref() {
                        Some(iso) => match duration_until(iso) {
                            Some(duration) => (Instant::now() + duration, "valid"),
                            None => {
                                // Expiry time is in the past
                                (Instant::now(), "expired (past timestamp)")
                            }
                        },
                        None => {
                            // No expiry timestamp in cache file
                            (Instant::now(), "expired (missing timestamp)")
                        }
                    };

                    let is_expired = expires_at <= Instant::now();

                    tracing::info!(
                        count = count,
                        last_sync_ts = ?persisted.last_sync_timestamp,
                        cache_status = cache_status,
                        cache_expired = is_expired,
                        "Loaded persistent asset cache from disk"
                    );

                    let mut guard = EXISTING_KEYS_CACHE
                        .write()
                        .unwrap_or_else(|e| e.into_inner());

                    // Only load if cache is empty (not already populated)
                    if guard.is_none() {
                        *guard = Some(RemoteKeyCache {
                            keys,
                            hashes: persisted.hashes,
                            expires_at,
                            last_sync_timestamp: persisted.last_sync_timestamp,
                        });

                        if is_expired {
                            tracing::info!(
                                "Persistent cache has expired; incremental sync will be triggered"
                            );
                        } else {
                            tracing::info!(
                                "Persistent cache is still valid; API call will be skipped"
                            );
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!("Failed to parse persistent asset cache: {}", e);
                }
            }
        }
        Err(e) => {
            tracing::warn!("Failed to read persistent asset cache: {}", e);
        }
    }
}

/// Save current cache to disk for persistence
fn save_persistent_cache(
    save_root: &Path,
    keys: &HashSet<String>,
    hashes: &HashMap<String, Option<String>>,
    last_sync_ts: Option<u64>,
) {
    let cache_path = persistent_remote_cache_path(save_root);
    if let Some(parent) = cache_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::warn!("Failed to create persistent asset cache directory: {}", e);
            return;
        }
    }

    // Get cache_expires_at from current in-memory cache
    let cache_expires_at = EXISTING_KEYS_CACHE
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .and_then(|cache| {
            // Only save expiry time if it's still in the future
            if cache.expires_at > Instant::now() {
                let remaining = cache.expires_at.duration_since(Instant::now());
                let future = Utc::now() + chrono::Duration::from_std(remaining).ok()?;
                Some(future.to_rfc3339())
            } else {
                // Cache has already expired, don't save an expired timestamp
                None
            }
        });

    let cache_expires_at_display = cache_expires_at.clone();

    let persisted = PersistentAssetCache {
        keys: keys.iter().cloned().collect(),
        hashes: hashes.clone(),
        last_sync_timestamp: last_sync_ts,
        cache_expires_at,
    };

    match serde_json::to_string_pretty(&persisted) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&cache_path, json) {
                tracing::warn!("Failed to write persistent asset cache: {}", e);
            } else {
                tracing::info!(
                    count = keys.len(),
                    last_sync_ts = ?last_sync_ts,
                    cache_expires_at = ?cache_expires_at_display,
                    "Saved persistent asset cache to {:?}",
                    cache_path
                );
            }
        }
        Err(e) => {
            tracing::warn!("Failed to serialize persistent asset cache: {}", e);
        }
    }
}
