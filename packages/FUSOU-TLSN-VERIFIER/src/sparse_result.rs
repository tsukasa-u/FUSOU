use crate::{
    append_json_string_field, append_range_field, is_canonical_member_id, parse_binding_value,
    parse_fixed_base64, parse_range_array, parse_result_string, parse_result_uint64,
    push_len_prefixed, push_ranges, push_u16, push_u64, sha256, validate_key_id,
    validate_ranges, validate_server_identity, ParserLimits, RevealedRange,
    Result as VerifierResultType, VerifierError, ISSUER, PROOF_PURPOSE,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use crate::tlsn_alpha15::AuthenticatedRequireInfo;
use uuid::Uuid;

pub const SPARSE_RESULT_VERSION: u16 = 2;
pub const SPARSE_PROFILE_ID: &str = "fusou-require-info-v2-sparse";
pub const SPARSE_DISCLOSURE_MODE: &str = "sparse";
pub const SPARSE_SIGNING_DOMAIN: &[u8] = b"FUSOU-VERIFIER-SPARSE-RESULT-V1\0";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SparseVerifierResult {
    pub version: u16,
    pub profile_id: String,
    pub disclosure_mode: String,
    pub profile_sha256: [u8; 32],
    pub issuer: String,
    pub proof_purpose: String,
    pub canonical_user_id: String,
    pub canonical_device_id: String,
    pub device_challenge: [u8; 32],
    pub verified_member_id: String,
    pub attestation_session_id: Uuid,
    pub binding_nonce: [u8; 32],
    pub binding_value: String,
    pub verifier_key_id: String,
    pub notary_key_id: String,
    pub notary_key_sha256: [u8; 32],
    pub tlsn_attestation_id: Vec<u8>,
    pub presentation_sha256: [u8; 32],
    pub server_identity: String,
    pub request_transcript_size: u64,
    pub response_transcript_size: u64,
    pub revealed_request_ranges: Vec<RevealedRange>,
    pub revealed_response_ranges: Vec<RevealedRange>,
    pub signature: [u8; 64],
}

impl SparseVerifierResult {
    pub fn from_authenticated(
        evidence: &AuthenticatedRequireInfo,
        profile_sha256: [u8; 32],
        verifier_key_id: String,
        notary_key_id: String,
        notary_key_sha256: [u8; 32],
        presentation_sha256: [u8; 32],
        canonical_user_id: String,
        canonical_device_id: String,
        device_challenge: [u8; 32],
        signature: [u8; 64],
    ) -> VerifierResultType<Self> {
        if (evidence.request_transcript_sha256.is_some()
            && evidence.response_transcript_sha256.is_some())
            || ranges_cover_transcript(
            &evidence.revealed_request_ranges,
            evidence.request_transcript_size,
        ) && ranges_cover_transcript(
            &evidence.revealed_response_ranges,
            evidence.response_transcript_size,
        ) {
            return Err(VerifierError::InvalidResult(
                "sparse Result requires at least one incomplete transcript digest",
            ));
        }
        let result = Self {
            version: SPARSE_RESULT_VERSION,
            profile_id: SPARSE_PROFILE_ID.to_owned(),
            disclosure_mode: SPARSE_DISCLOSURE_MODE.to_owned(),
            profile_sha256,
            issuer: ISSUER.to_owned(),
            proof_purpose: PROOF_PURPOSE.to_owned(),
            canonical_user_id,
            canonical_device_id,
            device_challenge,
            verified_member_id: evidence.verified_member_id.clone(),
            attestation_session_id: evidence.binding.session_id,
            binding_nonce: evidence.binding.binding_nonce,
            binding_value: evidence.binding.value.clone(),
            verifier_key_id,
            notary_key_id,
            notary_key_sha256,
            tlsn_attestation_id: evidence.attestation_id.to_vec(),
            presentation_sha256,
            server_identity: evidence.server_identity.clone(),
            request_transcript_size: evidence.request_transcript_size,
            response_transcript_size: evidence.response_transcript_size,
            revealed_request_ranges: evidence.revealed_request_ranges.clone(),
            revealed_response_ranges: evidence.revealed_response_ranges.clone(),
            signature,
        };
        result.validate()?;
        Ok(result)
    }

    pub fn validate(&self) -> VerifierResultType<()> {
        if self.version != SPARSE_RESULT_VERSION {
            return Err(VerifierError::InvalidResult("unsupported sparse Result version"));
        }
        if self.profile_id != SPARSE_PROFILE_ID {
            return Err(VerifierError::InvalidResult("unexpected sparse profile ID"));
        }
        if self.disclosure_mode != SPARSE_DISCLOSURE_MODE {
            return Err(VerifierError::InvalidResult("unexpected sparse disclosure mode"));
        }
        if self.issuer != ISSUER || self.proof_purpose != PROOF_PURPOSE {
            return Err(VerifierError::InvalidResult("unexpected sparse Result identity"));
        }
        if !is_canonical_member_id(&self.verified_member_id) {
            return Err(VerifierError::InvalidResult("invalid verified member ID"));
        }
        if Uuid::parse_str(&self.canonical_user_id)
            .ok()
            .is_none_or(|uuid| uuid.to_string() != self.canonical_user_id)
            || Uuid::parse_str(&self.canonical_device_id)
                .ok()
                .is_none_or(|uuid| uuid.to_string() != self.canonical_device_id)
        {
            return Err(VerifierError::InvalidResult("invalid canonical identity"));
        }
        if self.attestation_session_id.get_version_num() != 4 {
            return Err(VerifierError::InvalidResult("session ID is not UUIDv4"));
        }
        let binding = parse_binding_value(&self.binding_value)?;
        if binding.session_id != self.attestation_session_id
            || binding.binding_nonce != self.binding_nonce
        {
            return Err(VerifierError::InvalidResult(
                "binding fields do not match binding value",
            ));
        }
        validate_key_id(&self.verifier_key_id)?;
        validate_key_id(&self.notary_key_id)?;
        if self.tlsn_attestation_id.len() != 16 {
            return Err(VerifierError::InvalidResult(
                "attestation ID is not 16 bytes",
            ));
        }
        validate_server_identity(&self.server_identity)?;
        validate_ranges(&self.revealed_request_ranges, self.request_transcript_size)?;
        validate_ranges(&self.revealed_response_ranges, self.response_transcript_size)?;
        Ok(())
    }

    pub fn canonical_json(&self) -> VerifierResultType<String> {
        self.validate()?;
        let mut output = String::from("{");
        output.push_str("\"version\":2");
        append_json_string_field(&mut output, "profile_id", &self.profile_id);
        append_json_string_field(&mut output, "disclosure_mode", &self.disclosure_mode);
        append_json_string_field(
            &mut output,
            "profile_sha256",
            &URL_SAFE_NO_PAD.encode(self.profile_sha256),
        );
        append_json_string_field(&mut output, "issuer", &self.issuer);
        append_json_string_field(&mut output, "proof_purpose", &self.proof_purpose);
        append_json_string_field(&mut output, "canonical_user_id", &self.canonical_user_id);
        append_json_string_field(&mut output, "device_id", &self.canonical_device_id);
        append_json_string_field(
            &mut output,
            "device_challenge",
            &URL_SAFE_NO_PAD.encode(self.device_challenge),
        );
        append_json_string_field(&mut output, "verified_member_id", &self.verified_member_id);
        append_json_string_field(
            &mut output,
            "attestation_session_id",
            &self.attestation_session_id.to_string(),
        );
        append_json_string_field(
            &mut output,
            "binding_nonce",
            &URL_SAFE_NO_PAD.encode(self.binding_nonce),
        );
        append_json_string_field(&mut output, "binding_value", &self.binding_value);
        append_json_string_field(&mut output, "verifier_key_id", &self.verifier_key_id);
        append_json_string_field(&mut output, "notary_key_id", &self.notary_key_id);
        append_json_string_field(
            &mut output,
            "notary_key_sha256",
            &URL_SAFE_NO_PAD.encode(self.notary_key_sha256),
        );
        append_json_string_field(
            &mut output,
            "tlsn_attestation_id",
            &URL_SAFE_NO_PAD.encode(&self.tlsn_attestation_id),
        );
        append_json_string_field(
            &mut output,
            "presentation_sha256",
            &URL_SAFE_NO_PAD.encode(self.presentation_sha256),
        );
        append_json_string_field(&mut output, "server_identity", &self.server_identity);
        append_json_string_field(
            &mut output,
            "request_transcript_size",
            &self.request_transcript_size.to_string(),
        );
        append_json_string_field(
            &mut output,
            "response_transcript_size",
            &self.response_transcript_size.to_string(),
        );
        append_range_field(
            &mut output,
            "revealed_request_ranges",
            &self.revealed_request_ranges,
        );
        append_range_field(
            &mut output,
            "revealed_response_ranges",
            &self.revealed_response_ranges,
        );
        append_json_string_field(
            &mut output,
            "signature",
            &URL_SAFE_NO_PAD.encode(self.signature),
        );
        output.push('}');
        Ok(output)
    }

    pub fn signing_bytes(&self) -> VerifierResultType<Vec<u8>> {
        self.validate()?;
        let mut output = Vec::new();
        output.extend_from_slice(SPARSE_SIGNING_DOMAIN);
        push_u16(&mut output, self.version);
        push_len_prefixed(&mut output, self.profile_id.as_bytes())?;
        push_len_prefixed(&mut output, self.disclosure_mode.as_bytes())?;
        push_len_prefixed(&mut output, &self.profile_sha256)?;
        push_len_prefixed(&mut output, self.issuer.as_bytes())?;
        push_len_prefixed(&mut output, self.proof_purpose.as_bytes())?;
        push_len_prefixed(&mut output, self.canonical_user_id.as_bytes())?;
        push_len_prefixed(&mut output, self.canonical_device_id.as_bytes())?;
        push_len_prefixed(&mut output, &self.device_challenge)?;
        push_len_prefixed(&mut output, self.verified_member_id.as_bytes())?;
        push_len_prefixed(&mut output, self.attestation_session_id.as_bytes())?;
        push_len_prefixed(&mut output, &self.binding_nonce)?;
        push_len_prefixed(&mut output, self.binding_value.as_bytes())?;
        push_len_prefixed(&mut output, self.verifier_key_id.as_bytes())?;
        push_len_prefixed(&mut output, self.notary_key_id.as_bytes())?;
        push_len_prefixed(&mut output, &self.notary_key_sha256)?;
        push_len_prefixed(&mut output, &self.tlsn_attestation_id)?;
        push_len_prefixed(&mut output, &self.presentation_sha256)?;
        push_len_prefixed(&mut output, self.server_identity.as_bytes())?;
        push_u64(&mut output, self.request_transcript_size);
        push_ranges(&mut output, &self.revealed_request_ranges)?;
        push_u64(&mut output, self.response_transcript_size);
        push_ranges(&mut output, &self.revealed_response_ranges)?;
        Ok(output)
    }
}

fn ranges_cover_transcript(ranges: &[RevealedRange], transcript_size: u64) -> bool {
    let mut next_start = 0_u64;
    for range in ranges {
        if range.start != next_start {
            return false;
        }
        next_start = match range.start.checked_add(range.length) {
            Some(end) => end,
            None => return false,
        };
    }
    next_start == transcript_size
}

pub fn parse_sparse_verifier_result(
    input: &[u8],
    limits: &ParserLimits,
) -> VerifierResultType<SparseVerifierResult> {
    if input.len() > limits.verifier_result_json_bytes {
        return Err(VerifierError::LimitExceeded("Verifier Result JSON bytes"));
    }
    let mut cursor = crate::JsonCursor::new(input, limits);
    cursor.skip_whitespace();
    cursor.expect_byte(b'{')?;
    crate::expect_result_field(&mut cursor, "version", false)?;
    if cursor.parse_number()? != b"2" {
        return Err(VerifierError::InvalidResult("unexpected sparse Result number"));
    }
    crate::expect_result_field(&mut cursor, "profile_id", true)?;
    let profile_id = parse_result_string(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "disclosure_mode", true)?;
    let disclosure_mode = parse_result_string(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "profile_sha256", true)?;
    let profile_sha256 = parse_fixed_base64::<32>(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "issuer", true)?;
    let issuer = parse_result_string(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "proof_purpose", true)?;
    let proof_purpose = parse_result_string(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "canonical_user_id", true)?;
    let canonical_user_id = parse_result_string(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "device_id", true)?;
    let canonical_device_id = parse_result_string(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "device_challenge", true)?;
    let device_challenge = parse_fixed_base64::<32>(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "verified_member_id", true)?;
    let verified_member_id = parse_result_string(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "attestation_session_id", true)?;
    let attestation_session_id = crate::parse_result_uuid(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "binding_nonce", true)?;
    let binding_nonce = parse_fixed_base64::<32>(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "binding_value", true)?;
    let binding_value = parse_result_string(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "verifier_key_id", true)?;
    let verifier_key_id = parse_result_string(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "notary_key_id", true)?;
    let notary_key_id = parse_result_string(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "notary_key_sha256", true)?;
    let notary_key_sha256 = parse_fixed_base64::<32>(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "tlsn_attestation_id", true)?;
    let tlsn_attestation_id = crate::parse_result_base64(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "presentation_sha256", true)?;
    let presentation_sha256 = parse_fixed_base64::<32>(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "server_identity", true)?;
    let server_identity = parse_result_string(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "request_transcript_size", true)?;
    let request_transcript_size = parse_result_uint64(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "response_transcript_size", true)?;
    let response_transcript_size = parse_result_uint64(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "revealed_request_ranges", true)?;
    let revealed_request_ranges = parse_range_array(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "revealed_response_ranges", true)?;
    let revealed_response_ranges = parse_range_array(&mut cursor)?;
    crate::expect_result_field(&mut cursor, "signature", true)?;
    let signature = parse_fixed_base64::<64>(&mut cursor)?;
    cursor.skip_whitespace();
    cursor.expect_byte(b'}')?;
    if cursor.position != input.len() {
        return Err(VerifierError::InvalidResult("trailing Result bytes"));
    }
    let result = SparseVerifierResult {
        version: SPARSE_RESULT_VERSION,
        profile_id,
        disclosure_mode,
        profile_sha256,
        issuer,
        proof_purpose,
        canonical_user_id,
        canonical_device_id,
        device_challenge,
        verified_member_id,
        attestation_session_id,
        binding_nonce,
        binding_value,
        verifier_key_id,
        notary_key_id,
        notary_key_sha256,
        tlsn_attestation_id,
        presentation_sha256,
        server_identity,
        request_transcript_size,
        response_transcript_size,
        revealed_request_ranges,
        revealed_response_ranges,
        signature,
    };
    result.validate()?;
    if result.canonical_json()?.as_bytes() != input {
        return Err(VerifierError::NonCanonicalResult);
    }
    Ok(result)
}

pub fn presentation_sha256(presentation_bytes: &[u8]) -> [u8; 32] {
    sha256(presentation_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{parse_binding_value, ParsedBinding};

    fn evidence() -> AuthenticatedRequireInfo {
        AuthenticatedRequireInfo {
            verified_member_id: "16189463".to_owned(),
            binding: ParsedBinding {
                session_id: Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000").unwrap(),
                binding_nonce: [0x42; 32],
                value: {
                    let mut bytes = Vec::new();
                    bytes.extend_from_slice(crate::BINDING_PREFIX);
                    bytes.extend_from_slice(&16_u16.to_be_bytes());
                    bytes.extend_from_slice(
                        Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000")
                            .unwrap()
                            .as_bytes(),
                    );
                    bytes.extend_from_slice(&32_u16.to_be_bytes());
                    bytes.extend_from_slice(&[0x42; 32]);
                    URL_SAFE_NO_PAD.encode(bytes)
                },
            },
            server_identity: "game.example.test".to_owned(),
            attestation_id: [0x11; 16],
            request_transcript_sha256: None,
            response_transcript_sha256: Some([0x22; 32]),
            request_transcript_size: 128,
            response_transcript_size: 256,
            revealed_request_ranges: vec![RevealedRange {
                start: 0,
                length: 4,
                bytes: b"POST".to_vec(),
            }],
            revealed_response_ranges: vec![RevealedRange {
                start: 0,
                length: 4,
                bytes: b"HTTP".to_vec(),
            }],
        }
    }

    #[test]
    fn sparse_result_round_trips_with_distinct_signing_domain() {
        let result = SparseVerifierResult::from_authenticated(
            &evidence(),
            [1; 32],
            "verifier-test".to_owned(),
            "notary-test".to_owned(),
            [2; 32],
            [3; 32],
            "11111111-1111-4111-8111-111111111111".to_owned(),
            "22222222-2222-4222-8222-222222222222".to_owned(),
            [4; 32],
            [5; 64],
        )
        .unwrap();
        let json = result.canonical_json().unwrap();
        assert_eq!(parse_sparse_verifier_result(json.as_bytes(), &ParserLimits::default()).unwrap(), result);
        assert!(result.signing_bytes().unwrap().starts_with(SPARSE_SIGNING_DOMAIN));
        assert!(!result.signing_bytes().unwrap().starts_with(crate::SIGNING_DOMAIN));
        assert_eq!(parse_binding_value(&result.binding_value).unwrap().binding_nonce, [0x42; 32]);
    }

    #[test]
    fn sparse_result_rejects_complete_digest_pair() {
        let mut evidence = evidence();
        evidence.request_transcript_sha256 = Some([0x21; 32]);
        assert!(matches!(
            SparseVerifierResult::from_authenticated(
                &evidence,
                [1; 32],
                "verifier-test".to_owned(),
                "notary-test".to_owned(),
                [2; 32],
                [3; 32],
                "11111111-1111-4111-8111-111111111111".to_owned(),
                "22222222-2222-4222-8222-222222222222".to_owned(),
                [4; 32],
                [5; 64],
            ),
            Err(VerifierError::InvalidResult(_))
        ));
    }
}