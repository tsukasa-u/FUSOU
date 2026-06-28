#[cfg(target_os = "macos")]
pub fn collect_enclave_attestation(_nonce: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    Err("secure enclave attestation is not available in this build".to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn collect_enclave_attestation(_nonce: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    Err("unsupported platform".to_string())
}
