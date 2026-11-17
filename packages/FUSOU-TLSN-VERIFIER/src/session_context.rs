use crate::{parse_binding_value, sha256, validate_key_id};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ring::signature::{UnparsedPublicKey, ED25519};
use std::{collections::HashSet, sync::Mutex};
use thiserror::Error;
use tlsn_attestation::Extension;
use uuid::Uuid;

pub const SESSION_CONTEXT_GRANT_PREFIX: &[u8] = b"FUSOU-TLSN-SESSION-CONTEXT-GRANT-V1\0";
pub const SESSION_CONTEXT_GRANT_EXTENSION_ID: &[u8] = b"fusou.session-context.grant.v1";
pub const NOTARY_SESSION_CONTEXT_ACCEPTED_PREFIX: &[u8] =
    b"FUSOU-TLSN-NOTARY-SESSION-CONTEXT-ACCEPTED-V1\0";
pub const NOTARY_SESSION_CONTEXT_ACCEPTED_EXTENSION_ID: &[u8] =
    b"fusou.notary.session-context.accepted.v1";
pub const SESSION_CONTEXT_PURPOSE: &str = "fusou-require-info-v3-session-binding";
pub const NOTARY_SESSION_CONTEXT_POLICY_ID: &str = "fusou-tlsn-notary-session-binding-v1";
pub const MAX_SESSION_CONTEXT_GRANT_BYTES: usize = 2048;

const SESSION_CONTEXT_GRANT_VERSION: u16 = 1;
const NOTARY_SESSION_CONTEXT_VERSION: u16 = 1;
const ED25519_SPKI_PREFIX: &[u8] = b"\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00";
const DEVICE_COMMITMENT_PREFIX: &[u8] = b"FUSOU-SESSION-DEVICE-COMMITMENT-V1\0";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SessionContextError {
    #[error("invalid Session Authority context grant: {0}")]
    InvalidGrant(&'static str),
    #[error("Session Authority context grant signature is invalid")]
    InvalidSignature,
    #[error("Session Authority context grant does not match the pinned authority")]
    AuthorityMismatch,
    #[error("Notary context extensions are missing, duplicated, or unexpected")]
    InvalidExtensions,
    #[error("Notary context acceptance does not match its Session Authority grant")]
    InvalidAcceptance,
    #[error("Session Authority context grant has already been consumed")]
    Replayed,
    #[error("Notary context replay ledger is unavailable")]
    LedgerUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionContextGrant {
    signer_key_id: String,
    session_id: String,
    binding_value: String,
    device_id_sha256: [u8; 32],
    device_challenge: [u8; 32],
    issued_at_ms: u64,
    expires_at_ms: u64,
    signature: [u8; 64],
    signing_bytes: Vec<u8>,
    encoded: Vec<u8>,
}

impl SessionContextGrant {
    pub fn parse(encoded: &[u8]) -> Result<Self, SessionContextError> {
        if encoded.len() > MAX_SESSION_CONTEXT_GRANT_BYTES
            || !encoded.starts_with(SESSION_CONTEXT_GRANT_PREFIX)
        {
            return Err(SessionContextError::InvalidGrant("invalid size or domain"));
        }
        let mut reader = GrantReader {
            bytes: encoded,
            position: SESSION_CONTEXT_GRANT_PREFIX.len(),
        };
        if reader.read_u16()? != SESSION_CONTEXT_GRANT_VERSION {
            return Err(SessionContextError::InvalidGrant("unsupported version"));
        }
        let signer_key_id = reader.read_ascii_field(64)?;
        validate_key_id(&signer_key_id)
            .map_err(|_| SessionContextError::InvalidGrant("invalid signer key ID"))?;
        if reader.read_ascii_field(128)? != SESSION_CONTEXT_PURPOSE {
            return Err(SessionContextError::InvalidGrant("unexpected purpose"));
        }
        let session_id = reader.read_ascii_field(36)?;
        let parsed_session_id = Uuid::parse_str(&session_id)
            .map_err(|_| SessionContextError::InvalidGrant("invalid session ID"))?;
        if parsed_session_id.get_version_num() != 4 || parsed_session_id.to_string() != session_id {
            return Err(SessionContextError::InvalidGrant("noncanonical session ID"));
        }
        let binding_value = reader.read_ascii_field(512)?;
        let binding = parse_binding_value(&binding_value)
            .map_err(|_| SessionContextError::InvalidGrant("invalid binding value"))?;
        if binding.session_id != parsed_session_id {
            return Err(SessionContextError::InvalidGrant(
                "binding does not name the granted session",
            ));
        }
        let device_id_sha256 = reader.read_fixed::<32>()?;
        let device_challenge = reader.read_fixed::<32>()?;
        let issued_at_ms = reader.read_u64()?;
        let expires_at_ms = reader.read_u64()?;
        if expires_at_ms <= issued_at_ms {
            return Err(SessionContextError::InvalidGrant(
                "grant expiration does not follow issuance",
            ));
        }
        let signing_end = reader.position;
        let signature = reader.read_fixed::<64>()?;
        if reader.position != encoded.len() {
            return Err(SessionContextError::InvalidGrant("trailing bytes"));
        }
        Ok(Self {
            signer_key_id,
            session_id,
            binding_value,
            device_id_sha256,
            device_challenge,
            issued_at_ms,
            expires_at_ms,
            signature,
            signing_bytes: encoded[..signing_end].to_vec(),
            encoded: encoded.to_vec(),
        })
    }

    pub fn signing_bytes_for(
        signer_key_id: &str,
        session_id: &str,
        binding_value: &str,
        device_id_sha256: [u8; 32],
        device_challenge: [u8; 32],
        issued_at_ms: u64,
        expires_at_ms: u64,
    ) -> Result<Vec<u8>, SessionContextError> {
        validate_key_id(signer_key_id)
            .map_err(|_| SessionContextError::InvalidGrant("invalid signer key ID"))?;
        let session_id_text = session_id;
        let session_id = Uuid::parse_str(session_id_text)
            .map_err(|_| SessionContextError::InvalidGrant("invalid session ID"))?;
        if session_id.get_version_num() != 4 || session_id.to_string() != session_id_text {
            return Err(SessionContextError::InvalidGrant("noncanonical session ID"));
        }
        let binding = parse_binding_value(binding_value)
            .map_err(|_| SessionContextError::InvalidGrant("invalid binding value"))?;
        if binding.session_id != session_id || expires_at_ms <= issued_at_ms {
            return Err(SessionContextError::InvalidGrant(
                "grant identity or time fields are inconsistent",
            ));
        }
        let mut output = SESSION_CONTEXT_GRANT_PREFIX.to_vec();
        output.extend_from_slice(&SESSION_CONTEXT_GRANT_VERSION.to_be_bytes());
        append_field(&mut output, signer_key_id.as_bytes())?;
        append_field(&mut output, SESSION_CONTEXT_PURPOSE.as_bytes())?;
        append_field(&mut output, session_id.to_string().as_bytes())?;
        append_field(&mut output, binding_value.as_bytes())?;
        output.extend_from_slice(&device_id_sha256);
        output.extend_from_slice(&device_challenge);
        output.extend_from_slice(&issued_at_ms.to_be_bytes());
        output.extend_from_slice(&expires_at_ms.to_be_bytes());
        if output.len() + 64 > MAX_SESSION_CONTEXT_GRANT_BYTES {
            return Err(SessionContextError::InvalidGrant(
                "grant exceeds size limit",
            ));
        }
        Ok(output)
    }

    pub fn verify(
        &self,
        public_key_spki: &[u8],
        expected_key_id: &str,
    ) -> Result<(), SessionContextError> {
        if self.signer_key_id != expected_key_id
            || public_key_spki.len() != ED25519_SPKI_PREFIX.len() + 32
            || !public_key_spki.starts_with(ED25519_SPKI_PREFIX)
        {
            return Err(SessionContextError::AuthorityMismatch);
        }
        UnparsedPublicKey::new(&ED25519, &public_key_spki[ED25519_SPKI_PREFIX.len()..])
            .verify(&self.signing_bytes, &self.signature)
            .map_err(|_| SessionContextError::InvalidSignature)
    }

    pub fn signer_key_id(&self) -> &str {
        &self.signer_key_id
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn binding_value(&self) -> &str {
        &self.binding_value
    }

    pub fn device_id_sha256(&self) -> &[u8; 32] {
        &self.device_id_sha256
    }

    pub fn device_challenge(&self) -> &[u8; 32] {
        &self.device_challenge
    }

    pub fn issued_at_ms(&self) -> u64 {
        self.issued_at_ms
    }

    pub fn expires_at_ms(&self) -> u64 {
        self.expires_at_ms
    }

    pub fn encoded(&self) -> &[u8] {
        &self.encoded
    }

    pub fn digest(&self) -> [u8; 32] {
        sha256(&self.encoded)
    }

    pub fn signing_bytes(&self) -> &[u8] {
        &self.signing_bytes
    }

    pub fn signature(&self) -> &[u8; 64] {
        &self.signature
    }
}

pub fn device_id_commitment(device_id: &str) -> Result<[u8; 32], SessionContextError> {
    let device_id_text = device_id;
    let device_id = Uuid::parse_str(device_id_text)
        .map_err(|_| SessionContextError::InvalidGrant("invalid device ID"))?;
    let canonical = device_id.to_string();
    if canonical != device_id_text || device_id.get_version_num() != 4 {
        return Err(SessionContextError::InvalidGrant(
            "device ID is not a canonical UUIDv4",
        ));
    }
    let mut bytes = DEVICE_COMMITMENT_PREFIX.to_vec();
    bytes.extend_from_slice(canonical.as_bytes());
    Ok(sha256(&bytes))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotarySessionContextAcceptance {
    policy_id: String,
    grant_sha256: [u8; 32],
    validated_at_ms: u64,
}

impl NotarySessionContextAcceptance {
    pub fn parse(encoded: &[u8]) -> Result<Self, SessionContextError> {
        if !encoded.starts_with(NOTARY_SESSION_CONTEXT_ACCEPTED_PREFIX) {
            return Err(SessionContextError::InvalidAcceptance);
        }
        let mut reader = GrantReader {
            bytes: encoded,
            position: NOTARY_SESSION_CONTEXT_ACCEPTED_PREFIX.len(),
        };
        if reader
            .read_u16()
            .map_err(|_| SessionContextError::InvalidAcceptance)?
            != NOTARY_SESSION_CONTEXT_VERSION
        {
            return Err(SessionContextError::InvalidAcceptance);
        }
        let policy_id = reader
            .read_ascii_field(128)
            .map_err(|_| SessionContextError::InvalidAcceptance)?;
        if policy_id != NOTARY_SESSION_CONTEXT_POLICY_ID {
            return Err(SessionContextError::InvalidAcceptance);
        }
        let grant_sha256 = reader
            .read_fixed::<32>()
            .map_err(|_| SessionContextError::InvalidAcceptance)?;
        let validated_at_ms = reader
            .read_u64()
            .map_err(|_| SessionContextError::InvalidAcceptance)?;
        if reader.position != encoded.len() {
            return Err(SessionContextError::InvalidAcceptance);
        }
        Ok(Self {
            policy_id,
            grant_sha256,
            validated_at_ms,
        })
    }

    fn encode(grant_sha256: [u8; 32], validated_at_ms: u64) -> Vec<u8> {
        let mut output = NOTARY_SESSION_CONTEXT_ACCEPTED_PREFIX.to_vec();
        output.extend_from_slice(&NOTARY_SESSION_CONTEXT_VERSION.to_be_bytes());
        let policy_id = NOTARY_SESSION_CONTEXT_POLICY_ID.as_bytes();
        output.extend_from_slice(&(policy_id.len() as u16).to_be_bytes());
        output.extend_from_slice(policy_id);
        output.extend_from_slice(&grant_sha256);
        output.extend_from_slice(&validated_at_ms.to_be_bytes());
        output
    }

    pub fn validated_at_ms(&self) -> u64 {
        self.validated_at_ms
    }

    pub fn policy_id(&self) -> &str {
        &self.policy_id
    }

    pub fn extension(&self) -> Extension {
        Extension {
            id: NOTARY_SESSION_CONTEXT_ACCEPTED_EXTENSION_ID.to_vec(),
            value: Self::encode(self.grant_sha256, self.validated_at_ms),
        }
    }

    pub fn from_persisted_authority_claim(
        grant: &SessionContextGrant,
        validated_at_ms: u64,
    ) -> Result<Self, SessionContextError> {
        if validated_at_ms < grant.issued_at_ms || validated_at_ms >= grant.expires_at_ms {
            return Err(SessionContextError::InvalidAcceptance);
        }
        Ok(Self {
            policy_id: NOTARY_SESSION_CONTEXT_POLICY_ID.to_owned(),
            grant_sha256: grant.digest(),
            validated_at_ms,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedSessionContext {
    pub grant: SessionContextGrant,
    pub acceptance: NotarySessionContextAcceptance,
}

pub fn verify_authenticated_presentation_extensions(
    extensions: &[Extension],
    session_authority_public_key_spki: &[u8],
    session_authority_key_id: &str,
) -> Result<VerifiedSessionContext, SessionContextError> {
    if extensions.len() != 2 {
        return Err(SessionContextError::InvalidExtensions);
    }
    let mut grant = None;
    let mut acceptance = None;
    for extension in extensions {
        if extension.id == SESSION_CONTEXT_GRANT_EXTENSION_ID {
            if grant.is_some() {
                return Err(SessionContextError::InvalidExtensions);
            }
            grant = Some(SessionContextGrant::parse(&extension.value)?);
        } else if extension.id == NOTARY_SESSION_CONTEXT_ACCEPTED_EXTENSION_ID {
            if acceptance.is_some() {
                return Err(SessionContextError::InvalidExtensions);
            }
            acceptance = Some(NotarySessionContextAcceptance::parse(&extension.value)?);
        } else {
            return Err(SessionContextError::InvalidExtensions);
        }
    }
    let grant = grant.ok_or(SessionContextError::InvalidExtensions)?;
    let acceptance = acceptance.ok_or(SessionContextError::InvalidExtensions)?;
    grant.verify(session_authority_public_key_spki, session_authority_key_id)?;
    if acceptance.grant_sha256 != grant.digest()
        || acceptance.validated_at_ms < grant.issued_at_ms
        || acceptance.validated_at_ms >= grant.expires_at_ms
    {
        return Err(SessionContextError::InvalidAcceptance);
    }
    Ok(VerifiedSessionContext { grant, acceptance })
}

pub struct NotarySessionContextLedger {
    consumed_grants: Mutex<HashSet<[u8; 32]>>,
}

impl Default for NotarySessionContextLedger {
    fn default() -> Self {
        Self {
            consumed_grants: Mutex::new(HashSet::new()),
        }
    }
}

impl NotarySessionContextLedger {
    pub fn validate_request_extensions(
        &self,
        extensions: &[Extension],
        session_authority_public_key_spki: &[u8],
        session_authority_key_id: &str,
        now_ms: u64,
    ) -> Result<NotarySessionContextAcceptance, SessionContextError> {
        if extensions.len() != 1 || extensions[0].id != SESSION_CONTEXT_GRANT_EXTENSION_ID {
            return Err(SessionContextError::InvalidExtensions);
        }
        let grant = SessionContextGrant::parse(&extensions[0].value)?;
        grant.verify(session_authority_public_key_spki, session_authority_key_id)?;
        if now_ms < grant.issued_at_ms || now_ms >= grant.expires_at_ms {
            return Err(SessionContextError::InvalidGrant(
                "grant is outside its validity window",
            ));
        }
        let digest = grant.digest();
        let mut consumed = self
            .consumed_grants
            .lock()
            .map_err(|_| SessionContextError::LedgerUnavailable)?;
        if !consumed.insert(digest) {
            return Err(SessionContextError::Replayed);
        }
        Ok(NotarySessionContextAcceptance {
            policy_id: NOTARY_SESSION_CONTEXT_POLICY_ID.to_owned(),
            grant_sha256: digest,
            validated_at_ms: now_ms,
        })
    }

    pub fn acceptance_extension(acceptance: &NotarySessionContextAcceptance) -> Extension {
        acceptance.extension()
    }
}

pub fn encode_grant_base64url(grant: &SessionContextGrant) -> String {
    URL_SAFE_NO_PAD.encode(grant.encoded())
}

fn append_field(output: &mut Vec<u8>, field: &[u8]) -> Result<(), SessionContextError> {
    if field.len() > u16::MAX as usize {
        return Err(SessionContextError::InvalidGrant(
            "field exceeds size limit",
        ));
    }
    output.extend_from_slice(&(field.len() as u16).to_be_bytes());
    output.extend_from_slice(field);
    Ok(())
}

struct GrantReader<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl GrantReader<'_> {
    fn read_u16(&mut self) -> Result<u16, SessionContextError> {
        let bytes = self.read_fixed::<2>()?;
        Ok(u16::from_be_bytes(bytes))
    }

    fn read_u64(&mut self) -> Result<u64, SessionContextError> {
        let bytes = self.read_fixed::<8>()?;
        Ok(u64::from_be_bytes(bytes))
    }

    fn read_fixed<const N: usize>(&mut self) -> Result<[u8; N], SessionContextError> {
        let end = self
            .position
            .checked_add(N)
            .filter(|end| *end <= self.bytes.len())
            .ok_or(SessionContextError::InvalidGrant("truncated field"))?;
        let mut output = [0; N];
        output.copy_from_slice(&self.bytes[self.position..end]);
        self.position = end;
        Ok(output)
    }

    fn read_ascii_field(&mut self, max_bytes: usize) -> Result<String, SessionContextError> {
        let length = usize::from(self.read_u16()?);
        if length == 0 || length > max_bytes {
            return Err(SessionContextError::InvalidGrant(
                "field is empty or oversized",
            ));
        }
        let end = self
            .position
            .checked_add(length)
            .filter(|end| *end <= self.bytes.len())
            .ok_or(SessionContextError::InvalidGrant("truncated field"))?;
        let field = &self.bytes[self.position..end];
        self.position = end;
        let value = std::str::from_utf8(field)
            .map_err(|_| SessionContextError::InvalidGrant("field is not UTF-8"))?;
        if !value.is_ascii() || value.bytes().any(|byte| byte < 0x20 || byte == 0x7f) {
            return Err(SessionContextError::InvalidGrant(
                "field is not printable ASCII",
            ));
        }
        Ok(value.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{Ed25519KeyPair, KeyPair as _};
    use uuid::Uuid;

    const KEY_ID: &str = "session-authority-test-v1";
    const DEVICE_ID: &str = "22222222-2222-4222-8222-222222222222";

    struct SignedGrant {
        public_key_spki: Vec<u8>,
        grant: SessionContextGrant,
    }

    fn signed_grant() -> SignedGrant {
        let session_id = Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000").unwrap();
        let mut binding_bytes = crate::BINDING_PREFIX.to_vec();
        binding_bytes.extend_from_slice(&16_u16.to_be_bytes());
        binding_bytes.extend_from_slice(session_id.as_bytes());
        binding_bytes.extend_from_slice(&32_u16.to_be_bytes());
        binding_bytes.extend_from_slice(&[0x42; 32]);
        let binding_value = URL_SAFE_NO_PAD.encode(binding_bytes);
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[0x51; 32]).unwrap();
        let mut public_key_spki = ED25519_SPKI_PREFIX.to_vec();
        public_key_spki.extend_from_slice(key_pair.public_key().as_ref());
        let signing_bytes = SessionContextGrant::signing_bytes_for(
            KEY_ID,
            &session_id.to_string(),
            &binding_value,
            device_id_commitment(DEVICE_ID).unwrap(),
            [0x33; 32],
            1_000,
            2_000,
        )
        .unwrap();
        let signature = key_pair.sign(&signing_bytes);
        let mut encoded = signing_bytes;
        encoded.extend_from_slice(signature.as_ref());
        SignedGrant {
            public_key_spki,
            grant: SessionContextGrant::parse(&encoded).unwrap(),
        }
    }

    #[test]
    fn matches_the_shared_worker_session_context_vector() {
        let vector: serde_json::Value = serde_json::from_str(include_str!(
            "../fixtures/session-context-grant-v1-vector.json"
        ))
        .unwrap();
        let signed = signed_grant();
        assert_eq!(
            URL_SAFE_NO_PAD.encode(signed.grant.signing_bytes()),
            vector["signing_bytes"].as_str().unwrap()
        );
        assert_eq!(
            URL_SAFE_NO_PAD.encode(signed.grant.encoded()),
            vector["grant"].as_str().unwrap()
        );
        assert_eq!(
            URL_SAFE_NO_PAD.encode(signed.public_key_spki),
            vector["public_key_spki"].as_str().unwrap()
        );
        assert_eq!(
            URL_SAFE_NO_PAD.encode(signed.grant.digest()),
            vector["grant_sha256"].as_str().unwrap()
        );
    }

    #[test]
    fn validates_signed_grant_and_rejects_reuse() {
        let signed = signed_grant();
        signed
            .grant
            .verify(&signed.public_key_spki, KEY_ID)
            .unwrap();
        let ledger = NotarySessionContextLedger::default();
        let request_extension = Extension {
            id: SESSION_CONTEXT_GRANT_EXTENSION_ID.to_vec(),
            value: signed.grant.encoded().to_vec(),
        };
        let acceptance = ledger
            .validate_request_extensions(
                std::slice::from_ref(&request_extension),
                &signed.public_key_spki,
                KEY_ID,
                1_500,
            )
            .unwrap();
        assert_eq!(
            ledger.validate_request_extensions(
                &[request_extension],
                &signed.public_key_spki,
                KEY_ID,
                1_500,
            ),
            Err(SessionContextError::Replayed)
        );

        let verified = verify_authenticated_presentation_extensions(
            &[
                Extension {
                    id: SESSION_CONTEXT_GRANT_EXTENSION_ID.to_vec(),
                    value: signed.grant.encoded().to_vec(),
                },
                NotarySessionContextLedger::acceptance_extension(&acceptance),
            ],
            &signed.public_key_spki,
            KEY_ID,
        )
        .unwrap();
        assert_eq!(verified.grant, signed.grant);
        assert_eq!(
            verified.acceptance.policy_id(),
            NOTARY_SESSION_CONTEXT_POLICY_ID
        );
        assert_eq!(verified.acceptance.validated_at_ms(), 1_500);
    }

    #[test]
    fn rejects_tampered_expired_and_unpinned_grants() {
        let signed = signed_grant();
        let mut tampered = signed.grant.encoded().to_vec();
        *tampered.last_mut().unwrap() ^= 1;
        let tampered = SessionContextGrant::parse(&tampered).unwrap();
        assert_eq!(
            tampered.verify(&signed.public_key_spki, KEY_ID),
            Err(SessionContextError::InvalidSignature)
        );

        let ledger = NotarySessionContextLedger::default();
        let extension = Extension {
            id: SESSION_CONTEXT_GRANT_EXTENSION_ID.to_vec(),
            value: signed.grant.encoded().to_vec(),
        };
        assert!(matches!(
            ledger.validate_request_extensions(
                std::slice::from_ref(&extension),
                &signed.public_key_spki,
                KEY_ID,
                2_000,
            ),
            Err(SessionContextError::InvalidGrant(_))
        ));
        assert_eq!(
            signed.grant.verify(&signed.public_key_spki, "other-key"),
            Err(SessionContextError::AuthorityMismatch)
        );
    }

    #[test]
    fn rejects_malformed_and_unknown_version_context_encodings() {
        let signed = signed_grant();
        let mut unknown_grant_version = signed.grant.signing_bytes().to_vec();
        unknown_grant_version[SESSION_CONTEXT_GRANT_PREFIX.len() + 1] = 2;
        assert!(matches!(
            SessionContextGrant::parse(&unknown_grant_version),
            Err(SessionContextError::InvalidGrant("unsupported version"))
        ));

        let mut trailing_grant_bytes = signed.grant.encoded().to_vec();
        trailing_grant_bytes.push(0);
        assert!(matches!(
            SessionContextGrant::parse(&trailing_grant_bytes),
            Err(SessionContextError::InvalidGrant("trailing bytes"))
        ));
        assert!(matches!(
            SessionContextGrant::parse(&signed.grant.encoded()[..signed.grant.encoded().len() - 1]),
            Err(SessionContextError::InvalidGrant(_))
        ));

        let ledger = NotarySessionContextLedger::default();
        let extension = Extension {
            id: SESSION_CONTEXT_GRANT_EXTENSION_ID.to_vec(),
            value: signed.grant.encoded().to_vec(),
        };
        let acceptance = ledger
            .validate_request_extensions(&[extension], &signed.public_key_spki, KEY_ID, 1_500)
            .unwrap();
        let mut encoded_acceptance =
            NotarySessionContextLedger::acceptance_extension(&acceptance).value;
        encoded_acceptance[NOTARY_SESSION_CONTEXT_ACCEPTED_PREFIX.len() + 1] = 2;
        assert_eq!(
            NotarySessionContextAcceptance::parse(&encoded_acceptance),
            Err(SessionContextError::InvalidAcceptance)
        );
    }

    #[test]
    fn rejects_missing_duplicate_unknown_and_mismatched_extensions() {
        let signed = signed_grant();
        let ledger = NotarySessionContextLedger::default();
        let grant_extension = Extension {
            id: SESSION_CONTEXT_GRANT_EXTENSION_ID.to_vec(),
            value: signed.grant.encoded().to_vec(),
        };
        assert_eq!(
            ledger.validate_request_extensions(&[], &signed.public_key_spki, KEY_ID, 1_500,),
            Err(SessionContextError::InvalidExtensions)
        );
        assert_eq!(
            ledger.validate_request_extensions(
                &[grant_extension.clone(), grant_extension.clone()],
                &signed.public_key_spki,
                KEY_ID,
                1_500,
            ),
            Err(SessionContextError::InvalidExtensions)
        );
        assert_eq!(
            ledger.validate_request_extensions(
                &[Extension {
                    id: b"unknown".to_vec(),
                    value: Vec::new(),
                }],
                &signed.public_key_spki,
                KEY_ID,
                1_500,
            ),
            Err(SessionContextError::InvalidExtensions)
        );

        let acceptance = ledger
            .validate_request_extensions(
                &[grant_extension.clone()],
                &signed.public_key_spki,
                KEY_ID,
                1_500,
            )
            .unwrap();
        let mut acceptance_extension =
            NotarySessionContextLedger::acceptance_extension(&acceptance);
        let digest_offset = NOTARY_SESSION_CONTEXT_ACCEPTED_PREFIX.len()
            + 2
            + 2
            + NOTARY_SESSION_CONTEXT_POLICY_ID.len();
        acceptance_extension.value[digest_offset] ^= 1;
        assert_eq!(
            verify_authenticated_presentation_extensions(
                &[grant_extension.clone(), acceptance_extension,],
                &signed.public_key_spki,
                KEY_ID,
            ),
            Err(SessionContextError::InvalidAcceptance)
        );
        assert_eq!(
            verify_authenticated_presentation_extensions(
                &[grant_extension.clone()],
                &signed.public_key_spki,
                KEY_ID,
            ),
            Err(SessionContextError::InvalidExtensions)
        );
        assert_eq!(
            verify_authenticated_presentation_extensions(
                &[grant_extension.clone(), grant_extension],
                &signed.public_key_spki,
                KEY_ID,
            ),
            Err(SessionContextError::InvalidExtensions)
        );
    }
}
