use std::sync::{LazyLock, Mutex};

static EXTERNAL_WINDOW_SIZE_BEFORE: LazyLock<Mutex<tauri::PhysicalSize<u32>>> =
    LazyLock::new(|| {
        Mutex::new(tauri::PhysicalSize::<u32> {
            width: 1200,
            height: 720,
        })
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
            if window.label().eq("external") {
                if let Ok(is_maximized) = window.is_maximized() {
                    if is_maximized {
                        EXTERNAL_WINDOW_SIZE_BEFORE.lock().unwrap().height = size.height;
                        EXTERNAL_WINDOW_SIZE_BEFORE.lock().unwrap().width = size.width;
                        return;
                    }
                }
                if let Ok(is_minimized) = window.is_minimized() {
                    if is_minimized {
                        return;
                    }
                }

                if size.width != EXTERNAL_WINDOW_SIZE_BEFORE.lock().unwrap().width {
                    EXTERNAL_WINDOW_SIZE_BEFORE.lock().unwrap().width = size.width;
                    EXTERNAL_WINDOW_SIZE_BEFORE.lock().unwrap().height = size.width * 712 / 1192;
                } else {
                    EXTERNAL_WINDOW_SIZE_BEFORE.lock().unwrap().width = size.height * 1192 / 712;
                    EXTERNAL_WINDOW_SIZE_BEFORE.lock().unwrap().height = size.height;
                }

                let _ = window.set_size(*EXTERNAL_WINDOW_SIZE_BEFORE.lock().unwrap());
            }
        }
        _ => {}
    }
}
