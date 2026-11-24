use tauri::AppHandle;

use crate::window::{
    combined, external,
    host::{self, WindowLayoutStatePayload},
    layout::DockPosition,
};

#[tauri::command]
pub async fn get_window_layout_state(app: AppHandle) -> WindowLayoutStatePayload {
    host::get_layout_state(&app)
}

#[tauri::command]
pub async fn set_dock_position(
    app: AppHandle,
    position: String,
) -> Result<WindowLayoutStatePayload, String> {
    let trimmed = position.trim();
    if !matches!(trimmed, "auto" | "right" | "bottom" | "left" | "top") {
        return Err(format!("Unsupported dock_position: {position}"));
    }
    let dock = DockPosition::from_config_str(trimmed);
    combined::set_dock_position(&app, dock, true)?;
    Ok(host::get_layout_state(&app))
}

#[tauri::command]
pub async fn set_dock_panel_ratio(
    app: AppHandle,
    ratio_percent: u32,
) -> Result<WindowLayoutStatePayload, String> {
    combined::set_dock_panel_ratio(&app, ratio_percent, true)?;
    Ok(host::get_layout_state(&app))
}

#[tauri::command]
pub async fn open_game_pane(app: AppHandle) -> WindowLayoutStatePayload {
    external::create_external_window(&app);
    host::get_layout_state(&app)
}

#[tauri::command]
pub async fn close_game_pane(app: AppHandle) -> WindowLayoutStatePayload {
    if host::is_combined_mode(&app) {
        combined::hide_external_child_webview(&app);
    } else if let Some(external_win) = tauri::Manager::get_webview_window(&app, "external") {
        let _ = external_win.close();
    }
    host::get_layout_state(&app)
}

#[tauri::command]
pub async fn begin_splitter_drag(app: AppHandle) {
    if host::is_combined_mode(&app) {
        combined::begin_splitter_drag(&app);
    }
}

#[tauri::command]
pub async fn update_splitter_drag(app: AppHandle, screen_x: f64, screen_y: f64) {
    if host::is_combined_mode(&app) {
        combined::update_splitter_drag(&app, screen_x, screen_y);
    }
}

#[tauri::command]
pub async fn end_splitter_drag(app: AppHandle) {
    if host::is_combined_mode(&app) {
        combined::end_splitter_drag(&app);
    }
}
