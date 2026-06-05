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
use webkit2gtk::{gio, SnapshotOptions, SnapshotRegion, WebViewExt};

#[cfg(target_os = "linux")]
use gtk::prelude::WidgetExt;

#[cfg(windows)]
use base64::Engine as _;

#[cfg(windows)]
use std::collections::HashSet;

#[cfg(windows)]
use webview2_com::{
    callback::{AcceleratorKeyPressedEventHandler, CallDevToolsProtocolMethodCompletedHandler},
    CoTaskMemPWSTR,
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
        let mut installed = LINUX_KEY_FALLBACK_INSTALLED
            .lock()
            .expect("mutex poisoned");
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

    let mut dir = dirs::picture_dir().unwrap_or_else(|| {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    });

    dir.push("FUSOU");
    dir.push("screenshots");
    dir
}

fn get_visible_external_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let external = app.get_webview_window("external")?;

    match external.is_visible() {
        Ok(true) => Some(external),
        Ok(false) => return None,
        Err(e) => {
            tracing::warn!("failed to determine external window visibility: {}", e);
            None
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

    let eval_result = external.with_webview(move |webview| {
        let webview = webview.inner();
        #[allow(deprecated)]
        webview.run_javascript(
            script,
            None::<&gio::Cancellable>,
            move |run_result| match run_result {
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
            },
        );
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

        webview.inner().connect_key_press_event(move |_view, event| {
            let key = event.keyval();
            let modifiers = event.state();
            let has_ctrl = modifiers.contains(gdk::ModifierType::CONTROL_MASK);
            let has_meta = modifiers.contains(gdk::ModifierType::META_MASK)
                || modifiers.contains(gdk::ModifierType::SUPER_MASK);

            if key == gdk::keys::constants::F5 {
                tracing::warn!("linux webview key fallback pressed: F5 (external reload)");
                reload_focused_external_window(&app_handle);
                return webkit2gtk::glib::Propagation::Stop;
            }

            let is_r = key == gdk::keys::constants::r || key == gdk::keys::constants::R;
            if is_r && (has_ctrl || has_meta) {
                tracing::warn!(
                    "linux webview key fallback pressed: Ctrl/Super+R (external force refresh)"
                );
                force_refresh_focused_external_window(&app_handle);
                return webkit2gtk::glib::Propagation::Stop;
            }

            let is_s = key == gdk::keys::constants::s || key == gdk::keys::constants::S;
            if is_s && (has_ctrl || has_meta) {
                tracing::warn!(
                    "linux webview key fallback pressed: Ctrl/Super+S (external screenshot)"
                );
                capture_focused_external_window_screenshot(&app_handle);
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

#[cfg(windows)]
fn is_windows_key_down(kind: COREWEBVIEW2_KEY_EVENT_KIND) -> bool {
    kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
        || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
}

#[cfg(windows)]
fn is_windows_key_up(kind: COREWEBVIEW2_KEY_EVENT_KIND) -> bool {
    kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_UP
        || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_UP
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
                    VK_F5 => {
                        tracing::warn!("windows webview key fallback pressed: F5 (external reload)");
                        reload_focused_external_window(&app_handle);
                        unsafe {
                            let _ = args.SetHandled(true);
                        }
                    }
                    VK_R if ctrl_down || win_down => {
                        tracing::warn!(
                            "windows webview key fallback pressed: Ctrl/Super+R (external force refresh)"
                        );
                        force_refresh_focused_external_window(&app_handle);
                        unsafe {
                            let _ = args.SetHandled(true);
                        }
                    }
                    VK_S if ctrl_down || win_down => {
                        tracing::warn!(
                            "windows webview key fallback pressed: Ctrl/Super+S (external screenshot)"
                        );
                        capture_focused_external_window_screenshot(&app_handle);
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

pub fn reload_focused_external_window(app: &AppHandle) {
    let Some(external) = get_visible_external_window(app) else {
        tracing::debug!(
            "skip external reload: external window not found or not visible"
        );
        return;
    };

    tracing::warn!("trigger external reload");

    if let Err(e) = external.reload() {
        tracing::warn!("failed to reload external window: {}", e);
    }
}

pub fn force_refresh_focused_external_window(app: &AppHandle) {
    let Some(external) = get_visible_external_window(app) else {
        tracing::debug!(
            "skip external force refresh: external window not found or not visible"
        );
        return;
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
}

pub fn capture_focused_external_window_screenshot(app: &AppHandle) -> Option<PathBuf> {
    let Some(external) = get_visible_external_window(app) else {
        tracing::debug!(
            "skip external screenshot: external window not found or not visible"
        );
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

    let window_title = external
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

    #[cfg(target_os = "linux")]
    {
        let capture_size = external
            .inner_size()
            .ok()
            .map(|size| (size.width as i32, size.height as i32))
            .unwrap_or((1200, 720));

        let output_path_for_snapshot = output_path.clone();
        let schedule_result = external.with_webview(move |webview| {
            let webview = webview.inner();
            let (capture_width, capture_height) = capture_size;
            webview.snapshot(
                SnapshotRegion::Visible,
                SnapshotOptions::NONE,
                None::<&gio::Cancellable>,
                move |snapshot_result| match snapshot_result {
                    Ok(surface) => {
                        let Some(pixbuf) = gdk::pixbuf_get_from_surface(
                            &surface,
                            0,
                            0,
                            capture_width,
                            capture_height,
                        ) else {
                            tracing::warn!(
                                "failed to convert webview snapshot into pixbuf for {}",
                                output_path_for_snapshot.display(),
                            );
                            return;
                        };

                        if let Err(error) = pixbuf.savev(&output_path_for_snapshot, "png", &[]) {
                            tracing::warn!(
                                "failed to save screenshot {}: {}",
                                output_path_for_snapshot.display(),
                                error
                            );
                            return;
                        }

                        tracing::info!(
                            "saved external screenshot: {}",
                            output_path_for_snapshot.display()
                        );
                    }
                    Err(error) => {
                        tracing::warn!("failed to snapshot external webview: {}", error);
                    }
                },
            );
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
        let output_path_for_callback = output_path.clone();
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
                move |status, result_json| {
                    if let Err(error) = status {
                        tracing::warn!(
                            "windows screenshot devtools call failed with status: {}",
                            error
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
                            return Ok(());
                        }
                    };

                    let image_bytes = match base64::engine::general_purpose::STANDARD.decode(encoded)
                    {
                        Ok(bytes) => bytes,
                        Err(error) => {
                            tracing::warn!(
                                "failed to decode windows screenshot base64 payload: {}",
                                error
                            );
                            return Ok(());
                        }
                    };

                    if let Err(error) = fs::write(&output_path_for_callback, &image_bytes) {
                        tracing::warn!(
                            "failed to save windows screenshot {}: {}",
                            output_path_for_callback.display(),
                            error
                        );
                        return Ok(());
                    }

                    tracing::info!(
                        "saved external screenshot: {}",
                        output_path_for_callback.display()
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

pub fn create_external_window(app: &AppHandle, browser: Option<Browser>, browse_webview: bool) {
    if browse_webview {
        if let Some(window) = app.get_webview_window("external") {
            #[cfg(target_os = "linux")]
            install_linux_webview_key_fallback(&window);

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
                tracing::error!("Invalid game URL in config, cannot open external window: {}", e);
                return;
            }
        };

        let external = tauri::WebviewWindowBuilder::new(
            app,
            "external",
            tauri::WebviewUrl::External(game_url),
        );

        let app_configs = configs::get_user_configs_for_app();
        let kc_window = &app_configs.kc_window;
        let inner_winow_size_width = app_configs.kc_window.get_default_inner_width() as f64;
        let inner_winow_size_height = kc_window.get_default_inner_height() as f64;
        let max_window_size_width = kc_window.get_max_inner_width() as f64;
        let max_window_size_height = kc_window.get_max_inner_height() as f64;

        let external = external
            .fullscreen(false)
            .title("fusou-viewer")
            .inner_size(inner_winow_size_width, inner_winow_size_height)
            .max_inner_size(max_window_size_width, max_window_size_height)
            .visible(false)
            .initialization_script(init_script);
        #[cfg(dev)]
        let external = external.devtools(true);

        let external_result = external
            .build()
            .expect_or_log("error while building external");

        #[cfg(target_os = "linux")]
        install_linux_webview_key_fallback(&external_result);

        #[cfg(windows)]
        install_windows_webview_key_fallback(&external_result);

        external_result
            .show()
            .expect_or_log("can not show external window");
    } else {
        if let Some(browser) = browser {
            if let Err(e) = open_browser(browser, &get_game_url()) {
                tracing::error!("Failed to open external browser: {}", e);
            }
        } else {
            tracing::error!("browse_webview=false but no browser was provided");
        }
    }
}
