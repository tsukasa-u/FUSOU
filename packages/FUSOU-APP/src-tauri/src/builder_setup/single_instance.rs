#[cfg(feature = "gdrive")]
use crate::storage::providers::gdrive;
use tauri::{Manager, Url};
use fusou_auth::{AuthManager, FileStorage, Session};
use std::sync::{Arc, Mutex};
use kc_api::interface::deck_port::Basic;
use serde_json::json;
use uuid::Uuid;

pub fn single_instance_init(app: &tauri::AppHandle, argv: Vec<String>) {
    // Initialization code for single instance
    if let Some(path) = argv.get(1) {
        let url = Url::parse(path).unwrap();

        // Check if this is a Realtime-based member_id_hash sync request
        // fusou://sync?token=xxx&return_url=yyy
        if url.scheme() == "fusou" && url.host_str() == Some("sync") {
            handle_realtime_member_id_sync(&url, app);
            return;
        }

        // Check if this is a request for member_id_hash (legacy, for backward compatibility)
        if url.scheme() == "fusou" && url.host_str() == Some("request-member-id") {
            handle_member_id_request(&url);
            return;
        }

        // Parse tokens from URL query parameters
        // These are sent from FUSOU-WEB after OAuth authentication
        let mut providrer_refresh_token = String::new();
        let mut supabase_refresh_token = String::new();
        let mut supabase_access_token = String::new();

        url.query_pairs().for_each(|(key, value)| {
            // println!("key: {}, value: {}", key, value);
            if key.eq("provider_refresh_token") {
                providrer_refresh_token = value.to_string();
            } else if key.eq("supabase_refresh_token") {
                supabase_refresh_token = value.to_string();
            } else if key.eq("supabase_access_token") {
                supabase_access_token = value.to_string();
            }
        });
        
        // Provider refresh token (e.g., Google Drive)
        // Kept for future cloud provider features (currently deprecated)
        #[cfg(feature = "gdrive")]
        if !providrer_refresh_token.is_empty() {
            let token_type = "Bearer";
            let _ = gdrive::set_refresh_token(providrer_refresh_token, token_type.to_owned());
        }
        
        // Supabase session tokens (for social auth like Google OAuth)
        // Required: Enables cross-device account persistence
        // Different from anonymous auth which is local-only
        if !supabase_refresh_token.is_empty() && !supabase_access_token.is_empty() {
            let auth_manager = app.state::<Arc<Mutex<AuthManager<FileStorage>>>>();
            let manager = { auth_manager.lock().unwrap().clone() };
            
            let session = Session {
                access_token: supabase_access_token.clone(),
                refresh_token: supabase_refresh_token.clone(),
                expires_at: None,
                token_type: Some("bearer".to_string()),
            };
            
            // We can't await here easily because single_instance_init is synchronous?
            // But we can spawn a task.
            tauri::async_runtime::spawn(async move {
                if let Err(e) = manager.save_session(&session).await {
                    tracing::error!("Failed to save session in single instance: {}", e);
                } else {
                    tracing::info!("Social auth session saved successfully via OAuth callback");
                }
            });
            // Note: No need to emit tokens to frontend
            // Session saved to FileStorage and managed by AuthManager
        }
    }

    let singleton_window = match app.get_webview_window("main") {
        Some(window) => window,
        None => {
            tracing::error!("Failed to get main window");
            return;
        }
    };

    singleton_window.show().unwrap();

    if singleton_window.is_minimized().unwrap() {
        singleton_window.unminimize().unwrap();
    }

    if !singleton_window.is_focused().unwrap() {
        singleton_window.set_focus().unwrap();
    }

    println!("single instance: {:?}", argv.clone().get(1).unwrap());
}

/// Handle fusou://request-member-id?return_url=xxx
/// This allows WEB page to request member_id_hash from the app via hidden iframe
fn handle_member_id_request(url: &Url) {
    // Get return_url from query parameters
    let return_url = url
        .query_pairs()
        .find(|(key, _)| key == "return_url")
        .map(|(_, value)| value.to_string());

    if return_url.is_none() {
        tracing::warn!("request-member-id called without return_url parameter");
        return;
    }

    let return_url = return_url.unwrap();

    // Get member_id_hash from game data
    let basic = Basic::load();
    let member_id_hash = basic.member_id;

    if member_id_hash.is_empty() {
        tracing::warn!("member_id_hash not available; user should launch the game first");
        // Construct error response
        let error_url = format!("{}{}error=member_id_not_available", 
            return_url, 
            if return_url.contains('?') { "&" } else { "?" });
        // Open in browser window, which will update the existing page via JavaScript
        let _ = webbrowser::open(&error_url);
        return;
    }

    // Save to cache for future use
    use crate::auth::member_id_cache::MemberIdCache;
    if let Err(e) = MemberIdCache::save(&member_id_hash) {
        tracing::warn!("Failed to cache member_id_hash: {}", e);
    }

    // Construct return URL with member_id_hash
    // The WEB page will receive this via URLSearchParams and process it with JavaScript
    let separator = if return_url.contains('?') { "&" } else { "?" };
    let callback_url = format!("{}{}member_id_hash={}", return_url, separator, member_id_hash);


    tracing::info!("Sending member_id_hash to browser: {}", callback_url);
    
    // This will cause the browser to navigate, updating the existing page
    // The WEB page JavaScript will read the parameter and continue the flow
    let _ = webbrowser::open(&callback_url);
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

    tracing::info!("[Realtime Sync] Received sync request with token: {}", token);

    // 2. Generate APP instance ID (for handling multiple APP instances on same machine)
    let app_instance_id = get_or_create_app_instance_id();

    // 3. Execute Supabase update in async task
    tauri::async_runtime::spawn(async move {
        match handle_realtime_sync_async(&token, &app_instance_id).await {
            Ok(_) => {
                tracing::info!(
                    "[Realtime Sync] Successfully synced with token: {}",
                    token
                );
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
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // 1. Load member_id_hash from game data or cache
    use crate::auth::member_id_cache::MemberIdCache;
    
    // Try cache first
    let member_id_hash = MemberIdCache::load()
        .map(|cache| cache.member_id_hash)
        .unwrap_or_else(|| {
            // Fall back to loading from game data
            let basic = Basic::load();
            basic.member_id
        });

    if member_id_hash.is_empty() {
        return Err(
            "member_id_hash not available; user should launch the game first".into()
        );
    }

    tracing::info!(
        "[Realtime Sync] Loaded member_id_hash: {}...",
        &member_id_hash[..std::cmp::min(10, member_id_hash.len())]
    );

    // Save to cache for future use
    if let Err(e) = MemberIdCache::save(&member_id_hash) {
        tracing::warn!("[Realtime Sync] Failed to cache member_id_hash: {}", e);
    }

    // 2. Get Supabase configuration (with clear error messages)
    let supabase_url = std::env::var("SUPABASE_URL")
        .or_else(|_| std::env::var("PUBLIC_SUPABASE_URL"))
        .map_err(|_| "Environment variable SUPABASE_URL or PUBLIC_SUPABASE_URL is not set")?;
    
    // Support multiple variable names for API key (ANON_KEY for legacy, PUBLISHABLE_KEY for new)
    let supabase_anon_key = std::env::var("SUPABASE_ANON_KEY")
        .or_else(|_| std::env::var("PUBLIC_SUPABASE_ANON_KEY"))
        .or_else(|_| std::env::var("PUBLIC_SUPABASE_PUBLISHABLE_KEY"))
        .map_err(|_| "Environment variable SUPABASE_ANON_KEY, PUBLIC_SUPABASE_ANON_KEY, or PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set")?;

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

    Err(last_error.unwrap_or_else(|| "Unknown error".to_string()).into())
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
/// Generates a machine-specific ID to prevent conflicts when multiple APPs are running
/// Saves to file so the same ID is used on the same machine
fn get_or_create_app_instance_id() -> String {
    let instance_id_path = if let Ok(roaming_dir) = std::env::var("APPDATA") {
        std::path::PathBuf::from(&roaming_dir)
            .join("FUSOU")
            .join("app_instance_id.txt")
    } else if let Ok(home_dir) = std::env::var("HOME") {
        std::path::PathBuf::from(&home_dir)
            .join(".fusou")
            .join("app_instance_id.txt")
    } else {
        // Fallback: use session-specific ID
        return Uuid::new_v4().to_string();
    };

    // Read ID from file
    if let Ok(content) = std::fs::read_to_string(&instance_id_path) {
        let trimmed = content.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    // Create new ID if file doesn't exist or is empty
    let instance_id = Uuid::new_v4().to_string();
    let _ = std::fs::create_dir_all(instance_id_path.parent().unwrap());
    let _ = std::fs::write(&instance_id_path, &instance_id);

    instance_id
}
