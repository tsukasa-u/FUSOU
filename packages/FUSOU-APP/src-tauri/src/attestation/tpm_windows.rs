#[cfg(target_os = "windows")]
pub fn collect_tpm_attestation(_nonce: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    Err("tpm attestation is not available in this build".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn collect_tpm_attestation(_nonce: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    Err("unsupported platform".to_string())
}
