#[cfg(any(not(dev), check_release))]
use crate::{cmd::tauri_cmd, window::app};
#[cfg(any(not(dev), check_release))]
use tauri::Manager;
#[cfg(any(not(dev), check_release))]
use tauri_plugin_updater::UpdaterExt;

#[cfg(any(not(dev), check_release))]
pub fn setup_updater(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        match update(handle).await {
            Ok(_) => tracing::info!("update check finished"),
            Err(err) => tracing::error!("update check failed: {}", err),
        }
    });
    Ok(())
}

#[cfg(any(not(dev), check_release))]
async fn update(app: tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    if let Some(_update) = app.updater()?.check().await? {
        let window = app.get_webview_window("main");
        match window {
            Some(window) => {
                if let Ok(false) = window.is_visible() {
                    if let Err(e) = window.show() {
                        tracing::error!("Failed to show main window: {}", e);
                    }
                }
                tauri_cmd::set_update_page(&app);
            }
            None => {
                app::open_main_window(&app);
                tauri_cmd::set_update_page(&app);
            }
        }
        // let mut downloaded = 0;

        // // alternatively we could also call update.download() and update.install() separately
        // update
        //     .download_and_install(
        //         |chunk_length, content_length| {
        //             downloaded += chunk_length;
        //             print!("\rdownloaded {downloaded} from {content_length:?}");
        //         },
        //         || {
        //             println!();
        //             tracing::info!("download finished");
        //         },
        //     )
        //     .await?;

        // tracing::info!("update installed");
        // app.restart();
    }

    Ok(())
}
