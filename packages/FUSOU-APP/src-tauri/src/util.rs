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
use fusou_auth::DeviceKey;
use crate::attestation;

use crate::RESOURCES_DIR;
use crate::ROAMING_DIR;

/// Anonymous-only mode: social session state is permanently disabled.
/// Deprecated: Environment-scoped ID cache (ENV_UNIQ_ID). Do not use for user identification.
///
/// Use [`get_user_member_id()`] instead for the game-provided `api_member_id`.
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
/// Use [`get_user_member_id()`] instead. It returns the game-provided `api_member_id`
/// and user ownership is verified by the v2 anonymous-sync protocol (device key + challenge).
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

/// Non-sensitive local fallback identity used only when dataset_id is unavailable.
/// This value is environment-scoped (per app install), not account-scoped.
pub async fn get_local_fallback_id() -> String {
    #[allow(deprecated)]
    {
        get_user_env_id().await
    }
}

async fn load_or_create_device_key() -> Result<DeviceKey, String> {
    let path = get_ROAMING_DIR().join("fusou-auth-device-key.json");
    DeviceKey::load_or_create(path)
        .await
        .map_err(|e| e.to_string())
}

/// Check if the local session and dataset_token are still usable.
/// Returns false if no non-expired dataset_token exists.
async fn check_session_usable(app: &tauri::AppHandle) -> bool {
    let auth_manager_state = app.try_state::<std::sync::Arc<std::sync::Mutex<fusou_auth::AuthManager<fusou_auth::FileStorage>>>>();
    let Some(auth_manager_state) = auth_manager_state else {
        return false;
    };
    let auth_manager = {
        auth_manager_state.lock().unwrap().clone()
    };

    let Some(dataset_id) = auth_manager.resolve_dataset_id_for_upload(None).await else {
        return false;
    };

    match auth_manager.load_dataset_token_for_dataset(&dataset_id).await {
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
    // api_member_id を取得
    let api_member_id = get_user_member_id().await;
    if api_member_id.is_empty() {
        tracing::warn!("member_id is empty, skipping anonymous auth");
        return;
    }

    // Load persisted flag from disk (multi-device consistency)
    let (disk_attempted, disk_last_member_id) = load_auth_attempt_flag();

    // Check if already attempted for THIS api_member_id
    // If member_id changed (game switch), reset flag and allow retry
    let last_member_id = {
        let guard = LAST_AUTHENTICATED_MEMBER_ID.lock().unwrap();
        guard.clone().or(disk_last_member_id)
    };
    let member_id_changed = last_member_id
        .as_deref()
        .map(|last| last != api_member_id)
        .unwrap_or(false);

    // Use disk state for first check (multi-device consistency)
    if disk_attempted {
        if let Some(last_id) = last_member_id.clone() {
            if last_id == api_member_id {
                // Flag says already attempted for this member_id, but verify the dataset_token is
                // actually usable. If token is expired or missing, allow re-auth.
                let session_still_valid = check_session_usable(app).await;
                if session_still_valid {
                    tracing::debug!("anonymous auth already attempted for this member_id (from disk) and token is valid, skipping");
                    return;
                }
                tracing::info!("session expired or missing despite auth flag; allowing re-auth");
                ANONYMOUS_AUTH_ATTEMPTED.store(false, Ordering::SeqCst);
                save_auth_attempt_flag(false, &Some(api_member_id.clone()));
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
        tracing::debug!("anonymous auth already in progress for this member_id, skipping");
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

    if member_id_changed {
        tracing::info!("member_id changed; clearing cached dataset tokens before v2 auth");
        if let Err(e) = auth_manager_clone.clear_dataset_tokens().await {
            tracing::warn!("failed to clear cached dataset tokens on member switch: {}", e);
        }
    }

    let mut device_key = match load_or_create_device_key().await {
        Ok(k) => k,
        Err(e) => {
            tracing::error!("Failed to load/create device key: {}", e);
            ANONYMOUS_AUTH_ATTEMPTED.store(false, Ordering::SeqCst);
            save_auth_attempt_flag(false, &None);
            return;
        }
    };

    // 既存 token があれば refresh 判定に利用する。
    let current_token = if member_id_changed {
        None
    } else if let Some(dataset_id) = auth_manager_clone.resolve_dataset_id_for_upload(None).await {
        auth_manager_clone
            .load_dataset_token_for_dataset(&dataset_id)
            .await
            .ok()
            .flatten()
    } else {
        None
    };

    // 匿名認証 v2 を実行して dataset_token を取得
    // challenge nonce を使って毎回 attestation_report を再構築する。
    match auth_manager_clone
        .ensure_dataset_token_v2(
            &api_member_id,
            &mut device_key,
            current_token.as_ref(),
            Some(|nonce| attestation::collect_attestation_report(Some(nonce))),
        )
        .await
    {
        Ok(dataset_token) => {
            tracing::info!("Anonymous authentication successful");

            {
                let mut guard = LAST_AUTHENTICATED_MEMBER_ID.lock().unwrap();
                *guard = Some(api_member_id.clone());
            }
            
            // Persist flag to disk for multi-device consistency
            save_auth_attempt_flag(true, &Some(api_member_id.clone()));
            
            if let Err(e) = auth_manager_clone.save_dataset_token(&dataset_token).await {
                tracing::error!("Failed to save dataset_token: {}", e);
            } else {
                tracing::info!("dataset_token obtained and stored");
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
