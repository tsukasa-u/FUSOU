use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock, RwLock,
    },
    time::{Duration, Instant},
};

use dashmap::DashSet;
use once_cell::sync::Lazy;
use rand::{thread_rng, Rng};
use reqwest::{Client, StatusCode, Url};
use serde::{Deserialize, Serialize};
use tokio::{
    fs,
    sync::mpsc::{self, UnboundedReceiver, UnboundedSender},
    task::JoinHandle,
    time,
};
use tracing;
use walkdir::WalkDir;

use chrono::{DateTime, Utc};
use configs::ConfigsAppAssetSync;

static ASSET_SYNC_HANDLE: OnceLock<JoinHandle<()>> = OnceLock::new();
static ASSET_SYNC_QUEUE: OnceLock<UnboundedSender<PathBuf>> = OnceLock::new();
static PROCESSED_KEYS: Lazy<DashSet<String>> = Lazy::new(DashSet::new);
static SUPABASE_AUTH_READY: AtomicBool = AtomicBool::new(false);
static SUPABASE_WAITING_LOGGED: AtomicBool = AtomicBool::new(false);
static SUPABASE_ACCESS_TOKEN: Lazy<RwLock<Option<String>>> = Lazy::new(|| RwLock::new(None));
static SUPABASE_REFRESH_TOKEN: Lazy<RwLock<Option<String>>> = Lazy::new(|| RwLock::new(None));
static PERIOD_CACHE: Lazy<RwLock<Option<PeriodCache>>> = Lazy::new(|| RwLock::new(None));
static LAST_PERIOD_TAG: Lazy<RwLock<Option<String>>> = Lazy::new(|| RwLock::new(None));
static EXISTING_KEYS_CACHE: Lazy<RwLock<Option<RemoteKeyCache>>> = Lazy::new(|| RwLock::new(None));

const MIN_SCAN_INTERVAL_SECS: u64 = 10;
const PERIOD_CACHE_FALLBACK_SECS: u64 = 24 * 60 * 60;
const REMOTE_KEYS_CACHE_FALLBACK_SECS: u64 = 60 * 60;
const REMOTE_KEYS_REFRESH_MAX_JITTER_MS: u64 = 5_000;

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
struct UploadHandshakeResponse {
    #[serde(rename = "uploadUrl")]
    upload_url: String,
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

pub fn start(init: AssetSyncInit) -> Result<(), String> {
    if ASSET_SYNC_HANDLE.get().is_some() {
        tracing::debug!("asset sync worker already running");
        return Ok(());
    }

    if !init.require_supabase_auth {
        SUPABASE_AUTH_READY.store(true, Ordering::Relaxed);
        SUPABASE_WAITING_LOGGED.store(false, Ordering::Relaxed);
    }

    if let Err(err) = std::fs::create_dir_all(&init.save_root) {
        return Err(format!(
            "failed to create asset sync directory {}: {err}",
            init.save_root.display()
        ));
    }

    let (tx, rx) = mpsc::unbounded_channel();
    let _ = ASSET_SYNC_QUEUE.set(tx);

    let settings = Arc::new(init);
    let worker_settings = settings.clone();
    let handle = tokio::spawn(async move {
        if let Err(err) = run_worker(worker_settings, rx).await {
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

pub fn update_supabase_session(access_token: String, refresh_token: Option<String>) {
    if access_token.trim().is_empty() {
        tracing::warn!("received empty Supabase access token; asset sync remains locked");
        clear_supabase_session();
        return;
    }

    {
        let mut guard = SUPABASE_ACCESS_TOKEN
            .write()
            .expect("supabase access token lock poisoned");
        *guard = Some(access_token);
    }

    if let Some(token) = refresh_token {
        let mut guard = SUPABASE_REFRESH_TOKEN
            .write()
            .expect("supabase refresh token lock poisoned");
        *guard = Some(token);
    }

    let was_ready = SUPABASE_AUTH_READY.swap(true, Ordering::Relaxed);
    SUPABASE_WAITING_LOGGED.store(false, Ordering::Relaxed);
    if !was_ready {
        tracing::info!("Supabase authentication acknowledged; asset sync unlocked");
    } else {
        tracing::debug!("Supabase session refreshed for asset sync");
    }
}

pub fn clear_supabase_session() {
    {
        let mut guard = SUPABASE_ACCESS_TOKEN
            .write()
            .expect("supabase access token lock poisoned");
        guard.take();
    }

    {
        let mut guard = SUPABASE_REFRESH_TOKEN
            .write()
            .expect("supabase refresh token lock poisoned");
        guard.take();
    }

    let was_ready = SUPABASE_AUTH_READY.swap(false, Ordering::Relaxed);
    SUPABASE_WAITING_LOGGED.store(false, Ordering::Relaxed);
    if was_ready {
        tracing::info!("Supabase session cleared; asset sync paused");
    }
}

pub fn mark_supabase_signed_out() {
    clear_supabase_session();
}

async fn run_worker(
    settings: Arc<AssetSyncInit>,
    mut rx: UnboundedReceiver<PathBuf>,
) -> Result<(), String> {
    let client = build_client()
        .map_err(|err| format!("failed to initialize asset sync http client: {err}"))?;

    if let Err(err) = maybe_refresh_period(&client, &settings).await {
        tracing::warn!(error = %err, "failed to refresh asset sync period");
    }

    if let Err(err) = maybe_refresh_existing_keys(&client, &settings).await {
        tracing::warn!(error = %err, "failed to refresh existing asset keys cache");
    }

    let mut interval = time::interval(settings.scan_interval);
    loop {
        tokio::select! {
            _ = interval.tick() => {
                if check_auth_ready(&settings) {
                    if let Err(err) = maybe_refresh_period(&client, &settings).await {
                        tracing::warn!(error = %err, "failed to refresh asset sync period");
                    }
                    if let Err(err) = run_full_scan(&client, &settings).await {
                        tracing::warn!(error = %err, "asset sync scan failed");
                    }
                }
            }
            Some(path) = rx.recv() => {
                if check_auth_ready(&settings) {
                    if let Err(err) = maybe_refresh_period(&client, &settings).await {
                        tracing::warn!(error = %err, "failed to refresh asset sync period");
                    }
                    if let Err(err) = process_path(&client, &settings, &path).await {
                        tracing::warn!(error = %err, file = %path.display(), "asset upload failed");
                    }
                }
            }
        }
    }
}

fn check_auth_ready(settings: &AssetSyncInit) -> bool {
    if !settings.require_supabase_auth {
        return true;
    }
    let ready = SUPABASE_AUTH_READY.load(Ordering::Relaxed);
    if ready && get_supabase_access_token().is_none() {
        SUPABASE_AUTH_READY.store(false, Ordering::Relaxed);
        if !SUPABASE_WAITING_LOGGED.swap(true, Ordering::Relaxed) {
            tracing::info!(
                "Supabase access token missing; waiting for authentication before uploading assets"
            );
        }
        return false;
    }
    if ready {
        if SUPABASE_WAITING_LOGGED.swap(false, Ordering::Relaxed) {
            tracing::info!("Supabase authentication detected; starting asset uploads");
        }
        return true;
    }
    if !SUPABASE_WAITING_LOGGED.swap(true, Ordering::Relaxed) {
        tracing::info!("Waiting for Supabase authentication before uploading assets");
    }
    false
}

async fn run_full_scan(client: &Client, settings: &AssetSyncInit) -> Result<(), String> {
    for entry in WalkDir::new(&settings.save_root)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            let path = entry.into_path();
            if let Err(err) = process_path(client, settings, &path).await {
                tracing::debug!(error = %err, file = %path.display(), "asset scan skip");
            }
        }
    }
    Ok(())
}

async fn process_path(
    client: &Client,
    settings: &AssetSyncInit,
    path: &Path,
) -> Result<(), String> {
    let relative = match path.strip_prefix(&settings.save_root) {
        Ok(rel) => rel,
        Err(_) => return Err("file is outside of configured save root".into()),
    };

    if is_kcsapi(relative) {
        return Ok(());
    }

    if has_blocked_extension(relative, &settings.blocked_extensions) {
        tracing::debug!(
            file = %relative.display(),
            "asset sync skipped disallowed file extension"
        );
        return Ok(());
    }

    let key = match build_remote_key(relative, &settings.key_prefix) {
        Some(key) => key,
        None => return Err("unable to derive remote key".into()),
    };

    if PROCESSED_KEYS.contains(&key) {
        return Ok(());
    }

    maybe_refresh_existing_keys(client, settings).await?;

    if remote_key_exists(&key) {
        PROCESSED_KEYS.insert(key.clone());
        tracing::debug!(key, "asset already exists upstream; skipping upload");
        return Ok(());
    }

    let metadata = fs::metadata(path).await.map_err(|err| err.to_string())?;
    if metadata.len() == 0 {
        return Err("skip zero-length file".into());
    }

    upload_via_api(client, settings, path, relative, &key, metadata.len()).await?;
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

pub fn get_supabase_access_token() -> Option<String> {
    match SUPABASE_ACCESS_TOKEN.read() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

async fn upload_via_api(
    client: &Client,
    settings: &AssetSyncInit,
    path: &Path,
    relative: &Path,
    key: &str,
    file_size: u64,
) -> Result<(), String> {
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
        finder_tag: settings.finder_tag.clone().filter(|t| !t.is_empty()),
        file_name: filename.clone(),
        content_type: "application/octet-stream".to_string(),
    };

    let mut request = client
        .post(&settings.api_endpoint)
        .json(&handshake_req)
        .header("Origin", &settings.api_origin);

    if settings.require_supabase_auth {
        let token = get_supabase_access_token()
            .ok_or_else(|| "Supabase access token not available".to_string())?;
        request = request.bearer_auth(token);
    }

    let response = request
        .send()
        .await
        .map_err(|err| format!("asset sync handshake failed: {err}"))?;

    let status = response.status();
    if status == StatusCode::CONFLICT {
        tracing::info!(key, "asset already existed upstream (409)");
        return Ok(());
    }
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "asset sync handshake returned {}: {}",
            status,
            body.trim()
        ));
    }

    let handshake_res: UploadHandshakeResponse = response
        .json()
        .await
        .map_err(|err| format!("failed to decode handshake response: {err}"))?;

    // Step 2: Execution
    let mut upload_request = client
        .post(&handshake_res.upload_url)
        .body(bytes)
        .header("Content-Type", "application/octet-stream")
        .header("Origin", &settings.api_origin);

    if settings.require_supabase_auth {
        let token = get_supabase_access_token()
            .ok_or_else(|| "Supabase access token not available for upload".to_string())?;
        upload_request = upload_request.bearer_auth(token);
    }

    let upload_response = upload_request
        .send()
        .await
        .map_err(|err| format!("asset sync upload failed: {err}"))?;

    let upload_status = upload_response.status();
    if upload_status == StatusCode::CONFLICT {
        tracing::info!(key, "asset already existed upstream (409) during upload");
        return Ok(());
    }
    if !upload_status.is_success() {
        let body = upload_response.text().await.unwrap_or_default();
        return Err(format!(
            "asset sync upload returned {}: {}",
            upload_status,
            body.trim()
        ));
    }

    tracing::info!(key, endpoint = %settings.api_endpoint, "uploaded asset via API");
    register_remote_key(key);
    Ok(())
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
) -> Result<(), String> {
    let endpoint = match settings.existing_keys_endpoint.as_deref() {
        Some(value) => value,
        None => return Ok(()),
    };

    if remote_cache_is_fresh() {
        return Ok(());
    }

    wait_for_remote_cache_jitter().await;

    let response = client
        .get(endpoint)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|err| format!("failed to query existing keys endpoint: {err}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "existing keys endpoint returned {}: {}",
            status,
            body.trim()
        ));
    }

    let payload: ExistingKeysResponse = response
        .json()
        .await
        .map_err(|err| format!("failed to decode existing keys payload: {err}"))?;

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
