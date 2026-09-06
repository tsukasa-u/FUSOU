//! FUSOU-owned request transport boundary for the pinned alpha.15 Prover.

use crate::{
    parse_binding_value, parse_require_info_request, validate_server_identity, ParserLimits,
    VerifierError, BINDING_HEADER, REQUIRE_INFO_TARGET,
};
use futures::io::{AsyncReadExt, AsyncWriteExt};
use thiserror::Error;
use tlsn::prover::TlsConnection;

#[derive(Debug, Error)]
pub enum ProverTransportError {
    #[error("invalid prover-owned request: {0}")]
    InvalidRequest(#[from] VerifierError),
    #[error("require_info request has already been sent")]
    RequestAlreadySent,
    #[error("require_info request has not been sent")]
    RequestNotSent,
    #[error("response has already been read")]
    ResponseAlreadyRead,
    #[error("prover-owned TLS connection is closed")]
    ConnectionClosed,
    #[error("prover-owned TLS I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, ProverTransportError>;

pub fn build_require_info_request(server_identity: &str, binding_value: &str) -> Result<Vec<u8>> {
    validate_server_identity(server_identity)?;
    parse_binding_value(binding_value)?;

    let request = format!(
        "POST {REQUIRE_INFO_TARGET} HTTP/1.1\r\nHost: {server_identity}\r\n{BINDING_HEADER}: {binding_value}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    )
    .into_bytes();

    parse_require_info_request(&request, server_identity, &ParserLimits::default())?;
    Ok(request)
}

pub struct ProverOwnedTlsTransport {
    connection: Option<TlsConnection>,
    request_sent: bool,
    response_read: bool,
}

impl ProverOwnedTlsTransport {
    pub fn new(connection: TlsConnection) -> Self {
        Self {
            connection: Some(connection),
            request_sent: false,
            response_read: false,
        }
    }

    pub fn request_sent(&self) -> bool {
        self.request_sent
    }

    pub async fn send_require_info(
        &mut self,
        server_identity: &str,
        binding_value: &str,
    ) -> Result<()> {
        if self.request_sent {
            return Err(ProverTransportError::RequestAlreadySent);
        }
        let request = build_require_info_request(server_identity, binding_value)?;
        let connection = self
            .connection
            .as_mut()
            .ok_or(ProverTransportError::ConnectionClosed)?;

        self.request_sent = true;
        connection.write_all(&request).await?;
        connection.flush().await?;
        Ok(())
    }

    pub async fn read_response_to_end(&mut self) -> Result<Vec<u8>> {
        if !self.request_sent {
            return Err(ProverTransportError::RequestNotSent);
        }
        if self.response_read {
            return Err(ProverTransportError::ResponseAlreadyRead);
        }
        let connection = self
            .connection
            .as_mut()
            .ok_or(ProverTransportError::ConnectionClosed)?;

        self.response_read = true;
        let mut response = Vec::new();
        connection.read_to_end(&mut response).await?;
        Ok(response)
    }

    pub async fn close(&mut self) -> Result<()> {
        let Some(mut connection) = self.connection.take() else {
            return Ok(());
        };
        connection.close().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::experimental::{ExperimentalRequireInfoEvidence, ExperimentalRequireInfoProbe};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use rcgen::{
        BasicConstraints, CertificateParams, ExtendedKeyUsagePurpose, IsCa, KeyPair,
        KeyUsagePurpose,
    };
    use std::{future::IntoFuture, sync::Arc};
    use tlsn::{
        attestation::{
            presentation::Presentation,
            request::{Request as AttestationRequest, RequestConfig},
            Attestation, AttestationConfig, CryptoProvider,
        },
        config::{
            prove::ProveConfig, prover::ProverConfig, tls::TlsClientConfig,
            tls_commit::proxy::ProxyTlsConfig, verifier::VerifierConfig,
        },
        connection::{
            CertBinding, ConnectionInfo, DnsName, HandshakeData, ServerName, TranscriptLength,
        },
        transcript::{ContentType, TranscriptCommitConfig},
        verifier::VerifierCommitStart,
        webpki::{CertificateDer, RootCertStore, ServerCertVerifier},
        Session,
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio_rustls::{
        rustls::{pki_types::PrivateKeyDer, ServerConfig},
        TlsAcceptor,
    };
    use tokio_util::compat::TokioAsyncReadCompatExt;

    const SERVER_IDENTITY: &str = "game.example.test";

    fn binding_value() -> String {
        let session = uuid::Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000").unwrap();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(crate::BINDING_PREFIX);
        bytes.extend_from_slice(&16_u16.to_be_bytes());
        bytes.extend_from_slice(session.as_bytes());
        bytes.extend_from_slice(&32_u16.to_be_bytes());
        bytes.extend_from_slice(&[0x42_u8; 32]);
        URL_SAFE_NO_PAD.encode(bytes)
    }

    fn server_credentials() -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        let mut root_params = CertificateParams::default();
        root_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        root_params.key_usages = vec![KeyUsagePurpose::KeyCertSign];
        let root_key_pair = KeyPair::generate().unwrap();
        let root_certificate = root_params.self_signed(&root_key_pair).unwrap();

        let mut server_params = CertificateParams::new(vec![SERVER_IDENTITY.to_owned()]).unwrap();
        server_params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        server_params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        let server_key_pair = KeyPair::generate().unwrap();
        let server_certificate = server_params
            .signed_by(&server_key_pair, &root_certificate, &root_key_pair)
            .unwrap();
        (
            root_certificate.der().to_vec(),
            server_certificate.der().to_vec(),
            server_key_pair.serialize_der(),
        )
    }

    async fn serve_origin(
        socket: tokio::io::DuplexStream,
        certificate: Vec<u8>,
        private_key: Vec<u8>,
    ) -> (Vec<u8>, Vec<u8>) {
        let config = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                vec![certificate.into()],
                PrivateKeyDer::try_from(private_key).unwrap(),
            )
            .unwrap();
        let acceptor = TlsAcceptor::from(Arc::new(config));
        let mut stream = acceptor.accept(socket).await.unwrap();

        let mut request = Vec::new();
        let mut buffer = [0_u8; 2048];
        loop {
            let count = stream.read(&mut buffer).await.unwrap();
            assert_ne!(count, 0, "origin closed before the request headers arrived");
            request.extend_from_slice(&buffer[..count]);
            if request.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }

        let body =
            b"svdata={\"api_result\":1,\"api_data\":{\"api_basic\":{\"api_member_id\":16189463}}}";
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        response.extend_from_slice(body);
        stream.write_all(&response).await.unwrap();
        stream.shutdown().await.unwrap();
        (request, response)
    }

    #[test]
    fn request_builder_is_strict_and_one_shot() {
        let binding = binding_value();
        let request = build_require_info_request(SERVER_IDENTITY, &binding).unwrap();
        assert_eq!(
            parse_require_info_request(&request, SERVER_IDENTITY, &ParserLimits::default())
                .unwrap()
                .binding
                .value,
            binding
        );
        assert!(build_require_info_request(SERVER_IDENTITY, "not-a-binding").is_err());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn proxy_transport_authenticates_prover_owned_wire_bytes() {
        let binding = binding_value();
        let probe = ExperimentalRequireInfoProbe::new(SERVER_IDENTITY, &binding).unwrap();
        let expected_request = probe.request().to_vec();
        let (root_certificate, server_certificate, private_key) = server_credentials();

        let proxy_config = ProxyTlsConfig::builder()
            .server_name(DnsName::try_from(SERVER_IDENTITY).unwrap())
            .build()
            .unwrap();
        let root_store = RootCertStore {
            roots: vec![CertificateDer(root_certificate.clone())],
        };

        let (prover_socket, verifier_socket) = tokio::io::duplex(2 << 23);
        let mut prover_session = Session::new(prover_socket.compat());
        let mut verifier_session = Session::new(verifier_socket.compat());
        let prover = prover_session
            .new_prover(ProverConfig::builder().build().unwrap())
            .unwrap();
        let verifier = verifier_session
            .new_verifier(
                VerifierConfig::builder()
                    .root_store(root_store.clone())
                    .build()
                    .unwrap(),
            )
            .unwrap();

        let (prover_driver, prover_handle) = prover_session.split();
        let (verifier_driver, verifier_handle) = verifier_session.split();
        tokio::spawn(prover_driver);
        tokio::spawn(verifier_driver);

        let (origin_socket, verifier_origin_socket) = tokio::io::duplex(2 << 16);
        let origin_task =
            tokio::spawn(serve_origin(origin_socket, server_certificate, private_key));
        let prover_root_store = root_store.clone();

        let prover_task = tokio::spawn(async move {
            let prover = prover.commit(proxy_config).await.unwrap();
            let (connection, prover) = prover
                .connect(
                    TlsClientConfig::builder()
                        .server_name(ServerName::Dns(DnsName::try_from(SERVER_IDENTITY).unwrap()))
                        .root_store(prover_root_store)
                        .build()
                        .unwrap(),
                )
                .unwrap();
            let prover_task = tokio::spawn(prover.into_future());
            let mut transport = ProverOwnedTlsTransport::new(connection);
            transport
                .send_require_info(SERVER_IDENTITY, &binding)
                .await
                .unwrap();
            assert!(transport.request_sent());
            assert!(matches!(
                transport.send_require_info(SERVER_IDENTITY, &binding).await,
                Err(ProverTransportError::RequestAlreadySent)
            ));
            let response = transport.read_response_to_end().await.unwrap();
            transport.close().await.unwrap();
            let evidence = ExperimentalRequireInfoEvidence {
                request: probe.request().to_vec(),
                binding: probe.binding().clone(),
                verified_member_id: crate::parse_require_info_response(
                    &response,
                    &ParserLimits::default(),
                )
                .unwrap()
                .verified_member_id,
                response,
            };
            assert_eq!(evidence.verified_member_id, "16189463");

            let mut prover = prover_task.await.unwrap().unwrap();
            let mut transcript_commit = TranscriptCommitConfig::builder(prover.transcript());
            transcript_commit
                .commit_sent(0..prover.transcript().sent().len())
                .unwrap();
            transcript_commit
                .commit_recv(0..prover.transcript().received().len())
                .unwrap();
            let mut prove_config = ProveConfig::builder(prover.transcript());
            prove_config.transcript_commit(transcript_commit.build().unwrap());
            prove_config.server_identity();
            prove_config.reveal_sent_all().unwrap();
            prove_config.reveal_recv_all().unwrap();
            let prove_config = prove_config.build().unwrap();
            let prover_output = prover.prove(&prove_config).await.unwrap();
            let prover_transcript = prover.transcript().clone();
            let tls_transcript = prover.tls_transcript().clone();
            prover.close().await.unwrap();

            let tlsn::prover::ProverOutput {
                transcript_commitments,
                transcript_secrets,
            } = prover_output;
            let request_config = RequestConfig::builder().build().unwrap();
            let mut request_builder = AttestationRequest::builder(&request_config);
            request_builder
                .server_name(ServerName::Dns(DnsName::try_from(SERVER_IDENTITY).unwrap()))
                .handshake_data(HandshakeData {
                    certs: tls_transcript
                        .server_cert_chain()
                        .expect("server cert chain is present")
                        .to_vec(),
                    sig: tls_transcript
                        .server_signature()
                        .expect("server signature is present")
                        .clone(),
                    binding: tls_transcript.certificate_binding().clone(),
                })
                .transcript(prover_transcript)
                .transcript_commitments(transcript_secrets, transcript_commitments);
            let (attestation_request, secrets) =
                request_builder.build(&CryptoProvider::default()).unwrap();
            (evidence, attestation_request, secrets)
        });

        let verifier_task = tokio::spawn(async move {
            let verifier = verifier.commit().await.unwrap();
            let VerifierCommitStart::Proxy(verifier) = verifier else {
                panic!("expected proxy verifier");
            };
            let verifier = verifier
                .accept()
                .await
                .unwrap()
                .run(verifier_origin_socket.compat())
                .await
                .unwrap();
            let (output, verifier) = verifier.verify().await.unwrap().accept().await.unwrap();
            let tls_transcript = verifier.tls_transcript().clone();
            verifier.close().await.unwrap();
            (output, tls_transcript)
        });

        let (response, verifier_output) = tokio::join!(prover_task, verifier_task);
        let (evidence, attestation_request, secrets) = response.unwrap();
        let (verifier_output, tls_transcript) = verifier_output.unwrap();
        let origin_result = origin_task.await.unwrap();
        prover_handle.close();
        verifier_handle.close();

        let (origin_request, origin_response) = origin_result;
        assert_eq!(origin_request, expected_request);
        assert_eq!(evidence.request, origin_request);
        assert_eq!(evidence.response, origin_response);

        let transcript = verifier_output.transcript.unwrap();
        assert!(transcript.is_complete());
        assert_eq!(transcript.sent_unsafe(), expected_request.as_slice());
        assert_eq!(transcript.received_unsafe(), origin_response.as_slice());

        let mut provider = CryptoProvider::default();
        provider.cert = ServerCertVerifier::new(&root_store).unwrap();
        provider.signer.set_secp256k1(&[1_u8; 32]).unwrap();
        let mut attestation_config = AttestationConfig::builder();
        attestation_config
            .supported_signature_algs(Vec::from_iter(provider.signer.supported_algs()));
        let attestation_config = attestation_config.build().unwrap();
        let CertBinding::V1_2(cert_binding) = tls_transcript.certificate_binding() else {
            panic!("unsupported certificate binding version");
        };
        let sent_len = tls_transcript
            .sent()
            .iter()
            .filter_map(|record| {
                (record.typ == ContentType::ApplicationData).then_some(record.ciphertext.len())
            })
            .sum::<usize>();
        let received_len = tls_transcript
            .recv()
            .iter()
            .filter_map(|record| {
                (record.typ == ContentType::ApplicationData).then_some(record.ciphertext.len())
            })
            .sum::<usize>();
        let mut attestation_builder = Attestation::builder(&attestation_config)
            .accept_request(attestation_request.clone())
            .unwrap();
        attestation_builder
            .connection_info(ConnectionInfo {
                time: tls_transcript.time(),
                version: tls_transcript.version(),
                transcript_length: TranscriptLength {
                    sent: sent_len as u32,
                    received: received_len as u32,
                },
            })
            .server_ephemeral_key(cert_binding.server_ephemeral_key.clone())
            .transcript_commitments(verifier_output.transcript_commitments);
        let attestation = attestation_builder.build(&provider).unwrap();
        attestation_request
            .validate(&attestation, &provider)
            .unwrap();

        let mut presentation_builder = Presentation::builder(&provider, &attestation);
        presentation_builder.identity_proof(secrets.identity_proof());
        let mut transcript_proof = secrets.transcript_proof_builder();
        transcript_proof
            .reveal_sent(0..secrets.transcript().sent().len())
            .unwrap();
        transcript_proof
            .reveal_recv(0..secrets.transcript().received().len())
            .unwrap();
        presentation_builder.transcript_proof(transcript_proof.build().unwrap());
        let presentation = presentation_builder.build().unwrap();
        let presentation_bytes = bincode::serialize(&presentation).unwrap();
        let authenticated = crate::tlsn_alpha15::verify_alpha15_presentation_with_provider(
            &presentation_bytes,
            &provider,
        )
        .unwrap();
        let profile =
            crate::tlsn_alpha15::RequireInfoDisclosureProfile::for_mock_tlsn_verification(
                SERVER_IDENTITY,
            )
            .unwrap();
        let require_info = authenticated
            .verify_require_info(&profile, &ParserLimits::default())
            .unwrap();
        assert_eq!(require_info.verified_member_id, "16189463");
        let result = require_info
            .into_verifier_result(
                [0_u8; 32],
                "test-verifier".to_owned(),
                "test-notary".to_owned(),
                [0_u8; 64],
            )
            .unwrap();
        assert_eq!(result.verified_member_id, "16189463");
        assert!(!result.canonical_json().unwrap().is_empty());
        assert!(!result.signing_bytes().unwrap().is_empty());
    }
}
