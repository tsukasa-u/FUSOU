use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

pub fn show(app: &AppHandle, title: &str, body: &str) {
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}

pub fn success(app: &AppHandle, body: &str) {
    show(app, "Success", body);
}

pub fn info(app: &AppHandle, body: &str) {
    show(app, "Info", body);
}

pub fn warn(app: &AppHandle, body: &str) {
    show(app, "Warning", body);
}

pub fn error(app: &AppHandle, body: &str) {
    show(app, "Error", body);
}
