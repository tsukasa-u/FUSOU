use std::{collections::HashMap, fs};

use proxy_https::bidirectional_channel;
use tauri::{AppHandle, Emitter, Manager};

use crate::auth::auth_server;
#[cfg(feature = "auth-local-server")]
use crate::auth_server::AuthChannel;
use crate::builder_setup::bidirectional_channel::get_pac_bidirectional_channel;
use crate::builder_setup::bidirectional_channel::get_proxy_bidirectional_channel;
use crate::cloud_storage::google_drive;
use crate::interface::mst_equip_exslot_ship::MstEquipExslotShips;
use crate::interface::mst_equip_ship::MstEquipShips;
use crate::interface::mst_ship::MstShips;
use crate::interface::mst_slot_item::MstSlotItems;
use crate::interface::mst_slot_item_equip_type::MstSlotItemEquipTypes;
use crate::interface::mst_stype::MstStypes;
use crate::interface::mst_use_item::MstUseItems;
use crate::interface::slot_item::SlotItems;

use crate::sequence;
use tracing_unwrap::OptionExt;

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
    return google_drive::set_refresh_token(refresh_token.to_string(), token_type.to_string());
}

#[cfg(dev)]
#[tauri::command]
pub async fn open_auth_window(window: tauri::Window) {
    match window.get_webview_window("auth") {
        Some(auth_window) => {
            auth_window.show().unwrap();
        }
        None => {
            let _window = tauri::WebviewWindowBuilder::new(
                window.app_handle(),
                "auth",
                tauri::WebviewUrl::App("/auth".into()),
            )
            .devtools(true)
            .fullscreen(false)
            .title("fusou-auth")
            // .visible(false)
            .build()
            .unwrap();
        }
    }
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
            // .visible(false)
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

#[cfg(feature = "auth-local-server")]
#[tauri::command]
pub async fn open_auth_page(
    _window: tauri::Window,
    auth_channel: tauri::State<'_, AuthChannel>,
) -> Result<(), ()> {
    let addr = auth_server::serve_auth(0, auth_channel.slave.clone());

    let result = webbrowser::open(format!("http://localhost:{}/login", addr.port()).as_str())
        .map_err(|e| e.to_string());

    if let Err(e) = result {
        tracing::error!("Error: {}", e);
        return Err(());
    }
    Ok(())
}

#[cfg(not(feature = "auth-local-server"))]
#[tauri::command]
pub async fn open_auth_page(_window: tauri::Window) -> Result<(), ()> {
    let result = auth_server::open_auth_page();

    if let Err(e) = result {
        tracing::error!("Error: {e}");
        return Err(());
    }
    Ok(())
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
) -> Result<(), ()> {
    sequence::launch::launch_with_options(window, options).await
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

pub fn set_launch_page(app: &AppHandle) {
    let _ = app.emit_to("main", "set-main-page-launch", ());
}
