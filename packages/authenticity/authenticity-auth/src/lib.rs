#![forbid(unsafe_code)]

use async_trait::async_trait;
use authenticity_core::{
    AuthorityKeyId, ChallengeId, DeviceId, Digest, IdentityError, PrincipalId, SessionId,
};
use ed25519_dalek::{Signature, VerifyingKey};
use thiserror::Error;

const CHALLENGE_PAYLOAD_DOMAIN: &[u8] = b"AUTHENTICITY-DEVICE-CHALLENGE-V1\0";
const CHALLENGE_AUTHORITY_DOMAIN: &[u8] = b"AUTHENTICITY-CHALLENGE-AUTH-V1\0";
const DEVICE_PROOF_DOMAIN: &[u8] = b"AUTHENTICITY-DEVICE-PROOF-V1\0";

#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum AuthenticationError {
    #[error("identity provider rejected the credential")]
    CredentialRejected,
    #[error("identity provider is unavailable")]
    IdentityProviderUnavailable,
    #[error("provider returned an unexpected issuer or audience")]
    IssuerOrAudienceMismatch,
    #[error("authentication claims are expired or not yet valid")]
    InvalidAuthenticationTime,
    #[error("anonymous identity is not permitted by this policy")]
    AnonymousIdentityRejected,
    #[error("challenge authority is not trusted")]
    UntrustedChallengeAuthority,
    #[error("challenge signature is invalid")]
    InvalidChallengeSignature,
    #[error("device proof signature is invalid")]
    InvalidDeviceSignature,
    #[error("device is not registered to this principal")]
    DeviceNotRegistered,
    #[error("device registration is revoked or inactive")]
    DeviceRevoked,
    #[error("challenge does not match the authenticated request")]
    ChallengeBindingMismatch,
    #[error("challenge has expired or exceeds the configured lifetime")]
    InvalidChallengeTime,
    #[error("challenge has already been consumed")]
    ChallengeReplayed,
    #[error("device registry is unavailable")]
    DeviceRegistryUnavailable,
    #[error("replay-protection store is unavailable")]
    ReplayStoreUnavailable,
    #[error("challenge fields cannot be encoded")]
    InvalidChallenge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityProviderError {
    Rejected,
    Unavailable,
}

pub struct Credential(Vec<u8>);

impl Credential {
    pub fn new(secret: impl Into<Vec<u8>>) -> Self {
        Self(secret.into())
    }

    pub fn expose_secret(&self) -> &[u8] {
        &self.0
    }
}

impl std::fmt::Debug for Credential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Credential([redacted])")
    }
}

pub struct ProviderClaims {
    principal_id: PrincipalId,
    audience: String,
    session_id: SessionId,
    authenticated_at: u64,
    expires_at: u64,
    anonymous: bool,
}

impl ProviderClaims {
    pub fn new(
        principal_id: PrincipalId,
        audience: impl Into<String>,
        session_id: SessionId,
        authenticated_at: u64,
        expires_at: u64,
        anonymous: bool,
    ) -> Self {
        Self {
            principal_id,
            audience: audience.into(),
            session_id,
            authenticated_at,
            expires_at,
            anonymous,
        }
    }
}

#[async_trait]
/// Verifies the credential's cryptographic and provider-specific claims.
///
/// Implementations are a trusted boundary: they must validate token signatures,
/// issuer, audience, and revocation according to the provider's policy before
/// returning claims. `Authenticator` then enforces the caller's issuer,
/// audience, anonymous-identity, and time policy.
pub trait IdentityProvider: Send + Sync {
    async fn verify_credential(
        &self,
        credential: &Credential,
    ) -> Result<ProviderClaims, IdentityProviderError>;
}

pub struct AuthenticationPolicy {
    expected_issuer: String,
    expected_audience: String,
    allow_anonymous: bool,
}

impl AuthenticationPolicy {
    pub fn new(
        expected_issuer: impl Into<String>,
        expected_audience: impl Into<String>,
        allow_anonymous: bool,
    ) -> Result<Self, IdentityError> {
        let expected_issuer = expected_issuer.into();
        let expected_audience = expected_audience.into();
        if expected_issuer.trim().is_empty()
            || expected_issuer.len() > 1024
            || expected_issuer.chars().any(char::is_control)
            || expected_audience.trim().is_empty()
            || expected_audience.len() > 1024
            || expected_audience.chars().any(char::is_control)
        {
            return Err(IdentityError::InvalidIdentifier);
        }
        Ok(Self {
            expected_issuer,
            expected_audience,
            allow_anonymous,
        })
    }
}

pub struct AuthenticatedPrincipal {
    principal_id: PrincipalId,
    audience: String,
    session_id: SessionId,
    authenticated_at: u64,
    expires_at: u64,
    anonymous: bool,
}

impl AuthenticatedPrincipal {
    pub fn principal_id(&self) -> &PrincipalId {
        &self.principal_id
    }

    pub fn audience(&self) -> &str {
        &self.audience
    }

    pub fn session_id(&self) -> &SessionId {
        &self.session_id
    }

    pub fn authenticated_at(&self) -> u64 {
        self.authenticated_at
    }

    pub fn expires_at(&self) -> u64 {
        self.expires_at
    }

    pub fn is_anonymous(&self) -> bool {
        self.anonymous
    }
}

impl std::fmt::Debug for AuthenticatedPrincipal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuthenticatedPrincipal")
            .field("principal_id", &"[redacted]")
            .field("session_id", &"[redacted]")
            .field("authenticated_at", &self.authenticated_at)
            .field("expires_at", &self.expires_at)
            .field("anonymous", &self.anonymous)
            .finish()
    }
}

pub struct Authenticator;

impl Authenticator {
    pub async fn authenticate<P: IdentityProvider>(
        provider: &P,
        credential: &Credential,
        policy: &AuthenticationPolicy,
        now_unix_seconds: u64,
    ) -> Result<AuthenticatedPrincipal, AuthenticationError> {
        let claims = provider
            .verify_credential(credential)
            .await
            .map_err(|error| match error {
                IdentityProviderError::Rejected => AuthenticationError::CredentialRejected,
                IdentityProviderError::Unavailable => {
                    AuthenticationError::IdentityProviderUnavailable
                }
            })?;

        if claims.principal_id.issuer() != policy.expected_issuer
            || claims.audience != policy.expected_audience
        {
            return Err(AuthenticationError::IssuerOrAudienceMismatch);
        }
        if claims.authenticated_at > now_unix_seconds
            || claims.expires_at <= now_unix_seconds
            || claims.expires_at <= claims.authenticated_at
        {
            return Err(AuthenticationError::InvalidAuthenticationTime);
        }
        if claims.anonymous && !policy.allow_anonymous {
            return Err(AuthenticationError::AnonymousIdentityRejected);
        }

        Ok(AuthenticatedPrincipal {
            principal_id: claims.principal_id,
            audience: claims.audience,
            session_id: claims.session_id,
            authenticated_at: claims.authenticated_at,
            expires_at: claims.expires_at,
            anonymous: claims.anonymous,
        })
    }
}

pub struct ChallengeTrustAnchor {
    key_id: AuthorityKeyId,
    public_key: [u8; 32],
}

impl ChallengeTrustAnchor {
    pub const fn new(key_id: AuthorityKeyId, public_key: [u8; 32]) -> Self {
        Self { key_id, public_key }
    }
}

pub struct DeviceChallengePayload {
    authority_key_id: AuthorityKeyId,
    principal_id: PrincipalId,
    audience: String,
    session_id: SessionId,
    device_id: DeviceId,
    challenge_id: ChallengeId,
    nonce: [u8; 32],
    evidence_digest: Digest,
    purpose: String,
    issued_at: u64,
    expires_at: u64,
}

impl DeviceChallengePayload {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        authority_key_id: AuthorityKeyId,
        principal_id: PrincipalId,
        audience: impl Into<String>,
        session_id: SessionId,
        device_id: DeviceId,
        challenge_id: ChallengeId,
        nonce: [u8; 32],
        evidence_digest: Digest,
        purpose: impl Into<String>,
        issued_at: u64,
        expires_at: u64,
    ) -> Result<Self, AuthenticationError> {
        let audience = audience.into();
        let purpose = purpose.into();
        if audience.trim().is_empty()
            || audience.len() > 1024
            || audience.chars().any(char::is_control)
            || purpose.trim().is_empty()
            || purpose.len() > 256
            || purpose.chars().any(char::is_control)
        {
            return Err(AuthenticationError::InvalidChallenge);
        }
        Ok(Self {
            authority_key_id,
            principal_id,
            audience,
            session_id,
            device_id,
            challenge_id,
            nonce,
            evidence_digest,
            purpose,
            issued_at,
            expires_at,
        })
    }

    pub fn authority_key_id(&self) -> &AuthorityKeyId {
        &self.authority_key_id
    }

    pub fn principal_id(&self) -> &PrincipalId {
        &self.principal_id
    }

    pub fn session_id(&self) -> &SessionId {
        &self.session_id
    }

    pub fn audience(&self) -> &str {
        &self.audience
    }

    pub fn device_id(&self) -> &DeviceId {
        &self.device_id
    }

    pub fn challenge_id(&self) -> ChallengeId {
        self.challenge_id
    }

    pub fn evidence_digest(&self) -> Digest {
        self.evidence_digest
    }

    pub fn authority_signing_bytes(&self) -> Result<Vec<u8>, AuthenticationError> {
        self.signing_bytes(CHALLENGE_AUTHORITY_DOMAIN)
    }

    pub fn device_signing_bytes(&self) -> Result<Vec<u8>, AuthenticationError> {
        self.signing_bytes(DEVICE_PROOF_DOMAIN)
    }

    fn signing_bytes(&self, domain: &[u8]) -> Result<Vec<u8>, AuthenticationError> {
        let mut payload = Vec::new();
        payload.extend_from_slice(CHALLENGE_PAYLOAD_DOMAIN);
        push_field(&mut payload, self.authority_key_id.as_str().as_bytes())?;
        push_field(&mut payload, self.principal_id.issuer().as_bytes())?;
        push_field(&mut payload, self.principal_id.subject().as_bytes())?;
        push_field(&mut payload, self.audience.as_bytes())?;
        push_field(&mut payload, self.session_id.as_str().as_bytes())?;
        push_field(&mut payload, self.device_id.as_str().as_bytes())?;
        push_field(&mut payload, self.purpose.as_bytes())?;
        payload.extend_from_slice(self.challenge_id.as_bytes());
        payload.extend_from_slice(&self.nonce);
        payload.extend_from_slice(self.evidence_digest.as_bytes());
        payload.extend_from_slice(&self.issued_at.to_be_bytes());
        payload.extend_from_slice(&self.expires_at.to_be_bytes());

        let mut message = Vec::with_capacity(domain.len() + payload.len());
        message.extend_from_slice(domain);
        message.extend_from_slice(&payload);
        Ok(message)
    }
}

pub struct SignedDeviceChallenge {
    payload: DeviceChallengePayload,
    authority_signature: [u8; 64],
}

impl SignedDeviceChallenge {
    pub const fn new(payload: DeviceChallengePayload, authority_signature: [u8; 64]) -> Self {
        Self {
            payload,
            authority_signature,
        }
    }

    pub fn payload(&self) -> &DeviceChallengePayload {
        &self.payload
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceRegistrationStatus {
    Active,
    Revoked,
}

pub struct RegisteredDevice {
    principal_id: PrincipalId,
    device_id: DeviceId,
    public_key: [u8; 32],
    status: DeviceRegistrationStatus,
}

impl RegisteredDevice {
    pub const fn new(
        principal_id: PrincipalId,
        device_id: DeviceId,
        public_key: [u8; 32],
        status: DeviceRegistrationStatus,
    ) -> Self {
        Self {
            principal_id,
            device_id,
            public_key,
            status,
        }
    }

    pub fn principal_id(&self) -> &PrincipalId {
        &self.principal_id
    }

    pub fn device_id(&self) -> &DeviceId {
        &self.device_id
    }

    pub const fn public_key(&self) -> &[u8; 32] {
        &self.public_key
    }

    pub const fn status(&self) -> DeviceRegistrationStatus {
        self.status
    }
}

#[async_trait]
/// Resolves an active registration bound to the requested principal and device.
pub trait DeviceRegistrationResolver: Send + Sync {
    async fn resolve(
        &self,
        principal_id: &PrincipalId,
        device_id: &DeviceId,
    ) -> Result<Option<RegisteredDevice>, AuthenticationError>;
}

#[async_trait]
/// Atomically and durably consumes a challenge identifier and nonce.
///
/// Production implementations must reject reuse of either value and fail
/// closed if durable storage is unavailable. An in-memory implementation is
/// suitable only for tests or a single-process ephemeral demonstration.
pub trait ReplayProtectionStore: Send + Sync {
    async fn consume_once(
        &self,
        authority_key_id: &AuthorityKeyId,
        challenge_id: ChallengeId,
        nonce: &[u8; 32],
        expires_at: u64,
        now: u64,
    ) -> Result<bool, AuthenticationError>;
}

pub struct VerifiedDeviceProof {
    principal_id: PrincipalId,
    session_id: SessionId,
    device_id: DeviceId,
    challenge_id: ChallengeId,
    evidence_digest: Digest,
    verified_at: u64,
}

impl VerifiedDeviceProof {
    pub fn principal_id(&self) -> &PrincipalId {
        &self.principal_id
    }

    pub fn session_id(&self) -> &SessionId {
        &self.session_id
    }

    pub fn device_id(&self) -> &DeviceId {
        &self.device_id
    }

    pub fn challenge_id(&self) -> ChallengeId {
        self.challenge_id
    }

    pub fn evidence_digest(&self) -> Digest {
        self.evidence_digest
    }

    pub fn verified_at(&self) -> u64 {
        self.verified_at
    }
}

impl std::fmt::Debug for VerifiedDeviceProof {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VerifiedDeviceProof")
            .field("principal_id", &"[redacted]")
            .field("session_id", &"[redacted]")
            .field("device_id", &"[redacted]")
            .field("challenge_id", &self.challenge_id)
            .field("verified_at", &self.verified_at)
            .finish()
    }
}

pub struct DeviceProofVerifier {
    trust_anchor: ChallengeTrustAnchor,
    expected_purpose: String,
    max_challenge_lifetime: u64,
}

impl DeviceProofVerifier {
    pub fn new(
        trust_anchor: ChallengeTrustAnchor,
        expected_purpose: impl Into<String>,
        max_challenge_lifetime: u64,
    ) -> Result<Self, AuthenticationError> {
        let expected_purpose = expected_purpose.into();
        if expected_purpose.is_empty()
            || expected_purpose.len() > 256
            || expected_purpose.chars().any(char::is_control)
            || max_challenge_lifetime == 0
        {
            return Err(AuthenticationError::InvalidChallenge);
        }
        Ok(Self {
            trust_anchor,
            expected_purpose,
            max_challenge_lifetime,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn verify<R, S>(
        &self,
        principal: &AuthenticatedPrincipal,
        challenge: &SignedDeviceChallenge,
        expected_device_id: &DeviceId,
        expected_evidence_digest: Digest,
        device_signature: &[u8],
        now: u64,
        registry: &R,
        replay_store: &S,
    ) -> Result<VerifiedDeviceProof, AuthenticationError>
    where
        R: DeviceRegistrationResolver,
        S: ReplayProtectionStore,
    {
        if principal.anonymous || principal.expires_at <= now {
            return Err(AuthenticationError::InvalidAuthenticationTime);
        }

        let payload = &challenge.payload;
        if payload.authority_key_id != self.trust_anchor.key_id {
            return Err(AuthenticationError::UntrustedChallengeAuthority);
        }
        if payload.principal_id != principal.principal_id
            || payload.audience != principal.audience
            || payload.session_id != principal.session_id
            || payload.device_id != *expected_device_id
            || payload.evidence_digest != expected_evidence_digest
            || payload.purpose != self.expected_purpose
        {
            return Err(AuthenticationError::ChallengeBindingMismatch);
        }
        if payload.issued_at > now
            || payload.expires_at <= now
            || payload.expires_at <= payload.issued_at
            || payload.expires_at - payload.issued_at > self.max_challenge_lifetime
            || payload.expires_at > principal.expires_at
        {
            return Err(AuthenticationError::InvalidChallengeTime);
        }

        let challenge_authority_key = VerifyingKey::from_bytes(&self.trust_anchor.public_key)
            .map_err(|_| AuthenticationError::UntrustedChallengeAuthority)?;
        let authority_message = payload.authority_signing_bytes()?;
        let authority_signature = Signature::from_bytes(&challenge.authority_signature);
        challenge_authority_key
            .verify_strict(&authority_message, &authority_signature)
            .map_err(|_| AuthenticationError::InvalidChallengeSignature)?;

        let registered = registry
            .resolve(&principal.principal_id, expected_device_id)
            .await?
            .ok_or(AuthenticationError::DeviceNotRegistered)?;
        if registered.principal_id != principal.principal_id
            || registered.device_id != *expected_device_id
        {
            return Err(AuthenticationError::DeviceNotRegistered);
        }
        if registered.status != DeviceRegistrationStatus::Active {
            return Err(AuthenticationError::DeviceRevoked);
        }

        let device_key = VerifyingKey::from_bytes(&registered.public_key)
            .map_err(|_| AuthenticationError::DeviceNotRegistered)?;
        let device_signature = Signature::from_slice(device_signature)
            .map_err(|_| AuthenticationError::InvalidDeviceSignature)?;
        let device_message = payload.device_signing_bytes()?;
        device_key
            .verify_strict(&device_message, &device_signature)
            .map_err(|_| AuthenticationError::InvalidDeviceSignature)?;

        if !replay_store
            .consume_once(
                &self.trust_anchor.key_id,
                payload.challenge_id,
                &payload.nonce,
                payload.expires_at,
                now,
            )
            .await?
        {
            return Err(AuthenticationError::ChallengeReplayed);
        }

        Ok(VerifiedDeviceProof {
            principal_id: principal.principal_id.clone(),
            session_id: principal.session_id.clone(),
            device_id: expected_device_id.clone(),
            challenge_id: payload.challenge_id,
            evidence_digest: payload.evidence_digest,
            verified_at: now,
        })
    }
}

fn push_field(output: &mut Vec<u8>, bytes: &[u8]) -> Result<(), AuthenticationError> {
    let length = u32::try_from(bytes.len()).map_err(|_| AuthenticationError::InvalidChallenge)?;
    output.extend_from_slice(&length.to_be_bytes());
    output.extend_from_slice(bytes);
    Ok(())
}
