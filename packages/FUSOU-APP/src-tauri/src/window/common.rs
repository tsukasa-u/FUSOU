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
        let hwnd_ptr = hwnd.0 as *mut std::ffi::c_void;
        apply_windows_rounded_corners_hwnd(hwnd_ptr, window.label());
        apply_windows_taskbar_icon_hwnd(hwnd_ptr, window.label());
    }
}

/// Setup OS-level attributes for a raw `tauri::Window` (used by combined multi-webview mode).
/// Adds `WS_CLIPCHILDREN` on Windows so parent repaints never paint over child WebView2 HWNDs,
/// and explicitly applies both `ICON_BIG` and `ICON_SMALL` so the Windows taskbar shows the
/// real app icon immediately on first paint.
pub fn setup_combined_parent_window(window: &tauri::Window) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        let hwnd_ptr = hwnd.0 as *mut std::ffi::c_void;
        apply_windows_rounded_corners_hwnd(hwnd_ptr, window.label());
        apply_windows_clip_children_hwnd(hwnd_ptr, window.label());
        apply_windows_taskbar_icon_hwnd(hwnd_ptr, window.label());
    }
    #[cfg(not(windows))]
    {
        let _ = window;
    }
}

/// Re-applies the Windows taskbar and window icons on an existing `tauri::Window`.
/// Useful after `window.show()` once the event loop is actively pumping messages so
/// Windows Explorer refreshes the taskbar button immediately.
pub fn refresh_window_taskbar_icon(window: &tauri::Window) {
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        apply_windows_taskbar_icon_hwnd(hwnd.0 as *mut std::ffi::c_void, window.label());
    }
    #[cfg(not(windows))]
    {
        let _ = window;
    }
}

#[cfg(windows)]
const EMBEDDED_APP_ICO: &[u8] = include_bytes!("../../icons/icon.ico");

#[cfg(windows)]
fn select_ico_entry(ico_bytes: &[u8], desired_size: u32) -> Option<&[u8]> {
    if ico_bytes.len() < 6 {
        return None;
    }
    let icon_type = u16::from_le_bytes([ico_bytes[2], ico_bytes[3]]);
    let count = u16::from_le_bytes([ico_bytes[4], ico_bytes[5]]) as usize;
    if icon_type != 1 || count == 0 {
        return None;
    }

    let mut best: Option<(u32, &[u8])> = None;
    for i in 0..count {
        let entry_offset = 6 + i * 16;
        if entry_offset + 16 > ico_bytes.len() {
            break;
        }
        let raw_w = ico_bytes[entry_offset] as u32;
        let width = if raw_w == 0 { 256 } else { raw_w };
        let bytes_in_res = u32::from_le_bytes([
            ico_bytes[entry_offset + 8],
            ico_bytes[entry_offset + 9],
            ico_bytes[entry_offset + 10],
            ico_bytes[entry_offset + 11],
        ]) as usize;
        let image_offset = u32::from_le_bytes([
            ico_bytes[entry_offset + 12],
            ico_bytes[entry_offset + 13],
            ico_bytes[entry_offset + 14],
            ico_bytes[entry_offset + 15],
        ]) as usize;

        let Some(slice) = ico_bytes.get(image_offset..image_offset.saturating_add(bytes_in_res))
        else {
            continue;
        };

        // Prefer the smallest icon >= desired_size; otherwise fall back to the largest icon.
        let score = if width >= desired_size {
            width - desired_size
        } else {
            10_000 + (desired_size - width)
        };
        if best.map(|(best_score, _)| score < best_score).unwrap_or(true) {
            best = Some((score, slice));
        }
    }

    best.map(|(_, slice)| slice)
}

#[cfg(windows)]
fn load_or_create_windows_app_icons() -> (isize, isize) {
    use std::sync::OnceLock;

    static CACHED_ICONS: OnceLock<(isize, isize)> = OnceLock::new();
    *CACHED_ICONS.get_or_init(|| {
        #[link(name = "kernel32")]
        extern "system" {
            fn GetModuleHandleW(lpModuleName: *const u16) -> *mut std::ffi::c_void;
        }

        #[link(name = "user32")]
        extern "system" {
            fn GetSystemMetrics(nIndex: i32) -> i32;
            fn LoadImageW(
                hInst: *mut std::ffi::c_void,
                name: *const u16,
                r#type: u32,
                cx: i32,
                cy: i32,
                fuLoad: u32,
            ) -> *mut std::ffi::c_void;
            fn CreateIconFromResourceEx(
                presbits: *const u8,
                dwResSize: u32,
                fIcon: i32,
                dwVer: u32,
                cxDesired: i32,
                cyDesired: i32,
                Flags: u32,
            ) -> *mut std::ffi::c_void;
        }

        const IMAGE_ICON: u32 = 1;
        const LR_DEFAULTCOLOR: u32 = 0x0000;
        const LR_SHARED: u32 = 0x8000;
        const SM_CXICON: i32 = 11;
        const SM_CYICON: i32 = 12;
        const SM_CXSMICON: i32 = 49;
        const SM_CYSMICON: i32 = 50;
        // Resource ID embedded by tauri-build (`res.set_icon_with_id(..., "32512")`).
        const APP_ICON_RESOURCE_ID: *const u16 = 32512usize as *const u16;

        let load_size = |cx: i32, cy: i32| -> isize {
            unsafe {
                let hmodule = GetModuleHandleW(std::ptr::null());
                if !hmodule.is_null() {
                    let from_res = LoadImageW(
                        hmodule,
                        APP_ICON_RESOURCE_ID,
                        IMAGE_ICON,
                        cx,
                        cy,
                        LR_SHARED,
                    );
                    if !from_res.is_null() {
                        return from_res as isize;
                    }
                }

                // Fallback: construct HICON directly from the embedded `icons/icon.ico`
                // so dev/test builds never depend on exe resource linking.
                let desired = cx.max(cy).max(16) as u32;
                if let Some(entry) = select_ico_entry(EMBEDDED_APP_ICO, desired) {
                    let hicon = CreateIconFromResourceEx(
                        entry.as_ptr(),
                        entry.len() as u32,
                        1,
                        0x0003_0000,
                        cx,
                        cy,
                        LR_DEFAULTCOLOR,
                    );
                    if !hicon.is_null() {
                        return hicon as isize;
                    }
                }
                0
            }
        };

        let (big_w, big_h, small_w, small_h) = unsafe {
            (
                GetSystemMetrics(SM_CXICON).max(32),
                GetSystemMetrics(SM_CYICON).max(32),
                GetSystemMetrics(SM_CXSMICON).max(16),
                GetSystemMetrics(SM_CYSMICON).max(16),
            )
        };

        let hicon_big = load_size(big_w, big_h);
        let hicon_small = load_size(small_w, small_h);
        (hicon_big, hicon_small)
    })
}

/// Explicitly sets both window-class icons (`GCLP_HICON`, `GCLP_HICONSM`) and per-window icons
/// (`WM_SETICON` for `ICON_BIG` and `ICON_SMALL`).
///
/// `tao` registers its window class with `hIcon = NULL` / `hIconSm = NULL` and clears `ICON_BIG`
/// when `taskbar_icon` is `None`. Setting both class and window icons guarantees Windows Explorer
/// immediately renders FUSOU's icon on the taskbar even when `show()` happens before the event loop
/// starts pumping `WM_GETICON`.
#[cfg(windows)]
fn apply_windows_taskbar_icon_hwnd(hwnd_ptr: *mut std::ffi::c_void, label: &str) {
    #[link(name = "user32")]
    extern "system" {
        fn SendMessageW(
            hWnd: *mut std::ffi::c_void,
            Msg: u32,
            wParam: usize,
            lParam: isize,
        ) -> isize;
        #[cfg(target_pointer_width = "64")]
        fn SetClassLongPtrW(
            hWnd: *mut std::ffi::c_void,
            nIndex: i32,
            dwNewLong: isize,
        ) -> isize;
        #[cfg(target_pointer_width = "32")]
        fn SetClassLongW(hWnd: *mut std::ffi::c_void, nIndex: i32, dwNewLong: i32) -> i32;
    }

    const WM_SETICON: u32 = 0x0080;
    const ICON_SMALL: usize = 0;
    const ICON_BIG: usize = 1;
    const GCLP_HICON: i32 = -14;
    const GCLP_HICONSM: i32 = -34;

    let (hicon_big, hicon_small) = load_or_create_windows_app_icons();

    unsafe {
        if hicon_big != 0 {
            #[cfg(target_pointer_width = "64")]
            {
                SetClassLongPtrW(hwnd_ptr, GCLP_HICON, hicon_big);
            }
            #[cfg(target_pointer_width = "32")]
            {
                SetClassLongW(hwnd_ptr, GCLP_HICON, hicon_big as i32);
            }
            SendMessageW(hwnd_ptr, WM_SETICON, ICON_BIG, hicon_big);
        }

        if hicon_small != 0 {
            #[cfg(target_pointer_width = "64")]
            {
                SetClassLongPtrW(hwnd_ptr, GCLP_HICONSM, hicon_small);
            }
            #[cfg(target_pointer_width = "32")]
            {
                SetClassLongW(hwnd_ptr, GCLP_HICONSM, hicon_small as i32);
            }
            SendMessageW(hwnd_ptr, WM_SETICON, ICON_SMALL, hicon_small);
        }

        tracing::info!(
            "applied Windows taskbar/window icon to '{}' (big={}, small={})",
            label,
            hicon_big != 0,
            hicon_small != 0
        );
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

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn windows_app_icons_load_valid_big_and_small_handles() {
        assert!(select_ico_entry(EMBEDDED_APP_ICO, 32).is_some());
        assert!(select_ico_entry(EMBEDDED_APP_ICO, 16).is_some());

        let (hicon_big, hicon_small) = load_or_create_windows_app_icons();
        assert_ne!(hicon_big, 0, "ICON_BIG handle should be non-null");
        assert_ne!(hicon_small, 0, "ICON_SMALL handle should be non-null");
    }
}
