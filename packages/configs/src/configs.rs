extern crate serde;
extern crate toml;

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;

use once_cell::sync::OnceCell;

use tracing_unwrap::ResultExt;

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct ConfigsProxyCertificates {
    use_generated_certs: Option<bool>,
    cert_file: Option<String>,
    key_file: Option<String>,
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

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct ConfigsProxyPac {
    use_custom_pac: Option<bool>,
    pac_script: Option<String>,
    pac_server_port: Option<i64>,
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

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
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

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct ConfigsAppConnectKcServer {
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

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
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

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct ConfigsAppTheme {
    theme: Option<String>,
}

impl ConfigsAppTheme {
    pub fn get_theme(&self) -> String {
        self.theme.clone().unwrap_or("light".to_string())
    }
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct ConfigAppFont {
    font_family: Option<String>,
}

impl ConfigAppFont {
    pub fn get_font_family(&self) -> String {
        self.font_family
            .clone()
            .unwrap_or("Noto Sans JP, sans-serif".to_string())
    }
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
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

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct ConfigsAppDatabaseGoogleDrive {
    schedule_cron: Option<String>,
    page_size: Option<i64>,
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

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct ConfigsAppDatabase {
    allow_data_to_cloud: Option<bool>,
    pub google_drive: ConfigsAppDatabaseGoogleDrive,
}

impl ConfigsAppDatabase {
    pub fn get_allow_data_to_cloud(&self) -> bool {
        self.allow_data_to_cloud.unwrap_or(false)
    }
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct ConfigsAppAuth {
    pub deny_auth: Option<bool>,
}

impl ConfigsAppAuth {
    pub fn get_deny_auth(&self) -> bool {
        self.deny_auth.unwrap_or(true)
    }
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct ConfigsAppWindow {
    pub resize_debounce_millis: Option<u64>,
}

impl ConfigsAppWindow {
    pub fn get_resize_debounce_millis(&self) -> u64 {
        self.resize_debounce_millis.unwrap_or(1000)
    }
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct ConfigsApp {
    pub connect_kc_server: ConfigsAppConnectKcServer,
    pub browser: ConfigsAppBrowser,
    pub theme: ConfigsAppTheme,
    pub font: ConfigAppFont,
    pub discord: ConfigsAppDiscord,
    pub database: ConfigsAppDatabase,
    pub auth: ConfigsAppAuth,
    pub window: ConfigsAppWindow,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct ConfigsProxy {
    allow_save_api_requests: Option<bool>,
    allow_save_api_responses: Option<bool>,
    allow_save_resources: Option<bool>,
    save_file_location: Option<String>,
    pub network: ConfigsProxyNetwork,
    pub certificates: ConfigsProxyCertificates,
    pub pac: ConfigsProxyPac,
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

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct Configs {
    version: Option<String>,
    pub proxy: ConfigsProxy,
    pub app: ConfigsApp,
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
