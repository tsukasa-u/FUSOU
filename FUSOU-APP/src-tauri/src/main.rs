// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// #![recursion_limit = "256"]

use arboard::Clipboard;
use core::time;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Mutex;
use tauri::{AppHandle, CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu};
use tokio::sync::{mpsc, OnceCell};
use webbrowser::{open_browser, Browser};

mod cmd;
mod interface;
mod json_parser;
mod kcapi;
mod kcapi_common;
mod notification;

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

#[tokio::main]
async fn main() -> ExitCode {
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

    let proxy_serve_shutdown: CustomMenuItem = CustomMenuItem::new(
        "proxy-serve-shutdown".to_string(),
        "Shutdown Proxy Server".to_string(),
    );
    let gprc_serve_shutdown: CustomMenuItem = CustomMenuItem::new(
        "gprc-serve-shutdown".to_string(),
        "Shutdown gRPC Server".to_string(),
    )
    .disabled();
    let pac_server_shutdown: CustomMenuItem = CustomMenuItem::new(
        "pac-serve-shutdown".to_string(),
        "Shutdown PAC Server".to_string(),
    );
    let delete_registry: CustomMenuItem =
        CustomMenuItem::new("delete-registry".to_string(), "Delete Registry".to_string());

    #[cfg(TAURI_BUILD_TYPE = "DEBUG")]
    let open_debug_window: CustomMenuItem = CustomMenuItem::new(
        "open-debug-window".to_string(),
        "Open Debug Window".to_string(),
    );

    // let restart_proxy: CustomMenuItem = CustomMenuItem::new("restart-proxy".to_string(), "Restart Proxy Server".to_string());

    let quit: CustomMenuItem = CustomMenuItem::new("quit".to_string(), "Quit".to_string())
        .accelerator("CmdOrCtrl+Q".to_string());
    let pause: CustomMenuItem =
        CustomMenuItem::new("pause".to_string(), "Pause".to_string()).selected();
    let title: CustomMenuItem =
        CustomMenuItem::new("title".to_string(), "FUSOU".to_string()).disabled();
    let external_open_close: CustomMenuItem = CustomMenuItem::new(
        "external-open/close".to_string(),
        "Open WebView".to_string(),
    );
    let main_open_close: CustomMenuItem = CustomMenuItem::new(
        "main-open/close".to_string(),
        "Open Main Window".to_string(),
    );
    let visit_website: CustomMenuItem =
        CustomMenuItem::new("visit-website".to_string(), "Visit Website".to_string());
    let open_launch_page: CustomMenuItem = CustomMenuItem::new(
        "open-launch-page".to_string(),
        "Open Launch Page".to_string(),
    );

    let browser_sub_menu: SystemTrayMenu = SystemTrayMenu::new()
        .add_item(
            CustomMenuItem::new("select-default".to_string(), "Default".to_string()).selected(),
        )
        .add_item(
            CustomMenuItem::new("select-firefox".to_string(), "Firefox".to_string()).disabled(),
        )
        .add_item(CustomMenuItem::new("select-chrome".to_string(), "Chrome".to_string()).disabled())
        .add_item(CustomMenuItem::new("select-opera".to_string(), "Opera".to_string()).disabled())
        .add_native_item(tauri::SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new(
            "copy-url".to_string(),
            "Copy URL".to_string(),
        ));

    let danger_ope_sub_menu: SystemTrayMenu = SystemTrayMenu::new()
        .add_item(
            CustomMenuItem::new("danger-title".to_string(), "Danger Zone".to_string()).disabled(),
        )
        .add_item(proxy_serve_shutdown)
        .add_item(gprc_serve_shutdown)
        .add_item(pac_server_shutdown)
        .add_item(delete_registry);

    #[cfg(TAURI_BUILD_TYPE = "DEBUG")]
    let danger_ope_sub_menu = danger_ope_sub_menu
        .add_native_item(tauri::SystemTrayMenuItem::Separator)
        .add_item(open_debug_window);

    let advanced_sub_menu: SystemTrayMenu = SystemTrayMenu::new()
        .add_item(
            CustomMenuItem::new("advanced-title".to_string(), "Advanced".to_string()).disabled(),
        )
        .add_native_item(tauri::SystemTrayMenuItem::Separator)
        .add_submenu(tauri::SystemTraySubmenu::new(
            "Select browser".to_string(),
            browser_sub_menu,
        ))
        .add_submenu(tauri::SystemTraySubmenu::new(
            "Danger Zone".to_string(),
            danger_ope_sub_menu,
        ));

    let tray_menu = SystemTrayMenu::new()
        .add_item(title)
        .add_native_item(tauri::SystemTrayMenuItem::Separator)
        .add_item(visit_website)
        .add_item(main_open_close)
        .add_item(external_open_close)
        .add_item(open_launch_page)
        .add_native_item(tauri::SystemTrayMenuItem::Separator)
        .add_submenu(tauri::SystemTraySubmenu::new(
            "Advanced".to_string(),
            advanced_sub_menu,
        ))
        .add_native_item(tauri::SystemTrayMenuItem::Separator)
        .add_item(pause)
        .add_item(quit);

    let system_tray = SystemTray::new().with_menu(tray_menu).with_tooltip("FUSOU");

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

            // create_external_window(&app, browser);
            // let _window = app.get_window("main").unwrap().close().unwrap();

            // start proxy server
            // let save_path = "./../../FUSOU-PROXY-DATA".to_string();
            // let proxy_addr = proxy::proxy_server::serve_proxy(proxy_target.to_string(), 0, proxy_bidirectional_channel_slave, proxy_log_bidirectional_channel_master, save_path);

            // if proxy_addr.is_err() {
            //   return Err("Failed to start proxy server".into());
            // }

            // // start pac server
            // let pac_addr = proxy::pac_server::serve_pac_file(pac_path.clone(), 0, pac_bidirectional_channel_slave);

            // if pac_addr.is_err() {
            //   return Err("Failed to start pac server".into());
            // }

            // proxy::edit_pac::edit_pac(&pac_path, proxy_addr.unwrap().to_string().as_str());

            // cmd_pac_tauri::add_pac(&format!("http://localhost:{}/proxy.pac", pac_addr.unwrap().port()));

            // json_parser::serve_reponse_parser(&app.handle(), response_parse_channel_slave, proxy_log_bidirectional_channel_slave);

            // discord::connect();
            // // discord::set_activity("experimental implementation", "playing KanColle with FUSOU");
            // discord::set_activity_button("experimental implementation", "playing KanColle with FUSOU", "Visit GitHub Repository", "https://github.com/tsukasa-u/FUSOU");

            let proxy_bidirectional_channel_master_clone =
                proxy_bidirectional_channel_master.clone();
            let pac_bidirectional_channel_master_clone = pac_bidirectional_channel_master.clone();
            let response_parse_channel_master_clone = response_parse_channel_master.clone();
            let app_handle = app.handle();
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
            });
            return Ok(());
        })
        .system_tray(system_tray)
        // .on_page_load(|window, _ | {
        //   let _ = window.app_handle().tray_handle().get_item("open").set_title("close");
        // })
        .on_window_event(move |event| match event.event() {
            tauri::WindowEvent::CloseRequested { .. } => {
                let _ = event
                    .window()
                    .app_handle()
                    .tray_handle()
                    .get_item("main-open/close")
                    .set_title("Open Main Window");
            }
            tauri::WindowEvent::Resized(size) => {
                if event.window().label().eq("external") {
                    if let Ok(is_maximized) = event.window().is_maximized() {
                        if is_maximized {
                            external_window_size_before.lock().unwrap().height = size.height;
                            external_window_size_before.lock().unwrap().width = size.width;
                            return;
                        }
                    }
                    if let Ok(is_minimized) = event.window().is_minimized() {
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

                    let _ = event
                        .window()
                        .set_size(*external_window_size_before.lock().unwrap());
                }
            }
            _ => {}
        })
        .on_system_tray_event(move |app: &AppHandle, event: SystemTrayEvent| match event {
            SystemTrayEvent::LeftClick {
                position: _,
                size: _,
                ..
            } => {
                // notification::wrap_notification(app, notification::NotificationContent::default());

                let window = app.get_window("main");
                match window {
                    Some(window) => if let Ok(false) = window.is_visible() {
                        window.show().unwrap();
                        let _ = app
                            .tray_handle()
                            .get_item("main-open/close")
                            .set_title("Close Main Window");
                    },
                    None => {
                        let _window = tauri::WindowBuilder::new(
                            app,
                            "main",
                            tauri::WindowUrl::App("index.html".into()),
                        )
                        .title("fusou-app")
                        .build()
                        .unwrap();
                        let _ = app
                            .tray_handle()
                            .get_item("main-open/close")
                            .set_title("Close Main Window");
                    }
                }

                println!("system tray received a left click");
            }
            SystemTrayEvent::RightClick {
                position: _,
                size: _,
                ..
            } => {
                println!("system tray received a right click");
            }
            SystemTrayEvent::DoubleClick {
                position: _,
                size: _,
                ..
            } => {
                println!("system tray received a double click");
            }
            SystemTrayEvent::MenuItemClick { id, .. } => {
                match id.as_str() {
                    #[cfg(TAURI_BUILD_TYPE = "DEBUG")]
                    "open-debug-window" => {
                        match app.get_window("debug") {
                            Some(debug_window) => {
                                debug_window.show().unwrap();
                            }
                            None => {
                                let _window = tauri::WindowBuilder::new(
                                    app,
                                    "debug",
                                    tauri::WindowUrl::App("/debug".into()),
                                )
                                .fullscreen(false)
                                .title("fusou-debug")
                                // .visible(false)
                                .build()
                                .unwrap();
                            }
                        }
                    }
                    "gprc-serve-shutdown" => {
                        let _ = app.tray_handle().get_item("pause").set_title("Pause");
                        let _ = app.tray_handle().get_item("pause").set_enabled(false);
                        // gprc_server::gprc_stop_with_thread(wg.clone(), tx_master_gprc.clone());
                        // let _ = app.tray_handle().get_item("gprc-serve-shutdown").set_title("Shutdown gRPC Server");
                        // let _ = app.tray_handle().get_item("proxy-serve-shutdown").set_title("Shutdown Proxy Server");
                    }
                    "proxy-serve-shutdown" => {
                        let _ = app.tray_handle().get_item("pause").set_title("Pause");
                        let _ = app.tray_handle().get_item("pause").set_enabled(false);
                        // let _ = app.tray_handle().get_item("gprc-serve-shutdown").set_title("Shutdown gRPC Server");
                        // let _ = app.tray_handle().get_item("proxy-serve-shutdown").set_title("Shutdown Proxy Server");
                    }
                    "quit" => {
                        // let pac_bidirectional_channel_master_clone = pac_bidirectional_channel_master.clone();
                        // let proxy_bidirectional_channel_master_clone = proxy_bidirectional_channel_master.clone();
                        if let Some(window) = app.get_window("main") {
                            if let Ok(visible) = window.is_visible() {
                                if visible {
                                    app
                                        .get_window("main")
                                        .expect("no window labeled 'main' found")
                                        .hide()
                                        .unwrap();
                                }
                            }
                        }

                        if let Some(window) = app.get_window("external") {
                            if let Ok(visible) = window.is_visible() {
                                if visible {
                                    app
                                        .get_window("external")
                                        .expect("no window labeled 'external' found")
                                        .hide()
                                        .unwrap();
                                }
                            }
                        }

                        let _ = app
                            .tray_handle()
                            .get_item("main-open/close")
                            .set_enabled(false);
                        let _ = app.tray_handle().get_item("quit").set_enabled(false);
                        let _ = app.tray_handle().get_item("pause").set_enabled(false);
                        let _ = app
                            .tray_handle()
                            .get_item("advanced-title")
                            .set_enabled(false);

                        cmd::remove_pac();

                        // discord::close();

                        let shutdown_tx_clone = shutdown_tx.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = shutdown_tx_clone.send(()).await;
                        });
                    }
                    "copy-url" => {
                        let mut clipboard = Clipboard::new().unwrap();
                        clipboard.set_text("https://github.com/tsukasa-u").unwrap();
                    }
                    "visit-website" => {
                        let browser = SHARED_BROWSER.lock().unwrap().get_browser();
                        let _ = open_browser(browser, "https://github.com/tsukasa-u").is_ok();
                    }
                    "open-launch-page" => {
                        let window = app.get_window("main");
                        match window {
                            Some(window) => {
                                if let Ok(false) = window.is_visible() {
                                    window.show().unwrap();
                                }
                                tauri_cmd::set_launch_page(app);
                            }
                            None => {
                                let _window = tauri::WindowBuilder::new(
                                    app,
                                    "main",
                                    tauri::WindowUrl::App("index.html".into()),
                                )
                                .title("fusou-app")
                                .build()
                                .unwrap();
                            }
                        }
                    }
                    "main-open/close" => {
                        let window = app.get_window("main");
                        match window {
                            Some(window) => match window.is_visible() {
                                Ok(true) => {
                                    window.hide().unwrap();
                                    let _ = app
                                        .tray_handle()
                                        .get_item("main-open/close")
                                        .set_title("Open Main Window");
                                }
                                Ok(false) => {
                                    window.show().unwrap();
                                    let _ = app
                                        .tray_handle()
                                        .get_item("main-open/close")
                                        .set_title("Close Main Window");
                                }
                                _ => {}
                            },
                            None => {
                                let _window = tauri::WindowBuilder::new(
                                    app,
                                    "main",
                                    tauri::WindowUrl::App("index.html".into()),
                                )
                                .title("fusou-app")
                                .build()
                                .unwrap();
                                let _ = app
                                    .tray_handle()
                                    .get_item("main-open/close")
                                    .set_title("Close Main Window");
                            }
                        }
                    }
                    "external-open/close" => {
                        let window = app.get_window("external");
                        match window {
                            Some(window) => match window.is_visible() {
                                Ok(true) => {
                                    window.hide().unwrap();
                                    let _ = app
                                        .tray_handle()
                                        .get_item("external-open/close")
                                        .set_title("Open WebView");
                                }
                                Ok(false) => {
                                    window.show().unwrap();
                                    let _ = app
                                        .tray_handle()
                                        .get_item("external-open/close")
                                        .set_title("Close WebView");
                                }
                                _ => {}
                            },
                            None => {
                                // let _window = tauri::WindowBuilder::new(app, "main", tauri::WindowUrl::App("index.html".into()))
                                //   .build()
                                //   .unwrap();
                                crate::external::create_external_window(app, None, true);
                                let _ = app
                                    .tray_handle()
                                    .get_item("external-open/close")
                                    .set_title("Close WebView");
                            }
                        }
                    }
                    _ => {
                        let submenu: Vec<&str> = id.as_str().split("-").collect();
                        if let Some(&"sm1") = submenu.first() {
                            ["default", "firefox", "chrome", "opera"]
                                .iter()
                                .for_each(|&item| {
                                    // return true if the selecte menu tile match the current item in the vec!["default", "firefox", "chrome", "opera"]
                                    let _ = app
                                        .tray_handle()
                                        .get_item(&format!("select-{}", item))
                                        .set_selected(submenu.get(1).unwrap().eq(&item));
                                });

                            let mut browser = SHARED_BROWSER.lock().unwrap();
                            browser.set_browser(
                                &(match submenu.get(1) {
                                    Some(&"default") => Browser::default().to_owned(),
                                    Some(&"firefox") => Browser::Firefox.to_owned(),
                                    Some(&"chrome") => Browser::Chrome.to_owned(),
                                    Some(&"opera") => Browser::Opera.to_owned(),
                                    _ => Browser::default().to_owned(),
                                }),
                            );
                        }
                    }
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                api.prevent_exit();
            }
            tauri::RunEvent::Exit => {
                println!("exit");
            }
            _ => {}
        });

    // wg.wait().await;

    return ExitCode::SUCCESS;
}
