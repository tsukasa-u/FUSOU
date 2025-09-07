mod configs;

pub fn set_user_config(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    configs::set_user_config(path)
}

pub fn get_user_configs_for_proxy() -> configs::ConfigsProxy {
    configs::get_user_configs().proxy.clone()
}

pub fn get_user_configs_for_app() -> configs::ConfigsApp {
    configs::get_user_configs().app.clone()
}
