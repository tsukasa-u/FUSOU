use fusou_auth::{AuthManager, FileStorage};
use serde_json::json;
use std::sync::{Arc, Mutex};
use tauri::{Manager, Url};
use uuid::Uuid;

pub fn single_instance_init(app: &tauri::AppHandle, argv: Vec<String>) {
    // Initialization code for single instance
    if let Some(path) = argv.get(1) {
        let url = match Url::parse(path) {
            Ok(url) => url,
            Err(e) => {
                tracing::warn!("single instance received invalid url argument: {}", e);
                // Invalid deeplink should not stop window restore/focus flow.
                goto_restore_window(app, &argv);
                return;
            }
        };

        // Check if this is a Realtime-based member_id_hash sync request
        // fusou://sync?token=xxx&return_url=yyy
        if url.scheme() == "fusou" && url.host_str() == Some("sync") {
            handle_realtime_member_id_sync(&url, app);
            return;
        }

        // Check if this is a request for member_id_hash (legacy, for backward compatibility)
        if url.scheme() == "fusou" && url.host_str() == Some("request-member-id") {
            handle_member_id_request(&url, app);
            return;
        }

        // Anonymous-only mode: ignore OAuth callback tokens from FUSOU-WEB.
        // Deep-link parsing is maintained for compatibility with existing flows.
    }

    goto_restore_window(app, &argv);
}

fn goto_restore_window(app: &tauri::AppHandle, argv: &[String]) {
    let singleton_window = match app.get_webview_window("main") {
        Some(window) => window,
        None => {
            tracing::error!("Failed to get main window");
            return;
        }
    };

    if let Err(e) = singleton_window.show() {
        tracing::warn!(
            "failed to show main window in single instance handler: {}",
            e
        );
    }

    if singleton_window.is_minimized().unwrap_or(false) {
        if let Err(e) = singleton_window.unminimize() {
            tracing::warn!(
                "failed to unminimize main window in single instance handler: {}",
                e
            );
        }
    }

    if !singleton_window.is_focused().unwrap_or(false) {
        if let Err(e) = singleton_window.set_focus() {
            tracing::warn!(
                "failed to focus main window in single instance handler: {}",
                e
            );
        }
    }

    tracing::debug!("single instance arg: {:?}", argv.get(1));
}

/// Handle fusou://request-member-id?return_url=xxx
/// This allows WEB page to request member_id_hash from the app via hidden iframe
fn handle_member_id_request(url: &Url, app: &tauri::AppHandle) {
    // Get return_url from query parameters
    let return_url = url
        .query_pairs()
        .find(|(key, _)| key == "return_url")
        .map(|(_, value)| value.to_string());

    let Some(return_url) = return_url else {
        tracing::warn!("request-member-id called without return_url parameter");
        return;
    };

    if !is_allowed_return_url(&return_url) {
        tracing::warn!("request-member-id called with untrusted return_url");
        return;
    }

    // Resolve asynchronously so we can prefer AuthManager dataset_id (pid) without blocking.
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let member_id_hash = match resolve_member_id_hash_for_sync(&app_handle).await {
            Ok(hash) => hash,
            Err(e) => {
                tracing::warn!("request-member-id could not resolve member_id_hash: {}", e);
                let error_url = format!(
                    "{}{}error=member_id_not_available",
                    return_url,
                    if return_url.contains('?') { "&" } else { "?" }
                );
                let _ = webbrowser::open(&error_url);
                return;
            }
        };

        // Save to cache for future use.
        use crate::auth::member_id_cache::MemberIdCache;
        if let Err(e) = MemberIdCache::save(&member_id_hash) {
            tracing::warn!("Failed to cache member_id_hash: {}", e);
        }

        // Construct return URL with member_id_hash.
        // The WEB page will receive this via URLSearchParams and process it with JavaScript.
        let separator = if return_url.contains('?') { "&" } else { "?" };
        let callback_url = format!(
            "{}{}member_id_hash={}",
            return_url, separator, member_id_hash
        );

        tracing::info!("Sending member_id_hash to browser (hash redacted)");

        // This will cause the browser to navigate, updating the existing page.
        // The WEB page JavaScript will read the parameter and continue the flow.
        let _ = webbrowser::open(&callback_url);
    });
}

/// Handle fusou://sync?token=xxx&return_url=yyy
///
/// Realtime-based member_id_hash sync handler
///
/// Flow:
/// 1. WEB generates passphrase token and launches fusou://sync?token=xxx
/// 2. APP reaches here
/// 3. APP loads member_id_hash
/// 4. Updates pending_member_syncs table in Supabase
/// 5. Realtime automatically notifies WEB
/// 6. WEB processes data in-page (no navigation)
fn handle_realtime_member_id_sync(url: &Url, app: &tauri::AppHandle) {
    // 1. Extract token
    let token = match url
        .query_pairs()
        .find(|(key, _)| key == "token")
        .map(|(_, value)| value.to_string())
    {
        Some(t) => t,
        None => {
            tracing::warn!("[Realtime Sync] fusou://sync called without token parameter");
            return;
        }
    };

    tracing::info!("[Realtime Sync] Received sync request");

    // 2. Generate APP instance ID (for handling multiple APP instances on same machine)
    let app_instance_id = get_or_create_app_instance_id();
    let app_handle = app.clone();

    // 3. Execute Supabase update in async task
    tauri::async_runtime::spawn(async move {
        match handle_realtime_sync_async(&token, &app_instance_id, &app_handle).await {
            Ok(_) => {
                tracing::info!("[Realtime Sync] Successfully synced");
            }
            Err(e) => {
                tracing::error!("[Realtime Sync] Failed to sync: {}", e);
            }
        }
    });
}

/// Async: Load member_id_hash and save to Supabase (with retry functionality)
async fn handle_realtime_sync_async(
    token: &str,
    app_instance_id: &str,
    app: &tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // 1. Load member_id_hash: prefer AuthManager dataset_id (v2), then legacy fallback.
    let member_id_hash = resolve_member_id_hash_for_sync(app)
        .await
        .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?;

    tracing::info!("[Realtime Sync] Loaded member_id_hash");

    // 2. Get Supabase configuration (with clear error messages)
    // Try compile-time embedded values first (set via option_env! during build with dotenvx),
    // then fall back to runtime env vars (available when running via dotenvx directly).
    let supabase_url = option_env!("PUBLIC_SUPABASE_URL")
        .map(|s| s.to_string())
        .or_else(|| std::env::var("SUPABASE_URL").ok())
        .or_else(|| std::env::var("PUBLIC_SUPABASE_URL").ok())
        .ok_or("Environment variable SUPABASE_URL or PUBLIC_SUPABASE_URL is not set (compile-time or runtime)")?;

    // Support multiple variable names for API key (ANON_KEY for legacy, PUBLISHABLE_KEY for new)
    let supabase_anon_key = option_env!("PUBLIC_SUPABASE_PUBLISHABLE_KEY")
        .map(|s| s.to_string())
        .or_else(|| std::env::var("SUPABASE_ANON_KEY").ok())
        .or_else(|| std::env::var("PUBLIC_SUPABASE_ANON_KEY").ok())
        .or_else(|| std::env::var("PUBLIC_SUPABASE_PUBLISHABLE_KEY").ok())
        .ok_or("Environment variable SUPABASE_ANON_KEY, PUBLIC_SUPABASE_ANON_KEY, or PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set (compile-time or runtime)")?;

    if supabase_url.trim().is_empty() {
        return Err("SUPABASE_URL is set but empty".into());
    }
    if supabase_anon_key.trim().is_empty() {
        return Err("SUPABASE_ANON_KEY/PUBLISHABLE_KEY is set but empty".into());
    }

    // 3. Update Supabase with retry logic
    let max_retries = 3u32;
    let mut last_error: Option<String> = None;

    for attempt in 0..max_retries {
        match send_supabase_update(
            token,
            app_instance_id,
            &member_id_hash,
            &supabase_url,
            &supabase_anon_key,
        )
        .await
        {
            Ok(_) => {
                tracing::info!("[Realtime Sync] Supabase record updated successfully");
                return Ok(());
            }
            Err(e) => {
                last_error = Some(e.clone());

                if attempt < max_retries - 1 {
                    // Exponential backoff: 100ms, 200ms, 400ms
                    let backoff_ms = 100 * (1 << attempt);
                    tracing::warn!(
                        "[Realtime Sync] Attempt {} failed: {}. Retrying in {}ms...",
                        attempt + 1,
                        e,
                        backoff_ms
                    );
                    tokio::time::sleep(tokio::time::Duration::from_millis(backoff_ms as u64)).await;
                } else {
                    tracing::error!(
                        "[Realtime Sync] All {} attempts failed. Last error: {}",
                        max_retries,
                        e
                    );
                }
            }
        }
    }

    Err(last_error
        .unwrap_or_else(|| "Unknown error".to_string())
        .into())
}

fn is_allowed_return_url(return_url: &str) -> bool {
    let return_parsed = match Url::parse(return_url) {
        Ok(v) => v,
        Err(_) => return false,
    };

    let auth_page_url = configs::get_user_configs_for_app().auth.get_auth_page_url();
    let auth_page_parsed = match Url::parse(auth_page_url.as_str()) {
        Ok(v) => v,
        Err(_) => return false,
    };

    return_parsed.scheme() == auth_page_parsed.scheme()
        && return_parsed.host_str() == auth_page_parsed.host_str()
        && return_parsed.port_or_known_default() == auth_page_parsed.port_or_known_default()
}

fn normalize_member_id_hash(value: &str) -> Option<String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.len() == 64
        && normalized
            .as_bytes()
            .iter()
            .all(|b| b.is_ascii_hexdigit())
    {
        Some(normalized)
    } else {
        None
    }
}

async fn resolve_member_id_hash_for_sync(app: &tauri::AppHandle) -> Result<String, String> {
    if let Some(auth_manager_state) = app.try_state::<Arc<Mutex<AuthManager<FileStorage>>>>() {
        // Clone to avoid holding the lock across await.
        let auth_manager_clone = {
            let manager = auth_manager_state
                .lock()
                .map_err(|_| "failed to lock AuthManager state".to_string())?;
            manager.clone()
        };

        if let Some(dataset_id) = auth_manager_clone.resolve_dataset_id_for_upload(None).await {
            if let Some(normalized) = normalize_member_id_hash(&dataset_id) {
                tracing::info!("[Realtime Sync] Using AuthManager dataset_id as member_id_hash");
                return Ok(normalized);
            }

            tracing::warn!(
                "[Realtime Sync] AuthManager dataset_id has invalid hash format; falling back to legacy source"
            );
        }
    }

    crate::auth::auth_server::get_member_id_hash_with_cache()
}

/// Send PATCH request to Supabase
async fn send_supabase_update(
    token: &str,
    app_instance_id: &str,
    member_id_hash: &str,
    supabase_url: &str,
    supabase_anon_key: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let update_url = format!(
        "{}/rest/v1/pending_member_syncs?token=eq.{}",
        supabase_url,
        urlencoding::encode(token)
    );

    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let update_body = json!({
        "member_id_hash": member_id_hash,
        "app_instance_id": app_instance_id,
        "synced_at": now
    });

    tracing::debug!(
        "[Realtime Sync] Sending PATCH to {} with body: {}",
        update_url,
        update_body
    );

    let response = client
        .patch(&update_url)
        .header("apikey", supabase_anon_key)
        .header("Authorization", format!("Bearer {}", supabase_anon_key))
        .header("Content-Type", "application/json")
        .header("Prefer", "return=minimal")
        .json(&update_body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = response.status();

    if status.is_success() {
        return Ok(());
    }

    let error_body = response.text().await.unwrap_or_default();

    // Detailed error message per HTTP status code
    let error_msg = match status.as_u16() {
        400 => format!("Bad request (invalid token or data format): {}", error_body),
        401 => format!("Unauthorized (invalid or expired API key): {}", error_body),
        403 => format!("Forbidden (RLS policy denied access): {}", error_body),
        404 => format!("Record not found (token may have expired): {}", error_body),
        409 => format!("Conflict (record already updated): {}", error_body),
        429 => format!("Rate limited (too many requests): {}", error_body),
        500..=599 => format!("Supabase server error ({}): {}", status, error_body),
        _ => format!("Unexpected error ({}): {}", status, error_body),
    };

    tracing::error!("[Realtime Sync] {}", error_msg);
    Err(error_msg)
}

/// Get or create APP instance ID
///
/// Generates a machine-specific ID to prevent conflicts when multiple APPs are running.
/// Persists the ID under the Tauri-managed app data directory (`ROAMING_DIR`) so the
/// same ID is reused on the same machine. Avoid raw `APPDATA`/`HOME` lookups, which
/// would create files outside the app's data directory.
fn get_or_create_app_instance_id() -> String {
    let app_data_dir = crate::util::get_ROAMING_DIR();
    let instance_id_path = app_data_dir.join("app_instance_id.txt");

    // Read ID from file
    if let Ok(content) = std::fs::read_to_string(&instance_id_path) {
        let trimmed = content.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    // Create new ID if file doesn't exist or is empty
    let instance_id = Uuid::new_v4().to_string();
    if let Some(parent) = instance_id_path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            tracing::warn!(
                "Failed to create app data directory for app_instance_id at {:?}: {}",
                parent,
                e
            );
            return instance_id;
        }
    }
    if let Err(e) = std::fs::write(&instance_id_path, &instance_id) {
        tracing::warn!(
            "Failed to persist app_instance_id at {:?}: {}",
            instance_id_path,
            e
        );
    }

    instance_id
}
