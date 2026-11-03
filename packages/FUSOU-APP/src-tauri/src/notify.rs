use std::sync::OnceLock;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

static GLOBAL_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn set_app_handle(handle: AppHandle) {
    let _ = GLOBAL_APP_HANDLE.set(handle);
}

pub fn show<R: tauri::Runtime>(app: &AppHandle<R>, title: &str, body: &str) {
    if let Err(error) = app.notification().builder().title(title).body(body).show() {
        tracing::warn!(
            notification_title = title,
            error = %error,
            "failed to show notification"
        );
    }
}

pub fn show_global(title: &str, body: &str) {
    if let Some(app) = GLOBAL_APP_HANDLE.get() {
        show(app, title, body);
    } else {
        tracing::warn!(title, body, "show_global called before APP_HANDLE was initialized");
    }
}

