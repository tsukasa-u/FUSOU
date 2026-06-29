pub mod environment_check;
pub mod fingerprint;
pub mod secure_enclave_macos;
pub mod tpm_linux;
pub mod tpm_windows;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde_json::json;

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
        return json!({
            "attestation_level": "tpm",
            "attestation_data": B64.encode(attestation_data),
            "attestation_signature": B64.encode(attestation_signature),
            "attestation_format": "tpm2_quote_rsassa_sha256_v1",
            "public_key": B64.encode(public_key),
            "fingerprint": fingerprint::collect_fingerprint(),
            "environment": environment_check::detect_environment(),
        });
    }

    #[cfg(target_os = "linux")]
    if let Ok((attestation_data, attestation_signature, public_key)) =
        tpm_linux::collect_tpm_attestation(nonce)
    {
        return json!({
            "attestation_level": "tpm",
            "attestation_data": B64.encode(attestation_data),
            "attestation_signature": B64.encode(attestation_signature),
            "attestation_format": "tpm2_quote_rsassa_sha256_v1",
            "public_key": B64.encode(public_key),
            "fingerprint": fingerprint::collect_fingerprint(),
            "environment": environment_check::detect_environment(),
        });
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

    let has_tcti_env = std::env::var("TPM2TOOLS_TCTI").is_ok() || std::env::var("TCTI").is_ok();
    if !has_tcti_env {
        warnings.push(AttestationPreflightWarning {
            code: "windows_tcti_env_missing",
            message: "TPM TCTI environment variable is not configured (TPM2TOOLS_TCTI/TCTI). Current Windows TPM path may fail without it.".to_string(),
        });
    }
}

#[cfg(target_os = "macos")]
fn collect_macos_preflight_warnings(warnings: &mut Vec<AttestationPreflightWarning>) {
    warnings.push(AttestationPreflightWarning {
        code: "macos_secure_enclave_unimplemented",
        message: "Secure Enclave attestation collector is not implemented in this build yet; attestation may fall back to software mode.".to_string(),
    });
}
