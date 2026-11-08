use std::{
    fs,
    path::PathBuf,
    sync::{LazyLock, Mutex},
};
use tauri::{AppHandle, Manager};
use tracing_unwrap::ResultExt;
use webbrowser::{open_browser, Browser};

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

#[derive(Debug, Default)]
pub struct BrowserState(Browser);

impl BrowserState {
    pub fn new() -> Self {
        BrowserState(Browser::default())
    }

    // pub fn set_browser(&mut self, browser: &Browser) {
    //     browser.clone_into(&mut self.0);
    //     // self.0 = browser.clone();
    // }

    pub fn get_browser(&self) -> Browser {
        self.0
    }
}

pub static SHARED_BROWSER: LazyLock<Mutex<BrowserState>> =
    LazyLock::new(|| Mutex::new(BrowserState::new()));

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

fn get_visible_external_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let external = app.get_webview_window("external")?;

    match external.is_visible() {
        Ok(true) => Some(external),
        Ok(false) => None,
        Err(e) => {
            tracing::warn!("failed to determine external window visibility: {}", e);
            None
        }
    }
}

pub fn is_external_window_focused(app: &AppHandle) -> bool {
    let Some(external) = get_visible_external_window(app) else {
        return false;
    };

    match external.is_focused() {
        Ok(is_focused) => is_focused,
        Err(error) => {
            tracing::warn!("failed to determine external window focus: {}", error);
            false
        }
    }
}

#[cfg(target_os = "linux")]
fn eval_external_script_with_callback(
    external: &tauri::WebviewWindow,
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
fn install_linux_webview_key_fallback(external: &tauri::WebviewWindow) {
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

#[cfg(target_os = "linux")]
fn install_linux_webview_scripts(external: &tauri::WebviewWindow) {
    let window_label = external.label().to_string();
    let init_script = include_str!("./scripts/external_init_script.js");
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
                init_script,
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
fn install_windows_webview_key_fallback(external: &tauri::WebviewWindow) {
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

fn nudge_external_window_size(external: &tauri::WebviewWindow) {
    let Ok(size) = external.inner_size() else {
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

    if let Err(e) = external.set_size(nudged_size) {
        tracing::warn!("failed to nudge external window size: {}", e);
        return;
    }

    if let Err(e) = external.set_size(size) {
        tracing::warn!("failed to restore external window size after nudge: {}", e);
    }
}

pub fn reload_focused_external_window(app: &AppHandle) -> bool {
    let Some(external) = get_visible_external_window(app) else {
        tracing::debug!("skip external reload: external window not found or not visible");
        return false;
    };

    tracing::warn!("trigger external reload");

    match external.reload() {
        Ok(()) => true,
        Err(error) => {
            tracing::warn!("failed to reload external window: {}", error);
            false
        }
    }
}

pub fn force_refresh_focused_external_window(app: &AppHandle) -> bool {
    let Some(external) = get_visible_external_window(app) else {
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

pub fn capture_focused_external_window_screenshot(app: &AppHandle) -> Option<PathBuf> {
    let Some(external) = get_visible_external_window(app) else {
        tracing::debug!("skip external screenshot: external window not found or not visible");
        return None;
    };

    let output_dir = get_external_screenshot_dir();
    if let Err(error) = fs::create_dir_all(&output_dir) {
        tracing::warn!(
            "failed to create screenshot directory {}: {}",
            output_dir.display(),
            error
        );
        return None;
    }

    let window_title = external.title().unwrap_or_else(|_| "external".to_string());
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

    let _ = external.eval(
        "if (typeof window.__fusouPrepareScreenshot === 'function') { window.__fusouPrepareScreenshot(); } else { document.documentElement.classList.add('fusou-screenshot-mode'); } void document.documentElement.offsetHeight;"
    );

    #[cfg(target_os = "linux")]
    {
        const TITLEBAR_HEIGHT: f64 = 32.0;
        let scale_factor = external.scale_factor().unwrap_or(1.0);
        let titlebar_height_px = (TITLEBAR_HEIGHT * scale_factor).round() as f64;

        let (capture_width, capture_height) = external
            .inner_size()
            .ok()
            .map(|size| (size.width as i32, size.height as i32))
            .unwrap_or((1200, 752));

        let cropped_height = (capture_height - titlebar_height_px as i32).max(1);

        let output_path_for_snapshot = output_path.clone();
        let app_handle_for_snapshot = app.clone();
        let external_cleanup = external.clone();
        let schedule_result = external.with_webview(move |webview| {
            let webview = webview.inner().clone();
            // A small delay (50ms) ensures WebKitGTK has completed CSS reflow and compositing
            // for `.fusou-screenshot-mode` (which disables window corner clip-paths) before capturing.
            webkit2gtk::glib::timeout_add_local_once(std::time::Duration::from_millis(50), move || {
                webview.snapshot(
                    SnapshotRegion::Visible,
                    SnapshotOptions::NONE,
                    None::<&gio::Cancellable>,
                    move |snapshot_result| {
                        let _ = external_cleanup.eval(
                            "if (typeof window.__fusouFinishScreenshot === 'function') { window.__fusouFinishScreenshot(); } else { document.documentElement.classList.remove('fusou-screenshot-mode'); }"
                        );
                        let surface = match snapshot_result {
                            Ok(surface) => surface,
                            Err(error) => {
                                tracing::warn!("failed to snapshot external webview: {}", error);
                                crate::notify::show(
                                    &app_handle_for_snapshot,
                                    "External window",
                                    "Failed to snapshot external webview.",
                                );
                                return;
                            }
                        };

                        let save_result = (|| -> Result<(), Box<dyn std::error::Error>> {
                            let target = cairo::ImageSurface::create(
                                cairo::Format::ARgb32,
                                capture_width,
                                cropped_height,
                            )?;
                            let cr = cairo::Context::new(&target)?;

                            // Fill solid dark background (#0e0e11) first to eliminate any possible
                            // transparent corner bleeding from window rounding or compositor antialiasing.
                            cr.set_source_rgb(14.0 / 255.0, 14.0 / 255.0, 17.0 / 255.0);
                            cr.paint()?;

                            // Paint cropped webview surface (offsetting top titlebar)
                            cr.set_source_surface(&surface, 0.0, -titlebar_height_px)?;
                            cr.paint()?;
                            target.flush();

                            let mut file = fs::File::create(&output_path_for_snapshot)?;
                            target.write_to_png(&mut file)?;
                            Ok(())
                        })();

                        match save_result {
                            Ok(()) => {
                                tracing::info!(
                                    "saved external screenshot: {}",
                                    output_path_for_snapshot.display()
                                );
                                crate::notify::show(
                                    &app_handle_for_snapshot,
                                    "External window",
                                    &format!(
                                        "Screenshot saved to:\n{}",
                                        output_path_for_snapshot.display()
                                    ),
                                );
                            }
                            Err(error) => {
                                tracing::warn!(
                                    "failed to save screenshot {}: {}",
                                    output_path_for_snapshot.display(),
                                    error
                                );
                                crate::notify::show(
                                    &app_handle_for_snapshot,
                                    "External window",
                                    "Failed to save screenshot.",
                                );
                            }
                        }
                    },
                );
            });
        });

        if let Err(error) = schedule_result {
            tracing::warn!("failed to schedule external screenshot: {}", error);
            None
        } else {
            Some(output_path)
        }
    }

    #[cfg(windows)]
    {
        const TITLEBAR_HEIGHT: f64 = 32.0;
        let scale_factor = external.scale_factor().unwrap_or(1.0);
        let logical_height = external
            .inner_size()
            .ok()
            .map(|size| size.to_logical::<f64>(scale_factor).height)
            .unwrap_or(752.0);

        let output_path_for_callback = output_path.clone();
        let app_handle_for_callback = app.clone();
        let external_cleanup = external.clone();
        let schedule_result = external.with_webview(move |platform_webview| {
            let controller = platform_webview.controller();
            let webview = unsafe {
                match controller.CoreWebView2() {
                    Ok(webview) => webview,
                    Err(error) => {
                        tracing::warn!("failed to obtain CoreWebView2 for screenshot: {}", error);
                        return;
                    }
                }
            };

            let method_name = CoTaskMemPWSTR::from("Page.captureScreenshot");
            let parameters_json = CoTaskMemPWSTR::from(r#"{"format":"png"}"#);

            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |status, result_json: String| {
                    let _ = external_cleanup.eval(
                        "if (typeof window.__fusouFinishScreenshot === 'function') { window.__fusouFinishScreenshot(); } else { document.documentElement.classList.remove('fusou-screenshot-mode'); }"
                    );
                    if let Err(error) = status {
                        tracing::warn!(
                            "windows screenshot devtools call failed with status: {}",
                            error
                        );
                        crate::notify::show(
                            &app_handle_for_callback,
                            "External window",
                            "Failed to capture screenshot.",
                        );
                        return Ok(());
                    }

                    let encoded = match serde_json::from_str::<serde_json::Value>(&result_json)
                        .ok()
                        .and_then(|value| {
                            value
                                .get("data")
                                .and_then(|data| data.as_str())
                                .map(|data| data.to_string())
                        }) {
                        Some(encoded) => encoded,
                        None => {
                            tracing::warn!(
                                "windows screenshot response does not contain base64 image data"
                            );
                            crate::notify::show(
                                &app_handle_for_callback,
                                "External window",
                                "Failed to process screenshot data.",
                            );
                            return Ok(());
                        }
                    };

                    let image_bytes =
                        match base64::engine::general_purpose::STANDARD.decode(encoded) {
                            Ok(bytes) => bytes,
                            Err(error) => {
                                tracing::warn!(
                                    "failed to decode windows screenshot base64 payload: {}",
                                    error
                                );
                                crate::notify::show(
                                    &app_handle_for_callback,
                                    "External window",
                                    "Failed to decode screenshot data.",
                                );
                                return Ok(());
                            }
                        };

                    let final_image_bytes = match crop_top_from_png(
                        &image_bytes,
                        TITLEBAR_HEIGHT,
                        logical_height,
                    ) {
                        Ok(cropped) => cropped,
                        Err(error) => {
                            tracing::warn!(
                                "failed to crop titlebar from windows screenshot: {}",
                                error
                            );
                            image_bytes
                        }
                    };

                    if let Err(error) = fs::write(&output_path_for_callback, &final_image_bytes) {
                        tracing::warn!(
                            "failed to save windows screenshot {}: {}",
                            output_path_for_callback.display(),
                            error
                        );
                        crate::notify::show(
                            &app_handle_for_callback,
                            "External window",
                            "Failed to save screenshot.",
                        );
                        return Ok(());
                    }

                    tracing::info!(
                        "saved external screenshot: {}",
                        output_path_for_callback.display()
                    );
                    crate::notify::show(
                        &app_handle_for_callback,
                        "External window",
                        &format!(
                            "Screenshot saved to:\n{}",
                            output_path_for_callback.display()
                        ),
                    );

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
            }
        });

        if let Err(error) = schedule_result {
            tracing::warn!("failed to schedule external screenshot: {}", error);
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
    if capture_focused_external_window_screenshot(app).is_none() {
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
                                let bin = props["application.process.binary"].as_str().unwrap_or("");
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
                .args(["set-mute", &id.to_string(), if is_muted { "1" } else { "0" }])
                .status();
            tracing::info!(
                stream_id = id,
                volume = vol_clamped,
                muted = is_muted,
                "applied linux pipewire stream volume"
            );
        }

        // Method 2: PulseAudio fallback (pactl list sink-inputs)
        if let Ok(output) = std::process::Command::new("pactl").args(["list", "sink-inputs"]).output() {
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
                                .args(["set-sink-input-volume", &sink_id.to_string(), &format!("{}%", percent)])
                                .status();
                            let _ = std::process::Command::new("pactl")
                                .args(["set-sink-input-mute", &sink_id.to_string(), if is_muted { "1" } else { "0" }])
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

#[tauri::command]
pub fn external_window_shortcut(
    window: tauri::WebviewWindow,
    action: String,
) -> Result<(), String> {
    if window.label() != "external" {
        return Err("shortcut actions are only available to the external window".to_string());
    }

    if action == "start-dragging" {
        let _ = window.start_dragging();
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
        let _ = window.close();
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
                let _ = window.with_webview(move |platform_webview| {
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
                let _ = window.with_webview(move |platform_webview| {
                    let webview = platform_webview.inner();
                    webview.set_is_muted(is_muted);
                });
                set_linux_app_audio_volume(vol, muted);
            }

            let app_handle = window.app_handle();
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

    let app = window.app_handle();

    match action.as_str() {
        "reload" => handle_external_reload_shortcut(app),
        "force-refresh" => handle_external_force_refresh_shortcut(app),
        "screenshot" => handle_external_screenshot_shortcut(app),
        _ => return Err(format!("unsupported external shortcut action: {action}")),
    }

    Ok(())
}

pub fn set_external_window_volume(app: &AppHandle, volume: f64, muted: bool) {
    let Some(external) = get_visible_external_window(app) else {
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

pub fn create_external_window(app: &AppHandle, browser: Option<Browser>, browse_webview: bool) {
    if browse_webview {
        if let Some(window) = app.get_webview_window("external") {
            #[cfg(target_os = "linux")]
            install_linux_webview_key_fallback(&window);

            #[cfg(target_os = "linux")]
            install_linux_webview_scripts(&window);

            #[cfg(windows)]
            install_windows_webview_key_fallback(&window);

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

        let init_script = include_str!("./scripts/external_init_script.js");

        let game_url = match get_game_url().parse() {
            Ok(url) => url,
            Err(e) => {
                tracing::error!(
                    "Invalid game URL in config, cannot open external window: {}",
                    e
                );
                return;
            }
        };

        let external = tauri::WebviewWindowBuilder::new(
            app,
            "external",
            tauri::WebviewUrl::External(game_url),
        );
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

        #[cfg(target_os = "linux")]
        install_linux_webview_key_fallback(&external_result);

        #[cfg(target_os = "linux")]
        install_linux_webview_scripts(&external_result);

        #[cfg(windows)]
        install_windows_webview_key_fallback(&external_result);

        crate::window::common::setup_frameless_window(&external_result);

        external_result
            .show()
            .expect_or_log("can not show external window");
    } else if let Some(browser) = browser {
        if let Err(e) = open_browser(browser, &get_game_url()) {
            tracing::error!("Failed to open external browser: {}", e);
        }
    } else {
        tracing::error!("browse_webview=false but no browser was provided");
    }
}
