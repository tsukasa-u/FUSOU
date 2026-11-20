use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

mod configs;
mod migrations;

pub fn set_user_config(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    configs::set_user_config(path)
}

pub fn get_user_config_path() -> Option<PathBuf> {
    configs::get_user_config_path()
}

pub fn get_user_configs() -> configs::Configs {
    configs::get_user_configs()
}

pub fn get_user_configs_for_proxy() -> configs::ConfigsProxy {
    configs::get_user_configs().proxy.clone()
}

pub fn get_user_configs_for_app() -> configs::ConfigsApp {
    configs::get_user_configs().app.clone()
}

pub fn export_default_config_values() -> BTreeMap<String, configs::ConfigPatchValue> {
    configs::export_default_config_values()
}

pub fn export_user_config_values(
) -> Result<BTreeMap<String, configs::ConfigPatchValue>, Box<dyn std::error::Error>> {
    configs::export_user_config_values()
}

pub fn update_config_file(
    config_path: &Path,
    updates: &BTreeMap<String, configs::ConfigPatchValue>,
) -> Result<
    (
        configs::Configs,
        BTreeMap<String, configs::ConfigPatchValue>,
    ),
    Box<dyn std::error::Error>,
> {
    configs::update_config_file(config_path, updates)
}

pub fn update_user_config_values(
    updates: &BTreeMap<String, configs::ConfigPatchValue>,
) -> Result<
    (
        configs::Configs,
        BTreeMap<String, configs::ConfigPatchValue>,
    ),
    Box<dyn std::error::Error>,
> {
    configs::update_user_config_values(updates)
}

pub use configs::ConfigPatchValue;
pub use configs::ConfigsAppAssetSync;
pub use configs::ConfigsAppQuestTreeSender;

#[cfg(target_os = "linux")]
pub fn get_user_env() -> configs::ConfigEnv {
    configs::get_user_configs().env.clone()
}

#[cfg(target_os = "linux")]
pub use configs::WindowsSystem;
