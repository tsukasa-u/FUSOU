pub mod environment_check;
pub mod fingerprint;
pub mod secure_enclave_macos;
pub mod tpm_linux;
pub mod tpm_windows;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde_json::json;

#[cfg(any(target_os = "windows", target_os = "linux"))]
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(any(target_os = "windows", target_os = "linux"))]
use rcgen::{
    CertificateParams,
    CertificateRevocationListParams,
    CrlDistributionPoint,
    DnType,
    ExtendedKeyUsagePurpose,
    IsCa,
    KeyIdMethod,
    KeyPair,
    KeyUsagePurpose,
    SerialNumber,
    SubjectPublicKeyInfo,
};

#[cfg(any(target_os = "windows", target_os = "linux"))]
use time::{Duration as TimeDuration, OffsetDateTime};

const TPM_AK_PERSISTENT_HANDLE_ENV: &str = "FUSOU_TPM_AK_PERSISTENT_HANDLE";
const TPM_AK_CERT_CHAIN_B64_ENV: &str = "FUSOU_TPM_AK_CERT_CHAIN_B64";
const TPM_AK_AUTO_CA_CERT_PEM_NAME: &str = "fusou_ca_cert.pem";
const TPM_AK_AUTO_CA_KEY_PEM_NAME: &str = "fusou_ca_key.pem";
const TPM_AK_CERT_COMMON_NAME: &str = "FUSOU TPM AK";
const TPM_AK_CERT_ORGANIZATION_NAME: &str = "FUSOU";
const TPM_AK_EKU_OID: &[u64] = &[2, 23, 133, 8, 3];

#[cfg(any(target_os = "windows", target_os = "linux"))]
static AUTO_TPM_AK_CHAIN_WARNED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone)]
pub struct AttestationPreflightWarning {
    pub code: &'static str,
    pub message: String,
}

fn build_software_report() -> serde_json::Value {
    json!({
        "attestation_level": "software_fingerprint",
        "fingerprint": fingerprint::collect_fingerprint(),
        "environment": environment_check::detect_environment(),
    })
}

pub fn collect_attestation_report(nonce_hint: Option<&str>) -> serde_json::Value {
    let nonce = nonce_hint.unwrap_or_default().as_bytes();

    #[cfg(target_os = "windows")]
    if let Ok((attestation_data, attestation_signature, public_key)) =
        tpm_windows::collect_tpm_attestation(nonce)
    {
        let tpm_certificate_chain = resolve_tpm_ak_certificate_chain_b64(&public_key);
        let mut report = json!({
            "attestation_level": "tpm",
            "attestation_data": B64.encode(attestation_data),
            "attestation_signature": B64.encode(attestation_signature),
            "attestation_format": "tpm2_quote_rsassa_sha256_v1",
            "public_key": B64.encode(public_key),
            "fingerprint": fingerprint::collect_fingerprint(),
            "environment": environment_check::detect_environment(),
        });
        if !tpm_certificate_chain.is_empty() {
            report["certificate_chain"] = json!(tpm_certificate_chain);
        }
        return report;
    }

    #[cfg(target_os = "linux")]
    if let Ok((attestation_data, attestation_signature, public_key)) =
        tpm_linux::collect_tpm_attestation(nonce)
    {
        let tpm_certificate_chain = resolve_tpm_ak_certificate_chain_b64(&public_key);
        let mut report = json!({
            "attestation_level": "tpm",
            "attestation_data": B64.encode(attestation_data),
            "attestation_signature": B64.encode(attestation_signature),
            "attestation_format": "tpm2_quote_rsassa_sha256_v1",
            "public_key": B64.encode(public_key),
            "fingerprint": fingerprint::collect_fingerprint(),
            "environment": environment_check::detect_environment(),
        });
        if !tpm_certificate_chain.is_empty() {
            report["certificate_chain"] = json!(tpm_certificate_chain);
        }
        return report;
    }

    #[cfg(target_os = "macos")]
    if let Ok(attestation) = secure_enclave_macos::collect_enclave_attestation(nonce) {
        return json!({
            "attestation_level": "secure_enclave",
            "attestation_data": B64.encode(attestation.attestation_data),
            "attestation_signature": B64.encode(attestation.attestation_signature),
            "public_key": B64.encode(attestation.public_key),
            "certificate_chain": attestation
                .certificate_chain
                .iter()
                .map(|certificate| B64.encode(certificate))
                .collect::<Vec<String>>(),
            "attestation_format": attestation.attestation_format,
            "fingerprint": fingerprint::collect_fingerprint(),
            "environment": environment_check::detect_environment(),
        });
    }

    build_software_report()
}

pub fn collect_upload_attestation_report(nonce: &str) -> serde_json::Value {
    collect_attestation_report(Some(nonce))
}

pub fn runtime_preflight_warnings() -> Vec<AttestationPreflightWarning> {
    let mut warnings = Vec::new();

    #[cfg(target_os = "linux")]
    collect_linux_preflight_warnings(&mut warnings);

    #[cfg(target_os = "windows")]
    collect_windows_preflight_warnings(&mut warnings);

    #[cfg(target_os = "macos")]
    collect_macos_preflight_warnings(&mut warnings);

    warnings
}

#[cfg(target_os = "linux")]
fn collect_linux_preflight_warnings(warnings: &mut Vec<AttestationPreflightWarning>) {
    use std::fs::OpenOptions;
    use std::path::Path;
    use std::process::Command;

    let tpmrm_path = Path::new("/dev/tpmrm0");
    let tpm_path = Path::new("/dev/tpm0");
    let has_tpm_device = tpmrm_path.exists() || tpm_path.exists();
    let feature_enabled = cfg!(feature = "linux-tpm-attestation");

    if has_tpm_device && !feature_enabled {
        warnings.push(AttestationPreflightWarning {
            code: "linux_feature_disabled",
            message: "TPM device was detected, but this app build has linux-tpm-attestation disabled. Hardware attestation will be downgraded to software mode.".to_string(),
        });
    }

    if !feature_enabled {
        return;
    }

    if let Some(message) = validate_persistent_handle_env() {
        warnings.push(AttestationPreflightWarning {
            code: "linux_persistent_handle_invalid",
            message,
        });
    }

    if let Some(message) = validate_tpm_ak_cert_chain_env() {
        warnings.push(AttestationPreflightWarning {
            code: "linux_tpm_ak_cert_chain_invalid",
            message,
        });
    }

    if !has_explicit_tpm_ak_certificate_chain_env() {
        if let Some(message) = validate_auto_tpm_ak_chain_local_ca() {
            warnings.push(AttestationPreflightWarning {
                code: "linux_tpm_ak_cert_chain_auto_unavailable",
                message,
            });
        }
    }

    if has_tpm_device {
        let preferred = if tpmrm_path.exists() { tpmrm_path } else { tpm_path };
        let can_open = OpenOptions::new().read(true).write(true).open(preferred).is_ok();
        if !can_open {
            warnings.push(AttestationPreflightWarning {
                code: "linux_tpm_permission",
                message: format!(
                    "TPM device {} is present but cannot be opened read/write. Check device permissions (for example tss group membership).",
                    preferred.display()
                ),
            });
        }
    }

    let pkg_config_exists = Command::new("pkg-config")
        .arg("--version")
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !pkg_config_exists {
        warnings.push(AttestationPreflightWarning {
            code: "linux_pkg_config_missing",
            message: "pkg-config is not available; cannot verify tpm2-tss runtime dependencies automatically.".to_string(),
        });
        return;
    }

    let required = ["tss2-sys", "tss2-esys", "tss2-tctildr"];
    let missing: Vec<&str> = required
        .iter()
        .copied()
        .filter(|name| {
            !Command::new("pkg-config")
                .arg("--exists")
                .arg(name)
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        })
        .collect();

    if !missing.is_empty() {
        warnings.push(AttestationPreflightWarning {
            code: "linux_tpm2_tss_missing",
            message: format!(
                "Missing tpm2-tss development/runtime packages detected by pkg-config: {}.",
                missing.join(", ")
            ),
        });
    }
}

#[cfg(target_os = "windows")]
fn collect_windows_preflight_warnings(warnings: &mut Vec<AttestationPreflightWarning>) {
    let feature_enabled = cfg!(feature = "windows-tpm-attestation");

    if !feature_enabled {
        warnings.push(AttestationPreflightWarning {
            code: "windows_feature_disabled",
            message: "This app build has windows-tpm-attestation disabled. Hardware attestation will be downgraded to software mode.".to_string(),
        });
        return;
    }

    if let Some(message) = validate_persistent_handle_env() {
        warnings.push(AttestationPreflightWarning {
            code: "windows_persistent_handle_invalid",
            message,
        });
    }

    if let Some(message) = validate_tpm_ak_cert_chain_env() {
        warnings.push(AttestationPreflightWarning {
            code: "windows_tpm_ak_cert_chain_invalid",
            message,
        });
    }

    if !has_explicit_tpm_ak_certificate_chain_env() {
        if let Some(message) = validate_auto_tpm_ak_chain_local_ca() {
            warnings.push(AttestationPreflightWarning {
                code: "windows_tpm_ak_cert_chain_auto_unavailable",
                message,
            });
        }
    }

    // Windows TPM collector now attempts automatic TBS fallback when TCTI
    // environment variables are not configured.
}

#[cfg(target_os = "macos")]
fn collect_macos_preflight_warnings(warnings: &mut Vec<AttestationPreflightWarning>) {
    warnings.push(AttestationPreflightWarning {
        code: "macos_secure_enclave_unimplemented",
        message: "Secure Enclave attestation collector is not implemented in this build yet; attestation may fall back to software mode.".to_string(),
    });
}

fn validate_persistent_handle_env() -> Option<String> {
    let raw = std::env::var(TPM_AK_PERSISTENT_HANDLE_ENV).ok()?;
    let trimmed = raw.trim();

    if trimmed.is_empty() {
        return Some(format!(
            "{TPM_AK_PERSISTENT_HANDLE_ENV} is set but empty. Use a valid TPM persistent handle such as 0x81010001."
        ));
    }

    let parsed = match parse_persistent_handle_value(trimmed) {
        Ok(value) => value,
        Err(_) => {
            return Some(format!(
                "{TPM_AK_PERSISTENT_HANDLE_ENV} has an invalid value '{trimmed}'. Use decimal or 0x-prefixed hexadecimal format."
            ));
        }
    };

    if (parsed >> 24) != 0x81 {
        return Some(format!(
            "{TPM_AK_PERSISTENT_HANDLE_ENV} value '{trimmed}' is outside the TPM persistent-handle range. Use a handle starting with 0x81...."
        ));
    }

    None
}

fn parse_persistent_handle_value(value: &str) -> Result<u32, std::num::ParseIntError> {
    if let Some(hex) = value.strip_prefix("0x").or_else(|| value.strip_prefix("0X")) {
        return u32::from_str_radix(hex, 16);
    }

    value.parse::<u32>()
}

fn has_explicit_tpm_ak_certificate_chain_env() -> bool {
    match std::env::var(TPM_AK_CERT_CHAIN_B64_ENV) {
        Ok(value) => !value.trim().is_empty(),
        Err(_) => false,
    }
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn resolve_tpm_ak_certificate_chain_b64(ak_public_key_der: &[u8]) -> Vec<String> {
    let configured = collect_tpm_ak_certificate_chain_b64();
    if !configured.is_empty() {
        return configured;
    }

    match build_tpm_ak_certificate_chain_from_local_ca(ak_public_key_der) {
        Ok(chain) => chain,
        Err(message) => {
            if !AUTO_TPM_AK_CHAIN_WARNED.swap(true, Ordering::SeqCst) {
                tracing::warn!(
                    "Automatic TPM AK certificate chain provisioning failed: {}",
                    message,
                );
            }
            Vec::new()
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn resolve_tpm_ak_certificate_chain_b64(_ak_public_key_der: &[u8]) -> Vec<String> {
    collect_tpm_ak_certificate_chain_b64()
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn validate_auto_tpm_ak_chain_local_ca() -> Option<String> {
    let ca_dir = crate::util::get_ROAMING_DIR().join("ca");
    let cert_path = ca_dir.join(TPM_AK_AUTO_CA_CERT_PEM_NAME);
    let key_path = ca_dir.join(TPM_AK_AUTO_CA_KEY_PEM_NAME);

    if !cert_path.exists() || !key_path.exists() {
        return Some(format!(
            "Automatic TPM AK certificate chain provisioning requires local CA files at '{}' and '{}'.",
            cert_path.display(),
            key_path.display(),
        ));
    }

    let cert_pem = match std::fs::read_to_string(&cert_path) {
        Ok(value) => value,
        Err(err) => {
            return Some(format!(
                "Failed to read local CA certificate '{}': {}",
                cert_path.display(),
                err,
            ));
        }
    };

    let key_pem = match std::fs::read_to_string(&key_path) {
        Ok(value) => value,
        Err(err) => {
            return Some(format!(
                "Failed to read local CA private key '{}': {}",
                key_path.display(),
                err,
            ));
        }
    };

    if let Err(err) = CertificateParams::from_ca_cert_pem(&cert_pem) {
        return Some(format!(
            "Local CA certificate '{}' is not parseable: {}",
            cert_path.display(),
            err,
        ));
    }

    if let Err(err) = KeyPair::from_pem(&key_pem) {
        return Some(format!(
            "Local CA private key '{}' is not parseable: {}",
            key_path.display(),
            err,
        ));
    }

    None
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn build_tpm_ak_certificate_chain_from_local_ca(
    ak_public_key_der: &[u8],
) -> Result<Vec<String>, String> {
    let ca_dir = crate::util::get_ROAMING_DIR().join("ca");
    let cert_path = ca_dir.join(TPM_AK_AUTO_CA_CERT_PEM_NAME);
    let key_path = ca_dir.join(TPM_AK_AUTO_CA_KEY_PEM_NAME);

    let ca_cert_pem = std::fs::read_to_string(&cert_path).map_err(|err| {
        format!(
            "failed to read local CA certificate '{}': {}",
            cert_path.display(),
            err,
        )
    })?;
    let ca_key_pem = std::fs::read_to_string(&key_path).map_err(|err| {
        format!(
            "failed to read local CA private key '{}': {}",
            key_path.display(),
            err,
        )
    })?;

    let ca_params = CertificateParams::from_ca_cert_pem(&ca_cert_pem)
        .map_err(|err| format!("failed to parse CA certificate PEM: {}", err))?;
    let ca_key_pair = KeyPair::from_pem(&ca_key_pem)
        .map_err(|err| format!("failed to parse CA private key PEM: {}", err))?;
    let ca_cert = ca_params
        .self_signed(&ca_key_pair)
        .map_err(|err| format!("failed to reconstruct CA certificate: {}", err))?;

    let now = OffsetDateTime::now_utc();
    let crl_params = CertificateRevocationListParams {
        this_update: now - TimeDuration::minutes(5),
        next_update: now + TimeDuration::days(365),
        crl_number: SerialNumber::from(1u64),
        issuing_distribution_point: None,
        revoked_certs: Vec::new(),
        key_identifier_method: KeyIdMethod::Sha256,
    };
    let crl = crl_params
        .signed_by(&ca_cert, &ca_key_pair)
        .map_err(|err| format!("failed to generate local CRL: {}", err))?;

    let crl_data_url = format!(
        "data:application/pkix-crl;base64,{}",
        B64.encode(crl.der().as_ref()),
    );

    let subject_public_key = SubjectPublicKeyInfo::from_der(ak_public_key_der)
        .map_err(|err| format!("failed to parse TPM AK public key DER: {}", err))?;

    let mut leaf_params = CertificateParams::default();
    leaf_params.not_before = now - TimeDuration::minutes(5);
    leaf_params.not_after = now + TimeDuration::days(90);
    leaf_params.is_ca = IsCa::NoCa;
    leaf_params
        .distinguished_name
        .push(DnType::OrganizationName, TPM_AK_CERT_ORGANIZATION_NAME);
    leaf_params
        .distinguished_name
        .push(DnType::CommonName, TPM_AK_CERT_COMMON_NAME);
    leaf_params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    leaf_params.extended_key_usages =
        vec![ExtendedKeyUsagePurpose::Other(TPM_AK_EKU_OID.to_vec())];
    leaf_params.crl_distribution_points = vec![CrlDistributionPoint {
        uris: vec![crl_data_url],
    }];

    let leaf_cert = leaf_params
        .signed_by(&subject_public_key, &ca_cert, &ca_key_pair)
        .map_err(|err| format!("failed to sign TPM AK leaf certificate: {}", err))?;

    Ok(vec![
        B64.encode(leaf_cert.der().as_ref()),
        B64.encode(ca_cert.der().as_ref()),
    ])
}

fn collect_tpm_ak_certificate_chain_b64() -> Vec<String> {
    let raw = match std::env::var(TPM_AK_CERT_CHAIN_B64_ENV) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    parse_tpm_cert_chain_entries(raw.trim()).unwrap_or_default()
}

fn validate_tpm_ak_cert_chain_env() -> Option<String> {
    let raw = std::env::var(TPM_AK_CERT_CHAIN_B64_ENV).ok()?;
    let parsed = match parse_tpm_cert_chain_entries(raw.trim()) {
        Ok(entries) => entries,
        Err(message) => return Some(message),
    };

    if parsed.len() < 2 {
        return Some(format!(
            "{TPM_AK_CERT_CHAIN_B64_ENV} should contain at least leaf and root certificates (2+ entries)."
        ));
    }

    for (index, cert_b64) in parsed.iter().enumerate() {
        if B64.decode(cert_b64).is_err() {
            return Some(format!(
                "{TPM_AK_CERT_CHAIN_B64_ENV} entry #{index} is not valid base64 DER certificate data."
            ));
        }
    }

    None
}

fn parse_tpm_cert_chain_entries(value: &str) -> Result<Vec<String>, String> {
    if value.is_empty() {
        return Err(format!(
            "{TPM_AK_CERT_CHAIN_B64_ENV} is set but empty. Use a JSON array or comma-separated base64 certificates."
        ));
    }

    if value.starts_with('[') {
        let parsed: serde_json::Value = serde_json::from_str(value).map_err(|err| {
            format!(
                "{TPM_AK_CERT_CHAIN_B64_ENV} JSON parsing failed: {err}. Expected JSON string array."
            )
        })?;

        let Some(items) = parsed.as_array() else {
            return Err(format!(
                "{TPM_AK_CERT_CHAIN_B64_ENV} must be a JSON array of base64 certificate strings."
            ));
        };

        let values: Vec<String> = items
            .iter()
            .filter_map(|item| item.as_str().map(|s| s.trim().to_string()))
            .filter(|item| !item.is_empty())
            .collect();
        if values.is_empty() {
            return Err(format!(
                "{TPM_AK_CERT_CHAIN_B64_ENV} JSON array does not contain any non-empty certificate strings."
            ));
        }
        return Ok(values);
    }

    let values: Vec<String> = value
        .split(|ch: char| ch == ',' || ch == ';' || ch.is_whitespace())
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .collect();

    if values.is_empty() {
        return Err(format!(
            "{TPM_AK_CERT_CHAIN_B64_ENV} does not contain any certificate values."
        ));
    }

    Ok(values)
}
