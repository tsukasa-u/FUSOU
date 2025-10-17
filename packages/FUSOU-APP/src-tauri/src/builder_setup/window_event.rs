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

                if let Ok(mut size_before) = EXTERNAL_WINDOW_SIZE_BEFORE.lock() {
                    if size.width != size_before.width {
                        size_before.width = size.width;
                        size_before.height = size.width * 720 / 1200;
                    } else {
                        size_before.width = size.height * 1200 / 720;
                        size_before.height = size.height;
                    }
                }

                let _ = window.set_size(*EXTERNAL_WINDOW_SIZE_BEFORE.lock().unwrap());
            }
        }
        _ => {}
    }
}
