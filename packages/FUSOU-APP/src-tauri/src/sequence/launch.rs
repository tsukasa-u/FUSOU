use std::collections::HashMap;
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
                        binding_server_address
                            .as_deref()
                    };
                    if let Some(server_address) = server_address {
                        let pac_path = get_ROAMING_DIR()
                            .join("./pac/proxy.pac")
                            .as_path()
                            .to_str()
                            .expect_or_log("failed to convert str")
                            .to_string();

                        let period_tag = supabase::get_period_tag().await;

                        #[cfg(dev)]
                        let save_path = format!("./../../FUSOU-PROXY-DATA/{}", period_tag);
                        #[cfg(any(not(dev), check_release))]
                        let save_path = window
                            .app_handle()
                            .path()
                            .document_dir()
                            .expect_or_log("failed to get doc dirs")
                            .join("FUSOU")
                            .join("FUSOU-PROXY-DATA")
                            .join(&period_tag)
                            .as_path()
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
                        tracing::info!("ca path: {ca_path}");
                        tracing::info!("pac path: {pac_path}");

                        let file_prefix = util::get_user_env_id().await;

                        let addr = wrap_proxy::serve_proxy(
                            server_address.to_string(),
                            save_path,
                            pac_path,
                            ca_path,
                            window.app_handle(),
                            Some(file_prefix),
                            auth_manager.clone(),
                        );
                        match addr {
                            Ok(addr) => Some(addr),
                            Err(e) => {
                                tracing::error!("Error: {e}");
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
                get_response_parse_bidirectional_channel().clone_slave(),
                get_proxy_log_bidirectional_channel().clone_slave(),
            );
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
                    let browser = SHARED_BROWSER.lock().unwrap().get_browser();
                    create_external_window(window.app_handle(), Some(browser), false);
                }
            }
        }
    }

    return Ok(());
}
