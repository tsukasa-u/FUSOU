#![cfg(feature = "grpc")]

use crate::channel_types::StatusInfo;
use once_cell::sync::OnceCell;
use std::marker::PhantomData;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::mpsc::error::{SendError, SendTimeoutError};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};
use tonic::transport::Channel as GrpcTransport;
use tonic::{Request, Status};

use tracing::{error, info};

pub mod proto {
    tonic::include_proto!("fusou.channel");
}

use proto::channel_client::ChannelClient;
use proto::channel_server::{Channel, ChannelServer};
use proto::{Direction, StatusInfo as ProtoStatusInfo, StatusMessage, SubscribeRequest};

const DEFAULT_ENDPOINT: &str = "http://127.0.0.1:50061";
const ENV_ENDPOINT: &str = "FUSOU_CHANNEL_ENDPOINT";
const DEFAULT_BUFFER: usize = 128;

pub trait GrpcPayload: Clone + Send + Sync + 'static {
    fn to_proto(&self) -> ProtoStatusInfo;
    fn from_proto(message: ProtoStatusInfo) -> Result<Self, Status>
    where
        Self: Sized;
}

impl GrpcPayload for StatusInfo {
    fn to_proto(&self) -> ProtoStatusInfo {
        match self {
            StatusInfo::HEALTH { status, message } => ProtoStatusInfo {
                kind: Some(proto::status_info::Kind::Health(proto::Health {
                    status: status.clone(),
                    message: message.clone(),
                })),
            },
            StatusInfo::SHUTDOWN { status, message } => ProtoStatusInfo {
                kind: Some(proto::status_info::Kind::Shutdown(proto::Shutdown {
                    status: status.clone(),
                    message: message.clone(),
                })),
            },
            StatusInfo::RESPONSE {
                path,
                content_type,
                content,
            } => ProtoStatusInfo {
                kind: Some(proto::status_info::Kind::Response(proto::Response {
                    path: path.clone(),
                    content_type: content_type.clone(),
                    content: content.clone(),
                })),
            },
            StatusInfo::REQUEST {
                path,
                content_type,
                content,
            } => ProtoStatusInfo {
                kind: Some(proto::status_info::Kind::Request(proto::Request {
                    path: path.clone(),
                    content_type: content_type.clone(),
                    content: content.clone(),
                })),
            },
        }
    }

    fn from_proto(message: ProtoStatusInfo) -> Result<Self, Status> {
        match message.kind {
            Some(proto::status_info::Kind::Health(value)) => Ok(StatusInfo::HEALTH {
                status: value.status,
                message: value.message,
            }),
            Some(proto::status_info::Kind::Shutdown(value)) => Ok(StatusInfo::SHUTDOWN {
                status: value.status,
                message: value.message,
            }),
            Some(proto::status_info::Kind::Response(value)) => Ok(StatusInfo::RESPONSE {
                path: value.path,
                content_type: value.content_type,
                content: value.content,
            }),
            Some(proto::status_info::Kind::Request(value)) => Ok(StatusInfo::REQUEST {
                path: value.path,
                content_type: value.content_type,
                content: value.content,
            }),
            None => Err(Status::invalid_argument("missing StatusInfo.kind")),
        }
    }
}

fn endpoint_uri() -> &'static str {
    static ENDPOINT: OnceCell<String> = OnceCell::new();
    ENDPOINT.get_or_init(|| {
        std::env::var(ENV_ENDPOINT).unwrap_or_else(|_| DEFAULT_ENDPOINT.to_string())
    })
}

#[derive(Clone)]
struct Participant<T: GrpcPayload> {
    endpoint: Arc<String>,
    send_direction: Direction,
    recv_direction: Direction,
    client: Arc<Mutex<Option<ChannelClient<GrpcTransport>>>>,
    recv_stream: Arc<Mutex<Option<tonic::Streaming<StatusMessage>>>>,
    _marker: PhantomData<T>,
}

impl<T: GrpcPayload> Participant<T> {
    fn new(send_direction: Direction, recv_direction: Direction) -> Self {
        Self {
            endpoint: Arc::new(endpoint_uri().to_string()),
            send_direction,
            recv_direction,
            client: Arc::new(Mutex::new(None)),
            recv_stream: Arc::new(Mutex::new(None)),
            _marker: PhantomData,
        }
    }

    async fn client(&self) -> Result<ChannelClient<GrpcTransport>, Status> {
        let mut guard = self.client.lock().await;
        if let Some(client) = guard.as_ref() {
            return Ok(client.clone());
        }
        let client = ChannelClient::connect(self.endpoint.as_str().to_string())
            .await
            .map_err(|err| Status::unavailable(format!("failed to connect gRPC channel: {err}")))?;
        *guard = Some(client.clone());
        Ok(client)
    }

    async fn send(&self, message: T) -> Result<(), SendError<T>> {
        let mut client = self
            .client()
            .await
            .map_err(|_| SendError(message.clone()))?;
        let request = StatusMessage {
            direction: self.send_direction as i32,
            payload: Some(message.to_proto()),
        };
        match client.send_status(Request::new(request)).await {
            Ok(_) => Ok(()),
            Err(err) => {
                error!("gRPC send_status error: {}", err);
                Err(SendError(message))
            }
        }
    }

    async fn ensure_stream(&self) -> Result<(), Status> {
        let needs_stream = { self.recv_stream.lock().await.is_none() };
        if !needs_stream {
            return Ok(());
        }
        let mut client = self.client().await?;
        let response = client
            .stream_status(Request::new(SubscribeRequest {
                direction: self.recv_direction as i32,
            }))
            .await?;
        let mut guard = self.recv_stream.lock().await;
        *guard = Some(response.into_inner());
        Ok(())
    }

    async fn recv(&self) -> Option<T> {
        loop {
            if let Err(err) = self.ensure_stream().await {
                error!("failed to prepare stream: {}", err);
                tokio::time::sleep(Duration::from_millis(200)).await;
                continue;
            }
            let stream = {
                let mut guard = self.recv_stream.lock().await;
                guard.take()
            };
            let Some(mut stream) = stream else {
                continue;
            };
            match stream.message().await {
                Ok(Some(message)) => {
                    let payload = match message.payload {
                        Some(payload) => payload,
                        None => continue,
                    };
                    match T::from_proto(payload) {
                        Ok(value) => {
                            let mut guard = self.recv_stream.lock().await;
                            *guard = Some(stream);
                            return Some(value);
                        }
                        Err(err) => {
                            error!("failed to decode payload: {}", err);
                            let mut guard = self.recv_stream.lock().await;
                            *guard = Some(stream);
                            continue;
                        }
                    }
                }
                Ok(None) => {
                    let mut guard = self.recv_stream.lock().await;
                    *guard = None;
                    return None;
                }
                Err(err) => {
                    error!("stream error: {}", err);
                    let mut guard = self.recv_stream.lock().await;
                    *guard = None;
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
            }
        }
    }
}

#[derive(Clone)]
pub struct Master<T>
where
    T: GrpcPayload,
{
    inner: Participant<T>,
}

impl<T> Master<T>
where
    T: GrpcPayload,
{
    pub async fn send(&self, message: T) -> Result<(), SendError<T>> {
        self.inner.send(message).await
    }

    pub async fn send_timeout(
        &self,
        message: T,
        timeout_ms: u64,
    ) -> Result<(), SendTimeoutError<T>> {
        let cloned = message.clone();
        match timeout(Duration::from_millis(timeout_ms), self.send(cloned)).await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(SendError(payload))) => Err(SendTimeoutError::Closed(payload)),
            Err(_) => Err(SendTimeoutError::Timeout(message)),
        }
    }

    pub async fn recv(&mut self) -> Option<T> {
        self.inner.recv().await
    }
}

#[derive(Clone)]
pub struct Slave<T>
where
    T: GrpcPayload,
{
    inner: Participant<T>,
}

impl<T> Slave<T>
where
    T: GrpcPayload,
{
    pub async fn send(&self, message: T) -> Result<(), SendError<T>> {
        self.inner.send(message).await
    }

    pub async fn send_timeout(
        &self,
        message: T,
        timeout_ms: u64,
    ) -> Result<(), SendTimeoutError<T>> {
        let cloned = message.clone();
        match timeout(Duration::from_millis(timeout_ms), self.send(cloned)).await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(SendError(payload))) => Err(SendTimeoutError::Closed(payload)),
            Err(_) => Err(SendTimeoutError::Timeout(message)),
        }
    }

    pub async fn recv(&mut self) -> Option<T> {
        self.inner.recv().await
    }
}

#[derive(Clone)]
pub struct BidirectionalChannel<T>
where
    T: GrpcPayload,
{
    pub master: Master<T>,
    pub slave: Slave<T>,
}

impl<T> BidirectionalChannel<T>
where
    T: GrpcPayload,
{
    pub fn new(_buffer: usize) -> Self {
        Self {
            master: Master {
                inner: Participant::new(Direction::MasterToSlave, Direction::SlaveToMaster),
            },
            slave: Slave {
                inner: Participant::new(Direction::SlaveToMaster, Direction::MasterToSlave),
            },
        }
    }

    pub fn clone_master(&self) -> Master<T> {
        self.master.clone()
    }

    pub fn clone_slave(&self) -> Slave<T> {
        self.slave.clone()
    }

    pub async fn clean_buffer(&mut self) {
        let _ = timeout(Duration::from_millis(50), self.slave.recv()).await;
        let _ = timeout(Duration::from_millis(50), self.master.recv()).await;
    }
}

pub async fn check_health(
    mut master: Master<StatusInfo>,
) -> Result<(), SendTimeoutError<StatusInfo>> {
    match master
        .send_timeout(
            StatusInfo::HEALTH {
                status: "RUNNING".to_string(),
                message: "".to_string(),
            },
            2000,
        )
        .await
    {
        Ok(_) => {
            info!("Sent health message over gRPC");
            match timeout(Duration::from_millis(2000), master.recv()).await {
                Ok(Some(_)) => Ok(()),
                Ok(None) => Err(SendTimeoutError::Timeout(StatusInfo::HEALTH {
                    status: "ERROR".to_string(),
                    message: "Health stream closed".to_string(),
                })),
                Err(_) => Err(SendTimeoutError::Timeout(StatusInfo::HEALTH {
                    status: "ERROR".to_string(),
                    message: "Health check failed with timeout".to_string(),
                })),
            }
        }
        Err(e) => Err(e),
    }
}

pub async fn request_shutdown(
    mut master: Master<StatusInfo>,
) -> Result<(), SendTimeoutError<StatusInfo>> {
    match master
        .send_timeout(
            StatusInfo::SHUTDOWN {
                status: "SHUTTING DOWN".to_string(),
                message: "".to_string(),
            },
            2000,
        )
        .await
    {
        Ok(_) => {
            info!("Sent shutdown message over gRPC");
            match timeout(Duration::from_millis(2000), master.recv()).await {
                Ok(Some(_)) => Ok(()),
                Ok(None) => Err(SendTimeoutError::Timeout(StatusInfo::SHUTDOWN {
                    status: "ERROR".to_string(),
                    message: "Shutdown stream closed".to_string(),
                })),
                Err(_) => Err(SendTimeoutError::Timeout(StatusInfo::SHUTDOWN {
                    status: "ERROR".to_string(),
                    message: "Shutdown failed with timeout".to_string(),
                })),
            }
        }
        Err(e) => Err(e),
    }
}

pub mod server {
    use super::*;
    use std::pin::Pin;
    use tokio::sync::broadcast;
    use tokio_stream::wrappers::errors::BroadcastStreamRecvError;
    use tokio_stream::wrappers::BroadcastStream;
    use tokio_stream::StreamExt;
    use tonic::transport::Server;
    use tonic::{Request, Response, Status};

    #[derive(Clone)]
    struct ChannelBroker {
        master_to_slave: broadcast::Sender<StatusMessage>,
        slave_to_master: broadcast::Sender<StatusMessage>,
    }

    impl ChannelBroker {
        fn new(buffer: usize) -> Self {
            let (master_to_slave, _) = broadcast::channel(buffer);
            let (slave_to_master, _) = broadcast::channel(buffer);
            Self {
                master_to_slave,
                slave_to_master,
            }
        }

        fn publish(&self, message: StatusMessage) -> Result<(), Status> {
            let direction = Direction::from_i32(message.direction)
                .ok_or_else(|| Status::invalid_argument("invalid direction"))?;
            let target = match direction {
                Direction::MasterToSlave => &self.master_to_slave,
                Direction::SlaveToMaster => &self.slave_to_master,
            };
            target
                .send(message)
                .map_err(|err| Status::internal(format!("broadcast send failed: {err}")))?;
            Ok(())
        }

        fn subscribe(&self, direction: Direction) -> broadcast::Receiver<StatusMessage> {
            match direction {
                Direction::MasterToSlave => self.master_to_slave.subscribe(),
                Direction::SlaveToMaster => self.slave_to_master.subscribe(),
            }
        }
    }

    #[derive(Clone)]
    pub struct ChannelService {
        broker: Arc<ChannelBroker>,
    }

    #[tonic::async_trait]
    impl Channel for ChannelService {
        async fn send_status(
            &self,
            request: Request<StatusMessage>,
        ) -> Result<Response<()>, Status> {
            self.broker.publish(request.into_inner())?;
            Ok(Response::new(()))
        }

        type StreamStatusStream = Pin<
            Box<dyn tokio_stream::Stream<Item = Result<StatusMessage, Status>> + Send + 'static>,
        >;

        async fn stream_status(
            &self,
            request: Request<SubscribeRequest>,
        ) -> Result<Response<Self::StreamStatusStream>, Status> {
            let direction = Direction::from_i32(request.into_inner().direction)
                .ok_or_else(|| Status::invalid_argument("invalid direction"))?;
            let receiver = self.broker.subscribe(direction);
            let stream = BroadcastStream::new(receiver).filter_map(|msg| match msg {
                Ok(value) => Some(Ok(value)),
                Err(BroadcastStreamRecvError::Lagged(_)) => None,
            });
            Ok(Response::new(Box::pin(stream)))
        }
    }

    pub async fn serve(
        addr: SocketAddr,
        buffer: Option<usize>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let broker = Arc::new(ChannelBroker::new(buffer.unwrap_or(DEFAULT_BUFFER)));
        let service = ChannelService { broker };
        Server::builder()
            .add_service(ChannelServer::new(service))
            .serve(addr)
            .await?;
        Ok(())
    }
}
