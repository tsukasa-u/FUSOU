use std::collections::HashMap;
use tauri::Manager;

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

#[cfg(any(not(dev), check_release))]
use tracing_unwrap::ResultExt;

pub async fn launch_with_options(
    window: tauri::Window,
    options: HashMap<String, i32>,
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
                    let server_address = match server_index {
                        -1 => Some(server_name.as_str()),
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
                        let pac_path = get_ROAMING_DIR()
                            .join("./pac/proxy.pac")
                            .as_path()
                            .to_str()
                            .expect_or_log("failed to convert str")
                            .to_string();

                        #[cfg(dev)]
                        let save_path = "./../../FUSOU-PROXY-DATA".to_string();
                        #[cfg(any(not(dev), check_release))]
                        let save_path = window
                            .app_handle()
                            .path()
                            .document_dir()
                            .expect_or_log("failed to get doc dirs")
                            .join("FUSOU")
                            .join("FUSOU-PROXY-DATA")
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
