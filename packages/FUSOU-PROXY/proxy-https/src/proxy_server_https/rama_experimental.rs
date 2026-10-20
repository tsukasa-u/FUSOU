use super::RawCaptureHook;
use crate::{capture::ExactWireMetadata, capture_io::CaptureIo};
use hudsucker::certificate_authority::CertificateAuthority;
use rama::{
    conversion::RamaTryInto,
    error::{BoxError, BoxErrorExt as _},
    extensions::Extensions,
    http::{
        conn::TargetHttpVersion,
        io::upgrade::{self, Upgraded},
        ws::handshake::{
            client::HttpClientWebSocketExt,
            mitm::{
                WebSocketRelayEvent, WebSocketRelayEventInput, WebSocketRelayEventOutput,
                WebSocketRelayEventService,
            },
            server::validate_http_client_request,
        },
        Body, Request, Response, StatusCode, Version,
    },
    io::BridgeIo,
    net::address::Host,
    rt::Executor,
    service::service_fn,
    tls::{
        client::{ServerVerifyMode, TlsClientConfig, TlsServerTrust, TlsServerTrustAnchors},
        rustls::{
            server::{DynamicConfigProvider, RustlsServerConfigExt, TlsAcceptorLayer},
            RamaTlsRustlsCrateMarker,
        },
        server::TlsServerConfig,
        SecureTransport,
    },
    Layer, Service, ServiceInput,
};
use rama_http_backend::{proxy::mitm::HttpMitmRelay, server::HttpServer};
use std::{
    convert::Infallible,
    future::Future,
    io,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    pin::Pin,
    sync::{
        atomic::{AtomicU64, AtomicU8, AtomicUsize, Ordering},
        Arc,
    },
    task::{Context, Poll},
};
use tokio::{
    io::{AsyncRead, AsyncWrite, AsyncWriteExt, ReadBuf},
    net::{TcpListener, TcpStream},
    sync::Mutex as AsyncMutex,
    task::JoinSet,
};
use tokio_rustls::rustls::{
    self,
    pki_types::{CertificateDer, ServerName},
};

const WEBSOCKET_CLOSE_HANDSHAKE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const UPSTREAM_TLS_FAILURE_RESPONSE: &[u8] =
    b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

type TunnelTasks = Arc<AsyncMutex<JoinSet<()>>>;

#[derive(Clone)]
pub struct RamaExperimentalConfig {
    allowed_authority: String,
    allowed_host: String,
    upstream_address: SocketAddr,
    upstream_tls: Arc<rustls::ClientConfig>,
}

impl RamaExperimentalConfig {
    pub fn new(
        allowed_authority: impl Into<String>,
        upstream_address: SocketAddr,
        upstream_trust_roots: Vec<CertificateDer<'static>>,
    ) -> Result<Self, BoxError> {
        let allowed_authority = allowed_authority.into();
        let authority =
            rama::net::uri::Uri::parse_authority_form_strict(allowed_authority.as_str())
                .map_err(Into::<BoxError>::into)?;
        let allowed_host = authority
            .host_str()
            .ok_or_else(|| BoxError::from_static_str("CONNECT authority has no host"))?
            .into_owned();
        if authority.port_u16().is_none()
            || authority.to_string() != allowed_authority
            || !is_canonical_dns_name(&allowed_host)
        {
            return Err(BoxError::from_static_str(
                "Rama experimental authority must be canonical lowercase DNS host:port",
            ));
        }
        if authority.port_u16() != Some(upstream_address.port()) {
            return Err(BoxError::from_static_str(
                "CONNECT authority port must match the configured upstream socket port",
            ));
        }

        let host = Host::try_from(allowed_host.as_str())?;
        let trust_anchors = TlsServerTrustAnchors::try_new(upstream_trust_roots)?;
        let client_config = TlsClientConfig::new()
            .with_server_name(host)
            .with_server_verify(ServerVerifyMode::Auto)
            .with_server_trust(TlsServerTrust::custom(trust_anchors));
        let upstream_tls = <TlsClientConfig as RamaTryInto<
            rustls::ClientConfig,
            RamaTlsRustlsCrateMarker,
        >>::rama_try_into(client_config)?;

        Ok(Self {
            allowed_authority,
            allowed_host,
            upstream_address,
            upstream_tls: Arc::new(upstream_tls),
        })
    }
}

fn is_canonical_dns_name(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host == host.to_ascii_lowercase()
        && host.parse::<IpAddr>().is_err()
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}

struct SniBoundConfig {
    expected_sni: String,
    config: Arc<rustls::ServerConfig>,
}

impl DynamicConfigProvider for SniBoundConfig {
    fn get_config(
        &self,
        client_hello: rustls::server::ClientHello<'_>,
    ) -> impl Future<Output = Result<Arc<rustls::ServerConfig>, BoxError>> + Send {
        let matches = client_hello
            .server_name()
            .is_some_and(|name| name.eq_ignore_ascii_case(&self.expected_sni));
        let config = Arc::clone(&self.config);
        async move {
            if matches {
                Ok(config)
            } else {
                Err(BoxError::from_static_str(
                    "TLS SNI does not match CONNECT authority",
                ))
            }
        }
    }
}

const DOWNSTREAM_CLOSE_FRAME: u8 = 0b01;
const UPSTREAM_CLOSE_FRAME: u8 = 0b10;

fn websocket_close_handshake_complete(close_events: usize, close_frames: u8) -> bool {
    close_events > 0 && close_frames == (DOWNSTREAM_CLOSE_FRAME | UPSTREAM_CLOSE_FRAME)
}

struct WebSocketCloseFrameObserver<IO> {
    inner: IO,
    close_frames: Arc<AtomicU8>,
    relay_failed: Arc<std::sync::atomic::AtomicBool>,
    flag: u8,
    parser: WebSocketFrameParser,
}

impl<IO> WebSocketCloseFrameObserver<IO> {
    fn new(
        inner: IO,
        close_frames: Arc<AtomicU8>,
        relay_failed: Arc<std::sync::atomic::AtomicBool>,
        flag: u8,
        expect_masked: bool,
    ) -> Self {
        Self {
            inner,
            close_frames,
            relay_failed,
            flag,
            parser: WebSocketFrameParser::new(expect_masked),
        }
    }

    fn mark_io_failure(&self, message: &str) {
        if !self.relay_failed.swap(true, Ordering::AcqRel) {
            tracing::warn!(
                direction = self.flag,
                message,
                "Rama WebSocket relay I/O failed"
            );
        }
    }

    fn mark_protocol_failure(&self, message: &str) {
        if !self.relay_failed.swap(true, Ordering::AcqRel) {
            tracing::warn!(
                direction = self.flag,
                message,
                "Rama WebSocket relay observed an invalid frame"
            );
        }
    }
}

impl<IO> rama::extensions::ExtensionsRef for WebSocketCloseFrameObserver<IO>
where
    IO: rama::extensions::ExtensionsRef,
{
    fn extensions(&self) -> &rama::extensions::Extensions {
        self.inner.extensions()
    }
}

impl<IO> AsyncRead for WebSocketCloseFrameObserver<IO>
where
    IO: AsyncRead + AsyncWrite + Unpin,
{
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.as_mut().get_mut();
        let previous_len = buffer.filled().len();
        let buffer_has_capacity = buffer.remaining() > 0;
        let result = Pin::new(&mut this.inner).poll_read(context, buffer);
        match &result {
            Poll::Ready(Err(error)) => this.mark_io_failure(&error.to_string()),
            Poll::Ready(Ok(())) => {
                match this.parser.observe(&buffer.filled()[previous_len..]) {
                    Ok(true) => {
                        this.close_frames.fetch_or(this.flag, Ordering::Release);
                    }
                    Ok(false) => {}
                    Err(()) => {
                        this.mark_protocol_failure("invalid WebSocket frame");
                        return Poll::Ready(Err(io::Error::new(
                            io::ErrorKind::InvalidData,
                            "invalid WebSocket frame",
                        )));
                    }
                }
                if buffer_has_capacity
                    && buffer.filled().len() == previous_len
                    && !websocket_close_handshake_complete(
                        1,
                        this.close_frames.load(Ordering::Acquire),
                    )
                {
                    this.mark_io_failure("EOF before both close frames were observed");
                }
            }
            Poll::Pending => {}
        }
        result
    }
}

impl<IO> AsyncWrite for WebSocketCloseFrameObserver<IO>
where
    IO: AsyncRead + AsyncWrite + Unpin,
{
    fn poll_write(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.as_mut().get_mut();
        let result = Pin::new(&mut this.inner).poll_write(context, bytes);
        if let Poll::Ready(Err(error)) = &result {
            this.mark_io_failure(&error.to_string());
        } else if matches!(&result, Poll::Ready(Ok(0))) && !bytes.is_empty() {
            this.mark_io_failure("zero-byte write before relay completion");
        }
        result
    }

    fn poll_flush(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.as_mut().get_mut();
        let result = Pin::new(&mut this.inner).poll_flush(context);
        if let Poll::Ready(Err(error)) = &result {
            this.mark_io_failure(&error.to_string());
        }
        result
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.as_mut().get_mut();
        let result = Pin::new(&mut this.inner).poll_shutdown(context);
        if let Poll::Ready(Err(error)) = &result {
            this.mark_io_failure(&error.to_string());
        }
        result
    }
}

struct PendingWebSocketFrame {
    payload_remaining: u64,
    payload_offset: usize,
    mask: Option<[u8; 4]>,
    close_payload: Option<Vec<u8>>,
}

struct WebSocketFrameParser {
    buffered: Vec<u8>,
    current_frame: Option<PendingWebSocketFrame>,
    close_frame_seen: bool,
    invalid: bool,
    expect_masked: bool,
}

impl WebSocketFrameParser {
    fn new(expect_masked: bool) -> Self {
        Self {
            buffered: Vec::new(),
            current_frame: None,
            close_frame_seen: false,
            invalid: false,
            expect_masked,
        }
    }

    fn observe(&mut self, bytes: &[u8]) -> Result<bool, ()> {
        if self.invalid {
            return Err(());
        }
        if self.close_frame_seen {
            if bytes.is_empty() {
                return Ok(true);
            }
            self.invalid = true;
            return Err(());
        }
        self.buffered.extend_from_slice(bytes);
        loop {
            if let Some(frame) = self.current_frame.as_mut() {
                let consumed = frame.payload_remaining.min(self.buffered.len() as u64) as usize;
                if let Some(payload) = frame.close_payload.as_mut() {
                    for (index, byte) in self.buffered[..consumed].iter().enumerate() {
                        let decoded = match frame.mask {
                            Some(mask) => *byte ^ mask[(frame.payload_offset + index) % mask.len()],
                            None => *byte,
                        };
                        payload.push(decoded);
                    }
                }
                frame.payload_offset += consumed;
                frame.payload_remaining -= consumed as u64;
                self.buffered.drain(..consumed);
                if frame.payload_remaining > 0 {
                    return Ok(false);
                }
                let frame = self.current_frame.take().expect("active WebSocket frame");
                if let Some(payload) = frame.close_payload {
                    if !valid_close_payload(&payload) {
                        self.invalid = true;
                        return Err(());
                    }
                    if !self.buffered.is_empty() {
                        self.invalid = true;
                        return Err(());
                    }
                    self.close_frame_seen = true;
                    return Ok(true);
                }
            }

            if self.buffered.len() < 2 {
                return Ok(false);
            }
            let first = self.buffered[0];
            let second = self.buffered[1];
            let length_code = self.buffered[1] & 0x7f;
            let extended_length_bytes = match length_code {
                126 => 2,
                127 => 8,
                _ => 0,
            };
            if self.buffered.len() < 2 + extended_length_bytes {
                return Ok(false);
            }
            let payload_length = match length_code {
                126 => u64::from(u16::from_be_bytes([self.buffered[2], self.buffered[3]])),
                127 => u64::from_be_bytes([
                    self.buffered[2],
                    self.buffered[3],
                    self.buffered[4],
                    self.buffered[5],
                    self.buffered[6],
                    self.buffered[7],
                    self.buffered[8],
                    self.buffered[9],
                ]),
                length => u64::from(length),
            };
            if (length_code == 126 && payload_length < 126)
                || (length_code == 127 && payload_length <= u64::from(u16::MAX))
                || (length_code == 127 && self.buffered[2] & 0x80 != 0)
            {
                self.invalid = true;
                return Err(());
            }

            let is_masked = second & 0x80 != 0;
            let mask_length = if is_masked { 4 } else { 0 };
            let header_length = 2 + extended_length_bytes + mask_length;
            if self.buffered.len() < header_length {
                return Ok(false);
            }
            let opcode = first & 0x0f;
            let is_control = opcode & 0x08 != 0;
            let is_close = opcode == 0x08;
            let fin = first & 0x80 != 0;
            if !matches!(opcode, 0x00 | 0x01 | 0x02 | 0x08 | 0x09 | 0x0a)
                || first & 0x70 != 0
                || is_masked != self.expect_masked
                || (is_control && (!fin || payload_length > 125 || length_code > 125))
                || (is_close && (!fin || payload_length == 1))
            {
                self.invalid = true;
                return Err(());
            }
            let mask = if is_masked {
                Some(
                    self.buffered[2 + extended_length_bytes..header_length]
                        .try_into()
                        .expect("four-byte WebSocket mask"),
                )
            } else {
                None
            };
            if is_close && payload_length == 0 {
                self.buffered.drain(..header_length);
                if !self.buffered.is_empty() {
                    self.invalid = true;
                    return Err(());
                }
                self.close_frame_seen = true;
                return Ok(true);
            }
            self.buffered.drain(..header_length);
            self.current_frame = Some(PendingWebSocketFrame {
                payload_remaining: payload_length,
                payload_offset: 0,
                mask,
                close_payload: is_close.then(|| {
                    Vec::with_capacity(
                        usize::try_from(payload_length)
                            .expect("Close payload is at most 125 bytes"),
                    )
                }),
            });
        }
    }
}

fn valid_close_payload(payload: &[u8]) -> bool {
    if payload.is_empty() {
        return true;
    }
    if payload.len() < 2 {
        return false;
    }
    let code = u16::from_be_bytes([payload[0], payload[1]]);
    rama::http::ws::protocol::frame::coding::CloseCode::from(code).is_allowed()
        && std::str::from_utf8(&payload[2..]).is_ok()
}

#[cfg(test)]
mod websocket_frame_parser_tests {
    use super::{
        valid_close_payload, websocket_close_handshake_complete, WebSocketCloseFrameObserver,
        WebSocketFrameParser, DOWNSTREAM_CLOSE_FRAME, UPSTREAM_CLOSE_FRAME,
    };
    use std::sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        Arc,
    };

    #[derive(Debug)]
    struct WebSocketObserverTestExtension(u32);

    impl rama::extensions::Extension for WebSocketObserverTestExtension {}

    fn masked_close(payload: &[u8]) -> Vec<u8> {
        let mask = [0x11, 0x22, 0x33, 0x44];
        let mut frame = vec![0x88, 0x80 | payload.len() as u8];
        frame.extend_from_slice(&mask);
        frame.extend(
            payload
                .iter()
                .enumerate()
                .map(|(index, byte)| *byte ^ mask[index % mask.len()]),
        );
        frame
    }

    #[test]
    fn recognizes_complete_close_frames_after_split_reads() {
        let masked_close = masked_close(&[0x03, 0xe8, b'o', b'k']);
        let mut downstream = WebSocketFrameParser::new(true);
        for byte in &masked_close[..masked_close.len() - 1] {
            assert_eq!(downstream.observe(std::slice::from_ref(byte)), Ok(false));
        }
        assert_eq!(
            downstream.observe(&masked_close[masked_close.len() - 1..]),
            Ok(true)
        );

        let mut upstream = WebSocketFrameParser::new(false);
        assert_eq!(upstream.observe(&[0x88, 0x02, 0x03, 0xe8]), Ok(true));
    }

    #[test]
    fn accepts_maximum_close_payload_and_rejects_oversized_control_frame() {
        let mut maximum_payload = vec![0x03, 0xe8];
        maximum_payload.extend(std::iter::repeat_n(b'x', 123));
        let mut valid_parser = WebSocketFrameParser::new(true);
        assert_eq!(
            valid_parser.observe(&masked_close(&maximum_payload)),
            Ok(true)
        );

        let mut oversized_parser = WebSocketFrameParser::new(true);
        assert_eq!(
            oversized_parser.observe(&[0x88, 0xfe, 0x00, 0x7e, 0x11, 0x22, 0x33, 0x44]),
            Err(())
        );
    }

    #[test]
    fn ignores_data_frames_before_a_valid_close_frame() {
        let mut parser = WebSocketFrameParser::new(true);
        let mask = [0x01, 0x02, 0x03, 0x04];
        let mut frames = vec![0x81, 0x81];
        frames.extend_from_slice(&mask);
        frames.push(b'x' ^ mask[0]);
        frames.extend(masked_close(&[0x03, 0xe8]));
        assert_eq!(parser.observe(&frames), Ok(true));
    }

    #[test]
    fn rejects_invalid_close_codes_reasons_and_control_frames() {
        assert!(!valid_close_payload(&[0x03, 0xed]));
        assert!(!valid_close_payload(&[0x03, 0xe8, 0xff]));
        assert!(valid_close_payload(&[0x03, 0xe8, b'o', b'k']));
        assert!(valid_close_payload(&[]));

        let mut empty_close_parser = WebSocketFrameParser::new(true);
        assert_eq!(empty_close_parser.observe(&masked_close(&[])), Ok(true));

        for invalid_frame in [
            masked_close(&[0x03]),
            vec![0x88, 0x80 | 1, 0x11, 0x22, 0x33, 0x44, 0x00],
            vec![0x08, 0x80, 0x11, 0x22, 0x33, 0x44],
            vec![0x88, 0x02, 0x03, 0xed],
            vec![0x88, 0x82, 0x11, 0x22, 0x33, 0x44, 0x12, 0xdd],
            vec![0x88, 0x02, 0x03, 0xe8],
            vec![0x88, 0x80 | 126, 0, 1, 0x11, 0x22, 0x33, 0x44, 0x12],
        ] {
            let mut parser = WebSocketFrameParser::new(true);
            assert_eq!(parser.observe(&invalid_frame), Err(()));
        }
    }

    #[test]
    fn rejects_reserved_bits_opcodes_and_bytes_after_close() {
        for invalid_frame in [
            vec![0xc8, 0x80, 0x11, 0x22, 0x33, 0x44],
            vec![0x83, 0x80, 0x11, 0x22, 0x33, 0x44],
        ] {
            let mut parser = WebSocketFrameParser::new(true);
            assert_eq!(parser.observe(&invalid_frame), Err(()));
        }

        let mut parser = WebSocketFrameParser::new(false);
        assert_eq!(parser.observe(&[0x88, 0x02, 0x03, 0xe8]), Ok(true));
        assert_eq!(parser.observe(&[0x81, 0x00]), Err(()));

        let mut parser = WebSocketFrameParser::new(false);
        assert_eq!(parser.observe(&[0x88, 0x00, 0x81, 0x00]), Err(()));
    }

    #[tokio::test]
    async fn observer_rejects_invalid_frames_and_marks_partial_eof_unclean() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let (mut peer, stream) = tokio::io::duplex(64);
        let close_frames = Arc::new(AtomicU8::new(0));
        let relay_failed = Arc::new(AtomicBool::new(false));
        let mut observer = WebSocketCloseFrameObserver::new(
            stream,
            Arc::clone(&close_frames),
            Arc::clone(&relay_failed),
            DOWNSTREAM_CLOSE_FRAME,
            true,
        );
        peer.write_all(&[0x83, 0x80, 0x11, 0x22, 0x33, 0x44])
            .await
            .expect("write reserved opcode frame");
        let mut buffer = [0; 16];
        let error = observer
            .read(&mut buffer)
            .await
            .expect_err("observer must reject invalid frame");
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        assert!(relay_failed.load(Ordering::Acquire));
        assert_eq!(close_frames.load(Ordering::Acquire), 0);

        for partial_frame in [&[0x81][..], &[0x81, 0x83, 0x11, 0x22, 0x33, 0x44, b'x'][..]] {
            let (mut peer, stream) = tokio::io::duplex(64);
            let relay_failed = Arc::new(AtomicBool::new(false));
            let mut observer = WebSocketCloseFrameObserver::new(
                stream,
                Arc::new(AtomicU8::new(0)),
                Arc::clone(&relay_failed),
                DOWNSTREAM_CLOSE_FRAME,
                true,
            );
            peer.write_all(partial_frame)
                .await
                .expect("write partial frame");
            peer.shutdown().await.expect("end partial frame stream");
            observer
                .read_to_end(&mut Vec::new())
                .await
                .expect("EOF is relayed to the WebSocket parser");
            assert!(
                relay_failed.load(Ordering::Acquire),
                "EOF inside a frame must make the relay unclean"
            );
        }
    }

    #[test]
    fn incomplete_websocket_close_handshakes_are_not_clean() {
        assert!(!websocket_close_handshake_complete(
            1,
            DOWNSTREAM_CLOSE_FRAME
        ));
        assert!(!websocket_close_handshake_complete(1, UPSTREAM_CLOSE_FRAME));
        assert!(!websocket_close_handshake_complete(0, 0));
        assert!(websocket_close_handshake_complete(
            1,
            DOWNSTREAM_CLOSE_FRAME | UPSTREAM_CLOSE_FRAME
        ));
    }

    #[tokio::test]
    async fn websocket_observer_delegates_rama_extensions_reference() {
        use rama::extensions::ExtensionsRef;

        let (_peer, stream) = tokio::io::duplex(64);
        let input = rama::ServiceInput::new(stream);
        input.extensions.insert(WebSocketObserverTestExtension(234));
        let observer = WebSocketCloseFrameObserver::new(
            input,
            Arc::new(AtomicU8::new(0)),
            Arc::new(AtomicBool::new(false)),
            DOWNSTREAM_CLOSE_FRAME,
            true,
        );

        assert_eq!(
            observer
                .extensions()
                .get_ref::<WebSocketObserverTestExtension>()
                .map(|extension| extension.0),
            Some(234)
        );
    }
}

pub async fn serve<CA, Shutdown>(
    listener: TcpListener,
    config: RamaExperimentalConfig,
    ca: Arc<CA>,
    capture_output_root: PathBuf,
    shutdown: Shutdown,
) -> Result<(), BoxError>
where
    CA: CertificateAuthority,
    Shutdown: Future<Output = ()> + Send,
{
    let capture_hook = RawCaptureHook::new(capture_output_root);
    serve_with_capture_hook(listener, config, ca, capture_hook, shutdown).await
}

async fn serve_with_capture_hook<CA, Shutdown>(
    listener: TcpListener,
    config: RamaExperimentalConfig,
    ca: Arc<CA>,
    capture_hook: RawCaptureHook,
    shutdown: Shutdown,
) -> Result<(), BoxError>
where
    CA: CertificateAuthority,
    Shutdown: Future<Output = ()> + Send,
{
    let next_connection_id = Arc::new(AtomicU64::new(1));
    let mut connections = JoinSet::new();
    tokio::pin!(shutdown);

    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (socket, client_addr) = match accepted {
                    Ok(accepted) => accepted,
                    Err(error) => {
                        tracing::error!(%error, "Rama experimental listener accept failed");
                        return Err(error.into());
                    }
                };
                let connection_id = next_connection_id
                    .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |id| id.checked_add(1))
                    .map_err(|_| BoxError::from_static_str("Rama connection ID space exhausted"))?;
                let config = config.clone();
                let ca = Arc::clone(&ca);
                let capture_hook = capture_hook.clone();
                connections.spawn(async move {
                    let result = serve_connection(
                        socket,
                        client_addr,
                        connection_id,
                        config,
                        ca,
                        capture_hook,
                    )
                    .await;
                    (connection_id, client_addr, result)
                });
            }
            joined = connections.join_next(), if !connections.is_empty() => {
                match joined {
                    Some(Ok((connection_id, client_addr, Ok(())))) => {
                        tracing::debug!(connection_id, %client_addr, "Rama experimental client connection completed");
                    }
                    Some(Ok((connection_id, client_addr, Err(error)))) => {
                        tracing::warn!(%error, connection_id, %client_addr, "Rama experimental client connection failed");
                    }
                    Some(Err(error)) if error.is_cancelled() => {
                        tracing::debug!(%error, "Rama experimental client connection was cancelled");
                    }
                    Some(Err(error)) => {
                        tracing::error!(%error, "Rama experimental client connection task failed");
                    }
                    None => {}
                }
            }
            _ = &mut shutdown => break,
        }
    }

    connections.abort_all();
    while let Some(joined) = connections.join_next().await {
        match joined {
            Ok((_connection_id, _client_addr, Ok(()))) => {}
            Ok((connection_id, client_addr, Err(error))) => {
                tracing::warn!(%error, connection_id, %client_addr, "Rama experimental client connection failed during shutdown");
            }
            Err(error) if error.is_cancelled() => {
                tracing::debug!(%error, "Rama experimental client connection cancelled during shutdown");
            }
            Err(error) => {
                tracing::error!(%error, "Rama experimental client connection task failed during shutdown");
            }
        }
    }
    RawCaptureHook::wait_for_persistence_tasks(Arc::clone(&capture_hook.persistence_tasks)).await;
    Ok(())
}

async fn serve_connection<CA>(
    socket: TcpStream,
    client_addr: SocketAddr,
    connection_id: u64,
    config: RamaExperimentalConfig,
    ca: Arc<CA>,
    capture_hook: RawCaptureHook,
) -> Result<(), BoxError>
where
    CA: CertificateAuthority,
{
    let tunnel_tasks: TunnelTasks = Arc::new(AsyncMutex::new(JoinSet::new()));
    let tunnel_tasks_for_service = Arc::clone(&tunnel_tasks);
    let service = service_fn(move |request| {
        let config = config.clone();
        let ca = Arc::clone(&ca);
        let capture_hook = capture_hook.clone();
        let tunnel_tasks = Arc::clone(&tunnel_tasks_for_service);
        async move {
            Ok::<_, Infallible>(
                handle_connect(
                    request,
                    client_addr,
                    connection_id,
                    config,
                    ca,
                    capture_hook,
                    tunnel_tasks,
                )
                .await,
            )
        }
    });

    let connection_result = HttpServer::new_http1(Executor::default())
        .serve(ServiceInput::new(socket), service)
        .await;
    let mut tasks = std::mem::take(&mut *tunnel_tasks.lock().await);
    let mut tunnel_task_error = None;
    while let Some(joined) = tasks.join_next().await {
        match joined {
            Ok(()) => {}
            Err(error) => {
                tracing::warn!(%error, connection_id, %client_addr, "Rama experimental CONNECT tunnel task failed");
                if tunnel_task_error.is_none() {
                    tunnel_task_error = Some(BoxError::from(error));
                }
            }
        }
    }
    connection_result?;
    if let Some(error) = tunnel_task_error {
        return Err(error);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn handle_connect<CA>(
    request: Request<Body>,
    client_addr: SocketAddr,
    connection_id: u64,
    config: RamaExperimentalConfig,
    ca: Arc<CA>,
    capture_hook: RawCaptureHook,
    tunnel_tasks: TunnelTasks,
) -> Response
where
    CA: CertificateAuthority,
{
    if request.method() != rama::http::Method::CONNECT {
        return empty_response(StatusCode::METHOD_NOT_ALLOWED);
    }
    let authority = request.uri().to_string();
    let Ok(parsed_authority) = rama::net::uri::Uri::parse_authority_form_strict(authority.as_str())
    else {
        return empty_response(StatusCode::BAD_REQUEST);
    };
    if parsed_authority.to_string() != config.allowed_authority
        || request.headers().get_all("host").iter().count() != 1
        || !request
            .headers()
            .get("host")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|host| host.eq_ignore_ascii_case(&config.allowed_authority))
    {
        return empty_response(StatusCode::FORBIDDEN);
    }
    let authority = match authority.parse::<http::uri::Authority>() {
        Ok(authority) => authority,
        Err(error) => {
            tracing::warn!(%error, "Rama experimental CONNECT authority could not be adapted");
            return empty_response(StatusCode::BAD_REQUEST);
        }
    };

    let authority = authority.clone();
    let pending_upgrade = upgrade::handle_upgrade(&request);
    let task = async move {
        if let Err(error) = run_tunnel(
            pending_upgrade,
            config,
            authority,
            connection_id,
            ca,
            capture_hook,
        )
        .await
        {
            tracing::warn!(%error, connection_id, %client_addr, "Rama experimental CONNECT tunnel failed");
        }
    };
    tunnel_tasks.lock().await.spawn(task);
    empty_response(StatusCode::OK)
}

async fn run_tunnel<CA, Upgrade>(
    pending_upgrade: Upgrade,
    config: RamaExperimentalConfig,
    authority: http::uri::Authority,
    connection_id: u64,
    ca: Arc<CA>,
    capture_hook: RawCaptureHook,
) -> Result<(), BoxError>
where
    CA: CertificateAuthority,
    Upgrade: Future<Output = Result<Upgraded, BoxError>> + Send + 'static,
{
    let upgraded = pending_upgrade.await?;
    let server_config = ca.gen_server_config(&authority).await;
    let downstream_tls_config = TlsServerConfig::new()
        .with_alpn_http_1()
        .with_dynamic_config(Arc::new(SniBoundConfig {
            expected_sni: authority.host().to_owned(),
            config: server_config,
        }));
    let tls_acceptor =
        TlsAcceptorLayer::new(downstream_tls_config).into_layer(service_fn(|stream| async move {
            Ok::<_, Infallible>(stream)
        }));
    let mut downstream_tls = tls_acceptor.serve(ServiceInput::new(upgraded)).await?;
    let upstream_tls = match connect_verified_upstream(&config).await {
        Ok(stream) => stream,
        Err(error) => {
            tracing::warn!(%error, connection_id, "Rama experimental verified upstream TLS failed after downstream SNI validation");
            downstream_tls
                .write_all(UPSTREAM_TLS_FAILURE_RESPONSE)
                .await?;
            downstream_tls.shutdown().await?;
            return Ok(());
        }
    };
    let recorder = capture_hook.start_session(connection_id).map_err(|()| {
        tracing::error!(connection_id, "Rama raw capture session map is poisoned");
        BoxError::from_static_str("Rama raw capture session unavailable")
    })?;
    let capture_session = CaptureSessionGuard::new(capture_hook.clone(), connection_id);
    let ingress = CaptureIo::new_with_read_chunk_size(downstream_tls, recorder, 1);
    let egress = ServiceInput::new(upstream_tls);
    egress.extensions.insert(SecureTransport::default());
    egress
        .extensions
        .insert(TargetHttpVersion(Version::HTTP_11));

    let websocket_tasks = Arc::new(AsyncMutex::new(JoinSet::new()));
    let relay = HttpMitmRelay::new(Executor::default()).with_http_middleware(CaptureLayer {
        authority: authority.to_string(),
        connection_id,
        capture_hook: capture_hook.clone(),
        websocket_tasks: Arc::clone(&websocket_tasks),
    });
    let result = relay.serve(BridgeIo(ingress, egress)).await;

    let mut tasks = std::mem::take(&mut *websocket_tasks.lock().await);
    let mut websockets_clean = true;
    while let Some(task) = tasks.join_next().await {
        match task {
            Ok(true) => {}
            Ok(false) => {
                websockets_clean = false;
                tracing::warn!(
                    connection_id,
                    "Rama WebSocket relay ended without a clean close handshake"
                );
            }
            Err(error) => {
                websockets_clean = false;
                tracing::warn!(%error, connection_id, "Rama WebSocket relay task failed");
            }
        }
    }
    if !websockets_clean {
        tracing::info!(
            connection_id,
            "WebSocket relay ended uncleanly after HTTP Upgrade artifact finalization"
        );
    }
    capture_session.finish(result.is_ok()).await;
    result
}

async fn connect_verified_upstream(
    config: &RamaExperimentalConfig,
) -> Result<tokio_rustls::client::TlsStream<TcpStream>, BoxError> {
    let upstream_socket = TcpStream::connect(config.upstream_address).await?;
    let server_name =
        ServerName::try_from(config.allowed_host.clone()).map_err(Into::<BoxError>::into)?;
    Ok(
        tokio_rustls::TlsConnector::from(Arc::clone(&config.upstream_tls))
            .connect(server_name, upstream_socket)
            .await?,
    )
}

struct CaptureSessionGuard {
    capture_hook: RawCaptureHook,
    connection_id: u64,
    finalized: bool,
}

impl CaptureSessionGuard {
    fn new(capture_hook: RawCaptureHook, connection_id: u64) -> Self {
        Self {
            capture_hook,
            connection_id,
            finalized: false,
        }
    }

    async fn finish(mut self, connection_clean: bool) {
        let finish = self
            .capture_hook
            .finish_connection(self.connection_id, connection_clean);
        self.finalized = true;
        finish.await;
    }
}

impl Drop for CaptureSessionGuard {
    fn drop(&mut self) {
        if self.finalized {
            return;
        }
        self.capture_hook.mark_invalid(self.connection_id);
        self.capture_hook
            .schedule_finish_connection(self.connection_id, false);
    }
}

struct WebSocketCompletionGuard {
    capture_hook: RawCaptureHook,
    connection_id: u64,
    completed: bool,
}

impl WebSocketCompletionGuard {
    fn complete(&mut self, clean: bool) {
        self.capture_hook
            .websocket_completed_for(self.connection_id, clean);
        self.completed = true;
    }
}

impl Drop for WebSocketCompletionGuard {
    fn drop(&mut self) {
        if !self.completed {
            self.capture_hook
                .websocket_completed_for(self.connection_id, false);
        }
    }
}

#[derive(Clone)]
struct CaptureLayer {
    authority: String,
    connection_id: u64,
    capture_hook: RawCaptureHook,
    websocket_tasks: Arc<AsyncMutex<JoinSet<bool>>>,
}

struct CaptureService<S> {
    inner: Arc<S>,
    authority: String,
    connection_id: u64,
    capture_hook: RawCaptureHook,
    websocket_tasks: Arc<AsyncMutex<JoinSet<bool>>>,
}

impl<S> Clone for CaptureService<S> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            authority: self.authority.clone(),
            connection_id: self.connection_id,
            capture_hook: self.capture_hook.clone(),
            websocket_tasks: Arc::clone(&self.websocket_tasks),
        }
    }
}

impl<S> Layer<S> for CaptureLayer {
    type Service = CaptureService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        CaptureService {
            inner: Arc::new(inner),
            authority: self.authority.clone(),
            connection_id: self.connection_id,
            capture_hook: self.capture_hook.clone(),
            websocket_tasks: Arc::clone(&self.websocket_tasks),
        }
    }
}

impl<S> Service<Request<Body>> for CaptureService<S>
where
    S: Service<Request<Body>, Output = Response, Error: Into<BoxError>>
        + HttpClientWebSocketExt<Body>
        + Send
        + Sync
        + 'static,
{
    type Output = Response;
    type Error = BoxError;

    async fn serve(&self, mut request: Request<Body>) -> Result<Self::Output, Self::Error> {
        let connection_id = self.connection_id;
        self.capture_hook
            .request_started_for(connection_id, metadata_from_request(&request));

        if !request_is_for_authority(&request, &self.authority) {
            self.capture_hook.mark_invalid(connection_id);
            return Ok(empty_response(StatusCode::MISDIRECTED_REQUEST));
        }
        let is_websocket_attempt = is_websocket_upgrade_attempt(&request);
        if !rewrite_request_uri(&mut request, &self.authority) {
            self.capture_hook.mark_invalid(connection_id);
            return Ok(empty_response(StatusCode::BAD_REQUEST));
        }

        if !is_websocket_attempt {
            let response = match self.inner.as_ref().serve(request).await {
                Ok(response) => response,
                Err(error) => {
                    self.capture_hook.mark_invalid(connection_id);
                    return Err(error.into());
                }
            };
            self.capture_hook.request_completed_for(connection_id);
            self.capture_hook
                .response_started_for(connection_id, metadata_from_response(&response));
            return Ok(response);
        }

        if let Err(error) = validate_http_client_request(&request) {
            self.capture_hook.mark_invalid(connection_id);
            tracing::debug!(%error, connection_id, "invalid downstream WebSocket handshake");
            return Ok(empty_response(StatusCode::BAD_REQUEST));
        }

        let downstream_upgrade = upgrade::handle_upgrade(&request);
        let upstream_websocket = match self
            .inner
            .as_ref()
            .websocket_with_request(request)
            .handshake(Extensions::new())
            .await
        {
            Ok(websocket) => websocket,
            Err(error) => {
                self.capture_hook.mark_invalid(connection_id);
                tracing::warn!(%error, connection_id, "Rama upstream WebSocket handshake failed");
                return Ok(empty_response(StatusCode::BAD_GATEWAY));
            }
        };
        let response_parts = upstream_websocket.response;
        let response = Response::builder()
            .status(response_parts.status)
            .version(response_parts.version)
            .body(Body::empty())
            .map_err(Into::<BoxError>::into)?;
        let mut response = response;
        *response.headers_mut() = response_parts.headers;
        self.capture_hook.request_completed_for(connection_id);
        self.capture_hook
            .response_started_for(connection_id, metadata_from_response(&response));

        let upstream_io = upstream_websocket.socket.into_inner();
        let pending_upgrade = downstream_upgrade;
        let capture_hook = self.capture_hook.clone();
        let task = async move {
            let mut completion = WebSocketCompletionGuard {
                capture_hook: capture_hook.clone(),
                connection_id,
                completed: false,
            };
            let downstream_io = match pending_upgrade.await {
                Ok(io) => io,
                Err(error) => {
                    capture_hook.mark_invalid(connection_id);
                    tracing::warn!(%error, connection_id, "Rama downstream WebSocket upgrade failed");
                    completion.complete(false);
                    return false;
                }
            };
            capture_hook.response_completed_for(connection_id);
            let clean = relay_websocket(
                downstream_io,
                upstream_io,
                WEBSOCKET_CLOSE_HANDSHAKE_TIMEOUT,
            )
            .await;
            completion.complete(clean);
            clean
        };
        self.websocket_tasks.lock().await.spawn(task);
        Ok(response)
    }
}

#[derive(Clone)]
struct CloseTracker(Arc<AtomicUsize>);

impl Service<WebSocketRelayEventInput> for CloseTracker {
    type Output = WebSocketRelayEventOutput;
    type Error = Infallible;

    async fn serve(&self, input: WebSocketRelayEventInput) -> Result<Self::Output, Self::Error> {
        if matches!(&input.event, WebSocketRelayEvent::Close(_)) {
            self.0.fetch_add(1, Ordering::AcqRel);
        }
        Ok(input.into())
    }
}

async fn relay_websocket<Ingress, Egress>(
    downstream_io: Ingress,
    upstream_io: Egress,
    close_handshake_timeout: std::time::Duration,
) -> bool
where
    Ingress: rama::io::Io + Unpin + rama::extensions::ExtensionsRef,
    Egress: rama::io::Io + Unpin + rama::extensions::ExtensionsRef,
{
    let close_events = Arc::new(AtomicUsize::new(0));
    let close_frames = Arc::new(AtomicU8::new(0));
    let relay_failed = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let downstream_io = WebSocketCloseFrameObserver::new(
        downstream_io,
        Arc::clone(&close_frames),
        Arc::clone(&relay_failed),
        DOWNSTREAM_CLOSE_FRAME,
        true,
    );
    let upstream_io = WebSocketCloseFrameObserver::new(
        upstream_io,
        Arc::clone(&close_frames),
        Arc::clone(&relay_failed),
        UPSTREAM_CLOSE_FRAME,
        false,
    );
    let relay = WebSocketRelayEventService::new(CloseTracker(Arc::clone(&close_events)))
        .with_close_handshake_timeout(close_handshake_timeout);
    if let Err(never) = relay.serve(BridgeIo(downstream_io, upstream_io)).await {
        match never {}
    }
    let clean = websocket_close_handshake_complete(
        close_events.load(Ordering::Acquire),
        close_frames.load(Ordering::Acquire),
    ) && !relay_failed.load(Ordering::Acquire);
    if !clean {
        tracing::warn!(
            close_events = close_events.load(Ordering::Relaxed),
            close_frames = close_frames.load(Ordering::Relaxed),
            io_failed = relay_failed.load(Ordering::Relaxed),
            "Rama WebSocket relay did not complete a clean close handshake"
        );
    }
    clean
}

fn request_is_for_authority(request: &Request<Body>, expected: &str) -> bool {
    let host_headers = request.headers().get_all("host");
    if host_headers.iter().count() != 1 {
        return false;
    }
    let Some(host) = host_headers
        .iter()
        .next()
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let expected_host = expected.split(':').next().unwrap_or_default();
    if !host.eq_ignore_ascii_case(expected) && !host.eq_ignore_ascii_case(expected_host) {
        return false;
    }
    request
        .uri()
        .authority()
        .is_none_or(|authority| authority.to_string().eq_ignore_ascii_case(expected))
}

fn metadata_from_request(request: &Request<Body>) -> ExactWireMetadata {
    ExactWireMetadata::from_components(
        request.version().to_string(),
        Some(request.method().as_str().to_string()),
        Some(request.uri().to_string()),
        None,
        None,
        request
            .headers()
            .iter()
            .map(|(name, value)| (name.as_str().to_string(), value.as_bytes().to_vec())),
    )
}

fn metadata_from_response(response: &Response) -> ExactWireMetadata {
    ExactWireMetadata::from_components(
        response.version().to_string(),
        None,
        None,
        Some(response.status().as_u16()),
        response.status().canonical_reason().map(str::to_string),
        response
            .headers()
            .iter()
            .map(|(name, value)| (name.as_str().to_string(), value.as_bytes().to_vec())),
    )
}

fn is_websocket_upgrade_attempt(request: &Request<Body>) -> bool {
    let upgrade_header_indicates_websocket =
        request.headers().get_all("upgrade").iter().any(|value| {
            value.to_str().ok().is_some_and(|value| {
                value
                    .split(',')
                    .any(|token| token.trim().eq_ignore_ascii_case("websocket"))
            })
        });
    upgrade_header_indicates_websocket
        || [
            "sec-websocket-key",
            "sec-websocket-version",
            "sec-websocket-protocol",
            "sec-websocket-extensions",
        ]
        .iter()
        .any(|header| request.headers().contains_key(*header))
}

fn rewrite_request_uri(request: &mut Request<Body>, authority: &str) -> bool {
    let mut path_and_query = request.uri().path_or_root().into_owned();
    if let Some(query) = request.uri().query() {
        path_and_query.push('?');
        path_and_query.push_str(&query.as_encoded_str());
    }
    let Ok(uri) = rama::net::uri::Uri::parse(format!("https://{authority}{path_and_query}")) else {
        return false;
    };
    *request.uri_mut() = uri;
    true
}

fn empty_response(status: StatusCode) -> Response {
    Response::builder()
        .status(status)
        .body(Body::empty())
        .expect("valid Rama experimental response")
}

#[cfg(test)]
mod tests {
    use super::*;
    use rcgen::{CertificateParams, IsCa, KeyPair};
    use std::{
        io,
        time::{SystemTime, UNIX_EPOCH},
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio_rustls::{
        rustls::{
            pki_types::{PrivateKeyDer, PrivatePkcs8KeyDer},
            RootCertStore,
        },
        TlsAcceptor, TlsConnector,
    };

    fn unique_temp_dir() -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("fusou_rama_capture_{timestamp}"))
    }

    fn assert_websocket_101_semantics(response_wire: &[u8]) {
        let text = std::str::from_utf8(response_wire).expect("101 response is ASCII");
        let mut lines = text.split("\r\n");
        assert_eq!(lines.next(), Some("HTTP/1.1 101 Switching Protocols"));
        let headers = lines
            .take_while(|line| !line.is_empty())
            .filter_map(|line| line.split_once(':'))
            .map(|(name, value)| (name.to_ascii_lowercase(), value.trim().to_ascii_lowercase()))
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(
            headers.get("upgrade").map(String::as_str),
            Some("websocket")
        );
        assert!(headers
            .get("connection")
            .is_some_and(|value| value.split(',').any(|token| token.trim() == "upgrade")));
        assert_eq!(
            headers.get("sec-websocket-accept").map(String::as_str),
            Some("s3pplmbitxaq9kygzzhzrbk+xoo=")
        );
    }

    #[derive(Clone, Copy)]
    enum AbnormalWebSocketCase {
        UpstreamHandshakeFailure,
        OneSidedClose,
        InvalidContinuation,
        ClientDisconnect,
        UpstreamDisconnect,
        ProxyShutdown,
        ProxyTaskAbort,
    }

    #[tokio::test]
    async fn rejects_invalid_websocket_handshakes_before_upstream_service() {
        let upstream_calls = Arc::new(AtomicUsize::new(0));
        let upstream_calls_by_service = Arc::clone(&upstream_calls);
        let upstream = service_fn(move |_request: Request<Body>| {
            upstream_calls_by_service.fetch_add(1, Ordering::SeqCst);
            async { Ok::<_, Infallible>(empty_response(StatusCode::BAD_GATEWAY)) }
        });
        let service = CaptureService {
            inner: Arc::new(upstream),
            authority: "localhost:443".to_owned(),
            connection_id: 1,
            capture_hook: RawCaptureHook::new(unique_temp_dir()),
            websocket_tasks: Arc::new(AsyncMutex::new(JoinSet::new())),
        };
        let valid_key = "dGhlIHNhbXBsZSBub25jZQ==";
        let requests = [
            Request::builder()
                .method("GET")
                .uri("/socket")
                .header("Host", "localhost")
                .header("Upgrade", "websocket")
                .header("Connection", "Upgrade")
                .header("Sec-WebSocket-Version", "13")
                .body(Body::empty())
                .expect("request without a WebSocket key"),
            Request::builder()
                .method("GET")
                .uri("/socket")
                .header("Host", "localhost")
                .header("Upgrade", "websocket")
                .header("Sec-WebSocket-Key", valid_key)
                .header("Sec-WebSocket-Version", "13")
                .body(Body::empty())
                .expect("request without Connection: Upgrade"),
            Request::builder()
                .method("GET")
                .uri("/socket")
                .header("Host", "localhost")
                .header("Upgrade", "websocket")
                .header("Connection", "Upgrade")
                .header("Sec-WebSocket-Key", valid_key)
                .header("Sec-WebSocket-Version", "12")
                .body(Body::empty())
                .expect("request with an unsupported WebSocket version"),
        ];

        for request in requests {
            let response = service
                .serve(request)
                .await
                .expect("invalid WebSocket request response");
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        }
        assert_eq!(
            upstream_calls.load(Ordering::SeqCst),
            0,
            "invalid WebSocket requests must be rejected before the upstream service"
        );
    }

    #[test]
    fn configured_authority_port_must_match_fixed_upstream_socket() {
        let identity = rcgen::generate_simple_self_signed(vec!["localhost".to_owned()])
            .expect("generate local trust root");
        let trust_root = CertificateDer::from(identity.cert.der().to_vec());
        let mismatched_address: SocketAddr = "127.0.0.1:8443".parse().expect("socket address");
        assert!(
            RamaExperimentalConfig::new(
                "localhost:443",
                mismatched_address,
                vec![trust_root.clone()]
            )
            .is_err(),
            "a port translation must not be implicit"
        );

        let matching_address: SocketAddr = "127.0.0.1:443".parse().expect("socket address");
        assert!(
            RamaExperimentalConfig::new("localhost:443", matching_address, vec![trust_root])
                .is_ok(),
            "the fixed socket with the authority port must be accepted"
        );
    }

    async fn read_http_message(
        stream: &mut (impl tokio::io::AsyncRead + Unpin),
    ) -> io::Result<Vec<u8>> {
        let mut message = Vec::new();
        let mut buffer = [0; 1024];
        let headers_end = loop {
            if let Some(position) = message.windows(4).position(|window| window == b"\r\n\r\n") {
                break position + 4;
            }
            let count = stream.read(&mut buffer).await?;
            if count == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "connection closed before HTTP headers completed",
                ));
            }
            message.extend_from_slice(&buffer[..count]);
        };
        let headers = String::from_utf8_lossy(&message[..headers_end]).to_ascii_lowercase();
        if headers.contains("transfer-encoding: chunked") {
            while !message.windows(7).any(|window| window == b"\r\n0\r\n\r\n") {
                let count = stream.read(&mut buffer).await?;
                if count == 0 {
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "connection closed during chunked HTTP body",
                    ));
                }
                message.extend_from_slice(&buffer[..count]);
            }
        } else if let Some(content_length) = headers.lines().find_map(|line| {
            line.strip_prefix("content-length:")
                .and_then(|value| value.trim().parse::<usize>().ok())
        }) {
            while message.len() < headers_end + content_length {
                let count = stream.read(&mut buffer).await?;
                if count == 0 {
                    return Err(io::Error::new(
                        io::ErrorKind::UnexpectedEof,
                        "connection closed during fixed-length HTTP body",
                    ));
                }
                message.extend_from_slice(&buffer[..count]);
            }
        }
        Ok(message)
    }

    async fn read_websocket_frame(
        stream: &mut (impl tokio::io::AsyncRead + Unpin),
    ) -> io::Result<(Vec<u8>, u8, Vec<u8>)> {
        let mut header = [0; 2];
        stream.read_exact(&mut header).await?;
        let payload_length = usize::from(header[1] & 0x7f);
        if payload_length >= 126 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "test WebSocket frame exceeds its supported payload size",
            ));
        }

        let masked = header[1] & 0x80 != 0;
        let mut raw = header.to_vec();
        let mask = if masked {
            let mut mask = [0; 4];
            stream.read_exact(&mut mask).await?;
            raw.extend_from_slice(&mask);
            Some(mask)
        } else {
            None
        };
        let mut payload = vec![0; payload_length];
        stream.read_exact(&mut payload).await?;
        raw.extend_from_slice(&payload);
        if let Some(mask) = mask {
            for (index, byte) in payload.iter_mut().enumerate() {
                *byte ^= mask[index % mask.len()];
            }
        }
        Ok((raw, header[0] & 0x0f, payload))
    }

    fn masked_websocket_frame(opcode: u8, payload: &[u8], mask: [u8; 4]) -> Vec<u8> {
        assert!(payload.len() < 126, "test WebSocket payload must be short");
        let mut frame = vec![0x80 | opcode, 0x80 | payload.len() as u8];
        frame.extend_from_slice(&mask);
        frame.extend(
            payload
                .iter()
                .enumerate()
                .map(|(index, byte)| byte ^ mask[index % mask.len()]),
        );
        frame
    }

    struct BrokenIo;

    impl AsyncRead for BrokenIo {
        fn poll_read(
            self: Pin<&mut Self>,
            _context: &mut Context<'_>,
            _buffer: &mut ReadBuf<'_>,
        ) -> Poll<io::Result<()>> {
            Poll::Ready(Err(io::Error::new(
                io::ErrorKind::ConnectionReset,
                "injected WebSocket relay read failure",
            )))
        }
    }

    impl AsyncWrite for BrokenIo {
        fn poll_write(
            self: Pin<&mut Self>,
            _context: &mut Context<'_>,
            _bytes: &[u8],
        ) -> Poll<io::Result<usize>> {
            Poll::Ready(Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "injected WebSocket relay write failure",
            )))
        }

        fn poll_flush(self: Pin<&mut Self>, _context: &mut Context<'_>) -> Poll<io::Result<()>> {
            Poll::Ready(Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "injected WebSocket relay flush failure",
            )))
        }

        fn poll_shutdown(self: Pin<&mut Self>, _context: &mut Context<'_>) -> Poll<io::Result<()>> {
            Poll::Ready(Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "injected WebSocket relay shutdown failure",
            )))
        }
    }

    async fn finish_unclean_relay_without_handshake(
        hook: &RawCaptureHook,
        connection_id: u64,
        output_root: &std::path::Path,
        clean: bool,
    ) {
        assert!(!clean, "abnormal WebSocket session must not be clean");
        hook.finish_connection(connection_id, clean).await;
        assert!(
            !output_root.exists()
                || std::fs::read_dir(output_root)
                    .expect("capture output root")
                    .next()
                    .is_none(),
            "unclean relay without a completed HTTP handshake must not persist an artifact"
        );
    }

    #[tokio::test]
    async fn unclean_relay_without_completed_http_handshake_has_no_http_artifact() {
        let output_root = unique_temp_dir();
        let hook = RawCaptureHook::new(output_root.clone());
        let recorder = hook.start_session(71).expect("start capture session");
        let (mut client, downstream) = tokio::io::duplex(4096);
        let (upstream, mut server) = tokio::io::duplex(4096);
        let downstream = ServiceInput::new(CaptureIo::new(downstream, recorder.clone()));
        let upstream = ServiceInput::new(upstream);
        let relay_task = tokio::spawn(relay_websocket(
            downstream,
            upstream,
            std::time::Duration::from_millis(100),
        ));

        let close_frame = masked_websocket_frame(8, &[0x03, 0xe8], [1, 2, 3, 4]);
        client
            .write_all(&close_frame)
            .await
            .expect("write one-sided close frame");
        let (_, opcode, payload) = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            read_websocket_frame(&mut server),
        )
        .await
        .expect("upstream close frame timeout")
        .expect("read forwarded close frame");
        assert_eq!(opcode, 8);
        assert_eq!(payload, [0x03, 0xe8]);
        let clean = tokio::time::timeout(std::time::Duration::from_secs(1), relay_task)
            .await
            .expect("close-handshake deadline did not terminate relay")
            .expect("join one-sided close relay");
        assert_eq!(
            recorder
                .snapshot()
                .expect("capture snapshot")
                .request_bytes(),
            close_frame
        );
        finish_unclean_relay_without_handshake(&hook, 71, &output_root, clean).await;
        drop(client);
        drop(server);

        let output_root = unique_temp_dir();
        let hook = RawCaptureHook::new(output_root.clone());
        hook.start_session(72).expect("start capture session");
        let (client, downstream) = tokio::io::duplex(4096);
        let (upstream, _server) = tokio::io::duplex(4096);
        let relay_task = tokio::spawn(relay_websocket(
            ServiceInput::new(downstream),
            ServiceInput::new(upstream),
            std::time::Duration::from_millis(100),
        ));
        drop(client);
        let clean = tokio::time::timeout(std::time::Duration::from_secs(1), relay_task)
            .await
            .expect("disconnect did not terminate WebSocket relay")
            .expect("join disconnected relay");
        finish_unclean_relay_without_handshake(&hook, 72, &output_root, clean).await;

        let output_root = unique_temp_dir();
        let hook = RawCaptureHook::new(output_root.clone());
        hook.start_session(73).expect("start capture session");
        let (upstream, _server) = tokio::io::duplex(4096);
        let relay_task = tokio::spawn(relay_websocket(
            ServiceInput::new(BrokenIo),
            ServiceInput::new(upstream),
            std::time::Duration::from_millis(100),
        ));
        let clean = tokio::time::timeout(std::time::Duration::from_secs(1), relay_task)
            .await
            .expect("I/O error did not terminate WebSocket relay")
            .expect("join failed-I/O relay");
        finish_unclean_relay_without_handshake(&hook, 73, &output_root, clean).await;
    }

    async fn assert_upstream_tls_rejected(
        server_names: Vec<String>,
        trust_roots: Vec<CertificateDer<'static>>,
    ) {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let output_root = unique_temp_dir();
        let upstream_identity =
            rcgen::generate_simple_self_signed(server_names).expect("generate upstream identity");
        let upstream_certificate = CertificateDer::from(upstream_identity.cert.der().to_vec());
        let upstream_key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
            upstream_identity.key_pair.serialize_der(),
        ));
        let upstream_server_config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![upstream_certificate], upstream_key)
            .expect("build local upstream TLS config");
        let upstream_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind local upstream");
        let upstream_address = upstream_listener.local_addr().expect("upstream address");
        let upstream_acceptor = TlsAcceptor::from(Arc::new(upstream_server_config));
        let upstream_task = tokio::spawn(async move {
            let (socket, _) = upstream_listener.accept().await.expect("upstream accept");
            upstream_acceptor.accept(socket).await.is_ok()
        });

        let proxy_key = KeyPair::generate().expect("generate proxy CA key");
        let mut proxy_ca_params = CertificateParams::default();
        proxy_ca_params.is_ca = IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        let proxy_ca_certificate = proxy_ca_params
            .self_signed(&proxy_key)
            .expect("self-sign proxy CA");
        let proxy_ca_der = CertificateDer::from(proxy_ca_certificate.der().to_vec());
        let proxy_ca = hudsucker::certificate_authority::RcgenAuthority::new(
            proxy_key,
            proxy_ca_certificate,
            100,
            rustls::crypto::ring::default_provider(),
        );
        let authority = format!("localhost:{}", upstream_address.port());
        let config = RamaExperimentalConfig::new(authority.clone(), upstream_address, trust_roots)
            .expect("build fail-closed Rama proxy config");
        let proxy_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind Rama proxy");
        let proxy_address = proxy_listener.local_addr().expect("Rama proxy address");
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
        let proxy_task = tokio::spawn(serve(
            proxy_listener,
            config,
            Arc::new(proxy_ca),
            output_root.clone(),
            async move {
                let _ = shutdown_rx.await;
            },
        ));

        let mut client_socket = TcpStream::connect(proxy_address)
            .await
            .expect("connect to Rama proxy");
        let connect_request = format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n\r\n");
        client_socket
            .write_all(connect_request.as_bytes())
            .await
            .expect("write CONNECT request");
        let mut connect_response = Vec::new();
        let mut buffer = [0; 1024];
        while !connect_response
            .windows(4)
            .any(|window| window == b"\r\n\r\n")
        {
            let count = client_socket
                .read(&mut buffer)
                .await
                .expect("read CONNECT response");
            assert!(count > 0, "proxy closed before CONNECT response");
            connect_response.extend_from_slice(&buffer[..count]);
        }
        assert!(connect_response.starts_with(b"HTTP/1.1 200"));

        let mut proxy_roots = RootCertStore::empty();
        proxy_roots.add(proxy_ca_der).expect("trust test proxy CA");
        let downstream_tls_config = rustls::ClientConfig::builder()
            .with_root_certificates(proxy_roots)
            .with_no_client_auth();
        let mut downstream_tls = TlsConnector::from(Arc::new(downstream_tls_config))
            .connect(
                ServerName::try_from("localhost".to_owned()).expect("valid downstream name"),
                client_socket,
            )
            .await
            .expect("downstream TLS is accepted before upstream TLS is attempted");
        let failure_response = read_http_message(&mut downstream_tls)
            .await
            .expect("read tunneled upstream failure response");
        assert!(failure_response.starts_with(b"HTTP/1.1 502 Bad Gateway"));
        drop(downstream_tls);
        assert!(
            !output_root.exists(),
            "upstream TLS rejection must not produce a capture"
        );
        assert!(
            !tokio::time::timeout(std::time::Duration::from_secs(2), upstream_task)
                .await
                .expect("upstream TLS fixture timeout")
                .expect("upstream TLS fixture panicked"),
            "upstream TLS unexpectedly completed"
        );
        shutdown_tx.send(()).expect("stop Rama proxy");
        proxy_task
            .await
            .expect("join Rama proxy task")
            .expect("Rama proxy server");
        let _ = std::fs::remove_dir_all(output_root);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn rejects_untrusted_and_hostname_mismatched_upstream_tls() {
        let untrusted_identity =
            rcgen::generate_simple_self_signed(vec!["untrusted.local".to_owned()])
                .expect("generate unrelated trust root");
        let untrusted_root = CertificateDer::from(untrusted_identity.cert.der().to_vec());
        assert_upstream_tls_rejected(vec!["localhost".to_owned()], vec![untrusted_root]).await;

        let mismatched_identity =
            rcgen::generate_simple_self_signed(vec!["wrong.local".to_owned()])
                .expect("generate wrong-host upstream identity");
        let mismatched_root = CertificateDer::from(mismatched_identity.cert.der().to_vec());
        assert_upstream_tls_rejected(vec!["wrong.local".to_owned()], vec![mismatched_root]).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn rejects_downstream_sni_that_disagrees_with_connect_authority() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let output_root = unique_temp_dir();
        let upstream_identity = rcgen::generate_simple_self_signed(vec!["localhost".to_owned()])
            .expect("generate upstream identity");
        let upstream_certificate = CertificateDer::from(upstream_identity.cert.der().to_vec());
        let upstream_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind local upstream");
        let upstream_address = upstream_listener.local_addr().expect("upstream address");

        let proxy_key = KeyPair::generate().expect("generate proxy CA key");
        let mut proxy_ca_params = CertificateParams::default();
        proxy_ca_params.is_ca = IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        let proxy_ca_certificate = proxy_ca_params
            .self_signed(&proxy_key)
            .expect("self-sign proxy CA");
        let proxy_ca_der = CertificateDer::from(proxy_ca_certificate.der().to_vec());
        let proxy_ca = hudsucker::certificate_authority::RcgenAuthority::new(
            proxy_key,
            proxy_ca_certificate,
            100,
            rustls::crypto::ring::default_provider(),
        );
        let authority = format!("localhost:{}", upstream_address.port());
        let config = RamaExperimentalConfig::new(
            authority.clone(),
            upstream_address,
            vec![upstream_certificate],
        )
        .expect("build fail-closed Rama proxy config");
        let proxy_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind Rama proxy");
        let proxy_address = proxy_listener.local_addr().expect("Rama proxy address");
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
        let proxy_task = tokio::spawn(serve(
            proxy_listener,
            config,
            Arc::new(proxy_ca),
            output_root.clone(),
            async move {
                let _ = shutdown_rx.await;
            },
        ));

        let mut client_socket = TcpStream::connect(proxy_address)
            .await
            .expect("connect to Rama proxy");
        let connect_request = format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n\r\n");
        client_socket
            .write_all(connect_request.as_bytes())
            .await
            .expect("write CONNECT request");
        let mut connect_response = Vec::new();
        let mut buffer = [0; 1024];
        while !connect_response
            .windows(4)
            .any(|window| window == b"\r\n\r\n")
        {
            let count = client_socket
                .read(&mut buffer)
                .await
                .expect("read CONNECT response");
            assert!(count > 0, "proxy closed before CONNECT response");
            connect_response.extend_from_slice(&buffer[..count]);
        }
        assert!(connect_response.starts_with(b"HTTP/1.1 200"));

        let mut proxy_roots = RootCertStore::empty();
        proxy_roots.add(proxy_ca_der).expect("trust test proxy CA");
        let client_tls_config = rustls::ClientConfig::builder()
            .with_root_certificates(proxy_roots)
            .with_no_client_auth();
        let client_tls = TlsConnector::from(Arc::new(client_tls_config));
        let wrong_server_name =
            ServerName::try_from("wrong.local".to_owned()).expect("valid mismatched SNI");
        assert!(
            client_tls
                .connect(wrong_server_name, client_socket)
                .await
                .is_err(),
            "proxy accepted SNI that differs from CONNECT authority"
        );
        assert!(
            !output_root.exists(),
            "SNI rejection must not produce a capture"
        );
        assert!(
            tokio::time::timeout(
                std::time::Duration::from_millis(100),
                upstream_listener.accept()
            )
            .await
            .is_err(),
            "upstream TCP accept must not occur before downstream SNI validation"
        );
        shutdown_tx.send(()).expect("stop Rama proxy");
        proxy_task
            .await
            .expect("join Rama proxy task")
            .expect("Rama proxy server");
        let _ = std::fs::remove_dir_all(output_root);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn continues_after_invalid_clients_and_keeps_parallel_captures_isolated() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let output_root = unique_temp_dir();
        let upstream_identity = rcgen::generate_simple_self_signed(vec!["localhost".to_owned()])
            .expect("generate upstream identity");
        let upstream_certificate = CertificateDer::from(upstream_identity.cert.der().to_vec());
        let upstream_key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
            upstream_identity.key_pair.serialize_der(),
        ));
        let upstream_server_config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![upstream_certificate.clone()], upstream_key)
            .expect("build local upstream TLS config");
        let upstream_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind local upstream");
        let upstream_address = upstream_listener.local_addr().expect("upstream address");
        let upstream_acceptor = TlsAcceptor::from(Arc::new(upstream_server_config));
        let upstream_task = tokio::spawn(async move {
            let mut tasks = Vec::new();
            for _ in 0..2 {
                let (socket, _) = upstream_listener
                    .accept()
                    .await
                    .expect("accept upstream connection");
                let acceptor = upstream_acceptor.clone();
                tasks.push(tokio::spawn(async move {
                    let mut stream = acceptor
                        .accept(socket)
                        .await
                        .expect("upstream TLS accept");
                    let request = read_http_message(&mut stream)
                        .await
                        .expect("read parallel request");
                    let (connection, response_body) =
                        if request.windows(b"connection=one".len()).any(|window| {
                            window == b"connection=one"
                        }) {
                            ("one", "from-one")
                        } else {
                            assert!(
                                request
                                    .windows(b"connection=two".len())
                                    .any(|window| window == b"connection=two")
                            );
                            ("two", "from-two")
                        };
                    assert!(request.starts_with(b"GET /kcsapi/api_get_member/require_info"));
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response_body}",
                        response_body.len()
                    );
                    stream
                        .write_all(response.as_bytes())
                        .await
                        .expect("write parallel response");
                    stream.shutdown().await.expect("close upstream TLS");
                    connection
                }));
            }
            for task in tasks {
                task.await.expect("join upstream connection task");
            }
        });

        let proxy_key = KeyPair::generate().expect("generate proxy CA key");
        let mut proxy_ca_params = CertificateParams::default();
        proxy_ca_params.is_ca = IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        let proxy_ca_certificate = proxy_ca_params
            .self_signed(&proxy_key)
            .expect("self-sign proxy CA");
        let proxy_ca_der = CertificateDer::from(proxy_ca_certificate.der().to_vec());
        let proxy_ca = hudsucker::certificate_authority::RcgenAuthority::new(
            proxy_key,
            proxy_ca_certificate,
            100,
            rustls::crypto::ring::default_provider(),
        );
        let authority = format!("localhost:{}", upstream_address.port());
        let config = RamaExperimentalConfig::new(
            authority.clone(),
            upstream_address,
            vec![upstream_certificate],
        )
        .expect("build fail-closed Rama proxy config");
        let proxy_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind Rama proxy");
        let proxy_address = proxy_listener.local_addr().expect("Rama proxy address");
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
        let proxy_task = tokio::spawn(serve(
            proxy_listener,
            config,
            Arc::new(proxy_ca),
            output_root.clone(),
            async move {
                let _ = shutdown_rx.await;
            },
        ));

        let mut unauthorized_socket = TcpStream::connect(proxy_address)
            .await
            .expect("connect for mismatched CONNECT authority");
        let unauthorized_authority = "localhost:1";
        let unauthorized_request = format!(
            "CONNECT {unauthorized_authority} HTTP/1.1\r\nHost: {unauthorized_authority}\r\n\r\n"
        );
        unauthorized_socket
            .write_all(unauthorized_request.as_bytes())
            .await
            .expect("write mismatched CONNECT request");
        let unauthorized_response = read_http_message(&mut unauthorized_socket)
            .await
            .expect("read mismatched CONNECT response");
        assert!(
            unauthorized_response.starts_with(b"HTTP/1.1 403"),
            "mismatched CONNECT authority was not rejected: {unauthorized_response:?}"
        );
        drop(unauthorized_socket);

        let mut malformed_socket = TcpStream::connect(proxy_address)
            .await
            .expect("connect for malformed HTTP request");
        malformed_socket
            .write_all(b"NOT HTTP\r\n\r\n")
            .await
            .expect("write malformed HTTP request");
        let malformed_response = read_http_message(&mut malformed_socket)
            .await
            .expect("read malformed HTTP response");
        assert!(
            malformed_response.starts_with(b"HTTP/1.1 400"),
            "malformed client request did not receive HTTP 400: {malformed_response:?}"
        );
        drop(malformed_socket);

        async fn request_through_proxy(
            proxy_address: SocketAddr,
            authority: String,
            proxy_ca_der: CertificateDer<'static>,
            barrier: Arc<tokio::sync::Barrier>,
            connection: &'static str,
        ) -> (Vec<u8>, Vec<u8>) {
            let mut socket = TcpStream::connect(proxy_address)
                .await
                .expect("connect to Rama proxy");
            let connect_request =
                format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n\r\n");
            socket
                .write_all(connect_request.as_bytes())
                .await
                .expect("write CONNECT request");
            let mut connect_response = Vec::new();
            let mut buffer = [0; 1024];
            while !connect_response
                .windows(4)
                .any(|window| window == b"\r\n\r\n")
            {
                let count = socket
                    .read(&mut buffer)
                    .await
                    .expect("read CONNECT response");
                assert!(count > 0, "proxy closed before CONNECT response");
                connect_response.extend_from_slice(&buffer[..count]);
            }
            assert!(connect_response.starts_with(b"HTTP/1.1 200"));

            let mut roots = RootCertStore::empty();
            roots.add(proxy_ca_der).expect("trust test proxy CA");
            let client_tls_config = rustls::ClientConfig::builder()
                .with_root_certificates(roots)
                .with_no_client_auth();
            let client_tls = TlsConnector::from(Arc::new(client_tls_config));
            let server_name =
                ServerName::try_from("localhost".to_owned()).expect("valid downstream SNI");
            let mut stream = client_tls
                .connect(server_name, socket)
                .await
                .expect("downstream TLS handshake");
            barrier.wait().await;
            let request = format!(
                "GET /kcsapi/api_get_member/require_info?connection={connection} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
            )
            .into_bytes();
            stream
                .write_all(&request)
                .await
                .expect("write parallel request");
            let response = read_http_message(&mut stream)
                .await
                .expect("read parallel response");
            drop(stream);
            (request, response)
        }

        let barrier = Arc::new(tokio::sync::Barrier::new(2));
        let (one, two) = tokio::join!(
            request_through_proxy(
                proxy_address,
                authority.clone(),
                proxy_ca_der.clone(),
                Arc::clone(&barrier),
                "one",
            ),
            request_through_proxy(proxy_address, authority, proxy_ca_der, barrier, "two",)
        );
        upstream_task.await.expect("join upstream server");

        let capture_dirs = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let captures = std::fs::read_dir(&output_root)
                    .ok()
                    .into_iter()
                    .flatten()
                    .flatten()
                    .map(|entry| (entry.file_name(), entry.path()))
                    .filter_map(|(name, path)| {
                        (!name.to_string_lossy().starts_with('.')
                            && path.join("manifest.json").exists())
                        .then_some(path)
                    })
                    .collect::<Vec<_>>();
                if captures.len() == 2 {
                    break captures;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("parallel capture finalization timeout");

        let mut saw_one = false;
        let mut saw_two = false;
        for capture_dir in capture_dirs {
            crate::capture::verify_capture(&capture_dir).expect("verify parallel capture");
            let request_wire =
                std::fs::read(capture_dir.join("request-wire.bin")).expect("request wire");
            let response_wire =
                std::fs::read(capture_dir.join("response-wire.bin")).expect("response wire");
            if request_wire == one.0 {
                assert!(response_wire == one.1);
                saw_one = true;
            } else {
                assert_eq!(request_wire, two.0);
                assert_eq!(response_wire, two.1);
                saw_two = true;
            }
        }
        assert!(saw_one && saw_two, "parallel capture sessions were mixed");

        shutdown_tx.send(()).expect("stop Rama proxy");
        proxy_task
            .await
            .expect("join Rama proxy task")
            .expect("Rama proxy server");
        let _ = std::fs::remove_dir_all(output_root);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn captures_websocket_handshake_and_upgrade_stream_until_clean_close() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let output_root = unique_temp_dir();
        let upstream_identity = rcgen::generate_simple_self_signed(vec!["localhost".to_owned()])
            .expect("generate upstream identity");
        let upstream_certificate = CertificateDer::from(upstream_identity.cert.der().to_vec());
        let upstream_key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
            upstream_identity.key_pair.serialize_der(),
        ));
        let upstream_server_config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![upstream_certificate.clone()], upstream_key)
            .expect("build local upstream TLS config");
        let upstream_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind local upstream");
        let upstream_address = upstream_listener.local_addr().expect("upstream address");
        let upstream_acceptor = TlsAcceptor::from(Arc::new(upstream_server_config));
        let upstream_task = tokio::spawn(async move {
            let (socket, _) = upstream_listener.accept().await.expect("upstream accept");
            let mut stream = upstream_acceptor
                .accept(socket)
                .await
                .expect("upstream TLS accept");
            let handshake = read_http_message(&mut stream)
                .await
                .expect("read upstream WebSocket handshake");
            assert!(handshake.starts_with(b"GET /kcsapi/api_get_member/require_info HTTP/1.1"));
            let handshake_text = String::from_utf8_lossy(&handshake);
            let websocket_key = handshake_text.lines().find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("sec-websocket-key")
                    .then_some(value.trim())
            });
            assert_eq!(websocket_key, Some("dGhlIHNhbXBsZSBub25jZQ=="));
            stream
                .write_all(
                    b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n",
                )
                .await
                .expect("write upstream WebSocket response");

            let (_, opcode, payload) = read_websocket_frame(&mut stream)
                .await
                .expect("read upstream text frame");
            assert_eq!(opcode, 1);
            assert_eq!(payload, b"hi");
            stream
                .write_all(&[0x81, 0x02, b'o', b'k'])
                .await
                .expect("write upstream text frame");

            let (_, opcode, payload) = read_websocket_frame(&mut stream)
                .await
                .expect("read upstream close frame");
            assert_eq!(opcode, 8);
            assert_eq!(payload, [0x03, 0xe8]);
            stream
                .write_all(&[0x88, 0x02, 0x03, 0xe8])
                .await
                .expect("write upstream close response");
            stream.shutdown().await.expect("close upstream TLS");
        });

        let proxy_key = KeyPair::generate().expect("generate proxy CA key");
        let mut proxy_ca_params = CertificateParams::default();
        proxy_ca_params.is_ca = IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        let proxy_ca_certificate = proxy_ca_params
            .self_signed(&proxy_key)
            .expect("self-sign proxy CA");
        let proxy_ca_der = CertificateDer::from(proxy_ca_certificate.der().to_vec());
        let proxy_ca = hudsucker::certificate_authority::RcgenAuthority::new(
            proxy_key,
            proxy_ca_certificate,
            100,
            rustls::crypto::ring::default_provider(),
        );
        let authority = format!("localhost:{}", upstream_address.port());
        let config = RamaExperimentalConfig::new(
            authority.clone(),
            upstream_address,
            vec![upstream_certificate],
        )
        .expect("build fail-closed Rama proxy config");
        let proxy_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind Rama proxy");
        let proxy_address = proxy_listener.local_addr().expect("Rama proxy address");
        let capture_hook = RawCaptureHook::new(output_root.clone());
        let inspected_hook = capture_hook.clone();
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
        let proxy_task = tokio::spawn(serve_with_capture_hook(
            proxy_listener,
            config,
            Arc::new(proxy_ca),
            capture_hook,
            async move {
                let _ = shutdown_rx.await;
            },
        ));

        let mut client_socket = TcpStream::connect(proxy_address)
            .await
            .expect("connect to Rama proxy");
        let connect_request = format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n\r\n");
        client_socket
            .write_all(connect_request.as_bytes())
            .await
            .expect("write CONNECT request");
        let mut connect_response = Vec::new();
        let mut buffer = [0; 1024];
        while !connect_response
            .windows(4)
            .any(|window| window == b"\r\n\r\n")
        {
            let count = client_socket
                .read(&mut buffer)
                .await
                .expect("read CONNECT response");
            assert!(count > 0, "proxy closed before CONNECT response");
            connect_response.extend_from_slice(&buffer[..count]);
        }
        assert!(connect_response.starts_with(b"HTTP/1.1 200"));

        let mut proxy_roots = RootCertStore::empty();
        proxy_roots.add(proxy_ca_der).expect("trust test proxy CA");
        let client_tls_config = rustls::ClientConfig::builder()
            .with_root_certificates(proxy_roots)
            .with_no_client_auth();
        let client_tls = TlsConnector::from(Arc::new(client_tls_config));
        let server_name = ServerName::try_from("localhost".to_owned()).expect("valid SNI");
        let mut client_tls_stream = client_tls
            .connect(server_name, client_socket)
            .await
            .expect("downstream TLS handshake");

        let request_handshake = b"GET /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n";
        client_tls_stream
            .write_all(request_handshake)
            .await
            .expect("write downstream WebSocket handshake");
        let response_handshake = read_http_message(&mut client_tls_stream)
            .await
            .expect("read downstream WebSocket response");
        assert!(response_handshake.starts_with(b"HTTP/1.1 101"));
        assert_websocket_101_semantics(&response_handshake);
        let capture_dir = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                if let Ok(entries) = std::fs::read_dir(&output_root) {
                    if let Some(path) = entries
                        .flatten()
                        .filter_map(|entry| {
                            let is_staging = entry.file_name().to_string_lossy().starts_with('.');
                            (!is_staging).then_some(entry.path())
                        })
                        .find(|path| {
                            path.join("manifest.json").exists()
                                && path.join("request-wire.bin").exists()
                                && path.join("response-wire.bin").exists()
                        })
                    {
                        break path;
                    }
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("Rama Upgrade artifact was not finalized before frame relay");
        assert!(
            inspected_hook.session(1).is_none(),
            "completed Upgrade must release its capture session before relay ends"
        );

        let text_frame = masked_websocket_frame(1, b"hi", [0x11, 0x22, 0x33, 0x44]);
        client_tls_stream
            .write_all(&text_frame)
            .await
            .expect("write downstream text frame");
        let (response_text_frame, opcode, payload) = read_websocket_frame(&mut client_tls_stream)
            .await
            .expect("read downstream text frame");
        assert_eq!(opcode, 1);
        assert_eq!(payload, b"ok");
        assert_eq!(response_text_frame, [0x81, 0x02, b'o', b'k']);

        tokio::time::sleep(std::time::Duration::from_millis(5_100)).await;

        let close_frame = masked_websocket_frame(8, &[0x03, 0xe8], [0x55, 0x66, 0x77, 0x88]);
        client_tls_stream
            .write_all(&close_frame)
            .await
            .expect("write downstream close frame");
        let (response_close_frame, opcode, payload) = read_websocket_frame(&mut client_tls_stream)
            .await
            .expect("read downstream close response");
        assert_eq!(opcode, 8);
        assert_eq!(payload, [0x03, 0xe8]);
        assert_eq!(response_close_frame, [0x88, 0x02, 0x03, 0xe8]);
        client_tls_stream
            .shutdown()
            .await
            .expect("close downstream TLS");
        drop(client_tls_stream);

        tokio::time::timeout(std::time::Duration::from_secs(3), upstream_task)
            .await
            .expect("upstream WebSocket timeout")
            .expect("upstream WebSocket task panicked");
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while !inspected_hook
                .websocket_outcomes
                .lock()
                .expect("WebSocket outcomes")
                .iter()
                .any(|(connection_id, clean)| *connection_id == 1 && *clean)
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("Rama clean Close lifecycle was not reported");

        let expected_request_wire = request_handshake.to_vec();
        let expected_response_wire = response_handshake.to_vec();
        crate::capture::verify_capture(&capture_dir).expect("verify WebSocket raw transcript");
        assert_eq!(
            std::fs::read(capture_dir.join("request-wire.bin")).expect("request wire"),
            expected_request_wire
        );
        assert_eq!(
            std::fs::read(capture_dir.join("response-wire.bin")).expect("response wire"),
            expected_response_wire
        );
        let manifest: serde_json::Value = serde_json::from_slice(
            &std::fs::read(capture_dir.join("manifest.json")).expect("capture manifest"),
        )
        .expect("parse capture manifest");
        let messages = manifest["messages"].as_array().expect("message list");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["direction"].as_str(), Some("request"));
        assert_eq!(messages[0]["stream_start"].as_u64(), Some(0));
        assert_eq!(
            messages[0]["stream_end"].as_u64(),
            Some(request_handshake.len() as u64)
        );
        assert_eq!(messages[1]["direction"].as_str(), Some("response"));
        assert_eq!(messages[1]["stream_start"].as_u64(), Some(0));
        assert_eq!(
            messages[1]["stream_end"].as_u64(),
            Some(response_handshake.len() as u64)
        );
        shutdown_tx.send(()).expect("stop Rama proxy");
        proxy_task
            .await
            .expect("join Rama proxy task")
            .expect("Rama proxy server");
        let _ = std::fs::remove_dir_all(output_root);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn abnormal_websocket_close_through_connect_persists_handshake_capture() {
        run_abnormal_websocket_capture(AbnormalWebSocketCase::OneSidedClose).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn invalid_continuation_through_connect_persists_handshake_capture() {
        run_abnormal_websocket_capture(AbnormalWebSocketCase::InvalidContinuation).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn client_disconnect_through_connect_persists_handshake_capture() {
        run_abnormal_websocket_capture(AbnormalWebSocketCase::ClientDisconnect).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn upstream_disconnect_through_connect_persists_handshake_capture() {
        run_abnormal_websocket_capture(AbnormalWebSocketCase::UpstreamDisconnect).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn shutdown_aborts_open_websocket_and_keeps_handshake_capture() {
        run_abnormal_websocket_capture(AbnormalWebSocketCase::ProxyShutdown).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn outer_task_abort_closes_websocket_and_reports_unclean() {
        run_abnormal_websocket_capture(AbnormalWebSocketCase::ProxyTaskAbort).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn upstream_websocket_handshake_failure_returns_502_without_capture() {
        run_abnormal_websocket_capture(AbnormalWebSocketCase::UpstreamHandshakeFailure).await;
    }

    async fn run_abnormal_websocket_capture(case: AbnormalWebSocketCase) {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let output_root = unique_temp_dir();
        let upstream_identity = rcgen::generate_simple_self_signed(vec!["localhost".to_owned()])
            .expect("generate upstream identity");
        let upstream_certificate = CertificateDer::from(upstream_identity.cert.der().to_vec());
        let upstream_key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
            upstream_identity.key_pair.serialize_der(),
        ));
        let upstream_server_config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![upstream_certificate.clone()], upstream_key)
            .expect("build local upstream TLS config");
        let upstream_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind local upstream");
        let upstream_address = upstream_listener.local_addr().expect("upstream address");
        let upstream_acceptor = TlsAcceptor::from(Arc::new(upstream_server_config));
        let upstream_task = tokio::spawn(async move {
            let (socket, _) = upstream_listener.accept().await.expect("upstream accept");
            let mut stream = upstream_acceptor
                .accept(socket)
                .await
                .expect("upstream TLS accept");
            let request = read_http_message(&mut stream)
                .await
                .expect("read upstream WebSocket handshake");
            assert!(request.starts_with(b"GET /kcsapi/api_get_member/require_info HTTP/1.1"));
            if matches!(case, AbnormalWebSocketCase::UpstreamHandshakeFailure) {
                stream
                    .write_all(
                        b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    )
                    .await
                    .expect("write rejected upstream WebSocket response");
                return;
            }
            stream
                .write_all(
                    b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n",
                )
                .await
                .expect("write upstream WebSocket response");
            match case {
                AbnormalWebSocketCase::UpstreamHandshakeFailure => {
                    unreachable!("upstream handshake failure returned before relay")
                }
                AbnormalWebSocketCase::OneSidedClose => {
                    let (_, opcode, payload) = read_websocket_frame(&mut stream)
                        .await
                        .expect("read forwarded client Close frame");
                    assert_eq!(opcode, 8);
                    assert_eq!(payload, [0x03, 0xe8]);
                }
                AbnormalWebSocketCase::InvalidContinuation => {
                    let mut forwarded_frame = [0; 16];
                    match tokio::time::timeout(
                        std::time::Duration::from_secs(3),
                        stream.read(&mut forwarded_frame),
                    )
                    .await
                    .expect("upstream did not close after invalid continuation")
                    {
                        Ok(0) | Err(_) => {}
                        Ok(count) => panic!(
                            "invalid continuation frame was forwarded upstream: {:?}",
                            &forwarded_frame[..count]
                        ),
                    }
                }
                AbnormalWebSocketCase::ClientDisconnect => {
                    let mut forwarded_frame = [0; 16];
                    match tokio::time::timeout(
                        std::time::Duration::from_secs(3),
                        stream.read(&mut forwarded_frame),
                    )
                    .await
                    .expect("client disconnect was not propagated upstream")
                    {
                        Ok(0) | Err(_) => {}
                        Ok(count) => panic!(
                            "unexpected WebSocket bytes after client disconnect: {:?}",
                            &forwarded_frame[..count]
                        ),
                    }
                }
                AbnormalWebSocketCase::UpstreamDisconnect => {
                    stream
                        .write_all(&[0x81, 0x02, b'o'])
                        .await
                        .expect("write partial upstream WebSocket frame");
                    stream
                        .shutdown()
                        .await
                        .expect("close upstream after partial WebSocket frame");
                }
                AbnormalWebSocketCase::ProxyShutdown | AbnormalWebSocketCase::ProxyTaskAbort => {
                    let mut forwarded_frame = [0; 16];
                    match tokio::time::timeout(
                        std::time::Duration::from_secs(3),
                        stream.read(&mut forwarded_frame),
                    )
                    .await
                    .expect("proxy cancellation did not close upstream WebSocket")
                    {
                        Ok(0) | Err(_) => {}
                        Ok(count) => panic!(
                            "unexpected WebSocket bytes during proxy cancellation: {:?}",
                            &forwarded_frame[..count]
                        ),
                    }
                }
            }
        });

        let proxy_key = KeyPair::generate().expect("generate proxy CA key");
        let mut proxy_ca_params = CertificateParams::default();
        proxy_ca_params.is_ca = IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        let proxy_ca_certificate = proxy_ca_params
            .self_signed(&proxy_key)
            .expect("self-sign proxy CA");
        let proxy_ca_der = CertificateDer::from(proxy_ca_certificate.der().to_vec());
        let proxy_ca = hudsucker::certificate_authority::RcgenAuthority::new(
            proxy_key,
            proxy_ca_certificate,
            100,
            rustls::crypto::ring::default_provider(),
        );
        let authority = format!("localhost:{}", upstream_address.port());
        let config = RamaExperimentalConfig::new(
            authority.clone(),
            upstream_address,
            vec![upstream_certificate],
        )
        .expect("build fail-closed Rama proxy config");
        let proxy_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind Rama proxy");
        let proxy_address = proxy_listener.local_addr().expect("Rama proxy address");
        let capture_hook = RawCaptureHook::new(output_root.clone());
        let inspected_hook = capture_hook.clone();
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
        let mut shutdown_tx = Some(shutdown_tx);
        let mut proxy_task = Some(tokio::spawn(serve_with_capture_hook(
            proxy_listener,
            config,
            Arc::new(proxy_ca),
            capture_hook,
            async move {
                let _ = shutdown_rx.await;
            },
        )));

        let mut client_socket = TcpStream::connect(proxy_address)
            .await
            .expect("connect to Rama proxy");
        let connect_request = format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n\r\n");
        client_socket
            .write_all(connect_request.as_bytes())
            .await
            .expect("write CONNECT request");
        let mut connect_response = Vec::new();
        let mut buffer = [0; 1024];
        while !connect_response
            .windows(4)
            .any(|window| window == b"\r\n\r\n")
        {
            let count = client_socket
                .read(&mut buffer)
                .await
                .expect("read CONNECT response");
            assert!(count > 0, "proxy closed before CONNECT response");
            connect_response.extend_from_slice(&buffer[..count]);
        }
        assert!(connect_response.starts_with(b"HTTP/1.1 200"));

        let mut proxy_roots = RootCertStore::empty();
        proxy_roots.add(proxy_ca_der).expect("trust test proxy CA");
        let client_tls_config = rustls::ClientConfig::builder()
            .with_root_certificates(proxy_roots)
            .with_no_client_auth();
        let client_tls = TlsConnector::from(Arc::new(client_tls_config));
        let server_name = ServerName::try_from("localhost".to_owned()).expect("valid SNI");
        let mut client_tls_stream = client_tls
            .connect(server_name, client_socket)
            .await
            .expect("downstream TLS handshake");
        let retained_session = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let session = inspected_hook
                    .sessions
                    .lock()
                    .expect("capture sessions")
                    .values()
                    .next()
                    .cloned();
                if let Some(session) = session {
                    break session;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("capture session was not started before Upgrade request");
        let request_handshake = b"GET /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n";
        client_tls_stream
            .write_all(request_handshake)
            .await
            .expect("write downstream WebSocket handshake");
        let response_handshake = read_http_message(&mut client_tls_stream)
            .await
            .expect("read downstream WebSocket response");
        if matches!(case, AbnormalWebSocketCase::UpstreamHandshakeFailure) {
            assert!(response_handshake.starts_with(b"HTTP/1.1 502"));
            drop(client_tls_stream);
            tokio::time::timeout(std::time::Duration::from_secs(3), upstream_task)
                .await
                .expect("upstream rejection fixture timeout")
                .expect("upstream rejection fixture panicked");
            tokio::time::timeout(std::time::Duration::from_secs(3), async {
                while !inspected_hook
                    .sessions
                    .lock()
                    .expect("capture sessions")
                    .is_empty()
                {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("failed Upgrade session was not finalized");
            RawCaptureHook::wait_for_persistence_tasks(Arc::clone(
                &inspected_hook.persistence_tasks,
            ))
            .await;
            assert!(
                !output_root.exists()
                    || std::fs::read_dir(&output_root)
                        .expect("capture output root")
                        .next()
                        .is_none(),
                "an upstream WebSocket rejection must not persist a 101 capture"
            );
            assert!(inspected_hook
                .websocket_outcomes
                .lock()
                .expect("WebSocket outcomes")
                .is_empty());
            shutdown_tx
                .take()
                .expect("proxy shutdown sender")
                .send(())
                .expect("proxy shutdown signal");
            proxy_task
                .take()
                .expect("proxy task")
                .await
                .expect("proxy task join")
                .expect("proxy shutdown");
            let _ = std::fs::remove_dir_all(output_root);
            return;
        }
        assert!(response_handshake.starts_with(b"HTTP/1.1 101"));
        assert_websocket_101_semantics(&response_handshake);

        let capture_dir = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                if let Ok(entries) = std::fs::read_dir(&output_root) {
                    if let Some(path) = entries
                        .flatten()
                        .filter_map(|entry| {
                            let is_staging = entry.file_name().to_string_lossy().starts_with('.');
                            (!is_staging).then_some(entry.path())
                        })
                        .find(|path| {
                            path.join("manifest.json").exists()
                                && path.join("request-wire.bin").exists()
                                && path.join("response-wire.bin").exists()
                        })
                    {
                        break path;
                    }
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("Upgrade artifact was not finalized before WebSocket relay");
        assert!(
            inspected_hook.session(1).is_none(),
            "completed Upgrade must release its capture session before relay ends"
        );
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                let released = match retained_session.try_lock() {
                    Ok(session) => {
                        let snapshot = session.recorder.snapshot().expect("finalized snapshot");
                        snapshot.request_bytes().is_empty() && snapshot.response_bytes().is_empty()
                    }
                    Err(std::sync::TryLockError::WouldBlock) => false,
                    Err(std::sync::TryLockError::Poisoned(error)) => {
                        panic!("finalized session lock poisoned: {error}")
                    }
                };
                if released {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("finalized Upgrade capture buffers were not released");
        crate::capture::verify_capture(&capture_dir).expect("verify handshake-only capture");
        assert_eq!(
            std::fs::read(capture_dir.join("request-wire.bin")).expect("request wire"),
            request_handshake
        );
        assert_eq!(
            std::fs::read(capture_dir.join("response-wire.bin")).expect("response wire"),
            response_handshake
        );
        let manifest_before: serde_json::Value = serde_json::from_slice(
            &std::fs::read(capture_dir.join("manifest.json")).expect("capture manifest"),
        )
        .expect("parse capture manifest");
        let messages_before = manifest_before["messages"]
            .as_array()
            .expect("capture messages");
        assert_eq!(messages_before.len(), 2);
        assert_eq!(messages_before[0]["direction"].as_str(), Some("request"));
        assert_eq!(
            messages_before[0]["stream_end"].as_u64(),
            Some(request_handshake.len() as u64)
        );
        assert_eq!(messages_before[1]["direction"].as_str(), Some("response"));
        assert_eq!(
            messages_before[1]["stream_end"].as_u64(),
            Some(response_handshake.len() as u64)
        );

        let mut client_tls_stream = Some(client_tls_stream);
        match case {
            AbnormalWebSocketCase::UpstreamHandshakeFailure => {
                unreachable!("upstream handshake failure returned before relay")
            }
            AbnormalWebSocketCase::OneSidedClose => {
                client_tls_stream
                    .as_mut()
                    .expect("client TLS stream")
                    .write_all(&masked_websocket_frame(
                        8,
                        &[0x03, 0xe8],
                        [0x55, 0x66, 0x77, 0x88],
                    ))
                    .await
                    .expect("write one-sided Close frame");
            }
            AbnormalWebSocketCase::InvalidContinuation => {
                client_tls_stream
                    .as_mut()
                    .expect("client TLS stream")
                    .write_all(&masked_websocket_frame(0, &[], [0x55, 0x66, 0x77, 0x88]))
                    .await
                    .expect("write invalid continuation");
            }
            AbnormalWebSocketCase::ClientDisconnect => {
                client_tls_stream
                    .as_mut()
                    .expect("client TLS stream")
                    .write_all(&[0x81, 0x82, 0x11, 0x22])
                    .await
                    .expect("write partial downstream WebSocket frame");
                drop(client_tls_stream.take());
            }
            AbnormalWebSocketCase::UpstreamDisconnect => {
                let stream = client_tls_stream.as_mut().expect("client TLS stream");
                let mut byte = [0; 1];
                match tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    stream.read(&mut byte),
                )
                .await
                .expect("upstream disconnect was not propagated downstream")
                {
                    Ok(0) | Err(_) => {}
                    Ok(count) => panic!("unexpected upstream bytes after 101: {count}"),
                }
            }
            AbnormalWebSocketCase::ProxyShutdown => {
                shutdown_tx
                    .take()
                    .expect("proxy shutdown sender")
                    .send(())
                    .expect("stop Rama proxy");
                tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    proxy_task.take().expect("proxy task"),
                )
                .await
                .expect("Rama shutdown did not terminate")
                .expect("join Rama proxy task")
                .expect("Rama proxy server");
                let mut byte = [0; 1];
                match tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    client_tls_stream
                        .as_mut()
                        .expect("client TLS stream")
                        .read(&mut byte),
                )
                .await
                .expect("client socket remained open after Rama shutdown")
                {
                    Ok(0) | Err(_) => {}
                    Ok(count) => panic!("unexpected bytes after Rama shutdown: {count}"),
                }
            }
            AbnormalWebSocketCase::ProxyTaskAbort => {
                drop(shutdown_tx.take());
                let proxy_task = proxy_task.take().expect("proxy task");
                proxy_task.abort();
                let error = tokio::time::timeout(std::time::Duration::from_secs(3), proxy_task)
                    .await
                    .expect("outer Rama task abort did not terminate")
                    .expect_err("aborted Rama task unexpectedly completed");
                assert!(error.is_cancelled(), "Rama task was not cancelled");
                let mut byte = [0; 1];
                match tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    client_tls_stream
                        .as_mut()
                        .expect("client TLS stream")
                        .read(&mut byte),
                )
                .await
                .expect("client socket remained open after Rama task abort")
                {
                    Ok(0) | Err(_) => {}
                    Ok(count) => panic!("unexpected bytes after Rama task abort: {count}"),
                }
            }
        }
        tokio::time::timeout(std::time::Duration::from_secs(3), upstream_task)
            .await
            .expect("upstream WebSocket fixture timeout")
            .expect("upstream WebSocket fixture panicked");
        drop(client_tls_stream);
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while !inspected_hook
                .websocket_outcomes
                .lock()
                .expect("WebSocket outcomes")
                .iter()
                .any(|(connection_id, clean)| *connection_id == 1 && !*clean)
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("Rama unclean WebSocket lifecycle was not reported");
        assert_eq!(
            inspected_hook
                .websocket_outcomes
                .lock()
                .expect("WebSocket outcomes")
                .as_slice(),
            &[(1, false)],
            "Rama must report exactly one unclean outcome for the terminated relay"
        );
        RawCaptureHook::wait_for_persistence_tasks(Arc::clone(&inspected_hook.persistence_tasks))
            .await;

        assert!(
            inspected_hook
                .sessions
                .lock()
                .expect("capture sessions")
                .is_empty(),
            "completed Upgrade must not retain capture state until WebSocket close"
        );
        assert!(
            inspected_hook
                .persistence_tasks
                .lock()
                .expect("capture persistence tasks")
                .is_empty(),
            "capture persistence tasks must be joined after proxy termination"
        );
        crate::capture::verify_capture(&capture_dir).expect("verify finalized handshake capture");
        assert_eq!(
            std::fs::read(capture_dir.join("request-wire.bin")).expect("request wire after relay"),
            request_handshake
        );
        assert_eq!(
            std::fs::read(capture_dir.join("response-wire.bin"))
                .expect("response wire after relay"),
            response_handshake
        );
        let manifest_after: serde_json::Value = serde_json::from_slice(
            &std::fs::read(capture_dir.join("manifest.json"))
                .expect("capture manifest after relay"),
        )
        .expect("parse capture manifest after relay");
        assert_eq!(manifest_after, manifest_before);

        if let Some(shutdown_tx) = shutdown_tx.take() {
            shutdown_tx.send(()).expect("stop Rama proxy");
        }
        if let Some(proxy_task) = proxy_task.take() {
            proxy_task
                .await
                .expect("join Rama proxy task")
                .expect("Rama proxy server");
        }
        let _ = std::fs::remove_dir_all(output_root);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn rama_backend_preserves_hudsucker_raw_capture_contract() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let output_root = unique_temp_dir();

        let upstream_identity = rcgen::generate_simple_self_signed(vec!["localhost".to_owned()])
            .expect("generate upstream identity");
        let upstream_certificate = CertificateDer::from(upstream_identity.cert.der().to_vec());
        let upstream_key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
            upstream_identity.key_pair.serialize_der(),
        ));
        let upstream_server_config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![upstream_certificate.clone()], upstream_key)
            .expect("build local upstream TLS config");
        let upstream_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind local upstream");
        let upstream_address = upstream_listener.local_addr().expect("upstream address");
        let upstream_acceptor = TlsAcceptor::from(Arc::new(upstream_server_config));
        let upstream_task = tokio::spawn(async move {
            let (socket, _) = upstream_listener.accept().await.expect("upstream accept");
            let mut stream = upstream_acceptor
                .accept(socket)
                .await
                .expect("upstream TLS accept");
            for index in 0..3 {
                let request = read_http_message(&mut stream)
                    .await
                    .expect("read full upstream request body");
                if index == 1 {
                    assert!(request
                        .starts_with(b"POST /kcsapi/api_get_member/require_info?x=2 HTTP/1.1"));
                } else {
                    assert!(request.starts_with(b"GET /kcsapi/api_get_member/require_info"));
                }
                let connection = if index == 2 { "close" } else { "keep-alive" };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: {connection}\r\n\r\nr{}",
                    index + 1
                );
                stream
                    .write_all(response.as_bytes())
                    .await
                    .expect("write upstream response");
            }
            stream.shutdown().await.expect("close upstream TLS");
        });

        let proxy_key = KeyPair::generate().expect("generate proxy CA key");
        let mut proxy_ca_params = CertificateParams::default();
        proxy_ca_params.is_ca = IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        let proxy_ca_certificate = proxy_ca_params
            .self_signed(&proxy_key)
            .expect("self-sign proxy CA");
        let proxy_ca_der = CertificateDer::from(proxy_ca_certificate.der().to_vec());
        let proxy_ca = hudsucker::certificate_authority::RcgenAuthority::new(
            proxy_key,
            proxy_ca_certificate,
            100,
            rustls::crypto::ring::default_provider(),
        );

        let authority = format!("localhost:{}", upstream_address.port());
        let config = RamaExperimentalConfig::new(
            authority.clone(),
            upstream_address,
            vec![upstream_certificate],
        )
        .expect("build fail-closed Rama proxy config");
        let proxy_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind Rama proxy");
        let proxy_address = proxy_listener.local_addr().expect("Rama proxy address");
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
        let proxy_task = tokio::spawn(serve(
            proxy_listener,
            config,
            Arc::new(proxy_ca),
            output_root.clone(),
            async move {
                let _ = shutdown_rx.await;
            },
        ));

        let mut client_socket = TcpStream::connect(proxy_address)
            .await
            .expect("connect to Rama proxy");
        let connect_request = format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n\r\n");
        client_socket
            .write_all(connect_request.as_bytes())
            .await
            .expect("write CONNECT request");
        let mut connect_response = Vec::new();
        let mut buffer = [0; 1024];
        while !connect_response
            .windows(4)
            .any(|window| window == b"\r\n\r\n")
        {
            let count = client_socket
                .read(&mut buffer)
                .await
                .expect("read CONNECT response");
            assert!(count > 0, "proxy closed before CONNECT response");
            connect_response.extend_from_slice(&buffer[..count]);
        }
        assert!(connect_response.starts_with(b"HTTP/1.1 200"));

        let mut proxy_roots = RootCertStore::empty();
        proxy_roots.add(proxy_ca_der).expect("trust test proxy CA");
        let client_tls_config = rustls::ClientConfig::builder()
            .with_root_certificates(proxy_roots)
            .with_no_client_auth();
        let client_tls = TlsConnector::from(Arc::new(client_tls_config));
        let server_name =
            ServerName::try_from("localhost".to_owned()).expect("valid downstream SNI");
        let mut client_tls_stream = client_tls
            .connect(server_name, client_socket)
            .await
            .expect("downstream TLS handshake");

        let client_requests = [
            b"GET /kcsapi/api_get_member/require_info?x=1 HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n"
                .as_slice(),
            b"POST /kcsapi/api_get_member/require_info?x=2 HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n4\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n"
                .as_slice(),
            b"GET /kcsapi/api_get_member/require_info?x=3 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"
                .as_slice(),
        ];
        let mut expected_request_wire = Vec::new();
        let mut expected_response_wire = Vec::new();
        let mut expected_request_messages = Vec::new();
        let mut expected_response_messages = Vec::new();
        for (index, request) in client_requests.iter().enumerate() {
            for chunk in request.chunks([1, 5, request.len()][index]) {
                client_tls_stream
                    .write_all(chunk)
                    .await
                    .expect("write raw client request");
            }
            let response = read_http_message(&mut client_tls_stream)
                .await
                .expect("read full client response");
            assert!(response.starts_with(b"HTTP/1.1 200 OK"));
            assert!(response.ends_with(format!("r{}", index + 1).as_bytes()));
            expected_request_wire.extend_from_slice(request);
            expected_response_wire.extend_from_slice(&response);
            expected_request_messages.push(request.to_vec());
            expected_response_messages.push(response);
        }
        drop(client_tls_stream);
        upstream_task.await.expect("join upstream server");

        let capture_dir = tokio::time::timeout(std::time::Duration::from_secs(3), async {
            loop {
                if let Ok(mut entries) = std::fs::read_dir(&output_root) {
                    if let Some(path) = entries
                        .by_ref()
                        .flatten()
                        .map(|entry| (entry.file_name(), entry.path()))
                        .find_map(|(name, path)| {
                            let is_staging = name.to_string_lossy().starts_with('.');
                            (!is_staging && path.join("manifest.json").exists()).then_some(path)
                        })
                    {
                        break path;
                    }
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("Rama capture finalization timeout");
        crate::capture::verify_capture(&capture_dir).expect("verify Rama raw transcript");
        assert_eq!(
            std::fs::read(capture_dir.join("request-wire.bin")).expect("request wire"),
            expected_request_wire
        );
        assert_eq!(
            std::fs::read(capture_dir.join("response-wire.bin")).expect("response wire"),
            expected_response_wire
        );
        let manifest: serde_json::Value = serde_json::from_slice(
            &std::fs::read(capture_dir.join("manifest.json")).expect("capture manifest"),
        )
        .expect("parse capture manifest");
        let messages = manifest["messages"].as_array().expect("message list");
        assert_eq!(messages.len(), 6);
        let mut request_offset = 0;
        let mut response_offset = 0;
        for (sequence, message) in messages.iter().enumerate() {
            assert_eq!(message["sequence"].as_u64(), Some(sequence as u64));
            let (direction, expected_message, stream_offset) = if sequence % 2 == 0 {
                let expected_message = &expected_request_messages[sequence / 2];
                let offset = request_offset;
                request_offset += expected_message.len();
                ("request", expected_message, offset)
            } else {
                let expected_message = &expected_response_messages[sequence / 2];
                let offset = response_offset;
                response_offset += expected_message.len();
                ("response", expected_message, offset)
            };
            assert_eq!(message["direction"].as_str(), Some(direction));
            assert_eq!(message["stream_start"].as_u64(), Some(stream_offset as u64));
            assert_eq!(
                message["stream_end"].as_u64(),
                Some((stream_offset + expected_message.len()) as u64)
            );
            let stream = if direction == "request" {
                &expected_request_wire
            } else {
                &expected_response_wire
            };
            assert_eq!(
                &stream[stream_offset..stream_offset + expected_message.len()],
                expected_message
            );
        }
        assert_eq!(request_offset, expected_request_wire.len());
        assert_eq!(response_offset, expected_response_wire.len());

        shutdown_tx.send(()).expect("stop Rama proxy");
        proxy_task
            .await
            .expect("join Rama proxy task")
            .expect("Rama proxy server");
        let _ = std::fs::remove_dir_all(output_root);
    }
}
