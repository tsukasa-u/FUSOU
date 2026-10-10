use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use wasm_bindgen::prelude::*;

use crate::{
    parse_verifier_result,
    sparse_result::{parse_sparse_verifier_result, presentation_sha256, SparseVerifierResult},
    tlsn_alpha15::{
        verify_alpha15_presentation_with_provider_and_notary_key, AuthenticatedTranscript,
        RequireInfoDisclosureProfile, SparseRequireInfoDisclosureProfile,
    },
    ParserLimits, VerifierResult,
};

fn create_crypto_provider(
    trust_anchor_der: Option<&[u8]>,
) -> Result<tlsn_attestation::CryptoProvider, JsValue> {
    let Some(trust_anchor_der) = trust_anchor_der else {
        return Ok(tlsn_attestation::CryptoProvider::default());
    };
    if trust_anchor_der.is_empty() {
        return Err(JsValue::from_str("trust anchor must not be empty"));
    }
    let root_store = tlsn_core::webpki::RootCertStore {
        roots: vec![tlsn_core::webpki::CertificateDer(trust_anchor_der.to_vec())],
    };
    let mut provider = tlsn_attestation::CryptoProvider::default();
    provider.cert = tlsn::verifier::ServerCertVerifier::new(&root_store)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok(provider)
}

fn optional_production_digest(value: &[u8], label: &str) -> Result<Option<[u8; 32]>, JsValue> {
    if value.is_empty() {
        return Ok(None);
    }
    let digest = value
        .try_into()
        .map_err(|_| JsValue::from_str(&format!("{label} must be empty or exactly 32 bytes")))?;
    Ok(Some(digest))
}

fn range_json(range: &crate::RevealedRange) -> serde_json::Value {
    serde_json::json!({
        "start": range.start.to_string(),
        "length": range.length.to_string(),
        "bytes": URL_SAFE_NO_PAD.encode(&range.bytes),
    })
}

fn verified_presentation_json(transcript: &AuthenticatedTranscript) -> Result<String, JsValue> {
    let request_ranges = transcript.revealed_request_ranges();
    let response_ranges = transcript.revealed_response_ranges();
    serde_json::to_string(&serde_json::json!({
        "server_identity": transcript.server_identity(),
        "tlsn_attestation_id": URL_SAFE_NO_PAD.encode(transcript.attestation_id()),
        "notary_key_sha256": URL_SAFE_NO_PAD.encode(transcript.notary_key_sha256()),
        "request_transcript_size": transcript.request_transcript_size().to_string(),
        "request_transcript_sha256": transcript
            .request_transcript_sha256()
            .map(|digest| URL_SAFE_NO_PAD.encode(digest)),
        "revealed_request_ranges": request_ranges
            .iter()
            .map(range_json)
            .collect::<Vec<_>>(),
        "response_transcript_size": transcript.response_transcript_size().to_string(),
        "response_transcript_sha256": transcript
            .response_transcript_sha256()
            .map(|digest| URL_SAFE_NO_PAD.encode(digest)),
        "revealed_response_ranges": response_ranges
            .iter()
            .map(range_json)
            .collect::<Vec<_>>(),
    }))
    .map_err(|error| JsValue::from_str(&error.to_string()))
}

fn inspect_alpha15_presentation_inner(
    presentation_bytes: &[u8],
    trusted_notary_key: &[u8],
    trust_anchor_der: Option<&[u8]>,
) -> Result<String, JsValue> {
    if trusted_notary_key.is_empty() {
        return Err(JsValue::from_str("trusted Notary key must not be empty"));
    }
    let provider = create_crypto_provider(trust_anchor_der)?;
    let transcript = verify_alpha15_presentation_with_provider_and_notary_key(
        presentation_bytes,
        &provider,
        Some(trusted_notary_key),
    )
    .map_err(|error| JsValue::from_str(&error.to_string()))?;
    verified_presentation_json(&transcript)
}

fn verify_require_info_presentation_inner(
    presentation_bytes: &[u8],
    expected_server_identity: &str,
    profile_sha256: &[u8],
    verifier_key_id: &str,
    notary_key_id: &str,
    canonical_user_id: &str,
    canonical_device_id: &str,
    device_challenge: &[u8],
    origin_inventory_sha256: &[u8],
    target_approval_artifact_sha256: &[u8],
    trusted_notary_key: &[u8],
    trust_anchor_der: Option<&[u8]>,
) -> Result<String, JsValue> {
    let profile_sha256: [u8; 32] = profile_sha256
        .try_into()
        .map_err(|_| JsValue::from_str("profile_sha256 must be exactly 32 bytes"))?;
    let device_challenge: [u8; 32] = device_challenge
        .try_into()
        .map_err(|_| JsValue::from_str("device_challenge must be exactly 32 bytes"))?;
    let origin_inventory_sha256 = optional_production_digest(
        origin_inventory_sha256,
        "origin_inventory_sha256",
    )?;
    let target_approval_artifact_sha256 = optional_production_digest(
        target_approval_artifact_sha256,
        "target_approval_artifact_sha256",
    )?;
    let profile = RequireInfoDisclosureProfile::from_server_identity(expected_server_identity)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    if trusted_notary_key.is_empty() {
        return Err(JsValue::from_str("trusted Notary key must not be empty"));
    }
    let provider = create_crypto_provider(trust_anchor_der)?;
    let transcript = verify_alpha15_presentation_with_provider_and_notary_key(
        presentation_bytes,
        &provider,
        Some(trusted_notary_key),
    )
    .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let authenticated = transcript
        .verify_require_info(&profile, &ParserLimits::default())
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let result = authenticated
        .into_verifier_result(
            profile_sha256,
            verifier_key_id.to_owned(),
            notary_key_id.to_owned(),
            canonical_user_id.to_owned(),
            canonical_device_id.to_owned(),
            device_challenge,
            presentation_sha256(presentation_bytes),
            origin_inventory_sha256,
            target_approval_artifact_sha256,
            [0_u8; 64],
        )
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let canonical_unsigned_result = result
        .canonical_json()
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let signing_bytes = result
        .signing_bytes()
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let unsigned_result_json = serde_json::to_string(&canonical_unsigned_result)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;

    Ok(format!(
        "{{\"unsigned_result\":{},\"signing_bytes\":\"{}\"}}",
        unsigned_result_json,
        URL_SAFE_NO_PAD.encode(signing_bytes),
    ))
}

fn verify_sparse_require_info_presentation_inner(
    presentation_bytes: &[u8],
    expected_server_identity: &str,
    profile_sha256: &[u8],
    verifier_key_id: &str,
    notary_key_id: &str,
    canonical_user_id: &str,
    canonical_device_id: &str,
    device_challenge: &[u8],
    origin_inventory_sha256: &[u8],
    target_approval_artifact_sha256: &[u8],
    trust_anchor_der: Option<&[u8]>,
    trusted_notary_key: &[u8],
) -> Result<String, JsValue> {
    let profile_sha256: [u8; 32] = profile_sha256
        .try_into()
        .map_err(|_| JsValue::from_str("profile_sha256 must be exactly 32 bytes"))?;
    let device_challenge: [u8; 32] = device_challenge
        .try_into()
        .map_err(|_| JsValue::from_str("device_challenge must be exactly 32 bytes"))?;
    let origin_inventory_sha256 = optional_production_digest(
        origin_inventory_sha256,
        "origin_inventory_sha256",
    )?;
    let target_approval_artifact_sha256 = optional_production_digest(
        target_approval_artifact_sha256,
        "target_approval_artifact_sha256",
    )?;
    if trusted_notary_key.is_empty() {
        return Err(JsValue::from_str("trusted Notary key must not be empty"));
    }
    let profile =
        SparseRequireInfoDisclosureProfile::from_server_identity(expected_server_identity)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let provider = create_crypto_provider(trust_anchor_der)?;
    let transcript = verify_alpha15_presentation_with_provider_and_notary_key(
        presentation_bytes,
        &provider,
        Some(trusted_notary_key),
    )
    .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let authenticated = transcript
        .verify_require_info_sparse(&profile, &ParserLimits::default())
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let result = SparseVerifierResult::from_authenticated(
        &authenticated,
        profile_sha256,
        verifier_key_id.to_owned(),
        notary_key_id.to_owned(),
        *transcript.notary_key_sha256(),
        presentation_sha256(presentation_bytes),
        origin_inventory_sha256,
        target_approval_artifact_sha256,
        canonical_user_id.to_owned(),
        canonical_device_id.to_owned(),
        device_challenge,
        [0_u8; 64],
    )
    .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let unsigned_result = result
        .canonical_json()
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let signing_bytes = result
        .signing_bytes()
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let unsigned_result_json = serde_json::to_string(&unsigned_result)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok(format!(
        "{{\"unsigned_result\":{},\"signing_bytes\":\"{}\"}}",
        unsigned_result_json,
        URL_SAFE_NO_PAD.encode(signing_bytes),
    ))
}

#[wasm_bindgen]
pub fn inspect_alpha15_presentation(
    presentation_bytes: &[u8],
    trusted_notary_key: &[u8],
) -> Result<String, JsValue> {
    inspect_alpha15_presentation_inner(presentation_bytes, trusted_notary_key, None)
}

#[wasm_bindgen]
pub fn inspect_alpha15_server_identity(
    presentation_bytes: &[u8],
    trusted_notary_key: &[u8],
) -> Result<String, JsValue> {
    if trusted_notary_key.is_empty() {
        return Err(JsValue::from_str("trusted Notary key must not be empty"));
    }
    let provider = create_crypto_provider(None)?;
    let transcript = verify_alpha15_presentation_with_provider_and_notary_key(
        presentation_bytes,
        &provider,
        Some(trusted_notary_key),
    )
    .map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok(transcript.server_identity().to_owned())
}

#[wasm_bindgen]
pub fn inspect_synthetic_alpha15_presentation_with_root(
    presentation_bytes: &[u8],
    trust_anchor_der: &[u8],
    trusted_notary_key: &[u8],
) -> Result<String, JsValue> {
    inspect_alpha15_presentation_inner(
        presentation_bytes,
        trusted_notary_key,
        Some(trust_anchor_der),
    )
}

#[wasm_bindgen]
pub fn verify_require_info_presentation(
    presentation_bytes: &[u8],
    expected_server_identity: &str,
    profile_sha256: &[u8],
    verifier_key_id: &str,
    notary_key_id: &str,
    canonical_user_id: &str,
    canonical_device_id: &str,
    device_challenge: &[u8],
    origin_inventory_sha256: &[u8],
    target_approval_artifact_sha256: &[u8],
    trusted_notary_key: &[u8],
) -> Result<String, JsValue> {
    verify_require_info_presentation_inner(
        presentation_bytes,
        expected_server_identity,
        profile_sha256,
        verifier_key_id,
        notary_key_id,
        canonical_user_id,
        canonical_device_id,
        device_challenge,
        origin_inventory_sha256,
        target_approval_artifact_sha256,
        trusted_notary_key,
        None,
    )
}

#[wasm_bindgen]
pub fn verify_synthetic_require_info_presentation_with_root(
    presentation_bytes: &[u8],
    expected_server_identity: &str,
    profile_sha256: &[u8],
    verifier_key_id: &str,
    notary_key_id: &str,
    canonical_user_id: &str,
    canonical_device_id: &str,
    device_challenge: &[u8],
    origin_inventory_sha256: &[u8],
    target_approval_artifact_sha256: &[u8],
    trust_anchor_der: &[u8],
    trusted_notary_key: &[u8],
) -> Result<String, JsValue> {
    verify_require_info_presentation_inner(
        presentation_bytes,
        expected_server_identity,
        profile_sha256,
        verifier_key_id,
        notary_key_id,
        canonical_user_id,
        canonical_device_id,
        device_challenge,
        origin_inventory_sha256,
        target_approval_artifact_sha256,
        trusted_notary_key,
        Some(trust_anchor_der),
    )
}

#[wasm_bindgen]
pub fn verify_sparse_require_info_presentation(
    presentation_bytes: &[u8],
    expected_server_identity: &str,
    profile_sha256: &[u8],
    verifier_key_id: &str,
    notary_key_id: &str,
    canonical_user_id: &str,
    canonical_device_id: &str,
    device_challenge: &[u8],
    origin_inventory_sha256: &[u8],
    target_approval_artifact_sha256: &[u8],
    trusted_notary_key: &[u8],
) -> Result<String, JsValue> {
    verify_sparse_require_info_presentation_inner(
        presentation_bytes,
        expected_server_identity,
        profile_sha256,
        verifier_key_id,
        notary_key_id,
        canonical_user_id,
        canonical_device_id,
        device_challenge,
        origin_inventory_sha256,
        target_approval_artifact_sha256,
        None,
        trusted_notary_key,
    )
}

#[wasm_bindgen]
pub fn verify_synthetic_sparse_require_info_presentation_with_root(
    presentation_bytes: &[u8],
    expected_server_identity: &str,
    profile_sha256: &[u8],
    verifier_key_id: &str,
    notary_key_id: &str,
    canonical_user_id: &str,
    canonical_device_id: &str,
    device_challenge: &[u8],
    origin_inventory_sha256: &[u8],
    target_approval_artifact_sha256: &[u8],
    trust_anchor_der: &[u8],
    trusted_notary_key: &[u8],
) -> Result<String, JsValue> {
    verify_sparse_require_info_presentation_inner(
        presentation_bytes,
        expected_server_identity,
        profile_sha256,
        verifier_key_id,
        notary_key_id,
        canonical_user_id,
        canonical_device_id,
        device_challenge,
        origin_inventory_sha256,
        target_approval_artifact_sha256,
        Some(trust_anchor_der),
        trusted_notary_key,
    )
}

#[wasm_bindgen]
pub fn attach_verifier_result_signature(
    unsigned_result_json: &str,
    signature: &[u8],
) -> Result<String, JsValue> {
    let mut result: VerifierResult =
        parse_verifier_result(unsigned_result_json.as_bytes(), &ParserLimits::default())
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
    result.signature = signature
        .try_into()
        .map_err(|_| JsValue::from_str("signature must be exactly 64 bytes"))?;
    result
        .canonical_json()
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen]
pub fn attach_sparse_verifier_result_signature(
    unsigned_result_json: &str,
    signature: &[u8],
) -> Result<String, JsValue> {
    let mut result: SparseVerifierResult =
        parse_sparse_verifier_result(unsigned_result_json.as_bytes(), &ParserLimits::default())
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
    result.signature = signature
        .try_into()
        .map_err(|_| JsValue::from_str("signature must be exactly 64 bytes"))?;
    result
        .canonical_json()
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen]
pub fn derive_verifier_result_signing_bytes(
    unsigned_result_json: &str,
) -> Result<Vec<u8>, JsValue> {
    let result = parse_verifier_result(unsigned_result_json.as_bytes(), &ParserLimits::default())
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    result
        .signing_bytes()
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen]
pub fn derive_sparse_verifier_result_signing_bytes(
    unsigned_result_json: &str,
) -> Result<Vec<u8>, JsValue> {
    let result =
        parse_sparse_verifier_result(unsigned_result_json.as_bytes(), &ParserLimits::default())
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
    result
        .signing_bytes()
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

#[cfg(test)]
mod trust_store_tests {
    use rcgen::{BasicConstraints, CertificateParams, IsCa, KeyPair, KeyUsagePurpose};
    use std::time::{SystemTime, UNIX_EPOCH};
    use tlsn_core::{
        connection::{DnsName, ServerName},
        webpki::{CertificateDer, RootCertStore, ServerCertVerifier},
    };

    #[test]
    fn synthetic_root_is_not_implicitly_trusted_by_worker_mozilla_provider() {
        let root_key = KeyPair::generate().expect("synthetic root key");
        let mut root_params = CertificateParams::default();
        root_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        root_params.key_usages = vec![KeyUsagePurpose::KeyCertSign];
        let root_certificate = root_params.self_signed(&root_key).expect("synthetic root certificate");

        let leaf_key = KeyPair::generate().expect("synthetic leaf key");
        let mut leaf_params = CertificateParams::new(vec!["inventory.example.test".to_owned()])
            .expect("synthetic leaf params");
        leaf_params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        leaf_params.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::ServerAuth];
        let leaf_certificate = leaf_params
            .signed_by(&leaf_key, &root_certificate, &root_key)
            .expect("synthetic leaf certificate");

        let root_der = CertificateDer(root_certificate.der().to_vec());
        let leaf_der = CertificateDer(leaf_certificate.der().to_vec());
        let explicit_store = RootCertStore { roots: vec![root_der] };
        let explicit_verifier = ServerCertVerifier::new(&explicit_store).expect("synthetic verifier");
        let server_name = ServerName::Dns(
            DnsName::try_from("inventory.example.test").expect("synthetic DNS identity"),
        );
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_secs();

        assert!(explicit_verifier
            .verify_server_cert(&leaf_der, &[], &server_name, now)
            .is_ok());
        assert!(tlsn_attestation::CryptoProvider::default()
            .cert
            .verify_server_cert(&leaf_der, &[], &server_name, now)
            .is_err());
    }
}
