use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[cfg(dev)]
use std::fs;

use proxy_https::bidirectional_channel;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::builder_setup::bidirectional_channel::get_pac_bidirectional_channel;
use crate::builder_setup::bidirectional_channel::get_proxy_bidirectional_channel;
use crate::builder_setup::logger::MessageVisitor;
#[cfg(feature = "gdrive")]
use crate::storage::providers::gdrive;
use crate::interface::mst_equip_exslot_ship::MstEquipExslotShips;
use crate::interface::mst_equip_ship::MstEquipShips;
use crate::interface::mst_ship::MstShips;
use crate::interface::mst_slot_item::MstSlotItems;
use crate::interface::mst_slot_item_equip_type::MstSlotItemEquipTypes;
use crate::interface::mst_stype::MstStypes;
use crate::interface::mst_use_item::MstUseItems;
use crate::interface::slot_item::SlotItems;

use crate::sequence;
use fusou_upload::{PendingStore, UploadRetryService};
use tracing_unwrap::OptionExt;

// use tauri_plugin_notification::NotificationExt; // replaced by notify wrapper where needed

#[tauri::command]
pub async fn get_mst_ships(window: tauri::Window) {
    let data = MstShips::load();
    let _ = window
        .app_handle()
        .emit_to("main", "set-kcs-mst-ships", data);
}

#[tauri::command]
pub async fn get_mst_slot_items(window: tauri::Window) {
    let data = MstSlotItems::load();
    let _ = window
        .app_handle()
        .emit_to("main", "set-kcs-mst-slot-items", data);
}

#[tauri::command]
pub async fn get_slot_items(window: tauri::Window) {
    let data = SlotItems::load();
    let _ = window
        .app_handle()
        .emit_to("main", "set-kcs-slot-items", data);
}

#[tauri::command]
pub async fn get_mst_equip_exslot_ships(window: tauri::Window) {
    let data = MstEquipExslotShips::load();
    let _ = window
        .app_handle()
        .emit_to("main", "set-kcs-mst-equip-exslot-ships", data);
}

#[tauri::command]
pub async fn get_mst_slotitem_equip_types(window: tauri::Window) {
    let data = MstSlotItemEquipTypes::load();
    let _ = window
        .app_handle()
        .emit_to("main", "set-kcs-mst-slot-item-equip-types", data);
}

#[tauri::command]
pub async fn get_mst_equip_ships(window: tauri::Window) {
    let data = MstEquipShips::load();
    let _ = window
        .app_handle()
        .emit_to("main", "set-kcs-mst-equip-ships", data);
}

#[tauri::command]
pub async fn get_mst_stypes(window: tauri::Window) {
    let data = MstStypes::load();
    let _ = window
        .app_handle()
        .emit_to("main", "set-kcs-mst-stypes", data);
}

#[tauri::command]
pub async fn get_mst_useitems(window: tauri::Window) {
    let data = MstUseItems::load();
    let _ = window
        .app_handle()
        .emit_to("main", "set-kcs-mst-use-items", data);
}

#[allow(dead_code)]
#[tauri::command]
pub async fn show_splashscreen(window: tauri::Window) {
    // Show splashscreen
    window
        .get_webview_window("splashscreen")
        .expect_or_log("no window labeled 'splashscreen' found")
        .show()
        .unwrap();
}

#[allow(dead_code)]
#[tauri::command]
pub async fn close_splashscreen(window: tauri::Window) {
    // Close splashscreen
    window
        .get_webview_window("splashscreen")
        .expect_or_log("no window labeled 'splashscreen' found")
        .close()
        .unwrap();
    // Show main window
    window
        .get_webview_window("main")
        .expect_or_log("no window labeled 'main' found")
        .show()
        .unwrap();
    window
        .get_webview_window("external")
        .expect_or_log("no window labeled 'external' found")
        .show()
        .unwrap();
}

#[cfg(feature = "gdrive")]
#[tauri::command(rename_all = "snake_case")]
pub async fn set_refresh_token(_window: tauri::Window, token: String) -> Result<(), ()> {
    let split_token: Vec<String> = token.split("&").map(|s| s.to_string()).collect();
    #[allow(clippy::get_first)]
    let refresh_token = split_token.get(0);
    let token_type = split_token.get(1);
    if refresh_token.is_none() || token_type.is_none() {
        return Err(());
    }
    let refresh_token = refresh_token.unwrap();
    let token_type = token_type.unwrap();
    return gdrive::set_refresh_token(refresh_token.to_string(), token_type.to_string());
}

use fusou_auth::{AuthManager, FileStorage};

#[derive(Debug, Serialize)]
pub struct SessionHealth {
    pub has_session: bool,
    pub access_token_len: usize,
    pub refresh_token_len: usize,
    pub seems_valid: bool,
    pub reason: Option<String>,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn check_supabase_session_health(
    _window: tauri::Window,
    auth_manager: tauri::State<'_, Arc<Mutex<AuthManager<FileStorage>>>>,
) -> Result<SessionHealth, String> {
    let manager = {
        let guard = auth_manager.lock().unwrap();
        guard.clone()
    };

    let session_opt = manager.peek_session().await.map_err(|e| e.to_string())?;
    if let Some(session) = session_opt {
        let access_len = session.access_token.len();
        let refresh_len = session.refresh_token.len();

        Ok(SessionHealth {
            has_session: true,
            access_token_len: access_len,
            refresh_token_len: refresh_len,
            seems_valid: true,
            reason: None,
        })
    } else {
        Ok(SessionHealth {
            has_session: false,
            access_token_len: 0,
            refresh_token_len: 0,
            seems_valid: false,
            reason: Some("no session stored".to_string()),
        })
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn force_local_sign_out(
    window: tauri::Window,
    auth_manager: tauri::State<'_, Arc<Mutex<AuthManager<FileStorage>>>>,
) -> Result<(), String> {
    let manager = {
        let guard = auth_manager.lock().unwrap();
        guard.clone()
    };

    manager.clear().await.map_err(|e| e.to_string())?;

    // Tell frontend to drop tokens immediately.
    let _ = window
        .app_handle()
        .emit_to("main", "set-supabase-tokens", vec![String::new(), String::new()]);

    Ok(())
}

/// Get the current valid access token from Rust-managed session.
/// This ensures only Rust handles token refresh, avoiding duplicate refresh loops.
/// SolidJS should call this instead of maintaining its own Supabase session.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_access_token(
    auth_manager: tauri::State<'_, Arc<Mutex<AuthManager<FileStorage>>>>,
) -> Result<String, String> {
    let manager = {
        let guard = auth_manager.lock().unwrap();
        guard.clone()
    };

    // This automatically refreshes if token is near expiry
    manager
        .get_access_token()
        .await
        .map_err(|e| format!("Failed to get access token: {}", e))
}

#[cfg(dev)]
#[tauri::command]
pub async fn read_emit_file(window: tauri::Window, path: &str) -> Result<(), String> {
    use crate::json_parser::{emit_data, struct_selector_response, struct_selector_resquest};

    let file = fs::read_to_string(path);
    if let Err(e) = file {
        return Err(e.to_string());
    }
    let content = file.unwrap();

    let path_string = path.to_string();
    let path_split_slash: Vec<&str> = path_string.split("/").collect();
    let path_split_at: Vec<String> = path_split_slash[path_split_slash.len() - 1]
        .split("@")
        .map(|s| s.to_string())
        .collect();
    let formated_path = format!("/kcsapi/{}/{}", path_split_at[1], path_split_at[2]);

    match path_split_at[0].as_str() {
        s if s.ends_with("S") => {
            if let Ok(emit_data_list) = struct_selector_response(formated_path, content) {
                for emit_data_element in emit_data_list {
                    emit_data(window.app_handle(), emit_data_element);
                }
            }
        }
        s if s.ends_with("Q") => {
            if let Ok(emit_data_list) = struct_selector_resquest(formated_path, content) {
                for emit_data_element in emit_data_list {
                    emit_data(window.app_handle(), emit_data_element);
                }
            }
        }
        _ => {}
    }

    return Ok(());
}

#[tauri::command]
pub async fn check_pac_server_health(_window: tauri::Window) -> Result<String, String> {
    match bidirectional_channel::check_health(get_pac_bidirectional_channel().clone_master()).await
    {
        Ok(_) => Ok("PAC server is running".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn check_proxy_server_health(_window: tauri::Window) -> Result<String, String> {
    match bidirectional_channel::check_health(get_proxy_bidirectional_channel().clone_master())
        .await
    {
        Ok(_) => Ok("Proxy server is running".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn launch_with_options(
    window: tauri::Window,
    options: HashMap<String, i32>,
    auth_manager: tauri::State<'_, Arc<Mutex<AuthManager<FileStorage>>>>,
) -> Result<(), ()> {
    sequence::launch::launch_with_options(window, options, auth_manager.inner().clone()).await
}

#[tauri::command]
pub async fn check_open_window(window: tauri::Window, label: &str) -> Result<bool, ()> {
    let open_flag = match window.get_webview_window(label) {
        Some(win) => Ok(win.is_visible().unwrap_or(false)),
        None => Err(()),
    }?;

    let opened_flag = if !open_flag {
        let win = window.get_webview_window(label);
        win.clone().map(|app| app.show());
        win.map(|app| app.is_visible().unwrap_or(false))
    } else {
        Some(true)
    };

    return opened_flag.ok_or(());
}

#[tauri::command]
pub async fn get_app_theme(_window: tauri::Window) -> Result<String, ()> {
    let theme = configs::get_user_configs_for_app()
        .theme
        .get_theme()
        .to_string();
    Ok(theme)
}

#[tauri::command]
pub async fn get_app_font(_window: tauri::Window) -> Result<String, ()> {
    let font = configs::get_user_configs_for_app()
        .font
        .get_font_family()
        .to_string();
    Ok(font)
}

#[tauri::command]
pub async fn get_kc_server_name(_window: tauri::Window) -> Result<String, ()> {
    let name = configs::get_user_configs_for_app()
        .connect_kc_server
        .get_kc_server_name()
        .map(|s| s.to_string());
    Ok(name.unwrap_or("".to_string()))
}

//--------------------------------------------------------------

pub fn set_update_page(app: &AppHandle) {
    let _ = app.emit_to("main", "set-main-page-update", ());
}

#[tauri::command]
pub async fn perform_snapshot_sync(
    _window: tauri::Window,
    auth_manager: tauri::State<'_, Arc<Mutex<AuthManager<FileStorage>>>>,
) -> Result<serde_json::Value, String> {
    
    crate::storage::snapshot::perform_snapshot_sync_app(
        &_window.app_handle(),
        auth_manager.inner().clone(),
    ).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn retry_pending_uploads_now(
    retry_service: tauri::State<'_, Arc<UploadRetryService>>,
) -> Result<String, String> {
    retry_service.trigger_retry_force().await;
    Ok("Pending upload retry triggered".to_string())
}

#[derive(Debug, Serialize)]
pub struct PendingRetryItemStatus {
    pub id: String,
    pub attempt_count: u32,
    pub created_at: u64,
    pub last_attempt_at: Option<u64>,
    pub next_due_at: u64,
    pub seconds_until_next_due: u64,
    pub expires_at: u64,
}

#[derive(Debug, Serialize)]
pub struct PendingRetryStatus {
    pub total_pending: usize,
    pub due_now_count: usize,
    pub max_attempts: u32,
    pub interval_seconds: u64,
    pub ttl_seconds: u64,
    pub now_epoch_seconds: u64,
    pub next_due_at: Option<u64>,
    pub items: Vec<PendingRetryItemStatus>,
}

#[derive(Debug, Serialize)]
pub struct ShipGrowthSuppressionEntryStatus {
    pub key: String,
    pub expires_at_ms: u64,
    pub hash_prefix: String,
}

#[derive(Debug, Serialize)]
pub struct ShipGrowthSuppressionStatus {
    pub scope: Option<String>,
    pub entries: Vec<ShipGrowthSuppressionEntryStatus>,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_pending_upload_retry_status(
    pending_store: tauri::State<'_, Arc<PendingStore>>,
) -> Result<PendingRetryStatus, String> {
    let configs = configs::get_user_configs_for_app();
    let retry = &configs.asset_sync.retry;
    let interval_seconds = retry.get_interval_seconds();
    let ttl_seconds = retry.get_ttl_seconds();
    let max_attempts = retry.get_max_attempts();
    let now = UploadRetryService::now_epoch_seconds();

    let pending_items = pending_store.list_pending();
    let mut due_now_count = 0usize;

    let mut items: Vec<PendingRetryItemStatus> = pending_items
        .into_iter()
        .map(|meta| {
            let next_due_at = UploadRetryService::next_due_epoch_seconds(&meta, interval_seconds);
            let seconds_until_next_due = next_due_at.saturating_sub(now);
            if seconds_until_next_due == 0 {
                due_now_count += 1;
            }

            PendingRetryItemStatus {
                id: meta.id,
                attempt_count: meta.attempt_count,
                created_at: meta.created_at,
                last_attempt_at: meta.last_attempt_at,
                next_due_at,
                seconds_until_next_due,
                expires_at: meta.created_at.saturating_add(ttl_seconds),
            }
        })
        .collect();

    items.sort_by_key(|item| item.next_due_at);
    let next_due_at = items.first().map(|item| item.next_due_at);

    Ok(PendingRetryStatus {
        total_pending: items.len(),
        due_now_count,
        max_attempts,
        interval_seconds,
        ttl_seconds,
        now_epoch_seconds: now,
        next_due_at,
        items,
    })
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_ship_growth_suppression_status(
) -> Result<Option<ShipGrowthSuppressionStatus>, String> {
    Ok(crate::ship_growth_sender::get_suppression_status().map(|status| ShipGrowthSuppressionStatus {
        scope: status.scope,
        entries: status
            .entries
            .into_iter()
            .map(|entry| ShipGrowthSuppressionEntryStatus {
                key: entry.key,
                expires_at_ms: entry.expires_at_ms,
                hash_prefix: entry.hash.chars().take(12).collect(),
            })
            .collect(),
    }))
}

#[derive(Debug, Serialize)]
pub struct QuestTreeSuppressionEntryStatus {
    pub key: String,
    pub expires_at_ms: u64,
    pub hash_prefix: String,
}

#[derive(Debug, Serialize)]
pub struct QuestTreeSuppressionStatus {
    pub scope: Option<String>,
    pub entries: Vec<QuestTreeSuppressionEntryStatus>,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_quest_tree_suppression_status(
) -> Result<Option<QuestTreeSuppressionStatus>, String> {
    Ok(crate::quest_tree_sender::get_suppression_status().map(|status| QuestTreeSuppressionStatus {
        scope: status.scope,
        entries: status
            .entries
            .into_iter()
            .map(|entry| QuestTreeSuppressionEntryStatus {
                key: entry.key,
                expires_at_ms: entry.expires_at_ms,
                hash_prefix: entry.hash.chars().take(12).collect(),
            })
            .collect(),
    }))
}

#[derive(Debug, Serialize)]
pub struct RemodelSuppressionEntryStatus {
    pub key: String,
    pub expires_at_ms: u64,
    pub hash_prefix: String,
}

#[derive(Debug, Serialize)]
pub struct RemodelSuppressionStatus {
    pub scope: Option<String>,
    pub entries: Vec<RemodelSuppressionEntryStatus>,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_remodel_suppression_status(
) -> Result<Option<RemodelSuppressionStatus>, String> {
    Ok(crate::remodel_sender::get_suppression_status().map(|status| RemodelSuppressionStatus {
        scope: status.scope,
        entries: status
            .entries
            .into_iter()
            .map(|entry| RemodelSuppressionEntryStatus {
                key: entry.key,
                expires_at_ms: entry.expires_at_ms,
                hash_prefix: entry.hash.chars().take(12).collect(),
            })
            .collect(),
    }))
}

// Removed: use notify::show via internal callers when needed.

/// Tauri command to get all stored logs
#[tauri::command]
pub fn get_all_logs() -> Vec<MessageVisitor> {
    crate::builder_setup::logger::get_all_logs_internal()
}

/// Get user's Google Drive refresh token from Supabase (provider_tokens table).
/// Uses RLS (Row Level Security) via Authorization header for user identification.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_user_tokens(
    _user_id: String,
    auth_manager: tauri::State<'_, Arc<Mutex<AuthManager<FileStorage>>>>,
) -> Result<Option<String>, String> {
    let manager = {
        let guard = auth_manager.lock().unwrap();
        guard.clone()
    };

    manager
        .fetch_provider_token("google")
        .await
        .map_err(|e| format!("Failed to fetch provider token: {}", e))
}

#[cfg(dev)]
#[tauri::command]
pub async fn open_debug_window(window: tauri::Window) {
    match window.get_webview_window("debug") {
        Some(debug_window) => {
            debug_window.show().unwrap();
        }
        None => {
            let _window = tauri::WebviewWindowBuilder::new(
                window.app_handle(),
                "debug",
                tauri::WebviewUrl::App("/debug".into()),
            )
            .fullscreen(false)
            .title("fusou-debug")
            .build()
            .unwrap();
        }
    }
}

#[cfg(dev)]
#[tauri::command]
pub async fn close_debug_window(window: tauri::Window) {
    window
        .get_webview_window("debug")
        .expect_or_log("no window labeled 'debug' found")
        .close()
        .unwrap();
}

