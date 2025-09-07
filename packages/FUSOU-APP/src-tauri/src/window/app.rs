use tauri::AppHandle;

pub fn open_main_window(app: &AppHandle) {
    let _window =
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
            .title("fusou-app")
            .build()
            .unwrap();
}
