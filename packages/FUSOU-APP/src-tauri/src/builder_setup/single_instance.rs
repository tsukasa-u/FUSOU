use fusou_auth::{AuthManager, FileStorage};
use serde_json::json;
use std::sync::{Arc, Mutex};
use tauri::{Manager, Url};
use uuid::{Uuid, Variant};

pub fn single_instance_init(app: &tauri::AppHandle, argv: Vec<String>) {
    // Initialization code for single instance
    if let Some(path) = argv.get(1) {
        let url = match Url::parse(path) {
            Ok(url) => url,
            Err(e) => {
                tracing::warn!("single instance received invalid url argument: {}", e);
                // Invalid deeplink should not stop window restore/focus flow.
                goto_restore_window(app);
                return;
            }
        };

        // Check if this is a Worker-backed public_id sync request
        // fusou://sync?token=xxx
        if url.scheme() == "fusou" && url.host_str() == Some("sync") {
            handle_public_id_sync(&url, app);
            return;
        }

        // Anonymous-only mode: ignore OAuth callback tokens from FUSOU-WEB.
        // Deep-link parsing is maintained for compatibility with existing flows.
    }

    goto_restore_window(app);
}

fn goto_restore_window(app: &tauri::AppHandle) {
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

}

/// Handle fusou://sync?token=xxx
///
/// Worker-backed public_id sync handler
///
/// Flow:
/// 1. WEB generates passphrase token and launches fusou://sync?token=xxx
/// 2. APP reaches here
/// 3. APP loads public_id from AuthManager
/// 4. Completes the pending handoff through the Worker
/// 5. WEB polls the Worker and receives the public UUID
fn handle_public_id_sync(url: &Url, app: &tauri::AppHandle) {
    // 1. Extract token
    let token = match url
        .query_pairs()
        .find(|(key, _)| key == "token")
        .map(|(_, value)| value.to_string())
    {
        Some(t) => t,
        None => {
            tracing::warn!("[Public ID Sync] fusou://sync called without token parameter");
            return;
        }
    };
    let token = match Uuid::parse_str(&token) {
        Ok(parsed)
            if parsed.get_version_num() == 4 && parsed.get_variant() == Variant::RFC4122 =>
        {
            parsed.to_string()
        }
        _ => {
            tracing::warn!("[Worker Sync] fusou://sync token is not a UUID v4");
            return;
        }
    };

    tracing::info!("[Worker Sync] Received sync request");

    // 2. Generate APP instance ID (for handling multiple APP instances on same machine)
    let app_instance_id = get_or_create_app_instance_id();
    let app_handle = app.clone();

    // 3. Execute Supabase update in async task
    tauri::async_runtime::spawn(async move {
        match handle_public_id_sync_async(&token, &app_instance_id, &app_handle).await {
            Ok(_) => {
                tracing::info!("[Public ID Sync] Successfully synced");
            }
            Err(e) => {
                tracing::error!("[Public ID Sync] Failed to sync: {}", e);
            }
        }
    });
}

/// Async: complete the Worker-managed sync handoff (with retry functionality)
async fn handle_public_id_sync_async(
    token: &str,
    app_instance_id: &str,
    app: &tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // The AuthManager token is the sole source for the current public_id.
    let (_public_id, dataset_token) = resolve_dataset_token_for_sync(app)
        .await
        .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { e.into() })?;

    tracing::info!("[Public ID Sync] Loaded public_id");

    let complete_endpoint = configs::get_user_configs_for_app()
        .auth
        .get_anonymous_sync_v2_complete_endpoint()
        .ok_or("anonymous_sync_v2_complete_endpoint not configured")?
        .replace("{token}", token);

    // Complete the handoff with retry logic.
    let max_retries = 3u32;
    let mut last_error: Option<String> = None;

    for attempt in 0..max_retries {
        match send_supabase_update(
            app_instance_id,
            &complete_endpoint,
            &dataset_token,
        )
        .await
        {
            Ok(_) => {
                tracing::info!("[Public ID Sync] Sync handoff completed successfully");
                return Ok(());
            }
            Err(e) => {
                last_error = Some(e.clone());

                if attempt < max_retries - 1 {
                    // Exponential backoff: 100ms, 200ms, 400ms
                    let backoff_ms = 100 * (1 << attempt);
                    tracing::warn!(
                        "[Public ID Sync] Attempt {} failed: {}. Retrying in {}ms...",
                        attempt + 1,
                        e,
                        backoff_ms
                    );
                    tokio::time::sleep(tokio::time::Duration::from_millis(backoff_ms as u64)).await;
                } else {
                    tracing::error!(
                        "[Public ID Sync] All {} attempts failed. Last error: {}",
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

async fn resolve_dataset_token_for_sync(
    app: &tauri::AppHandle,
) -> Result<(String, String), String> {
    if let Some(auth_manager_state) = app.try_state::<Arc<Mutex<AuthManager<FileStorage>>>>() {
        // Clone to avoid holding the lock across await.
        let auth_manager_clone = {
            let manager = auth_manager_state
                .lock()
                .map_err(|_| "failed to lock AuthManager state".to_string())?;
            manager.clone()
        };

        if let Some(dataset_id) =
            crate::util::resolve_dataset_id_for_current_member(&auth_manager_clone).await
        {
            let normalized = dataset_id.trim().to_ascii_lowercase();
            if let Ok(uuid) = Uuid::parse_str(&normalized) {
                if uuid.get_version_num() == 4 && uuid.get_variant() == Variant::RFC4122 {
                    let dataset_token = auth_manager_clone
                        .load_dataset_token_for_dataset(&normalized)
                        .await
                        .map_err(|e| format!("failed to load dataset token: {}", e))?
                        .ok_or_else(|| "dataset_token is not available".to_string())?;
                    if dataset_token.dataset_id.as_deref() != Some(normalized.as_str()) {
                        return Err("dataset_token dataset_id does not match public_id".to_string());
                    }
                    tracing::info!("[Public ID Sync] Using AuthManager dataset_id as public_id");
                    return Ok((normalized, dataset_token.token));
                }
            }

            tracing::warn!("[Public ID Sync] AuthManager dataset_id is not a UUID v4");
        }
    }

    Err("public_id is not available; complete anonymous v2 auth first".into())
}

/// Send a completion request to the Worker.
async fn send_supabase_update(
    app_instance_id: &str,
    complete_endpoint: &str,
    dataset_token: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let update_body = json!({
        "app_instance_id": app_instance_id,
        "dataset_token": dataset_token
    });

    tracing::debug!(
        "[Public ID Sync] Sending sync completion request (token/public_id redacted)"
    );

    let response = client
        .post(complete_endpoint)
        .header("Content-Type", "application/json")
        .json(&update_body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = response.status();

    if status.is_success() {
        return Ok(());
    }

    let _ = response.text().await;

    // Keep retry diagnostics free of bearer tokens and response bodies.
    let error_msg = match status.as_u16() {
        400 => "Bad request (invalid sync data)".to_string(),
        401 => "Unauthorized (invalid or expired dataset token)".to_string(),
        404 => "Record not found (sync token may have expired)".to_string(),
        409 => "Conflict (sync record already completed or expired)".to_string(),
        429 => "Rate limited (too many requests)".to_string(),
        500..=599 => format!("Sync server error ({})", status),
        _ => format!("Unexpected sync response ({})", status),
    };

    tracing::error!("[Public ID Sync] {}", error_msg);
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
