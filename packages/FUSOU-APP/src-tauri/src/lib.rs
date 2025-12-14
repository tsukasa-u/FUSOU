#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")] // Prevents additional console window on Windows in release
// #![recursion_limit = "256"]

use once_cell::sync::OnceCell;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use kc_api::interface;
use tauri::{Manager, Emitter};
// use crate::notify; // access via module path since we declare below
mod json_parser;

use fusou_auth::{AuthManager, FileStorage, Storage};
use tauri::AppHandle;


mod auth;
mod builder_setup;
mod storage;
mod cmd;
mod integration;
mod scheduler;
mod sequence;
mod util;
mod window;
mod wrap_proxy;
mod notify;

use fusou_upload::PendingStore;
use fusou_upload::UploadRetryService;

use tauri_plugin_autostart::MacosLauncher;

static RESOURCES_DIR: OnceCell<Mutex<PathBuf>> = OnceCell::new();

static ROAMING_DIR: OnceCell<Mutex<PathBuf>> = OnceCell::new();

async fn bootstrap_tokens_on_startup(
    app_handle: AppHandle,
    app_handle_for_notification: AppHandle,
    storage: Arc<FileStorage>,
    auth_manager: AuthManager<FileStorage>,
) {
    // Try to load existing session from storage
    if let Ok(Some(session)) = storage.load_session().await {
        tracing::info!("startup: session loaded from storage");
        // Verify token validity by attempting to get a valid access token
        // This will automatically refresh if needed, or fail if refresh token is invalid
        match auth_manager.get_access_token().await {
            Ok(access_token) => {
                tracing::info!("startup: found existing session and token is valid (or refreshed), emitting tokens to frontend");
                
                // Load the potentially refreshed session
                let updated_session = storage.load_session().await
                    .ok()
                    .flatten()
                    .unwrap_or(session);
                
                let _ = app_handle.emit_to(
                    "main",
                    "set-supabase-tokens",
                    vec![access_token, updated_session.refresh_token.clone()],
                );

                // Fetch all cloud provider tokens from Supabase
                // This supports multiple providers: google, dropbox, icloud, onedrive, etc.
                let supported_providers = storage::CloudProviderFactory::supported_providers();
                tracing::info!(?supported_providers, "startup: fetching provider refresh tokens");

                for provider in supported_providers {
                    tracing::info!(provider, "startup: begin fetch provider token");
                    match auth_manager.fetch_provider_token(provider).await {
                        Ok(Some(token)) => {
                            tracing::info!(provider, "startup: fetched provider token successfully");
                            match storage::CloudProviderFactory::create(provider) {
                                Ok(mut p) => {
                                    tracing::info!(provider, "startup: created provider instance");
                                    if let Err(e) = p.initialize(token.to_string()).await {
                                        tracing::warn!(provider, error = ?e, "startup: provider initialize failed");
                                    } else {
                                        tracing::info!(provider, "startup: provider initialized successfully");
                                    }
                                }
                                Err(e) => tracing::warn!(provider, error = %e, "startup: provider factory create failed"),
                            }
                        }
                        Ok(None) => tracing::info!(provider, "startup: no provider token for user"),
                        Err(e) => tracing::warn!(provider, error = %e, "startup: failed to fetch provider token"),
                    }
                }
            }
            Err(e) => {
                tracing::warn!("startup: token validation/refresh failed: {} - authentication required", e);
                
                // Send notification to user
                notify::show(&app_handle_for_notification, "Authentication Expired", "Your session has expired. Please sign in again to use FUSOU.");

                // Open authentication page
                if let Err(e) = auth::auth_server::open_auth_page() {
                    tracing::error!("Failed to open auth page: {}", e);
                }
            }
        }
    } else {
        tracing::warn!("startup: no existing session found - authentication required");

        // Send notification to user
        notify::show(&app_handle_for_notification, "Authentication Required", "Please sign in with your Supabase account to use FUSOU");

        // Open authentication page using existing auth module function
        if let Err(e) = auth::auth_server::open_auth_page() {
            tracing::error!("Failed to open auth page: {}", e);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[tokio::main]
pub async fn run() {
    let ctx = tauri::generate_context!();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    // tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    // tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .build(),
        )
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(
            move |app: &tauri::AppHandle, argv: Vec<String>, _cwd| {
                builder_setup::single_instance::single_instance_init(app, argv)
            },
        ));

    builder = builder
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
            cmd::tauri_cmd::check_open_window,
            cmd::tauri_cmd::get_app_theme,
            cmd::tauri_cmd::get_app_font,
            cmd::tauri_cmd::get_kc_server_name,
            cmd::tauri_cmd::get_access_token,
            cmd::tauri_cmd::get_user_tokens,
            cmd::tauri_cmd::check_supabase_session_health,
            cmd::tauri_cmd::force_local_sign_out,
            cmd::tauri_cmd::perform_snapshot_sync,
            cmd::tauri_cmd::get_all_logs,
            #[cfg(dev)]
            cmd::tauri_cmd::open_debug_window,
            #[cfg(dev)]
            cmd::tauri_cmd::close_debug_window,
            #[cfg(dev)]
            cmd::tauri_cmd::read_emit_file,
        ])
        .setup(move |app: &mut tauri::App| {
            // Initialize AuthManager
            let roaming_dir = app.path().app_data_dir().expect("failed to get roaming dir");
            let session_path = roaming_dir.join("fusou-auth-session.json");
            let storage = Arc::new(FileStorage::new(session_path.clone()));
            let auth_manager = AuthManager::from_env(storage.clone())
                .expect("failed to create auth manager");
            let auth_manager_for_retry = Arc::new(auth_manager.clone());
            let auth_manager_state = Arc::new(Mutex::new(auth_manager.clone()));
            app.manage(auth_manager_state.clone());

            // Initialize PendingStore and UploadRetryService
            let pending_dir = roaming_dir.join("pending_uploads");
            let pending_store = Arc::new(PendingStore::new(pending_dir));
            
            let retry_service = Arc::new(UploadRetryService::new(
                pending_store.clone(), 
                auth_manager_for_retry,
                None
            ));
            
            app.manage(pending_store.clone());
            app.manage(retry_service.clone());

            // Initialize storage dependencies for submit_data
            let pending_store_clone = pending_store.clone();
            let retry_service_clone = retry_service.clone();
            tokio::spawn(async move {
                storage::submit_data::initialize_storage_deps(pending_store_clone, retry_service_clone).await;
            });

            // Run remaining setup (logger, tray, schedulers, etc.) so that logging is available
            // before we perform token fetch below.
            builder_setup::setup::setup_init(app)?;

            // Fetch tokens and emit to frontend (after logger is initialized inside setup_init)
            let app_handle = app.handle().clone();
            let app_handle_for_notification = app.handle().clone();
            let storage_for_bootstrap = storage.clone();
            let auth_manager_for_bootstrap = auth_manager.clone();

            tauri::async_runtime::spawn(async move {
                bootstrap_tokens_on_startup(
                    app_handle,
                    app_handle_for_notification,
                    storage_for_bootstrap,
                    auth_manager_for_bootstrap,
                ).await;
            });
            Ok(())
        })
        .on_window_event(move |window: &tauri::Window, event: &tauri::WindowEvent| {
            builder_setup::window_event::window_event_handler(window, event)
        });

    if let Err(e) = builder.run(ctx) {
        tracing::error!("error while building tauri application: {}", e);
    }
}
