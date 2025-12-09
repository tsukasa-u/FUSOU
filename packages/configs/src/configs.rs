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
    #[serde(default = "default_use_generated_certs")]
    use_generated_certs: Option<bool>,
    cert_file: Option<String>,
    key_file: Option<String>,
}

fn default_use_generated_certs() -> Option<bool> {
    Some(true)
}

impl Default for ConfigsProxyCertificates {
    fn default() -> Self {
        Self {
            use_generated_certs: Some(true),
            cert_file: Some("path/to/cert/file".to_string()),
            key_file: Some("path/to/key/file".to_string()),
        }
    }
}

impl ConfigsProxyCertificates {
    pub fn get_use_generated_certs(&self) -> bool {
        self.use_generated_certs.unwrap_or(false)
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
    #[serde(default = "default_use_custom_pac")]
    use_custom_pac: Option<bool>,
    pac_script: Option<String>,
    #[serde(default)]
    pac_server_port: Option<i64>,
}

fn default_use_custom_pac() -> Option<bool> {
    Some(false)
}

impl Default for ConfigsProxyPac {
    fn default() -> Self {
        Self {
            use_custom_pac: Some(false),
            pac_script: Some("path/to/pac/script.pac".to_string()),
            pac_server_port: Some(0),
        }
    }
}

impl ConfigsProxyPac {
    pub fn get_use_custom_pac(&self) -> bool {
        self.use_custom_pac.unwrap_or(true)
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
            .unwrap_or(0) as u16
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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ConfigsProxyChannel {
    #[serde(default)]
    pub transport: ChannelTransportKind,
    #[serde(default)]
    endpoint: Option<String>,
    #[serde(default)]
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
    #[serde(default = "default_backend_crate")]
    backend_crate: Option<String>,
    #[serde(default)]
    enforce_http: Option<bool>,
    #[serde(default)]
    set_nodelay: Option<bool>,
    #[serde(default)]
    connect_timeout: Option<i64>,
    #[serde(default)]
    keepalive_interval: Option<i64>,
    #[serde(default = "default_recv_buffer_size")]
    recv_buffer_size: Option<i64>,
    #[serde(default = "default_send_buffer_size")]
    send_buffer_size: Option<i64>,
    #[serde(default)]
    proxy_server_port: Option<i64>,
}

fn default_backend_crate() -> Option<String> {
    Some("hudsucker".to_string())
}

fn default_recv_buffer_size() -> Option<i64> {
    Some(8_000_000)
}

fn default_send_buffer_size() -> Option<i64> {
    Some(8_000_000)
}

impl Default for ConfigsProxyNetwork {
    fn default() -> Self {
        Self {
            backend_crate: Some("hudsucker".to_string()),
            enforce_http: Some(false),
            set_nodelay: Some(false),
            connect_timeout: Some(0),
            keepalive_interval: Some(0),
            recv_buffer_size: Some(8_000_000),
            send_buffer_size: Some(8_000_000),
            proxy_server_port: Some(0),
        }
    }
}

impl ConfigsProxyNetwork {
    pub fn get_backend_crate(&self) -> String {
        self.backend_crate
            .clone()
            .unwrap_or("hudsucker".to_string())
    }

    pub fn get_enforce_http(&self) -> bool {
        self.enforce_http.unwrap_or(false)
    }

    pub fn get_set_nodelay(&self) -> bool {
        self.set_nodelay.unwrap_or(false)
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
            .unwrap_or(0) as u16
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ConfigsAppConnectKcServer {
    #[serde(default)]
    kc_server_name: Option<String>,
    #[serde(default)]
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
        match server_index {
            1 => Some("w01y.kancolle-server.com".to_string()),
            2 => Some("w02k.kancolle-server.com".to_string()),
            3 => Some("w03s.kancolle-server.com".to_string()),
            4 => Some("w04m.kancolle-server.com".to_string()),
            5 => Some("w05o.kancolle-server.com".to_string()),
            6 => Some("w06k.kancolle-server.com".to_string()),
            7 => Some("w07l.kancolle-server.com".to_string()),
            8 => Some("w08r.kancolle-server.com".to_string()),
            9 => Some("w09s.kancolle-server.com".to_string()),
            10 => Some("w10b.kancolle-server.com".to_string()),
            11 => Some("w11t.kancolle-server.com".to_string()),
            12 => Some("w12p.kancolle-server.com".to_string()),
            13 => Some("w13b.kancolle-server.com".to_string()),
            14 => Some("w14h.kancolle-server.com".to_string()),
            15 => Some("w15p.kancolle-server.com".to_string()),
            16 => Some("w16s.kancolle-server.com".to_string()),
            17 => Some("w17k.kancolle-server.com".to_string()),
            18 => Some("w18i.kancolle-server.com".to_string()),
            19 => Some("w19s.kancolle-server.com".to_string()),
            20 => Some("w20h.kancolle-server.com".to_string()),
            _ => None,
        }
    }

    pub fn get_all_servers(&self) -> std::collections::HashMap<i32, String> {
        if let Some(map) = &self.server_list {
            map.clone()
        } else {
            self.get_default_servers()
        }
    }

    fn get_default_servers(&self) -> std::collections::HashMap<i32, String> {
        let mut map = std::collections::HashMap::new();
        for i in 1..=20 {
            if let Some(addr) = self.get_default_server_address(i) {
                map.insert(i, addr);
            }
        }
        map
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppBrowser {
    #[serde(default = "default_browser_url")]
    url: Option<String>,
}

fn default_browser_url() -> Option<String> {
    Some("http://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/".to_string())
}

impl Default for ConfigsAppBrowser {
    fn default() -> Self {
        Self {
            url: Some("http://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/".to_string()),
        }
    }
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
    #[serde(default)]
    enable: Option<bool>,
}

impl Default for ConfigsAppAutostart {
    fn default() -> Self {
        Self {
            enable: Some(false),
        }
    }
}

impl ConfigsAppAutostart {
    pub fn get_enable_autostart(&self) -> bool {
        self.enable.unwrap_or(false)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppTheme {
    #[serde(default = "default_theme")]
    theme: Option<String>,
}

fn default_theme() -> Option<String> {
    Some("light".to_string())
}

impl Default for ConfigsAppTheme {
    fn default() -> Self {
        Self {
            theme: Some("light".to_string()),
        }
    }
}

impl ConfigsAppTheme {
    pub fn get_theme(&self) -> String {
        self.theme.clone().unwrap_or("light".to_string())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigAppFont {
    #[serde(default = "default_font_family")]
    font_family: Option<String>,
}

fn default_font_family() -> Option<String> {
    Some("Noto Sans JP".to_string())
}

impl Default for ConfigAppFont {
    fn default() -> Self {
        Self {
            font_family: Some("Noto Sans JP".to_string()),
        }
    }
}

impl ConfigAppFont {
    pub fn get_font_family(&self) -> String {
        self.font_family
            .clone()
            .unwrap_or("Noto Sans JP, sans-serif".to_string())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppDiscord {
    #[serde(default)]
    enable_discord_integration: Option<bool>,
    #[serde(default)]
    use_custom_message: Option<bool>,
    #[serde(default)]
    custom_message: Option<String>,
    #[serde(default)]
    custom_details: Option<String>,
    #[serde(default)]
    use_custom_image: Option<bool>,
    #[serde(default)]
    custom_image_url: Option<String>,
}

impl Default for ConfigsAppDiscord {
    fn default() -> Self {
        Self {
            enable_discord_integration: Some(false),
            use_custom_message: Some(false),
            custom_message: Some("".to_string()),
            custom_details: Some("".to_string()),
            use_custom_image: Some(false),
            custom_image_url: Some("".to_string()),
        }
    }
}

impl ConfigsAppDiscord {
    pub fn get_enable_discord_integration(&self) -> bool {
        self.enable_discord_integration.unwrap_or(false)
    }

    pub fn get_use_custom_message(&self) -> bool {
        self.use_custom_message.unwrap_or(false)
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
        self.use_custom_image.unwrap_or(false)
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
    #[serde(default = "default_schedule_cron")]
    schedule_cron: Option<String>,
    #[serde(default = "default_page_size")]
    page_size: Option<i64>,
}

fn default_schedule_cron() -> Option<String> {
    Some("0 0 * * * *".to_string())
}

fn default_page_size() -> Option<i64> {
    Some(100)
}

impl Default for ConfigsAppDatabaseGoogleDrive {
    fn default() -> Self {
        Self {
            schedule_cron: Some("0 0 * * * *".to_string()),
            page_size: Some(100),
        }
    }
}

impl ConfigsAppDatabaseGoogleDrive {
    pub fn get_schedule_cron(&self) -> String {
        self.schedule_cron
            .clone()
            .unwrap_or("0 0 * * * *".to_string()) // every hour
    }

    pub fn get_page_size(&self) -> i64 {
        match self.page_size {
            Some(v) if v <= 0 => 100,
            Some(v) if v > 100 => 100,
            Some(v) => v,
            None => 100,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct ConfigsAppDatabaseLocal {
    #[serde(default)]
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
    #[serde(default)]
    allow_data_to_cloud: Option<bool>,
    #[serde(default)]
    allow_data_to_local: Option<bool>,
    #[serde(default)]
    pub local: ConfigsAppDatabaseLocal,
    #[serde(default)]
    pub google_drive: ConfigsAppDatabaseGoogleDrive,
}

impl Default for ConfigsAppDatabase {
    fn default() -> Self {
        Self {
            allow_data_to_cloud: Some(false),
            allow_data_to_local: Some(false),
            local: ConfigsAppDatabaseLocal::default(),
            google_drive: ConfigsAppDatabaseGoogleDrive::default(),
        }
    }
}

impl ConfigsAppDatabase {
    pub fn get_allow_data_to_cloud(&self) -> bool {
        self.allow_data_to_cloud.unwrap_or(false)
    }

    pub fn get_allow_data_to_local(&self) -> bool {
        self.allow_data_to_local.unwrap_or(false)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppAssetSync {
    #[serde(default = "default_asset_upload_enable")]
    asset_upload_enable: Option<bool>,
    #[serde(default = "default_asset_sync_scan_interval_seconds")]
    scan_interval_seconds: Option<u64>,
    #[serde(default = "default_asset_upload_endpoint")]
    asset_upload_endpoint: Option<String>,
    #[serde(default = "default_fleet_snapshot_endpoint")]
    fleet_snapshot_endpoint: Option<String>,
    #[serde(default = "default_asset_key_prefix")]
    asset_key_prefix: Option<String>,
    #[serde(default = "default_kc_period_endpoint")]
    kc_period_endpoint: Option<String>,
    #[serde(default = "default_asset_skip_extensions")]
    asset_skip_extensions: Option<Vec<String>>,
    #[serde(default = "default_asset_existing_keys_endpoint")]
    asset_existing_keys_endpoint: Option<String>,
    #[serde(default)]
    pub finder_tag: Option<String>,
    #[serde(default)]
    pub retry: ConfigsAppAssetSyncRetry,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppAssetSyncRetry {
    #[serde(default = "default_retry_max_attempts")]
    max_attempts: Option<u32>,
    #[serde(default = "default_retry_ttl_seconds")]
    ttl_seconds: Option<u64>,
    #[serde(default = "default_retry_interval_seconds")]
    interval_seconds: Option<u64>,
}

fn default_retry_max_attempts() -> Option<u32> {
    Some(5)
}

fn default_retry_ttl_seconds() -> Option<u64> {
    Some(86400) // 24 hours
}

fn default_retry_interval_seconds() -> Option<u64> {
    Some(300) // 5 minutes
}

impl Default for ConfigsAppAssetSyncRetry {
    fn default() -> Self {
        Self {
            max_attempts: Some(5),
            ttl_seconds: Some(86400),
            interval_seconds: Some(300),
        }
    }
}

impl ConfigsAppAssetSyncRetry {
    pub fn get_max_attempts(&self) -> u32 {
        self.max_attempts.unwrap_or(5)
    }

    pub fn get_ttl_seconds(&self) -> u64 {
        self.ttl_seconds.unwrap_or(86400)
    }

    pub fn get_interval_seconds(&self) -> u64 {
        self.interval_seconds.unwrap_or(300)
    }
}

fn default_asset_upload_enable() -> Option<bool> {
    Some(false)
}

fn default_asset_sync_scan_interval_seconds() -> Option<u64> {
    Some(30)
}

fn default_asset_upload_endpoint() -> Option<String> {
    Some("".to_string())
}

fn default_asset_key_prefix() -> Option<String> {
    Some("assets".to_string())
}

fn default_kc_period_endpoint() -> Option<String> {
    Some("".to_string())
}

fn default_asset_skip_extensions() -> Option<Vec<String>> {
    Some(vec!["mp3".to_string()])
}

fn default_asset_existing_keys_endpoint() -> Option<String> {
    Some("".to_string())
}

fn default_fleet_snapshot_endpoint() -> Option<String> {
    Some("".to_string())
}

impl Default for ConfigsAppAssetSync {
    fn default() -> Self {
        Self {
            asset_upload_enable: Some(false),
            scan_interval_seconds: Some(30),
            asset_upload_endpoint: Some("".to_string()),
            fleet_snapshot_endpoint: Some("".to_string()),
            asset_key_prefix: Some("assets".to_string()),
            kc_period_endpoint: Some("".to_string()),
            asset_skip_extensions: default_asset_skip_extensions(),
            asset_existing_keys_endpoint: Some("".to_string()),
            finder_tag: None,
            retry: ConfigsAppAssetSyncRetry::default(),
        }
    }
}

impl ConfigsAppAssetSync {
    pub fn get_enable(&self) -> bool {
        // Backward-compatible wrapper
        self.get_asset_upload_enable()
    }

    pub fn get_asset_upload_enable(&self) -> bool {
        self.asset_upload_enable.unwrap_or(false)
    }

    pub fn get_scan_interval_seconds(&self) -> u64 {
        match self.scan_interval_seconds {
            Some(v) if v == 0 => 30,
            Some(v) => v,
            None => 30,
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
            .unwrap_or_default()
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppAuth {
    #[serde(default = "default_deny_auth")]
    pub deny_auth: Option<bool>,
    #[serde(default = "default_auth_page_url")]
    pub auth_page_url: Option<String>,
}

fn default_deny_auth() -> Option<bool> {
    Some(true)
}

fn default_auth_page_url() -> Option<String> {
    Some("https://fusou.pages.dev/signinLocalApp".to_string())
}

impl Default for ConfigsAppAuth {
    fn default() -> Self {
        Self {
            deny_auth: Some(true),
            auth_page_url: Some("https://fusou.pages.dev/signinLocalApp".to_string()),
        }
    }
}

impl ConfigsAppAuth {
    pub fn get_deny_auth(&self) -> bool {
        self.deny_auth.unwrap_or(true)
    }

    pub fn get_auth_page_url(&self) -> String {
        match &self.auth_page_url {
            Some(v) if !v.is_empty() => v.clone(),
            _ => "https://fusou.pages.dev/signinLocalApp".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsAppWindow {
    #[serde(default = "default_resize_debounce_millis")]
    resize_debounce_millis: Option<u64>,
    #[serde(default = "default_keep_window_size_duration_millis")]
    keep_window_size_duration_millis: Option<u64>,
    #[serde(default = "default_max_inner_width")]
    max_inner_width: Option<u32>,
    #[serde(default = "default_max_inner_height")]
    max_inner_height: Option<u32>,
    #[serde(default = "default_default_inner_width")]
    default_inner_width: Option<u32>,
    #[serde(default = "default_default_inner_height")]
    default_inner_height: Option<u32>,
    #[serde(default = "default_window_title_bar_height")]
    window_title_bar_height: Option<u32>,
}

fn default_resize_debounce_millis() -> Option<u64> {
    Some(200)
}

fn default_keep_window_size_duration_millis() -> Option<u64> {
    Some(1000)
}

fn default_max_inner_width() -> Option<u32> {
    Some(1920)
}

fn default_max_inner_height() -> Option<u32> {
    Some(1080)
}

fn default_default_inner_width() -> Option<u32> {
    Some(1200)
}

fn default_default_inner_height() -> Option<u32> {
    Some(720)
}

fn default_window_title_bar_height() -> Option<u32> {
    Some(68)
}

impl Default for ConfigsAppWindow {
    fn default() -> Self {
        Self {
            resize_debounce_millis: Some(200),
            keep_window_size_duration_millis: Some(1000),
            max_inner_width: Some(1920),
            max_inner_height: Some(1080),
            default_inner_width: Some(1200),
            default_inner_height: Some(720),
            window_title_bar_height: Some(68),
        }
    }
}

impl ConfigsAppWindow {
    #[cfg(target_os = "linux")]
    pub fn get_resize_debounce_millis(&self) -> u64 {
        self.resize_debounce_millis.unwrap_or(1000)
    }
    #[cfg(target_os = "linux")]
    pub fn get_keep_window_size_duration_millis(&self) -> u64 {
        self.keep_window_size_duration_millis.unwrap_or(1000)
    }
    pub fn get_max_inner_width(&self) -> u32 {
        self.max_inner_width.unwrap_or(1200)
    }
    pub fn get_max_inner_height(&self) -> u32 {
        self.max_inner_height.unwrap_or(720)
    }
    pub fn get_default_inner_width(&self) -> u32 {
        self.default_inner_width.unwrap_or(1200)
    }
    pub fn get_default_inner_height(&self) -> u32 {
        self.default_inner_height.unwrap_or(720)
    }
    #[cfg(target_os = "linux")]
    pub fn get_window_title_bar_height(&self) -> u32 {
        self.window_title_bar_height.unwrap_or(68)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsApp {
    #[serde(default)]
    pub connect_kc_server: ConfigsAppConnectKcServer,
    #[serde(default)]
    pub browser: ConfigsAppBrowser,
    #[serde(default)]
    pub autostart: ConfigsAppAutostart,
    #[serde(default)]
    pub theme: ConfigsAppTheme,
    #[serde(default)]
    pub font: ConfigAppFont,
    #[serde(default)]
    pub discord: ConfigsAppDiscord,
    #[serde(default)]
    pub database: ConfigsAppDatabase,
    #[serde(default)]
    pub asset_sync: ConfigsAppAssetSync,
    #[serde(default)]
    pub auth: ConfigsAppAuth,
    #[serde(default)]
    pub kc_window: ConfigsAppWindow,
}

impl Default for ConfigsApp {
    fn default() -> Self {
        Self {
            connect_kc_server: ConfigsAppConnectKcServer::default(),
            browser: ConfigsAppBrowser::default(),
            autostart: ConfigsAppAutostart::default(),
            theme: ConfigsAppTheme::default(),
            font: ConfigAppFont::default(),
            discord: ConfigsAppDiscord::default(),
            database: ConfigsAppDatabase::default(),
            asset_sync: ConfigsAppAssetSync::default(),
            auth: ConfigsAppAuth::default(),
            kc_window: ConfigsAppWindow::default(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigsProxy {
    #[serde(default)]
    allow_save_api_requests: Option<bool>,
    #[serde(default)]
    allow_save_api_responses: Option<bool>,
    #[serde(default)]
    allow_save_resources: Option<bool>,
    #[serde(default)]
    save_file_location: Option<String>,
    #[serde(default)]
    pub network: ConfigsProxyNetwork,
    #[serde(default)]
    pub certificates: ConfigsProxyCertificates,
    #[serde(default)]
    pub pac: ConfigsProxyPac,
    #[serde(default)]
    pub channel: ConfigsProxyChannel,
}

impl Default for ConfigsProxy {
    fn default() -> Self {
        Self {
            allow_save_api_requests: Some(false),
            allow_save_api_responses: Some(false),
            allow_save_resources: Some(false),
            save_file_location: Some("".to_string()),
            network: ConfigsProxyNetwork::default(),
            certificates: ConfigsProxyCertificates::default(),
            pac: ConfigsProxyPac::default(),
            channel: ConfigsProxyChannel::default(),
        }
    }
}

impl ConfigsProxy {
    pub fn get_allow_save_api_requests(&self) -> bool {
        self.allow_save_api_requests.unwrap_or(false)
    }

    pub fn get_allow_save_api_responses(&self) -> bool {
        self.allow_save_api_responses.unwrap_or(false)
    }

    pub fn get_allow_save_resources(&self) -> bool {
        self.allow_save_resources.unwrap_or(false)
    }

    pub fn get_save_file_location(&self) -> Option<String> {
        match self.save_file_location {
            Some(ref v) if !v.is_empty() => Some(v.clone()),
            _ => None,
        }
    }

    pub fn get_channel_transport(&self) -> ChannelTransportKind {
        self.channel.transport
    }

    pub fn get_channel_endpoint(&self) -> Option<String> {
        self.channel.get_endpoint()
    }

    pub fn get_channel_buffer_size(&self) -> Option<usize> {
        self.channel.get_buffer_size()
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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
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
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    pub proxy: ConfigsProxy,
    #[serde(default)]
    pub app: ConfigsApp,
    #[serde(default)]
    pub asset_sync: ConfigsAppAssetSync,
    #[serde(default)]
    pub env: ConfigEnv,
}

impl Default for Configs {
    fn default() -> Self {
        Self {
            version: None,
            proxy: ConfigsProxy::default(),
            app: ConfigsApp::default(),
            asset_sync: ConfigsAppAssetSync::default(),
            env: ConfigEnv::default(),
        }
    }
}

static USER_CONFIGS: OnceCell<Configs> = OnceCell::new();
static DEFAULT_USER_CONFIGS: OnceCell<Configs> = OnceCell::new();

pub fn set_user_config(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let config = get_configs(path);
    USER_CONFIGS
        .set(config)
        .map_err(|_| "User configs already set")?;
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
    const CONFIGS_PATH: &str = "configs.toml";
    USER_CONFIGS
        .get_or_init(|| get_configs(CONFIGS_PATH))
        .clone()
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
