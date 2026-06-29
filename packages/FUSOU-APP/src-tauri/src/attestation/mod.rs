pub mod environment_check;
pub mod fingerprint;
pub mod secure_enclave_macos;
pub mod tpm_linux;
pub mod tpm_windows;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde_json::json;

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
    if let Ok((attestation_data, public_key)) = tpm_windows::collect_tpm_attestation(nonce) {
        return json!({
            "attestation_level": "tpm",
            "attestation_data": B64.encode(attestation_data),
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
    if let Ok((attestation_data, public_key)) =
        secure_enclave_macos::collect_enclave_attestation(nonce)
    {
        return json!({
            "attestation_level": "secure_enclave",
            "attestation_data": B64.encode(attestation_data),
            "public_key": B64.encode(public_key),
            "fingerprint": fingerprint::collect_fingerprint(),
            "environment": environment_check::detect_environment(),
        });
    }

    build_software_report()
}
