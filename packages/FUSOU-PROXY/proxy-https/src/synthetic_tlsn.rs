use crate::experimental_tlsn::{
    sha256, AttestationBinding, Http1OriginRequestSerializer, OriginRequestSerializer,
    ProofContinuation, ProofContinuationError, SerializationError, SerializedOriginRequest,
    TlsnOriginCapture, TlsnOriginExchange, TlsnOriginResponse, TlsnOriginTransport,
    TlsnTransportError, TlsnTransportFuture, UnverifiedTlsnTranscript,
};
use fusou_tlsn_verifier::{
    parse_require_info_request, plan_require_info_response_sparse_ranges,
    prover_transport::ProverOwnedTlsTransport, ParserLimits,
};
use http::{HeaderMap, HeaderName, HeaderValue, Method, Request, StatusCode, Version};
use hyper::body::Bytes;
use rcgen::{
    BasicConstraints, CertificateParams, ExtendedKeyUsagePurpose, IsCa, KeyPair, KeyUsagePurpose,
};
use std::{
    future::IntoFuture,
    ops::Range,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tlsn::{
    attestation::{
        request::{Request as AttestationRequest, RequestConfig},
        Attestation, AttestationConfig, CryptoProvider,
    },
    config::{
        prover::ProverConfig, tls::TlsClientConfig, tls_commit::proxy::ProxyTlsConfig,
        verifier::VerifierConfig,
    },
    connection::{CertBinding, ConnectionInfo, DnsName, ServerName, TranscriptLength},
    transcript::{ContentType, TlsTranscript, TranscriptCommitConfig},
    verifier::VerifierCommitStart,
    webpki::{CertificateDer, RootCertStore},
    Session,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::oneshot;
use tokio_rustls::{
    rustls::{pki_types::PrivateKeyDer, ServerConfig},
    TlsAcceptor,
};
use tokio_util::compat::TokioAsyncReadCompatExt;

pub const SYNTHETIC_SERVER_IDENTITY: &str = "game.example.test";

pub fn synthetic_require_info_request() -> Request<Bytes> {
    Request::builder()
        .method(Method::POST)
        .uri(format!(
            "https://{SYNTHETIC_SERVER_IDENTITY}/kcsapi/api_get_member/require_info"
        ))
        .version(Version::HTTP_11)
        .header("Host", SYNTHETIC_SERVER_IDENTITY)
        .header("Content-Length", "0")
        .header("Connection", "close")
        .body(Bytes::new())
        .expect("synthetic request must be valid")
}

pub fn synthetic_serialized_require_info_request(
    binding: &AttestationBinding,
) -> Result<SerializedOriginRequest, SerializationError> {
    let (parts, body) = synthetic_require_info_request().into_parts();
    Http1OriginRequestSerializer.serialize(&parts, body, binding)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyntheticAlpha15WireEvidence {
    pub origin_request: Vec<u8>,
    pub authenticated_request: Vec<u8>,
    pub origin_response: Vec<u8>,
    pub authenticated_response: Vec<u8>,
    pub committed_request_bytes: usize,
    pub committed_response_bytes: usize,
    pub committed_response_range_count: usize,
    pub committed_response_largest_range_bytes: usize,
    pub disclosed_response_range_count: usize,
    pub disclosed_response_largest_range_bytes: usize,
    pub presentation: Option<Vec<u8>>,
    pub sparse_presentation: Option<Vec<u8>>,
    pub root_certificate: Option<Vec<u8>>,
    pub notary_verifying_key: Option<Vec<u8>>,
    pub presentation_available: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SyntheticAlpha15Memory {
    pub rss_bytes: Option<u64>,
    pub peak_rss_bytes: Option<u64>,
    pub data_bytes: Option<u64>,
    pub virtual_bytes: Option<u64>,
}

impl SyntheticAlpha15Memory {
    fn current() -> Self {
        let Ok(status) = std::fs::read_to_string("/proc/self/status") else {
            return Self {
                rss_bytes: None,
                peak_rss_bytes: None,
                data_bytes: None,
                virtual_bytes: None,
            };
        };
        let read_kilobytes = |name: &str| {
            status
                .lines()
                .find_map(|line| line.strip_prefix(&format!("{name}:")))
                .and_then(|value| value.split_whitespace().next())
                .and_then(|value| value.parse::<u64>().ok())
                .map(|value| value * 1024)
        };
        Self {
            rss_bytes: read_kilobytes("VmRSS"),
            peak_rss_bytes: read_kilobytes("VmHWM"),
            data_bytes: read_kilobytes("VmData"),
            virtual_bytes: read_kilobytes("VmSize"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SyntheticAlpha15Timing {
    pub origin_capture_latency: Duration,
    pub proof_generation_latency: Option<Duration>,
    pub prover_commit_latency: Option<Duration>,
    pub prover_connect_latency: Option<Duration>,
    pub transcript_commit_latency: Option<Duration>,
    pub prove_config_latency: Option<Duration>,
    pub prove_latency: Option<Duration>,
    pub attestation_latency: Option<Duration>,
    pub presentation_build_latency: Option<Duration>,
    pub presentation_serialization_latency: Option<Duration>,
    pub memory_after_exchange: SyntheticAlpha15Memory,
    pub memory_after_transcript_commit: Option<SyntheticAlpha15Memory>,
    pub memory_after_prove_config: Option<SyntheticAlpha15Memory>,
    pub memory_after_prove: Option<SyntheticAlpha15Memory>,
    pub memory_after_attestation: Option<SyntheticAlpha15Memory>,
    pub memory_after_presentation_build: Option<SyntheticAlpha15Memory>,
    pub memory_after_presentation_serialization: Option<SyntheticAlpha15Memory>,
}

impl Default for SyntheticAlpha15Timing {
    fn default() -> Self {
        Self {
            origin_capture_latency: Duration::ZERO,
            proof_generation_latency: None,
            prover_commit_latency: None,
            prover_connect_latency: None,
            transcript_commit_latency: None,
            prove_config_latency: None,
            prove_latency: None,
            attestation_latency: None,
            presentation_build_latency: None,
            presentation_serialization_latency: None,
            memory_after_exchange: SyntheticAlpha15Memory::current(),
            memory_after_transcript_commit: None,
            memory_after_prove_config: None,
            memory_after_prove: None,
            memory_after_attestation: None,
            memory_after_presentation_build: None,
            memory_after_presentation_serialization: None,
        }
    }
}

fn update_timing(
    last_timing: &Arc<Mutex<Option<SyntheticAlpha15Timing>>>,
    update: impl FnOnce(&mut SyntheticAlpha15Timing),
) {
    if let Ok(mut timing) = last_timing.lock() {
        if let Some(timing) = timing.as_mut() {
            update(timing);
        }
    }
}

pub struct SyntheticAlpha15OriginTransport {
    sent: AtomicBool,
    root_certificate: Arc<Vec<u8>>,
    server_certificate: Arc<Vec<u8>>,
    private_key: Arc<Vec<u8>>,
    last_request: Mutex<Option<Vec<u8>>>,
    last_evidence: Arc<Mutex<Option<SyntheticAlpha15WireEvidence>>>,
    last_timing: Arc<Mutex<Option<SyntheticAlpha15Timing>>>,
}

impl SyntheticAlpha15OriginTransport {
    pub fn new() -> Result<Self, TlsnTransportError> {
        let (root_certificate, server_certificate, private_key) = server_credentials()?;
        Ok(Self {
            sent: AtomicBool::new(false),
            root_certificate: Arc::new(root_certificate),
            server_certificate: Arc::new(server_certificate),
            private_key: Arc::new(private_key),
            last_request: Mutex::new(None),
            last_evidence: Arc::new(Mutex::new(None)),
            last_timing: Arc::new(Mutex::new(None)),
        })
    }

    pub fn last_request(&self) -> Option<Vec<u8>> {
        self.last_request
            .lock()
            .ok()
            .and_then(|request| request.clone())
    }

    pub fn wire_evidence(&self) -> Option<SyntheticAlpha15WireEvidence> {
        self.last_evidence
            .lock()
            .ok()
            .and_then(|evidence| evidence.clone())
    }

    pub fn timing(&self) -> Option<SyntheticAlpha15Timing> {
        self.last_timing.lock().ok().and_then(|timing| *timing)
    }
}

impl TlsnOriginTransport for SyntheticAlpha15OriginTransport {
    fn send_once(&self, request: SerializedOriginRequest) -> TlsnTransportFuture {
        if self.sent.swap(true, Ordering::AcqRel) {
            return Box::pin(async { Err(TlsnTransportError::AlreadySent) });
        }

        let request_bytes = request.bytes().to_vec();
        if let Ok(mut last_request) = self.last_request.lock() {
            *last_request = Some(request_bytes.clone());
        }
        let root_certificate = Arc::clone(&self.root_certificate);
        let server_certificate = Arc::clone(&self.server_certificate);
        let private_key = Arc::clone(&self.private_key);
        let last_evidence = Arc::clone(&self.last_evidence);
        let last_timing = Arc::clone(&self.last_timing);
        Box::pin(async move {
            run_synthetic_exchange(
                SerializedOriginRequest::new(Bytes::from(request_bytes))
                    .map_err(|_| TlsnTransportError::OriginConnectionFailed)?,
                root_certificate,
                server_certificate,
                private_key,
                last_evidence,
                last_timing,
            )
            .await
        })
    }
}

async fn run_synthetic_exchange(
    request: SerializedOriginRequest,
    root_certificate: Arc<Vec<u8>>,
    server_certificate: Arc<Vec<u8>>,
    private_key: Arc<Vec<u8>>,
    last_evidence: Arc<Mutex<Option<SyntheticAlpha15WireEvidence>>>,
    last_timing: Arc<Mutex<Option<SyntheticAlpha15Timing>>>,
) -> Result<TlsnOriginCapture, TlsnTransportError> {
    let exchange_started = Instant::now();
    let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
    let proxy_config = ProxyTlsConfig::builder()
        .server_name(
            DnsName::try_from(SYNTHETIC_SERVER_IDENTITY)
                .map_err(|_| TlsnTransportError::OriginConnectionFailed)?,
        )
        .build()
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    let root_store = RootCertStore {
        roots: vec![CertificateDer(root_certificate.as_ref().clone())],
    };
    let parsed_request = parse_require_info_request(
        request.bytes(),
        SYNTHETIC_SERVER_IDENTITY,
        &ParserLimits::default(),
    )
    .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    let expected_binding = parsed_request.binding;

    let (prover_socket, verifier_socket) = tokio::io::duplex(2 << 23);
    let mut prover_session = Session::new(prover_socket.compat());
    let mut verifier_session = Session::new(verifier_socket.compat());
    let prover = prover_session
        .new_prover(
            ProverConfig::builder()
                .build()
                .map_err(|_| TlsnTransportError::OriginConnectionFailed)?,
        )
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    let verifier = verifier_session
        .new_verifier(
            VerifierConfig::builder()
                .root_store(root_store.clone())
                .build()
                .map_err(|_| TlsnTransportError::OriginConnectionFailed)?,
        )
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    let (prover_driver, prover_handle) = prover_session.split();
    let (verifier_driver, verifier_handle) = verifier_session.split();
    tokio::spawn(prover_driver);
    tokio::spawn(verifier_driver);

    let (origin_socket, verifier_origin_socket) = tokio::io::duplex(2 << 16);
    let origin_task = tokio::spawn(serve_synthetic_origin(
        origin_socket,
        (*server_certificate).clone(),
        (*private_key).clone(),
    ));
    let (exchange_tx, exchange_rx) = oneshot::channel();
    if let Ok(mut timing) = last_timing.lock() {
        *timing = Some(SyntheticAlpha15Timing::default());
    }
    let sparse_proof = std::env::var("FUSOU_SYNTHETIC_PROOF_MODE")
        .is_ok_and(|mode| mode == "sparse");
    let prover_root_store = root_store.clone();
    let request_for_prover = request.clone();
    let prover_timing = Arc::clone(&last_timing);
    let prover_task = tokio::spawn(async move {
        let prover_commit_started = Instant::now();
        let prover = prover
            .commit(proxy_config)
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        update_timing(&prover_timing, |timing| {
            timing.prover_commit_latency = Some(prover_commit_started.elapsed());
        });
        let prover_connect_started = Instant::now();
        let (connection, prover) = prover
            .connect(
                TlsClientConfig::builder()
                    .server_name(ServerName::Dns(
                        DnsName::try_from(SYNTHETIC_SERVER_IDENTITY)
                            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?,
                    ))
                    .root_store(prover_root_store)
                    .build()
                    .map_err(|_| TlsnTransportError::OriginConnectionFailed)?,
            )
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        update_timing(&prover_timing, |timing| {
            timing.prover_connect_latency = Some(prover_connect_started.elapsed());
        });
        let prover_task = tokio::spawn(prover.into_future());
        let mut transport = ProverOwnedTlsTransport::new(connection);
        transport
            .send_actual_require_info(
                request_for_prover.bytes(),
                SYNTHETIC_SERVER_IDENTITY,
                &expected_binding,
            )
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        let raw_response = transport
            .read_response_to_end()
            .await
            .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
        let response_sha256 = sha256(&raw_response);
        let response = parse_origin_response(raw_response.clone())?;
        exchange_tx
            .send(TlsnOriginExchange {
                response,
                transcript: UnverifiedTlsnTranscript {
                    request_sha256: sha256(request_for_prover.bytes()),
                    response_sha256,
                },
            })
            .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
        transport
            .close()
            .await
            .map_err(|_| TlsnTransportError::ResponseReadFailed)?;

        let mut prover = prover_task
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        let transcript_commit_started = Instant::now();
        let mut transcript_commit = TranscriptCommitConfig::builder(prover.transcript());
        let sent_len = prover.transcript().sent().len();
        transcript_commit
            .commit_sent(0..sent_len)
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        let response_commitment_ranges = if sparse_proof {
            sparse_response_ranges(&raw_response)?
        } else {
            response_commitment_ranges(&raw_response)?
        };
        for range in response_commitment_ranges {
            transcript_commit
                .commit_recv(range)
                .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        }
        let transcript_commit = transcript_commit
            .build()
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        update_timing(&prover_timing, |timing| {
            timing.transcript_commit_latency = Some(transcript_commit_started.elapsed());
            timing.memory_after_transcript_commit = Some(SyntheticAlpha15Memory::current());
        });
        let mut request_config_builder = RequestConfig::builder();
        request_config_builder.transcript_commit(transcript_commit.clone());
        let request_config = request_config_builder
            .build()
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        let prove_config_started = Instant::now();
        let mut prove_config = tlsn::config::prove::ProveConfig::builder(prover.transcript());
        prove_config
            .transcript_commit(transcript_commit)
            .server_identity();
        let received_len = prover.transcript().received().len();
        prove_config
            .reveal_sent(0..sent_len)
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        if sparse_proof {
            for range in sparse_response_ranges(&raw_response)? {
                prove_config
                    .reveal_recv(range)
                    .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
            }
        } else {
            prove_config
                .reveal_recv(0..received_len)
                .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        }
        let prove_config = prove_config
            .build()
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        update_timing(&prover_timing, |timing| {
            timing.prove_config_latency = Some(prove_config_started.elapsed());
            timing.memory_after_prove_config = Some(SyntheticAlpha15Memory::current());
        });
        let prove_started = Instant::now();
        let prover_output = prover
            .prove(&prove_config)
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        update_timing(&prover_timing, |timing| {
            timing.prove_latency = Some(prove_started.elapsed());
            timing.memory_after_prove = Some(SyntheticAlpha15Memory::current());
        });
        let prover_transcript = prover.transcript().clone();
        let tls_transcript = prover.tls_transcript().clone();
        let server_name = ServerName::Dns(
            DnsName::try_from(SYNTHETIC_SERVER_IDENTITY)
                .map_err(|_| TlsnTransportError::OriginConnectionFailed)?,
        );
        let handshake_data = tlsn::connection::HandshakeData {
            certs: tls_transcript
                .server_cert_chain()
                .ok_or(TlsnTransportError::OriginConnectionFailed)?
                .to_vec(),
            sig: tls_transcript
                .server_signature()
                .ok_or(TlsnTransportError::OriginConnectionFailed)?
                .clone(),
            binding: tls_transcript.certificate_binding().clone(),
        };
        let mut request_builder = AttestationRequest::builder(&request_config);
        request_builder
            .server_name(server_name)
            .handshake_data(handshake_data)
            .transcript(prover_transcript)
            .transcript_commitments(
                prover_output.transcript_secrets,
                prover_output.transcript_commitments,
            );
        let (attestation_request, secrets) = request_builder
            .build(&CryptoProvider::default())
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        prover
            .close()
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        Ok::<(AttestationRequest, tlsn::attestation::Secrets), TlsnTransportError>((
            attestation_request,
            secrets,
        ))
    });

    let verifier_task = tokio::spawn(async move {
        let verifier = verifier
            .commit()
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        let VerifierCommitStart::Proxy(verifier) = verifier else {
            return Err(TlsnTransportError::OriginConnectionFailed);
        };
        let verifier = verifier
            .accept()
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        let verifier = verifier
            .run(verifier_origin_socket.compat())
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        let (output, verifier) = verifier
            .verify()
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?
            .accept()
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        let transcript = output
            .transcript
            .as_ref()
            .ok_or(TlsnTransportError::ResponseReadFailed)?;
        let sent = transcript.materialize_sent();
        let received = transcript.materialize_received();
        let tls_transcript = verifier.tls_transcript().clone();
        verifier
            .close()
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        Ok((sent, received, output, tls_transcript))
    });

    let exchange = exchange_rx
        .await
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    let expected_request = request.bytes().to_vec();
    update_timing(&last_timing, |timing| {
        timing.origin_capture_latency = exchange_started.elapsed();
        timing.memory_after_exchange = SyntheticAlpha15Memory::current();
    });
    let proof_exchange = exchange.clone();
    let proof_timing = Arc::clone(&last_timing);
    let proof = ProofContinuation::new(Box::pin(async move {
        let proof_started = Instant::now();
        let (prover_result, verifier_result, origin_result) =
            tokio::join!(prover_task, verifier_task, origin_task);
        prover_handle.close();
        verifier_handle.close();
        let (attestation_request, secrets) = prover_result
            .map_err(|_| ProofContinuationError::ProverFinalization)?
            .map_err(|_| ProofContinuationError::Prove)?;
        let (
            authenticated_request,
            authenticated_response,
            verifier_output,
            verifier_tls_transcript,
        ) = verifier_result
            .map_err(|_| ProofContinuationError::Notary)?
            .map_err(|_| ProofContinuationError::Notary)?;
        let (origin_request, raw_response) = origin_result
            .map_err(|_| ProofContinuationError::ProverFinalization)?
            .map_err(|_| ProofContinuationError::ProverFinalization)?;
        let sparse_ranges = sparse_response_ranges(&raw_response)
            .map_err(|_| ProofContinuationError::ProverFinalization)?;
        let expected_response = proof_exchange.response.raw_response_bytes.clone();
        let response_matches = authenticated_response.len() == raw_response.len()
            && if sparse_proof {
                sparse_ranges.iter().all(|range| {
                    authenticated_response.get(range.clone()) == raw_response.get(range.clone())
                })
            } else {
                authenticated_response == raw_response
            };
        if authenticated_request != origin_request || !response_matches {
            return Err(ProofContinuationError::ProverFinalization);
        }
        if origin_request != expected_request || raw_response != expected_response {
            return Err(ProofContinuationError::ProverFinalization);
        }
        let attestation_started = Instant::now();
        let mut notary_provider = CryptoProvider::default();
        notary_provider
            .signer
            .set_secp256k1(&[1_u8; 32])
            .map_err(|_| ProofContinuationError::Notary)?;
        let mut attestation_config_builder = AttestationConfig::builder();
        attestation_config_builder
            .supported_signature_algs(notary_provider.signer.supported_algs().collect::<Vec<_>>());
        let attestation_config = attestation_config_builder
            .build()
            .map_err(|_| ProofContinuationError::Notary)?;
        let attestation_request_for_validation = attestation_request.clone();
        let mut attestation_builder = Attestation::builder(&attestation_config)
            .accept_request(attestation_request)
            .map_err(|_| ProofContinuationError::AttestationRequest)?;
        let CertBinding::V1_2(binding) = verifier_tls_transcript.certificate_binding() else {
            return Err(ProofContinuationError::AttestationRequest);
        };
        let sent = application_data_length(&verifier_tls_transcript, true)
            .map_err(|_| ProofContinuationError::AttestationRequest)?;
        let received = application_data_length(&verifier_tls_transcript, false)
            .map_err(|_| ProofContinuationError::AttestationRequest)?;
        attestation_builder
            .connection_info(ConnectionInfo {
                time: verifier_tls_transcript.time(),
                version: verifier_tls_transcript.version(),
                transcript_length: TranscriptLength { sent, received },
            })
            .server_ephemeral_key(binding.server_ephemeral_key.clone())
            .transcript_commitments(verifier_output.transcript_commitments);
        let attestation = attestation_builder
            .build(&notary_provider)
            .map_err(|_| ProofContinuationError::Notary)?;
        attestation_request_for_validation
            .validate(&attestation, &CryptoProvider::default())
            .map_err(|_| ProofContinuationError::AttestationValidation)?;
        update_timing(&proof_timing, |timing| {
            timing.attestation_latency = Some(attestation_started.elapsed());
            timing.memory_after_attestation = Some(SyntheticAlpha15Memory::current());
        });
        let (sent_len, received_len) = secrets.transcript().len();
        let presentation_provider = CryptoProvider::default();
        let presentation_build_started = Instant::now();
        let presentation = if sparse_proof {
            None
        } else {
            let mut transcript_proof_builder = secrets.transcript_proof_builder();
            transcript_proof_builder
                .reveal_sent(0..sent_len)
                .map_err(|_| ProofContinuationError::Presentation)?;
            transcript_proof_builder
                .reveal_recv(0..received_len)
                .map_err(|_| ProofContinuationError::Presentation)?;
            let transcript_proof = transcript_proof_builder
                .build()
                .map_err(|_| ProofContinuationError::Presentation)?;
            let mut presentation_builder = attestation.presentation_builder(&presentation_provider);
            presentation_builder
                .identity_proof(secrets.identity_proof())
                .transcript_proof(transcript_proof);
            Some(
                presentation_builder
                    .build()
                    .map_err(|_| ProofContinuationError::Presentation)?,
            )
        };
        let mut sparse_transcript_proof = secrets.transcript_proof_builder();
        sparse_transcript_proof
            .reveal_sent(0..origin_request.len())
            .map_err(|_| ProofContinuationError::Presentation)?;
        for range in &sparse_ranges {
            sparse_transcript_proof
                .reveal_recv(range.clone())
                .map_err(|_| ProofContinuationError::Presentation)?;
        }
        let sparse_transcript_proof = sparse_transcript_proof
            .build()
            .map_err(|_| ProofContinuationError::Presentation)?;
        let mut sparse_presentation_builder =
            attestation.presentation_builder(&presentation_provider);
        sparse_presentation_builder
            .identity_proof(secrets.identity_proof())
            .transcript_proof(sparse_transcript_proof);
        let sparse_presentation = sparse_presentation_builder
            .build()
            .map_err(|_| ProofContinuationError::Presentation)?;
        update_timing(&proof_timing, |timing| {
            timing.presentation_build_latency = Some(presentation_build_started.elapsed());
            timing.memory_after_presentation_build = Some(SyntheticAlpha15Memory::current());
        });
        let presentation_serialization_started = Instant::now();
        let notary_verifying_key = bincode::serialize(sparse_presentation.verifying_key())
            .map_err(|_| ProofContinuationError::Presentation)?;
        let presentation = presentation
            .map(|presentation| bincode::serialize(&presentation))
            .transpose()
            .map_err(|_| ProofContinuationError::Presentation)?;
        let sparse_presentation = bincode::serialize(&sparse_presentation)
            .map_err(|_| ProofContinuationError::Presentation)?;
        update_timing(&proof_timing, |timing| {
            timing.presentation_serialization_latency =
                Some(presentation_serialization_started.elapsed());
            timing.memory_after_presentation_serialization = Some(SyntheticAlpha15Memory::current());
        });
        if let Ok(mut stored_evidence) = last_evidence.lock() {
            let committed_response_ranges = if sparse_proof {
                sparse_ranges.clone()
            } else {
                response_commitment_ranges(&raw_response)
                    .map_err(|_| ProofContinuationError::ProverFinalization)?
            };
            let committed_response_bytes = if sparse_proof {
                sparse_ranges
                    .iter()
                    .map(Range::len)
                    .sum()
            } else {
                raw_response.len()
            };
            *stored_evidence = Some(SyntheticAlpha15WireEvidence {
                origin_request,
                authenticated_request,
                origin_response: raw_response.clone(),
                authenticated_response: raw_response,
                committed_request_bytes: expected_request.len(),
                committed_response_bytes,
                committed_response_range_count: committed_response_ranges.len(),
                committed_response_largest_range_bytes: committed_response_ranges
                    .iter()
                    .map(Range::len)
                    .max()
                    .unwrap_or(0),
                disclosed_response_range_count: sparse_ranges.len(),
                disclosed_response_largest_range_bytes: sparse_ranges
                    .iter()
                    .map(Range::len)
                    .max()
                    .unwrap_or(0),
                presentation,
                sparse_presentation: Some(sparse_presentation),
                root_certificate: Some((*root_certificate).clone()),
                notary_verifying_key: Some(notary_verifying_key),
                presentation_available: !sparse_proof,
            });
        }
        if let Ok(mut timing) = last_timing.lock() {
            if let Some(timing) = timing.as_mut() {
                timing.proof_generation_latency = Some(proof_started.elapsed());
            }
        }
        Ok(())
    }));
    Ok(TlsnOriginCapture { exchange, proof })
}

fn application_data_length(
    transcript: &TlsTranscript,
    sent: bool,
) -> Result<u32, TlsnTransportError> {
    let records = if sent {
        transcript.sent()
    } else {
        transcript.recv()
    };
    records
        .iter()
        .filter(|record| record.typ == ContentType::ApplicationData)
        .map(|record| record.ciphertext.len())
        .try_fold(0_u32, |total, length| {
            let length =
                u32::try_from(length).map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
            total
                .checked_add(length)
                .ok_or(TlsnTransportError::OriginConnectionFailed)
        })
}

fn server_credentials() -> Result<(Vec<u8>, Vec<u8>, Vec<u8>), TlsnTransportError> {
    let mut root_params = CertificateParams::default();
    root_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    root_params.key_usages = vec![KeyUsagePurpose::KeyCertSign];
    let root_key_pair =
        KeyPair::generate().map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    let root_certificate = root_params
        .self_signed(&root_key_pair)
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;

    let mut server_params = CertificateParams::new(vec![SYNTHETIC_SERVER_IDENTITY.to_owned()])
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    server_params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    server_params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    let server_key_pair =
        KeyPair::generate().map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    let server_certificate = server_params
        .signed_by(&server_key_pair, &root_certificate, &root_key_pair)
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    Ok((
        root_certificate.der().to_vec(),
        server_certificate.der().to_vec(),
        server_key_pair.serialize_der(),
    ))
}

async fn serve_synthetic_origin(
    socket: tokio::io::DuplexStream,
    certificate: Vec<u8>,
    private_key: Vec<u8>,
) -> Result<(Vec<u8>, Vec<u8>), ()> {
    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![certificate.into()],
            PrivateKeyDer::try_from(private_key).map_err(|_| ())?,
        )
        .map_err(|_| ())?;
    let acceptor = TlsAcceptor::from(Arc::new(config));
    let mut stream = acceptor.accept(socket).await.map_err(|_| ())?;
    let mut request = Vec::new();
    let mut buffer = [0_u8; 2048];
    loop {
        let count = stream.read(&mut buffer).await.map_err(|_| ())?;
        if count == 0 {
            return Err(());
        }
        request.extend_from_slice(&buffer[..count]);
        if let Some(position) = request.windows(4).position(|window| window == b"\r\n\r\n") {
            let header_end = position + 4;
            let content_length = request[..position]
                .split(|byte| *byte == b'\n')
                .find_map(|line| {
                    let line = line.strip_suffix(b"\r").unwrap_or(line);
                    let separator = line.iter().position(|byte| *byte == b':')?;
                    let (name, value_with_separator) = line.split_at(separator);
                    let value = &value_with_separator[1..];
                    name.eq_ignore_ascii_case(b"content-length").then(|| {
                        value
                            .iter()
                            .copied()
                            .skip_while(u8::is_ascii_whitespace)
                            .collect::<Vec<_>>()
                    })
                })
                .and_then(|value| String::from_utf8(value).ok())
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(0);
            if request.len() >= header_end + content_length {
                break;
            }
        }
    }

    let body = synthetic_response_body()?;
    let mut response = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    response.extend_from_slice(&body);
    stream.write_all(&response).await.map_err(|_| ())?;
    stream.shutdown().await.map_err(|_| ())?;
    Ok((request, response))
}

fn synthetic_response_body() -> Result<Vec<u8>, ()> {
    if let Ok(path) = std::env::var("FUSOU_SYNTHETIC_RESPONSE_FIXTURE_PATH") {
        let bytes = std::fs::read(path).map_err(|_| ())?;
        let opening = if bytes.starts_with(b"---\r\n") {
            5
        } else if bytes.starts_with(b"---\n") {
            4
        } else {
            return Err(());
        };
        let closing_start = bytes[opening..]
            .windows(4)
            .position(|window| window == b"\n---")
            .map(|position| opening + position)
            .ok_or(())?;
        let delimiter_end = closing_start.checked_add(4).ok_or(())?;
        let payload_start = if bytes.get(delimiter_end..delimiter_end + 2) == Some(b"\r\n") {
            delimiter_end + 2
        } else if bytes.get(delimiter_end..delimiter_end + 1) == Some(b"\n") {
            delimiter_end + 1
        } else {
            return Err(());
        };
        return Ok(bytes[payload_start..].to_vec());
    }

    let padding_bytes = std::env::var("FUSOU_SYNTHETIC_RESPONSE_PADDING_BYTES")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let padding_byte = std::env::var("FUSOU_SYNTHETIC_RESPONSE_HIDDEN_BYTE")
        .ok()
        .and_then(|value| value.bytes().next())
        .filter(u8::is_ascii_graphic)
        .unwrap_or(b'a');
    let hidden_kind = std::env::var("FUSOU_SYNTHETIC_RESPONSE_HIDDEN_KIND")
        .unwrap_or_else(|_| "string".to_owned());
    let padding = if padding_bytes == 0 {
        "synthetic-padding".to_owned()
    } else {
        let byte = if hidden_kind == "number" && !padding_byte.is_ascii_digit() {
            b'1'
        } else {
            padding_byte
        };
        char::from(byte).to_string().repeat(padding_bytes)
    };
    let hidden_value = match hidden_kind.as_str() {
        "string" => format!("\"{padding}\""),
        "number" => padding,
        "object" => format!("{{\"nested\":\"{padding}\"}}"),
        "array" => format!("[\"{padding}\"]"),
        _ => return Err(()),
    };
    Ok(format!(
        "svdata={{\"api_result\":1,\"api_data\":{{\"api_basic\":{{\"api_member_id\":16189463}}}},\"padding\":{hidden_value}}}"
    )
    .into_bytes())
}

fn sparse_response_ranges(response: &[u8]) -> Result<Vec<Range<usize>>, TlsnTransportError> {
    plan_require_info_response_sparse_ranges(response, &ParserLimits::default())
        .map_err(|_| TlsnTransportError::ResponseReadFailed)
}

fn response_commitment_ranges(response: &[u8]) -> Result<Vec<Range<usize>>, TlsnTransportError> {
    let sparse_ranges = sparse_response_ranges(response)?;
    let mut ranges = Vec::new();
    let mut cursor = 0;
    for range in sparse_ranges {
        if cursor < range.start {
            ranges.push(cursor..range.start);
        }
        ranges.push(range.clone());
        cursor = range.end;
    }
    if cursor < response.len() {
        ranges.push(cursor..response.len());
    }
    Ok(ranges)
}

fn parse_origin_response(raw_response: Vec<u8>) -> Result<TlsnOriginResponse, TlsnTransportError> {
    let position = raw_response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or(TlsnTransportError::ResponseReadFailed)?;
    let header_end = position + 4;
    let header_text = std::str::from_utf8(&raw_response[..position])
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    let mut lines = header_text.split("\r\n");
    let status_code = lines
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or(TlsnTransportError::ResponseReadFailed)?;
    let mut headers = HeaderMap::new();
    for line in lines {
        let (name, value) = line
            .split_once(':')
            .ok_or(TlsnTransportError::ResponseReadFailed)?;
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
        let value = HeaderValue::from_str(value.trim())
            .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
        headers.append(name, value);
    }
    let raw_response = Bytes::from(raw_response);
    let body = raw_response.slice(header_end..);
    if headers
        .get("content-length")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        != Some(body.len())
    {
        return Err(TlsnTransportError::ResponseReadFailed);
    }
    Ok(TlsnOriginResponse::new(
        StatusCode::from_u16(status_code).map_err(|_| TlsnTransportError::ResponseReadFailed)?,
        headers,
        body,
        raw_response,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::experimental_tlsn::ProofContinuationState;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use fusou_tlsn_verifier::BINDING_PREFIX;
    use uuid::Uuid;

    fn binding_value() -> String {
        let session = Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000").unwrap();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(BINDING_PREFIX);
        bytes.extend_from_slice(&16_u16.to_be_bytes());
        bytes.extend_from_slice(session.as_bytes());
        bytes.extend_from_slice(&32_u16.to_be_bytes());
        bytes.extend_from_slice(&[0x42_u8; 32]);
        URL_SAFE_NO_PAD.encode(bytes)
    }

    fn request() -> SerializedOriginRequest {
        synthetic_serialized_require_info_request(
            &AttestationBinding::new(binding_value()).unwrap(),
        )
        .unwrap()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn synthetic_transport_uses_alpha15_and_preserves_wire_bytes() {
        let transport = SyntheticAlpha15OriginTransport::new().unwrap();
        let request = request();
        let expected_request = request.bytes().to_vec();
        let capture = transport.send_once(request).await.unwrap();
        assert_eq!(
            capture.proof.state().unwrap(),
            ProofContinuationState::Pending
        );
        assert!(transport.wire_evidence().is_none());
        let exchange = capture.exchange;
        capture.proof.run().await.unwrap();

        assert_eq!(
            transport.last_request().as_deref(),
            Some(expected_request.as_slice())
        );
        assert_eq!(exchange.response.status, StatusCode::OK);
        assert_eq!(
            exchange.transcript.request_sha256,
            sha256(&expected_request)
        );
        assert_eq!(
            exchange.transcript.response_sha256,
            sha256(&exchange.response.raw_response_bytes)
        );
        let evidence = transport.wire_evidence().expect("wire evidence");
        let sparse_mode =
            std::env::var("FUSOU_SYNTHETIC_PROOF_MODE").is_ok_and(|mode| mode == "sparse");
        assert_eq!(evidence.origin_request, expected_request);
        assert_eq!(evidence.authenticated_request, evidence.origin_request);
        assert_eq!(evidence.authenticated_response, evidence.origin_response);
        assert_eq!(evidence.committed_request_bytes, evidence.origin_request.len());
        if sparse_mode {
            assert!(evidence.committed_response_bytes < evidence.origin_response.len());
            assert_eq!(
                evidence.committed_response_range_count,
                evidence.disclosed_response_range_count
            );
        } else {
            assert_eq!(
                evidence.committed_response_bytes,
                evidence.origin_response.len()
            );
        }
        assert_eq!(evidence.presentation_available, !sparse_mode);
        assert_eq!(
            evidence
                .presentation
                .as_ref()
                .is_some_and(|bytes| !bytes.is_empty()),
            !sparse_mode
        );
        let sparse_presentation = evidence
            .sparse_presentation
            .as_ref()
            .expect("sparse Presentation");
        let notary_verifying_key = evidence
            .notary_verifying_key
            .as_ref()
            .expect("Notary verifying key");
        let root_certificate = evidence
            .root_certificate
            .as_ref()
            .expect("root certificate");
        let sparse_transcript =
            fusou_tlsn_verifier::tlsn_alpha15::verify_alpha15_presentation_with_trusted_notary_key_and_trust_anchor(
                sparse_presentation,
                root_certificate,
                notary_verifying_key,
            )
            .unwrap();
        assert!(sparse_transcript.request_transcript_sha256().is_some());
        assert_eq!(sparse_transcript.response_transcript_sha256(), None);
        let profile =
            fusou_tlsn_verifier::tlsn_alpha15::RequireInfoDisclosureProfile::from_server_identity(
                SYNTHETIC_SERVER_IDENTITY,
            )
            .unwrap();
        assert_eq!(
            sparse_transcript.verify_require_info(&profile, &ParserLimits::default()),
            Err(
                fusou_tlsn_verifier::tlsn_alpha15::Alpha15AdapterError::Parser(
                    fusou_tlsn_verifier::VerifierError::InvalidRange(
                        "authenticated read crosses an undisclosed range"
                    )
                )
            )
        );
        let sparse_profile =
            fusou_tlsn_verifier::tlsn_alpha15::SparseRequireInfoDisclosureProfile::from_server_identity(
                SYNTHETIC_SERVER_IDENTITY,
            )
            .unwrap();
        let sparse_result = sparse_transcript
            .verify_require_info_sparse(&sparse_profile, &ParserLimits::default())
            .unwrap();
        assert_eq!(sparse_result.verified_member_id, "16189463");
        assert!(sparse_result.response_transcript_sha256.is_none());
        assert!(sparse_result
            .revealed_response_ranges
            .iter()
            .map(|range| range.length)
            .sum::<u64>()
            < sparse_result.response_transcript_size);
        assert!(evidence
            .root_certificate
            .as_ref()
            .is_some_and(|bytes| !bytes.is_empty()));
        assert!(String::from_utf8_lossy(&exchange.response.body).contains("16189463"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn synthetic_transport_rejects_duplicate_send() {
        let transport = SyntheticAlpha15OriginTransport::new().unwrap();
        transport.send_once(request()).await.unwrap();
        assert!(matches!(
            transport.send_once(request()).await,
            Err(TlsnTransportError::AlreadySent)
        ));
    }

    #[tokio::test]
    async fn synthetic_transport_rejects_noncanonical_target_before_starting_tasks() {
        let transport = SyntheticAlpha15OriginTransport::new().unwrap();
        let request = String::from_utf8(request().bytes().to_vec())
            .unwrap()
            .replacen(
                "/kcsapi/api_get_member/require_info HTTP/1.1",
                "/kcsapi/api_get_member/require_info?api_token=actual HTTP/1.1",
                1,
            );
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            transport.send_once(SerializedOriginRequest::new(Bytes::from(request)).unwrap()),
        )
        .await
        .expect("invalid target should fail without hanging");
        assert!(matches!(
            result,
            Err(TlsnTransportError::OriginConnectionFailed)
        ));
    }
}
