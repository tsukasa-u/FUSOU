use crate::{
    experimental_tlsn::{
        sha256, AttestationBinding, BindingError, BindingFuture, BindingRequestContext,
        ProofContinuation, ProofContinuationError, SerializedOriginRequest, TlsnOriginCapture,
        TlsnOriginExchange, TlsnOriginResponse, TlsnTransportError, VerificationError,
        VerificationFuture, VerificationOutcome, VerifiedMemberId, VerifiedTlsnEvidence,
    },
    production_tlsn::{
        Alpha15OriginTransportFactory, OriginTransportConfig, PresentationHandoff,
        PresentationVerificationInput, ProductionResultSigner, ResultSignerError,
        ResultSignerFuture, SignedTlsnResult, TlsnPresentation, TlsnVerificationBackend,
    },
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Utc};
use fusou_auth::{AuthManager, DeviceKey, FileStorage};
use fusou_tlsn_verifier::{
    parse_binding_value, parse_require_info_request, prover_transport::ProverOwnedTlsTransport,
    ParserLimits, REQUIRE_INFO_TARGET,
};
use futures::io::{AsyncReadExt, AsyncWriteExt};
use http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use hyper::body::Bytes;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    future::IntoFuture,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tlsn::{
    attestation::{
        request::{Request as AttestationRequest, RequestConfig},
        Attestation, CryptoProvider,
    },
    config::{
        prove::ProveConfig, prover::ProverConfig, tls::TlsClientConfig,
        tls_commit::mpc::MpcTlsConfig,
    },
    connection::{DnsName, HandshakeData, ServerName},
    prover::ProverOutput,
    transcript::TranscriptCommitConfig,
    Session,
};
use tlsn_formats::http::{DefaultHttpCommitter, HttpCommit, HttpTranscript};
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncReadCompatExt;

const MAX_SENT_DATA: usize = 128 * 1024;
const MAX_RECV_DATA: usize = 4 * 1024 * 1024;
const ED25519_SPKI_PREFIX: &[u8; 12] = b"\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00";
const RESULT_SIGNING_KEY_REGISTRY_SCOPE: &str = "tlsn-result-signing-key-registry";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResultSigningKeyRegistry {
    schema_version: u8,
    scope: String,
    keys: Vec<ResultSigningKeyEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResultSigningKeyEntry {
    key_id: String,
    public_key_spki: String,
    status: String,
    not_before: String,
    not_after: Option<String>,
}

#[derive(Clone)]
pub struct ResultSignatureVerifier {
    expected_key_id: String,
    public_key: [u8; 32],
    not_before: DateTime<Utc>,
    not_after: Option<DateTime<Utc>>,
    sparse: bool,
}

impl ResultSignatureVerifier {
    pub fn new(
        public_key_spki: Vec<u8>,
        expected_key_id: String,
        registry_json: String,
    ) -> Result<Self, TlsnTransportError> {
        Self::new_with_profile(public_key_spki, expected_key_id, registry_json, false)
    }

    pub fn new_sparse(
        public_key_spki: Vec<u8>,
        expected_key_id: String,
        registry_json: String,
    ) -> Result<Self, TlsnTransportError> {
        Self::new_with_profile(public_key_spki, expected_key_id, registry_json, true)
    }

    fn new_with_profile(
        public_key_spki: Vec<u8>,
        expected_key_id: String,
        registry_json: String,
        sparse: bool,
    ) -> Result<Self, TlsnTransportError> {
        if !valid_result_key_id(&expected_key_id)
            || public_key_spki.len() != ED25519_SPKI_PREFIX.len() + 32
            || !public_key_spki.starts_with(ED25519_SPKI_PREFIX)
        {
            return Err(TlsnTransportError::Unavailable);
        }
        let registry: ResultSigningKeyRegistry =
            serde_json::from_str(&registry_json).map_err(|_| TlsnTransportError::Unavailable)?;
        if registry.schema_version != 1
            || registry.scope != RESULT_SIGNING_KEY_REGISTRY_SCOPE
            || registry.keys.is_empty()
        {
            return Err(TlsnTransportError::Unavailable);
        }
        let mut seen_key_ids = HashSet::new();
        let mut expected_entry = None;
        for entry in registry.keys {
            if !valid_result_key_id(&entry.key_id)
                || !seen_key_ids.insert(entry.key_id.clone())
                || !matches!(
                    entry.status.as_str(),
                    "ACTIVE" | "VERIFY_ONLY" | "RETIRED" | "REVOKED"
                )
            {
                return Err(TlsnTransportError::Unavailable);
            }
            let not_before = DateTime::parse_from_rfc3339(&entry.not_before)
                .map_err(|_| TlsnTransportError::Unavailable)?
                .with_timezone(&Utc);
            let not_after = entry
                .not_after
                .as_deref()
                .map(DateTime::parse_from_rfc3339)
                .transpose()
                .map_err(|_| TlsnTransportError::Unavailable)?
                .map(|value| value.with_timezone(&Utc));
            if not_after.is_some_and(|value| value <= not_before) {
                return Err(TlsnTransportError::Unavailable);
            }
            let public_key = decode_result_public_key(&entry.public_key_spki)
                .ok_or(TlsnTransportError::Unavailable)?;
            if entry.key_id == expected_key_id {
                expected_entry = Some((entry.status, public_key, not_before, not_after));
            }
        }
        let (status, registry_public_key, not_before, not_after) =
            expected_entry.ok_or(TlsnTransportError::Unavailable)?;
        let mut public_key = [0_u8; 32];
        public_key.copy_from_slice(&public_key_spki[ED25519_SPKI_PREFIX.len()..]);
        let now = Utc::now();
        if status != "ACTIVE"
            || registry_public_key != public_key
            || not_before > now
            || not_after.is_some_and(|value| value < now)
        {
            return Err(TlsnTransportError::Unavailable);
        }
        Ok(Self {
            expected_key_id,
            public_key,
            not_before,
            not_after,
            sparse,
        })
    }

    fn verify(&self, payload: &serde_json::Value) -> Result<VerifiedMemberId, VerificationError> {
        let now = Utc::now();
        if self.not_before > now || self.not_after.is_some_and(|value| value < now) {
            return Err(VerificationError::WorkerRejected);
        }
        if payload.get("signature_algorithm")
            != Some(&serde_json::Value::String("Ed25519".to_owned()))
            || payload.get("signer_key_id")
                != Some(&serde_json::Value::String(self.expected_key_id.clone()))
        {
            return Err(VerificationError::WorkerRejected);
        }
        let result = payload
            .get("result")
            .and_then(serde_json::Value::as_object)
            .ok_or(VerificationError::WorkerRejected)?;
        let result_bytes =
            serde_json::to_vec(result).map_err(|_| VerificationError::WorkerRejected)?;
        let verified_member_id = if self.sparse {
            let parsed = fusou_tlsn_verifier::sparse_result::parse_sparse_verifier_result(
                &result_bytes,
                &ParserLimits::default(),
            )
            .map_err(|_| VerificationError::WorkerRejected)?;
            let signing_bytes = parsed
                .signing_bytes()
                .map_err(|_| VerificationError::WorkerRejected)?;
            ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, &self.public_key)
                .verify(&signing_bytes, &parsed.signature)
                .map_err(|_| VerificationError::WorkerRejected)?;
            parsed.verified_member_id
        } else {
            let parsed = fusou_tlsn_verifier::parse_verifier_result(
                &result_bytes,
                &ParserLimits::default(),
            )
            .map_err(|_| VerificationError::WorkerRejected)?;
            let signing_bytes = parsed
                .signing_bytes()
                .map_err(|_| VerificationError::WorkerRejected)?;
            ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, &self.public_key)
                .verify(&signing_bytes, &parsed.signature)
                .map_err(|_| VerificationError::WorkerRejected)?;
            parsed.verified_member_id
        };
        VerifiedMemberId::from_verifier(verified_member_id)
    }
}

fn valid_result_key_id(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn decode_result_public_key(value: &str) -> Option<[u8; 32]> {
    let decoded = URL_SAFE_NO_PAD.decode(value).ok()?;
    if URL_SAFE_NO_PAD.encode(&decoded) != value
        || decoded.len() != ED25519_SPKI_PREFIX.len() + 32
        || !decoded.starts_with(ED25519_SPKI_PREFIX)
    {
        return None;
    }
    let mut public_key = [0_u8; 32];
    public_key.copy_from_slice(&decoded[ED25519_SPKI_PREFIX.len()..]);
    Some(public_key)
}

fn max_sent_data_for_request(request: &[u8]) -> Result<usize, TlsnTransportError> {
    if request.is_empty() || request.len() > MAX_SENT_DATA {
        return Err(TlsnTransportError::RequestTooLarge);
    }
    Ok(request.len())
}

pub struct RealAlpha15OriginTransportFactory {
    notary_endpoint: String,
    handoff: Arc<PresentationHandoff>,
}

pub struct RemoteSessionBindingProvider {
    endpoint: String,
    client: reqwest::Client,
    auth_manager: AuthManager<FileStorage>,
    device_key_path: PathBuf,
    session_authority_public_key: Vec<u8>,
    session_authority_key_id: String,
    state: Arc<Mutex<Option<SessionBindingContext>>>,
}

#[derive(Clone)]
pub struct SessionBindingContext {
    session_id: String,
    device_id: String,
    binding: String,
    binding_challenge: String,
    device_challenge: String,
    expires_at: String,
    session_receipt: SessionReceipt,
    device_auth_nonce: String,
    device_auth_signature: String,
}

const WORKER_POLL_INTERVAL: Duration = Duration::from_millis(500);
const WORKER_POLL_TIMEOUT: Duration = Duration::from_secs(660);

struct RemoteWorkerResult {
    presentation: TlsnPresentation,
    session: SessionBindingContext,
    device_signature: String,
    payload: serde_json::Value,
    key_id: String,
}

pub struct RemoteWorkerResultStore {
    results: Mutex<HashMap<[u8; 32], RemoteWorkerResult>>,
}

impl RemoteWorkerResultStore {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            results: Mutex::new(HashMap::new()),
        })
    }

    fn insert(
        &self,
        request_sha256: [u8; 32],
        result: RemoteWorkerResult,
    ) -> Result<(), VerificationError> {
        self.results
            .lock()
            .map_err(|_| VerificationError::WorkerUnavailable)?
            .insert(request_sha256, result);
        Ok(())
    }

    fn take(&self, request_sha256: &[u8; 32]) -> Result<RemoteWorkerResult, ResultSignerError> {
        self.results
            .lock()
            .map_err(|_| ResultSignerError::Failed)?
            .remove(request_sha256)
            .ok_or(ResultSignerError::Unavailable)
    }
}

fn worker_endpoints(endpoint: &str) -> Result<(String, String), TlsnTransportError> {
    let parsed =
        reqwest::Url::parse(endpoint.trim()).map_err(|_| TlsnTransportError::Unavailable)?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(TlsnTransportError::Unavailable);
    }
    let path = parsed.path().trim_end_matches('/');
    if path.is_empty() {
        return Err(TlsnTransportError::Unavailable);
    }
    let mut status = parsed.clone();
    status.set_path(&format!("{path}/status"));
    Ok((parsed.to_string(), status.to_string()))
}

fn worker_http_error(
    status: reqwest::StatusCode,
    payload: &serde_json::Value,
) -> VerificationError {
    if payload
        .get("error")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|error| error.starts_with("trigger_"))
    {
        return VerificationError::TriggerUnavailable;
    }
    if status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        VerificationError::WorkerUnavailable
    } else {
        VerificationError::WorkerRejected
    }
}

async fn worker_json(response: reqwest::Response) -> Result<serde_json::Value, VerificationError> {
    response
        .json()
        .await
        .map_err(|_| VerificationError::WorkerUnavailable)
}

fn queued_job_id(payload: &serde_json::Value) -> Result<String, VerificationError> {
    if payload.get("verified") != Some(&serde_json::Value::Bool(false))
        || !matches!(
            payload.get("status").and_then(serde_json::Value::as_str),
            Some("queued" | "processing")
        )
    {
        return Err(VerificationError::WorkerRejected);
    }
    let job_id = payload
        .get("job_id")
        .and_then(serde_json::Value::as_str)
        .ok_or(VerificationError::WorkerRejected)?;
    uuid::Uuid::parse_str(job_id).map_err(|_| VerificationError::WorkerRejected)?;
    Ok(job_id.to_owned())
}

fn verified_worker_payload(
    payload: serde_json::Value,
) -> Result<(serde_json::Value, String, VerifiedMemberId), VerificationError> {
    if payload.get("verified") != Some(&serde_json::Value::Bool(true)) {
        return Err(VerificationError::WorkerRejected);
    }
    let result = payload
        .get("result")
        .and_then(serde_json::Value::as_object)
        .ok_or(VerificationError::WorkerRejected)?;
    let key_id = payload
        .get("signer_key_id")
        .and_then(serde_json::Value::as_str)
        .ok_or(VerificationError::WorkerRejected)?
        .to_owned();
    let member_id = result
        .get("verified_member_id")
        .and_then(serde_json::Value::as_str)
        .ok_or(VerificationError::WorkerRejected)
        .and_then(|value| VerifiedMemberId::from_verifier(value.to_owned()))?;
    Ok((payload, key_id, member_id))
}

async fn poll_worker_result(
    client: &reqwest::Client,
    status_endpoint: &str,
    access_token: &str,
    session: &SessionBindingContext,
    job_id: &str,
    poll_interval: Duration,
    poll_timeout: Duration,
) -> Result<serde_json::Value, VerificationError> {
    tokio::time::timeout(poll_timeout, async {
        loop {
            tokio::time::sleep(poll_interval).await;
            let binding_id = URL_SAFE_NO_PAD.encode(sha256(session.binding().as_bytes()));
            let response = client
                .post(status_endpoint)
                .bearer_auth(access_token)
                .json(&serde_json::json!({
                    "job_id": job_id,
                    "session_id": session.session_id(),
                    "binding_id": binding_id,
                    "canonical_user_id": session.session_receipt.canonical_user_id.clone(),
                    "device_id": session.device_id(),
                }))
                .send()
                .await
                .map_err(|_| VerificationError::WorkerUnavailable)?;
            let status = response.status();
            let payload = worker_json(response).await?;
            if status == reqwest::StatusCode::ACCEPTED {
                if queued_job_id(&payload)? != job_id {
                    return Err(VerificationError::WorkerRejected);
                }
                continue;
            }
            if status.is_success() {
                return Ok(payload);
            }
            return Err(worker_http_error(status, &payload));
        }
    })
    .await
    .map_err(|_| VerificationError::WorkerUnavailable)?
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteWorkerResponseMode {
    Async,
    Sync,
}

impl RemoteWorkerResponseMode {
    fn parse(value: &str) -> Result<Self, TlsnTransportError> {
        match value {
            "async" => Ok(Self::Async),
            "sync" => Ok(Self::Sync),
            _ => Err(TlsnTransportError::Unavailable),
        }
    }

    fn header_value(self) -> &'static str {
        match self {
            Self::Async => "async",
            Self::Sync => "sync",
        }
    }
}

pub struct RemoteWorkerVerificationBackend {
    endpoint: String,
    status_endpoint: String,
    client: reqwest::Client,
    auth_manager: AuthManager<FileStorage>,
    device_key_path: PathBuf,
    binding_state: Arc<Mutex<Option<SessionBindingContext>>>,
    results: Arc<RemoteWorkerResultStore>,
    result_verifier: Arc<ResultSignatureVerifier>,
    response_mode: RemoteWorkerResponseMode,
}

impl RemoteWorkerVerificationBackend {
    pub fn new(
        endpoint: String,
        auth_manager: AuthManager<FileStorage>,
        device_key_path: PathBuf,
        binding_state: Arc<Mutex<Option<SessionBindingContext>>>,
        results: Arc<RemoteWorkerResultStore>,
        result_verifier: Arc<ResultSignatureVerifier>,
        response_mode: String,
    ) -> Result<Self, TlsnTransportError> {
        let (endpoint, status_endpoint) = worker_endpoints(&endpoint)?;
        let response_mode = RemoteWorkerResponseMode::parse(&response_mode)?;
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| TlsnTransportError::Unavailable)?;
        Ok(Self {
            endpoint,
            status_endpoint,
            client,
            auth_manager,
            device_key_path,
            binding_state,
            results,
            result_verifier,
            response_mode,
        })
    }
}

impl TlsnVerificationBackend for RemoteWorkerVerificationBackend {
    fn verify(&self, input: PresentationVerificationInput) -> VerificationFuture {
        let endpoint = self.endpoint.clone();
        let status_endpoint = self.status_endpoint.clone();
        let client = self.client.clone();
        let auth_manager = self.auth_manager.clone();
        let device_key_path = self.device_key_path.clone();
        let binding_state = Arc::clone(&self.binding_state);
        let results = Arc::clone(&self.results);
        let result_verifier = Arc::clone(&self.result_verifier);
        let response_mode = self.response_mode;
        Box::pin(async move {
            let (context, _request, binding, _exchange, presentation) = input.into_parts();
            let session = binding_state
                .lock()
                .map_err(|_| VerificationError::WorkerUnavailable)?
                .take()
                .ok_or(VerificationError::WorkerUnavailable)?;
            if binding.value() != session.binding() {
                return Err(VerificationError::BindingMismatch);
            }
            let device_key = DeviceKey::load_or_create(device_key_path)
                .await
                .map_err(|_| VerificationError::WorkerUnavailable)?;
            if device_key.device_id() != Some(session.device_id()) {
                return Err(VerificationError::WorkerRejected);
            }
            let access_token = auth_manager
                .get_access_token()
                .await
                .map_err(|_| VerificationError::WorkerUnavailable)?;
            let challenge = URL_SAFE_NO_PAD
                .decode(session.device_challenge())
                .map_err(|_| VerificationError::WorkerRejected)?;
            if challenge.len() != 32 {
                return Err(VerificationError::WorkerRejected);
            }
            let signing_bytes = tlsn_device_proof_signing_bytes(
                session.device_id(),
                session.session_id(),
                session.binding(),
                &challenge,
            )
            .map_err(|_| VerificationError::WorkerRejected)?;
            let device_signature = device_key.sign_b64(&signing_bytes);
            let response = client
                .post(endpoint)
                .bearer_auth(access_token.clone())
                .header("X-FUSOU-TLSN-Response-Mode", response_mode.header_value())
                .json(&serde_json::json!({
                    "presentation_base64": URL_SAFE_NO_PAD.encode(presentation.bytes()),
                    "session_id": session.session_id(),
                    "device_id": session.device_id(),
                    "binding": session.binding(),
                    "device_proof": {
                        "challenge": session.device_challenge(),
                        "sig": device_signature,
                    },
                }))
                .send()
                .await
                .map_err(|_| VerificationError::WorkerUnavailable)?;
            let status = response.status();
            let payload = worker_json(response).await?;
            let payload = if status == reqwest::StatusCode::ACCEPTED {
                let job_id = queued_job_id(&payload)?;
                poll_worker_result(
                    &client,
                    &status_endpoint,
                    &access_token,
                    &session,
                    &job_id,
                    WORKER_POLL_INTERVAL,
                    WORKER_POLL_TIMEOUT,
                )
                .await?
            } else if status.is_success() {
                payload
            } else {
                return Err(worker_http_error(status, &payload));
            };
            let (payload, key_id, _member_id) = verified_worker_payload(payload)?;
            let member_id = result_verifier.verify(&payload)?;
            let request_sha256 = *context.request_sha256();
            let response_sha256 = *context.response_sha256();
            results.insert(
                request_sha256,
                RemoteWorkerResult {
                    presentation,
                    session,
                    device_signature,
                    payload,
                    key_id,
                },
            )?;
            Ok(VerificationOutcome::Verified(
                VerifiedTlsnEvidence::from_verifier(request_sha256, response_sha256, member_id),
            ))
        })
    }
}

pub struct RemoteWorkerResultSigner {
    results: Arc<RemoteWorkerResultStore>,
    artifact_root: PathBuf,
}

impl RemoteWorkerResultSigner {
    pub fn new(results: Arc<RemoteWorkerResultStore>, artifact_root: PathBuf) -> Self {
        Self {
            results,
            artifact_root,
        }
    }
}

impl ProductionResultSigner for RemoteWorkerResultSigner {
    fn sign(&self, evidence: VerifiedTlsnEvidence) -> ResultSignerFuture {
        let results = Arc::clone(&self.results);
        let artifact_root = self.artifact_root.clone();
        Box::pin(async move {
            let result = results.take(evidence.request_sha256())?;
            let bytes =
                serde_json::to_vec(&result.payload).map_err(|_| ResultSignerError::Failed)?;
            write_production_capture_bundle(
                &artifact_root,
                &result.presentation,
                &result.session,
                &result.payload,
                &result.device_signature,
            )
            .await
            .map_err(|_| ResultSignerError::Failed)?;
            SignedTlsnResult::new(result.key_id, bytes).map_err(|_| ResultSignerError::Failed)
        })
    }
}

pub struct FilesystemResultDelivery {
    root: PathBuf,
}

impl FilesystemResultDelivery {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }
}

impl crate::production_tlsn::ProductionResultDelivery for FilesystemResultDelivery {
    fn deliver(
        &self,
        result: crate::production_tlsn::SignedTlsnResult,
    ) -> crate::production_tlsn::ResultDeliveryFuture {
        let root = self.root.clone();
        let name = hex_identifier(result.sha256());
        Box::pin(async move {
            tokio::fs::create_dir_all(&root)
                .await
                .map_err(|_| crate::production_tlsn::ResultDeliveryError::Failed)?;
            tokio::fs::write(root.join(format!("{name}.json")), result.bytes())
                .await
                .map_err(|_| crate::production_tlsn::ResultDeliveryError::Failed)
        })
    }
}

fn tlsn_device_proof_signing_bytes(
    device_id: &str,
    session_id: &str,
    binding: &str,
    challenge: &[u8],
) -> Result<Vec<u8>, ()> {
    let device_id = uuid::Uuid::parse_str(device_id).map_err(|_| ())?;
    let session_id = uuid::Uuid::parse_str(session_id).map_err(|_| ())?;
    if challenge.len() != 32 || binding.len() > u16::MAX as usize {
        return Err(());
    }
    let mut output = b"FUSOU-TLSN-DEVICE-PROOF-V1\0".to_vec();
    push_length_prefixed(
        &mut output,
        device_id.as_hyphenated().to_string().as_bytes(),
    );
    push_length_prefixed(
        &mut output,
        session_id.as_hyphenated().to_string().as_bytes(),
    );
    push_length_prefixed(&mut output, binding.as_bytes());
    push_length_prefixed(&mut output, challenge);
    Ok(output)
}

fn push_length_prefixed(output: &mut Vec<u8>, value: &[u8]) {
    output.extend_from_slice(&(value.len() as u16).to_be_bytes());
    output.extend_from_slice(value);
}

impl SessionBindingContext {
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    pub fn binding(&self) -> &str {
        &self.binding
    }

    pub fn device_challenge(&self) -> &str {
        &self.device_challenge
    }
}

async fn write_production_capture_bundle(
    artifact_root: &PathBuf,
    presentation: &crate::production_tlsn::TlsnPresentation,
    session: &SessionBindingContext,
    worker_payload: &serde_json::Value,
    device_signature: &str,
) -> Result<(), std::io::Error> {
    let directory = artifact_root.join(presentation.identifier());
    tokio::fs::create_dir_all(&directory).await?;

    let session_json = serde_json::json!({
        "session_id": session.session_id(),
        "challenge": session.binding_challenge,
        "binding": session.binding(),
        "device_id": session.device_id(),
        "device_challenge": session.device_challenge(),
        "expires_at": session.expires_at,
        "session_receipt": &session.session_receipt,
    });
    let authentication_json = serde_json::json!({
        "request": {
            "device_id": session.device_id(),
            "nonce": session.device_auth_nonce,
            "sig": session.device_auth_signature,
        },
        "worker_acceptance": {
            "status": 201,
            "device_id": session.device_id(),
            "session_id": session.session_id(),
        },
    });
    let challenge = URL_SAFE_NO_PAD
        .decode(session.device_challenge())
        .map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid device challenge")
        })?;
    let signing_bytes = tlsn_device_proof_signing_bytes(
        session.device_id(),
        session.session_id(),
        session.binding(),
        &challenge,
    )
    .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid device proof"))?;
    let digest = sha256(&signing_bytes);
    let possession_json = serde_json::json!({
        "device_id": session.device_id(),
        "session_id": session.session_id(),
        "binding_value": session.binding(),
        "challenge": session.device_challenge(),
        "sig": device_signature,
        "message_sha256": URL_SAFE_NO_PAD.encode(digest),
        "message_sha256_hex": hex_bytes(&digest),
        "replay_digest": URL_SAFE_NO_PAD.encode(digest),
        "replay_digest_hex": hex_bytes(&digest),
    });
    let result = worker_payload.get("result").ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "Worker result missing")
    })?;
    let consume_receipt = worker_payload.get("consume_receipt").ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "consume receipt missing")
    })?;
    for (name, value) in [
        ("session.json", session_json),
        ("device-authentication.json", authentication_json),
        ("possession-proof.json", possession_json),
        ("result.json", result.clone()),
        ("consume-receipt.json", consume_receipt.clone()),
        ("worker-verification.json", worker_payload.clone()),
    ] {
        tokio::fs::write(directory.join(name), serde_json::to_vec_pretty(&value)?).await?;
    }
    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
struct SessionAuthorityResponse {
    session_id: String,
    challenge: String,
    binding: String,
    device_id: String,
    device_challenge: String,
    expires_at: String,
    session_receipt: SessionReceipt,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct SessionReceipt {
    schema_version: u8,
    #[serde(rename = "type")]
    receipt_type: String,
    signer_key_id: String,
    signature_algorithm: String,
    session_id: String,
    canonical_user_id: String,
    device_id: String,
    device_auth_nonce: String,
    nonce: String,
    device_challenge: String,
    binding_value: String,
    created_at: String,
    expires_at: String,
    signature: String,
}

impl RemoteSessionBindingProvider {
    pub fn new(
        endpoint: String,
        auth_manager: AuthManager<FileStorage>,
        device_key_path: PathBuf,
        session_authority_public_key: Vec<u8>,
        session_authority_key_id: String,
    ) -> Result<Self, BindingError> {
        let parsed =
            reqwest::Url::parse(endpoint.trim()).map_err(|_| BindingError::NoBindingAuthority)?;
        if parsed.scheme() != "https" || parsed.host_str().is_none() {
            return Err(BindingError::NoBindingAuthority);
        }
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|_| BindingError::NoBindingAuthority)?;
        if session_authority_public_key.len() != 44
            || session_authority_public_key[..12]
                != *b"\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00"
            || session_authority_key_id.trim().is_empty()
        {
            return Err(BindingError::NoBindingAuthority);
        }
        Ok(Self {
            endpoint,
            client,
            auth_manager,
            device_key_path,
            session_authority_public_key,
            session_authority_key_id,
            state: Arc::new(Mutex::new(None)),
        })
    }

    pub fn state(&self) -> Arc<Mutex<Option<SessionBindingContext>>> {
        Arc::clone(&self.state)
    }
}

impl crate::experimental_tlsn::AttestationBindingProvider for RemoteSessionBindingProvider {
    fn issue_binding(&self, context: BindingRequestContext) -> BindingFuture {
        let endpoint = self.endpoint.clone();
        let client = self.client.clone();
        let auth_manager = self.auth_manager.clone();
        let device_key_path = self.device_key_path.clone();
        let session_authority_public_key = self.session_authority_public_key.clone();
        let session_authority_key_id = self.session_authority_key_id.clone();
        let state = Arc::clone(&self.state);
        Box::pin(async move {
            if context.target() != REQUIRE_INFO_TARGET {
                return Err(BindingError::InvalidBinding);
            }
            let device_key = DeviceKey::load_or_create(device_key_path)
                .await
                .map_err(|_| BindingError::NoBindingAuthority)?;
            let device_id = device_key
                .device_id()
                .ok_or(BindingError::NoBindingAuthority)?
                .to_owned();
            let mut nonce_bytes = [0_u8; 32];
            rand::thread_rng().fill_bytes(&mut nonce_bytes);
            let nonce = nonce_bytes
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            let device_auth_signature = device_key.sign_b64(nonce.as_bytes());
            let access_token = auth_manager
                .get_access_token()
                .await
                .map_err(|_| BindingError::NoBindingAuthority)?;
            let response = client
                .post(endpoint)
                .bearer_auth(access_token)
                .json(&serde_json::json!({
                    "device_id": device_id,
                    "nonce": nonce,
                    "sig": device_auth_signature,
                }))
                .send()
                .await
                .map_err(|_| BindingError::NoBindingAuthority)?;
            if response.status() != reqwest::StatusCode::CREATED {
                return Err(BindingError::NoBindingAuthority);
            }
            let authority = response
                .json::<SessionAuthorityResponse>()
                .await
                .map_err(|_| BindingError::InvalidBinding)?;
            if authority.device_id != device_id
                || authority.device_challenge.len() != 43
                || !authority
                    .device_challenge
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
                || DateTime::parse_from_rfc3339(&authority.expires_at)
                    .map(|expires_at| expires_at.with_timezone(&Utc) <= Utc::now())
                    .unwrap_or(true)
            {
                return Err(BindingError::InvalidBinding);
            }
            let session_id = uuid::Uuid::parse_str(&authority.session_id)
                .map_err(|_| BindingError::InvalidBinding)?;
            let parsed_binding = parse_binding_value(&authority.binding)
                .map_err(|_| BindingError::InvalidBinding)?;
            if parsed_binding.session_id != session_id {
                return Err(BindingError::InvalidBinding);
            }
            if authority.challenge != URL_SAFE_NO_PAD.encode(parsed_binding.binding_nonce) {
                return Err(BindingError::InvalidBinding);
            }
            verify_session_receipt(
                &authority.session_receipt,
                &authority,
                &nonce,
                &session_authority_public_key,
                &session_authority_key_id,
            )?;
            let mut state_guard = state.lock().map_err(|_| BindingError::NoBindingAuthority)?;
            if state_guard.is_some() {
                return Err(BindingError::AlreadyIssued);
            }
            *state_guard = Some(SessionBindingContext {
                session_id: authority.session_id,
                device_id,
                binding: authority.binding.clone(),
                binding_challenge: authority.challenge,
                device_challenge: authority.device_challenge,
                expires_at: authority.expires_at,
                session_receipt: authority.session_receipt,
                device_auth_nonce: nonce,
                device_auth_signature,
            });
            AttestationBinding::new(authority.binding).map_err(|_| BindingError::InvalidBinding)
        })
    }
}

fn verify_session_receipt(
    receipt: &SessionReceipt,
    authority: &SessionAuthorityResponse,
    device_auth_nonce: &str,
    public_key_spki: &[u8],
    expected_key_id: &str,
) -> Result<(), BindingError> {
    if public_key_spki.len() != 44
        || public_key_spki[..12] != *b"\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00"
    {
        return Err(BindingError::InvalidBinding);
    }
    let parsed_binding =
        parse_binding_value(&authority.binding).map_err(|_| BindingError::InvalidBinding)?;
    if receipt.schema_version != 1
        || receipt.receipt_type != "attestation-session-issued"
        || receipt.signature_algorithm != "Ed25519"
        || receipt.signer_key_id != expected_key_id
        || receipt.session_id != authority.session_id
        || receipt.device_id != authority.device_id
        || receipt.device_auth_nonce != device_auth_nonce
        || receipt.nonce != URL_SAFE_NO_PAD.encode(parsed_binding.binding_nonce)
        || receipt.nonce != authority.challenge
        || receipt.device_challenge != authority.device_challenge
        || receipt.binding_value != authority.binding
        || receipt.expires_at != authority.expires_at
        || receipt.canonical_user_id.trim().is_empty()
    {
        return Err(BindingError::InvalidBinding);
    }
    let created_at = DateTime::parse_from_rfc3339(&receipt.created_at)
        .map_err(|_| BindingError::InvalidBinding)?
        .with_timezone(&Utc);
    let expires_at = DateTime::parse_from_rfc3339(&receipt.expires_at)
        .map_err(|_| BindingError::InvalidBinding)?
        .with_timezone(&Utc);
    if created_at > Utc::now() || expires_at <= Utc::now() || created_at >= expires_at {
        return Err(BindingError::InvalidBinding);
    }
    let signature = URL_SAFE_NO_PAD
        .decode(&receipt.signature)
        .map_err(|_| BindingError::InvalidBinding)?;
    if signature.len() != 64 || URL_SAFE_NO_PAD.encode(&signature) != receipt.signature {
        return Err(BindingError::InvalidBinding);
    }
    let signing_bytes = receipt_signing_bytes(receipt)?;
    ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, &public_key_spki[12..])
        .verify(&signing_bytes, &signature)
        .map_err(|_| BindingError::InvalidBinding)
}

fn receipt_signing_bytes(receipt: &SessionReceipt) -> Result<Vec<u8>, BindingError> {
    let fields = [
        receipt.signer_key_id.as_str(),
        receipt.session_id.as_str(),
        receipt.canonical_user_id.as_str(),
        receipt.device_id.as_str(),
        receipt.device_auth_nonce.as_str(),
        receipt.nonce.as_str(),
        receipt.device_challenge.as_str(),
        receipt.binding_value.as_str(),
        receipt.created_at.as_str(),
        receipt.expires_at.as_str(),
    ];
    let mut output = b"FUSOU-ATTESTATION-SESSION-V1\0".to_vec();
    output.extend_from_slice(&[0, 1]);
    for field in fields {
        if field.len() > u16::MAX as usize {
            return Err(BindingError::InvalidBinding);
        }
        output.extend_from_slice(&(field.len() as u16).to_be_bytes());
        output.extend_from_slice(field.as_bytes());
    }
    Ok(output)
}

pub struct RealAlpha15DedicatedVerifier {
    server_identity: String,
    notary_verifying_key: Vec<u8>,
}

impl RealAlpha15DedicatedVerifier {
    pub fn new(
        server_identity: String,
        notary_verifying_key: Vec<u8>,
    ) -> Result<Self, TlsnTransportError> {
        if server_identity.trim().is_empty() || notary_verifying_key.is_empty() {
            return Err(TlsnTransportError::Unavailable);
        }
        Ok(Self {
            server_identity,
            notary_verifying_key,
        })
    }
}

impl crate::production_tlsn::TlsnVerificationBackend for RealAlpha15DedicatedVerifier {
    fn verify(
        &self,
        input: crate::production_tlsn::PresentationVerificationInput,
    ) -> crate::experimental_tlsn::VerificationFuture {
        let server_identity = self.server_identity.clone();
        let notary_verifying_key = self.notary_verifying_key.clone();
        Box::pin(async move {
            let (context, request, binding, exchange, presentation) = input.into_parts();
            if context.server_identity() != server_identity {
                return Err(crate::experimental_tlsn::VerificationError::ServerIdentityMismatch);
            }
            let transcript = fusou_tlsn_verifier::tlsn_alpha15::verify_alpha15_presentation_with_trusted_notary_key(
                presentation.bytes(),
                &notary_verifying_key,
            )
            .map_err(|_| crate::experimental_tlsn::VerificationError::PresentationInvalid)?;
            if transcript.server_identity() != server_identity
                || transcript.request_transcript_sha256()
                    != Some(context.authenticated_request_sha256())
                || transcript.response_transcript_sha256()
                    != Some(context.authenticated_response_sha256())
            {
                return Err(crate::experimental_tlsn::VerificationError::InvalidTranscript);
            }
            let profile = fusou_tlsn_verifier::tlsn_alpha15::RequireInfoDisclosureProfile::from_server_identity(
                &server_identity,
            )
            .map_err(|_| crate::experimental_tlsn::VerificationError::ServerIdentityMismatch)?;
            let verified = transcript
                .verify_require_info(&profile, &ParserLimits::default())
                .map_err(|_| crate::experimental_tlsn::VerificationError::PresentationInvalid)?;
            let expected_binding = fusou_tlsn_verifier::parse_binding_value(binding.value())
                .map_err(|_| crate::experimental_tlsn::VerificationError::BindingMismatch)?;
            if verified.binding.session_id != expected_binding.session_id
                || verified.binding.binding_nonce != expected_binding.binding_nonce
            {
                return Err(crate::experimental_tlsn::VerificationError::BindingMismatch);
            }
            let request_sha256 = sha256(request.bytes());
            let response_sha256 = sha256(&exchange.response.raw_response_bytes);
            if request_sha256 != *context.request_sha256()
                || response_sha256 != *context.response_sha256()
            {
                return Err(crate::experimental_tlsn::VerificationError::InvalidTranscript);
            }
            Ok(crate::experimental_tlsn::VerificationOutcome::Verified(
                crate::experimental_tlsn::VerifiedTlsnEvidence::from_verifier(
                    request_sha256,
                    response_sha256,
                    crate::experimental_tlsn::VerifiedMemberId::from_verifier(
                        verified.verified_member_id,
                    )?,
                ),
            ))
        })
    }
}

impl RealAlpha15OriginTransportFactory {
    pub fn new(
        notary_endpoint: String,
        handoff: Arc<PresentationHandoff>,
    ) -> Result<Self, TlsnTransportError> {
        if notary_endpoint.trim().is_empty() {
            return Err(TlsnTransportError::Unavailable);
        }
        Ok(Self {
            notary_endpoint,
            handoff,
        })
    }
}

impl Alpha15OriginTransportFactory for RealAlpha15OriginTransportFactory {
    fn send_once(
        &self,
        config: OriginTransportConfig,
        request: SerializedOriginRequest,
    ) -> crate::experimental_tlsn::TlsnTransportFuture {
        let notary_endpoint = self.notary_endpoint.clone();
        let handoff = Arc::clone(&self.handoff);
        Box::pin(async move { run_real_exchange(config, request, notary_endpoint, handoff).await })
    }
}

async fn run_real_exchange(
    config: OriginTransportConfig,
    request: SerializedOriginRequest,
    notary_endpoint: String,
    handoff: Arc<PresentationHandoff>,
) -> Result<TlsnOriginCapture, TlsnTransportError> {
    let parsed_request = parse_require_info_request(
        request.bytes(),
        config.target().server_identity(),
        &ParserLimits::default(),
    )
    .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    let max_sent_data = max_sent_data_for_request(request.bytes())?;

    let origin_socket = TcpStream::connect((config.target().hostname(), config.target().port()))
        .await
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    let notary_socket = TcpStream::connect(&notary_endpoint)
        .await
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;

    let session = Session::new(notary_socket.compat());
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);
    let prover = handle
        .new_prover(
            ProverConfig::builder()
                .build()
                .map_err(|_| TlsnTransportError::OriginConnectionFailed)?,
        )
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?
        .commit(
            MpcTlsConfig::builder()
                .max_sent_data(max_sent_data)
                .max_recv_data(MAX_RECV_DATA)
                .build()
                .map_err(|_| TlsnTransportError::OriginConnectionFailed)?,
        )
        .await
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;

    let server_name = DnsName::try_from(config.target().server_identity())
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    let root_store = tlsn::webpki::RootCertStore {
        roots: config
            .tls()
            .trusted_root_certificates()
            .iter()
            .cloned()
            .map(tlsn::webpki::CertificateDer)
            .collect(),
    };
    let (connection, prover) = prover
        .connect(
            TlsClientConfig::builder()
                .server_name(ServerName::Dns(server_name))
                .root_store(root_store)
                .build()
                .map_err(|_| TlsnTransportError::OriginConnectionFailed)?,
            origin_socket.compat(),
        )
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    let prover_task = tokio::spawn(prover.into_future());
    let mut transport = ProverOwnedTlsTransport::new(connection);
    transport
        .send_actual_require_info(
            request.bytes(),
            config.target().server_identity(),
            &parsed_request.binding,
        )
        .await
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    let raw_response = transport
        .read_response_to_end()
        .await
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    let response = parse_http_response(raw_response)?;
    let server_identity = config.target().server_identity().to_owned();
    let request_sha256 = sha256(request.bytes());
    let response_sha256 = sha256(&response.raw_response_bytes);
    let browser_exchange = TlsnOriginExchange {
        response: TlsnOriginResponse::new(
            response.status,
            response.headers,
            response.body,
            response.raw_response_bytes,
        ),
        transcript: crate::experimental_tlsn::UnverifiedTlsnTranscript {
            request_sha256,
            response_sha256,
        },
    };
    let proof = ProofContinuation::new(Box::pin(async move {
        transport
            .close()
            .await
            .map_err(|_| ProofContinuationError::ProverFinalization)?;

        let mut prover = prover_task
            .await
            .map_err(|_| ProofContinuationError::ProverFinalization)?
            .map_err(|_| ProofContinuationError::ProverFinalization)?;
        let transcript_commit = {
            let transcript = HttpTranscript::parse(prover.transcript())
                .map_err(|_| ProofContinuationError::TranscriptCommit)?;
            let mut commit_builder = TranscriptCommitConfig::builder(prover.transcript());
            DefaultHttpCommitter::default()
                .commit_transcript(&mut commit_builder, &transcript)
                .map_err(|_| ProofContinuationError::TranscriptCommit)?;
            commit_builder
                .build()
                .map_err(|_| ProofContinuationError::TranscriptCommit)?
        };

        let mut request_config_builder = RequestConfig::builder();
        request_config_builder.transcript_commit(transcript_commit.clone());
        let request_config = request_config_builder
            .build()
            .map_err(|_| ProofContinuationError::AttestationRequest)?;
        let mut prove_builder = ProveConfig::builder(prover.transcript());
        prove_builder
            .transcript_commit(transcript_commit)
            .server_identity();
        let sent_len = prover.transcript().sent().len();
        let received_len = prover.transcript().received().len();
        prove_builder
            .reveal_sent(0..sent_len)
            .map_err(|_| ProofContinuationError::Prove)?;
        prove_builder
            .reveal_recv(0..received_len)
            .map_err(|_| ProofContinuationError::Prove)?;
        let prove_config = prove_builder
            .build()
            .map_err(|_| ProofContinuationError::Prove)?;
        let ProverOutput {
            transcript_commitments,
            transcript_secrets,
            ..
        } = prover
            .prove(&prove_config)
            .await
            .map_err(|_| ProofContinuationError::Prove)?;
        let prover_transcript = prover.transcript().clone();
        let tls_transcript = prover.tls_transcript().clone();
        let handshake_data = HandshakeData {
            certs: tls_transcript
                .server_cert_chain()
                .ok_or(ProofContinuationError::AttestationRequest)?
                .to_vec(),
            sig: tls_transcript
                .server_signature()
                .ok_or(ProofContinuationError::AttestationRequest)?
                .clone(),
            binding: tls_transcript.certificate_binding().clone(),
        };
        let mut attestation_builder = AttestationRequest::builder(&request_config);
        attestation_builder
            .server_name(ServerName::Dns(
                DnsName::try_from(server_identity.as_str())
                    .map_err(|_| ProofContinuationError::AttestationRequest)?,
            ))
            .handshake_data(handshake_data)
            .transcript(prover_transcript)
            .transcript_commitments(transcript_secrets, transcript_commitments);
        let (attestation_request, secrets) = attestation_builder
            .build(&CryptoProvider::default())
            .map_err(|_| ProofContinuationError::AttestationRequest)?;
        prover
            .close()
            .await
            .map_err(|_| ProofContinuationError::ProverFinalization)?;

        handle.close();
        let mut notary_socket = driver_task
            .await
            .map_err(|_| ProofContinuationError::Notary)?
            .map_err(|_| ProofContinuationError::Notary)?;
        let request_bytes =
            bincode::serialize(&attestation_request).map_err(|_| ProofContinuationError::Notary)?;
        notary_socket
            .write_all(&request_bytes)
            .await
            .map_err(|_| ProofContinuationError::Notary)?;
        notary_socket
            .close()
            .await
            .map_err(|_| ProofContinuationError::Notary)?;
        let mut attestation_bytes = Vec::new();
        notary_socket
            .read_to_end(&mut attestation_bytes)
            .await
            .map_err(|_| ProofContinuationError::Notary)?;
        let attestation: Attestation =
            bincode::deserialize(&attestation_bytes).map_err(|_| ProofContinuationError::Notary)?;
        attestation_request
            .validate(&attestation, &CryptoProvider::default())
            .map_err(|_| ProofContinuationError::AttestationValidation)?;
        let presentation = build_presentation(&attestation, &secrets)
            .map_err(|_| ProofContinuationError::Presentation)?;
        let presentation_bytes =
            bincode::serialize(&presentation).map_err(|_| ProofContinuationError::Presentation)?;
        handoff
            .publish(
                request_sha256,
                hex_identifier(&presentation_bytes),
                presentation_bytes,
            )
            .map_err(|_| ProofContinuationError::Presentation)?;
        Ok(())
    }));

    Ok(TlsnOriginCapture {
        exchange: browser_exchange,
        proof,
    })
}

fn build_presentation(
    attestation: &Attestation,
    secrets: &tlsn::attestation::Secrets,
) -> Result<tlsn::attestation::presentation::Presentation, TlsnTransportError> {
    let mut builder = secrets.transcript_proof_builder();
    builder
        .reveal_sent(0..secrets.transcript().sent().len())
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    builder
        .reveal_recv(0..secrets.transcript().received().len())
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    let transcript_proof = builder
        .build()
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    let provider = CryptoProvider::default();
    let mut presentation_builder = attestation.presentation_builder(&provider);
    presentation_builder.identity_proof(secrets.identity_proof());
    presentation_builder.transcript_proof(transcript_proof);
    presentation_builder
        .build()
        .map_err(|_| TlsnTransportError::ResponseReadFailed)
}

struct ParsedHttpResponse {
    status: StatusCode,
    headers: HeaderMap,
    body: Bytes,
    raw_response_bytes: Bytes,
}

fn parse_http_response(raw: Vec<u8>) -> Result<ParsedHttpResponse, TlsnTransportError> {
    let raw = Bytes::from(raw);
    let header_end = raw
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or(TlsnTransportError::ResponseReadFailed)?;
    let head = &raw[..header_end];
    let body = raw.slice(header_end + 4..);
    let mut lines = head.split(|byte| *byte == b'\r' || *byte == b'\n');
    let status_line = lines.next().ok_or(TlsnTransportError::ResponseReadFailed)?;
    let mut status_fields = status_line.splitn(3, |byte| *byte == b' ');
    if status_fields.next() != Some(b"HTTP/1.1".as_slice()) {
        return Err(TlsnTransportError::ResponseReadFailed);
    }
    let status_code = status_fields
        .next()
        .and_then(|value| std::str::from_utf8(value).ok())
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or(TlsnTransportError::ResponseReadFailed)?;
    let mut headers = HeaderMap::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let separator = line
            .iter()
            .position(|byte| *byte == b':')
            .ok_or(TlsnTransportError::ResponseReadFailed)?;
        let (name, value) = line.split_at(separator);
        let value = &value[1..];
        let name =
            HeaderName::from_bytes(name).map_err(|_| TlsnTransportError::ResponseReadFailed)?;
        let value = HeaderValue::from_bytes(value.strip_prefix(b" ").unwrap_or(value))
            .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
        headers.append(name, value);
    }
    if let Some(content_length) = headers.get(http::header::CONTENT_LENGTH) {
        let expected = content_length
            .to_str()
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .ok_or(TlsnTransportError::ResponseReadFailed)?;
        if expected != body.len() {
            return Err(TlsnTransportError::ResponseReadFailed);
        }
    }
    Ok(ParsedHttpResponse {
        status: StatusCode::from_u16(status_code)
            .map_err(|_| TlsnTransportError::ResponseReadFailed)?,
        headers,
        body,
        raw_response_bytes: raw,
    })
}

fn hex_identifier(bytes: &[u8]) -> String {
    let digest = sha256(bytes);
    hex_bytes(&digest)
}

fn hex_bytes(bytes: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        experimental_tlsn::ExperimentalVerifierBoundary,
        production_tlsn::{
            HandoffPresentationProvider, OriginTarget, PresentationVerifierBoundary,
            RuntimeIdentifiers,
        },
    };
    use ring::signature::{Ed25519KeyPair, KeyPair};
    use warp::Filter;

    fn test_session_context() -> SessionBindingContext {
        SessionBindingContext {
            session_id: "550e8400-e29b-41d4-a716-446655440000".to_owned(),
            device_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7".to_owned(),
            binding: "binding-value".to_owned(),
            binding_challenge: URL_SAFE_NO_PAD.encode([7_u8; 32]),
            device_challenge: URL_SAFE_NO_PAD.encode([9_u8; 32]),
            expires_at: (Utc::now() + chrono::Duration::minutes(5)).to_rfc3339(),
            session_receipt: SessionReceipt {
                schema_version: 1,
                receipt_type: "attestation-session-issued".to_owned(),
                signer_key_id: "session-authority-2026".to_owned(),
                signature_algorithm: "Ed25519".to_owned(),
                session_id: "550e8400-e29b-41d4-a716-446655440000".to_owned(),
                canonical_user_id: "11111111-1111-4111-8111-111111111111".to_owned(),
                device_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7".to_owned(),
                device_auth_nonce: "a".repeat(64),
                nonce: URL_SAFE_NO_PAD.encode([7_u8; 32]),
                device_challenge: URL_SAFE_NO_PAD.encode([9_u8; 32]),
                binding_value: "binding-value".to_owned(),
                created_at: Utc::now().to_rfc3339(),
                expires_at: (Utc::now() + chrono::Duration::minutes(5)).to_rfc3339(),
                signature: URL_SAFE_NO_PAD.encode([3_u8; 64]),
            },
            device_auth_nonce: "a".repeat(64),
            device_auth_signature: URL_SAFE_NO_PAD.encode([4_u8; 64]),
        }
    }

    fn test_auth_manager(path: PathBuf) -> AuthManager<FileStorage> {
        AuthManager::new(
            fusou_auth::manager::AuthConfig {
                supabase_url: "http://unused.invalid".to_owned(),
                api_key: "unused".to_owned(),
                refresh_path: "/auth/v1/token".to_owned(),
                refresh_margin_secs: 30,
            },
            Arc::new(FileStorage::new(path)),
        )
    }

    fn test_result_signature_verifier() -> Arc<ResultSignatureVerifier> {
        let mut public_key_spki = ED25519_SPKI_PREFIX.to_vec();
        public_key_spki.extend_from_slice(&[11_u8; 32]);
        let public_key_spki_base64 = URL_SAFE_NO_PAD.encode(&public_key_spki);
        let registry = serde_json::json!({
            "schema_version": 1,
            "scope": RESULT_SIGNING_KEY_REGISTRY_SCOPE,
            "keys": [{
                "key_id": "result-signer-2026",
                "public_key_spki": public_key_spki_base64,
                "status": "ACTIVE",
                "not_before": "2020-01-01T00:00:00.000Z",
                "not_after": null,
            }],
        });
        Arc::new(
            ResultSignatureVerifier::new(
                public_key_spki,
                "result-signer-2026".to_owned(),
                registry.to_string(),
            )
            .unwrap(),
        )
    }

    fn result_registry(
        public_key_spki: &[u8],
        status: &str,
        not_before: &str,
        not_after: Option<&str>,
    ) -> String {
        serde_json::json!({
            "schema_version": 1,
            "scope": RESULT_SIGNING_KEY_REGISTRY_SCOPE,
            "keys": [{
                "key_id": "result-signer-2026",
                "public_key_spki": URL_SAFE_NO_PAD.encode(public_key_spki),
                "status": status,
                "not_before": not_before,
                "not_after": not_after,
            }],
        })
        .to_string()
    }

    fn signed_result_payload() -> (serde_json::Value, Vec<u8>) {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[11_u8; 32]).unwrap();
        let session_id = uuid::Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000").unwrap();
        let binding_nonce = [0x42_u8; 32];
        let mut binding_bytes = Vec::new();
        binding_bytes.extend_from_slice(fusou_tlsn_verifier::BINDING_PREFIX);
        binding_bytes.extend_from_slice(&16_u16.to_be_bytes());
        binding_bytes.extend_from_slice(session_id.as_bytes());
        binding_bytes.extend_from_slice(&32_u16.to_be_bytes());
        binding_bytes.extend_from_slice(&binding_nonce);
        let response = b"HTTP/1.1 200 OK\r\n\r\n";
        let mut result = fusou_tlsn_verifier::VerifierResult {
            version: 1,
            profile_id: fusou_tlsn_verifier::PROFILE_ID.to_owned(),
            profile_sha256: [1_u8; 32],
            issuer: fusou_tlsn_verifier::ISSUER.to_owned(),
            proof_purpose: fusou_tlsn_verifier::PROOF_PURPOSE.to_owned(),
            canonical_user_id: "11111111-1111-4111-8111-111111111111".to_owned(),
            canonical_device_id: "22222222-2222-4222-8222-222222222222".to_owned(),
            device_challenge: [6_u8; 32],
            verified_member_id: "16189463".to_owned(),
            attestation_session_id: session_id,
            binding_nonce,
            binding_value: URL_SAFE_NO_PAD.encode(binding_bytes),
            verifier_key_id: "verifier-test".to_owned(),
            notary_key_id: "notary-test".to_owned(),
            tlsn_attestation_id: vec![2_u8; 16],
            server_identity: "game.example.test".to_owned(),
            request_transcript_size: 4,
            request_transcript_sha256: [3_u8; 32],
            response_transcript_size: response.len() as u64,
            response_transcript_sha256: [4_u8; 32],
            revealed_request_ranges: vec![fusou_tlsn_verifier::RevealedRange {
                start: 0,
                length: 4,
                bytes: b"POST".to_vec(),
            }],
            revealed_response_ranges: vec![fusou_tlsn_verifier::RevealedRange {
                start: 0,
                length: response.len() as u64,
                bytes: response.to_vec(),
            }],
            signature: [0_u8; 64],
        };
        let signing_bytes = result.signing_bytes().unwrap();
        result
            .signature
            .copy_from_slice(key_pair.sign(&signing_bytes).as_ref());
        let result_json: serde_json::Value =
            serde_json::from_str(&result.canonical_json().unwrap()).unwrap();
        let payload = serde_json::json!({
            "verified": true,
            "result": result_json,
            "signer_key_id": "result-signer-2026",
            "signature_algorithm": "Ed25519",
        });
        let mut public_key_spki = ED25519_SPKI_PREFIX.to_vec();
        public_key_spki.extend_from_slice(key_pair.public_key().as_ref());
        (payload, public_key_spki)
    }

    #[test]
    fn result_signature_verifier_accepts_valid_signed_result() {
        let (payload, public_key_spki) = signed_result_payload();
        let verifier = ResultSignatureVerifier::new(
            public_key_spki.clone(),
            "result-signer-2026".to_owned(),
            result_registry(&public_key_spki, "ACTIVE", "2020-01-01T00:00:00.000Z", None),
        )
        .unwrap();
        assert!(verifier.verify(&payload).is_ok());
    }

    #[test]
    fn result_signature_verifier_rejects_mutated_result_and_signature() {
        let (payload, public_key_spki) = signed_result_payload();
        let verifier = ResultSignatureVerifier::new(
            public_key_spki.clone(),
            "result-signer-2026".to_owned(),
            result_registry(&public_key_spki, "ACTIVE", "2020-01-01T00:00:00.000Z", None),
        )
        .unwrap();

        let mut mutated_result = payload.clone();
        mutated_result["result"]["verified_member_id"] =
            serde_json::Value::String("16189464".to_owned());
        assert!(verifier.verify(&mutated_result).is_err());

        let mut mutated_signature = payload;
        let signature = mutated_signature["result"]["signature"].as_str().unwrap();
        let mut signature_bytes = URL_SAFE_NO_PAD.decode(signature).unwrap();
        signature_bytes[0] ^= 1;
        mutated_signature["result"]["signature"] =
            serde_json::Value::String(URL_SAFE_NO_PAD.encode(signature_bytes));
        assert!(verifier.verify(&mutated_signature).is_err());
    }

    #[test]
    fn result_signature_verifier_rejects_wrong_outer_identity_and_key() {
        let (payload, public_key_spki) = signed_result_payload();
        let wrong_key_pair = Ed25519KeyPair::from_seed_unchecked(&[12_u8; 32]).unwrap();
        let mut wrong_public_key_spki = ED25519_SPKI_PREFIX.to_vec();
        wrong_public_key_spki.extend_from_slice(wrong_key_pair.public_key().as_ref());
        let verifier = ResultSignatureVerifier::new(
            wrong_public_key_spki.clone(),
            "result-signer-2026".to_owned(),
            result_registry(
                &wrong_public_key_spki,
                "ACTIVE",
                "2020-01-01T00:00:00.000Z",
                None,
            ),
        )
        .unwrap();
        assert!(verifier.verify(&payload).is_err());

        let mut unknown_signer = payload.clone();
        unknown_signer["signer_key_id"] = serde_json::Value::String("unknown-signer".to_owned());
        let expected_verifier = ResultSignatureVerifier::new(
            public_key_spki.clone(),
            "result-signer-2026".to_owned(),
            result_registry(&public_key_spki, "ACTIVE", "2020-01-01T00:00:00.000Z", None),
        )
        .unwrap();
        assert!(expected_verifier.verify(&unknown_signer).is_err());

        let mut wrong_algorithm = payload;
        wrong_algorithm["signature_algorithm"] = serde_json::Value::String("Ed25519ph".to_owned());
        assert!(expected_verifier.verify(&wrong_algorithm).is_err());
    }

    #[test]
    fn result_signature_verifier_rejects_invalid_current_registry_key() {
        let (_, public_key_spki) = signed_result_payload();
        for (status, not_before, not_after) in [
            ("REVOKED", "2020-01-01T00:00:00.000Z", None),
            ("RETIRED", "2020-01-01T00:00:00.000Z", None),
            ("ACTIVE", "2099-01-01T00:00:00.000Z", None),
            (
                "ACTIVE",
                "2020-01-01T00:00:00.000Z",
                Some("2020-01-02T00:00:00.000Z"),
            ),
        ] {
            assert!(ResultSignatureVerifier::new(
                public_key_spki.clone(),
                "result-signer-2026".to_owned(),
                result_registry(&public_key_spki, status, not_before, not_after),
            )
            .is_err());
        }
        assert!(ResultSignatureVerifier::new(
            public_key_spki,
            "result-signer-2026".to_owned(),
            "{}".to_owned(),
        )
        .is_err());
    }

    async fn verify_with_local_state(
        session: SessionBindingContext,
        binding: &str,
        device_key_path: PathBuf,
    ) -> Result<VerificationOutcome, VerificationError> {
        let request = SerializedOriginRequest::new(Bytes::from_static(b"request")).unwrap();
        let response_bytes = Bytes::from_static(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
        let exchange = TlsnOriginExchange {
            response: TlsnOriginResponse::new(
                StatusCode::OK,
                HeaderMap::new(),
                Bytes::new(),
                response_bytes.clone(),
            ),
            transcript: crate::experimental_tlsn::UnverifiedTlsnTranscript {
                request_sha256: sha256(request.bytes()),
                response_sha256: sha256(&response_bytes),
            },
        };
        let handoff = PresentationHandoff::new();
        handoff
            .publish(
                exchange.transcript.request_sha256,
                "test-presentation".to_owned(),
                vec![1],
            )
            .unwrap();
        let backend = Arc::new(RemoteWorkerVerificationBackend {
            endpoint: "http://127.0.0.1:1/verify/tlsn".to_owned(),
            status_endpoint: "http://127.0.0.1:1/verify/tlsn/status".to_owned(),
            client: reqwest::Client::new(),
            auth_manager: test_auth_manager(std::env::temp_dir().join(format!(
                "fusou-tlsn-unused-session-{}.json",
                uuid::Uuid::new_v4()
            ))),
            device_key_path,
            binding_state: Arc::new(Mutex::new(Some(session))),
            results: RemoteWorkerResultStore::new(),
            result_verifier: test_result_signature_verifier(),
            response_mode: RemoteWorkerResponseMode::Async,
        });
        let boundary = PresentationVerifierBoundary::new(
            Arc::new(HandoffPresentationProvider::new(handoff)),
            backend,
            OriginTarget::new(
                "game.example.test".to_owned(),
                443,
                "game.example.test".to_owned(),
            )
            .unwrap(),
            RuntimeIdentifiers::default(),
        );
        boundary
            .verify(
                1,
                request,
                AttestationBinding::new(binding.to_owned()).unwrap(),
                exchange,
            )
            .await
    }

    #[tokio::test]
    async fn remote_worker_rejects_binding_mismatch_before_network_io() {
        let result = verify_with_local_state(
            test_session_context(),
            "different-binding",
            std::env::temp_dir().join(format!(
                "fusou-tlsn-unused-device-key-{}.json",
                uuid::Uuid::new_v4()
            )),
        )
        .await;
        assert_eq!(result, Err(VerificationError::BindingMismatch));
    }

    #[tokio::test]
    async fn remote_worker_rejects_local_device_mismatch_before_network_io() {
        let directory = std::env::temp_dir().join(format!(
            "fusou-tlsn-device-mismatch-{}",
            uuid::Uuid::new_v4()
        ));
        let device_key_path = directory.join("device-key.json");
        let mut device_key = DeviceKey::load_or_create(device_key_path.clone())
            .await
            .unwrap();
        device_key
            .set_device_id("11111111-1111-4111-8111-111111111111".to_owned())
            .await
            .unwrap();
        let result =
            verify_with_local_state(test_session_context(), "binding-value", device_key_path).await;
        let _ = tokio::fs::remove_dir_all(directory).await;
        assert_eq!(result, Err(VerificationError::WorkerRejected));
    }

    #[test]
    fn max_sent_data_matches_request_length() {
        let request = vec![0_u8; 99];
        assert_eq!(max_sent_data_for_request(&request), Ok(99));
    }

    #[test]
    fn max_sent_data_accepts_exact_absolute_capacity() {
        let request = vec![0_u8; MAX_SENT_DATA];
        assert_eq!(max_sent_data_for_request(&request), Ok(MAX_SENT_DATA));
    }

    #[test]
    fn max_sent_data_rejects_empty_requests() {
        assert_eq!(
            max_sent_data_for_request(&[]),
            Err(TlsnTransportError::RequestTooLarge)
        );
    }

    #[test]
    fn max_sent_data_rejects_requests_over_absolute_capacity() {
        let request = vec![0_u8; MAX_SENT_DATA + 1];
        assert_eq!(
            max_sent_data_for_request(&request),
            Err(TlsnTransportError::RequestTooLarge)
        );
    }

    #[test]
    fn tlsn_device_proof_frames_challenge_with_length() {
        let bytes = tlsn_device_proof_signing_bytes(
            "550e8400-e29b-41d4-a716-446655440000",
            "7c9e6679-7425-40de-944b-e07fc1f90ae7",
            "binding-value",
            &[0x2a; 32],
        )
        .unwrap();
        let prefix_len = b"FUSOU-TLSN-DEVICE-PROOF-V1\0".len();
        assert_eq!(&bytes[prefix_len..prefix_len + 2], &[0, 36]);
        assert_eq!(&bytes[prefix_len + 38..prefix_len + 40], &[0, 36]);
        assert_eq!(&bytes[bytes.len() - 34..bytes.len() - 32], &[0, 32]);
        assert_eq!(&bytes[bytes.len() - 32..], &[0x2a; 32]);
    }

    #[test]
    fn session_receipt_verification_matches_worker_contract() {
        let session_id = "550e8400-e29b-41d4-a716-446655440000";
        let device_id = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
        let binding_nonce = [7_u8; 32];
        let mut binding_bytes = b"FUSOU-ATTESTATION-BINDING-V1\0".to_vec();
        binding_bytes.extend_from_slice(&16_u16.to_be_bytes());
        binding_bytes.extend_from_slice(&uuid::Uuid::parse_str(session_id).unwrap().into_bytes());
        binding_bytes.extend_from_slice(&32_u16.to_be_bytes());
        binding_bytes.extend_from_slice(&binding_nonce);
        let binding = URL_SAFE_NO_PAD.encode(binding_bytes);
        let now = Utc::now();
        let created_at = now.to_rfc3339();
        let expires_at = (now + chrono::Duration::minutes(5)).to_rfc3339();
        let mut receipt = SessionReceipt {
            schema_version: 1,
            receipt_type: "attestation-session-issued".to_owned(),
            signer_key_id: "session-authority-2026".to_owned(),
            signature_algorithm: "Ed25519".to_owned(),
            session_id: session_id.to_owned(),
            canonical_user_id: "user-123".to_owned(),
            device_id: device_id.to_owned(),
            device_auth_nonce: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                .to_owned(),
            nonce: URL_SAFE_NO_PAD.encode(binding_nonce),
            device_challenge: URL_SAFE_NO_PAD.encode([9_u8; 32]),
            binding_value: binding.clone(),
            created_at,
            expires_at,
            signature: String::new(),
        };
        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[3_u8; 32]).unwrap();
        receipt.signature =
            URL_SAFE_NO_PAD.encode(key_pair.sign(&receipt_signing_bytes(&receipt).unwrap()));
        let authority = SessionAuthorityResponse {
            session_id: session_id.to_owned(),
            challenge: receipt.nonce.clone(),
            binding,
            device_id: device_id.to_owned(),
            device_challenge: receipt.device_challenge.clone(),
            expires_at: receipt.expires_at.clone(),
            session_receipt: SessionReceipt {
                schema_version: receipt.schema_version,
                receipt_type: receipt.receipt_type.clone(),
                signer_key_id: receipt.signer_key_id.clone(),
                signature_algorithm: receipt.signature_algorithm.clone(),
                session_id: receipt.session_id.clone(),
                canonical_user_id: receipt.canonical_user_id.clone(),
                device_id: receipt.device_id.clone(),
                device_auth_nonce: receipt.device_auth_nonce.clone(),
                nonce: receipt.nonce.clone(),
                device_challenge: receipt.device_challenge.clone(),
                binding_value: receipt.binding_value.clone(),
                created_at: receipt.created_at.clone(),
                expires_at: receipt.expires_at.clone(),
                signature: receipt.signature.clone(),
            },
        };
        let mut public_key_spki = b"\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00".to_vec();
        public_key_spki.extend_from_slice(key_pair.public_key().as_ref());
        verify_session_receipt(
            &authority.session_receipt,
            &authority,
            &receipt.device_auth_nonce,
            &public_key_spki,
            "session-authority-2026",
        )
        .unwrap();

        let mut mutated_receipt = authority.session_receipt.clone();
        mutated_receipt.binding_value.push('A');
        assert!(verify_session_receipt(
            &mutated_receipt,
            &authority,
            &receipt.device_auth_nonce,
            &public_key_spki,
            "session-authority-2026",
        )
        .is_err());
    }

    #[test]
    fn worker_endpoint_derives_status_path_without_query_or_fragment() {
        assert_eq!(
            worker_endpoints("https://worker.example.test/verify/tlsn").unwrap(),
            (
                "https://worker.example.test/verify/tlsn".to_owned(),
                "https://worker.example.test/verify/tlsn/status".to_owned(),
            )
        );
        assert!(worker_endpoints("not a URL").is_err());
        assert!(worker_endpoints("http://worker.example.test/verify/tlsn").is_err());
        assert!(worker_endpoints("https://user@worker.example.test/verify/tlsn").is_err());
        assert!(worker_endpoints("https://worker.example.test/verify/tlsn?x=1").is_err());
        assert!(worker_endpoints("https://worker.example.test/verify/tlsn#fragment").is_err());
    }

    #[test]
    fn worker_http_statuses_preserve_retry_and_trigger_boundaries() {
        assert_eq!(
            worker_http_error(
                reqwest::StatusCode::INTERNAL_SERVER_ERROR,
                &serde_json::json!({})
            ),
            VerificationError::WorkerUnavailable
        );
        assert_eq!(
            worker_http_error(
                reqwest::StatusCode::TOO_MANY_REQUESTS,
                &serde_json::json!({})
            ),
            VerificationError::WorkerUnavailable
        );
        assert_eq!(
            worker_http_error(reqwest::StatusCode::BAD_REQUEST, &serde_json::json!({})),
            VerificationError::WorkerRejected
        );
        assert_eq!(
            worker_http_error(
                reqwest::StatusCode::SERVICE_UNAVAILABLE,
                &serde_json::json!({ "error": "trigger_enqueue_failed" }),
            ),
            VerificationError::TriggerUnavailable
        );
        assert_eq!(
            worker_http_error(
                reqwest::StatusCode::SERVICE_UNAVAILABLE,
                &serde_json::json!({ "error": "trigger_unavailable" }),
            ),
            VerificationError::TriggerUnavailable
        );
    }

    #[tokio::test]
    async fn worker_poll_timeout_is_reported_as_unavailable() {
        let job_id = "550e8400-e29b-41d4-a716-446655440000";
        let route = warp::post().map(move || {
            warp::reply::with_status(
                warp::reply::json(&serde_json::json!({
                    "verified": false,
                    "status": "processing",
                    "job_id": job_id,
                })),
                warp::http::StatusCode::ACCEPTED,
            )
        });
        let (address, server) = warp::serve(route).bind_ephemeral(([127, 0, 0, 1], 0));
        let server = tokio::spawn(server);
        let result = poll_worker_result(
            &reqwest::Client::new(),
            &format!("http://{address}/verify/tlsn/status"),
            "test-token",
            &test_session_context(),
            job_id,
            Duration::from_millis(1),
            Duration::from_millis(20),
        )
        .await;
        server.abort();
        assert_eq!(result, Err(VerificationError::WorkerUnavailable));
    }

    #[test]
    fn queued_worker_payload_requires_uuid_and_pending_status() {
        let job_id = "550e8400-e29b-41d4-a716-446655440000";
        let payload = serde_json::json!({
            "verified": false,
            "status": "queued",
            "job_id": job_id,
        });
        assert_eq!(queued_job_id(&payload).unwrap(), job_id);
        assert!(queued_job_id(&serde_json::json!({
            "verified": false,
            "status": "queued",
            "job_id": "job-1",
        }))
        .is_err());
    }

    #[test]
    fn worker_final_payload_requires_signed_canonical_member_result() {
        let payload = serde_json::json!({
            "verified": true,
            "signer_key_id": "result-signer-2026",
            "result": {
                "verified_member_id": "16189463",
            },
        });
        let (_, key_id, member_id) = verified_worker_payload(payload).unwrap();
        assert_eq!(key_id, "result-signer-2026");
        assert_eq!(member_id.as_str(), "16189463");
        for invalid in [
            serde_json::json!({
                "verified": false,
                "signer_key_id": "result-signer-2026",
                "result": { "verified_member_id": "16189463" },
            }),
            serde_json::json!({
                "verified": true,
                "signer_key_id": "result-signer-2026",
            }),
            serde_json::json!({
                "verified": true,
                "result": { "verified_member_id": "16189463" },
            }),
            serde_json::json!({
                "verified": true,
                "signer_key_id": "result-signer-2026",
                "result": { "verified_member_id": "01" },
            }),
            serde_json::json!("malformed final response"),
        ] {
            assert!(verified_worker_payload(invalid).is_err());
        }
    }

    #[cfg(feature = "synthetic-tlsn")]
    mod app_remote_worker_e2e {
        use super::*;
        use crate::{
            experimental_tlsn::{
                ExperimentalRequireInfoForwarder, ProofContinuation, ProofContinuationError,
                TlsnOriginCapture, TlsnOriginExchange, UnverifiedTlsnTranscript,
            },
            production_tlsn::{
                FilesystemPresentationArtifactSink, HandoffPresentationProvider, OriginTarget,
                OriginTlsConfig, ProductionTlsnDependencies, RuntimeIdentifiers,
                ServerIdentityPolicy,
            },
            synthetic_tlsn::{synthetic_require_info_request, SYNTHETIC_SERVER_IDENTITY},
        };
        use fusou_auth::manager::AuthConfig;
        use http_body_util::BodyExt;
        use std::{path::PathBuf, time::Instant};

        #[derive(serde::Deserialize)]
        struct SyntheticFixture {
            binding_value: String,
            presentation_base64: String,
            root_certificate_base64: String,
            authenticated_request_base64: String,
            authenticated_response_base64: String,
        }

        struct FixtureAlpha15OriginTransportFactory {
            handoff: Arc<PresentationHandoff>,
            expected_request: Vec<u8>,
            response: Vec<u8>,
            presentation: Vec<u8>,
            root_certificate: Vec<u8>,
        }

        impl Alpha15OriginTransportFactory for FixtureAlpha15OriginTransportFactory {
            fn send_once(
                &self,
                config: OriginTransportConfig,
                request: SerializedOriginRequest,
            ) -> crate::experimental_tlsn::TlsnTransportFuture {
                let handoff = Arc::clone(&self.handoff);
                let expected_request = self.expected_request.clone();
                let response = self.response.clone();
                let presentation = self.presentation.clone();
                let root_certificate = self.root_certificate.clone();
                Box::pin(async move {
                    if config.target().server_identity() != SYNTHETIC_SERVER_IDENTITY
                        || config.tls().trusted_root_certificates() != [root_certificate]
                        || request.bytes() != expected_request
                    {
                        return Err(TlsnTransportError::OriginConnectionFailed);
                    }
                    let request_sha256 = sha256(request.bytes());
                    let response_sha256 = sha256(&response);
                    let parsed = parse_http_response(response)?;
                    let presentation_identifier = URL_SAFE_NO_PAD.encode(sha256(&presentation));
                    let proof = ProofContinuation::new(Box::pin(async move {
                        handoff
                            .publish(request_sha256, presentation_identifier, presentation)
                            .map_err(|_| ProofContinuationError::Presentation)
                    }));
                    Ok(TlsnOriginCapture {
                        exchange: TlsnOriginExchange {
                            response: TlsnOriginResponse::new(
                                parsed.status,
                                parsed.headers,
                                parsed.body,
                                parsed.raw_response_bytes,
                            ),
                            transcript: UnverifiedTlsnTranscript {
                                request_sha256,
                                response_sha256,
                            },
                        },
                        proof,
                    })
                })
            }
        }

        fn required_env(name: &str) -> String {
            std::env::var(name)
                .unwrap_or_else(|_| panic!("{name} must be set by the APP E2E harness"))
        }

        #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
        #[ignore = "run with pnpm --dir packages/FUSOU-TLSN-VERIFICATION-WORKER test:app-roundtrip"]
        async fn app_remote_worker_full_synthetic_e2e() {
            let worker_origin = required_env("FUSOU_TLSN_APP_E2E_WORKER_ORIGIN");
            let worker_url = reqwest::Url::parse(&worker_origin).expect("valid local Worker URL");
            assert_eq!(worker_url.scheme(), "http");
            assert!(worker_url
                .host_str()
                .is_some_and(|host| matches!(host, "127.0.0.1" | "localhost" | "::1")));

            let fixture: SyntheticFixture = serde_json::from_slice(
                &tokio::fs::read(required_env("FUSOU_TLSN_APP_E2E_FIXTURE_PATH"))
                    .await
                    .expect("read synthetic fixture"),
            )
            .expect("parse synthetic fixture");
            let expected_request = URL_SAFE_NO_PAD
                .decode(&fixture.authenticated_request_base64)
                .expect("decode authenticated request");
            let expected_response = URL_SAFE_NO_PAD
                .decode(&fixture.authenticated_response_base64)
                .expect("decode authenticated response");
            let presentation = URL_SAFE_NO_PAD
                .decode(&fixture.presentation_base64)
                .expect("decode presentation");
            let root_certificate = URL_SAFE_NO_PAD
                .decode(&fixture.root_certificate_base64)
                .expect("decode trust root");
            let artifact_root = PathBuf::from(required_env("FUSOU_TLSN_APP_E2E_ARTIFACT_ROOT"));
            let auth_manager = AuthManager::new(
                AuthConfig {
                    supabase_url: "http://unused.invalid".to_owned(),
                    api_key: "unused".to_owned(),
                    refresh_path: "/auth/v1/token".to_owned(),
                    refresh_margin_secs: 30,
                },
                Arc::new(FileStorage::new(PathBuf::from(required_env(
                    "FUSOU_TLSN_APP_E2E_AUTH_SESSION_PATH",
                )))),
            );
            let device_key_path = PathBuf::from(required_env("FUSOU_TLSN_APP_E2E_DEVICE_KEY_PATH"));
            let session_authority_public_key = URL_SAFE_NO_PAD
                .decode(required_env(
                    "FUSOU_TLSN_APP_E2E_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
                ))
                .expect("decode session authority public key");
            let client = reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(30))
                .build()
                .expect("build local Worker client");
            let binding_state = Arc::new(Mutex::new(None));
            let binding_provider = Arc::new(RemoteSessionBindingProvider {
                endpoint: format!("{worker_origin}/attestation/session"),
                client: client.clone(),
                auth_manager: auth_manager.clone(),
                device_key_path: device_key_path.clone(),
                session_authority_public_key,
                session_authority_key_id: required_env(
                    "FUSOU_TLSN_APP_E2E_SESSION_AUTHORITY_KEY_ID",
                ),
                state: Arc::clone(&binding_state),
            });
            let worker_results = RemoteWorkerResultStore::new();
            let verification_backend = Arc::new(RemoteWorkerVerificationBackend {
                endpoint: format!("{worker_origin}/verify/tlsn"),
                status_endpoint: format!("{worker_origin}/verify/tlsn/status"),
                client,
                auth_manager,
                device_key_path,
                binding_state,
                results: Arc::clone(&worker_results),
                result_verifier: Arc::new(
                    ResultSignatureVerifier::new(
                        URL_SAFE_NO_PAD
                            .decode(required_env("FUSOU_TLSN_APP_E2E_RESULT_PUBLIC_KEY_SPKI"))
                            .expect("decode result public key"),
                        required_env("FUSOU_TLSN_APP_E2E_RESULT_SIGNER_KEY_ID"),
                        required_env("FUSOU_TLSN_APP_E2E_RESULT_SIGNING_KEY_REGISTRY"),
                    )
                    .expect("valid result signing key registry"),
                ),
                response_mode: RemoteWorkerResponseMode::Async,
            });
            let handoff = PresentationHandoff::new();
            let origin = OriginTransportConfig::new(
                OriginTarget::new(
                    SYNTHETIC_SERVER_IDENTITY.to_owned(),
                    443,
                    SYNTHETIC_SERVER_IDENTITY.to_owned(),
                )
                .expect("valid synthetic target"),
                OriginTlsConfig::new(vec![root_certificate.clone()])
                    .expect("valid synthetic trust root"),
                ServerIdentityPolicy::new(vec![SYNTHETIC_SERVER_IDENTITY.to_owned()])
                    .expect("valid synthetic identity policy"),
                true,
            );
            let forwarder = ProductionTlsnDependencies::new(
                origin,
                binding_provider,
                Arc::new(FixtureAlpha15OriginTransportFactory {
                    handoff: Arc::clone(&handoff),
                    expected_request: expected_request.clone(),
                    response: expected_response.clone(),
                    presentation: presentation.clone(),
                    root_certificate,
                }),
                Arc::new(HandoffPresentationProvider::new(Arc::clone(&handoff))),
                verification_backend,
                Arc::new(RemoteWorkerResultSigner::new(
                    worker_results,
                    artifact_root.clone(),
                )),
                Arc::new(FilesystemResultDelivery::new(artifact_root.join("results"))),
            )
            .with_presentation_artifact_sink(Arc::new(FilesystemPresentationArtifactSink::new(
                artifact_root.clone(),
            )))
            .with_identifiers(RuntimeIdentifiers::new(
                Some("app-worker-synthetic-e2e".to_owned()),
                None,
                None,
            ))
            .build_forwarder()
            .expect("build production TLSN forwarder");

            let response = forwarder
                .forward(1, synthetic_require_info_request())
                .await
                .expect("forward synthetic request");
            assert_eq!(response.status(), StatusCode::OK);
            let response_body = response
                .into_body()
                .collect()
                .await
                .expect("read synthetic response")
                .to_bytes();
            assert!(String::from_utf8_lossy(&response_body).contains("16189463"));

            let deadline = Instant::now() + Duration::from_secs(30);
            loop {
                let state = forwarder.state().expect("read forwarder state");
                if state == crate::experimental_tlsn::ExperimentalTlsnRuntimeState::ResultReady {
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "APP TLSN pipeline did not reach ResultReady; final state: {state:?}"
                );
                tokio::time::sleep(Duration::from_millis(25)).await;
            }

            let presentation_identifier = URL_SAFE_NO_PAD.encode(sha256(&presentation));
            let worker_payload: serde_json::Value = serde_json::from_slice(
                &tokio::fs::read(
                    artifact_root
                        .join(&presentation_identifier)
                        .join("worker-verification.json"),
                )
                .await
                .expect("read Worker verification artifact"),
            )
            .expect("parse Worker verification artifact");
            assert_eq!(
                worker_payload.get("verified"),
                Some(&serde_json::Value::Bool(true))
            );
            assert_eq!(
                worker_payload
                    .pointer("/result/verified_member_id")
                    .and_then(serde_json::Value::as_str),
                Some("16189463")
            );
            assert_eq!(
                worker_payload
                    .pointer("/result/binding_value")
                    .and_then(serde_json::Value::as_str),
                Some(fixture.binding_value.as_str())
            );
            assert_eq!(
                worker_payload
                    .pointer("/result/request_transcript_sha256")
                    .and_then(serde_json::Value::as_str),
                Some(URL_SAFE_NO_PAD.encode(sha256(&expected_request)).as_str())
            );
            assert_eq!(
                worker_payload
                    .pointer("/result/response_transcript_sha256")
                    .and_then(serde_json::Value::as_str),
                Some(URL_SAFE_NO_PAD.encode(sha256(&expected_response)).as_str())
            );
            assert_eq!(
                worker_payload
                    .get("signature_algorithm")
                    .and_then(serde_json::Value::as_str),
                Some("Ed25519")
            );
            assert_eq!(
                worker_payload
                    .get("signer_key_id")
                    .and_then(serde_json::Value::as_str),
                Some("worker-test")
            );
            assert!(worker_payload
                .pointer("/result/signature")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|signature| !signature.is_empty()));

            let mut results = tokio::fs::read_dir(artifact_root.join("results"))
                .await
                .expect("read delivered results");
            let delivered_path = results
                .next_entry()
                .await
                .expect("read delivered result entry")
                .expect("one delivered result")
                .path();
            assert!(results
                .next_entry()
                .await
                .expect("read final delivered result entry")
                .is_none());
            let delivered_payload: serde_json::Value = serde_json::from_slice(
                &tokio::fs::read(delivered_path)
                    .await
                    .expect("read delivered result"),
            )
            .expect("parse delivered result");
            assert_eq!(delivered_payload, worker_payload);
        }
    }
}
