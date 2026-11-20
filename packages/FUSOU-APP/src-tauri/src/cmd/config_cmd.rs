use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

use configs::ConfigPatchValue;
use serde::Serialize;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tokio_cron_scheduler::JobBuilder;
use url::Url;

use crate::builder_setup::setup::AppShutdownController;
use crate::util::get_ROAMING_DIR;

#[derive(Debug, Clone, Copy)]
struct ConfigKeySpec {
    key: &'static str,
    requires_restart: bool,
}

const EDITABLE_CONFIG_SPECS: &[ConfigKeySpec] = &[
    // General & Appearance
    ConfigKeySpec {
        key: "app.theme.theme",
        requires_restart: false,
    },
    ConfigKeySpec {
        key: "app.font.font_family",
        requires_restart: false,
    },
    ConfigKeySpec {
        key: "app.autostart.enable",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.connect_kc_server.kc_server_name",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.browser.external_screenshot_directory",
        requires_restart: false,
    },
    ConfigKeySpec {
        key: "app.browser.url",
        requires_restart: true,
    },
    // Discord Rich Presence
    ConfigKeySpec {
        key: "app.discord.enable_discord_integration",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.discord.use_custom_message",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.discord.custom_message",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.discord.custom_details",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.discord.use_custom_image",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.discord.custom_image_url",
        requires_restart: true,
    },
    // Map Cell Labels
    ConfigKeySpec {
        key: "app.map_cell_labels.bundle_url",
        requires_restart: true,
    },
    // Database & Storage
    ConfigKeySpec {
        key: "app.database.allow_data_to_shared_cloud",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.database.allow_data_to_local",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.database.integration_schedule_cron",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.database.local.output_directory",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.database.local.integration_batch_size",
        requires_restart: false,
    },
    ConfigKeySpec {
        key: "app.database.r2.upload_endpoint",
        requires_restart: false,
    },
    ConfigKeySpec {
        key: "app.database.r2.master_data_upload_endpoint",
        requires_restart: false,
    },
    // Asset Sync & Retry
    ConfigKeySpec {
        key: "app.asset_sync.asset_upload_enable",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.asset_sync.scan_interval_seconds",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.asset_sync.asset_upload_endpoint",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.asset_sync.fleet_snapshot_endpoint",
        requires_restart: false,
    },
    ConfigKeySpec {
        key: "app.asset_sync.kc_period_endpoint",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.asset_sync.asset_existing_keys_endpoint",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.asset_sync.asset_skip_extensions",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.asset_sync.retry.max_attempts",
        requires_restart: false,
    },
    ConfigKeySpec {
        key: "app.asset_sync.retry.ttl_seconds",
        requires_restart: false,
    },
    ConfigKeySpec {
        key: "app.asset_sync.retry.interval_seconds",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.asset_sync.retry.auth_backoff_seconds",
        requires_restart: false,
    },
    ConfigKeySpec {
        key: "app.asset_sync.retry.item_interval_seconds",
        requires_restart: false,
    },
    // Auth
    ConfigKeySpec {
        key: "app.auth.allow_auth",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.auth.auth_page_url",
        requires_restart: false,
    },
    ConfigKeySpec {
        key: "app.auth.anonymous_sync_v2_register_endpoint",
        requires_restart: false,
    },
    ConfigKeySpec {
        key: "app.auth.anonymous_sync_v2_challenge_endpoint",
        requires_restart: false,
    },
    ConfigKeySpec {
        key: "app.auth.anonymous_sync_v2_refresh_endpoint",
        requires_restart: false,
    },
    ConfigKeySpec {
        key: "app.auth.anonymous_sync_v2_complete_endpoint",
        requires_restart: false,
    },
    // Data Senders
    ConfigKeySpec {
        key: "app.quest_tree_sender.enable",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.quest_tree_sender.allow_data_to_local",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.quest_tree_sender.ingest_endpoint",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.ship_growth_sender.enable",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.ship_growth_sender.allow_data_to_local",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.ship_growth_sender.ingest_endpoint",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.soku_speed_sender.enable",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.soku_speed_sender.allow_data_to_local",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.soku_speed_sender.ingest_endpoint",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.remodel_sender.enable",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.remodel_sender.allow_data_to_local",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.remodel_sender.ingest_endpoint",
        requires_restart: true,
    },
    // Game Window
    ConfigKeySpec {
        key: "app.kc_window.default_inner_width",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.kc_window.default_inner_height",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.kc_window.max_inner_width",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.kc_window.max_inner_height",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.kc_window.resize_debounce_millis",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "app.kc_window.keep_window_size_duration_millis",
        requires_restart: false,
    },
    // Proxy
    ConfigKeySpec {
        key: "proxy.allow_save_api_requests",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.allow_save_api_responses",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.allow_save_resources",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.allow_save_main_js_local",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.save_file_location",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.network.enforce_http",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.network.set_nodelay",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.network.connect_timeout",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.network.keepalive_interval",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.network.recv_buffer_size",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.network.send_buffer_size",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.network.proxy_server_port",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.certificates.use_generated_certs",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.certificates.cert_file",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.certificates.key_file",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.pac.use_custom_pac",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.pac.pac_script",
        requires_restart: true,
    },
    ConfigKeySpec {
        key: "proxy.pac.pac_server_port",
        requires_restart: true,
    },
];

fn lookup_spec(key: &str) -> Option<&'static ConfigKeySpec> {
    EDITABLE_CONFIG_SPECS.iter().find(|spec| spec.key == key)
}

fn filter_editable_values(
    all_values: BTreeMap<String, ConfigPatchValue>,
) -> BTreeMap<String, ConfigPatchValue> {
    all_values
        .into_iter()
        .filter(|(key, _)| lookup_spec(key).is_some())
        .collect()
}

fn server_display_name(index: i32) -> &'static str {
    match index {
        1 => "横須賀鎮守府",
        2 => "新呉鎮守府",
        3 => "佐世保鎮守府",
        4 => "舞鶴鎮守府",
        5 => "大湊警備府",
        6 => "トラック泊地",
        7 => "リンガ泊地",
        8 => "ラバウル基地",
        9 => "ショートランド泊地",
        10 => "ブイン基地",
        11 => "タウイタウイ泊地",
        12 => "パラオ泊地",
        13 => "ブルネイ泊地",
        14 => "単冠湾泊地",
        15 => "幌筵泊地",
        16 => "宿毛湾泊地",
        17 => "鹿屋基地",
        18 => "岩川基地",
        19 => "佐伯湾泊地",
        20 => "柱島泊地",
        _ => "Unknown Server",
    }
}

fn validate_optional_http_url(
    key: &str,
    value: &str,
    allow_token_placeholder: bool,
) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let normalized = if allow_token_placeholder {
        trimmed.replace("{token}", "placeholder")
    } else {
        trimmed.to_string()
    };
    let parsed = Url::parse(&normalized).map_err(|err| format!("{key}: invalid URL ({err})"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("{key}: URL must use http or https scheme"));
    }
    Ok(())
}

fn validate_config_entry(key: &str, value: &ConfigPatchValue) -> Result<(), String> {
    if lookup_spec(key).is_none() {
        return Err(format!("Unsupported or read-only config key: {key}"));
    }

    match (key, value) {
        ("app.theme.theme", ConfigPatchValue::String(theme)) => {
            if !matches!(theme.as_str(), "light" | "dark") {
                return Err("app.theme.theme must be 'light' or 'dark'".to_string());
            }
        }
        (
            "proxy.network.proxy_server_port" | "proxy.pac.pac_server_port",
            ConfigPatchValue::Integer(port),
        ) => {
            if !(0..=65535).contains(port) {
                return Err(format!("{key} must be between 0 and 65535"));
            }
        }
        (
            "proxy.network.connect_timeout"
            | "proxy.network.keepalive_interval"
            | "proxy.network.recv_buffer_size"
            | "proxy.network.send_buffer_size",
            ConfigPatchValue::Integer(val),
        ) => {
            if *val < 0 {
                return Err(format!("{key} must be 0 or greater"));
            }
        }
        ("app.database.local.integration_batch_size", ConfigPatchValue::Integer(size)) => {
            if !(1..=10000).contains(size) {
                return Err(
                    "app.database.local.integration_batch_size must be between 1 and 10000"
                        .to_string(),
                );
            }
        }
        ("app.database.integration_schedule_cron", ConfigPatchValue::String(cron)) => {
            let trimmed = cron.trim();
            if trimmed.is_empty() {
                return Err("app.database.integration_schedule_cron cannot be empty".to_string());
            }
            JobBuilder::new()
                .with_cron_job_type()
                .with_schedule(trimmed)
                .map_err(|err| {
                    format!("app.database.integration_schedule_cron is invalid: {err}")
                })?;
        }
        (
            "app.asset_sync.scan_interval_seconds"
            | "app.asset_sync.retry.max_attempts"
            | "app.asset_sync.retry.interval_seconds"
            | "app.asset_sync.retry.auth_backoff_seconds",
            ConfigPatchValue::Integer(val),
        ) => {
            if *val < 1 {
                return Err(format!("{key} must be at least 1"));
            }
        }
        ("app.asset_sync.retry.ttl_seconds", ConfigPatchValue::Integer(val)) => {
            if *val < 60 {
                return Err("app.asset_sync.retry.ttl_seconds must be at least 60".to_string());
            }
        }
        ("app.asset_sync.retry.item_interval_seconds", ConfigPatchValue::Integer(val)) => {
            if *val < 0 {
                return Err(
                    "app.asset_sync.retry.item_interval_seconds must be 0 or greater".to_string(),
                );
            }
        }
        (
            "app.kc_window.default_inner_width"
            | "app.kc_window.default_inner_height"
            | "app.kc_window.max_inner_width"
            | "app.kc_window.max_inner_height",
            ConfigPatchValue::Integer(val),
        ) => {
            if !(200..=7680).contains(val) {
                return Err(format!("{key} must be between 200 and 7680"));
            }
        }
        (
            "app.kc_window.resize_debounce_millis"
            | "app.kc_window.keep_window_size_duration_millis",
            ConfigPatchValue::Integer(val),
        ) => {
            if !(0..=60000).contains(val) {
                return Err(format!("{key} must be between 0 and 60000"));
            }
        }
        (
            "app.browser.url"
            | "app.discord.custom_image_url"
            | "app.map_cell_labels.bundle_url"
            | "app.database.r2.upload_endpoint"
            | "app.database.r2.master_data_upload_endpoint"
            | "app.asset_sync.asset_upload_endpoint"
            | "app.asset_sync.fleet_snapshot_endpoint"
            | "app.asset_sync.kc_period_endpoint"
            | "app.asset_sync.asset_existing_keys_endpoint"
            | "app.auth.auth_page_url"
            | "app.auth.anonymous_sync_v2_register_endpoint"
            | "app.auth.anonymous_sync_v2_challenge_endpoint"
            | "app.auth.anonymous_sync_v2_refresh_endpoint"
            | "app.quest_tree_sender.ingest_endpoint"
            | "app.ship_growth_sender.ingest_endpoint"
            | "app.soku_speed_sender.ingest_endpoint"
            | "app.remodel_sender.ingest_endpoint",
            ConfigPatchValue::String(url),
        ) => {
            validate_optional_http_url(key, url, false)?;
        }
        ("app.auth.anonymous_sync_v2_complete_endpoint", ConfigPatchValue::String(url)) => {
            validate_optional_http_url(key, url, true)?;
        }
        _ => {}
    }

    Ok(())
}

#[derive(Debug, Serialize)]
pub struct KcServerOption {
    pub index: i32,
    pub hostname: String,
    pub label: String,
}

#[derive(Debug, Serialize)]
pub struct AppConfigsResponse {
    pub config_path: String,
    pub values: BTreeMap<String, ConfigPatchValue>,
    pub defaults: BTreeMap<String, ConfigPatchValue>,
    pub restart_required_keys: Vec<String>,
    pub server_list: Vec<KcServerOption>,
    pub platform: String,
}

#[derive(Debug, Serialize)]
pub struct SaveAppConfigsResponse {
    pub values: BTreeMap<String, ConfigPatchValue>,
    pub updated_keys: Vec<String>,
    pub restart_required: bool,
    pub restart_required_keys: Vec<String>,
}

fn build_server_options(servers: HashMap<i32, String>) -> Vec<KcServerOption> {
    let mut entries: Vec<(i32, String)> = servers.into_iter().collect();
    entries.sort_by_key(|(index, _)| *index);
    entries
        .into_iter()
        .map(|(index, hostname)| KcServerOption {
            index,
            label: format!("{} ({})", server_display_name(index), hostname),
            hostname,
        })
        .collect()
}

fn get_active_config_path() -> PathBuf {
    configs::get_user_config_path()
        .unwrap_or_else(|| get_ROAMING_DIR().join("user").join("configs.toml"))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_app_configs() -> Result<AppConfigsResponse, String> {
    let config_path = get_active_config_path();
    let values = configs::export_user_config_values()
        .map(filter_editable_values)
        .map_err(|err| format!("Failed to read user configs: {err}"))?;
    let defaults = filter_editable_values(configs::export_default_config_values());
    let restart_required_keys = EDITABLE_CONFIG_SPECS
        .iter()
        .filter(|spec| spec.requires_restart)
        .map(|spec| spec.key.to_string())
        .collect();
    let server_list = build_server_options(
        configs::get_user_configs_for_app()
            .connect_kc_server
            .get_all_servers(),
    );

    Ok(AppConfigsResponse {
        config_path: config_path.to_string_lossy().to_string(),
        values,
        defaults,
        restart_required_keys,
        server_list,
        platform: std::env::consts::OS.to_string(),
    })
}

#[tauri::command(rename_all = "snake_case")]
pub async fn save_app_configs(
    updates: BTreeMap<String, ConfigPatchValue>,
) -> Result<SaveAppConfigsResponse, String> {
    let current_values = configs::export_user_config_values()
        .map(filter_editable_values)
        .map_err(|err| format!("Failed to read current configs: {err}"))?;

    let mut changed_updates = BTreeMap::new();
    for (key, value) in updates {
        validate_config_entry(&key, &value)?;
        if current_values.get(&key) != Some(&value) {
            changed_updates.insert(key, value);
        }
    }

    if changed_updates.is_empty() {
        return Ok(SaveAppConfigsResponse {
            values: current_values,
            updated_keys: Vec::new(),
            restart_required: false,
            restart_required_keys: Vec::new(),
        });
    }

    let (_, all_updated_values) = configs::update_user_config_values(&changed_updates)
        .map_err(|err| format!("Failed to save configs: {err}"))?;

    let updated_keys: Vec<String> = changed_updates.keys().cloned().collect();
    let restart_required_keys: Vec<String> = updated_keys
        .iter()
        .filter(|key| {
            lookup_spec(key.as_str())
                .map(|spec| spec.requires_restart)
                .unwrap_or(true)
        })
        .cloned()
        .collect();

    Ok(SaveAppConfigsResponse {
        values: filter_editable_values(all_updated_values),
        updated_keys,
        restart_required: !restart_required_keys.is_empty(),
        restart_required_keys,
    })
}

#[tauri::command(rename_all = "snake_case")]
pub async fn restart_app(
    app: tauri::AppHandle,
    shutdown: tauri::State<'_, AppShutdownController>,
) -> Result<(), String> {
    tracing::info!("Restart requested from Settings UI");
    shutdown.request_restart(&app);
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn open_config_file(app: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_active_config_path();
    app.opener()
        .open_path(config_path.to_string_lossy(), None::<&str>)
        .map_err(|err| format!("Failed to open configs.toml: {err}"))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn pick_config_path(
    app: tauri::AppHandle,
    mode: String,
    current_path: Option<String>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file();

    if let Some(existing) = current_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        let existing_path = PathBuf::from(existing);
        let dir = if existing_path.is_dir() {
            Some(existing_path)
        } else {
            existing_path
                .parent()
                .filter(|parent| parent.is_dir())
                .map(PathBuf::from)
        };
        if let Some(dir) = dir {
            builder = builder.set_directory(dir);
        }
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    match mode.as_str() {
        "directory" => {
            builder.pick_folder(move |folder| {
                let resolved = folder.and_then(|p| p.into_path().ok());
                let _ = tx.send(resolved);
            });
        }
        "file" => {
            builder.pick_file(move |file| {
                let resolved = file.and_then(|p| p.into_path().ok());
                let _ = tx.send(resolved);
            });
        }
        other => {
            return Err(format!("Unsupported picker mode: {other}"));
        }
    }

    let selected = rx
        .await
        .map_err(|_| "File picker dialog was cancelled unexpectedly".to_string())?;
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn configs_toml_keys_are_exhaustively_covered_with_zero_exceptions() {
        let defaults = configs::export_default_config_values();
        let default_keys: BTreeSet<&str> = defaults.keys().map(String::as_str).collect();

        let mut editable_keys = BTreeSet::new();
        for spec in EDITABLE_CONFIG_SPECS {
            assert!(
                editable_keys.insert(spec.key),
                "Duplicate key '{}' in EDITABLE_CONFIG_SPECS",
                spec.key
            );
        }

        let uncovered_in_toml: Vec<&str> =
            default_keys.difference(&editable_keys).copied().collect();
        assert!(
            uncovered_in_toml.is_empty(),
            "New or unmapped key(s) in packages/configs/configs.toml must be added to EDITABLE_CONFIG_SPECS and Settings UI: {:?}",
            uncovered_in_toml
        );

        let stale_in_specs: Vec<&str> = editable_keys.difference(&default_keys).copied().collect();
        assert!(
            stale_in_specs.is_empty(),
            "Key(s) listed in EDITABLE_CONFIG_SPECS no longer exist in packages/configs/configs.toml: {:?}",
            stale_in_specs
        );
    }

    #[test]
    fn validation_accepts_valid_and_rejects_invalid_values() {
        assert!(validate_config_entry(
            "app.theme.theme",
            &ConfigPatchValue::String("dark".to_string())
        )
        .is_ok());
        assert!(validate_config_entry(
            "app.theme.theme",
            &ConfigPatchValue::String("solarized".to_string())
        )
        .is_err());

        assert!(validate_config_entry(
            "proxy.network.proxy_server_port",
            &ConfigPatchValue::Integer(8080)
        )
        .is_ok());
        assert!(validate_config_entry(
            "proxy.network.proxy_server_port",
            &ConfigPatchValue::Integer(70000)
        )
        .is_err());

        assert!(validate_config_entry(
            "app.database.integration_schedule_cron",
            &ConfigPatchValue::String("0 0 * * * *".to_string())
        )
        .is_ok());
        assert!(validate_config_entry(
            "app.database.integration_schedule_cron",
            &ConfigPatchValue::String("not a cron".to_string())
        )
        .is_err());

        assert!(validate_config_entry(
            "app.auth.anonymous_sync_v2_complete_endpoint",
            &ConfigPatchValue::String(
                "https://fusou.dev/api/auth/anonymous-sync/v2/pending/{token}/complete".to_string()
            )
        )
        .is_ok());
        assert!(validate_config_entry(
            "app.browser.url",
            &ConfigPatchValue::String("ftp://example.com".to_string())
        )
        .is_err());

        assert!(
            validate_config_entry("version", &ConfigPatchValue::String("0.5.0".to_string()))
                .is_err()
        );
    }

    #[test]
    fn immediate_vs_restart_classification_matches_runtime_behavior() {
        assert!(!lookup_spec("app.theme.theme").unwrap().requires_restart);
        assert!(
            !lookup_spec("app.font.font_family")
                .unwrap()
                .requires_restart
        );
        assert!(
            !lookup_spec("app.browser.external_screenshot_directory")
                .unwrap()
                .requires_restart
        );
        assert!(
            lookup_spec("app.database.allow_data_to_local")
                .unwrap()
                .requires_restart
        );
        assert!(
            lookup_spec("proxy.allow_save_api_responses")
                .unwrap()
                .requires_restart
        );
        assert!(
            lookup_spec("app.discord.enable_discord_integration")
                .unwrap()
                .requires_restart
        );
    }
}
