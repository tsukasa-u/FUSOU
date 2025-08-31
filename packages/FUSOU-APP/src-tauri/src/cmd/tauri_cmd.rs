use std::collections::HashMap;
use std::fs;
use std::fs::canonicalize;

use proxy_https::bidirectional_channel;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;

use crate::auth::auth_server;
#[cfg(feature = "auth-local-server")]
use crate::auth_server::AuthChannel;
use crate::cloud_storage::google_drive;
use crate::external::create_external_window;
use crate::interface::mst_equip_exslot_ship::MstEquipExslotShips;
use crate::interface::mst_equip_ship::MstEquipShips;
use crate::interface::mst_ship::MstShips;
use crate::interface::mst_slot_item::MstSlotItems;
use crate::interface::mst_slot_item_equip_type::MstSlotItemEquipTypes;
use crate::interface::mst_stype::MstStypes;
use crate::interface::mst_use_item::MstUseItems;
use crate::interface::slot_item::SlotItems;

use crate::external::SHARED_BROWSER;
use crate::json_parser;
use crate::util;
use crate::wrap_proxy::{self, PacChannel, ProxyChannel, ProxyLogChannel, ResponseParseChannel};

#[cfg(any(not(dev), check_release))]
use crate::RESOURCES_DIR;

#[cfg(any(not(dev), check_release))]
use crate::ROAMING_DIR;

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
        .expect("no window labeled 'splashscreen' found")
        .show()
        .unwrap();
}

#[allow(dead_code)]
#[tauri::command]
pub async fn close_splashscreen(window: tauri::Window) {
    // Close splashscreen
    window
        .get_webview_window("splashscreen")
        .expect("no window labeled 'splashscreen' found")
        .close()
        .unwrap();
    // Show main window
    window
        .get_webview_window("main")
        .expect("no window labeled 'main' found")
        .show()
        .unwrap();
    window
        .get_webview_window("external")
        .expect("no window labeled 'external' found")
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
        .expect("no window labeled 'debug' found")
        .close()
        .unwrap();
}

#[cfg(dev)]
#[tauri::command]
pub async fn read_dir(window: tauri::Window, path: &str) -> Result<(), String> {
    let dir = fs::read_dir(path);
    if let Err(e) = dir {
        return Err(e.to_string());
    }
    let dir = dir.unwrap();
    let mut files: Vec<String> = Vec::new();
    let mut dirs: Vec<String> = Vec::new();

    if let Ok(canonicalized_path) = canonicalize(path) {
        dirs.push(canonicalized_path.to_string_lossy().to_string());

        if let Some(dir_parent) = canonicalized_path.parent() {
            dirs.push(dir_parent.to_string_lossy().to_string());
        }
    }

    for item in dir.into_iter() {
        match item {
            Ok(item) => {
                if let Ok(file_type) = item.file_type() {
                    let item_path = canonicalize(item.path()).unwrap();
                    // let item_path = item.path();
                    if file_type.is_dir() {
                        dirs.push(item_path.to_string_lossy().to_string());
                    } else {
                        files.push(item_path.to_string_lossy().to_string());
                    }
                }
            }
            Err(e) => {
                return Err(e.to_string());
            }
        }
    }

    let _ = window
        .app_handle()
        .emit_to("debug", "set-debug-api-read-dir", vec![dirs, files]);

    return Ok(());
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
        println!("Error: {}", e);
        return Err(());
    }
    Ok(())
}

#[cfg(not(feature = "auth-local-server"))]
#[tauri::command]
pub async fn open_auth_page(_window: tauri::Window) -> Result<(), ()> {
    let result = auth_server::open_auth_page();

    if let Err(e) = result {
        println!("Error: {}", e);
        return Err(());
    }
    Ok(())
}

#[tauri::command]
pub async fn check_pac_server_health(
    _window: tauri::Window,
    pac_channel: tauri::State<'_, PacChannel>,
) -> Result<String, String> {
    match bidirectional_channel::check_health(pac_channel.master.clone()).await {
        Ok(_) => Ok("PAC server is running".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn check_proxy_server_health(
    _window: tauri::Window,
    proxy_channel: tauri::State<'_, ProxyChannel>,
) -> Result<String, String> {
    match bidirectional_channel::check_health(proxy_channel.master.clone()).await {
        Ok(_) => Ok("Proxy server is running".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn launch_with_options(
    window: tauri::Window,
    options: HashMap<String, i32>,
    pac_channel: tauri::State<'_, PacChannel>,
    proxy_channel: tauri::State<'_, ProxyChannel>,
    proxy_log_channel: tauri::State<'_, ProxyLogChannel>,
    response_parse_channel: tauri::State<'_, ResponseParseChannel>,
) -> Result<(), ()> {
    println!("{:?}", options);

    let _proxy_addr = {
        if let Some(&flag) = options.get("run_proxy_server") {
            if flag != 0 {
                if let Some(&server_index) = options.get("server") {
                    let server_address = match server_index {
                        -1 => Some(""),
                        1 => Some("w01y.kancolle-server.com"), // 横須賀鎮守府
                        2 => Some("w02k.kancolle-server.com"), // 新呉鎮守府
                        3 => Some("w03s.kancolle-server.com"), // 佐世保鎮守府
                        4 => Some("w04m.kancolle-server.com"), // 舞鶴鎮守府
                        5 => Some("w05o.kancolle-server.com"), // 大湊警備府
                        6 => Some("w06k.kancolle-server.com"), // トラック泊地
                        7 => Some("w07l.kancolle-server.com"), // リンガ泊地
                        8 => Some("w08r.kancolle-server.com"), // ラバウル基地
                        9 => Some("w09s.kancolle-server.com"), // ショートランド泊地
                        10 => Some("w10b.kancolle-server.com"), // ブイン基地
                        11 => Some("w11t.kancolle-server.com"), // タウイタウイ泊地
                        12 => Some("w12p.kancolle-server.com"), // パラオ泊地
                        13 => Some("w13b.kancolle-server.com"), // ブルネイ泊地
                        14 => Some("w14h.kancolle-server.com"), // 単冠湾泊地
                        15 => Some("w15p.kancolle-server.com"), // 幌筵泊地
                        16 => Some("w16s.kancolle-server.com"), // 宿毛湾泊地
                        17 => Some("w17k.kancolle-server.com"), // 鹿屋基地
                        18 => Some("w18i.kancolle-server.com"), // 岩川基地
                        19 => Some("w19s.kancolle-server.com"), // 佐伯湾泊地
                        20 => Some("w20h.kancolle-server.com"), // 柱島泊地
                        _ => None,
                    };
                    if let Some(server_address) = server_address {
                        #[cfg(dev)]
                        let pac_path = "./../../FUSOU-PROXY/proxy-https/proxy.pac".to_string();
                        #[cfg(any(not(dev), check_release))]
                        let pac_path = ROAMING_DIR
                            .get()
                            .expect("ROAMING_DIR not found")
                            .join("./resources/pac/proxy.pac")
                            .as_path()
                            .to_str()
                            .expect("failed to convert str")
                            .to_string();
                        // let pac_path = window.app_handle().path_resolver().resolve_resource("./resources/pac/proxy.pac").expect("failed to resolve resources/pac/proxy dir").as_path().to_str().expect("failed to convert str").to_string();

                        #[cfg(dev)]
                        let save_path = "./../../FUSOU-PROXY-DATA".to_string();
                        #[cfg(any(not(dev), check_release))]
                        let save_path = window
                            .app_handle()
                            .path()
                            .document_dir()
                            .expect("failed to get doc dirs")
                            .join("FUSOU-PROXY-DATA")
                            .as_path()
                            .to_str()
                            .expect("failed to convert str")
                            .to_string();

                        #[cfg(dev)]
                        let ca_path = "./ca/".to_string();
                        #[cfg(any(not(dev), check_release))]
                        let ca_path = ROAMING_DIR
                            .get()
                            .expect("ROAMING_DIR not found")
                            .join("./resources/ca")
                            .as_path()
                            .to_str()
                            .expect("failed to convert str")
                            .to_string();
                        // let ca_path =  window.app_handle().path_resolver().resolve_resource("./resources/ca").expect("failed to resolve app_local_data_dir").as_path().to_str().expect("failed to convert str").to_string();

                        println!("save address: {}", save_path);
                        println!("ca path: {}", ca_path);
                        println!("pac path: {}", pac_path);

                        let file_prefix = util::get_user_env_id().await;

                        let addr = wrap_proxy::serve_proxy(
                            server_address.to_string(),
                            save_path,
                            pac_path,
                            ca_path,
                            proxy_channel.slave.clone(),
                            proxy_log_channel.master.clone(),
                            pac_channel.slave.clone(),
                            window.app_handle(),
                            Some(file_prefix),
                        );
                        match addr {
                            Ok(addr) => Some(addr),
                            Err(e) => {
                                println!("Error: {}", e);
                                return Err(());
                            }
                        }
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    };

    if let Some(&flag) = options.get("open_app") {
        if flag != 0 {
            json_parser::serve_reponse_parser(
                window.app_handle(),
                response_parse_channel.slave.clone(),
                proxy_log_channel.slave.clone(),
            );
            window
                .get_webview_window("main")
                .expect("no window labeled 'main' found")
                .show()
                .unwrap();
            // let _ = window
            //     .app_handle()
            //     .tray_handle()
            //     .get_item("main-open/close")
            //     .set_title("Close Main Window");
        } else {
            // window
            //     .get_webview_window("main")
            //     .expect("no window labeled 'main' found")
            //     .close()
            //     .unwrap();
            // let _ = window
            //     .app_handle()
            //     .tray_handle()
            //     .get_item("main-open/close")
            //     .set_title("Open Main Window");
        }
    }
    if let Some(&flag) = options.get("open_kancolle") {
        if flag != 0 {
            if let Some(&browse_webview) = options.get("open_kancolle_with_webview") {
                if browse_webview != 0 {
                    create_external_window(window.app_handle(), None, true);
                } else {
                    let browser = SHARED_BROWSER.lock().unwrap().get_browser();
                    create_external_window(window.app_handle(), Some(browser), false);
                }
            }
        }
    }

    return Ok(());
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

//--------------------------------------------------------------

pub fn set_launch_page(app: &AppHandle) {
    let _ = app.emit_to("main", "set-main-page-launch", ());
}
