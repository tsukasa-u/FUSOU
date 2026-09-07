use crate::experimental_tlsn::{
    sha256, SerializedOriginRequest, TlsnOriginExchange, TlsnOriginResponse, TlsnOriginTransport,
    TlsnTransportError, TlsnTransportFuture, UnverifiedTlsnTranscript,
};
use fusou_tlsn_verifier::{
    parse_require_info_request, prover_transport::ProverOwnedTlsTransport, ParserLimits,
};
use http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use hyper::body::Bytes;
use rcgen::{
    BasicConstraints, CertificateParams, ExtendedKeyUsagePurpose, IsCa, KeyPair, KeyUsagePurpose,
};
use std::{
    future::IntoFuture,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tlsn::{
    config::{
        prover::ProverConfig, tls::TlsClientConfig, tls_commit::proxy::ProxyTlsConfig,
        verifier::VerifierConfig,
    },
    connection::{DnsName, ServerName},
    transcript::TranscriptCommitConfig,
    verifier::VerifierCommitStart,
    webpki::{CertificateDer, RootCertStore},
    Session,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_rustls::{
    rustls::{pki_types::PrivateKeyDer, ServerConfig},
    TlsAcceptor,
};
use tokio_util::compat::TokioAsyncReadCompatExt;

pub const SYNTHETIC_SERVER_IDENTITY: &str = "game.example.test";

pub struct SyntheticAlpha15OriginTransport {
    sent: AtomicBool,
    root_certificate: Arc<Vec<u8>>,
    server_certificate: Arc<Vec<u8>>,
    private_key: Arc<Vec<u8>>,
    last_request: Mutex<Option<Vec<u8>>>,
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
        })
    }

    pub fn last_request(&self) -> Option<Vec<u8>> {
        self.last_request
            .lock()
            .ok()
            .and_then(|request| request.clone())
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
        Box::pin(async move {
            run_synthetic_exchange(
                SerializedOriginRequest::new(Bytes::from(request_bytes))
                    .map_err(|_| TlsnTransportError::OriginConnectionFailed)?,
                root_certificate,
                server_certificate,
                private_key,
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
) -> Result<TlsnOriginExchange, TlsnTransportError> {
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
    let prover_root_store = root_store.clone();
    let request_for_prover = request.clone();
    let prover_task = tokio::spawn(async move {
        let prover = prover
            .commit(proxy_config)
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
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
        let prover_task = tokio::spawn(prover.into_future());
        let parsed_request = parse_require_info_request(
            request_for_prover.bytes(),
            SYNTHETIC_SERVER_IDENTITY,
            &ParserLimits::default(),
        )
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        let mut transport = ProverOwnedTlsTransport::new(connection);
        transport
            .send_actual_require_info(
                request_for_prover.bytes(),
                SYNTHETIC_SERVER_IDENTITY,
                &parsed_request.binding,
            )
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        transport
            .read_response_to_end()
            .await
            .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
        transport
            .close()
            .await
            .map_err(|_| TlsnTransportError::ResponseReadFailed)?;

        let mut prover = prover_task
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        let mut transcript_commit = TranscriptCommitConfig::builder(prover.transcript());
        transcript_commit
            .commit_sent(0..prover.transcript().sent().len())
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        transcript_commit
            .commit_recv(0..prover.transcript().received().len())
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        let mut prove_config = tlsn::config::prove::ProveConfig::builder(prover.transcript());
        prove_config
            .transcript_commit(
                transcript_commit
                    .build()
                    .map_err(|_| TlsnTransportError::OriginConnectionFailed)?,
            )
            .server_identity();
        prove_config
            .reveal_sent_all()
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        prove_config
            .reveal_recv_all()
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        let prove_config = prove_config
            .build()
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        prover
            .prove(&prove_config)
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        prover
            .close()
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)
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
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?
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
            .ok_or(TlsnTransportError::ResponseReadFailed)?;
        let sent = transcript.sent_unsafe().to_vec();
        let received = transcript.received_unsafe().to_vec();
        verifier
            .close()
            .await
            .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
        Ok((sent, received))
    });

    let (prover_result, verifier_result, origin_result) =
        tokio::join!(prover_task, verifier_task, origin_task);
    prover_handle.close();
    verifier_handle.close();
    prover_result.map_err(|_| TlsnTransportError::OriginConnectionFailed)??;
    let (authenticated_request, authenticated_response) =
        verifier_result.map_err(|_| TlsnTransportError::OriginConnectionFailed)??;
    let (origin_request, raw_response) = origin_result
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    if authenticated_request != origin_request || authenticated_response != raw_response {
        return Err(TlsnTransportError::ResponseReadFailed);
    }
    if origin_request != request.bytes() {
        return Err(TlsnTransportError::OriginConnectionFailed);
    }
    let response = parse_origin_response(&raw_response)?;
    Ok(TlsnOriginExchange {
        response,
        transcript: UnverifiedTlsnTranscript {
            request_sha256: sha256(&origin_request),
            response_sha256: sha256(&raw_response),
        },
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

    let body =
        b"svdata={\"api_result\":1,\"api_data\":{\"api_basic\":{\"api_member_id\":16189463}}}";
    let mut response = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    response.extend_from_slice(body);
    stream.write_all(&response).await.map_err(|_| ())?;
    stream.shutdown().await.map_err(|_| ())?;
    Ok((request, response))
}

fn parse_origin_response(raw_response: &[u8]) -> Result<TlsnOriginResponse, TlsnTransportError> {
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
    let body = Bytes::copy_from_slice(&raw_response[header_end..]);
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
        Bytes::copy_from_slice(raw_response),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
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
        SerializedOriginRequest::new(Bytes::from(format!(
            "POST /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: {SYNTHETIC_SERVER_IDENTITY}\r\nX-Attestation-Binding: {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            binding_value()
        )))
        .unwrap()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn synthetic_transport_uses_alpha15_and_preserves_wire_bytes() {
        let transport = SyntheticAlpha15OriginTransport::new().unwrap();
        let request = request();
        let expected_request = request.bytes().to_vec();
        let exchange = transport.send_once(request).await.unwrap();

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
}
