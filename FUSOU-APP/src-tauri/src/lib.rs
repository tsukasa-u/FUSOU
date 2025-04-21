// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// #![recursion_limit = "256"]

use tauri_plugin_deep_link::DeepLinkExt;

use core::time;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, Url,
};
use tokio::sync::{mpsc, OnceCell};
use webbrowser::open_browser;

mod cmd;
mod database;
mod interface;
mod json_parser;
mod kcapi;
mod kcapi_common;

mod discord;
mod external;
mod google_drive;
mod tauri_cmd;
mod util;
mod wrap_proxy;

mod auth_server;
mod supabase;

#[cfg(dev)]
mod test;

// use proxy::bidirectional_channel::{BidirectionalChannel, StatusInfo};
use proxy_https::bidirectional_channel::{request_shutdown, BidirectionalChannel, StatusInfo};

use crate::external::SHARED_BROWSER;

static RESOURCES_DIR: OnceCell<PathBuf> = OnceCell::const_new();

#[cfg(any(not(dev), check_release))]
static ROAMING_DIR: OnceCell<PathBuf> = OnceCell::const_new();

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

    let auth_bidirectional_channel = BidirectionalChannel::<StatusInfo>::new(1);
    let auth_bidirectional_channel_slave = auth_bidirectional_channel.clone_slave();
    let auth_bidirectional_channel_master = auth_bidirectional_channel.clone_master();

    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

    // let shared_browser = Arc::new(Mutex::new(BrowserState::new()));

    let external_window_size_before = Mutex::new(tauri::PhysicalSize::<u32> {
        width: 1200,
        height: 720,
    });

    // let browser = shared_browser.lock().unwrap().get_browser();

    let manage_pac_channel = wrap_proxy::PacChannel {
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

    let manage_auth_channel = auth_server::AuthChannel {
        // master: auth_bidirectional_channel_master.clone(),
        slave: auth_bidirectional_channel_slave.clone(),
    };

    let ctx = tauri::generate_context!();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    // tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    // tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .build(),
        )
        .manage(manage_pac_channel)
        .manage(manage_proxy_channel)
        .manage(manage_proxy_log_channel)
        .manage(manage_response_parse_channel)
        .manage(manage_auth_channel)
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
            tauri_cmd::set_refresh_token,
            tauri_cmd::open_auth_page,
            #[cfg(dev)]
            tauri_cmd::open_auth_window,
            #[cfg(dev)]
            tauri_cmd::open_debug_window,
            #[cfg(dev)]
            tauri_cmd::close_debug_window,
            #[cfg(dev)]
            tauri_cmd::read_dir,
            #[cfg(dev)]
            tauri_cmd::read_emit_file,
        ])
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        // .plugin(tauri_plugin_devtools::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(
            move |app, argv, _cwd| {
                if let Some(path) = argv.get(1) {
                    let url = Url::parse(path).unwrap();

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
                    if !providrer_refresh_token.is_empty() {
                        let token_type = "Bearer";
                        let _ = google_drive::set_refresh_token(
                            providrer_refresh_token,
                            token_type.to_owned(),
                        );
                    }
                    if !supabase_refresh_token.is_empty() && !supabase_access_token.is_empty() {
                        app.emit_to(
                            "main",
                            "set-supabase-tokens",
                            vec![&supabase_access_token, &supabase_refresh_token],
                        )
                        .unwrap();
                    }
                }

                let singleton_window = app.get_webview_window("main").unwrap();

                singleton_window.show().unwrap();

                if singleton_window.is_minimized().unwrap() {
                    singleton_window.unminimize().unwrap();
                }

                if !singleton_window.is_focused().unwrap() {
                    singleton_window.set_focus().unwrap();
                }

                println!("single instance: {:?}", argv.clone().get(1).unwrap());
            },
        ))
        .setup(move |app| {
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            app.deep_link().register_all()?;

            app.deep_link().on_open_url(|event| {
                dbg!(event.urls());
            });

            #[cfg(dev)]
            RESOURCES_DIR
                .set(PathBuf::from(env!("CARGO_MANIFEST_DIR")))
                .unwrap();
            #[cfg(any(not(dev), check_release))]
            match app.path().resource_dir() {
                Ok(path) => {
                    RESOURCES_DIR.set(path.join("resources")).unwrap();
                }
                Err(e) => return Err(e.into()),
            }

            #[cfg(any(not(dev), check_release))]
            match app.path().app_data_dir() {
                Ok(path) => {
                    ROAMING_DIR.set(path.clone()).unwrap();
                }
                Err(e) => return Err(e.into()),
            }
            let danger_ope_sub_menu_title =
                MenuItemBuilder::with_id("danger-title".to_string(), "Danger Zone")
                    .enabled(false)
                    .build(app)
                    .unwrap();
            let proxy_serve_shutdown = MenuItemBuilder::with_id(
                "proxy-serve-shutdown".to_string(),
                "Shutdown Proxy Server",
            )
            .build(app)
            .unwrap();
            let pac_server_shutdown =
                MenuItemBuilder::with_id("pac-serve-shutdown".to_string(), "Shutdown PAC Server")
                    .build(app)
                    .unwrap();
            let delete_registry =
                MenuItemBuilder::with_id("delete-registry".to_string(), "Delete Registry")
                    .build(app)
                    .unwrap();

            #[cfg(dev)]
            let open_debug_window =
                MenuItemBuilder::with_id("open-debug-window".to_string(), "Open Debug Window")
                    .build(app)
                    .unwrap();

            #[cfg(dev)]
            let open_auth_window =
                MenuItemBuilder::with_id("open-auth-window".to_string(), "Open Auth Window")
                    .build(app)
                    .unwrap();

            #[cfg(dev)]
            let debug_google_drive =
                MenuItemBuilder::with_id("debug-google-drive".to_string(), "Debug Google Drive")
                    .build(app)
                    .unwrap();

            let quit = MenuItemBuilder::with_id("quit".to_string(), "Quit")
                .build(app)
                .unwrap();
            let title = MenuItemBuilder::with_id("title".to_string(), "FUSOU")
                .enabled(false)
                .build(app)
                .unwrap();
            let external_open_close =
                MenuItemBuilder::with_id("external-open/close".to_string(), "Open WebView")
                    .build(app)
                    .unwrap();
            let main_open_close =
                MenuItemBuilder::with_id("main-open/close".to_string(), "Open Main Window")
                    .build(app)
                    .unwrap();
            let visit_website =
                MenuItemBuilder::with_id("visit-website".to_string(), "Visit Website")
                    .build(app)
                    .unwrap();
            let open_launch_page =
                MenuItemBuilder::with_id("open-launch-page".to_string(), "Open Launch Page")
                    .build(app)
                    .unwrap();

            let danger_ope_sub_menu = SubmenuBuilder::new(app, "Danger Zone")
                .item(&danger_ope_sub_menu_title)
                .item(&proxy_serve_shutdown)
                .item(&pac_server_shutdown)
                .item(&delete_registry);

            #[cfg(dev)]
            let danger_ope_sub_menu = danger_ope_sub_menu
                .separator()
                .item(&open_debug_window)
                .item(&open_auth_window)
                .item(&debug_google_drive);

            let danger_ope_sub_menu = danger_ope_sub_menu.build().unwrap();

            let adavanced_title =
                MenuItemBuilder::with_id("advanced-title".to_string(), "Advanced")
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

            let _system_tray = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("FUSOU")
                // .icon(tauri::image::Image::new(
                //     include_bytes!("../icons/128x128.png"),
                //     128,
                //     128,
                // ))
                .icon_as_template(false)
                .title("fusou-system-tray")
                .show_menu_on_left_click(true)
                .icon(app.default_window_icon().unwrap().clone())
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
                        #[cfg(dev)]
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
                        #[cfg(dev)]
                        "open-auth-window" => match tray.get_webview_window("auth") {
                            Some(debug_window) => {
                                debug_window.show().unwrap();
                            }
                            None => {
                                let _window = tauri::WebviewWindowBuilder::new(
                                    tray.app_handle(),
                                    "auth",
                                    tauri::WebviewUrl::App("/auth".into()),
                                )
                                .fullscreen(false)
                                .title("fusou-auth")
                                .build()
                                .unwrap();
                            }
                        },
                        #[cfg(dev)]
                        "debug-google-drive" => {
                            println!("debug-google-drive");
                            test::test();
                        }
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
                            let _ = main_open_close.set_enabled(false);
                            let _ = quit.set_enabled(false);
                            let _ = adavanced_title.set_enabled(false);

                            cmd::remove_pac(tray.app_handle());

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
                                    crate::external::create_external_window(
                                        tray.app_handle(),
                                        None,
                                        true,
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
            let auth_bidirectional_channel_master_clone = auth_bidirectional_channel_master.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = shutdown_rx.recv().await;
                // is it needed to add select! for timeout?
                let _ = tokio::join!(
                    request_shutdown(proxy_bidirectional_channel_master_clone),
                    request_shutdown(pac_bidirectional_channel_master_clone),
                    request_shutdown(response_parse_channel_master_clone),
                    request_shutdown(auth_bidirectional_channel_master_clone),
                );

                tokio::time::sleep(time::Duration::from_millis(2000)).await;
                app_handle.cleanup_before_exit();
                app_handle.exit(0_i32);
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
