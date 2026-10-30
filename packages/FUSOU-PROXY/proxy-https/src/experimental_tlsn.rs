use crate::exchange_lifecycle::{ExchangeLifecycle, ExchangePolicy, ExchangeStop};
use http::{
    request, HeaderMap, HeaderName, HeaderValue, Method, Request, Response, StatusCode, Version,
};
use hyper::body::Bytes;
use sha2::{Digest, Sha256};
use std::{
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio_util::task::AbortOnDropHandle;

pub const BINDING_HEADER: &str = "X-Attestation-Binding";
const BINDING_HEADER_NAME: HeaderName = HeaderName::from_static("x-attestation-binding");
const HOST_HEADER_NAME: HeaderName = HeaderName::from_static("host");
const CONTENT_LENGTH_HEADER_NAME: HeaderName = HeaderName::from_static("content-length");
const TRANSFER_ENCODING_HEADER_NAME: HeaderName = HeaderName::from_static("transfer-encoding");
pub(crate) const MAX_TLSN_SENT_DATA_BYTES: usize = 128 * 1024;
const REQUIRE_INFO_TARGET: &str = "/kcsapi/api_get_member/require_info";

pub type ExperimentalForwardFuture =
    Pin<Box<dyn Future<Output = Result<Option<Response<Bytes>>, String>> + Send>>;
pub type BindingFuture =
    Pin<Box<dyn Future<Output = Result<AttestationBinding, BindingError>> + Send>>;
pub type TlsnTransportFuture =
    Pin<Box<dyn Future<Output = Result<TlsnOriginCapture, TlsnTransportError>> + Send>>;
pub type ProofContinuationFuture =
    Pin<Box<dyn Future<Output = Result<(), ProofContinuationError>> + Send>>;
pub type VerificationFuture =
    Pin<Box<dyn Future<Output = Result<VerificationOutcome, VerificationError>> + Send>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeferredVerification {
    job_id: String,
}

impl DeferredVerification {
    pub fn new(job_id: String) -> Result<Self, VerificationError> {
        if job_id.is_empty()
            || !job_id.is_ascii()
            || job_id
                .bytes()
                .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
        {
            return Err(VerificationError::InvalidDeferredJob);
        }
        Ok(Self { job_id })
    }

    pub fn job_id(&self) -> &str {
        &self.job_id
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerificationOutcome {
    Verified(VerifiedTlsnEvidence),
    Deferred(DeferredVerification),
}
pub type ResultBoundaryFuture =
    Pin<Box<dyn Future<Output = Result<(), ResultBoundaryError>> + Send>>;

pub trait ExperimentalRequireInfoForwarder: Send + Sync {
    fn forward(&self, connection_id: u64, request: Request<Bytes>) -> ExperimentalForwardFuture;

    fn capture_ready(&self) -> bool {
        true
    }

    fn start_preparation(&self) {}
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttestationBinding {
    value: String,
}

impl AttestationBinding {
    pub fn new(value: String) -> Result<Self, BindingError> {
        if value.is_empty() || !value.is_ascii() || value.contains('\r') || value.contains('\n') {
            return Err(BindingError::InvalidBinding);
        }
        Ok(Self { value })
    }

    pub fn value(&self) -> &str {
        &self.value
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BindingError {
    NoBindingAuthority,
    CandidateAuthUnavailable,
    CandidateDeviceUnavailable,
    RuntimeConfigUnavailable,
    RuntimeConfigChanged,
    AlreadyIssued,
    BindingNotReady,
    InvalidBinding,
}

impl std::fmt::Display for BindingError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::NoBindingAuthority => "NoBindingAuthority",
            Self::CandidateAuthUnavailable => {
                "candidate capture unavailable: valid auth session required"
            }
            Self::CandidateDeviceUnavailable => {
                "candidate capture unavailable: registered device required"
            }
            Self::RuntimeConfigUnavailable => "TLSN Runtime Config verification is unavailable",
            Self::RuntimeConfigChanged => {
                "TLSN Runtime Config changed; restart the proxy before retrying"
            }
            Self::AlreadyIssued => "binding provider already issued its single-use binding",
            Self::BindingNotReady => "a verified TLSN binding is not ready",
            Self::InvalidBinding => "binding value is not a valid opaque header value",
        };
        formatter.write_str(message)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BindingRequestContext {
    connection_id: u64,
    target: String,
}

impl BindingRequestContext {
    pub fn new(connection_id: u64, target: &str) -> Self {
        Self {
            connection_id,
            target: target.to_owned(),
        }
    }

    pub fn connection_id(&self) -> u64 {
        self.connection_id
    }

    pub fn target(&self) -> &str {
        &self.target
    }
}

pub trait AttestationBindingProvider: Send + Sync {
    fn issue_binding(&self, context: BindingRequestContext) -> BindingFuture;

    fn capture_ready(&self) -> bool {
        true
    }

    fn start_preparation(&self, _context: BindingRequestContext) {}

    fn attempt_completed(&self, _binding: &AttestationBinding) {}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OriginSendJournalOutcome {
    NotSent,
    Unknown,
    ResponseReceived,
}

pub trait OriginSendJournal: Send + Sync {
    fn record_send_intent(
        &self,
        attempt_id: &str,
        target: &str,
        request_sha256: &[u8; 32],
    ) -> Result<(), String>;

    fn record_outcome(
        &self,
        attempt_id: &str,
        outcome: OriginSendJournalOutcome,
    ) -> Result<(), String>;
}

#[derive(Clone)]
struct PreparedBindingState {
    binding: Option<AttestationBinding>,
    preparing: bool,
    in_use: bool,
}

pub struct PreparedBindingProvider {
    inner: Arc<dyn AttestationBindingProvider>,
    context: BindingRequestContext,
    state: Arc<Mutex<PreparedBindingState>>,
    active: Arc<AtomicBool>,
}

impl PreparedBindingProvider {
    pub fn new(inner: Arc<dyn AttestationBindingProvider>, context: BindingRequestContext) -> Self {
        Self {
            inner,
            context,
            state: Arc::new(Mutex::new(PreparedBindingState {
                binding: None,
                preparing: false,
                in_use: false,
            })),
            active: Arc::new(AtomicBool::new(true)),
        }
    }

    fn prepare_in_background(&self) {
        if !self.active.load(Ordering::Acquire) {
            return;
        }
        let should_start = match self.state.lock() {
            Ok(mut state) if !state.preparing && !state.in_use && state.binding.is_none() => {
                state.preparing = true;
                true
            }
            Ok(_) => false,
            Err(_) => {
                tracing::error!("prepared TLSN binding state is poisoned");
                false
            }
        };
        if !should_start {
            return;
        }

        let inner = Arc::clone(&self.inner);
        let state = Arc::clone(&self.state);
        let active = Arc::clone(&self.active);
        let context = self.context.clone();
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            if let Ok(mut state) = self.state.lock() {
                state.preparing = false;
            }
            tracing::warn!("TLSN binding preparation skipped because no Tokio runtime is active");
            return;
        };
        runtime.spawn(async move {
            let mut retry_delay = Duration::from_secs(1);
            loop {
                if !active.load(Ordering::Acquire) {
                    if let Ok(mut state) = state.lock() {
                        state.preparing = false;
                    }
                    return;
                }
                match inner.issue_binding(context.clone()).await {
                    Ok(binding) => {
                        if !active.load(Ordering::Acquire) {
                            inner.attempt_completed(&binding);
                            if let Ok(mut state) = state.lock() {
                                state.preparing = false;
                            }
                            return;
                        }
                        match state.lock() {
                            Ok(mut state) => {
                                state.preparing = false;
                                if !state.in_use && state.binding.is_none() {
                                    state.binding = Some(binding);
                                } else {
                                    inner.attempt_completed(&binding);
                                }
                            }
                            Err(_) => {
                                tracing::error!("prepared TLSN binding state is poisoned after preparation");
                                inner.attempt_completed(&binding);
                            }
                        }
                        return;
                    }
                    Err(error) => {
                        tracing::warn!(%error, "TLSN binding preparation failed; ordinary proxy traffic remains available");
                        tokio::time::sleep(retry_delay).await;
                        retry_delay = (retry_delay * 2).min(Duration::from_secs(30));
                    }
                }
            }
        });
    }
}

impl Drop for PreparedBindingProvider {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
    }
}

impl AttestationBindingProvider for PreparedBindingProvider {
    fn issue_binding(&self, context: BindingRequestContext) -> BindingFuture {
        let result = if context.target() != self.context.target() {
            Err(BindingError::InvalidBinding)
        } else {
            match self.state.lock() {
                Ok(mut state) if !state.in_use => match state.binding.take() {
                    Some(binding) => {
                        state.in_use = true;
                        Ok(binding)
                    }
                    None => Err(BindingError::BindingNotReady),
                },
                Ok(_) => Err(BindingError::BindingNotReady),
                Err(_) => Err(BindingError::NoBindingAuthority),
            }
        };
        Box::pin(async move { result })
    }

    fn capture_ready(&self) -> bool {
        self.state
            .lock()
            .map(|state| state.binding.is_some() && !state.in_use)
            .unwrap_or(false)
    }

    fn start_preparation(&self, _context: BindingRequestContext) {
        self.inner.start_preparation(self.context.clone());
        self.prepare_in_background();
    }

    fn attempt_completed(&self, binding: &AttestationBinding) {
        self.inner.attempt_completed(binding);
        match self.state.lock() {
            Ok(mut state) => state.in_use = false,
            Err(_) => tracing::error!("prepared TLSN binding state is poisoned after an attempt"),
        }
        self.prepare_in_background();
    }
}

#[derive(Debug, Default)]
pub struct NoBindingAuthority;

impl AttestationBindingProvider for NoBindingAuthority {
    fn issue_binding(&self, _context: BindingRequestContext) -> BindingFuture {
        Box::pin(async { Err(BindingError::NoBindingAuthority) })
    }
}

pub struct SingleUseBindingProvider {
    inner: Arc<dyn AttestationBindingProvider>,
    issued: Mutex<bool>,
}

impl SingleUseBindingProvider {
    pub fn new(inner: Arc<dyn AttestationBindingProvider>) -> Self {
        Self {
            inner,
            issued: Mutex::new(false),
        }
    }
}

impl AttestationBindingProvider for SingleUseBindingProvider {
    fn issue_binding(&self, context: BindingRequestContext) -> BindingFuture {
        let inner = Arc::clone(&self.inner);
        let already_issued = match self.issued.lock() {
            Ok(mut issued) => {
                if *issued {
                    true
                } else {
                    *issued = true;
                    false
                }
            }
            Err(_) => true,
        };
        Box::pin(async move {
            if already_issued {
                return Err(BindingError::AlreadyIssued);
            }
            inner.issue_binding(context).await
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SerializedOriginRequest {
    bytes: Bytes,
}

impl SerializedOriginRequest {
    pub fn new(bytes: Bytes) -> Result<Self, SerializationError> {
        if bytes.is_empty() {
            return Err(SerializationError::EmptyRequest);
        }
        Ok(Self { bytes })
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SerializationError {
    UnsupportedMethod,
    UnsupportedHttpVersion,
    MissingHost,
    DuplicateHost,
    ExistingBinding,
    DuplicateContentLength,
    TransferEncodingNotSupported,
    InvalidContentLength,
    ContentLengthMismatch,
    RequestTooLarge,
    InvalidHeaderValue,
    EmptyRequest,
}

impl std::fmt::Display for SerializationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::UnsupportedMethod => "request method is not POST",
            Self::UnsupportedHttpVersion => "only HTTP/1.1 origin serialization is supported",
            Self::MissingHost => "request is missing exactly one Host header",
            Self::DuplicateHost => "request contains duplicate Host headers",
            Self::ExistingBinding => "request already contains X-Attestation-Binding",
            Self::DuplicateContentLength => "request contains duplicate Content-Length headers",
            Self::TransferEncodingNotSupported => {
                "Transfer-Encoding cannot be reconstructed after body collection"
            }
            Self::InvalidContentLength => "Content-Length is not canonical decimal",
            Self::ContentLengthMismatch => "Content-Length does not match collected body",
            Self::RequestTooLarge => "serialized TLSN HTTP request exceeds the sent-data limit",
            Self::InvalidHeaderValue => "header value cannot be serialized safely",
            Self::EmptyRequest => "serialized origin request is empty",
        };
        formatter.write_str(message)
    }
}

fn add_serialized_len(length: &mut usize, additional: usize) -> Result<(), SerializationError> {
    *length = length
        .checked_add(additional)
        .ok_or(SerializationError::RequestTooLarge)?;
    if *length > MAX_TLSN_SENT_DATA_BYTES {
        return Err(SerializationError::RequestTooLarge);
    }
    Ok(())
}

fn add_serialized_header_len(
    length: &mut usize,
    name_len: usize,
    value_len: usize,
) -> Result<(), SerializationError> {
    add_serialized_len(length, name_len)?;
    add_serialized_len(length, 2)?;
    add_serialized_len(length, value_len)?;
    add_serialized_len(length, 2)
}

fn serialized_request_len(
    parts: &request::Parts,
    target: &str,
    body_len: usize,
    generated_content_length: Option<&str>,
    binding: &AttestationBinding,
) -> Result<usize, SerializationError> {
    let mut length = 0;
    add_serialized_len(&mut length, parts.method.as_str().len())?;
    add_serialized_len(&mut length, 1)?;
    add_serialized_len(&mut length, target.len())?;
    add_serialized_len(&mut length, b" HTTP/1.1\r\n".len())?;

    for (name, value) in &parts.headers {
        add_serialized_header_len(&mut length, name.as_str().len(), value.as_bytes().len())?;
    }
    if let Some(content_length) = generated_content_length {
        add_serialized_header_len(
            &mut length,
            CONTENT_LENGTH_HEADER_NAME.as_str().len(),
            content_length.len(),
        )?;
    }
    add_serialized_header_len(
        &mut length,
        BINDING_HEADER_NAME.as_str().len(),
        binding.value.len(),
    )?;
    add_serialized_len(&mut length, 2)?;
    add_serialized_len(&mut length, body_len)?;
    Ok(length)
}

pub trait OriginRequestSerializer: Send + Sync {
    fn serialize(
        &self,
        parts: &request::Parts,
        body: Bytes,
        binding: &AttestationBinding,
    ) -> Result<SerializedOriginRequest, SerializationError>;
}

#[derive(Debug, Default)]
pub struct Http1OriginRequestSerializer;

impl OriginRequestSerializer for Http1OriginRequestSerializer {
    fn serialize(
        &self,
        parts: &request::Parts,
        body: Bytes,
        binding: &AttestationBinding,
    ) -> Result<SerializedOriginRequest, SerializationError> {
        if parts.method != Method::POST {
            return Err(SerializationError::UnsupportedMethod);
        }
        if parts.version != Version::HTTP_11 {
            return Err(SerializationError::UnsupportedHttpVersion);
        }

        let host_count = parts.headers.get_all(&HOST_HEADER_NAME).iter().count();
        if host_count == 0 {
            return Err(SerializationError::MissingHost);
        }
        if host_count > 1 {
            return Err(SerializationError::DuplicateHost);
        }
        if parts
            .headers
            .get_all(&BINDING_HEADER_NAME)
            .iter()
            .next()
            .is_some()
        {
            return Err(SerializationError::ExistingBinding);
        }
        let content_length_values = parts
            .headers
            .get_all(&CONTENT_LENGTH_HEADER_NAME)
            .iter()
            .collect::<Vec<_>>();
        if content_length_values.len() > 1 {
            return Err(SerializationError::DuplicateContentLength);
        }
        if parts
            .headers
            .get_all(&TRANSFER_ENCODING_HEADER_NAME)
            .iter()
            .next()
            .is_some()
        {
            return Err(SerializationError::TransferEncodingNotSupported);
        }

        if let Some(content_length) = content_length_values.first() {
            let value = content_length
                .to_str()
                .map_err(|_| SerializationError::InvalidContentLength)?;
            let parsed = value
                .parse::<usize>()
                .map_err(|_| SerializationError::InvalidContentLength)?;
            if parsed != body.len() {
                return Err(SerializationError::ContentLengthMismatch);
            }
        }

        let target = parts
            .uri
            .path_and_query()
            .map(|value| value.as_str())
            .unwrap_or("/");
        let generated_content_length = content_length_values
            .is_empty()
            .then(|| body.len().to_string());
        let serialized_len = serialized_request_len(
            parts,
            target,
            body.len(),
            generated_content_length.as_deref(),
            binding,
        )?;
        let mut output = Vec::with_capacity(serialized_len);
        output.extend_from_slice(parts.method.as_str().as_bytes());
        output.push(b' ');
        output.extend_from_slice(target.as_bytes());
        output.extend_from_slice(b" HTTP/1.1\r\n");

        for (name, value) in &parts.headers {
            append_header(&mut output, name, value)?;
        }
        if let Some(content_length) = generated_content_length {
            append_header_value(
                &mut output,
                &CONTENT_LENGTH_HEADER_NAME,
                content_length.as_bytes(),
            )?;
        }
        append_header_value(&mut output, &BINDING_HEADER_NAME, binding.value.as_bytes())?;
        output.extend_from_slice(b"\r\n");
        output.extend_from_slice(&body);

        SerializedOriginRequest::new(Bytes::from(output))
            .map_err(|_| SerializationError::EmptyRequest)
    }
}

fn append_header(
    output: &mut Vec<u8>,
    name: &HeaderName,
    value: &HeaderValue,
) -> Result<(), SerializationError> {
    append_header_value(output, name, value.as_bytes())
}

fn append_header_value(
    output: &mut Vec<u8>,
    name: &HeaderName,
    value: &[u8],
) -> Result<(), SerializationError> {
    if value
        .iter()
        .any(|byte| *byte == b'\r' || *byte == b'\n' || *byte == 0)
    {
        return Err(SerializationError::InvalidHeaderValue);
    }
    output.extend_from_slice(name.as_str().as_bytes());
    output.extend_from_slice(b": ");
    output.extend_from_slice(value);
    output.extend_from_slice(b"\r\n");
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TlsnOriginResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Bytes,
    pub raw_response_bytes: Bytes,
}

impl TlsnOriginResponse {
    pub fn new(
        status: StatusCode,
        headers: HeaderMap,
        body: Bytes,
        raw_response_bytes: Bytes,
    ) -> Self {
        Self {
            status,
            headers,
            body,
            raw_response_bytes,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnverifiedTlsnTranscript {
    pub request_sha256: [u8; 32],
    pub response_sha256: [u8; 32],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TlsnOriginExchange {
    pub response: TlsnOriginResponse,
    pub transcript: UnverifiedTlsnTranscript,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TlsnTransportError {
    LifecyclePolicyMissing,
    Cancelled,
    DeadlineExceeded,
    Unavailable,
    RuntimeConfigUnavailable,
    RuntimeConfigChanged,
    AlreadySent,
    RequestTooLarge,
    OriginConnectionFailed,
    AmbiguousOriginSend,
    SystemTrustStoreUnavailable,
    TlsHandshakeFailed { server_identity: String },
    ResponseReadFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProofContinuationError {
    Cancelled,
    Deadline,
    ProverFinalization,
    TranscriptCommit,
    Prove,
    AttestationRequest,
    Notary,
    NotaryAttestationLimit,
    AttestationValidation,
    Presentation,
}

impl std::fmt::Display for ProofContinuationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Cancelled => "TLSN proof cancelled; no upstream retry",
            Self::Deadline => "TLSN proof deadline exceeded; no upstream retry",
            Self::ProverFinalization => "TLSN prover finalization failed",
            Self::TranscriptCommit => "TLSN transcript commit failed",
            Self::Prove => "TLSN prove failed",
            Self::AttestationRequest => "TLSN AttestationRequest construction failed",
            Self::Notary => "TLSN Notary exchange failed",
            Self::NotaryAttestationLimit => {
                "TLSN Notary attestation exceeds the explicit local byte limit"
            }
            Self::AttestationValidation => "TLSN Attestation validation failed",
            Self::Presentation => "TLSN Presentation construction failed",
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProofContinuationState {
    Pending,
    Running,
    Succeeded,
    Failed,
}

pub struct ProofContinuation {
    future: Option<ProofContinuationFuture>,
    state: Arc<Mutex<ProofContinuationState>>,
}

impl ProofContinuation {
    pub fn new(future: ProofContinuationFuture) -> Self {
        Self {
            future: Some(future),
            state: Arc::new(Mutex::new(ProofContinuationState::Pending)),
        }
    }

    pub fn completed() -> Self {
        Self::new(Box::pin(async { Ok(()) }))
    }

    pub fn state(&self) -> Result<ProofContinuationState, String> {
        self.state
            .lock()
            .map(|state| *state)
            .map_err(|_| "TLSN proof continuation state is poisoned".to_owned())
    }

    pub fn run(mut self) -> ProofContinuationFuture {
        let future = self
            .future
            .take()
            .expect("proof continuation must only be run once");
        let state = Arc::clone(&self.state);
        Box::pin(async move {
            if let Ok(mut current) = state.lock() {
                *current = ProofContinuationState::Running;
            }
            match future.await {
                Ok(()) => {
                    if let Ok(mut current) = state.lock() {
                        *current = ProofContinuationState::Succeeded;
                    }
                    Ok(())
                }
                Err(error) => {
                    if let Ok(mut current) = state.lock() {
                        *current = ProofContinuationState::Failed;
                    }
                    Err(error)
                }
            }
        })
    }
}

pub struct TlsnOriginCapture {
    pub exchange: TlsnOriginExchange,
    pub proof: ProofContinuation,
}

impl std::fmt::Display for TlsnTransportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::LifecyclePolicyMissing => "TLSN transport lifecycle policy is not configured",
            Self::Cancelled => "TLSN transport cancelled; no upstream retry",
            Self::DeadlineExceeded => "TLSN absolute exchange deadline exceeded; no upstream retry",
            Self::Unavailable => "TLSN origin transport is unavailable",
            Self::RuntimeConfigUnavailable => {
                "TLSN Runtime Config verification is unavailable before origin transport"
            }
            Self::RuntimeConfigChanged => "TLSN Runtime Config changed before origin transport",
            Self::AlreadySent => "TLSN origin transport rejected a duplicate send",
            Self::RequestTooLarge => "TLSN origin request exceeds the configured capacity",
            Self::OriginConnectionFailed => "TLSN origin connection failed",
            Self::AmbiguousOriginSend => {
                "TLSN origin write failed; Game Server receipt is UNKNOWN; no upstream retry"
            }
            Self::SystemTrustStoreUnavailable => {
                "platform TLS trust store is unavailable or invalid"
            }
            Self::TlsHandshakeFailed { server_identity } => {
                return write!(
                    formatter,
                    "TLSN TLS validation or handshake failed for {server_identity}"
                );
            }
            Self::ResponseReadFailed => "TLSN origin response read failed",
        };
        formatter.write_str(message)
    }
}

pub trait TlsnOriginTransport: Send + Sync {
    fn send_once(&self, request: SerializedOriginRequest) -> TlsnTransportFuture;

    fn send_once_with_lifecycle(
        &self,
        request: SerializedOriginRequest,
        _lifecycle: ExchangeLifecycle,
    ) -> TlsnTransportFuture {
        self.send_once(request)
    }
}

#[derive(Debug, Default)]
pub struct UnconfiguredTlsnOriginTransport;

impl TlsnOriginTransport for UnconfiguredTlsnOriginTransport {
    fn send_once(&self, _request: SerializedOriginRequest) -> TlsnTransportFuture {
        Box::pin(async { Err(TlsnTransportError::Unavailable) })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedMemberId(String);

impl VerifiedMemberId {
    pub fn from_verifier(value: String) -> Result<Self, VerificationError> {
        let canonical = value == "0"
            || (!value.is_empty()
                && !value.starts_with('0')
                && value.bytes().all(|byte| byte.is_ascii_digit()));
        if !canonical {
            return Err(VerificationError::InvalidMemberId);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedTlsnEvidence {
    request_sha256: [u8; 32],
    response_sha256: [u8; 32],
    verified_member_id: VerifiedMemberId,
    metadata: TlsnEvidenceMetadata,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TlsnEvidenceMetadata {
    connection_id: u64,
    binding_identifier: [u8; 32],
    server_identity: Option<String>,
    authenticated_request_sha256: [u8; 32],
    authenticated_response_sha256: [u8; 32],
    presentation_identifier: Option<String>,
    presentation_sha256: Option<[u8; 32]>,
}

impl TlsnEvidenceMetadata {
    pub fn new(
        connection_id: u64,
        binding_identifier: [u8; 32],
        server_identity: Option<String>,
        authenticated_request_sha256: [u8; 32],
        authenticated_response_sha256: [u8; 32],
        presentation_identifier: Option<String>,
        presentation_sha256: Option<[u8; 32]>,
    ) -> Self {
        Self {
            connection_id,
            binding_identifier,
            server_identity,
            authenticated_request_sha256,
            authenticated_response_sha256,
            presentation_identifier,
            presentation_sha256,
        }
    }

    pub fn connection_id(&self) -> u64 {
        self.connection_id
    }

    pub fn binding_identifier(&self) -> &[u8; 32] {
        &self.binding_identifier
    }

    pub fn server_identity(&self) -> Option<&str> {
        self.server_identity.as_deref()
    }

    pub fn authenticated_request_sha256(&self) -> &[u8; 32] {
        &self.authenticated_request_sha256
    }

    pub fn authenticated_response_sha256(&self) -> &[u8; 32] {
        &self.authenticated_response_sha256
    }

    pub fn presentation_identifier(&self) -> Option<&str> {
        self.presentation_identifier.as_deref()
    }

    pub fn presentation_sha256(&self) -> Option<&[u8; 32]> {
        self.presentation_sha256.as_ref()
    }
}

impl VerifiedTlsnEvidence {
    #[allow(dead_code)]
    pub(crate) fn from_verifier(
        request_sha256: [u8; 32],
        response_sha256: [u8; 32],
        verified_member_id: VerifiedMemberId,
    ) -> Self {
        Self {
            request_sha256,
            response_sha256,
            verified_member_id,
            metadata: TlsnEvidenceMetadata::new(
                0,
                [0_u8; 32],
                None,
                request_sha256,
                response_sha256,
                None,
                None,
            ),
        }
    }

    pub(crate) fn with_metadata(mut self, metadata: TlsnEvidenceMetadata) -> Self {
        self.metadata = metadata;
        self
    }

    pub fn request_sha256(&self) -> &[u8; 32] {
        &self.request_sha256
    }

    pub fn response_sha256(&self) -> &[u8; 32] {
        &self.response_sha256
    }

    pub fn verified_member_id(&self) -> &VerifiedMemberId {
        &self.verified_member_id
    }

    pub fn metadata(&self) -> &TlsnEvidenceMetadata {
        &self.metadata
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerificationError {
    Unavailable,
    InvalidTranscript,
    InvalidMemberId,
    ServerIdentityMismatch,
    BindingMismatch,
    PresentationUnavailable,
    PresentationInvalid,
    PresentationExportUnavailable,
    PresentationExportFailed,
    InvalidDeferredJob,
    WorkerUnavailable,
    TriggerUnavailable,
    WorkerRejected,
}

impl std::fmt::Display for VerificationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::Unavailable => "Dedicated TLSN verifier is unavailable",
            Self::InvalidTranscript => "TLSN transcript does not match the serialized exchange",
            Self::InvalidMemberId => "verified member ID is not a canonical non-empty ASCII value",
            Self::ServerIdentityMismatch => "TLSN server identity mismatch",
            Self::BindingMismatch => "TLSN Presentation binding does not match the issued binding",
            Self::PresentationUnavailable => "TLSN Presentation is unavailable",
            Self::PresentationInvalid => "TLSN Presentation is invalid",
            Self::PresentationExportUnavailable => {
                "TLSN Presentation artifact export is unavailable"
            }
            Self::PresentationExportFailed => "TLSN Presentation artifact export failed",
            Self::InvalidDeferredJob => "deferred TLSN verification job ID is invalid",
            Self::WorkerUnavailable => "TLSN verification Worker is unavailable",
            Self::TriggerUnavailable => "TLSN verification Trigger is unavailable",
            Self::WorkerRejected => "TLSN verification Worker rejected the Presentation",
        };
        formatter.write_str(message)
    }
}

pub trait ExperimentalVerifierBoundary: Send + Sync {
    fn verify(
        &self,
        connection_id: u64,
        request: SerializedOriginRequest,
        binding: AttestationBinding,
        exchange: TlsnOriginExchange,
    ) -> VerificationFuture;

    fn verify_with_lifecycle(
        &self,
        connection_id: u64,
        request: SerializedOriginRequest,
        binding: AttestationBinding,
        exchange: TlsnOriginExchange,
        _lifecycle: ExchangeLifecycle,
    ) -> VerificationFuture {
        self.verify(connection_id, request, binding, exchange)
    }
}

#[derive(Debug, Default)]
pub struct UnconfiguredVerifier;

impl ExperimentalVerifierBoundary for UnconfiguredVerifier {
    fn verify(
        &self,
        _connection_id: u64,
        _request: SerializedOriginRequest,
        _binding: AttestationBinding,
        _exchange: TlsnOriginExchange,
    ) -> VerificationFuture {
        Box::pin(async { Err(VerificationError::Unavailable) })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResultBoundaryError {
    Unavailable,
    SigningUnavailable,
    DeliveryUnavailable,
}

impl std::fmt::Display for ResultBoundaryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::Unavailable => "Result boundary is unavailable",
            Self::SigningUnavailable => "production Result signer is unavailable",
            Self::DeliveryUnavailable => "Result delivery is unavailable",
        };
        formatter.write_str(message)
    }
}

pub trait ExperimentalResultBoundary: Send + Sync {
    fn accept(&self, evidence: VerifiedTlsnEvidence) -> ResultBoundaryFuture;

    fn accept_with_lifecycle(
        &self,
        evidence: VerifiedTlsnEvidence,
        _lifecycle: ExchangeLifecycle,
    ) -> ResultBoundaryFuture {
        self.accept(evidence)
    }
}

#[derive(Debug, Default)]
pub struct UnconfiguredResultBoundary;

impl ExperimentalResultBoundary for UnconfiguredResultBoundary {
    fn accept(&self, _evidence: VerifiedTlsnEvidence) -> ResultBoundaryFuture {
        Box::pin(async { Err(ResultBoundaryError::Unavailable) })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExperimentalTlsnRuntimeState {
    Ready,
    Selected,
    BindingIssued,
    Serialized,
    Sent,
    ResponseReceived,
    ResponseReturned,
    ProofStarted,
    ProverFinalizationFailed,
    TranscriptCommitFailed,
    ProveFailed,
    AttestationRequestFailed,
    NotaryFailed,
    AttestationValidationFailed,
    PresentationFailed,
    ProofFailed,
    EvidenceReady,
    PresentationVerificationFailed,
    VerificationDeferred,
    WorkerUnavailable,
    TriggerVerificationFailed,
    WorkerVerificationFailed,
    Verified,
    ResultSigningFailed,
    ArtifactDeliveryFailed,
    ResultReady,
    ResultDelivered,
    Cancelled,
    DeadlineExceeded,
    Unattested,
    CleanupUnconfirmed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OriginRequestOutcome {
    NotSent,
    Unknown,
    ResponseReceived,
}

pub struct ExperimentalTlsnForwarder {
    binding_provider: Arc<dyn AttestationBindingProvider>,
    serializer: Arc<dyn OriginRequestSerializer>,
    transport: Arc<dyn TlsnOriginTransport>,
    verifier: Arc<dyn ExperimentalVerifierBoundary>,
    result_boundary: Arc<dyn ExperimentalResultBoundary>,
    send_journal: Option<Arc<dyn OriginSendJournal>>,
    journal_target: Option<String>,
    state: Arc<Mutex<ExperimentalTlsnRuntimeState>>,
    lifecycle_policy: Option<ExchangePolicy>,
    lifecycle: Arc<Mutex<Option<ExchangeLifecycle>>>,
    proof_task: Arc<Mutex<Option<AbortOnDropHandle<()>>>>,
    origin_outcome: Arc<Mutex<OriginRequestOutcome>>,
}

struct ExchangeOwner {
    lifecycle: ExchangeLifecycle,
    state: Arc<Mutex<ExperimentalTlsnRuntimeState>>,
    finished: bool,
}

fn stop_state(reason: ExchangeStop) -> ExperimentalTlsnRuntimeState {
    match reason {
        ExchangeStop::Cancelled => ExperimentalTlsnRuntimeState::Cancelled,
        ExchangeStop::Deadline => ExperimentalTlsnRuntimeState::DeadlineExceeded,
    }
}

impl Drop for ExchangeOwner {
    fn drop(&mut self) {
        if !self.finished {
            let reason = self.lifecycle.stop(ExchangeStop::Cancelled);
            match self.state.lock() {
                Ok(mut state) => *state = stop_state(reason),
                Err(_) => tracing::error!("TLSN runtime state poisoned during cancellation"),
            }
        }
    }
}

impl ExperimentalTlsnForwarder {
    pub fn new(
        binding_provider: Arc<dyn AttestationBindingProvider>,
        serializer: Arc<dyn OriginRequestSerializer>,
        transport: Arc<dyn TlsnOriginTransport>,
        verifier: Arc<dyn ExperimentalVerifierBoundary>,
        result_boundary: Arc<dyn ExperimentalResultBoundary>,
    ) -> Arc<Self> {
        Self::new_with_policy(
            binding_provider,
            serializer,
            transport,
            verifier,
            result_boundary,
            None,
        )
    }

    pub fn new_with_policy(
        binding_provider: Arc<dyn AttestationBindingProvider>,
        serializer: Arc<dyn OriginRequestSerializer>,
        transport: Arc<dyn TlsnOriginTransport>,
        verifier: Arc<dyn ExperimentalVerifierBoundary>,
        result_boundary: Arc<dyn ExperimentalResultBoundary>,
        lifecycle_policy: Option<ExchangePolicy>,
    ) -> Arc<Self> {
        Self::new_with_policy_and_journal(
            binding_provider,
            serializer,
            transport,
            verifier,
            result_boundary,
            lifecycle_policy,
            None,
            None,
        )
    }

    pub fn new_with_policy_and_journal(
        binding_provider: Arc<dyn AttestationBindingProvider>,
        serializer: Arc<dyn OriginRequestSerializer>,
        transport: Arc<dyn TlsnOriginTransport>,
        verifier: Arc<dyn ExperimentalVerifierBoundary>,
        result_boundary: Arc<dyn ExperimentalResultBoundary>,
        lifecycle_policy: Option<ExchangePolicy>,
        send_journal: Option<Arc<dyn OriginSendJournal>>,
        journal_target: Option<String>,
    ) -> Arc<Self> {
        Arc::new(Self {
            binding_provider,
            serializer,
            transport,
            verifier,
            result_boundary,
            send_journal,
            journal_target,
            state: Arc::new(Mutex::new(ExperimentalTlsnRuntimeState::Ready)),
            lifecycle_policy,
            lifecycle: Arc::new(Mutex::new(None)),
            proof_task: Arc::new(Mutex::new(None)),
            origin_outcome: Arc::new(Mutex::new(OriginRequestOutcome::NotSent)),
        })
    }

    pub fn unavailable() -> Arc<Self> {
        Self::new(
            Arc::new(NoBindingAuthority),
            Arc::new(Http1OriginRequestSerializer),
            Arc::new(UnconfiguredTlsnOriginTransport),
            Arc::new(UnconfiguredVerifier),
            Arc::new(UnconfiguredResultBoundary),
        )
    }

    pub fn state(&self) -> Result<ExperimentalTlsnRuntimeState, String> {
        self.state
            .lock()
            .map(|state| *state)
            .map_err(|_| "Experimental TLSN runtime state is poisoned".to_owned())
    }

    pub fn origin_outcome(&self) -> Result<OriginRequestOutcome, String> {
        self.origin_outcome
            .lock()
            .map(|outcome| *outcome)
            .map_err(|_| "TLSN origin outcome state is poisoned".to_owned())
    }

    fn begin_attempt(&self) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Experimental TLSN runtime state is poisoned".to_owned())?;
        if self.origin_outcome()? == OriginRequestOutcome::Unknown {
            return Err(
                "previous TLSN origin outcome is unknown; no retry is permitted".to_owned(),
            );
        }
        if matches!(
            *state,
            ExperimentalTlsnRuntimeState::Selected
                | ExperimentalTlsnRuntimeState::BindingIssued
                | ExperimentalTlsnRuntimeState::Serialized
                | ExperimentalTlsnRuntimeState::Sent
                | ExperimentalTlsnRuntimeState::ResponseReceived
                | ExperimentalTlsnRuntimeState::ResponseReturned
                | ExperimentalTlsnRuntimeState::ProofStarted
                | ExperimentalTlsnRuntimeState::EvidenceReady
                | ExperimentalTlsnRuntimeState::Verified
                | ExperimentalTlsnRuntimeState::CleanupUnconfirmed
        ) {
            return Err("another TLSN attempt is still active".to_owned());
        }
        *state = ExperimentalTlsnRuntimeState::Selected;
        *self
            .origin_outcome
            .lock()
            .map_err(|_| "TLSN origin outcome state is poisoned".to_owned())? =
            OriginRequestOutcome::NotSent;
        Ok(())
    }

    pub fn start_preparation(&self) {
        self.binding_provider
            .start_preparation(BindingRequestContext::new(0, REQUIRE_INFO_TARGET));
    }

    pub fn capture_ready(&self) -> bool {
        self.binding_provider.capture_ready()
    }

    pub fn cancel(&self) -> Result<(), String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "TLSN runtime state poisoned")?;
        if !matches!(
            *state,
            ExperimentalTlsnRuntimeState::Selected
                | ExperimentalTlsnRuntimeState::BindingIssued
                | ExperimentalTlsnRuntimeState::Serialized
                | ExperimentalTlsnRuntimeState::Sent
                | ExperimentalTlsnRuntimeState::ResponseReceived
                | ExperimentalTlsnRuntimeState::ResponseReturned
                | ExperimentalTlsnRuntimeState::ProofStarted
                | ExperimentalTlsnRuntimeState::EvidenceReady
                | ExperimentalTlsnRuntimeState::Verified
                | ExperimentalTlsnRuntimeState::ResultDelivered
        ) {
            return Err("TLSN exchange is not active".to_owned());
        }
        let lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| "TLSN lifecycle state poisoned")?;
        let lifecycle = lifecycle.as_ref().ok_or("TLSN exchange has not started")?;
        lifecycle.stop(ExchangeStop::Cancelled);
        Ok(())
    }

    fn transition(
        &self,
        expected: ExperimentalTlsnRuntimeState,
        next: ExperimentalTlsnRuntimeState,
    ) -> Result<(), String> {
        transition_state(&self.state, expected, next)
    }

    fn transition_shared(
        state: &Arc<Mutex<ExperimentalTlsnRuntimeState>>,
        expected: ExperimentalTlsnRuntimeState,
        next: ExperimentalTlsnRuntimeState,
    ) -> Result<(), String> {
        transition_state(state, expected, next)
    }

    async fn run_proof_pipeline(
        state: Arc<Mutex<ExperimentalTlsnRuntimeState>>,
        proof: ProofContinuation,
        verifier: Arc<dyn ExperimentalVerifierBoundary>,
        result_boundary: Arc<dyn ExperimentalResultBoundary>,
        connection_id: u64,
        serialized: SerializedOriginRequest,
        binding: AttestationBinding,
        exchange: TlsnOriginExchange,
        lifecycle: Option<ExchangeLifecycle>,
    ) {
        if Self::transition_shared(
            &state,
            ExperimentalTlsnRuntimeState::ResponseReturned,
            ExperimentalTlsnRuntimeState::ProofStarted,
        )
        .is_err()
        {
            return;
        }
        let proof_started = std::time::Instant::now();
        if let Err(error) = proof.run().await {
            tracing::warn!(
                connection_id,
                elapsed_ms = elapsed_millis(proof_started),
                %error,
                "TLSN presentation generation and Notary stage failed after browser response"
            );
            let next = match error {
                ProofContinuationError::Cancelled => ExperimentalTlsnRuntimeState::Cancelled,
                ProofContinuationError::Deadline => ExperimentalTlsnRuntimeState::DeadlineExceeded,
                ProofContinuationError::ProverFinalization => {
                    ExperimentalTlsnRuntimeState::ProverFinalizationFailed
                }
                ProofContinuationError::TranscriptCommit => {
                    ExperimentalTlsnRuntimeState::TranscriptCommitFailed
                }
                ProofContinuationError::Prove => ExperimentalTlsnRuntimeState::ProveFailed,
                ProofContinuationError::AttestationRequest => {
                    ExperimentalTlsnRuntimeState::AttestationRequestFailed
                }
                ProofContinuationError::Notary | ProofContinuationError::NotaryAttestationLimit => {
                    ExperimentalTlsnRuntimeState::NotaryFailed
                }
                ProofContinuationError::AttestationValidation => {
                    ExperimentalTlsnRuntimeState::AttestationValidationFailed
                }
                ProofContinuationError::Presentation => {
                    ExperimentalTlsnRuntimeState::PresentationFailed
                }
            };
            let _ =
                Self::transition_shared(&state, ExperimentalTlsnRuntimeState::ProofStarted, next);
            return;
        }
        tracing::info!(
            connection_id,
            elapsed_ms = elapsed_millis(proof_started),
            "TLSN presentation generation and Notary stage completed"
        );
        if Self::transition_shared(
            &state,
            ExperimentalTlsnRuntimeState::ProofStarted,
            ExperimentalTlsnRuntimeState::EvidenceReady,
        )
        .is_err()
        {
            return;
        }
        let verification_started = std::time::Instant::now();
        let verification = match lifecycle.as_ref() {
            Some(lifecycle) => verifier.verify_with_lifecycle(
                connection_id,
                serialized,
                binding,
                exchange,
                lifecycle.clone(),
            ),
            None => verifier.verify(connection_id, serialized, binding, exchange),
        };
        let outcome = match verification.await {
            Ok(outcome) => outcome,
            Err(error) => {
                tracing::warn!(
                    connection_id,
                    elapsed_ms = elapsed_millis(verification_started),
                    %error,
                    "TLSN Presentation or Worker verification failed after browser response"
                );
                let next = match error {
                    VerificationError::PresentationUnavailable
                    | VerificationError::PresentationInvalid => {
                        ExperimentalTlsnRuntimeState::PresentationVerificationFailed
                    }
                    VerificationError::PresentationExportUnavailable
                    | VerificationError::PresentationExportFailed => {
                        ExperimentalTlsnRuntimeState::ArtifactDeliveryFailed
                    }
                    VerificationError::WorkerUnavailable => {
                        ExperimentalTlsnRuntimeState::WorkerUnavailable
                    }
                    VerificationError::TriggerUnavailable => {
                        ExperimentalTlsnRuntimeState::TriggerVerificationFailed
                    }
                    _ => ExperimentalTlsnRuntimeState::WorkerVerificationFailed,
                };
                let _ = Self::transition_shared(
                    &state,
                    ExperimentalTlsnRuntimeState::EvidenceReady,
                    next,
                );
                return;
            }
        };
        let verified = match outcome {
            VerificationOutcome::Verified(evidence) => {
                tracing::info!(
                    connection_id,
                    elapsed_ms = elapsed_millis(verification_started),
                    "TLSN Presentation and Worker verification completed"
                );
                evidence
            }
            VerificationOutcome::Deferred(deferred) => {
                tracing::info!(
                    connection_id,
                    job_id = deferred.job_id(),
                    elapsed_ms = elapsed_millis(verification_started),
                    "TLSN Presentation verification deferred to the configured backend"
                );
                let _ = Self::transition_shared(
                    &state,
                    ExperimentalTlsnRuntimeState::EvidenceReady,
                    ExperimentalTlsnRuntimeState::VerificationDeferred,
                );
                return;
            }
        };
        if Self::transition_shared(
            &state,
            ExperimentalTlsnRuntimeState::EvidenceReady,
            ExperimentalTlsnRuntimeState::Verified,
        )
        .is_err()
        {
            return;
        }
        let result_started = std::time::Instant::now();
        let result = match lifecycle {
            Some(lifecycle) => result_boundary.accept_with_lifecycle(verified, lifecycle),
            None => result_boundary.accept(verified),
        };
        if let Err(error) = result.await {
            tracing::warn!(
                connection_id,
                elapsed_ms = elapsed_millis(result_started),
                %error,
                "TLSN Result signing or delivery failed after browser response"
            );
            let next = match error {
                ResultBoundaryError::SigningUnavailable => {
                    ExperimentalTlsnRuntimeState::ResultSigningFailed
                }
                ResultBoundaryError::DeliveryUnavailable => {
                    ExperimentalTlsnRuntimeState::ArtifactDeliveryFailed
                }
                ResultBoundaryError::Unavailable => ExperimentalTlsnRuntimeState::ProofFailed,
            };
            let _ = Self::transition_shared(&state, ExperimentalTlsnRuntimeState::Verified, next);
            return;
        }
        tracing::info!(
            connection_id,
            elapsed_ms = elapsed_millis(result_started),
            "TLSN signed Result delivery completed"
        );
        let _ = Self::transition_shared(
            &state,
            ExperimentalTlsnRuntimeState::Verified,
            ExperimentalTlsnRuntimeState::ResultDelivered,
        );
    }
}

fn elapsed_millis(started: std::time::Instant) -> u64 {
    let elapsed = started.elapsed();
    elapsed
        .as_secs()
        .saturating_mul(1_000)
        .saturating_add(u64::from(elapsed.subsec_millis()))
}

fn transition_state(
    state: &Arc<Mutex<ExperimentalTlsnRuntimeState>>,
    expected: ExperimentalTlsnRuntimeState,
    next: ExperimentalTlsnRuntimeState,
) -> Result<(), String> {
    let mut state = state
        .lock()
        .map_err(|_| "Experimental TLSN runtime state is poisoned".to_owned())?;
    if *state != expected {
        return Err(format!(
            "invalid Experimental TLSN state transition: {:?} -> {:?}, expected {:?}",
            *state, next, expected
        ));
    }
    *state = next;
    Ok(())
}

impl ExperimentalTlsnForwarder {
    async fn forward_inner(
        self: Arc<Self>,
        connection_id: u64,
        request: Request<Bytes>,
    ) -> Result<Option<Response<Bytes>>, String> {
        let context = BindingRequestContext::new(connection_id, request.uri().path());
        let binding = match self.binding_provider.issue_binding(context).await {
            Ok(binding) => binding,
            Err(error) => {
                tracing::info!(%error, connection_id, "TLSN capture unavailable before origin send; using ordinary proxy");
                return Ok(None);
            }
        };
        if self.begin_attempt().is_err() {
            self.binding_provider.attempt_completed(&binding);
            return Ok(None);
        }
        let lifecycle = match self.lifecycle_policy.map(ExchangePolicy::start).transpose() {
            Ok(lifecycle) => lifecycle,
            Err(error) => {
                tracing::warn!(%error, connection_id, "TLSN exchange could not start before origin send; using ordinary proxy");
                if let Ok(mut state) = self.state.lock() {
                    *state = ExperimentalTlsnRuntimeState::Unattested;
                }
                self.binding_provider.attempt_completed(&binding);
                return Ok(None);
            }
        };
        *self
            .lifecycle
            .lock()
            .map_err(|_| "TLSN lifecycle state poisoned")? = lifecycle.clone();
        let mut owner = lifecycle.clone().map(|lifecycle| ExchangeOwner {
            lifecycle,
            state: Arc::clone(&self.state),
            finished: false,
        });
        let mut fallback_allowed = true;
        let preparation = async {
            let (parts, body) = request.into_parts();
            self.transition(
                ExperimentalTlsnRuntimeState::Selected,
                ExperimentalTlsnRuntimeState::BindingIssued,
            )?;
            let serialized = match self.serializer.serialize(&parts, body, &binding) {
                Ok(serialized) => serialized,
                Err(error) => {
                    tracing::warn!(%error, connection_id, "TLSN request serialization failed before origin send; using ordinary proxy");
                    return Ok(None);
                }
            };
            self.transition(
                ExperimentalTlsnRuntimeState::BindingIssued,
                ExperimentalTlsnRuntimeState::Serialized,
            )?;

            let attempt_id = digest_hex(&sha256(binding.value().as_bytes()));
            let journal_target = self
                .journal_target
                .clone()
                .or_else(|| parts.uri.host().map(str::to_owned))
                .unwrap_or_default();
            if let Some(journal) = &self.send_journal {
                if let Err(error) = journal.record_send_intent(
                    &attempt_id,
                    &journal_target,
                    &sha256(serialized.bytes()),
                ) {
                    fallback_allowed = false;
                    return Err(format!(
                        "TLSN pre-send journal rejected origin send: {error}"
                    ));
                }
            }

            // This transition is intentionally committed before transport I/O. Any
            // partial write or connection error must not be retried or sent to Production.
            self.transition(
                ExperimentalTlsnRuntimeState::Serialized,
                ExperimentalTlsnRuntimeState::Sent,
            )?;
            let transport = match lifecycle.as_ref() {
                Some(lifecycle) => self
                    .transport
                    .send_once_with_lifecycle(serialized.clone(), lifecycle.clone()),
                None => self.transport.send_once(serialized.clone()),
            };
            *self
                .origin_outcome
                .lock()
                .map_err(|_| "TLSN origin outcome state is poisoned")? =
                OriginRequestOutcome::Unknown;
            let capture = match transport.await {
                Ok(capture) => capture,
                Err(error) => {
                    if matches!(
                        error,
                        TlsnTransportError::LifecyclePolicyMissing
                            | TlsnTransportError::Unavailable
                            | TlsnTransportError::RuntimeConfigUnavailable
                            | TlsnTransportError::RuntimeConfigChanged
                            | TlsnTransportError::RequestTooLarge
                            | TlsnTransportError::OriginConnectionFailed
                            | TlsnTransportError::SystemTrustStoreUnavailable
                            | TlsnTransportError::TlsHandshakeFailed { .. }
                    ) {
                        match self.origin_outcome.lock() {
                            Ok(mut outcome) => *outcome = OriginRequestOutcome::NotSent,
                            Err(_) => tracing::error!("TLSN origin outcome state is poisoned"),
                        }
                    }
                    let origin_outcome = self.origin_outcome()?;
                    if let Some(journal) = &self.send_journal {
                        let recorded_outcome = match origin_outcome {
                            OriginRequestOutcome::NotSent => OriginSendJournalOutcome::NotSent,
                            OriginRequestOutcome::Unknown => OriginSendJournalOutcome::Unknown,
                            OriginRequestOutcome::ResponseReceived => {
                                OriginSendJournalOutcome::ResponseReceived
                            }
                        };
                        if let Err(journal_error) =
                            journal.record_outcome(&attempt_id, recorded_outcome)
                        {
                            fallback_allowed = false;
                            return Err(format!(
                                "{error}; TLSN origin outcome journal update failed: {journal_error}"
                            ));
                        }
                    }
                    if origin_outcome == OriginRequestOutcome::NotSent {
                        tracing::warn!(%error, connection_id, "TLSN origin request was not sent; using ordinary proxy");
                        return Ok(None);
                    }
                    return Err(error.to_string());
                }
            };
            *self
                .origin_outcome
                .lock()
                .map_err(|_| "TLSN origin outcome state is poisoned")? =
                OriginRequestOutcome::ResponseReceived;
            self.transition(
                ExperimentalTlsnRuntimeState::Sent,
                ExperimentalTlsnRuntimeState::ResponseReceived,
            )?;
            let browser_response = capture.exchange.response.clone();
            let response = response_from_origin(browser_response)?;
            self.transition(
                ExperimentalTlsnRuntimeState::ResponseReceived,
                ExperimentalTlsnRuntimeState::ResponseReturned,
            )?;
            Ok::<_, String>(Some((
                serialized,
                binding.clone(),
                capture,
                response,
                attempt_id,
            )))
        };
        let prepared = match lifecycle.as_ref() {
            Some(lifecycle) => lifecycle
                .run(preparation)
                .await
                .map_err(|reason| reason.to_string())
                .and_then(|result| result),
            None => preparation.await,
        };
        let (serialized, binding, capture, response, attempt_id) = match prepared {
            Ok(Some(prepared)) => prepared,
            Ok(None) => {
                if let Some(lifecycle) = lifecycle.as_ref() {
                    lifecycle.stop(ExchangeStop::Cancelled);
                    if lifecycle.wait_for_cleanup().await {
                        if let Ok(mut state) = self.state.lock() {
                            *state = ExperimentalTlsnRuntimeState::Unattested;
                        }
                    } else {
                        if let Ok(mut state) = self.state.lock() {
                            *state = ExperimentalTlsnRuntimeState::CleanupUnconfirmed;
                        }
                        self.binding_provider.attempt_completed(&binding);
                        return Err("TLSN cleanup deadline expired before origin send".to_owned());
                    }
                    owner
                        .as_mut()
                        .expect("lifecycle owns the exchange")
                        .finished = true;
                } else if let Ok(mut state) = self.state.lock() {
                    *state = ExperimentalTlsnRuntimeState::Unattested;
                }
                self.binding_provider.attempt_completed(&binding);
                return Ok(None);
            }
            Err(error) => {
                let origin_outcome = self.origin_outcome()?;
                if let Some(lifecycle) = lifecycle.as_ref() {
                    let stopped = lifecycle.stop_reason();
                    lifecycle.stop(ExchangeStop::Cancelled);
                    let next = if lifecycle.wait_for_cleanup().await {
                        stopped
                            .map(stop_state)
                            .unwrap_or(ExperimentalTlsnRuntimeState::Unattested)
                    } else {
                        tracing::error!("TLSN cleanup deadline expired after transport failure");
                        ExperimentalTlsnRuntimeState::CleanupUnconfirmed
                    };
                    *self
                        .state
                        .lock()
                        .map_err(|_| "TLSN runtime state poisoned")? = next;
                    owner
                        .as_mut()
                        .expect("lifecycle owns the exchange")
                        .finished = true;
                }
                self.binding_provider.attempt_completed(&binding);
                if origin_outcome == OriginRequestOutcome::NotSent && fallback_allowed {
                    return Ok(None);
                }
                return Err(error);
            }
        };
        let TlsnOriginCapture { exchange, proof } = capture;
        let state = Arc::clone(&self.state);
        let verifier = Arc::clone(&self.verifier);
        let result_boundary = Arc::clone(&self.result_boundary);
        let binding_provider = Arc::clone(&self.binding_provider);
        let binding_for_completion = binding.clone();
        let send_journal = self.send_journal.clone();
        let task = AbortOnDropHandle::new(tokio::spawn(async move {
            tokio::task::yield_now().await;
            if let Some(journal) = send_journal {
                let journal_update = tokio::task::spawn_blocking(move || {
                    journal.record_outcome(&attempt_id, OriginSendJournalOutcome::ResponseReceived)
                })
                .await;
                match journal_update {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => tracing::error!(
                        %error,
                        connection_id,
                        "TLSN origin response was received but its durable journal update failed"
                    ),
                    Err(error) => tracing::error!(
                        %error,
                        connection_id,
                        "TLSN origin response journal task failed"
                    ),
                }
            }
            let pipeline = Self::run_proof_pipeline(
                Arc::clone(&state),
                proof,
                verifier,
                result_boundary,
                connection_id,
                serialized,
                binding,
                exchange,
                lifecycle.clone(),
            );
            let stopped = match lifecycle.as_ref() {
                Some(lifecycle) => lifecycle.run(pipeline).await.err(),
                None => {
                    pipeline.await;
                    None
                }
            };
            let cleanup_confirmed = match lifecycle.as_ref() {
                Some(lifecycle) => lifecycle.wait_for_cleanup().await,
                None => true,
            };
            match state.lock() {
                Ok(mut state) => {
                    let stopped = stopped.or_else(|| {
                        lifecycle
                            .as_ref()
                            .and_then(|lifecycle| lifecycle.check().err())
                    });
                    if !cleanup_confirmed {
                        tracing::error!("TLSN owned tasks did not finish within cleanup budget");
                        *state = ExperimentalTlsnRuntimeState::CleanupUnconfirmed;
                    } else if let Some(reason) = stopped {
                        tracing::warn!(%reason, "TLSN proof pipeline stopped without retry");
                        *state = stop_state(reason);
                    } else if *state == ExperimentalTlsnRuntimeState::ResultDelivered {
                        *state = ExperimentalTlsnRuntimeState::ResultReady;
                    }
                }
                Err(_) => tracing::error!("TLSN runtime state poisoned during proof completion"),
            }
            if let Some(owner) = owner.as_mut() {
                owner.finished = true;
            }
            if cleanup_confirmed {
                binding_provider.attempt_completed(&binding_for_completion);
            }
        }));
        *self
            .proof_task
            .lock()
            .map_err(|_| "TLSN proof task owner poisoned")? = Some(task);

        Ok(Some(response))
    }
}

impl ExperimentalRequireInfoForwarder for ExperimentalTlsnForwarder {
    fn forward(&self, connection_id: u64, request: Request<Bytes>) -> ExperimentalForwardFuture {
        let forwarder = Arc::new(Self {
            binding_provider: Arc::clone(&self.binding_provider),
            serializer: Arc::clone(&self.serializer),
            transport: Arc::clone(&self.transport),
            verifier: Arc::clone(&self.verifier),
            result_boundary: Arc::clone(&self.result_boundary),
            send_journal: self.send_journal.clone(),
            journal_target: self.journal_target.clone(),
            state: Arc::clone(&self.state),
            lifecycle_policy: self.lifecycle_policy,
            lifecycle: Arc::clone(&self.lifecycle),
            proof_task: Arc::clone(&self.proof_task),
            origin_outcome: Arc::clone(&self.origin_outcome),
        });
        Box::pin(forwarder.forward_inner(connection_id, request))
    }
}

fn response_from_origin(response: TlsnOriginResponse) -> Result<Response<Bytes>, String> {
    let mut builder = Response::builder().status(response.status);
    for (name, value) in &response.headers {
        builder = builder.header(name, value);
    }
    builder
        .body(response.body)
        .map_err(|error| format!("failed to construct browser response: {error}"))
}

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    let digest = Sha256::digest(bytes);
    let mut output = [0_u8; 32];
    output.copy_from_slice(&digest);
    output
}

pub(crate) fn digest_hex(digest: &[u8; 32]) -> String {
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        write!(&mut encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    encoded
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub(crate) struct ForwardedRequest {
        pub connection_id: u64,
        pub method: Method,
        pub uri: http::Uri,
        pub headers: HeaderMap,
        pub body: Bytes,
    }

    pub(crate) struct RecordingForwarder {
        pub requests: Arc<Mutex<Vec<ForwardedRequest>>>,
        fail: bool,
    }

    impl RecordingForwarder {
        pub(crate) fn new() -> Self {
            Self {
                requests: Arc::new(Mutex::new(Vec::new())),
                fail: false,
            }
        }

        pub(crate) fn failing() -> Self {
            Self {
                requests: Arc::new(Mutex::new(Vec::new())),
                fail: true,
            }
        }
    }

    impl ExperimentalRequireInfoForwarder for RecordingForwarder {
        fn forward(
            &self,
            connection_id: u64,
            request: Request<Bytes>,
        ) -> ExperimentalForwardFuture {
            let requests = Arc::clone(&self.requests);
            let fail = self.fail;
            Box::pin(async move {
                let (parts, body) = request.into_parts();
                requests
                    .lock()
                    .map_err(|_| "recording forwarder lock is poisoned".to_owned())?
                    .push(ForwardedRequest {
                        connection_id,
                        method: parts.method,
                        uri: parts.uri,
                        headers: parts.headers,
                        body,
                    });
                if fail {
                    return Err("synthetic TLSN forwarder failure".to_owned());
                }
                Response::builder()
                    .status(StatusCode::CREATED)
                    .header("x-tlsn-fixture", "shared")
                    .body(Bytes::from_static(b"shared TLSN response"))
                    .map(Some)
                    .map_err(|error| error.to_string())
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::oneshot;

    fn request(binding: Option<&str>) -> Request<Bytes> {
        let mut builder = Request::builder()
            .method(Method::POST)
            .uri("https://game.example.test/kcsapi/api_get_member/require_info?x=1")
            .version(Version::HTTP_11)
            .header("Host", "game.example.test")
            .header("Content-Length", "3");
        if let Some(binding) = binding {
            builder = builder.header(BINDING_HEADER, binding);
        }
        builder.body(Bytes::from_static(b"abc")).unwrap()
    }

    fn binding() -> AttestationBinding {
        AttestationBinding::new("opaque-binding-value".to_owned()).unwrap()
    }

    struct MockBindingProvider {
        calls: Arc<AtomicUsize>,
        connection_ids: Arc<Mutex<Vec<u64>>>,
    }

    impl AttestationBindingProvider for MockBindingProvider {
        fn issue_binding(&self, context: BindingRequestContext) -> BindingFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.connection_ids
                .lock()
                .unwrap()
                .push(context.connection_id());
            Box::pin(async { Ok(binding()) })
        }
    }

    struct FailingBindingProvider {
        calls: Arc<AtomicUsize>,
        error: BindingError,
    }

    impl AttestationBindingProvider for FailingBindingProvider {
        fn issue_binding(&self, _context: BindingRequestContext) -> BindingFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let error = self.error.clone();
            Box::pin(async move { Err(error) })
        }
    }

    struct MockTransport {
        calls: Arc<AtomicUsize>,
        request_bytes: Arc<Mutex<Vec<Vec<u8>>>>,
        response: TlsnOriginExchange,
        retained_response: Mutex<Option<TlsnOriginResponse>>,
        proof_release: Mutex<Option<oneshot::Receiver<()>>>,
    }

    impl TlsnOriginTransport for MockTransport {
        fn send_once(&self, request: SerializedOriginRequest) -> TlsnTransportFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.request_bytes
                .lock()
                .unwrap()
                .push(request.bytes().to_vec());
            *self.retained_response.lock().unwrap() = Some(self.response.response.clone());
            let response = self.response.clone();
            let proof_release = self.proof_release.lock().unwrap().take();
            Box::pin(async move {
                Ok(TlsnOriginCapture {
                    exchange: response,
                    proof: match proof_release {
                        Some(release) => ProofContinuation::new(Box::pin(async move {
                            release.await.map_err(|_| ProofContinuationError::Prove)
                        })),
                        None => ProofContinuation::completed(),
                    },
                })
            })
        }
    }

    struct MockVerifier {
        calls: Arc<AtomicUsize>,
    }

    impl ExperimentalVerifierBoundary for MockVerifier {
        fn verify(
            &self,
            _connection_id: u64,
            request: SerializedOriginRequest,
            _binding: AttestationBinding,
            exchange: TlsnOriginExchange,
        ) -> VerificationFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move {
                if exchange.transcript.request_sha256 != sha256(request.bytes())
                    || exchange.transcript.response_sha256
                        != sha256(&exchange.response.raw_response_bytes)
                {
                    return Err(VerificationError::InvalidTranscript);
                }
                Ok(VerificationOutcome::Verified(
                    VerifiedTlsnEvidence::from_verifier(
                        sha256(request.bytes()),
                        sha256(&exchange.response.raw_response_bytes),
                        VerifiedMemberId::from_verifier("16189463".to_owned())?,
                    ),
                ))
            })
        }
    }

    struct DeferredVerifier {
        calls: Arc<AtomicUsize>,
    }

    impl ExperimentalVerifierBoundary for DeferredVerifier {
        fn verify(
            &self,
            _connection_id: u64,
            _request: SerializedOriginRequest,
            _binding: AttestationBinding,
            _exchange: TlsnOriginExchange,
        ) -> VerificationFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                Ok(VerificationOutcome::Deferred(DeferredVerification::new(
                    "job-1".to_owned(),
                )?))
            })
        }
    }

    struct MockResultBoundary {
        calls: Arc<AtomicUsize>,
    }

    impl ExperimentalResultBoundary for MockResultBoundary {
        fn accept(&self, _evidence: VerifiedTlsnEvidence) -> ResultBoundaryFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok(()) })
        }
    }

    fn exchange() -> TlsnOriginExchange {
        let raw_response = Bytes::from_static(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
        );
        let mut headers = HeaderMap::new();
        headers.insert("Content-Length", HeaderValue::from_static("2"));
        headers.insert("Connection", HeaderValue::from_static("close"));
        TlsnOriginExchange {
            response: TlsnOriginResponse::new(
                StatusCode::OK,
                headers,
                Bytes::from_static(b"ok"),
                raw_response.clone(),
            ),
            transcript: UnverifiedTlsnTranscript {
                request_sha256: sha256(
                    b"POST /kcsapi/api_get_member/require_info?x=1 HTTP/1.1\r\nHost: game.example.test\r\nContent-Length: 3\r\nX-Attestation-Binding: opaque-binding-value\r\n\r\nabc",
                ),
                response_sha256: sha256(&raw_response),
            },
        }
    }

    fn policy_forwarder(
        proof_release: Option<oneshot::Receiver<()>>,
        exchange_ms: &str,
    ) -> (
        Arc<ExperimentalTlsnForwarder>,
        Arc<AtomicUsize>,
        Arc<AtomicUsize>,
    ) {
        let sends = Arc::new(AtomicUsize::new(0));
        let results = Arc::new(AtomicUsize::new(0));
        let serialized = Http1OriginRequestSerializer
            .serialize(
                &request(None).into_parts().0,
                Bytes::from_static(b"abc"),
                &binding(),
            )
            .unwrap();
        let mut response = exchange();
        response.transcript.request_sha256 = sha256(serialized.bytes());
        let forwarder = ExperimentalTlsnForwarder::new_with_policy(
            Arc::new(MockBindingProvider {
                calls: Arc::new(AtomicUsize::new(0)),
                connection_ids: Arc::new(Mutex::new(Vec::new())),
            }),
            Arc::new(Http1OriginRequestSerializer),
            Arc::new(MockTransport {
                calls: Arc::clone(&sends),
                request_bytes: Arc::new(Mutex::new(Vec::new())),
                response,
                retained_response: Mutex::new(None),
                proof_release: Mutex::new(proof_release),
            }),
            Arc::new(MockVerifier {
                calls: Arc::new(AtomicUsize::new(0)),
            }),
            Arc::new(MockResultBoundary {
                calls: Arc::clone(&results),
            }),
            Some(ExchangePolicy::from_millis(Some(exchange_ms), Some("1000")).unwrap()),
        );
        (forwarder, sends, results)
    }

    async fn wait_state(
        forwarder: &ExperimentalTlsnForwarder,
        expected: ExperimentalTlsnRuntimeState,
    ) {
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while forwarder.state().unwrap() != expected {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn explicit_policy_completes_pipeline_once_and_only_after_cleanup() {
        let (forwarder, sends, results) = policy_forwarder(None, "1000");
        assert_eq!(
            forwarder
                .forward(1, request(None))
                .await
                .unwrap()
                .expect("capture response")
                .status(),
            StatusCode::OK
        );
        wait_state(&forwarder, ExperimentalTlsnRuntimeState::ResultReady).await;
        assert_eq!(sends.load(Ordering::SeqCst), 1);
        assert_eq!(results.load(Ordering::SeqCst), 1);
        assert!(forwarder.cancel().is_err());
        assert_eq!(
            forwarder
                .lifecycle
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .stop_reason(),
            None
        );
        assert!(forwarder.forward(2, request(None)).await.unwrap().is_some());
        assert_eq!(sends.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn absolute_deadline_after_browser_response_never_retries_or_delivers_result() {
        let (release, wait) = oneshot::channel();
        let (forwarder, sends, results) = policy_forwarder(Some(wait), "50");
        assert!(forwarder.forward(1, request(None)).await.unwrap().is_some());
        wait_state(&forwarder, ExperimentalTlsnRuntimeState::DeadlineExceeded).await;
        assert!(release.send(()).is_err());
        assert_eq!(results.load(Ordering::SeqCst), 0);
        assert_eq!(sends.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn cancelled_proof_cannot_publish_late_result_or_affect_another_exchange() {
        let (release, wait) = oneshot::channel();
        let (forwarder, sends, results) = policy_forwarder(Some(wait), "1000");
        let (other, other_sends, other_results) = policy_forwarder(None, "1000");
        assert!(forwarder.forward(1, request(None)).await.unwrap().is_some());
        forwarder.cancel().unwrap();
        assert!(other.forward(2, request(None)).await.unwrap().is_some());
        wait_state(&forwarder, ExperimentalTlsnRuntimeState::Cancelled).await;
        wait_state(&other, ExperimentalTlsnRuntimeState::ResultReady).await;
        assert!(release.send(()).is_err());
        assert_eq!(sends.load(Ordering::SeqCst), 1);
        assert_eq!(results.load(Ordering::SeqCst), 0);
        assert_eq!(other_sends.load(Ordering::SeqCst), 1);
        assert_eq!(other_results.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn dropping_runtime_owner_cancels_background_proof_instead_of_detaching() {
        let (release, wait) = oneshot::channel();
        let (forwarder, sends, results) = policy_forwarder(Some(wait), "1000");
        assert!(forwarder.forward(1, request(None)).await.unwrap().is_some());
        let lifecycle = forwarder.lifecycle.lock().unwrap().clone().unwrap();
        drop(forwarder);
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while !release.is_closed() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(lifecycle.stop_reason(), Some(ExchangeStop::Cancelled));
        assert_eq!(sends.load(Ordering::SeqCst), 1);
        assert_eq!(results.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn cleanup_timeout_prevents_result_ready_and_does_not_reopen_the_single_use_runtime() {
        let (_release, wait) = oneshot::channel();
        let (forwarder, sends, results) = policy_forwarder(Some(wait), "10000");
        assert!(forwarder.forward(1, request(None)).await.unwrap().is_some());
        let lifecycle = forwarder.lifecycle.lock().unwrap().clone().unwrap();
        let unfinished = lifecycle.tasks().spawn(std::future::pending::<()>());
        forwarder.cancel().unwrap();
        wait_state(&forwarder, ExperimentalTlsnRuntimeState::CleanupUnconfirmed).await;
        assert!(forwarder.forward(2, request(None)).await.unwrap().is_none());
        assert_eq!(sends.load(Ordering::SeqCst), 1);
        assert_eq!(results.load(Ordering::SeqCst), 0);
        unfinished.abort();
        assert!(unfinished.await.unwrap_err().is_cancelled());
        assert!(lifecycle.wait_for_cleanup().await);
        assert_eq!(
            forwarder.state().unwrap(),
            ExperimentalTlsnRuntimeState::CleanupUnconfirmed
        );
    }

    #[test]
    fn serializer_injects_one_binding_and_preserves_body_and_target() {
        let serialized = Http1OriginRequestSerializer
            .serialize(
                &request(None).into_parts().0,
                Bytes::from_static(b"abc"),
                &binding(),
            )
            .unwrap();
        let text = String::from_utf8(serialized.bytes().to_vec()).unwrap();
        assert_eq!(
            text.matches(&BINDING_HEADER.to_ascii_lowercase()).count(),
            1
        );
        assert!(text.starts_with("POST /kcsapi/api_get_member/require_info?x=1 HTTP/1.1\r\n"));
        assert!(text.ends_with("\r\n\r\nabc"));
    }

    #[test]
    fn serializer_rejects_oversized_total_before_allocating_serialized_request() {
        let mut parts = request(None).into_parts().0;
        parts.headers.remove(&CONTENT_LENGTH_HEADER_NAME);
        let oversized_body = Bytes::from(vec![b'a'; MAX_TLSN_SENT_DATA_BYTES]);

        assert_eq!(
            Http1OriginRequestSerializer
                .serialize(&parts, oversized_body, &binding())
                .unwrap_err(),
            SerializationError::RequestTooLarge
        );
    }

    #[test]
    fn serializer_rejects_existing_binding_and_duplicate_content_length() {
        let existing = request(Some("already-present")).into_parts().0;
        assert_eq!(
            Http1OriginRequestSerializer
                .serialize(&existing, Bytes::from_static(b"abc"), &binding())
                .unwrap_err(),
            SerializationError::ExistingBinding
        );

        let mut duplicate = request(None).into_parts().0;
        duplicate
            .headers
            .append(CONTENT_LENGTH_HEADER_NAME, HeaderValue::from_static("3"));
        assert_eq!(
            Http1OriginRequestSerializer
                .serialize(&duplicate, Bytes::from_static(b"abc"), &binding())
                .unwrap_err(),
            SerializationError::DuplicateContentLength
        );
    }

    #[tokio::test]
    async fn concrete_forwarder_runs_each_boundary_once_and_returns_origin_response() {
        let binding_calls = Arc::new(AtomicUsize::new(0));
        let connection_ids = Arc::new(Mutex::new(Vec::new()));
        let transport_calls = Arc::new(AtomicUsize::new(0));
        let verifier_calls = Arc::new(AtomicUsize::new(0));
        let result_calls = Arc::new(AtomicUsize::new(0));
        let request_bytes = Arc::new(Mutex::new(Vec::new()));
        let expected_request = Http1OriginRequestSerializer
            .serialize(
                &request(None).into_parts().0,
                Bytes::from_static(b"abc"),
                &binding(),
            )
            .unwrap();
        let mut origin_exchange = exchange();
        origin_exchange.transcript.request_sha256 = sha256(expected_request.bytes());
        let transport = Arc::new(MockTransport {
            calls: Arc::clone(&transport_calls),
            request_bytes: Arc::clone(&request_bytes),
            response: origin_exchange,
            retained_response: Mutex::new(None),
            proof_release: Mutex::new(None),
        });
        let forwarder = ExperimentalTlsnForwarder::new(
            Arc::new(MockBindingProvider {
                calls: Arc::clone(&binding_calls),
                connection_ids: Arc::clone(&connection_ids),
            }),
            Arc::new(Http1OriginRequestSerializer),
            Arc::clone(&transport) as Arc<dyn TlsnOriginTransport>,
            Arc::new(MockVerifier {
                calls: Arc::clone(&verifier_calls),
            }),
            Arc::new(MockResultBoundary {
                calls: Arc::clone(&result_calls),
            }),
        );

        let response = forwarder
            .forward(41, request(None))
            .await
            .unwrap()
            .expect("capture response");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            forwarder.origin_outcome().unwrap(),
            OriginRequestOutcome::ResponseReceived
        );
        assert_eq!(binding_calls.load(Ordering::SeqCst), 1);
        assert_eq!(connection_ids.lock().unwrap().as_slice(), [41]);
        assert_eq!(transport_calls.load(Ordering::SeqCst), 1);
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                if forwarder.state().unwrap() == ExperimentalTlsnRuntimeState::ResultReady {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("background proof pipeline did not complete");
        assert_eq!(verifier_calls.load(Ordering::SeqCst), 1);
        assert_eq!(result_calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            forwarder.state().unwrap(),
            ExperimentalTlsnRuntimeState::ResultReady
        );
        assert_eq!(request_bytes.lock().unwrap().len(), 1);
        assert_eq!(request_bytes.lock().unwrap()[0], expected_request.bytes());
        assert_eq!(
            request_bytes.lock().unwrap()[0]
                .windows(BINDING_HEADER.len())
                .filter(|window| *window == BINDING_HEADER.to_ascii_lowercase().as_bytes())
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn deferred_verification_stops_before_result_boundary() {
        let verifier_calls = Arc::new(AtomicUsize::new(0));
        let result_calls = Arc::new(AtomicUsize::new(0));
        let transport = Arc::new(MockTransport {
            calls: Arc::new(AtomicUsize::new(0)),
            request_bytes: Arc::new(Mutex::new(Vec::new())),
            response: exchange(),
            retained_response: Mutex::new(None),
            proof_release: Mutex::new(None),
        });
        let forwarder = ExperimentalTlsnForwarder::new(
            Arc::new(MockBindingProvider {
                calls: Arc::new(AtomicUsize::new(0)),
                connection_ids: Arc::new(Mutex::new(Vec::new())),
            }),
            Arc::new(Http1OriginRequestSerializer),
            Arc::clone(&transport) as Arc<dyn TlsnOriginTransport>,
            Arc::new(DeferredVerifier {
                calls: Arc::clone(&verifier_calls),
            }),
            Arc::new(MockResultBoundary {
                calls: Arc::clone(&result_calls),
            }),
        );

        let response = forwarder
            .forward(41, request(None))
            .await
            .unwrap()
            .expect("capture response");
        assert_eq!(response.status(), StatusCode::OK);
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                if forwarder.state().unwrap() == ExperimentalTlsnRuntimeState::VerificationDeferred
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("deferred verification state was not recorded");
        assert_eq!(verifier_calls.load(Ordering::SeqCst), 1);
        assert_eq!(result_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn forward_returns_before_proof_continuation_completes() {
        let (release_tx, release_rx) = oneshot::channel();
        let verifier_calls = Arc::new(AtomicUsize::new(0));
        let result_calls = Arc::new(AtomicUsize::new(0));
        let expected_request = Http1OriginRequestSerializer
            .serialize(
                &request(None).into_parts().0,
                Bytes::from_static(b"abc"),
                &binding(),
            )
            .unwrap();
        let mut origin_exchange = exchange();
        origin_exchange.transcript.request_sha256 = sha256(expected_request.bytes());
        let transport = Arc::new(MockTransport {
            calls: Arc::new(AtomicUsize::new(0)),
            request_bytes: Arc::new(Mutex::new(Vec::new())),
            response: origin_exchange,
            retained_response: Mutex::new(None),
            proof_release: Mutex::new(Some(release_rx)),
        });
        let forwarder = ExperimentalTlsnForwarder::new(
            Arc::new(MockBindingProvider {
                calls: Arc::new(AtomicUsize::new(0)),
                connection_ids: Arc::new(Mutex::new(Vec::new())),
            }),
            Arc::new(Http1OriginRequestSerializer),
            Arc::clone(&transport) as Arc<dyn TlsnOriginTransport>,
            Arc::new(MockVerifier {
                calls: Arc::clone(&verifier_calls),
            }),
            Arc::new(MockResultBoundary {
                calls: Arc::clone(&result_calls),
            }),
        );

        let response = forwarder
            .forward(41, request(None))
            .await
            .unwrap()
            .expect("capture response");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            forwarder.state().unwrap(),
            ExperimentalTlsnRuntimeState::ResponseReturned
        );
        assert_eq!(verifier_calls.load(Ordering::SeqCst), 0);
        assert_eq!(result_calls.load(Ordering::SeqCst), 0);

        release_tx.send(()).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                if forwarder.state().unwrap() == ExperimentalTlsnRuntimeState::ResultReady {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("background proof pipeline did not complete");
        assert_eq!(verifier_calls.load(Ordering::SeqCst), 1);
        assert_eq!(result_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn proof_failure_records_stage_after_response_returns() {
        let (release_tx, release_rx) = oneshot::channel();
        drop(release_tx);
        let expected_request = Http1OriginRequestSerializer
            .serialize(
                &request(None).into_parts().0,
                Bytes::from_static(b"abc"),
                &binding(),
            )
            .unwrap();
        let mut origin_exchange = exchange();
        origin_exchange.transcript.request_sha256 = sha256(expected_request.bytes());
        let transport = Arc::new(MockTransport {
            calls: Arc::new(AtomicUsize::new(0)),
            request_bytes: Arc::new(Mutex::new(Vec::new())),
            response: origin_exchange,
            retained_response: Mutex::new(None),
            proof_release: Mutex::new(Some(release_rx)),
        });
        let forwarder = ExperimentalTlsnForwarder::new(
            Arc::new(MockBindingProvider {
                calls: Arc::new(AtomicUsize::new(0)),
                connection_ids: Arc::new(Mutex::new(Vec::new())),
            }),
            Arc::new(Http1OriginRequestSerializer),
            Arc::clone(&transport) as Arc<dyn TlsnOriginTransport>,
            Arc::new(MockVerifier {
                calls: Arc::new(AtomicUsize::new(0)),
            }),
            Arc::new(MockResultBoundary {
                calls: Arc::new(AtomicUsize::new(0)),
            }),
        );

        let response = forwarder
            .forward(41, request(None))
            .await
            .unwrap()
            .expect("capture response");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            forwarder.state().unwrap(),
            ExperimentalTlsnRuntimeState::ResponseReturned
        );
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                if forwarder.state().unwrap() == ExperimentalTlsnRuntimeState::ProveFailed {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("proof stage failure was not recorded");
    }

    #[tokio::test]
    async fn unavailable_dependencies_fail_closed_before_transport() {
        let forwarder = ExperimentalTlsnForwarder::unavailable();
        assert!(forwarder.forward(7, request(None)).await.unwrap().is_none());
        assert_eq!(
            forwarder.origin_outcome().unwrap(),
            OriginRequestOutcome::NotSent
        );
        assert_eq!(
            forwarder.state().unwrap(),
            ExperimentalTlsnRuntimeState::Ready
        );
    }

    #[tokio::test]
    async fn runtime_config_binding_errors_stop_before_origin_transport() {
        for binding_error in [
            BindingError::RuntimeConfigUnavailable,
            BindingError::RuntimeConfigChanged,
        ] {
            let binding_calls = Arc::new(AtomicUsize::new(0));
            let transport_calls = Arc::new(AtomicUsize::new(0));
            let transport = Arc::new(MockTransport {
                calls: Arc::clone(&transport_calls),
                request_bytes: Arc::new(Mutex::new(Vec::new())),
                response: exchange(),
                retained_response: Mutex::new(None),
                proof_release: Mutex::new(None),
            });
            let forwarder = ExperimentalTlsnForwarder::new(
                Arc::new(FailingBindingProvider {
                    calls: Arc::clone(&binding_calls),
                    error: binding_error.clone(),
                }),
                Arc::new(Http1OriginRequestSerializer),
                Arc::clone(&transport) as Arc<dyn TlsnOriginTransport>,
                Arc::new(UnconfiguredVerifier),
                Arc::new(UnconfiguredResultBoundary),
            );

            assert!(forwarder.forward(7, request(None)).await.unwrap().is_none());
            assert_eq!(binding_calls.load(Ordering::SeqCst), 1);
            assert_eq!(transport_calls.load(Ordering::SeqCst), 0);
            assert_eq!(
                forwarder.state().unwrap(),
                ExperimentalTlsnRuntimeState::Ready
            );
        }
    }

    #[tokio::test]
    async fn selected_runtime_cannot_be_replayed_or_fallback_to_production() {
        let transport_calls = Arc::new(AtomicUsize::new(0));
        let transport = Arc::new(MockTransport {
            calls: Arc::clone(&transport_calls),
            request_bytes: Arc::new(Mutex::new(Vec::new())),
            response: exchange(),
            retained_response: Mutex::new(None),
            proof_release: Mutex::new(None),
        });
        let forwarder = ExperimentalTlsnForwarder::new(
            Arc::new(MockBindingProvider {
                calls: Arc::new(AtomicUsize::new(0)),
                connection_ids: Arc::new(Mutex::new(Vec::new())),
            }),
            Arc::new(Http1OriginRequestSerializer),
            Arc::clone(&transport) as Arc<dyn TlsnOriginTransport>,
            Arc::new(UnconfiguredVerifier),
            Arc::new(UnconfiguredResultBoundary),
        );
        let first = forwarder.forward(1, request(None)).await;
        assert!(first.is_ok_and(|response| response.is_some()));
        assert_eq!(transport_calls.load(Ordering::SeqCst), 1);
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                if forwarder.state().unwrap()
                    == ExperimentalTlsnRuntimeState::WorkerVerificationFailed
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("detached verifier failure was not recorded");
        let second = forwarder.forward(1, request(None)).await;
        assert!(second.is_ok_and(|response| response.is_some()));
        assert_eq!(transport_calls.load(Ordering::SeqCst), 2);
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                if forwarder.state().unwrap()
                    == ExperimentalTlsnRuntimeState::WorkerVerificationFailed
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("second attempt failure was not recorded");
        assert_eq!(
            forwarder.state().unwrap(),
            ExperimentalTlsnRuntimeState::WorkerVerificationFailed
        );
    }

    struct FailingOrigin {
        ambiguous: bool,
        calls: Arc<AtomicUsize>,
    }

    impl TlsnOriginTransport for FailingOrigin {
        fn send_once(&self, _: SerializedOriginRequest) -> TlsnTransportFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let error = if self.ambiguous {
                TlsnTransportError::AmbiguousOriginSend
            } else {
                TlsnTransportError::OriginConnectionFailed
            };
            Box::pin(async move { Err(error) })
        }
    }

    #[tokio::test]
    async fn pre_send_failure_and_ambiguous_write_are_distinct_and_neither_retries() {
        for ambiguous in [false, true] {
            let calls = Arc::new(AtomicUsize::new(0));
            let forwarder = ExperimentalTlsnForwarder::new(
                Arc::new(MockBindingProvider {
                    calls: Arc::new(AtomicUsize::new(0)),
                    connection_ids: Arc::new(Mutex::new(Vec::new())),
                }),
                Arc::new(Http1OriginRequestSerializer),
                Arc::new(FailingOrigin {
                    ambiguous,
                    calls: Arc::clone(&calls),
                }),
                Arc::new(UnconfiguredVerifier),
                Arc::new(UnconfiguredResultBoundary),
            );
            let result = forwarder.forward(1, request(None)).await;
            if ambiguous {
                assert!(result.is_err());
            } else {
                assert!(result.is_ok_and(|response| response.is_none()));
            }
            assert_eq!(
                forwarder.origin_outcome().unwrap(),
                if ambiguous {
                    OriginRequestOutcome::Unknown
                } else {
                    OriginRequestOutcome::NotSent
                }
            );
            assert_eq!(calls.load(Ordering::SeqCst), 1);
        }
    }

    struct GatedWorker {
        release: Mutex<Option<oneshot::Receiver<()>>>,
    }

    impl ExperimentalVerifierBoundary for GatedWorker {
        fn verify(
            &self,
            _: u64,
            _: SerializedOriginRequest,
            _: AttestationBinding,
            _: TlsnOriginExchange,
        ) -> VerificationFuture {
            let release = self.release.lock().unwrap().take().unwrap();
            Box::pin(async move {
                let _ = release.await;
                Err(VerificationError::WorkerUnavailable)
            })
        }
    }

    struct GatedDelivery {
        release: Mutex<Option<oneshot::Receiver<()>>>,
        signing_failure: bool,
    }

    impl ExperimentalResultBoundary for GatedDelivery {
        fn accept(&self, _: VerifiedTlsnEvidence) -> ResultBoundaryFuture {
            let release = self.release.lock().unwrap().take().unwrap();
            let signing_failure = self.signing_failure;
            Box::pin(async move {
                let _ = release.await;
                Err(if signing_failure {
                    ResultBoundaryError::SigningUnavailable
                } else {
                    ResultBoundaryError::DeliveryUnavailable
                })
            })
        }
    }

    #[tokio::test]
    async fn delayed_worker_signing_and_archive_failures_cannot_hold_or_rewrite_origin_response() {
        for stage in ["worker", "signing", "archive"] {
            let (release_tx, release_rx) = oneshot::channel();
            let (verifier, boundary): (
                Arc<dyn ExperimentalVerifierBoundary>,
                Arc<dyn ExperimentalResultBoundary>,
            ) = if stage == "worker" {
                (
                    Arc::new(GatedWorker {
                        release: Mutex::new(Some(release_rx)),
                    }),
                    Arc::new(UnconfiguredResultBoundary),
                )
            } else {
                (
                    Arc::new(MockVerifier {
                        calls: Arc::new(AtomicUsize::new(0)),
                    }),
                    Arc::new(GatedDelivery {
                        release: Mutex::new(Some(release_rx)),
                        signing_failure: stage == "signing",
                    }),
                )
            };
            let serialized = Http1OriginRequestSerializer
                .serialize(
                    &request(None).into_parts().0,
                    Bytes::from_static(b"abc"),
                    &binding(),
                )
                .unwrap();
            let mut captured = exchange();
            captured.transcript.request_sha256 = sha256(serialized.bytes());
            let calls = Arc::new(AtomicUsize::new(0));
            let forwarder = ExperimentalTlsnForwarder::new(
                Arc::new(MockBindingProvider {
                    calls: Arc::new(AtomicUsize::new(0)),
                    connection_ids: Arc::new(Mutex::new(Vec::new())),
                }),
                Arc::new(Http1OriginRequestSerializer),
                Arc::new(MockTransport {
                    calls: Arc::clone(&calls),
                    request_bytes: Arc::new(Mutex::new(Vec::new())),
                    response: captured,
                    retained_response: Mutex::new(None),
                    proof_release: Mutex::new(None),
                }),
                verifier,
                boundary,
            );
            let response = tokio::time::timeout(
                std::time::Duration::from_secs(1),
                forwarder.forward(1, request(None)),
            )
            .await
            .unwrap()
            .unwrap()
            .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.body().as_ref(), b"ok");
            assert_eq!(
                forwarder.origin_outcome().unwrap(),
                OriginRequestOutcome::ResponseReceived
            );
            assert_ne!(
                forwarder.state().unwrap(),
                ExperimentalTlsnRuntimeState::ResultReady
            );
            release_tx.send(()).unwrap();
            let failed = match stage {
                "worker" => ExperimentalTlsnRuntimeState::WorkerUnavailable,
                "signing" => ExperimentalTlsnRuntimeState::ResultSigningFailed,
                _ => ExperimentalTlsnRuntimeState::ArtifactDeliveryFailed,
            };
            tokio::time::timeout(std::time::Duration::from_secs(1), async {
                while forwarder.state().unwrap() != failed {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
            assert_eq!(
                forwarder.origin_outcome().unwrap(),
                OriginRequestOutcome::ResponseReceived
            );
            assert_eq!(calls.load(Ordering::SeqCst), 1);
        }
    }
}
