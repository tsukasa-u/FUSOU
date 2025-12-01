use crate::storage::providers::gdrive;
use tauri::{Emitter, Manager, Url};
use fusou_auth::{AuthManager, FileStorage, Session};
use std::sync::{Arc, Mutex};

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
            let _ = gdrive::set_refresh_token(providrer_refresh_token, token_type.to_owned());
        }
        if !supabase_refresh_token.is_empty() && !supabase_access_token.is_empty() {
            let auth_manager = app.state::<Arc<Mutex<AuthManager<FileStorage>>>>();
            let manager = { auth_manager.lock().unwrap().clone() };
            
            let session = Session {
                access_token: supabase_access_token.clone(),
                refresh_token: supabase_refresh_token.clone(),
                expires_at: None,
                token_type: Some("bearer".to_string()),
            };
            
            // We can't await here easily because single_instance_init is synchronous?
            // But we can spawn a task.
            tauri::async_runtime::spawn(async move {
                if let Err(e) = manager.save_session(&session).await {
                    tracing::error!("Failed to save session in single instance: {}", e);
                }
            });

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
