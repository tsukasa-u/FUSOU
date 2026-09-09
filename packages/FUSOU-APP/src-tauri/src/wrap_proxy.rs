// use proxy::bidirectional_channel::{Master, Slave, StatusInfo};
use proxy_https::{
    bidirectional_channel::{Master, Slave, StatusInfo},
    edit_pac::edit_pac,
};
#[cfg(feature = "tlsn-production")]
use proxy_https::{
    production_tlsn::{
        FilesystemPresentationArtifactSink, HandoffPresentationProvider, OriginTarget,
        OriginTlsConfig, OriginTransportConfig, ProductionTlsnDependencies,
        ServerIdentityPolicy, RuntimeIdentifiers,
    },
    real_tlsn::{
        FilesystemResultDelivery, RealAlpha15DedicatedVerifier,
        RealAlpha15OriginTransportFactory, RemoteSessionBindingProvider,
        RemoteWorkerResultSigner,
    },
};
#[cfg(feature = "tlsn-production")]
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use tauri::Url;

use crate::{
    builder_setup::bidirectional_channel::{
        get_pac_bidirectional_channel, get_proxy_bidirectional_channel,
        get_proxy_log_bidirectional_channel,
    },
    cmd::native_cmd::{self, add_store_sync},
};
#[cfg(feature = "tlsn-production")]
use crate::util::get_ROAMING_DIR;

use fusou_auth::{AuthManager, FileStorage};
use std::path::Path;
use std::sync::{Arc, Mutex};

#[cfg(target_os = "linux")]
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
        return add_store_sync(app).await;
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

#[cfg(feature = "tlsn-production")]
fn production_configuration_error(error: impl std::fmt::Display) -> Box<dyn std::error::Error> {
    std::io::Error::new(std::io::ErrorKind::InvalidInput, error.to_string()).into()
}

#[cfg(feature = "tlsn-production")]
fn build_production_tlsn_dependencies(
    proxy_target: &str,
    artifact_root: &str,
    auth_manager: &AuthManager<FileStorage>,
) -> Result<ProductionTlsnDependencies, Box<dyn std::error::Error>> {
    let proxy_configs = configs::get_user_configs_for_proxy();
    let server_identity = proxy_configs
        .get_tlsn_server_identity()
        .ok_or_else(|| production_configuration_error("tlsn_server_identity is required for production TLSN"))?;
    let notary_endpoint = proxy_configs
        .get_tlsn_notary_endpoint()
        .ok_or_else(|| production_configuration_error("tlsn_notary_endpoint is required for production TLSN"))?;
    let session_endpoint = proxy_configs
        .get_tlsn_session_authority_endpoint()
        .ok_or_else(|| production_configuration_error("tlsn_session_authority_endpoint is required for production TLSN"))?;
    let verification_endpoint = proxy_configs
        .get_tlsn_verification_endpoint()
        .ok_or_else(|| production_configuration_error("tlsn_verification_endpoint is required for production TLSN"))?;
    let session_authority_key_id = proxy_configs
        .get_tlsn_session_authority_key_id()
        .ok_or_else(|| production_configuration_error("tlsn_session_authority_key_id is required for production TLSN"))?;
    let session_authority_public_key = URL_SAFE_NO_PAD
        .decode(proxy_configs.get_tlsn_session_authority_public_key().ok_or_else(|| {
            production_configuration_error(
                "tlsn_session_authority_public_key is required for production TLSN",
            )
        })?)?;
    let notary_key = URL_SAFE_NO_PAD.decode(
        proxy_configs
            .get_tlsn_notary_verifying_key()
            .ok_or_else(|| production_configuration_error("tlsn_notary_verifying_key is required for production TLSN"))?,
    )?;
    let trusted_roots = proxy_configs
        .get_tlsn_origin_trust_roots()
        .into_iter()
        .map(|root| URL_SAFE_NO_PAD.decode(root).map_err(Into::into))
        .collect::<Result<Vec<_>, Box<dyn std::error::Error>>>()?;
    if trusted_roots.is_empty() {
        return Err(production_configuration_error(
            "tlsn_origin_trust_roots is required for production TLSN",
        ));
    }
    let artifact_root = std::path::PathBuf::from(artifact_root);
    if artifact_root.as_os_str().is_empty() {
        return Err(production_configuration_error(
            "tlsn_artifact_output_path is required for production TLSN",
        ));
    }
    let target = OriginTarget::new(
        proxy_target.to_owned(),
        proxy_configs.get_tlsn_origin_port(),
        server_identity.clone(),
    )
    .map_err(production_configuration_error)?;
    let origin = OriginTransportConfig::new(
        target.clone(),
        OriginTlsConfig::new(trusted_roots).map_err(production_configuration_error)?,
        ServerIdentityPolicy::new(vec![server_identity.clone()])
            .map_err(production_configuration_error)?,
        true,
    );
    let handoff = proxy_https::production_tlsn::PresentationHandoff::new();
    let binding_provider = std::sync::Arc::new(RemoteSessionBindingProvider::new(
        session_endpoint,
        auth_manager.clone(),
        get_ROAMING_DIR().join("fusou-auth-device-key.json"),
        session_authority_public_key,
        session_authority_key_id,
    )
    .map_err(production_configuration_error)?);
    let transport_factory = std::sync::Arc::new(RealAlpha15OriginTransportFactory::new(
        notary_endpoint,
        std::sync::Arc::clone(&handoff),
    )
    .map_err(production_configuration_error)?);
    let dedicated_verifier = std::sync::Arc::new(RealAlpha15DedicatedVerifier::new(
        server_identity,
        notary_key,
    )
    .map_err(production_configuration_error)?);
    let result_signer = std::sync::Arc::new(RemoteWorkerResultSigner::new(
        verification_endpoint,
        auth_manager.clone(),
        get_ROAMING_DIR().join("fusou-auth-device-key.json"),
        binding_provider.state(),
        std::sync::Arc::clone(&handoff),
    )
    .map_err(|_| production_configuration_error("invalid TLSN verification endpoint configuration"))?);
    Ok(ProductionTlsnDependencies::new(
        origin,
        binding_provider,
        transport_factory,
        std::sync::Arc::new(HandoffPresentationProvider::new(
            std::sync::Arc::clone(&handoff),
        )),
        dedicated_verifier,
        result_signer,
        std::sync::Arc::new(FilesystemResultDelivery::new(artifact_root.join("results"))),
    )
    .with_presentation_artifact_sink(std::sync::Arc::new(
        FilesystemPresentationArtifactSink::new(artifact_root),
    ))
    .with_identifiers(RuntimeIdentifiers::default()))
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
) -> Result<Url, Box<dyn std::error::Error>>
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
            if !add_store_sync(app).await {
                return Err("Failed to install regenerated CA certificate".into());
            }
            #[cfg(target_os = "linux")]
            if !check_ca_installed(app).await {
                return Err("Generated CA certificate verification failed after regeneration".into());
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

    let capture_runtime_metadata = Some(proxy_https::capture::CaptureRuntimeMetadata {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        game_client: "FUSOU-APP external WebView/browser".to_string(),
        allowlisted_game_server: proxy_target.clone(),
    });
    let proxy_addr = if proxy_configs.get_tlsn_production_enabled() {
        #[cfg(feature = "tlsn-production")]
        {
            let artifact_root = proxy_configs
                .get_tlsn_artifact_output_path()
                .ok_or("tlsn_artifact_output_path is required for production TLSN")?;
            let dependencies = build_production_tlsn_dependencies(
                &proxy_target,
                &artifact_root,
                &auth_manager_for_proxy,
            )?;
            proxy_https::proxy_server_https::serve_proxy_with_production_dependencies(
                0,
                proxy_bidirectional_channel_slave,
                proxy_log_bidirectional_channel_master,
                save_path,
                asset_sync_save_path,
                ca_path,
                file_prefix.unwrap_or_default(),
                auth_manager_for_proxy,
                capture_runtime_metadata,
                dependencies,
            )
        }
        #[cfg(not(feature = "tlsn-production"))]
        {
            Err("production TLSN is enabled but the application was built without the tlsn-production feature".into())
        }
    } else {
        proxy_https::proxy_server_https::serve_proxy(
            0,
            proxy_bidirectional_channel_slave,
            proxy_log_bidirectional_channel_master,
            save_path,
            asset_sync_save_path,
            ca_path,
            file_prefix.unwrap_or_default(),
            auth_manager_for_proxy,
            capture_runtime_metadata,
        )
    };

    if proxy_addr.is_err() {
        return Err("Failed to start proxy server".into());
    }

    // start pac server
    // let pac_addr = proxy::pac_server::serve_pac_file(pac_path.clone(), 0, pac_bidirectional_channel_slave);
    let pac_addr = proxy_https::pac_server::serve_pac_file(
        pac_path.clone(),
        0,
        pac_bidirectional_channel_slave,
    );

    if pac_addr.is_err() {
        return Err("Failed to start pac server".into());
    }

    // edit_pac(pac_path.as_str(), proxy_addr.unwrap().to_string().as_str());
    let host = if proxy_target.is_empty() {
        None
    } else {
        Some(proxy_target.as_str())
    };
    let proxy_addr_string = match proxy_addr {
        Ok(addr) => addr.to_string(),
        Err(_) => return Err("Failed to start proxy server".into()),
    };
    edit_pac(pac_path.as_str(), proxy_addr_string.clone().as_str(), host);

    if let Ok(pac_socket) = pac_addr {
        native_cmd::add_pac(
            format!("http://localhost:{}/proxy.pac", pac_socket.port()),
            app,
        );
    } else {
        return Err("Failed to start pac server".into());
    }

    let proxy_url = Url::parse(&format!("http://{proxy_addr_string}"))
        .map_err(|_| "Failed to parse proxy URL")?;
    return Ok(proxy_url);
}
