use configs;

pub fn open_auth_page() -> Result<(), String> {
    if configs::get_user_configs_for_app().auth.get_deny_auth() {
        return Err("User authentication is denied".into());
    }

    let auth_page_url = configs::get_user_configs_for_app().auth.get_auth_page_url();
    let result = webbrowser::open(&auth_page_url).map_err(|e| e.to_string());
    return result;
}
