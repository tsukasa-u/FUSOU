use configs;
use std::sync::{Arc, LazyLock, Mutex};
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

struct Debouncer {
    sender: mpsc::Sender<()>,
    callback: Arc<Mutex<Box<dyn FnMut() + Send + 'static>>>,
}

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

static RESIZE_DEBOUNCER: LazyLock<Debouncer> = LazyLock::new(|| {
    let duration = Duration::from_millis(
        configs::get_user_configs_for_app()
            .window
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
            trigger_resize_debouncer();
        }
        _ => {}
    }
}

pub fn set_resize_debouncer_callback<F>(callback: F)
where
    F: FnMut() + Send + 'static,
{
    RESIZE_DEBOUNCER.set_callback(callback);
}

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

    let target_size = {
        let mut size_before = EXTERNAL_WINDOW_SIZE_BEFORE.lock().unwrap();
        if size.width != size_before.width {
            size_before.width = size.width;
            size_before.height = size.width * 720 / 1200;
        } else {
            size_before.width = size.height * 1200 / 720;
            size_before.height = size.height;
        }
        *size_before
    };

    let _ = window.set_size(target_size);
}
