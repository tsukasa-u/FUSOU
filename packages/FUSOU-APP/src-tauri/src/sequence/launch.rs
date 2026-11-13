use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

use crate::auth::supabase;
use crate::util::get_ROAMING_DIR;
use crate::window::external::create_external_window;
use crate::window::external::SHARED_BROWSER;
use crate::{
    builder_setup::bidirectional_channel::{
        get_proxy_log_bidirectional_channel, get_response_parse_bidirectional_channel,
    },
    json_parser, util, wrap_proxy,
};
use tracing_unwrap::OptionExt;

use fusou_auth::{AuthManager, FileStorage};
use std::sync::{Arc, Mutex};

static PROXY_SERVER_RUNNING: AtomicBool = AtomicBool::new(false);
static PARSER_SERVER_RUNNING: AtomicBool = AtomicBool::new(false);

#[cfg(any(not(dev), check_release))]
use tracing_unwrap::ResultExt;

pub async fn launch_with_options(
    window: tauri::Window,
    options: HashMap<String, i32>,
    auth_manager: Arc<Mutex<AuthManager<FileStorage>>>,
) -> Result<(), ()> {
    let server_name = if let Some(name) = configs::get_user_configs_for_app()
        .connect_kc_server
        .get_kc_server_name()
    {
        name.clone()
    } else {
        String::from("")
    };
    let _proxy_addr = {
        if let Some(&flag) = options.get("run_proxy_server") {
            if flag != 0 {
                if let Some(&server_index) = options.get("server") {
                    let binding_server_address = configs::get_user_configs_for_app()
                        .connect_kc_server
                        .get_server_address(server_index);
                    let server_address = if server_index == -1 {
                        Some(server_name.as_str())
                    } else {
                        binding_server_address.as_deref()
                    };
                    if let Some(server_address) = server_address {
                        let pac_path = get_ROAMING_DIR()
                            .join("./pac/proxy.pac")
                            .as_path()
                            .to_str()
                            .expect_or_log("failed to convert str")
                            .to_string();

                        let period_tag = match supabase::get_period_tag().await {
                            Some(tag) => tag,
                            None => {
                                tracing::warn!("kc-period tag could not be determined; using fallback directory for local proxy storage (cloud upload is suspended)");
                                "unknown-period".to_string()
                            }
                        };

                        #[cfg(dev)]
                        let proxy_base_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                            .join("../../FUSOU-PROXY-DATA");
                        #[cfg(any(not(dev), check_release))]
                        let proxy_base_dir = match window.app_handle().path().document_dir() {
                            Ok(path) => path.join("fusou").join("FUSOU-PROXY-DATA"),
                            Err(e) => {
                                tracing::error!("failed to get document_dir: {}", e);
                                return Err(());
                            }
                        };
                        let save_path = proxy_base_dir
                            .join(&period_tag)
                            .to_str()
                            .expect_or_log("failed to convert str")
                            .to_string();

                        let asset_sync_save_path = get_ROAMING_DIR()
                            .join("asset_sync")
                            .join(&period_tag)
                            .to_str()
                            .expect_or_log("failed to convert str")
                            .to_string();

                        let ca_path = get_ROAMING_DIR()
                            .join("./ca")
                            .as_path()
                            .to_str()
                            .expect_or_log("failed to convert str")
                            .to_string();
                        // let ca_path =  window.app_handle().path_resolver().resolve_resource("./resources/ca").expect_or_log("failed to resolve app_local_data_dir").as_path().to_str().expect_or_log("failed to convert str").to_string();

                        tracing::info!("save address: {save_path}");
                        tracing::info!("asset sync save address: {asset_sync_save_path}");
                        tracing::info!("ca path: {ca_path}");
                        tracing::info!("pac path: {pac_path}");

                        let file_prefix = {
                            let manager = auth_manager.lock().unwrap().clone();
                            if let Some(dataset_id) =
                                crate::util::resolve_dataset_id_for_current_member(&manager).await
                            {
                                dataset_id
                            } else {
                                util::get_local_fallback_id().await
                            }
                        };

                        if PROXY_SERVER_RUNNING
                            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                            .is_err()
                        {
                            tracing::info!(
                                "proxy server is already running; skipping duplicate start"
                            );
                            None
                        } else {
                            let addr = wrap_proxy::serve_proxy(
                                server_address.to_string(),
                                save_path,
                                asset_sync_save_path,
                                pac_path,
                                ca_path,
                                window.app_handle(),
                                Some(file_prefix),
                                auth_manager.clone(),
                            )
                            .await;
                            match addr {
                                Ok(addr) => Some(addr),
                                Err(e) => {
                                    PROXY_SERVER_RUNNING.store(false, Ordering::Release);
                                    tracing::error!("failed to start proxy: {e}");
                                    crate::notify::show(
                                        window.app_handle(),
                                        "FUSOU - Proxy Startup Error",
                                        &format!("Failed to start the proxy: {e}"),
                                    );
                                    None
                                }
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
            if PARSER_SERVER_RUNNING
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
            {
                json_parser::serve_reponse_parser(
                    window.app_handle(),
                    get_response_parse_bidirectional_channel().clone_slave(),
                    get_proxy_log_bidirectional_channel().clone_slave(),
                );
            } else {
                tracing::info!("response parser is already running; skipping duplicate start");
            }
            window
                .get_webview_window("main")
                .expect_or_log("no window labeled 'main' found")
                .show()
                .unwrap();
            // let _ = window
            //     .app_handle()
            //     .tray_handle()
            //     .get_item("main-open/close")
            //     .set_title("Close Main Window");
        } else {
            window
                .get_webview_window("main")
                .expect_or_log("no window labeled 'main' found")
                .close()
                .unwrap();
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
                    let browser = SHARED_BROWSER
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .get_browser();
                    create_external_window(window.app_handle(), Some(browser), false);
                }
            } else {
                create_external_window(window.app_handle(), None, true);
            }
        }
    }

    Ok(())
}
