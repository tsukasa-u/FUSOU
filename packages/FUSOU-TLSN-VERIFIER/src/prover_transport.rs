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
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use rcgen::generate_simple_self_signed;
    use std::{future::IntoFuture, sync::Arc};
    use tlsn::{
        config::{
            prove::ProveConfig, prover::ProverConfig, tls::TlsClientConfig,
            tls_commit::proxy::ProxyTlsConfig, verifier::VerifierConfig,
        },
        connection::{DnsName, ServerName},
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

    fn server_credentials() -> (Vec<u8>, Vec<u8>) {
        let certified = generate_simple_self_signed(vec![SERVER_IDENTITY.to_owned()]).unwrap();
        (
            certified.cert.der().to_vec(),
            certified.key_pair.serialize_der(),
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
        let expected_request = build_require_info_request(SERVER_IDENTITY, &binding).unwrap();
        let (certificate, private_key) = server_credentials();

        let proxy_config = ProxyTlsConfig::builder()
            .server_name(DnsName::try_from(SERVER_IDENTITY).unwrap())
            .build()
            .unwrap();
        let root_store = RootCertStore {
            roots: vec![CertificateDer(certificate.clone())],
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
        let origin_task = tokio::spawn(serve_origin(origin_socket, certificate, private_key));

        let prover_task = tokio::spawn(async move {
            let prover = prover.commit(proxy_config).await.unwrap();
            let (connection, prover) = prover
                .connect(
                    TlsClientConfig::builder()
                        .server_name(ServerName::Dns(DnsName::try_from(SERVER_IDENTITY).unwrap()))
                        .root_store(root_store)
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
            let response = transport.read_response_to_end().await.unwrap();
            transport.close().await.unwrap();

            let mut prover = prover_task.await.unwrap().unwrap();
            let mut prove_config = ProveConfig::builder(prover.transcript());
            prove_config.server_identity();
            prove_config.reveal_sent_all().unwrap();
            prove_config.reveal_recv_all().unwrap();
            let prove_config = prove_config.build().unwrap();
            prover.prove(&prove_config).await.unwrap();
            prover.close().await.unwrap();
            response
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
            verifier.close().await.unwrap();
            output
        });

        let (response, verifier_output) = tokio::join!(prover_task, verifier_task);
        let response = response.unwrap();
        let verifier_output = verifier_output.unwrap();
        let origin_result = origin_task.await.unwrap();
        prover_handle.close();
        verifier_handle.close();

        let (origin_request, origin_response) = origin_result;
        assert_eq!(origin_request, expected_request);
        assert_eq!(response, origin_response);

        let transcript = verifier_output.transcript.unwrap();
        assert!(transcript.is_complete());
        assert_eq!(transcript.sent_unsafe(), expected_request.as_slice());
        assert_eq!(transcript.received_unsafe(), origin_response.as_slice());
    }
}
