use tauri::{Manager, Runtime, WebviewWindow, WebviewWindowBuilder};

/// Configure standard frameless, transparent, undecorated window properties
pub fn configure_frameless_window<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(true)
}

/// Setup OS-level attributes and behaviors for any custom frameless window
pub fn setup_frameless_window(window: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        apply_windows_rounded_corners_hwnd(hwnd.0 as *mut std::ffi::c_void, window.label());
    }
}

/// Setup OS-level attributes for a raw `tauri::Window` (used by combined multi-webview mode).
/// Adds `WS_CLIPCHILDREN` on Windows so parent repaints never paint over child WebView2 HWNDs.
pub fn setup_combined_parent_window(window: &tauri::Window) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        let hwnd_ptr = hwnd.0 as *mut std::ffi::c_void;
        apply_windows_rounded_corners_hwnd(hwnd_ptr, window.label());
        apply_windows_clip_children_hwnd(hwnd_ptr, window.label());
    }
    #[cfg(not(windows))]
    {
        let _ = window;
    }
}

#[cfg(windows)]
fn apply_windows_clip_children_hwnd(hwnd_ptr: *mut std::ffi::c_void, label: &str) {
    #[link(name = "user32")]
    extern "system" {
        fn GetWindowLongW(hwnd: *mut std::ffi::c_void, nIndex: i32) -> i32;
        fn SetWindowLongW(hwnd: *mut std::ffi::c_void, nIndex: i32, dwNewLong: i32) -> i32;
    }

    const GWL_STYLE: i32 = -16;
    const WS_CLIPCHILDREN: i32 = 0x0200_0000;

    unsafe {
        let current = GetWindowLongW(hwnd_ptr, GWL_STYLE);
        if (current & WS_CLIPCHILDREN) == 0 {
            let prev = SetWindowLongW(hwnd_ptr, GWL_STYLE, current | WS_CLIPCHILDREN);
            tracing::debug!(
                "applied WS_CLIPCHILDREN to combined window '{}' (prev_style={:#x})",
                label,
                prev
            );
        }
    }
}

#[cfg(windows)]
fn apply_windows_rounded_corners_hwnd(hwnd_ptr: *mut std::ffi::c_void, label: &str) {
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: *mut std::ffi::c_void,
            dwAttribute: u32,
            pvAttribute: *const std::ffi::c_void,
            cbAttribute: u32,
        ) -> i32;
    }

    unsafe {
        // 1. Force dark mode frame so DWM compositing uses black/dark fallback instead of white
        const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
        let dark_mode = 1i32;
        let res_dark = DwmSetWindowAttribute(
            hwnd_ptr,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &dark_mode as *const _ as *const std::ffi::c_void,
            std::mem::size_of_val(&dark_mode) as u32,
        );

        // 2. Prevent DWM from drawing opaque white corner buffers behind our transparent CSS corners
        const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
        const DWMWCP_DONOTROUND: u32 = 1;
        let preference = DWMWCP_DONOTROUND;
        let res_corner = DwmSetWindowAttribute(
            hwnd_ptr,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const _ as *const std::ffi::c_void,
            std::mem::size_of_val(&preference) as u32,
        );

        // 3. Remove DWM default white border outline
        const DWMWA_BORDER_COLOR: u32 = 34;
        const DWMWA_COLOR_NONE: u32 = 0xFFFFFFFE;
        let border_color = DWMWA_COLOR_NONE;
        let res_border = DwmSetWindowAttribute(
            hwnd_ptr,
            DWMWA_BORDER_COLOR,
            &border_color as *const _ as *const std::ffi::c_void,
            std::mem::size_of_val(&border_color) as u32,
        );

        tracing::debug!(
            "setup_frameless_window for '{}': dark={res_dark}, corner={res_corner}, border={res_border}",
            label
        );
    }
}
