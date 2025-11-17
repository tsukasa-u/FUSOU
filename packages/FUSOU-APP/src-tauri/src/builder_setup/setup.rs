#[cfg(dev)]
use std::path::PathBuf;
use std::{env, fs, sync::Mutex, time};

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::mpsc;

use crate::{
    builder_setup::{
        bidirectional_channel::{
            get_pac_bidirectional_channel, get_proxy_bidirectional_channel,
            get_response_parse_bidirectional_channel,
            get_scheduler_integrate_bidirectional_channel,
        },
        logger,
    },
    cloud_storage::integrate,
    cmd::{native_cmd, tauri_cmd},
    integration::discord,
    scheduler,
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
        tracing::info!("urls: {:?}", event.urls());
    });
    Ok(())
}

fn set_paths(
    #[allow(unused_variables)] app: &mut tauri::App,
) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(dev)]
    let _ = RESOURCES_DIR.set(Mutex::new(PathBuf::from(format!(
        "{}/resources",
        env!("CARGO_MANIFEST_DIR")
    ))));

    #[cfg(any(not(dev), check_release))]
    match app.path().resource_dir() {
        Ok(path) => {
            let _ = RESOURCES_DIR.set(Mutex::new(path.join("resources")));
        }
        Err(e) => {
            tracing::error!("Failed to get resource_dir: {}", e);
            return Err(e.into());
        }
    }

    #[cfg(dev)]
    let _ = ROAMING_DIR.set(Mutex::new(PathBuf::from(format!(
        "{}/roaming",
        env!("CARGO_MANIFEST_DIR")
    ))));

    #[cfg(any(not(dev), check_release))]
    match app.path().app_data_dir() {
        Ok(path) => {
            let _ = ROAMING_DIR.set(Mutex::new(path.clone()));
        }
        Err(e) => {
            tracing::error!("Failed to get app_data_dir: {}", e);
            return Err(e.into());
        }
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
            .build(app)?;
    let proxy_serve_shutdown =
        MenuItemBuilder::with_id("proxy-serve-shutdown".to_string(), "Shutdown Proxy Server")
            .build(app)?;
    let pac_server_shutdown =
        MenuItemBuilder::with_id("pac-serve-shutdown".to_string(), "Shutdown PAC Server")
            .build(app)?;
    let delete_registry =
        MenuItemBuilder::with_id("delete-registry".to_string(), "Delete Registry").build(app)?;

    #[cfg(dev)]
    let open_debug_window =
        MenuItemBuilder::with_id("open-debug-window".to_string(), "Open Debug Window")
            .build(app)?;

    #[cfg(dev)]
    let open_auth_window =
        MenuItemBuilder::with_id("open-auth-window".to_string(), "Open Auth Window").build(app)?;

    let quit = MenuItemBuilder::with_id("quit".to_string(), "Quit").build(app)?;
    // let restart = MenuItemBuilder::with_id("restart".to_string(), "Restart")
    //     .build(app)?;
    let title = MenuItemBuilder::with_id("title".to_string(), "FUSOU")
        .enabled(false)
        .build(app)?;
    let external_open_close =
        MenuItemBuilder::with_id("external-open/close".to_string(), "Open WebView").build(app)?;
    let main_open_close =
        MenuItemBuilder::with_id("main-open/close".to_string(), "Open Main Window").build(app)?;
    // let visit_website = MenuItemBuilder::with_id("visit-website".to_string(), "Visit Website")
    //     .build(app)?;
    let open_launch_page =
        MenuItemBuilder::with_id("open-launch-page".to_string(), "Open Launch Page").build(app)?;

    let open_configs =
        MenuItemBuilder::with_id("open-configs".to_string(), "Open Configs").build(app)?;

    let open_log_file =
        MenuItemBuilder::with_id("open-log-file".to_string(), "Open log file").build(app)?;

    let intergrate_file =
        MenuItemBuilder::with_id("intergrate_file".to_string(), "Intergrate Cloud File")
            .build(app)?;

    let check_update =
        MenuItemBuilder::with_id("check-update".to_string(), "Check Update").build(app)?;

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

    let danger_ope_sub_menu = danger_ope_sub_menu.build()?;

    let adavanced_title = MenuItemBuilder::with_id("advanced-title".to_string(), "Advanced")
        .enabled(false)
        .build(app)?;

    let advanced_sub_menu = SubmenuBuilder::new(app, "Adavanced")
        // .item(&adavanced_title)
        .item(&open_configs)
        .item(&open_log_file)
        .item(&intergrate_file)
        .item(&check_update)
        .separator()
        .item(&danger_ope_sub_menu)
        .build()?;

    let tray_menu = MenuBuilder::new(app)
        .item(&title)
        .separator()
        // .item(&visit_website)
        .item(&main_open_close)
        .item(&external_open_close)
        .item(&open_launch_page)
        .separator()
        .item(&advanced_sub_menu)
        .separator()
        .item(&quit)
        // .item(&restart)
        .build()?;

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
                            if let Err(e) = window.show() {
                                tracing::error!("Failed to show window: {}", e);
                            }
                        }
                    }
                    None => {
                        app::open_main_window(app);
                    }
                }
            }
        })
        .on_menu_event({
            let shutdown_tx = shutdown_tx.clone();
            move |tray, event| {
                match event.id().as_ref() {
                    #[cfg(dev)]
                    "open-debug-window" => match tray.get_webview_window("debug") {
                        Some(debug_window) => {
                            if let Err(e) = debug_window.show() {
                                tracing::error!("Failed to show debug window: {}", e);
                            }
                        }
                        None => {
                            if let Err(e) = tauri::WebviewWindowBuilder::new(
                                tray.app_handle(),
                                "debug",
                                tauri::WebviewUrl::App("/debug".into()),
                            )
                            .fullscreen(false)
                            .title("fusou-debug")
                            .build()
                            {
                                tracing::error!("Failed to build debug window: {}", e);
                            }
                        }
                    },
                    #[cfg(dev)]
                    "open-auth-window" => match tray.get_webview_window("auth") {
                        Some(debug_window) => {
                            if let Err(e) = debug_window.show() {
                                tracing::error!("Failed to show auth window: {}", e);
                            }
                        }
                        None => {
                            if let Err(e) = tauri::WebviewWindowBuilder::new(
                                tray.app_handle(),
                                "auth",
                                tauri::WebviewUrl::App("/auth".into()),
                            )
                            .fullscreen(false)
                            .title("fusou-auth")
                            .build()
                            {
                                tracing::error!("Failed to build auth window: {}", e);
                            }
                        }
                    },
                    "proxy-serve-shutdown" => {}
                    // "restart" => {}
                    "quit" => {
                        if let Some(window) = tray.get_webview_window("main") {
                            if let Ok(visible) = window.is_visible() {
                                if visible {
                                    if let Err(e) = window.hide() {
                                        tracing::error!("Failed to hide main window: {}", e);
                                    }
                                }
                            }
                        }

                        if let Some(window) = tray.get_webview_window("external") {
                            if let Ok(visible) = window.is_visible() {
                                if visible {
                                    if let Err(e) = window.hide() {
                                        tracing::error!("Failed to hide external window: {}", e);
                                    }
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
                                    if let Err(e) = window.show() {
                                        tracing::error!("Failed to show main window: {}", e);
                                    }
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
                    "open-log-file" => {
                        let log_path = get_ROAMING_DIR()
                            .join("log")
                            .join(logger::get_log_file_name());
                        let path_str = log_path.to_string_lossy();
                        let _ = tray.app_handle().opener().open_path(path_str, None::<&str>);
                    }
                    "intergrate_file" => {
                        integrate::integrate_port_table();
                    }
                    "check-update" => {
                        let window = tray.get_webview_window("main");
                        match window {
                            Some(window) => {
                                if let Ok(false) = window.is_visible() {
                                    if let Err(e) = window.show() {
                                        tracing::error!("Failed to show main window: {}", e);
                                    }
                                }
                                tauri_cmd::set_update_page(tray.app_handle());
                            }
                            None => {
                                app::open_main_window(tray.app_handle());
                                tauri_cmd::set_update_page(tray.app_handle());
                            }
                        }
                    }
                    "main-open/close" => {
                        let window = tray.get_webview_window("main");
                        match window {
                            Some(window) => match window.is_visible() {
                                Ok(true) => {
                                    if let Err(e) = window.hide() {
                                        tracing::error!("Failed to hide main window: {}", e);
                                    }
                                    // // let _ = app
                                    // //     .tray_handle()
                                    // //     .get_item("main-open/close")
                                    // //     .set_title("Open Main Window");
                                    // let _ = main_open_close.set_text("Open Main Window");
                                }
                                Ok(false) => {
                                    if let Err(e) = window.show() {
                                        tracing::error!("Failed to show main window: {}", e);
                                    }
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
                                    // if let Err(e) = window.hide() {
                                    //     tracing::error!("Failed to hide external window: {}", e);
                                    // }
                                    // // let _ = app
                                    // //     .tray_handle()
                                    // //     .get_item("external-open/close")
                                    // //     .set_title("Open WebView");
                                    // external_open_close.set_text("Open WebView");
                                }
                                Ok(false) => {
                                    if let Err(e) = window.show() {
                                        tracing::error!("Failed to show external window: {}", e);
                                    }
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
        .build(app)?;

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
    tracing::info!("open configs: {:?}", roaming_config_path);
    tracing::info!("default configs: {:?}", resources_config_path);
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

fn configure_channel_transport() {
    let proxy_configs = configs::get_user_configs_for_proxy();
    let transport = proxy_configs.get_channel_transport();

    #[cfg(feature = "grpc-channel")]
    {
        if !matches!(transport, configs::ChannelTransportKind::Grpc) {
            tracing::warn!(
                "proxy.channel.transport is set to `mpsc`, but this binary was built with the `grpc-channel` feature. gRPC transport will be used."
            );
        }

        if let Some(endpoint) = proxy_configs.get_channel_endpoint() {
            env::set_var("FUSOU_CHANNEL_ENDPOINT", endpoint.clone());
            tracing::info!("Configured gRPC channel endpoint: {}", endpoint);
        } else {
            tracing::info!("Configured gRPC channel endpoint: default (127.0.0.1:50061)");
        }

        if let Some(buffer) = proxy_configs.get_channel_buffer_size() {
            env::set_var("FUSOU_CHANNEL_BUFFER", buffer.to_string());
            tracing::info!("Configured gRPC channel buffer size override: {}", buffer);
        }
    }

    #[cfg(not(feature = "grpc-channel"))]
    {
        if matches!(transport, configs::ChannelTransportKind::Grpc) {
            tracing::warn!(
                "proxy.channel.transport is set to `grpc`, but this binary was built without the `grpc-channel` feature. Falling back to the in-process channel."
            );
        }
    }
}

pub fn setup_init(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

    set_paths(app)?;
    logger::setup(app);
    #[cfg(any(not(dev), check_release))]
    setup_updater(app)?;
    setup_deep_link(app)?;
    setup_configs()?;
    configure_channel_transport();
    setup_tray(app, shutdown_tx)?;
    setup_discord()?;
    scheduler::integrate_file::start_scheduler();

    let proxy_bidirectional_channel_master_clone = get_proxy_bidirectional_channel().clone_master();
    let pac_bidirectional_channel_master_clone = get_pac_bidirectional_channel().clone_master();
    let response_parse_channel_master_clone =
        get_response_parse_bidirectional_channel().clone_master();
    let scheduler_integrate_channel_master_clone =
        get_scheduler_integrate_bidirectional_channel().clone_master();
    #[cfg(feature = "auth-local-server")]
    let auth_bidirectional_channel_master_clone = get_auth_bidirectional_channel().clone_master();

    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                tracing::info!("Received Ctrl+C, shutting down.");
            }
            _ = shutdown_rx.recv() => {
                tracing::info!("Received shutdown signal, shutting down.");
            }
        }
        // is it needed to add select! for timeout?
        #[cfg(feature = "auth-local-server")]
        let _ = tokio::join!(
            request_shutdown(proxy_bidirectional_channel_master_clone),
            request_shutdown(pac_bidirectional_channel_master_clone),
            request_shutdown(response_parse_channel_master_clone),
            request_shutdown(auth_bidirectional_channel_master_clone),
            request_shutdown(scheduler_integrate_channel_master_clone),
        );
        #[cfg(not(feature = "auth-local-server"))]
        let _ = tokio::join!(
            request_shutdown(proxy_bidirectional_channel_master_clone),
            request_shutdown(pac_bidirectional_channel_master_clone),
            request_shutdown(response_parse_channel_master_clone),
            request_shutdown(scheduler_integrate_channel_master_clone),
        );

        tokio::time::sleep(time::Duration::from_millis(2000)).await;
        app_handle.cleanup_before_exit();
        app_handle.exit(0_i32);
    });
    return Ok(());
}
