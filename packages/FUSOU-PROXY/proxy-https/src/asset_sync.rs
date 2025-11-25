use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock, RwLock,
    },
    time::{Duration, Instant},
};

use dashmap::DashSet;
use once_cell::sync::Lazy;
use reqwest::{multipart, Client, StatusCode, Url};
use serde::Deserialize;
use tokio::{
    fs,
    sync::mpsc::{self, UnboundedReceiver, UnboundedSender},
    task::JoinHandle,
    time,
};
use tracing;
use walkdir::WalkDir;

use configs::ConfigsAppAssetSync;
use chrono::{DateTime, Utc};

static ASSET_SYNC_HANDLE: OnceLock<JoinHandle<()>> = OnceLock::new();
static ASSET_SYNC_QUEUE: OnceLock<UnboundedSender<PathBuf>> = OnceLock::new();
static PROCESSED_KEYS: Lazy<DashSet<String>> = Lazy::new(DashSet::new);
static SUPABASE_AUTH_READY: AtomicBool = AtomicBool::new(false);
static SUPABASE_WAITING_LOGGED: AtomicBool = AtomicBool::new(false);
static SUPABASE_ACCESS_TOKEN: Lazy<RwLock<Option<String>>> = Lazy::new(|| RwLock::new(None));
static SUPABASE_REFRESH_TOKEN: Lazy<RwLock<Option<String>>> = Lazy::new(|| RwLock::new(None));
static PERIOD_CACHE: Lazy<RwLock<Option<PeriodCache>>> = Lazy::new(|| RwLock::new(None));
static LAST_PERIOD_TAG: Lazy<RwLock<Option<String>>> = Lazy::new(|| RwLock::new(None));

const MIN_SCAN_INTERVAL_SECS: u64 = 10;
const PERIOD_CACHE_FALLBACK_SECS: u64 = 24 * 60 * 60;

struct PeriodCache {
    expires_at: Instant,
}

#[derive(Deserialize)]
struct PeriodApiResponse {
    tag: Option<String>,
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
        let api_endpoint = normalize_string(config.get_api_endpoint())
            .ok_or_else(|| "asset_sync.api_endpoint is empty".to_string())?;
        let api_origin = derive_origin(&api_endpoint)?;
        let key_prefix = normalize_string(config.get_key_prefix());
        let period_endpoint = config.get_period_endpoint();
        let blocked_extensions = config.get_skip_extensions();

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
            require_supabase_auth: config.get_require_supabase_auth(),
            finder_tag,
            period_endpoint,
            blocked_extensions,
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
        Url::parse(endpoint).map_err(|err| format!("invalid asset_sync.api_endpoint: {err}"))?;
    let scheme = url.scheme();
    let host = url
        .host_str()
        .ok_or_else(|| "asset_sync.api_endpoint missing host".to_string())?;
    let origin = match url.port() {
        Some(port) => format!("{}://{}:{}", scheme, host, port),
        None => format!("{}://{}", scheme, host),
    };
    Ok(origin)
}

fn get_supabase_access_token() -> Option<String> {
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

    let mut form = multipart::Form::new()
        .text("key", key.to_string())
        .text("relative_path", relative.to_string_lossy().to_string())
        .text("file_size", file_size.to_string());

    if let Some(tag) = &settings.finder_tag {
        if !tag.is_empty() {
            form = form.text("finder_tag", tag.clone());
        }
    }

    let file_part = multipart::Part::bytes(bytes)
        .file_name(filename)
        .mime_str("application/octet-stream")
        .map_err(|err| format!("failed to build multipart payload: {err}"))?;

    form = form.part("file", file_part);

    let mut request = client
        .post(&settings.api_endpoint)
        .multipart(form)
        .header("Origin", &settings.api_origin);

    if settings.require_supabase_auth {
        let token = get_supabase_access_token()
            .ok_or_else(|| "Supabase access token not available".to_string())?;
        request = request.bearer_auth(token);
    }

    let response = request
        .send()
        .await
        .map_err(|err| format!("asset sync request failed: {err}"))?;

    let status = response.status();
    if status == StatusCode::CONFLICT {
        tracing::info!(key, "asset already existed upstream (409)");
        return Ok(());
    }
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "asset sync API returned {}: {}",
            status,
            body.trim()
        ));
    }

    tracing::info!(key, endpoint = %settings.api_endpoint, "uploaded asset via API");
    Ok(())
}

async fn maybe_refresh_period(
    client: &Client,
    settings: &AssetSyncInit,
) -> Result<(), String> {
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
        let mut guard = PERIOD_CACHE
            .write()
            .expect("period cache lock poisoned");
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
    let expiry = DateTime::parse_from_rfc3339(iso)
        .ok()?
        .with_timezone(&Utc);
    let diff = expiry.signed_duration_since(Utc::now());
    diff.to_std().ok()
}

fn apply_period_transition(new_tag: Option<String>) {
    let mut guard = LAST_PERIOD_TAG
        .write()
        .expect("period tag lock poisoned");

    let changed = match (&*guard, &new_tag) {
        (Some(prev), Some(curr)) => prev != curr,
        (None, Some(_)) => true,
        (Some(_), None) => true,
        (None, None) => false,
    };

    if changed {
        PROCESSED_KEYS.clear();
        let label = new_tag
            .as_deref()
            .unwrap_or("<none>");
        tracing::info!(
            period_tag = label,
            "asset sync period advanced; cleared processed asset cache"
        );
        *guard = new_tag;
    }
}
