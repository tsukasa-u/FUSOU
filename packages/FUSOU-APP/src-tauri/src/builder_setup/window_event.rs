use configs;
use std::sync::{LazyLock, Mutex};

use crate::window::external;

#[cfg(target_os = "linux")]
use std::sync::Arc;
#[cfg(target_os = "linux")]
use tauri::PhysicalSize;
#[cfg(target_os = "linux")]
use tokio::{
    sync::mpsc,
    task,
    time::{self, Duration},
};

const TITLEBAR_HEIGHT: f64 = 32.0;

static EXTERNAL_WINDOW_SIZE_BEFORE: LazyLock<Mutex<Option<tauri::PhysicalSize<u32>>>> =
    LazyLock::new(|| Mutex::new(None));

type ResizeContext = Option<(tauri::Window, tauri::PhysicalSize<u32>)>;
static LAST_RESIZE_CONTEXT: LazyLock<Mutex<ResizeContext>> = LazyLock::new(|| Mutex::new(None));

#[cfg(target_os = "linux")]
struct Debouncer {
    sender: mpsc::Sender<()>,
    callback: Arc<Mutex<Box<dyn FnMut() + Send + 'static>>>,
}

#[cfg(target_os = "linux")]
impl Debouncer {
    fn new(debounce_duration: Duration) -> Self {
        let (sender, mut receiver) = mpsc::channel(1);
        let callback: Arc<Mutex<Box<dyn FnMut() + Send + 'static>>> = Arc::new(Mutex::new(
            Box::new(|| {}) as Box<dyn FnMut() + Send + 'static>,
        ));
        let callback_clone = Arc::clone(&callback);

        task::spawn(async move {
            while receiver.recv().await.is_some() {
                loop {
                    match time::timeout(debounce_duration, receiver.recv()).await {
                        Ok(Some(_)) => {
                            continue;
                        }
                        Ok(None) => {
                            return;
                        }
                        Err(_) => {
                            break;
                        }
                    }
                }

                if let Ok(mut cb) = callback_clone.lock() {
                    (*cb)();
                }
            }
        });

        Self { sender, callback }
    }

    fn trigger(&self) {
        let _ = self.sender.try_send(());
    }

    fn set_callback<F>(&self, callback: F)
    where
        F: FnMut() + Send + 'static,
    {
        if let Ok(mut cb) = self.callback.lock() {
            *cb = Box::new(callback);
        }
    }
}

#[cfg(target_os = "linux")]
static RESIZE_DEBOUNCER: LazyLock<Debouncer> = LazyLock::new(|| {
    let duration = Duration::from_millis(
        configs::get_user_configs_for_app()
            .kc_window
            .get_resize_debounce_millis(),
    );
    let debouncer = Debouncer::new(duration);
    debouncer.set_callback(handle_external_resize);
    debouncer
});

pub fn window_event_handler(window: &tauri::Window, event: &tauri::WindowEvent) {
    match event {
        tauri::WindowEvent::CloseRequested { api, .. } => match window.label() {
            "main" => {
                if let Err(e) = window.hide() {
                    tracing::warn!("failed to hide main window on close request: {}", e);
                }
                api.prevent_close();
            }
            "external" => {
                if let Err(e) = window.close() {
                    tracing::warn!("failed to close external window: {}", e);
                } else {
                    external::unregister_webview_key_fallback(window.label());
                }
            }
            #[cfg(dev)]
            "debug" => {
                if let Err(e) = window.close() {
                    tracing::warn!("failed to close debug window: {}", e);
                }
            }
            _ => {}
        },
        tauri::WindowEvent::Resized(size) => {
            {
                let mut ctx = LAST_RESIZE_CONTEXT
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                *ctx = Some((window.clone(), *size));
            }
            #[cfg(target_os = "linux")]
            trigger_resize_debouncer();
            #[cfg(not(target_os = "linux"))]
            handle_external_resize();
        }
        _ => {}
    }
}

#[cfg(target_os = "linux")]
fn trigger_resize_debouncer() {
    RESIZE_DEBOUNCER.trigger();
}

fn handle_external_resize() {
    let Some((window, size)) = LAST_RESIZE_CONTEXT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
    else {
        return;
    };

    if !window.label().eq("external") {
        return;
    }

    if let Ok(is_maximized) = window.is_maximized() {
        if is_maximized {
            if let Ok(mut stored) = EXTERNAL_WINDOW_SIZE_BEFORE.lock() {
                *stored = Some(size);
            }
            return;
        }
    }

    if let Ok(is_minimized) = window.is_minimized() {
        if is_minimized {
            return;
        }
    }

    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let titlebar_physical = (TITLEBAR_HEIGHT * scale_factor).round();

    let app_configs = configs::get_user_configs_for_app();
    let kc_window = &app_configs.kc_window;
    let inner_winow_size_width = kc_window.get_default_inner_width() as f64;
    let inner_winow_size_height = kc_window.get_default_inner_height() as f64;

    let target_size = {
        let mut size_before_guard = EXTERNAL_WINDOW_SIZE_BEFORE
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        let mut new_physical = size;
        let expected_height_from_width = (size.width as f64 * inner_winow_size_height
            / inner_winow_size_width
            + titlebar_physical)
            .round() as u32;

        match *size_before_guard {
            Some(size_before) => {
                if size.width != size_before.width {
                    new_physical.height = expected_height_from_width;
                } else if size.height != size_before.height {
                    let game_height = (size.height as f64 - titlebar_physical).max(1.0);
                    new_physical.width = (game_height * inner_winow_size_width
                        / inner_winow_size_height)
                        .round() as u32;
                } else {
                    return;
                }
            }
            None => {
                if size.height != expected_height_from_width {
                    new_physical.height = expected_height_from_width;
                } else {
                    *size_before_guard = Some(size);
                    return;
                }
            }
        }

        *size_before_guard = Some(new_physical);
        new_physical
    };

    if size == target_size {
        return;
    }

    #[cfg(target_os = "linux")]
    {
        let _ = window.set_max_size(Some(target_size));
        let _ = window.set_min_size(Some(target_size));
    }
    let _ = window.set_size(target_size);
    #[cfg(target_os = "linux")]
    {
        let keep_window_size_duration_millis = kc_window.get_keep_window_size_duration_millis();
        tokio::spawn(async move {
            let _ =
                tokio::time::sleep(Duration::from_millis(keep_window_size_duration_millis)).await;
            let _ = window.set_max_size::<PhysicalSize<u32>>(None);
            let _ = window.set_min_size::<PhysicalSize<u32>>(None);
        });
    }
}
