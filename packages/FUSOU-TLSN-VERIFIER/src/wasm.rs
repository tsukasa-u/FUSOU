use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use wasm_bindgen::prelude::*;

use crate::{
    parse_verifier_result,
    tlsn_alpha15::{
        verify_alpha15_presentation_with_provider_and_notary_key, RequireInfoDisclosureProfile,
    },
    ParserLimits, VerifierResult,
};

fn verify_require_info_presentation_inner(
    presentation_bytes: &[u8],
    expected_server_identity: &str,
    profile_sha256: &[u8],
    verifier_key_id: &str,
    notary_key_id: &str,
    canonical_user_id: &str,
    canonical_device_id: &str,
    device_challenge: &[u8],
    trusted_notary_key: &[u8],
    trust_anchor_der: Option<&[u8]>,
) -> Result<String, JsValue> {
    let profile_sha256: [u8; 32] = profile_sha256
        .try_into()
        .map_err(|_| JsValue::from_str("profile_sha256 must be exactly 32 bytes"))?;
    let device_challenge: [u8; 32] = device_challenge
        .try_into()
        .map_err(|_| JsValue::from_str("device_challenge must be exactly 32 bytes"))?;
    let profile = RequireInfoDisclosureProfile::from_server_identity(expected_server_identity)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    if trusted_notary_key.is_empty() {
        return Err(JsValue::from_str("trusted Notary key must not be empty"));
    }
    let provider = if let Some(trust_anchor_der) = trust_anchor_der {
        if trust_anchor_der.is_empty() {
            return Err(JsValue::from_str("trust anchor must not be empty"));
        }
        let root_store = tlsn_core::webpki::RootCertStore {
            roots: vec![tlsn_core::webpki::CertificateDer(trust_anchor_der.to_vec())],
        };
        let mut provider = tlsn_attestation::CryptoProvider::default();
        provider.cert = tlsn::verifier::ServerCertVerifier::new(&root_store)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        provider
    } else {
        tlsn_attestation::CryptoProvider::default()
    };
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
        trusted_notary_key,
        None,
    )
}

#[wasm_bindgen]
pub fn verify_require_info_presentation_with_trust_anchor(
    presentation_bytes: &[u8],
    expected_server_identity: &str,
    profile_sha256: &[u8],
    verifier_key_id: &str,
    notary_key_id: &str,
    canonical_user_id: &str,
    canonical_device_id: &str,
    device_challenge: &[u8],
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
        trusted_notary_key,
        Some(trust_anchor_der),
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
