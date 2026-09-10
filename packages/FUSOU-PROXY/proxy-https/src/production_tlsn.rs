use crate::experimental_tlsn::{
    sha256, AttestationBinding, ExperimentalResultBoundary, ExperimentalTlsnForwarder,
    ExperimentalVerifierBoundary, ResultBoundaryError, ResultBoundaryFuture,
    SerializedOriginRequest, TlsnEvidenceMetadata, TlsnOriginExchange, TlsnOriginTransport,
    TlsnTransportError, TlsnTransportFuture, VerificationError, VerificationFuture,
    VerifiedTlsnEvidence,
};
use std::{
    collections::HashMap,
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OriginConfigurationError {
    InvalidHostname,
    InvalidServerIdentity,
    InvalidPort,
    EmptyTrustConfiguration,
    EmptyIdentityPolicy,
    ServerIdentityNotAllowed,
    ExperimentalDisabled,
}

impl std::fmt::Display for OriginConfigurationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::InvalidHostname => "origin hostname is invalid",
            Self::InvalidServerIdentity => "origin server identity is invalid",
            Self::InvalidPort => "origin port must be non-zero",
            Self::EmptyTrustConfiguration => "origin trust configuration is empty",
            Self::EmptyIdentityPolicy => "origin server identity policy is empty",
            Self::ServerIdentityNotAllowed => "origin server identity is not allowlisted",
            Self::ExperimentalDisabled => "Experimental TLSN is disabled in the origin config",
        };
        formatter.write_str(message)
    }
}

fn valid_authority_component(value: &str) -> bool {
    !value.is_empty()
        && value.is_ascii()
        && value
            .bytes()
            .all(|byte| !byte.is_ascii_control() && !byte.is_ascii_whitespace())
        && !value.contains(['/', '?', '#'])
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OriginTarget {
    hostname: String,
    port: u16,
    server_identity: String,
}

impl OriginTarget {
    pub fn new(
        hostname: String,
        port: u16,
        server_identity: String,
    ) -> Result<Self, OriginConfigurationError> {
        if !valid_authority_component(&hostname) {
            return Err(OriginConfigurationError::InvalidHostname);
        }
        if port == 0 {
            return Err(OriginConfigurationError::InvalidPort);
        }
        if !valid_authority_component(&server_identity) {
            return Err(OriginConfigurationError::InvalidServerIdentity);
        }
        Ok(Self {
            hostname,
            port,
            server_identity,
        })
    }

    pub fn hostname(&self) -> &str {
        &self.hostname
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn server_identity(&self) -> &str {
        &self.server_identity
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OriginTlsConfig {
    trusted_root_certificates: Vec<Vec<u8>>,
}

impl OriginTlsConfig {
    pub fn new(trusted_root_certificates: Vec<Vec<u8>>) -> Result<Self, OriginConfigurationError> {
        if trusted_root_certificates.is_empty()
            || trusted_root_certificates.iter().any(Vec::is_empty)
        {
            return Err(OriginConfigurationError::EmptyTrustConfiguration);
        }
        Ok(Self {
            trusted_root_certificates,
        })
    }

    pub fn trusted_root_certificates(&self) -> &[Vec<u8>] {
        &self.trusted_root_certificates
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerIdentityPolicy {
    allowlisted_identities: Vec<String>,
}

impl ServerIdentityPolicy {
    pub fn new(allowlisted_identities: Vec<String>) -> Result<Self, OriginConfigurationError> {
        if allowlisted_identities.is_empty() {
            return Err(OriginConfigurationError::EmptyIdentityPolicy);
        }
        if allowlisted_identities
            .iter()
            .any(|identity| !valid_authority_component(identity))
        {
            return Err(OriginConfigurationError::InvalidServerIdentity);
        }
        Ok(Self {
            allowlisted_identities,
        })
    }

    pub fn allows(&self, server_identity: &str) -> bool {
        self.allowlisted_identities
            .iter()
            .any(|identity| identity == server_identity)
    }

    pub fn identities(&self) -> &[String] {
        &self.allowlisted_identities
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OriginTransportConfig {
    target: OriginTarget,
    tls: OriginTlsConfig,
    server_identity_policy: ServerIdentityPolicy,
    experimental_enabled: bool,
}

impl OriginTransportConfig {
    pub fn new(
        target: OriginTarget,
        tls: OriginTlsConfig,
        server_identity_policy: ServerIdentityPolicy,
        experimental_enabled: bool,
    ) -> Self {
        Self {
            target,
            tls,
            server_identity_policy,
            experimental_enabled,
        }
    }

    pub fn validate_for_experimental(&self) -> Result<(), OriginConfigurationError> {
        if !self.experimental_enabled {
            return Err(OriginConfigurationError::ExperimentalDisabled);
        }
        if !self
            .server_identity_policy
            .allows(self.target.server_identity())
        {
            return Err(OriginConfigurationError::ServerIdentityNotAllowed);
        }
        Ok(())
    }

    pub fn target(&self) -> &OriginTarget {
        &self.target
    }

    pub fn tls(&self) -> &OriginTlsConfig {
        &self.tls
    }

    pub fn server_identity_policy(&self) -> &ServerIdentityPolicy {
        &self.server_identity_policy
    }
}

pub trait Alpha15OriginTransportFactory: Send + Sync {
    fn send_once(
        &self,
        config: OriginTransportConfig,
        request: SerializedOriginRequest,
    ) -> TlsnTransportFuture;
}

#[derive(Debug, Default)]
pub struct UnconfiguredAlpha15OriginTransportFactory;

impl Alpha15OriginTransportFactory for UnconfiguredAlpha15OriginTransportFactory {
    fn send_once(
        &self,
        _config: OriginTransportConfig,
        _request: SerializedOriginRequest,
    ) -> TlsnTransportFuture {
        Box::pin(async { Err(TlsnTransportError::Unavailable) })
    }
}

pub struct ProductionAlpha15OriginTransport {
    config: OriginTransportConfig,
    factory: Arc<dyn Alpha15OriginTransportFactory>,
    sent: AtomicBool,
}

impl ProductionAlpha15OriginTransport {
    pub fn new(
        config: OriginTransportConfig,
        factory: Arc<dyn Alpha15OriginTransportFactory>,
    ) -> Result<Self, OriginConfigurationError> {
        config.validate_for_experimental()?;
        Ok(Self {
            config,
            factory,
            sent: AtomicBool::new(false),
        })
    }
}

impl TlsnOriginTransport for ProductionAlpha15OriginTransport {
    fn send_once(&self, request: SerializedOriginRequest) -> TlsnTransportFuture {
        if self.sent.swap(true, Ordering::AcqRel) {
            return Box::pin(async { Err(TlsnTransportError::AlreadySent) });
        }
        self.factory.send_once(self.config.clone(), request)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TlsnPresentation {
    identifier: String,
    bytes: Vec<u8>,
    sha256: [u8; 32],
}

impl TlsnPresentation {
    pub fn new(identifier: String, bytes: Vec<u8>) -> Result<Self, PresentationError> {
        if identifier.is_empty()
            || !identifier.is_ascii()
            || identifier
                .bytes()
                .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
        {
            return Err(PresentationError::Invalid);
        }
        if bytes.is_empty() {
            return Err(PresentationError::Invalid);
        }
        Ok(Self {
            identifier,
            sha256: sha256(&bytes),
            bytes,
        })
    }

    pub fn identifier(&self) -> &str {
        &self.identifier
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn sha256(&self) -> &[u8; 32] {
        &self.sha256
    }
}

pub type PresentationFuture =
    Pin<Box<dyn Future<Output = Result<TlsnPresentation, PresentationError>> + Send>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PresentationError {
    Unavailable,
    Invalid,
}

impl std::fmt::Display for PresentationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Unavailable => "TLSN Presentation provider is unavailable",
            Self::Invalid => "TLSN Presentation is invalid",
        })
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RuntimeIdentifiers {
    experiment_id: Option<String>,
    session_id: Option<String>,
    request_id: Option<String>,
}

impl RuntimeIdentifiers {
    pub fn new(
        experiment_id: Option<String>,
        session_id: Option<String>,
        request_id: Option<String>,
    ) -> Self {
        Self {
            experiment_id,
            session_id,
            request_id,
        }
    }

    pub fn experiment_id(&self) -> Option<&str> {
        self.experiment_id.as_deref()
    }

    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    pub fn request_id(&self) -> Option<&str> {
        self.request_id.as_deref()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresentationRequestContext {
    identifiers: RuntimeIdentifiers,
    connection_id: u64,
    request_profile: Option<PresentationRequestProfile>,
    binding_identifier: [u8; 32],
    request_sha256: [u8; 32],
    authenticated_request_sha256: [u8; 32],
    response_sha256: [u8; 32],
    authenticated_response_sha256: [u8; 32],
    server_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresentationRequestProfile {
    method: String,
    target: String,
    http_version: String,
}

impl PresentationRequestProfile {
    fn from_serialized_request(request: &SerializedOriginRequest) -> Option<Self> {
        let line_end = request
            .bytes()
            .windows(2)
            .position(|window| window == b"\r\n")?;
        let mut fields = request.bytes()[..line_end].split(|byte| *byte == b' ');
        let method = std::str::from_utf8(fields.next()?).ok()?.to_owned();
        let target = std::str::from_utf8(fields.next()?).ok()?.to_owned();
        let http_version = std::str::from_utf8(fields.next()?).ok()?.to_owned();
        if fields.next().is_some() {
            return None;
        }
        Some(Self {
            method,
            target,
            http_version,
        })
    }

    pub fn method(&self) -> &str {
        &self.method
    }

    pub fn target(&self) -> &str {
        &self.target
    }

    pub fn http_version(&self) -> &str {
        &self.http_version
    }
}

impl PresentationRequestContext {
    fn from_exchange(
        identifiers: RuntimeIdentifiers,
        connection_id: u64,
        binding: &AttestationBinding,
        request: &SerializedOriginRequest,
        exchange: &TlsnOriginExchange,
        target: &OriginTarget,
    ) -> Self {
        let request_sha256 = sha256(request.bytes());
        let mut identifiers = identifiers;
        if identifiers.session_id.is_none() {
            identifiers.session_id = binding_session_id(binding.value());
        }
        if identifiers.request_id.is_none() {
            identifiers.request_id = Some(base64url_string(&request_sha256));
        }
        Self {
            identifiers,
            connection_id,
            request_profile: PresentationRequestProfile::from_serialized_request(request),
            binding_identifier: sha256(binding.value().as_bytes()),
            request_sha256,
            authenticated_request_sha256: exchange.transcript.request_sha256,
            response_sha256: sha256(&exchange.response.raw_response_bytes),
            authenticated_response_sha256: exchange.transcript.response_sha256,
            server_identity: target.server_identity().to_owned(),
        }
    }

    pub fn identifiers(&self) -> &RuntimeIdentifiers {
        &self.identifiers
    }

    pub fn connection_id(&self) -> u64 {
        self.connection_id
    }

    pub fn request_profile(&self) -> Option<&PresentationRequestProfile> {
        self.request_profile.as_ref()
    }

    pub fn binding_identifier(&self) -> &[u8; 32] {
        &self.binding_identifier
    }

    pub fn request_sha256(&self) -> &[u8; 32] {
        &self.request_sha256
    }

    pub fn authenticated_request_sha256(&self) -> &[u8; 32] {
        &self.authenticated_request_sha256
    }

    pub fn response_sha256(&self) -> &[u8; 32] {
        &self.response_sha256
    }

    pub fn authenticated_response_sha256(&self) -> &[u8; 32] {
        &self.authenticated_response_sha256
    }

    pub fn server_identity(&self) -> &str {
        &self.server_identity
    }
}

pub trait PresentationProvider: Send + Sync {
    fn provide(&self, context: PresentationRequestContext) -> PresentationFuture;

    fn discard(&self, _context: &PresentationRequestContext) {}
}

pub type PresentationExportFuture =
    Pin<Box<dyn Future<Output = Result<(), PresentationExportError>> + Send>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PresentationExportError {
    Unavailable,
    Failed,
}

impl std::fmt::Display for PresentationExportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Unavailable => "TLSN Presentation artifact export is unavailable",
            Self::Failed => "TLSN Presentation artifact export failed",
        })
    }
}

pub trait PresentationArtifactSink: Send + Sync {
    fn export(
        &self,
        context: PresentationRequestContext,
        presentation: TlsnPresentation,
    ) -> PresentationExportFuture;
}

#[derive(Debug, Default)]
pub struct UnconfiguredPresentationArtifactSink;

impl PresentationArtifactSink for UnconfiguredPresentationArtifactSink {
    fn export(
        &self,
        _context: PresentationRequestContext,
        _presentation: TlsnPresentation,
    ) -> PresentationExportFuture {
        Box::pin(async { Err(PresentationExportError::Unavailable) })
    }
}

#[derive(Debug, Default)]
pub struct UnconfiguredPresentationProvider;

impl PresentationProvider for UnconfiguredPresentationProvider {
    fn provide(&self, _context: PresentationRequestContext) -> PresentationFuture {
        Box::pin(async { Err(PresentationError::Unavailable) })
    }
}

#[derive(Default)]
pub struct PresentationHandoff {
    pending: Mutex<HashMap<[u8; 32], (String, Vec<u8>)>>,
    consumed: Mutex<HashMap<[u8; 32], TlsnPresentation>>,
}

impl PresentationHandoff {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn publish(
        &self,
        request_sha256: [u8; 32],
        identifier: String,
        bytes: Vec<u8>,
    ) -> Result<(), PresentationError> {
        if identifier.is_empty() || bytes.is_empty() {
            return Err(PresentationError::Invalid);
        }
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| PresentationError::Invalid)?;
        if pending.contains_key(&request_sha256) {
            return Err(PresentationError::Invalid);
        }
        pending.insert(request_sha256, (identifier, bytes));
        Ok(())
    }

    fn take_for(&self, request_sha256: &[u8; 32]) -> Result<TlsnPresentation, PresentationError> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| PresentationError::Invalid)?;
        let Some((identifier, bytes)) = pending.remove(request_sha256) else {
            return Err(PresentationError::Unavailable);
        };
        let presentation = TlsnPresentation::new(identifier, bytes)?;
        self.consumed
            .lock()
            .map_err(|_| PresentationError::Invalid)?
            .insert(*request_sha256, presentation.clone());
        Ok(presentation)
    }

    pub(crate) fn take_consumed(
        &self,
        request_sha256: &[u8; 32],
    ) -> Result<TlsnPresentation, PresentationError> {
        self.consumed
            .lock()
            .map_err(|_| PresentationError::Invalid)?
            .remove(request_sha256)
            .ok_or(PresentationError::Unavailable)
    }

    fn discard_consumed(&self, request_sha256: &[u8; 32]) {
        if let Ok(mut consumed) = self.consumed.lock() {
            consumed.remove(request_sha256);
        }
    }
}

pub struct HandoffPresentationProvider {
    handoff: Arc<PresentationHandoff>,
}

impl HandoffPresentationProvider {
    pub fn new(handoff: Arc<PresentationHandoff>) -> Self {
        Self { handoff }
    }
}

impl PresentationProvider for HandoffPresentationProvider {
    fn provide(&self, context: PresentationRequestContext) -> PresentationFuture {
        let handoff = Arc::clone(&self.handoff);
        Box::pin(async move { handoff.take_for(context.authenticated_request_sha256()) })
    }

    fn discard(&self, context: &PresentationRequestContext) {
        self.handoff
            .discard_consumed(context.authenticated_request_sha256());
    }
}

pub struct FilesystemPresentationArtifactSink {
    root: std::path::PathBuf,
}

impl FilesystemPresentationArtifactSink {
    pub fn new(root: impl Into<std::path::PathBuf>) -> Self {
        Self { root: root.into() }
    }
}

impl PresentationArtifactSink for FilesystemPresentationArtifactSink {
    fn export(
        &self,
        context: PresentationRequestContext,
        presentation: TlsnPresentation,
    ) -> PresentationExportFuture {
        let root = self.root.clone();
        Box::pin(async move {
            tokio::fs::create_dir_all(&root)
                .await
                .map_err(|_| PresentationExportError::Failed)?;
            let directory = root.join(presentation.identifier());
            tokio::fs::create_dir(&directory)
                .await
                .map_err(|_| PresentationExportError::Failed)?;

            let metadata = serde_json::json!({
                "schema_version": 1,
                "capture_provenance": "production",
                "capture_source": "fusou-proxy-production-tlsn",
                "synthetic": false,
                "test": false,
                "canary": false,
                "local": false,
                "presentation_sha256": base64url_string(presentation.sha256()),
                "presentation_size_bytes": presentation.bytes().len(),
                "capture_timestamp": chrono::Utc::now().to_rfc3339(),
                "connection_id": context.connection_id(),
                "session_id": context.identifiers().session_id(),
                "request_id": context.identifiers().request_id(),
                "request_sha256": base64url_string(context.request_sha256()),
                "authenticated_request_sha256": base64url_string(context.authenticated_request_sha256()),
                "response_sha256": base64url_string(context.response_sha256()),
                "authenticated_response_sha256": base64url_string(context.authenticated_response_sha256()),
                "binding_identifier": base64url_string(context.binding_identifier()),
                "server_identity": context.server_identity(),
                "request": context.request_profile().map(|profile| serde_json::json!({
                    "method": profile.method(),
                    "target": profile.target(),
                    "http_version": profile.http_version(),
                })),
                "proxy_provenance": {
                    "declared": "production",
                    "cryptographic_status": "UNVERIFIED",
                    "proxy_identity": "fusou-proxy",
                    "proxy_deployment_id": "runtime-artifact",
                    "proxy_binary_identity": format!("proxy-https:{}", env!("CARGO_PKG_VERSION")),
                    "presentation_sha256": base64url_string(presentation.sha256()),
                    "created_at": chrono::Utc::now().to_rfc3339(),
                    "capture_context": {
                        "source": "FUSOU-APP client-facing TLS plaintext boundary",
                        "request_origin": "FUSOU-APP normal game traffic",
                        "no_standalone_game_server_request": true,
                        "no_request_injection": true,
                        "no_request_replay": true,
                        "no_capture_generated_traffic": true,
                        "method": context.request_profile().map(|profile| profile.method()),
                        "target": context.request_profile().map(|profile| profile.target()),
                        "http_version": context.request_profile().map(|profile| profile.http_version()),
                        "connection_id": context.connection_id(),
                        "request_sha256": base64url_string(context.request_sha256()),
                        "authenticated_request_sha256": base64url_string(context.authenticated_request_sha256()),
                    },
                    "authority": {
                        "type": "externally-pinned-production-proxy-key",
                        "status": "UNVERIFIED",
                    },
                    "signer_key_id": null,
                    "signature": null,
                },
            });

            tokio::fs::write(directory.join("presentation.bin"), presentation.bytes())
                .await
                .map_err(|_| PresentationExportError::Failed)?;
            tokio::fs::write(
                directory.join("metadata.json"),
                serde_json::to_vec_pretty(&metadata)
                    .map_err(|_| PresentationExportError::Failed)?,
            )
            .await
            .map_err(|_| PresentationExportError::Failed)
        })
    }
}

fn binding_session_id(value: &str) -> Option<String> {
    const PREFIX: &[u8] = b"FUSOU-ATTESTATION-BINDING-V1\0";
    let bytes = decode_base64url(value)?;
    if bytes.len() != PREFIX.len() + 2 + 16 + 2 + 32 || !bytes.starts_with(PREFIX) {
        return None;
    }
    let session_length = u16::from_be_bytes([bytes[PREFIX.len()], bytes[PREFIX.len() + 1]]);
    if session_length != 16 {
        return None;
    }
    uuid::Uuid::from_slice(&bytes[PREFIX.len() + 2..PREFIX.len() + 18])
        .ok()
        .map(|uuid| uuid.hyphenated().to_string())
}

fn decode_base64url(value: &str) -> Option<Vec<u8>> {
    if value.is_empty() || value.contains('=') || !value.is_ascii() {
        return None;
    }
    let mut output = Vec::with_capacity(value.len() * 3 / 4);
    let mut accumulator = 0_u32;
    let mut bits = 0_u8;
    for byte in value.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            _ => return None,
        };
        accumulator = (accumulator << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((accumulator >> bits) as u8);
            accumulator &= (1 << bits) - 1;
        }
    }
    if bits >= 6 || (bits > 0 && accumulator != 0) {
        return None;
    }
    Some(output)
}

fn base64url_string(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::with_capacity((bytes.len() * 4 + 2) / 3);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        output.push(TABLE[(first >> 2) as usize] as char);
        if chunk.len() == 1 {
            output.push(TABLE[((first & 0x03) << 4) as usize] as char);
        } else {
            let second = chunk[1];
            output.push(TABLE[(((first & 0x03) << 4) | (second >> 4)) as usize] as char);
            if chunk.len() == 2 {
                output.push(TABLE[((second & 0x0f) << 2) as usize] as char);
            } else {
                let third = chunk[2];
                output.push(TABLE[(((second & 0x0f) << 2) | (third >> 6)) as usize] as char);
                output.push(TABLE[(third & 0x3f) as usize] as char);
            }
        }
    }
    output
}

pub trait DedicatedTlsnVerifier: Send + Sync {
    fn verify(
        &self,
        context: PresentationRequestContext,
        request: SerializedOriginRequest,
        binding: AttestationBinding,
        exchange: TlsnOriginExchange,
        presentation: TlsnPresentation,
    ) -> VerificationFuture;
}

#[derive(Debug, Default)]
pub struct UnconfiguredDedicatedVerifier;

impl DedicatedTlsnVerifier for UnconfiguredDedicatedVerifier {
    fn verify(
        &self,
        _context: PresentationRequestContext,
        _request: SerializedOriginRequest,
        _binding: AttestationBinding,
        _exchange: TlsnOriginExchange,
        _presentation: TlsnPresentation,
    ) -> VerificationFuture {
        Box::pin(async { Err(VerificationError::Unavailable) })
    }
}

pub struct PresentationVerifierBoundary {
    presentation_provider: Arc<dyn PresentationProvider>,
    dedicated_verifier: Arc<dyn DedicatedTlsnVerifier>,
    presentation_artifact_sink: Option<Arc<dyn PresentationArtifactSink>>,
    target: OriginTarget,
    identifiers: RuntimeIdentifiers,
}

impl PresentationVerifierBoundary {
    pub fn new(
        presentation_provider: Arc<dyn PresentationProvider>,
        dedicated_verifier: Arc<dyn DedicatedTlsnVerifier>,
        target: OriginTarget,
        identifiers: RuntimeIdentifiers,
    ) -> Arc<Self> {
        Self::new_with_artifact_sink(
            presentation_provider,
            dedicated_verifier,
            target,
            identifiers,
            None,
        )
    }

    pub fn new_with_artifact_sink(
        presentation_provider: Arc<dyn PresentationProvider>,
        dedicated_verifier: Arc<dyn DedicatedTlsnVerifier>,
        target: OriginTarget,
        identifiers: RuntimeIdentifiers,
        presentation_artifact_sink: Option<Arc<dyn PresentationArtifactSink>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            presentation_provider,
            dedicated_verifier,
            presentation_artifact_sink,
            target,
            identifiers,
        })
    }
}

impl ExperimentalVerifierBoundary for PresentationVerifierBoundary {
    fn verify(
        &self,
        connection_id: u64,
        request: SerializedOriginRequest,
        binding: AttestationBinding,
        exchange: TlsnOriginExchange,
    ) -> VerificationFuture {
        let request_sha256 = sha256(request.bytes());
        let response_sha256 = sha256(&exchange.response.raw_response_bytes);
        if exchange.transcript.request_sha256 != request_sha256
            || exchange.transcript.response_sha256 != response_sha256
        {
            return Box::pin(async { Err(VerificationError::InvalidTranscript) });
        }
        let provider = Arc::clone(&self.presentation_provider);
        let verifier = Arc::clone(&self.dedicated_verifier);
        let artifact_sink = self.presentation_artifact_sink.clone();
        let context = PresentationRequestContext::from_exchange(
            self.identifiers.clone(),
            connection_id,
            &binding,
            &request,
            &exchange,
            &self.target,
        );
        Box::pin(async move {
            let presentation =
                provider
                    .provide(context.clone())
                    .await
                    .map_err(|error| match error {
                        PresentationError::Unavailable => {
                            VerificationError::PresentationUnavailable
                        }
                        PresentationError::Invalid => VerificationError::PresentationInvalid,
                    })?;
            let result = async {
                if let Some(artifact_sink) = artifact_sink {
                    artifact_sink
                        .export(context.clone(), presentation.clone())
                        .await
                        .map_err(|error| match error {
                            PresentationExportError::Unavailable => {
                                VerificationError::PresentationExportUnavailable
                            }
                            PresentationExportError::Failed => {
                                VerificationError::PresentationExportFailed
                            }
                        })?;
                }
                let presentation_metadata = TlsnEvidenceMetadata::new(
                    context.connection_id(),
                    *context.binding_identifier(),
                    Some(context.server_identity().to_owned()),
                    *context.authenticated_request_sha256(),
                    *context.authenticated_response_sha256(),
                    Some(presentation.identifier().to_owned()),
                    Some(*presentation.sha256()),
                );
                let evidence = verifier
                    .verify(context.clone(), request, binding, exchange, presentation)
                    .await?;
                if evidence.request_sha256() != &request_sha256
                    || evidence.response_sha256() != &response_sha256
                {
                    return Err(VerificationError::InvalidTranscript);
                }
                Ok(evidence.with_metadata(presentation_metadata))
            }
            .await;
            if result.is_err() {
                provider.discard(&context);
            }
            result
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResultSignerError {
    Unavailable,
    Failed,
}

pub type ResultSignerFuture =
    Pin<Box<dyn Future<Output = Result<SignedTlsnResult, ResultSignerError>> + Send>>;

pub trait ProductionResultSigner: Send + Sync {
    fn sign(&self, evidence: VerifiedTlsnEvidence) -> ResultSignerFuture;
}

#[derive(Debug, Default)]
pub struct UnconfiguredProductionResultSigner;

impl ProductionResultSigner for UnconfiguredProductionResultSigner {
    fn sign(&self, _evidence: VerifiedTlsnEvidence) -> ResultSignerFuture {
        Box::pin(async { Err(ResultSignerError::Unavailable) })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignedTlsnResult {
    key_id: String,
    bytes: Vec<u8>,
    sha256: [u8; 32],
}

impl SignedTlsnResult {
    pub fn new(key_id: String, bytes: Vec<u8>) -> Result<Self, ResultSignerError> {
        if key_id.is_empty() || bytes.is_empty() {
            return Err(ResultSignerError::Failed);
        }
        Ok(Self {
            key_id,
            sha256: sha256(&bytes),
            bytes,
        })
    }

    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn sha256(&self) -> &[u8; 32] {
        &self.sha256
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResultDeliveryError {
    Unavailable,
    Failed,
}

pub type ResultDeliveryFuture =
    Pin<Box<dyn Future<Output = Result<(), ResultDeliveryError>> + Send>>;

pub trait ProductionResultDelivery: Send + Sync {
    fn deliver(&self, result: SignedTlsnResult) -> ResultDeliveryFuture;
}

#[derive(Debug, Default)]
pub struct UnconfiguredProductionResultDelivery;

impl ProductionResultDelivery for UnconfiguredProductionResultDelivery {
    fn deliver(&self, _result: SignedTlsnResult) -> ResultDeliveryFuture {
        Box::pin(async { Err(ResultDeliveryError::Unavailable) })
    }
}

pub struct SignedResultBoundary {
    signer: Arc<dyn ProductionResultSigner>,
    delivery: Arc<dyn ProductionResultDelivery>,
}

impl SignedResultBoundary {
    pub fn new(
        signer: Arc<dyn ProductionResultSigner>,
        delivery: Arc<dyn ProductionResultDelivery>,
    ) -> Arc<Self> {
        Arc::new(Self { signer, delivery })
    }
}

impl ExperimentalResultBoundary for SignedResultBoundary {
    fn accept(&self, evidence: VerifiedTlsnEvidence) -> ResultBoundaryFuture {
        let signer = Arc::clone(&self.signer);
        let delivery = Arc::clone(&self.delivery);
        Box::pin(async move {
            let result = signer.sign(evidence).await.map_err(|error| match error {
                ResultSignerError::Unavailable => ResultBoundaryError::SigningUnavailable,
                ResultSignerError::Failed => ResultBoundaryError::Unavailable,
            })?;
            delivery.deliver(result).await.map_err(|error| match error {
                ResultDeliveryError::Unavailable => ResultBoundaryError::DeliveryUnavailable,
                ResultDeliveryError::Failed => ResultBoundaryError::Unavailable,
            })
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProductionConfigurationError {
    InvalidOrigin(OriginConfigurationError),
    MissingPresentationArtifactSink,
}

impl std::fmt::Display for ProductionConfigurationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidOrigin(error) => write!(formatter, "invalid production origin: {error}"),
            Self::MissingPresentationArtifactSink => {
                formatter.write_str("production TLSN requires a Presentation artifact sink")
            }
        }
    }
}

pub struct ProductionTlsnDependencies {
    origin: OriginTransportConfig,
    binding_provider: Arc<dyn crate::experimental_tlsn::AttestationBindingProvider>,
    transport_factory: Arc<dyn Alpha15OriginTransportFactory>,
    presentation_provider: Arc<dyn PresentationProvider>,
    presentation_artifact_sink: Option<Arc<dyn PresentationArtifactSink>>,
    dedicated_verifier: Arc<dyn DedicatedTlsnVerifier>,
    signer: Arc<dyn ProductionResultSigner>,
    delivery: Arc<dyn ProductionResultDelivery>,
    identifiers: RuntimeIdentifiers,
}

impl ProductionTlsnDependencies {
    pub fn new(
        origin: OriginTransportConfig,
        binding_provider: Arc<dyn crate::experimental_tlsn::AttestationBindingProvider>,
        transport_factory: Arc<dyn Alpha15OriginTransportFactory>,
        presentation_provider: Arc<dyn PresentationProvider>,
        dedicated_verifier: Arc<dyn DedicatedTlsnVerifier>,
        signer: Arc<dyn ProductionResultSigner>,
        delivery: Arc<dyn ProductionResultDelivery>,
    ) -> Self {
        Self {
            origin,
            binding_provider,
            transport_factory,
            presentation_provider,
            presentation_artifact_sink: None,
            dedicated_verifier,
            signer,
            delivery,
            identifiers: RuntimeIdentifiers::default(),
        }
    }

    pub fn with_identifiers(mut self, identifiers: RuntimeIdentifiers) -> Self {
        self.identifiers = identifiers;
        self
    }

    pub fn with_presentation_artifact_sink(
        mut self,
        sink: Arc<dyn PresentationArtifactSink>,
    ) -> Self {
        self.presentation_artifact_sink = Some(sink);
        self
    }

    pub fn build_forwarder(
        self,
    ) -> Result<Arc<ExperimentalTlsnForwarder>, ProductionConfigurationError> {
        self.origin
            .validate_for_experimental()
            .map_err(ProductionConfigurationError::InvalidOrigin)?;
        let presentation_artifact_sink = self
            .presentation_artifact_sink
            .ok_or(ProductionConfigurationError::MissingPresentationArtifactSink)?;
        let transport = Arc::new(
            ProductionAlpha15OriginTransport::new(self.origin.clone(), self.transport_factory)
                .map_err(ProductionConfigurationError::InvalidOrigin)?,
        );
        let verifier = PresentationVerifierBoundary::new_with_artifact_sink(
            self.presentation_provider,
            self.dedicated_verifier,
            self.origin.target().clone(),
            self.identifiers,
            Some(presentation_artifact_sink),
        );
        let result_boundary = SignedResultBoundary::new(self.signer, self.delivery);
        Ok(ExperimentalTlsnForwarder::new(
            self.binding_provider,
            Arc::new(crate::experimental_tlsn::Http1OriginRequestSerializer),
            transport,
            verifier,
            result_boundary,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::experimental_tlsn::{
        AttestationBinding, BindingError, BindingFuture, ExperimentalRequireInfoForwarder,
        TlsnOriginResponse, VerifiedMemberId,
    };
    use crate::experimental_tlsn::{ProofContinuation, TlsnOriginCapture};
    use http::{HeaderMap, HeaderValue, StatusCode};
    use hyper::body::Bytes;
    use std::sync::{atomic::AtomicUsize, Mutex};

    fn origin_config(enabled: bool) -> OriginTransportConfig {
        OriginTransportConfig::new(
            OriginTarget::new(
                "game.example.test".to_owned(),
                443,
                "game.example.test".to_owned(),
            )
            .unwrap(),
            OriginTlsConfig::new(vec![vec![1, 2, 3]]).unwrap(),
            ServerIdentityPolicy::new(vec!["game.example.test".to_owned()]).unwrap(),
            enabled,
        )
    }

    fn request() -> SerializedOriginRequest {
        SerializedOriginRequest::new(Bytes::from_static(
            b"POST /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: game.example.test\r\nContent-Length: 0\r\nX-Attestation-Binding: opaque\r\n\r\n",
        ))
        .unwrap()
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
            transcript: crate::experimental_tlsn::UnverifiedTlsnTranscript {
                request_sha256: sha256(request().bytes()),
                response_sha256: sha256(&raw_response),
            },
        }
    }

    struct RecordingFactory {
        calls: AtomicUsize,
        request: Mutex<Option<Vec<u8>>>,
    }

    impl Alpha15OriginTransportFactory for RecordingFactory {
        fn send_once(
            &self,
            _config: OriginTransportConfig,
            request: SerializedOriginRequest,
        ) -> TlsnTransportFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            *self.request.lock().unwrap() = Some(request.bytes().to_vec());
            Box::pin(async {
                Ok(TlsnOriginCapture {
                    exchange: exchange(),
                    proof: ProofContinuation::completed(),
                })
            })
        }
    }

    struct Binding;

    impl crate::experimental_tlsn::AttestationBindingProvider for Binding {
        fn issue_binding(
            &self,
            _context: crate::experimental_tlsn::BindingRequestContext,
        ) -> BindingFuture {
            Box::pin(async {
                AttestationBinding::new("opaque".to_owned())
                    .map_err(|_| BindingError::InvalidBinding)
            })
        }
    }

    struct RecordingPresentationProvider {
        calls: AtomicUsize,
        context: Mutex<Option<PresentationRequestContext>>,
    }

    impl PresentationProvider for RecordingPresentationProvider {
        fn provide(&self, context: PresentationRequestContext) -> PresentationFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            *self.context.lock().unwrap() = Some(context);
            Box::pin(async { TlsnPresentation::new("presentation-1".to_owned(), vec![9, 8, 7]) })
        }
    }

    struct RecordingPresentationArtifactSink {
        calls: AtomicUsize,
        context: Mutex<Option<PresentationRequestContext>>,
        presentation: Mutex<Option<TlsnPresentation>>,
    }

    impl PresentationArtifactSink for RecordingPresentationArtifactSink {
        fn export(
            &self,
            context: PresentationRequestContext,
            presentation: TlsnPresentation,
        ) -> PresentationExportFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            *self.context.lock().unwrap() = Some(context);
            *self.presentation.lock().unwrap() = Some(presentation);
            Box::pin(async { Ok(()) })
        }
    }

    struct RecordingDedicatedVerifier {
        calls: AtomicUsize,
        presentation: Mutex<Option<TlsnPresentation>>,
    }

    impl DedicatedTlsnVerifier for RecordingDedicatedVerifier {
        fn verify(
            &self,
            context: PresentationRequestContext,
            request: SerializedOriginRequest,
            _binding: AttestationBinding,
            exchange: TlsnOriginExchange,
            presentation: TlsnPresentation,
        ) -> VerificationFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            *self.presentation.lock().unwrap() = Some(presentation);
            let request_sha256 = sha256(request.bytes());
            let response_sha256 = sha256(&exchange.response.raw_response_bytes);
            assert_eq!(context.request_sha256(), &request_sha256);
            assert_eq!(context.response_sha256(), &response_sha256);
            Box::pin(async move {
                Ok(VerifiedTlsnEvidence::from_verifier(
                    request_sha256,
                    response_sha256,
                    VerifiedMemberId::from_verifier("16189463".to_owned())?,
                ))
            })
        }
    }

    struct MismatchedDedicatedVerifier;

    impl DedicatedTlsnVerifier for MismatchedDedicatedVerifier {
        fn verify(
            &self,
            _context: PresentationRequestContext,
            _request: SerializedOriginRequest,
            _binding: AttestationBinding,
            _exchange: TlsnOriginExchange,
            _presentation: TlsnPresentation,
        ) -> VerificationFuture {
            Box::pin(async {
                Ok(VerifiedTlsnEvidence::from_verifier(
                    [1_u8; 32],
                    [2_u8; 32],
                    VerifiedMemberId::from_verifier("16189463".to_owned())?,
                ))
            })
        }
    }

    struct RecordingSigner {
        calls: AtomicUsize,
    }

    impl ProductionResultSigner for RecordingSigner {
        fn sign(&self, _evidence: VerifiedTlsnEvidence) -> ResultSignerFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { SignedTlsnResult::new("key-1".to_owned(), b"signed-result".to_vec()) })
        }
    }

    struct RecordingDelivery {
        calls: AtomicUsize,
        result: Mutex<Option<SignedTlsnResult>>,
    }

    impl ProductionResultDelivery for RecordingDelivery {
        fn deliver(&self, result: SignedTlsnResult) -> ResultDeliveryFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            *self.result.lock().unwrap() = Some(result);
            Box::pin(async { Ok(()) })
        }
    }

    #[test]
    fn production_origin_requires_explicit_enablement_and_allowlist() {
        assert_eq!(
            origin_config(false).validate_for_experimental(),
            Err(OriginConfigurationError::ExperimentalDisabled)
        );
        let config = OriginTransportConfig::new(
            OriginTarget::new(
                "game.example.test".to_owned(),
                443,
                "game.example.test".to_owned(),
            )
            .unwrap(),
            OriginTlsConfig::new(vec![vec![1]]).unwrap(),
            ServerIdentityPolicy::new(vec!["other.example.test".to_owned()]).unwrap(),
            true,
        );
        assert_eq!(
            config.validate_for_experimental(),
            Err(OriginConfigurationError::ServerIdentityNotAllowed)
        );
    }

    #[tokio::test]
    async fn production_transport_preserves_bytes_and_is_one_shot() {
        let factory = Arc::new(RecordingFactory {
            calls: AtomicUsize::new(0),
            request: Mutex::new(None),
        });
        let transport = ProductionAlpha15OriginTransport::new(
            origin_config(true),
            Arc::clone(&factory) as Arc<dyn Alpha15OriginTransportFactory>,
        )
        .unwrap();
        let request = request();
        transport.send_once(request.clone()).await.unwrap();
        assert_eq!(factory.calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            factory.request.lock().unwrap().as_deref(),
            Some(request.bytes())
        );
        assert!(matches!(
            transport.send_once(request).await,
            Err(TlsnTransportError::AlreadySent)
        ));
    }

    #[tokio::test]
    async fn unconfigured_origin_fails_closed_without_a_real_connection() {
        let transport = ProductionAlpha15OriginTransport::new(
            origin_config(true),
            Arc::new(UnconfiguredAlpha15OriginTransportFactory),
        )
        .unwrap();
        assert!(matches!(
            transport.send_once(request()).await,
            Err(TlsnTransportError::Unavailable)
        ));
    }

    #[tokio::test]
    async fn production_dependencies_build_explicitly_and_fail_closed_without_transport() {
        let sink = Arc::new(RecordingPresentationArtifactSink {
            calls: AtomicUsize::new(0),
            context: Mutex::new(None),
            presentation: Mutex::new(None),
        });
        let forwarder = ProductionTlsnDependencies::new(
            origin_config(true),
            Arc::new(Binding),
            Arc::new(UnconfiguredAlpha15OriginTransportFactory),
            Arc::new(UnconfiguredPresentationProvider),
            Arc::new(UnconfiguredDedicatedVerifier),
            Arc::new(UnconfiguredProductionResultSigner),
            Arc::new(UnconfiguredProductionResultDelivery),
        )
        .with_presentation_artifact_sink(sink)
        .build_forwarder()
        .unwrap();
        let request = hudsucker::hyper::Request::builder()
            .method("POST")
            .uri("https://game.example.test/kcsapi/api_get_member/require_info")
            .header("Host", "game.example.test")
            .body(Bytes::new())
            .unwrap();

        assert_eq!(
            forwarder.forward(42, request).await.unwrap_err(),
            "TLSN origin transport is unavailable"
        );
    }

    #[test]
    fn production_dependencies_require_an_artifact_sink() {
        let result = ProductionTlsnDependencies::new(
            origin_config(true),
            Arc::new(Binding),
            Arc::new(UnconfiguredAlpha15OriginTransportFactory),
            Arc::new(UnconfiguredPresentationProvider),
            Arc::new(UnconfiguredDedicatedVerifier),
            Arc::new(UnconfiguredProductionResultSigner),
            Arc::new(UnconfiguredProductionResultDelivery),
        )
        .build_forwarder();

        let error = match result {
            Ok(_) => panic!("missing artifact sink must fail closed"),
            Err(error) => error,
        };
        assert_eq!(
            error.to_string(),
            "production TLSN requires a Presentation artifact sink"
        );
    }

    #[tokio::test]
    async fn presentation_boundary_attaches_provider_metadata_after_verification() {
        let provider = Arc::new(RecordingPresentationProvider {
            calls: AtomicUsize::new(0),
            context: Mutex::new(None),
        });
        let verifier = Arc::new(RecordingDedicatedVerifier {
            calls: AtomicUsize::new(0),
            presentation: Mutex::new(None),
        });
        let boundary = PresentationVerifierBoundary::new(
            Arc::clone(&provider) as Arc<dyn PresentationProvider>,
            Arc::clone(&verifier) as Arc<dyn DedicatedTlsnVerifier>,
            OriginTarget::new(
                "game.example.test".to_owned(),
                443,
                "game.example.test".to_owned(),
            )
            .unwrap(),
            RuntimeIdentifiers::new(
                Some("experiment-1".to_owned()),
                Some("session-1".to_owned()),
                Some("request-1".to_owned()),
            ),
        );
        let request = request();
        let binding = AttestationBinding::new("opaque".to_owned()).unwrap();
        let exchange = exchange();
        let authenticated_request_sha256 = exchange.transcript.request_sha256;
        let authenticated_response_sha256 = exchange.transcript.response_sha256;
        let evidence = boundary
            .verify(7, request.clone(), binding.clone(), exchange)
            .await
            .unwrap();

        assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
        assert_eq!(verifier.calls.load(Ordering::SeqCst), 1);
        let context = provider.context.lock().unwrap().clone().unwrap();
        assert_eq!(context.connection_id(), 7);
        assert_eq!(context.identifiers().experiment_id(), Some("experiment-1"));
        assert_eq!(context.identifiers().session_id(), Some("session-1"));
        assert_eq!(context.identifiers().request_id(), Some("request-1"));
        assert_eq!(
            context.binding_identifier(),
            &sha256(binding.value().as_bytes())
        );
        assert_eq!(
            context.authenticated_request_sha256(),
            &authenticated_request_sha256
        );
        assert_eq!(
            context.authenticated_response_sha256(),
            &authenticated_response_sha256
        );
        assert_eq!(context.server_identity(), "game.example.test");
        assert_eq!(
            verifier
                .presentation
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .identifier(),
            "presentation-1"
        );
        assert_eq!(evidence.metadata().connection_id(), 7);
        assert_eq!(
            evidence.metadata().binding_identifier(),
            &sha256(binding.value().as_bytes())
        );
        assert_eq!(
            evidence.metadata().authenticated_request_sha256(),
            &authenticated_request_sha256
        );
        assert_eq!(
            evidence.metadata().authenticated_response_sha256(),
            &authenticated_response_sha256
        );
        assert_eq!(
            evidence.metadata().server_identity(),
            Some("game.example.test")
        );
        assert_eq!(
            evidence.metadata().presentation_identifier(),
            Some("presentation-1")
        );
        assert_eq!(
            evidence.metadata().presentation_sha256(),
            Some(&sha256(&[9, 8, 7]))
        );
        assert_eq!(evidence.request_sha256(), &sha256(request.bytes()));
    }

    #[tokio::test]
    async fn presentation_boundary_exports_raw_presentation_with_safe_request_profile() {
        let provider = Arc::new(RecordingPresentationProvider {
            calls: AtomicUsize::new(0),
            context: Mutex::new(None),
        });
        let sink = Arc::new(RecordingPresentationArtifactSink {
            calls: AtomicUsize::new(0),
            context: Mutex::new(None),
            presentation: Mutex::new(None),
        });
        let boundary = PresentationVerifierBoundary::new_with_artifact_sink(
            Arc::clone(&provider) as Arc<dyn PresentationProvider>,
            Arc::new(RecordingDedicatedVerifier {
                calls: AtomicUsize::new(0),
                presentation: Mutex::new(None),
            }),
            OriginTarget::new(
                "game.example.test".to_owned(),
                443,
                "game.example.test".to_owned(),
            )
            .unwrap(),
            RuntimeIdentifiers::default(),
            Some(Arc::clone(&sink) as Arc<dyn PresentationArtifactSink>),
        );

        boundary
            .verify(
                7,
                request(),
                AttestationBinding::new("opaque".to_owned()).unwrap(),
                exchange(),
            )
            .await
            .unwrap();

        assert_eq!(sink.calls.load(Ordering::SeqCst), 1);
        let context = sink.context.lock().unwrap().clone().unwrap();
        let profile = context.request_profile().unwrap();
        assert_eq!(profile.method(), "POST");
        assert_eq!(profile.target(), "/kcsapi/api_get_member/require_info");
        assert_eq!(profile.http_version(), "HTTP/1.1");
        assert_eq!(
            sink.presentation.lock().unwrap().as_ref().unwrap().bytes(),
            &[9, 8, 7]
        );
    }

    #[tokio::test]
    async fn unconfigured_presentation_boundary_fails_closed() {
        let boundary = PresentationVerifierBoundary::new(
            Arc::new(UnconfiguredPresentationProvider),
            Arc::new(UnconfiguredDedicatedVerifier),
            OriginTarget::new(
                "game.example.test".to_owned(),
                443,
                "game.example.test".to_owned(),
            )
            .unwrap(),
            RuntimeIdentifiers::default(),
        );

        assert_eq!(
            boundary
                .verify(
                    1,
                    request(),
                    AttestationBinding::new("opaque".to_owned()).unwrap(),
                    exchange(),
                )
                .await,
            Err(VerificationError::PresentationUnavailable)
        );
    }

    #[tokio::test]
    async fn presentation_boundary_rejects_inconsistent_transcript_before_provider() {
        let provider = Arc::new(RecordingPresentationProvider {
            calls: AtomicUsize::new(0),
            context: Mutex::new(None),
        });
        let boundary = PresentationVerifierBoundary::new(
            Arc::clone(&provider) as Arc<dyn PresentationProvider>,
            Arc::new(UnconfiguredDedicatedVerifier),
            OriginTarget::new(
                "game.example.test".to_owned(),
                443,
                "game.example.test".to_owned(),
            )
            .unwrap(),
            RuntimeIdentifiers::default(),
        );
        let mut exchange = exchange();
        exchange.transcript.request_sha256 = [0_u8; 32];

        assert_eq!(
            boundary
                .verify(
                    1,
                    request(),
                    AttestationBinding::new("opaque".to_owned()).unwrap(),
                    exchange,
                )
                .await,
            Err(VerificationError::InvalidTranscript)
        );
        assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn presentation_boundary_rejects_mismatched_verifier_evidence() {
        let handoff = PresentationHandoff::new();
        let request = request();
        let binding = AttestationBinding::new("opaque".to_owned()).unwrap();
        let exchange = exchange();
        let request_sha256 = exchange.transcript.request_sha256;
        handoff
            .publish(request_sha256, "presentation-1".to_owned(), vec![9, 8, 7])
            .unwrap();
        let boundary = PresentationVerifierBoundary::new(
            Arc::new(HandoffPresentationProvider::new(Arc::clone(&handoff))),
            Arc::new(MismatchedDedicatedVerifier),
            OriginTarget::new(
                "game.example.test".to_owned(),
                443,
                "game.example.test".to_owned(),
            )
            .unwrap(),
            RuntimeIdentifiers::default(),
        );

        assert_eq!(
            boundary.verify(1, request, binding, exchange).await,
            Err(VerificationError::InvalidTranscript)
        );
        assert!(matches!(
            handoff.take_consumed(&request_sha256),
            Err(PresentationError::Unavailable)
        ));
    }

    #[tokio::test]
    async fn signed_result_boundary_signs_before_delivery() {
        let signer = Arc::new(RecordingSigner {
            calls: AtomicUsize::new(0),
        });
        let delivery = Arc::new(RecordingDelivery {
            calls: AtomicUsize::new(0),
            result: Mutex::new(None),
        });
        let boundary = SignedResultBoundary::new(
            Arc::clone(&signer) as Arc<dyn ProductionResultSigner>,
            Arc::clone(&delivery) as Arc<dyn ProductionResultDelivery>,
        );

        boundary
            .accept(VerifiedTlsnEvidence::from_verifier(
                sha256(b"request"),
                sha256(b"response"),
                VerifiedMemberId::from_verifier("16189463".to_owned()).unwrap(),
            ))
            .await
            .unwrap();

        assert_eq!(signer.calls.load(Ordering::SeqCst), 1);
        assert_eq!(delivery.calls.load(Ordering::SeqCst), 1);
        let result = delivery.result.lock().unwrap().clone().unwrap();
        assert_eq!(result.key_id(), "key-1");
        assert_eq!(result.bytes(), b"signed-result");
        assert_eq!(result.sha256(), &sha256(b"signed-result"));
    }

    #[tokio::test]
    async fn unconfigured_signed_result_boundary_fails_closed() {
        let boundary = SignedResultBoundary::new(
            Arc::new(UnconfiguredProductionResultSigner),
            Arc::new(UnconfiguredProductionResultDelivery),
        );

        assert_eq!(
            boundary
                .accept(VerifiedTlsnEvidence::from_verifier(
                    sha256(b"request"),
                    sha256(b"response"),
                    VerifiedMemberId::from_verifier("16189463".to_owned()).unwrap(),
                ))
                .await,
            Err(ResultBoundaryError::SigningUnavailable)
        );
    }
}
