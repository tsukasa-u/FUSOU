use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::window::{
    combined,
    layout::{
        clamp_panel_ratio, compute_combined_layout, resolve_dock_position,
        resolve_effective_window_mode, CombinedLayoutInput, CombinedLayoutOutput, DockEdgeFlags,
        DockPosition, EffectiveDockPosition, WindowMode, COMBINED_TITLEBAR_HEIGHT, MIN_GAME_AXIS,
        MIN_PANEL_AXIS,
    },
};

pub const COMBINED_WINDOW_LABEL: &str = "combined";
pub const CHROME_WEBVIEW_LABEL: &str = "chrome";
pub const MAIN_WEBVIEW_LABEL: &str = "main";
pub const EXTERNAL_WEBVIEW_LABEL: &str = "external";
pub const EVENT_LAYOUT_CHANGED: &str = "fusou-layout-changed";

#[derive(Debug, Clone, Serialize)]
pub struct PlatformCapabilities {
    pub supports_separate_mode: bool,
    pub supports_custom_titlebar: bool,
    pub is_mobile: bool,
}

impl PlatformCapabilities {
    pub fn current() -> Self {
        let is_mobile = cfg!(any(target_os = "android", target_os = "ios"));
        Self {
            supports_separate_mode: !is_mobile,
            supports_custom_titlebar: !is_mobile,
            is_mobile,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct WindowLayoutStatePayload {
    pub configured_mode: WindowMode,
    pub effective_mode: WindowMode,
    pub dock_position: DockPosition,
    pub effective_dock_position: EffectiveDockPosition,
    pub panel_ratio_percent: u32,
    pub game_visible: bool,
    pub is_dragging_splitter: bool,
    pub panel_edges: DockEdgeFlags,
    pub game_edges: DockEdgeFlags,
    pub platform_capabilities: PlatformCapabilities,
}

#[derive(Debug, Clone)]
struct RuntimeLayoutInner {
    configured_mode: WindowMode,
    effective_mode: WindowMode,
    dock_position: DockPosition,
    effective_dock_position: EffectiveDockPosition,
    panel_ratio_percent: u32,
    game_visible: bool,
    is_dragging_splitter: bool,
}

pub struct WindowLayoutState {
    inner: Mutex<RuntimeLayoutInner>,
}

impl WindowLayoutState {
    pub fn from_user_configs() -> Self {
        let kc_window = &configs::get_user_configs_for_app().kc_window;
        let caps = PlatformCapabilities::current();
        let configured_mode = WindowMode::from_config_str(&kc_window.get_window_mode());
        let effective_mode = resolve_effective_window_mode(configured_mode, caps.is_mobile);
        let dock_position = DockPosition::from_config_str(&kc_window.get_dock_position());
        let effective_dock_position = resolve_dock_position(
            dock_position,
            kc_window.get_default_inner_width() as f64,
            kc_window.get_default_inner_height() as f64,
        );
        let panel_ratio_percent = clamp_panel_ratio(kc_window.get_dock_panel_ratio_percent());

        Self {
            inner: Mutex::new(RuntimeLayoutInner {
                configured_mode,
                effective_mode,
                dock_position,
                effective_dock_position,
                panel_ratio_percent,
                game_visible: false,
                is_dragging_splitter: false,
            }),
        }
    }

    pub fn snapshot(&self) -> WindowLayoutStatePayload {
        let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let panel_edges = if guard.effective_mode == WindowMode::Combined {
            DockEdgeFlags::panel_edges(guard.effective_dock_position, guard.game_visible)
        } else {
            DockEdgeFlags::all()
        };
        let game_edges = if guard.effective_mode == WindowMode::Combined {
            DockEdgeFlags::game_edges(guard.effective_dock_position)
        } else {
            DockEdgeFlags::all()
        };
        WindowLayoutStatePayload {
            configured_mode: guard.configured_mode,
            effective_mode: guard.effective_mode,
            dock_position: guard.dock_position,
            effective_dock_position: guard.effective_dock_position,
            panel_ratio_percent: guard.panel_ratio_percent,
            game_visible: guard.game_visible,
            is_dragging_splitter: guard.is_dragging_splitter,
            panel_edges,
            game_edges,
            platform_capabilities: PlatformCapabilities::current(),
        }
    }

    pub fn is_combined(&self) -> bool {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .effective_mode
            == WindowMode::Combined
    }

    pub fn set_dock_position(&self, dock: DockPosition) {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.dock_position = dock;
    }

    pub fn set_panel_ratio_percent(&self, ratio: u32) -> u32 {
        let clamped = clamp_panel_ratio(ratio);
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.panel_ratio_percent = clamped;
        clamped
    }

    pub fn set_game_visible(&self, visible: bool) {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.game_visible = visible;
    }

    pub fn set_dragging_splitter(&self, dragging: bool) {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.is_dragging_splitter = dragging;
    }

    pub fn is_dragging_splitter(&self) -> bool {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_dragging_splitter
    }

    pub fn compute_layout_for_size(&self, total_width: f64, total_height: f64) -> CombinedLayoutOutput {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let caps = PlatformCapabilities::current();
        let titlebar_height = if caps.supports_custom_titlebar {
            COMBINED_TITLEBAR_HEIGHT
        } else {
            0.0
        };
        let output = compute_combined_layout(CombinedLayoutInput {
            total_width,
            total_height,
            titlebar_height,
            dock_position: guard.dock_position,
            panel_ratio_percent: guard.panel_ratio_percent,
            game_visible: guard.game_visible,
            min_game_axis: MIN_GAME_AXIS,
            min_panel_axis: MIN_PANEL_AXIS,
        });
        guard.effective_dock_position = output.effective_dock;
        output
    }
}

pub fn init_runtime_state(app: &AppHandle) {
    if app.try_state::<WindowLayoutState>().is_none() {
        app.manage(WindowLayoutState::from_user_configs());
    }
}

pub fn get_layout_state(app: &AppHandle) -> WindowLayoutStatePayload {
    if let Some(state) = app.try_state::<WindowLayoutState>() {
        state.snapshot()
    } else {
        WindowLayoutState::from_user_configs().snapshot()
    }
}

pub fn is_combined_mode(app: &AppHandle) -> bool {
    app.try_state::<WindowLayoutState>()
        .map(|state| state.is_combined())
        .unwrap_or_else(|| {
            let caps = PlatformCapabilities::current();
            let configured = WindowMode::from_config_str(
                &configs::get_user_configs_for_app()
                    .kc_window
                    .get_window_mode(),
            );
            resolve_effective_window_mode(configured, caps.is_mobile) == WindowMode::Combined
        })
}

pub fn primary_window_label(app: &AppHandle) -> &'static str {
    if is_combined_mode(app) {
        COMBINED_WINDOW_LABEL
    } else {
        MAIN_WEBVIEW_LABEL
    }
}

pub fn get_primary_window(app: &AppHandle) -> Option<tauri::Window> {
    let label = primary_window_label(app);
    app.get_window(label).or_else(|| {
        app.get_webview_window(label)
            .map(|ww| ww.as_ref().window())
    })
}

pub fn get_app_webview(app: &AppHandle) -> Option<tauri::Webview> {
    app.get_webview(MAIN_WEBVIEW_LABEL)
}

pub fn get_game_webview(app: &AppHandle) -> Option<tauri::Webview> {
    app.get_webview(EXTERNAL_WEBVIEW_LABEL)
}

pub fn get_chrome_webview(app: &AppHandle) -> Option<tauri::Webview> {
    app.get_webview(CHROME_WEBVIEW_LABEL)
}

pub fn emit_layout_state(app: &AppHandle) {
    let payload = get_layout_state(app);
    let _ = app.emit(EVENT_LAYOUT_CHANGED, &payload);
}

pub fn init_primary_window(app: &AppHandle) {
    init_runtime_state(app);
    if is_combined_mode(app) {
        combined::create_combined_window(app, true);
    } else {
        crate::window::app::create_separate_main_window(app, false);
    }
}

pub fn show_primary_window(app: &AppHandle) {
    if let Some(window) = get_primary_window(app) {
        if let Ok(false) = window.is_visible() {
            if let Err(e) = window.show() {
                tracing::error!("Failed to show primary window: {}", e);
            }
        }
        if is_combined_mode(app) {
            combined::ensure_combined_maximized(&window);
            combined::sync_combined_layout(app);
        }
    } else if is_combined_mode(app) {
        combined::create_combined_window(app, true);
    } else {
        crate::window::app::create_separate_main_window(app, true);
    }
}

pub fn hide_primary_window(app: &AppHandle) {
    if let Some(window) = get_primary_window(app) {
        if let Ok(true) = window.is_visible() {
            if let Err(e) = window.hide() {
                tracing::error!("Failed to hide primary window: {}", e);
            }
        }
    }
}

pub fn hide_all_windows_for_shutdown(app: &AppHandle) {
    hide_primary_window(app);
    if !is_combined_mode(app) {
        if let Some(window) = app.get_webview_window(EXTERNAL_WEBVIEW_LABEL) {
            if let Ok(true) = window.is_visible() {
                if let Err(e) = window.hide() {
                    tracing::error!("Failed to hide external window: {}", e);
                }
            }
        }
    }
}

pub fn restore_and_focus_primary_window(app: &AppHandle) {
    show_primary_window(app);
    let Some(window) = get_primary_window(app) else {
        tracing::error!("Failed to get primary window for restore/focus");
        return;
    };

    if window.is_minimized().unwrap_or(false) {
        if let Err(e) = window.unminimize() {
            tracing::warn!("failed to unminimize primary window: {}", e);
        }
    }

    if !window.is_focused().unwrap_or(false) {
        if let Err(e) = window.set_focus() {
            tracing::warn!("failed to focus primary window: {}", e);
        }
    }
}

pub fn toggle_primary_window(app: &AppHandle) {
    if let Some(window) = get_primary_window(app) {
        match window.is_visible() {
            Ok(true) => {
                if let Err(e) = window.hide() {
                    tracing::error!("Failed to hide primary window: {}", e);
                }
            }
            Ok(false) => {
                if let Err(e) = window.show() {
                    tracing::error!("Failed to show primary window: {}", e);
                }
                if is_combined_mode(app) {
                    combined::ensure_combined_maximized(&window);
                    combined::sync_combined_layout(app);
                }
            }
            Err(_) => {}
        }
    } else {
        show_primary_window(app);
    }
}

pub fn apply_config_layout_updates(app: &AppHandle) {
    if !is_combined_mode(app) {
        emit_layout_state(app);
        return;
    }

    let kc_window = &configs::get_user_configs_for_app().kc_window;
    if let Some(state) = app.try_state::<WindowLayoutState>() {
        state.set_dock_position(DockPosition::from_config_str(&kc_window.get_dock_position()));
        state.set_panel_ratio_percent(kc_window.get_dock_panel_ratio_percent());
    }
    combined::sync_combined_layout(app);
}
