use http::{request, HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Version};
use hudsucker::{
    hyper::{Request, Response},
    Body,
};
use hyper::body::Bytes;
use sha2::{Digest, Sha256};
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};

pub const BINDING_HEADER: &str = "X-Attestation-Binding";
const BINDING_HEADER_NAME: HeaderName = HeaderName::from_static("x-attestation-binding");
const HOST_HEADER_NAME: HeaderName = HeaderName::from_static("host");
const CONTENT_LENGTH_HEADER_NAME: HeaderName = HeaderName::from_static("content-length");
const TRANSFER_ENCODING_HEADER_NAME: HeaderName = HeaderName::from_static("transfer-encoding");

pub type ExperimentalForwardFuture =
    Pin<Box<dyn Future<Output = Result<Response<Body>, String>> + Send>>;
pub type BindingFuture =
    Pin<Box<dyn Future<Output = Result<AttestationBinding, BindingError>> + Send>>;
pub type TlsnTransportFuture =
    Pin<Box<dyn Future<Output = Result<TlsnOriginExchange, TlsnTransportError>> + Send>>;
pub type VerificationFuture =
    Pin<Box<dyn Future<Output = Result<VerifiedTlsnEvidence, VerificationError>> + Send>>;
pub type ResultBoundaryFuture =
    Pin<Box<dyn Future<Output = Result<(), ResultBoundaryError>> + Send>>;

pub trait ExperimentalRequireInfoForwarder: Send + Sync {
    fn forward(&self, connection_id: u64, request: Request<Bytes>) -> ExperimentalForwardFuture;
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
    AlreadyIssued,
    InvalidBinding,
}

impl std::fmt::Display for BindingError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::NoBindingAuthority => "NoBindingAuthority",
            Self::AlreadyIssued => "binding provider already issued its single-use binding",
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
    fn new(connection_id: u64, target: &str) -> Self {
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
            Self::InvalidHeaderValue => "header value cannot be serialized safely",
            Self::EmptyRequest => "serialized origin request is empty",
        };
        formatter.write_str(message)
    }
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
        let mut output = Vec::with_capacity(256 + body.len());
        output.extend_from_slice(parts.method.as_str().as_bytes());
        output.push(b' ');
        output.extend_from_slice(target.as_bytes());
        output.extend_from_slice(b" HTTP/1.1\r\n");

        for (name, value) in &parts.headers {
            append_header(&mut output, name, value)?;
        }
        if content_length_values.is_empty() {
            append_header_value(
                &mut output,
                &CONTENT_LENGTH_HEADER_NAME,
                body.len().to_string().as_bytes(),
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
    Unavailable,
    AlreadySent,
    OriginConnectionFailed,
    ResponseReadFailed,
}

impl std::fmt::Display for TlsnTransportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::Unavailable => "TLSN origin transport is unavailable",
            Self::AlreadySent => "TLSN origin transport rejected a duplicate send",
            Self::OriginConnectionFailed => "TLSN origin connection failed",
            Self::ResponseReadFailed => "TLSN origin response read failed",
        };
        formatter.write_str(message)
    }
}

pub trait TlsnOriginTransport: Send + Sync {
    fn send_once(&self, request: SerializedOriginRequest) -> TlsnTransportFuture;
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
    EvidenceReady,
    Verified,
    ResultReady,
}

pub struct ExperimentalTlsnForwarder {
    binding_provider: Arc<dyn AttestationBindingProvider>,
    serializer: Arc<dyn OriginRequestSerializer>,
    transport: Arc<dyn TlsnOriginTransport>,
    verifier: Arc<dyn ExperimentalVerifierBoundary>,
    result_boundary: Arc<dyn ExperimentalResultBoundary>,
    state: Arc<Mutex<ExperimentalTlsnRuntimeState>>,
}

impl ExperimentalTlsnForwarder {
    pub fn new(
        binding_provider: Arc<dyn AttestationBindingProvider>,
        serializer: Arc<dyn OriginRequestSerializer>,
        transport: Arc<dyn TlsnOriginTransport>,
        verifier: Arc<dyn ExperimentalVerifierBoundary>,
        result_boundary: Arc<dyn ExperimentalResultBoundary>,
    ) -> Arc<Self> {
        Arc::new(Self {
            binding_provider: Arc::new(SingleUseBindingProvider::new(binding_provider)),
            serializer,
            transport,
            verifier,
            result_boundary,
            state: Arc::new(Mutex::new(ExperimentalTlsnRuntimeState::Ready)),
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

    fn transition(
        &self,
        expected: ExperimentalTlsnRuntimeState,
        next: ExperimentalTlsnRuntimeState,
    ) -> Result<(), String> {
        let mut state = self
            .state
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

    async fn forward_inner(
        self: Arc<Self>,
        connection_id: u64,
        request: Request<Bytes>,
    ) -> Result<Response<Body>, String> {
        self.transition(
            ExperimentalTlsnRuntimeState::Ready,
            ExperimentalTlsnRuntimeState::Selected,
        )?;
        let (parts, body) = request.into_parts();
        let context = BindingRequestContext::new(connection_id, parts.uri.path());
        let binding = self
            .binding_provider
            .issue_binding(context)
            .await
            .map_err(|error| error.to_string())?;
        self.transition(
            ExperimentalTlsnRuntimeState::Selected,
            ExperimentalTlsnRuntimeState::BindingIssued,
        )?;
        let serialized = self
            .serializer
            .serialize(&parts, body, &binding)
            .map_err(|error| error.to_string())?;
        self.transition(
            ExperimentalTlsnRuntimeState::BindingIssued,
            ExperimentalTlsnRuntimeState::Serialized,
        )?;

        // This transition is intentionally committed before transport I/O. Any
        // partial write or connection error must not be retried or sent to Production.
        self.transition(
            ExperimentalTlsnRuntimeState::Serialized,
            ExperimentalTlsnRuntimeState::Sent,
        )?;
        let exchange = self
            .transport
            .send_once(serialized.clone())
            .await
            .map_err(|error| error.to_string())?;
        self.transition(
            ExperimentalTlsnRuntimeState::Sent,
            ExperimentalTlsnRuntimeState::ResponseReceived,
        )?;
        let browser_response = exchange.response.clone();
        self.transition(
            ExperimentalTlsnRuntimeState::ResponseReceived,
            ExperimentalTlsnRuntimeState::EvidenceReady,
        )?;
        let verified = self
            .verifier
            .verify(connection_id, serialized, binding, exchange)
            .await
            .map_err(|error| error.to_string())?;
        self.transition(
            ExperimentalTlsnRuntimeState::EvidenceReady,
            ExperimentalTlsnRuntimeState::Verified,
        )?;
        self.result_boundary
            .accept(verified)
            .await
            .map_err(|error| error.to_string())?;
        self.transition(
            ExperimentalTlsnRuntimeState::Verified,
            ExperimentalTlsnRuntimeState::ResultReady,
        )?;

        response_from_origin(browser_response)
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
            state: Arc::clone(&self.state),
        });
        Box::pin(forwarder.forward_inner(connection_id, request))
    }
}

fn response_from_origin(response: TlsnOriginResponse) -> Result<Response<Body>, String> {
    let mut builder = Response::builder().status(response.status);
    for (name, value) in &response.headers {
        builder = builder.header(name, value);
    }
    builder
        .body(Body::from(http_body_util::Full::from(response.body)))
        .map_err(|error| format!("failed to construct browser response: {error}"))
}

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    let digest = Sha256::digest(bytes);
    let mut output = [0_u8; 32];
    output.copy_from_slice(&digest);
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

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

    struct MockTransport {
        calls: Arc<AtomicUsize>,
        request_bytes: Arc<Mutex<Vec<Vec<u8>>>>,
        response: TlsnOriginExchange,
        retained_response: Mutex<Option<TlsnOriginResponse>>,
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
            Box::pin(async move { Ok(response) })
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
                Ok(VerifiedTlsnEvidence::from_verifier(
                    sha256(request.bytes()),
                    sha256(&exchange.response.raw_response_bytes),
                    VerifiedMemberId::from_verifier("16189463".to_owned())?,
                ))
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

        let response = forwarder.forward(41, request(None)).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(binding_calls.load(Ordering::SeqCst), 1);
        assert_eq!(connection_ids.lock().unwrap().as_slice(), [41]);
        assert_eq!(transport_calls.load(Ordering::SeqCst), 1);
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
    async fn unavailable_dependencies_fail_closed_before_transport() {
        let forwarder = ExperimentalTlsnForwarder::unavailable();
        let error = forwarder.forward(7, request(None)).await.unwrap_err();
        assert!(error.contains("NoBindingAuthority"));
        assert_eq!(
            forwarder.state().unwrap(),
            ExperimentalTlsnRuntimeState::Selected
        );
    }

    #[tokio::test]
    async fn selected_runtime_cannot_be_replayed_or_fallback_to_production() {
        let transport_calls = Arc::new(AtomicUsize::new(0));
        let transport = Arc::new(MockTransport {
            calls: Arc::clone(&transport_calls),
            request_bytes: Arc::new(Mutex::new(Vec::new())),
            response: exchange(),
            retained_response: Mutex::new(None),
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
        assert!(first.is_err());
        assert_eq!(transport_calls.load(Ordering::SeqCst), 1);
        let second = forwarder.forward(1, request(None)).await;
        assert!(second.is_err());
        assert_eq!(transport_calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            forwarder.state().unwrap(),
            ExperimentalTlsnRuntimeState::EvidenceReady
        );
    }
}
