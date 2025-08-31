extern crate serde;
extern crate toml;

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;

use tokio::sync::OnceCell;

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct ConfigsProxyCertificates {
    use_custom_pac: Option<bool>,
    pac_script: Option<String>,
    pac_server_port: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct ConfigsProxyPac {
    use_custom_pac: Option<bool>,
    pac_script: Option<String>,
    pac_server_port: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct ConfigsProxyNetwork {
    backend_crate: Option<String>,
    enforce_http: Option<bool>,
    set_nodelay: Option<bool>,
    connect_timeout: Option<i64>,
    keepalive_interval: Option<i64>,
    recv_buffer_size: Option<i64>,
    send_buffer_size: Option<i64>,
    proxy_server_port: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct ConfigsAppBrowser {
    url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct ConfigsAppTheme {
    theme: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct ConfigAppFont {
    font_family: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct ConfigsAppDiscord {
    enable_discord_integration: Option<bool>,
    use_custom_message: Option<bool>,
    custom_message: Option<String>,
    custom_details: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct ConfigsAppDatabase {
    allow_data_to_cloud: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct ConfigsAppAuth {
    deny_auth: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct ConfigsApp {
    browser: Option<ConfigsAppBrowser>,
    theme: Option<ConfigsAppTheme>,
    font: Option<ConfigAppFont>,
    discord: Option<ConfigsAppDiscord>,
    database: Option<ConfigsAppDatabase>,
    auth: Option<ConfigsAppAuth>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct ConfigsProxy {
    kc_server_name: Option<String>,
    allow_save_api_requests: Option<bool>,
    allow_save_api_responses: Option<bool>,
    allow_save_resources: Option<bool>,
    save_file_location: Option<String>,
    network: Option<ConfigsProxyNetwork>,
    certificates: Option<ConfigsProxyCertificates>,
    pac: Option<ConfigsProxyPac>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct Configs {
    version: Option<String>,
    proxy: Option<ConfigsProxy>,
    app: Option<ConfigsApp>,
}

static USER_CONFIGS: OnceCell<Configs> = OnceCell::const_new();

async fn get_configs(config_path: &str) -> Result<Configs, Box<dyn std::error::Error>> {
    // Definition of struct instant
    const DEFAULT_TOML_FILE: &str = include_str!("../resources/user/configs.toml");
    let default_parse_result: Result<Configs, toml::de::Error> = toml::from_str(DEFAULT_TOML_FILE);
    if default_parse_result.is_err() {
        panic!(
            "Failed to parse TOML: {}",
            default_parse_result.err().unwrap()
        );
    }
    let default_configs: Configs = default_parse_result.unwrap();

    // Write TOML to file
    if fs::metadata(config_path).is_err() {
        let mut file = File::create(config_path)?;
        write!(file, "{}", DEFAULT_TOML_FILE)?;
        file.flush()?;
    }

    // Read file and parse to Configs
    let user_toml_file: String = fs::read_to_string(config_path)?;
    let user_parse_result: Result<Configs, toml::de::Error> = toml::from_str(&user_toml_file);
    let user_configs: Configs = match user_parse_result {
        Ok(p) => p,
        Err(_) => {
            println!("Failed to parse TOML: {}", user_parse_result.err().unwrap());
            default_configs
        }
    };

    Ok(user_configs)
}

pub async fn get_user_configs() -> Configs {
    const CONFIGS_PATH: &str = "configs.toml";
    (*USER_CONFIGS
        .get_or_init(|| async { get_configs(CONFIGS_PATH).await.unwrap_or_default() })
        .await)
        .clone()
}
