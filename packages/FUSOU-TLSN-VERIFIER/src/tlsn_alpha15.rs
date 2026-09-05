use crate::{
    parse_require_info_request, parse_require_info_response, sha256, validate_server_identity,
    verify_transcript_digest, ParsedBinding, ParserLimits, RevealedRange, VerifierError,
    MAX_ATTESTATION_ID_BYTES, PROFILE_ID, REQUIRE_INFO_TARGET,
};
use std::{io::Cursor, ops::Range};
use thiserror::Error;
use tlsn_attestation::{presentation::Presentation, CryptoProvider};

pub const SELECTED_REVISION: &str = "refs/tags/v0.1.0-alpha.15";
pub const SELECTED_COMMIT: &str = "47aee45b53e06648c1b2ad3689b367b8c923fdec";
pub const PRESENTATION_VERIFY_ENTRY_POINT: &str =
    "presentation.verify(&CryptoProvider::default())?.attestation.header.id.0";
pub const UPSTREAM_PRESENTATION_TYPE: &str = "tlsn_attestation::Presentation";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum Alpha15AdapterError {
    #[error("alpha.15 Presentation decoding failed: {0}")]
    PresentationDecode(String),
    #[error("alpha.15 Presentation verification failed: {0}")]
    PresentationVerification(String),
    #[error("alpha.15 Presentation does not disclose an authenticated server identity")]
    MissingServerIdentity,
    #[error("alpha.15 Presentation does not disclose an authenticated transcript")]
    MissingTranscript,
    #[error("verified alpha.15 output is invalid: {0}")]
    InvalidVerifiedOutput(&'static str),
    #[error("authenticated server identity is not in the trusted allowlist")]
    ServerIdentityNotAllowlisted,
    #[error("authenticated transcript is not covered by the FUSOU disclosure profile: {0}")]
    DisclosureProfileViolation(&'static str),
    #[error(transparent)]
    Parser(#[from] VerifierError),
}

pub type Result<T> = std::result::Result<T, Alpha15AdapterError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequireInfoDisclosureProfile {
    server_identity: String,
}

impl RequireInfoDisclosureProfile {
    pub const ID: &'static str = PROFILE_ID;
    pub const TARGET: &'static str = REQUIRE_INFO_TARGET;

    pub fn id(&self) -> &'static str {
        Self::ID
    }

    pub fn server_identity(&self) -> &str {
        &self.server_identity
    }

    #[allow(dead_code)]
    pub(crate) fn from_configured_allowlist(server_identity: &str) -> Result<Self> {
        const CONFIGURED_SERVER_IDENTITIES: &[&str] = &[];
        if !CONFIGURED_SERVER_IDENTITIES.contains(&server_identity) {
            return Err(Alpha15AdapterError::ServerIdentityNotAllowlisted);
        }
        validate_server_identity(server_identity)?;
        Ok(Self {
            server_identity: server_identity.to_owned(),
        })
    }

    #[cfg(test)]
    fn for_mock_tlsn_verification(server_identity: &str) -> Result<Self> {
        validate_server_identity(server_identity)?;
        Ok(Self {
            server_identity: server_identity.to_owned(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AuthenticatedDirection {
    transcript: Vec<u8>,
    digest: [u8; 32],
    ranges: Vec<RevealedRange>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatedTranscript {
    server_identity: String,
    attestation_id: [u8; MAX_ATTESTATION_ID_BYTES],
    sent: AuthenticatedDirection,
    received: AuthenticatedDirection,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatedRequireInfo {
    pub verified_member_id: String,
    pub binding: ParsedBinding,
    pub server_identity: String,
    pub attestation_id: [u8; MAX_ATTESTATION_ID_BYTES],
    pub request_transcript_sha256: [u8; 32],
    pub response_transcript_sha256: [u8; 32],
    pub request_transcript_size: u64,
    pub response_transcript_size: u64,
    pub revealed_request_ranges: Vec<RevealedRange>,
    pub revealed_response_ranges: Vec<RevealedRange>,
}

impl AuthenticatedRequireInfo {
    pub fn into_verifier_result(
        self,
        profile_sha256: [u8; 32],
        verifier_key_id: String,
        notary_key_id: String,
        signature: [u8; 64],
    ) -> Result<crate::VerifierResult> {
        let result = crate::VerifierResult {
            version: 1,
            profile_id: PROFILE_ID.to_owned(),
            profile_sha256,
            issuer: crate::ISSUER.to_owned(),
            proof_purpose: crate::PROOF_PURPOSE.to_owned(),
            attestation_session_id: self.binding.session_id,
            binding_nonce: self.binding.binding_nonce,
            binding_value: self.binding.value,
            verifier_key_id,
            notary_key_id,
            tlsn_attestation_id: self.attestation_id.to_vec(),
            server_identity: self.server_identity,
            request_transcript_size: self.request_transcript_size,
            request_transcript_sha256: self.request_transcript_sha256,
            response_transcript_size: self.response_transcript_size,
            response_transcript_sha256: self.response_transcript_sha256,
            revealed_request_ranges: self.revealed_request_ranges,
            revealed_response_ranges: self.revealed_response_ranges,
            signature,
        };
        result.validate().map_err(Alpha15AdapterError::Parser)?;
        Ok(result)
    }
}

#[allow(dead_code)]
#[derive(Debug)]
pub(crate) struct Alpha15VerifiedOutput {
    pub(crate) server_identity: String,
    pub(crate) attestation_id: [u8; MAX_ATTESTATION_ID_BYTES],
    pub(crate) sent_transcript: Vec<u8>,
    pub(crate) sent_digest: [u8; 32],
    pub(crate) sent_ranges: Vec<RevealedRange>,
    pub(crate) received_transcript: Vec<u8>,
    pub(crate) received_digest: [u8; 32],
    pub(crate) received_ranges: Vec<RevealedRange>,
}

impl AuthenticatedTranscript {
    #[allow(dead_code)]
    fn from_verified_alpha15(output: Alpha15VerifiedOutput) -> Result<Self> {
        if output.attestation_id.len() != MAX_ATTESTATION_ID_BYTES {
            return Err(Alpha15AdapterError::InvalidVerifiedOutput(
                "attestation ID must be exactly 16 bytes",
            ));
        }
        validate_server_identity(&output.server_identity)?;
        validate_authenticated_direction(
            &output.sent_transcript,
            output.sent_digest,
            &output.sent_ranges,
        )?;
        validate_authenticated_direction(
            &output.received_transcript,
            output.received_digest,
            &output.received_ranges,
        )?;
        Ok(Self {
            server_identity: output.server_identity,
            attestation_id: output.attestation_id,
            sent: AuthenticatedDirection {
                transcript: output.sent_transcript,
                digest: output.sent_digest,
                ranges: output.sent_ranges,
            },
            received: AuthenticatedDirection {
                transcript: output.received_transcript,
                digest: output.received_digest,
                ranges: output.received_ranges,
            },
        })
    }

    pub fn server_identity(&self) -> &str {
        &self.server_identity
    }

    pub fn attestation_id(&self) -> &[u8; MAX_ATTESTATION_ID_BYTES] {
        &self.attestation_id
    }

    pub fn request_transcript_sha256(&self) -> &[u8; 32] {
        &self.sent.digest
    }

    pub fn response_transcript_sha256(&self) -> &[u8; 32] {
        &self.received.digest
    }

    pub fn revealed_request_ranges(&self) -> &[RevealedRange] {
        &self.sent.ranges
    }

    pub fn revealed_response_ranges(&self) -> &[RevealedRange] {
        &self.received.ranges
    }

    pub fn verify_require_info(
        &self,
        profile: &RequireInfoDisclosureProfile,
        limits: &ParserLimits,
    ) -> Result<AuthenticatedRequireInfo> {
        if self.server_identity != profile.server_identity {
            return Err(Alpha15AdapterError::ServerIdentityNotAllowlisted);
        }
        let request =
            parse_require_info_request(&self.sent.transcript, &self.server_identity, limits)
                .map_err(Alpha15AdapterError::Parser)?;
        let response = parse_require_info_response(&self.received.transcript, limits)
            .map_err(Alpha15AdapterError::Parser)?;
        Ok(AuthenticatedRequireInfo {
            verified_member_id: response.verified_member_id,
            binding: request.binding,
            server_identity: self.server_identity.clone(),
            attestation_id: self.attestation_id,
            request_transcript_sha256: self.sent.digest,
            response_transcript_sha256: self.received.digest,
            request_transcript_size: self.sent.transcript.len() as u64,
            response_transcript_size: self.received.transcript.len() as u64,
            revealed_request_ranges: self.sent.ranges.clone(),
            revealed_response_ranges: self.received.ranges.clone(),
        })
    }
}

#[allow(dead_code)]
fn validate_authenticated_direction(
    transcript: &[u8],
    digest: [u8; 32],
    ranges: &[RevealedRange],
) -> Result<()> {
    if transcript.is_empty() {
        return Err(Alpha15AdapterError::InvalidVerifiedOutput(
            "authenticated transcript is empty",
        ));
    }
    if sha256(transcript) != digest {
        return Err(Alpha15AdapterError::InvalidVerifiedOutput(
            "transcript digest does not match verified output",
        ));
    }
    verify_transcript_digest(transcript, transcript.len() as u64, &digest, ranges)
        .map_err(|_| Alpha15AdapterError::DisclosureProfileViolation("range bytes or bounds"))
        .and_then(|()| {
            let mut next_start = 0_u64;
            for range in ranges {
                if range.start != next_start {
                    return Err(Alpha15AdapterError::DisclosureProfileViolation(
                        "strict parser input is not fully disclosed",
                    ));
                }
                next_start = range.start + range.length;
            }
            if next_start != transcript.len() as u64 {
                return Err(Alpha15AdapterError::DisclosureProfileViolation(
                    "strict parser input is not fully disclosed",
                ));
            }
            Ok(())
        })
}

pub fn verify_alpha15_presentation(presentation_bytes: &[u8]) -> Result<AuthenticatedTranscript> {
    let mut cursor = Cursor::new(presentation_bytes);
    let presentation: Presentation = bincode::deserialize_from(&mut cursor)
        .map_err(|error| Alpha15AdapterError::PresentationDecode(error.to_string()))?;
    if cursor.position() != presentation_bytes.len() as u64 {
        return Err(Alpha15AdapterError::PresentationDecode(
            "trailing Presentation bytes".to_owned(),
        ));
    }
    let output = presentation
        .verify(&CryptoProvider::default())
        .map_err(|error| Alpha15AdapterError::PresentationVerification(error.to_string()))?;
    let server_identity = output
        .server_name
        .ok_or(Alpha15AdapterError::MissingServerIdentity)?
        .to_string();
    let transcript = output
        .transcript
        .ok_or(Alpha15AdapterError::MissingTranscript)?;
    if !transcript.is_complete() {
        return Err(Alpha15AdapterError::DisclosureProfileViolation(
            "alpha.15 transcript disclosure is incomplete",
        ));
    }

    let sent_transcript = transcript.sent_unsafe().to_vec();
    let received_transcript = transcript.received_unsafe().to_vec();
    let sent_ranges = map_authenticated_ranges(transcript.sent_authed().iter(), &sent_transcript)?;
    let received_ranges =
        map_authenticated_ranges(transcript.received_authed().iter(), &received_transcript)?;

    AuthenticatedTranscript::from_verified_alpha15(Alpha15VerifiedOutput {
        server_identity,
        attestation_id: output.attestation.header.id.0,
        sent_digest: sha256(&sent_transcript),
        sent_ranges,
        sent_transcript,
        received_digest: sha256(&received_transcript),
        received_ranges,
        received_transcript,
    })
}

fn map_authenticated_ranges(
    ranges: impl Iterator<Item = Range<usize>>,
    transcript: &[u8],
) -> Result<Vec<RevealedRange>> {
    ranges
        .map(|range| {
            let bytes = transcript.get(range.clone()).ok_or(
                Alpha15AdapterError::DisclosureProfileViolation(
                    "alpha.15 disclosed range is outside the transcript",
                ),
            )?;
            Ok(RevealedRange {
                start: range.start as u64,
                length: range.len() as u64,
                bytes: bytes.to_vec(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use uuid::Uuid;

    fn mock_binding() -> String {
        let session = Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000").unwrap();
        let nonce = [0x42_u8; 32];
        let mut bytes = Vec::new();
        bytes.extend_from_slice(crate::BINDING_PREFIX);
        bytes.extend_from_slice(&16_u16.to_be_bytes());
        bytes.extend_from_slice(session.as_bytes());
        bytes.extend_from_slice(&32_u16.to_be_bytes());
        bytes.extend_from_slice(&nonce);
        URL_SAFE_NO_PAD.encode(bytes)
    }

    fn mock_output() -> Alpha15VerifiedOutput {
        let binding = mock_binding();
        let request = format!(
            "POST {REQUIRE_INFO_TARGET} HTTP/1.1\r\nHost: game.example.test\r\nX-FUSOU-Attestation-Binding: {binding}\r\nContent-Length: 0\r\n\r\n"
        )
        .into_bytes();
        let response_body =
            b"svdata={\"api_result\":1,\"api_data\":{\"api_basic\":{\"api_member_id\":16189463}}}";
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n",
            response_body.len()
        )
        .into_bytes();
        response.extend_from_slice(response_body);
        Alpha15VerifiedOutput {
            server_identity: "game.example.test".to_owned(),
            attestation_id: [0x11_u8; MAX_ATTESTATION_ID_BYTES],
            sent_digest: sha256(&request),
            sent_ranges: vec![RevealedRange {
                start: 0,
                length: request.len() as u64,
                bytes: request.clone(),
            }],
            sent_transcript: request,
            received_digest: sha256(&response),
            received_ranges: vec![RevealedRange {
                start: 0,
                length: response.len() as u64,
                bytes: response.clone(),
            }],
            received_transcript: response,
        }
    }

    #[test]
    fn real_alpha15_fixture_verifies_with_pinned_backend() {
        let transcript = verify_alpha15_presentation(include_bytes!(
            "../fixtures/tlsn-alpha15-upstream-presentation.bin"
        ))
        .unwrap();
        assert_eq!(
            transcript.attestation_id(),
            &[
                0xef, 0xfe, 0x1a, 0x31, 0x6b, 0x1c, 0x91, 0xb4, 0x1f, 0x62, 0x84, 0xf7, 0x84, 0x09,
                0xc6, 0xc2,
            ]
        );
        assert_eq!(transcript.server_identity(), "tlsnotary.org");
        assert_eq!(
            transcript.request_transcript_sha256(),
            &[
                0xc3, 0x63, 0xbe, 0x30, 0x7b, 0x84, 0xf4, 0x38, 0x9c, 0xf1, 0x23, 0xe9, 0x7d, 0x68,
                0xf0, 0x66, 0x60, 0x0c, 0x09, 0x64, 0xd3, 0xae, 0x4d, 0x1d, 0x9b, 0x2b, 0x67, 0xe2,
                0xe6, 0x92, 0x38, 0xf8
            ]
        );
        assert_eq!(
            transcript.response_transcript_sha256(),
            &[
                0xb4, 0xbb, 0x12, 0x6c, 0x97, 0x9e, 0xee, 0xb4, 0xd6, 0x83, 0x2d, 0x3b, 0xb9, 0x78,
                0x49, 0xb9, 0xe9, 0x98, 0x47, 0x49, 0x08, 0xe6, 0x50, 0x0b, 0x2a, 0x2c, 0xcb, 0xef,
                0xf2, 0x5b, 0x26, 0x2f
            ]
        );
        assert_eq!(
            transcript.revealed_request_ranges(),
            &[RevealedRange {
                start: 0,
                length: 35,
                bytes: b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n".to_vec(),
            }]
        );
        assert_eq!(
            transcript.revealed_response_ranges(),
            &[RevealedRange {
                start: 0,
                length: 145,
                bytes: b"HTTP/1.1 200 OK\r\nCookie: very-secret-cookie\r\nContent-Length: 44\r\nContent-Type: application/json\r\n\r\n{\"foo\": \"bar\", \"bazz\": 123, \"buzz\": [1,\"5\"]}\r\n".to_vec(),
            }]
        );
        let profile =
            RequireInfoDisclosureProfile::for_mock_tlsn_verification("tlsnotary.org").unwrap();
        assert!(matches!(
            transcript.verify_require_info(&profile, &ParserLimits::default()),
            Err(Alpha15AdapterError::Parser(VerifierError::InvalidHttp(
                "unexpected start line"
            )))
        ));
    }

    #[test]
    fn rejects_modified_truncated_and_trailing_alpha15_presentations() {
        let fixture = include_bytes!("../fixtures/tlsn-alpha15-upstream-presentation.bin");

        let mut modified = fixture.to_vec();
        let modified_index = modified.len() / 2;
        modified[modified_index] ^= 1;
        assert!(verify_alpha15_presentation(&modified).is_err());

        assert!(verify_alpha15_presentation(&fixture[..fixture.len() - 1]).is_err());

        let mut trailing = fixture.to_vec();
        trailing.push(0);
        assert!(verify_alpha15_presentation(&trailing).is_err());
    }

    #[test]
    fn rejects_invalid_alpha15_encoding() {
        assert!(verify_alpha15_presentation(b"not-a-presentation").is_err());
    }

    #[test]
    fn mock_tlsn_verification_plumbing_reaches_strict_parser() {
        let transcript = AuthenticatedTranscript::from_verified_alpha15(mock_output()).unwrap();
        let profile =
            RequireInfoDisclosureProfile::for_mock_tlsn_verification("game.example.test").unwrap();
        let result = transcript
            .verify_require_info(&profile, &ParserLimits::default())
            .unwrap();
        assert_eq!(result.verified_member_id, "16189463");
        assert_eq!(result.attestation_id, [0x11_u8; MAX_ATTESTATION_ID_BYTES]);
    }

    #[test]
    fn rejects_wrong_allowlisted_server_identity() {
        let transcript = AuthenticatedTranscript::from_verified_alpha15(mock_output()).unwrap();
        let profile =
            RequireInfoDisclosureProfile::for_mock_tlsn_verification("other.example.test").unwrap();
        assert_eq!(
            transcript.verify_require_info(&profile, &ParserLimits::default()),
            Err(Alpha15AdapterError::ServerIdentityNotAllowlisted)
        );
    }

    #[test]
    fn rejects_modified_authenticated_bytes_and_wrong_ranges() {
        let mut output = mock_output();
        let last_index = output.received_transcript.len() - 1;
        output.received_transcript[last_index] ^= 1;
        assert!(AuthenticatedTranscript::from_verified_alpha15(output).is_err());

        let mut output = mock_output();
        output.sent_ranges[0].bytes[0] = b'G';
        assert!(AuthenticatedTranscript::from_verified_alpha15(output).is_err());

        let mut output = mock_output();
        output.received_ranges[0].start = 1;
        assert!(AuthenticatedTranscript::from_verified_alpha15(output).is_err());
    }

    #[test]
    fn rejects_modified_digest_and_partial_authenticated_coverage() {
        let mut output = mock_output();
        output.sent_digest[0] ^= 1;
        assert!(AuthenticatedTranscript::from_verified_alpha15(output).is_err());

        let mut output = mock_output();
        let request = output.sent_transcript.clone();
        output.sent_ranges = vec![RevealedRange {
            start: 0,
            length: request.len() as u64 - 1,
            bytes: request[..request.len() - 1].to_vec(),
        }];
        assert!(matches!(
            AuthenticatedTranscript::from_verified_alpha15(output),
            Err(Alpha15AdapterError::DisclosureProfileViolation(_))
        ));
    }

    #[test]
    fn keeps_request_and_response_in_one_authenticated_object() {
        let transcript = AuthenticatedTranscript::from_verified_alpha15(mock_output()).unwrap();
        assert_eq!(
            transcript.request_transcript_sha256(),
            &sha256(&transcript.sent.transcript)
        );
        assert_eq!(
            transcript.response_transcript_sha256(),
            &sha256(&transcript.received.transcript)
        );
    }

    #[test]
    fn production_allowlist_fails_closed_until_registry_is_linked() {
        assert_eq!(
            RequireInfoDisclosureProfile::from_configured_allowlist("game.example.test"),
            Err(Alpha15AdapterError::ServerIdentityNotAllowlisted)
        );
    }

    #[test]
    fn builds_result_from_authenticated_digests_and_binding() {
        let transcript = AuthenticatedTranscript::from_verified_alpha15(mock_output()).unwrap();
        let profile =
            RequireInfoDisclosureProfile::for_mock_tlsn_verification("game.example.test").unwrap();
        let authenticated = transcript
            .verify_require_info(&profile, &ParserLimits::default())
            .unwrap();
        let result = authenticated
            .into_verifier_result(
                [0x22_u8; 32],
                "verifier-alpha15-test".to_owned(),
                "notary-alpha15-test".to_owned(),
                [0x33_u8; 64],
            )
            .unwrap();
        assert_eq!(
            result.request_transcript_size,
            mock_output().sent_transcript.len() as u64
        );
        assert_eq!(result.tlsn_attestation_id, vec![0x11_u8; 16]);
        assert_eq!(result.binding_nonce, [0x42_u8; 32]);
        assert!(result.canonical_json().is_ok());
    }
}
