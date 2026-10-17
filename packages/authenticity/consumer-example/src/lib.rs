#![forbid(unsafe_code)]

use authenticity_auth::{AuthenticatedPrincipal, AuthenticationError, VerifiedDeviceProof};
use authenticity_core::Digest;
use authenticity_tlsn::VerifiedPresentation;
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum ReportError {
    #[error("verified identity, device proof, and Presentation are not bound to one another")]
    BindingMismatch,
    #[error("verification report serialization failed")]
    Serialization,
}

#[derive(Serialize)]
pub struct VerificationReport {
    schema: &'static str,
    classification: &'static str,
    self_authenticating: bool,
    checks: Vec<Check>,
    presentation: PresentationFacts,
    principal: PrincipalFacts,
    device: DeviceFacts,
}

#[derive(Serialize)]
struct Check {
    id: &'static str,
    status: &'static str,
}

#[derive(Serialize)]
struct PresentationFacts {
    upstream_revision: &'static str,
    sha256: String,
    server_identity: String,
    notary_key_id: String,
    attestation_id_hex: String,
    disclosure_count: usize,
}

#[derive(Serialize)]
struct PrincipalFacts {
    issuer: String,
    audience: String,
    session_id: String,
    expires_at: u64,
    provider_classification: &'static str,
}

#[derive(Serialize)]
struct DeviceFacts {
    device_id: String,
    challenge_id_hex: String,
    verified_at: u64,
}

impl VerificationReport {
    pub fn from_verified(
        presentation: &VerifiedPresentation,
        principal: &AuthenticatedPrincipal,
        device_proof: &VerifiedDeviceProof,
    ) -> Result<Self, ReportError> {
        let expected_digest = Digest::new(*presentation.presentation_sha256());
        if device_proof.principal_id() != principal.principal_id()
            || device_proof.session_id() != principal.session_id()
            || device_proof.evidence_digest() != expected_digest
        {
            return Err(ReportError::BindingMismatch);
        }

        Ok(Self {
            schema: "authenticity-local-report-v1",
            classification: "SYNTHETIC_FIXTURE_AND_LOCAL_TEST_PROVIDER",
            self_authenticating: false,
            checks: vec![
                Check {
                    id: "tlsn.presentation_and_notary",
                    status: "VERIFIED_BY_PINNED_CLEAN_UPSTREAM",
                },
                Check {
                    id: "tlsn.server_identity_and_web_pki",
                    status: "VERIFIED_AGAINST_EXPLICIT_MOZILLA_POLICY",
                },
                Check {
                    id: "user.authentication",
                    status: "VERIFIED_BY_LOCAL_TEST_PROVIDER_ONLY",
                },
                Check {
                    id: "device.proof_of_possession",
                    status: "VERIFIED_BY_LOCAL_TEST_REGISTRY_AND_REPLAY_STORE",
                },
                Check {
                    id: "claim_and_result_signature",
                    status: "NOT_IMPLEMENTED",
                },
                Check {
                    id: "evidence_bundle_independent_verification",
                    status: "NOT_IMPLEMENTED",
                },
                Check {
                    id: "authorization",
                    status: "NOT_CHECKED",
                },
            ],
            presentation: PresentationFacts {
                upstream_revision: presentation.upstream_revision(),
                sha256: hex(presentation.presentation_sha256()),
                server_identity: presentation.server_identity().as_str().to_owned(),
                notary_key_id: presentation.notary_key_id().to_owned(),
                attestation_id_hex: hex(presentation.attestation_id()),
                disclosure_count: presentation.disclosures().len(),
            },
            principal: PrincipalFacts {
                issuer: principal.principal_id().issuer().to_owned(),
                audience: principal.audience().to_owned(),
                session_id: principal.session_id().as_str().to_owned(),
                expires_at: principal.expires_at(),
                provider_classification: "LOCAL_TEST_PROVIDER_NOT_PRODUCTION_AUTH",
            },
            device: DeviceFacts {
                device_id: device_proof.device_id().as_str().to_owned(),
                challenge_id_hex: hex(device_proof.challenge_id().as_bytes()),
                verified_at: device_proof.verified_at(),
            },
        })
    }

    pub fn to_json(&self) -> Result<String, ReportError> {
        serde_json::to_string_pretty(self).map_err(|_| ReportError::Serialization)
    }
}

pub fn authentication_error_for_report(error: AuthenticationError) -> &'static str {
    match error {
        AuthenticationError::CredentialRejected => "credential_rejected",
        AuthenticationError::IdentityProviderUnavailable => "identity_provider_unavailable",
        AuthenticationError::IssuerOrAudienceMismatch => "issuer_or_audience_mismatch",
        AuthenticationError::InvalidAuthenticationTime => "invalid_authentication_time",
        AuthenticationError::AnonymousIdentityRejected => "anonymous_identity_rejected",
        AuthenticationError::UntrustedChallengeAuthority => "untrusted_challenge_authority",
        AuthenticationError::InvalidChallengeSignature => "invalid_challenge_signature",
        AuthenticationError::InvalidDeviceSignature => "invalid_device_signature",
        AuthenticationError::DeviceNotRegistered => "device_not_registered",
        AuthenticationError::DeviceRevoked => "device_revoked",
        AuthenticationError::ChallengeBindingMismatch => "challenge_binding_mismatch",
        AuthenticationError::InvalidChallengeTime => "invalid_challenge_time",
        AuthenticationError::ChallengeReplayed => "challenge_replayed",
        AuthenticationError::DeviceRegistryUnavailable => "device_registry_unavailable",
        AuthenticationError::ReplayStoreUnavailable => "replay_store_unavailable",
        AuthenticationError::InvalidChallenge => "invalid_challenge",
    }
}

fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}
