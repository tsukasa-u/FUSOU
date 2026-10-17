#![cfg(feature = "clean-upstream-spike")]

use authenticity_core::ServerIdentity;
use authenticity_tlsn::{
    default_spike_input_limit, DisclosureDirection, PresentationVerifier, ServerCertificateTrust,
    ServerCertificateTrustKind, TlsnVerificationError, TrustedNotaryKey, UntrustedPresentation,
};
use rcgen::{BasicConstraints, CertificateParams, IsCa, KeyPair, KeyUsagePurpose};

const PRESENTATION: &[u8] = include_bytes!(
    "../../../FUSOU-TLSN-VERIFIER/fixtures/tlsn-alpha15-clean-upstream-sparse-presentation.bin"
);
const NOTARY_KEY: &[u8] = include_bytes!(
    "../../../FUSOU-TLSN-VERIFIER/fixtures/tlsn-alpha15-clean-upstream-sparse-notary-verifying-key.bin"
);

fn verifier(
    expected_server: &str,
    trusted_key: &[u8],
    trust: ServerCertificateTrust,
) -> PresentationVerifier {
    PresentationVerifier::new(
        TrustedNotaryKey::new("fixture-notary-only", trusted_key.to_vec()).unwrap(),
        ServerIdentity::new(expected_server).unwrap(),
        trust,
        default_spike_input_limit(),
    )
    .unwrap()
}

#[test]
fn clean_upstream_verifies_and_extracts_only_authenticated_offsets() {
    let verified = verifier(
        "tlsnotary.org",
        NOTARY_KEY,
        ServerCertificateTrust::MozillaWebPki,
    )
    .verify(UntrustedPresentation::new(PRESENTATION))
    .unwrap();

    assert_eq!(verified.server_identity().as_str(), "tlsnotary.org");
    assert_eq!(
        verified.server_certificate_trust(),
        ServerCertificateTrustKind::MozillaWebPki
    );
    assert_eq!(verified.attestation_id().len(), 16);
    assert_eq!(
        verified.upstream_revision(),
        "47aee45b53e06648c1b2ad3689b367b8c923fdec"
    );
    assert_eq!(verified.sent_transcript_length(), 35);
    assert_eq!(verified.received_transcript_length(), 145);
    assert_eq!(verified.disclosures().len(), 4);
    assert_eq!(
        verified.disclosures()[0].direction(),
        DisclosureDirection::Sent
    );
    assert_eq!(verified.disclosures()[0].range(), 0..3);
    assert_eq!(verified.disclosures()[0].bytes(), b"GET");
    assert_eq!(verified.disclosures()[1].range(), 10..16);
    assert_eq!(verified.disclosures()[1].bytes(), b"/1.1\r\n");
    assert_eq!(
        verified.disclosures()[2].direction(),
        DisclosureDirection::Received
    );
    assert_eq!(verified.disclosures()[2].range(), 0..3);
    assert_eq!(verified.disclosures()[2].bytes(), b"HTT");
    assert_eq!(verified.disclosures()[3].range(), 137..145);
    assert_eq!(verified.disclosures()[3].bytes(), b",\"5\"]}\r\n");
}

#[test]
fn clean_upstream_rejects_malformed_untrusted_inputs_and_wrong_trust() {
    let valid = verifier(
        "tlsnotary.org",
        NOTARY_KEY,
        ServerCertificateTrust::MozillaWebPki,
    );
    assert!(matches!(
        valid.verify(UntrustedPresentation::new(
            &PRESENTATION[..PRESENTATION.len() - 1]
        )),
        Err(TlsnVerificationError::PresentationDecode)
    ));

    let mut trailing = PRESENTATION.to_vec();
    trailing.push(0);
    assert!(matches!(
        valid.verify(UntrustedPresentation::new(&trailing)),
        Err(TlsnVerificationError::TrailingBytes)
    ));

    let mut wrong_key = NOTARY_KEY.to_vec();
    *wrong_key.last_mut().unwrap() ^= 1;
    assert!(matches!(
        verifier(
            "tlsnotary.org",
            &wrong_key,
            ServerCertificateTrust::MozillaWebPki
        )
        .verify(UntrustedPresentation::new(PRESENTATION)),
        Err(TlsnVerificationError::NotaryKeyMismatch)
    ));

    assert!(matches!(
        verifier(
            "other.example",
            NOTARY_KEY,
            ServerCertificateTrust::MozillaWebPki
        )
        .verify(UntrustedPresentation::new(PRESENTATION)),
        Err(TlsnVerificationError::ServerIdentityMismatch)
    ));

    assert!(matches!(
        PresentationVerifier::new(
            TrustedNotaryKey::new("fixture-notary-only", NOTARY_KEY.to_vec()).unwrap(),
            ServerIdentity::new("tlsnotary.org").unwrap(),
            ServerCertificateTrust::ExplicitDerRoots(Vec::new()),
            default_spike_input_limit(),
        ),
        Err(TlsnVerificationError::InvalidServerTrust)
    ));

    let root_key = KeyPair::generate().unwrap();
    let mut root_params = CertificateParams::default();
    root_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    root_params.key_usages = vec![KeyUsagePurpose::KeyCertSign];
    let unrelated_root = root_params.self_signed(&root_key).unwrap();
    assert!(matches!(
        verifier(
            "tlsnotary.org",
            NOTARY_KEY,
            ServerCertificateTrust::ExplicitDerRoots(vec![unrelated_root.der().to_vec()])
        )
        .verify(UntrustedPresentation::new(PRESENTATION)),
        Err(TlsnVerificationError::PresentationVerification)
    ));

    let size_limited = PresentationVerifier::new(
        TrustedNotaryKey::new("fixture-notary-only", NOTARY_KEY.to_vec()).unwrap(),
        ServerIdentity::new("tlsnotary.org").unwrap(),
        ServerCertificateTrust::MozillaWebPki,
        1,
    )
    .unwrap();
    assert!(matches!(
        size_limited.verify(UntrustedPresentation::new(PRESENTATION)),
        Err(TlsnVerificationError::PresentationSize)
    ));
}
