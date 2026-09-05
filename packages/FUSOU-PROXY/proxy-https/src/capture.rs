use chrono::{DateTime, SecondsFormat, Utc};
use http::{request, response, HeaderMap, Version};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

const CAPTURE_MAGIC: &[u8] = b"FUSOU-CAPTURE-V1\0";
const REQUEST_BODY_FILE: &str = "request-body.bin";
const RESPONSE_BODY_FILE: &str = "response-body.bin";
const REQUEST_WIRE_FILE: &str = "request-wire.bin";
const RESPONSE_WIRE_FILE: &str = "response-wire.bin";
const MANIFEST_FILE: &str = "manifest.json";
static CAPTURE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
pub enum CaptureError {
    MissingRequest,
    InvalidCaptureId,
    InvalidBoundary,
    InvalidMessageBoundary,
    OutputPathNotAbsolute,
    InvalidPayloadFile,
    InvalidEvidencePolicy(String),
    Io(io::Error),
    Json(serde_json::Error),
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingRequest => formatter.write_str("capture response recorded before request"),
            Self::InvalidCaptureId => {
                formatter.write_str("capture ID must be a single safe path component")
            }
            Self::InvalidBoundary => {
                formatter.write_str("capture boundary does not match payload length")
            }
            Self::InvalidMessageBoundary => {
                formatter.write_str("capture message boundary does not match wire stream")
            }
            Self::OutputPathNotAbsolute => {
                formatter.write_str("capture output path must be absolute")
            }
            Self::InvalidPayloadFile => {
                formatter.write_str("capture payload file must be a single safe path component")
            }
            Self::InvalidEvidencePolicy(message) => {
                write!(formatter, "invalid capture evidence policy: {message}")
            }
            Self::Io(error) => write!(formatter, "capture I/O failed: {error}"),
            Self::Json(error) => write!(formatter, "capture JSON failed: {error}"),
        }
    }
}

impl std::error::Error for CaptureError {}

impl From<io::Error> for CaptureError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for CaptureError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

pub const CAPTURE_COLLECTOR_VERSION: &str = "exact-wire-capture-v3";
pub const HUDSUCKER_FORK_REVISION: &str = "hudsucker-0.23.0-fusou-maintained-fork";
pub const NATURAL_CAPTURE_REVIEW_SCHEMA_VERSION: u32 = 2;
pub const CLIENT_FACING_TLS_PLAINTEXT_BOUNDARY: &str =
    "after MITM TLS accept and before Hyper parsing";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CaptureRuntimeMetadata {
    pub app_version: String,
    pub game_client: String,
    pub allowlisted_game_server: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NaturalCaptureObservation {
    pub observed_at_utc: String,
    pub app_version: String,
    pub game_client: String,
    pub allowlisted_game_server: String,
    pub ordinary_fusou_app_startup: bool,
    pub ordinary_gameplay: bool,
    pub existing_client_generated_request: bool,
    pub observed_require_info: bool,
    pub no_standalone_game_server_request: bool,
    pub no_request_injection: bool,
    pub no_request_replay: bool,
    pub no_request_retry: bool,
    pub no_capture_generated_traffic: bool,
    pub client_facing_tls_plaintext_boundary: String,
    pub trigger_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NaturalCapturePrivacyReview {
    pub reviewed_at_utc: String,
    pub reviewer_role: String,
    pub raw_artifact_retained_private: bool,
    pub no_raw_artifact_committed: bool,
    pub sanitized_fixture_reviewed: bool,
    pub sanitized_fixture_id: String,
    pub no_credentials_or_session_tokens_in_sanitized_fixture: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NaturalCaptureOperationalReview {
    pub launcher_revision: String,
    pub proxy_persistence_disabled: bool,
    pub app_uploads_disabled: bool,
    pub pending_uploads_reviewed: bool,
    pub external_transmission_status: String,
    pub external_transmission_evidence: String,
    pub credential_exposure_status: String,
    pub privacy_disposition: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NaturalCaptureReview {
    pub schema_version: u32,
    pub review_id: String,
    pub capture_id: String,
    pub capture_complete_artifact_sha256: String,
    pub observation: NaturalCaptureObservation,
    pub privacy_review: NaturalCapturePrivacyReview,
    pub operational_review: NaturalCaptureOperationalReview,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CaptureProvenance {
    pub evidence_class: String,
    pub natural_provenance: bool,
    pub capture_enabled: bool,
    pub app_version: Option<String>,
    pub proxy_version: String,
    pub hudsucker_fork_revision: String,
    pub collector_version: String,
    pub game_client: Option<String>,
    pub allowlisted_game_server: Option<String>,
    pub connection_id: Option<u64>,
    pub capture_started_at_utc: Option<String>,
    pub capture_ended_at_utc: Option<String>,
    pub manual_observation_record: Option<String>,
}

impl CaptureProvenance {
    pub fn synthetic() -> Self {
        Self {
            evidence_class: "synthetic".to_string(),
            natural_provenance: false,
            capture_enabled: true,
            app_version: None,
            proxy_version: env!("CARGO_PKG_VERSION").to_string(),
            hudsucker_fork_revision: HUDSUCKER_FORK_REVISION.to_string(),
            collector_version: CAPTURE_COLLECTOR_VERSION.to_string(),
            game_client: None,
            allowlisted_game_server: None,
            connection_id: None,
            capture_started_at_utc: None,
            capture_ended_at_utc: None,
            manual_observation_record: None,
        }
    }

    pub fn natural_candidate(runtime: &CaptureRuntimeMetadata) -> Self {
        let mut provenance = Self::synthetic();
        provenance.evidence_class = "natural_candidate".to_string();
        provenance.app_version = Some(runtime.app_version.clone());
        provenance.game_client = Some(runtime.game_client.clone());
        provenance.allowlisted_game_server = Some(runtime.allowlisted_game_server.clone());
        provenance
    }

    pub(crate) fn for_connection(mut self, connection_id: u64) -> Self {
        self.connection_id = Some(connection_id);
        self.capture_started_at_utc = Some(capture_timestamp());
        self
    }

    pub(crate) fn mark_finished(&mut self) {
        self.capture_ended_at_utc = Some(capture_timestamp());
    }

    fn structured() -> Self {
        let mut provenance = Self::synthetic();
        provenance.evidence_class = "non_evidence".to_string();
        provenance
    }
}

impl Default for CaptureProvenance {
    fn default() -> Self {
        Self {
            evidence_class: "legacy".to_string(),
            natural_provenance: false,
            capture_enabled: false,
            app_version: None,
            proxy_version: "UNKNOWN".to_string(),
            hudsucker_fork_revision: "UNKNOWN".to_string(),
            collector_version: "UNKNOWN".to_string(),
            game_client: None,
            allowlisted_game_server: None,
            connection_id: None,
            capture_started_at_utc: None,
            capture_ended_at_utc: None,
            manual_observation_record: None,
        }
    }
}

fn capture_timestamp() -> String {
    DateTime::<Utc>::from(SystemTime::now()).to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[derive(Debug, Clone)]
pub struct CapturedMessage {
    version: String,
    method: Option<String>,
    target: Option<String>,
    status: Option<u16>,
    reason: Option<String>,
    headers: Vec<CapturedHeader>,
    body: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CapturedHeader {
    name: String,
    value: Vec<u8>,
}

impl CapturedMessage {
    pub fn from_request(parts: &request::Parts, body: &[u8]) -> Self {
        Self {
            version: version_name(parts.version),
            method: Some(parts.method.as_str().to_string()),
            target: Some(parts.uri.to_string()),
            status: None,
            reason: None,
            headers: captured_headers(&parts.headers),
            body: body.to_vec(),
        }
    }

    pub fn from_response(parts: &response::Parts, body: &[u8]) -> Self {
        Self {
            version: version_name(parts.version),
            method: None,
            target: None,
            status: Some(parts.status.as_u16()),
            reason: parts.status.canonical_reason().map(str::to_string),
            headers: captured_headers(&parts.headers),
            body: body.to_vec(),
        }
    }

    pub fn body_bytes(&self) -> &[u8] {
        &self.body
    }

    fn manifest(&self, direction: &str, body_file: &str, stream_start: u64) -> MessageManifest {
        let body_length = self.body.len() as u64;
        MessageManifest {
            sequence: None,
            direction: direction.to_string(),
            representation: "handler-visible body bytes; not original HTTP wire bytes".to_string(),
            parse_state: "HANDLER_VISIBLE_BODY".to_string(),
            body_file: body_file.to_string(),
            body_bytes: body_length,
            body_sha256: sha256_hex(&self.body),
            stream_start,
            stream_end: stream_start + body_length,
            version: self.version.clone(),
            method: self.method.clone(),
            target: self.target.clone(),
            status: self.status,
            reason: self.reason.clone(),
            headers: self
                .headers
                .iter()
                .map(|header| HeaderManifest {
                    name: header.name.clone(),
                    value_hex: hex_encode(&header.value),
                })
                .collect(),
            framing: FramingManifest {
                content_length_hex: header_values_hex(&self.headers, "content-length"),
                transfer_encoding_hex: header_values_hex(&self.headers, "transfer-encoding"),
                content_encoding_hex: header_values_hex(&self.headers, "content-encoding"),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExactWireMetadata {
    version: String,
    method: Option<String>,
    target: Option<String>,
    status: Option<u16>,
    reason: Option<String>,
    headers: Vec<CapturedHeader>,
}

impl ExactWireMetadata {
    pub fn from_request<B>(request: &request::Request<B>) -> Self {
        Self {
            version: version_name(request.version()),
            method: Some(request.method().as_str().to_string()),
            target: Some(request.uri().to_string()),
            status: None,
            reason: None,
            headers: captured_headers(request.headers()),
        }
    }

    pub fn from_response<B>(response: &response::Response<B>) -> Self {
        Self {
            version: version_name(response.version()),
            method: None,
            target: None,
            status: Some(response.status().as_u16()),
            reason: response.status().canonical_reason().map(str::to_string),
            headers: captured_headers(response.headers()),
        }
    }

    pub fn target(&self) -> Option<&str> {
        self.target.as_deref()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExactWireDirection {
    Request,
    Response,
}

impl ExactWireDirection {
    fn as_str(self) -> &'static str {
        match self {
            Self::Request => "request",
            Self::Response => "response",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExactWireMessage {
    bytes: Vec<u8>,
    stream_start: u64,
    stream_end: u64,
    direction: ExactWireDirection,
    sequence: u64,
    metadata: ExactWireMetadata,
}

impl ExactWireMessage {
    pub fn from_parts(
        bytes: impl Into<Vec<u8>>,
        stream_start: u64,
        stream_end: u64,
    ) -> Result<Self, CaptureError> {
        let bytes = bytes.into();
        if stream_end < stream_start || stream_end - stream_start != bytes.len() as u64 {
            return Err(CaptureError::InvalidBoundary);
        }
        Ok(Self {
            bytes,
            stream_start,
            stream_end,
            direction: ExactWireDirection::Request,
            sequence: 0,
            metadata: ExactWireMetadata {
                version: "WIRE_UNKNOWN".to_string(),
                method: None,
                target: None,
                status: None,
                reason: None,
                headers: Vec::new(),
            },
        })
    }

    pub fn from_bytes(bytes: impl Into<Vec<u8>>, stream_start: u64) -> Result<Self, CaptureError> {
        let bytes = bytes.into();
        let stream_end = stream_start
            .checked_add(bytes.len() as u64)
            .ok_or(CaptureError::InvalidBoundary)?;
        Ok(Self {
            bytes,
            stream_start,
            stream_end,
            direction: ExactWireDirection::Request,
            sequence: 0,
            metadata: ExactWireMetadata {
                version: "WIRE_UNKNOWN".to_string(),
                method: None,
                target: None,
                status: None,
                reason: None,
                headers: Vec::new(),
            },
        })
    }

    pub fn from_parts_with_metadata(
        bytes: impl Into<Vec<u8>>,
        stream_start: u64,
        stream_end: u64,
        direction: ExactWireDirection,
        sequence: u64,
        metadata: ExactWireMetadata,
    ) -> Result<Self, CaptureError> {
        let bytes = bytes.into();
        if stream_end < stream_start || stream_end - stream_start != bytes.len() as u64 {
            return Err(CaptureError::InvalidBoundary);
        }
        Ok(Self {
            bytes,
            stream_start,
            stream_end,
            direction,
            sequence,
            metadata,
        })
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn stream_start(&self) -> u64 {
        self.stream_start
    }

    pub fn stream_end(&self) -> u64 {
        self.stream_end
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExactWireCapture {
    request_bytes: Vec<u8>,
    response_bytes: Vec<u8>,
    messages: Vec<ExactWireMessage>,
    provenance: CaptureProvenance,
}

impl ExactWireCapture {
    pub fn new(request: ExactWireMessage, response: ExactWireMessage) -> Self {
        let request_bytes = request.bytes.clone();
        let response_bytes = response.bytes.clone();
        let request = ExactWireMessage {
            direction: ExactWireDirection::Request,
            sequence: 0,
            ..request
        };
        let response = ExactWireMessage {
            direction: ExactWireDirection::Response,
            sequence: 1,
            ..response
        };
        Self {
            request_bytes,
            response_bytes,
            messages: vec![request, response],
            provenance: CaptureProvenance::synthetic(),
        }
    }

    pub fn from_transcript(
        request_bytes: impl Into<Vec<u8>>,
        response_bytes: impl Into<Vec<u8>>,
        messages: Vec<ExactWireMessage>,
    ) -> Result<Self, CaptureError> {
        Self::from_transcript_with_provenance(
            request_bytes,
            response_bytes,
            messages,
            CaptureProvenance::synthetic(),
        )
    }

    pub fn from_transcript_with_provenance(
        request_bytes: impl Into<Vec<u8>>,
        response_bytes: impl Into<Vec<u8>>,
        messages: Vec<ExactWireMessage>,
        provenance: CaptureProvenance,
    ) -> Result<Self, CaptureError> {
        let capture = Self {
            request_bytes: request_bytes.into(),
            response_bytes: response_bytes.into(),
            messages,
            provenance,
        };
        capture.validate_messages()?;
        Ok(capture)
    }

    pub fn write_private_raw(
        self,
        output_root: impl Into<PathBuf>,
        capture_id: impl Into<String>,
    ) -> Result<PathBuf, CaptureError> {
        self.write_private_raw_transcript(output_root, capture_id)
    }

    pub fn write_private_raw_transcript(
        self,
        output_root: impl Into<PathBuf>,
        capture_id: impl Into<String>,
    ) -> Result<PathBuf, CaptureError> {
        self.validate_messages()?;
        let request_length = self.request_bytes.len() as u64;
        let response_length = self.response_bytes.len() as u64;
        let core = CaptureManifestCore {
            schema_version: 3,
            capture_id: capture_id.into(),
            capture_kind: "require_info".to_string(),
            source: "lower-level exact-wire collector".to_string(),
            wire_fidelity: "EXACT_WIRE".to_string(),
            privacy_state: "PRIVATE_RAW_CAPTURE".to_string(),
            request: stream_manifest("request", REQUEST_WIRE_FILE, &self.request_bytes),
            response: stream_manifest("response", RESPONSE_WIRE_FILE, &self.response_bytes),
            messages: self.messages.iter().map(message_manifest).collect(),
            canonical_stream: CanonicalStreamManifest {
                ordering: "request-wire then response-wire; length-delimited in hash preimage"
                    .to_string(),
                request_start: 0,
                request_end: request_length,
                response_start: request_length,
                response_end: request_length + response_length,
            },
            provenance: self.provenance.clone(),
            sanitization: None,
        };
        write_artifact(
            output_root.into(),
            core,
            &self.request_bytes,
            &self.response_bytes,
            REQUEST_WIRE_FILE,
            RESPONSE_WIRE_FILE,
        )
    }

    fn validate_messages(&self) -> Result<(), CaptureError> {
        let mut previous_sequence = None;
        let mut request_end = 0;
        let mut response_end = 0;
        for message in &self.messages {
            if let Some(previous_sequence) = previous_sequence {
                if message.sequence <= previous_sequence {
                    return Err(CaptureError::InvalidMessageBoundary);
                }
            }
            previous_sequence = Some(message.sequence);
            let (stream, previous_end) = match message.direction {
                ExactWireDirection::Request => (&self.request_bytes, &mut request_end),
                ExactWireDirection::Response => (&self.response_bytes, &mut response_end),
            };
            if message.stream_start < *previous_end
                || message.stream_end < message.stream_start
                || message.stream_end as usize > stream.len()
                || message.stream_end - message.stream_start != message.bytes.len() as u64
                || stream[message.stream_start as usize..message.stream_end as usize]
                    != message.bytes
            {
                return Err(CaptureError::InvalidMessageBoundary);
            }
            *previous_end = message.stream_end;
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct CaptureBuilder {
    output_root: PathBuf,
    capture_id: String,
    request: Option<CapturedMessage>,
}

impl CaptureBuilder {
    pub fn new(output_root: impl Into<PathBuf>, capture_id: impl Into<String>) -> Self {
        Self {
            output_root: output_root.into(),
            capture_id: capture_id.into(),
            request: None,
        }
    }

    pub fn record_request(&mut self, request: CapturedMessage) {
        self.request = Some(request);
    }

    pub fn finish(self, response: CapturedMessage) -> Result<PathBuf, CaptureError> {
        self.finish_with_privacy(response, "PRIVATE_STRUCTURED_VIEW", None)
    }

    fn finish_with_privacy(
        self,
        response: CapturedMessage,
        privacy_state: &str,
        sanitization: Option<SanitizationManifest>,
    ) -> Result<PathBuf, CaptureError> {
        validate_capture_id(&self.capture_id)?;
        let request = self.request.ok_or(CaptureError::MissingRequest)?;
        let request_length = request.body.len() as u64;
        let response_length = response.body.len() as u64;
        let core = CaptureManifestCore {
            schema_version: 2,
            capture_id: self.capture_id.clone(),
            capture_kind: "require_info".to_string(),
            source: "FUSOU HTTPS proxy HttpHandler boundary".to_string(),
            wire_fidelity: "HANDLER_VISIBLE_BODY_ONLY_NOT_RAW_WIRE".to_string(),
            privacy_state: privacy_state.to_string(),
            request: request.manifest("request", REQUEST_BODY_FILE, 0),
            response: response.manifest("response", RESPONSE_BODY_FILE, request_length),
            messages: Vec::new(),
            canonical_stream: CanonicalStreamManifest {
                ordering: "request-body then response-body; length-delimited in hash preimage"
                    .to_string(),
                request_start: 0,
                request_end: request_length,
                response_start: request_length,
                response_end: request_length + response_length,
            },
            provenance: CaptureProvenance::structured(),
            sanitization,
        };
        write_artifact(
            self.output_root,
            core,
            &request.body,
            &response.body,
            REQUEST_BODY_FILE,
            RESPONSE_BODY_FILE,
        )
    }
}

#[derive(Debug, Clone)]
pub struct SanitizedCapture {
    request: CapturedMessage,
    response: CapturedMessage,
    pub report: SanitizationReport,
}

impl SanitizedCapture {
    pub fn write_pending_review(
        self,
        output_root: impl Into<PathBuf>,
        capture_id: impl Into<String>,
    ) -> Result<PathBuf, CaptureError> {
        let mut builder = CaptureBuilder::new(output_root, capture_id);
        builder.record_request(self.request);
        builder.finish_with_privacy(
            self.response,
            "SANITIZED_PENDING_REVIEW",
            Some(self.report.into()),
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SanitizationReport {
    pub redacted_header_names: Vec<String>,
    pub request_body_replacements: usize,
    pub response_body_replacements: usize,
    pub manual_privacy_review_required: bool,
}

pub fn sanitize_for_fixture(
    request: &CapturedMessage,
    response: &CapturedMessage,
    explicit_redactions: &[Vec<u8>],
) -> SanitizedCapture {
    let (request_body, request_body_replacements) =
        redact_bytes(&request.body, explicit_redactions);
    let (response_body, response_body_replacements) =
        redact_bytes(&response.body, explicit_redactions);
    let (request, request_headers) = sanitize_message(request, request_body, "request");
    let (response, response_headers) = sanitize_message(response, response_body, "response");
    let mut redacted_header_names = request_headers;
    redacted_header_names.extend(response_headers);
    redacted_header_names.sort();
    redacted_header_names.dedup();

    SanitizedCapture {
        request,
        response,
        report: SanitizationReport {
            redacted_header_names,
            request_body_replacements,
            response_body_replacements,
            manual_privacy_review_required: true,
        },
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CaptureManifest {
    #[serde(flatten)]
    core: CaptureManifestCore,
    complete_artifact_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CaptureManifestCore {
    schema_version: u32,
    capture_id: String,
    capture_kind: String,
    source: String,
    wire_fidelity: String,
    privacy_state: String,
    #[serde(default)]
    provenance: CaptureProvenance,
    request: MessageManifest,
    response: MessageManifest,
    #[serde(default)]
    messages: Vec<MessageManifest>,
    canonical_stream: CanonicalStreamManifest,
    sanitization: Option<SanitizationManifest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MessageManifest {
    #[serde(default)]
    sequence: Option<u64>,
    direction: String,
    representation: String,
    #[serde(default)]
    parse_state: String,
    body_file: String,
    body_bytes: u64,
    body_sha256: String,
    stream_start: u64,
    stream_end: u64,
    version: String,
    method: Option<String>,
    target: Option<String>,
    status: Option<u16>,
    reason: Option<String>,
    headers: Vec<HeaderManifest>,
    framing: FramingManifest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HeaderManifest {
    name: String,
    value_hex: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FramingManifest {
    content_length_hex: Vec<String>,
    transfer_encoding_hex: Vec<String>,
    content_encoding_hex: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CanonicalStreamManifest {
    ordering: String,
    request_start: u64,
    request_end: u64,
    response_start: u64,
    response_end: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SanitizationManifest {
    redacted_header_names: Vec<String>,
    request_body_replacements: usize,
    response_body_replacements: usize,
    manual_privacy_review_required: bool,
}

impl From<SanitizationReport> for SanitizationManifest {
    fn from(report: SanitizationReport) -> Self {
        Self {
            redacted_header_names: report.redacted_header_names,
            request_body_replacements: report.request_body_replacements,
            response_body_replacements: report.response_body_replacements,
            manual_privacy_review_required: report.manual_privacy_review_required,
        }
    }
}

fn wire_manifest(direction: &str, body_file: &str, message: &ExactWireMessage) -> MessageManifest {
    MessageManifest {
        sequence: None,
        direction: direction.to_string(),
        representation: "complete HTTP wire bytes from lower-level collector".to_string(),
        parse_state: "WIRE_STREAM".to_string(),
        body_file: body_file.to_string(),
        body_bytes: message.bytes.len() as u64,
        body_sha256: sha256_hex(&message.bytes),
        stream_start: message.stream_start,
        stream_end: message.stream_end,
        version: "WIRE_UNKNOWN".to_string(),
        method: None,
        target: None,
        status: None,
        reason: None,
        headers: Vec::new(),
        framing: FramingManifest {
            content_length_hex: Vec::new(),
            transfer_encoding_hex: Vec::new(),
            content_encoding_hex: Vec::new(),
        },
    }
}

fn stream_manifest(direction: &str, body_file: &str, bytes: &[u8]) -> MessageManifest {
    let message = ExactWireMessage::from_bytes(bytes.to_vec(), 0).expect("stream boundary");
    wire_manifest(direction, body_file, &message)
}

fn message_manifest(message: &ExactWireMessage) -> MessageManifest {
    MessageManifest {
        sequence: Some(message.sequence),
        direction: message.direction.as_str().to_string(),
        representation: "message range within complete HTTP wire stream".to_string(),
        parse_state: "HYPER_ACCEPTED_BODY_COMPLETE".to_string(),
        body_file: match message.direction {
            ExactWireDirection::Request => REQUEST_WIRE_FILE.to_string(),
            ExactWireDirection::Response => RESPONSE_WIRE_FILE.to_string(),
        },
        body_bytes: message.bytes.len() as u64,
        body_sha256: sha256_hex(&message.bytes),
        stream_start: message.stream_start,
        stream_end: message.stream_end,
        version: message.metadata.version.clone(),
        method: message.metadata.method.clone(),
        target: message.metadata.target.clone(),
        status: message.metadata.status,
        reason: message.metadata.reason.clone(),
        headers: message
            .metadata
            .headers
            .iter()
            .map(|header| HeaderManifest {
                name: header.name.clone(),
                value_hex: hex_encode(&header.value),
            })
            .collect(),
        framing: FramingManifest {
            content_length_hex: header_values_hex(&message.metadata.headers, "content-length"),
            transfer_encoding_hex: header_values_hex(
                &message.metadata.headers,
                "transfer-encoding",
            ),
            content_encoding_hex: header_values_hex(&message.metadata.headers, "content-encoding"),
        },
    }
}

fn write_artifact(
    output_root: PathBuf,
    core: CaptureManifestCore,
    request_bytes: &[u8],
    response_bytes: &[u8],
    request_file: &str,
    response_file: &str,
) -> Result<PathBuf, CaptureError> {
    validate_capture_id(&core.capture_id)?;
    if !output_root.is_absolute() {
        return Err(CaptureError::OutputPathNotAbsolute);
    }
    let core_json = serde_json::to_vec(&core)?;
    let manifest = CaptureManifest {
        complete_artifact_sha256: complete_artifact_sha256(
            &core_json,
            request_bytes,
            response_bytes,
        ),
        core,
    };

    fs::create_dir_all(&output_root)?;
    let capture_dir = output_root.join(&manifest.core.capture_id);
    let staging_dir = output_root.join(format!(".{}.staging", manifest.core.capture_id));
    fs::create_dir(&staging_dir)?;
    fs::write(staging_dir.join(request_file), request_bytes)?;
    fs::write(staging_dir.join(response_file), response_bytes)?;
    fs::write(
        staging_dir.join(MANIFEST_FILE),
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    fs::rename(staging_dir, &capture_dir)?;
    Ok(capture_dir)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureVerification {
    pub request_sha256: String,
    pub response_sha256: String,
    pub complete_artifact_sha256: String,
}

pub fn verify_capture(capture_dir: impl AsRef<Path>) -> Result<CaptureVerification, CaptureError> {
    let capture_dir = capture_dir.as_ref();
    let manifest: CaptureManifest =
        serde_json::from_slice(&fs::read(capture_dir.join(MANIFEST_FILE))?)?;
    validate_payload_file(&manifest.core.request.body_file)?;
    validate_payload_file(&manifest.core.response.body_file)?;
    let request_body = fs::read(capture_dir.join(&manifest.core.request.body_file))?;
    let response_body = fs::read(capture_dir.join(&manifest.core.response.body_file))?;
    let request_sha256 = sha256_hex(&request_body);
    let response_sha256 = sha256_hex(&response_body);
    if manifest.core.request.stream_end < manifest.core.request.stream_start
        || manifest.core.response.stream_end < manifest.core.response.stream_start
        || request_body.len() as u64 != manifest.core.request.body_bytes
        || response_body.len() as u64 != manifest.core.response.body_bytes
        || request_sha256 != manifest.core.request.body_sha256
        || response_sha256 != manifest.core.response.body_sha256
        || manifest.core.request.stream_end - manifest.core.request.stream_start
            != manifest.core.request.body_bytes
        || manifest.core.response.stream_end - manifest.core.response.stream_start
            != manifest.core.response.body_bytes
        || manifest.core.canonical_stream.request_start != 0
        || manifest.core.canonical_stream.request_end != manifest.core.request.body_bytes
        || manifest.core.canonical_stream.response_start != manifest.core.request.body_bytes
        || manifest.core.canonical_stream.response_end
            != manifest.core.request.body_bytes + manifest.core.response.body_bytes
    {
        return Err(CaptureError::Io(io::Error::new(
            io::ErrorKind::InvalidData,
            "capture manifest does not match body files",
        )));
    }
    if manifest.core.wire_fidelity == "EXACT_WIRE" {
        verify_message_manifests(&manifest.core.messages, &request_body, &response_body)?;
    }
    let core_json = serde_json::to_vec(&manifest.core)?;
    let complete_sha256 = complete_artifact_sha256(&core_json, &request_body, &response_body);
    if complete_sha256 != manifest.complete_artifact_sha256 {
        return Err(CaptureError::Io(io::Error::new(
            io::ErrorKind::InvalidData,
            "capture complete hash does not match manifest",
        )));
    }
    Ok(CaptureVerification {
        request_sha256,
        response_sha256,
        complete_artifact_sha256: complete_sha256,
    })
}

pub fn verify_capture_evidence(
    capture_dir: impl AsRef<Path>,
) -> Result<CaptureVerification, CaptureError> {
    let capture_dir = capture_dir.as_ref();
    let verification = verify_capture(capture_dir)?;
    let manifest: CaptureManifest =
        serde_json::from_slice(&fs::read(capture_dir.join(MANIFEST_FILE))?)?;
    validate_evidence_policy(&manifest.core.provenance)?;
    Ok(verification)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NaturalCaptureReviewVerification {
    pub capture: CaptureVerification,
    pub review_id: String,
    pub natural_provenance: bool,
    pub privacy_qualified: bool,
    pub external_transmission_status: String,
    pub privacy_disposition: String,
}

pub fn verify_natural_capture_review(
    capture_dir: impl AsRef<Path>,
    review_path: impl AsRef<Path>,
) -> Result<NaturalCaptureReviewVerification, CaptureError> {
    let capture_dir = capture_dir.as_ref();
    let capture = verify_capture_evidence(capture_dir)?;
    let manifest: CaptureManifest =
        serde_json::from_slice(&fs::read(capture_dir.join(MANIFEST_FILE))?)?;
    let review: NaturalCaptureReview = serde_json::from_slice(&fs::read(review_path)?)?;
    validate_natural_capture_review(&manifest, &review)?;
    let privacy_qualified = review.operational_review.proxy_persistence_disabled
        && review.operational_review.app_uploads_disabled
        && review.operational_review.pending_uploads_reviewed
        && review.operational_review.external_transmission_status == "RESOLVED_ABSENT"
        && review.operational_review.privacy_disposition == "QUALIFIED";
    Ok(NaturalCaptureReviewVerification {
        capture,
        review_id: review.review_id,
        natural_provenance: true,
        privacy_qualified,
        external_transmission_status: review.operational_review.external_transmission_status,
        privacy_disposition: review.operational_review.privacy_disposition,
    })
}

fn validate_evidence_policy(provenance: &CaptureProvenance) -> Result<(), CaptureError> {
    if provenance.natural_provenance {
        return Err(CaptureError::InvalidEvidencePolicy(
            "the collector cannot assert natural provenance".to_string(),
        ));
    }
    if provenance.proxy_version.trim().is_empty()
        || provenance.hudsucker_fork_revision.trim().is_empty()
        || provenance.collector_version.trim().is_empty()
    {
        return Err(CaptureError::InvalidEvidencePolicy(
            "runtime provenance versions must be non-empty".to_string(),
        ));
    }
    if provenance.manual_observation_record.is_some() {
        return Err(CaptureError::InvalidEvidencePolicy(
            "manual observation records must remain external to collector artifacts".to_string(),
        ));
    }
    match provenance.evidence_class.as_str() {
        "synthetic" | "non_evidence" => Ok(()),
        "natural_candidate" => {
            if !provenance.capture_enabled
                || provenance
                    .app_version
                    .as_deref()
                    .map_or(true, str::is_empty)
                || provenance
                    .game_client
                    .as_deref()
                    .map_or(true, str::is_empty)
                || provenance
                    .allowlisted_game_server
                    .as_deref()
                    .map_or(true, str::is_empty)
                || provenance.connection_id.is_none()
                || provenance.capture_started_at_utc.is_none()
                || provenance.capture_ended_at_utc.is_none()
            {
                return Err(CaptureError::InvalidEvidencePolicy(
                    "natural candidate provenance is incomplete".to_string(),
                ));
            }
            validate_timestamp(provenance.capture_started_at_utc.as_deref().unwrap())?;
            validate_timestamp(provenance.capture_ended_at_utc.as_deref().unwrap())?;
            Ok(())
        }
        other => Err(CaptureError::InvalidEvidencePolicy(format!(
            "unsupported evidence class {other}"
        ))),
    }
}

fn validate_natural_capture_review(
    manifest: &CaptureManifest,
    review: &NaturalCaptureReview,
) -> Result<(), CaptureError> {
    let provenance = &manifest.core.provenance;
    if review.schema_version != NATURAL_CAPTURE_REVIEW_SCHEMA_VERSION {
        return Err(CaptureError::InvalidEvidencePolicy(
            "unsupported natural capture review schema".to_string(),
        ));
    }
    validate_capture_id(&review.review_id)?;
    validate_capture_id(&review.capture_id)?;
    validate_capture_id(&review.privacy_review.sanitized_fixture_id)?;
    if review.capture_id != manifest.core.capture_id
        || review.capture_complete_artifact_sha256 != manifest.complete_artifact_sha256
        || provenance.evidence_class != "natural_candidate"
        || review.observation.app_version != provenance.app_version.as_deref().unwrap_or_default()
        || review.observation.game_client != provenance.game_client.as_deref().unwrap_or_default()
        || review.observation.allowlisted_game_server
            != provenance
                .allowlisted_game_server
                .as_deref()
                .unwrap_or_default()
    {
        return Err(CaptureError::InvalidEvidencePolicy(
            "natural capture review does not match capture provenance".to_string(),
        ));
    }
    if !review.observation.ordinary_fusou_app_startup
        || !review.observation.ordinary_gameplay
        || !review.observation.existing_client_generated_request
        || !review.observation.observed_require_info
        || !review.observation.no_standalone_game_server_request
        || !review.observation.no_request_injection
        || !review.observation.no_request_replay
        || !review.observation.no_request_retry
        || !review.observation.no_capture_generated_traffic
        || review.observation.client_facing_tls_plaintext_boundary
            != CLIENT_FACING_TLS_PLAINTEXT_BOUNDARY
        || review.observation.trigger_action != "UNKNOWN"
    {
        return Err(CaptureError::InvalidEvidencePolicy(
            "natural capture review does not satisfy passive observation policy".to_string(),
        ));
    }
    if !review.privacy_review.raw_artifact_retained_private
        || !review.privacy_review.no_raw_artifact_committed
        || !review.privacy_review.sanitized_fixture_reviewed
        || !review
            .privacy_review
            .no_credentials_or_session_tokens_in_sanitized_fixture
        || review.privacy_review.reviewer_role.trim().is_empty()
    {
        return Err(CaptureError::InvalidEvidencePolicy(
            "natural capture privacy review is incomplete".to_string(),
        ));
    }
    validate_timestamp(&review.observation.observed_at_utc)?;
    validate_timestamp(&review.privacy_review.reviewed_at_utc)?;
    if review
        .operational_review
        .launcher_revision
        .trim()
        .is_empty()
        || review
            .operational_review
            .external_transmission_evidence
            .trim()
            .is_empty()
    {
        return Err(CaptureError::InvalidEvidencePolicy(
            "natural capture operational review is incomplete".to_string(),
        ));
    }
    if !matches!(
        review
            .operational_review
            .external_transmission_status
            .as_str(),
        "RESOLVED_ABSENT" | "CONFIRMED" | "POSSIBLE_UNRESOLVED"
    ) {
        return Err(CaptureError::InvalidEvidencePolicy(
            "unsupported external transmission status".to_string(),
        ));
    }
    if !matches!(
        review
            .operational_review
            .credential_exposure_status
            .as_str(),
        "NONE_OBSERVED" | "PRIVATE_RAW_ONLY" | "UNKNOWN"
    ) {
        return Err(CaptureError::InvalidEvidencePolicy(
            "unsupported credential exposure status".to_string(),
        ));
    }
    if !matches!(
        review.operational_review.privacy_disposition.as_str(),
        "QUALIFIED" | "DISQUALIFIED" | "UNKNOWN"
    ) {
        return Err(CaptureError::InvalidEvidencePolicy(
            "unsupported privacy disposition".to_string(),
        ));
    }
    Ok(())
}

fn validate_timestamp(value: &str) -> Result<(), CaptureError> {
    DateTime::parse_from_rfc3339(value).map_err(|_| {
        CaptureError::InvalidEvidencePolicy("provenance timestamp is not RFC3339".to_string())
    })?;
    Ok(())
}

fn verify_message_manifests(
    messages: &[MessageManifest],
    request_bytes: &[u8],
    response_bytes: &[u8],
) -> Result<(), CaptureError> {
    if messages.is_empty() {
        return Err(CaptureError::InvalidMessageBoundary);
    }
    let mut previous_sequence = None;
    let mut request_end = 0;
    let mut response_end = 0;
    for message in messages {
        let sequence = message
            .sequence
            .ok_or(CaptureError::InvalidMessageBoundary)?;
        if previous_sequence.is_some_and(|previous| sequence <= previous) {
            return Err(CaptureError::InvalidMessageBoundary);
        }
        previous_sequence = Some(sequence);
        let (stream, expected_file, previous_end) = match message.direction.as_str() {
            "request" => (request_bytes, REQUEST_WIRE_FILE, &mut request_end),
            "response" => (response_bytes, RESPONSE_WIRE_FILE, &mut response_end),
            _ => return Err(CaptureError::InvalidMessageBoundary),
        };
        if message.body_file != expected_file
            || message.stream_start < *previous_end
            || message.stream_end < message.stream_start
            || message.stream_end as usize > stream.len()
            || message.stream_end - message.stream_start != message.body_bytes
            || sha256_hex(&stream[message.stream_start as usize..message.stream_end as usize])
                != message.body_sha256
        {
            return Err(CaptureError::InvalidMessageBoundary);
        }
        *previous_end = message.stream_end;
    }
    Ok(())
}

pub fn next_capture_id() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let sequence = CAPTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("capture-{timestamp}-{}-{sequence}", std::process::id())
}

fn captured_headers(headers: &HeaderMap) -> Vec<CapturedHeader> {
    headers
        .iter()
        .map(|(name, value)| CapturedHeader {
            name: name.as_str().to_string(),
            value: value.as_bytes().to_vec(),
        })
        .collect()
}

fn header_values_hex(headers: &[CapturedHeader], name: &str) -> Vec<String> {
    headers
        .iter()
        .filter(|header| header.name.eq_ignore_ascii_case(name))
        .map(|header| hex_encode(&header.value))
        .collect()
}

fn version_name(version: Version) -> String {
    match version {
        Version::HTTP_09 => "HTTP/0.9",
        Version::HTTP_10 => "HTTP/1.0",
        Version::HTTP_11 => "HTTP/1.1",
        Version::HTTP_2 => "HTTP/2",
        Version::HTTP_3 => "HTTP/3",
        _ => "UNKNOWN",
    }
    .to_string()
}

fn validate_capture_id(capture_id: &str) -> Result<(), CaptureError> {
    if capture_id.is_empty()
        || capture_id == "."
        || capture_id == ".."
        || capture_id.contains('/')
        || capture_id.contains('\\')
    {
        return Err(CaptureError::InvalidCaptureId);
    }
    Ok(())
}

fn validate_payload_file(payload_file: &str) -> Result<(), CaptureError> {
    let path = Path::new(payload_file);
    if payload_file.is_empty()
        || path.is_absolute()
        || payload_file.contains('\\')
        || path.components().count() != 1
        || !matches!(
            path.components().next(),
            Some(std::path::Component::Normal(_))
        )
    {
        return Err(CaptureError::InvalidPayloadFile);
    }
    Ok(())
}

fn complete_artifact_sha256(core_json: &[u8], request_body: &[u8], response_body: &[u8]) -> String {
    let mut preimage = Vec::with_capacity(
        CAPTURE_MAGIC.len() + core_json.len() + request_body.len() + response_body.len() + 24,
    );
    preimage.extend_from_slice(CAPTURE_MAGIC);
    append_u64(&mut preimage, core_json.len() as u64);
    preimage.extend_from_slice(core_json);
    append_u64(&mut preimage, request_body.len() as u64);
    preimage.extend_from_slice(request_body);
    append_u64(&mut preimage, response_body.len() as u64);
    preimage.extend_from_slice(response_body);
    sha256_hex(&preimage)
}

fn append_u64(output: &mut Vec<u8>, value: u64) {
    output.extend_from_slice(&value.to_be_bytes());
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex_encode(&digest)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn sanitize_message(
    message: &CapturedMessage,
    body: Vec<u8>,
    direction: &str,
) -> (CapturedMessage, Vec<String>) {
    let mut redacted_header_names = Vec::new();
    let headers = message
        .headers
        .iter()
        .map(|header| {
            if is_sensitive_header(&header.name) {
                redacted_header_names.push(format!("{direction}:{}", header.name));
                CapturedHeader {
                    name: header.name.clone(),
                    value: b"<REDACTED>".to_vec(),
                }
            } else {
                header.clone()
            }
        })
        .collect();
    (
        CapturedMessage {
            version: message.version.clone(),
            method: message.method.clone(),
            target: message.target.clone(),
            status: message.status,
            reason: message.reason.clone(),
            headers,
            body,
        },
        redacted_header_names,
    )
}

fn is_sensitive_header(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "authorization"
            | "proxy-authorization"
            | "cookie"
            | "set-cookie"
            | "x-fusou-attestation-binding"
    ) || normalized.contains("token")
        || normalized.contains("session")
}

fn redact_bytes(input: &[u8], redactions: &[Vec<u8>]) -> (Vec<u8>, usize) {
    let mut output = input.to_vec();
    let mut replacements = 0;
    for redaction in redactions {
        if redaction.is_empty() {
            continue;
        }
        let mut search_start = 0;
        while search_start < output.len() {
            let Some(relative_offset) = output[search_start..]
                .windows(redaction.len())
                .position(|window| window == redaction.as_slice())
            else {
                break;
            };
            let start = search_start + relative_offset;
            let end = start + redaction.len();
            output.splice(start..end, b"<REDACTED>".iter().copied());
            search_start = start + b"<REDACTED>".len();
            replacements += 1;
        }
    }
    (output, replacements)
}

#[cfg(test)]
mod tests {
    use super::*;
    use http::{Method, Request, Response, StatusCode};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("fusou_capture_{name}_{stamp}"))
    }

    fn messages() -> (CapturedMessage, CapturedMessage) {
        let request = Request::builder()
            .method(Method::POST)
            .uri("https://game.kancolle-server.com/kcsapi/api_get_member/require_info?x=1")
            .header("Content-Length", "19")
            .header("Content-Encoding", "gzip")
            .header("Cookie", "private-cookie")
            .body(())
            .expect("request");
        let (request_parts, _) = request.into_parts();
        let response = Response::builder()
            .status(StatusCode::OK)
            .header("Content-Length", "18")
            .header("Content-Encoding", "gzip")
            .body(())
            .expect("response");
        let (response_parts, _) = response.into_parts();
        (
            CapturedMessage::from_request(&request_parts, b"request-body-bytes"),
            CapturedMessage::from_response(&response_parts, b"response-body-bytes"),
        )
    }

    #[test]
    fn capture_preserves_body_bytes_and_verifies_boundaries_and_hashes() {
        let (request, response) = messages();
        let root = temp_dir("lossless");
        let mut builder = CaptureBuilder::new(&root, "capture-one");
        builder.record_request(request.clone());
        let capture_dir = builder.finish(response.clone()).expect("write capture");

        assert_eq!(
            fs::read(capture_dir.join(REQUEST_BODY_FILE)).unwrap(),
            request.body
        );
        assert_eq!(
            fs::read(capture_dir.join(RESPONSE_BODY_FILE)).unwrap(),
            response.body
        );
        let verification = verify_capture(&capture_dir).expect("verify capture");
        assert_eq!(verification.request_sha256, sha256_hex(&request.body));
        assert_eq!(verification.response_sha256, sha256_hex(&response.body));
        let manifest = fs::read_to_string(capture_dir.join(MANIFEST_FILE)).unwrap();
        assert!(manifest.contains("HANDLER_VISIBLE_BODY_ONLY_NOT_RAW_WIRE"));
        assert!(manifest.contains("content_encoding_hex"));
    }

    #[test]
    fn identical_input_has_identical_complete_hash() {
        let (request, response) = messages();
        let first_root = temp_dir("deterministic_first");
        let second_root = temp_dir("deterministic_second");
        let mut first = CaptureBuilder::new(&first_root, "same-capture");
        first.record_request(request.clone());
        let first_dir = first.finish(response.clone()).expect("first capture");
        let mut second = CaptureBuilder::new(&second_root, "same-capture");
        second.record_request(request);
        let second_dir = second.finish(response).expect("second capture");
        let first_manifest: CaptureManifest =
            serde_json::from_slice(&fs::read(first_dir.join(MANIFEST_FILE)).unwrap()).unwrap();
        let second_manifest: CaptureManifest =
            serde_json::from_slice(&fs::read(second_dir.join(MANIFEST_FILE)).unwrap()).unwrap();
        assert_eq!(
            first_manifest.complete_artifact_sha256,
            second_manifest.complete_artifact_sha256
        );
    }

    #[test]
    fn sanitization_redacts_sensitive_headers_and_explicit_body_values() {
        let (request, response) = messages();
        let sanitized = sanitize_for_fixture(
            &request,
            &response,
            &[
                b"request-body-bytes".to_vec(),
                b"response-body-bytes".to_vec(),
            ],
        );
        assert!(sanitized.report.manual_privacy_review_required);
        assert_eq!(sanitized.report.request_body_replacements, 1);
        assert_eq!(sanitized.report.response_body_replacements, 1);
        assert!(sanitized
            .report
            .redacted_header_names
            .contains(&"request:cookie".to_string()));
        assert!(!sanitized.request.body.contains(&b'r'));
        assert!(!sanitized.response.body.contains(&b'r'));
    }

    #[test]
    fn sanitized_writer_marks_fixture_as_pending_review() {
        let (request, response) = messages();
        let sanitized = sanitize_for_fixture(
            &request,
            &response,
            &[
                b"request-body-bytes".to_vec(),
                b"response-body-bytes".to_vec(),
            ],
        );
        let root = temp_dir("sanitized_fixture");
        let capture_dir = sanitized
            .write_pending_review(&root, "sanitized-fixture")
            .expect("write sanitized fixture");

        let manifest = fs::read_to_string(capture_dir.join(MANIFEST_FILE)).unwrap();
        assert!(manifest.contains("SANITIZED_PENDING_REVIEW"));
        assert!(manifest.contains("manual_privacy_review_required"));
        assert!(!fs::read(capture_dir.join(REQUEST_BODY_FILE))
            .unwrap()
            .windows(b"request-body-bytes".len())
            .any(|window| window == b"request-body-bytes"));
    }

    #[test]
    fn exact_wire_capture_preserves_wire_payloads_and_source_boundaries() {
        let request_wire = b"POST /kcsapi/api_get_member/require_info HTTP/1.1\r\n\r\nwire-request";
        let response_wire = b"HTTP/1.1 200 OK\r\n\r\nwire-response";
        let request = ExactWireMessage::from_parts_with_metadata(
            request_wire,
            0,
            request_wire.len() as u64,
            ExactWireDirection::Request,
            0,
            ExactWireMetadata {
                version: "HTTP/1.1".to_string(),
                method: Some("POST".to_string()),
                target: Some("/kcsapi/api_get_member/require_info".to_string()),
                status: None,
                reason: None,
                headers: Vec::new(),
            },
        )
        .expect("request boundary");
        let response = ExactWireMessage::from_parts_with_metadata(
            response_wire,
            0,
            response_wire.len() as u64,
            ExactWireDirection::Response,
            1,
            ExactWireMetadata {
                version: "HTTP/1.1".to_string(),
                method: None,
                target: None,
                status: Some(200),
                reason: Some("OK".to_string()),
                headers: Vec::new(),
            },
        )
        .expect("response boundary");
        let root = temp_dir("exact_wire");
        let capture_dir = ExactWireCapture::new(request, response)
            .write_private_raw(&root, "exact-wire")
            .expect("write exact-wire capture");

        assert_eq!(
            fs::read(capture_dir.join(REQUEST_WIRE_FILE)).unwrap(),
            request_wire
        );
        assert_eq!(
            fs::read(capture_dir.join(RESPONSE_WIRE_FILE)).unwrap(),
            response_wire
        );
        let manifest = fs::read_to_string(capture_dir.join(MANIFEST_FILE)).unwrap();
        assert!(manifest.contains("EXACT_WIRE"));
        assert!(manifest.contains("lower-level exact-wire collector"));
        verify_capture(&capture_dir).expect("verify exact-wire capture");
        verify_capture_evidence(&capture_dir).expect("verify exact-wire evidence policy");
    }

    #[test]
    fn collector_provenance_never_asserts_natural_provenance() {
        let synthetic = CaptureProvenance::synthetic();
        assert_eq!(synthetic.evidence_class, "synthetic");
        assert!(!synthetic.natural_provenance);

        let runtime = CaptureRuntimeMetadata {
            app_version: "0.0.0-test".to_string(),
            game_client: "test-client".to_string(),
            allowlisted_game_server: "game.example.test".to_string(),
        };
        let natural_candidate = CaptureProvenance::natural_candidate(&runtime).for_connection(42);
        assert_eq!(natural_candidate.evidence_class, "natural_candidate");
        assert!(!natural_candidate.natural_provenance);
        assert!(natural_candidate.capture_started_at_utc.is_some());
    }

    #[test]
    fn evidence_validator_rejects_natural_provenance_claims() {
        let mut provenance = CaptureProvenance::synthetic();
        provenance.natural_provenance = true;
        assert!(matches!(
            validate_evidence_policy(&provenance),
            Err(CaptureError::InvalidEvidencePolicy(message))
                if message.contains("cannot assert natural provenance")
        ));
    }

    #[test]
    fn manual_natural_review_must_match_candidate_and_privacy_record() {
        let request_wire = b"POST /kcsapi/api_get_member/require_info HTTP/1.1\r\n\r\nrequest";
        let response_wire = b"HTTP/1.1 200 OK\r\n\r\nresponse";
        let request = ExactWireMessage::from_parts_with_metadata(
            request_wire,
            0,
            request_wire.len() as u64,
            ExactWireDirection::Request,
            0,
            ExactWireMetadata {
                version: "HTTP/1.1".to_string(),
                method: Some("POST".to_string()),
                target: Some("/kcsapi/api_get_member/require_info".to_string()),
                status: None,
                reason: None,
                headers: Vec::new(),
            },
        )
        .expect("request boundary");
        let response = ExactWireMessage::from_parts_with_metadata(
            response_wire,
            0,
            response_wire.len() as u64,
            ExactWireDirection::Response,
            1,
            ExactWireMetadata {
                version: "HTTP/1.1".to_string(),
                method: None,
                target: None,
                status: Some(200),
                reason: Some("OK".to_string()),
                headers: Vec::new(),
            },
        )
        .expect("response boundary");
        let runtime = CaptureRuntimeMetadata {
            app_version: "0.0.0-test".to_string(),
            game_client: "supported-client".to_string(),
            allowlisted_game_server: "game.example.test".to_string(),
        };
        let mut provenance = CaptureProvenance::natural_candidate(&runtime).for_connection(7);
        provenance.mark_finished();
        let root = temp_dir("natural_review");
        let capture_dir = ExactWireCapture::from_transcript_with_provenance(
            request_wire.to_vec(),
            response_wire.to_vec(),
            vec![request, response],
            provenance,
        )
        .expect("natural candidate")
        .write_private_raw(&root, "natural-candidate")
        .expect("write natural candidate");
        let manifest: CaptureManifest =
            serde_json::from_slice(&fs::read(capture_dir.join(MANIFEST_FILE)).expect("manifest"))
                .expect("manifest JSON");
        let review = NaturalCaptureReview {
            schema_version: NATURAL_CAPTURE_REVIEW_SCHEMA_VERSION,
            review_id: "manual-review-1".to_string(),
            capture_id: manifest.core.capture_id.clone(),
            capture_complete_artifact_sha256: manifest.complete_artifact_sha256,
            observation: NaturalCaptureObservation {
                observed_at_utc: capture_timestamp(),
                app_version: "0.0.0-test".to_string(),
                game_client: "supported-client".to_string(),
                allowlisted_game_server: "game.example.test".to_string(),
                ordinary_fusou_app_startup: true,
                ordinary_gameplay: true,
                existing_client_generated_request: true,
                observed_require_info: true,
                no_standalone_game_server_request: true,
                no_request_injection: true,
                no_request_replay: true,
                no_request_retry: true,
                no_capture_generated_traffic: true,
                client_facing_tls_plaintext_boundary: CLIENT_FACING_TLS_PLAINTEXT_BOUNDARY
                    .to_string(),
                trigger_action: "UNKNOWN".to_string(),
            },
            privacy_review: NaturalCapturePrivacyReview {
                reviewed_at_utc: capture_timestamp(),
                reviewer_role: "authorized maintainer".to_string(),
                raw_artifact_retained_private: true,
                no_raw_artifact_committed: true,
                sanitized_fixture_reviewed: true,
                sanitized_fixture_id: "sanitized-review-1".to_string(),
                no_credentials_or_session_tokens_in_sanitized_fixture: true,
            },
            operational_review: NaturalCaptureOperationalReview {
                launcher_revision: "test-launcher".to_string(),
                proxy_persistence_disabled: true,
                app_uploads_disabled: true,
                pending_uploads_reviewed: true,
                external_transmission_status: "RESOLVED_ABSENT".to_string(),
                external_transmission_evidence: "isolated test".to_string(),
                credential_exposure_status: "NONE_OBSERVED".to_string(),
                privacy_disposition: "QUALIFIED".to_string(),
            },
        };
        let review_path = root.join("natural-review.json");
        fs::write(
            &review_path,
            serde_json::to_vec_pretty(&review).expect("review JSON"),
        )
        .expect("write review");

        let verification = verify_natural_capture_review(&capture_dir, &review_path)
            .expect("verify natural review");
        assert!(verification.natural_provenance);
        assert!(verification.privacy_qualified);
        assert_eq!(verification.review_id, "manual-review-1");

        let mut unresolved_review = review.clone();
        unresolved_review
            .operational_review
            .external_transmission_status = "POSSIBLE_UNRESOLVED".to_string();
        unresolved_review.operational_review.privacy_disposition = "UNKNOWN".to_string();
        fs::write(
            &review_path,
            serde_json::to_vec(&unresolved_review).expect("unresolved review JSON"),
        )
        .expect("overwrite review");
        let unresolved_verification = verify_natural_capture_review(&capture_dir, &review_path)
            .expect("verify unresolved natural review");
        assert!(unresolved_verification.natural_provenance);
        assert!(!unresolved_verification.privacy_qualified);

        let mut invalid_review = review;
        invalid_review.observation.no_request_replay = false;
        fs::write(
            &review_path,
            serde_json::to_vec(&invalid_review).expect("invalid review JSON"),
        )
        .expect("overwrite review");
        assert!(matches!(
            verify_natural_capture_review(&capture_dir, &review_path),
            Err(CaptureError::InvalidEvidencePolicy(message))
                if message.contains("passive observation policy")
        ));
    }

    #[test]
    fn malformed_exact_wire_boundary_is_rejected() {
        assert!(matches!(
            ExactWireMessage::from_parts(b"abc", 10, 12),
            Err(CaptureError::InvalidBoundary)
        ));
    }

    #[test]
    fn invalid_capture_id_is_rejected_before_writing() {
        let (_, response) = messages();
        let root = temp_dir("invalid_id");
        let mut builder = CaptureBuilder::new(root, "../escape");
        builder.record_request(messages().0);
        assert!(matches!(
            builder.finish(response),
            Err(CaptureError::InvalidCaptureId)
        ));
    }

    #[test]
    fn relative_output_path_is_rejected_before_writing() {
        let (_, response) = messages();
        let mut builder = CaptureBuilder::new("relative-capture-root", "capture-one");
        builder.record_request(messages().0);
        assert!(matches!(
            builder.finish(response),
            Err(CaptureError::OutputPathNotAbsolute)
        ));
    }

    #[test]
    fn verifier_rejects_payload_path_escape() {
        let (request, response) = messages();
        let root = temp_dir("payload_escape");
        let mut builder = CaptureBuilder::new(&root, "capture-one");
        builder.record_request(request);
        let capture_dir = builder.finish(response).expect("write capture");
        let manifest_path = capture_dir.join(MANIFEST_FILE);
        let manifest = fs::read_to_string(&manifest_path).unwrap();
        fs::write(
            &manifest_path,
            manifest.replace("request-body.bin", "../outside.bin"),
        )
        .unwrap();
        assert!(matches!(
            verify_capture(capture_dir),
            Err(CaptureError::InvalidPayloadFile)
        ));
    }
}
