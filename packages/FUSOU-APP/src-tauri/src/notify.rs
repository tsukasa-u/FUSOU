use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

pub fn show<R: tauri::Runtime>(app: &AppHandle<R>, title: &str, body: &str) {
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}
