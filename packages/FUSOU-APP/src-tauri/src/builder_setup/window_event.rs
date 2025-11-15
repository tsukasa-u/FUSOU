use configs;
use std::sync::{LazyLock, Mutex};

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

static EXTERNAL_WINDOW_SIZE_BEFORE: LazyLock<Mutex<tauri::PhysicalSize<u32>>> =
    LazyLock::new(|| {
        Mutex::new(tauri::PhysicalSize::<u32> {
            width: 1200,
            height: 720,
        })
    });

static LAST_RESIZE_CONTEXT: LazyLock<Mutex<Option<(tauri::Window, tauri::PhysicalSize<u32>)>>> =
    LazyLock::new(|| Mutex::new(None));

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
                window.hide().unwrap();
                api.prevent_close();
            }
            "external" => {
                window.close().unwrap();
            }
            #[cfg(dev)]
            "debug" => {
                window.close().unwrap();
            }
            _ => {}
        },
        tauri::WindowEvent::Resized(size) => {
            {
                let mut ctx = LAST_RESIZE_CONTEXT.lock().unwrap();
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
pub fn set_resize_debouncer_callback<F>(callback: F)
where
    F: FnMut() + Send + 'static,
{
    RESIZE_DEBOUNCER.set_callback(callback);
}

#[cfg(target_os = "linux")]
fn trigger_resize_debouncer() {
    RESIZE_DEBOUNCER.trigger();
}

fn handle_external_resize() {
    let Some((window, size)) = LAST_RESIZE_CONTEXT.lock().unwrap().take() else {
        return;
    };

    if !window.label().eq("external") {
        return;
    }

    if let Ok(is_maximized) = window.is_maximized() {
        if is_maximized {
            if let Ok(mut stored) = EXTERNAL_WINDOW_SIZE_BEFORE.lock() {
                stored.height = size.height;
                stored.width = size.width;
            }
            return;
        }
    }

    if let Ok(is_minimized) = window.is_minimized() {
        if is_minimized {
            return;
        }
    }

    let app_configs = configs::get_user_configs_for_app();
    let kc_window = &app_configs.kc_window;
    let inner_winow_size_width = app_configs.kc_window.get_default_inner_width() as f64;
    let inner_winow_size_height = kc_window.get_default_inner_height() as f64;
    #[cfg(target_os = "linux")]
    let window_title_bar_height = kc_window.get_window_title_bar_height() as f64;

    #[cfg(target_os = "linux")]
    let window_system_type = configs::get_user_env().get_window_system_type();
    #[cfg(target_os = "linux")]
    let linux_window_title_bar_height =
        if let Some(configs::WindowsSystem::Wayland) = window_system_type {
            window_title_bar_height
        } else {
            0.0
        };

    let target_size = {
        let mut size_before = EXTERNAL_WINDOW_SIZE_BEFORE.lock().unwrap();
        if size.width != size_before.width {
            size_before.width = size.width;
            #[cfg(target_os = "linux")]
            {
                size_before.height = (size.width as f64 * inner_winow_size_height
                    / inner_winow_size_width
                    + linux_window_title_bar_height)
                    .round() as u32;
            }
            #[cfg(not(target_os = "linux"))]
            {
                size_before.height = (size.width as f64 * inner_winow_size_height
                    / inner_winow_size_width)
                    .round() as u32;
            }
        } else {
            #[cfg(target_os = "linux")]
            {
                size_before.width = ((size.height as f64 - linux_window_title_bar_height)
                    * inner_winow_size_width
                    / inner_winow_size_height)
                    .round() as u32;
            }
            #[cfg(not(target_os = "linux"))]
            {
                size_before.width = (size.height as f64 * inner_winow_size_width
                    / inner_winow_size_height)
                    .round() as u32;
            }
            size_before.height = size.height;
        }
        *size_before
    };

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
