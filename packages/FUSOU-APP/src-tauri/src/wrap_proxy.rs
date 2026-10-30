// use proxy::bidirectional_channel::{Master, Slave, StatusInfo};
#[cfg(feature = "tlsn-production")]
use crate::tlsn_runtime_config_manifest::{
    RuntimeConfigManifestError, RuntimeConfigWorkerInput, VerifiedRuntimeConfigManifest,
};
#[cfg(feature = "tlsn-production")]
use crate::tlsn_runtime_config_runtime::RuntimeConfigManager;
#[cfg(feature = "tlsn-production")]
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use proxy_https::{
    bidirectional_channel::{Master, Slave, StatusInfo},
    edit_pac::edit_pac,
};
#[cfg(feature = "tlsn-production")]
use proxy_https::{
    experimental_tlsn::{
        AttestationBindingProvider, BindingError, BindingFuture, BindingRequestContext,
        SerializedOriginRequest, TlsnTransportError, TlsnTransportFuture,
    },
    production_tlsn::{
        Alpha15OriginTransportFactory, AppPublicConfigurationFingerprints,
        FilesystemPresentationArtifactSink, HandoffPresentationProvider, OriginTarget,
        OriginTlsConfig, OriginTransportConfig, ProductionTlsnDependencies, RuntimeIdentifiers,
        ServerIdentityPolicy, WorkerHealthObservation,
    },
    real_tlsn::{
        FilesystemResultDelivery, RealAlpha15OriginTransportFactory, RemoteSessionBindingProvider,
        RemoteWorkerResultSigner, RemoteWorkerResultStore, RemoteWorkerVerificationBackend,
        ResultSignatureVerifier,
    },
};
#[cfg(feature = "tlsn-production")]
use std::{future::Future, pin::Pin};
#[cfg(feature = "tlsn-production")]
use tauri::Manager;
use tauri::Url;

#[cfg(feature = "tlsn-production")]
use crate::util::get_ROAMING_DIR;
use crate::{
    builder_setup::bidirectional_channel::{
        get_pac_bidirectional_channel, get_proxy_bidirectional_channel,
        get_proxy_log_bidirectional_channel,
    },
    cmd::native_cmd::{self, add_store_sync},
};

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
type RuntimeConfigRefreshFuture<'a> =
    Pin<Box<dyn Future<Output = Result<String, RuntimeConfigManifestError>> + Send + 'a>>;

#[cfg(feature = "tlsn-production")]
trait RuntimeConfigRevalidator: Send + Sync {
    fn refresh_manifest_sha256(&self) -> RuntimeConfigRefreshFuture<'_>;
}

#[cfg(feature = "tlsn-production")]
impl RuntimeConfigRevalidator for RuntimeConfigManager {
    fn refresh_manifest_sha256(&self) -> RuntimeConfigRefreshFuture<'_> {
        Box::pin(async move { Ok(self.refresh().await?.manifest_sha256().to_owned()) })
    }
}

#[cfg(feature = "tlsn-production")]
#[derive(Debug, Clone, Copy)]
enum RuntimeConfigGateFailure {
    Unavailable,
    Changed,
}

#[cfg(feature = "tlsn-production")]
async fn verify_runtime_config_unchanged(
    manager: &dyn RuntimeConfigRevalidator,
    expected_manifest_sha256: &str,
) -> Result<(), RuntimeConfigGateFailure> {
    let current_digest = manager.refresh_manifest_sha256().await.map_err(|error| {
        tracing::warn!(
            error = %error,
            "Runtime Config revalidation failed before TLSN processing"
        );
        RuntimeConfigGateFailure::Unavailable
    })?;
    if current_digest != expected_manifest_sha256 {
        tracing::warn!(
            "Runtime Config changed after proxy initialization; refusing TLSN processing"
        );
        return Err(RuntimeConfigGateFailure::Changed);
    }
    Ok(())
}

#[cfg(feature = "tlsn-production")]
struct RuntimeConfigGuardedBindingProvider {
    manager: Arc<dyn RuntimeConfigRevalidator>,
    expected_manifest_sha256: String,
    inner: Arc<dyn AttestationBindingProvider>,
}

#[cfg(feature = "tlsn-production")]
impl AttestationBindingProvider for RuntimeConfigGuardedBindingProvider {
    fn issue_binding(&self, context: BindingRequestContext) -> BindingFuture {
        let manager = Arc::clone(&self.manager);
        let expected_manifest_sha256 = self.expected_manifest_sha256.clone();
        let inner = Arc::clone(&self.inner);
        Box::pin(async move {
            verify_runtime_config_unchanged(manager.as_ref(), &expected_manifest_sha256)
                .await
                .map_err(|failure| match failure {
                    RuntimeConfigGateFailure::Unavailable => BindingError::RuntimeConfigUnavailable,
                    RuntimeConfigGateFailure::Changed => BindingError::RuntimeConfigChanged,
                })?;
            inner.issue_binding(context).await
        })
    }
}

#[cfg(feature = "tlsn-production")]
struct RuntimeConfigGuardedOriginTransportFactory {
    manager: Arc<dyn RuntimeConfigRevalidator>,
    expected_manifest_sha256: String,
    inner: Arc<dyn Alpha15OriginTransportFactory>,
}

#[cfg(feature = "tlsn-production")]
impl RuntimeConfigGuardedOriginTransportFactory {
    fn send_revalidated(
        &self,
        config: OriginTransportConfig,
        request: SerializedOriginRequest,
        lifecycle: Option<proxy_https::exchange_lifecycle::ExchangeLifecycle>,
    ) -> TlsnTransportFuture {
        let manager = Arc::clone(&self.manager);
        let expected_manifest_sha256 = self.expected_manifest_sha256.clone();
        let inner = Arc::clone(&self.inner);
        Box::pin(async move {
            verify_runtime_config_unchanged(manager.as_ref(), &expected_manifest_sha256)
                .await
                .map_err(|failure| match failure {
                    RuntimeConfigGateFailure::Unavailable => {
                        TlsnTransportError::RuntimeConfigUnavailable
                    }
                    RuntimeConfigGateFailure::Changed => TlsnTransportError::RuntimeConfigChanged,
                })?;
            match lifecycle {
                Some(lifecycle) => {
                    inner
                        .send_once_with_lifecycle(config, request, lifecycle)
                        .await
                }
                None => inner.send_once(config, request).await,
            }
        })
    }
}

#[cfg(feature = "tlsn-production")]
impl Alpha15OriginTransportFactory for RuntimeConfigGuardedOriginTransportFactory {
    fn send_once(
        &self,
        config: OriginTransportConfig,
        request: SerializedOriginRequest,
    ) -> TlsnTransportFuture {
        self.send_revalidated(config, request, None)
    }

    fn send_once_with_lifecycle(
        &self,
        config: OriginTransportConfig,
        request: SerializedOriginRequest,
        lifecycle: proxy_https::exchange_lifecycle::ExchangeLifecycle,
    ) -> TlsnTransportFuture {
        self.send_revalidated(config, request, Some(lifecycle))
    }
}

#[cfg(feature = "tlsn-production")]
fn build_production_tlsn_dependencies(
    proxy_target: &str,
    artifact_root: &str,
    auth_manager: &AuthManager<FileStorage>,
    runtime_config: &VerifiedRuntimeConfigManifest,
    runtime_config_manager: Arc<dyn RuntimeConfigRevalidator>,
    worker_health_observation: WorkerHealthObservation,
    public_configuration_fingerprints: AppPublicConfigurationFingerprints,
) -> Result<ProductionTlsnDependencies, Box<dyn std::error::Error>> {
    let lifecycle_policy = crate::tlsn_preflight::explicit_exchange_policy()
        .map_err(production_configuration_error)?;
    let attestation_limit = crate::tlsn_preflight::explicit_notary_attestation_limit()
        .map_err(production_configuration_error)?;
    let proxy_configs = configs::get_user_configs_for_proxy();
    let selected_target = runtime_config
        .approved_target(proxy_target)
        .ok_or_else(|| {
            production_configuration_error(
                "selected TLSN Origin is not in the verified Target Approval",
            )
        })?;
    let server_identity = selected_target.server_identity().to_owned();
    let input = |name| runtime_config.worker_input(name).to_owned();
    let notary_endpoint = input(RuntimeConfigWorkerInput::NotaryEndpoint);
    let session_endpoint = input(RuntimeConfigWorkerInput::SessionAuthorityEndpoint);
    let verification_endpoint = input(RuntimeConfigWorkerInput::VerificationEndpoint);
    let session_authority_key_id = input(RuntimeConfigWorkerInput::SessionAuthorityKeyId);
    let session_authority_public_key =
        URL_SAFE_NO_PAD.decode(input(RuntimeConfigWorkerInput::SessionAuthorityPublicKey))?;
    let result_public_key_spki =
        URL_SAFE_NO_PAD.decode(input(RuntimeConfigWorkerInput::ResultPublicKeySpki))?;
    let result_signer_key_id = input(RuntimeConfigWorkerInput::ResultSignerKeyId);
    let result_signing_key_registry = input(RuntimeConfigWorkerInput::ResultSigningKeyRegistry);
    let disclosure_mode = runtime_config.payload().source.disclosure_mode.clone();
    if !matches!(disclosure_mode.as_str(), "complete" | "sparse") {
        return Err(production_configuration_error(
            "verified disclosure mode must be complete or sparse",
        ));
    }
    let artifact_root = std::path::PathBuf::from(artifact_root);
    let candidate_capture_enabled = proxy_configs.get_tlsn_candidate_capture_enabled();
    if artifact_root.as_os_str().is_empty() {
        return Err(production_configuration_error(
            "tlsn_artifact_output_path is required for the TLSN experiment",
        ));
    }
    let target = OriginTarget::new(
        server_identity.clone(),
        selected_target.port(),
        server_identity.clone(),
    )
    .map_err(production_configuration_error)?;
    let origin = OriginTransportConfig::new(
        target.clone(),
        OriginTlsConfig::new().map_err(production_configuration_error)?,
        ServerIdentityPolicy::from_shipped_inventory().map_err(production_configuration_error)?,
        true,
    );
    let handoff = proxy_https::production_tlsn::PresentationHandoff::new();
    let remote_binding_provider = std::sync::Arc::new(
        RemoteSessionBindingProvider::new(
            session_endpoint,
            auth_manager.clone(),
            get_ROAMING_DIR().join("fusou-auth-device-key.json"),
            session_authority_public_key,
            session_authority_key_id,
        )
        .map_err(production_configuration_error)?,
    );
    let binding_state = remote_binding_provider.state();
    let binding_provider: Arc<dyn AttestationBindingProvider> =
        Arc::new(RuntimeConfigGuardedBindingProvider {
            manager: Arc::clone(&runtime_config_manager),
            expected_manifest_sha256: runtime_config.manifest_sha256().to_owned(),
            inner: remote_binding_provider,
        });
    let real_transport_factory = std::sync::Arc::new(
        RealAlpha15OriginTransportFactory::new(
            notary_endpoint,
            std::sync::Arc::clone(&handoff),
            attestation_limit,
        )
        .map_err(production_configuration_error)?,
    );
    let transport_factory: Arc<dyn Alpha15OriginTransportFactory> =
        Arc::new(RuntimeConfigGuardedOriginTransportFactory {
            manager: runtime_config_manager,
            expected_manifest_sha256: runtime_config.manifest_sha256().to_owned(),
            inner: real_transport_factory,
        });
    let worker_results = RemoteWorkerResultStore::new();
    let result_verifier = std::sync::Arc::new(
        if disclosure_mode == "sparse" {
            ResultSignatureVerifier::new_sparse(
                result_public_key_spki,
                result_signer_key_id,
                result_signing_key_registry,
            )
        } else {
            ResultSignatureVerifier::new(
                result_public_key_spki,
                result_signer_key_id,
                result_signing_key_registry,
            )
        }
        .and_then(|verifier| {
            let pins = &runtime_config.payload().production_authority_pins;
            verifier.with_production_authority_pins(
                &pins.origin_inventory_sha256,
                &pins.target_approval_artifact_sha256,
            )
        })
        .map_err(production_configuration_error)?,
    );
    let verification_backend = std::sync::Arc::new(
        RemoteWorkerVerificationBackend::new(
            verification_endpoint,
            auth_manager.clone(),
            get_ROAMING_DIR().join("fusou-auth-device-key.json"),
            binding_state,
            std::sync::Arc::clone(&worker_results),
            result_verifier,
            proxy_configs.get_tlsn_response_mode(),
        )
        .map_err(production_configuration_error)?,
    );
    let result_signer = std::sync::Arc::new(
        RemoteWorkerResultSigner::new(worker_results, artifact_root.clone())
            .with_candidate_capture_enabled(candidate_capture_enabled)
            .with_runtime_config_materials(runtime_config.evidence_materials())
            .map_err(|_| production_configuration_error(
                "verified Runtime Config capture materials are missing or exceed their bound",
            ))?,
    );
    Ok(ProductionTlsnDependencies::new(
        origin,
        binding_provider,
        transport_factory,
        std::sync::Arc::new(HandoffPresentationProvider::new(std::sync::Arc::clone(
            &handoff,
        ))),
        verification_backend,
        result_signer,
        std::sync::Arc::new(FilesystemResultDelivery::new(artifact_root.join("results"))),
    )
    .with_lifecycle_policy(lifecycle_policy)
    .with_presentation_artifact_sink(std::sync::Arc::new(
        FilesystemPresentationArtifactSink::new(artifact_root)
            .with_enabled(candidate_capture_enabled),
    ))
    .with_identifiers(
        RuntimeIdentifiers::default()
            .with_worker_health_observation(worker_health_observation)
            .with_app_public_configuration_fingerprints(public_configuration_fingerprints),
    ))
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
    #[cfg(feature = "tlsn-production")]
    let mut public_configuration_fingerprints = None;
    #[cfg(feature = "tlsn-production")]
    let mut verified_runtime_config = None;
    #[cfg(feature = "tlsn-production")]
    let mut runtime_config_manager = None;

    if proxy_configs.get_tlsn_experiment_enabled() {
        #[cfg(feature = "tlsn-production")]
        {
            let manager = app
                .try_state::<RuntimeConfigManager>()
                .ok_or("Runtime Config manager is not registered")?
                .inner()
                .clone();
            let verified = manager
                .refresh()
                .await
                .map_err(|error| format!("TLSN Runtime Config verification failed: {error}"))?;
            let report =
                crate::tlsn_preflight::run_verified_runtime_preflight(&verified, &proxy_target);
            if !report.ready {
                return Err(report.failure_summary().into());
            }
            public_configuration_fingerprints = Some(report.public_configuration_fingerprints);
            verified_runtime_config = Some(verified);
            runtime_config_manager = Some(manager);
        }
        #[cfg(not(feature = "tlsn-production"))]
        {
            return Err(
                "TLSN experiment is enabled but the application was built without the tlsn-production feature"
                    .into(),
            );
        }
    }

    #[cfg(feature = "tlsn-production")]
    let runtime_identity = if let Some(config) = verified_runtime_config.as_ref() {
        let expected =
            crate::tlsn_runtime::ExpectedWorkerIdentity::from_verified_runtime_config(config);
        crate::tlsn_worker_identity::validate_disclosure_endpoint(
            &config.payload().source.disclosure_mode,
            expected.verification_endpoint,
        )?;
        Some(
            crate::tlsn_runtime::fetch_and_validate_health_observation(&expected)
                .await
                .map_err(|error| format!("TLSN Worker health observation failed: {error}"))?,
        )
    } else {
        None
    };

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
                return Err(
                    "Generated CA certificate verification failed after regeneration".into(),
                );
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
    let proxy_addr = if proxy_configs.get_tlsn_experiment_enabled() {
        #[cfg(feature = "tlsn-production")]
        {
            let artifact_root = proxy_configs
                .get_tlsn_artifact_output_path()
                .ok_or("tlsn_artifact_output_path is required for the TLSN experiment")?;
            let runtime_config = verified_runtime_config
                .as_ref()
                .ok_or("verified Runtime Config is required for the TLSN experiment")?;
            let manager = runtime_config_manager
                .clone()
                .ok_or("Runtime Config manager is required for the TLSN experiment")?;
            let dependencies = build_production_tlsn_dependencies(
                &proxy_target,
                &artifact_root,
                &auth_manager_for_proxy,
                runtime_config,
                Arc::new(manager),
                runtime_identity.ok_or("production Worker health observation is required")?,
                {
                    let fingerprints = public_configuration_fingerprints
                        .expect("TLSN preflight fingerprints are required");
                    AppPublicConfigurationFingerprints {
                        schema_version: fingerprints.schema_version,
                        scope: fingerprints.scope.to_owned(),
                        compile_time_sha256: fingerprints.compile_time_sha256,
                        runtime_sha256: fingerprints.runtime_sha256,
                        combined_sha256: fingerprints.combined_sha256,
                        candidate_binding_status: fingerprints.candidate_binding_status.to_owned(),
                    }
                },
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
            Err("TLSN experiment is enabled but the application was built without the tlsn-production feature".into())
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

#[cfg(all(test, feature = "tlsn-production"))]
mod runtime_config_transport_gate_tests {
    use super::*;
    use proxy_https::experimental_tlsn::AttestationBinding;
    use std::{
        collections::VecDeque,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Mutex as StdMutex,
        },
    };

    struct FakeRevalidator {
        results: StdMutex<VecDeque<Result<String, RuntimeConfigManifestError>>>,
    }

    impl RuntimeConfigRevalidator for FakeRevalidator {
        fn refresh_manifest_sha256(&self) -> RuntimeConfigRefreshFuture<'_> {
            let result = self.results.lock().unwrap().pop_front().unwrap();
            Box::pin(async move { result })
        }
    }

    struct CountingOriginFactory {
        calls: Arc<AtomicUsize>,
    }

    struct CountingBindingProvider {
        calls: Arc<AtomicUsize>,
    }

    impl AttestationBindingProvider for CountingBindingProvider {
        fn issue_binding(&self, _context: BindingRequestContext) -> BindingFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { AttestationBinding::new("test-binding".to_owned()) })
        }
    }

    impl Alpha15OriginTransportFactory for CountingOriginFactory {
        fn send_once(
            &self,
            _config: OriginTransportConfig,
            _request: SerializedOriginRequest,
        ) -> TlsnTransportFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Err(TlsnTransportError::Unavailable) })
        }

        fn send_once_with_lifecycle(
            &self,
            _config: OriginTransportConfig,
            _request: SerializedOriginRequest,
            lifecycle: proxy_https::exchange_lifecycle::ExchangeLifecycle,
        ) -> TlsnTransportFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move {
                Err(match lifecycle.check() {
                    Err(proxy_https::exchange_lifecycle::ExchangeStop::Cancelled) => {
                        TlsnTransportError::Cancelled
                    }
                    Err(proxy_https::exchange_lifecycle::ExchangeStop::Deadline) => {
                        TlsnTransportError::DeadlineExceeded
                    }
                    Ok(()) => TlsnTransportError::Unavailable,
                })
            })
        }
    }

    fn test_binding_provider(
        results: Vec<Result<String, RuntimeConfigManifestError>>,
        calls: Arc<AtomicUsize>,
    ) -> RuntimeConfigGuardedBindingProvider {
        RuntimeConfigGuardedBindingProvider {
            manager: Arc::new(FakeRevalidator {
                results: StdMutex::new(results.into()),
            }),
            expected_manifest_sha256: "A".repeat(43),
            inner: Arc::new(CountingBindingProvider { calls }),
        }
    }

    fn origin_config() -> OriginTransportConfig {
        let target = OriginTarget::new(
            "game.example.test".to_owned(),
            443,
            "game.example.test".to_owned(),
        )
        .unwrap();
        let tls = OriginTlsConfig::new().expect("test host must provide the platform trust store");
        let identity_policy =
            ServerIdentityPolicy::new(vec!["game.example.test".to_owned()]).unwrap();
        OriginTransportConfig::new(target, tls, identity_policy, true)
    }

    fn test_factory(
        results: Vec<Result<String, RuntimeConfigManifestError>>,
        calls: Arc<AtomicUsize>,
    ) -> RuntimeConfigGuardedOriginTransportFactory {
        RuntimeConfigGuardedOriginTransportFactory {
            manager: Arc::new(FakeRevalidator {
                results: StdMutex::new(results.into()),
            }),
            expected_manifest_sha256: "A".repeat(43),
            inner: Arc::new(CountingOriginFactory { calls }),
        }
    }

    #[tokio::test]
    async fn final_transport_gate_rejects_changed_or_unavailable_config_before_origin_call() {
        for (revalidation, expected) in [
            (Ok("B".repeat(43)), TlsnTransportError::RuntimeConfigChanged),
            (
                Err(RuntimeConfigManifestError::Invalid("test fetch failure")),
                TlsnTransportError::RuntimeConfigUnavailable,
            ),
        ] {
            let calls = Arc::new(AtomicUsize::new(0));
            let factory = test_factory(vec![revalidation], Arc::clone(&calls));
            let error = match factory
                .send_once(
                    origin_config(),
                    SerializedOriginRequest::new(b"GET / HTTP/1.1\r\n\r\n".as_slice().into())
                        .unwrap(),
                )
                .await
            {
                Ok(_) => panic!("revalidation failure must prevent origin transport"),
                Err(error) => error,
            };
            assert_eq!(error, expected);
            assert_eq!(calls.load(Ordering::SeqCst), 0);
        }
    }

    #[tokio::test]
    async fn unchanged_runtime_config_calls_origin_factory_once() {
        let calls = Arc::new(AtomicUsize::new(0));
        let factory = test_factory(vec![Ok("A".repeat(43))], Arc::clone(&calls));
        let result = factory
            .send_once(
                origin_config(),
                SerializedOriginRequest::new(b"GET / HTTP/1.1\r\n\r\n".as_slice().into()).unwrap(),
            )
            .await;

        assert!(matches!(result, Err(TlsnTransportError::Unavailable)));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn runtime_config_guard_forwards_the_same_cancellation_context() {
        let calls = Arc::new(AtomicUsize::new(0));
        let factory = test_factory(vec![Ok("A".repeat(43))], Arc::clone(&calls));
        let lifecycle = proxy_https::exchange_lifecycle::ExchangePolicy::from_millis(
            Some("1000"),
            Some("1000"),
        )
        .unwrap()
        .start()
        .unwrap();
        lifecycle.stop(proxy_https::exchange_lifecycle::ExchangeStop::Cancelled);
        let result = factory
            .send_once_with_lifecycle(
                origin_config(),
                SerializedOriginRequest::new(b"GET / HTTP/1.1\r\n\r\n".as_slice().into()).unwrap(),
                lifecycle,
            )
            .await;
        assert!(matches!(result, Err(TlsnTransportError::Cancelled)));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn lifecycle_aware_transport_cannot_bypass_runtime_config_revalidation() {
        let calls = Arc::new(AtomicUsize::new(0));
        let factory = test_factory(vec![Ok("B".repeat(43))], Arc::clone(&calls));
        let lifecycle = proxy_https::exchange_lifecycle::ExchangePolicy::from_millis(
            Some("1000"),
            Some("1000"),
        )
        .unwrap()
        .start()
        .unwrap();
        let result = factory
            .send_once_with_lifecycle(
                origin_config(),
                SerializedOriginRequest::new(b"GET / HTTP/1.1\r\n\r\n".as_slice().into()).unwrap(),
                lifecycle,
            )
            .await;
        assert!(matches!(
            result,
            Err(TlsnTransportError::RuntimeConfigChanged)
        ));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn binding_gate_rejects_changed_or_unavailable_config_before_issuing_binding() {
        for (revalidation, expected) in [
            (Ok("B".repeat(43)), BindingError::RuntimeConfigChanged),
            (
                Err(RuntimeConfigManifestError::Invalid("test fetch failure")),
                BindingError::RuntimeConfigUnavailable,
            ),
        ] {
            let calls = Arc::new(AtomicUsize::new(0));
            let provider = test_binding_provider(vec![revalidation], Arc::clone(&calls));
            let error = provider
                .issue_binding(BindingRequestContext::new(1, "game.example.test"))
                .await
                .unwrap_err();
            assert_eq!(error, expected);
            assert_eq!(calls.load(Ordering::SeqCst), 0);
        }
    }

    #[tokio::test]
    async fn unchanged_runtime_config_allows_binding_provider_once() {
        let calls = Arc::new(AtomicUsize::new(0));
        let provider = test_binding_provider(vec![Ok("A".repeat(43))], Arc::clone(&calls));
        let binding = provider
            .issue_binding(BindingRequestContext::new(1, "game.example.test"))
            .await
            .expect("unchanged Runtime Config should reach the binding provider");

        assert_eq!(binding.value(), "test-binding");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn manifest_change_after_binding_check_still_blocks_game_server_transport() {
        let calls = Arc::new(AtomicUsize::new(0));
        let manager = Arc::new(FakeRevalidator {
            results: StdMutex::new(vec![Ok("A".repeat(43)), Ok("B".repeat(43))].into()),
        });
        verify_runtime_config_unchanged(manager.as_ref(), &"A".repeat(43))
            .await
            .expect("initial binding-time revalidation should pass");
        let factory = RuntimeConfigGuardedOriginTransportFactory {
            manager,
            expected_manifest_sha256: "A".repeat(43),
            inner: Arc::new(CountingOriginFactory {
                calls: Arc::clone(&calls),
            }),
        };

        let error = match factory
            .send_once(
                origin_config(),
                SerializedOriginRequest::new(b"GET / HTTP/1.1\r\n\r\n".as_slice().into()).unwrap(),
            )
            .await
        {
            Ok(_) => panic!("changed Runtime Config must prevent origin transport"),
            Err(error) => error,
        };
        assert_eq!(error, TlsnTransportError::RuntimeConfigChanged);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }
}
