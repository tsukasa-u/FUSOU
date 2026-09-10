use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use url::Url;

const ED25519_SPKI_PREFIX: &[u8; 12] = b"\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00";

#[derive(Debug, Clone)]
pub struct TlsnPreflightConfig {
    pub production_enabled: bool,
    pub notary_endpoint: Option<String>,
    pub session_authority_endpoint: Option<String>,
    pub session_authority_key_id: Option<String>,
    pub session_authority_public_key: Option<String>,
    pub verification_endpoint: Option<String>,
    pub notary_verifying_key: Option<String>,
    pub origin_trust_roots: Vec<String>,
    pub server_identity: Option<String>,
    pub origin_port_configured: Option<i64>,
    pub artifact_output_path: Option<String>,
}

impl TlsnPreflightConfig {
    pub fn from_proxy(proxy: &configs::ConfigsProxy) -> Self {
        let raw = proxy.get_tlsn_config();
        Self {
            production_enabled: proxy.get_tlsn_production_enabled(),
            notary_endpoint: proxy.get_tlsn_notary_endpoint(),
            session_authority_endpoint: proxy.get_tlsn_session_authority_endpoint(),
            session_authority_key_id: proxy.get_tlsn_session_authority_key_id(),
            session_authority_public_key: proxy.get_tlsn_session_authority_public_key(),
            verification_endpoint: proxy.get_tlsn_verification_endpoint(),
            notary_verifying_key: proxy.get_tlsn_notary_verifying_key(),
            origin_trust_roots: proxy.get_tlsn_origin_trust_roots(),
            server_identity: proxy.get_tlsn_server_identity(),
            origin_port_configured: raw.origin_port,
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
    pub ready: bool,
    pub checks: Vec<PreflightCheck>,
}

impl TlsnPreflightReport {
    pub fn text(&self) -> String {
        let mut output = format!(
            "TLSN Production preflight\nfeature_enabled={}\nbuild_profile={}\nconfig_path={}\nready={}\n",
            self.feature_enabled, self.build_profile, self.config_path, self.ready
        );
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
        "tlsn_production_enabled",
        if config.production_enabled {
            PreflightStatus::Pass
        } else {
            PreflightStatus::Error
        },
        if config.production_enabled {
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
    check_notary_verifying_key(&mut checks, config.notary_verifying_key.as_deref());
    check_trust_roots(&mut checks, &config.origin_trust_roots);

    match config.server_identity.as_deref() {
        Some(value) if valid_server_identity(value) => push_check(
            &mut checks,
            "tlsn_server_identity",
            PreflightStatus::Pass,
            format!("present; length={}", value.trim().len()),
        ),
        Some(_) => push_check(
            &mut checks,
            "tlsn_server_identity",
            PreflightStatus::Error,
            "invalid or empty",
        ),
        None => push_check(
            &mut checks,
            "tlsn_server_identity",
            PreflightStatus::Error,
            "missing",
        ),
    }

    match config.origin_port_configured {
        Some(port) if (1..=65535).contains(&port) => push_check(
            &mut checks,
            "tlsn_origin_port",
            PreflightStatus::Pass,
            format!("explicit value valid; port={port}"),
        ),
        Some(port) => push_check(
            &mut checks,
            "tlsn_origin_port",
            PreflightStatus::Error,
            format!("explicit value invalid; range=1..=65535; supplied_type=i64; supplied_length={}", port.to_string().len()),
        ),
        None => push_check(
            &mut checks,
            "tlsn_origin_port",
            PreflightStatus::Warning,
            "not explicitly configured; existing getter fallback is 443",
        ),
    }

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
        ready,
        checks,
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

fn check_trust_roots(checks: &mut Vec<PreflightCheck>, values: &[String]) {
    if values.is_empty() {
        push_check(
            checks,
            "tlsn_origin_trust_roots",
            PreflightStatus::Error,
            "must contain at least one certificate",
        );
        return;
    }

    for (index, value) in values.iter().enumerate() {
        match decode_unpadded_base64(value).and_then(|bytes| validate_der_certificate(&bytes)) {
            Ok(()) => {}
            Err(detail) => {
                push_check(
                    checks,
                    "tlsn_origin_trust_roots",
                    PreflightStatus::Error,
                    format!("certificate index={index} invalid: {detail}"),
                );
                return;
            }
        }
    }

    push_check(
        checks,
        "tlsn_origin_trust_roots",
        PreflightStatus::Pass,
        format!("DER certificate parse succeeded; count={}", values.len()),
    );
}

fn validate_der_certificate(bytes: &[u8]) -> Result<(), &'static str> {
    rustls::RootCertStore::empty()
        .add(rustls::pki_types::CertificateDer::from(bytes.to_vec()))
        .map_err(|_| "invalid DER X.509 certificate")
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
    use rcgen::{BasicConstraints, CertificateParams, IsCa, KeyPair};
    use std::{fs, path::PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

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

        let mut root_params = CertificateParams::default();
        root_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        let root_key = KeyPair::generate().unwrap();
        let root_certificate = root_params.self_signed(&root_key).unwrap();

        let mut session_key = ED25519_SPKI_PREFIX.to_vec();
        session_key.extend_from_slice(&[7_u8; 32]);

        let notary_key = tlsn_attestation::signing::VerifyingKey {
            alg: tlsn_attestation::signing::KeyAlgId::K256,
            data: hex::decode("031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f").unwrap(),
        };

        Fixture {
            root,
            config: TlsnPreflightConfig {
                production_enabled: true,
                notary_endpoint: Some("notary.example.test:7047".to_owned()),
                session_authority_endpoint: Some(
                    "https://authority.example.test/attestation/session".to_owned(),
                ),
                session_authority_key_id: Some("authority-key-2026".to_owned()),
                session_authority_public_key: Some(URL_SAFE_NO_PAD.encode(session_key)),
                verification_endpoint: Some("https://worker.example.test/verify/tlsn".to_owned()),
                notary_verifying_key: Some(URL_SAFE_NO_PAD.encode(bincode::serialize(&notary_key).unwrap())),
                origin_trust_roots: vec![URL_SAFE_NO_PAD.encode(root_certificate.der())],
                server_identity: Some("game.example.test".to_owned()),
                origin_port_configured: Some(443),
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
    fn invalid_trust_root_der_fails() {
        let mut fixture = fixture();
        fixture.config.origin_trust_roots = vec![URL_SAFE_NO_PAD.encode(b"not a certificate")];
        assert_error(&run_preflight(&fixture.config, &fixture.config_path), "tlsn_origin_trust_roots");
    }

    #[test]
    fn empty_trust_roots_fails() {
        let mut fixture = fixture();
        fixture.config.origin_trust_roots.clear();
        assert_error(&run_preflight(&fixture.config, &fixture.config_path), "tlsn_origin_trust_roots");
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
    fn invalid_origin_port_fails_without_using_fallback() {
        let mut fixture = fixture();
        fixture.config.origin_port_configured = Some(65536);
        assert_error(&run_preflight(&fixture.config, &fixture.config_path), "tlsn_origin_port");
    }

    #[test]
    fn empty_server_identity_fails() {
        let mut fixture = fixture();
        fixture.config.server_identity = Some(" ".to_owned());
        assert_error(&run_preflight(&fixture.config, &fixture.config_path), "tlsn_server_identity");
    }

    #[test]
    fn production_disabled_fails() {
        let mut fixture = fixture();
        fixture.config.production_enabled = false;
        assert_error(&run_preflight(&fixture.config, &fixture.config_path), "tlsn_production_enabled");
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