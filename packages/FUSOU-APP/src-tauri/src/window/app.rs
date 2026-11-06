use tauri::AppHandle;

pub fn open_main_window(app: &AppHandle) {
    match tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
        .title("fusou-app")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(true)
        .build()
    {
        Ok(window) => {
            #[cfg(windows)]
            crate::window::external::apply_windows_rounded_corners(&window);
        }
        Err(e) => {
            tracing::warn!("failed to open main window: {}", e);
        }
    }
}
