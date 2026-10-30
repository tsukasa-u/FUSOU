use super::*;
use crate::production_tlsn::{PresentationRequestContext, RuntimeIdentifiers};

const REQUEST: &[u8] = b"POST";
const RESPONSE: &[u8] = b"HTTP/1.1 200 OK\r\n\r\n";
const PRESENTATION: &[u8] = b"synthetic Result signature fixture Presentation";

fn fixture(
    sparse: bool,
    production: bool,
) -> (
    serde_json::Value,
    ResultSignatureVerifier,
    SessionBindingContext,
) {
    let (payload, public_key) = signed_result_payload();
    let mut result = fusou_tlsn_verifier::parse_verifier_result(
        &serde_json::to_vec(&payload["result"]).unwrap(),
        &ParserLimits::default(),
    )
    .unwrap();
    result.request_transcript_sha256 = sha256(REQUEST);
    result.response_transcript_sha256 = sha256(RESPONSE);
    if production {
        result.origin_inventory_sha256 = Some([0x31; 32]);
        result.target_approval_artifact_sha256 = Some([0x32; 32]);
    }
    let key = Ed25519KeyPair::from_seed_unchecked(&[11; 32]).unwrap();
    let result_json = if sparse {
        let mut sparse_result = fusou_tlsn_verifier::sparse_result::SparseVerifierResult {
            version: fusou_tlsn_verifier::sparse_result::SPARSE_RESULT_VERSION,
            profile_id: fusou_tlsn_verifier::sparse_result::SPARSE_PROFILE_ID.to_owned(),
            disclosure_mode: "sparse".to_owned(),
            profile_sha256: result.profile_sha256,
            issuer: result.issuer,
            proof_purpose: result.proof_purpose,
            canonical_user_id: result.canonical_user_id,
            canonical_device_id: result.canonical_device_id,
            device_challenge: result.device_challenge,
            verified_member_id: result.verified_member_id,
            attestation_session_id: result.attestation_session_id,
            binding_nonce: result.binding_nonce,
            binding_value: result.binding_value,
            verifier_key_id: result.verifier_key_id,
            notary_key_id: result.notary_key_id,
            notary_key_sha256: [0x73; 32],
            tlsn_attestation_id: result.tlsn_attestation_id,
            presentation_sha256: result.presentation_sha256,
            server_identity: result.server_identity,
            origin_inventory_sha256: result.origin_inventory_sha256,
            target_approval_artifact_sha256: result.target_approval_artifact_sha256,
            request_transcript_size: result.request_transcript_size,
            response_transcript_size: result.response_transcript_size,
            revealed_request_ranges: vec![fusou_tlsn_verifier::RevealedRange {
                start: 0,
                length: 1,
                bytes: vec![REQUEST[0]],
            }],
            revealed_response_ranges: result.revealed_response_ranges,
            signature: [0; 64],
        };
        let signing_bytes = sparse_result.signing_bytes().unwrap();
        sparse_result
            .signature
            .copy_from_slice(key.sign(&signing_bytes).as_ref());
        sparse_result.canonical_json().unwrap()
    } else {
        let signing_bytes = result.signing_bytes().unwrap();
        result
            .signature
            .copy_from_slice(key.sign(&signing_bytes).as_ref());
        result.canonical_json().unwrap()
    };
    let mut payload = payload;
    payload["result"] = serde_json::from_str(&result_json).unwrap();
    let registry = result_registry(&public_key, "ACTIVE", "2020-01-01T00:00:00.000Z", None);
    let verifier = if sparse {
        ResultSignatureVerifier::new_sparse(public_key, "result-signer-2026".to_owned(), registry)
    } else {
        ResultSignatureVerifier::new(public_key, "result-signer-2026".to_owned(), registry)
    }
    .unwrap();
    let verifier = if production {
        verifier
            .with_production_authority_pins(
                &URL_SAFE_NO_PAD.encode([0x31; 32]),
                &URL_SAFE_NO_PAD.encode([0x32; 32]),
            )
            .unwrap()
    } else {
        verifier
    };
    let result = &payload["result"];
    let string = |field: &str| result[field].as_str().unwrap().to_owned();
    let mut session = test_session_context();
    session.session_id = string("attestation_session_id");
    session.device_id = string("device_id");
    session.binding = string("binding_value");
    session.binding_challenge = string("binding_nonce");
    session.device_challenge = string("device_challenge");
    session.session_receipt.canonical_user_id = string("canonical_user_id");
    session.session_receipt.session_id = session.session_id.clone();
    session.session_receipt.device_id = session.device_id.clone();
    session.session_receipt.binding_value = session.binding.clone();
    session.session_receipt.nonce = session.binding_challenge.clone();
    session.session_receipt.device_challenge = session.device_challenge.clone();
    (payload, verifier, session)
}

fn input(
    session: &SessionBindingContext,
    request: &[u8],
    response: &[u8],
    presentation: &[u8],
    identity: &str,
    connection: u64,
) -> PresentationVerificationInput {
    let request = SerializedOriginRequest::new(Bytes::copy_from_slice(request)).unwrap();
    let response_bytes = Bytes::copy_from_slice(response);
    let exchange = TlsnOriginExchange {
        response: TlsnOriginResponse::new(
            StatusCode::OK,
            HeaderMap::new(),
            Bytes::new(),
            response_bytes.clone(),
        ),
        transcript: crate::experimental_tlsn::UnverifiedTlsnTranscript {
            request_sha256: sha256(request.bytes()),
            response_sha256: sha256(&response_bytes),
        },
    };
    let binding = AttestationBinding::new(session.binding.clone()).unwrap();
    let target = OriginTarget::new(identity.to_owned(), 443, identity.to_owned()).unwrap();
    let context = PresentationRequestContext::from_exchange(
        RuntimeIdentifiers::default(),
        connection,
        &binding,
        &request,
        &exchange,
        &target,
    );
    PresentationVerificationInput::new(
        context,
        request,
        binding,
        exchange,
        TlsnPresentation::new("synthetic-binding".to_owned(), presentation.to_vec()).unwrap(),
    )
}

fn accept(
    payload: serde_json::Value,
    verifier: &ResultSignatureVerifier,
    session: SessionBindingContext,
    input: PresentationVerificationInput,
    store: &RemoteWorkerResultStore,
) -> Result<VerificationOutcome, VerificationError> {
    let response = WorkerResponse {
        body_bytes: serde_json::to_vec(&payload).unwrap(),
        payload,
        verifier_execution_receipt_header_bytes: None,
        verifier_execution_receipt_bytes: None,
        status: 200,
    };
    accept_worker_result(
        input,
        session,
        "synthetic-device-proof".to_owned(),
        response,
        verifier,
        store,
    )
}

#[test]
fn current_complete_and_sparse_results_are_cached_once() {
    for sparse in [false, true] {
        let (payload, verifier, session) = fixture(sparse, true);
        assert!(verifier.verify(&payload).is_ok());
        let store = RemoteWorkerResultStore::new();
        let current = input(
            &session,
            REQUEST,
            RESPONSE,
            PRESENTATION,
            "game.example.test",
            101,
        );
        assert!(accept(payload, &verifier, session, current, &store).is_ok());
        assert_eq!(store.take(&sha256(REQUEST)).unwrap().connection_id, 101);
        assert!(store.take(&sha256(REQUEST)).is_err());
    }
}

#[test]
fn valid_signatures_for_other_presentations_targets_or_transcripts_are_not_cached() {
    for sparse in [false, true] {
        let (payload, verifier, session) = fixture(sparse, true);
        for (request, response, presentation, identity) in [
            (
                REQUEST,
                RESPONSE,
                &b"different exact Presentation bytes"[..],
                "game.example.test",
            ),
            (REQUEST, RESPONSE, PRESENTATION, "other.example.test"),
            (&b"POST!"[..], RESPONSE, PRESENTATION, "game.example.test"),
            (
                REQUEST,
                &b"HTTP/1.1 200 OK\r\n\r\n!"[..],
                PRESENTATION,
                "game.example.test",
            ),
        ] {
            assert!(verifier.verify(&payload).is_ok());
            let store = RemoteWorkerResultStore::new();
            let current = input(&session, request, response, presentation, identity, 101);
            assert_eq!(
                accept(payload.clone(), &verifier, session.clone(), current, &store),
                Err(VerificationError::WorkerRejected)
            );
            assert!(store.results.lock().unwrap().is_empty());
        }
    }
}

#[test]
fn complete_results_reject_same_length_transcript_substitution() {
    let (payload, verifier, session) = fixture(false, true);
    for (request, response) in [
        (&b"GET "[..], RESPONSE),
        (REQUEST, &b"HTTP/1.1 500 NO\r\n\r\n"[..]),
    ] {
        assert_eq!(request.len(), REQUEST.len());
        assert_eq!(response.len(), RESPONSE.len());
        assert!(verifier.verify(&payload).is_ok());
        let store = RemoteWorkerResultStore::new();
        let current = input(
            &session,
            request,
            response,
            PRESENTATION,
            "game.example.test",
            101,
        );
        assert_eq!(
            accept(payload.clone(), &verifier, session.clone(), current, &store),
            Err(VerificationError::WorkerRejected)
        );
        assert!(store.results.lock().unwrap().is_empty());
    }
}

#[test]
fn signed_results_from_other_session_device_or_user_are_not_cached() {
    for sparse in [false, true] {
        let (payload, verifier, session) = fixture(sparse, true);
        for field in 0..6 {
            let mut other = session.clone();
            match field {
                0 => other.session_id = "550e8400-e29b-41d4-a716-446655440000".to_owned(),
                1 => other.binding_challenge = URL_SAFE_NO_PAD.encode([0x77; 32]),
                2 => other.binding.push('A'),
                3 => other.device_challenge = URL_SAFE_NO_PAD.encode([0x78; 32]),
                4 => other.device_id = "33333333-3333-4333-8333-333333333333".to_owned(),
                5 => {
                    other.session_receipt.canonical_user_id =
                        "44444444-4444-4444-8444-444444444444".to_owned()
                }
                _ => unreachable!(),
            }
            assert!(verifier.verify(&payload).is_ok());
            let store = RemoteWorkerResultStore::new();
            let current = input(
                &other,
                REQUEST,
                RESPONSE,
                PRESENTATION,
                "game.example.test",
                101,
            );
            assert_eq!(
                accept(payload.clone(), &verifier, other, current, &store),
                Err(VerificationError::WorkerRejected)
            );
            assert!(store.results.lock().unwrap().is_empty());
        }
    }
}

#[test]
fn production_requires_both_independently_configured_authority_digests() {
    for sparse in [false, true] {
        for production in [false, true] {
            let (payload, verifier, session) = fixture(sparse, production);
            for (inventory, approval) in [([0x30; 32], [0x32; 32]), ([0x31; 32], [0x30; 32])] {
                let pinned = verifier
                    .clone()
                    .with_production_authority_pins(
                        &URL_SAFE_NO_PAD.encode(inventory),
                        &URL_SAFE_NO_PAD.encode(approval),
                    )
                    .unwrap();
                assert!(pinned.verify(&payload).is_ok());
                let store = RemoteWorkerResultStore::new();
                let current = input(
                    &session,
                    REQUEST,
                    RESPONSE,
                    PRESENTATION,
                    "game.example.test",
                    101,
                );
                assert_eq!(
                    accept(payload.clone(), &pinned, session.clone(), current, &store),
                    Err(VerificationError::WorkerRejected)
                );
                assert!(store.results.lock().unwrap().is_empty());
            }
            let (_, pinned, _) = fixture(sparse, true);
            let store = RemoteWorkerResultStore::new();
            let current = input(
                &session,
                REQUEST,
                RESPONSE,
                PRESENTATION,
                "game.example.test",
                101,
            );
            assert_eq!(
                accept(payload, &pinned, session, current, &store).is_ok(),
                production
            );
            assert_eq!(store.results.lock().unwrap().len(), usize::from(production));
        }
    }
}

#[test]
fn generic_null_authority_path_cannot_accept_production_results() {
    for sparse in [false, true] {
        let (_, generic, _) = fixture(sparse, false);
        for production in [false, true] {
            let (payload, _, session) = fixture(sparse, production);
            let store = RemoteWorkerResultStore::new();
            let current = input(
                &session,
                REQUEST,
                RESPONSE,
                PRESENTATION,
                "game.example.test",
                101,
            );
            assert_eq!(
                accept(payload, &generic, session, current, &store).is_ok(),
                !production
            );
            assert_eq!(
                store.results.lock().unwrap().len(),
                usize::from(!production)
            );
        }
    }
}

#[test]
fn duplicate_valid_result_does_not_replace_an_unconsumed_operation() {
    let (payload, verifier, session) = fixture(false, true);
    let store = RemoteWorkerResultStore::new();
    for connection in [101, 102] {
        let current = input(
            &session,
            REQUEST,
            RESPONSE,
            PRESENTATION,
            "game.example.test",
            connection,
        );
        assert_eq!(
            accept(payload.clone(), &verifier, session.clone(), current, &store).is_ok(),
            connection == 101
        );
    }
    assert_eq!(store.take(&sha256(REQUEST)).unwrap().connection_id, 101);
}

#[test]
fn production_pin_configuration_rejects_noncanonical_or_missing_digests() {
    let (_, verifier, _) = fixture(false, false);
    let valid = URL_SAFE_NO_PAD.encode([0x31; 32]);
    for invalid in [
        String::new(),
        "not-a-digest".to_owned(),
        format!("{valid}="),
        URL_SAFE_NO_PAD.encode([0x31; 31]),
    ] {
        assert!(verifier
            .clone()
            .with_production_authority_pins(&invalid, &valid)
            .is_err());
        assert!(verifier
            .clone()
            .with_production_authority_pins(&valid, &invalid)
            .is_err());
    }
}
