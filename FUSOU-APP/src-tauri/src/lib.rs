// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// #![recursion_limit = "256"]

// use arboard::Clipboard;
use core::time;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Url,
};
use tokio::sync::{mpsc, OnceCell};
use webbrowser::open_browser;

mod cmd;
mod interface;
mod json_parser;
mod kcapi;
mod kcapi_common;

mod discord;
mod external;
mod tauri_cmd;
mod util;
mod wrap_proxy;

// use proxy::bidirectional_channel::{BidirectionalChannel, StatusInfo};
use proxy_https::bidirectional_channel::{request_shutdown, BidirectionalChannel, StatusInfo};

use crate::external::SHARED_BROWSER;

static RESOURCES_DIR: OnceCell<PathBuf> = OnceCell::const_new();

#[cfg(TAURI_BUILD_TYPE = "RELEASE")]
static ROAMING_DIR: OnceCell<PathBuf> = OnceCell::const_new();

static PROXY_ADDRESS: OnceCell<Url> = OnceCell::const_new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let proxy_bidirectional_channel = BidirectionalChannel::<StatusInfo>::new(1);
    let proxy_bidirectional_channel_slave = proxy_bidirectional_channel.clone_slave();
    let proxy_bidirectional_channel_master = proxy_bidirectional_channel.clone_master();

    let pac_bidirectional_channel = BidirectionalChannel::<StatusInfo>::new(1);
    let pac_bidirectional_channel_slave = pac_bidirectional_channel.clone_slave();
    let pac_bidirectional_channel_master = pac_bidirectional_channel.clone_master();

    let proxy_log_bidirectional_channel = BidirectionalChannel::<StatusInfo>::new(1);
    let proxy_log_bidirectional_channel_slave = proxy_log_bidirectional_channel.clone_slave();
    let proxy_log_bidirectional_channel_master = proxy_log_bidirectional_channel.clone_master();

    let response_parse_channel = BidirectionalChannel::<StatusInfo>::new(1);
    let response_parse_channel_slave = response_parse_channel.clone_slave();
    let response_parse_channel_master = response_parse_channel.clone_master();

    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

    // let shared_browser = Arc::new(Mutex::new(BrowserState::new()));

    let external_window_size_before = Mutex::new(tauri::PhysicalSize::<u32> {
        width: 1200,
        height: 720,
    });

    // let browser = shared_browser.lock().unwrap().get_browser();

    let manege_pac_channel = wrap_proxy::PacChannel {
        master: pac_bidirectional_channel_master.clone(),
        slave: pac_bidirectional_channel_slave.clone(),
    };

    let manage_proxy_channel = wrap_proxy::ProxyChannel {
        master: proxy_bidirectional_channel_master.clone(),
        slave: proxy_bidirectional_channel_slave.clone(),
    };

    let manage_proxy_log_channel = wrap_proxy::ProxyLogChannel {
        master: proxy_log_bidirectional_channel_master.clone(),
        slave: proxy_log_bidirectional_channel_slave.clone(),
    };

    let manage_response_parse_channel = wrap_proxy::ResponseParseChannel {
        // master: response_parse_channel_master.clone(),
        slave: response_parse_channel_slave.clone(),
    };

    let mut ctx = tauri::generate_context!();

    tauri::Builder::default()
        .manage(manege_pac_channel)
        .manage(manage_proxy_channel)
        .manage(manage_proxy_log_channel)
        .manage(manage_response_parse_channel)
        .invoke_handler(tauri::generate_handler![
            // tauri_cmd::close_splashscreen,
            // tauri_cmd::show_splashscreen,
            tauri_cmd::get_mst_ships,
            tauri_cmd::get_mst_slot_items,
            tauri_cmd::get_slot_items,
            tauri_cmd::get_mst_equip_exslot_ships,
            tauri_cmd::get_mst_slotitem_equip_types,
            tauri_cmd::get_mst_equip_ships,
            tauri_cmd::get_mst_stypes,
            tauri_cmd::get_mst_useitems,
            tauri_cmd::launch_with_options,
            tauri_cmd::check_pac_server_health,
            tauri_cmd::check_proxy_server_health,
            tauri_cmd::open_debug_window,
            tauri_cmd::close_debug_window,
            tauri_cmd::read_dir,
            tauri_cmd::read_emit_file,
        ])
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            #[cfg(TAURI_BUILD_TYPE = "DEBUG")]
            RESOURCES_DIR
                .set(PathBuf::from(env!("CARGO_MANIFEST_DIR")))
                .unwrap();
            #[cfg(TAURI_BUILD_TYPE = "RELEASE")]
            match app.path_resolver().resource_dir() {
                Some(path) => {
                    RESOURCES_DIR.set(path.join("resources")).unwrap();
                    println!(
                        "app_local_data_dir: {:?}",
                        app.path_resolver().app_local_data_dir()
                    );
                    println!("app_cache_dir: {:?}", app.path_resolver().app_cache_dir());
                    println!("app_data_dir: {:?}", app.path_resolver().app_data_dir());
                    println!("app_log_dir: {:?}", app.path_resolver().app_log_dir());
                    println!("app_config_dir: {:?}", app.path_resolver().app_config_dir());
                    println!("resource_dir: {:?}", app.path_resolver().resource_dir());
                }
                None => return Err("Failed to get app data directory".into()),
            }

            #[cfg(TAURI_BUILD_TYPE = "RELEASE")]
            match app.path_resolver().app_data_dir() {
                Some(path) => {
                    ROAMING_DIR.set(path.clone()).unwrap();
                }
                None => return Err("Failed to get app data directory".into()),
            }
            let danger_ope_sub_menu_title =
                MenuItemBuilder::with_id("danger-title".to_string(), "Danger Zone".to_string())
                    .enabled(false)
                    .build(app)
                    .unwrap();
            let proxy_serve_shutdown = MenuItemBuilder::with_id(
                "proxy-serve-shutdown".to_string(),
                "Shutdown Proxy Server".to_string(),
            )
            .build(app)
            .unwrap();
            let pac_server_shutdown = MenuItemBuilder::with_id(
                "pac-serve-shutdown".to_string(),
                "Shutdown PAC Server".to_string(),
            )
            .build(app)
            .unwrap();
            let delete_registry = MenuItemBuilder::with_id(
                "delete-registry".to_string(),
                "Delete Registry".to_string(),
            )
            .build(app)
            .unwrap();

            #[cfg(TAURI_BUILD_TYPE = "DEBUG")]
            let open_debug_window = MenuItemBuilder::with_id(
                "open-debug-window".to_string(),
                "Open Debug Window".to_string(),
            )
            .build(app)
            .unwrap();

            let quit = MenuItemBuilder::with_id("quit".to_string(), "Quit".to_string())
                .build(app)
                .unwrap();
            let title = MenuItemBuilder::with_id("title".to_string(), "FUSOU".to_string())
                .enabled(false)
                .build(app)
                .unwrap();
            let external_open_close = MenuItemBuilder::with_id(
                "external-open/close".to_string(),
                "Open WebView".to_string(),
            )
            .build(app)
            .unwrap();
            let main_open_close = MenuItemBuilder::with_id(
                "main-open/close".to_string(),
                "Open Main Window".to_string(),
            )
            .build(app)
            .unwrap();
            let visit_website =
                MenuItemBuilder::with_id("visit-website".to_string(), "Visit Website".to_string())
                    .build(app)
                    .unwrap();
            let open_launch_page = MenuItemBuilder::with_id(
                "open-launch-page".to_string(),
                "Open Launch Page".to_string(),
            )
            .build(app)
            .unwrap();

            let danger_ope_sub_menu = SubmenuBuilder::new(app, "Danger Zone")
                .item(&danger_ope_sub_menu_title)
                .item(&proxy_serve_shutdown)
                .item(&pac_server_shutdown)
                .item(&delete_registry);

            #[cfg(TAURI_BUILD_TYPE = "DEBUG")]
            let danger_ope_sub_menu = danger_ope_sub_menu.separator().item(&open_debug_window);

            let danger_ope_sub_menu = danger_ope_sub_menu.build().unwrap();

            let adavanced_title =
                MenuItemBuilder::with_id("advanced-title".to_string(), "Advanced".to_string())
                    .enabled(false)
                    .build(app)
                    .unwrap();

            let advanced_sub_menu = SubmenuBuilder::new(app, "Adavanced")
                // .item(&adavanced_title)
                // .separator()
                .item(&danger_ope_sub_menu)
                .build()
                .unwrap();

            let tray_menu = MenuBuilder::new(app)
                .item(&title)
                .separator()
                .item(&visit_website)
                .item(&main_open_close)
                .item(&external_open_close)
                .item(&open_launch_page)
                .separator()
                .item(&advanced_sub_menu)
                .separator()
                .item(&quit)
                .build()
                .unwrap();

            let system_tray = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("FUSOU")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        // if let Some(webview_window) = app.get_webview_window("main") {
                        //     let _ = webview_window.show();
                        //     let _ = webview_window.set_focus();
                        // }
                        let window = app.get_webview_window("main");
                        match window {
                            Some(window) => {
                                if let Ok(false) = window.is_visible() {
                                    window.show().unwrap();
                                }
                            }
                            None => {
                                let _window = tauri::WebviewWindowBuilder::new(
                                    app,
                                    "main",
                                    tauri::WebviewUrl::App("index.html".into()),
                                )
                                .title("fusou-app")
                                .build()
                                .unwrap();
                            }
                        }

                        println!("system tray received a left click");
                    }
                })
                .on_menu_event(move |tray, event| {
                    match event.id().as_ref() {
                        #[cfg(TAURI_BUILD_TYPE = "DEBUG")]
                        "open-debug-window" => match tray.get_webview_window("debug") {
                            Some(debug_window) => {
                                debug_window.show().unwrap();
                            }
                            None => {
                                let _window = tauri::WebviewWindowBuilder::new(
                                    tray.app_handle(),
                                    "debug",
                                    tauri::WebviewUrl::App("/debug".into()),
                                )
                                .fullscreen(false)
                                .title("fusou-debug")
                                .build()
                                .unwrap();
                            }
                        },
                        "proxy-serve-shutdown" => {}
                        "quit" => {
                            if let Some(window) = tray.get_webview_window("main") {
                                if let Ok(visible) = window.is_visible() {
                                    if visible {
                                        tray.get_webview_window("main")
                                            .expect("no window labeled 'main' found")
                                            .hide()
                                            .unwrap();
                                    }
                                }
                            }

                            if let Some(window) = tray.get_webview_window("external") {
                                if let Ok(visible) = window.is_visible() {
                                    if visible {
                                        tray.get_webview_window("external")
                                            .expect("no window labeled 'external' found")
                                            .hide()
                                            .unwrap();
                                    }
                                }
                            }

                            // let _ = app
                            //     .tray_handle()
                            //     .get_item("main-open/close")
                            //     .set_enabled(false);
                            // let _ = app.tray_handle().get_item("quit").set_enabled(false);
                            // let _ = app
                            //     .tray_handle()
                            //     .get_item("advanced-title")
                            //     .set_enabled(false);
                            main_open_close.set_enabled(false);
                            quit.set_enabled(false);
                            adavanced_title.set_enabled(false);

                            cmd::remove_pac();

                            // discord::close();

                            let shutdown_tx_clone = shutdown_tx.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = shutdown_tx_clone.send(()).await;
                            });
                        }
                        "visit-website" => {
                            let browser = SHARED_BROWSER.lock().unwrap().get_browser();
                            let _ = open_browser(browser, "https://github.com/tsukasa-u").is_ok();
                        }
                        "open-launch-page" => {
                            let window = tray.get_webview_window("main");
                            match window {
                                Some(window) => {
                                    if let Ok(false) = window.is_visible() {
                                        window.show().unwrap();
                                    }
                                    tauri_cmd::set_launch_page(tray.app_handle());
                                }
                                None => {
                                    let _window = tauri::WebviewWindowBuilder::new(
                                        tray.app_handle(),
                                        "main",
                                        tauri::WebviewUrl::App("index.html".into()),
                                    )
                                    .title("fusou-app")
                                    .build()
                                    .unwrap();
                                }
                            }
                        }
                        "main-open/close" => {
                            let window = tray.get_webview_window("main");
                            match window {
                                Some(window) => match window.is_visible() {
                                    Ok(true) => {
                                        // window.hide().unwrap();
                                        // // let _ = app
                                        // //     .tray_handle()
                                        // //     .get_item("main-open/close")
                                        // //     .set_title("Open Main Window");
                                        // main_open_close.set_text("Open Main Window");
                                    }
                                    Ok(false) => {
                                        window.show().unwrap();
                                        // // let _ = app
                                        // //     .tray_handle()
                                        // //     .get_item("main-open/close")
                                        // //     .set_title("Close Main Window");
                                        // main_open_close.set_text("Close Main Window");
                                    }
                                    _ => {}
                                },
                                None => {
                                    let _window = tauri::WebviewWindowBuilder::new(
                                        tray.app_handle(),
                                        "main",
                                        tauri::WebviewUrl::App("index.html".into()),
                                    )
                                    .title("fusou-app")
                                    .build()
                                    .unwrap();
                                    // // let _ = app
                                    // //     .tray_handle()
                                    // //     .get_item("main-open/close")
                                    // //     .set_title("Close Main Window");
                                    // main_open_close.set_text("Close Main Window");
                                }
                            }
                        }
                        "external-open/close" => {
                            let window = tray.get_webview_window("external");
                            match window {
                                Some(window) => match window.is_visible() {
                                    Ok(true) => {
                                        // window.hide().unwrap();
                                        // // let _ = app
                                        // //     .tray_handle()
                                        // //     .get_item("external-open/close")
                                        // //     .set_title("Open WebView");
                                        // external_open_close.set_text("Open WebView");
                                    }
                                    Ok(false) => {
                                        window.show().unwrap();
                                        // // let _ = app
                                        // //     .tray_handle()
                                        // //     .get_item("external-open/close")
                                        // //     .set_title("Close WebView");
                                        // external_open_close.set_text("Close WebView");
                                    }
                                    _ => {}
                                },
                                None => {
                                    let proxy_addr = PROXY_ADDRESS.get().map(|addr| addr.clone());
                                    crate::external::create_external_window(
                                        tray.app_handle(),
                                        None,
                                        true,
                                        proxy_addr,
                                    );
                                    // // let _ = app
                                    // //     .tray_handle()
                                    // //     .get_item("external-open/close")
                                    // //     .set_title("Close WebView");
                                    // external_open_close.set_text("Close WebView");
                                }
                            }
                        }
                        _ => {}
                    }
                })
                .build(app)
                .unwrap();

            // discord::connect();
            // // discord::set_activity("experimental implementation", "playing KanColle with FUSOU");
            // discord::set_activity_button("experimental implementation", "playing KanColle with FUSOU", "Visit GitHub Repository", "https://github.com/tsukasa-u/FUSOU");

            let proxy_bidirectional_channel_master_clone =
                proxy_bidirectional_channel_master.clone();
            let pac_bidirectional_channel_master_clone = pac_bidirectional_channel_master.clone();
            let response_parse_channel_master_clone = response_parse_channel_master.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = shutdown_rx.recv().await;
                // is it needed to add select! for timeout?
                let _ = tokio::join!(
                    request_shutdown(proxy_bidirectional_channel_master_clone),
                    request_shutdown(pac_bidirectional_channel_master_clone),
                    request_shutdown(response_parse_channel_master_clone),
                );

                tokio::time::sleep(time::Duration::from_millis(2000)).await;
                app_handle.exit(0_i32);
                // app.handle().exit(0_i32);
            });
            return Ok(());
        })
        .on_window_event(move |window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => match window.label() {
                "main" => {
                    window.hide().unwrap();
                    api.prevent_close();
                }
                "external" => {
                    window.close().unwrap();
                }
                "debug" => {
                    window.close().unwrap();
                }
                _ => {}
            },
            tauri::WindowEvent::Resized(size) => {
                if window.label().eq("external") {
                    if let Ok(is_maximized) = window.is_maximized() {
                        if is_maximized {
                            external_window_size_before.lock().unwrap().height = size.height;
                            external_window_size_before.lock().unwrap().width = size.width;
                            return;
                        }
                    }
                    if let Ok(is_minimized) = window.is_minimized() {
                        if is_minimized {
                            return;
                        }
                    }

                    if size.width != external_window_size_before.lock().unwrap().width {
                        external_window_size_before.lock().unwrap().width = size.width;
                        external_window_size_before.lock().unwrap().height =
                            size.width * 712 / 1192;
                    } else {
                        external_window_size_before.lock().unwrap().width =
                            size.height * 1192 / 712;
                        external_window_size_before.lock().unwrap().height = size.height;
                    }

                    let _ = window.set_size(*external_window_size_before.lock().unwrap());
                }
            }
            _ => {}
        })
        .run(ctx)
        .expect("error while building tauri application");
}
