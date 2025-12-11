extern crate serde;
extern crate toml;

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;

use once_cell::sync::OnceCell;

use tracing_unwrap::ResultExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsProxyCertificates {
    use_generated_certs: Option<bool>,
    cert_file: Option<String>,
    key_file: Option<String>,
}

impl ConfigsProxyCertificates {
    pub fn get_use_generated_certs(&self) -> bool {
        self.use_generated_certs.unwrap_or_else(|| {
            get_default_configs().proxy.certificates.use_generated_certs.unwrap()
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
        self.use_custom_pac.unwrap_or_else(|| {
            get_default_configs().proxy.pac.use_custom_pac.unwrap()
        })
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
            .unwrap_or_else(|| get_default_configs().proxy.pac.pac_server_port.unwrap()) as u16
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChannelTransportKind {
    Mpsc,
    Grpc,
}

impl Default for ChannelTransportKind {
    fn default() -> Self {
        ChannelTransportKind::Mpsc
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsProxyChannel {
    pub transport: ChannelTransportKind,
    endpoint: Option<String>,
    buffer_size: Option<i64>,
}

impl ConfigsProxyChannel {
    pub fn get_endpoint(&self) -> Option<String> {
        match self.endpoint {
            Some(ref value) if !value.is_empty() => Some(value.clone()),
            _ => None,
        }
    }

    pub fn get_buffer_size(&self) -> Option<usize> {
        self.buffer_size.and_then(|value| {
            if value <= 0 {
                None
            } else {
                Some(value as usize)
            }
        })
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsProxyNetwork {
    backend_crate: Option<String>,
    enforce_http: Option<bool>,
    set_nodelay: Option<bool>,
    connect_timeout: Option<i64>,
    keepalive_interval: Option<i64>,
    recv_buffer_size: Option<i64>,
    send_buffer_size: Option<i64>,
    proxy_server_port: Option<i64>,
}

impl ConfigsProxyNetwork {
    pub fn get_backend_crate(&self) -> String {
        self.backend_crate
            .clone()
            .unwrap_or_else(|| get_default_configs().proxy.network.backend_crate.clone().unwrap())
    }

    pub fn get_enforce_http(&self) -> bool {
        self.enforce_http.unwrap_or_else(|| get_default_configs().proxy.network.enforce_http.unwrap())
    }

    pub fn get_set_nodelay(&self) -> bool {
        self.set_nodelay.unwrap_or_else(|| get_default_configs().proxy.network.set_nodelay.unwrap())
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
            .unwrap_or_else(|| get_default_configs().proxy.network.proxy_server_port.unwrap()) as u16
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppConnectKcServer {
    kc_server_name: Option<String>,
    server_list: Option<std::collections::HashMap<i32, String>>,
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
}

impl ConfigsAppBrowser {
    pub fn get_url(&self) -> Option<String> {
        match self.url {
            Some(ref v) if !v.is_empty() => Some(v.clone()),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppAutostart {
    enable: Option<bool>,
}

impl ConfigsAppAutostart {
    pub fn get_enable_autostart(&self) -> bool {
        self.enable.unwrap_or_else(|| get_default_configs().app.autostart.enable.unwrap())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppTheme {
    theme: Option<String>,
}

impl ConfigsAppTheme {
    pub fn get_theme(&self) -> String {
        self.theme.clone().unwrap_or_else(|| get_default_configs().app.theme.theme.clone().unwrap())
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
        self.enable_discord_integration.unwrap_or_else(|| get_default_configs().app.discord.enable_discord_integration.unwrap())
    }

    pub fn get_use_custom_message(&self) -> bool {
        self.use_custom_message.unwrap_or_else(|| get_default_configs().app.discord.use_custom_message.unwrap())
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
        self.use_custom_image.unwrap_or_else(|| get_default_configs().app.discord.use_custom_image.unwrap())
    }

    pub fn get_custom_image_url(&self) -> String {
        match self.custom_image_url {
            Some(ref v) => v.clone(),
            None => "".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppDatabaseGoogleDrive {
    schedule_cron: Option<String>,
    page_size: Option<i64>,
}

impl ConfigsAppDatabaseGoogleDrive {
    pub fn get_schedule_cron(&self) -> String {
        self.schedule_cron
            .clone()
            .unwrap_or_else(|| get_default_configs().app.database.google_drive.schedule_cron.clone().unwrap())
    }

    pub fn get_page_size(&self) -> i64 {
        match self.page_size {
            Some(v) if v <= 0 => 100,
            Some(v) if v > 100 => 100,
            Some(v) => v,
            None => get_default_configs().app.database.google_drive.page_size.unwrap(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppDatabaseLocal {
    output_directory: Option<String>,
}

impl ConfigsAppDatabaseLocal {
    pub fn get_output_directory(&self) -> Option<String> {
        match self.output_directory {
            Some(ref v) if !v.is_empty() => Some(v.clone()),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppDatabase {
    allow_data_to_cloud: Option<bool>,
    allow_data_to_local: Option<bool>,
    pub local: ConfigsAppDatabaseLocal,
    pub google_drive: ConfigsAppDatabaseGoogleDrive,
}

impl ConfigsAppDatabase {
    pub fn get_allow_data_to_cloud(&self) -> bool {
        self.allow_data_to_cloud.unwrap_or_else(|| get_default_configs().app.database.allow_data_to_cloud.unwrap())
    }

    pub fn get_allow_data_to_local(&self) -> bool {
        self.allow_data_to_local.unwrap_or_else(|| get_default_configs().app.database.allow_data_to_local.unwrap())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppAssetSync {
    asset_upload_enable: Option<bool>,
    scan_interval_seconds: Option<u64>,
    asset_upload_endpoint: Option<String>,
    fleet_snapshot_endpoint: Option<String>,
    asset_key_prefix: Option<String>,
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
}

impl ConfigsAppAssetSyncRetry {
    pub fn get_max_attempts(&self) -> u32 {
        self.max_attempts.unwrap_or_else(|| get_default_configs().app.asset_sync.retry.max_attempts.unwrap())
    }

    pub fn get_ttl_seconds(&self) -> u64 {
        self.ttl_seconds.unwrap_or_else(|| get_default_configs().app.asset_sync.retry.ttl_seconds.unwrap())
    }

    pub fn get_interval_seconds(&self) -> u64 {
        self.interval_seconds.unwrap_or_else(|| get_default_configs().app.asset_sync.retry.interval_seconds.unwrap())
    }
}

impl ConfigsAppAssetSync {
    pub fn get_enable(&self) -> bool {
        // Backward-compatible wrapper
        self.get_asset_upload_enable()
    }

    pub fn get_asset_upload_enable(&self) -> bool {
        self.asset_upload_enable.unwrap_or_else(|| get_default_configs().app.asset_sync.asset_upload_enable.unwrap())
    }

    pub fn get_scan_interval_seconds(&self) -> u64 {
        match self.scan_interval_seconds {
            Some(v) if v == 0 => get_default_configs().app.asset_sync.scan_interval_seconds.unwrap(),
            Some(v) => v,
            None => get_default_configs().app.asset_sync.scan_interval_seconds.unwrap(),
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

    // Backward-compatible wrapper
    pub fn get_asset_sync_snapshot_endpoint(&self) -> Option<String> {
        self.get_fleet_snapshot_endpoint()
    }

    pub fn get_key_prefix(&self) -> Option<String> {
        // Backward-compatible wrapper to new `asset_key_prefix`
        self.get_asset_key_prefix()
    }

    pub fn get_asset_key_prefix(&self) -> Option<String> {
        match self.asset_key_prefix {
            Some(ref v) if !v.trim().is_empty() => Some(v.trim().to_string()),
            _ => None,
        }
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
                    .app.asset_sync
                    .asset_skip_extensions.as_ref()
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
    deny_auth: Option<bool>,
    auth_page_url: Option<String>,
}

impl ConfigsAppAuth {
    pub fn get_deny_auth(&self) -> bool {
        self.deny_auth.unwrap_or_else(|| get_default_configs().app.auth.deny_auth.unwrap())
    }

    pub fn get_auth_page_url(&self) -> String {
        match &self.auth_page_url {
            Some(v) if !v.is_empty() => v.clone(),
            _ => get_default_configs().app.auth.auth_page_url.clone().unwrap(),
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
    window_title_bar_height: Option<u32>,
}

impl ConfigsAppWindow {
    #[cfg(target_os = "linux")]
    pub fn get_resize_debounce_millis(&self) -> u64 {
        self.resize_debounce_millis.unwrap_or_else(|| get_default_configs().app.kc_window.resize_debounce_millis.unwrap())
    }
    #[cfg(target_os = "linux")]
    pub fn get_keep_window_size_duration_millis(&self) -> u64 {
        self.keep_window_size_duration_millis.unwrap_or_else(|| get_default_configs().app.kc_window.keep_window_size_duration_millis.unwrap())
    }
    pub fn get_max_inner_width(&self) -> u32 {
        self.max_inner_width.unwrap_or_else(|| get_default_configs().app.kc_window.max_inner_width.unwrap())
    }
    pub fn get_max_inner_height(&self) -> u32 {
        self.max_inner_height.unwrap_or_else(|| get_default_configs().app.kc_window.max_inner_height.unwrap())
    }
    pub fn get_default_inner_width(&self) -> u32 {
        self.default_inner_width.unwrap_or_else(|| get_default_configs().app.kc_window.default_inner_width.unwrap())
    }
    pub fn get_default_inner_height(&self) -> u32 {
        self.default_inner_height.unwrap_or_else(|| get_default_configs().app.kc_window.default_inner_height.unwrap())
    }
    #[cfg(target_os = "linux")]
    pub fn get_window_title_bar_height(&self) -> u32 {
        self.window_title_bar_height.unwrap_or_else(|| get_default_configs().app.kc_window.window_title_bar_height.unwrap())
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
    pub auth: ConfigsAppAuth,
    pub kc_window: ConfigsAppWindow,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsProxy {
    allow_save_api_requests: Option<bool>,
    allow_save_api_responses: Option<bool>,
    allow_save_resources: Option<bool>,
    save_file_location: Option<String>,
    pub network: ConfigsProxyNetwork,
    pub certificates: ConfigsProxyCertificates,
    pub pac: ConfigsProxyPac,
    pub channel: ConfigsProxyChannel,
}

impl ConfigsProxy {
    pub fn get_allow_save_api_requests(&self) -> bool {
        self.allow_save_api_requests.unwrap_or_else(|| get_default_configs().proxy.allow_save_api_requests.unwrap())
    }

    pub fn get_allow_save_api_responses(&self) -> bool {
        self.allow_save_api_responses.unwrap_or_else(|| get_default_configs().proxy.allow_save_api_responses.unwrap())
    }

    pub fn get_allow_save_resources(&self) -> bool {
        self.allow_save_resources.unwrap_or_else(|| get_default_configs().proxy.allow_save_resources.unwrap())
    }

    pub fn get_save_file_location(&self) -> Option<String> {
        match self.save_file_location {
            Some(ref v) if !v.is_empty() => Some(v.clone()),
            _ => None,
        }
    }

    pub fn get_channel_transport(&self) -> ChannelTransportKind {
        self.channel.transport.clone()
    }

    pub fn get_channel_endpoint(&self) -> Option<String> {
        self.channel.get_endpoint()
            .or_else(|| get_default_configs().proxy.channel.get_endpoint())
    }

    pub fn get_channel_buffer_size(&self) -> Option<usize> {
        self.channel.get_buffer_size()
            .or_else(|| get_default_configs().proxy.channel.get_buffer_size())
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

static USER_CONFIGS: OnceCell<Configs> = OnceCell::new();
static DEFAULT_USER_CONFIGS: OnceCell<Configs> = OnceCell::new();

/// Get the default configs parsed from embedded configs.toml
fn get_default_configs() -> &'static Configs {
    DEFAULT_USER_CONFIGS.get_or_init(|| {
        let toml_str = include_str!("../configs.toml");
        toml::from_str(toml_str).expect("Failed to parse embedded configs.toml")
    })
}

pub fn set_user_config(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let config = get_configs(path);
    if USER_CONFIGS.set(config).is_err() {
        // Configs may be initialized multiple times in dev/hot-reload runs; keep the first one.
        tracing::warn!("User configs already set; reusing existing instance");
    }
    Ok(())
}

pub fn get_configs(config_path: &str) -> Configs {
    tracing::info!("Loading configs from: {}", config_path);
    const DEFAULT_TOML_FILE: &str = include_str!("../configs.toml");
    let default_parse_result: Result<Configs, toml::de::Error> = toml::from_str(DEFAULT_TOML_FILE);
    if default_parse_result.is_err() {
        let error_message = format!(
            "Failed to parse default TOML: {}",
            default_parse_result.err().unwrap()
        );
        tracing::error!("{error_message}");
        panic!("{error_message}");
    }
    let default_configs: Configs = default_parse_result.unwrap();
    DEFAULT_USER_CONFIGS.get_or_init(|| default_configs.clone());

    // Write TOML to file
    if fs::metadata(config_path).is_err() {
        tracing::warn!(
            "Config file not found, creating default at: {}",
            config_path
        );
        let mut file = File::create(config_path).expect_or_log("Failed to create config file");
        write!(file, "{DEFAULT_TOML_FILE}").expect_or_log("Failed to write default config");
        file.flush().expect_or_log("Failed to flush config file");
    }

    // Read file and parse to Configs
    let user_toml_file: String =
        fs::read_to_string(config_path).expect_or_log("Failed to read config file");
    let user_parse_result: Result<Configs, toml::de::Error> = toml::from_str(&user_toml_file);
    let user_configs: Configs = match user_parse_result {
        Ok(p) => p,
        Err(_) => {
            tracing::error!("Failed to parse TOML: {}", user_parse_result.err().unwrap());
            default_configs
        }
    };

    // Update config file to include any new fields from default template
    if let Err(e) = update_config_file(config_path) {
        tracing::warn!("Failed to update config file with new fields: {}", e);
    }

    user_configs
}

pub fn get_user_configs() -> Configs {
    if let Some(configs) = USER_CONFIGS.get() {
        return configs.clone();
    }

    // Avoid creating a configs.toml in the current working directory when the
    // caller forgets to call set_user_config(). In that case, fall back to the
    // embedded defaults without touching the filesystem.
    tracing::warn!(
        "User configs not initialized; using embedded defaults (no file written)"
    );
    get_default_configs().clone()
}

/// Merge and update user config file with default template, preserving comments
pub fn update_config_file(config_path: &str) -> Result<(), Box<dyn std::error::Error>> {
    use toml_edit::DocumentMut;
    
    const DEFAULT_TOML_FILE: &str = include_str!("../configs.toml");
    
    // Parse default TOML with comments preserved
    let mut default_doc = DEFAULT_TOML_FILE.parse::<DocumentMut>()?;
    
    // Read existing user config if it exists
    let user_toml_content = fs::read_to_string(config_path).unwrap_or_default();
    
    if user_toml_content.is_empty() {
        // No existing file, just write default
        fs::write(config_path, DEFAULT_TOML_FILE)?;
        tracing::info!("Created new config file with defaults at: {}", config_path);
        return Ok(());
    }
    
    // Parse existing user config
    let user_doc = user_toml_content.parse::<DocumentMut>()?;
    
    // Merge: copy user values into default doc structure
    merge_toml_values(&mut default_doc, &user_doc);
    
    // Write merged config back
    fs::write(config_path, default_doc.to_string())?;
    tracing::info!("Updated config file at: {}", config_path);
    
    Ok(())
}

/// Recursively merge user values into default document
fn merge_toml_values(default_doc: &mut toml_edit::DocumentMut, user_doc: &toml_edit::DocumentMut) {
    use toml_edit::Item;
    
    for (key, user_item) in user_doc.iter() {
        if let Some(default_item) = default_doc.get_mut(key) {
            match (default_item, user_item) {
                (Item::Table(default_table), Item::Table(user_table)) => {
                    // Recursively merge tables
                    merge_table_values(default_table, user_table);
                }
                (Item::Value(default_value), Item::Value(user_value)) => {
                    // Copy user value to default
                    *default_value = user_value.clone();
                }
                _ => {
                    // Type mismatch, keep default
                }
            }
        }
    }
}

/// Merge table values recursively
fn merge_table_values(default_table: &mut toml_edit::Table, user_table: &toml_edit::Table) {
    use toml_edit::Item;
    
    for (key, user_item) in user_table.iter() {
        if let Some(default_item) = default_table.get_mut(key) {
            match (default_item, user_item) {
                (Item::Table(nested_default), Item::Table(nested_user)) => {
                    merge_table_values(nested_default, nested_user);
                }
                (Item::Value(default_value), Item::Value(user_value)) => {
                    *default_value = user_value.clone();
                }
                _ => {}
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use toml;

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
                panic!("config.toml failed to deserialize into Configs struct: {}", e);
            }
        }
    }

    #[test]
    fn test_all_default_values_match_config_toml() {
        // Initialize default configs from configs.toml
        let default_configs = get_default_configs();
        
        // Test Proxy Network defaults
        let empty_network = ConfigsProxyNetwork {
            backend_crate: None,
            enforce_http: None,
            set_nodelay: None,
            connect_timeout: None,
            keepalive_interval: None,
            recv_buffer_size: None,
            send_buffer_size: None,
            proxy_server_port: None,
        };
        
        assert_eq!(
            empty_network.get_backend_crate(),
            default_configs.proxy.network.get_backend_crate(),
            "backend_crate getter should return configs.toml default"
        );
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
            save_file_location: None,
            network: default_configs.proxy.network.clone(),
            certificates: default_configs.proxy.certificates.clone(),
            pac: default_configs.proxy.pac.clone(),
            channel: default_configs.proxy.channel.clone(),
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
        
        // Test App Autostart defaults
        let empty_autostart = ConfigsAppAutostart {
            enable: None,
        };
        
        assert_eq!(
            empty_autostart.get_enable_autostart(),
            default_configs.app.autostart.get_enable_autostart(),
            "autostart enable getter should return configs.toml default"
        );
        
        // Test App Theme defaults
        let empty_theme = ConfigsAppTheme {
            theme: None,
        };
        
        assert_eq!(
            empty_theme.get_theme(),
            default_configs.app.theme.get_theme(),
            "theme getter should return configs.toml default"
        );
        
        // Test App Font defaults
        let empty_font = ConfigAppFont {
            font_family: None,
        };
        
        assert_eq!(
            empty_font.get_font_family(),
            default_configs.app.font.get_font_family(),
            "font_family getter should return configs.toml default"
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
            allow_data_to_cloud: None,
            allow_data_to_local: None,
            local: default_configs.app.database.local.clone(),
            google_drive: default_configs.app.database.google_drive.clone(),
        };
        
        assert_eq!(
            empty_database_fields.get_allow_data_to_cloud(),
            default_configs.app.database.get_allow_data_to_cloud(),
            "database allow_data_to_cloud getter should return configs.toml default"
        );
        assert_eq!(
            empty_database_fields.get_allow_data_to_local(),
            default_configs.app.database.get_allow_data_to_local(),
            "database allow_data_to_local getter should return configs.toml default"
        );
        
        // Test App Database Google Drive defaults
        let empty_google_drive = ConfigsAppDatabaseGoogleDrive {
            schedule_cron: None,
            page_size: None,
        };
        
        assert_eq!(
            empty_google_drive.get_schedule_cron(),
            default_configs.app.database.google_drive.get_schedule_cron(),
            "google_drive schedule_cron getter should return configs.toml default"
        );
        assert_eq!(
            empty_google_drive.get_page_size(),
            default_configs.app.database.google_drive.get_page_size(),
            "google_drive page_size getter should return configs.toml default"
        );
        
        // Test App Asset Sync defaults
        let empty_asset_sync = ConfigsAppAssetSync {
            asset_upload_enable: None,
            scan_interval_seconds: None,
            asset_upload_endpoint: None,
            fleet_snapshot_endpoint: None,
            asset_key_prefix: None,
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
        
        // Test App Auth defaults
        let empty_auth = ConfigsAppAuth {
            deny_auth: None,
            auth_page_url: None,
        };
        
        assert_eq!(
            empty_auth.get_deny_auth(),
            default_configs.app.auth.get_deny_auth(),
            "auth deny_auth getter should return configs.toml default"
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
            window_title_bar_height: None,
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
            let expected = default_configs.app.connect_kc_server.get_server_address(index);
            
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
}