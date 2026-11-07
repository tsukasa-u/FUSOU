use std::sync::OnceLock;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

static GLOBAL_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn set_app_handle(handle: AppHandle) {
    let _ = GLOBAL_APP_HANDLE.set(handle);
}

pub fn show<R: tauri::Runtime>(app: &AppHandle<R>, title: &str, body: &str) {
    #[cfg(target_os = "linux")]
    {
        // On Linux, calling synchronous D-Bus notification methods directly from the
        // GTK main event loop thread (e.g. inside WebKitGTK async callbacks like snapshot)
        // can cause event loop starvation or deadlocks with the notification daemon.
        // Spawning on a background thread ensures notifications are sent cleanly without blocking GTK.
        let app = app.clone();
        let title = title.to_string();
        let body = body.to_string();
        std::thread::spawn(move || {
            if let Err(error) = app.notification().builder().title(&title).body(&body).show() {
                tracing::warn!(
                    notification_title = title,
                    error = %error,
                    "failed to show notification"
                );
            }
        });
        return;
    }

    #[cfg(not(target_os = "linux"))]
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

