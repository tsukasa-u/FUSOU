use tauri::AppHandle;

pub fn create_separate_main_window(app: &AppHandle, show_immediately: bool) {
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("fusou-app")
    .inner_size(1200.0, 720.0)
    .use_https_scheme(true)
    .visible(show_immediately);
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

#[allow(dead_code)]
pub fn open_main_window(app: &AppHandle) {
    crate::window::host::show_primary_window(app);
}
