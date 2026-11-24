use std::{
    fs,
    path::PathBuf,
    sync::{LazyLock, Mutex},
};
use tauri::{AppHandle, Emitter, Manager};
use tracing_unwrap::ResultExt;

#[cfg(target_os = "linux")]
use std::collections::HashSet;

#[cfg(any(target_os = "linux", windows))]
use chrono::Local;

#[cfg(target_os = "linux")]
use webkit2gtk::{
    gio, SettingsExt, SnapshotOptions, SnapshotRegion, UserContentInjectedFrames,
    UserContentManagerExt, UserScript, UserScriptInjectionTime, WebViewExt,
};

#[cfg(target_os = "linux")]
use gtk::prelude::WidgetExt;

#[cfg(windows)]
use base64::Engine as _;

#[cfg(windows)]
use std::collections::HashSet;

#[cfg(windows)]
use webview2_com::{
    AcceleratorKeyPressedEventHandler, CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR,
    Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_KEY_EVENT_KIND, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
        COREWEBVIEW2_KEY_EVENT_KIND_KEY_UP, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
        COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_UP,
    },
};

static DEFAULT_GAME_URL: &str = "http://www.dmm.com/netgame/social/-/gadgets/=/app_id=854854/";

static GAME_URL: once_cell::sync::OnceCell<String> = once_cell::sync::OnceCell::new();

#[cfg(any(windows, target_os = "linux"))]
static SCREENSHOT_CLIPBOARD: LazyLock<Mutex<Option<arboard::Clipboard>>> =
    LazyLock::new(|| Mutex::new(None));

const FORCE_RENDER_REFRESH_SCRIPT: &str = r#"
(() => {
    try {
        if (typeof window.__fusouForceRenderRefresh === "function") {
            window.__fusouForceRenderRefresh();
            return "force-refresh:hook";
        }

        const element = document.body ?? document.documentElement;
        if (!element) return "force-refresh:no-root";

        const previousDisplay = element.style.display;
        element.style.display = "none";
        void element.offsetHeight;
        element.style.display = previousDisplay || "";
        return "force-refresh:nudge-dom";
    } catch (error) {
        return `force-refresh:error:${String(error)}`;
    }
})();
"#;

#[cfg(windows)]
const VK_F5: u32 = 0x74;
#[cfg(windows)]
const VK_R: u32 = 0x52;
#[cfg(windows)]
const VK_S: u32 = 0x53;
#[cfg(windows)]
const VK_CONTROL: u32 = 0x11;
#[cfg(windows)]
const VK_LCONTROL: u32 = 0xA2;
#[cfg(windows)]
const VK_RCONTROL: u32 = 0xA3;
#[cfg(windows)]
const VK_LWIN: u32 = 0x5B;
#[cfg(windows)]
const VK_RWIN: u32 = 0x5C;
#[cfg(windows)]
const VK_SHIFT: u32 = 0x10;
#[cfg(windows)]
const VK_LSHIFT: u32 = 0xA0;
#[cfg(windows)]
const VK_RSHIFT: u32 = 0xA1;

fn get_game_url() -> String {
    GAME_URL
        .get_or_init(|| {
            if let Some(game_url) = configs::get_user_configs_for_app().browser.get_url() {
                game_url
            } else {
                DEFAULT_GAME_URL.to_string()
            }
        })
        .clone()
}

#[cfg(target_os = "linux")]
static LINUX_KEY_FALLBACK_INSTALLED: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

#[cfg(windows)]
static WINDOWS_KEY_FALLBACK_INSTALLED: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

pub fn unregister_webview_key_fallback(window_label: &str) {
    #[cfg(target_os = "linux")]
    {
        let mut installed = LINUX_KEY_FALLBACK_INSTALLED.lock().expect("mutex poisoned");
        installed.remove(window_label);
    }

    #[cfg(windows)]
    {
        let mut installed = WINDOWS_KEY_FALLBACK_INSTALLED
            .lock()
            .expect("mutex poisoned");
        installed.remove(window_label);
    }

    #[cfg(not(any(target_os = "linux", windows)))]
    {
        let _ = window_label;
    }
}

fn sanitize_filename_fragment(input: &str) -> String {
    input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

fn get_external_screenshot_dir() -> PathBuf {
    if let Some(configured_dir) = configs::get_user_configs_for_app()
        .browser
        .get_external_screenshot_directory()
    {
        let configured_dir = configured_dir.trim();

        if configured_dir == "~" {
            if let Some(home_dir) = dirs::home_dir() {
                return home_dir;
            }
        }

        if let Some(relative_to_home) = configured_dir
            .strip_prefix("~/")
            .or_else(|| configured_dir.strip_prefix("~\\"))
        {
            if let Some(home_dir) = dirs::home_dir() {
                return home_dir.join(relative_to_home);
            }
        }

        return PathBuf::from(configured_dir);
    }

    let mut dir = dirs::picture_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    dir.push("FUSOU");
    dir.push("screenshots");
    dir
}

pub fn parse_game_url() -> Option<tauri::Url> {
    match get_game_url().parse() {
        Ok(url) => Some(url),
        Err(e) => {
            tracing::error!(
                "Invalid game URL in config, cannot open external window: {}",
                e
            );
            None
        }
    }
}

fn get_visible_external_webview(app: &AppHandle) -> Option<tauri::Webview> {
    let external = app.get_webview("external")?;

    if crate::window::host::is_combined_mode(app) {
        let game_visible = app
            .try_state::<crate::window::host::WindowLayoutState>()
            .map(|state| state.snapshot().game_visible)
            .unwrap_or(false);
        if !game_visible {
            return None;
        }
    }

    match external.window().is_visible() {
        Ok(true) => Some(external),
        Ok(false) => None,
        Err(e) => {
            tracing::warn!("failed to determine external window visibility: {}", e);
            None
        }
    }
}

pub fn is_external_window_focused(app: &AppHandle) -> bool {
    let Some(external) = get_visible_external_webview(app) else {
        return false;
    };

    match external.window().is_focused() {
        Ok(is_focused) => is_focused,
        Err(error) => {
            tracing::warn!("failed to determine external window focus: {}", error);
            false
        }
    }
}

#[cfg(target_os = "linux")]
fn eval_external_script_with_callback(
    external: &tauri::Webview,
    script: &'static str,
    action_name: &'static str,
) {
    let callback_action_name = action_name.to_string();

    let eval_result =
        external.with_webview(move |webview| {
            let webview = webview.inner();
            #[allow(deprecated)]
            webview.run_javascript(script, None::<&gio::Cancellable>, move |run_result| {
                match run_result {
                    Ok(_) => {
                        tracing::warn!(
                            "external {} callback received (run_javascript: ok)",
                            callback_action_name
                        );
                    }
                    Err(error) => {
                        tracing::warn!(
                            "external {} callback received (run_javascript: error): {}",
                            callback_action_name,
                            error
                        );
                    }
                }
            });
        });

    if let Err(error) = eval_result {
        tracing::warn!(
            "failed to schedule external {} run_javascript callback: {}",
            action_name,
            error
        );
    }
}

#[cfg(target_os = "linux")]
fn install_linux_webview_key_fallback(external: &tauri::Webview) {
    let window_label = external.label().to_string();

    {
        let mut installed = LINUX_KEY_FALLBACK_INSTALLED.lock().expect("mutex poisoned");
        if !installed.insert(window_label.clone()) {
            return;
        }
    }

    let app_handle = external.app_handle().clone();
    let install_result = external.with_webview(move |webview| {
        let app_handle = app_handle.clone();

        webview
            .inner()
            .connect_key_press_event(move |_view, event| {
                let key = event.keyval();
                let modifiers = event.state();
                let has_ctrl = modifiers.contains(gdk::ModifierType::CONTROL_MASK);
                let has_meta = modifiers.contains(gdk::ModifierType::META_MASK)
                    || modifiers.contains(gdk::ModifierType::SUPER_MASK);
                let has_shift = modifiers.contains(gdk::ModifierType::SHIFT_MASK);
                let has_alt = modifiers.contains(gdk::ModifierType::MOD1_MASK);

                if key == gdk::keys::constants::F5 {
                    tracing::warn!("linux webview key fallback pressed: F5 (external reload)");
                    handle_external_reload_shortcut(&app_handle);
                    return webkit2gtk::glib::Propagation::Stop;
                }

                let is_r = key == gdk::keys::constants::r || key == gdk::keys::constants::R;
                if is_r && (has_ctrl || has_meta) && !has_shift && !has_alt {
                    tracing::warn!(
                        "linux webview key fallback pressed: Ctrl/Super+R (external force refresh)"
                    );
                    handle_external_force_refresh_shortcut(&app_handle);
                    return webkit2gtk::glib::Propagation::Stop;
                }

                let is_s = key == gdk::keys::constants::s || key == gdk::keys::constants::S;
                if is_s && (has_ctrl || has_meta) && !has_shift && !has_alt {
                    tracing::warn!(
                        "linux webview key fallback pressed: Ctrl/Super+S (external screenshot)"
                    );
                    handle_external_screenshot_shortcut(&app_handle);
                    return webkit2gtk::glib::Propagation::Stop;
                }

                webkit2gtk::glib::Propagation::Proceed
            });
    });

    if let Err(error) = install_result {
        tracing::warn!(
            "failed to install linux webview key fallback for {}: {}",
            window_label,
            error
        );

        let mut installed = LINUX_KEY_FALLBACK_INSTALLED.lock().expect("mutex poisoned");
        installed.remove(&window_label);
    } else {
        tracing::warn!(
            "installed linux webview key fallback for external window {}",
            window_label
        );
    }
}

pub fn build_external_init_script(docked: bool) -> String {
    #[cfg(windows)]
    let platform = "windows";
    #[cfg(target_os = "linux")]
    let platform = "linux";
    #[cfg(not(any(windows, target_os = "linux")))]
    let platform = "other";

    let prefix = format!(
        "window.__fusouPlatform = \"{platform}\";\nwindow.__fusouDocked = {docked};\n"
    );

    let raw_script = include_str!("./scripts/external_init_script.js");
    let mut combined = String::with_capacity(prefix.len() + raw_script.len());
    combined.push_str(&prefix);
    combined.push_str(raw_script);
    combined
}

#[cfg(target_os = "linux")]
fn install_linux_webview_scripts(external: &tauri::Webview) {
    let window_label = external.label().to_string();
    let docked = crate::window::host::is_combined_mode(external.app_handle());
    let init_script = build_external_init_script(docked);
    let install_result = external.with_webview(move |webview| {
        let wv = webview.inner();

        if let Some(settings) = WebViewExt::settings(&wv) {
            settings.set_enable_webaudio(true);
            settings.set_media_playback_requires_user_gesture(false);
            settings.set_media_playback_allows_inline(true);
            settings.set_enable_developer_extras(true);
        }

        if let Some(manager) = wv.user_content_manager() {
            let script = UserScript::new(
                &init_script,
                UserContentInjectedFrames::AllFrames,
                UserScriptInjectionTime::Start,
                &[],
                &[],
            );
            manager.add_script(&script);
        }
    });

    if let Err(error) = install_result {
        tracing::warn!(
            "failed to install linux webview scripts for {}: {}",
            window_label,
            error
        );
    } else {
        tracing::info!(
            "installed linux webview scripts (all frames) for external window {}",
            window_label
        );
    }
}

#[cfg(windows)]
fn is_windows_key_down(kind: COREWEBVIEW2_KEY_EVENT_KIND) -> bool {
    kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
        || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
}

#[cfg(windows)]
fn is_windows_key_up(kind: COREWEBVIEW2_KEY_EVENT_KIND) -> bool {
    kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_UP || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_UP
}

#[cfg(windows)]
fn install_windows_webview_key_fallback(external: &tauri::Webview) {
    let window_label = external.label().to_string();

    {
        let mut installed = WINDOWS_KEY_FALLBACK_INSTALLED
            .lock()
            .expect("mutex poisoned");
        if !installed.insert(window_label.clone()) {
            return;
        }
    }

    let app_handle = external.app_handle().clone();
    let callback_window_label = window_label.clone();
    let install_result = external.with_webview(move |webview| {
        let app_handle = app_handle.clone();
        let callback_window_label = callback_window_label.clone();
        let mut ctrl_down = false;
        let mut win_down = false;
        let mut shift_down = false;

        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_controller, args| {
            let Some(args) = args else {
                return Ok(());
            };

            let mut key_kind = COREWEBVIEW2_KEY_EVENT_KIND(0);
            let mut virtual_key = 0u32;

            // WebView2 key event accessors are COM calls.
            unsafe {
                if let Err(error) = args.KeyEventKind(&mut key_kind) {
                    tracing::warn!("failed to read windows key event kind: {}", error);
                    return Ok(());
                }

                if let Err(error) = args.VirtualKey(&mut virtual_key) {
                    tracing::warn!("failed to read windows virtual key: {}", error);
                    return Ok(());
                }
            }

            if is_windows_key_down(key_kind) {
                match virtual_key {
                    VK_CONTROL | VK_LCONTROL | VK_RCONTROL => ctrl_down = true,
                    VK_LWIN | VK_RWIN => win_down = true,
                    VK_SHIFT | VK_LSHIFT | VK_RSHIFT => shift_down = true,
                    VK_F5 => {
                        tracing::warn!("windows webview key fallback pressed: F5 (external reload)");
                        handle_external_reload_shortcut(&app_handle);
                        unsafe {
                            let _ = args.SetHandled(true);
                        }
                    }
                    VK_R if (ctrl_down || win_down) && !shift_down => {
                        tracing::warn!(
                            "windows webview key fallback pressed: Ctrl/Super+R (external force refresh)"
                        );
                        handle_external_force_refresh_shortcut(&app_handle);
                        unsafe {
                            let _ = args.SetHandled(true);
                        }
                    }
                    VK_S if (ctrl_down || win_down) && !shift_down => {
                        tracing::warn!(
                            "windows webview key fallback pressed: Ctrl/Super+S (external screenshot)"
                        );
                        handle_external_screenshot_shortcut(&app_handle);
                        unsafe {
                            let _ = args.SetHandled(true);
                        }
                    }
                    _ => {}
                }
            }

            if is_windows_key_up(key_kind) {
                match virtual_key {
                    VK_CONTROL | VK_LCONTROL | VK_RCONTROL => ctrl_down = false,
                    VK_LWIN | VK_RWIN => win_down = false,
                    VK_SHIFT | VK_LSHIFT | VK_RSHIFT => shift_down = false,
                    _ => {}
                }
            }

            Ok(())
        }));

        let controller = webview.controller();
        let mut event_token = Default::default();

        // Registering an accelerator callback is also a COM call.
        let register_result = unsafe {
            controller.add_AcceleratorKeyPressed(&handler, &mut event_token)
        };

        if let Err(error) = register_result {
            tracing::warn!(
                "failed to install windows webview key fallback for {}: {}",
                callback_window_label,
                error
            );

            let mut installed = WINDOWS_KEY_FALLBACK_INSTALLED
                .lock()
                .expect("mutex poisoned");
            installed.remove(&callback_window_label);
        } else {
            tracing::warn!(
                "installed windows webview key fallback for external window {}",
                callback_window_label
            );
        }
    });

    if let Err(error) = install_result {
        tracing::warn!(
            "failed to schedule windows webview key fallback install for {}: {}",
            window_label,
            error
        );

        let mut installed = WINDOWS_KEY_FALLBACK_INSTALLED
            .lock()
            .expect("mutex poisoned");
        installed.remove(&window_label);
    }
}

pub fn install_webview_hooks(external: &tauri::Webview) {
    #[cfg(target_os = "linux")]
    {
        install_linux_webview_key_fallback(external);
        install_linux_webview_scripts(external);
    }

    #[cfg(windows)]
    {
        install_windows_webview_key_fallback(external);
    }

    #[cfg(not(any(target_os = "linux", windows)))]
    {
        let _ = external;
    }
}

fn nudge_external_window_size(external: &tauri::Webview) {
    if crate::window::host::is_combined_mode(external.app_handle()) {
        crate::window::combined::sync_combined_layout(external.app_handle());
        return;
    }

    let window = external.window();
    let Ok(size) = window.inner_size() else {
        return;
    };

    let nudged_width = if size.width > 1 {
        size.width - 1
    } else {
        size.width.saturating_add(1)
    };

    if nudged_width == size.width {
        return;
    }

    let nudged_size = tauri::PhysicalSize::new(nudged_width, size.height);

    if let Err(e) = window.set_size(nudged_size) {
        tracing::warn!("failed to nudge external window size: {}", e);
        return;
    }

    if let Err(e) = window.set_size(size) {
        tracing::warn!("failed to restore external window size after nudge: {}", e);
    }
}

pub fn reload_focused_external_window(app: &AppHandle) -> bool {
    let Some(external) = get_visible_external_webview(app) else {
        tracing::debug!("skip external reload: external window not found or not visible");
        return false;
    };

    let current_url = external.url().ok();
    tracing::warn!(
        combined = crate::window::host::is_combined_mode(app),
        url = ?current_url,
        bounds = ?external.bounds(),
        "trigger external reload"
    );

    if current_url
        .as_ref()
        .map(|u| u.as_str() == "about:blank" || u.as_str().is_empty())
        .unwrap_or(true)
    {
        if let Some(game_url) = parse_game_url() {
            tracing::warn!(target_url = %game_url, "external webview was on blank URL; navigating to game URL");
            return match external.navigate(game_url) {
                Ok(()) => true,
                Err(error) => {
                    tracing::warn!("failed to navigate external window: {}", error);
                    false
                }
            };
        }
    }

    match external.reload() {
        Ok(()) => true,
        Err(error) => {
            tracing::warn!("failed to reload external window: {}", error);
            false
        }
    }
}

pub fn force_refresh_focused_external_window(app: &AppHandle) -> bool {
    let Some(external) = get_visible_external_webview(app) else {
        tracing::debug!("skip external force refresh: external window not found or not visible");
        return false;
    };

    tracing::warn!("trigger external force refresh");

    #[cfg(target_os = "linux")]
    eval_external_script_with_callback(&external, FORCE_RENDER_REFRESH_SCRIPT, "force-refresh");

    #[cfg(not(target_os = "linux"))]
    if let Err(e) = external.eval(FORCE_RENDER_REFRESH_SCRIPT) {
        tracing::warn!("failed to eval force render refresh script: {}", e);
    }

    // Fallback repaint path that does not depend on page JS responsiveness.
    nudge_external_window_size(&external);
    true
}

#[cfg(any(windows, target_os = "linux"))]
fn decode_png_to_rgba(png_bytes: &[u8]) -> Result<(usize, usize, Vec<u8>), String> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(png_bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|error| format!("failed to decode screenshot for clipboard: {}", error))?;
    let buffer_size = reader
        .output_buffer_size()
        .ok_or_else(|| "screenshot is too large to copy to clipboard".to_string())?;
    let mut buffer = vec![0; buffer_size];
    let info = reader
        .next_frame(&mut buffer)
        .map_err(|error| format!("failed to decode screenshot for clipboard: {}", error))?;

    if info.bit_depth != png::BitDepth::Eight || info.width == 0 || info.height == 0 {
        return Err("screenshot has an unsupported size or color depth".to_string());
    }

    let channels = match info.color_type {
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        png::ColorType::Grayscale => 1,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Indexed => {
            return Err("screenshot palette could not be expanded for clipboard".to_string());
        }
    };
    let width = info.width as usize;
    let height = info.height as usize;
    let row_bytes = width
        .checked_mul(channels)
        .ok_or_else(|| "screenshot dimensions are too large".to_string())?;
    if info.line_size < row_bytes {
        return Err("screenshot data has an invalid row size".to_string());
    }
    let decoded = buffer
        .get(..info.buffer_size())
        .ok_or_else(|| "screenshot data is incomplete".to_string())?;
    let rgba_capacity = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "screenshot dimensions are too large".to_string())?;
    let mut rgba = Vec::with_capacity(rgba_capacity);

    for row_index in 0..height {
        let row_start = row_index * info.line_size;
        let row = &decoded[row_start..row_start + row_bytes];
        for pixel in row.chunks_exact(channels) {
            match info.color_type {
                png::ColorType::Rgb => rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]),
                png::ColorType::Rgba => rgba.extend_from_slice(pixel),
                png::ColorType::Grayscale => {
                    rgba.extend_from_slice(&[pixel[0], pixel[0], pixel[0], 255]);
                }
                png::ColorType::GrayscaleAlpha => {
                    rgba.extend_from_slice(&[pixel[0], pixel[0], pixel[0], pixel[1]]);
                }
                png::ColorType::Indexed => {
                    return Err(
                        "screenshot palette could not be expanded for clipboard".to_string()
                    );
                }
            }
        }
    }

    Ok((width, height, rgba))
}

#[cfg(any(windows, target_os = "linux"))]
fn copy_png_to_clipboard(png_bytes: &[u8]) -> Result<(), String> {
    let (width, height, rgba) = decode_png_to_rgba(png_bytes)?;
    let mut clipboard = SCREENSHOT_CLIPBOARD
        .lock()
        .map_err(|error| format!("failed to access screenshot clipboard: {}", error))?;
    if clipboard.is_none() {
        *clipboard =
            Some(arboard::Clipboard::new().map_err(|error| {
                format!("failed to initialize screenshot clipboard: {}", error)
            })?);
    }
    let clipboard = clipboard
        .as_mut()
        .ok_or_else(|| "screenshot clipboard is not available".to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width,
            height,
            bytes: std::borrow::Cow::Owned(rgba),
        })
        .map_err(|error| format!("failed to copy screenshot to clipboard: {}", error))
}

#[cfg(all(test, any(windows, target_os = "linux")))]
mod screenshot_clipboard_tests {
    use super::*;

    fn encode_png(color_type: png::ColorType, data: &[u8]) -> Vec<u8> {
        let mut png_bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_bytes, 1, 1);
            encoder.set_color(color_type);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().expect("PNG header should encode");
            writer
                .write_image_data(data)
                .expect("PNG pixel should encode");
        }
        png_bytes
    }

    #[test]
    fn converts_rgb_pixels_to_rgba_for_clipboard() {
        let png_bytes = encode_png(png::ColorType::Rgb, &[12, 34, 56]);

        let (width, height, rgba) = decode_png_to_rgba(&png_bytes).expect("RGB PNG should decode");

        assert_eq!((width, height), (1, 1));
        assert_eq!(rgba, [12, 34, 56, 255]);
    }

    #[test]
    fn preserves_alpha_for_rgba_clipboard_pixels() {
        let png_bytes = encode_png(png::ColorType::Rgba, &[12, 34, 56, 78]);

        let (_, _, rgba) = decode_png_to_rgba(&png_bytes).expect("RGBA PNG should decode");

        assert_eq!(rgba, [12, 34, 56, 78]);
    }

    #[test]
    fn centered_aspect_crop_removes_top_bottom_and_side_letterboxes() {
        // Tall pane (e.g. 1421x980 at 1.25x DPI, right-docked panel)
        assert_eq!(
            compute_centered_aspect_crop(1421, 980, GAME_ASPECT_WIDTH, GAME_ASPECT_HEIGHT),
            (0, 64, 1421, 852)
        );
        // Wide pane (e.g. 1920x720, bottom-docked panel)
        assert_eq!(
            compute_centered_aspect_crop(1920, 720, GAME_ASPECT_WIDTH, GAME_ASPECT_HEIGHT),
            (360, 0, 1200, 720)
        );
        // Exact 5:3 pane
        assert_eq!(
            compute_centered_aspect_crop(1200, 720, GAME_ASPECT_WIDTH, GAME_ASPECT_HEIGHT),
            (0, 0, 1200, 720)
        );
    }

    #[cfg(windows)]
    #[test]
    fn crop_png_to_game_aspect_strips_letterbox_rows() {
        // 10x10 PNG: 5:3 aspect inside 10x10 is 10x6 centered at y = 2..8
        let mut raw = Vec::with_capacity(10 * 10 * 4);
        for y in 0..10 {
            for _x in 0..10 {
                if (2..8).contains(&y) {
                    raw.extend_from_slice(&[20, 180, 90, 255]);
                } else {
                    raw.extend_from_slice(&[14, 14, 17, 255]);
                }
            }
        }
        let mut png_bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_bytes, 10, 10);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().expect("header");
            writer.write_image_data(&raw).expect("data");
        }

        let cropped = crop_png_to_game_aspect(&png_bytes).expect("crop succeeds");
        let (w, h, rgba) = decode_png_to_rgba(&cropped).expect("decode cropped");
        assert_eq!((w, h), (10, 6));
        assert!(rgba.chunks_exact(4).all(|px| px == [20, 180, 90, 255]));
    }
}

#[cfg(any(windows, target_os = "linux"))]
fn save_screenshot_and_copy(
    output_path: &PathBuf,
    png_bytes: &[u8],
) -> (Result<(), String>, Result<(), String>) {
    let save_result = fs::write(output_path, png_bytes).map_err(|error| {
        format!(
            "failed to save screenshot {}: {}",
            output_path.display(),
            error
        )
    });
    let copy_result = copy_png_to_clipboard(png_bytes);
    (save_result, copy_result)
}

#[cfg(any(windows, target_os = "linux"))]
fn finish_screenshot_delivery(
    app: &AppHandle,
    external: &tauri::Webview,
    output_path: &PathBuf,
    save_result: Result<(), String>,
    copy_result: Result<(), String>,
) {
    if let Err(error) = &save_result {
        tracing::warn!("{}", error);
    } else {
        tracing::info!("saved external screenshot: {}", output_path.display());
    }
    if let Err(error) = &copy_result {
        tracing::warn!("{}", error);
    } else {
        tracing::info!("copied external screenshot to clipboard");
    }

    let saved = save_result.is_ok();
    let copied = copy_result.is_ok();
    let notification = match (saved, copied) {
        (true, true) => format!(
            "Screenshot saved and copied to clipboard:\n{}",
            output_path.display()
        ),
        (true, false) => format!(
            "Screenshot saved to:\n{}\nCould not copy it to the clipboard.",
            output_path.display()
        ),
        (false, true) => {
            "Screenshot copied to clipboard, but could not be saved to a file.".to_string()
        }
        (false, false) => "Failed to save screenshot or copy it to the clipboard.".to_string(),
    };

    finish_external_screenshot(external);
    emit_screenshot_status(
        app,
        if saved || copied {
            "finished"
        } else {
            "failed"
        },
    );
    crate::notify::show(app, "External window", &notification);
}

#[cfg(any(windows, target_os = "linux"))]
const GAME_ASPECT_WIDTH: f64 = 1200.0;
#[cfg(any(windows, target_os = "linux"))]
const GAME_ASPECT_HEIGHT: f64 = 720.0;

#[cfg(any(windows, target_os = "linux"))]
fn compute_centered_aspect_crop(
    img_width: u32,
    img_height: u32,
    aspect_width: f64,
    aspect_height: f64,
) -> (u32, u32, u32, u32) {
    if img_width == 0 || img_height == 0 || aspect_width <= 0.0 || aspect_height <= 0.0 {
        return (0, 0, img_width.max(1), img_height.max(1));
    }

    let w = img_width as f64;
    let h = img_height as f64;
    let scale = (w / aspect_width).min(h / aspect_height);
    let exact_w = aspect_width * scale;
    let exact_h = aspect_height * scale;
    let exact_x = ((w - exact_w) / 2.0).max(0.0);
    let exact_y = ((h - exact_h) / 2.0).max(0.0);

    // Use [ceil(start), floor(end)] so fractional-pixel letterbox edges never bleed into the crop.
    let x0 = (exact_x.ceil() as u32).min(img_width.saturating_sub(1));
    let y0 = (exact_y.ceil() as u32).min(img_height.saturating_sub(1));
    let x1 = ((exact_x + exact_w).floor() as u32).clamp(x0 + 1, img_width);
    let y1 = ((exact_y + exact_h).floor() as u32).clamp(y0 + 1, img_height);

    (x0, y0, x1 - x0, y1 - y0)
}

#[cfg(windows)]
fn crop_png_rect(
    png_bytes: &[u8],
    crop_x: u32,
    crop_y: u32,
    crop_w: u32,
    crop_h: u32,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let cursor = std::io::Cursor::new(png_bytes);
    let decoder = png::Decoder::new(cursor);
    let mut reader = decoder.read_info()?;
    let buf_size = reader
        .output_buffer_size()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "image too large"))?;
    let mut buf = vec![0u8; buf_size];
    let info = reader.next_frame(&mut buf)?;

    let bytes_per_pixel = match info.color_type {
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        png::ColorType::Grayscale => 1,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Indexed => 1,
    } * (info.bit_depth as usize / 8).max(1);

    let x0 = crop_x.min(info.width.saturating_sub(1)) as usize;
    let y0 = crop_y.min(info.height.saturating_sub(1)) as usize;
    let out_w = crop_w.clamp(1, info.width - x0 as u32) as usize;
    let out_h = crop_h.clamp(1, info.height - y0 as u32) as usize;

    let src_row_bytes = info.line_size;
    let dst_row_bytes = out_w * bytes_per_pixel;
    let mut cropped = Vec::with_capacity(dst_row_bytes * out_h);

    for row in y0..(y0 + out_h) {
        let start = row * src_row_bytes + x0 * bytes_per_pixel;
        let end = start + dst_row_bytes;
        if end <= buf.len() {
            cropped.extend_from_slice(&buf[start..end]);
        }
    }

    let mut output = Vec::new();
    let mut encoder = png::Encoder::new(&mut output, out_w as u32, out_h as u32);
    encoder.set_color(info.color_type);
    encoder.set_depth(info.bit_depth);
    let mut writer = encoder.write_header()?;
    writer.write_image_data(&cropped)?;
    drop(writer);

    Ok(output)
}

#[cfg(windows)]
fn crop_png_to_game_aspect(png_bytes: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let cursor = std::io::Cursor::new(png_bytes);
    let decoder = png::Decoder::new(cursor);
    let reader = decoder.read_info()?;
    let info = reader.info();
    let (crop_x, crop_y, crop_w, crop_h) = compute_centered_aspect_crop(
        info.width,
        info.height,
        GAME_ASPECT_WIDTH,
        GAME_ASPECT_HEIGHT,
    );
    if crop_x == 0 && crop_y == 0 && crop_w == info.width && crop_h == info.height {
        return Ok(png_bytes.to_vec());
    }
    crop_png_rect(png_bytes, crop_x, crop_y, crop_w, crop_h)
}

#[cfg(windows)]
fn crop_top_from_png(
    png_bytes: &[u8],
    titlebar_logical_height: f64,
    window_logical_height: f64,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let cursor = std::io::Cursor::new(png_bytes);
    let decoder = png::Decoder::new(cursor);
    let mut reader = decoder.read_info()?;
    let buf_size = reader
        .output_buffer_size()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "image too large"))?;
    let mut buf = vec![0u8; buf_size];
    let info = reader.next_frame(&mut buf)?;

    let bytes_per_pixel = match info.color_type {
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        png::ColorType::Grayscale => 1,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Indexed => 1,
    } * (info.bit_depth as usize / 8).max(1);

    let crop_ratio = (titlebar_logical_height / window_logical_height.max(1.0)).clamp(0.0, 1.0);
    let crop_rows = ((info.height as f64) * crop_ratio).round() as usize;
    let crop_rows = crop_rows.min(info.height as usize);

    let row_bytes = info.width as usize * bytes_per_pixel;
    let start_offset = crop_rows * row_bytes;

    let cropped_buf = if start_offset < buf.len() {
        &buf[start_offset..]
    } else {
        &buf[..]
    };
    let new_height = (info.height - crop_rows as u32).max(1);

    let mut output = Vec::new();
    let mut encoder = png::Encoder::new(&mut output, info.width, new_height);
    encoder.set_color(info.color_type);
    encoder.set_depth(info.bit_depth);
    let mut writer = encoder.write_header()?;
    writer.write_image_data(cropped_buf)?;
    drop(writer);

    Ok(output)
}

#[cfg(windows)]
fn process_windows_screenshot(
    result_json: &str,
    titlebar_logical_height: f64,
    logical_height: f64,
    docked: bool,
) -> Result<Vec<u8>, (String, &'static str)> {
    let value = serde_json::from_str::<serde_json::Value>(result_json).map_err(|error| {
        (
            format!("failed to parse windows screenshot response: {}", error),
            "Failed to process screenshot data.",
        )
    })?;
    let encoded = value
        .get("data")
        .and_then(|data| data.as_str())
        .ok_or_else(|| {
            (
                "windows screenshot response does not contain base64 image data".to_string(),
                "Failed to process screenshot data.",
            )
        })?;

    let image_bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| {
            (
                format!(
                    "failed to decode windows screenshot base64 payload: {}",
                    error
                ),
                "Failed to decode screenshot data.",
            )
        })?;

    let final_image_bytes = if docked {
        match crop_png_to_game_aspect(&image_bytes) {
            Ok(cropped) => cropped,
            Err(error) => {
                tracing::warn!(
                    "failed to crop letterbox from docked windows screenshot: {}",
                    error
                );
                image_bytes
            }
        }
    } else if titlebar_logical_height > 0.0 {
        match crop_top_from_png(&image_bytes, titlebar_logical_height, logical_height) {
            Ok(cropped) => cropped,
            Err(error) => {
                tracing::warn!("failed to crop titlebar from windows screenshot: {}", error);
                image_bytes
            }
        }
    } else {
        image_bytes
    };

    Ok(final_image_bytes)
}

fn emit_screenshot_status(app: &AppHandle, status: &'static str) {
    if let Err(error) = app.emit("fusou-screenshot-status", status) {
        tracing::warn!("failed to emit screenshot status {}: {}", status, error);
    }
}

fn restore_external_screenshot_mode(external: &tauri::Webview) {
    if let Err(error) = external.eval(
        "if (typeof window.__fusouRestoreScreenshotMode === 'function') { window.__fusouRestoreScreenshotMode(); } else { document.documentElement.classList.remove('fusou-screenshot-mode'); if (document.body) { document.body.classList.remove('fusou-screenshot-mode'); } }",
    ) {
        tracing::warn!("failed to restore external screenshot mode: {}", error);
    }
}

fn finish_external_screenshot(external: &tauri::Webview) {
    if let Err(error) = external.eval(
        "if (typeof window.__fusouFinishScreenshot === 'function') { window.__fusouFinishScreenshot(); } else { document.documentElement.classList.remove('fusou-screenshot-mode'); if (document.body) { document.body.classList.remove('fusou-screenshot-mode'); } }",
    ) {
        tracing::warn!("failed to finish external screenshot action: {}", error);
    }
}

pub fn capture_focused_external_window_screenshot(app: &AppHandle) -> Option<PathBuf> {
    capture_focused_external_window_screenshot_with_prepare(app, true)
}

fn capture_focused_external_window_screenshot_with_prepare(
    app: &AppHandle,
    prepare_screenshot: bool,
) -> Option<PathBuf> {
    emit_screenshot_status(app, "started");

    let Some(external) = get_visible_external_webview(app) else {
        tracing::debug!("skip external screenshot: external window not found or not visible");
        emit_screenshot_status(app, "failed");
        return None;
    };

    let output_dir = get_external_screenshot_dir();
    if let Err(error) = fs::create_dir_all(&output_dir) {
        tracing::warn!(
            "failed to create screenshot directory {}: {}",
            output_dir.display(),
            error
        );
        emit_screenshot_status(app, "failed");
        return None;
    }

    let window_title = external
        .window()
        .title()
        .unwrap_or_else(|_| "external".to_string());
    let normalized_title = sanitize_filename_fragment(&window_title);
    let title_suffix = if normalized_title.is_empty() {
        "external".to_string()
    } else {
        normalized_title
    };

    let filename = format!(
        "fusou-external-{}-{}.png",
        Local::now().format("%Y%m%d-%H%M%S-%3f"),
        title_suffix
    );
    let output_path = output_dir.join(filename);

    if prepare_screenshot {
        if let Err(error) = external.eval(
            "if (typeof window.__fusouPrepareScreenshot === 'function') { window.__fusouPrepareScreenshot(); } else { document.documentElement.classList.add('fusou-screenshot-mode'); } void document.documentElement.offsetHeight;",
        ) {
            tracing::warn!("failed to prepare external window for screenshot: {}", error);
        }
    }

    let docked = crate::window::host::is_combined_mode(app);

    #[cfg(target_os = "linux")]
    {
        let titlebar_height: f64 = if docked { 0.0 } else { 32.0 };
        let scale_factor = external.window().scale_factor().unwrap_or(1.0);
        let titlebar_height_px = (titlebar_height * scale_factor).round() as f64;

        let (capture_width, capture_height) = external
            .bounds()
            .ok()
            .map(|rect| {
                let phys = rect.size.to_physical::<u32>(scale_factor);
                (phys.width as i32, phys.height as i32)
            })
            .or_else(|| {
                external
                    .window()
                    .inner_size()
                    .ok()
                    .map(|size| (size.width as i32, size.height as i32))
            })
            .unwrap_or((1200, 752));

        let cropped_height = (capture_height - titlebar_height_px as i32).max(1);

        let output_path_for_snapshot = output_path.clone();
        let app_handle_for_snapshot = app.clone();
        let external_cleanup = external.clone();
        let external_cleanup_for_schedule_error = external.clone();
        let schedule_result = external.with_webview(move |webview| {
            let webview = webview.inner().clone();
            // A small delay (50ms) ensures WebKitGTK has completed CSS reflow and compositing
            // for `.fusou-screenshot-mode` (which disables window corner clip-paths) before capturing.
            webkit2gtk::glib::timeout_add_local_once(
                std::time::Duration::from_millis(50),
                move || {
                    webview.snapshot(
                        SnapshotRegion::Visible,
                        SnapshotOptions::NONE,
                        None::<&gio::Cancellable>,
                        move |snapshot_result| {
                            restore_external_screenshot_mode(&external_cleanup);
                            let surface = match snapshot_result {
                                Ok(surface) => surface,
                                Err(error) => {
                                    tracing::warn!(
                                        "failed to snapshot external webview: {}",
                                        error
                                    );
                                    finish_external_screenshot(&external_cleanup);
                                    emit_screenshot_status(&app_handle_for_snapshot, "failed");
                                    crate::notify::show(
                                        &app_handle_for_snapshot,
                                        "External window",
                                        "Failed to snapshot external webview.",
                                    );
                                    return;
                                }
                            };

                            let image_result = (|| -> Result<Vec<u8>, Box<dyn std::error::Error>> {
                                let (crop_x, crop_y, out_w, out_h) = if docked {
                                    let (x, y, w, h) = compute_centered_aspect_crop(
                                        capture_width.max(1) as u32,
                                        cropped_height.max(1) as u32,
                                        GAME_ASPECT_WIDTH,
                                        GAME_ASPECT_HEIGHT,
                                    );
                                    (x as f64, y as f64, w as i32, h as i32)
                                } else {
                                    (0.0, 0.0, capture_width, cropped_height)
                                };
                                let target = cairo::ImageSurface::create(
                                    cairo::Format::ARgb32,
                                    out_w,
                                    out_h,
                                )?;
                                let cr = cairo::Context::new(&target)?;

                                // Fill solid dark background (#0e0e11) first to eliminate any possible
                                // transparent corner bleeding from window rounding or compositor antialiasing.
                                cr.set_source_rgb(14.0 / 255.0, 14.0 / 255.0, 17.0 / 255.0);
                                cr.paint()?;

                                // Paint cropped webview surface (offsetting top titlebar and docked letterbox)
                                cr.set_source_surface(
                                    &surface,
                                    -crop_x,
                                    -(titlebar_height_px + crop_y),
                                )?;
                                cr.paint()?;
                                target.flush();

                                let mut image_bytes = Vec::new();
                                target.write_to_png(&mut image_bytes)?;
                                Ok(image_bytes)
                            })();

                            match image_result {
                                Ok(image_bytes) => {
                                    let app_handle_for_delivery = app_handle_for_snapshot.clone();
                                    let output_path_for_delivery = output_path_for_snapshot.clone();
                                    let output_path_for_save = output_path_for_snapshot.clone();
                                    let external_cleanup_for_delivery = external_cleanup.clone();
                                    tauri::async_runtime::spawn(async move {
                                        let delivery_result =
                                            tauri::async_runtime::spawn_blocking(move || {
                                                save_screenshot_and_copy(
                                                    &output_path_for_delivery,
                                                    &image_bytes,
                                                )
                                            })
                                            .await;

                                        match delivery_result {
                                            Ok((save_result, copy_result)) => {
                                                finish_screenshot_delivery(
                                                    &app_handle_for_delivery,
                                                    &external_cleanup_for_delivery,
                                                    &output_path_for_save,
                                                    save_result,
                                                    copy_result,
                                                );
                                            }
                                            Err(error) => {
                                                tracing::warn!(
                                                    "screenshot delivery task failed: {}",
                                                    error
                                                );
                                                finish_external_screenshot(
                                                    &external_cleanup_for_delivery,
                                                );
                                                emit_screenshot_status(
                                                    &app_handle_for_delivery,
                                                    "failed",
                                                );
                                                crate::notify::show(
                                                    &app_handle_for_delivery,
                                                    "External window",
                                                    "Failed to save screenshot or copy it to the clipboard.",
                                                );
                                            }
                                        }
                                    });
                                }
                                Err(error) => {
                                    tracing::warn!(
                                        "failed to prepare screenshot {}: {}",
                                        output_path_for_snapshot.display(), error
                                    );
                                    finish_external_screenshot(&external_cleanup);
                                    emit_screenshot_status(&app_handle_for_snapshot, "failed");
                                    crate::notify::show(
                                        &app_handle_for_snapshot,
                                        "External window",
                                        "Failed to save screenshot.",
                                    );
                                }
                            }
                        },
                    );
                },
            );
        });

        if let Err(error) = schedule_result {
            tracing::warn!("failed to schedule external screenshot: {}", error);
            finish_external_screenshot(&external_cleanup_for_schedule_error);
            emit_screenshot_status(app, "failed");
            None
        } else {
            Some(output_path)
        }
    }

    #[cfg(windows)]
    {
        let titlebar_height: f64 = if docked { 0.0 } else { 32.0 };
        let scale_factor = external.window().scale_factor().unwrap_or(1.0);
        let logical_height = external
            .bounds()
            .ok()
            .map(|rect| rect.size.to_logical::<f64>(scale_factor).height)
            .or_else(|| {
                external
                    .window()
                    .inner_size()
                    .ok()
                    .map(|size| size.to_logical::<f64>(scale_factor).height)
            })
            .unwrap_or(752.0);

        let output_path_for_callback = output_path.clone();
        let app_handle_for_callback = app.clone();
        let app_handle_for_call_error = app.clone();
        let external_cleanup_for_callback = external.clone();
        let external_cleanup_for_setup = external.clone();
        let external_cleanup_for_call = external.clone();
        let external_cleanup_for_schedule_error = external.clone();
        let schedule_result = external.with_webview(move |platform_webview| {
            let controller = platform_webview.controller();
            let webview = unsafe {
                match controller.CoreWebView2() {
                    Ok(webview) => webview,
                    Err(error) => {
                        tracing::warn!("failed to obtain CoreWebView2 for screenshot: {}", error);
                        finish_external_screenshot(&external_cleanup_for_setup);
                        emit_screenshot_status(&app_handle_for_callback, "failed");
                        crate::notify::show(
                            &app_handle_for_callback,
                            "External window",
                            "Failed to capture screenshot.",
                        );
                        return;
                    }
                }
            };

            let method_name = CoTaskMemPWSTR::from("Page.captureScreenshot");
            let parameters_json = CoTaskMemPWSTR::from(r#"{"format":"png"}"#);

            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |status, result_json: String| {
                    restore_external_screenshot_mode(&external_cleanup_for_callback);
                    if let Err(error) = status {
                        tracing::warn!(
                            "windows screenshot devtools call failed with status: {}",
                            error
                        );
                        finish_external_screenshot(&external_cleanup_for_callback);
                        emit_screenshot_status(&app_handle_for_callback, "failed");
                        crate::notify::show(
                            &app_handle_for_callback,
                            "External window",
                            "Failed to capture screenshot.",
                        );
                        return Ok(());
                    }

                    let app_handle_for_save = app_handle_for_callback.clone();
                    let output_path_for_save = output_path_for_callback.clone();
                    let output_path_for_processing = output_path_for_callback.clone();
                    let external_cleanup_for_save = external_cleanup_for_callback.clone();
                    tauri::async_runtime::spawn(async move {
                        let delivery_result = tauri::async_runtime::spawn_blocking(move || {
                            let image_bytes = process_windows_screenshot(
                                &result_json,
                                titlebar_height,
                                logical_height,
                                docked,
                            )?;
                            Ok::<_, (String, &'static str)>(save_screenshot_and_copy(
                                &output_path_for_processing,
                                &image_bytes,
                            ))
                        })
                        .await;

                        match delivery_result {
                            Ok(Ok((save_result, copy_result))) => {
                                finish_screenshot_delivery(
                                    &app_handle_for_save,
                                    &external_cleanup_for_save,
                                    &output_path_for_save,
                                    save_result,
                                    copy_result,
                                );
                            }
                            Ok(Err((error, message))) => {
                                tracing::warn!("{}", error);
                                finish_external_screenshot(&external_cleanup_for_save);
                                emit_screenshot_status(&app_handle_for_save, "failed");
                                crate::notify::show(
                                    &app_handle_for_save,
                                    "External window",
                                    message,
                                );
                            }
                            Err(error) => {
                                tracing::warn!(
                                    "windows screenshot delivery task failed: {}",
                                    error
                                );
                                finish_external_screenshot(&external_cleanup_for_save);
                                emit_screenshot_status(&app_handle_for_save, "failed");
                                crate::notify::show(
                                    &app_handle_for_save,
                                    "External window",
                                    "Failed to process screenshot data.",
                                );
                            }
                        }
                    });

                    Ok(())
                },
            ));

            let call_result = unsafe {
                webview.CallDevToolsProtocolMethod(
                    *method_name.as_ref().as_pcwstr(),
                    *parameters_json.as_ref().as_pcwstr(),
                    &handler,
                )
            };

            if let Err(error) = call_result {
                tracing::warn!(
                    "failed to schedule windows screenshot devtools call: {}",
                    error
                );
                finish_external_screenshot(&external_cleanup_for_call);
                emit_screenshot_status(&app_handle_for_call_error, "failed");
                crate::notify::show(
                    &app_handle_for_call_error,
                    "External window",
                    "Failed to capture screenshot.",
                );
            }
        });

        if let Err(error) = schedule_result {
            tracing::warn!("failed to schedule external screenshot: {}", error);
            finish_external_screenshot(&external_cleanup_for_schedule_error);
            emit_screenshot_status(app, "failed");
            None
        } else {
            Some(output_path)
        }
    }

    #[cfg(not(any(target_os = "linux", windows)))]
    {
        tracing::warn!(
            "external screenshot shortcut is currently only implemented on Linux and Windows"
        );
        emit_screenshot_status(app, "failed");
        None
    }
}

pub fn handle_external_reload_shortcut(app: &AppHandle) {
    if !is_external_window_focused(app) || !reload_focused_external_window(app) {
        return;
    }

    crate::notify::show(app, "External window", "Reload started.");
}

pub fn handle_external_force_refresh_shortcut(app: &AppHandle) {
    if !is_external_window_focused(app) || !force_refresh_focused_external_window(app) {
        return;
    }

    crate::notify::show(app, "External window", "Refresh requested.");
}

pub fn handle_external_screenshot_shortcut(app: &AppHandle) {
    handle_external_screenshot_shortcut_with_prepare(app, true);
}

fn handle_external_screenshot_shortcut_with_prepare(app: &AppHandle, prepare_screenshot: bool) {
    if capture_focused_external_window_screenshot_with_prepare(app, prepare_screenshot).is_none() {
        crate::notify::show(
            app,
            "External window",
            "Failed to capture screenshot. Ensure the game window is open.",
        );
    }
}

#[cfg(target_os = "linux")]
pub fn set_linux_app_audio_volume(volume: f64, muted: bool) {
    let vol_clamped = volume.clamp(0.0, 1.0);
    let is_muted = muted || vol_clamped <= 0.0001;

    std::thread::spawn(move || {
        let mut target_ids: Vec<u32> = Vec::new();

        // 1a. Try pw-dump Node (PipeWire structured JSON)
        if let Ok(output) = std::process::Command::new("pw-dump").arg("Node").output() {
            if output.status.success() {
                if let Ok(json_val) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                    if let Some(nodes) = json_val.as_array() {
                        for node in nodes {
                            let props = &node["info"]["props"];
                            if props["media.class"].as_str() == Some("Stream/Output/Audio") {
                                let name = props["application.name"].as_str().unwrap_or("");
                                let bin =
                                    props["application.process.binary"].as_str().unwrap_or("");
                                let name_lower = name.to_lowercase();
                                let bin_lower = bin.to_lowercase();
                                if name_lower == "app"
                                    || name_lower == "fusou"
                                    || name_lower.contains("fusou")
                                    || bin_lower.contains("webkit")
                                    || bin_lower.contains("fusou")
                                    || name_lower.contains("app")
                                {
                                    if let Some(id) = node["id"].as_u64() {
                                        target_ids.push(id as u32);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // 1b. Fallback: Parse wpctl status output if pw-dump didn't match
        if target_ids.is_empty() {
            if let Ok(output) = std::process::Command::new("wpctl").arg("status").output() {
                if output.status.success() {
                    let text = String::from_utf8_lossy(&output.stdout);
                    let mut in_streams = false;
                    for line in text.lines() {
                        if line.contains("Streams:") {
                            in_streams = true;
                            continue;
                        }
                        if in_streams {
                            if line.contains("Video") || line.contains("Settings") {
                                break;
                            }
                            let line_lower = line.to_lowercase();
                            if line_lower.contains("app")
                                || line_lower.contains("fusou")
                                || line_lower.contains("webkit")
                            {
                                let trimmed = line.trim();
                                if let Some((id_part, _)) = trimmed.split_once('.') {
                                    if let Ok(id) = id_part.trim().parse::<u32>() {
                                        target_ids.push(id);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Apply volume and mute to all matching PipeWire stream nodes
        for id in &target_ids {
            let vol_str = format!("{:.2}", vol_clamped);
            let _ = std::process::Command::new("wpctl")
                .args(["set-volume", &id.to_string(), &vol_str])
                .status();
            let _ = std::process::Command::new("wpctl")
                .args([
                    "set-mute",
                    &id.to_string(),
                    if is_muted { "1" } else { "0" },
                ])
                .status();
            tracing::info!(
                stream_id = id,
                volume = vol_clamped,
                muted = is_muted,
                "applied linux pipewire stream volume"
            );
        }

        // Method 2: PulseAudio fallback (pactl list sink-inputs)
        if let Ok(output) = std::process::Command::new("pactl")
            .args(["list", "sink-inputs"])
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                let mut current_sink_input: Option<u32> = None;
                for line in text.lines() {
                    let line = line.trim();
                    if line.starts_with("Sink Input #") {
                        if let Some(num_str) = line.strip_prefix("Sink Input #") {
                            current_sink_input = num_str.parse::<u32>().ok();
                        }
                    } else if (line.contains("application.name = \"app\"")
                        || line.contains("application.name = \"fusou\"")
                        || line.to_lowercase().contains("fusou")
                        || line.contains("WebKitWebProcess"))
                        && current_sink_input.is_some()
                    {
                        if let Some(sink_id) = current_sink_input {
                            let percent = (vol_clamped * 100.0).round() as u32;
                            let _ = std::process::Command::new("pactl")
                                .args([
                                    "set-sink-input-volume",
                                    &sink_id.to_string(),
                                    &format!("{}%", percent),
                                ])
                                .status();
                            let _ = std::process::Command::new("pactl")
                                .args([
                                    "set-sink-input-mute",
                                    &sink_id.to_string(),
                                    if is_muted { "1" } else { "0" },
                                ])
                                .status();
                            tracing::info!(
                                sink_input = sink_id,
                                volume = percent,
                                muted = is_muted,
                                "applied linux pulseaudio sink-input volume"
                            );
                        }
                    }
                }
            }
        }
    });
}

fn parse_resize_direction(raw: &str) -> Option<tauri_runtime::ResizeDirection> {
    match raw {
        "North" => Some(tauri_runtime::ResizeDirection::North),
        "South" => Some(tauri_runtime::ResizeDirection::South),
        "East" => Some(tauri_runtime::ResizeDirection::East),
        "West" => Some(tauri_runtime::ResizeDirection::West),
        "NorthEast" => Some(tauri_runtime::ResizeDirection::NorthEast),
        "NorthWest" => Some(tauri_runtime::ResizeDirection::NorthWest),
        "SouthEast" => Some(tauri_runtime::ResizeDirection::SouthEast),
        "SouthWest" => Some(tauri_runtime::ResizeDirection::SouthWest),
        _ => None,
    }
}

#[tauri::command]
pub fn external_window_shortcut(
    webview: tauri::Webview,
    action: String,
) -> Result<(), String> {
    if webview.label() != "external" {
        return Err("shortcut actions are only available to the external window".to_string());
    }

    let window = webview.window();

    if action == "start-dragging" {
        let _ = window.start_dragging();
        return Ok(());
    }

    if let Some(direction_raw) = action.strip_prefix("resize:") {
        if let Some(direction) = parse_resize_direction(direction_raw) {
            let _ = window.start_resize_dragging(direction);
            return Ok(());
        }
        return Err(format!("unsupported resize direction: {direction_raw}"));
    }

    if let Some(coords) = action.strip_prefix("splitter-move:") {
        let mut parts = coords.split(':');
        if let (Some(x), Some(y)) = (
            parts.next().and_then(|s| s.parse::<f64>().ok()),
            parts.next().and_then(|s| s.parse::<f64>().ok()),
        ) {
            crate::window::combined::update_splitter_drag(webview.app_handle(), x, y);
        }
        return Ok(());
    }

    if action == "splitter-end" {
        crate::window::combined::end_splitter_drag(webview.app_handle());
        return Ok(());
    }

    if action == "minimize" {
        let _ = window.minimize();
        return Ok(());
    }

    if action == "toggle-maximize" {
        if window.is_maximized().unwrap_or(false) {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
        return Ok(());
    }

    if action == "close" {
        if crate::window::host::is_combined_mode(webview.app_handle()) {
            crate::window::combined::hide_external_child_webview(webview.app_handle());
        } else {
            let _ = window.close();
        }
        return Ok(());
    }

    if action.starts_with("volume:") {
        let parts: Vec<&str> = action.split(':').collect();
        if parts.len() >= 3 {
            let vol = parts[1].parse::<f64>().unwrap_or(1.0);
            let muted = parts[2] == "true";
            let is_muted = muted || vol <= 0.0001;

            #[cfg(windows)]
            {
                use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
                use windows_core::Interface;
                let _ = webview.with_webview(move |platform_webview| {
                    let controller = platform_webview.controller();
                    let webview = match unsafe { controller.CoreWebView2() } {
                        Ok(wv) => wv,
                        Err(_) => return,
                    };
                    if let Ok(wv8) = webview.cast::<ICoreWebView2_8>() {
                        let _ = unsafe { wv8.SetIsMuted(is_muted) };
                    }
                });
            }

            #[cfg(target_os = "linux")]
            {
                use webkit2gtk::WebViewExt;
                let _ = webview.with_webview(move |platform_webview| {
                    let webview = platform_webview.inner();
                    webview.set_is_muted(is_muted);
                });
                set_linux_app_audio_volume(vol, muted);
            }

            let app_handle = webview.app_handle();
            use tauri::Emitter;
            let _ = app_handle.emit(
                "fusou-volume-changed",
                serde_json::json!({
                    "volume": vol,
                    "muted": muted
                }),
            );
        }
        return Ok(());
    }

    let app = webview.app_handle();

    match action.as_str() {
        "reload" => handle_external_reload_shortcut(app),
        "force-refresh" => handle_external_force_refresh_shortcut(app),
        "screenshot" => handle_external_screenshot_shortcut_with_prepare(app, false),
        _ => return Err(format!("unsupported external shortcut action: {action}")),
    }

    Ok(())
}

pub fn set_external_window_volume(app: &AppHandle, volume: f64, muted: bool) {
    let Some(external) = (if crate::window::host::is_combined_mode(app) {
        app.get_webview("external")
    } else {
        get_visible_external_webview(app)
    }) else {
        return;
    };

    let is_muted = muted || volume <= 0.0001;

    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
        use windows_core::Interface;
        let _ = external.with_webview(move |platform_webview| {
            let controller = platform_webview.controller();
            let webview = match unsafe { controller.CoreWebView2() } {
                Ok(wv) => wv,
                Err(_) => return,
            };
            if let Ok(wv8) = webview.cast::<ICoreWebView2_8>() {
                let _ = unsafe { wv8.SetIsMuted(is_muted) };
            }
        });
    }

    #[cfg(target_os = "linux")]
    {
        use webkit2gtk::WebViewExt;
        let _ = external.with_webview(move |platform_webview| {
            let webview = platform_webview.inner();
            webview.set_is_muted(is_muted);
        });
        set_linux_app_audio_volume(volume, muted);
    }

    let script = format!(
        "if (typeof window.__fusouSetVolume === 'function') {{ window.__fusouSetVolume({}, {}, true); }}",
        volume, muted
    );
    if let Err(e) = external.eval(&script) {
        tracing::warn!("failed to eval volume script: {}", e);
    }
}

#[tauri::command]
pub fn trigger_external_screenshot(app: AppHandle) {
    if capture_focused_external_window_screenshot(&app).is_none() {
        crate::notify::show(
            &app,
            "External window",
            "Failed to capture screenshot. Ensure the game window is open.",
        );
    }
}

#[tauri::command]
pub fn trigger_external_reload(app: AppHandle) {
    if !reload_focused_external_window(&app) {
        crate::notify::show(
            &app,
            "External window",
            "Failed to reload external window. Ensure the game window is open.",
        );
    }
}

#[tauri::command]
pub fn set_external_volume(app: AppHandle, volume: f64, muted: bool) {
    set_external_window_volume(&app, volume, muted);
}

pub fn create_external_window(app: &AppHandle) {
    if crate::window::host::is_combined_mode(app) {
        crate::window::combined::attach_external_child_webview(app);
        return;
    }

    if let Some(window) = app.get_webview_window("external") {
        if let Some(webview) = app.get_webview("external") {
            install_webview_hooks(&webview);
        }

        match window.is_visible() {
            Ok(visible) => {
                if !visible {
                    window
                        .show()
                        .expect_or_log("Failed to show external window");
                }
            }
            Err(e) => {
                tracing::error!("Error: {e:?}");
            }
        }
        return;
    } else {
        tracing::error!("can not get webview windows \"external\"");
    }

    let init_script = build_external_init_script(false);

    let Some(game_url) = parse_game_url() else {
        return;
    };

    let external =
        tauri::WebviewWindowBuilder::new(app, "external", tauri::WebviewUrl::External(game_url));
    let external = crate::window::common::configure_frameless_window(external);

    let app_configs = configs::get_user_configs_for_app();
    let kc_window = &app_configs.kc_window;
    let inner_winow_size_width = app_configs.kc_window.get_default_inner_width() as f64;
    let inner_winow_size_height = kc_window.get_default_inner_height() as f64;
    let max_window_size_width = kc_window.get_max_inner_width() as f64;
    let max_window_size_height = kc_window.get_max_inner_height() as f64;

    const TITLEBAR_HEIGHT: f64 = 32.0;
    let external = external
        .fullscreen(false)
        .title("fusou-viewer")
        .inner_size(
            inner_winow_size_width,
            inner_winow_size_height + TITLEBAR_HEIGHT,
        )
        .max_inner_size(
            max_window_size_width,
            max_window_size_height + TITLEBAR_HEIGHT,
        )
        .visible(false)
        .initialization_script_for_all_frames(init_script);
    #[cfg(dev)]
    let external = external.devtools(true);

    let external_result = external
        .build()
        .expect_or_log("error while building external");

    if let Some(webview) = app.get_webview("external") {
        install_webview_hooks(&webview);
    }

    crate::window::common::setup_frameless_window(&external_result);

    external_result
        .show()
        .expect_or_log("can not show external window");
}
