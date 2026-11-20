extern crate serde;
extern crate toml;

use crate::migrations::{self, ConfigVersion};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, RwLock};

use once_cell::sync::OnceCell;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsProxyCertificates {
    use_generated_certs: Option<bool>,
    cert_file: Option<String>,
    key_file: Option<String>,
}

impl ConfigsProxyCertificates {
    pub fn get_use_generated_certs(&self) -> bool {
        self.use_generated_certs.unwrap_or_else(|| {
            get_default_configs()
                .proxy
                .certificates
                .use_generated_certs
                .unwrap()
        })
    }

    pub fn get_cert_file(&self) -> Option<PathBuf> {
        self.cert_file.clone().map(PathBuf::from)
    }

    pub fn get_key_file(&self) -> Option<PathBuf> {
        self.key_file.clone().map(PathBuf::from)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsProxyPac {
    use_custom_pac: Option<bool>,
    pac_script: Option<String>,
    pac_server_port: Option<i64>,
}

impl ConfigsProxyPac {
    pub fn get_use_custom_pac(&self) -> bool {
        self.use_custom_pac
            .unwrap_or_else(|| get_default_configs().proxy.pac.use_custom_pac.unwrap())
    }

    pub fn get_pac_script(&self) -> Option<String> {
        self.pac_script.clone()
    }

    pub fn get_pac_server_port(&self) -> u16 {
        self.pac_server_port
            .map(|v| match v {
                port if port < 0 => 0,
                port if port > 65535 => 65535,
                _ => v,
            })
            .unwrap_or_else(|| get_default_configs().proxy.pac.pac_server_port.unwrap())
            as u16
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsProxyNetwork {
    enforce_http: Option<bool>,
    set_nodelay: Option<bool>,
    connect_timeout: Option<i64>,
    keepalive_interval: Option<i64>,
    recv_buffer_size: Option<i64>,
    send_buffer_size: Option<i64>,
    proxy_server_port: Option<i64>,
}

impl ConfigsProxyNetwork {
    pub fn get_enforce_http(&self) -> bool {
        self.enforce_http
            .unwrap_or_else(|| get_default_configs().proxy.network.enforce_http.unwrap())
    }

    pub fn get_set_nodelay(&self) -> bool {
        self.set_nodelay
            .unwrap_or_else(|| get_default_configs().proxy.network.set_nodelay.unwrap())
    }

    pub fn get_connect_timeout(&self) -> Option<std::time::Duration> {
        match self.connect_timeout {
            Some(v) if v <= 0 => None,
            Some(v) => Some(std::time::Duration::from_secs(v as u64)),
            None => None,
        }
    }

    pub fn get_keepalive_interval(&self) -> Option<std::time::Duration> {
        match self.keepalive_interval {
            Some(v) if v <= 0 => None,
            Some(v) => Some(std::time::Duration::from_secs(v as u64)),
            None => None,
        }
    }

    pub fn get_recv_buffer_size(&self) -> Option<usize> {
        match self.recv_buffer_size {
            Some(v) if v < 0 => Some(0),
            Some(v) => Some(v as usize),
            None => None,
        }
    }

    pub fn get_send_buffer_size(&self) -> Option<usize> {
        match self.send_buffer_size {
            Some(v) if v < 0 => Some(0),
            Some(v) => Some(v as usize),
            None => None,
        }
    }

    pub fn get_proxy_server_port(&self) -> u16 {
        self.proxy_server_port
            .map(|v| match v {
                port if port < 0 => 0,
                port if port > 65535 => 65535,
                _ => v,
            })
            .unwrap_or_else(|| {
                get_default_configs()
                    .proxy
                    .network
                    .proxy_server_port
                    .unwrap()
            }) as u16
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppConnectKcServer {
    kc_server_name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_server_list")]
    server_list: Option<std::collections::HashMap<i32, String>>,
}

fn deserialize_server_list<'de, D>(
    deserializer: D,
) -> Result<Option<std::collections::HashMap<i32, String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let entries = std::collections::HashMap::<String, String>::deserialize(deserializer)?;
    entries
        .into_iter()
        .map(|(key, value)| {
            key.parse::<i32>()
                .map(|index| (index, value))
                .map_err(serde::de::Error::custom)
        })
        .collect::<Result<std::collections::HashMap<_, _>, _>>()
        .map(Some)
}

impl ConfigsAppConnectKcServer {
    pub fn get_kc_server_name(&self) -> Option<String> {
        match self.kc_server_name {
            Some(ref v) if !v.is_empty() => Some(v.clone()),
            _ => None,
        }
    }

    pub fn get_server_address(&self, server_index: i32) -> Option<String> {
        if let Some(map) = &self.server_list {
            map.get(&server_index).cloned()
        } else {
            // Return default server list if not configured
            self.get_default_server_address(server_index)
        }
    }

    fn get_default_server_address(&self, server_index: i32) -> Option<String> {
        get_default_configs()
            .app
            .connect_kc_server
            .server_list
            .as_ref()
            .and_then(|map| map.get(&server_index).cloned())
    }

    pub fn get_all_servers(&self) -> std::collections::HashMap<i32, String> {
        if let Some(map) = &self.server_list {
            map.clone()
        } else {
            self.get_default_servers()
        }
    }

    fn get_default_servers(&self) -> std::collections::HashMap<i32, String> {
        get_default_configs()
            .app
            .connect_kc_server
            .server_list
            .clone()
            .unwrap_or_default()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppBrowser {
    url: Option<String>,
    external_screenshot_directory: Option<String>,
}

impl ConfigsAppBrowser {
    pub fn get_url(&self) -> Option<String> {
        match self.url {
            Some(ref v) if !v.is_empty() => Some(v.clone()),
            _ => None,
        }
    }

    pub fn get_external_screenshot_directory(&self) -> Option<String> {
        self.external_screenshot_directory
            .as_ref()
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
            .map(|v| v.to_string())
            .or_else(|| {
                get_default_configs()
                    .app
                    .browser
                    .external_screenshot_directory
                    .as_ref()
                    .map(|v| v.trim())
                    .filter(|v| !v.is_empty())
                    .map(|v| v.to_string())
            })
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppAutostart {
    enable: Option<bool>,
}

impl ConfigsAppAutostart {
    pub fn get_enable_autostart(&self) -> bool {
        self.enable
            .unwrap_or_else(|| get_default_configs().app.autostart.enable.unwrap())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppTheme {
    theme: Option<String>,
}

impl ConfigsAppTheme {
    pub fn get_theme(&self) -> String {
        self.theme
            .clone()
            .unwrap_or_else(|| get_default_configs().app.theme.theme.clone().unwrap())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigAppFont {
    font_family: Option<String>,
}

impl ConfigAppFont {
    pub fn get_font_family(&self) -> String {
        self.font_family
            .clone()
            .unwrap_or_else(|| get_default_configs().app.font.font_family.clone().unwrap())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppDiscord {
    enable_discord_integration: Option<bool>,
    use_custom_message: Option<bool>,
    custom_message: Option<String>,
    custom_details: Option<String>,
    use_custom_image: Option<bool>,
    custom_image_url: Option<String>,
}

impl ConfigsAppDiscord {
    pub fn get_enable_discord_integration(&self) -> bool {
        self.enable_discord_integration.unwrap_or_else(|| {
            get_default_configs()
                .app
                .discord
                .enable_discord_integration
                .unwrap()
        })
    }

    pub fn get_use_custom_message(&self) -> bool {
        self.use_custom_message.unwrap_or_else(|| {
            get_default_configs()
                .app
                .discord
                .use_custom_message
                .unwrap()
        })
    }

    pub fn get_custom_message(&self) -> String {
        match self.custom_message {
            Some(ref v) if !v.is_empty() => v.clone(),
            _ => "".to_string(),
        }
    }

    pub fn get_custom_details(&self) -> String {
        match self.custom_details {
            Some(ref v) if !v.is_empty() => v.clone(),
            _ => "".to_string(),
        }
    }

    pub fn get_use_custom_image(&self) -> bool {
        self.use_custom_image
            .unwrap_or_else(|| get_default_configs().app.discord.use_custom_image.unwrap())
    }

    pub fn get_custom_image_url(&self) -> String {
        match self.custom_image_url {
            Some(ref v) => v.clone(),
            None => "".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppDatabaseLocal {
    output_directory: Option<String>,
    integration_batch_size: Option<i32>,
}

impl ConfigsAppDatabaseLocal {
    pub fn get_output_directory(&self) -> Option<String> {
        match self.output_directory {
            Some(ref v) if !v.is_empty() => Some(v.clone()),
            _ => None,
        }
    }

    pub fn get_integration_batch_size(&self) -> i32 {
        match self.integration_batch_size {
            Some(v) if v <= 0 => 500,
            Some(v) if v > 10000 => 10000,
            Some(v) => v,
            None => get_default_configs()
                .app
                .database
                .local
                .integration_batch_size
                .unwrap_or(500),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppDatabaseR2 {
    upload_endpoint: Option<String>,
    master_data_upload_endpoint: Option<String>,
}

impl ConfigsAppDatabaseR2 {
    pub fn get_upload_endpoint(&self) -> Option<String> {
        match self.upload_endpoint {
            Some(ref v) if !v.trim().is_empty() => Some(v.trim().to_string()),
            _ => None,
        }
    }

    pub fn get_master_data_upload_endpoint(&self) -> Option<String> {
        match self.master_data_upload_endpoint {
            Some(ref v) if !v.trim().is_empty() => Some(v.trim().to_string()),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppDatabase {
    allow_data_to_shared_cloud: Option<bool>,
    allow_data_to_local: Option<bool>,
    integration_schedule_cron: Option<String>,
    pub local: ConfigsAppDatabaseLocal,
    pub r2: ConfigsAppDatabaseR2,
}

impl ConfigsAppDatabase {
    pub fn get_allow_data_to_shared_cloud(&self) -> bool {
        self.allow_data_to_shared_cloud.unwrap_or_else(|| {
            get_default_configs()
                .app
                .database
                .allow_data_to_shared_cloud
                .unwrap()
        })
    }

    pub fn get_allow_data_to_local(&self) -> bool {
        self.allow_data_to_local.unwrap_or_else(|| {
            get_default_configs()
                .app
                .database
                .allow_data_to_local
                .unwrap()
        })
    }

    pub fn get_integration_schedule_cron(&self) -> String {
        self.integration_schedule_cron.clone().unwrap_or_else(|| {
            get_default_configs()
                .app
                .database
                .integration_schedule_cron
                .clone()
                .unwrap_or_default()
        })
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppAssetSync {
    asset_upload_enable: Option<bool>,
    scan_interval_seconds: Option<u64>,
    asset_upload_endpoint: Option<String>,
    fleet_snapshot_endpoint: Option<String>,
    r2_upload_endpoint: Option<String>,
    kc_period_endpoint: Option<String>,
    asset_skip_extensions: Option<Vec<String>>,
    asset_existing_keys_endpoint: Option<String>,
    finder_tag: Option<String>,
    pub retry: ConfigsAppAssetSyncRetry,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppAssetSyncRetry {
    max_attempts: Option<u32>,
    ttl_seconds: Option<u64>,
    interval_seconds: Option<u64>,
    auth_backoff_seconds: Option<u64>,
    item_interval_seconds: Option<u64>,
}

impl ConfigsAppAssetSyncRetry {
    pub fn get_max_attempts(&self) -> u32 {
        self.max_attempts.unwrap_or_else(|| {
            get_default_configs()
                .app
                .asset_sync
                .retry
                .max_attempts
                .unwrap()
        })
    }

    pub fn get_ttl_seconds(&self) -> u64 {
        self.ttl_seconds.unwrap_or_else(|| {
            get_default_configs()
                .app
                .asset_sync
                .retry
                .ttl_seconds
                .unwrap()
        })
    }

    pub fn get_interval_seconds(&self) -> u64 {
        self.interval_seconds.unwrap_or_else(|| {
            get_default_configs()
                .app
                .asset_sync
                .retry
                .interval_seconds
                .unwrap()
        })
    }

    pub fn get_auth_backoff_seconds(&self) -> u64 {
        self.auth_backoff_seconds.unwrap_or_else(|| {
            get_default_configs()
                .app
                .asset_sync
                .retry
                .auth_backoff_seconds
                .unwrap()
        })
    }

    pub fn get_item_interval_seconds(&self) -> u64 {
        self.item_interval_seconds.unwrap_or_else(|| {
            get_default_configs()
                .app
                .asset_sync
                .retry
                .item_interval_seconds
                .unwrap()
        })
    }
}

impl ConfigsAppAssetSync {
    pub fn get_enable(&self) -> bool {
        // Backward-compatible wrapper
        self.get_asset_upload_enable()
    }

    pub fn get_asset_upload_enable(&self) -> bool {
        self.asset_upload_enable.unwrap_or_else(|| {
            get_default_configs()
                .app
                .asset_sync
                .asset_upload_enable
                .unwrap()
        })
    }

    pub fn get_scan_interval_seconds(&self) -> u64 {
        match self.scan_interval_seconds {
            Some(v) if v == 0 => get_default_configs()
                .app
                .asset_sync
                .scan_interval_seconds
                .unwrap(),
            Some(v) => v,
            None => get_default_configs()
                .app
                .asset_sync
                .scan_interval_seconds
                .unwrap(),
        }
    }

    pub fn get_api_endpoint(&self) -> Option<String> {
        // Backward-compatible wrapper for code that still calls `get_api_endpoint()`
        self.get_asset_upload_endpoint()
    }

    pub fn get_asset_upload_endpoint(&self) -> Option<String> {
        match self.asset_upload_endpoint {
            Some(ref v) if !v.trim().is_empty() => Some(v.trim().to_string()),
            _ => None,
        }
    }

    // Backward-compatible wrappers for older getter names
    pub fn get_asset_sync_api_endpoint(&self) -> Option<String> {
        self.get_asset_upload_endpoint()
    }

    pub fn get_snapshot_endpoint(&self) -> Option<String> {
        // Backward-compatible wrapper
        self.get_fleet_snapshot_endpoint()
    }

    pub fn get_fleet_snapshot_endpoint(&self) -> Option<String> {
        match self.fleet_snapshot_endpoint {
            Some(ref v) if !v.trim().is_empty() => Some(v.trim().to_string()),
            _ => None,
        }
    }

    /// New R2 upload endpoint
    pub fn get_r2_upload_endpoint(&self) -> Option<String> {
        match self.r2_upload_endpoint {
            Some(ref v) if !v.trim().is_empty() => Some(v.trim().to_string()),
            _ => None,
        }
    }

    // Backward-compatible wrapper
    pub fn get_asset_sync_snapshot_endpoint(&self) -> Option<String> {
        self.get_fleet_snapshot_endpoint()
    }

    pub fn get_period_endpoint(&self) -> Option<String> {
        // Backward-compatible wrapper
        self.get_kc_period_endpoint()
    }

    pub fn get_kc_period_endpoint(&self) -> Option<String> {
        match self.kc_period_endpoint {
            Some(ref v) if !v.trim().is_empty() => Some(v.trim().to_string()),
            _ => None,
        }
    }

    // Backward-compatible wrapper
    pub fn get_asset_sync_period_endpoint(&self) -> Option<String> {
        self.get_kc_period_endpoint()
    }

    pub fn get_skip_extensions(&self) -> Vec<String> {
        // Backward-compatible wrapper for `asset_skip_extensions`
        self.get_asset_skip_extensions()
    }

    pub fn get_asset_skip_extensions(&self) -> Vec<String> {
        self.asset_skip_extensions
            .as_ref()
            .map(|vec| {
                vec.iter()
                    .filter_map(|value| {
                        let trimmed = value.trim().trim_start_matches('.');
                        if trimmed.is_empty() {
                            None
                        } else {
                            Some(trimmed.to_ascii_lowercase())
                        }
                    })
                    .collect()
            })
            .unwrap_or_else(|| {
                get_default_configs()
                    .app
                    .asset_sync
                    .asset_skip_extensions
                    .as_ref()
                    .map(|vec| {
                        vec.iter()
                            .filter_map(|value| {
                                let trimmed = value.trim().trim_start_matches('.');
                                if trimmed.is_empty() {
                                    None
                                } else {
                                    Some(trimmed.to_ascii_lowercase())
                                }
                            })
                            .collect()
                    })
                    .unwrap_or_default()
            })
    }

    pub fn get_existing_keys_endpoint(&self) -> Option<String> {
        // Backward-compatible wrapper
        self.get_asset_existing_keys_endpoint()
    }

    pub fn get_asset_existing_keys_endpoint(&self) -> Option<String> {
        match self.asset_existing_keys_endpoint {
            Some(ref v) if !v.trim().is_empty() => Some(v.trim().to_string()),
            _ => None,
        }
    }

    // Backward-compatible wrapper
    pub fn get_asset_sync_existing_keys_endpoint(&self) -> Option<String> {
        self.get_asset_existing_keys_endpoint()
    }

    pub fn get_finder_tag(&self) -> Option<String> {
        self.finder_tag.clone()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppAuth {
    allow_auth: Option<bool>,
    auth_page_url: Option<String>,
    anonymous_sync_v2_register_endpoint: Option<String>,
    anonymous_sync_v2_challenge_endpoint: Option<String>,
    anonymous_sync_v2_refresh_endpoint: Option<String>,
    anonymous_sync_v2_complete_endpoint: Option<String>,
}

impl ConfigsAppAuth {
    pub fn get_allow_auth(&self) -> bool {
        self.allow_auth
            .unwrap_or_else(|| get_default_configs().app.auth.allow_auth.unwrap())
    }

    pub fn get_auth_page_url(&self) -> String {
        match &self.auth_page_url {
            Some(v) if !v.is_empty() => v.clone(),
            _ => get_default_configs()
                .app
                .auth
                .auth_page_url
                .clone()
                .unwrap(),
        }
    }

    /// v2 anonymous-sync の各エンドポイント URL を返す。
    /// 未設定の場合は configs.toml のデフォルト値にフォールバックし、
    /// それも未設定なら `None` を返す (=> 呼び出し側でエラー扱いとする)。
    pub fn get_anonymous_sync_v2_register_endpoint(&self) -> Option<String> {
        match &self.anonymous_sync_v2_register_endpoint {
            Some(v) if !v.trim().is_empty() => Some(v.trim().to_string()),
            _ => get_default_configs()
                .app
                .auth
                .anonymous_sync_v2_register_endpoint
                .as_ref()
                .map(|s| s.trim().to_string()),
        }
    }

    pub fn get_anonymous_sync_v2_challenge_endpoint(&self) -> Option<String> {
        match &self.anonymous_sync_v2_challenge_endpoint {
            Some(v) if !v.trim().is_empty() => Some(v.trim().to_string()),
            _ => get_default_configs()
                .app
                .auth
                .anonymous_sync_v2_challenge_endpoint
                .as_ref()
                .map(|s| s.trim().to_string()),
        }
    }

    pub fn get_anonymous_sync_v2_refresh_endpoint(&self) -> Option<String> {
        match &self.anonymous_sync_v2_refresh_endpoint {
            Some(v) if !v.trim().is_empty() => Some(v.trim().to_string()),
            _ => get_default_configs()
                .app
                .auth
                .anonymous_sync_v2_refresh_endpoint
                .as_ref()
                .map(|s| s.trim().to_string()),
        }
    }

    pub fn get_anonymous_sync_v2_complete_endpoint(&self) -> Option<String> {
        match &self.anonymous_sync_v2_complete_endpoint {
            Some(v) if !v.trim().is_empty() => Some(v.trim().to_string()),
            _ => get_default_configs()
                .app
                .auth
                .anonymous_sync_v2_complete_endpoint
                .as_ref()
                .map(|s| s.trim().to_string()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppWindow {
    resize_debounce_millis: Option<u64>,
    keep_window_size_duration_millis: Option<u64>,
    max_inner_width: Option<u32>,
    max_inner_height: Option<u32>,
    default_inner_width: Option<u32>,
    default_inner_height: Option<u32>,
}

impl ConfigsAppWindow {
    #[cfg(target_os = "linux")]
    pub fn get_resize_debounce_millis(&self) -> u64 {
        self.resize_debounce_millis.unwrap_or_else(|| {
            get_default_configs()
                .app
                .kc_window
                .resize_debounce_millis
                .unwrap()
        })
    }
    #[cfg(target_os = "linux")]
    pub fn get_keep_window_size_duration_millis(&self) -> u64 {
        self.keep_window_size_duration_millis.unwrap_or_else(|| {
            get_default_configs()
                .app
                .kc_window
                .keep_window_size_duration_millis
                .unwrap()
        })
    }
    pub fn get_max_inner_width(&self) -> u32 {
        self.max_inner_width
            .unwrap_or_else(|| get_default_configs().app.kc_window.max_inner_width.unwrap())
    }
    pub fn get_max_inner_height(&self) -> u32 {
        self.max_inner_height.unwrap_or_else(|| {
            get_default_configs()
                .app
                .kc_window
                .max_inner_height
                .unwrap()
        })
    }
    pub fn get_default_inner_width(&self) -> u32 {
        self.default_inner_width.unwrap_or_else(|| {
            get_default_configs()
                .app
                .kc_window
                .default_inner_width
                .unwrap()
        })
    }
    pub fn get_default_inner_height(&self) -> u32 {
        self.default_inner_height.unwrap_or_else(|| {
            get_default_configs()
                .app
                .kc_window
                .default_inner_height
                .unwrap()
        })
    }
}

macro_rules! define_sender_config {
    ($struct_name:ident, $field:ident) => {
        #[derive(Debug, Serialize, Deserialize, Clone)]
        pub struct $struct_name {
            enable: Option<bool>,
            allow_data_to_local: Option<bool>,
            ingest_endpoint: Option<String>,
        }

        impl $struct_name {
            pub fn get_enable(&self) -> bool {
                self.enable
                    .unwrap_or_else(|| get_default_configs().app.$field.enable.unwrap())
            }

            pub fn get_allow_data_to_local(&self) -> bool {
                self.allow_data_to_local.unwrap_or_else(|| {
                    get_default_configs()
                        .app
                        .$field
                        .allow_data_to_local
                        .unwrap()
                })
            }

            pub fn get_ingest_endpoint(&self) -> Option<String> {
                match self.ingest_endpoint {
                    Some(ref v) if !v.trim().is_empty() => Some(v.trim().to_string()),
                    _ => None,
                }
            }
        }
    };
}

define_sender_config!(ConfigsAppQuestTreeSender, quest_tree_sender);
define_sender_config!(ConfigsAppShipGrowthSender, ship_growth_sender);
define_sender_config!(ConfigsAppSokuSpeedSender, soku_speed_sender);
define_sender_config!(ConfigsAppRemodelSender, remodel_sender);

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ConfigsAppMapCellLabels {
    bundle_url: Option<String>,
}

impl ConfigsAppMapCellLabels {
    pub fn get_bundle_url(&self) -> Option<String> {
        self.bundle_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .or_else(|| {
                get_default_configs()
                    .app
                    .map_cell_labels
                    .bundle_url
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_owned)
            })
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsApp {
    pub connect_kc_server: ConfigsAppConnectKcServer,
    pub browser: ConfigsAppBrowser,
    pub autostart: ConfigsAppAutostart,
    pub theme: ConfigsAppTheme,
    pub font: ConfigAppFont,
    pub discord: ConfigsAppDiscord,
    pub database: ConfigsAppDatabase,
    pub asset_sync: ConfigsAppAssetSync,
    #[serde(default)]
    pub map_cell_labels: ConfigsAppMapCellLabels,
    pub auth: ConfigsAppAuth,
    pub kc_window: ConfigsAppWindow,
    pub quest_tree_sender: ConfigsAppQuestTreeSender,
    pub ship_growth_sender: ConfigsAppShipGrowthSender,
    pub soku_speed_sender: ConfigsAppSokuSpeedSender,
    pub remodel_sender: ConfigsAppRemodelSender,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsProxy {
    allow_save_api_requests: Option<bool>,
    allow_save_api_responses: Option<bool>,
    allow_save_resources: Option<bool>,
    allow_save_main_js_local: Option<bool>,
    save_file_location: Option<String>,
    pub network: ConfigsProxyNetwork,
    pub certificates: ConfigsProxyCertificates,
    pub pac: ConfigsProxyPac,
}

impl ConfigsProxy {
    pub fn get_allow_save_api_requests(&self) -> bool {
        self.allow_save_api_requests
            .unwrap_or_else(|| get_default_configs().proxy.allow_save_api_requests.unwrap())
    }

    pub fn get_allow_save_api_responses(&self) -> bool {
        self.allow_save_api_responses.unwrap_or_else(|| {
            get_default_configs()
                .proxy
                .allow_save_api_responses
                .unwrap()
        })
    }

    pub fn get_allow_save_resources(&self) -> bool {
        self.allow_save_resources
            .unwrap_or_else(|| get_default_configs().proxy.allow_save_resources.unwrap())
    }

    pub fn get_allow_save_main_js_local(&self) -> bool {
        self.allow_save_main_js_local.unwrap_or_else(|| {
            get_default_configs()
                .proxy
                .allow_save_main_js_local
                .unwrap()
        })
    }

    pub fn get_save_file_location(&self) -> Option<String> {
        match self.save_file_location {
            Some(ref v) if !v.is_empty() => Some(v.clone()),
            _ => None,
        }
    }
}

#[cfg(target_os = "linux")]
static XDG_SESSION_TYPE: OnceCell<Option<WindowsSystem>> = OnceCell::new();

#[cfg(target_os = "linux")]
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum WindowsSystem {
    X11,
    Wayland,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigEnv {}

impl ConfigEnv {
    #[cfg(target_os = "linux")]
    pub fn get_window_system_type(&self) -> Option<WindowsSystem> {
        XDG_SESSION_TYPE
            .get_or_init(|| match std::env::var("XDG_SESSION_TYPE") {
                Ok(session_type) => {
                    tracing::info!("XDG_SESSION_TYPE: {}", session_type);
                    match session_type.as_str() {
                        "x11" => Some(WindowsSystem::X11),
                        "wayland" => Some(WindowsSystem::Wayland),
                        _ => None,
                    }
                }
                Err(e) => {
                    tracing::error!("Couldn't read XDG_SESSION_TYPE: {}", e);
                    None
                }
            })
            .clone()
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Configs {
    version: Option<String>,
    pub proxy: ConfigsProxy,
    pub app: ConfigsApp,
    pub env: ConfigEnv,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ConfigPatchValue {
    Bool(bool),
    Integer(i64),
    String(String),
    StringArray(Vec<String>),
}

static USER_CONFIGS: LazyLock<RwLock<Option<Configs>>> = LazyLock::new(|| RwLock::new(None));
static USER_CONFIG_PATH: LazyLock<RwLock<Option<PathBuf>>> = LazyLock::new(|| RwLock::new(None));
static DEFAULT_USER_CONFIGS: OnceCell<Configs> = OnceCell::new();

const DEFAULT_TOML_FILE: &str = include_str!("../configs.toml");

/// Get the default configs parsed from embedded configs.toml
fn get_default_configs() -> &'static Configs {
    DEFAULT_USER_CONFIGS.get_or_init(|| {
        toml::from_str(DEFAULT_TOML_FILE).expect("Failed to parse embedded configs.toml")
    })
}

pub fn get_user_config_path() -> Option<PathBuf> {
    USER_CONFIG_PATH
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

pub fn set_user_config(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let config = get_configs(path)?;
    {
        let mut guard = USER_CONFIGS.write().unwrap_or_else(|e| e.into_inner());
        *guard = Some(config);
    }
    {
        let mut path_guard = USER_CONFIG_PATH.write().unwrap_or_else(|e| e.into_inner());
        *path_guard = Some(PathBuf::from(path));
    }
    Ok(())
}

pub fn get_configs(config_path: &str) -> Result<Configs, Box<dyn std::error::Error>> {
    use toml_edit::DocumentMut;

    tracing::info!("Loading configs from: {}", config_path);
    let mut default_doc = DEFAULT_TOML_FILE.parse::<DocumentMut>()?;
    let default_configs = toml::from_str::<Configs>(DEFAULT_TOML_FILE)?;
    let current_version = semver::Version::parse(env!("CARGO_PKG_VERSION"))?;
    let default_version = migrations::read_config_version(&default_doc)?;
    if default_version != ConfigVersion::Crate(current_version.clone()) {
        return Err(Box::new(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Default config version must match configs crate version {current_version}"),
        )));
    }
    DEFAULT_USER_CONFIGS.get_or_init(|| default_configs.clone());

    let original_config = match fs::read_to_string(config_path) {
        Ok(contents) => Some(contents),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(Box::new(error)),
    };
    let mut user_doc = match &original_config {
        Some(contents) => contents.parse::<DocumentMut>()?,
        None => default_doc.clone(),
    };
    let source_version = if original_config.is_some() {
        migrations::read_config_version(&user_doc)?
    } else {
        ConfigVersion::Crate(current_version.clone())
    };

    let changes = migrations::migrate_config(&mut user_doc, &source_version, &current_version)?;
    merge_toml_values(&mut default_doc, &user_doc);

    let updated_config = default_doc.to_string();
    let configs = toml::from_str::<Configs>(&updated_config)?;
    if original_config.as_deref() != Some(updated_config.as_str()) {
        if original_config.is_some() {
            let backup_path = Path::new(config_path)
                .with_extension(format!("toml.{}.bak", source_version.label()));
            if !backup_path.exists() {
                fs::copy(config_path, backup_path)?;
            }
        }
        fs::write(config_path, &updated_config)?;
    }

    if source_version != ConfigVersion::Crate(current_version.clone()) {
        tracing::info!(
            "Migrated config schema from {} to {current_version}",
            source_version.label()
        );
    }
    for change in changes {
        tracing::info!("Migrated config setting: {change}");
    }

    Ok(configs)
}

pub fn get_user_configs() -> Configs {
    if let Some(configs) = USER_CONFIGS
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        return configs.clone();
    }

    // Avoid creating a configs.toml in the current working directory when the
    // caller forgets to call set_user_config(). In that case, fall back to the
    // embedded defaults without touching the filesystem.
    tracing::warn!("User configs not initialized; using embedded defaults (no file written)");
    get_default_configs().clone()
}

fn toml_value_to_patch(value: &toml_edit::Value) -> Option<ConfigPatchValue> {
    match value {
        toml_edit::Value::Boolean(b) => Some(ConfigPatchValue::Bool(*b.value())),
        toml_edit::Value::Integer(i) => Some(ConfigPatchValue::Integer(*i.value())),
        toml_edit::Value::String(s) => Some(ConfigPatchValue::String(s.value().clone())),
        toml_edit::Value::Array(arr) => {
            let mut items = Vec::with_capacity(arr.len());
            for elem in arr.iter() {
                match elem {
                    toml_edit::Value::String(s) => items.push(s.value().clone()),
                    _ => return None,
                }
            }
            Some(ConfigPatchValue::StringArray(items))
        }
        _ => None,
    }
}

fn collect_flat_table_values(
    prefix: &str,
    table: &toml_edit::Table,
    out: &mut BTreeMap<String, ConfigPatchValue>,
) {
    for (key, item) in table.iter() {
        let full_key = if prefix.is_empty() {
            key.to_string()
        } else {
            format!("{prefix}.{key}")
        };
        if full_key == "version" || full_key == "app.connect_kc_server.server_list" {
            continue;
        }
        match item {
            toml_edit::Item::Table(subtable) => {
                collect_flat_table_values(&full_key, subtable, out);
            }
            toml_edit::Item::Value(value) => {
                if let Some(patch_value) = toml_value_to_patch(value) {
                    out.insert(full_key, patch_value);
                }
            }
            _ => {}
        }
    }
}

fn load_merged_document(
    config_path: Option<&Path>,
) -> Result<toml_edit::DocumentMut, Box<dyn std::error::Error>> {
    use toml_edit::DocumentMut;

    let mut default_doc = DEFAULT_TOML_FILE.parse::<DocumentMut>()?;
    if let Some(path) = config_path {
        match fs::read_to_string(path) {
            Ok(contents) => {
                let mut user_doc = contents.parse::<DocumentMut>()?;
                let current_version = semver::Version::parse(env!("CARGO_PKG_VERSION"))?;
                let source_version = migrations::read_config_version(&user_doc)?;
                let _ =
                    migrations::migrate_config(&mut user_doc, &source_version, &current_version)?;
                merge_toml_values(&mut default_doc, &user_doc);
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(Box::new(error)),
        }
    }
    Ok(default_doc)
}

pub fn export_default_config_values() -> BTreeMap<String, ConfigPatchValue> {
    let mut values = BTreeMap::new();
    if let Ok(doc) = DEFAULT_TOML_FILE.parse::<toml_edit::DocumentMut>() {
        collect_flat_table_values("", doc.as_table(), &mut values);
    }
    values
}

pub fn export_config_values_from_path(
    config_path: Option<&Path>,
) -> Result<BTreeMap<String, ConfigPatchValue>, Box<dyn std::error::Error>> {
    let doc = load_merged_document(config_path)?;
    let mut values = BTreeMap::new();
    collect_flat_table_values("", doc.as_table(), &mut values);
    Ok(values)
}

pub fn export_user_config_values(
) -> Result<BTreeMap<String, ConfigPatchValue>, Box<dyn std::error::Error>> {
    let path = get_user_config_path();
    export_config_values_from_path(path.as_deref())
}

fn apply_patch_to_document(
    doc: &mut toml_edit::DocumentMut,
    dot_path: &str,
    patch: &ConfigPatchValue,
) -> Result<(), Box<dyn std::error::Error>> {
    if dot_path == "version" || dot_path.starts_with("app.connect_kc_server.server_list") {
        return Err(Box::new(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Config key '{dot_path}' is read-only"),
        )));
    }

    let segments: Vec<&str> = dot_path.split('.').collect();
    if segments.is_empty() || segments.iter().any(|s| s.is_empty()) {
        return Err(Box::new(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Invalid config key path: '{dot_path}'"),
        )));
    }

    let mut current_table = doc.as_table_mut();
    for segment in &segments[..segments.len() - 1] {
        current_table = current_table
            .get_mut(segment)
            .and_then(|item| item.as_table_mut())
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("Unknown config section in key '{dot_path}'"),
                )
            })?;
    }

    let leaf_key = segments[segments.len() - 1];
    let target_item = current_table.get_mut(leaf_key).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Unknown config key '{dot_path}'"),
        )
    })?;

    let existing_value = target_item.as_value_mut().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Config key '{dot_path}' does not point to a value"),
        )
    })?;

    let new_value = match (existing_value as &toml_edit::Value, patch) {
        (toml_edit::Value::Boolean(_), ConfigPatchValue::Bool(b)) => toml_edit::Value::from(*b),
        (toml_edit::Value::Integer(_), ConfigPatchValue::Integer(n)) => toml_edit::Value::from(*n),
        (toml_edit::Value::String(_), ConfigPatchValue::String(s)) => {
            toml_edit::Value::from(s.as_str())
        }
        (toml_edit::Value::Array(_), ConfigPatchValue::StringArray(items)) => {
            let mut arr = toml_edit::Array::new();
            for item in items {
                arr.push(item.as_str());
            }
            toml_edit::Value::Array(arr)
        }
        _ => {
            return Err(Box::new(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("Type mismatch for config key '{dot_path}'"),
            )));
        }
    };

    let decor = existing_value.decor().clone();
    *existing_value = new_value;
    *existing_value.decor_mut() = decor;
    Ok(())
}

/// Apply typed updates to a configs.toml file while preserving comments, formatting, and schema safety.
pub fn update_config_file(
    config_path: &Path,
    updates: &BTreeMap<String, ConfigPatchValue>,
) -> Result<(Configs, BTreeMap<String, ConfigPatchValue>), Box<dyn std::error::Error>> {
    let mut doc = load_merged_document(Some(config_path))?;

    for (key, patch) in updates {
        apply_patch_to_document(&mut doc, key, patch)?;
    }

    let updated_toml = doc.to_string();
    let parsed_configs = toml::from_str::<Configs>(&updated_toml)?;

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(config_path, &updated_toml)?;

    let mut flat_values = BTreeMap::new();
    collect_flat_table_values("", doc.as_table(), &mut flat_values);

    Ok((parsed_configs, flat_values))
}

/// Update the active user configs.toml on disk and refresh the in-memory `USER_CONFIGS`.
pub fn update_user_config_values(
    updates: &BTreeMap<String, ConfigPatchValue>,
) -> Result<(Configs, BTreeMap<String, ConfigPatchValue>), Box<dyn std::error::Error>> {
    let config_path = get_user_config_path().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "User config path is not initialized",
        )
    })?;

    let (parsed_configs, flat_values) = update_config_file(&config_path, updates)?;
    {
        let mut guard = USER_CONFIGS.write().unwrap_or_else(|e| e.into_inner());
        *guard = Some(parsed_configs.clone());
    }

    Ok((parsed_configs, flat_values))
}

/// Recursively merge user values into default document while keeping schema/type safety
fn merge_toml_item(default_item: &mut toml_edit::Item, user_item: &toml_edit::Item) {
    use std::mem::discriminant;
    use toml_edit::Item;

    match (default_item, user_item) {
        (Item::Table(default_table), Item::Table(user_table)) => {
            merge_table_values(default_table, user_table);
        }
        (Item::Value(default_value), Item::Value(user_value))
            if discriminant(default_value) == discriminant(user_value) =>
        {
            *default_value = user_value.clone();
        }
        _ => {
            // Type mismatch: keep default value
        }
    }
}

/// Recursively merge user values into default document
fn merge_toml_values(default_doc: &mut toml_edit::DocumentMut, user_doc: &toml_edit::DocumentMut) {
    for (key, user_item) in user_doc.iter() {
        // Keep the current default template's top-level version when upgrading configs.
        if key == "version" {
            continue;
        }
        if let Some(default_item) = default_doc.get_mut(key) {
            merge_toml_item(default_item, user_item);
        }
    }
}

/// Merge table values recursively
fn merge_table_values(default_table: &mut toml_edit::Table, user_table: &toml_edit::Table) {
    for (key, user_item) in user_table.iter() {
        if let Some(default_item) = default_table.get_mut(key) {
            merge_toml_item(default_item, user_item);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn remove_test_config_files(path: &Path) {
        let _ = fs::remove_file(path);
        for label in ["v0", "v1", "0.5.0", "0.5.1"] {
            let backup_path = path.with_extension(format!("toml.{label}.bak"));
            let _ = fs::remove_file(backup_path);
        }
    }

    #[test]
    fn test_config_toml_is_valid() {
        // Test that config.toml can be successfully parsed into Configs structure
        // This ensures that the TOML structure matches the Rust struct definitions
        let config_content = include_str!("../configs.toml");

        let parsed_result: Result<Configs, toml::de::Error> = toml::from_str(config_content);

        match parsed_result {
            Ok(_) => {
                // Success - config.toml is valid and can be deserialized
            }
            Err(e) => {
                panic!(
                    "config.toml failed to deserialize into Configs struct: {}",
                    e
                );
            }
        }
    }

    #[test]
    fn test_config_version_matches_configs_crate_version() {
        let config: Configs =
            toml::from_str(include_str!("../configs.toml")).expect("default TOML should parse");
        assert_eq!(config.version.as_deref(), Some(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn test_bundled_app_config_is_mapped_to_single_source() {
        let tauri_conf = include_str!("../../FUSOU-APP/src-tauri/tauri.conf.json");
        assert!(
            tauri_conf.contains(r#""../../configs/configs.toml": "resources/user/configs.toml""#),
            "tauri.conf.json must map ../../configs/configs.toml to resources/user/configs.toml"
        );

        assert!(
            !std::path::Path::new("../FUSOU-APP/src-tauri/resources/user/configs.toml").exists(),
            "duplicate FUSOU-APP/src-tauri/resources/user/configs.toml should not exist"
        );

        let roaming_content = include_str!("../../FUSOU-APP/src-tauri/roaming/user/configs.toml");
        toml::from_str::<Configs>(roaming_content)
            .expect("dev roaming FUSOU-APP configs.toml must match Configs");
    }

    #[test]
    fn map_cell_labels_url_comes_from_config_and_old_configs_still_parse() {
        let default_url = get_default_configs()
            .app
            .map_cell_labels
            .get_bundle_url()
            .expect("default map label bundle URL should be configured");

        assert_eq!(
            default_url,
            "https://fusou.dev/battle-maps/cell_labels.json"
        );

        let custom = ConfigsAppMapCellLabels {
            bundle_url: Some("https://maps.example.test/labels.json".to_string()),
        };
        assert_eq!(
            custom.get_bundle_url().as_deref(),
            Some("https://maps.example.test/labels.json")
        );

        let mut old_config: toml::Value =
            toml::from_str(include_str!("../configs.toml")).expect("default TOML should parse");
        old_config
            .get_mut("app")
            .and_then(toml::Value::as_table_mut)
            .expect("app config table should exist")
            .remove("map_cell_labels");
        let old_config: Configs = old_config
            .try_into()
            .expect("configs without map_cell_labels should remain compatible");

        assert_eq!(
            old_config.app.map_cell_labels.get_bundle_url(),
            Some(default_url)
        );
    }

    #[test]
    fn test_all_default_values_match_config_toml() {
        // Initialize default configs from configs.toml
        let default_configs = get_default_configs();

        // Test Proxy Network defaults
        let empty_network = ConfigsProxyNetwork {
            enforce_http: None,
            set_nodelay: None,
            connect_timeout: None,
            keepalive_interval: None,
            recv_buffer_size: None,
            send_buffer_size: None,
            proxy_server_port: None,
        };

        assert_eq!(
            empty_network.get_enforce_http(),
            default_configs.proxy.network.get_enforce_http(),
            "enforce_http getter should return configs.toml default"
        );
        assert_eq!(
            empty_network.get_set_nodelay(),
            default_configs.proxy.network.get_set_nodelay(),
            "set_nodelay getter should return configs.toml default"
        );
        assert_eq!(
            empty_network.get_proxy_server_port(),
            default_configs.proxy.network.get_proxy_server_port(),
            "proxy_server_port getter should return configs.toml default"
        );

        // Test Proxy Certificates defaults
        let empty_certs = ConfigsProxyCertificates {
            use_generated_certs: None,
            cert_file: None,
            key_file: None,
        };

        assert_eq!(
            empty_certs.get_use_generated_certs(),
            default_configs.proxy.certificates.get_use_generated_certs(),
            "use_generated_certs getter should return configs.toml default"
        );

        // Test Proxy PAC defaults
        let empty_pac = ConfigsProxyPac {
            use_custom_pac: None,
            pac_script: None,
            pac_server_port: None,
        };

        assert_eq!(
            empty_pac.get_use_custom_pac(),
            default_configs.proxy.pac.get_use_custom_pac(),
            "use_custom_pac getter should return configs.toml default"
        );
        assert_eq!(
            empty_pac.get_pac_server_port(),
            default_configs.proxy.pac.get_pac_server_port(),
            "pac_server_port getter should return configs.toml default"
        );

        // Test Proxy defaults
        let empty_proxy_fields = ConfigsProxy {
            allow_save_api_requests: None,
            allow_save_api_responses: None,
            allow_save_resources: None,
            allow_save_main_js_local: None,
            save_file_location: None,
            network: default_configs.proxy.network.clone(),
            certificates: default_configs.proxy.certificates.clone(),
            pac: default_configs.proxy.pac.clone(),
        };

        assert_eq!(
            empty_proxy_fields.get_allow_save_api_requests(),
            default_configs.proxy.get_allow_save_api_requests(),
            "allow_save_api_requests getter should return configs.toml default"
        );
        assert_eq!(
            empty_proxy_fields.get_allow_save_api_responses(),
            default_configs.proxy.get_allow_save_api_responses(),
            "allow_save_api_responses getter should return configs.toml default"
        );
        assert_eq!(
            empty_proxy_fields.get_allow_save_resources(),
            default_configs.proxy.get_allow_save_resources(),
            "allow_save_resources getter should return configs.toml default"
        );
        assert_eq!(
            empty_proxy_fields.get_allow_save_main_js_local(),
            default_configs.proxy.get_allow_save_main_js_local(),
            "allow_save_main_js_local getter should return configs.toml default"
        );

        // Test App Autostart defaults
        let empty_autostart = ConfigsAppAutostart { enable: None };

        assert_eq!(
            empty_autostart.get_enable_autostart(),
            default_configs.app.autostart.get_enable_autostart(),
            "autostart enable getter should return configs.toml default"
        );

        // Test App Theme defaults
        let empty_theme = ConfigsAppTheme { theme: None };

        assert_eq!(
            empty_theme.get_theme(),
            default_configs.app.theme.get_theme(),
            "theme getter should return configs.toml default"
        );

        // Test App Font defaults
        let empty_font = ConfigAppFont { font_family: None };

        assert_eq!(
            empty_font.get_font_family(),
            default_configs.app.font.get_font_family(),
            "font_family getter should return configs.toml default"
        );

        // Test App Browser defaults
        let empty_browser = ConfigsAppBrowser {
            url: None,
            external_screenshot_directory: None,
        };

        assert_eq!(
            empty_browser.get_external_screenshot_directory(),
            default_configs
                .app
                .browser
                .get_external_screenshot_directory(),
            "browser external_screenshot_directory getter should return configs.toml default"
        );

        // Test App Discord defaults
        let empty_discord = ConfigsAppDiscord {
            enable_discord_integration: None,
            use_custom_message: None,
            custom_message: None,
            custom_details: None,
            use_custom_image: None,
            custom_image_url: None,
        };

        assert_eq!(
            empty_discord.get_enable_discord_integration(),
            default_configs.app.discord.get_enable_discord_integration(),
            "discord enable_discord_integration getter should return configs.toml default"
        );
        assert_eq!(
            empty_discord.get_use_custom_message(),
            default_configs.app.discord.get_use_custom_message(),
            "discord use_custom_message getter should return configs.toml default"
        );
        assert_eq!(
            empty_discord.get_use_custom_image(),
            default_configs.app.discord.get_use_custom_image(),
            "discord use_custom_image getter should return configs.toml default"
        );

        // Test App Database defaults
        let empty_database_fields = ConfigsAppDatabase {
            allow_data_to_shared_cloud: None,
            allow_data_to_local: None,
            integration_schedule_cron: None,
            local: default_configs.app.database.local.clone(),
            r2: default_configs.app.database.r2.clone(),
        };

        assert_eq!(
            empty_database_fields.get_allow_data_to_shared_cloud(),
            default_configs
                .app
                .database
                .get_allow_data_to_shared_cloud(),
            "database allow_data_to_shared_cloud getter should return configs.toml default"
        );
        assert_eq!(
            empty_database_fields.get_allow_data_to_local(),
            default_configs.app.database.get_allow_data_to_local(),
            "database allow_data_to_local getter should return configs.toml default"
        );

        // Test App Asset Sync defaults
        let empty_asset_sync = ConfigsAppAssetSync {
            asset_upload_enable: None,
            scan_interval_seconds: None,
            asset_upload_endpoint: None,
            fleet_snapshot_endpoint: None,
            r2_upload_endpoint: None,
            kc_period_endpoint: None,
            asset_skip_extensions: None,
            asset_existing_keys_endpoint: None,
            finder_tag: None,
            retry: default_configs.app.asset_sync.retry.clone(),
        };

        assert_eq!(
            empty_asset_sync.get_asset_upload_enable(),
            default_configs.app.asset_sync.get_asset_upload_enable(),
            "asset_sync asset_upload_enable getter should return configs.toml default"
        );
        assert_eq!(
            empty_asset_sync.get_scan_interval_seconds(),
            default_configs.app.asset_sync.get_scan_interval_seconds(),
            "asset_sync scan_interval_seconds getter should return configs.toml default"
        );
        assert_eq!(
            empty_asset_sync.get_asset_skip_extensions(),
            default_configs.app.asset_sync.get_asset_skip_extensions(),
            "asset_sync asset_skip_extensions getter should return configs.toml default"
        );

        // Test App Asset Sync Retry defaults
        let empty_retry = ConfigsAppAssetSyncRetry {
            max_attempts: None,
            ttl_seconds: None,
            interval_seconds: None,
            auth_backoff_seconds: None,
            item_interval_seconds: None,
        };

        assert_eq!(
            empty_retry.get_max_attempts(),
            default_configs.app.asset_sync.retry.get_max_attempts(),
            "retry max_attempts getter should return configs.toml default"
        );
        assert_eq!(
            empty_retry.get_ttl_seconds(),
            default_configs.app.asset_sync.retry.get_ttl_seconds(),
            "retry ttl_seconds getter should return configs.toml default"
        );
        assert_eq!(
            empty_retry.get_interval_seconds(),
            default_configs.app.asset_sync.retry.get_interval_seconds(),
            "retry interval_seconds getter should return configs.toml default"
        );
        assert_eq!(
            empty_retry.get_auth_backoff_seconds(),
            default_configs
                .app
                .asset_sync
                .retry
                .get_auth_backoff_seconds(),
            "retry auth_backoff_seconds getter should return configs.toml default"
        );

        // Test App Auth defaults
        let empty_auth = ConfigsAppAuth {
            allow_auth: None,
            auth_page_url: None,
            anonymous_sync_v2_register_endpoint: None,
            anonymous_sync_v2_challenge_endpoint: None,
            anonymous_sync_v2_refresh_endpoint: None,
            anonymous_sync_v2_complete_endpoint: None,
        };

        assert!(!default_configs.app.auth.get_allow_auth());
        assert_eq!(
            empty_auth.get_allow_auth(),
            default_configs.app.auth.get_allow_auth(),
            "auth allow_auth getter should return configs.toml default"
        );
        assert_eq!(
            empty_auth.get_auth_page_url(),
            default_configs.app.auth.get_auth_page_url(),
            "auth auth_page_url getter should return configs.toml default"
        );

        // Test App Window defaults
        let empty_window = ConfigsAppWindow {
            resize_debounce_millis: None,
            keep_window_size_duration_millis: None,
            max_inner_width: None,
            max_inner_height: None,
            default_inner_width: None,
            default_inner_height: None,
        };

        assert_eq!(
            empty_window.get_max_inner_width(),
            default_configs.app.kc_window.get_max_inner_width(),
            "window max_inner_width getter should return configs.toml default"
        );
        assert_eq!(
            empty_window.get_max_inner_height(),
            default_configs.app.kc_window.get_max_inner_height(),
            "window max_inner_height getter should return configs.toml default"
        );
        assert_eq!(
            empty_window.get_default_inner_width(),
            default_configs.app.kc_window.get_default_inner_width(),
            "window default_inner_width getter should return configs.toml default"
        );
        assert_eq!(
            empty_window.get_default_inner_height(),
            default_configs.app.kc_window.get_default_inner_height(),
            "window default_inner_height getter should return configs.toml default"
        );
    }

    #[test]
    fn test_server_list_from_config_toml() {
        // Test that server list is loaded from configs.toml, not hardcoded
        let default_configs = get_default_configs();

        // Create empty server config
        let empty_server_config = ConfigsAppConnectKcServer {
            kc_server_name: None,
            server_list: None,
        };

        // Verify server list comes from configs.toml via get_default_server_address
        // Test a few server indices
        let test_indices = vec![1, 10, 20];

        for index in test_indices {
            let result = empty_server_config.get_server_address(index);
            let expected = default_configs
                .app
                .connect_kc_server
                .get_server_address(index);

            assert_eq!(
                result, expected,
                "Server address for index {} should come from configs.toml",
                index
            );
        }

        // Verify get_all_servers returns configs.toml data
        let all_servers = empty_server_config.get_all_servers();
        let expected_servers = default_configs.app.connect_kc_server.get_all_servers();

        assert_eq!(
            all_servers, expected_servers,
            "All servers should come from configs.toml"
        );
    }

    #[test]
    fn test_get_configs_treats_missing_version_as_v0_and_preserves_values() {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "fusou-configs-merge-test-{}.toml",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let legacy_user_toml = r#"
[proxy]
allow_save_api_responses = true

[proxy.network]
connect_timeout = "invalid-string-type"
recv_buffer_size = 1234567
"#;
        std::fs::write(&path, legacy_user_toml).unwrap();

        let loaded = get_configs(path.to_str().unwrap()).unwrap();
        assert!(loaded.proxy.get_allow_save_api_responses());
        assert_eq!(loaded.proxy.network.get_recv_buffer_size(), Some(1234567));
        // Type mismatch falls back cleanly to default template without dropping valid user values
        let default_cfg = get_default_configs();
        assert_eq!(
            loaded.proxy.network.connect_timeout,
            default_cfg.proxy.network.connect_timeout
        );
        assert_eq!(loaded.version.as_deref(), Some(env!("CARGO_PKG_VERSION")));

        remove_test_config_files(&path);
    }

    #[test]
    fn test_v0_migration_converts_legacy_keys_and_keeps_existing_values() {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "fusou-configs-v0-migration-{}.toml",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(
            &path,
            r#"
[app.auth]
deny_auth = true

[app.asset_sync]
enable = true
asset_upload_enable = true

[app.soku_speed_sender]
enable = true

[app.kc_window]
window_title_bar_height = 68
"#,
        )
        .unwrap();

        let loaded = get_configs(path.to_str().unwrap()).unwrap();
        assert!(!loaded.app.auth.get_allow_auth());
        assert!(loaded.app.soku_speed_sender.get_enable());
        assert!(!loaded.app.soku_speed_sender.get_allow_data_to_local());

        let migrated: toml::Value = toml::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            migrated["version"].as_str(),
            Some(env!("CARGO_PKG_VERSION"))
        );
        assert_eq!(migrated["app"]["auth"]["allow_auth"].as_bool(), Some(false));
        assert!(migrated["app"]["auth"].get("deny_auth").is_none());
        assert!(migrated["app"]["asset_sync"].get("enable").is_none());
        assert_eq!(
            migrated["app"]["asset_sync"]["asset_upload_enable"].as_bool(),
            Some(true)
        );
        assert!(migrated["app"]["kc_window"]
            .get("window_title_bar_height")
            .is_none());

        remove_test_config_files(&path);
    }

    #[test]
    fn test_v0_migration_prefers_an_already_renamed_auth_setting() {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "fusou-configs-v0-auth-precedence-{}.toml",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(
            &path,
            r#"
[app.auth]
deny_auth = true
allow_auth = true
"#,
        )
        .unwrap();

        let loaded = get_configs(path.to_str().unwrap()).unwrap();
        assert!(loaded.app.auth.get_allow_auth());
        let migrated: toml::Value = toml::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(migrated["app"]["auth"]["allow_auth"].as_bool(), Some(true));
        assert!(migrated["app"]["auth"].get("deny_auth").is_none());

        remove_test_config_files(&path);
    }

    #[test]
    fn test_v1_is_not_treated_as_legacy_or_overwritten() {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "fusou-configs-unknown-v1-{}.toml",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let legacy_config = r#"
version = "v1"

[app.auth]
allow_auth = true
"#;
        std::fs::write(&path, legacy_config).unwrap();

        assert!(get_configs(path.to_str().unwrap()).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), legacy_config);

        remove_test_config_files(&path);
    }

    #[test]
    fn test_unsupported_config_version_is_not_overwritten() {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "fusou-configs-future-version-{}.toml",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let future_config = "version = \"0.6.0\"\n\n[app.auth]\nallow_auth = true\n";
        std::fs::write(&path, future_config).unwrap();

        assert!(get_configs(path.to_str().unwrap()).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), future_config);

        remove_test_config_files(&path);
    }

    #[test]
    fn sender_local_save_defaults_and_compatibility() {
        let default_cfg = get_default_configs();
        assert!(!default_cfg.app.quest_tree_sender.get_allow_data_to_local());
        assert!(!default_cfg.app.ship_growth_sender.get_allow_data_to_local());
        assert!(!default_cfg.app.soku_speed_sender.get_allow_data_to_local());
        assert!(!default_cfg.app.remodel_sender.get_allow_data_to_local());

        let empty_quest = ConfigsAppQuestTreeSender {
            enable: None,
            allow_data_to_local: None,
            ingest_endpoint: None,
        };
        assert!(!empty_quest.get_allow_data_to_local());

        let empty_ship_growth = ConfigsAppShipGrowthSender {
            enable: None,
            allow_data_to_local: None,
            ingest_endpoint: None,
        };
        assert!(!empty_ship_growth.get_allow_data_to_local());

        let empty_soku_speed = ConfigsAppSokuSpeedSender {
            enable: None,
            allow_data_to_local: None,
            ingest_endpoint: None,
        };
        assert!(!empty_soku_speed.get_allow_data_to_local());

        let empty_remodel = ConfigsAppRemodelSender {
            enable: None,
            allow_data_to_local: None,
            ingest_endpoint: None,
        };
        assert!(!empty_remodel.get_allow_data_to_local());

        let mut legacy_toml: toml::Value =
            toml::from_str(include_str!("../configs.toml")).expect("default TOML should parse");
        let app_table = legacy_toml
            .get_mut("app")
            .and_then(toml::Value::as_table_mut)
            .expect("app config table should exist");
        for sender_key in [
            "quest_tree_sender",
            "ship_growth_sender",
            "soku_speed_sender",
            "remodel_sender",
        ] {
            app_table
                .get_mut(sender_key)
                .and_then(toml::Value::as_table_mut)
                .unwrap_or_else(|| panic!("{sender_key} table should exist"))
                .remove("allow_data_to_local");
        }

        let parsed_legacy: Configs = legacy_toml
            .try_into()
            .expect("legacy config without allow_data_to_local should deserialize");
        assert!(!parsed_legacy
            .app
            .quest_tree_sender
            .get_allow_data_to_local());
        assert!(!parsed_legacy
            .app
            .ship_growth_sender
            .get_allow_data_to_local());
        assert!(!parsed_legacy
            .app
            .soku_speed_sender
            .get_allow_data_to_local());
        assert!(!parsed_legacy.app.remodel_sender.get_allow_data_to_local());

        let mut path = std::env::temp_dir();
        path.push(format!(
            "fusou-configs-local-save-test-{}.toml",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let user_toml = r#"
[app.quest_tree_sender]
allow_data_to_local = true

[app.ship_growth_sender]
enable = true
allow_data_to_local = true

[app.soku_speed_sender]
allow_data_to_local = true

[app.remodel_sender]
enable = true
allow_data_to_local = true
"#;
        std::fs::write(&path, user_toml).unwrap();
        let merged = get_configs(path.to_str().unwrap()).unwrap();
        assert!(!merged.app.quest_tree_sender.get_enable());
        assert!(merged.app.quest_tree_sender.get_allow_data_to_local());
        assert!(merged.app.ship_growth_sender.get_enable());
        assert!(merged.app.ship_growth_sender.get_allow_data_to_local());
        assert!(!merged.app.soku_speed_sender.get_enable());
        assert!(merged.app.soku_speed_sender.get_allow_data_to_local());
        assert!(merged.app.remodel_sender.get_enable());
        assert!(merged.app.remodel_sender.get_allow_data_to_local());
        remove_test_config_files(&path);
    }

    #[test]
    fn update_config_file_patches_typed_values_and_preserves_comments() {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "fusou-configs-patch-test-{}.toml",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let _ = get_configs(path.to_str().unwrap()).unwrap();

        let mut updates = BTreeMap::new();
        updates.insert(
            "app.theme.theme".to_string(),
            ConfigPatchValue::String("dark".to_string()),
        );
        updates.insert(
            "app.database.allow_data_to_local".to_string(),
            ConfigPatchValue::Bool(true),
        );
        updates.insert(
            "app.asset_sync.retry.ttl_seconds".to_string(),
            ConfigPatchValue::Integer(86400),
        );
        updates.insert(
            "app.asset_sync.asset_skip_extensions".to_string(),
            ConfigPatchValue::StringArray(vec!["mp3".to_string(), "ogg".to_string()]),
        );

        let (updated, flat) = update_config_file(&path, &updates).unwrap();
        assert_eq!(updated.app.theme.get_theme(), "dark");
        assert!(updated.app.database.get_allow_data_to_local());
        assert_eq!(updated.app.asset_sync.retry.get_ttl_seconds(), 86400);
        assert_eq!(
            updated.app.asset_sync.get_asset_skip_extensions(),
            vec!["mp3".to_string(), "ogg".to_string()]
        );
        assert_eq!(
            flat.get("app.theme.theme"),
            Some(&ConfigPatchValue::String("dark".to_string()))
        );

        let raw = fs::read_to_string(&path).unwrap();
        assert!(
            raw.contains("# 30 days"),
            "inline comment should be preserved"
        );
        assert!(
            raw.contains("# Whether to save KanColle data to the local filesystem"),
            "section comments should be preserved"
        );

        let mut invalid_updates = BTreeMap::new();
        invalid_updates.insert(
            "version".to_string(),
            ConfigPatchValue::String("9.9.9".to_string()),
        );
        assert!(update_config_file(&path, &invalid_updates).is_err());

        let mut mismatch_updates = BTreeMap::new();
        mismatch_updates.insert(
            "app.database.allow_data_to_local".to_string(),
            ConfigPatchValue::String("yes".to_string()),
        );
        assert!(update_config_file(&path, &mismatch_updates).is_err());

        let mut unknown_updates = BTreeMap::new();
        unknown_updates.insert(
            "app.nonexistent.flag".to_string(),
            ConfigPatchValue::Bool(true),
        );
        assert!(update_config_file(&path, &unknown_updates).is_err());

        // File must remain valid and unchanged after rejected updates
        let reloaded = get_configs(path.to_str().unwrap()).unwrap();
        assert_eq!(reloaded.app.theme.get_theme(), "dark");
        assert!(reloaded.app.database.get_allow_data_to_local());

        remove_test_config_files(&path);
    }

    #[test]
    fn test_0_5_0_migration_removes_obsolete_channel_backend_and_gdrive() {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "fusou-configs-0-5-0-migration-{}.toml",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(
            &path,
            r#"
version = "0.5.0"

[proxy]
allow_save_api_responses = true

[proxy.network]
backend_crate = "hudsucker"
proxy_server_port = 18080

[proxy.channel]
transport = "grpc"
endpoint = "http://127.0.0.1:50061"
buffer_size = 64

[app.database]
allow_data_to_cloud = true
allow_data_to_local = true

[app.database.google_drive]
page_size = 50
"#,
        )
        .unwrap();

        let loaded = get_configs(path.to_str().unwrap()).unwrap();
        assert!(loaded.proxy.get_allow_save_api_responses());
        assert_eq!(loaded.proxy.network.get_proxy_server_port(), 18080);
        assert!(loaded.app.database.get_allow_data_to_local());
        assert_eq!(loaded.version.as_deref(), Some(env!("CARGO_PKG_VERSION")));

        let migrated: toml::Value = toml::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            migrated["version"].as_str(),
            Some(env!("CARGO_PKG_VERSION"))
        );
        assert!(migrated["proxy"].get("channel").is_none());
        assert!(migrated["proxy"]["network"].get("backend_crate").is_none());
        assert!(migrated["app"]["database"]
            .get("allow_data_to_cloud")
            .is_none());
        assert!(migrated["app"]["database"].get("google_drive").is_none());
        assert_eq!(
            migrated["proxy"]["network"]["proxy_server_port"].as_integer(),
            Some(18080)
        );
        assert!(path.with_extension("toml.0.5.0.bak").exists());

        remove_test_config_files(&path);
    }
}
