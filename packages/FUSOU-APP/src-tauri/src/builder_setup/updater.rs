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
    if let Some(update) = app.updater()?.check().await? {
        let mut downloaded = 0;

        // alternatively we could also call update.download() and update.install() separately
        update
            .download_and_install(
                |chunk_length, content_length| {
                    downloaded += chunk_length;
                    println!("downloaded {downloaded} from {content_length:?}");
                },
                || {
                    tracing::info!("download finished");
                },
            )
            .await?;

        tracing::info!("update installed");
        app.restart();
    }

    Ok(())
}
