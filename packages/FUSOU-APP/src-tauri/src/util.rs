use std::fs;
use std::io::Read;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;
use std::sync::Mutex;
use tokio::sync::OnceCell;
use tracing_unwrap::{OptionExt, ResultExt};
use uuid::Uuid;
use kc_api::interface::deck_port::Basic;
use tauri::Manager;
use fusou_auth::types;

use crate::RESOURCES_DIR;
use crate::ROAMING_DIR;

/// Anonymous-only mode: social session state is permanently disabled.
/// Deprecated: Environment-scoped ID cache (ENV_UNIQ_ID). Do not use for user identification.
///
/// Use [`get_user_member_id()`] instead for a user-scoped, salted SHA-256 identifier
/// that enables secure cross-device data consolidation.
#[allow(deprecated)]
#[deprecated(since = "0.4.0", note = "Environment-scoped ID cache. Do not use for user identification. Use get_user_member_id() instead.")]
static KC_USER_ENV_UNIQUE_ID: OnceCell<String> = OnceCell::const_new();

/// Flag to track if anonymous auth has been attempted (to avoid redundant attempts)
/// NOTE: This is stored in memory AND persisted to disk for multi-device consistency.
/// See: load_auth_attempt_flag(), save_auth_attempt_flag()
static ANONYMOUS_AUTH_ATTEMPTED: AtomicBool = AtomicBool::new(false);
static LAST_AUTHENTICATED_MEMBER_ID: LazyLock<Mutex<Option<String>>> =
    LazyLock::new(Mutex::default);

/// Load the auth attempt flag from disk if available (multi-device consistency).
/// Returns (attempted_before, last_member_id)
fn load_auth_attempt_flag() -> (bool, Option<String>) {
    let flag_path = get_ROAMING_DIR().join("fusou-auth-attempt.json");
    if let Ok(content) = std::fs::read_to_string(&flag_path) {
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(&content) {
            let attempted = data.get("attempted").and_then(|v| v.as_bool()).unwrap_or(false);
            let member_id = data.get("last_member_id").and_then(|v| v.as_str()).map(|s| s.to_string());
            return (attempted, member_id);
        }
    }
    (false, None)
}

/// Persist the auth attempt flag to disk for multi-device consistency.
fn save_auth_attempt_flag(attempted: bool, member_id: &Option<String>) {
    let flag_path = get_ROAMING_DIR().join("fusou-auth-attempt.json");
    let data = serde_json::json!({
        "attempted": attempted,
        "last_member_id": member_id,
        "timestamp": chrono::Utc::now().to_rfc3339()
    });
    let _ = if let Some(parent) = flag_path.parent() {
        std::fs::create_dir_all(parent)
    } else {
        Ok(())
    };
    let _ = std::fs::write(&flag_path, serde_json::to_string(&data).unwrap_or_default());
}

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
///
/// Tracking issue: <https://github.com/tsukasa-u/FUSOU/issues/TBD>
#[allow(dead_code)]
#[allow(deprecated)]
#[deprecated(since = "0.4.0", note = "Environment-scoped ID. Do not use for user identification. Use get_user_member_id() instead. See tracking issue: https://github.com/tsukasa-u/FUSOU/issues/TBD")]
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

/// Check if the local session and dataset_token are still usable.
/// Returns false if session is missing/expired or dataset_token is missing/expired.
async fn check_session_usable(app: &tauri::AppHandle, member_id_hash: &str) -> bool {
    let auth_manager_state = app.try_state::<std::sync::Arc<std::sync::Mutex<fusou_auth::AuthManager<fusou_auth::FileStorage>>>>();
    let Some(auth_manager_state) = auth_manager_state else {
        return false;
    };
    let auth_manager = {
        auth_manager_state.lock().unwrap().clone()
    };

    // Check session: try to get access token (refreshes if needed)
    let session_ok = auth_manager.get_access_token().await.is_ok();
    if !session_ok {
        return false;
    }

    // Check dataset_token: must exist and not be expired (within 1 day margin)
    match auth_manager.load_dataset_token_for_dataset(member_id_hash).await {
        Ok(Some(token)) => {
            let one_day = chrono::Duration::days(1);
            token.expires_at > chrono::Utc::now() + one_day
        }
        _ => false,
    }
}

/// Execute anonymous authentication in background and save session and dataset_token
/// Called multiple times after Set::Basic, but only executes on first call
///
/// Multi-device: Auth attempt flag is persisted to disk to prevent redundant attempts
/// across multiple device launches of the same app instance.
/// If the existing session is expired or missing, the flag is ignored and re-auth is allowed.
pub async fn try_anonymous_auth(app: &tauri::AppHandle) {
    // member_id_hashを取得
    let member_id_hash = get_user_member_id().await;
    if member_id_hash.is_empty() {
        tracing::warn!("member_id is empty, skipping anonymous auth");
        return;
    }

    // Load persisted flag from disk (multi-device consistency)
    let (disk_attempted, disk_last_member_id) = load_auth_attempt_flag();

    // Check if already attempted for THIS member_id_hash
    // If member_id changed (game switch), reset flag and allow retry
    let last_member_id = {
        let guard = LAST_AUTHENTICATED_MEMBER_ID.lock().unwrap();
        guard.clone().or(disk_last_member_id)
    };

    // Use disk state for first check (multi-device consistency)
    if disk_attempted {
        if let Some(last_id) = last_member_id.clone() {
            if last_id == member_id_hash {
                // Flag says already attempted for this member_id, but verify the session is
                // actually usable. If the session is expired or missing, allow re-auth.
                let session_still_valid = check_session_usable(app, &member_id_hash).await;
                if session_still_valid {
                    tracing::debug!("anonymous auth already attempted for this member_id_hash (from disk) and session is valid, skipping");
                    return;
                }
                tracing::info!("session expired or missing despite auth flag; allowing re-auth");
                ANONYMOUS_AUTH_ATTEMPTED.store(false, Ordering::SeqCst);
                save_auth_attempt_flag(false, &Some(member_id_hash.clone()));
            } else {
                tracing::info!("member_id changed, resetting anonymous auth flag for new game");
                ANONYMOUS_AUTH_ATTEMPTED.store(false, Ordering::SeqCst);
                save_auth_attempt_flag(false, &None);
            }
        } else {
            // Disk flag is true but last_member_id not set, reset and allow re-auth
            tracing::info!("auth flag set but last_member_id missing; resetting flag");
            ANONYMOUS_AUTH_ATTEMPTED.store(false, Ordering::SeqCst);
            save_auth_attempt_flag(false, &None);
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
        ANONYMOUS_AUTH_ATTEMPTED.store(false, Ordering::SeqCst);
        save_auth_attempt_flag(false, &None);
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
        Ok((anon_session_opt, dataset_token_str)) => {
            tracing::info!("Anonymous authentication successful");
            
            // Anonymous-only mode: always persist anonymous session if returned.
            if let Some(anon_session) = anon_session_opt {
                if let Err(e) = auth_manager_clone.save_session(&anon_session).await {
                    tracing::error!("Failed to save anonymous session: {}", e);
                    ANONYMOUS_AUTH_ATTEMPTED.store(false, Ordering::SeqCst);
                    save_auth_attempt_flag(false, &None);
                    return;
                }
            } else {
                tracing::info!(
                    "Anonymous auth completed without session tokens (likely existing mapping on another device); dataset_token-only mode"
                );
            }

            {
                let mut guard = LAST_AUTHENTICATED_MEMBER_ID.lock().unwrap();
                *guard = Some(member_id_hash.clone());
            }
            
            // Persist flag to disk for multi-device consistency
            save_auth_attempt_flag(true, &Some(member_id_hash.clone()));
            
            // dataset_tokenを保存（7日間有効期限）
            let dataset_token = types::DatasetToken {
                token: dataset_token_str,
                expires_at: chrono::Utc::now() + chrono::Duration::days(7),
                dataset_id: Some(member_id_hash.clone()),
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
            save_auth_attempt_flag(false, &None);
            
            // Notify user that they can manually trigger social auth
            crate::notify::show(
                app,
                "Background Authentication Failed",
                "Some features may be limited. Background anonymous sign-in failed."
            );
        }
    }
}

#[allow(dead_code)]
pub fn type_of<T>(_: &T) -> &'static str {
    std::any::type_name::<T>()
}
