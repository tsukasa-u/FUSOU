use crate::capture::{CaptureError, ExactWireCapture, ExactWireMessage};
use std::{
    fmt, io,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    task::{Context, Poll},
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureDirection {
    Request,
    Response,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CaptureLimits {
    pub request_bytes: Option<usize>,
    pub response_bytes: Option<usize>,
}

#[derive(Debug)]
pub enum CaptureIoError {
    RecorderPoisoned,
    CaptureUnavailable,
    LimitExceeded {
        direction: CaptureDirection,
        limit: usize,
        attempted: usize,
    },
    ExactWire(CaptureError),
}

impl fmt::Display for CaptureIoError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RecorderPoisoned => formatter.write_str("capture recorder lock poisoned"),
            Self::CaptureUnavailable => formatter.write_str("capture recorder unavailable"),
            Self::LimitExceeded {
                direction,
                limit,
                attempted,
            } => write!(
                formatter,
                "capture {direction:?} limit exceeded: limit={limit}, attempted={attempted}"
            ),
            Self::ExactWire(error) => write!(formatter, "exact-wire capture failed: {error}"),
        }
    }
}

impl std::error::Error for CaptureIoError {}

impl From<CaptureIoError> for io::Error {
    fn from(error: CaptureIoError) -> Self {
        Self::new(io::ErrorKind::Other, error)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureSnapshot {
    request: Vec<u8>,
    response: Vec<u8>,
}

impl CaptureSnapshot {
    pub fn request_bytes(&self) -> &[u8] {
        &self.request
    }

    pub fn response_bytes(&self) -> &[u8] {
        &self.response
    }

    pub fn request_len(&self) -> usize {
        self.request.len()
    }

    pub fn response_len(&self) -> usize {
        self.response.len()
    }
}

#[derive(Debug, Default)]
struct RecorderState {
    request: Vec<u8>,
    response: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct CaptureRecorder {
    state: Arc<Mutex<RecorderState>>,
    limits: CaptureLimits,
    unavailable: Arc<AtomicBool>,
}

impl CaptureRecorder {
    pub fn new() -> Self {
        Self::with_limits(CaptureLimits::default())
    }

    pub fn with_limits(limits: CaptureLimits) -> Self {
        Self {
            state: Arc::new(Mutex::new(RecorderState::default())),
            limits,
            unavailable: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn snapshot(&self) -> Result<CaptureSnapshot, CaptureIoError> {
        self.ensure_available()?;
        let state = self.state.lock().map_err(|_| {
            self.mark_unavailable();
            CaptureIoError::RecorderPoisoned
        })?;
        Ok(CaptureSnapshot {
            request: state.request.clone(),
            response: state.response.clone(),
        })
    }

    pub fn exact_wire_capture(&self) -> Result<ExactWireCapture, CaptureIoError> {
        let snapshot = self.snapshot()?;
        let request =
            ExactWireMessage::from_bytes(snapshot.request, 0).map_err(CaptureIoError::ExactWire)?;
        let response =
            ExactWireMessage::from_bytes(snapshot.response, request.bytes().len() as u64)
                .map_err(CaptureIoError::ExactWire)?;
        Ok(ExactWireCapture::new(request, response))
    }

    fn record(&self, direction: CaptureDirection, bytes: &[u8]) -> Result<(), CaptureIoError> {
        if bytes.is_empty() {
            return Ok(());
        }

        self.ensure_available()?;
        let mut state = self.state.lock().map_err(|_| {
            self.mark_unavailable();
            CaptureIoError::RecorderPoisoned
        })?;
        let (captured, limit) = match direction {
            CaptureDirection::Request => (&mut state.request, self.limits.request_bytes),
            CaptureDirection::Response => (&mut state.response, self.limits.response_bytes),
        };
        let attempted =
            captured
                .len()
                .checked_add(bytes.len())
                .ok_or(CaptureIoError::LimitExceeded {
                    direction,
                    limit: usize::MAX,
                    attempted: usize::MAX,
                })?;
        if let Some(limit) = limit {
            if attempted > limit {
                return Err(CaptureIoError::LimitExceeded {
                    direction,
                    limit,
                    attempted,
                });
            }
        }
        captured.extend_from_slice(bytes);
        Ok(())
    }

    fn ensure_available(&self) -> Result<(), CaptureIoError> {
        if self.unavailable.load(Ordering::SeqCst) {
            return Err(CaptureIoError::CaptureUnavailable);
        }
        Ok(())
    }

    fn ensure_capacity(
        &self,
        direction: CaptureDirection,
        additional: usize,
    ) -> Result<(), CaptureIoError> {
        self.ensure_available()?;
        let state = self.state.lock().map_err(|_| {
            self.mark_unavailable();
            CaptureIoError::RecorderPoisoned
        })?;
        let (captured, limit) = match direction {
            CaptureDirection::Request => (&state.request, self.limits.request_bytes),
            CaptureDirection::Response => (&state.response, self.limits.response_bytes),
        };
        let attempted =
            captured
                .len()
                .checked_add(additional)
                .ok_or(CaptureIoError::LimitExceeded {
                    direction,
                    limit: usize::MAX,
                    attempted: usize::MAX,
                })?;
        if let Some(limit) = limit {
            if attempted > limit {
                return Err(CaptureIoError::LimitExceeded {
                    direction,
                    limit,
                    attempted,
                });
            }
        }
        Ok(())
    }

    fn mark_unavailable(&self) {
        self.unavailable.store(true, Ordering::SeqCst);
    }
}

impl Default for CaptureRecorder {
    fn default() -> Self {
        Self::new()
    }
}

pub struct CaptureIo<IO> {
    inner: IO,
    recorder: CaptureRecorder,
}

impl<IO> CaptureIo<IO> {
    pub fn new(inner: IO, recorder: CaptureRecorder) -> Self {
        Self { inner, recorder }
    }

    pub fn recorder(&self) -> &CaptureRecorder {
        &self.recorder
    }

    pub fn into_inner(self) -> IO {
        self.inner
    }

    pub fn into_hyper_io(self) -> hudsucker::hyper_util::rt::TokioIo<Self>
    where
        IO: AsyncRead + AsyncWrite,
    {
        hudsucker::hyper_util::rt::TokioIo::new(self)
    }
}

impl<IO> AsyncRead for CaptureIo<IO>
where
    IO: AsyncRead + AsyncWrite + Unpin,
{
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let filled_before = buffer.filled().len();
        let result = Pin::new(&mut self.inner).poll_read(context, buffer);
        if let Poll::Ready(Ok(())) = &result {
            let filled_after = buffer.filled().len();
            if filled_after > filled_before {
                let bytes = buffer.filled()[filled_before..filled_after].to_vec();
                if let Err(error) = self.recorder.record(CaptureDirection::Request, &bytes) {
                    return Poll::Ready(Err(error.into()));
                }
            }
        }
        result
    }
}

impl<IO> AsyncWrite for CaptureIo<IO>
where
    IO: AsyncRead + AsyncWrite + Unpin,
{
    fn poll_write(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<io::Result<usize>> {
        if let Err(error) = self
            .recorder
            .ensure_capacity(CaptureDirection::Response, bytes.len())
        {
            return Poll::Ready(Err(error.into()));
        }
        let result = Pin::new(&mut self.inner).poll_write(context, bytes);
        if let Poll::Ready(Ok(written)) = result {
            if let Err(error) = self
                .recorder
                .record(CaptureDirection::Response, &bytes[..written])
            {
                self.recorder.mark_unavailable();
                tracing::error!(error = %error, written, "capture failed after response bytes were forwarded");
                return Poll::Ready(Ok(written));
            }
            return Poll::Ready(Ok(written));
        }
        result
    }

    fn poll_write_vectored(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffers: &[io::IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        let requested = match buffers
            .iter()
            .try_fold(0usize, |total, buffer| total.checked_add(buffer.len()))
        {
            Some(requested) => requested,
            None => {
                return Poll::Ready(Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "vectored write length overflow",
                )))
            }
        };
        if let Err(error) = self
            .recorder
            .ensure_capacity(CaptureDirection::Response, requested)
        {
            return Poll::Ready(Err(error.into()));
        }
        let result = Pin::new(&mut self.inner).poll_write_vectored(context, buffers);
        if let Poll::Ready(Ok(written)) = result {
            let mut remaining = written;
            let mut captured = Vec::with_capacity(written);
            for buffer in buffers {
                let length = remaining.min(buffer.len());
                captured.extend_from_slice(&buffer[..length]);
                remaining -= length;
                if remaining == 0 {
                    break;
                }
            }
            if remaining != 0 {
                return Poll::Ready(Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "underlying vectored write exceeded supplied buffers",
                )));
            }
            if let Err(error) = self.recorder.record(CaptureDirection::Response, &captured) {
                self.recorder.mark_unavailable();
                tracing::error!(error = %error, written, "capture failed after response bytes were forwarded");
                return Poll::Ready(Ok(written));
            }
            return Poll::Ready(Ok(written));
        }
        result
    }

    fn poll_flush(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        if let Err(error) = self.recorder.ensure_available() {
            return Poll::Ready(Err(error.into()));
        }
        Pin::new(&mut self.get_mut().inner).poll_flush(context)
    }

    fn poll_shutdown(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
        if let Err(error) = self.recorder.ensure_available() {
            return Poll::Ready(Err(error.into()));
        }
        Pin::new(&mut self.get_mut().inner).poll_shutdown(context)
    }

    fn is_write_vectored(&self) -> bool {
        self.inner.is_write_vectored()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn unique_temp_dir(name: &str) -> std::path::PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("fusou_capture_io_{name}_{timestamp}"))
    }

    struct PoisoningWriter {
        inner: tokio::io::DuplexStream,
        recorder: CaptureRecorder,
        poisoned: bool,
    }

    impl AsyncRead for PoisoningWriter {
        fn poll_read(
            mut self: Pin<&mut Self>,
            context: &mut Context<'_>,
            buffer: &mut ReadBuf<'_>,
        ) -> Poll<io::Result<()>> {
            Pin::new(&mut self.inner).poll_read(context, buffer)
        }
    }

    impl AsyncWrite for PoisoningWriter {
        fn poll_write(
            mut self: Pin<&mut Self>,
            context: &mut Context<'_>,
            bytes: &[u8],
        ) -> Poll<io::Result<usize>> {
            if !self.poisoned {
                self.poisoned = true;
                let recorder = self.recorder.clone();
                let _ = std::thread::spawn(move || {
                    let _guard = recorder.state.lock().expect("lock recorder");
                    panic!("poison recorder for post-write failure test");
                })
                .join();
            }
            Pin::new(&mut self.inner).poll_write(context, bytes)
        }

        fn poll_flush(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<io::Result<()>> {
            Pin::new(&mut self.inner).poll_flush(context)
        }

        fn poll_shutdown(
            mut self: Pin<&mut Self>,
            context: &mut Context<'_>,
        ) -> Poll<io::Result<()>> {
            Pin::new(&mut self.inner).poll_shutdown(context)
        }
    }

    #[tokio::test]
    async fn preserves_request_and_response_bytes_with_directional_separation() {
        let (mut client, server) = tokio::io::duplex(4096);
        let recorder = CaptureRecorder::new();
        let mut captured = CaptureIo::new(server, recorder.clone());
        let request = b"POST /require_info HTTP/1.1\r\nHost: game.example\r\n\r\nbody";
        let response = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok";

        client.write_all(request).await.expect("write request");
        let mut received_request = vec![0; request.len()];
        captured
            .read_exact(&mut received_request)
            .await
            .expect("read request");
        captured.write_all(response).await.expect("write response");
        let mut received_response = vec![0; response.len()];
        client
            .read_exact(&mut received_response)
            .await
            .expect("read response");

        let snapshot = recorder.snapshot().expect("snapshot");
        assert_eq!(received_request, request);
        assert_eq!(received_response, response);
        assert_eq!(snapshot.request_bytes(), request);
        assert_eq!(snapshot.response_bytes(), response);
        assert_eq!(snapshot.request_len(), request.len());
        assert_eq!(snapshot.response_len(), response.len());
    }

    #[tokio::test]
    async fn exact_wire_output_preserves_boundaries_for_existing_harness() {
        let (mut client, server) = tokio::io::duplex(4096);
        let recorder = CaptureRecorder::new();
        let mut captured = CaptureIo::new(server, recorder.clone());
        let request = b"GET /require_info HTTP/1.1\r\nHost: game.example\r\n\r\n";
        let response = b"HTTP/1.1 204 No Content\r\n\r\n";

        client.write_all(request).await.expect("write request");
        let mut request_buffer = vec![0; request.len()];
        captured
            .read_exact(&mut request_buffer)
            .await
            .expect("read request");
        captured.write_all(response).await.expect("write response");
        let mut response_buffer = vec![0; response.len()];
        client
            .read_exact(&mut response_buffer)
            .await
            .expect("read response");

        let root = unique_temp_dir("exact_wire");
        let capture_dir = recorder
            .exact_wire_capture()
            .expect("exact wire capture")
            .write_private_raw(&root, "capture-1")
            .expect("write artifact");
        let verification = crate::capture::verify_capture(&capture_dir).expect("verify artifact");
        assert_eq!(
            fs::read(capture_dir.join("request-wire.bin")).unwrap(),
            request
        );
        assert_eq!(
            fs::read(capture_dir.join("response-wire.bin")).unwrap(),
            response
        );
        assert!(!verification.complete_artifact_sha256.is_empty());
        fs::remove_dir_all(root).expect("remove temporary artifact");
    }

    #[tokio::test]
    async fn does_not_replay_request_bytes() {
        let (mut client, server) = tokio::io::duplex(4096);
        let recorder = CaptureRecorder::new();
        let mut captured = CaptureIo::new(server, recorder.clone());
        let request = b"POST /require_info HTTP/1.1\r\nContent-Length: 0\r\n\r\n";

        client.write_all(request).await.expect("write request once");
        let mut received = vec![0; request.len()];
        captured
            .read_exact(&mut received)
            .await
            .expect("read request");
        assert_eq!(received, request);
        assert_eq!(recorder.snapshot().unwrap().request_bytes(), request);
    }

    #[tokio::test]
    async fn handles_connection_close_without_replaying_or_losing_bytes() {
        let (mut client, server) = tokio::io::duplex(4096);
        let recorder = CaptureRecorder::new();
        let mut captured = CaptureIo::new(server, recorder.clone());
        let request = b"GET /require_info HTTP/1.1\r\nHost: game.example\r\n\r\n";

        client.write_all(request).await.expect("write request");
        client.shutdown().await.expect("close client write side");
        let mut received = Vec::new();
        captured
            .read_to_end(&mut received)
            .await
            .expect("read until close");
        assert_eq!(received, request);
        assert_eq!(recorder.snapshot().unwrap().request_bytes(), request);
    }

    #[tokio::test]
    async fn failed_tls_handshake_never_enters_plaintext_capture() {
        let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
        let certified = rcgen::generate_simple_self_signed(vec!["localhost".to_string()])
            .expect("generate test certificate");
        let certificate =
            tokio_rustls::rustls::pki_types::CertificateDer::from(certified.cert.der().to_vec());
        let private_key = tokio_rustls::rustls::pki_types::PrivateKeyDer::Pkcs8(
            tokio_rustls::rustls::pki_types::PrivatePkcs8KeyDer::from(
                certified.key_pair.serialize_der(),
            ),
        );
        let config = tokio_rustls::rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![certificate], private_key)
            .expect("build TLS config");
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let (mut client, server) = tokio::io::duplex(4096);
        let recorder = CaptureRecorder::new();
        let recorder_for_handshake = recorder.clone();
        let handshake = tokio::spawn(async move {
            acceptor
                .accept(server)
                .await
                .map(|plaintext| CaptureIo::new(plaintext, recorder_for_handshake))
        });

        client
            .write_all(b"not a TLS handshake")
            .await
            .expect("write invalid TLS");
        client.shutdown().await.expect("close invalid TLS stream");
        assert!(handshake.await.expect("join handshake").is_err());
        assert_eq!(recorder.snapshot().unwrap().request_len(), 0);
        assert_eq!(recorder.snapshot().unwrap().response_len(), 0);
    }

    #[tokio::test]
    async fn hyper_parse_failure_keeps_received_bytes_without_forwarding() {
        use http_body_util::Full;
        use hudsucker::{
            hyper::{body::Bytes, server::conn::http1, service::service_fn, Response},
            hyper_util::rt::TokioIo,
        };
        use std::convert::Infallible;
        use std::sync::atomic::{AtomicBool, Ordering};

        let (mut client, server) = tokio::io::duplex(4096);
        let recorder = CaptureRecorder::new();
        let captured = CaptureIo::new(server, recorder.clone());
        let service_called = Arc::new(AtomicBool::new(false));
        let service_called_by_handler = Arc::clone(&service_called);
        let service = service_fn(move |_request| {
            service_called_by_handler.store(true, Ordering::SeqCst);
            async { Ok::<_, Infallible>(Response::new(Full::new(Bytes::new()))) }
        });
        let connection = http1::Builder::new().serve_connection(TokioIo::new(captured), service);
        let task = tokio::spawn(connection);
        let invalid_request = b"NOT HTTP\r\n\r\n";
        client
            .write_all(invalid_request)
            .await
            .expect("write invalid HTTP");
        client.shutdown().await.expect("close invalid HTTP stream");

        assert!(task.await.expect("join HTTP task").is_err());
        let snapshot = recorder.snapshot().expect("snapshot");
        assert_eq!(snapshot.request_bytes(), invalid_request);
        assert!(snapshot.response_bytes().starts_with(b"HTTP/1.1 400"));
        assert!(!service_called.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn capture_limit_rejects_before_forwarding() {
        let (mut client, server) = tokio::io::duplex(4096);
        let recorder = CaptureRecorder::with_limits(CaptureLimits {
            request_bytes: None,
            response_bytes: Some(0),
        });
        let mut captured = CaptureIo::new(server, recorder.clone());
        let response = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok";

        assert!(captured.write_all(response).await.is_err());
        drop(captured);
        let mut received = Vec::new();
        client
            .read_to_end(&mut received)
            .await
            .expect("read closed stream");
        assert!(received.is_empty());
        assert!(recorder.snapshot().unwrap().response_bytes().is_empty());
    }

    #[tokio::test]
    async fn post_write_capture_failure_does_not_retry_forwarded_response() {
        let (mut client, inner) = tokio::io::duplex(4096);
        let recorder = CaptureRecorder::new();
        let poisoned = PoisoningWriter {
            inner,
            recorder: recorder.clone(),
            poisoned: false,
        };
        let mut captured = CaptureIo::new(poisoned, recorder.clone());
        let response = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok";

        captured
            .write_all(response)
            .await
            .expect("forward response once");
        let mut received = vec![0; response.len()];
        client
            .read_exact(&mut received)
            .await
            .expect("read exactly one forwarded response");
        assert_eq!(received, response);
        assert!(recorder.snapshot().is_err());
        assert!(captured.write_all(b"second response").await.is_err());
    }
}
