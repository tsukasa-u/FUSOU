use std::{collections::HashSet, sync::Mutex};

use async_trait::async_trait;
use authenticity_auth::{
    AuthenticatedPrincipal, AuthenticationError, AuthenticationPolicy, Authenticator,
    ChallengeTrustAnchor, Credential, DeviceChallengePayload, DeviceProofVerifier,
    DeviceRegistrationResolver, DeviceRegistrationStatus, IdentityProvider, IdentityProviderError,
    ProviderClaims, RegisteredDevice, ReplayProtectionStore, SignedDeviceChallenge,
};
use authenticity_core::{AuthorityKeyId, ChallengeId, DeviceId, Digest, PrincipalId, SessionId};
use authenticity_tlsn::{
    PresentationVerifier, ServerCertificateTrust, TrustedNotaryKey, UntrustedPresentation,
    VerifiedPresentation, default_spike_input_limit,
};
use ed25519_dalek::{Signer, SigningKey};

use authenticity_consumer_example::VerificationReport;

const PRESENTATION: &[u8] = include_bytes!(
    "../../../FUSOU-TLSN-VERIFIER/fixtures/tlsn-alpha15-clean-upstream-sparse-presentation.bin"
);
const NOTARY_KEY: &[u8] = include_bytes!(
    "../../../FUSOU-TLSN-VERIFIER/fixtures/tlsn-alpha15-clean-upstream-sparse-notary-verifying-key.bin"
);
const NOW: u64 = 1_800_000_000;

struct LocalTestIdentityProvider {
    principal_id: PrincipalId,
    session_id: SessionId,
}

#[async_trait]
impl IdentityProvider for LocalTestIdentityProvider {
    async fn verify_credential(
        &self,
        credential: &Credential,
    ) -> Result<ProviderClaims, IdentityProviderError> {
        if credential.expose_secret() != b"local-test-token" {
            return Err(IdentityProviderError::Rejected);
        }
        Ok(ProviderClaims::new(
            self.principal_id.clone(),
            "test-consumer",
            self.session_id.clone(),
            NOW - 10,
            NOW + 900,
            false,
        ))
    }
}

struct LocalTestDeviceRegistry {
    registration: RegisteredDevice,
}

#[async_trait]
impl DeviceRegistrationResolver for LocalTestDeviceRegistry {
    async fn resolve(
        &self,
        _principal_id: &PrincipalId,
        _device_id: &DeviceId,
    ) -> Result<Option<RegisteredDevice>, AuthenticationError> {
        Ok(Some(RegisteredDevice::new(
            self.registration.principal_id().clone(),
            self.registration.device_id().clone(),
            *self.registration.public_key(),
            self.registration.status(),
        )))
    }
}

struct LocalTestReplayStore(Mutex<(HashSet<ChallengeId>, HashSet<[u8; 32]>)>);

#[async_trait]
impl ReplayProtectionStore for LocalTestReplayStore {
    async fn consume_once(
        &self,
        _authority_key_id: &AuthorityKeyId,
        challenge_id: ChallengeId,
        nonce: &[u8; 32],
        _expires_at: u64,
        _now: u64,
    ) -> Result<bool, AuthenticationError> {
        let mut consumed = self
            .0
            .lock()
            .map_err(|_| AuthenticationError::ReplayStoreUnavailable)?;
        if consumed.0.contains(&challenge_id) || consumed.1.contains(nonce) {
            return Ok(false);
        }
        consumed.0.insert(challenge_id);
        consumed.1.insert(*nonce);
        Ok(true)
    }
}

struct TestFixture {
    presentation: VerifiedPresentation,
    principal: AuthenticatedPrincipal,
    challenge: SignedDeviceChallenge,
    device_signature: [u8; 64],
    device_id: DeviceId,
    trust_anchor: ChallengeTrustAnchor,
    registry: LocalTestDeviceRegistry,
    replay_store: LocalTestReplayStore,
}

async fn test_fixture() -> TestFixture {
    let presentation = PresentationVerifier::new(
        TrustedNotaryKey::new("notary-fixture-key", NOTARY_KEY.to_vec()).unwrap(),
        authenticity_core::ServerIdentity::new("tlsnotary.org").unwrap(),
        ServerCertificateTrust::MozillaWebPki,
        default_spike_input_limit(),
    )
    .unwrap()
    .verify(UntrustedPresentation::new(PRESENTATION))
    .unwrap();

    let principal_id = PrincipalId::new("https://identity.test", "user-42").unwrap();
    let session_id = SessionId::new("test-session-9").unwrap();
    let provider = LocalTestIdentityProvider {
        principal_id: principal_id.clone(),
        session_id: session_id.clone(),
    };
    let principal = Authenticator::authenticate(
        &provider,
        &Credential::new(b"local-test-token".to_vec()),
        &AuthenticationPolicy::new("https://identity.test", "test-consumer", false).unwrap(),
        NOW,
    )
    .await
    .unwrap();

    let authority_signing_key = SigningKey::from_bytes(&[0x51; 32]);
    let device_signing_key = SigningKey::from_bytes(&[0x72; 32]);
    let device_id = DeviceId::new("test-device-3").unwrap();
    let authority_key_id = AuthorityKeyId::new("local-test-authority").unwrap();
    let payload = DeviceChallengePayload::new(
        authority_key_id.clone(),
        principal_id.clone(),
        "test-consumer",
        session_id,
        device_id.clone(),
        ChallengeId::new([0x31; 16]),
        [0x41; 32],
        Digest::new(*presentation.presentation_sha256()),
        "verify-presentation",
        NOW - 1,
        NOW + 120,
    )
    .unwrap();
    let authority_signature = authority_signing_key
        .sign(&payload.authority_signing_bytes().unwrap())
        .to_bytes();
    let challenge = SignedDeviceChallenge::new(payload, authority_signature);
    let device_signature = device_signing_key
        .sign(&challenge.payload().device_signing_bytes().unwrap())
        .to_bytes();
    let trust_anchor = ChallengeTrustAnchor::new(
        authority_key_id,
        authority_signing_key.verifying_key().to_bytes(),
    );
    let registry = LocalTestDeviceRegistry {
        registration: RegisteredDevice::new(
            principal_id,
            device_id.clone(),
            device_signing_key.verifying_key().to_bytes(),
            DeviceRegistrationStatus::Active,
        ),
    };

    TestFixture {
        presentation,
        principal,
        challenge,
        device_signature,
        device_id,
        trust_anchor,
        registry,
        replay_store: LocalTestReplayStore(Mutex::new((HashSet::new(), HashSet::new()))),
    }
}

fn proof_verifier(anchor: ChallengeTrustAnchor) -> DeviceProofVerifier {
    DeviceProofVerifier::new(anchor, "verify-presentation", 300).unwrap()
}

#[tokio::test]
async fn authentication_rejects_bad_credentials_and_wrong_audience() {
    let provider = LocalTestIdentityProvider {
        principal_id: PrincipalId::new("https://identity.test", "user-42").unwrap(),
        session_id: SessionId::new("test-session-9").unwrap(),
    };
    let credential = Credential::new(b"local-test-token".to_vec());
    let wrong_audience =
        AuthenticationPolicy::new("https://identity.test", "another-consumer", false).unwrap();
    assert_eq!(
        Authenticator::authenticate(&provider, &credential, &wrong_audience, NOW)
            .await
            .unwrap_err(),
        AuthenticationError::IssuerOrAudienceMismatch
    );

    let policy =
        AuthenticationPolicy::new("https://identity.test", "test-consumer", false).unwrap();
    assert_eq!(
        Authenticator::authenticate(
            &provider,
            &Credential::new(b"wrong-token".to_vec()),
            &policy,
            NOW
        )
        .await
        .unwrap_err(),
        AuthenticationError::CredentialRejected
    );
    assert!(AuthenticationPolicy::new(" ", "test-consumer", false).is_err());
    assert!(AuthenticationPolicy::new("https://identity.test", " ", false).is_err());
}

#[tokio::test]
async fn clean_upstream_presentation_auth_and_device_binding_emit_local_report() {
    let fixture = test_fixture().await;
    let proof = proof_verifier(fixture.trust_anchor)
        .verify(
            &fixture.principal,
            &fixture.challenge,
            &fixture.device_id,
            Digest::new(*fixture.presentation.presentation_sha256()),
            &fixture.device_signature,
            NOW,
            &fixture.registry,
            &fixture.replay_store,
        )
        .await
        .unwrap();

    let report =
        VerificationReport::from_verified(&fixture.presentation, &fixture.principal, &proof)
            .unwrap();
    let json = report.to_json().unwrap();
    assert!(json.contains("SYNTHETIC_FIXTURE_AND_LOCAL_TEST_PROVIDER"));
    assert!(json.contains("VERIFIED_BY_PINNED_CLEAN_UPSTREAM"));
    assert!(json.contains("NOT_IMPLEMENTED"));
    assert!(json.contains("\"self_authenticating\": false"));
    assert!(!json.contains("local-test-token"));
}

#[tokio::test]
async fn device_binding_rejects_mismatch_expiry_and_replay() {
    let fixture = test_fixture().await;
    let verifier = proof_verifier(fixture.trust_anchor);

    let authority_key = SigningKey::from_bytes(&[0x51; 32]);
    let device_key = SigningKey::from_bytes(&[0x72; 32]);
    let wrong_audience_payload = DeviceChallengePayload::new(
        AuthorityKeyId::new("local-test-authority").unwrap(),
        PrincipalId::new("https://identity.test", "user-42").unwrap(),
        "another-consumer",
        SessionId::new("test-session-9").unwrap(),
        DeviceId::new("test-device-3").unwrap(),
        ChallengeId::new([0x33; 16]),
        [0x43; 32],
        Digest::new(*fixture.presentation.presentation_sha256()),
        "verify-presentation",
        NOW - 1,
        NOW + 120,
    )
    .unwrap();
    let wrong_audience_authority_signature = authority_key
        .sign(&wrong_audience_payload.authority_signing_bytes().unwrap())
        .to_bytes();
    let wrong_audience_challenge =
        SignedDeviceChallenge::new(wrong_audience_payload, wrong_audience_authority_signature);
    let wrong_audience_device_signature = device_key
        .sign(
            &wrong_audience_challenge
                .payload()
                .device_signing_bytes()
                .unwrap(),
        )
        .to_bytes();
    let audience_mismatch = verifier
        .verify(
            &fixture.principal,
            &wrong_audience_challenge,
            &fixture.device_id,
            Digest::new(*fixture.presentation.presentation_sha256()),
            &wrong_audience_device_signature,
            NOW,
            &fixture.registry,
            &fixture.replay_store,
        )
        .await;
    assert_eq!(
        audience_mismatch.unwrap_err(),
        AuthenticationError::ChallengeBindingMismatch
    );

    let mismatch = verifier
        .verify(
            &fixture.principal,
            &fixture.challenge,
            &fixture.device_id,
            Digest::new([0xff; 32]),
            &fixture.device_signature,
            NOW,
            &fixture.registry,
            &fixture.replay_store,
        )
        .await;
    assert_eq!(
        mismatch.unwrap_err(),
        AuthenticationError::ChallengeBindingMismatch
    );

    let expired = verifier
        .verify(
            &fixture.principal,
            &fixture.challenge,
            &fixture.device_id,
            Digest::new(*fixture.presentation.presentation_sha256()),
            &fixture.device_signature,
            NOW + 120,
            &fixture.registry,
            &fixture.replay_store,
        )
        .await;
    assert_eq!(
        expired.unwrap_err(),
        AuthenticationError::InvalidChallengeTime
    );

    verifier
        .verify(
            &fixture.principal,
            &fixture.challenge,
            &fixture.device_id,
            Digest::new(*fixture.presentation.presentation_sha256()),
            &fixture.device_signature,
            NOW,
            &fixture.registry,
            &fixture.replay_store,
        )
        .await
        .unwrap();
    assert!(
        !fixture
            .replay_store
            .consume_once(
                fixture.challenge.payload().authority_key_id(),
                ChallengeId::new([0x32; 16]),
                &[0x41; 32],
                NOW + 120,
                NOW,
            )
            .await
            .unwrap()
    );
    let replay = verifier
        .verify(
            &fixture.principal,
            &fixture.challenge,
            &fixture.device_id,
            Digest::new(*fixture.presentation.presentation_sha256()),
            &fixture.device_signature,
            NOW,
            &fixture.registry,
            &fixture.replay_store,
        )
        .await;
    assert_eq!(replay.unwrap_err(), AuthenticationError::ChallengeReplayed);
}
