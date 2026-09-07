//! Direct, explicitly acknowledged origin compatibility observation.
//!
//! This module is deliberately separate from the alpha.15 Prover transport. It
//! sends one ordinary TLS request to one hard-coded experimental host and
//! records only response metadata. It does not create or verify TLSNotary
//! evidence.

use crate::{
    parse_binding_value,
    prover_transport::{build_require_info_request, ProverTransportError},
    sha256, VerifierError,
};
use std::{fmt::Write as _, sync::Arc, time::Duration};
use thiserror::Error;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time::timeout,
};
use tokio_rustls::{
    rustls::{pki_types::ServerName, ClientConfig, RootCertStore},
    TlsConnector,
};

pub const EXPERIMENTAL_ALLOWLISTED_GAME_SERVER: &str = "w16s.kancolle-server.com";
pub const EXPERIMENTAL_GAME_SERVER_PORT: u16 = 443;
pub const MAX_COMPATIBILITY_RESPONSE_BYTES: usize = 16_777_216;
pub const COMPATIBILITY_IO_TIMEOUT: Duration = Duration::from_secs(30);
pub const COMPATIBILITY_EVIDENCE_CLASS: &str = "DIRECT_ORIGIN_COMPATIBILITY_OBSERVATION";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeaderMode {
    WithBinding,
    WithoutBinding,
}

impl HeaderMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::WithBinding => "with-header",
            Self::WithoutBinding => "without-header",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompatibilityProbeConfig {
    pub header_mode: HeaderMode,
    pub binding_value: Option<String>,
    pub acknowledge_live_request: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompatibilityObservation {
    pub header_mode: HeaderMode,
    pub http_status: u16,
    pub request_bytes: usize,
    pub response_bytes: usize,
    pub request_sha256: String,
    pub response_sha256: String,
}

#[derive(Debug, Error)]
pub enum CompatibilityProbeError {
    #[error("the live-request acknowledgement flag is required")]
    LiveRequestAcknowledgementRequired,
    #[error("with-header mode requires a valid Session/nonce binding")]
    BindingRequired,
    #[error("without-header mode must not receive a binding value")]
    BindingNotAllowed,
    #[error("invalid binding value: {0}")]
    Binding(#[from] VerifierError),
    #[error("request construction failed: {0}")]
    Request(#[from] ProverTransportError),
    #[error("TCP connection failed: {0}")]
    Tcp(#[source] std::io::Error),
    #[error("TLS connection failed: {0}")]
    Tls(#[source] std::io::Error),
    #[error("compatibility probe timed out")]
    Timeout,
    #[error("origin response exceeded the compatibility size limit")]
    ResponseTooLarge,
    #[error("origin response has no valid HTTP/1.1 status line")]
    InvalidResponse,
}

pub type Result<T> = std::result::Result<T, CompatibilityProbeError>;

pub fn build_compatibility_request(config: &CompatibilityProbeConfig) -> Result<Vec<u8>> {
    validate_config(config)?;
    match config.header_mode {
        HeaderMode::WithBinding => build_require_info_request(
            EXPERIMENTAL_ALLOWLISTED_GAME_SERVER,
            config.binding_value.as_deref().expect("validated binding"),
        )
        .map_err(CompatibilityProbeError::from),
        HeaderMode::WithoutBinding => Ok(format!(
            "POST /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: {EXPERIMENTAL_ALLOWLISTED_GAME_SERVER}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        )
        .into_bytes()),
    }
}

pub fn validate_config(config: &CompatibilityProbeConfig) -> Result<()> {
    if !config.acknowledge_live_request {
        return Err(CompatibilityProbeError::LiveRequestAcknowledgementRequired);
    }
    match (config.header_mode, config.binding_value.as_deref()) {
        (HeaderMode::WithBinding, None) => Err(CompatibilityProbeError::BindingRequired),
        (HeaderMode::WithBinding, Some(value)) => {
            parse_binding_value(value)?;
            Ok(())
        }
        (HeaderMode::WithoutBinding, Some(_)) => Err(CompatibilityProbeError::BindingNotAllowed),
        (HeaderMode::WithoutBinding, None) => Ok(()),
    }
}

pub async fn run(config: CompatibilityProbeConfig) -> Result<CompatibilityObservation> {
    let request = build_compatibility_request(&config)?;
    let tcp_stream = timeout(
        COMPATIBILITY_IO_TIMEOUT,
        TcpStream::connect((
            EXPERIMENTAL_ALLOWLISTED_GAME_SERVER,
            EXPERIMENTAL_GAME_SERVER_PORT,
        )),
    )
    .await
    .map_err(|_| CompatibilityProbeError::Timeout)?
    .map_err(CompatibilityProbeError::Tcp)?;

    let mut root_store = RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let client_config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    let connector = TlsConnector::from(Arc::new(client_config));
    let server_name = ServerName::try_from(EXPERIMENTAL_ALLOWLISTED_GAME_SERVER.to_owned())
        .map_err(|_| CompatibilityProbeError::InvalidResponse)?;
    let mut tls_stream = timeout(
        COMPATIBILITY_IO_TIMEOUT,
        connector.connect(server_name, tcp_stream),
    )
    .await
    .map_err(|_| CompatibilityProbeError::Timeout)?
    .map_err(CompatibilityProbeError::Tls)?;

    let response = timeout(COMPATIBILITY_IO_TIMEOUT, async {
        tls_stream
            .write_all(&request)
            .await
            .map_err(CompatibilityProbeError::Tls)?;
        tls_stream
            .flush()
            .await
            .map_err(CompatibilityProbeError::Tls)?;
        read_response(&mut tls_stream).await
    })
    .await
    .map_err(|_| CompatibilityProbeError::Timeout)??;

    let http_status = parse_http_status(&response)?;
    Ok(CompatibilityObservation {
        header_mode: config.header_mode,
        http_status,
        request_bytes: request.len(),
        response_bytes: response.len(),
        request_sha256: hex_digest(&sha256(&request)),
        response_sha256: hex_digest(&sha256(&response)),
    })
}

impl CompatibilityObservation {
    pub fn sanitized_json(&self) -> String {
        format!(
            "{{\"evidence_class\":\"{COMPATIBILITY_EVIDENCE_CLASS}\",\"tlsn_presentation\":false,\"production_route_touched\":false,\"one_shot\":true,\"server_identity\":\"{EXPERIMENTAL_ALLOWLISTED_GAME_SERVER}\",\"target\":\"/kcsapi/api_get_member/require_info\",\"header_mode\":\"{}\",\"http_status\":{},\"request_bytes\":{},\"response_bytes\":{},\"request_sha256\":\"{}\",\"response_sha256\":\"{}\",\"api_member_id\":null}}",
            self.header_mode.as_str(),
            self.http_status,
            self.request_bytes,
            self.response_bytes,
            self.request_sha256,
            self.response_sha256,
        )
    }
}

async fn read_response<S>(stream: &mut S) -> Result<Vec<u8>>
where
    S: tokio::io::AsyncRead + Unpin,
{
    let mut response = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = stream
            .read(&mut buffer)
            .await
            .map_err(CompatibilityProbeError::Tls)?;
        if count == 0 {
            return Ok(response);
        }
        if response.len().saturating_add(count) > MAX_COMPATIBILITY_RESPONSE_BYTES {
            return Err(CompatibilityProbeError::ResponseTooLarge);
        }
        response.extend_from_slice(&buffer[..count]);
    }
}

fn parse_http_status(response: &[u8]) -> Result<u16> {
    let line_end = response
        .windows(2)
        .position(|window| window == b"\r\n")
        .ok_or(CompatibilityProbeError::InvalidResponse)?;
    let status_line = std::str::from_utf8(&response[..line_end])
        .map_err(|_| CompatibilityProbeError::InvalidResponse)?;
    let mut fields = status_line.splitn(3, ' ');
    if fields.next() != Some("HTTP/1.1") {
        return Err(CompatibilityProbeError::InvalidResponse);
    }
    let status = fields
        .next()
        .ok_or(CompatibilityProbeError::InvalidResponse)?
        .parse::<u16>()
        .map_err(|_| CompatibilityProbeError::InvalidResponse)?;
    if !(100..=599).contains(&status) {
        return Err(CompatibilityProbeError::InvalidResponse);
    }
    Ok(status)
}

fn hex_digest(digest: &[u8; 32]) -> String {
    let mut output = String::with_capacity(64);
    for byte in digest {
        write!(&mut output, "{byte:02x}").expect("writing to String cannot fail");
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use uuid::Uuid;

    fn binding_value() -> String {
        let session = Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000").unwrap();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(crate::BINDING_PREFIX);
        bytes.extend_from_slice(&16_u16.to_be_bytes());
        bytes.extend_from_slice(session.as_bytes());
        bytes.extend_from_slice(&32_u16.to_be_bytes());
        bytes.extend_from_slice(&[0x42_u8; 32]);
        URL_SAFE_NO_PAD.encode(bytes)
    }

    #[test]
    fn live_probe_requires_explicit_acknowledgement() {
        let error = validate_config(&CompatibilityProbeConfig {
            header_mode: HeaderMode::WithoutBinding,
            binding_value: None,
            acknowledge_live_request: false,
        })
        .unwrap_err();
        assert!(matches!(
            error,
            CompatibilityProbeError::LiveRequestAcknowledgementRequired
        ));
    }

    #[test]
    fn header_modes_are_strictly_validated() {
        let binding = binding_value();
        assert!(build_compatibility_request(&CompatibilityProbeConfig {
            header_mode: HeaderMode::WithBinding,
            binding_value: Some(binding.clone()),
            acknowledge_live_request: true,
        })
        .unwrap()
        .windows(crate::BINDING_HEADER.len())
        .any(|window| window == crate::BINDING_HEADER.as_bytes()));
        assert!(!build_compatibility_request(&CompatibilityProbeConfig {
            header_mode: HeaderMode::WithoutBinding,
            binding_value: None,
            acknowledge_live_request: true,
        })
        .unwrap()
        .windows(crate::BINDING_HEADER.len())
        .any(|window| window == crate::BINDING_HEADER.as_bytes()));
        assert!(matches!(
            validate_config(&CompatibilityProbeConfig {
                header_mode: HeaderMode::WithoutBinding,
                binding_value: Some(binding),
                acknowledge_live_request: true,
            }),
            Err(CompatibilityProbeError::BindingNotAllowed)
        ));
    }

    #[test]
    fn observation_artifact_never_contains_member_id() {
        let artifact = CompatibilityObservation {
            header_mode: HeaderMode::WithoutBinding,
            http_status: 400,
            request_bytes: 123,
            response_bytes: 456,
            request_sha256: "00".repeat(32),
            response_sha256: "11".repeat(32),
        }
        .sanitized_json();
        assert!(artifact.contains("\"api_member_id\":null"));
        assert!(!artifact.contains("16189463"));
        assert!(artifact.contains("DIRECT_ORIGIN_COMPATIBILITY_OBSERVATION"));
    }

    #[test]
    fn status_parser_requires_http_11_and_valid_status() {
        assert_eq!(
            parse_http_status(b"HTTP/1.1 204 No Content\r\n\r\n").unwrap(),
            204
        );
        assert!(parse_http_status(b"HTTP/2 200 OK\r\n").is_err());
        assert!(parse_http_status(b"HTTP/1.1 700 Invalid\r\n").is_err());
    }
}
