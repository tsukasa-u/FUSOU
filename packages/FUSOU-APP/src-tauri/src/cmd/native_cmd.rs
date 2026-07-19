// use tauri::api::process::Command;
// use std::process::Command;
use tauri_plugin_shell::ShellExt;
use tracing_unwrap::{OptionExt, ResultExt};

use crate::notify;

#[cfg(target_os = "windows")]
pub static PATH_ADD_PROXY_BAT: &str = "cmd/windows/add_proxy.bat";
#[cfg(target_os = "windows")]
pub static PATH_DELETE_PROXY_BAT: &str = "cmd/windows/delete_proxy.bat";
#[cfg(target_os = "windows")]
pub static PATH_ADD_STORE_BAT: &str = "cmd/windows/add_store.bat";
#[cfg(target_os = "linux")]
pub static PATH_ADD_PROXY_SH: &str = "cmd/linux/add_proxy.sh";
#[cfg(target_os = "linux")]
pub static PATH_DELETE_PROXY_SH: &str = "cmd/linux/delete_proxy.sh";
#[cfg(target_os = "linux")]
pub static PATH_ADD_STORE_SH: &str = "cmd/linux/add_store.sh";
#[cfg(target_os = "linux")]
pub static PATH_CHECK_CA_SH: &str = "cmd/linux/check_ca.sh";

#[cfg(target_os = "linux")]
use proxy_https::proxy_server_https::CA_CERT_NAME;
#[cfg(target_os = "linux")]
use proxy_https::proxy_server_https::CA_CERT_NAME_CRT;
#[cfg(target_os = "windows")]
use proxy_https::proxy_server_https::CA_CERT_NAME_PEM;

use crate::util::get_RESOURCES_DIR;
use crate::util::get_ROAMING_DIR;

pub fn add_pac<R>(path: String, app: &tauri::AppHandle<R>)
where
    R: tauri::Runtime,
{
    #[cfg(target_os = "windows")]
    let cmd_path = get_RESOURCES_DIR()
        .join(PATH_ADD_PROXY_BAT)
        .as_path()
        .to_str()
        .expect_or_log("cmd_path not found")
        .to_string();

    #[cfg(target_os = "linux")]
    let cmd_path = get_RESOURCES_DIR()
        .join(PATH_ADD_PROXY_SH)
        .as_path()
        .to_str()
        .expect_or_log("cmd_path not found")
        .to_string();

    let app_handle = app.clone();
    let path_clone = path.clone();
    tauri::async_runtime::spawn(async move {
        let output_result = app_handle
            .shell()
            .command(cmd_path)
            .args([path])
            .output()
            .await;

        match output_result {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);

                tracing::debug!("add_pac stdout: {}", stdout);
                tracing::debug!("add_pac stderr: {}", stderr);
                if !output.status.success() {
                    tracing::warn!("add_pac failed with status: {:?}", output.status);
                    if !stderr.trim().is_empty() {
                        tracing::warn!("add_pac stderr: {}", stderr);
                    }
                    if !stdout.trim().is_empty() {
                        tracing::warn!("add_pac stdout: {}", stdout);
                    }
                    notify::show(
                        &app_handle,
                        "Proxy Setup Failed",
                        "Failed to apply PAC settings. Please retry and check your system proxy permissions.",
                    );
                }
            }
            Err(err) => {
                tracing::warn!("failed to execute add_pac process: {:?}", err);
                notify::show(
                    &app_handle,
                    "Proxy Setup Failed",
                    "Could not run PAC setup command. Please retry and check your environment.",
                );
            }
        }
    });

    tracing::info!("register AutoConfigURL: {}", path_clone);
}

pub fn remove_pac<R>(app: &tauri::AppHandle<R>)
where
    R: tauri::Runtime,
{
    #[cfg(target_os = "windows")]
    let cmd_path = get_RESOURCES_DIR()
        .join(PATH_DELETE_PROXY_BAT)
        .as_path()
        .to_str()
        .expect_or_log("cmd_path not found")
        .to_string();

    #[cfg(target_os = "linux")]
    let cmd_path = get_RESOURCES_DIR()
        .join(PATH_DELETE_PROXY_SH)
        .as_path()
        .to_str()
        .expect_or_log("cmd_path not found")
        .to_string();

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let output_result = app_handle
            .shell()
            .command(cmd_path)
            .output()
            .await;

        match output_result {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);

                tracing::debug!("remove_pac stdout: {}", stdout);
                tracing::debug!("remove_pac stderr: {}", stderr);
                if !output.status.success() {
                    tracing::warn!("remove_pac failed with status: {:?}", output.status);
                    if !stderr.trim().is_empty() {
                        tracing::warn!("remove_pac stderr: {}", stderr);
                    }
                    if !stdout.trim().is_empty() {
                        tracing::warn!("remove_pac stdout: {}", stdout);
                    }
                    notify::show(
                        &app_handle,
                        "Proxy Cleanup Failed",
                        "Failed to remove PAC settings. Please check your system proxy configuration.",
                    );
                }
            }
            Err(err) => {
                tracing::warn!("failed to execute remove_pac process: {:?}", err);
                notify::show(
                    &app_handle,
                    "Proxy Cleanup Failed",
                    "Could not run PAC cleanup command. Please retry and check your environment.",
                );
            }
        }
    });

    tracing::info!("unregister AutoConfigURL");
}

pub fn add_store<R>(app: &tauri::AppHandle<R>)
where
    R: tauri::Runtime,
{
    #[cfg(target_os = "windows")]
    let ca_cert_name = CA_CERT_NAME_PEM;
    #[cfg(target_os = "linux")]
    let ca_cert_name = CA_CERT_NAME_CRT;

    let ca_path = get_ROAMING_DIR()
        .join("ca")
        .join(ca_cert_name)
        .as_path()
        .to_str()
        .expect_or_log("ca_path not found")
        .to_string();

    #[cfg(target_os = "windows")]
    let cmd_path = get_RESOURCES_DIR()
        .join(PATH_ADD_STORE_BAT)
        .as_path()
        .to_str()
        .expect_or_log("cmd_path not found")
        .to_string();

    #[cfg(target_os = "linux")]
    let cmd_path = get_RESOURCES_DIR()
        .join(PATH_ADD_STORE_SH)
        .as_path()
        .to_str()
        .expect_or_log("cmd_path not found")
        .to_string();

    tracing::debug!("cmd_path: {}", cmd_path.clone());
    tracing::debug!("ca_path: {}", ca_path.clone());
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let output_result = app_handle
            .shell()
            .command(cmd_path)
            .args([ca_path])
            .output()
            .await;

        match output_result {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let status = output.status;

                tracing::debug!("add_store stdout: {}", stdout);
                tracing::debug!("add_store stderr: {}", stderr);
                if status.success() {
                    tracing::info!("add_store succeeded");
                } else {
                    tracing::warn!("add_store failed with status: {:?}", status);
                    if !stderr.trim().is_empty() {
                        tracing::warn!("add_store stderr: {}", stderr);
                    }
                    if !stdout.trim().is_empty() {
                        tracing::warn!("add_store stdout: {}", stdout);
                    }
                    notify::show(
                        &app_handle,
                        "Certificate Installation Failed",
                        "Failed to install the local CA certificate. Please retry and check your permissions.",
                    );
                }
            }
            Err(err) => {
                tracing::warn!("failed to execute add_store process: {:?}", err);
                notify::show(
                    &app_handle,
                    "Certificate Installation Failed",
                    "Could not run certificate installation command. Please retry and check your environment.",
                );
            }
        }
    });
}

#[cfg(target_os = "linux")]
pub async fn check_ca_installed<R>(app: &tauri::AppHandle<R>) -> bool
where
    R: tauri::Runtime,
{
    let app_handle = app.clone();
    let cmd_path = get_RESOURCES_DIR()
        .join(PATH_CHECK_CA_SH)
        .as_path()
        .to_str()
        .expect_or_log("cmd_path not found")
        .to_string();
    let ca_cert_file_name = CA_CERT_NAME;

    let output = app_handle
        .shell()
        .command(cmd_path)
        .args([ca_cert_file_name])
        .output()
        .await
        .expect_or_log("failed to execute process");

    let status = output.status;
    tracing::debug!("{}", String::from_utf8_lossy(&output.stdout));
    if status.success() {
        tracing::info!("CA certificate is installed");
    } else {
        tracing::info!("CA certificate is not installed");
    }
    return status.success();
}
