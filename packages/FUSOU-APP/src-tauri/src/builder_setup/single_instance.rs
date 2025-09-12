use crate::cloud_storage::google_drive;
use tauri::{Emitter, Manager, Url};

pub fn single_instance_init(app: &tauri::AppHandle, argv: Vec<String>) {
    // Initialization code for single instance
    if let Some(path) = argv.get(1) {
        let url = Url::parse(path).unwrap();

        let mut providrer_refresh_token = String::new();
        let mut supabase_refresh_token = String::new();
        let mut supabase_access_token = String::new();

        url.query_pairs().for_each(|(key, value)| {
            // println!("key: {}, value: {}", key, value);
            if key.eq("provider_refresh_token") {
                providrer_refresh_token = value.to_string();
            } else if key.eq("supabase_refresh_token") {
                supabase_refresh_token = value.to_string();
            } else if key.eq("supabase_access_token") {
                supabase_access_token = value.to_string();
            }
        });
        if !providrer_refresh_token.is_empty() {
            let token_type = "Bearer";
            let _ = google_drive::set_refresh_token(providrer_refresh_token, token_type.to_owned());
        }
        if !supabase_refresh_token.is_empty() && !supabase_access_token.is_empty() {
            app.emit_to(
                "main",
                "set-supabase-tokens",
                vec![&supabase_access_token, &supabase_refresh_token],
            )
            .unwrap();
        }
    }

    let singleton_window = match app.get_webview_window("main") {
        Some(window) => window,
        None => {
            tracing::error!("Failed to get main window");
            return;
        }
    };

    singleton_window.show().unwrap();

    if singleton_window.is_minimized().unwrap() {
        singleton_window.unminimize().unwrap();
    }

    if !singleton_window.is_focused().unwrap() {
        singleton_window.set_focus().unwrap();
    }

    println!("single instance: {:?}", argv.clone().get(1).unwrap());
}
