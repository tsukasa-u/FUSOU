use crate::{
    body::Body, certificate_authority::CertificateAuthority, rewind::Rewind, ClientStream,
    ClientStreamHook, HttpContext, HttpHandler, NoopClientStreamHook, RequestOrResponse,
    WebSocketContext, WebSocketHandler,
};
use futures::{Sink, Stream, StreamExt};
use http::uri::{Authority, Scheme};
use hyper::{
    body::{Body as HttpBody, Bytes, Incoming},
    header::Entry,
    service::service_fn,
    upgrade::Upgraded,
    Method, Request, Response, StatusCode, Uri,
};
use hyper_util::{
    client::legacy::{connect::Connect, Client},
    rt::{TokioExecutor, TokioIo},
    server,
};
use std::{
    convert::Infallible,
    future::Future,
    net::SocketAddr,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    task::{Context, Poll},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite},
    net::TcpStream,
    sync::mpsc::UnboundedSender,
    task::JoinSet,
};
use tokio_rustls::TlsAcceptor;
use tokio_tungstenite::{
    tungstenite::{self, Message},
    Connector, WebSocketStream,
};
use tracing::{error, info_span, instrument, warn, Instrument};

fn bad_request() -> Response<Body> {
    Response::builder()
        .status(StatusCode::BAD_REQUEST)
        .body(Body::empty())
        .expect("Failed to build response")
}

fn service_unavailable() -> Response<Body> {
    Response::builder()
        .status(StatusCode::SERVICE_UNAVAILABLE)
        .body(Body::empty())
        .expect("Failed to build service unavailable response")
}

pub(crate) struct TrackedProxyTask {
    future: Pin<Box<dyn Future<Output = ()> + Send + 'static>>,
    on_cancel: Option<Box<dyn FnOnce() + Send + 'static>>,
}

impl TrackedProxyTask {
    pub(crate) fn new(
        future: impl Future<Output = ()> + Send + 'static,
        on_cancel: impl FnOnce() + Send + 'static,
    ) -> Self {
        Self {
            future: Box::pin(future),
            on_cancel: Some(Box::new(on_cancel)),
        }
    }

    fn disarm(&mut self) {
        self.on_cancel = None;
    }
}

impl Future for TrackedProxyTask {
    type Output = ();

    fn poll(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Self::Output> {
        let this = self.as_mut().get_mut();
        match this.future.as_mut().poll(context) {
            Poll::Ready(()) => {
                this.on_cancel = None;
                Poll::Ready(())
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

impl Drop for TrackedProxyTask {
    fn drop(&mut self) {
        if let Some(on_cancel) = self.on_cancel.take() {
            on_cancel();
        }
    }
}

pub(crate) struct InternalProxy<C, CA, H, W, K = NoopClientStreamHook> {
    pub ca: Arc<CA>,
    pub client: Client<C, Body>,
    pub server: server::conn::auto::Builder<TokioExecutor>,
    pub http_handler: H,
    pub websocket_handler: W,
    pub websocket_connector: Option<Connector>,
    pub background_tasks: UnboundedSender<TrackedProxyTask>,
    pub client_addr: SocketAddr,
    pub connection_id: u64,
    pub client_stream_hook: K,
}

impl<C, CA, H, W, K> Clone for InternalProxy<C, CA, H, W, K>
where
    C: Clone,
    H: Clone,
    W: Clone,
    K: Clone,
{
    fn clone(&self) -> Self {
        InternalProxy {
            ca: Arc::clone(&self.ca),
            client: self.client.clone(),
            server: self.server.clone(),
            http_handler: self.http_handler.clone(),
            websocket_handler: self.websocket_handler.clone(),
            websocket_connector: self.websocket_connector.clone(),
            background_tasks: self.background_tasks.clone(),
            client_addr: self.client_addr,
            connection_id: self.connection_id,
            client_stream_hook: self.client_stream_hook.clone(),
        }
    }
}

impl<C, CA, H, W, K> InternalProxy<C, CA, H, W, K>
where
    C: Connect + Clone + Send + Sync + 'static,
    CA: CertificateAuthority,
    H: HttpHandler,
    W: WebSocketHandler,
    K: ClientStreamHook,
{
    fn context(&self) -> HttpContext {
        HttpContext {
            client_addr: self.client_addr,
            connection_id: self.connection_id,
        }
    }

    #[instrument(
        skip_all,
        fields(
            version = ?req.version(),
            method = %req.method(),
            uri=%req.uri(),
            client_addr = %self.client_addr,
        )
    )]
    pub(crate) async fn proxy(
        mut self,
        req: Request<Incoming>,
    ) -> Result<Response<Body>, Infallible> {
        let ctx = self.context();
        let request_body_is_empty = req.body().is_end_stream();
        self.client_stream_hook.request_started(&ctx, &req);
        let request_hook = self.client_stream_hook.clone();
        let request_context = ctx.clone();
        let req = req.map(|body| {
            let body = Body::from(body);
            if request_body_is_empty {
                body
            } else {
                body.with_completion(move || {
                    request_hook.request_completed(&request_context);
                })
            }
        });
        if request_body_is_empty {
            self.client_stream_hook.request_completed(&ctx);
        }

        let req = match self
            .http_handler
            .handle_request(&ctx, req.map(Body::from))
            .instrument(info_span!("handle_request"))
            .await
        {
            RequestOrResponse::Request(req) => req,
            RequestOrResponse::Response(res) => return Ok(self.wrap_response(&ctx, res)),
        };

        if req.method() == Method::CONNECT {
            Ok(self.process_connect(req))
        } else if hyper_tungstenite::is_upgrade_request(&req) {
            Ok(self.upgrade_websocket(req).await)
        } else {
            let res = self
                .client
                .request(normalize_request(req))
                .instrument(info_span!("proxy_request"))
                .await;

            let res = match res {
                Ok(res) => {
                    self.http_handler
                        .handle_response(&ctx, res.map(Body::from))
                        .instrument(info_span!("handle_response"))
                        .await
                }
                Err(err) => {
                    self.http_handler
                        .handle_error(&ctx, err)
                        .instrument(info_span!("handle_error"))
                        .await
                }
            };
            Ok(self.wrap_response(&ctx, res))
        }
    }

    fn wrap_response(&self, context: &HttpContext, response: Response<Body>) -> Response<Body> {
        self.client_stream_hook.response_started(context, &response);
        let hook = self.client_stream_hook.clone();
        let context = context.clone();
        let (parts, body) = response.into_parts();
        Response::from_parts(
            parts,
            body.with_completion(move || {
                hook.response_completed(&context);
            }),
        )
    }

    fn process_connect(mut self, mut req: Request<Body>) -> Response<Body> {
        match req.uri().authority().cloned() {
            Some(authority) => {
                let span = info_span!("process_connect");
                let background_tasks = self.background_tasks.clone();
                let cancellation_hook = self.client_stream_hook.clone();
                let cancellation_context = self.context();
                let fut = async move {
                    match hyper::upgrade::on(&mut req).await {
                        Ok(upgraded) => {
                            let mut upgraded = TokioIo::new(upgraded);
                            let mut buffer = [0; 4];
                            let bytes_read = match upgraded.read(&mut buffer).await {
                                Ok(bytes_read) => bytes_read,
                                Err(e) => {
                                    error!("Failed to read from upgraded connection: {}", e);
                                    return;
                                }
                            };

                            let mut upgraded = Rewind::new(
                                upgraded,
                                Bytes::copy_from_slice(buffer[..bytes_read].as_ref()),
                            );

                            if self
                                .http_handler
                                .should_intercept(&self.context(), &req)
                                .await
                            {
                                if buffer == *b"GET " {
                                    if let Err(e) = self
                                        .serve_stream(
                                            TokioIo::new(upgraded),
                                            Scheme::HTTP,
                                            authority,
                                        )
                                        .await
                                    {
                                        error!("WebSocket connect error: {}", e);
                                    }

                                    return;
                                } else if buffer[..2] == *b"\x16\x03" {
                                    let server_config = self
                                        .ca
                                        .gen_server_config(&authority)
                                        .instrument(info_span!("gen_server_config"))
                                        .await;

                                    let stream = match TlsAcceptor::from(server_config)
                                        .accept(upgraded)
                                        .await
                                    {
                                        Ok(stream) => stream,
                                        Err(e) => {
                                            error!("Failed to establish TLS connection: {}", e);
                                            return;
                                        }
                                    };

                                    let hook = self.client_stream_hook.clone();
                                    let context = self.context();
                                    let stream =
                                        hook.wrap(&context, Box::new(stream) as ClientStream);
                                    let stream = TokioIo::new(stream);

                                    let result =
                                        self.serve_stream(stream, Scheme::HTTPS, authority).await;
                                    hook.finish_with_status(context, result.is_ok()).await;
                                    if let Err(e) = result {
                                        if !e
                                            .to_string()
                                            .starts_with("error shutting down connection")
                                        {
                                            error!("HTTPS connect error: {}", e);
                                        }
                                    }

                                    return;
                                } else {
                                    warn!(
                                        "Unknown protocol, read '{:02X?}' from upgraded connection",
                                        &buffer[..bytes_read]
                                    );
                                }
                            }

                            let mut server = match TcpStream::connect(authority.as_ref()).await {
                                Ok(server) => server,
                                Err(e) => {
                                    error!("Failed to connect to {}: {}", authority, e);
                                    return;
                                }
                            };

                            if let Err(e) =
                                tokio::io::copy_bidirectional(&mut upgraded, &mut server).await
                            {
                                error!("Failed to tunnel to {}: {}", authority, e);
                            }
                        }
                        Err(e) => error!("Upgrade error: {}", e),
                    };
                };

                let task = TrackedProxyTask::new(fut.instrument(span), move || {
                    cancellation_hook.connection_aborted(&cancellation_context)
                });
                if let Err(error) = background_tasks.send(task) {
                    error!(%error, "Proxy task manager is no longer accepting CONNECT tunnels");
                    let mut task = error.0;
                    task.disarm();
                    drop(task);
                    return service_unavailable();
                }
                Response::new(Body::empty())
            }
            None => bad_request(),
        }
    }

    #[instrument(skip_all)]
    async fn upgrade_websocket(self, req: Request<Body>) -> Response<Body> {
        let mut req = {
            let (mut parts, _) = req.into_parts();

            parts.uri = {
                let mut parts = parts.uri.into_parts();

                parts.scheme = if parts.scheme.unwrap_or(Scheme::HTTP) == Scheme::HTTP {
                    Some("ws".try_into().expect("Failed to convert scheme"))
                } else {
                    Some("wss".try_into().expect("Failed to convert scheme"))
                };

                match Uri::from_parts(parts) {
                    Ok(uri) => uri,
                    Err(_) => {
                        return bad_request();
                    }
                }
            };

            Request::from_parts(parts, ())
        };

        let uri = req.uri().clone();
        let (server_socket, _) = match tokio_tungstenite::connect_async_tls_with_config(
            req.clone(),
            None,
            false,
            self.websocket_connector.clone(),
        )
        .await
        {
            Ok(upstream) => upstream,
            Err(error) => {
                error!(%error, "Failed to establish upstream WebSocket");
                return Response::builder()
                    .status(StatusCode::BAD_GATEWAY)
                    .body(Body::empty())
                    .expect("Failed to build gateway response");
            }
        };

        match hyper_tungstenite::upgrade(&mut req, None) {
            Ok((res, websocket)) => {
                let context = self.context();
                let response = res.map(Body::from);
                let hook = self.client_stream_hook.clone();
                let response_hook = hook.clone();
                let response_context = context.clone();
                let cancellation_hook = hook.clone();
                let cancellation_context = context.clone();
                let background_tasks = self.background_tasks.clone();
                let span = info_span!("websocket");
                let fut = async move {
                    let clean = match websocket.await {
                        Ok(client_socket) => {
                            hook.response_completed(&context);
                            let mut relay = JoinSet::new();
                            relay.spawn(self.handle_websocket(client_socket, server_socket, uri));
                            match relay.join_next().await {
                                Some(Ok(clean)) => clean,
                                Some(Err(error)) => {
                                    error!(%error, "WebSocket relay task failed");
                                    false
                                }
                                None => false,
                            }
                        }
                        Err(e) => {
                            error!("Failed to upgrade to WebSocket: {}", e);
                            false
                        }
                    };
                    hook.websocket_completed(&context, clean);
                };

                let task = TrackedProxyTask::new(fut.instrument(span), move || {
                    cancellation_hook.websocket_completed(&cancellation_context, false);
                    cancellation_hook.connection_aborted(&cancellation_context);
                });
                if let Err(error) = background_tasks.send(task) {
                    error!(%error, "Proxy task manager is no longer accepting WebSocket upgrades");
                    let response = service_unavailable();
                    response_hook.response_started(&response_context, &response);
                    let mut task = error.0;
                    task.disarm();
                    drop(task);
                    return response;
                }
                response_hook.response_started(&response_context, &response);
                response
            }
            Err(_) => bad_request(),
        }
    }

    #[instrument(skip_all)]
    async fn handle_websocket<S>(
        self,
        client_socket: WebSocketStream<TokioIo<Upgraded>>,
        server_socket: WebSocketStream<S>,
        uri: Uri,
    ) -> bool
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let (server_sink, server_stream) = server_socket.split();
        let (client_sink, client_stream) = client_socket.split();

        let InternalProxy {
            websocket_handler, ..
        } = self;

        let lifecycle = Arc::new(WebSocketRelayLifecycle::default());
        let client_to_server = websocket_handler.clone().handle_websocket(
            WebSocketContext::ClientToServer {
                src: self.client_addr,
                dst: uri.clone(),
            },
            ObservedWebSocketStream::new(
                client_stream,
                WebSocketSide::Client,
                Arc::clone(&lifecycle),
            ),
            ObservedWebSocketSink::new(server_sink, WebSocketSide::Server, Arc::clone(&lifecycle)),
        );
        let server_to_client = websocket_handler.handle_websocket(
            WebSocketContext::ServerToClient {
                src: uri.clone(),
                dst: self.client_addr,
            },
            ObservedWebSocketStream::new(
                server_stream,
                WebSocketSide::Server,
                Arc::clone(&lifecycle),
            ),
            ObservedWebSocketSink::new(client_sink, WebSocketSide::Client, Arc::clone(&lifecycle)),
        );

        tokio::pin!(client_to_server);
        tokio::pin!(server_to_client);
        let client_finished_first = tokio::select! {
            _ = &mut client_to_server => true,
            _ = &mut server_to_client => false,
        };
        if lifecycle.close_handshake_started() {
            let timeout = std::time::Duration::from_secs(10);
            let remaining = if client_finished_first {
                tokio::time::timeout(timeout, &mut server_to_client).await
            } else {
                tokio::time::timeout(timeout, &mut client_to_server).await
            };
            if remaining.is_err() {
                lifecycle.fail();
            }
        }

        lifecycle.is_clean()
    }

    #[instrument(skip_all)]
    async fn serve_stream<I>(
        self,
        stream: I,
        scheme: Scheme,
        authority: Authority,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>>
    where
        I: hyper::rt::Read + hyper::rt::Write + Unpin + Send + 'static,
    {
        let service = service_fn(|mut req| {
            if req.version() == hyper::Version::HTTP_10 || req.version() == hyper::Version::HTTP_11
            {
                let (mut parts, body) = req.into_parts();

                parts.uri = {
                    let mut parts = parts.uri.into_parts();
                    parts.scheme = Some(scheme.clone());
                    parts.authority = Some(authority.clone());
                    Uri::from_parts(parts).expect("Failed to build URI")
                };

                req = Request::from_parts(parts, body);
            };

            self.clone().proxy(req)
        });

        self.server
            .serve_connection_with_upgrades(stream, service)
            .await
    }
}

#[derive(Default)]
struct WebSocketRelayLifecycle {
    client_close_received: AtomicBool,
    server_close_received: AtomicBool,
    client_close_forwarded: AtomicBool,
    server_close_forwarded: AtomicBool,
    failed: AtomicBool,
}

impl WebSocketRelayLifecycle {
    fn close_received(&self, side: WebSocketSide) {
        match side {
            WebSocketSide::Client => self.client_close_received.store(true, Ordering::Release),
            WebSocketSide::Server => self.server_close_received.store(true, Ordering::Release),
        }
    }

    fn close_forwarded(&self, side: WebSocketSide) {
        match side {
            WebSocketSide::Client => self.client_close_forwarded.store(true, Ordering::Release),
            WebSocketSide::Server => self.server_close_forwarded.store(true, Ordering::Release),
        }
    }

    fn fail(&self) {
        self.failed.store(true, Ordering::Release);
    }

    fn close_handshake_started(&self) -> bool {
        self.client_close_received.load(Ordering::Acquire)
            || self.server_close_received.load(Ordering::Acquire)
    }

    fn is_clean(&self) -> bool {
        self.client_close_received.load(Ordering::Acquire)
            && self.server_close_received.load(Ordering::Acquire)
            && self.client_close_forwarded.load(Ordering::Acquire)
            && self.server_close_forwarded.load(Ordering::Acquire)
            && !self.failed.load(Ordering::Acquire)
    }
}

#[derive(Clone, Copy)]
enum WebSocketSide {
    Client,
    Server,
}

struct ObservedWebSocketStream<S> {
    inner: S,
    side: WebSocketSide,
    lifecycle: Arc<WebSocketRelayLifecycle>,
}

impl<S> ObservedWebSocketStream<S> {
    fn new(inner: S, side: WebSocketSide, lifecycle: Arc<WebSocketRelayLifecycle>) -> Self {
        Self {
            inner,
            side,
            lifecycle,
        }
    }
}

impl<S> Stream for ObservedWebSocketStream<S>
where
    S: Stream<Item = Result<Message, tungstenite::Error>> + Unpin,
{
    type Item = Result<Message, tungstenite::Error>;

    fn poll_next(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let result = Pin::new(&mut self.inner).poll_next(context);
        match &result {
            Poll::Ready(Some(Ok(Message::Close(_)))) => {
                self.lifecycle.close_received(self.side);
            }
            Poll::Ready(Some(Err(error))) if !normal_websocket_close(&error) => {
                self.lifecycle.fail();
            }
            _ => {}
        }
        result
    }
}

struct ObservedWebSocketSink<S> {
    inner: S,
    side: WebSocketSide,
    lifecycle: Arc<WebSocketRelayLifecycle>,
}

impl<S> ObservedWebSocketSink<S> {
    fn new(inner: S, side: WebSocketSide, lifecycle: Arc<WebSocketRelayLifecycle>) -> Self {
        Self {
            inner,
            side,
            lifecycle,
        }
    }
}

impl<S> Sink<Message> for ObservedWebSocketSink<S>
where
    S: Sink<Message, Error = tungstenite::Error> + Unpin,
{
    type Error = tungstenite::Error;

    fn poll_ready(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Result<(), Self::Error>> {
        let result = Pin::new(&mut self.inner).poll_ready(context);
        if matches!(&result, Poll::Ready(Err(error)) if !normal_websocket_close(error)) {
            self.lifecycle.fail();
        }
        result
    }

    fn start_send(mut self: Pin<&mut Self>, item: Message) -> Result<(), Self::Error> {
        let is_close = matches!(item, Message::Close(_));
        let result = Pin::new(&mut self.inner).start_send(item);
        match &result {
            Ok(()) if is_close => self.lifecycle.close_forwarded(self.side),
            Err(error) if !normal_websocket_close(error) => self.lifecycle.fail(),
            _ => {}
        }
        result
    }

    fn poll_flush(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Result<(), Self::Error>> {
        let result = Pin::new(&mut self.inner).poll_flush(context);
        if matches!(&result, Poll::Ready(Err(error)) if !normal_websocket_close(error)) {
            self.lifecycle.fail();
        }
        result
    }

    fn poll_close(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<Result<(), Self::Error>> {
        let result = Pin::new(&mut self.inner).poll_close(context);
        if matches!(&result, Poll::Ready(Err(error)) if !normal_websocket_close(error)) {
            self.lifecycle.fail();
        }
        result
    }
}

fn normal_websocket_close(error: &tungstenite::Error) -> bool {
    matches!(
        error,
        tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed
    )
}

#[instrument(skip_all)]
fn normalize_request<T>(mut req: Request<T>) -> Request<T> {
    // Hyper will automatically add a Host header if needed.
    req.headers_mut().remove(hyper::header::HOST);

    // HTTP/2 supports multiple cookie headers, but HTTP/1.x only supports one.
    if let Entry::Occupied(mut cookies) = req.headers_mut().entry(hyper::header::COOKIE) {
        let joined_cookies = bstr::join(b"; ", cookies.iter());
        cookies.insert(joined_cookies.try_into().expect("Failed to join cookies"));
    }

    *req.version_mut() = hyper::Version::HTTP_11;
    req
}

#[cfg(test)]
mod tests {
    use super::*;
    use hyper_util::client::legacy::connect::HttpConnector;
    use tokio_rustls::rustls::ServerConfig;

    struct CA;

    impl CertificateAuthority for CA {
        async fn gen_server_config(&self, _authority: &Authority) -> Arc<ServerConfig> {
            unimplemented!();
        }
    }

    fn build_proxy() -> InternalProxy<HttpConnector, CA, crate::NoopHandler, crate::NoopHandler> {
        InternalProxy {
            ca: Arc::new(CA),
            client: Client::builder(TokioExecutor::new()).build(HttpConnector::new()),
            server: server::conn::auto::Builder::new(TokioExecutor::new()),
            http_handler: crate::NoopHandler::new(),
            websocket_handler: crate::NoopHandler::new(),
            websocket_connector: None,
            client_addr: "127.0.0.1:8080".parse().unwrap(),
            connection_id: 1,
            client_stream_hook: crate::NoopClientStreamHook,
        }
    }

    mod bad_request {
        use super::*;

        #[test]
        fn correct_status() {
            let res = bad_request();
            assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        }
    }

    mod normalize_request {
        use super::*;

        #[test]
        fn removes_host_header() {
            let req = Request::builder()
                .uri("http://example.com/")
                .header(hyper::header::HOST, "example.com")
                .body(())
                .unwrap();

            let req = normalize_request(req);

            assert_eq!(req.headers().get(hyper::header::HOST), None);
        }

        #[test]
        fn joins_cookies() {
            let req = Request::builder()
                .uri("http://example.com/")
                .header(hyper::header::COOKIE, "foo=bar")
                .header(hyper::header::COOKIE, "baz=qux")
                .body(())
                .unwrap();

            let req = normalize_request(req);

            assert_eq!(
                req.headers().get_all(hyper::header::COOKIE).iter().count(),
                1
            );

            assert_eq!(
                req.headers().get(hyper::header::COOKIE),
                Some(&"foo=bar; baz=qux".parse().unwrap())
            );
        }
    }

    mod process_connect {
        use super::*;

        #[test]
        fn returns_bad_request_if_missing_authority() {
            let proxy = build_proxy();

            let req = Request::builder()
                .uri("/foo/bar?baz")
                .body(Body::empty())
                .unwrap();

            let res = proxy.process_connect(req);

            assert_eq!(res.status(), StatusCode::BAD_REQUEST)
        }
    }

    mod upgrade_websocket {
        use super::*;

        #[test]
        fn returns_bad_request_if_missing_authority() {
            let proxy = build_proxy();

            let req = Request::builder()
                .uri("/foo/bar?baz")
                .body(Body::empty())
                .unwrap();

            let res = proxy.upgrade_websocket(req);

            assert_eq!(res.status(), StatusCode::BAD_REQUEST)
        }

        #[test]
        fn returns_bad_request_if_missing_headers() {
            let proxy = build_proxy();

            let req = Request::builder()
                .uri("http://example.com/foo/bar?baz")
                .body(Body::empty())
                .unwrap();

            let res = proxy.upgrade_websocket(req);

            assert_eq!(res.status(), StatusCode::BAD_REQUEST)
        }
    }
}
