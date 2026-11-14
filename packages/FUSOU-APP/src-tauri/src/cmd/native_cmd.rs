use std::path::PathBuf;

use crate::notify;
use crate::util::{get_CMD_DIR, get_ROAMING_DIR};

#[cfg(target_os = "linux")]
use proxy_https::proxy_server_https::CA_CERT_NAME_CRT;
#[cfg(target_os = "windows")]
use proxy_https::proxy_server_https::CA_CERT_NAME_DER;

fn resolve_store_cert_path() -> Result<PathBuf, String> {
    let proxy_configs = configs::get_user_configs_for_proxy();
    let use_generated_certs = proxy_configs.certificates.get_use_generated_certs();
    tracing::info!(
        use_generated_certs,
        "resolving store/check certificate path from proxy settings"
    );

    if !use_generated_certs {
        if let Some(custom_cert_path) = proxy_configs.certificates.get_cert_file() {
            tracing::info!(
                cert_path = %custom_cert_path.display(),
                "custom certificate mode selected for store/check"
            );
            return Ok(custom_cert_path);
        }
        return Err(
            "custom certificate mode requires certificates.cert_file for store/check operations"
                .to_string(),
        );
    }

    #[cfg(target_os = "windows")]
    {
        let path = get_ROAMING_DIR().join("ca").join(CA_CERT_NAME_DER);
        tracing::info!(cert_path = %path.display(), "generated certificate mode selected for store/check");
        Ok(path)
    }

    #[cfg(target_os = "linux")]
    {
        let path = get_ROAMING_DIR().join("ca").join(CA_CERT_NAME_CRT);
        tracing::info!(cert_path = %path.display(), "generated certificate mode selected for store/check");
        Ok(path)
    }
}

pub fn add_pac<R>(path: String, app: &tauri::AppHandle<R>)
where
    R: tauri::Runtime,
{
    let cmd_dir = get_CMD_DIR();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = proxy_https::system_proxy::add_pac(&cmd_dir, &path).await {
            tracing::warn!("add_pac failed: {err}");
            notify::show(
                &app_handle,
                "Proxy Setup Failed",
                "Failed to apply PAC settings. Please retry and check your system proxy permissions.",
            );
        }
    });
}

pub fn remove_pac<R>(app: &tauri::AppHandle<R>)
where
    R: tauri::Runtime,
{
    let cmd_dir = get_CMD_DIR();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = proxy_https::system_proxy::remove_pac(&cmd_dir).await {
            tracing::warn!("remove_pac failed: {err}");
            notify::show(
                &app_handle,
                "Proxy Cleanup Failed",
                "Failed to remove PAC settings. Please check your system proxy configuration.",
            );
        }
    });
}

#[allow(dead_code)]
pub fn add_store<R>(app: &tauri::AppHandle<R>)
where
    R: tauri::Runtime,
{
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = add_store_sync(&app_handle).await;
    });
}

pub async fn add_store_sync<R>(app: &tauri::AppHandle<R>) -> bool
where
    R: tauri::Runtime,
{
    let ca_path = match resolve_store_cert_path() {
        Ok(path) => path,
        Err(err) => {
            tracing::warn!("add_store path resolution failed: {err}");
            notify::show(
                app,
                "Certificate Installation Failed",
                "Certificate path configuration is invalid for current mode. Please check configs.toml.",
            );
            return false;
        }
    };

    let cmd_dir = get_CMD_DIR();
    match proxy_https::system_proxy::add_store(&cmd_dir, &ca_path).await {
        Ok(()) => true,
        Err(err) => {
            tracing::warn!("add_store failed: {err}");
            notify::show(
                app,
                "Certificate Installation Failed",
                "Failed to install the local CA certificate. Please retry and check your permissions.",
            );
            false
        }
    }
}

pub async fn check_ca_installed<R>(_app: &tauri::AppHandle<R>) -> bool
where
    R: tauri::Runtime,
{
    let ca_cert_path = match resolve_store_cert_path() {
        Ok(path) => path,
        Err(err) => {
            tracing::warn!("check_ca path resolution failed: {err}");
            return false;
        }
    };

    let cmd_dir = get_CMD_DIR();
    match proxy_https::system_proxy::check_ca_installed(&cmd_dir, &ca_cert_path).await {
        Ok(installed) => installed,
        Err(err) => {
            tracing::warn!("failed to check installed CA certificate: {err}");
            false
        }
    }
}
