use tauri::AppHandle;

pub fn open_main_window(app: &AppHandle) {
    if let Err(e) = tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("fusou-app")
    .build()
    {
        tracing::warn!("failed to open main window: {}", e);
    }
}
