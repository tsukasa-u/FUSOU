//! FUSOU-owned request transport boundary for the pinned alpha.15 Prover.

use crate::{
    parse_http_chunk_size, parse_http_content_length, parse_require_info_request,
    validate_server_identity, ParsedBinding, ParserLimits, VerifierError, MAX_HTTP_HEADER_BYTES,
    MAX_RESPONSE_TRANSCRIPT_BYTES,
};
use futures::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use thiserror::Error;
use tlsn::prover::TlsConnection;

#[derive(Debug, Error)]
pub enum ProverTransportError {
    #[error("invalid prover-owned request: {0}")]
    InvalidRequest(#[from] VerifierError),
    #[error("require_info request has already been sent")]
    RequestAlreadySent,
    #[error("actual require_info request binding does not match the expected binding")]
    BindingMismatch,
    #[error("require_info request has not been sent")]
    RequestNotSent,
    #[error("response has already been read")]
    ResponseAlreadyRead,
    #[error("response headers exceeded the configured limit")]
    ResponseHeadersTooLarge,
    #[error("response body exceeded the configured limit")]
    ResponseBodyTooLarge,
    #[error("response ended before the framed body was complete")]
    ResponseEofBeforeComplete,
    #[error("response framing is unsupported or ambiguous")]
    UnsupportedResponseFraming,
    #[error("prover-owned TLS connection is closed")]
    ConnectionClosed,
    #[error("prover-owned TLS I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, ProverTransportError>;

pub fn validate_actual_require_info_request(
    request: &[u8],
    server_identity: &str,
    expected_binding: &ParsedBinding,
) -> Result<()> {
    validate_server_identity(server_identity)?;
    let parsed = parse_require_info_request(request, server_identity, &ParserLimits::default())?;
    if parsed.binding != *expected_binding {
        return Err(ProverTransportError::BindingMismatch);
    }
    Ok(())
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

    pub async fn send_actual_require_info(
        &mut self,
        request: &[u8],
        server_identity: &str,
        expected_binding: &ParsedBinding,
    ) -> Result<()> {
        self.send_actual_require_info_with_timing(request, server_identity, expected_binding)
            .await
            .map(|_| ())
    }

    pub async fn send_actual_require_info_with_timing(
        &mut self,
        request: &[u8],
        server_identity: &str,
        expected_binding: &ParsedBinding,
    ) -> Result<std::time::Duration> {
        if self.request_sent {
            return Err(ProverTransportError::RequestAlreadySent);
        }
        validate_actual_require_info_request(request, server_identity, expected_binding)?;
        let connection = self
            .connection
            .as_mut()
            .ok_or(ProverTransportError::ConnectionClosed)?;

        self.request_sent = true;
        let write_started = std::time::Instant::now();
        connection.write_all(request).await?;
        connection.flush().await?;
        Ok(write_started.elapsed())
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
        let mut response = Vec::with_capacity(4096);
        let header_end = loop {
            let mut byte = [0_u8; 1];
            let count = connection.read(&mut byte).await?;
            if count == 0 {
                return Err(ProverTransportError::ResponseEofBeforeComplete);
            }
            response.push(byte[0]);
            if response.len() > MAX_HTTP_HEADER_BYTES {
                return Err(ProverTransportError::ResponseHeadersTooLarge);
            }
            if response.ends_with(b"\r\n\r\n") {
                break response.len();
            }
        };
        match parse_response_framing(&response[..header_end])? {
            ResponseFraming::ContentLength(body_length) => {
                let total_length = header_end
                    .checked_add(body_length)
                    .ok_or(ProverTransportError::ResponseBodyTooLarge)?;
                if total_length > MAX_RESPONSE_TRANSCRIPT_BYTES {
                    return Err(ProverTransportError::ResponseBodyTooLarge);
                }
                response.resize(total_length, 0);
                connection
                    .read_exact(&mut response[header_end..])
                    .await
                    .map_err(map_response_read_error)?;
            }
            ResponseFraming::Chunked => {
                read_chunked_body(connection, &mut response).await?;
            }
        }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResponseFraming {
    ContentLength(usize),
    Chunked,
}

impl ResponseFraming {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ContentLength(_) => "content-length",
            Self::Chunked => "chunked",
        }
    }
}

pub fn parse_response_framing(headers: &[u8]) -> Result<ResponseFraming> {
    let first_line_end = headers
        .windows(2)
        .position(|window| window == b"\r\n")
        .ok_or(ProverTransportError::UnsupportedResponseFraming)?;
    if !headers[..first_line_end].starts_with(b"HTTP/1.1 ") {
        return Err(ProverTransportError::UnsupportedResponseFraming);
    }

    let mut content_length = None;
    let mut chunked = false;
    let mut cursor = first_line_end + 2;
    while cursor < headers.len() {
        let line_end = headers[cursor..]
            .windows(2)
            .position(|window| window == b"\r\n")
            .map(|offset| cursor + offset)
            .ok_or(ProverTransportError::UnsupportedResponseFraming)?;
        if line_end == cursor {
            if cursor + 2 != headers.len() {
                return Err(ProverTransportError::UnsupportedResponseFraming);
            }
            break;
        }
        let line = &headers[cursor..line_end];
        let colon = line
            .iter()
            .position(|byte| *byte == b':')
            .ok_or(ProverTransportError::UnsupportedResponseFraming)?;
        let name = &line[..colon];
        let value = trim_ows(&line[colon + 1..]);
        if name.eq_ignore_ascii_case(b"transfer-encoding") {
            if chunked || !value.eq_ignore_ascii_case(b"chunked") {
                return Err(ProverTransportError::UnsupportedResponseFraming);
            }
            chunked = true;
        }
        if name.eq_ignore_ascii_case(b"content-length") {
            if content_length.is_some() {
                return Err(ProverTransportError::UnsupportedResponseFraming);
            }
            let value = parse_http_content_length(&value)
                .ok()
                .and_then(|value| usize::try_from(value).ok())
                .ok_or(ProverTransportError::UnsupportedResponseFraming)?;
            content_length = Some(value);
        }
        cursor = line_end + 2;
    }

    match (content_length, chunked) {
        (Some(_), true) | (None, false) => Err(ProverTransportError::UnsupportedResponseFraming),
        (Some(length), false) => Ok(ResponseFraming::ContentLength(length)),
        (None, true) => Ok(ResponseFraming::Chunked),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForwardedHttpResponse {
    pub status_code: u16,
    pub headers: Vec<(Vec<u8>, Vec<u8>)>,
    pub body: Vec<u8>,
    pub raw_response_bytes: Vec<u8>,
    pub framing: ResponseFraming,
}

pub fn parse_http_response_for_forwarding(raw: &[u8]) -> crate::Result<ForwardedHttpResponse> {
    let limits = ParserLimits::default();
    if raw.len() > limits.response_transcript_bytes {
        return Err(VerifierError::LimitExceeded("response transcript bytes"));
    }
    let header_end = raw
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or(VerifierError::InvalidHttp(
            "response headers are incomplete",
        ))?;
    let status_line_end = raw[..header_end]
        .windows(2)
        .position(|window| window == b"\r\n")
        .ok_or(VerifierError::InvalidHttp(
            "response status line is incomplete",
        ))?;
    let status_line = &raw[..status_line_end];
    let mut status_fields = status_line.splitn(3, |byte| *byte == b' ');
    if status_fields.next() != Some(b"HTTP/1.1".as_slice()) {
        return Err(VerifierError::InvalidHttp("unsupported response version"));
    }
    let status_bytes = status_fields
        .next()
        .filter(|value| value.len() == 3 && value.iter().all(u8::is_ascii_digit))
        .ok_or(VerifierError::InvalidHttp("invalid response status code"))?;
    let status_code = std::str::from_utf8(status_bytes)
        .map_err(|_| VerifierError::InvalidHttp("invalid response status code"))?
        .parse::<u16>()
        .map_err(|_| VerifierError::InvalidHttp("invalid response status code"))?;
    let (headers, body_start) = crate::parse_message_head(raw, status_line, &limits)?;
    let framing = parse_response_framing(&raw[..body_start])
        .map_err(|_| VerifierError::InvalidHttp("unsupported or ambiguous response framing"))?;
    let body = crate::parse_framed_body(
        &headers,
        &raw[body_start..],
        limits.response_transcript_bytes,
    )?;
    let mut forwarding_headers = headers
        .into_iter()
        .filter(|header| {
            framing != ResponseFraming::Chunked
                || (!header.name.eq_ignore_ascii_case(b"transfer-encoding")
                    && !header.name.eq_ignore_ascii_case(b"trailer"))
        })
        .map(|header| (header.name, header.value))
        .collect::<Vec<_>>();
    if framing == ResponseFraming::Chunked {
        forwarding_headers.push((
            b"content-length".to_vec(),
            body.len().to_string().into_bytes(),
        ));
    }
    Ok(ForwardedHttpResponse {
        status_code,
        headers: forwarding_headers,
        body,
        raw_response_bytes: raw.to_vec(),
        framing,
    })
}

fn trim_ows(mut value: &[u8]) -> &[u8] {
    while value
        .first()
        .is_some_and(|byte| matches!(byte, b' ' | b'\t'))
    {
        value = &value[1..];
    }
    while value
        .last()
        .is_some_and(|byte| matches!(byte, b' ' | b'\t'))
    {
        value = &value[..value.len() - 1];
    }
    value
}

async fn read_chunked_body<R>(connection: &mut R, response: &mut Vec<u8>) -> Result<()>
where
    R: AsyncRead + Unpin,
{
    loop {
        let size_line = read_crlf_line(connection, response).await?;
        let size = parse_http_chunk_size(&size_line)
            .map_err(|_| ProverTransportError::UnsupportedResponseFraming)?;
        if size == 0 {
            let terminator_end = response
                .len()
                .checked_add(2)
                .ok_or(ProverTransportError::ResponseBodyTooLarge)?;
            if terminator_end > MAX_RESPONSE_TRANSCRIPT_BYTES {
                return Err(ProverTransportError::ResponseBodyTooLarge);
            }
            let mut trailer_terminator = [0; 2];
            connection
                .read_exact(&mut trailer_terminator)
                .await
                .map_err(map_response_read_error)?;
            response.extend_from_slice(&trailer_terminator);
            if trailer_terminator != *b"\r\n" {
                return Err(ProverTransportError::UnsupportedResponseFraming);
            }
            return Ok(());
        }

        let chunk_end = response
            .len()
            .checked_add(size)
            .and_then(|length| length.checked_add(2))
            .ok_or(ProverTransportError::ResponseBodyTooLarge)?;
        if chunk_end > MAX_RESPONSE_TRANSCRIPT_BYTES {
            return Err(ProverTransportError::ResponseBodyTooLarge);
        }
        let chunk_start = response.len();
        response.resize(chunk_end, 0);
        connection
            .read_exact(&mut response[chunk_start..])
            .await
            .map_err(map_response_read_error)?;
        if &response[chunk_start + size..chunk_end] != b"\r\n" {
            return Err(ProverTransportError::UnsupportedResponseFraming);
        }
    }
}

async fn read_crlf_line<R>(connection: &mut R, response: &mut Vec<u8>) -> Result<Vec<u8>>
where
    R: AsyncRead + Unpin,
{
    let line_start = response.len();
    loop {
        if response.len().saturating_sub(line_start) >= 18 {
            return Err(ProverTransportError::UnsupportedResponseFraming);
        }
        let mut byte = [0; 1];
        let count = connection.read(&mut byte).await?;
        if count == 0 {
            return Err(ProverTransportError::ResponseEofBeforeComplete);
        }
        if response.len() >= MAX_RESPONSE_TRANSCRIPT_BYTES {
            return Err(ProverTransportError::ResponseBodyTooLarge);
        }
        response.push(byte[0]);
        if response.ends_with(b"\r\n") {
            return Ok(response[line_start..response.len() - 2].to_vec());
        }
    }
}

fn map_response_read_error(error: std::io::Error) -> ProverTransportError {
    if error.kind() == std::io::ErrorKind::UnexpectedEof {
        ProverTransportError::ResponseEofBeforeComplete
    } else {
        ProverTransportError::Io(error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::experimental::{ExperimentalRequireInfoEvidence, ExperimentalRequireInfoProbe};
    use crate::parse_binding_value;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use futures::io::AsyncRead as FuturesAsyncRead;
    use rcgen::{
        BasicConstraints, CertificateParams, ExtendedKeyUsagePurpose, IsCa, KeyPair,
        KeyUsagePurpose,
    };
    use std::{future::IntoFuture, sync::Arc};
    use std::{
        io,
        pin::Pin,
        task::{Context, Poll},
    };
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
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        sync::oneshot,
    };
    use tokio_rustls::{
        rustls::{pki_types::PrivateKeyDer, ServerConfig},
        TlsAcceptor,
    };
    use tokio_util::compat::TokioAsyncReadCompatExt;

    const SERVER_IDENTITY: &str = "game.example.test";

    struct FragmentedReader {
        bytes: Vec<u8>,
        position: usize,
        max_read: usize,
    }

    impl FragmentedReader {
        fn new(bytes: &[u8], max_read: usize) -> Self {
            Self {
                bytes: bytes.to_vec(),
                position: 0,
                max_read,
            }
        }
    }

    impl FuturesAsyncRead for FragmentedReader {
        fn poll_read(
            self: Pin<&mut Self>,
            _context: &mut Context<'_>,
            output: &mut [u8],
        ) -> Poll<io::Result<usize>> {
            let this = self.get_mut();
            if output.is_empty() || this.position == this.bytes.len() {
                return Poll::Ready(Ok(0));
            }
            let count = output
                .len()
                .min(this.max_read)
                .min(this.bytes.len() - this.position);
            output[..count].copy_from_slice(&this.bytes[this.position..this.position + count]);
            this.position += count;
            Poll::Ready(Ok(count))
        }
    }

    async fn read_chunked_wire(body: &[u8], max_read: usize) -> Result<Vec<u8>> {
        let mut reader = FragmentedReader::new(body, max_read);
        let mut response = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n".to_vec();
        read_chunked_body(&mut reader, &mut response).await?;
        Ok(response)
    }

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

    fn actual_request(binding: &str) -> Vec<u8> {
        format!(
            "POST /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: {SERVER_IDENTITY}\r\nX-Attestation-Binding: {binding}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        )
        .into_bytes()
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
        chunked: bool,
        release_close: Option<oneshot::Receiver<()>>,
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
        let mut response = if chunked {
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n"
                .to_vec()
        } else {
            format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n",
                body.len()
            )
            .into_bytes()
        };
        if chunked {
            let split = body.len() / 2;
            response.extend_from_slice(format!("{:X}\r\n", split).as_bytes());
            response.extend_from_slice(&body[..split]);
            response.extend_from_slice(b"\r\n");
            response.extend_from_slice(format!("{:x}\r\n", body.len() - split).as_bytes());
            response.extend_from_slice(&body[split..]);
            response.extend_from_slice(b"\r\n0\r\n\r\n");
        } else {
            response.extend_from_slice(body);
        }
        if chunked {
            for byte in &response {
                stream.write_all(std::slice::from_ref(byte)).await.unwrap();
                stream.flush().await.unwrap();
            }
        } else {
            stream.write_all(&response).await.unwrap();
        }
        if let Some(release_close) = release_close {
            release_close.await.unwrap();
        }
        stream.shutdown().await.unwrap();
        (request, response)
    }

    #[test]
    fn response_framing_uses_http_content_length_and_accepts_chunked_only() {
        for (headers, expected) in [
            (
                b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".as_slice(),
                ResponseFraming::ContentLength(0),
            ),
            (
                b"HTTP/1.1 200 OK\r\nContent-Length: \t007 \t\r\n\r\n".as_slice(),
                ResponseFraming::ContentLength(7),
            ),
            (
                b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\n\r\n".as_slice(),
                ResponseFraming::ContentLength(7),
            ),
        ] {
            assert_eq!(parse_response_framing(headers).unwrap(), expected);
        }
        assert!(matches!(
            parse_response_framing(b"HTTP/1.1 200 OK\r\n\r\n"),
            Err(ProverTransportError::UnsupportedResponseFraming)
        ));
        assert!(matches!(
            parse_response_framing(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"),
            Ok(ResponseFraming::Chunked)
        ));
        assert!(matches!(
            parse_response_framing(
                b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nTransfer-Encoding: chunked\r\n\r\n"
            ),
            Err(ProverTransportError::UnsupportedResponseFraming)
        ));
        assert!(matches!(
            parse_response_framing(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nTransfer-Encoding: chunked\r\n\r\n"
            ),
            Err(ProverTransportError::UnsupportedResponseFraming)
        ));
        for headers in [
            b"HTTP/1.1 200 OK\r\nContent-Length: 18446744073709551616\r\n\r\n".as_slice(),
            b"HTTP/1.1 200 OK\r\nContent-Length:\r\n\r\n",
            b"HTTP/1.1 200 OK\r\nContent-Length: +7\r\n\r\n",
            b"HTTP/1.1 200 OK\r\nContent-Length: -7\r\n\r\n",
            b"HTTP/1.1 200 OK\r\nContent-Length: \xd9\xa7\r\n\r\n",
            b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nContent-Length: 7\r\n\r\n",
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, chunked\r\n\r\n",
        ] {
            assert!(
                matches!(
                    parse_response_framing(headers),
                    Err(ProverTransportError::UnsupportedResponseFraming)
                ),
                "{headers:?}"
            );
        }
        for headers in [
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked, chunked\r\n\r\n".as_slice(),
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, chunked\r\n\r\n",
            b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n",
        ] {
            assert!(matches!(
                parse_response_framing(headers),
                Err(ProverTransportError::UnsupportedResponseFraming)
            ));
        }
    }

    #[tokio::test]
    async fn chunked_reader_handles_multiple_fragments_and_preserves_wire_bytes() {
        let wire_body = b"A\r\n0123456789\r\n2\r\nok\r\n0\r\n\r\n";
        let response = read_chunked_wire(wire_body, 1).await.unwrap();
        let header_end = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .unwrap()
            + 4;

        assert_eq!(
            &response[..header_end],
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
        );
        assert_eq!(&response[header_end..], wire_body);
        assert_eq!(
            crate::decode_chunked_http_body(&response[header_end..], 64).unwrap(),
            b"0123456789ok"
        );
        assert_eq!(
            crate::decode_chunked_http_body(b"0\r\n\r\n", 0).unwrap(),
            Vec::<u8>::new()
        );
    }

    #[tokio::test]
    async fn chunked_reader_rejects_truncation_invalid_framing_and_extensions() {
        for wire_body in [
            b"4\r".as_slice(),
            b"4\r\nab",
            b"1\nab\r\n0\r\n\r\n",
            b"1\r\naXX",
            b"G\r\n",
            b"FFFFFFFFFFFFFFFF\r\n",
            b"1;ext=x\r\na\r\n0\r\n\r\n",
            b"0\r\nX-Trace: value\r\n\r\n",
        ] {
            assert!(
                read_chunked_wire(wire_body, 2).await.is_err(),
                "{wire_body:?}"
            );
        }
        assert!(crate::decode_chunked_http_body(b"0\r\n\r\nextra", 64).is_err());
    }

    #[tokio::test]
    async fn chunked_reader_enforces_the_existing_response_transcript_limit() {
        let mut reader = FragmentedReader::new(b"0\r\n\r\n", 1);
        let mut response = vec![b'x'; MAX_RESPONSE_TRANSCRIPT_BYTES - 3];
        assert!(matches!(
            read_chunked_body(&mut reader, &mut response).await,
            Err(ProverTransportError::ResponseBodyTooLarge)
        ));
    }

    #[test]
    fn forwarding_parser_normalizes_chunked_headers_and_preserves_wire_digest_input() {
        let raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nTrailer: X-Trace\r\n\r\n3\r\npay\r\n4\r\nload\r\n0\r\n\r\n";
        let parsed = parse_http_response_for_forwarding(raw).unwrap();

        assert_eq!(parsed.status_code, 200);
        assert_eq!(parsed.framing, ResponseFraming::Chunked);
        assert_eq!(parsed.body.as_slice(), b"payload");
        assert_eq!(parsed.raw_response_bytes.as_slice(), raw);
        assert!(!parsed
            .headers
            .iter()
            .any(|(name, _)| name.as_slice() == b"transfer-encoding"
                || name.as_slice() == b"trailer"));
        assert!(parsed
            .headers
            .iter()
            .any(|(name, value)| name.as_slice() == b"content-length" && value.as_slice() == b"7"));
        assert_ne!(
            crate::sha256(&parsed.raw_response_bytes),
            crate::sha256(&parsed.body)
        );
    }

    #[test]
    fn forwarding_parser_accepts_leading_zero_content_length_without_rewriting_wire_bytes() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Length:\t007 \t\r\n\r\npayload";
        let parsed = parse_http_response_for_forwarding(raw).unwrap();

        assert_eq!(parsed.status_code, 200);
        assert_eq!(parsed.framing, ResponseFraming::ContentLength(7));
        assert_eq!(parsed.body.as_slice(), b"payload");
        assert_eq!(parsed.raw_response_bytes.as_slice(), raw);
        assert!(parsed.headers.iter().any(
            |(name, value)| name.as_slice() == b"content-length" && value.as_slice() == b"007"
        ));
    }

    #[tokio::test]
    async fn chunked_body_reader_handles_fragmented_multiple_chunks_and_empty_body() {
        let wire_body = b"A\r\n0123456789\r\n2\r\nok\r\n0\r\n\r\n";
        let response = read_chunked_wire(wire_body, 1).await.unwrap();
        let header_end = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .unwrap()
            + 4;

        assert_eq!(
            &response[..header_end],
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"
        );
        assert_eq!(&response[header_end..], wire_body);
        assert_eq!(
            crate::decode_chunked_http_body(&response[header_end..], 64).unwrap(),
            b"0123456789ok"
        );

        let empty = read_chunked_wire(b"0\r\n\r\n", 1).await.unwrap();
        let empty_header_end = empty
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .unwrap()
            + 4;
        assert!(
            crate::decode_chunked_http_body(&empty[empty_header_end..], 0)
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn chunked_body_reader_rejects_truncation_and_unsupported_framing() {
        for wire_body in [
            b"4\r".as_slice(),
            b"4\r\nab",
            b"1\nab\r\n0\r\n\r\n",
            b"1\r\naXX",
            b"G\r\n",
            b"FFFFFFFFFFFFFFFF\r\n",
            b"1;ext=x\r\na\r\n0\r\n\r\n",
            b"0\r\nX-Trace: value\r\n\r\n",
        ] {
            assert!(
                read_chunked_wire(wire_body, 2).await.is_err(),
                "{wire_body:?}"
            );
        }
        assert!(crate::decode_chunked_http_body(b"0\r\n\r\nextra", 64).is_err());
    }

    #[tokio::test]
    async fn chunked_body_reader_enforces_the_existing_response_transcript_limit() {
        let mut reader = FragmentedReader::new(b"0\r\n\r\n", 1);
        let mut response = vec![b'x'; MAX_RESPONSE_TRANSCRIPT_BYTES - 3];
        assert!(matches!(
            read_chunked_body(&mut reader, &mut response).await,
            Err(ProverTransportError::ResponseBodyTooLarge)
        ));
    }

    #[test]
    fn actual_request_validation_is_strict() {
        let binding = binding_value();
        let expected_binding = parse_binding_value(&binding).unwrap();
        let request = actual_request(&binding);
        validate_actual_require_info_request(&request, SERVER_IDENTITY, &expected_binding).unwrap();

        let missing_binding = format!(
            "POST /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: {SERVER_IDENTITY}\r\nContent-Length: 0\r\n\r\n"
        );
        assert!(validate_actual_require_info_request(
            missing_binding.as_bytes(),
            SERVER_IDENTITY,
            &expected_binding,
        )
        .is_err());
    }

    #[test]
    fn actual_request_validation_accepts_http_content_length_ows_and_leading_zeroes() {
        let binding = binding_value();
        let expected_binding = parse_binding_value(&binding).unwrap();
        let request = format!(
            "POST /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: {SERVER_IDENTITY}\r\nX-Attestation-Binding: {binding}\r\nContent-Length: \t000\t\r\n\r\n"
        );
        validate_actual_require_info_request(
            request.as_bytes(),
            SERVER_IDENTITY,
            &expected_binding,
        )
        .unwrap();
    }

    #[tokio::test]
    async fn transport_rejects_invalid_state_transitions_fail_closed() {
        let mut transport = ProverOwnedTlsTransport {
            connection: None,
            request_sent: false,
            response_read: false,
        };
        assert!(matches!(
            transport.read_response_to_end().await,
            Err(ProverTransportError::RequestNotSent)
        ));

        let binding = binding_value();
        let expected_binding = parse_binding_value(&binding).unwrap();
        let request = actual_request(&binding);
        let send_error = transport
            .send_actual_require_info(&request, SERVER_IDENTITY, &expected_binding)
            .await;
        assert!(matches!(
            send_error,
            Err(ProverTransportError::ConnectionClosed)
        ));
        assert!(!transport.request_sent());
        assert!(matches!(
            transport
                .send_actual_require_info(&request, SERVER_IDENTITY, &expected_binding)
                .await,
            Err(ProverTransportError::ConnectionClosed)
        ));

        let mut response_already_read = ProverOwnedTlsTransport {
            connection: None,
            request_sent: true,
            response_read: true,
        };
        assert!(matches!(
            response_already_read.read_response_to_end().await,
            Err(ProverTransportError::ResponseAlreadyRead)
        ));
        response_already_read.close().await.unwrap();
        response_already_read.close().await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn proxy_transport_authenticates_prover_owned_wire_bytes() {
        let binding = binding_value();
        let probe = ExperimentalRequireInfoProbe::from_actual_request(
            SERVER_IDENTITY,
            &parse_binding_value(&binding).unwrap(),
            actual_request(&binding),
        )
        .unwrap();
        let expected_request = probe.request().to_vec();
        let request_for_transport = expected_request.clone();
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
        let (release_close, release_close_rx) = oneshot::channel();
        let origin_task = tokio::spawn(serve_origin(
            origin_socket,
            server_certificate,
            private_key,
            true,
            Some(release_close_rx),
        ));
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
                .send_actual_require_info(&request_for_transport, SERVER_IDENTITY, probe.binding())
                .await
                .unwrap();
            assert!(transport.request_sent());
            assert!(matches!(
                transport
                    .send_actual_require_info(
                        &request_for_transport,
                        SERVER_IDENTITY,
                        probe.binding(),
                    )
                    .await,
                Err(ProverTransportError::RequestAlreadySent)
            ));
            let response = tokio::time::timeout(
                std::time::Duration::from_secs(2),
                transport.read_response_to_end(),
            )
            .await
            .expect("Content-Length response must complete before EOF")
            .unwrap();
            assert!(matches!(
                transport.read_response_to_end().await,
                Err(ProverTransportError::ResponseAlreadyRead)
            ));
            release_close
                .send(())
                .expect("origin must still be waiting for EOF release");
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
            let sent_len = prover.transcript().sent().len();
            let received_len = prover.transcript().received().len();
            prove_config.reveal_sent(0..sent_len).unwrap();
            prove_config.reveal_recv(0..received_len).unwrap();
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
        assert!(!origin_request
            .windows(b"16189463".len())
            .any(|window| { window == b"16189463" }));
        assert_eq!(evidence.request, origin_request);
        assert_eq!(evidence.response, origin_response);

        let transcript = verifier_output.transcript.unwrap();
        assert!(transcript.is_complete());
        assert_eq!(transcript.materialize_sent(), expected_request.as_slice());
        assert_eq!(
            transcript.materialize_received(),
            origin_response.as_slice()
        );

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
        let trusted_notary_key = bincode::serialize(presentation.verifying_key()).unwrap();
        let wasm_result_json = crate::wasm::verify_synthetic_require_info_presentation_with_root(
            &presentation_bytes,
            SERVER_IDENTITY,
            &[0x11_u8; 32],
            "test-verifier",
            "test-notary",
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
            &[9_u8; 32],
            &[],
            &[],
            &root_certificate,
            &trusted_notary_key,
        )
        .unwrap();
        let wasm_wrapper: serde_json::Value = serde_json::from_str(&wasm_result_json).unwrap();
        let wasm_unsigned_result: serde_json::Value =
            serde_json::from_str(wasm_wrapper["unsigned_result"].as_str().unwrap()).unwrap();
        assert_eq!(wasm_unsigned_result["version"], 2);
        assert_eq!(wasm_unsigned_result["profile_id"], crate::PROFILE_ID);
        assert_eq!(wasm_unsigned_result["verified_member_id"], "16189463");
        assert_eq!(
            wasm_unsigned_result["response_transcript_sha256"],
            URL_SAFE_NO_PAD.encode(crate::sha256(&origin_response))
        );
        assert_eq!(
            wasm_unsigned_result["presentation_sha256"],
            URL_SAFE_NO_PAD.encode(crate::sha256(&presentation_bytes))
        );
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
                "11111111-1111-4111-8111-111111111111".to_owned(),
                "22222222-2222-4222-8222-222222222222".to_owned(),
                [0_u8; 32],
                [0_u8; 32],
                None,
                None,
                [0_u8; 64],
            )
            .unwrap();
        assert_eq!(result.verified_member_id, "16189463");
        assert!(!result.canonical_json().unwrap().is_empty());
        assert!(!result.signing_bytes().unwrap().is_empty());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn experimental_probe_runs_on_a_prover_owned_connection() {
        let binding = binding_value();
        let probe = ExperimentalRequireInfoProbe::from_actual_request(
            SERVER_IDENTITY,
            &parse_binding_value(&binding).unwrap(),
            actual_request(&binding),
        )
        .unwrap();
        let expected_request = probe.request().to_vec();
        let (root_certificate, server_certificate, private_key) = server_credentials();
        let root_store = RootCertStore {
            roots: vec![CertificateDer(root_certificate)],
        };
        let proxy_config = ProxyTlsConfig::builder()
            .server_name(DnsName::try_from(SERVER_IDENTITY).unwrap())
            .build()
            .unwrap();

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
        let origin_task = tokio::spawn(serve_origin(
            origin_socket,
            server_certificate,
            private_key,
            false,
            None,
        ));
        let prover_root_store = root_store;
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
            let evidence = probe.run(connection).await.unwrap();
            let prover = prover_task.await.unwrap().unwrap();
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
            let sent_len = prover.transcript().sent().len();
            let received_len = prover.transcript().received().len();
            prove_config.reveal_sent(0..sent_len).unwrap();
            prove_config.reveal_recv(0..received_len).unwrap();
            let prove_config = prove_config.build().unwrap();
            let mut prover = prover;
            prover.prove(&prove_config).await.unwrap();
            prover.close().await.unwrap();
            evidence
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
            let (_, verifier) = verifier.verify().await.unwrap().accept().await.unwrap();
            verifier.close().await.unwrap();
        });

        let (evidence, verifier_result) = tokio::join!(prover_task, verifier_task);
        verifier_result.unwrap();
        let evidence = evidence.unwrap();
        let (origin_request, origin_response) = origin_task.await.unwrap();
        prover_handle.close();
        verifier_handle.close();

        assert_eq!(origin_request, expected_request);
        assert_eq!(evidence.request, origin_request);
        assert_eq!(evidence.response, origin_response);
        assert_eq!(evidence.binding.value, binding_value());
        assert_eq!(evidence.verified_member_id, "16189463");
    }
}
