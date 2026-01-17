use std::fs;
use std::io::Read;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;
use tokio::sync::OnceCell;
use tracing_unwrap::{OptionExt, ResultExt};
use uuid::Uuid;
use kc_api::interface::deck_port::Basic;
use tauri::Manager;
use tauri::Emitter;
use fusou_auth::types;

use crate::RESOURCES_DIR;
use crate::ROAMING_DIR;
use crate::notify;
/// Deprecated: Environment-scoped ID cache (ENV_UNIQ_ID). Do not use for user identification.
///
/// Use [`get_user_member_id()`] instead for a user-scoped, salted SHA-256 identifier
/// that enables secure cross-device data consolidation.
#[deprecated(since = "0.4.0", note = "Environment-scoped ID cache. Do not use for user identification. Use get_user_member_id() instead.")]
static KC_USER_ENV_UNIQUE_ID: OnceCell<String> = OnceCell::const_new();

/// Flag to ensure member_id upsert is called only once per unique member_id_hash
static MEMBER_ID_UPSERTED: AtomicBool = AtomicBool::new(false);
static LAST_UPSERTED_MEMBER_ID: LazyLock<OnceCell<String>> = LazyLock::new(|| OnceCell::new());

/// Flag to track if anonymous auth has been attempted (to avoid redundant attempts)
static ANONYMOUS_AUTH_ATTEMPTED: AtomicBool = AtomicBool::new(false);
static LAST_AUTHENTICATED_MEMBER_ID: LazyLock<OnceCell<String>> = LazyLock::new(|| OnceCell::new());

#[allow(non_snake_case)]
pub fn get_ROAMING_DIR() -> PathBuf {
    return ROAMING_DIR
        .get()
        .expect_or_log("ROAMING_DIR not found")
        .lock()
        .unwrap()
        .clone();
}

#[allow(non_snake_case)]
pub fn get_RESOURCES_DIR() -> PathBuf {
    return RESOURCES_DIR
        .get()
        .expect_or_log("RESOURCES_DIR not found")
        .lock()
        .unwrap()
        .clone();
}

/// Deprecated: Returns an environment-scoped ID (ENV_UNIQ_ID). Do not use for user identification.
///
/// Use [`get_user_member_id()`] instead. It uses the server-provided user ID
/// hashed with a fixed salt (SHA-256), enabling cross-device data consolidation
/// and meeting security requirements.
#[deprecated(since = "0.4.0", note = "Environment-scoped ID. Do not use for user identification. Use get_user_member_id() instead.")]
pub async fn get_user_env_id() -> String {
    KC_USER_ENV_UNIQUE_ID
        .get_or_init(|| async {
            let binding = get_ROAMING_DIR().join("./user");
            let directory_path = binding.as_path();

            if !fs::exists(directory_path).expect_or_log("failed to check the directory existence")
            {
                fs::create_dir_all(directory_path).expect_or_log("failed to create folder");
            }

            let file_path_binding = directory_path.join("./ENV_UNIQ_ID");
            let file_path = file_path_binding.as_path();

            if fs::exists(file_path).expect_or_log("failed to check the file existence") {
                let mut file = fs::File::open(file_path).expect_or_log("file not found");
                let mut contents = String::new();
                file.read_to_string(&mut contents)
                    .expect_or_log("something went wrong reading the file");
                contents
            } else {
                let mut file = fs::File::create(file_path).expect_or_log("failed to create file.");

                let new_uuid = Uuid::new_v4().to_string();
                writeln!(file, "{new_uuid}").expect_or_log("cannot write.");
                new_uuid
            }
        })
        .await
        .clone()
}

pub async fn get_user_member_id() -> String {
    let basic = Basic::load();
    basic.member_id
}

/// Upsert member_id_hash to Supabase user mapping.
/// Called once per unique member_id_hash when Basic is updated after game launch.
pub async fn try_upsert_member_id(app: &tauri::AppHandle) {
    let member_id_hash = get_user_member_id().await;
    if member_id_hash.is_empty() {
        tracing::warn!("member_id is empty, skipping upsert");
        return;
    }

    // Check if we already attempted upsert for THIS member_id_hash
    // If member_id changed (game switch), reset flag and allow retry
    let last_member_id = LAST_UPSERTED_MEMBER_ID.get();
    if MEMBER_ID_UPSERTED.load(Ordering::SeqCst) {
        if let Some(last_id) = last_member_id {
            if last_id == &member_id_hash {
                tracing::debug!("member_id upsert already completed for this member_id_hash, skipping");
                return;
            } else {
                tracing::info!("member_id changed ({} -> {}), resetting upsert flag for new game", last_id, member_id_hash);
                MEMBER_ID_UPSERTED.store(false, Ordering::SeqCst);
            }
        } else {
            // Flag is true but last_member_id not set, shouldn't happen but be safe
            return;
        }
    }

    // Get auth manager from app state
    let auth_manager_state = app.try_state::<std::sync::Arc<std::sync::Mutex<fusou_auth::AuthManager<fusou_auth::FileStorage>>>>();
    if auth_manager_state.is_none() {
        tracing::warn!("AuthManager not available, skipping member_id upsert");
        MEMBER_ID_UPSERTED.store(false, Ordering::SeqCst);
        return;
    }

    let auth_manager = auth_manager_state.unwrap();
    
    // Clone the auth manager to avoid holding lock across await
    let auth_manager_clone = {
        let manager = auth_manager.lock().unwrap();
        manager.clone()
    };
    
    let access_token = auth_manager_clone.get_access_token().await;

    let token = match access_token {
        Ok(t) => t,
        Err(e) => {
            // Session is invalid - try background anonymous auth instead of opening browser
            tracing::warn!("Failed to get access token for member_id upsert (session likely expired): {} - will retry after anonymous auth", e);
            
            // Background anonymous auth will be attempted by try_anonymous_auth (spawned from Set::Basic)
            // Do not open browser to avoid interrupting user
            
            MEMBER_ID_UPSERTED.store(false, Ordering::SeqCst);
            return;
        }
    };

    // Get endpoint from configs (use explicit member_map_endpoint only)
    let app_configs = configs::get_user_configs_for_app();
    let upsert_url = match app_configs.auth.get_member_map_endpoint() {
        Some(explicit) => explicit.trim_end_matches('/').to_string(),
        None => {
            tracing::warn!("member_map_endpoint not configured, cannot upsert member_id");
            MEMBER_ID_UPSERTED.store(false, Ordering::SeqCst);
            return;
        }
    };

    // Send POST request
    let client = reqwest::Client::new();
    let client_version = env!("CARGO_PKG_VERSION");
    let body = serde_json::json!({
        "member_id_hash": member_id_hash,
        "client_version": client_version
    });

    match client
        .post(&upsert_url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() {
                tracing::info!("member_id upsert successful (may be existing or new mapping)");
                // Server returns 200 OK for both new upserts and already-existing mappings
                // This is idempotent by design
                // Mark as completed for this member_id
                let _ = LAST_UPSERTED_MEMBER_ID.set(member_id_hash.clone());
                MEMBER_ID_UPSERTED.store(true, Ordering::SeqCst);
            } else {
                let body_text = resp.text().await.unwrap_or_default();
                tracing::error!("member_id upsert failed: status={}, body={}", status, body_text);
                MEMBER_ID_UPSERTED.store(false, Ordering::SeqCst); // Retry next time
            }
        }
        Err(e) => {
            tracing::error!("member_id upsert network error: {}", e);
            MEMBER_ID_UPSERTED.store(false, Ordering::SeqCst); // Retry next time
        }
    }
}

/// Execute anonymous authentication in background and save session and dataset_token
/// Called multiple times after Set::Basic, but only executes on first call
pub async fn try_anonymous_auth(app: &tauri::AppHandle) {
    // member_id_hashを取得
    let member_id_hash = get_user_member_id().await;
    if member_id_hash.is_empty() {
        tracing::warn!("member_id is empty, skipping anonymous auth");
        return;
    }

    // Check if already attempted for THIS member_id_hash
    // If member_id changed (game switch), reset flag and allow retry
    let last_member_id = LAST_AUTHENTICATED_MEMBER_ID.get();
    if ANONYMOUS_AUTH_ATTEMPTED.load(Ordering::SeqCst) {
        if let Some(last_id) = last_member_id {
            if last_id == &member_id_hash {
                tracing::debug!("anonymous auth already attempted for this member_id_hash, skipping");
                return;
            } else {
                tracing::info!("member_id changed ({} -> {}), resetting anonymous auth flag for new game", last_id, member_id_hash);
                ANONYMOUS_AUTH_ATTEMPTED.store(false, Ordering::SeqCst);
            }
        } else {
            // Flag is true but last_member_id not set, shouldn't happen but be safe
            return;
        }
    }

    // Mark as attempted (will update member_id if successful)
    if ANONYMOUS_AUTH_ATTEMPTED.swap(true, Ordering::SeqCst) {
        tracing::debug!("anonymous auth already in progress for this member_id_hash, skipping");
        return;
    }

    tracing::info!("Starting background anonymous authentication");

    // fusou-authのAuthManagerを取得
    let auth_manager_state = app.try_state::<std::sync::Arc<std::sync::Mutex<fusou_auth::AuthManager<fusou_auth::FileStorage>>>>();
    if auth_manager_state.is_none() {
        tracing::warn!("AuthManager not available, skipping anonymous auth");
        return;
    }

    let auth_manager = auth_manager_state.unwrap();
    
    // Clone to avoid holding lock across await
    let auth_manager_clone = {
        let manager = auth_manager.lock().unwrap();
        manager.clone()
    };

    // 匿名認証を実行してセッションとdataset_tokenを取得
    match auth_manager_clone.get_or_refresh_anonymous_session(&member_id_hash).await {
        Ok((anon_session, dataset_token_str)) => {
            tracing::info!("Anonymous authentication successful");
            
            // Check if we already have a session (e.g., from bootstrap social auth)
            // Only save anonymous session if there's no existing session
            let has_existing_session = match auth_manager_clone.peek_session().await {
                Ok(Some(existing)) => {
                    // Check if existing session is social auth (has non-empty refresh_token from social provider)
                    let is_social_auth = !existing.refresh_token.is_empty();
                    if is_social_auth {
                        tracing::info!("Keeping existing social auth session, not overwriting with anonymous session");
                    } else {
                        tracing::info!("No valid social auth session found, proceeding with anonymous session");
                    }
                    is_social_auth
                }
                _ => false,
            };
            
            // Only save anonymous session if no existing social auth session
            if !has_existing_session {
                // セッションを保存
                if let Err(e) = auth_manager_clone.save_session(&anon_session).await {
                    tracing::error!("Failed to save anonymous session: {}", e);
                    // Mark as not attempted for retry on failure
                    ANONYMOUS_AUTH_ATTEMPTED.store(false, Ordering::SeqCst);
                    return;
                } else {
                    // Success: record member_id and mark as attempted
                    let _ = LAST_AUTHENTICATED_MEMBER_ID.set(member_id_hash.clone());
                    // Note: No need to emit tokens to frontend
                    // Session saved to FileStorage and managed by AuthManager
                }
            } else {
                tracing::info!("Skipping anonymous session save to preserve social auth session");
                // Still record member_id for this attempt
                let _ = LAST_AUTHENTICATED_MEMBER_ID.set(member_id_hash.clone());
            }
            
            // dataset_tokenを保存（7日間有効期限）
            let dataset_token = types::DatasetToken {
                token: dataset_token_str,
                expires_at: chrono::Utc::now() + chrono::Duration::days(7),
            };
            
            if let Err(e) = auth_manager_clone.save_dataset_token(&dataset_token).await {
                tracing::error!("Failed to save dataset_token: {}", e);
            } else {
                tracing::info!("dataset_token obtained and stored (expires in 7 days)");
            }
        }
        Err(e) => {
            tracing::error!("Anonymous authentication failed: {}", e);
            
            // Reset flag on failure to allow future attempts (e.g., when network becomes available)
            ANONYMOUS_AUTH_ATTEMPTED.store(false, Ordering::SeqCst);
            
            // Notify user that they can manually trigger social auth
            crate::notify::show(
                app,
                "Background Authentication Failed",
                "Some features may be limited. Use 'Open Auth Page' from system tray to link a social account."
            );
        }
    }
}

#[allow(dead_code)]
pub fn type_of<T>(_: &T) -> &'static str {
    std::any::type_name::<T>()
}
