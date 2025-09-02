// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// #![recursion_limit = "256"]

use std::path::PathBuf;
use tokio::sync::OnceCell;

use kc_api::{database, interface};
mod json_parser;

mod auth;
mod builder_setup;
mod cloud_storage;
mod cmd;
mod external;
mod integration;
mod util;
mod wrap_proxy;

#[cfg(dev)]
mod test;

use crate::builder_setup::bidirectional_channel::{
    get_manage_pac_channel, get_manage_proxy_channel, get_manage_proxy_log_channel,
    get_manage_response_parse_channel,
};

#[cfg(feature = "auth-local-server")]
use crate::builder_setup::bidirectional_channel::get_manage_auth_channel;

static RESOURCES_DIR: OnceCell<PathBuf> = OnceCell::const_new();

#[cfg(any(not(dev), check_release))]
static ROAMING_DIR: OnceCell<PathBuf> = OnceCell::const_new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[tokio::main]
pub async fn run() {
    // let shared_browser = Arc::new(Mutex::new(BrowserState::new()));

    // let browser = shared_browser.lock().unwrap().get_browser();

    let manage_pac_channel = get_manage_pac_channel();

    let manage_proxy_channel = get_manage_proxy_channel();

    let manage_proxy_log_channel = get_manage_proxy_log_channel();

    let manage_response_parse_channel = get_manage_response_parse_channel();

    #[cfg(feature = "auth-local-server")]
    let manage_auth_channel = get_manage_auth_channel();

    let ctx = tauri::generate_context!();

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
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
        .manage(manage_response_parse_channel);

    #[cfg(feature = "auth-local-server")]
    {
        builder = builder.manage(manage_auth_channel);
    }

    builder
        .invoke_handler(tauri::generate_handler![
            // cmd::tauri_cmd::close_splashscreen,
            // cmd::tauri_cmd::show_splashscreen,
            cmd::tauri_cmd::get_mst_ships,
            cmd::tauri_cmd::get_mst_slot_items,
            cmd::tauri_cmd::get_slot_items,
            cmd::tauri_cmd::get_mst_equip_exslot_ships,
            cmd::tauri_cmd::get_mst_slotitem_equip_types,
            cmd::tauri_cmd::get_mst_equip_ships,
            cmd::tauri_cmd::get_mst_stypes,
            cmd::tauri_cmd::get_mst_useitems,
            cmd::tauri_cmd::launch_with_options,
            cmd::tauri_cmd::check_pac_server_health,
            cmd::tauri_cmd::check_proxy_server_health,
            cmd::tauri_cmd::set_refresh_token,
            cmd::tauri_cmd::open_auth_page,
            cmd::tauri_cmd::check_open_window,
            #[cfg(dev)]
            cmd::tauri_cmd::open_auth_window,
            #[cfg(dev)]
            cmd::tauri_cmd::open_debug_window,
            #[cfg(dev)]
            cmd::tauri_cmd::close_debug_window,
            #[cfg(dev)]
            cmd::tauri_cmd::read_dir,
            #[cfg(dev)]
            cmd::tauri_cmd::read_emit_file,
        ])
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        // .plugin(tauri_plugin_devtools::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(
            move |app: &tauri::AppHandle, argv: Vec<String>, _cwd| {
                builder_setup::single_instance::single_instance_init(app, argv)
            },
        ))
        .setup(move |app: &mut tauri::App| {
            builder_setup::setup::setup_init(app)?;
            Ok(())
        })
        .on_window_event(move |window: &tauri::Window, event: &tauri::WindowEvent| {
            builder_setup::window_event::window_event_handler(window, event)
        })
        .run(ctx)
        .expect("error while building tauri application");
}
