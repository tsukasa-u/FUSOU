//! Experimental-only comparison of FUSOU Session to alpha.15 proof correlation.
//!
//! Candidate A uses a server-issued, single-use binding value that is carried
//! in the authenticated HTTP request. Candidate B intentionally fails closed:
//! alpha.15 authenticated output does not contain FUSOU Session/Challenge
//! metadata, so a database-only join is demonstrated as swappable rather than
//! accepted as cryptographic binding.

use crate::{
    tlsn_alpha15::{AuthenticatedRequireInfo, AuthenticatedTranscript},
    BINDING_PREFIX,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use std::collections::{HashMap, HashSet};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CorrelationError {
    #[error("Session ID must be UUIDv4")]
    InvalidSessionId,
    #[error("binding value has already been issued")]
    BindingAlreadyIssued,
    #[error("authenticated binding was not issued by this authority")]
    UnknownBinding,
    #[error("authenticated binding Session does not match the expected Session")]
    SessionMismatch,
    #[error("authenticated binding nonce does not match the issued nonce")]
    NonceMismatch,
    #[error("authenticated binding was already consumed")]
    BindingAlreadyConsumed,
    #[error(
        "alpha.15 authenticated output contains no cryptographic FUSOU Session/Challenge binding"
    )]
    HeaderlessSessionBindingUnavailable,
}

pub type Result<T> = std::result::Result<T, CorrelationError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssuedBinding {
    session_id: Uuid,
    binding_nonce: [u8; 32],
    value: String,
}

impl IssuedBinding {
    pub fn session_id(&self) -> Uuid {
        self.session_id
    }

    pub fn binding_nonce(&self) -> &[u8; 32] {
        &self.binding_nonce
    }

    pub fn value(&self) -> &str {
        &self.value
    }
}

#[derive(Debug, Default)]
pub struct ExperimentalBindingAuthority {
    issued: HashMap<String, IssuedBinding>,
    consumed: HashSet<String>,
}

impl ExperimentalBindingAuthority {
    pub fn issue_binding(
        &mut self,
        session_id: Uuid,
        binding_nonce: [u8; 32],
    ) -> Result<IssuedBinding> {
        if session_id.get_version_num() != 4 {
            return Err(CorrelationError::InvalidSessionId);
        }
        let value = encode_binding_value(session_id, binding_nonce);
        if self.issued.contains_key(&value) {
            return Err(CorrelationError::BindingAlreadyIssued);
        }
        let binding = IssuedBinding {
            session_id,
            binding_nonce,
            value: value.clone(),
        };
        self.issued.insert(value, binding.clone());
        Ok(binding)
    }

    pub fn consume_authenticated_require_info(
        &mut self,
        expected_session_id: Uuid,
        evidence: &AuthenticatedRequireInfo,
    ) -> Result<CorrelatedAuthenticatedProof> {
        let authenticated_binding = &evidence.binding;
        let issued = self
            .issued
            .get(&authenticated_binding.value)
            .ok_or(CorrelationError::UnknownBinding)?;
        if self.consumed.contains(&authenticated_binding.value) {
            return Err(CorrelationError::BindingAlreadyConsumed);
        }
        if issued.session_id != expected_session_id
            || authenticated_binding.session_id != expected_session_id
        {
            return Err(CorrelationError::SessionMismatch);
        }
        if issued.binding_nonce != authenticated_binding.binding_nonce {
            return Err(CorrelationError::NonceMismatch);
        }
        self.consumed.insert(authenticated_binding.value.clone());
        Ok(CorrelatedAuthenticatedProof {
            session_id: expected_session_id,
            attestation_id: evidence.attestation_id,
            verified_member_id: evidence.verified_member_id.clone(),
            request_transcript_sha256: evidence.request_transcript_sha256,
            response_transcript_sha256: evidence.response_transcript_sha256,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CorrelatedAuthenticatedProof {
    pub session_id: Uuid,
    pub attestation_id: [u8; 16],
    pub verified_member_id: String,
    pub request_transcript_sha256: [u8; 32],
    pub response_transcript_sha256: [u8; 32],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeaderlessCorrelationContext {
    pub session_id: Uuid,
    pub proof_attempt_id: Uuid,
    pub challenge_nonce: [u8; 32],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeaderlessAuthenticatedProof {
    pub attestation_id: [u8; 16],
    pub request_transcript_sha256: [u8; 32],
    pub response_transcript_sha256: [u8; 32],
    pub verified_member_id: Option<String>,
}

impl From<&AuthenticatedRequireInfo> for HeaderlessAuthenticatedProof {
    fn from(evidence: &AuthenticatedRequireInfo) -> Self {
        Self {
            attestation_id: evidence.attestation_id,
            request_transcript_sha256: evidence.request_transcript_sha256,
            response_transcript_sha256: evidence.response_transcript_sha256,
            verified_member_id: Some(evidence.verified_member_id.clone()),
        }
    }
}

impl HeaderlessAuthenticatedProof {
    pub fn from_authenticated_transcript(
        transcript: &AuthenticatedTranscript,
    ) -> HeaderlessAuthenticatedProof {
        HeaderlessAuthenticatedProof {
            attestation_id: *transcript.attestation_id(),
            request_transcript_sha256: *transcript.request_transcript_sha256(),
            response_transcript_sha256: *transcript.response_transcript_sha256(),
            verified_member_id: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnauthenticatedHeaderlessJoin {
    pub context: HeaderlessCorrelationContext,
    pub proof: HeaderlessAuthenticatedProof,
}

pub fn reject_headerless_correlation(
    _context: &HeaderlessCorrelationContext,
    _proof: &HeaderlessAuthenticatedProof,
) -> Result<()> {
    Err(CorrelationError::HeaderlessSessionBindingUnavailable)
}

#[cfg(test)]
fn naive_db_join_for_demonstration(
    context: HeaderlessCorrelationContext,
    proof: HeaderlessAuthenticatedProof,
) -> UnauthenticatedHeaderlessJoin {
    UnauthenticatedHeaderlessJoin { context, proof }
}

fn encode_binding_value(session_id: Uuid, binding_nonce: [u8; 32]) -> String {
    let mut bytes = Vec::with_capacity(BINDING_PREFIX.len() + 2 + 16 + 2 + 32);
    bytes.extend_from_slice(BINDING_PREFIX);
    bytes.extend_from_slice(&16_u16.to_be_bytes());
    bytes.extend_from_slice(session_id.as_bytes());
    bytes.extend_from_slice(&32_u16.to_be_bytes());
    bytes.extend_from_slice(&binding_nonce);
    URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        parse_binding_value, parse_require_info_request,
        prover_transport::build_require_info_request, tlsn_alpha15::AuthenticatedRequireInfo,
        ParsedBinding, ParserLimits, BINDING_HEADER,
    };

    fn session(value: &str) -> Uuid {
        Uuid::parse_str(value).unwrap()
    }

    fn authenticated_evidence(binding: ParsedBinding) -> AuthenticatedRequireInfo {
        AuthenticatedRequireInfo {
            verified_member_id: "16189463".to_owned(),
            binding,
            server_identity: "game.example.test".to_owned(),
            attestation_id: [0x11; 16],
            request_transcript_sha256: [0x21; 32],
            response_transcript_sha256: [0x22; 32],
            request_transcript_size: 128,
            response_transcript_size: 256,
            revealed_request_ranges: Vec::new(),
            revealed_response_ranges: Vec::new(),
        }
    }

    #[test]
    fn candidate_a_binds_authenticated_proof_to_one_session_and_consumes_once() {
        let session_a = session("123e4567-e89b-42d3-a456-426614174000");
        let session_b = session("123e4567-e89b-42d3-a456-426614174001");
        let mut authority = ExperimentalBindingAuthority::default();
        let issued = authority.issue_binding(session_a, [0x42; 32]).unwrap();
        let parsed = parse_binding_value(issued.value()).unwrap();
        let evidence = authenticated_evidence(parsed);

        assert_eq!(
            authority.consume_authenticated_require_info(session_b, &evidence),
            Err(CorrelationError::SessionMismatch)
        );
        let correlated = authority
            .consume_authenticated_require_info(session_a, &evidence)
            .unwrap();
        assert_eq!(correlated.session_id, session_a);
        assert_eq!(correlated.verified_member_id, "16189463");
        assert_eq!(
            authority.consume_authenticated_require_info(session_a, &evidence),
            Err(CorrelationError::BindingAlreadyConsumed)
        );
    }

    #[test]
    fn candidate_a_rejects_binding_not_issued_by_the_authority() {
        let session_a = session("123e4567-e89b-42d3-a456-426614174000");
        let session_b = session("123e4567-e89b-42d3-a456-426614174001");
        let mut authority = ExperimentalBindingAuthority::default();
        let mut bytes = [0x42; 32];
        bytes[0] = 0x43;
        let unissued = encode_binding_value(session_b, bytes);
        let evidence = authenticated_evidence(parse_binding_value(&unissued).unwrap());

        assert_eq!(
            authority.consume_authenticated_require_info(session_a, &evidence),
            Err(CorrelationError::UnknownBinding)
        );
    }

    #[test]
    fn candidate_a_header_name_is_profile_contract_not_alpha15_security() {
        let session_a = session("123e4567-e89b-42d3-a456-426614174000");
        let mut authority = ExperimentalBindingAuthority::default();
        let issued = authority.issue_binding(session_a, [0x42; 32]).unwrap();
        let request = build_require_info_request("game.example.test", issued.value()).unwrap();
        assert!(parse_require_info_request(
            &request,
            "game.example.test",
            &ParserLimits::default(),
        )
        .is_ok());

        let renamed = String::from_utf8(request.clone())
            .unwrap()
            .replace(BINDING_HEADER, "X-Experimental-Binding")
            .into_bytes();
        assert!(parse_require_info_request(
            &renamed,
            "game.example.test",
            &ParserLimits::default(),
        )
        .is_err());

        let legacy = String::from_utf8(request)
            .unwrap()
            .replace(BINDING_HEADER, "X-FUSOU-Attestation-Binding")
            .into_bytes();
        assert!(
            parse_require_info_request(&legacy, "game.example.test", &ParserLimits::default(),)
                .is_err()
        );
    }

    #[test]
    fn candidate_b_database_join_allows_the_session_swap_it_must_reject() {
        let session_a = session("123e4567-e89b-42d3-a456-426614174000");
        let session_b = session("123e4567-e89b-42d3-a456-426614174001");
        let proof_a = HeaderlessAuthenticatedProof {
            attestation_id: [0x11; 16],
            request_transcript_sha256: [0x31; 32],
            response_transcript_sha256: [0x32; 32],
            verified_member_id: Some("16189463".to_owned()),
        };
        let context_a = HeaderlessCorrelationContext {
            session_id: session_a,
            proof_attempt_id: session("223e4567-e89b-42d3-a456-426614174000"),
            challenge_nonce: [0x41; 32],
        };
        let context_b = HeaderlessCorrelationContext {
            session_id: session_b,
            proof_attempt_id: session("223e4567-e89b-42d3-a456-426614174001"),
            challenge_nonce: [0x51; 32],
        };

        let naive_join = naive_db_join_for_demonstration(context_b, proof_a.clone());
        assert_eq!(naive_join.context.session_id, session_b);
        assert_eq!(naive_join.proof, proof_a);
        assert_eq!(
            reject_headerless_correlation(&context_a, &proof_a),
            Err(CorrelationError::HeaderlessSessionBindingUnavailable)
        );
    }

    #[test]
    fn candidate_b_challenge_is_not_authenticated_when_it_is_only_local_metadata() {
        let context = HeaderlessCorrelationContext {
            session_id: session("123e4567-e89b-42d3-a456-426614174000"),
            proof_attempt_id: session("223e4567-e89b-42d3-a456-426614174000"),
            challenge_nonce: [0x42; 32],
        };
        let proof = HeaderlessAuthenticatedProof {
            attestation_id: [0x11; 16],
            request_transcript_sha256: [0x31; 32],
            response_transcript_sha256: [0x32; 32],
            verified_member_id: Some("16189463".to_owned()),
        };

        assert_eq!(
            reject_headerless_correlation(&context, &proof),
            Err(CorrelationError::HeaderlessSessionBindingUnavailable)
        );
    }

    #[test]
    fn candidate_b_alpha15_output_has_no_fusou_session_or_member_binding() {
        let transcript = crate::tlsn_alpha15::verify_alpha15_presentation(include_bytes!(
            "../fixtures/tlsn-alpha15-upstream-presentation.bin"
        ))
        .unwrap();
        let proof = HeaderlessAuthenticatedProof::from_authenticated_transcript(&transcript);
        let context = HeaderlessCorrelationContext {
            session_id: session("123e4567-e89b-42d3-a456-426614174000"),
            proof_attempt_id: session("223e4567-e89b-42d3-a456-426614174000"),
            challenge_nonce: [0x42; 32],
        };

        assert_eq!(proof.verified_member_id, None);
        assert_eq!(
            reject_headerless_correlation(&context, &proof),
            Err(CorrelationError::HeaderlessSessionBindingUnavailable)
        );
    }
}
