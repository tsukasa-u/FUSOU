#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")] // Prevents additional console window on Windows in release
                                                                   // #![recursion_limit = "256"]

use once_cell::sync::OnceCell;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use kc_api::interface;
use tauri::{Emitter, Manager};
// use crate::notify; // access via module path since we declare below
mod json_parser;

use fusou_auth::{AuthManager, FileStorage, Storage};
use tauri::AppHandle;

mod auth;
mod attestation;
mod builder_setup;
mod cmd;
mod integration;
mod notify;
mod scheduler;
mod senders;
mod sequence;
mod storage;
mod util;
mod window;
mod wrap_proxy;
use senders::{quest_tree_sender, remodel_sender, ship_growth_sender, soku_speed_sender};

use fusou_upload::PendingStore;
use fusou_upload::UploadRetryService;

use tauri_plugin_autostart::MacosLauncher;

static RESOURCES_DIR: OnceCell<Mutex<PathBuf>> = OnceCell::new();

static ROAMING_DIR: OnceCell<Mutex<PathBuf>> = OnceCell::new();

async fn bootstrap_tokens_on_startup(
    app_handle: AppHandle,
    _app_handle_for_notification: AppHandle,
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
                let updated_session = storage
                    .load_session()
                    .await
                    .ok()
                    .flatten()
                    .unwrap_or(session);

                // Note: No need to emit tokens to frontend
                // Frontend doesn't use Supabase tokens directly
                // All auth operations handled by Rust AuthManager

                // Fetch all cloud provider tokens from Supabase
                // This supports multiple providers: google, dropbox, icloud, onedrive, etc.
                let supported_providers = storage::CloudProviderFactory::supported_providers();
                tracing::info!(
                    ?supported_providers,
                    "startup: fetching provider refresh tokens"
                );

                for provider in supported_providers {
                    tracing::info!(provider, "startup: begin fetch provider token");
                    match auth_manager.fetch_provider_token(provider).await {
                        Ok(Some(token)) => {
                            tracing::info!(
                                provider,
                                "startup: fetched provider token successfully"
                            );
                            match storage::CloudProviderFactory::create(provider) {
                                Ok(mut p) => {
                                    tracing::info!(provider, "startup: created provider instance");
                                    if let Err(e) = p.initialize(token.to_string()).await {
                                        tracing::warn!(provider, error = ?e, "startup: provider initialize failed");
                                    } else {
                                        tracing::info!(
                                            provider,
                                            "startup: provider initialized successfully"
                                        );
                                    }
                                }
                                Err(e) => {
                                    tracing::warn!(provider, error = %e, "startup: provider factory create failed")
                                }
                            }
                        }
                        Ok(None) => tracing::info!(provider, "startup: no provider token for user"),
                        Err(e) => {
                            tracing::warn!(provider, error = %e, "startup: failed to fetch provider token")
                        }
                    }
                }
            }
            Err(e) => {
                tracing::warn!("startup: token validation/refresh failed: {} - will attempt background anonymous auth when game starts", e);

                // Do NOT open auth page here - wait for game to start
                // Background anonymous auth will be attempted from try_anonymous_auth() after Set::Basic
            }
        }
    } else {
        tracing::warn!("startup: no existing session found - will attempt background anonymous auth when game starts");

        // Do NOT open auth page here - wait for game to start
        // Background anonymous auth will be attempted from try_anonymous_auth() after Set::Basic
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
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
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
            #[cfg(feature = "gdrive")]
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
            cmd::tauri_cmd::retry_pending_uploads_now,
            cmd::tauri_cmd::retry_pending_upload_item_now,
            cmd::tauri_cmd::delete_pending_upload_item,
            cmd::tauri_cmd::get_pending_upload_retry_status,
            cmd::tauri_cmd::get_ship_growth_suppression_status,
            cmd::tauri_cmd::get_quest_tree_suppression_status,
            cmd::tauri_cmd::get_remodel_suppression_status,
            cmd::tauri_cmd::get_all_logs,
            #[cfg(dev)]
            cmd::tauri_cmd::open_debug_window,
            #[cfg(dev)]
            cmd::tauri_cmd::close_debug_window,
            #[cfg(dev)]
            cmd::tauri_cmd::read_emit_file,
        ])
        .setup(move |app: &mut tauri::App| {
            // Initialize ROAMING_DIR global first so all subsequent code can use get_ROAMING_DIR()
            builder_setup::setup::set_paths(app)?;

            // Initialize AuthManager
            let session_path = util::get_ROAMING_DIR().join("fusou-auth-session.json");
            let dataset_token_path = util::get_ROAMING_DIR().join("fusou-auth-dataset-token.json");
            let storage = Arc::new(FileStorage::new(session_path.clone()));

            let mut auth_manager =
                AuthManager::from_env(storage.clone()).expect("failed to create auth manager");

            // Set dataset_token persistent storage path
            auth_manager.set_dataset_token_path(Some(dataset_token_path));

            // Bridge app-specific capabilities into fusou-storage runtime hooks.
            // Keep dataset_id semantics aligned with pre-extraction behavior by
            // resolving through AuthManager.
            let auth_manager_for_storage_hooks = Arc::new(auth_manager.clone());
            if let Err(err) = crate::storage::set_dataset_id_resolver({
                let auth_manager = auth_manager_for_storage_hooks.clone();
                move || {
                    let auth_manager = auth_manager.clone();
                    async move {
                        auth_manager
                            .resolve_dataset_id_for_upload(None)
                            .await
                            .unwrap_or_default()
                    }
                }
            }) {
                tracing::debug!(%err, "storage dataset_id resolver hook already initialized");
            }

            let auth_manager_for_retry = Arc::new(auth_manager.clone());
            let auth_manager_state = Arc::new(Mutex::new(auth_manager.clone()));
            app.manage(auth_manager_state.clone());

            // Initialize PendingStore and UploadRetryService
            let pending_dir = util::get_ROAMING_DIR().join("pending_uploads");
            let pending_store = Arc::new(PendingStore::new(pending_dir));

            // Register app-level custom retry handler so pending items are retried and deleted on success
            let retry_handler =
                Arc::new(crate::storage::retry_handler::AppUploadRetryHandler::new(
                    auth_manager_for_retry.clone(),
                ));
            let retry_service = Arc::new(UploadRetryService::new(
                pending_store.clone(),
                auth_manager_for_retry,
                Some(retry_handler),
            ));

            app.manage(pending_store.clone());
            app.manage(retry_service.clone());

            // Ensure user config file path is initialized before reading retry settings.
            builder_setup::setup::setup_configs()?;

            // Kick retry on startup and keep retrying on configured interval.
            let retry_service_for_background = retry_service.clone();
            let retry_interval_seconds = configs::get_user_configs_for_app()
                .asset_sync
                .retry
                .get_interval_seconds()
                .max(1);
            tokio::spawn(async move {
                tracing::info!(
                    retry_interval_seconds,
                    "starting background pending upload retry loop"
                );
                tracing::info!("running one-time forced pending upload retry on startup");
                retry_service_for_background.trigger_retry_force().await;

                let mut ticker =
                    tokio::time::interval(std::time::Duration::from_secs(retry_interval_seconds));
                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                ticker.tick().await;
                loop {
                    ticker.tick().await;
                    retry_service_for_background.trigger_retry().await;
                }
            });

            // Initialize storage dependencies for submit_data
            let pending_store_clone = pending_store.clone();
            let retry_service_clone = retry_service.clone();
            tokio::spawn(async move {
                storage::submit_data::initialize_storage_deps(
                    pending_store_clone,
                    retry_service_clone,
                )
                .await;
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
                )
                .await;
            });

            // Initialize quest tree sender if configured
            {
                let app_configs = configs::get_user_configs_for_app();
                if app_configs.quest_tree_sender.get_enable() {
                    if let Some(ingest_endpoint) =
                        app_configs.quest_tree_sender.get_ingest_endpoint()
                    {
                        let auth_manager_for_quest = Arc::new(auth_manager.clone());
                        let quest_cache_root = util::get_ROAMING_DIR()
                            .join("cache")
                            .join("request_suppression")
                            .join("quest_tree_sender");
                        tracing::info!("starting quest tree sender");
                        quest_tree_sender::start(
                            ingest_endpoint,
                            auth_manager_for_quest,
                            pending_store.clone(),
                            retry_service.clone(),
                            quest_cache_root,
                        );
                    } else {
                        tracing::warn!(
                            "quest_tree_sender enabled but ingest_endpoint not configured"
                        );
                    }
                }

                if app_configs.ship_growth_sender.get_enable() {
                    if let Some(ingest_endpoint) =
                        app_configs.ship_growth_sender.get_ingest_endpoint()
                    {
                        let auth_manager_for_ship_growth = Arc::new(auth_manager.clone());
                        let ship_growth_cache_root = util::get_ROAMING_DIR()
                            .join("cache")
                            .join("request_suppression")
                            .join("ship_growth_sender");
                        tracing::info!("starting ship growth sender");
                        ship_growth_sender::start(
                            ingest_endpoint,
                            auth_manager_for_ship_growth,
                            pending_store.clone(),
                            retry_service.clone(),
                            ship_growth_cache_root,
                        );
                    } else {
                        tracing::warn!(
                            "ship_growth_sender enabled but ingest_endpoint not configured"
                        );
                    }
                }

                if app_configs.soku_speed_sender.get_enable() {
                    if let Some(ingest_endpoint) =
                        app_configs.soku_speed_sender.get_ingest_endpoint()
                    {
                        let auth_manager_for_soku_speed = Arc::new(auth_manager.clone());
                        let soku_speed_cache_root = util::get_ROAMING_DIR()
                            .join("cache")
                            .join("request_suppression")
                            .join("soku_speed_sender");
                        tracing::info!("starting soku_speed sender");
                        soku_speed_sender::start(
                            ingest_endpoint,
                            auth_manager_for_soku_speed,
                            pending_store.clone(),
                            retry_service.clone(),
                            soku_speed_cache_root,
                        );
                    } else {
                        tracing::warn!(
                            "soku_speed_sender enabled but ingest_endpoint not configured"
                        );
                    }
                }

                if app_configs.remodel_sender.get_enable() {
                    if let Some(ingest_endpoint) = app_configs.remodel_sender.get_ingest_endpoint()
                    {
                        let auth_manager_for_remodel = Arc::new(auth_manager.clone());
                        let remodel_cache_root = util::get_ROAMING_DIR()
                            .join("cache")
                            .join("request_suppression")
                            .join("remodel_sender");
                        tracing::info!("starting remodel sender");
                        remodel_sender::start(
                            ingest_endpoint,
                            auth_manager_for_remodel,
                            pending_store.clone(),
                            retry_service.clone(),
                            remodel_cache_root,
                        );
                    } else {
                        tracing::warn!("remodel_sender enabled but ingest_endpoint not configured");
                    }
                }
            }

            Ok(())
        })
        .on_window_event(move |window: &tauri::Window, event: &tauri::WindowEvent| {
            builder_setup::window_event::window_event_handler(window, event)
        });

    if let Err(e) = builder.run(ctx) {
        tracing::error!("error while building tauri application: {}", e);
    }
}
