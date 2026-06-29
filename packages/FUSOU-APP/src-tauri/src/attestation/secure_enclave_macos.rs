#[derive(Clone, Debug)]
pub struct SecureEnclaveAttestation {
    pub attestation_data: Vec<u8>,
    pub attestation_signature: Vec<u8>,
    pub public_key: Vec<u8>,
    pub certificate_chain: Vec<Vec<u8>>,
    pub attestation_format: &'static str,
}

#[cfg(target_os = "macos")]
pub fn collect_enclave_attestation(_nonce: &[u8]) -> Result<SecureEnclaveAttestation, String> {
    Err("secure enclave attestation is not available in this build".to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn collect_enclave_attestation(_nonce: &[u8]) -> Result<SecureEnclaveAttestation, String> {
    Err("unsupported platform".to_string())
}
