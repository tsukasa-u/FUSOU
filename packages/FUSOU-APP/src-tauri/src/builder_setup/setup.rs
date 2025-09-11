#[cfg(dev)]
use std::path::PathBuf;
use std::{fs, sync::Mutex, time};

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::mpsc;

use crate::{
    builder_setup::bidirectional_channel::{
        get_pac_bidirectional_channel, get_proxy_bidirectional_channel,
        get_response_parse_bidirectional_channel,
    },
    cmd::{native_cmd, tauri_cmd},
    integration::discord,
    util::{get_RESOURCES_DIR, get_ROAMING_DIR},
    window::{app, external},
};
use proxy_https::bidirectional_channel::request_shutdown;

#[cfg(any(not(dev), check_release))]
use crate::builder_setup::updater::setup_updater;

use crate::RESOURCES_DIR;
use crate::ROAMING_DIR;

fn setup_deep_link(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
    app.deep_link().register_all()?;

    app.deep_link().on_open_url(|event| {
        dbg!(event.urls());
    });
    Ok(())
}

fn set_paths(
    #[allow(unused_variables)] app: &mut tauri::App,
) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(dev)]
    RESOURCES_DIR
        .set(Mutex::new(PathBuf::from(format!(
            "{}/resources",
            env!("CARGO_MANIFEST_DIR")
        ))))
        .unwrap();

    #[cfg(any(not(dev), check_release))]
    match app.path().resource_dir() {
        Ok(path) => {
            RESOURCES_DIR
                .set(Mutex::new(path.join("resources")))
                .unwrap();
        }
        Err(e) => return Err(e.into()),
    }

    #[cfg(dev)]
    ROAMING_DIR
        .set(Mutex::new(PathBuf::from(format!(
            "{}/roaming",
            env!("CARGO_MANIFEST_DIR")
        ))))
        .unwrap();

    #[cfg(any(not(dev), check_release))]
    match app.path().app_data_dir() {
        Ok(path) => {
            ROAMING_DIR.set(Mutex::new(path.clone())).unwrap();
        }
        Err(e) => return Err(e.into()),
    }
    Ok(())
}

fn setup_tray(
    app: &mut tauri::App,
    shutdown_tx: mpsc::Sender<()>,
) -> Result<(), Box<dyn std::error::Error>> {
    let danger_ope_sub_menu_title =
        MenuItemBuilder::with_id("danger-title".to_string(), "Danger Zone")
            .enabled(false)
            .build(app)
            .unwrap();
    let proxy_serve_shutdown =
        MenuItemBuilder::with_id("proxy-serve-shutdown".to_string(), "Shutdown Proxy Server")
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

    let quit = MenuItemBuilder::with_id("quit".to_string(), "Quit")
        .build(app)
        .unwrap();
    // let restart = MenuItemBuilder::with_id("restart".to_string(), "Restart")
    //     .build(app)
    //     .unwrap();
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
    // let visit_website = MenuItemBuilder::with_id("visit-website".to_string(), "Visit Website")
    //     .build(app)
    //     .unwrap();
    let open_launch_page =
        MenuItemBuilder::with_id("open-launch-page".to_string(), "Open Launch Page")
            .build(app)
            .unwrap();

    let open_configs = MenuItemBuilder::with_id("open-configs".to_string(), "Open Configs")
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
        .item(&open_auth_window);

    let danger_ope_sub_menu = danger_ope_sub_menu.build().unwrap();

    let adavanced_title = MenuItemBuilder::with_id("advanced-title".to_string(), "Advanced")
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
        // .item(&visit_website)
        .item(&main_open_close)
        .item(&external_open_close)
        .item(&open_launch_page)
        .item(&open_configs)
        .separator()
        .item(&advanced_sub_menu)
        .separator()
        .item(&quit)
        // .item(&restart)
        .build()
        .unwrap();

    app.manage(Mutex::new(main_open_close));

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
                let window = app.get_webview_window("main");
                match window {
                    Some(window) => {
                        if let Ok(false) = window.is_visible() {
                            window.show().unwrap();
                        }
                    }
                    None => {
                        app::open_main_window(app);
                    }
                }

                println!("system tray received a left click");
            }
        })
        .on_menu_event({
            let shutdown_tx = shutdown_tx.clone();
            move |tray, event| {
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
                    "proxy-serve-shutdown" => {}
                    // "restart" => {}
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

                        // let _ = main_open_close.set_enabled(false);
                        let _ = quit.set_enabled(false);
                        let _ = adavanced_title.set_enabled(false);

                        native_cmd::remove_pac(tray.app_handle());

                        discord::close();

                        let shutdown_tx_clone = shutdown_tx.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = shutdown_tx_clone.send(()).await;
                        });
                    }
                    // "visit-website" => {
                    //     let browser = SHARED_BROWSER.lock().unwrap().get_browser();
                    //     let _ = open_browser(browser, "https://github.com/tsukasa-u").is_ok();
                    // }
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
                                app::open_main_window(tray.app_handle());
                            }
                        }
                    }
                    "open-configs" => {
                        let config_path = get_ROAMING_DIR().join("user").join("configs.toml");
                        let path_str = config_path.to_string_lossy();
                        let _ = tray.app_handle().opener().open_path(path_str, None::<&str>);
                    }
                    "main-open/close" => {
                        let window = tray.get_webview_window("main");
                        match window {
                            Some(window) => match window.is_visible() {
                                Ok(true) => {
                                    window.hide().unwrap();
                                    // // let _ = app
                                    // //     .tray_handle()
                                    // //     .get_item("main-open/close")
                                    // //     .set_title("Open Main Window");
                                    // let _ = main_open_close.set_text("Open Main Window");
                                }
                                Ok(false) => {
                                    window.show().unwrap();
                                    // // let _ = app
                                    // //     .tray_handle()
                                    // //     .get_item("main-open/close")
                                    // //     .set_title("Close Main Window");
                                    // let _ = main_open_close.set_text("Close Main Window");
                                }
                                _ => {}
                            },
                            None => {
                                app::open_main_window(tray.app_handle());
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
                                external::create_external_window(tray.app_handle(), None, true);
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
            }
        })
        .build(app)
        .unwrap();

    Ok(())
}

pub fn setup_discord() -> Result<(), Box<dyn std::error::Error>> {
    discord::connect();
    // discord::set_activity("experimental implementation", "playing KanColle with FUSOU");
    discord::set_activity_button(
        "experimental implementation",
        "playing KanColle with FUSOU",
        "Visit GitHub Repository",
        "https://github.com/tsukasa-u/FUSOU",
    );
    Ok(())
}

pub fn setup_configs() -> Result<(), Box<dyn std::error::Error>> {
    let resources_config_path = get_RESOURCES_DIR().join("user").join("configs.toml");
    let roaming_config_path = get_ROAMING_DIR().join("user").join("configs.toml");
    println!("open configs: {:?}", roaming_config_path);
    println!("default configs: {:?}", resources_config_path);
    if fs::metadata(&roaming_config_path).is_err() {
        if let Some(parent) = roaming_config_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&resources_config_path, &roaming_config_path)?;
    }
    let path_str = roaming_config_path.to_string_lossy();
    configs::set_user_config(&path_str)?;
    Ok(())
}

pub fn setup_init(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

    #[cfg(any(not(dev), check_release))]
    setup_updater(app)?;
    setup_deep_link(app)?;
    set_paths(app)?;
    setup_configs()?;
    setup_tray(app, shutdown_tx)?;
    setup_discord()?;

    let proxy_bidirectional_channel_master_clone = get_proxy_bidirectional_channel().clone_master();
    let pac_bidirectional_channel_master_clone = get_pac_bidirectional_channel().clone_master();
    let response_parse_channel_master_clone =
        get_response_parse_bidirectional_channel().clone_master();
    #[cfg(feature = "auth-local-server")]
    let auth_bidirectional_channel_master_clone = get_auth_bidirectional_channel().clone_master();

    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let _ = shutdown_rx.recv().await;
        // is it needed to add select! for timeout?
        #[cfg(feature = "auth-local-server")]
        let _ = tokio::join!(
            request_shutdown(proxy_bidirectional_channel_master_clone),
            request_shutdown(pac_bidirectional_channel_master_clone),
            request_shutdown(response_parse_channel_master_clone),
            request_shutdown(auth_bidirectional_channel_master_clone),
        );
        #[cfg(not(feature = "auth-local-server"))]
        let _ = tokio::join!(
            request_shutdown(proxy_bidirectional_channel_master_clone),
            request_shutdown(pac_bidirectional_channel_master_clone),
            request_shutdown(response_parse_channel_master_clone),
        );

        tokio::time::sleep(time::Duration::from_millis(2000)).await;
        app_handle.cleanup_before_exit();
        app_handle.exit(0_i32);
    });
    return Ok(());
}
