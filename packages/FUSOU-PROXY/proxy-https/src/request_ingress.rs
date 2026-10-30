use http_body_util::BodyExt;
use hyper::body::{Body, Bytes};
use std::{fmt, sync::Arc, time::Duration};
use tokio::{
    sync::{OwnedSemaphorePermit, Semaphore},
    time::{timeout_at, Instant},
};
use tokio_util::bytes::BytesMut;

const MAX_BODY_BYTES: usize = 1024 * 1024;
const IDLE_TIMEOUT: Duration = Duration::from_secs(10);
const COMPLETION_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_COLLECTORS: usize = 8;

#[derive(Clone)]
pub(crate) struct RequestIngress {
    slots: Arc<Semaphore>,
    max_bytes: usize,
    idle_timeout: Duration,
    completion_timeout: Duration,
}

pub(crate) struct CollectedRequest {
    pub(crate) bytes: Bytes,
    _reservation: Option<OwnedSemaphorePermit>,
}

impl CollectedRequest {
    pub(crate) fn unbounded(bytes: Bytes) -> Self {
        Self {
            bytes,
            _reservation: None,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum IngressError {
    Busy,
    TooLarge,
    IdleTimeout,
    CompletionTimeout,
    ReadFailed,
}

impl IngressError {
    pub(crate) fn status(&self) -> http::StatusCode {
        match self {
            Self::Busy => http::StatusCode::SERVICE_UNAVAILABLE,
            Self::TooLarge => http::StatusCode::PAYLOAD_TOO_LARGE,
            Self::IdleTimeout | Self::CompletionTimeout => http::StatusCode::REQUEST_TIMEOUT,
            Self::ReadFailed => http::StatusCode::BAD_REQUEST,
        }
    }
}

impl fmt::Display for IngressError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Busy => "request ingress collection capacity exhausted",
            Self::TooLarge => "request body exceeds ingress size limit",
            Self::IdleTimeout => "request body ingress idle timeout",
            Self::CompletionTimeout => "request body ingress completion timeout",
            Self::ReadFailed => "request body ingress read failed",
        })
    }
}

impl Default for RequestIngress {
    fn default() -> Self {
        Self {
            slots: Arc::new(Semaphore::new(MAX_COLLECTORS)),
            max_bytes: MAX_BODY_BYTES,
            idle_timeout: IDLE_TIMEOUT,
            completion_timeout: COMPLETION_TIMEOUT,
        }
    }
}

impl RequestIngress {
    pub(crate) async fn collect<B>(&self, mut body: B) -> Result<CollectedRequest, IngressError>
    where
        B: Body<Data = Bytes> + Unpin,
    {
        let reservation = self
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| IngressError::Busy)?;
        if body.size_hint().lower() > self.max_bytes as u64 {
            return Err(IngressError::TooLarge);
        }
        let deadline = Instant::now() + self.completion_timeout;
        let mut bytes = BytesMut::new();
        loop {
            let idle_deadline = Instant::now() + self.idle_timeout;
            let frame = timeout_at(deadline.min(idle_deadline), body.frame())
                .await
                .map_err(|_| {
                    if Instant::now() >= deadline {
                        IngressError::CompletionTimeout
                    } else {
                        IngressError::IdleTimeout
                    }
                })?;
            if Instant::now() >= deadline {
                return Err(IngressError::CompletionTimeout);
            }
            let Some(frame) = frame else {
                return Ok(CollectedRequest {
                    bytes: bytes.freeze(),
                    _reservation: Some(reservation),
                });
            };
            let frame = frame.map_err(|_| IngressError::ReadFailed)?;
            if let Ok(data) = frame.into_data() {
                if data.len() > self.max_bytes - bytes.len() {
                    return Err(IngressError::TooLarge);
                }
                bytes.extend_from_slice(&data);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hyper::body::Frame;
    use std::{
        collections::VecDeque,
        convert::Infallible,
        pin::Pin,
        task::{Context, Poll},
    };

    struct Frames(VecDeque<Result<Frame<Bytes>, Infallible>>);

    impl Body for Frames {
        type Data = Bytes;
        type Error = Infallible;
        fn poll_frame(
            mut self: Pin<&mut Self>,
            _: &mut Context<'_>,
        ) -> Poll<Option<Result<Frame<Bytes>, Infallible>>> {
            Poll::Ready(self.0.pop_front())
        }
    }

    struct PendingBody;
    impl Body for PendingBody {
        type Data = Bytes;
        type Error = Infallible;
        fn poll_frame(
            self: Pin<&mut Self>,
            _: &mut Context<'_>,
        ) -> Poll<Option<Result<Frame<Bytes>, Infallible>>> {
            Poll::Pending
        }
    }

    fn policy() -> RequestIngress {
        RequestIngress {
            slots: Arc::new(Semaphore::new(1)),
            max_bytes: 4,
            idle_timeout: Duration::from_millis(10),
            completion_timeout: Duration::from_millis(100),
        }
    }

    #[tokio::test]
    async fn reserves_before_read_and_holds_capacity_until_collected_body_is_dropped() {
        let ingress = policy();
        let collected = ingress
            .collect(http_body_util::Full::new(Bytes::from_static(b"1234")))
            .await
            .unwrap();
        assert_eq!(collected.bytes.as_ref(), b"1234");
        let another_handler = ingress.clone();
        assert!(matches!(
            another_handler.collect(PendingBody).await,
            Err(IngressError::Busy)
        ));
        drop(collected);
        assert_eq!(ingress.slots.available_permits(), 1);
    }

    #[tokio::test]
    async fn declared_and_streamed_oversize_are_rejected_without_retaining_a_slot() {
        let ingress = policy();
        assert!(matches!(
            ingress
                .collect(http_body_util::Full::new(Bytes::from_static(b"12345")))
                .await,
            Err(IngressError::TooLarge)
        ));
        let frames = Frames(VecDeque::from([
            Ok(Frame::data(Bytes::from_static(b"123"))),
            Ok(Frame::data(Bytes::from_static(b"45"))),
        ]));
        assert!(matches!(
            ingress.collect(frames).await,
            Err(IngressError::TooLarge)
        ));
        assert_eq!(ingress.slots.available_permits(), 1);
    }

    #[tokio::test]
    async fn idle_and_absolute_completion_timeouts_are_distinct() {
        let mut ingress = policy();
        assert!(matches!(
            ingress.collect(PendingBody).await,
            Err(IngressError::IdleTimeout)
        ));
        ingress.completion_timeout = Duration::from_millis(1);
        assert!(matches!(
            ingress.collect(PendingBody).await,
            Err(IngressError::CompletionTimeout)
        ));
        assert_eq!(ingress.slots.available_permits(), 1);
    }

    #[tokio::test]
    async fn cancellation_drops_the_collector_and_returns_its_reservation() {
        let ingress = policy();
        let collector = ingress.clone();
        let task = tokio::spawn(async move { collector.collect(PendingBody).await });
        tokio::task::yield_now().await;
        assert_eq!(ingress.slots.available_permits(), 0);
        task.abort();
        assert!(matches!(task.await, Err(error) if error.is_cancelled()));
        assert_eq!(ingress.slots.available_permits(), 1);
    }

    #[tokio::test]
    async fn progress_cannot_reset_the_absolute_body_completion_deadline() {
        let mut ingress = policy();
        ingress.max_bytes = 1024;
        ingress.idle_timeout = Duration::from_secs(1);
        ingress.completion_timeout = Duration::from_millis(30);
        let stream = hudsucker::futures::stream::unfold((), |()| async {
            tokio::time::sleep(Duration::from_millis(5)).await;
            Some((Ok::<_, std::io::Error>(Bytes::from_static(b"x")), ()))
        });
        assert!(matches!(
            ingress.collect(hudsucker::Body::from_stream(stream)).await,
            Err(IngressError::CompletionTimeout)
        ));
        assert_eq!(ingress.slots.available_permits(), 1);
    }
}
