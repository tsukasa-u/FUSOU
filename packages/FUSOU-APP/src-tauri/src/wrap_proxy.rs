// use proxy::bidirectional_channel::{Master, Slave, StatusInfo};
use proxy_https::{
    bidirectional_channel::{Master, Slave, StatusInfo},
    edit_pac::edit_pac,
};
use tauri::Url;

use crate::{
    builder_setup::bidirectional_channel::{
        get_pac_bidirectional_channel, get_proxy_bidirectional_channel,
        get_proxy_log_bidirectional_channel,
    },
    cmd::native_cmd::{self, add_store_sync},
};

use fusou_auth::{AuthManager, FileStorage};
use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

static PAC_SERVER_ADDR: OnceLock<Mutex<Option<SocketAddr>>> = OnceLock::new();

fn pac_server_addr() -> &'static Mutex<Option<SocketAddr>> {
    PAC_SERVER_ADDR.get_or_init(|| Mutex::new(None))
}

struct PacAddrResetGuard;

impl Drop for PacAddrResetGuard {
    fn drop(&mut self) {
        let mut guard = pac_server_addr().lock().unwrap_or_else(|e| e.into_inner());
        *guard = None;
    }
}

async fn shutdown_proxy_after_partial_failure(proxy_handle: tokio::task::JoinHandle<()>) {
    let channel = get_proxy_bidirectional_channel().clone_master();
    if channel
        .send(StatusInfo::SHUTDOWN {
            status: "SHUTTING DOWN".to_string(),
            message: "Shutting down proxy after startup failure".to_string(),
        })
        .await
        .is_err()
    {
        proxy_handle.abort();
    }
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
use crate::cmd::native_cmd::check_ca_installed;

pub async fn check_ca_and_install<R>(app: &tauri::AppHandle<R>) -> bool
where
    R: tauri::Runtime,
{
    #[cfg(target_os = "linux")]
    {
        if check_ca_installed(app).await {
            return true;
        }

        tracing::info!("CA certificate is not installed");
        if !add_store_sync(app).await {
            return false;
        }

        return check_ca_installed(app).await;
    }

    #[cfg(target_os = "windows")]
    {
        if check_ca_installed(app).await {
            return true;
        }

        tracing::info!("CA certificate is not installed");
        if !add_store_sync(app).await {
            return false;
        }

        return check_ca_installed(app).await;
    }
}

fn validate_custom_certificate_mode_settings() -> Result<(), String> {
    let proxy_configs = configs::get_user_configs_for_proxy();
    if proxy_configs.certificates.get_use_generated_certs() {
        return Ok(());
    }

    let cert_path = proxy_configs
        .certificates
        .get_cert_file()
        .ok_or("custom certificate mode requires certificates.cert_file")?;
    let key_path = proxy_configs
        .certificates
        .get_key_file()
        .ok_or("custom certificate mode requires certificates.key_file")?;

    tracing::info!(
        cert_path = %cert_path.display(),
        key_path = %key_path.display(),
        "validating custom certificate mode file paths"
    );

    if !Path::new(&cert_path).exists() {
        return Err(format!(
            "custom certificate file does not exist: {}",
            cert_path.display()
        ));
    }
    if !Path::new(&key_path).exists() {
        return Err(format!(
            "custom key file does not exist: {}",
            key_path.display()
        ));
    }

    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub async fn serve_proxy<R>(
    proxy_target: String,
    save_path: String,
    asset_sync_save_path: String,
    pac_path: String,
    ca_path: String,
    app: &tauri::AppHandle<R>,
    file_prefix: Option<String>,
    auth_manager: Arc<Mutex<AuthManager<FileStorage>>>,
) -> Result<(Url, tokio::task::JoinHandle<()>), Box<dyn std::error::Error>>
where
    R: tauri::Runtime,
{
    let proxy_bidirectional_channel_slave: Slave<StatusInfo> =
        get_proxy_bidirectional_channel().clone_slave();
    let proxy_log_bidirectional_channel_master: Master<StatusInfo> =
        get_proxy_log_bidirectional_channel().clone_master();
    let pac_bidirectional_channel_slave: Slave<StatusInfo> =
        get_pac_bidirectional_channel().clone_slave();

    let proxy_configs = configs::get_user_configs_for_proxy();
    let use_generated_certs = proxy_configs.certificates.get_use_generated_certs();

    if use_generated_certs {
        let ca_check_result = proxy_https::proxy_server_https::check_ca(ca_path.clone());

        if ca_check_result {
            tracing::info!("Generated CA certificate already exists");
            if !check_ca_and_install(app).await {
                return Err("Failed to install or verify generated CA certificate".into());
            }
        } else {
            tracing::info!("Generated CA certificate does not exist, creating...");
            proxy_https::proxy_server_https::create_ca(ca_path.clone());
            if !check_ca_and_install(app).await {
                return Err("Failed to install or verify generated CA certificate".into());
            }
        }
    } else {
        if let Err(err) = validate_custom_certificate_mode_settings() {
            tracing::warn!("custom certificate preflight failed: {}", err);
            return Err(err.into());
        }
        tracing::info!("Custom CA mode is enabled by settings; skipping generated CA create/check");
        if !check_ca_and_install(app).await {
            return Err("Failed to install or verify custom CA certificate".into());
        }
    }

    // start proxy server
    // let save_path = "./../../FUSOU-PROXY-DATA".to_string();
    // let proxy_addr = proxy::proxy_server_http::serve_proxy(proxy_target, 0, proxy_bidirectional_channel_slave, proxy_log_bidirectional_channel_master, save_path);

    let auth_manager_for_proxy = {
        let guard = auth_manager.lock().unwrap_or_else(|e| e.into_inner());
        Arc::new(guard.clone())
    };

    let (proxy_addr, proxy_handle) = proxy_https::proxy_server_https::serve_proxy_with_handle(
        0,
        proxy_bidirectional_channel_slave,
        proxy_log_bidirectional_channel_master,
        save_path,
        asset_sync_save_path,
        ca_path,
        file_prefix.unwrap_or("".to_string()),
        auth_manager_for_proxy,
    )
    .map_err(|err| format!("Failed to start proxy server: {err}"))?;

    let existing_pac_addr = { *pac_server_addr().lock().unwrap_or_else(|e| e.into_inner()) };
    let pac_socket = match existing_pac_addr {
        Some(addr) => addr,
        None => {
            let (addr, pac_handle) = match proxy_https::pac_server::serve_pac_file_with_handle(
                pac_path.clone(),
                0,
                pac_bidirectional_channel_slave,
            )
            .map_err(|err| format!("Failed to start pac server: {err}"))
            {
                Ok(started) => started,
                Err(msg) => {
                    shutdown_proxy_after_partial_failure(proxy_handle).await;
                    return Err(msg.into());
                }
            };
            {
                let mut guard = pac_server_addr().lock().unwrap_or_else(|e| e.into_inner());
                *guard = Some(addr);
            }
            tokio::spawn(async move {
                let _reset_guard = PacAddrResetGuard;
                let _ = pac_handle.await;
            });
            addr
        }
    };

    let host = if proxy_target.is_empty() {
        None
    } else {
        Some(proxy_target.as_str())
    };
    let proxy_addr_string = proxy_addr.to_string();
    edit_pac(pac_path.as_str(), proxy_addr_string.as_str(), host);

    native_cmd::add_pac(
        format!("http://localhost:{}/proxy.pac", pac_socket.port()),
        app,
    );

    let proxy_url = match Url::parse(&format!("http://{proxy_addr_string}")) {
        Ok(url) => url,
        Err(_) => {
            shutdown_proxy_after_partial_failure(proxy_handle).await;
            return Err("Failed to parse proxy URL".into());
        }
    };
    Ok((proxy_url, proxy_handle))
}
