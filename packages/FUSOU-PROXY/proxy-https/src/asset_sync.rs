use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, OnceLock, RwLock,
    },
    time::{Duration, Instant},
};

use dashmap::DashSet;
use once_cell::sync::Lazy;
use rand::{thread_rng, Rng};
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use tokio::{
    fs,
    sync::mpsc::{self, UnboundedReceiver, UnboundedSender},
    task::JoinHandle,
    time,
};
use tracing;
use fusou_auth::{FileStorage, AuthManager};

use chrono::{DateTime, Utc};
use configs::ConfigsAppAssetSync;

use fusou_upload::{PendingStore, Uploader, UploadRequest, UploadContext, UploadResult};
use reqwest::StatusCode;

static ASSET_SYNC_HANDLE: OnceLock<JoinHandle<()>> = OnceLock::new();
static ASSET_SYNC_QUEUE: OnceLock<UnboundedSender<PathBuf>> = OnceLock::new();
static PROCESSED_KEYS: Lazy<DashSet<String>> = Lazy::new(DashSet::new);
static SUPABASE_AUTH_READY: AtomicBool = AtomicBool::new(false);
static SUPABASE_WAITING_LOGGED: AtomicBool = AtomicBool::new(false);
static SUPABASE_AUTH_FAILED: AtomicBool = AtomicBool::new(false);
static LAST_AUTH_FAIL_EPOCH: AtomicU64 = AtomicU64::new(0);
static SUPABASE_BACKOFF_LOGGED: AtomicBool = AtomicBool::new(false);
static PERIOD_CACHE: Lazy<RwLock<Option<PeriodCache>>> = Lazy::new(|| RwLock::new(None));
static LAST_PERIOD_TAG: Lazy<RwLock<Option<String>>> = Lazy::new(|| RwLock::new(None));
static EXISTING_KEYS_CACHE: Lazy<RwLock<Option<RemoteKeyCache>>> = Lazy::new(|| RwLock::new(None));
static PENDING_STORE: OnceLock<Arc<PendingStore>> = OnceLock::new();

const MIN_SCAN_INTERVAL_SECS: u64 = 10;
const PERIOD_CACHE_FALLBACK_SECS: u64 = 24 * 60 * 60;
const REMOTE_KEYS_CACHE_FALLBACK_SECS: u64 = 60 * 60;
const REMOTE_KEYS_REFRESH_MAX_JITTER_MS: u64 = 5_000;

#[derive(Debug, Clone)]
struct ExistingKeysError {
    status: Option<StatusCode>,
    message: String,
}

impl ExistingKeysError {
    fn transport(msg: impl Into<String>) -> Self {
        Self { status: None, message: msg.into() }
    }

    fn http(status: StatusCode, body: String) -> Self {
        Self { status: Some(status), message: body }
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

#[derive(Serialize)]
struct UploadHandshakeRequest {
    key: String,
    relative_path: String,
    file_size: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    finder_tag: Option<String>,
    file_name: String,
    content_type: String,
}



#[derive(Deserialize)]
struct PeriodApiResponse {
    tag: Option<String>,
    cache_expires_at: Option<String>,
}

struct RemoteKeyCache {
    keys: HashSet<String>,
    expires_at: Instant,
}

#[derive(Deserialize)]
struct ExistingKeysResponse {
    keys: Vec<String>,
    cache_expires_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AssetSyncInit {
    pub save_root: PathBuf,
    pub api_endpoint: String,
    pub api_origin: String,
    pub key_prefix: Option<String>,
    pub scan_interval: Duration,
    pub require_supabase_auth: bool,
    pub finder_tag: Option<String>,
    pub period_endpoint: Option<String>,
    pub blocked_extensions: Vec<String>,
    pub existing_keys_endpoint: Option<String>,
    pub auth_backoff_secs: u64,
}

impl AssetSyncInit {
    pub fn from_configs(
        config: &ConfigsAppAssetSync,
        save_root: String,
        finder_tag: Option<String>,
    ) -> Result<Self, String> {
        if save_root.trim().is_empty() {
            return Err("asset sync save path is empty".to_string());
        }
        let api_endpoint = normalize_string(config.get_asset_sync_api_endpoint())
            .ok_or_else(|| "asset_sync.asset_sync_api_endpoint is empty".to_string())?;
        let api_origin = derive_origin(&api_endpoint)?;
        let key_prefix = normalize_string(config.get_key_prefix());
        let period_endpoint = config.get_period_endpoint();
        let blocked_extensions = config.get_skip_extensions();
        let existing_keys_endpoint = config.get_existing_keys_endpoint();
        let auth_backoff_secs = config.retry.get_auth_backoff_seconds();

        let scan_interval_seconds = config
            .get_scan_interval_seconds()
            .max(MIN_SCAN_INTERVAL_SECS);
        let scan_interval = Duration::from_secs(scan_interval_seconds);

        Ok(Self {
            save_root: PathBuf::from(save_root),
            api_endpoint,
            api_origin,
            key_prefix,
            scan_interval,
            require_supabase_auth: true,
            finder_tag,
            period_endpoint,
            blocked_extensions,
            existing_keys_endpoint,
            auth_backoff_secs,
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

    // Initialize PendingStore
    let pending_dir = init.save_root.join("pending");
    let pending_store = Arc::new(PendingStore::new(pending_dir));
    let _ = PENDING_STORE.set(pending_store.clone());

    let (tx, rx) = mpsc::unbounded_channel();
    let _ = ASSET_SYNC_QUEUE.set(tx);

    let settings = Arc::new(init);
    let worker_settings = settings.clone();
    let handle = tokio::spawn(async move {
        if let Err(err) = run_worker(worker_settings, auth_manager, rx, pending_store).await {
            tracing::error!(error = %err, "asset sync worker stopped");
        }
    });

    ASSET_SYNC_HANDLE
        .set(handle)
        .map_err(|_| "asset sync worker has already been started".to_string())?;

    tracing::info!(
        root = %settings.save_root.display(),
        endpoint = %settings.api_endpoint,
        interval_secs = settings.scan_interval.as_secs(),
        "asset sync worker started"
    );

    Ok(())
}

pub fn notify_new_asset(path: PathBuf) {
    if let Some(queue) = ASSET_SYNC_QUEUE.get() {
        let _ = queue.send(path);
    }
}

async fn run_worker(
    settings: Arc<AssetSyncInit>,
    auth_manager: Arc<AuthManager<FileStorage>>,
    mut rx: UnboundedReceiver<PathBuf>,
    pending_store: Arc<PendingStore>,
) -> Result<(), String> {
    let client = build_client()
        .map_err(|err| format!("failed to initialize asset sync http client: {err}"))?;

    if let Err(err) = maybe_refresh_period(&client, &settings).await {
        tracing::warn!(error = %err, "failed to refresh asset sync period");
    }

    // Only attempt to refresh existing keys if authentication is ready
    if check_auth_ready(&settings, &auth_manager).await {
        if let Err(err) = maybe_refresh_existing_keys(&client, &settings, &auth_manager).await {
            tracing::warn!(error = %err, "failed to refresh existing asset keys cache");
        }
    }

    loop {
        if let Some(path) = rx.recv().await {
            if check_auth_ready(&settings, &auth_manager).await {
                tracing::info!(file = %path.display(), "received new asset notification, processing...");
                if let Err(err) = process_path(&client, &settings, &path, &auth_manager, &pending_store).await {
                    tracing::warn!(error = %err, file = %path.display(), "asset upload failed");
                }
            }
        }
    }
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
    tracing::info!(file = %path.display(), "processing path");
    let relative = match path.strip_prefix(&settings.save_root) {
        Ok(rel) => rel,
        Err(_) => return Err("file is outside of configured save root".into()),
    };

    if is_kcsapi(relative) {
        tracing::info!(file = %relative.display(), "skipping kcsapi file");
        return Ok(());
    }

    if has_blocked_extension(relative, &settings.blocked_extensions) {
        tracing::info!(
            file = %relative.display(),
            "skipping because of blocked extension"
        );
        return Ok(());
    }

    let key = match build_remote_key(relative, &settings.key_prefix) {
        Some(key) => key,
        None => return Err("unable to derive remote key".into()),
    };

    tracing::info!(check_key = key, "checking if remote key exists");

    if PROCESSED_KEYS.contains(&key) {
        tracing::info!(key, "skipping because already processed in this session");
        return Ok(());
    }

    if let Err(err) = maybe_refresh_existing_keys(client, settings, auth_manager).await {
        if matches!(err.status, Some(StatusCode::UNAUTHORIZED)) {
            tracing::warn!("Authentication failed while checking existing keys; stopping upload");
        }
        return Err(err.to_string());
    }

    if remote_key_exists(&key) {
        PROCESSED_KEYS.insert(key.clone());
        tracing::info!(key, "skipping because remote key already exists");
        return Ok(());
    }

    let metadata = fs::metadata(path).await.map_err(|err| err.to_string())?;
    if metadata.len() == 0 {
        tracing::info!(file = %path.display(), "skipping zero-length file");
        return Err("skip zero-length file".into());
    }

    upload_via_api(
        client,
        settings,
        path,
        relative,
        &key,
        metadata.len(),
        auth_manager,
        Some(pending_store),
    )
    .await?;
    PROCESSED_KEYS.insert(key);
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
fn build_client() -> Result<Client, reqwest::Error> {
    reqwest::Client::builder().build()
}

fn now_epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn derive_origin(endpoint: &str) -> Result<String, String> {
    let url =
        Url::parse(endpoint).map_err(|err| format!("invalid asset_sync.asset_sync_api_endpoint: {err}"))?;
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
    auth_manager: &AuthManager<FileStorage>,
    pending_store: Option<&PendingStore>,
) -> Result<(), String> {
    tracing::info!(key, file = %path.display(), size = file_size, "starting upload process");

    let bytes = fs::read(path)
        .await
        .map_err(|err| format!("failed to read file for upload: {err}"))?;

    let filename = relative
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .or_else(|| path.file_name().map(|n| n.to_string_lossy().to_string()))
        .unwrap_or_else(|| "asset.bin".to_string());

    // Step 1: Handshake
    let handshake_req = UploadHandshakeRequest {
        key: key.to_string(),
        relative_path: relative.to_string_lossy().to_string(),
        file_size: file_size.to_string(),
        finder_tag: settings.finder_tag.clone().and_then(|tag| {
            if tag.trim().is_empty() {
                None
            } else {
                Some(tag)
            }
        }),
        file_name: filename.clone(),
        content_type: "application/octet-stream".to_string(),
    };

    let handshake_body = serde_json::to_value(&handshake_req)
        .map_err(|e| format!("Failed to serialize handshake: {}", e))?;

    let mut headers = std::collections::HashMap::new();
    headers.insert("Origin".to_string(), settings.api_origin.clone());
    headers.insert("Content-Type".to_string(), "application/octet-stream".to_string());

    let request = UploadRequest {
        endpoint: &settings.api_endpoint,
        handshake_body,
        data: bytes,
        headers,
        context: UploadContext::Asset {
            relative_path: relative.to_string_lossy().to_string(),
            key: key.to_string(),
            file_size,
        },
    };

    match Uploader::upload(client, auth_manager, request, pending_store).await {
        Ok(UploadResult::Success) => {
            tracing::info!(key, endpoint = %settings.api_endpoint, "asset upload successful");
            register_remote_key(key);
            // Reset auth failure flag on successful upload
            SUPABASE_AUTH_FAILED.store(false, Ordering::Relaxed);
            Ok(())
        },
        Ok(UploadResult::Skipped) => {
            tracing::info!(key, "asset already existed upstream (409)");
            Ok(())
        },
        Err(e) => {
            // Improved error detection: Check if error contains "Authentication error" prefix
            // This is safer than pattern matching against fixed strings like "401" or "RequireReauth"
            // because it's explicitly set by UploadError::AuthenticationError variant
            if e.contains("Authentication error") {
                tracing::warn!(key, error = %e, "authentication failure detected; resetting auth cache");
                SUPABASE_AUTH_READY.store(false, Ordering::Relaxed);
                SUPABASE_AUTH_FAILED.store(true, Ordering::Relaxed);
                LAST_AUTH_FAIL_EPOCH.store(now_epoch_secs(), Ordering::Relaxed);
                SUPABASE_BACKOFF_LOGGED.store(false, Ordering::Relaxed);
                SUPABASE_WAITING_LOGGED.store(false, Ordering::Relaxed);
            }
            Err(e)
        },
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
        .expect("period cache lock poisoned")
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
        let mut guard = PERIOD_CACHE.write().expect("period cache lock poisoned");
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
    diff.to_std().ok()
}

fn apply_period_transition(new_tag: Option<String>) {
    let mut guard = LAST_PERIOD_TAG.write().expect("period tag lock poisoned");

    let changed = match (&*guard, &new_tag) {
        (Some(prev), Some(curr)) => prev != curr,
        (None, Some(_)) => true,
        (Some(_), None) => true,
        (None, None) => false,
    };

    if changed {
        PROCESSED_KEYS.clear();
        let label = new_tag.as_deref().unwrap_or("<none>");
        tracing::info!(
            period_tag = label,
            "asset sync period advanced; cleared processed asset cache"
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
            tracing::warn!("existing_keys_endpoint is not configured; remote key cache is disabled");
            return Ok(());
        }
    };

    if remote_cache_is_fresh() {
        tracing::info!("remote key cache is still fresh; skipping refresh");
        return Ok(());
    }

    tracing::info!("remote key cache is stale or missing; refreshing from API: {}", endpoint);

    wait_for_remote_cache_jitter().await;

    // Get access token for Authorization header
    tracing::info!("maybe_refresh_existing_keys: requesting access token from auth_manager");
    let access_token = auth_manager
        .get_access_token()
        .await
        .map_err(|err| ExistingKeysError::transport(format!(
            "failed to get access token for existing keys API: {err}"
        )))?;
    
    let token_preview = if access_token.len() > 20 {
        format!("{}...{}", &access_token[..10], &access_token[access_token.len()-10..])
    } else {
        "<short-token>".to_string()
    };
    tracing::info!("maybe_refresh_existing_keys: got access token, preview: {}, calling API: {}", token_preview, endpoint);

    let response = client
        .get(endpoint)
        .header("Accept", "application/json")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|err| ExistingKeysError::transport(format!(
            "failed to query existing keys endpoint: {err}"
        )))?;

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

    let payload: ExistingKeysResponse = response
        .json()
        .await
        .map_err(|err| ExistingKeysError::transport(format!(
            "failed to decode existing keys payload: {err}"
        )))?;

    cache_remote_keys(payload);
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
        .expect("existing keys cache lock poisoned")
        .as_ref()
    {
        Some(cache) => cache.expires_at > Instant::now(),
        None => false,
    }
}

fn cache_remote_keys(payload: ExistingKeysResponse) {
    let ttl = payload
        .cache_expires_at
        .as_deref()
        .and_then(duration_until)
        .filter(|duration| !duration.is_zero())
        .unwrap_or_else(|| Duration::from_secs(REMOTE_KEYS_CACHE_FALLBACK_SECS));

    let expires_at = Instant::now() + ttl;
    let keys: HashSet<String> = payload.keys.into_iter().collect();
    let count = keys.len();

    tracing::info!(
        count = count,
        expires_in_secs = ttl.as_secs(),
        "caching remote keys. sample: {:?}",
        keys.iter().take(5).collect::<Vec<_>>()
    );

    {
        let mut guard = EXISTING_KEYS_CACHE
            .write()
            .expect("existing keys cache lock poisoned");
        *guard = Some(RemoteKeyCache { keys, expires_at });
    }

    tracing::debug!(count = count, "existing remote asset key cache refreshed");
}

fn remote_key_exists(key: &str) -> bool {
    match EXISTING_KEYS_CACHE
        .read()
        .expect("existing keys cache lock poisoned")
        .as_ref()
    {
        Some(cache) => cache.keys.contains(key),
        None => false,
    }
}

fn register_remote_key(key: &str) {
    let mut guard = EXISTING_KEYS_CACHE
        .write()
        .expect("existing keys cache lock poisoned");

    match guard.as_mut() {
        Some(cache) => {
            cache.keys.insert(key.to_string());
            if cache.expires_at <= Instant::now() {
                cache.expires_at =
                    Instant::now() + Duration::from_secs(REMOTE_KEYS_CACHE_FALLBACK_SECS);
            }
        }
        None => {
            let mut keys = HashSet::new();
            keys.insert(key.to_string());
            *guard = Some(RemoteKeyCache {
                keys,
                expires_at: Instant::now() + Duration::from_secs(REMOTE_KEYS_CACHE_FALLBACK_SECS),
            });
        }
    }
}

