use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};
use url::Url;

#[cfg(feature = "tlsn-production")]
use proxy_https::real_tlsn::ResultSignatureVerifier;

const ED25519_SPKI_PREFIX: &[u8; 12] = b"\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00";
const APP_PUBLIC_CONFIGURATION_FINGERPRINT_CONTRACT: &str = include_str!(
    "../../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-configuration-fingerprint-contract-v2.json"
);

#[derive(Debug, Deserialize)]
struct AppConfigurationFingerprintContract {
    schema_version: u8,
    scope: String,
    canonicalization: String,
    digest_encoding: String,
    projection_fields: BTreeMap<String, Vec<String>>,
    projection_hash_preimage_fields: Vec<String>,
    combined_hash_preimage_fields: Vec<String>,
    test_vector: AppConfigurationFingerprintTestVector,
}

#[derive(Debug, Deserialize)]
struct AppConfigurationFingerprintTestVector {
    compile_time_fields: BTreeMap<String, serde_json::Value>,
    runtime_fields: BTreeMap<String, serde_json::Value>,
    compile_time_sha256: String,
    runtime_sha256: String,
    combined_sha256: String,
}

fn app_configuration_fingerprint_contract() -> &'static AppConfigurationFingerprintContract {
    static CONTRACT: OnceLock<AppConfigurationFingerprintContract> = OnceLock::new();
    CONTRACT.get_or_init(|| {
        serde_json::from_str(APP_PUBLIC_CONFIGURATION_FINGERPRINT_CONTRACT)
            .expect("shared APP configuration fingerprint contract must be valid")
    })
}

#[derive(Debug, Clone)]
pub struct TlsnPreflightConfig {
    pub experiment_enabled: bool,
    pub candidate_capture_enabled: bool,
    pub notary_endpoint: Option<String>,
    pub session_authority_endpoint: Option<String>,
    pub session_authority_key_id: Option<String>,
    pub session_authority_public_key: Option<String>,
    pub result_public_key_spki: Option<String>,
    pub result_signer_key_id: Option<String>,
    pub result_signing_key_registry: Option<String>,
    pub verification_endpoint: Option<String>,
    pub worker_health_endpoint: Option<String>,
    pub expected_deployment_id: Option<String>,
    pub expected_worker_name: Option<String>,
    pub expected_git_commit_sha: Option<String>,
    pub expected_binding_mode: String,
    pub expected_active_version_id: Option<String>,
    pub disclosure_mode: String,
    pub response_mode: String,
    pub notary_verifying_key: Option<String>,
    pub artifact_output_path: Option<String>,
}

impl TlsnPreflightConfig {
    pub fn from_proxy(proxy: &configs::ConfigsProxy) -> Self {
        Self {
            experiment_enabled: proxy.get_tlsn_experiment_enabled(),
            candidate_capture_enabled: proxy.get_tlsn_candidate_capture_enabled(),
            notary_endpoint: proxy.get_tlsn_notary_endpoint(),
            session_authority_endpoint: proxy.get_tlsn_session_authority_endpoint(),
            session_authority_key_id: proxy.get_tlsn_session_authority_key_id(),
            session_authority_public_key: proxy.get_tlsn_session_authority_public_key(),
            result_public_key_spki: proxy.get_tlsn_result_public_key_spki(),
            result_signer_key_id: proxy.get_tlsn_result_signer_key_id(),
            result_signing_key_registry: proxy.get_tlsn_result_signing_key_registry(),
            verification_endpoint: proxy.get_tlsn_verification_endpoint(),
            worker_health_endpoint: proxy.get_tlsn_worker_health_endpoint(),
            expected_deployment_id: proxy.get_tlsn_expected_deployment_id(),
            expected_worker_name: proxy.get_tlsn_expected_worker_name(),
            expected_git_commit_sha: proxy.get_tlsn_expected_git_commit_sha(),
            expected_binding_mode: proxy.get_tlsn_expected_binding_mode(),
            expected_active_version_id: proxy.get_tlsn_expected_active_version_id(),
            disclosure_mode: proxy.get_tlsn_disclosure_mode(),
            response_mode: proxy.get_tlsn_response_mode(),
            notary_verifying_key: proxy.get_tlsn_notary_verifying_key(),
            artifact_output_path: proxy.get_tlsn_artifact_output_path(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PreflightStatus {
    Pass,
    Warning,
    Error,
}

impl std::fmt::Display for PreflightStatus {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Pass => "pass",
            Self::Warning => "warning",
            Self::Error => "error",
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PreflightCheck {
    pub name: String,
    pub status: PreflightStatus,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TlsnPreflightReport {
    pub feature_enabled: bool,
    pub build_profile: String,
    pub config_path: String,
    pub public_configuration_fingerprints: TlsnPublicConfigurationFingerprints,
    pub ready: bool,
    pub checks: Vec<PreflightCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TlsnPublicConfigurationFingerprints {
    pub schema_version: u8,
    pub scope: &'static str,
    pub compile_time_sha256: String,
    pub runtime_sha256: String,
    pub combined_sha256: String,
    pub candidate_binding_status: &'static str,
}

impl TlsnPreflightReport {
    pub fn text(&self) -> String {
        let mut output = format!(
            "TLSN experiment preflight\nfeature_enabled={}\nbuild_profile={}\nconfig_path={}\nready={}\n",
            self.feature_enabled, self.build_profile, self.config_path, self.ready
        );
        output.push_str(&format!(
            "public_configuration_fingerprints.scope={}\npublic_configuration_fingerprints.compile_time_sha256={}\npublic_configuration_fingerprints.runtime_sha256={}\npublic_configuration_fingerprints.combined_sha256={}\npublic_configuration_fingerprints.candidate_binding_status={}\n",
            self.public_configuration_fingerprints.scope,
            self.public_configuration_fingerprints.compile_time_sha256,
            self.public_configuration_fingerprints.runtime_sha256,
            self.public_configuration_fingerprints.combined_sha256,
            self.public_configuration_fingerprints.candidate_binding_status,
        ));
        for check in &self.checks {
            output.push_str(&format!(
                "[{}] {}: {}\n",
                check.status, check.name, check.detail
            ));
        }
        output
    }

    pub fn failure_summary(&self) -> String {
        self.checks
            .iter()
            .filter(|check| check.status == PreflightStatus::Error)
            .map(|check| format!("{}: {}", check.name, check.detail))
            .collect::<Vec<_>>()
            .join("; ")
    }
}

pub fn run_loaded_config_preflight(config_path: &Path) -> TlsnPreflightReport {
    let proxy = configs::get_user_configs_for_proxy();
    let config = TlsnPreflightConfig::from_proxy(&proxy);
    run_preflight(&config, config_path)
}

pub fn run_current_config_preflight() -> TlsnPreflightReport {
    let config_path = crate::util::get_ROAMING_DIR().join("user").join("configs.toml");
    run_loaded_config_preflight(&config_path)
}

pub fn run_preflight(config: &TlsnPreflightConfig, config_path: &Path) -> TlsnPreflightReport {
    let mut checks = Vec::new();
    let public_configuration_fingerprints = public_configuration_fingerprints(config);
    let feature_enabled = cfg!(feature = "tlsn-production");

    push_check(
        &mut checks,
        "compile_time_feature",
        if feature_enabled {
            PreflightStatus::Pass
        } else {
            PreflightStatus::Error
        },
        if feature_enabled {
            "tlsn-production feature is enabled in this binary"
        } else {
            "tlsn-production feature is disabled in this binary"
        },
    );

    push_check(
        &mut checks,
        "build_profile",
        PreflightStatus::Pass,
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
    );

    push_check(
        &mut checks,
        "config_source",
        if config_path.is_file() {
            PreflightStatus::Pass
        } else {
            PreflightStatus::Error
        },
        if config_path.is_file() {
            "loaded config file exists"
        } else {
            "loaded config file is missing"
        },
    );

    push_check(
        &mut checks,
        "tlsn_enabled",
        if config.experiment_enabled {
            PreflightStatus::Pass
        } else {
            PreflightStatus::Error
        },
        if config.experiment_enabled {
            "enabled"
        } else {
            "disabled"
        },
    );

    match config.notary_endpoint.as_deref() {
        Some(endpoint) => match validate_notary_endpoint(endpoint) {
            Ok(port) => push_check(
                &mut checks,
                "tlsn_notary_endpoint",
                PreflightStatus::Pass,
                format!("host:port syntax valid; port={port}; no connection attempted"),
            ),
            Err(detail) => push_check(
                &mut checks,
                "tlsn_notary_endpoint",
                PreflightStatus::Error,
                detail,
            ),
        },
        None => push_check(
            &mut checks,
            "tlsn_notary_endpoint",
            PreflightStatus::Error,
            "missing",
        ),
    }

    check_https_endpoint(
        &mut checks,
        "tlsn_session_authority_endpoint",
        config.session_authority_endpoint.as_deref(),
    );
    check_https_endpoint(
        &mut checks,
        "tlsn_verification_endpoint",
        config.verification_endpoint.as_deref(),
    );
    check_worker_health_endpoint(
        &mut checks,
        config.worker_health_endpoint.as_deref(),
    );
    check_expected_identity(
        &mut checks,
        config.expected_deployment_id.as_deref(),
        config.expected_worker_name.as_deref(),
        config.expected_git_commit_sha.as_deref(),
        &config.expected_binding_mode,
    );
    for (name, result) in [
        (
            "tlsn_expected_active_version_id",
            crate::tlsn_worker_identity::validate_active_version_pin(
                config.expected_active_version_id.as_deref().unwrap_or(""),
            ),
        ),
        (
            "tlsn_worker_endpoint_binding",
            crate::tlsn_worker_identity::validate_worker_endpoints(
                config.worker_health_endpoint.as_deref().unwrap_or(""),
                config.verification_endpoint.as_deref().unwrap_or(""),
            )
            .and_then(|()| {
                crate::tlsn_worker_identity::validate_disclosure_endpoint(
                    &config.disclosure_mode,
                    config.verification_endpoint.as_deref().unwrap_or(""),
                )
            }),
        ),
    ] {
        match result {
            Ok(()) => push_check(
                &mut checks,
                name,
                PreflightStatus::Pass,
                "independent pin valid",
            ),
            Err(detail) => push_check(&mut checks, name, PreflightStatus::Error, detail),
        }
    }
    let disclosure_mode_valid = matches!(config.disclosure_mode.as_str(), "complete" | "sparse");
    push_check(
        &mut checks,
        "tlsn_disclosure_mode",
        if disclosure_mode_valid {
            PreflightStatus::Pass
        } else {
            PreflightStatus::Error
        },
        if disclosure_mode_valid {
            config.disclosure_mode.as_str()
        } else {
            "must be complete or sparse"
        },
    );
    let response_mode_valid = matches!(config.response_mode.as_str(), "async" | "sync");
    push_check(
        &mut checks,
        "tlsn_response_mode",
        if response_mode_valid {
            PreflightStatus::Pass
        } else {
            PreflightStatus::Error
        },
        if response_mode_valid {
            config.response_mode.as_str()
        } else {
            "must be async or sync"
        },
    );
    if config.disclosure_mode == "sparse"
        && !config
            .verification_endpoint
            .as_deref()
            .is_some_and(|endpoint| {
                endpoint
                    .trim_end_matches('/')
                    .ends_with("/verify/tlsn/sparse")
            })
    {
        push_check(
            &mut checks,
            "tlsn_sparse_endpoint",
            PreflightStatus::Error,
            "sparse mode requires a verification endpoint ending in /verify/tlsn/sparse",
        );
    }

    match config.session_authority_key_id.as_deref() {
        Some(value) if !value.trim().is_empty() => push_check(
            &mut checks,
            "tlsn_session_authority_key_id",
            PreflightStatus::Pass,
            format!("present; length={}", value.trim().len()),
        ),
        _ => push_check(
            &mut checks,
            "tlsn_session_authority_key_id",
            PreflightStatus::Error,
            "missing or empty",
        ),
    }

    check_session_authority_public_key(
        &mut checks,
        config.session_authority_public_key.as_deref(),
    );
    match config.result_signer_key_id.as_deref() {
        Some(value) if !value.trim().is_empty() => push_check(
            &mut checks,
            "tlsn_result_signer_key_id",
            PreflightStatus::Pass,
            format!("present; length={}", value.trim().len()),
        ),
        _ => push_check(
            &mut checks,
            "tlsn_result_signer_key_id",
            PreflightStatus::Error,
            "missing or empty",
        ),
    }
    check_result_public_key(&mut checks, config.result_public_key_spki.as_deref());
    check_result_signing_registry(
        &mut checks,
        config.result_public_key_spki.as_deref(),
        config.result_signer_key_id.as_deref(),
        config.result_signing_key_registry.as_deref(),
    );
    check_notary_verifying_key(&mut checks, config.notary_verifying_key.as_deref());
    check_platform_trust_store(&mut checks);

    check_origin_inventory(&mut checks);

    match config.artifact_output_path.as_deref() {
        Some(value) => match validate_artifact_output_path(value) {
            Ok(detail) => push_check(
                &mut checks,
                "tlsn_artifact_output_path",
                PreflightStatus::Pass,
                detail,
            ),
            Err(detail) => push_check(
                &mut checks,
                "tlsn_artifact_output_path",
                PreflightStatus::Error,
                detail,
            ),
        },
        None => push_check(
            &mut checks,
            "tlsn_artifact_output_path",
            PreflightStatus::Error,
            "missing or empty",
        ),
    }

    let ready = checks
        .iter()
        .all(|check| check.status != PreflightStatus::Error);
    TlsnPreflightReport {
        feature_enabled,
        build_profile: if cfg!(debug_assertions) {
            "debug".to_owned()
        } else {
            "release".to_owned()
        },
        config_path: config_path.display().to_string(),
        public_configuration_fingerprints,
        ready,
        checks,
    }
}

fn public_configuration_fingerprints(
    config: &TlsnPreflightConfig,
) -> TlsnPublicConfigurationFingerprints {
    let contract = app_configuration_fingerprint_contract();
    let compile_time = compile_time_public_configuration_projection(config);
    let runtime = runtime_public_configuration_projection(config);
    let compile_time_sha256 = projection_sha256("compile_time", &compile_time);
    let runtime_sha256 = projection_sha256("runtime", &runtime);
    TlsnPublicConfigurationFingerprints {
        schema_version: contract.schema_version,
        scope: contract.scope.as_str(),
        compile_time_sha256: compile_time_sha256.clone(),
        runtime_sha256: runtime_sha256.clone(),
        combined_sha256: combined_configuration_sha256(
            contract.schema_version,
            &contract.scope,
            &compile_time_sha256,
            &runtime_sha256,
        ),
        candidate_binding_status: "UNBOUND",
    }
}

fn compile_time_public_configuration_projection(
    config: &TlsnPreflightConfig,
) -> BTreeMap<String, serde_json::Value> {
    select_contract_projection("compile_time", BTreeMap::from([
        (
            "expected_binding_mode".to_owned(),
            serde_json::json!(config.expected_binding_mode),
        ),
        (
            "expected_deployment_id".to_owned(),
            serde_json::json!(config.expected_deployment_id),
        ),
        (
            "expected_git_commit_sha".to_owned(),
            serde_json::json!(config.expected_git_commit_sha),
        ),
        (
            "expected_worker_name".to_owned(),
            serde_json::json!(config.expected_worker_name),
        ),
        (
            "notary_endpoint".to_owned(),
            serde_json::json!(config.notary_endpoint),
        ),
        (
            "notary_verifying_key".to_owned(),
            serde_json::json!(config.notary_verifying_key),
        ),
        (
            "result_public_key_spki".to_owned(),
            serde_json::json!(config.result_public_key_spki),
        ),
        (
            "result_signer_key_id".to_owned(),
            serde_json::json!(config.result_signer_key_id),
        ),
        (
            "result_signing_key_registry".to_owned(),
            serde_json::json!(config.result_signing_key_registry),
        ),
        (
            "worker_health_endpoint".to_owned(),
            serde_json::json!(config.worker_health_endpoint),
        ),
        (
            "session_authority_endpoint".to_owned(),
            serde_json::json!(config.session_authority_endpoint),
        ),
        (
            "session_authority_key_id".to_owned(),
            serde_json::json!(config.session_authority_key_id),
        ),
        (
            "session_authority_public_key".to_owned(),
            serde_json::json!(config.session_authority_public_key),
        ),
        (
            "verification_endpoint".to_owned(),
            serde_json::json!(config.verification_endpoint),
        ),
    ]))
}

fn runtime_public_configuration_projection(
    config: &TlsnPreflightConfig,
) -> BTreeMap<String, serde_json::Value> {
    select_contract_projection("runtime", BTreeMap::from([
        (
            "candidate_capture_enabled".to_owned(),
            serde_json::json!(config.candidate_capture_enabled),
        ),
        (
            "disclosure_mode".to_owned(),
            serde_json::json!(config.disclosure_mode),
        ),
        (
            "experiment_enabled".to_owned(),
            serde_json::json!(config.experiment_enabled),
        ),
        (
            "response_mode".to_owned(),
            serde_json::json!(config.response_mode),
        ),
    ]))
}

fn select_contract_projection(
    projection: &str,
    values: BTreeMap<String, serde_json::Value>,
) -> BTreeMap<String, serde_json::Value> {
    let fields = app_configuration_fingerprint_contract()
        .projection_fields
        .get(projection)
        .expect("projection must exist in shared APP configuration fingerprint contract");
    assert_eq!(values.len(), fields.len(), "projection field inventory drifted");
    fields
        .iter()
        .map(|field| {
            (
                field.clone(),
                values
                    .get(field)
                    .expect("shared projection field must map to an APP config value")
                    .clone(),
            )
        })
        .collect()
}

fn projection_sha256(projection: &str, fields: &impl Serialize) -> String {
    let contract = app_configuration_fingerprint_contract();
    let preimage = BTreeMap::from([
        ("fields".to_owned(), serde_json::to_value(fields).expect("projection serializes")),
        ("projection".to_owned(), serde_json::json!(projection)),
        (
            "schema_version".to_owned(),
            serde_json::json!(contract.schema_version),
        ),
        (
            "scope".to_owned(),
            serde_json::json!(contract.scope),
        ),
    ]);
    assert_eq!(
        preimage.keys().cloned().collect::<Vec<_>>(),
        contract.projection_hash_preimage_fields
    );
    canonical_sha256(&preimage)
}

fn combined_configuration_sha256(
    schema_version: u8,
    scope: &str,
    compile_time_sha256: &str,
    runtime_sha256: &str,
) -> String {
    let contract = app_configuration_fingerprint_contract();
    let preimage = BTreeMap::from([
        (
            "compile_time_sha256".to_owned(),
            serde_json::json!(compile_time_sha256),
        ),
        ("runtime_sha256".to_owned(), serde_json::json!(runtime_sha256)),
        ("schema_version".to_owned(), serde_json::json!(schema_version)),
        ("scope".to_owned(), serde_json::json!(scope)),
    ]);
    assert_eq!(
        preimage.keys().cloned().collect::<Vec<_>>(),
        contract.combined_hash_preimage_fields
    );
    canonical_sha256(&preimage)
}

pub(crate) fn canonical_sha256(value: &impl Serialize) -> String {
    let value = serde_json::to_value(value).expect("TLSN canonical value must serialize");
    let mut bytes = Vec::new();
    append_canonical_json(&value, &mut bytes);
    URL_SAFE_NO_PAD.encode(Sha256::digest(bytes))
}

fn append_canonical_json(value: &serde_json::Value, output: &mut Vec<u8>) {
    match value {
        serde_json::Value::Object(object) => {
            output.push(b'{');
            let mut entries = object.iter().collect::<Vec<_>>();
            entries.sort_unstable_by(|(left, _), (right, _)| left.cmp(right));
            for (index, (key, value)) in entries.into_iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                output.extend_from_slice(
                    &serde_json::to_vec(key).expect("JSON object key must serialize"),
                );
                output.push(b':');
                append_canonical_json(value, output);
            }
            output.push(b'}');
        }
        serde_json::Value::Array(values) => {
            output.push(b'[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                append_canonical_json(value, output);
            }
            output.push(b']');
        }
        _ => output.extend_from_slice(
            &serde_json::to_vec(value).expect("JSON scalar value must serialize"),
        ),
    }
}

fn push_check(
    checks: &mut Vec<PreflightCheck>,
    name: &str,
    status: PreflightStatus,
    detail: impl Into<String>,
) {
    checks.push(PreflightCheck {
        name: name.to_owned(),
        status,
        detail: detail.into(),
    });
}

fn validate_notary_endpoint(value: &str) -> Result<u16, &'static str> {
    let value = value.trim();
    if value.is_empty() {
        return Err("missing or empty");
    }
    if value != value.trim()
        || value.contains("://")
        || value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        return Err("must be a raw host:port value without a URL scheme or whitespace");
    }

    let (host, port) = if let Some(rest) = value.strip_prefix('[') {
        let (host, port) = rest
            .split_once("]:")
            .ok_or("IPv6 Notary endpoint must use [host]:port syntax")?;
        (host, port)
    } else {
        let mut parts = value.split(':');
        let host = parts.next().unwrap_or_default();
        let port = parts.next().ok_or("must use host:port syntax")?;
        if parts.next().is_some() {
            return Err("unbracketed IPv6 is not valid host:port syntax");
        }
        (host, port)
    };

    if host.is_empty()
        || host
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
        || host.contains(['/', '?', '#', '@'])
    {
        return Err("host component is invalid");
    }
    let port = port.parse::<u16>().map_err(|_| "port is not a valid u16")?;
    if port == 0 {
        return Err("port must be in range 1..=65535");
    }
    Ok(port)
}

fn check_https_endpoint(checks: &mut Vec<PreflightCheck>, name: &str, value: Option<&str>) {
    match value {
        Some(value) => match validate_https_endpoint(value) {
            Ok(()) => push_check(
                checks,
                name,
                PreflightStatus::Pass,
                "HTTPS URL syntax valid; no connection attempted",
            ),
            Err(detail) => push_check(checks, name, PreflightStatus::Error, detail),
        },
        None => push_check(checks, name, PreflightStatus::Error, "missing or empty"),
    }
}

fn validate_https_endpoint(value: &str) -> Result<(), &'static str> {
    let value = value.trim();
    if value.is_empty() || value != value.trim() {
        return Err("missing or contains surrounding whitespace");
    }
    let parsed = Url::parse(value).map_err(|_| "invalid URL syntax")?;
    if parsed.scheme() != "https" {
        return Err("URL scheme must be https");
    }
    if parsed.host_str().is_none() {
        return Err("HTTPS URL must contain a host");
    }
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() {
        return Err("HTTPS URL must not contain credentials or a fragment");
    }
    Ok(())
}

fn check_worker_health_endpoint(checks: &mut Vec<PreflightCheck>, value: Option<&str>) {
    match value {
        Some(value) => match validate_worker_health_endpoint(value) {
            Ok(()) => push_check(
                checks,
                "tlsn_worker_health_endpoint",
                PreflightStatus::Pass,
                "HTTPS /health URL syntax valid; no connection attempted",
            ),
            Err(detail) => push_check(
                checks,
                "tlsn_worker_health_endpoint",
                PreflightStatus::Error,
                detail,
            ),
        },
        None => push_check(
            checks,
            "tlsn_worker_health_endpoint",
            PreflightStatus::Error,
            "missing or empty",
        ),
    }
}

fn validate_worker_health_endpoint(value: &str) -> Result<(), &'static str> {
    validate_https_endpoint(value)?;
    let parsed = Url::parse(value).map_err(|_| "invalid URL syntax")?;
    if parsed.query().is_some() {
        return Err("Worker health URL must not contain a query");
    }
    if parsed.path() != "/health" {
        return Err("Worker health URL path must be /health");
    }
    Ok(())
}

fn check_expected_identity(
    checks: &mut Vec<PreflightCheck>,
    deployment_id: Option<&str>,
    worker_name: Option<&str>,
    git_commit_sha: Option<&str>,
    binding_mode: &str,
) {
    let deployment_valid = deployment_id.is_some_and(|value| !value.trim().is_empty());
    let worker_valid = worker_name.is_some_and(|value| !value.trim().is_empty());
    let sha_valid = git_commit_sha.is_some_and(|value| {
        value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
    });
    let binding_valid =
        crate::tlsn_worker_identity::WorkerRole::from_binding_mode(binding_mode).is_ok();
    let valid = deployment_valid && worker_valid && sha_valid && binding_valid;
    push_check(
        checks,
        "tlsn_expected_worker_identity",
        if valid {
            PreflightStatus::Pass
        } else {
            PreflightStatus::Error
        },
        if valid {
            "deployment ID, Worker name, Git SHA, and binding mode are pinned"
        } else {
            "requires non-empty deployment ID and Worker name, 40-hex Git SHA, and a strict Canary/fixed_canary or Production/random expectation"
        },
    );
}

fn decode_unpadded_base64(value: &str) -> Result<Vec<u8>, &'static str> {
    let value = value.trim();
    if value.is_empty() || value != value.trim() {
        return Err("missing or contains surrounding whitespace");
    }
    if value.contains('=') {
        return Err("must use unpadded base64url");
    }
    let decoded = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| "invalid unpadded base64url")?;
    if URL_SAFE_NO_PAD.encode(&decoded) != value {
        return Err("base64url is not canonical unpadded form");
    }
    Ok(decoded)
}

fn check_session_authority_public_key(checks: &mut Vec<PreflightCheck>, value: Option<&str>) {
    match value {
        Some(value) => match decode_unpadded_base64(value) {
            Ok(bytes) if bytes.len() == ED25519_SPKI_PREFIX.len() + 32 && bytes.starts_with(ED25519_SPKI_PREFIX) => {
                push_check(
                    checks,
                    "tlsn_session_authority_public_key",
                    PreflightStatus::Pass,
                    format!("base64url decoded; length={}; format=Ed25519-SPKI", bytes.len()),
                )
            }
            Ok(bytes) => push_check(
                checks,
                "tlsn_session_authority_public_key",
                PreflightStatus::Error,
                format!("base64url decoded but Ed25519-SPKI format is invalid; decoded_length={}", bytes.len()),
            ),
            Err(detail) => push_check(
                checks,
                "tlsn_session_authority_public_key",
                PreflightStatus::Error,
                detail,
            ),
        },
        None => push_check(
            checks,
            "tlsn_session_authority_public_key",
            PreflightStatus::Error,
            "missing",
        ),
    }
}

fn check_result_public_key(checks: &mut Vec<PreflightCheck>, value: Option<&str>) {
    match value {
        Some(value) => match decode_unpadded_base64(value) {
            Ok(bytes) if bytes.len() == ED25519_SPKI_PREFIX.len() + 32 && bytes.starts_with(ED25519_SPKI_PREFIX) => {
                push_check(
                    checks,
                    "tlsn_result_public_key_spki",
                    PreflightStatus::Pass,
                    format!("base64url decoded; length={}; format=Ed25519-SPKI", bytes.len()),
                )
            }
            Ok(bytes) => push_check(
                checks,
                "tlsn_result_public_key_spki",
                PreflightStatus::Error,
                format!("base64url decoded but Ed25519-SPKI format is invalid; decoded_length={}", bytes.len()),
            ),
            Err(detail) => push_check(
                checks,
                "tlsn_result_public_key_spki",
                PreflightStatus::Error,
                detail,
            ),
        },
        None => push_check(
            checks,
            "tlsn_result_public_key_spki",
            PreflightStatus::Error,
            "missing",
        ),
    }
}

#[cfg(feature = "tlsn-production")]
fn check_result_signing_registry(
    checks: &mut Vec<PreflightCheck>,
    public_key_spki: Option<&str>,
    signer_key_id: Option<&str>,
    registry: Option<&str>,
) {
    let valid = match (public_key_spki, signer_key_id, registry) {
        (Some(public_key_spki), Some(signer_key_id), Some(registry)) => {
            decode_unpadded_base64(public_key_spki)
                .ok()
                .and_then(|public_key| {
                    ResultSignatureVerifier::new(
                        public_key,
                        signer_key_id.to_owned(),
                        registry.to_owned(),
                    )
                    .ok()
                })
                .is_some()
        }
        _ => false,
    };
    push_check(
        checks,
        "tlsn_result_signing_key_registry",
        if valid {
            PreflightStatus::Pass
        } else {
            PreflightStatus::Error
        },
        if valid {
            "registry schema, active signer, validity window, and SPKI match are valid"
        } else {
            "registry is invalid or does not match the active result signer"
        },
    );
}

#[cfg(not(feature = "tlsn-production"))]
fn check_result_signing_registry(
    checks: &mut Vec<PreflightCheck>,
    _public_key_spki: Option<&str>,
    _signer_key_id: Option<&str>,
    _registry: Option<&str>,
) {
    push_check(
        checks,
        "tlsn_result_signing_key_registry",
        PreflightStatus::Error,
        "tlsn-production feature is disabled",
    );
}

fn check_notary_verifying_key(checks: &mut Vec<PreflightCheck>, value: Option<&str>) {
    match value {
        Some(value) => match decode_unpadded_base64(value) {
            Ok(bytes) => match validate_notary_key_bytes(&bytes) {
                Ok(()) => push_check(
                    checks,
                    "tlsn_notary_verifying_key",
                    PreflightStatus::Pass,
                    format!("base64url decoded; length={}; format=alpha15-bincode-VerifyingKey", bytes.len()),
                ),
                Err(detail) => push_check(
                    checks,
                    "tlsn_notary_verifying_key",
                    PreflightStatus::Error,
                    detail,
                ),
            },
            Err(detail) => push_check(
                checks,
                "tlsn_notary_verifying_key",
                PreflightStatus::Error,
                detail,
            ),
        },
        None => push_check(
            checks,
            "tlsn_notary_verifying_key",
            PreflightStatus::Error,
            "missing",
        ),
    }
}

#[cfg(feature = "tlsn-production")]
fn validate_notary_key_bytes(bytes: &[u8]) -> Result<(), &'static str> {
    let key: tlsn_attestation::signing::VerifyingKey =
        bincode::deserialize(bytes).map_err(|_| "decoded key is not an alpha.15 VerifyingKey")?;
    let canonical = bincode::serialize(&key).map_err(|_| "alpha.15 VerifyingKey serialization failed")?;
    if canonical != bytes {
        return Err("decoded key is not canonical alpha.15 VerifyingKey serialization");
    }
    Ok(())
}

#[cfg(not(feature = "tlsn-production"))]
fn validate_notary_key_bytes(_bytes: &[u8]) -> Result<(), &'static str> {
    Err("cannot validate alpha.15 Notary key format because tlsn-production is disabled")
}

fn check_platform_trust_store(checks: &mut Vec<PreflightCheck>) {
    match proxy_https::production_tlsn::OriginTlsConfig::new() {
        Ok(config) => {
            let mut roots = rustls::RootCertStore::empty();
            for certificate in config.trusted_root_certificates() {
                if roots
                    .add(rustls::pki_types::CertificateDer::from(certificate.clone()))
                    .is_err()
                {
                    push_check(
                        checks,
                        "tlsn_platform_trust_store",
                        PreflightStatus::Error,
                        "platform trust store contains an invalid certificate",
                    );
                    return;
                }
            }
            if roots.is_empty() {
                push_check(
                    checks,
                    "tlsn_platform_trust_store",
                    PreflightStatus::Error,
                    "platform trust store contains no usable certificates",
                );
                return;
            }
            push_check(
                checks,
                "tlsn_platform_trust_store",
                PreflightStatus::Pass,
                format!("native certificates loadable; count={}; target-specific Origin chain validation is not established", roots.len()),
            );
        }
        Err(_) => push_check(
            checks,
            "tlsn_platform_trust_store",
            PreflightStatus::Error,
            "platform TLS trust store is unavailable or invalid",
        ),
    }
}

fn valid_server_identity(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value == value.trim()
        && value
            .bytes()
            .all(|byte| !byte.is_ascii_control() && !byte.is_ascii_whitespace())
        && !value.contains(['/', '?', '#'])
}

fn check_origin_inventory(checks: &mut Vec<PreflightCheck>) {
    let inventory = configs::get_tlsn_origin_inventory();
    let mut indices = std::collections::HashSet::new();
    let mut identities = std::collections::HashSet::new();
    let valid = inventory.schema_version == 1
        && inventory.targets.len() == 20
        && inventory.targets.iter().all(|target| {
            target.port == 443
                && valid_server_identity(&target.server_identity)
                && indices.insert(target.server_index)
                && identities.insert(target.server_identity.to_ascii_lowercase())
        });
    if valid {
        push_check(
            checks,
            "tlsn_origin_inventory",
            PreflightStatus::Pass,
            "20 shipped Origin identities are unique on port 443; each request selects its target from this inventory",
        );
    } else {
        push_check(
            checks,
            "tlsn_origin_inventory",
            PreflightStatus::Error,
            "embedded inventory is malformed; expected 20 unique DNS identities on port 443",
        );
    }
}

fn validate_artifact_output_path(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value != value.trim() {
        return Err("missing or contains surrounding whitespace".to_owned());
    }

    let path = Path::new(value);
    if path.exists() {
        if !path.is_dir() {
            return Err("existing path is not a directory".to_owned());
        }
        check_directory_writable(path)?;
        return Ok("directory exists and temporary write/delete succeeded".to_owned());
    }

    let mut ancestor = path.parent().unwrap_or_else(|| Path::new("."));
    while !ancestor.exists() {
        let Some(parent) = ancestor.parent() else {
            return Err("artifact path has no existing parent directory".to_owned());
        };
        if parent == ancestor {
            return Err("artifact path has no existing parent directory".to_owned());
        }
        ancestor = parent;
    }
    if !ancestor.is_dir() {
        return Err("artifact path parent is not a directory".to_owned());
    }
    check_directory_writable(ancestor)?;
    Ok("directory does not exist; nearest existing parent is writable and runtime creation is possible".to_owned())
}

fn check_directory_writable(directory: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if fs::metadata(directory)
            .map_err(|_| "directory metadata is unavailable".to_owned())?
            .permissions()
            .mode()
            & 0o222
            == 0
        {
            return Err("directory permission bits do not allow writing".to_owned());
        }
    }
    #[cfg(windows)]
    if fs::metadata(directory)
        .map_err(|_| "directory metadata is unavailable".to_owned())?
        .permissions()
        .readonly()
    {
        return Err("directory is marked read-only".to_owned());
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "system clock is before Unix epoch".to_owned())?
        .as_nanos();
    let probe = directory.join(format!(
        ".fusou-tlsn-preflight-{}-{timestamp}",
        std::process::id()
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(|_| "temporary write probe failed".to_owned())?;
    file.write_all(b"preflight")
        .map_err(|_| "temporary write probe failed".to_owned())?;
    drop(file);
    fs::remove_file(&probe).map_err(|_| "temporary probe cleanup failed".to_owned())?;
    Ok(())
}

#[cfg(all(test, feature = "tlsn-production"))]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::{fs, path::PathBuf};

    static TEST_ID: AtomicU64 = AtomicU64::new(0);

    struct Fixture {
        root: PathBuf,
        config: TlsnPreflightConfig,
        config_path: PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn fixture() -> Fixture {
        let id = TEST_ID.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("fusou-tlsn-preflight-{id}"));
        fs::create_dir_all(&root).unwrap();
        let artifact = root.join("artifacts");
        fs::create_dir_all(&artifact).unwrap();
        let config_path = root.join("configs.toml");
        fs::write(&config_path, "[proxy]\n").unwrap();

        let mut session_key = ED25519_SPKI_PREFIX.to_vec();
        session_key.extend_from_slice(&[7_u8; 32]);
        let mut result_key = ED25519_SPKI_PREFIX.to_vec();
        result_key.extend_from_slice(&[8_u8; 32]);
        let result_key_base64 = URL_SAFE_NO_PAD.encode(&result_key);
        let result_registry = serde_json::json!({
            "schema_version": 1,
            "scope": "tlsn-result-signing-key-registry",
            "keys": [{
                "key_id": "result-signer-2026",
                "public_key_spki": result_key_base64,
                "status": "ACTIVE",
                "not_before": "2020-01-01T00:00:00.000Z",
                "not_after": null,
            }],
        });

        let notary_key = tlsn_attestation::signing::VerifyingKey {
            alg: tlsn_attestation::signing::KeyAlgId::K256,
            data: hex::decode("031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f").unwrap(),
        };

        Fixture {
            root,
            config: TlsnPreflightConfig {
                experiment_enabled: true,
                candidate_capture_enabled: false,
                disclosure_mode: "complete".to_owned(),
                response_mode: "async".to_owned(),
                notary_endpoint: Some("notary.example.test:7047".to_owned()),
                session_authority_endpoint: Some(
                    "https://authority.example.test/attestation/session".to_owned(),
                ),
                session_authority_key_id: Some("authority-key-2026".to_owned()),
                session_authority_public_key: Some(URL_SAFE_NO_PAD.encode(session_key)),
                result_public_key_spki: Some(URL_SAFE_NO_PAD.encode(result_key)),
                result_signer_key_id: Some("result-signer-2026".to_owned()),
                result_signing_key_registry: Some(result_registry.to_string()),
                verification_endpoint: Some("https://worker.example.test/verify/tlsn".to_owned()),
                worker_health_endpoint: Some("https://worker.example.test/health".to_owned()),
                expected_deployment_id: Some("canary-2026".to_owned()),
                expected_worker_name: Some("fusou-tlsn-verification-canary".to_owned()),
                expected_git_commit_sha: Some(
                    "0123456789abcdef0123456789abcdef01234567".to_owned(),
                ),
                expected_binding_mode: "fixed_canary".to_owned(),
                expected_active_version_id: Some("4b064508-1cdb-453c-826b-bdea36a8b1e5".to_owned()),
                notary_verifying_key: Some(
                    URL_SAFE_NO_PAD.encode(bincode::serialize(&notary_key).unwrap()),
                ),
                artifact_output_path: Some(artifact.to_string_lossy().into_owned()),
            },
            config_path,
        }
    }

    fn assert_error(report: &TlsnPreflightReport, name: &str) {
        assert_eq!(
            report
                .checks
                .iter()
                .find(|check| check.name == name)
                .map(|check| check.status),
            Some(PreflightStatus::Error),
            "expected {name} to fail: {}",
            report.text()
        );
    }

    #[test]
    fn valid_configuration_passes_offline_preflight() {
        let fixture = fixture();
        let report = run_preflight(&fixture.config, &fixture.config_path);
        assert!(report.feature_enabled);
        assert!(report.ready, "{}", report.text());
        assert_eq!(
            report.public_configuration_fingerprints.schema_version,
            app_configuration_fingerprint_contract().schema_version
        );
        assert_eq!(
            report
                .public_configuration_fingerprints
                .candidate_binding_status,
            "UNBOUND"
        );
    }

    #[test]
    fn production_configuration_requires_independent_version_and_endpoint_pins() {
        let mut fixture = fixture();
        fixture.config.expected_binding_mode = "random".to_owned();
        fixture.config.expected_deployment_id = Some("production-2026".to_owned());
        fixture.config.expected_worker_name = Some("fusou-tlsn-verification-production".to_owned());
        let report = run_preflight(&fixture.config, &fixture.config_path);
        assert!(report.ready, "{}", report.text());
        fixture.config.expected_binding_mode.clear();
        assert_error(
            &run_preflight(&fixture.config, &fixture.config_path),
            "tlsn_expected_worker_identity",
        );
        fixture.config.expected_binding_mode = "random".to_owned();
        fixture.config.expected_active_version_id = None;
        assert_error(
            &run_preflight(&fixture.config, &fixture.config_path),
            "tlsn_expected_active_version_id",
        );
        fixture.config.expected_active_version_id =
            Some("4b064508-1cdb-453c-826b-bdea36a8b1e5".to_owned());
        fixture.config.verification_endpoint =
            Some("https://different-worker.example.test/verify/tlsn".to_owned());
        assert_error(
            &run_preflight(&fixture.config, &fixture.config_path),
            "tlsn_worker_endpoint_binding",
        );
    }

    #[test]
    fn public_configuration_fingerprints_bind_compile_and_runtime_values_without_emitting_them() {
        let fixture = fixture();
        let baseline = public_configuration_fingerprints(&fixture.config);
        assert_eq!(baseline.schema_version, 2);
        assert_eq!(baseline.scope, app_configuration_fingerprint_contract().scope);
        let mut pin_rotation = fixture.config.clone();
        pin_rotation.expected_active_version_id =
            Some("5b064508-1cdb-453c-826b-bdea36a8b1e5".to_owned());
        assert_eq!(public_configuration_fingerprints(&pin_rotation), baseline);

        let compile_mutations: [(&str, fn(&mut TlsnPreflightConfig)); 14] = [
            ("expected_deployment_id", |config| {
                config.expected_deployment_id = Some("changed".to_owned())
            }),
            ("expected_worker_name", |config| {
                config.expected_worker_name = Some("changed".to_owned())
            }),
            ("expected_git_commit_sha", |config| {
                config.expected_git_commit_sha = Some("b".repeat(40))
            }),
            ("expected_binding_mode", |config| {
                config.expected_binding_mode = "changed".to_owned()
            }),
            ("worker_health_endpoint", |config| {
                config.worker_health_endpoint = Some("https://other.example.test/health".to_owned())
            }),
            ("verification_endpoint", |config| {
                config.verification_endpoint =
                    Some("https://other.example.test/verify/tlsn".to_owned())
            }),
            ("notary_endpoint", |config| {
                config.notary_endpoint = Some("other.example.test:7047".to_owned())
            }),
            ("notary_verifying_key", |config| {
                config.notary_verifying_key = Some("changed".to_owned())
            }),
            ("session_authority_endpoint", |config| {
                config.session_authority_endpoint =
                    Some("https://other.example.test/attestation/session".to_owned())
            }),
            ("session_authority_key_id", |config| {
                config.session_authority_key_id = Some("changed".to_owned())
            }),
            ("session_authority_public_key", |config| {
                config.session_authority_public_key = Some("changed".to_owned())
            }),
            ("result_public_key_spki", |config| {
                config.result_public_key_spki = Some("changed".to_owned())
            }),
            ("result_signer_key_id", |config| {
                config.result_signer_key_id = Some("changed".to_owned())
            }),
            ("result_signing_key_registry", |config| {
                config.result_signing_key_registry = Some("changed".to_owned())
            }),
        ];
        let compile_projection = compile_time_public_configuration_projection(&fixture.config);
        assert_eq!(
            compile_projection
                .keys()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>(),
            app_configuration_fingerprint_contract()
                .projection_fields
                .get("compile_time")
                .unwrap()
                .iter()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>()
        );
        for (field, mutate) in compile_mutations {
            let mut changed = fixture.config.clone();
            mutate(&mut changed);
            let fingerprints = public_configuration_fingerprints(&changed);
            assert_ne!(
                fingerprints.compile_time_sha256, baseline.compile_time_sha256,
                "{field}"
            );
            assert_eq!(
                fingerprints.runtime_sha256, baseline.runtime_sha256,
                "{field}"
            );
            assert_ne!(
                fingerprints.combined_sha256, baseline.combined_sha256,
                "{field}"
            );
        }

        let runtime_mutations: [(&str, fn(&mut TlsnPreflightConfig)); 4] = [
            ("experiment_enabled", |config| {
                config.experiment_enabled = !config.experiment_enabled
            }),
            ("candidate_capture_enabled", |config| {
                config.candidate_capture_enabled = !config.candidate_capture_enabled
            }),
            ("disclosure_mode", |config| {
                config.disclosure_mode = "sparse".to_owned()
            }),
            ("response_mode", |config| {
                config.response_mode = "sync".to_owned()
            }),
        ];
        let runtime_projection = runtime_public_configuration_projection(&fixture.config);
        assert_eq!(
            runtime_projection
                .keys()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>(),
            app_configuration_fingerprint_contract()
                .projection_fields
                .get("runtime")
                .unwrap()
                .iter()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>()
        );
        for (field, mutate) in runtime_mutations {
            let mut changed = fixture.config.clone();
            mutate(&mut changed);
            let fingerprints = public_configuration_fingerprints(&changed);
            assert_eq!(
                fingerprints.compile_time_sha256, baseline.compile_time_sha256,
                "{field}"
            );
            assert_ne!(
                fingerprints.runtime_sha256, baseline.runtime_sha256,
                "{field}"
            );
            assert_ne!(
                fingerprints.combined_sha256, baseline.combined_sha256,
                "{field}"
            );
        }

        let mut changed_output_path = fixture.config.clone();
        changed_output_path.artifact_output_path = Some("/private/other-output".to_owned());
        assert_eq!(
            public_configuration_fingerprints(&changed_output_path),
            baseline
        );

        let mut hidden_value = fixture.config.clone();
        let marker = "fingerprint-projection-value-must-not-be-emitted";
        hidden_value.expected_deployment_id = Some(marker.to_owned());
        hidden_value.expected_worker_name = Some(marker.to_owned());
        hidden_value.expected_git_commit_sha = Some(marker.to_owned());
        hidden_value.expected_binding_mode = marker.to_owned();
        hidden_value.worker_health_endpoint = Some(marker.to_owned());
        hidden_value.verification_endpoint = Some(marker.to_owned());
        hidden_value.notary_endpoint = Some(marker.to_owned());
        hidden_value.notary_verifying_key = Some(marker.to_owned());
        hidden_value.session_authority_endpoint = Some(marker.to_owned());
        hidden_value.session_authority_key_id = Some(marker.to_owned());
        hidden_value.session_authority_public_key = Some(marker.to_owned());
        hidden_value.result_public_key_spki = Some(marker.to_owned());
        hidden_value.result_signer_key_id = Some(marker.to_owned());
        hidden_value.result_signing_key_registry = Some(marker.to_owned());
        hidden_value.disclosure_mode = marker.to_owned();
        hidden_value.response_mode = marker.to_owned();
        let report = run_preflight(&hidden_value, &fixture.config_path);
        assert!(!report.text().contains(marker));
        assert!(!serde_json::to_string(&report)
            .expect("preflight report serializes")
            .contains(marker));
    }

    #[test]
    fn canonical_fingerprint_encoding_is_order_independent_and_domain_separated() {
        let first: serde_json::Value =
            serde_json::from_str(r#"{"z":1,"a":{"y":2,"b":3}}"#).unwrap();
        let reordered: serde_json::Value =
            serde_json::from_str(r#"{"a":{"b":3,"y":2},"z":1}"#).unwrap();
        assert_eq!(canonical_sha256(&first), canonical_sha256(&reordered));

        let contract = app_configuration_fingerprint_contract();
        let baseline =
            combined_configuration_sha256(contract.schema_version, &contract.scope, "compile", "runtime");
        assert_ne!(
            combined_configuration_sha256(3, &contract.scope, "compile", "runtime"),
            baseline
        );
        assert_ne!(
            combined_configuration_sha256(2, "another-scope", "compile", "runtime"),
            baseline
        );
    }

    #[test]
    fn fingerprint_contract_matches_the_shared_cross_language_test_vector() {
        let contract = app_configuration_fingerprint_contract();
        assert_eq!(contract.schema_version, 2);
        assert_eq!(contract.scope, "fusou-tlsn-app-public-configuration");
        assert_eq!(contract.canonicalization, "FUSOU-CANONICAL-JSON-V1");
        assert_eq!(contract.digest_encoding, "sha256-base64url-no-padding");
        let vector = &contract.test_vector;

        assert_eq!(
            projection_sha256("compile_time", &vector.compile_time_fields),
            vector.compile_time_sha256
        );
        assert_eq!(
            projection_sha256("runtime", &vector.runtime_fields),
            vector.runtime_sha256
        );
        assert_eq!(
            combined_configuration_sha256(
                contract.schema_version,
                &contract.scope,
                &vector.compile_time_sha256,
                &vector.runtime_sha256,
            ),
            vector.combined_sha256
        );
    }

    #[test]
    fn missing_worker_health_endpoint_fails() {
        let mut fixture = fixture();
        fixture.config.worker_health_endpoint = None;
        let report = run_preflight(&fixture.config, &fixture.config_path);
        assert_error(&report, "tlsn_worker_health_endpoint");
    }

    #[test]
    fn missing_notary_endpoint_fails() {
        let mut fixture = fixture();
        fixture.config.notary_endpoint = None;
        assert_error(&run_preflight(&fixture.config, &fixture.config_path), "tlsn_notary_endpoint");
    }

    #[test]
    fn url_notary_endpoint_fails() {
        let mut fixture = fixture();
        fixture.config.notary_endpoint = Some("http://notary.example.test:7047".to_owned());
        assert_error(&run_preflight(&fixture.config, &fixture.config_path), "tlsn_notary_endpoint");
    }

    #[test]
    fn invalid_notary_port_fails() {
        let mut fixture = fixture();
        fixture.config.notary_endpoint = Some("notary.example.test:0".to_owned());
        assert_error(&run_preflight(&fixture.config, &fixture.config_path), "tlsn_notary_endpoint");
    }

    #[test]
    fn http_service_endpoint_fails() {
        let mut fixture = fixture();
        fixture.config.session_authority_endpoint = Some("http://authority.example.test/session".to_owned());
        assert_error(
            &run_preflight(&fixture.config, &fixture.config_path),
            "tlsn_session_authority_endpoint",
        );
    }

    #[test]
    fn invalid_public_key_encoding_fails() {
        let mut fixture = fixture();
        fixture.config.session_authority_public_key = Some("not-base64".to_owned());
        assert_error(
            &run_preflight(&fixture.config, &fixture.config_path),
            "tlsn_session_authority_public_key",
        );
    }

    #[test]
    fn artifact_file_fails() {
        let mut fixture = fixture();
        let file = fixture.root.join("artifact-file");
        fs::write(&file, b"file").unwrap();
        fixture.config.artifact_output_path = Some(file.to_string_lossy().into_owned());
        assert_error(&run_preflight(&fixture.config, &fixture.config_path), "tlsn_artifact_output_path");
    }

    #[cfg(unix)]
    #[test]
    fn artifact_directory_without_write_permission_fails() {
        use std::os::unix::fs::PermissionsExt;

        let mut fixture = fixture();
        let directory = fixture.root.join("read-only-artifacts");
        fs::create_dir_all(&directory).unwrap();
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o555)).unwrap();
        fixture.config.artifact_output_path = Some(directory.to_string_lossy().into_owned());
        assert_error(&run_preflight(&fixture.config, &fixture.config_path), "tlsn_artifact_output_path");
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn origin_inventory_passes_preflight_without_a_fixed_identity() {
        let fixture = fixture();
        let report = run_preflight(&fixture.config, &fixture.config_path);
        assert_eq!(
            report.checks.iter().find(|check| check.name == "tlsn_origin_inventory").map(|check| check.status),
            Some(PreflightStatus::Pass),
            "{}",
            report.text()
        );
    }

    #[test]
    fn experiment_disabled_fails() {
        let mut fixture = fixture();
        fixture.config.experiment_enabled = false;
        assert_error(&run_preflight(&fixture.config, &fixture.config_path), "tlsn_enabled");
    }

    #[ignore = "invoked by the offline Production trust-contract round-trip test"]
    #[test]
    fn generated_app_config_passes_offline_preflight() {
        let config_path = std::env::var_os("FUSOU_TLSN_ROUNDTRIP_CONFIG_PATH")
            .expect("FUSOU_TLSN_ROUNDTRIP_CONFIG_PATH must point to a generated APP config");
        let config_path = Path::new(&config_path);
        configs::set_user_config(config_path.to_str().expect("config path must be UTF-8")).unwrap();
        let configs = configs::get_user_configs();
        let config = TlsnPreflightConfig::from_proxy(&configs.proxy);
        let report = run_preflight(&config, config_path);
        assert!(report.ready, "{}", report.text());
    }
}
