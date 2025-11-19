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
}

impl ConfigsAppConnectKcServer {
    pub fn get_kc_server_name(&self) -> Option<String> {
        match self.kc_server_name {
            Some(ref v) if !v.is_empty() => Some(v.clone()),
            _ => None,
        }
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
pub struct ConfigsAppAuth {
    #[serde(default = "default_deny_auth")]
    pub deny_auth: Option<bool>,
}

fn default_deny_auth() -> Option<bool> {
    Some(true)
}

impl Default for ConfigsAppAuth {
    fn default() -> Self {
        Self {
            deny_auth: Some(true),
        }
    }
}

impl ConfigsAppAuth {
    pub fn get_deny_auth(&self) -> bool {
        self.deny_auth.unwrap_or(true)
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
    pub theme: ConfigsAppTheme,
    #[serde(default)]
    pub font: ConfigAppFont,
    #[serde(default)]
    pub discord: ConfigsAppDiscord,
    #[serde(default)]
    pub database: ConfigsAppDatabase,
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
            theme: ConfigsAppTheme::default(),
            font: ConfigAppFont::default(),
            discord: ConfigsAppDiscord::default(),
            database: ConfigsAppDatabase::default(),
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
    pub env: ConfigEnv,
}

impl Default for Configs {
    fn default() -> Self {
        Self {
            version: None,
            proxy: ConfigsProxy::default(),
            app: ConfigsApp::default(),
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

    user_configs
}

pub fn get_user_configs() -> Configs {
    const CONFIGS_PATH: &str = "configs.toml";
    USER_CONFIGS
        .get_or_init(|| get_configs(CONFIGS_PATH))
        .clone()
}
