use std::{
    collections::BTreeMap,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use configs::ConfigPatchValue;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Rect};

use crate::window::{
    external,
    host::{
        emit_layout_state, get_app_webview, get_chrome_webview, get_game_webview,
        get_primary_window, WindowLayoutState, CHROME_WEBVIEW_LABEL, COMBINED_WINDOW_LABEL,
        EXTERNAL_WEBVIEW_LABEL, MAIN_WEBVIEW_LABEL,
    },
    layout::{
        clamp_panel_ratio, compute_ratio_from_pointer, DockEdgeFlags, DockPosition, LogicalRect,
        COMBINED_TITLEBAR_HEIGHT,
    },
};

const COMBINED_BG_DARK: tauri::window::Color = tauri::window::Color(14, 14, 17, 255);
const COMBINED_CHROME_BG: tauri::webview::Color = tauri::webview::Color(39, 39, 42, 255);
const COMBINED_PANEL_BG: tauri::webview::Color = tauri::webview::Color(24, 24, 27, 255);
const COMBINED_GAME_BG: tauri::webview::Color = tauri::webview::Color(14, 14, 17, 255);

static LAYOUT_SYNC_SCHEDULED: AtomicBool = AtomicBool::new(false);

fn logical_rect_to_physical_parts(
    rect: LogicalRect,
    scale_factor: f64,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let x0 = (rect.x * scale_factor).round() as i32;
    let y0 = (rect.y * scale_factor).round() as i32;
    let x1 = ((rect.x + rect.width) * scale_factor).round() as i32;
    let y1 = ((rect.y + rect.height) * scale_factor).round() as i32;
    let width = (x1 - x0).max(1) as u32;
    let height = (y1 - y0).max(1) as u32;
    (PhysicalPosition::new(x0, y0), PhysicalSize::new(width, height))
}

fn logical_rect_to_tauri_rect(rect: LogicalRect, scale_factor: f64) -> Rect {
    let (position, size) = logical_rect_to_physical_parts(rect, scale_factor);
    Rect {
        position: position.into(),
        size: size.into(),
    }
}

fn default_combined_window_size() -> (f64, f64) {
    let kc_window = &configs::get_user_configs_for_app().kc_window;
    let game_w = kc_window.get_default_inner_width() as f64;
    let game_h = kc_window.get_default_inner_height() as f64;
    let dock = DockPosition::from_config_str(&kc_window.get_dock_position());
    let ratio = clamp_panel_ratio(kc_window.get_dock_panel_ratio_percent()) as f64 / 100.0;

    match dock {
        DockPosition::Bottom | DockPosition::Top => {
            let panel_h = ((game_h * ratio) / (1.0 - ratio).max(0.2))
                .round()
                .clamp(260.0, 540.0);
            (game_w, game_h + panel_h + COMBINED_TITLEBAR_HEIGHT)
        }
        DockPosition::Right | DockPosition::Left | DockPosition::Auto => {
            let panel_w = ((game_w * ratio) / (1.0 - ratio).max(0.2))
                .round()
                .clamp(320.0, 640.0);
            (game_w + panel_w, game_h + COMBINED_TITLEBAR_HEIGHT)
        }
    }
}

fn push_game_dock_edges(app: &AppHandle, edges: DockEdgeFlags) {
    let Some(game_wv) = get_game_webview(app) else {
        return;
    };
    let script = format!(
        "if (typeof window.__fusouSetDockEdges === 'function') {{ window.__fusouSetDockEdges({{ top: {}, bottom: {}, left: {}, right: {} }}); }}",
        edges.top, edges.bottom, edges.left, edges.right
    );
    if let Err(err) = game_wv.eval(&script) {
        tracing::debug!("failed to push dock edges to external webview: {}", err);
    }
}

fn install_external_diagnostics(webview: &tauri::Webview) {
    #[cfg(windows)]
    {
        use webview2_com::{
            Microsoft::Web::WebView2::Win32::{
                COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_WEB_ERROR_STATUS,
            },
            NavigationCompletedEventHandler, ProcessFailedEventHandler, take_pwstr,
        };
        use windows_core::{BOOL, PWSTR};

        let app_for_nav = webview.app_handle().clone();
        let _ = webview.with_webview(move |platform_wv| {
            let controller = platform_wv.controller();
            let mut is_visible = BOOL::default();
            let vis_res = unsafe { controller.IsVisible(&mut is_visible) };
            tracing::debug!(
                controller_is_visible = ?vis_res.map(|_| is_visible.as_bool()),
                "[combined:external] native controller state"
            );

            let Ok(core) = (unsafe { controller.CoreWebView2() }) else {
                tracing::error!("[combined:external] failed to obtain CoreWebView2");
                return;
            };

            let mut nav_token = Default::default();
            let nav_handler = NavigationCompletedEventHandler::create(Box::new(move |wv, args| {
                let mut is_success = BOOL::default();
                let mut web_err = COREWEBVIEW2_WEB_ERROR_STATUS::default();
                if let Some(args) = args {
                    unsafe {
                        let _ = args.IsSuccess(&mut is_success);
                        let _ = args.WebErrorStatus(&mut web_err);
                    }
                }
                let src = wv
                    .and_then(|w| unsafe {
                        let mut pwstr = PWSTR::null();
                        w.Source(&mut pwstr).ok()?;
                        Some(take_pwstr(pwstr))
                    })
                    .unwrap_or_default();
                if is_success.as_bool() {
                    tracing::info!(
                        url = %src,
                        "[combined:external] NavigationCompleted"
                    );
                    let app_handle = app_for_nav.clone();
                    tauri::async_runtime::spawn(async move {
                        external::apply_stored_external_volume(&app_handle);
                    });
                } else {
                    tracing::warn!(
                        is_success = false,
                        web_error_status = web_err.0,
                        url = %src,
                        "[combined:external] NavigationCompleted failed"
                    );
                }
                Ok(())
            }));
            if let Err(err) = unsafe { core.add_NavigationCompleted(&nav_handler, &mut nav_token) }
            {
                tracing::warn!("[combined:external] add_NavigationCompleted failed: {}", err);
            }

            let mut proc_token = Default::default();
            let proc_handler = ProcessFailedEventHandler::create(Box::new(|_, args| {
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                if let Some(args) = args {
                    unsafe {
                        let _ = args.ProcessFailedKind(&mut kind);
                    }
                }
                tracing::error!(
                    process_failed_kind = kind.0,
                    "[combined:external] WebView2 ProcessFailed"
                );
                Ok(())
            }));
            if let Err(err) = unsafe { core.add_ProcessFailed(&proc_handler, &mut proc_token) } {
                tracing::warn!("[combined:external] add_ProcessFailed failed: {}", err);
            }
        });
    }
    #[cfg(not(windows))]
    {
        let _ = webview;
    }
}

pub fn ensure_combined_maximized(window: &tauri::Window) {
    if !window.is_maximized().unwrap_or(false) {
        if let Err(err) = window.maximize() {
            tracing::warn!("failed to maximize combined window: {}", err);
        }
    }
    schedule_sync_combined_layout(window.app_handle(), 100);
}

/// Schedule a coalesced layout sync off the synchronous Win32 `WM_SIZE` callback.
/// Calling WebView2 COM APIs (`SetBounds` / `ExecuteScript`) synchronously inside `WM_SIZE`
/// can deadlock or freeze input on Windows during maximize/resize transitions.
pub fn schedule_sync_combined_layout(app: &AppHandle, delay_ms: u64) {
    if LAYOUT_SYNC_SCHEDULED
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if delay_ms > 0 {
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        }
        LAYOUT_SYNC_SCHEDULED.store(false, Ordering::Release);
        let app_for_main = app_handle.clone();
        if let Err(err) = app_handle.run_on_main_thread(move || {
            sync_combined_layout_internal(&app_for_main, false);
        }) {
            tracing::warn!("failed to dispatch combined layout sync on main thread: {}", err);
        }
    });
}

pub fn create_combined_window(app: &AppHandle, show_immediately: bool) {
    if let Some(window) = app.get_window(COMBINED_WINDOW_LABEL) {
        if show_immediately {
            let _ = window.show();
            ensure_combined_maximized(&window);
        }
        sync_combined_layout(app);
        return;
    }

    let (init_w, init_h) = default_combined_window_size();
    // Use an opaque parent window with WS_CLIPCHILDREN (not transparent/softbuffer) so child
    // WebView2 HWNDs composite reliably on Windows during creation, resize, and maximize.
    let builder = tauri::window::WindowBuilder::new(app, COMBINED_WINDOW_LABEL)
        .title("fusou-app")
        .decorations(false)
        .shadow(false)
        .resizable(true)
        .visible(false)
        .background_color(COMBINED_BG_DARK)
        .inner_size(init_w, init_h)
        .min_inner_size(640.0, 420.0);

    let window = match builder.build() {
        Ok(win) => win,
        Err(err) => {
            tracing::error!("failed to build combined parent window: {}", err);
            return;
        }
    };

    crate::window::common::setup_combined_parent_window(&window);

    let scale_factor = window.scale_factor().unwrap_or(1.0).max(0.5);
    let (win_w, win_h) =
        current_window_logical_size(&window).unwrap_or((init_w, init_h));

    let layout = app
        .try_state::<WindowLayoutState>()
        .map(|state| state.compute_layout_for_size(win_w, win_h))
        .unwrap_or_else(|| {
            WindowLayoutState::from_user_configs().compute_layout_for_size(win_w, win_h)
        });

    let chrome_builder = tauri::webview::WebviewBuilder::new(
        CHROME_WEBVIEW_LABEL,
        tauri::WebviewUrl::App("index.html?surface=chrome".into()),
    )
    .background_color(COMBINED_CHROME_BG)
    .use_https_scheme(true);
    #[cfg(dev)]
    let chrome_builder = chrome_builder.devtools(true);

    let (chrome_pos, chrome_size) = logical_rect_to_physical_parts(layout.titlebar, scale_factor);
    if let Err(err) = window.add_child(chrome_builder, chrome_pos, chrome_size) {
        tracing::error!("failed to add chrome child webview: {}", err);
    }

    let main_builder = tauri::webview::WebviewBuilder::new(
        MAIN_WEBVIEW_LABEL,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .background_color(COMBINED_PANEL_BG)
    .use_https_scheme(true);
    #[cfg(dev)]
    let main_builder = main_builder.devtools(true);

    let (panel_pos, panel_size) = logical_rect_to_physical_parts(layout.panel, scale_factor);
    if let Err(err) = window.add_child(main_builder, panel_pos, panel_size) {
        tracing::error!("failed to add main child webview: {}", err);
    }

    if show_immediately {
        if let Err(err) = window.show() {
            tracing::error!("failed to show combined window: {}", err);
        }
        ensure_combined_maximized(&window);
    }

    sync_combined_layout_internal(app, true);
}

pub fn attach_external_child_webview(app: &AppHandle) {
    if app.get_window(COMBINED_WINDOW_LABEL).is_none() {
        create_combined_window(app, true);
    }

    let Some(window) = app.get_window(COMBINED_WINDOW_LABEL) else {
        tracing::error!("combined parent window unavailable; cannot attach game webview");
        return;
    };

    if !window.is_visible().unwrap_or(false) {
        let _ = window.show();
    }
    ensure_combined_maximized(&window);

    if let Some(existing) = get_game_webview(app) {
        if let Some(state) = app.try_state::<WindowLayoutState>() {
            state.set_game_visible(true);
        }
        // Resize main panel and position the existing game webview BEFORE showing it so they never overlap.
        sync_combined_layout_internal(app, true);
        if let Err(err) = existing.show() {
            tracing::warn!("failed to show docked external webview: {}", err);
        }
        external::install_webview_hooks(&existing);
        external::apply_stored_external_volume(app);
        schedule_sync_combined_layout(app, 150);
        return;
    }

    let Some(game_url) = external::parse_game_url() else {
        return;
    };

    let init_script = external::build_external_init_script(true);

    if let Some(state) = app.try_state::<WindowLayoutState>() {
        state.set_game_visible(true);
    }

    let scale_factor = window.scale_factor().unwrap_or(1.0).max(0.5);
    let (win_w, win_h) =
        current_window_logical_size(&window).unwrap_or_else(default_combined_window_size);
    let layout = app
        .try_state::<WindowLayoutState>()
        .map(|state| state.compute_layout_for_size(win_w, win_h))
        .unwrap_or_else(|| {
            WindowLayoutState::from_user_configs().compute_layout_for_size(win_w, win_h)
        });

    // Shrink the main panel BEFORE adding the game child webview so their HWNDs never overlap.
    if let Some(main_wv) = get_app_webview(app) {
        if let Err(err) =
            main_wv.set_bounds(logical_rect_to_tauri_rect(layout.panel, scale_factor))
        {
            tracing::warn!("failed to pre-resize main webview before attaching game: {}", err);
        }
    }

    let game_rect = layout.game.unwrap_or(LogicalRect {
        x: 0.0,
        y: COMBINED_TITLEBAR_HEIGHT,
        width: (win_w * 0.7).max(240.0),
        height: (win_h - COMBINED_TITLEBAR_HEIGHT).max(240.0),
    });

    let external_builder = tauri::webview::WebviewBuilder::new(
        EXTERNAL_WEBVIEW_LABEL,
        tauri::WebviewUrl::External(game_url.clone()),
    )
    .background_color(COMBINED_GAME_BG)
    .initialization_script_for_all_frames(init_script);
    #[cfg(dev)]
    let external_builder = external_builder.devtools(true);

    let (game_pos, game_size) = logical_rect_to_physical_parts(game_rect, scale_factor);
    tracing::info!(
        win_w,
        win_h,
        scale_factor,
        game_url = %game_url,
        game_x = game_pos.x,
        game_y = game_pos.y,
        game_w = game_size.width,
        game_h = game_size.height,
        "[combined:external] attaching child webview"
    );

    match window.add_child(external_builder, game_pos, game_size) {
        Ok(webview) => {
            if let Err(err) = webview.show() {
                tracing::warn!("failed to explicitly show external child webview: {}", err);
            }
            install_external_diagnostics(&webview);
            external::install_webview_hooks(&webview);
            external::apply_stored_external_volume(app);
            sync_combined_layout_internal(app, true);
            schedule_sync_combined_layout(app, 150);
        }
        Err(err) => {
            tracing::error!("failed to add external child webview: {}", err);
            if let Some(state) = app.try_state::<WindowLayoutState>() {
                state.set_game_visible(false);
            }
            sync_combined_layout_internal(app, true);
        }
    }
}

/// Hide the docked game child webview without closing it so the browser session
/// and game connection remain alive and never reload when shown again.
pub fn hide_external_child_webview(app: &AppHandle) {
    if let Some(game_wv) = get_game_webview(app) {
        if let Err(err) = game_wv.hide() {
            tracing::warn!("failed to hide docked external webview: {}", err);
        }
    }

    if let Some(state) = app.try_state::<WindowLayoutState>() {
        state.set_game_visible(false);
        state.set_dragging_splitter(false);
    }

    sync_combined_layout_internal(app, true);
}

fn current_window_logical_size(window: &tauri::Window) -> Option<(f64, f64)> {
    let scale_factor = window.scale_factor().unwrap_or(1.0).max(0.5);
    let inner = window.inner_size().ok()?;
    let logical = inner.to_logical::<f64>(scale_factor);
    if logical.width <= 1.0 || logical.height <= 1.0 {
        return None;
    }
    Some((logical.width, logical.height))
}

pub fn sync_combined_layout(app: &AppHandle) {
    sync_combined_layout_internal(app, true);
}

fn sync_combined_layout_internal(app: &AppHandle, force_notify: bool) {
    let Some(window) = get_primary_window(app) else {
        return;
    };
    if window.label() != COMBINED_WINDOW_LABEL {
        return;
    }
    if window.is_minimized().unwrap_or(false) {
        return;
    }

    let scale_factor = window.scale_factor().unwrap_or(1.0).max(0.5);
    let Some((width, height)) = current_window_logical_size(&window) else {
        return;
    };

    let Some(state) = app.try_state::<WindowLayoutState>() else {
        return;
    };

    let prev_effective_dock = state.snapshot().effective_dock_position;
    let layout = state.compute_layout_for_size(width, height);
    let dock_changed = layout.effective_dock != prev_effective_dock;

    if let Some(chrome) = get_chrome_webview(app) {
        if let Err(err) =
            chrome.set_bounds(logical_rect_to_tauri_rect(layout.titlebar, scale_factor))
        {
            tracing::warn!("failed to set chrome webview bounds: {}", err);
        }
    }

    if let Some(main_wv) = get_app_webview(app) {
        if let Err(err) = main_wv.set_bounds(logical_rect_to_tauri_rect(layout.panel, scale_factor))
        {
            tracing::warn!("failed to set main webview bounds: {}", err);
        }
    }

    if let Some(game_rect) = layout.game {
        if let Some(game_wv) = get_game_webview(app) {
            if let Err(err) =
                game_wv.set_bounds(logical_rect_to_tauri_rect(game_rect, scale_factor))
            {
                tracing::warn!("failed to set external webview bounds: {}", err);
            }
        }
        if force_notify || dock_changed {
            let game_edges = DockEdgeFlags::game_edges(layout.effective_dock);
            push_game_dock_edges(app, game_edges);
        }
    }

    if force_notify || dock_changed {
        emit_layout_state(app);
    }
}

pub fn set_dock_position(app: &AppHandle, dock: DockPosition, persist: bool) -> Result<(), String> {
    if let Some(state) = app.try_state::<WindowLayoutState>() {
        state.set_dock_position(dock);
    }
    if persist {
        let mut updates = BTreeMap::new();
        updates.insert(
            "app.kc_window.dock_position".to_string(),
            ConfigPatchValue::String(dock.as_str().to_string()),
        );
        configs::update_user_config_values(&updates)
            .map_err(|err| format!("Failed to persist dock_position: {err}"))?;
    }
    sync_combined_layout_internal(app, true);
    Ok(())
}

pub fn set_dock_panel_ratio(
    app: &AppHandle,
    ratio_percent: u32,
    persist: bool,
) -> Result<u32, String> {
    let clamped = if let Some(state) = app.try_state::<WindowLayoutState>() {
        state.set_panel_ratio_percent(ratio_percent)
    } else {
        clamp_panel_ratio(ratio_percent)
    };

    if persist {
        let mut updates = BTreeMap::new();
        updates.insert(
            "app.kc_window.dock_panel_ratio_percent".to_string(),
            ConfigPatchValue::Integer(clamped as i64),
        );
        configs::update_user_config_values(&updates)
            .map_err(|err| format!("Failed to persist dock_panel_ratio_percent: {err}"))?;
    }

    sync_combined_layout_internal(app, true);
    Ok(clamped)
}

pub fn begin_splitter_drag(app: &AppHandle) {
    let Some(state) = app.try_state::<WindowLayoutState>() else {
        return;
    };
    state.set_dragging_splitter(true);
    let snapshot = state.snapshot();
    let axis = if snapshot.effective_dock_position.is_horizontal() {
        "horizontal"
    } else {
        "vertical"
    };
    if let Some(game_wv) = get_game_webview(app) {
        let script = format!(
            "if (typeof window.__fusouSetSplitterDragging === 'function') {{ window.__fusouSetSplitterDragging(true, '{}'); }}",
            axis
        );
        let _ = game_wv.eval(&script);
    }
    emit_layout_state(app);
}

pub fn update_splitter_drag(app: &AppHandle, screen_x: f64, screen_y: f64) {
    let Some(state) = app.try_state::<WindowLayoutState>() else {
        return;
    };
    if !state.is_dragging_splitter() {
        return;
    }

    let Some(window) = get_primary_window(app) else {
        return;
    };
    if window.label() != COMBINED_WINDOW_LABEL {
        return;
    }

    let scale_factor = window.scale_factor().unwrap_or(1.0).max(0.5);
    let Ok(inner_pos) = window.inner_position() else {
        return;
    };
    let Ok(inner_size) = window.inner_size() else {
        return;
    };
    let origin = inner_pos.to_logical::<f64>(scale_factor);
    let size = inner_size.to_logical::<f64>(scale_factor);

    let snapshot = state.snapshot();
    let titlebar_h = if snapshot.platform_capabilities.supports_custom_titlebar {
        COMBINED_TITLEBAR_HEIGHT
    } else {
        0.0
    };
    let next_ratio = compute_ratio_from_pointer(
        snapshot.effective_dock_position,
        origin.x,
        origin.y + titlebar_h,
        size.width,
        (size.height - titlebar_h).max(1.0),
        screen_x,
        screen_y,
    );

    if next_ratio != snapshot.panel_ratio_percent {
        state.set_panel_ratio_percent(next_ratio);
        sync_combined_layout_internal(app, false);
    }
}

pub fn end_splitter_drag(app: &AppHandle) {
    let Some(state) = app.try_state::<WindowLayoutState>() else {
        return;
    };
    if !state.is_dragging_splitter() {
        return;
    }

    state.set_dragging_splitter(false);
    if let Some(game_wv) = get_game_webview(app) {
        let _ = game_wv.eval(
            "if (typeof window.__fusouSetSplitterDragging === 'function') { window.__fusouSetSplitterDragging(false); }",
        );
    }

    let ratio = state.snapshot().panel_ratio_percent;
    let mut updates = BTreeMap::new();
    updates.insert(
        "app.kc_window.dock_panel_ratio_percent".to_string(),
        ConfigPatchValue::Integer(ratio as i64),
    );
    if let Err(err) = configs::update_user_config_values(&updates) {
        tracing::warn!("failed to persist splitter ratio after drag: {}", err);
    }
    emit_layout_state(app);
}
