use tauri::AppHandle;

pub fn open_main_window(app: &AppHandle) {
    let builder = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
        .title("fusou-app");
    let builder = crate::window::common::configure_frameless_window(builder);

    match builder.build() {
        Ok(window) => {
            crate::window::common::setup_frameless_window(&window);
        }
        Err(e) => {
            tracing::warn!("failed to open main window: {}", e);
        }
    }
}
