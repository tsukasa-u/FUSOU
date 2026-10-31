use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

pub fn show<R: tauri::Runtime>(app: &AppHandle<R>, title: &str, body: &str) {
    if let Err(error) = app.notification().builder().title(title).body(body).show() {
        tracing::warn!(
            notification_title = title,
            error = %error,
            "failed to show notification"
        );
    }
}
