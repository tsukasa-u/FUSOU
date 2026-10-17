use std::{io::Cursor, ops::Range};

use authenticity_core::ServerIdentity;
use bincode::Options;
use sha2::{Digest, Sha256};
use thiserror::Error;
use tlsn_attestation::{CryptoProvider, presentation::Presentation};
use tlsn_core::transcript::{Direction, PartialTranscript};

use crate::TLSN_UPSTREAM_REVISION;

const DEFAULT_MAX_PRESENTATION_BYTES: usize = 32 * 1024 * 1024;
const MAX_DISCLOSURE_RANGES: usize = 4096;

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum TlsnVerificationError {
    #[error("Presentation is empty or exceeds the configured byte limit")]
    PresentationSize,
    #[error("Presentation decoding failed")]
    PresentationDecode,
    #[error("Presentation contains trailing bytes")]
    TrailingBytes,
    #[error("Presentation Notary key does not match the configured trust input")]
    NotaryKeyMismatch,
    #[error("server certificate trust policy is invalid")]
    InvalidServerTrust,
    #[error("TLSNotary cryptographic verification failed")]
    PresentationVerification,
    #[error("verified Presentation has no server identity or transcript")]
    MissingVerifiedOutput,
    #[error("verified server identity does not match the configured target")]
    ServerIdentityMismatch,
    #[error("verified disclosure ranges are inconsistent")]
    InvalidDisclosure,
}

pub struct TrustedNotaryKey {
    key_id: String,
    serialized_key: Vec<u8>,
}

impl TrustedNotaryKey {
    pub fn new(
        key_id: impl Into<String>,
        serialized_key: impl Into<Vec<u8>>,
    ) -> Result<Self, TlsnVerificationError> {
        let key_id = key_id.into();
        let serialized_key = serialized_key.into();
        if key_id.is_empty() || serialized_key.is_empty() || serialized_key.len() > 4096 {
            return Err(TlsnVerificationError::NotaryKeyMismatch);
        }
        Ok(Self {
            key_id,
            serialized_key,
        })
    }
}

pub enum ServerCertificateTrust {
    MozillaWebPki,
    ExplicitDerRoots(Vec<Vec<u8>>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerCertificateTrustKind {
    MozillaWebPki,
    ExplicitDerRoots { root_count: usize },
}

pub struct UntrustedPresentation<'a>(&'a [u8]);

impl<'a> UntrustedPresentation<'a> {
    pub const fn new(bytes: &'a [u8]) -> Self {
        Self(bytes)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisclosureDirection {
    Sent,
    Received,
}

pub struct VerifiedDisclosure {
    direction: DisclosureDirection,
    range: Range<usize>,
    bytes: Vec<u8>,
}

impl VerifiedDisclosure {
    pub const fn direction(&self) -> DisclosureDirection {
        self.direction
    }

    pub fn range(&self) -> Range<usize> {
        self.range.clone()
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

impl std::fmt::Debug for VerifiedDisclosure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VerifiedDisclosure")
            .field("direction", &self.direction)
            .field("range", &self.range)
            .field("byte_length", &self.bytes.len())
            .finish()
    }
}

pub struct VerifiedPresentation {
    server_identity: ServerIdentity,
    attestation_id: [u8; 16],
    notary_key_id: String,
    server_certificate_trust: ServerCertificateTrustKind,
    presentation_sha256: [u8; 32],
    sent_transcript_length: usize,
    received_transcript_length: usize,
    disclosures: Vec<VerifiedDisclosure>,
}

impl VerifiedPresentation {
    pub fn server_identity(&self) -> &ServerIdentity {
        &self.server_identity
    }

    pub const fn attestation_id(&self) -> &[u8; 16] {
        &self.attestation_id
    }

    pub fn notary_key_id(&self) -> &str {
        &self.notary_key_id
    }

    pub const fn server_certificate_trust(&self) -> ServerCertificateTrustKind {
        self.server_certificate_trust
    }

    pub const fn presentation_sha256(&self) -> &[u8; 32] {
        &self.presentation_sha256
    }

    pub const fn sent_transcript_length(&self) -> usize {
        self.sent_transcript_length
    }

    pub const fn received_transcript_length(&self) -> usize {
        self.received_transcript_length
    }

    pub fn disclosures(&self) -> &[VerifiedDisclosure] {
        &self.disclosures
    }

    pub const fn upstream_revision(&self) -> &'static str {
        TLSN_UPSTREAM_REVISION
    }
}

impl std::fmt::Debug for VerifiedPresentation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VerifiedPresentation")
            .field("server_identity", &self.server_identity)
            .field("attestation_id", &self.attestation_id)
            .field("notary_key_id", &self.notary_key_id)
            .field("server_certificate_trust", &self.server_certificate_trust)
            .field("presentation_sha256", &self.presentation_sha256)
            .field("sent_transcript_length", &self.sent_transcript_length)
            .field(
                "received_transcript_length",
                &self.received_transcript_length,
            )
            .field("disclosure_count", &self.disclosures.len())
            .finish()
    }
}

pub struct PresentationVerifier {
    trusted_notary_key: TrustedNotaryKey,
    expected_server_identity: ServerIdentity,
    server_certificate_trust: ServerCertificateTrust,
    max_presentation_bytes: usize,
}

impl PresentationVerifier {
    pub fn new(
        trusted_notary_key: TrustedNotaryKey,
        expected_server_identity: ServerIdentity,
        server_certificate_trust: ServerCertificateTrust,
        max_presentation_bytes: usize,
    ) -> Result<Self, TlsnVerificationError> {
        if max_presentation_bytes == 0 {
            return Err(TlsnVerificationError::PresentationSize);
        }
        if matches!(
            &server_certificate_trust,
            ServerCertificateTrust::ExplicitDerRoots(roots) if roots.is_empty()
        ) {
            return Err(TlsnVerificationError::InvalidServerTrust);
        }
        Ok(Self {
            trusted_notary_key,
            expected_server_identity,
            server_certificate_trust,
            max_presentation_bytes,
        })
    }

    /// Verifies untrusted serialized Presentation bytes using the configured
    /// trust inputs. The encoded-byte limit is not an aggregate heap or CPU
    /// budget for adversarial sequence lengths, so this spike is not suitable
    /// for remote attacker-controlled input or Production use.
    pub fn verify(
        &self,
        input: UntrustedPresentation<'_>,
    ) -> Result<VerifiedPresentation, TlsnVerificationError> {
        if input.0.is_empty() || input.0.len() > self.max_presentation_bytes {
            return Err(TlsnVerificationError::PresentationSize);
        }

        let mut cursor = Cursor::new(input.0);
        let presentation: Presentation = bincode::DefaultOptions::new()
            .with_fixint_encoding()
            .allow_trailing_bytes()
            .with_limit(self.max_presentation_bytes as u64)
            .deserialize_from(&mut cursor)
            .map_err(|_| TlsnVerificationError::PresentationDecode)?;
        if cursor.position() != input.0.len() as u64 {
            return Err(TlsnVerificationError::TrailingBytes);
        }

        let notary_key = bincode::serialize(presentation.verifying_key())
            .map_err(|_| TlsnVerificationError::PresentationDecode)?;
        if notary_key != self.trusted_notary_key.serialized_key {
            return Err(TlsnVerificationError::NotaryKeyMismatch);
        }

        let server_certificate_trust = match &self.server_certificate_trust {
            ServerCertificateTrust::MozillaWebPki => ServerCertificateTrustKind::MozillaWebPki,
            ServerCertificateTrust::ExplicitDerRoots(roots) => {
                ServerCertificateTrustKind::ExplicitDerRoots {
                    root_count: roots.len(),
                }
            }
        };
        let mut provider = CryptoProvider::default();
        if let ServerCertificateTrust::ExplicitDerRoots(root_der) = &self.server_certificate_trust {
            let root_store = tlsn_core::webpki::RootCertStore {
                roots: root_der
                    .iter()
                    .cloned()
                    .map(tlsn_core::webpki::CertificateDer)
                    .collect(),
            };
            provider.cert = tlsn::verifier::ServerCertVerifier::new(&root_store)
                .map_err(|_| TlsnVerificationError::InvalidServerTrust)?;
        }

        let output = presentation
            .verify(&provider)
            .map_err(|_| TlsnVerificationError::PresentationVerification)?;
        let observed_server = output
            .server_name
            .ok_or(TlsnVerificationError::MissingVerifiedOutput)?
            .to_string();
        let observed_server = ServerIdentity::new(observed_server)
            .map_err(|_| TlsnVerificationError::ServerIdentityMismatch)?;
        if observed_server != self.expected_server_identity {
            return Err(TlsnVerificationError::ServerIdentityMismatch);
        }
        let transcript = output
            .transcript
            .ok_or(TlsnVerificationError::MissingVerifiedOutput)?;
        let disclosures = extract_disclosures(&transcript)?;

        Ok(VerifiedPresentation {
            server_identity: observed_server,
            attestation_id: output.attestation.header.id.0,
            notary_key_id: self.trusted_notary_key.key_id.clone(),
            server_certificate_trust,
            presentation_sha256: Sha256::digest(input.0).into(),
            sent_transcript_length: transcript.len_sent(),
            received_transcript_length: transcript.len_received(),
            disclosures,
        })
    }
}

fn extract_disclosures(
    transcript: &PartialTranscript,
) -> Result<Vec<VerifiedDisclosure>, TlsnVerificationError> {
    let sent_range_count = transcript.sent_authed().iter().count();
    let received_range_count = transcript.received_authed().iter().count();
    if sent_range_count > MAX_DISCLOSURE_RANGES
        || received_range_count > MAX_DISCLOSURE_RANGES - sent_range_count
    {
        return Err(TlsnVerificationError::InvalidDisclosure);
    }
    let mut disclosures = Vec::with_capacity(sent_range_count + received_range_count);
    let sent_ranges: Vec<_> = transcript.sent_authed().iter().collect();
    let received_ranges: Vec<_> = transcript.received_authed().iter().collect();

    append_direction_disclosures(
        &mut disclosures,
        DisclosureDirection::Sent,
        transcript.len_sent(),
        &sent_ranges,
        transcript.iter(Direction::Sent).collect(),
    )?;
    append_direction_disclosures(
        &mut disclosures,
        DisclosureDirection::Received,
        transcript.len_received(),
        &received_ranges,
        transcript.iter(Direction::Received).collect(),
    )?;
    Ok(disclosures)
}

fn append_direction_disclosures(
    output: &mut Vec<VerifiedDisclosure>,
    direction: DisclosureDirection,
    total_length: usize,
    ranges: &[Range<usize>],
    packed_bytes: Vec<u8>,
) -> Result<(), TlsnVerificationError> {
    let mut packed_offset = 0_usize;
    let mut previous_end = 0_usize;
    for range in ranges {
        if range.start >= range.end || range.start < previous_end || range.end > total_length {
            return Err(TlsnVerificationError::InvalidDisclosure);
        }
        let next_offset = packed_offset
            .checked_add(range.len())
            .ok_or(TlsnVerificationError::InvalidDisclosure)?;
        let bytes = packed_bytes
            .get(packed_offset..next_offset)
            .ok_or(TlsnVerificationError::InvalidDisclosure)?
            .to_vec();
        output.push(VerifiedDisclosure {
            direction,
            range: range.clone(),
            bytes,
        });
        packed_offset = next_offset;
        previous_end = range.end;
    }
    if packed_offset != packed_bytes.len() {
        return Err(TlsnVerificationError::InvalidDisclosure);
    }
    Ok(())
}

pub const fn default_spike_input_limit() -> usize {
    DEFAULT_MAX_PRESENTATION_BYTES
}
