use super::RawCaptureHook;
use crate::{capture::ExactWireMetadata, capture_io::CaptureIo};
use hudsucker::certificate_authority::CertificateAuthority;
use rama::{
    Layer, Service, ServiceInput,
    conversion::RamaTryInto,
    error::{BoxError, BoxErrorExt as _},
    extensions::Extensions,
    http::{
        Body, Request, Response, StatusCode, Version,
        conn::TargetHttpVersion,
        io::upgrade::{self, Upgraded},
        ws::handshake::{
            client::HttpClientWebSocketExt,
            mitm::{
                WebSocketRelayEvent, WebSocketRelayEventInput, WebSocketRelayEventOutput,
                WebSocketRelayEventService,
            },
        },
    },
    io::BridgeIo,
    net::address::Host,
    rt::Executor,
    service::service_fn,
    tls::{
        SecureTransport,
        client::{ServerVerifyMode, TlsClientConfig, TlsServerTrust, TlsServerTrustAnchors},
        rustls::{
            RamaTlsRustlsCrateMarker,
            server::{DynamicConfigProvider, RustlsServerConfigExt, TlsAcceptorLayer},
        },
        server::TlsServerConfig,
    },
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
        Arc,
        atomic::{AtomicU8, AtomicU64, AtomicUsize, Ordering},
    },
    task::{Context, Poll},
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::{TcpListener, TcpStream},
    sync::Mutex as AsyncMutex,
    task::{JoinHandle, JoinSet},
};
use tokio_rustls::rustls::{
    self,
    pki_types::{CertificateDer, ServerName},
};

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
    flag: u8,
    parser: WebSocketFrameParser,
}

impl<IO> WebSocketCloseFrameObserver<IO> {
    fn new(inner: IO, close_frames: Arc<AtomicU8>, flag: u8, expect_masked: bool) -> Self {
        Self {
            inner,
            close_frames,
            flag,
            parser: WebSocketFrameParser::new(expect_masked),
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
        let result = Pin::new(&mut this.inner).poll_read(context, buffer);
        if matches!(result, Poll::Ready(Ok(())))
            && this.parser.observe(&buffer.filled()[previous_len..])
        {
            this.close_frames.fetch_or(this.flag, Ordering::Release);
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
        Pin::new(&mut self.as_mut().get_mut().inner).poll_write(context, bytes)
    }

    fn poll_flush(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.as_mut().get_mut().inner).poll_flush(context)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.as_mut().get_mut().inner).poll_shutdown(context)
    }
}

struct WebSocketFrameParser {
    buffered: Vec<u8>,
    payload_remaining: u64,
    current_frame_is_close: bool,
    close_frame_seen: bool,
    expect_masked: bool,
}

impl WebSocketFrameParser {
    fn new(expect_masked: bool) -> Self {
        Self {
            buffered: Vec::new(),
            payload_remaining: 0,
            current_frame_is_close: false,
            close_frame_seen: false,
            expect_masked,
        }
    }

    fn observe(&mut self, bytes: &[u8]) -> bool {
        if self.close_frame_seen {
            return true;
        }
        self.buffered.extend_from_slice(bytes);
        loop {
            if self.payload_remaining > 0 {
                let consumed = self.payload_remaining.min(self.buffered.len() as u64) as usize;
                self.buffered.drain(..consumed);
                self.payload_remaining -= consumed as u64;
                if self.payload_remaining > 0 {
                    return false;
                }
                if self.current_frame_is_close {
                    self.close_frame_seen = true;
                    return true;
                }
                self.current_frame_is_close = false;
            }

            if self.buffered.len() < 2 {
                return false;
            }
            let length_code = self.buffered[1] & 0x7f;
            let extended_length_bytes = match length_code {
                126 => 2,
                127 => 8,
                _ => 0,
            };
            if self.buffered.len() < 2 + extended_length_bytes {
                return false;
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
            let header_length =
                2 + extended_length_bytes + usize::from(self.buffered[1] & 0x80 != 0) * 4;
            if self.buffered.len() < header_length {
                return false;
            }
            let opcode = self.buffered[0] & 0x0f;
            let is_masked = self.buffered[1] & 0x80 != 0;
            self.current_frame_is_close = opcode == 0x08
                && self.buffered[0] & 0x80 != 0
                && self.buffered[0] & 0x70 == 0
                && length_code <= 125
                && payload_length != 1
                && is_masked == self.expect_masked;
            self.buffered.drain(..header_length);
            self.payload_remaining = payload_length;
            if payload_length == 0 && self.current_frame_is_close {
                self.close_frame_seen = true;
                return true;
            }
        }
    }
}

#[cfg(test)]
mod websocket_frame_parser_tests {
    use super::{
        DOWNSTREAM_CLOSE_FRAME, UPSTREAM_CLOSE_FRAME, WebSocketFrameParser,
        websocket_close_handshake_complete,
    };

    #[test]
    fn recognizes_complete_close_frames_after_split_reads() {
        let masked_close = [0x88, 0x82, 0x11, 0x22, 0x33, 0x44, 0x12, 0xc8];
        let mut downstream = WebSocketFrameParser::new(true);
        for byte in &masked_close[..masked_close.len() - 1] {
            assert!(!downstream.observe(std::slice::from_ref(byte)));
        }
        assert!(downstream.observe(&masked_close[masked_close.len() - 1..]));

        let mut upstream = WebSocketFrameParser::new(false);
        assert!(upstream.observe(&[0x88, 0x02, 0x03, 0xe8]));
    }

    #[test]
    fn ignores_data_frames_and_invalid_close_frames() {
        let mut parser = WebSocketFrameParser::new(true);
        assert!(parser.observe(&[0x81, 0x01, b'x', 0x88, 0x80, 0x11, 0x22, 0x33, 0x44,]));

        let mut fragmented_close = WebSocketFrameParser::new(true);
        assert!(!fragmented_close.observe(&[0x08, 0x80, 0x11, 0x22, 0x33, 0x44]));

        let mut wrong_mask = WebSocketFrameParser::new(true);
        assert!(!wrong_mask.observe(&[0x88, 0x02, 0x03, 0xe8]));
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
    let next_connection_id = Arc::new(AtomicU64::new(1));
    let mut connections = JoinSet::new();
    tokio::pin!(shutdown);

    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (socket, client_addr) = accepted?;
                let connection_id = next_connection_id
                    .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |id| id.checked_add(1))
                    .map_err(|_| BoxError::from_static_str("Rama connection ID space exhausted"))?;
                let config = config.clone();
                let ca = Arc::clone(&ca);
                let capture_hook = capture_hook.clone();
                connections.spawn(async move {
                    serve_connection(
                        socket,
                        client_addr,
                        connection_id,
                        config,
                        ca,
                        capture_hook,
                    )
                    .await
                });
            }
            joined = connections.join_next(), if !connections.is_empty() => {
                if let Some(result) = joined {
                    result.map_err(Into::<BoxError>::into)??;
                }
            }
            _ = &mut shutdown => break,
        }
    }

    connections.shutdown().await;
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
    let tunnel_tasks = Arc::new(AsyncMutex::new(Vec::new()));
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
    let tasks = std::mem::take(&mut *tunnel_tasks.lock().await);
    for task in tasks {
        task.await.map_err(Into::<BoxError>::into)?;
    }
    connection_result
}

#[allow(clippy::too_many_arguments)]
async fn handle_connect<CA>(
    request: Request<Body>,
    client_addr: SocketAddr,
    connection_id: u64,
    config: RamaExperimentalConfig,
    ca: Arc<CA>,
    capture_hook: RawCaptureHook,
    tunnel_tasks: Arc<AsyncMutex<Vec<JoinHandle<()>>>>,
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

    let upstream_socket = match TcpStream::connect(config.upstream_address).await {
        Ok(socket) => socket,
        Err(error) => {
            tracing::warn!(%error, "Rama experimental upstream TCP connection failed");
            return empty_response(StatusCode::BAD_GATEWAY);
        }
    };
    let server_name = match ServerName::try_from(config.allowed_host.clone()) {
        Ok(name) => name,
        Err(error) => {
            tracing::warn!(%error, "Rama experimental upstream TLS name was invalid");
            return empty_response(StatusCode::BAD_GATEWAY);
        }
    };
    let upstream_tls = match tokio_rustls::TlsConnector::from(Arc::clone(&config.upstream_tls))
        .connect(server_name, upstream_socket)
        .await
    {
        Ok(stream) => stream,
        Err(error) => {
            tracing::warn!(%error, "Rama experimental verified upstream TLS failed");
            return empty_response(StatusCode::BAD_GATEWAY);
        }
    };

    let authority = authority.clone();
    let pending_upgrade = upgrade::handle_upgrade(&request);
    let task = tokio::spawn(async move {
        if let Err(error) = run_tunnel(
            pending_upgrade,
            upstream_tls,
            authority,
            connection_id,
            ca,
            capture_hook,
        )
        .await
        {
            tracing::warn!(%error, connection_id, %client_addr, "Rama experimental CONNECT tunnel failed");
        }
    });
    tunnel_tasks.lock().await.push(task);
    empty_response(StatusCode::OK)
}

async fn run_tunnel<CA, Upgrade>(
    pending_upgrade: Upgrade,
    upstream_tls: tokio_rustls::client::TlsStream<TcpStream>,
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
    let downstream_tls = tls_acceptor.serve(ServiceInput::new(upgraded)).await?;
    let recorder = capture_hook.start_session(connection_id).map_err(|()| {
        tracing::error!(connection_id, "Rama raw capture session map is poisoned");
        BoxError::from_static_str("Rama raw capture session unavailable")
    })?;
    let ingress = CaptureIo::new_with_read_chunk_size(downstream_tls, recorder, 1);
    let egress = ServiceInput::new(upstream_tls);
    egress.extensions.insert(SecureTransport::default());
    egress
        .extensions
        .insert(TargetHttpVersion(Version::HTTP_11));

    let websocket_tasks = Arc::new(AsyncMutex::new(Vec::new()));
    let relay = HttpMitmRelay::new(Executor::default()).with_http_middleware(CaptureLayer {
        authority: authority.to_string(),
        connection_id,
        capture_hook: capture_hook.clone(),
        websocket_tasks: Arc::clone(&websocket_tasks),
    });
    let result = relay.serve(BridgeIo(ingress, egress)).await;

    let tasks = std::mem::take(&mut *websocket_tasks.lock().await);
    let mut websockets_clean = true;
    for task in tasks {
        match task.await {
            Ok(true) => {}
            Ok(false) => {
                capture_hook.mark_invalid(connection_id);
                websockets_clean = false;
                tracing::warn!(
                    connection_id,
                    "Rama WebSocket relay ended without a clean close handshake"
                );
            }
            Err(error) => {
                capture_hook.mark_invalid(connection_id);
                websockets_clean = false;
                tracing::warn!(%error, connection_id, "Rama WebSocket relay task failed");
            }
        }
    }
    capture_hook
        .finish_connection(connection_id, result.is_ok() && websockets_clean)
        .await;
    result
}

#[derive(Clone)]
struct CaptureLayer {
    authority: String,
    connection_id: u64,
    capture_hook: RawCaptureHook,
    websocket_tasks: Arc<AsyncMutex<Vec<JoinHandle<bool>>>>,
}

struct CaptureService<S> {
    inner: Arc<S>,
    authority: String,
    connection_id: u64,
    capture_hook: RawCaptureHook,
    websocket_tasks: Arc<AsyncMutex<Vec<JoinHandle<bool>>>>,
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
        let is_websocket = is_websocket_upgrade(&request);
        if !rewrite_request_uri(&mut request, &self.authority) {
            self.capture_hook.mark_invalid(connection_id);
            return Ok(empty_response(StatusCode::BAD_REQUEST));
        }

        if !is_websocket {
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
        let task = tokio::spawn(async move {
            let downstream_io = match pending_upgrade.await {
                Ok(io) => io,
                Err(error) => {
                    capture_hook.mark_invalid(connection_id);
                    tracing::warn!(%error, connection_id, "Rama downstream WebSocket upgrade failed");
                    return false;
                }
            };
            let close_events = Arc::new(AtomicUsize::new(0));
            let close_frames = Arc::new(AtomicU8::new(0));
            let downstream_io = WebSocketCloseFrameObserver::new(
                downstream_io,
                Arc::clone(&close_frames),
                DOWNSTREAM_CLOSE_FRAME,
                true,
            );
            let upstream_io = WebSocketCloseFrameObserver::new(
                upstream_io,
                Arc::clone(&close_frames),
                UPSTREAM_CLOSE_FRAME,
                false,
            );
            let relay = WebSocketRelayEventService::new(CloseTracker(Arc::clone(&close_events)))
                .with_close_handshake_timeout(std::time::Duration::from_secs(10));
            let relay_result = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                relay.serve(BridgeIo(downstream_io, upstream_io)),
            )
            .await;
            match relay_result {
                Ok(Ok(_))
                    if websocket_close_handshake_complete(
                        close_events.load(Ordering::Acquire),
                        close_frames.load(Ordering::Acquire),
                    ) =>
                {
                    true
                }
                Ok(Ok(_)) => {
                    capture_hook.mark_invalid(connection_id);
                    false
                }
                Ok(Err(error)) => {
                    capture_hook.mark_invalid(connection_id);
                    tracing::warn!(%error, connection_id, "Rama WebSocket relay failed");
                    false
                }
                Err(_) => {
                    capture_hook.mark_invalid(connection_id);
                    tracing::warn!(
                        connection_id,
                        "Rama WebSocket close handshake deadline exceeded"
                    );
                    false
                }
            }
        });
        self.websocket_tasks.lock().await.push(task);
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

fn is_websocket_upgrade(request: &Request<Body>) -> bool {
    let upgrade = request
        .headers()
        .get("upgrade")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("websocket"));
    let connection = request.headers().get_all("connection").iter().any(|value| {
        value.to_str().ok().is_some_and(|value| {
            value
                .split(',')
                .any(|token| token.trim().eq_ignore_ascii_case("upgrade"))
        })
    });
    upgrade && connection
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
        TlsAcceptor, TlsConnector,
        rustls::{
            RootCertStore,
            pki_types::{PrivateKeyDer, PrivatePkcs8KeyDer},
        },
    };

    fn unique_temp_dir() -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("fusou_rama_capture_{timestamp}"))
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
        assert!(connect_response.starts_with(b"HTTP/1.1 502"));
        drop(client_socket);
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
                .expect("verified upstream TLS");
            let mut first_request_byte = [0; 1];
            stream.read(&mut first_request_byte).await
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
        let upstream_read = tokio::time::timeout(std::time::Duration::from_secs(2), upstream_task)
            .await
            .expect("upstream close timeout")
            .expect("upstream task panicked");
        match upstream_read {
            Ok(0) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::ConnectionReset | io::ErrorKind::UnexpectedEof
                ) => {}
            Ok(count) => panic!("SNI rejection forwarded {count} upstream request bytes"),
            Err(error) => panic!("unexpected upstream read failure after SNI rejection: {error}"),
        }
        shutdown_tx.send(()).expect("stop Rama proxy");
        proxy_task
            .await
            .expect("join Rama proxy task")
            .expect("Rama proxy server");
        let _ = std::fs::remove_dir_all(output_root);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn keeps_parallel_connection_captures_isolated() {
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
        client_tls_stream
            .shutdown()
            .await
            .expect("close downstream TLS");
        drop(client_tls_stream);

        tokio::time::timeout(std::time::Duration::from_secs(3), upstream_task)
            .await
            .expect("upstream WebSocket timeout")
            .expect("upstream WebSocket task panicked");
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
        .expect("WebSocket capture finalization timeout");

        let mut expected_request_wire = request_handshake.to_vec();
        expected_request_wire.extend_from_slice(&text_frame);
        expected_request_wire.extend_from_slice(&close_frame);
        let mut expected_response_wire = response_handshake;
        expected_response_wire.extend_from_slice(&response_text_frame);
        expected_response_wire.extend_from_slice(&response_close_frame);
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
            Some(expected_response_wire.len() as u64)
        );
        shutdown_tx.send(()).expect("stop Rama proxy");
        proxy_task
            .await
            .expect("join Rama proxy task")
            .expect("Rama proxy server");
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
                    assert!(
                        request
                            .starts_with(b"POST /kcsapi/api_get_member/require_info?x=2 HTTP/1.1")
                    );
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
