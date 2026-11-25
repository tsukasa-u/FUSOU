use super::*;
use crate::production_tlsn::{
    OriginTarget, PresentationRequestContext, ProductionResultSigner, RuntimeIdentifiers,
};

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
        let capture_identifier = sha256(session.binding.as_bytes());
        let current = input(
            &session,
            REQUEST,
            RESPONSE,
            PRESENTATION,
            "game.example.test",
            101,
        );
        assert!(accept(payload, &verifier, session, current, &store).is_ok());
        assert_eq!(
            store
                .take(&capture_identifier, &sha256(REQUEST), &sha256(RESPONSE),)
                .unwrap()
                .connection_id,
            101
        );
        assert!(store
            .take(&capture_identifier, &sha256(REQUEST), &sha256(RESPONSE),)
            .is_err());
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

#[derive(Clone)]
struct WorkerHttpReply {
    status: u16,
    body: String,
    receipt_header: Option<String>,
}

impl WorkerHttpReply {
    fn json(status: u16, payload: &serde_json::Value) -> Self {
        Self {
            status,
            body: serde_json::to_string(payload).unwrap(),
            receipt_header: None,
        }
    }
}

struct CapturedWorkerRequest {
    path: &'static str,
    body: serde_json::Value,
    authorization: Option<String>,
    response_mode: Option<String>,
}

struct WorkerHttpState {
    initial_reply: WorkerHttpReply,
    status_replies: Vec<WorkerHttpReply>,
    initial_delay: std::time::Duration,
    initial_requests: usize,
    status_requests: usize,
    requests: Vec<CapturedWorkerRequest>,
}

async fn scripted_worker_response(
    state: std::sync::Arc<std::sync::Mutex<WorkerHttpState>>,
    path: &'static str,
    body: serde_json::Value,
    authorization: Option<String>,
    response_mode: Option<String>,
) -> warp::reply::Response {
    use warp::Reply;
    let (reply, delay) = {
        let mut state = state.lock().unwrap();
        state.requests.push(CapturedWorkerRequest {
            path,
            body,
            authorization,
            response_mode,
        });
        if path == "/verify/tlsn" {
            state.initial_requests += 1;
            (state.initial_reply.clone(), state.initial_delay)
        } else {
            let index = state.status_requests;
            state.status_requests += 1;
            let reply = state
                .status_replies
                .get(index)
                .or_else(|| state.status_replies.last())
                .cloned()
                .unwrap_or_else(|| WorkerHttpReply::json(500, &serde_json::json!({})));
            (reply, std::time::Duration::ZERO)
        }
    };
    if !delay.is_zero() {
        tokio::time::sleep(delay).await;
    }
    let mut response = warp::reply::with_status(
        reply.body,
        warp::http::StatusCode::from_u16(reply.status).unwrap(),
    )
    .into_response();
    if let Some(header) = reply.receipt_header {
        response.headers_mut().insert(
            "x-fusou-tlsn-verifier-execution-receipt",
            header.parse().unwrap(),
        );
    }
    response
}

fn spawn_worker_http_server(
    state: std::sync::Arc<std::sync::Mutex<WorkerHttpState>>,
) -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
    use warp::Filter;

    let initial_state = std::sync::Arc::clone(&state);
    let initial = warp::post()
        .and(warp::path!("verify" / "tlsn"))
        .and(warp::body::json())
        .and(warp::header::optional::<String>("authorization"))
        .and(warp::header::optional::<String>(
            "x-fusou-tlsn-response-mode",
        ))
        .then(move |body, authorization, response_mode| {
            scripted_worker_response(
                std::sync::Arc::clone(&initial_state),
                "/verify/tlsn",
                body,
                authorization,
                response_mode,
            )
        });
    let status_state = std::sync::Arc::clone(&state);
    let status = warp::post()
        .and(warp::path!("verify" / "tlsn" / "status"))
        .and(warp::body::json())
        .and(warp::header::optional::<String>("authorization"))
        .and(warp::header::optional::<String>(
            "x-fusou-tlsn-response-mode",
        ))
        .then(move |body, authorization, response_mode| {
            scripted_worker_response(
                std::sync::Arc::clone(&status_state),
                "/verify/tlsn/status",
                body,
                authorization,
                response_mode,
            )
        });
    let (address, server) =
        warp::serve(initial.or(status).unify()).bind_ephemeral(([127, 0, 0, 1], 0));
    (address, tokio::spawn(server))
}

struct BackendRun {
    root: std::path::PathBuf,
    session: SessionBindingContext,
    results: std::sync::Arc<RemoteWorkerResultStore>,
    state: std::sync::Arc<std::sync::Mutex<WorkerHttpState>>,
    outcome: Result<VerificationOutcome, VerificationError>,
}

async fn run_backend_case(
    mut session: SessionBindingContext,
    verifier: ResultSignatureVerifier,
    initial_reply: WorkerHttpReply,
    status_replies: Vec<WorkerHttpReply>,
    response_mode: RemoteWorkerResponseMode,
    initial_delay: std::time::Duration,
    client_timeout: std::time::Duration,
    poll_interval: std::time::Duration,
    poll_timeout: std::time::Duration,
) -> BackendRun {
    let root = std::env::temp_dir().join(format!(
        "fusou-tlsn-remote-worker-http-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    tokio::fs::create_dir_all(&root)
        .await
        .expect("create isolated backend fixture directory");

    let device_key_path = root.join("device-key.json");
    let mut device_key = DeviceKey::load_or_create(device_key_path.clone())
        .await
        .expect("create local registered DeviceKey fixture");
    device_key
        .set_device_id(session.device_id().to_owned())
        .await
        .expect("register DeviceKey fixture to the signed Session device");
    session.device_public_key = device_key.public_key_b64().to_owned();

    let auth_manager = test_auth_manager(root.join("auth-session.json"));
    auth_manager
        .save_session(&fusou_auth::Session {
            access_token: "local-worker-http-access-token".to_owned(),
            refresh_token: "unused-refresh-token".to_owned(),
            expires_at: Some(Utc::now() + chrono::Duration::minutes(10)),
            token_type: Some("Bearer".to_owned()),
        })
        .await
        .expect("save unexpired local Auth session");

    let state = std::sync::Arc::new(std::sync::Mutex::new(WorkerHttpState {
        initial_reply,
        status_replies,
        initial_delay,
        initial_requests: 0,
        status_requests: 0,
        requests: Vec::new(),
    }));
    let (address, server) = spawn_worker_http_server(std::sync::Arc::clone(&state));
    let client = reqwest::Client::builder()
        .timeout(client_timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("build local-only Worker HTTP client");
    let results = RemoteWorkerResultStore::new();
    let backend = RemoteWorkerVerificationBackend {
        endpoint: format!("http://{address}/verify/tlsn"),
        status_endpoint: format!("http://{address}/verify/tlsn/status"),
        client,
        auth_manager,
        device_key_path,
        binding_state: std::sync::Arc::new(std::sync::Mutex::new(Some(session.clone()))),
        results: std::sync::Arc::clone(&results),
        result_verifier: std::sync::Arc::new(verifier),
        response_mode,
        poll_interval,
        poll_timeout,
    };
    let (context, request, binding, exchange, presentation) = input(
        &session,
        REQUEST,
        RESPONSE,
        PRESENTATION,
        "game.example.test",
        101,
    )
    .into_parts();
    let handoff = PresentationHandoff::new();
    handoff
        .publish(
            *context.binding_identifier(),
            *context.request_sha256(),
            presentation.identifier().to_owned(),
            presentation.bytes().to_vec(),
        )
        .expect("publish exact Presentation into local capture handoff");
    let target = OriginTarget::new(
        context.server_identity().to_owned(),
        443,
        context.server_identity().to_owned(),
    )
    .expect("construct fixture origin target");
    let boundary = PresentationVerifierBoundary::new(
        std::sync::Arc::new(HandoffPresentationProvider::new(handoff)),
        std::sync::Arc::new(backend),
        target,
        RuntimeIdentifiers::default(),
    );
    let outcome = boundary
        .verify(context.connection_id(), request, binding, exchange)
        .await;
    server.abort();

    BackendRun {
        root,
        session,
        results,
        state,
        outcome,
    }
}

fn verified_payload_with_consume_receipt() -> (
    serde_json::Value,
    ResultSignatureVerifier,
    SessionBindingContext,
) {
    let (mut payload, verifier, session) = fixture(false, true);
    payload["consume_receipt"] = serde_json::json!({
        "test_fixture": "candidate-writer-input-only",
    });
    (payload, verifier, session)
}

fn json_response_bytes(payload: &serde_json::Value) -> Vec<u8> {
    serde_json::to_vec(payload).unwrap()
}

fn assert_device_proof(request: &CapturedWorkerRequest, session: &SessionBindingContext) {
    let expected_presentation = URL_SAFE_NO_PAD.encode(PRESENTATION);
    assert_eq!(
        request.body["session_id"].as_str(),
        Some(session.session_id())
    );
    assert_eq!(
        request.body["device_id"].as_str(),
        Some(session.device_id())
    );
    assert_eq!(request.body["binding"].as_str(), Some(session.binding()));
    assert_eq!(
        request.body["presentation_base64"].as_str(),
        Some(expected_presentation.as_str())
    );

    let proof = &request.body["device_proof"];
    assert_eq!(
        proof["challenge"].as_str(),
        Some(session.device_challenge())
    );
    let challenge = URL_SAFE_NO_PAD
        .decode(session.device_challenge())
        .expect("decode Session device challenge");
    let signing_bytes = tlsn_device_proof_signing_bytes(
        session.device_id(),
        session.session_id(),
        session.binding(),
        &challenge,
    )
    .expect("recreate device possession proof message");
    let signature = STANDARD
        .decode(proof["sig"].as_str().expect("device signature"))
        .expect("decode device possession proof");
    let public_key = STANDARD
        .decode(&session.device_public_key)
        .expect("decode registered device public key");
    ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, public_key)
        .verify(&signing_bytes, &signature)
        .expect("initial request carries the registered device proof");
}

async fn prepare_candidate_capture_directory(
    artifact_root: &std::path::Path,
    session: &SessionBindingContext,
) -> std::path::PathBuf {
    ensure_private_candidate_root(artifact_root)
        .await
        .expect("create private candidate root");
    let presentation = TlsnPresentation::new("synthetic-binding".to_owned(), PRESENTATION.to_vec())
        .expect("create signed fixture Presentation");
    let directory = artifact_root.join(presentation.identifier());
    crate::production_tlsn::create_private_candidate_directory(&directory)
        .await
        .expect("create private candidate capture directory");
    write_private_candidate_file(&directory.join("presentation.bin"), PRESENTATION)
        .await
        .expect("write exact Presentation bytes");
    let metadata = serde_json::json!({
        "schema_version": 2,
        "candidate_capture_id": presentation.identifier(),
        "session_id": session.session_id(),
        "request_id": "remote-worker-http-result-recovery",
        "request_sha256": URL_SAFE_NO_PAD.encode(sha256(REQUEST)),
        "authenticated_request_sha256": URL_SAFE_NO_PAD.encode(sha256(REQUEST)),
        "binding_identifier": URL_SAFE_NO_PAD.encode(sha256(session.binding().as_bytes())),
        "capture_timestamp": Utc::now().to_rfc3339(),
        "presentation_sha256": URL_SAFE_NO_PAD.encode(presentation.sha256()),
        "proxy_provenance": {
            "app_public_configuration_fingerprints":
                super::candidate_app_configuration_fingerprint_fixture(),
        },
    });
    write_private_candidate_file(
        &directory.join("metadata.json"),
        &canonical_json_bytes(&metadata),
    )
    .await
    .expect("write candidate capture metadata");
    directory
}

#[tokio::test]
async fn remote_backend_recovers_unconfirmed_queue_result_once_and_preserves_exact_candidate_bytes()
{
    let (payload, verifier, session) = verified_payload_with_consume_receipt();
    assert!(verifier.verify(&payload).is_ok());
    let job_id = uuid::Uuid::new_v4().to_string();
    let final_body = json_response_bytes(&payload);
    let run = run_backend_case(
        session,
        verifier,
        WorkerHttpReply::json(
            503,
            &serde_json::json!({
                "verified": false,
                "error": "queue_enqueue_unconfirmed",
                "job_id": job_id,
            }),
        ),
        vec![
            WorkerHttpReply::json(
                202,
                &serde_json::json!({
                    "verified": false,
                    "status": "processing",
                    "job_id": job_id,
                }),
            ),
            WorkerHttpReply {
                status: 200,
                body: String::from_utf8(final_body.clone()).unwrap(),
                receipt_header: None,
            },
        ],
        RemoteWorkerResponseMode::Async,
        std::time::Duration::ZERO,
        std::time::Duration::from_secs(2),
        std::time::Duration::from_millis(1),
        std::time::Duration::from_secs(1),
    )
    .await;
    let evidence = match run.outcome {
        Ok(VerificationOutcome::Verified(evidence)) => evidence,
        other => panic!("expected recovered verified Result, got {other:?}"),
    };

    {
        let state = run.state.lock().unwrap();
        assert_eq!(state.initial_requests, 1);
        assert_eq!(state.status_requests, 2);
        assert_eq!(state.requests.len(), 3);
        assert_eq!(state.requests[0].path, "/verify/tlsn");
        assert_eq!(
            state.requests[0].authorization.as_deref(),
            Some("Bearer local-worker-http-access-token")
        );
        assert_eq!(state.requests[0].response_mode.as_deref(), Some("async"));
        assert_device_proof(&state.requests[0], &run.session);
        let expected_binding_id = URL_SAFE_NO_PAD.encode(sha256(run.session.binding().as_bytes()));
        for request in &state.requests[1..] {
            assert_eq!(request.path, "/verify/tlsn/status");
            assert_eq!(
                request.authorization.as_deref(),
                Some("Bearer local-worker-http-access-token")
            );
            assert_eq!(request.body["job_id"].as_str(), Some(job_id.as_str()));
            assert_eq!(
                request.body["session_id"].as_str(),
                Some(run.session.session_id())
            );
            assert_eq!(
                request.body["binding_id"].as_str(),
                Some(expected_binding_id.as_str())
            );
            assert_eq!(
                request.body["canonical_user_id"].as_str(),
                Some(run.session.session_receipt.canonical_user_id.as_str())
            );
            assert_eq!(
                request.body["device_id"].as_str(),
                Some(run.session.device_id())
            );
            assert!(request.body.get("presentation_base64").is_none());
            assert!(request.body.get("device_proof").is_none());
        }
    }
    assert_eq!(run.results.results.lock().unwrap().len(), 1);

    let artifact_root = run.root.join("candidate");
    let candidate_directory =
        prepare_candidate_capture_directory(&artifact_root, &run.session).await;
    let signed = RemoteWorkerResultSigner::new(std::sync::Arc::clone(&run.results), artifact_root)
        .with_candidate_capture_enabled(true)
        .sign(evidence)
        .await
        .expect("sign and capture recovered Worker Result");
    assert_eq!(signed.key_id(), "result-signer-2026");
    assert_eq!(
        tokio::fs::read(candidate_directory.join("result-exact.bin"))
            .await
            .expect("read exact final Worker status body"),
        final_body
    );
    let manifest: serde_json::Value = serde_json::from_slice(
        &tokio::fs::read(candidate_directory.join("candidate-manifest.json"))
            .await
            .expect("read candidate manifest"),
    )
    .expect("parse candidate manifest");
    assert_eq!(
        manifest["candidate_status"],
        "INCOMPLETE_MISSING_EXECUTION_RECEIPT"
    );
    assert_eq!(manifest["verifier_execution_receipt_status"], "MISSING");
    assert!(!candidate_directory
        .join("verifier-execution-receipt.bin")
        .exists());
    tokio::fs::remove_dir_all(&run.root)
        .await
        .expect("remove isolated backend fixture");
}

#[tokio::test]
async fn remote_backend_persists_queue_receipt_for_independent_verification() {
    use ring::signature::Ed25519KeyPair;
    use serde_json::{json, Value};
    let (mut payload, verifier, session) = verified_payload_with_consume_receipt();
    let presented_sha256 = URL_SAFE_NO_PAD.encode(sha256(PRESENTATION));
    let issued_at = "2026-11-25T03:30:00.000Z";
    payload["consume_receipt"] = json!({
        "presentation_id": presented_sha256,
        "used_at": issued_at,
    });
    let challenge = URL_SAFE_NO_PAD.decode(session.device_challenge()).unwrap();
    let proof = tlsn_device_proof_signing_bytes(
        session.device_id(),
        session.session_id(),
        session.binding(),
        &challenge,
    )
    .unwrap();
    payload["device_replay_digest_hex"] = json!(hex_bytes(&sha256(&proof)));
    let exact_response = json_response_bytes(&payload);

    let vector: Value = serde_json::from_str(include_str!(
        "../../../../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/fixtures/production-queue-execution-receipt-v1.json"
    )).unwrap();
    let mut receipt: Value =
        serde_json::from_str(vector["receipt_utf8"].as_str().unwrap()).unwrap();
    receipt["presentation_sha256"] = json!(presented_sha256);
    receipt["result_sha256"] = json!(URL_SAFE_NO_PAD.encode(sha256(&exact_response)));
    let job_id = receipt["job_id"].as_str().unwrap();
    let signing_fields = json!([
        receipt["schema_version"],
        receipt["scope"],
        receipt["environment"],
        receipt["deployment_role"],
        receipt["execution_mode"],
        receipt["job_id"],
        receipt["verification_attempt_id"],
        receipt["deployment_id"],
        receipt["worker_name"],
        receipt["runtime_version_id"],
        receipt["source_sha"],
        receipt["verifier_execution_key_id"],
        receipt["verifier_public_key_spki_sha256"],
        receipt["verification_profile"],
        receipt["presentation_sha256"],
        receipt["result_sha256"],
        receipt["issued_at"],
    ]);
    let mut signing_bytes = b"FUSOU-TLSN-PRODUCTION-QUEUE-VERIFIER-EXECUTION-V1\0".to_vec();
    signing_bytes.extend(serde_json::to_vec(&signing_fields).unwrap());
    let key = Ed25519KeyPair::from_seed_unchecked(&[4; 32]).unwrap();
    let signature = key.sign(&signing_bytes);
    let job_id = job_id.to_owned();
    receipt["signature_base64url"] = json!(URL_SAFE_NO_PAD.encode(signature));
    let receipt_bytes = serde_json::to_vec(&receipt).unwrap();
    let header = URL_SAFE_NO_PAD.encode(&receipt_bytes);

    let run = run_backend_case(
        session,
        verifier,
        WorkerHttpReply::json(
            202,
            &json!({ "verified": false, "status": "queued", "job_id": job_id }),
        ),
        vec![WorkerHttpReply {
            status: 200,
            body: String::from_utf8(exact_response.clone()).unwrap(),
            receipt_header: Some(header.clone()),
        }],
        RemoteWorkerResponseMode::Async,
        std::time::Duration::ZERO,
        std::time::Duration::from_secs(2),
        std::time::Duration::from_millis(1),
        std::time::Duration::from_secs(1),
    )
    .await;
    let evidence = match run.outcome {
        Ok(VerificationOutcome::Verified(evidence)) => evidence,
        other => panic!("expected verified Result with a detached receipt, got {other:?}"),
    };
    {
        let state = run.state.lock().unwrap();
        assert_eq!((state.initial_requests, state.status_requests), (1, 1));
        assert_eq!(state.requests[1].body["job_id"], job_id);
    }
    let artifact_root = run.root.join("candidate");
    let candidate = prepare_candidate_capture_directory(&artifact_root, &run.session).await;
    RemoteWorkerResultSigner::new(run.results, artifact_root)
        .with_candidate_capture_enabled(true)
        .sign(evidence)
        .await
        .unwrap();
    assert_eq!(
        tokio::fs::read(candidate.join("result-exact.bin"))
            .await
            .unwrap(),
        exact_response
    );
    assert_eq!(
        tokio::fs::read(candidate.join("verifier-execution-receipt.bin"))
            .await
            .unwrap(),
        receipt_bytes
    );
    assert_eq!(
        tokio::fs::read(candidate.join("verifier-execution-receipt-header.txt"))
            .await
            .unwrap(),
        header.as_bytes()
    );

    let trust = run.root.join("independent-queue-execution-trust.json");
    tokio::fs::write(
        &trust,
        serde_json::to_vec(&vector["independent_trust"]).unwrap(),
    )
    .await
    .unwrap();
    let report = fusou_tlsn_verifier::evidence_bundle::finalization::verify_candidate_queue_execution_receipt(
        &candidate, &trust,
    ).unwrap();
    assert_eq!(report["status"], "SIGNATURE_AND_EXACT_BYTES_VERIFIED");
    assert_eq!(report["job_id"], job_id);
    tokio::fs::remove_dir_all(run.root).await.unwrap();
}

#[tokio::test]
async fn remote_backend_preserves_accepted_202_and_synchronous_success() {
    for mode in [
        RemoteWorkerResponseMode::Async,
        RemoteWorkerResponseMode::Sync,
    ] {
        let (payload, verifier, session) = verified_payload_with_consume_receipt();
        let job_id = uuid::Uuid::new_v4().to_string();
        let final_body = json_response_bytes(&payload);
        let (initial, statuses) = match mode {
            RemoteWorkerResponseMode::Async => (
                WorkerHttpReply::json(
                    202,
                    &serde_json::json!({
                        "verified": false,
                        "status": "queued",
                        "job_id": job_id,
                    }),
                ),
                vec![
                    WorkerHttpReply::json(
                        202,
                        &serde_json::json!({
                            "verified": false,
                            "status": "processing",
                            "job_id": job_id,
                        }),
                    ),
                    WorkerHttpReply {
                        status: 200,
                        body: String::from_utf8(final_body).unwrap(),
                        receipt_header: None,
                    },
                ],
            ),
            RemoteWorkerResponseMode::Sync => (
                WorkerHttpReply {
                    status: 200,
                    body: String::from_utf8(final_body).unwrap(),
                    receipt_header: None,
                },
                Vec::new(),
            ),
        };
        let run = run_backend_case(
            session,
            verifier,
            initial,
            statuses,
            mode,
            std::time::Duration::ZERO,
            std::time::Duration::from_secs(2),
            std::time::Duration::from_millis(1),
            std::time::Duration::from_secs(1),
        )
        .await;
        assert!(matches!(run.outcome, Ok(VerificationOutcome::Verified(_))));
        let state = run.state.lock().unwrap();
        assert_eq!(state.initial_requests, 1);
        assert_eq!(
            state.status_requests,
            usize::from(mode == RemoteWorkerResponseMode::Async) * 2
        );
        assert_eq!(
            state.requests[0].response_mode.as_deref(),
            Some(mode.header_value())
        );
        assert_eq!(run.results.results.lock().unwrap().len(), 1);
        drop(state);
        tokio::fs::remove_dir_all(&run.root)
            .await
            .expect("remove isolated backend fixture");
    }
}

#[tokio::test]
async fn remote_backend_does_not_poll_other_503_responses_or_retry_initial_timeouts() {
    let (payload, verifier, session) = verified_payload_with_consume_receipt();
    let valid_job_id = uuid::Uuid::new_v4().to_string();
    let responses = [
        (
            serde_json::json!({ "verified": false, "error": "queue_unconfigured" }),
            VerificationError::WorkerUnavailable,
        ),
        (
            serde_json::json!({ "verified": false, "error": "trigger_enqueue_failed" }),
            VerificationError::TriggerUnavailable,
        ),
        (
            serde_json::json!({ "verified": false, "error": "temporary_worker_failure" }),
            VerificationError::WorkerUnavailable,
        ),
        (
            serde_json::json!({
                "verified": false,
                "error": "queue_enqueue_unconfirmed",
                "job_id": "not-a-uuid",
            }),
            VerificationError::WorkerUnavailable,
        ),
        (
            serde_json::json!({
                "verified": true,
                "error": "queue_enqueue_unconfirmed",
                "job_id": valid_job_id,
            }),
            VerificationError::WorkerUnavailable,
        ),
    ];
    for (response, expected_error) in responses {
        let run = run_backend_case(
            session.clone(),
            verifier.clone(),
            WorkerHttpReply::json(503, &response),
            vec![WorkerHttpReply::json(
                200,
                &serde_json::json!({
                    "verified": true,
                    "result": payload["result"],
                    "signer_key_id": payload["signer_key_id"],
                }),
            )],
            RemoteWorkerResponseMode::Async,
            std::time::Duration::ZERO,
            std::time::Duration::from_secs(2),
            std::time::Duration::from_millis(1),
            std::time::Duration::from_secs(1),
        )
        .await;
        assert_eq!(run.outcome, Err(expected_error));
        let state = run.state.lock().unwrap();
        assert_eq!(state.initial_requests, 1);
        assert_eq!(state.status_requests, 0);
        assert_eq!(run.results.results.lock().unwrap().len(), 0);
        drop(state);
        tokio::fs::remove_dir_all(&run.root)
            .await
            .expect("remove isolated backend fixture");
    }

    let run = run_backend_case(
        session,
        verifier,
        WorkerHttpReply::json(
            503,
            &serde_json::json!({
                "verified": false,
                "error": "queue_enqueue_unconfirmed",
                "job_id": uuid::Uuid::new_v4().to_string(),
            }),
        ),
        Vec::new(),
        RemoteWorkerResponseMode::Async,
        std::time::Duration::from_millis(100),
        std::time::Duration::from_millis(10),
        std::time::Duration::from_millis(1),
        std::time::Duration::from_millis(50),
    )
    .await;
    assert_eq!(run.outcome, Err(VerificationError::WorkerUnavailable));
    let state = run.state.lock().unwrap();
    assert_eq!(state.initial_requests, 1);
    assert_eq!(state.status_requests, 0);
    assert!(run.results.results.lock().unwrap().is_empty());
    drop(state);
    tokio::fs::remove_dir_all(&run.root)
        .await
        .expect("remove isolated backend timeout fixture");
}

#[tokio::test]
async fn remote_backend_rejects_mismatched_jobs_unverified_results_and_invalid_signatures_or_bindings(
) {
    let (payload, verifier, session) = verified_payload_with_consume_receipt();
    let job_id = uuid::Uuid::new_v4().to_string();
    let mismatched_job_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    assert_ne!(job_id, mismatched_job_id);
    let status_cases = [
        (
            WorkerHttpReply::json(
                202,
                &serde_json::json!({
                    "verified": false,
                    "status": "processing",
                    "job_id": mismatched_job_id,
                }),
            ),
            session.clone(),
            VerificationError::WorkerRejected,
        ),
        (
            WorkerHttpReply::json(
                200,
                &serde_json::json!({
                    "verified": false,
                    "status": "failed",
                }),
            ),
            session.clone(),
            VerificationError::WorkerRejected,
        ),
        (
            {
                let mut invalid = payload.clone();
                invalid["result"]["signature"] =
                    serde_json::Value::String(URL_SAFE_NO_PAD.encode([0_u8; 64]));
                WorkerHttpReply::json(200, &invalid)
            },
            session.clone(),
            VerificationError::WorkerRejected,
        ),
        (
            WorkerHttpReply::json(200, &payload),
            {
                let mut changed = session.clone();
                changed.binding.push('A');
                changed.session_receipt.binding_value = changed.binding.clone();
                changed
            },
            VerificationError::WorkerRejected,
        ),
    ];
    for (final_reply, session, expected_error) in status_cases {
        let run = run_backend_case(
            session,
            verifier.clone(),
            WorkerHttpReply::json(
                503,
                &serde_json::json!({
                    "verified": false,
                    "error": "queue_enqueue_unconfirmed",
                    "job_id": job_id,
                }),
            ),
            vec![final_reply],
            RemoteWorkerResponseMode::Async,
            std::time::Duration::ZERO,
            std::time::Duration::from_secs(2),
            std::time::Duration::from_millis(1),
            std::time::Duration::from_secs(1),
        )
        .await;
        assert_eq!(run.outcome, Err(expected_error));
        let state = run.state.lock().unwrap();
        assert_eq!(state.initial_requests, 1);
        assert_eq!(state.status_requests, 1);
        assert_eq!(run.results.results.lock().unwrap().len(), 0);
        drop(state);
        tokio::fs::remove_dir_all(&run.root)
            .await
            .expect("remove isolated backend rejection fixture");
    }

    let run = run_backend_case(
        session,
        verifier,
        WorkerHttpReply::json(
            503,
            &serde_json::json!({
                "verified": false,
                "error": "queue_enqueue_unconfirmed",
                "job_id": job_id,
            }),
        ),
        vec![WorkerHttpReply::json(
            202,
            &serde_json::json!({
                "verified": false,
                "status": "processing",
                "job_id": job_id,
            }),
        )],
        RemoteWorkerResponseMode::Async,
        std::time::Duration::ZERO,
        std::time::Duration::from_secs(2),
        std::time::Duration::from_millis(1),
        std::time::Duration::from_millis(20),
    )
    .await;
    assert_eq!(run.outcome, Err(VerificationError::WorkerUnavailable));
    let state = run.state.lock().unwrap();
    assert_eq!(state.initial_requests, 1);
    assert!(state.status_requests > 0);
    assert!(run.results.results.lock().unwrap().is_empty());
    drop(state);
    tokio::fs::remove_dir_all(&run.root)
        .await
        .expect("remove isolated backend polling-timeout fixture");
}

#[test]
fn duplicate_valid_result_does_not_replace_an_unconsumed_operation() {
    let (payload, verifier, session) = fixture(false, true);
    let store = RemoteWorkerResultStore::new();
    let capture_identifier = sha256(session.binding.as_bytes());
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
    assert_eq!(
        store
            .take(&capture_identifier, &sha256(REQUEST), &sha256(RESPONSE),)
            .unwrap()
            .connection_id,
        101
    );
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
