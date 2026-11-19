use crate::exchange_lifecycle::{ExchangeLifecycle, ExchangeStop, NotaryAttestationLimit};
use crate::{
    experimental_tlsn::{
        sha256, AttestationBinding, BindingError, BindingFuture, BindingRequestContext,
        ProofContinuation, ProofContinuationError, SerializedOriginRequest, TlsnOriginCapture,
        TlsnOriginExchange, TlsnOriginResponse, TlsnTransportError, VerificationError,
        VerificationFuture, VerificationOutcome, VerifiedMemberId, VerifiedTlsnEvidence,
        MAX_TLSN_RECV_DATA_BYTES, MAX_TLSN_SENT_DATA_BYTES,
    },
    production_tlsn::{
        canonical_json_bytes, ensure_private_candidate_root, validate_private_candidate_directory,
        validate_private_candidate_file, write_private_candidate_file,
        Alpha15OriginTransportFactory, OriginTransportConfig, PresentationHandoff,
        PresentationVerificationInput, ProductionResultSigner, ResultSignerError,
        ResultSignerFuture, SignedTlsnResult, TlsnPresentation, TlsnVerificationBackend,
        MAX_WORKER_HEALTH_RESPONSE_BYTES,
    },
};
use authenticity_core::is_valid_key_id;
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use chrono::{DateTime, Utc};
use fusou_auth::{AuthManager, DeviceKey, FileStorage};
use fusou_tlsn_verifier::{
    parse_binding_value, plan_require_info_response_sparse_ranges,
    prover_transport::{
        parse_http_response_for_forwarding, ProverOwnedTlsTransport, ResponseFraming,
    },
    session_context::{
        device_id_commitment, SessionContextGrant, SESSION_CONTEXT_GRANT_EXTENSION_ID,
    },
    ParserLimits, REQUIRE_INFO_TARGET,
};
use futures::io::{AsyncReadExt, AsyncWriteExt};
use http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use hyper::body::Bytes;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    future::IntoFuture,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tlsn::{
    attestation::{
        request::{Request as AttestationRequest, RequestConfig},
        signing::{KeyAlgId, VerifyingKey},
        Attestation, CryptoProvider, Extension,
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
use tokio_util::{compat::TokioAsyncReadCompatExt, task::AbortOnDropHandle};

const MAX_SENT_DATA: usize = MAX_TLSN_SENT_DATA_BYTES;
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
    authority_digests: Option<([u8; 32], [u8; 32])>,
}

fn result_signer_validity_window_contains(
    not_before: &DateTime<Utc>,
    not_after: Option<&DateTime<Utc>>,
    at: &DateTime<Utc>,
) -> bool {
    not_before <= at && not_after.map_or(true, |end| at <= end)
}

struct ResultExchangeContext<'a> {
    session: &'a SessionBindingContext,
    presentation: &'a TlsnPresentation,
    server_identity: &'a str,
    request: &'a [u8],
    response: &'a [u8],
}

impl ResultSignatureVerifier {
    pub fn with_production_authority_pins(
        mut self,
        origin_inventory_sha256: &str,
        target_approval_artifact_sha256: &str,
    ) -> Result<Self, TlsnTransportError> {
        let decode = |value: &str| {
            let bytes: [u8; 32] = URL_SAFE_NO_PAD
                .decode(value)
                .map_err(|_| TlsnTransportError::Unavailable)?
                .try_into()
                .map_err(|_| TlsnTransportError::Unavailable)?;
            if URL_SAFE_NO_PAD.encode(bytes) != value {
                return Err(TlsnTransportError::Unavailable);
            }
            Ok(bytes)
        };
        self.authority_digests = Some((
            decode(origin_inventory_sha256)?,
            decode(target_approval_artifact_sha256)?,
        ));
        Ok(self)
    }

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
        if !is_valid_key_id(&expected_key_id)
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
            if !is_valid_key_id(&entry.key_id)
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
            || !result_signer_validity_window_contains(&not_before, not_after.as_ref(), &now)
        {
            return Err(TlsnTransportError::Unavailable);
        }
        Ok(Self {
            expected_key_id,
            public_key,
            not_before,
            not_after,
            sparse,
            authority_digests: None,
        })
    }

    fn verify_exchange(
        &self,
        payload: &serde_json::Value,
        context: ResultExchangeContext<'_>,
    ) -> Result<VerifiedMemberId, VerificationError> {
        let member_id = self.verify(payload)?;
        let result = &payload["result"];
        let session = context.session;
        let mut expected = vec![
            (
                "presentation_sha256",
                URL_SAFE_NO_PAD.encode(context.presentation.sha256()),
            ),
            ("server_identity", context.server_identity.to_owned()),
            (
                "canonical_user_id",
                session.session_receipt.canonical_user_id.clone(),
            ),
            ("device_id", session.device_id.clone()),
            ("attestation_session_id", session.session_id.clone()),
            ("binding_nonce", session.binding_challenge.clone()),
            ("binding_value", session.binding.clone()),
            ("device_challenge", session.device_challenge.clone()),
            ("request_transcript_size", context.request.len().to_string()),
            (
                "response_transcript_size",
                context.response.len().to_string(),
            ),
        ];
        if !self.sparse {
            expected.extend([
                (
                    "request_transcript_sha256",
                    URL_SAFE_NO_PAD.encode(sha256(context.request)),
                ),
                (
                    "response_transcript_sha256",
                    URL_SAFE_NO_PAD.encode(sha256(context.response)),
                ),
            ]);
        }
        for (field, value) in expected {
            if result.get(field).and_then(serde_json::Value::as_str) != Some(value.as_str()) {
                tracing::warn!(field, "signed Result does not match the current exchange");
                return Err(VerificationError::WorkerRejected);
            }
        }
        let digests = match self.authority_digests {
            Some((inventory, approval)) => [
                serde_json::Value::String(URL_SAFE_NO_PAD.encode(inventory)),
                serde_json::Value::String(URL_SAFE_NO_PAD.encode(approval)),
            ],
            // Unpinned generic fixtures cannot consume non-null Production authority.
            None => [serde_json::Value::Null, serde_json::Value::Null],
        };
        for (field, digest) in ["origin_inventory_sha256", "target_approval_artifact_sha256"]
            .into_iter()
            .zip(digests)
        {
            if result.get(field) != Some(&digest) {
                tracing::warn!(field, "signed Result does not match configured authority");
                return Err(VerificationError::WorkerRejected);
            }
        }
        Ok(member_id)
    }

    fn verify(&self, payload: &serde_json::Value) -> Result<VerifiedMemberId, VerificationError> {
        let now = Utc::now();
        if !result_signer_validity_window_contains(&self.not_before, self.not_after.as_ref(), &now)
        {
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
            let parsed =
                fusou_tlsn_verifier::parse_verifier_result(&result_bytes, &ParserLimits::default())
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
    notary_verifying_key: VerifyingKey,
    notary_id: String,
    environment: String,
    handoff: Arc<PresentationHandoff>,
    attestation_limit: NotaryAttestationLimit,
    sparse: bool,
    test_attestation_grant_override: Option<Vec<u8>>,
    test_extra_attestation_extensions: Vec<Extension>,
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
    device_public_key: String,
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
    request_sha256: [u8; 32],
    response_sha256: [u8; 32],
    presentation: TlsnPresentation,
    session: SessionBindingContext,
    device_signature: String,
    payload: serde_json::Value,
    response_bytes: Vec<u8>,
    verifier_execution_receipt_header_bytes: Option<Vec<u8>>,
    verifier_execution_receipt_bytes: Option<Vec<u8>>,
    response_status: u16,
    connection_id: u64,
    key_id: String,
}

#[derive(Debug, PartialEq, Eq)]
struct WorkerResponse {
    payload: serde_json::Value,
    body_bytes: Vec<u8>,
    verifier_execution_receipt_header_bytes: Option<Vec<u8>>,
    verifier_execution_receipt_bytes: Option<Vec<u8>>,
    status: u16,
}

pub struct RemoteWorkerResultStore {
    results: Mutex<HashMap<[u8; 32], RemoteWorkerResult>>,
    completed: Mutex<HashSet<[u8; 32]>>,
}

impl RemoteWorkerResultStore {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            results: Mutex::new(HashMap::new()),
            completed: Mutex::new(HashSet::new()),
        })
    }

    fn insert(
        &self,
        capture_identifier: [u8; 32],
        result: RemoteWorkerResult,
    ) -> Result<(), VerificationError> {
        let mut results = self
            .results
            .lock()
            .map_err(|_| VerificationError::WorkerUnavailable)?;
        let completed = self
            .completed
            .lock()
            .map_err(|_| VerificationError::WorkerUnavailable)?;
        if completed.contains(&capture_identifier) || results.contains_key(&capture_identifier) {
            tracing::warn!("refusing duplicate Worker Result registration for a capture");
            return Err(VerificationError::WorkerRejected);
        }
        results.insert(capture_identifier, result);
        Ok(())
    }

    fn take(
        &self,
        capture_identifier: &[u8; 32],
        request_sha256: &[u8; 32],
        response_sha256: &[u8; 32],
    ) -> Result<RemoteWorkerResult, ResultSignerError> {
        let mut results = self.results.lock().map_err(|_| ResultSignerError::Failed)?;
        let mut completed = self
            .completed
            .lock()
            .map_err(|_| ResultSignerError::Failed)?;
        let result = results
            .get(capture_identifier)
            .ok_or(ResultSignerError::Unavailable)?;
        if result.request_sha256 != *request_sha256 || result.response_sha256 != *response_sha256 {
            return Err(ResultSignerError::Failed);
        }
        let result = results
            .remove(capture_identifier)
            .ok_or(ResultSignerError::Unavailable)?;
        completed.insert(*capture_identifier);
        Ok(result)
    }

    fn discard_capture(&self, capture_identifier: &[u8; 32]) -> Result<(), String> {
        let mut results = self
            .results
            .lock()
            .map_err(|_| "Worker Result store is poisoned".to_owned())?;
        let mut completed = self
            .completed
            .lock()
            .map_err(|_| "Worker Result completion state is poisoned".to_owned())?;
        results.remove(capture_identifier);
        completed.remove(capture_identifier);
        Ok(())
    }
}

fn remote_worker_http_client(timeout: Duration) -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
        .build()
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

fn is_web_device_auth_nonce(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validated_candidate_device_id(value: &str) -> Result<String, BindingError> {
    let parsed =
        uuid::Uuid::parse_str(value).map_err(|_| BindingError::CandidateDeviceUnavailable)?;
    if parsed.get_version_num() != 4
        || parsed.get_variant() != uuid::Variant::RFC4122
        || parsed.to_string() != value.to_ascii_lowercase()
    {
        return Err(BindingError::CandidateDeviceUnavailable);
    }
    Ok(parsed.to_string())
}

async fn worker_response(response: reqwest::Response) -> Result<WorkerResponse, VerificationError> {
    let status = response.status().as_u16();
    let verifier_execution_receipt_header_bytes = response
        .headers()
        .get("X-FUSOU-TLSN-Verifier-Execution-Receipt")
        .map(|value| value.as_bytes().to_vec());
    let verifier_execution_receipt_bytes = verifier_execution_receipt_header_bytes
        .as_deref()
        .map(|encoded| {
            let encoded =
                std::str::from_utf8(encoded).map_err(|_| VerificationError::WorkerRejected)?;
            let decoded = URL_SAFE_NO_PAD
                .decode(encoded)
                .map_err(|_| VerificationError::WorkerRejected)?;
            if decoded.is_empty() || URL_SAFE_NO_PAD.encode(&decoded) != encoded {
                return Err(VerificationError::WorkerRejected);
            }
            Ok(decoded)
        })
        .transpose()?;
    let body_bytes = response
        .bytes()
        .await
        .map_err(|_| VerificationError::WorkerUnavailable)?
        .to_vec();
    let payload =
        serde_json::from_slice(&body_bytes).map_err(|_| VerificationError::WorkerUnavailable)?;
    Ok(WorkerResponse {
        payload,
        body_bytes,
        verifier_execution_receipt_header_bytes,
        verifier_execution_receipt_bytes,
        status,
    })
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
) -> Result<WorkerResponse, VerificationError> {
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
            let worker_response = worker_response(response).await?;
            if status == reqwest::StatusCode::ACCEPTED {
                if queued_job_id(&worker_response.payload)? != job_id {
                    return Err(VerificationError::WorkerRejected);
                }
                continue;
            }
            if status.is_success() {
                return Ok(worker_response);
            }
            return Err(worker_http_error(status, &worker_response.payload));
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
        let client = remote_worker_http_client(Duration::from_secs(30))
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
            let (context, request, binding, exchange, presentation) = input.into_parts();
            let session = binding_state
                .lock()
                .map_err(|_| VerificationError::WorkerUnavailable)?
                .take()
                .ok_or(VerificationError::WorkerUnavailable)?;
            if binding.value() != session.binding() {
                return Err(VerificationError::BindingMismatch);
            }
            let device_key = DeviceKey::load_registered(device_key_path)
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
            let worker_response = worker_response(response).await?;
            let worker_response = if status == reqwest::StatusCode::ACCEPTED {
                let job_id = queued_job_id(&worker_response.payload)?;
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
                worker_response
            } else {
                return Err(worker_http_error(status, &worker_response.payload));
            };
            if device_key.public_key_b64() != session.device_public_key {
                return Err(VerificationError::WorkerRejected);
            }
            accept_worker_result(
                PresentationVerificationInput::new(
                    context,
                    request,
                    binding,
                    exchange,
                    presentation,
                ),
                session,
                device_signature,
                worker_response,
                &result_verifier,
                &results,
            )
        })
    }
}

fn accept_worker_result(
    input: PresentationVerificationInput,
    session: SessionBindingContext,
    device_signature: String,
    response: WorkerResponse,
    verifier: &ResultSignatureVerifier,
    results: &RemoteWorkerResultStore,
) -> Result<VerificationOutcome, VerificationError> {
    let (context, request, binding, exchange, presentation) = input.into_parts();
    if binding.value() != session.binding() {
        return Err(VerificationError::BindingMismatch);
    }
    let WorkerResponse {
        payload,
        body_bytes: response_bytes,
        verifier_execution_receipt_header_bytes,
        verifier_execution_receipt_bytes,
        status: response_status,
    } = response;
    let (payload, key_id, _) = verified_worker_payload(payload)?;
    let member_id = verifier.verify_exchange(
        &payload,
        ResultExchangeContext {
            session: &session,
            presentation: &presentation,
            server_identity: context.server_identity(),
            request: request.bytes(),
            response: &exchange.response.raw_response_bytes,
        },
    )?;
    let request_sha256 = *context.request_sha256();
    let response_sha256 = *context.response_sha256();
    results.insert(
        *context.binding_identifier(),
        RemoteWorkerResult {
            request_sha256,
            response_sha256,
            presentation,
            session,
            device_signature,
            payload,
            response_bytes,
            verifier_execution_receipt_header_bytes,
            verifier_execution_receipt_bytes,
            response_status,
            connection_id: context.connection_id(),
            key_id,
        },
    )?;
    Ok(VerificationOutcome::Verified(
        VerifiedTlsnEvidence::from_verifier(request_sha256, response_sha256, member_id),
    ))
}

pub struct RemoteWorkerResultSigner {
    results: Arc<RemoteWorkerResultStore>,
    artifact_root: PathBuf,
    candidate_capture_enabled: bool,
    runtime_materials: Option<Arc<BTreeMap<String, Vec<u8>>>>,
}

impl RemoteWorkerResultSigner {
    pub fn new(results: Arc<RemoteWorkerResultStore>, artifact_root: PathBuf) -> Self {
        Self {
            results,
            artifact_root,
            candidate_capture_enabled: false,
            runtime_materials: None,
        }
    }

    pub fn with_candidate_capture_enabled(mut self, enabled: bool) -> Self {
        self.candidate_capture_enabled = enabled;
        self
    }

    pub fn with_runtime_config_materials(
        mut self,
        materials: Arc<BTreeMap<String, Vec<u8>>>,
    ) -> Result<Self, ResultSignerError> {
        let names = [
            "runtime-config-envelope.json",
            "runtime-worker-reference.json",
            "runtime-origin-inventory.json",
            "runtime-target-approval.json",
            "runtime-security-registry-set.json",
            "runtime-result-registry-envelope.json",
            "runtime-result-registry.json",
        ];
        if materials.len() != names.len()
            || names
                .iter()
                .any(|name| materials.get(*name).is_none_or(Vec::is_empty))
            || materials
                .values()
                .try_fold(0_usize, |size, raw| size.checked_add(raw.len()))
                .is_none_or(|size| size > 16 * 1024 * 1024)
        {
            return Err(ResultSignerError::Failed);
        }
        self.runtime_materials = Some(materials);
        Ok(self)
    }
}

impl ProductionResultSigner for RemoteWorkerResultSigner {
    fn sign(&self, evidence: VerifiedTlsnEvidence) -> ResultSignerFuture {
        let results = Arc::clone(&self.results);
        let artifact_root = self.artifact_root.clone();
        let candidate_capture_enabled = self.candidate_capture_enabled;
        let runtime_materials = self.runtime_materials.clone();
        let capture_identifier = *evidence.metadata().binding_identifier();
        let request_sha256 = *evidence.request_sha256();
        let response_sha256 = *evidence.response_sha256();
        Box::pin(async move {
            let result = results.take(&capture_identifier, &request_sha256, &response_sha256)?;
            let bytes =
                serde_json::to_vec(&result.payload).map_err(|_| ResultSignerError::Failed)?;
            if candidate_capture_enabled {
                write_production_capture_bundle(
                    &artifact_root,
                    &result.presentation,
                    &result.session,
                    &result.payload,
                    &result.device_signature,
                    &result.response_bytes,
                    result.verifier_execution_receipt_header_bytes.as_deref(),
                    result.verifier_execution_receipt_bytes.as_deref(),
                    result.response_status,
                    result.connection_id,
                    runtime_materials.as_deref(),
                )
                .await
                .map_err(|_| ResultSignerError::Failed)?;
            }
            SignedTlsnResult::new(result.key_id, bytes).map_err(|_| ResultSignerError::Failed)
        })
    }

    fn finish_capture(&self, capture_identifier: &[u8; 32]) -> Result<(), String> {
        self.results.discard_capture(capture_identifier)
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
    exact_response_bytes: &[u8],
    verifier_execution_receipt_header_bytes: Option<&[u8]>,
    verifier_execution_receipt_bytes: Option<&[u8]>,
    response_status: u16,
    connection_id: u64,
    runtime_materials: Option<&BTreeMap<String, Vec<u8>>>,
) -> Result<(), std::io::Error> {
    ensure_private_candidate_root(artifact_root).await?;
    let directory = artifact_root.join(presentation.identifier());
    validate_private_candidate_directory(&directory).await?;
    let mut existing_entries = tokio::fs::read_dir(&directory).await?;
    let mut existing_names = Vec::new();
    while let Some(entry) = existing_entries.next_entry().await? {
        existing_names.push(entry.file_name());
    }
    existing_names.sort();
    let expected_names_without_health = [
        std::ffi::OsString::from("metadata.json"),
        std::ffi::OsString::from("presentation.bin"),
    ];
    let expected_names_with_health = [
        std::ffi::OsString::from("metadata.json"),
        std::ffi::OsString::from("presentation.bin"),
        std::ffi::OsString::from("worker-health.json"),
    ];
    let has_health = existing_names == expected_names_with_health;
    if existing_names != expected_names_without_health && !has_health {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "candidate Presentation directory is not empty",
        ));
    }
    validate_private_candidate_file(&directory.join("presentation.bin")).await?;
    validate_private_candidate_file(&directory.join("metadata.json")).await?;
    let write_result = async {
    let health_bytes = if has_health {
        let path = directory.join("worker-health.json");
        validate_private_candidate_file(&path).await?;
        let bytes = tokio::fs::read(path).await?;
        if bytes.is_empty() || bytes.len() > MAX_WORKER_HEALTH_RESPONSE_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "candidate Worker health response is empty or oversized",
            ));
        }
        Some(bytes)
    } else {
        None
    };
    let session_json = serde_json::json!({
        "session_id": session.session_id(),
        "canonical_user_id": session.session_receipt.canonical_user_id,
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
    let public_key_bytes = STANDARD
        .decode(&session.device_public_key)
        .map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid device public key")
        })?;
    if public_key_bytes.len() != 32 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "invalid device public key length",
        ));
    }
    let device_identity_json = serde_json::json!({
        "schema_version": 1,
        "canonical_user_id": session.session_receipt.canonical_user_id,
        "device_id": session.device_id(),
        "device_public_key": session.device_public_key,
        "device_public_key_sha256": URL_SAFE_NO_PAD.encode(sha256(&public_key_bytes)),
        "authority_state": "UNVERIFIED",
    });
    let mut artifacts = vec![
        ("session.json", serde_json::to_vec_pretty(&session_json)?),
        (
            "device-authentication.json",
            serde_json::to_vec_pretty(&authentication_json)?,
        ),
        (
            "device-identity.json",
            serde_json::to_vec_pretty(&device_identity_json)?,
        ),
        (
            "possession-proof.json",
            serde_json::to_vec_pretty(&possession_json)?,
        ),
        ("result.json", serde_json::to_vec(result)?),
        (
            "consume-receipt.json",
            serde_json::to_vec_pretty(consume_receipt)?,
        ),
        (
            "worker-verification.json",
            serde_json::to_vec_pretty(worker_payload)?,
        ),
        (
            "capture-provenance.json",
            serde_json::to_vec_pretty(&serde_json::json!({
                "schema_version": 1,
                "classification": "UNVERIFIED",
                "source": "production-proxy-capture",
            }))?,
        ),
        ("result-exact.bin", exact_response_bytes.to_vec()),
    ];
    if let Some(header_bytes) = verifier_execution_receipt_header_bytes {
        artifacts.push((
            "verifier-execution-receipt-header.txt",
            header_bytes.to_vec(),
        ));
    }
    if let Some(receipt_bytes) = verifier_execution_receipt_bytes {
        artifacts.push((
            "verifier-execution-receipt.bin",
            receipt_bytes.to_vec(),
        ));
    }
    if let Some(materials) = runtime_materials {
        for (name, raw) in materials {
            artifacts.push((name.as_str(), raw.clone()));
        }
    }
    let metadata_bytes = tokio::fs::read(directory.join("metadata.json")).await?;
    let presentation_bytes = tokio::fs::read(directory.join("presentation.bin")).await?;
    let (candidate_identity, candidate_artifact_id) =
        create_candidate_artifact_identity(&metadata_bytes, &presentation_bytes)?;
    artifacts.push((
        "candidate-identity.json",
        canonical_json_bytes(&candidate_identity),
    ));
    for (name, bytes) in &artifacts {
        write_capture_file(&directory.join(name), bytes).await?;
    }
    let mut manifest_artifacts = serde_json::Map::new();
    for (name, bytes) in &artifacts {
        manifest_artifacts.insert(
            (*name).to_owned(),
            serde_json::json!({
                "size_bytes": bytes.len(),
                "sha256": URL_SAFE_NO_PAD.encode(sha256(bytes)),
            }),
        );
    }
    for name in ["presentation.bin", "metadata.json"] {
        let bytes = tokio::fs::read(directory.join(name)).await?;
        manifest_artifacts.insert(
            name.to_owned(),
            serde_json::json!({
                "size_bytes": bytes.len(),
                "sha256": URL_SAFE_NO_PAD.encode(sha256(&bytes)),
            }),
        );
    }
    if let Some(bytes) = &health_bytes {
        manifest_artifacts.insert(
            "worker-health.json".to_owned(),
            serde_json::json!({
                "size_bytes": bytes.len(),
                "sha256": URL_SAFE_NO_PAD.encode(sha256(bytes)),
            }),
        );
    }
    let manifest = serde_json::json!({
        "schema_version": 2,
        "scope": "fusou-tlsn-human-test-play-candidate",
        "candidate_status": if verifier_execution_receipt_bytes.is_some() { "CAPTURED_PENDING_OFFLINE_VERIFICATION" } else { "INCOMPLETE_MISSING_EXECUTION_RECEIPT" },
        "approval_status": "UNAPPROVED",
        "target_identity_status": "NOT_YET_OBSERVED",
        "target_identity_source": "alpha15-verified-presentation-required",
        "synthetic_fixture": false,
        "capture_provenance": "production-proxy-capture",
        "presentation_sha256": URL_SAFE_NO_PAD.encode(presentation.sha256()),
        "candidate_artifact_id": candidate_artifact_id,
        "exact_result_sha256": URL_SAFE_NO_PAD.encode(sha256(exact_response_bytes)),
        "verifier_execution_receipt_status": if verifier_execution_receipt_bytes.is_some() { "CAPTURED" } else { "MISSING" },
        "verifier_execution_receipt_sha256": verifier_execution_receipt_bytes.map(|bytes| URL_SAFE_NO_PAD.encode(sha256(bytes))),
        "worker_result_http_status": response_status,
        "connection_id": connection_id,
        "artifacts": manifest_artifacts,
        "readiness_effect": "NONE",
        "gameplay_effect": "NONE",
    });
    write_capture_file(
        &directory.join("candidate-manifest.json"),
        &serde_json::to_vec_pretty(&manifest)?,
    )
    .await?;
    Ok::<Option<Vec<u8>>, std::io::Error>(health_bytes)
    }
    .await;
    match write_result {
        Ok(_) => Ok(()),
        Err(error) => match tokio::fs::remove_dir_all(&directory).await {
            Ok(()) => Err(error),
            Err(cleanup) => Err(std::io::Error::other(format!(
                "{error}; candidate cleanup unconfirmed: {cleanup}"
            ))),
        },
    }
}

fn required_candidate_identity_string<'a>(
    value: &'a serde_json::Value,
    label: &str,
) -> Result<&'a str, std::io::Error> {
    value
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("candidate identity field is missing: {label}"),
            )
        })
}

fn required_candidate_identity_hash<'a>(
    value: &'a serde_json::Value,
    label: &str,
) -> Result<&'a str, std::io::Error> {
    let value = required_candidate_identity_string(value, label)?;
    let decoded = URL_SAFE_NO_PAD.decode(value).map_err(|_| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("candidate identity digest is malformed: {label}"),
        )
    })?;
    if decoded.len() != 32 || URL_SAFE_NO_PAD.encode(decoded) != value {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("candidate identity digest is malformed: {label}"),
        ));
    }
    Ok(value)
}

fn create_candidate_artifact_identity(
    metadata_bytes: &[u8],
    presentation_bytes: &[u8],
) -> Result<(serde_json::Value, String), std::io::Error> {
    const IDENTITY_SCOPE: &str = "fusou-tlsn-candidate-artifact-identity";
    const CONFIGURATION_SCOPE: &str = "fusou-tlsn-app-public-configuration";
    let metadata: serde_json::Value = serde_json::from_slice(metadata_bytes)?;
    if metadata["schema_version"].as_u64() != Some(2)
        || canonical_json_bytes(&metadata) != metadata_bytes
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "candidate metadata is not canonical schema v2 JSON",
        ));
    }
    let fingerprints = &metadata["proxy_provenance"]["app_public_configuration_fingerprints"];
    if fingerprints["schema_version"].as_u64() != Some(2)
        || fingerprints["scope"].as_str() != Some(CONFIGURATION_SCOPE)
        || fingerprints["candidate_binding_status"].as_str() != Some("UNBOUND")
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "candidate APP configuration fingerprint is missing or unsupported",
        ));
    }
    let presentation_sha256 = URL_SAFE_NO_PAD.encode(sha256(presentation_bytes));
    if metadata["presentation_sha256"].as_str() != Some(&presentation_sha256) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "candidate metadata Presentation digest does not match exact bytes",
        ));
    }
    let body = serde_json::json!({
        "schema_version": 1,
        "scope": IDENTITY_SCOPE,
        "canonicalization": "FUSOU-CANONICAL-JSON-V1",
        "candidate_capture_id": required_candidate_identity_string(&metadata["candidate_capture_id"], "candidate_capture_id")?,
        "session_id": required_candidate_identity_string(&metadata["session_id"], "session_id")?,
        "request_id": required_candidate_identity_string(&metadata["request_id"], "request_id")?,
        "request_sha256": required_candidate_identity_hash(&metadata["authenticated_request_sha256"], "authenticated_request_sha256")?,
        "binding_identifier": required_candidate_identity_hash(&metadata["binding_identifier"], "binding_identifier")?,
        "created_at": required_candidate_identity_string(&metadata["capture_timestamp"], "capture_timestamp")?,
        "presentation_sha256": presentation_sha256,
        "metadata_sha256": URL_SAFE_NO_PAD.encode(sha256(metadata_bytes)),
        "app_configuration": {
            "schema_version": 2,
            "scope": CONFIGURATION_SCOPE,
            "combined_sha256": required_candidate_identity_hash(&fingerprints["combined_sha256"], "combined_sha256")?,
        },
        "binding_status": "CRYPTOGRAPHICALLY_BOUND",
        "authority_status": "LOCAL_CONSISTENCY",
        "independent_authentication": "UNVERIFIED",
    });
    let candidate_artifact_id = URL_SAFE_NO_PAD.encode(sha256(&canonical_json_bytes(&body)));
    let mut identity = body.as_object().cloned().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "candidate identity is not an object",
        )
    })?;
    identity.insert(
        "candidate_artifact_id".to_owned(),
        serde_json::Value::String(candidate_artifact_id.clone()),
    );
    Ok((serde_json::Value::Object(identity), candidate_artifact_id))
}

async fn write_capture_file(path: &std::path::Path, bytes: &[u8]) -> Result<(), std::io::Error> {
    write_private_candidate_file(path, bytes).await
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
    session_context_grant: String,
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
        let client = remote_worker_http_client(Duration::from_secs(20))
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
            if !matches!(auth_manager.peek_session().await, Ok(Some(_))) {
                return Err(BindingError::CandidateAuthUnavailable);
            }
            let device_key = DeviceKey::load_registered(device_key_path)
                .await
                .map_err(|_| BindingError::CandidateDeviceUnavailable)?;
            let device_id = device_key
                .device_id()
                .ok_or(BindingError::CandidateDeviceUnavailable)?;
            let device_id = validated_candidate_device_id(device_id)?;
            let access_token = auth_manager
                .get_access_token()
                .await
                .map_err(|_| BindingError::CandidateAuthUnavailable)?;
            let nonce = auth_manager
                .fetch_anonymous_sync_v2_challenge(&device_id)
                .await
                .map_err(|_| BindingError::NoBindingAuthority)?;
            if !is_web_device_auth_nonce(&nonce) {
                return Err(BindingError::NoBindingAuthority);
            }
            let device_auth_signature = device_key.sign_b64(nonce.as_bytes());
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
            let grant_bytes = URL_SAFE_NO_PAD
                .decode(&authority.session_context_grant)
                .map_err(|_| BindingError::InvalidBinding)?;
            if URL_SAFE_NO_PAD.encode(&grant_bytes) != authority.session_context_grant {
                return Err(BindingError::InvalidBinding);
            }
            let grant = SessionContextGrant::parse(&grant_bytes)
                .map_err(|_| BindingError::InvalidBinding)?;
            grant
                .verify(&session_authority_public_key, &session_authority_key_id)
                .map_err(|_| BindingError::InvalidBinding)?;
            let issued_at_ms = DateTime::parse_from_rfc3339(&authority.session_receipt.created_at)
                .map_err(|_| BindingError::InvalidBinding)?
                .timestamp_millis();
            let expires_at_ms = DateTime::parse_from_rfc3339(&authority.session_receipt.expires_at)
                .map_err(|_| BindingError::InvalidBinding)?
                .timestamp_millis();
            let device_challenge_bytes = URL_SAFE_NO_PAD
                .decode(&authority.device_challenge)
                .map_err(|_| BindingError::InvalidBinding)?;
            if grant.session_id() != authority.session_id
                || grant.binding_value() != authority.binding
                || grant.device_id_sha256()
                    != &device_id_commitment(&device_id)
                        .map_err(|_| BindingError::InvalidBinding)?
                || grant.device_challenge() != device_challenge_bytes.as_slice()
                || grant.issued_at_ms() != issued_at_ms as u64
                || grant.expires_at_ms() != expires_at_ms as u64
                || grant.expires_at_ms() <= Utc::now().timestamp_millis() as u64
            {
                return Err(BindingError::InvalidBinding);
            }
            let grant_expires_at_ms = grant.expires_at_ms();
            let mut state_guard = state.lock().map_err(|_| BindingError::NoBindingAuthority)?;
            if state_guard.is_some() {
                return Err(BindingError::AlreadyIssued);
            }
            *state_guard = Some(SessionBindingContext {
                session_id: authority.session_id,
                device_id,
                device_public_key: device_key.public_key_b64().to_owned(),
                binding: authority.binding.clone(),
                binding_challenge: authority.challenge,
                device_challenge: authority.device_challenge,
                expires_at: authority.expires_at,
                session_receipt: authority.session_receipt,
                device_auth_nonce: nonce,
                device_auth_signature,
            });
            AttestationBinding::with_session_context_grant(
                authority.binding,
                Bytes::from(grant_bytes),
                grant_expires_at_ms,
            )
            .map_err(|_| BindingError::InvalidBinding)
        })
    }

    fn attempt_completed(&self, binding: &AttestationBinding) {
        match self.state.lock() {
            Ok(mut state)
                if state
                    .as_ref()
                    .is_some_and(|session| session.binding() == binding.value()) =>
            {
                *state = None;
            }
            Ok(_) => {}
            Err(error) => {
                tracing::error!(%error, "Remote TLSN session binding state is poisoned during attempt cleanup");
            }
        }
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
    session_authority_public_key_spki: Vec<u8>,
    session_authority_key_id: String,
}

impl RealAlpha15DedicatedVerifier {
    pub fn new(
        server_identity: String,
        notary_verifying_key: Vec<u8>,
        session_authority_public_key_spki: Vec<u8>,
        session_authority_key_id: String,
    ) -> Result<Self, TlsnTransportError> {
        if server_identity.trim().is_empty()
            || notary_verifying_key.is_empty()
            || session_authority_public_key_spki.len() != ED25519_SPKI_PREFIX.len() + 32
            || !session_authority_public_key_spki.starts_with(ED25519_SPKI_PREFIX)
            || !is_valid_key_id(&session_authority_key_id)
        {
            return Err(TlsnTransportError::Unavailable);
        }
        Ok(Self {
            server_identity,
            notary_verifying_key,
            session_authority_public_key_spki,
            session_authority_key_id,
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
        let session_authority_public_key_spki = self.session_authority_public_key_spki.clone();
        let session_authority_key_id = self.session_authority_key_id.clone();
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
            let profile = fusou_tlsn_verifier::tlsn_alpha15::SessionExtensionRequireInfoDisclosureProfile::from_server_identity_and_session_authority(
                &server_identity,
                &session_authority_key_id,
                &session_authority_public_key_spki,
            )
            .map_err(|_| crate::experimental_tlsn::VerificationError::ServerIdentityMismatch)?;
            let verified = transcript
                .verify_require_info_with_session_extension(&profile, &ParserLimits::default())
                .map_err(|_| crate::experimental_tlsn::VerificationError::PresentationInvalid)?;
            let verified_session_context = verified
                .session_context()
                .ok_or(crate::experimental_tlsn::VerificationError::BindingMismatch)?;
            let supplied_grant = binding
                .session_context_grant()
                .ok_or(crate::experimental_tlsn::VerificationError::BindingMismatch)?;
            if verified_session_context.grant.encoded() != supplied_grant.bytes()
                || verified_session_context.grant.binding_value() != binding.value()
            {
                return Err(crate::experimental_tlsn::VerificationError::BindingMismatch);
            }
            let expected_binding = fusou_tlsn_verifier::parse_binding_value(binding.value())
                .map_err(|_| crate::experimental_tlsn::VerificationError::BindingMismatch)?;
            if verified.binding().session_id != expected_binding.session_id
                || verified.binding().binding_nonce != expected_binding.binding_nonce
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
                        verified.verified_member_id().to_owned(),
                    )?,
                ),
            ))
        })
    }
}

impl RealAlpha15OriginTransportFactory {
    pub fn new(
        notary_endpoint: String,
        notary_verifying_key: VerifyingKey,
        notary_id: String,
        environment: String,
        handoff: Arc<PresentationHandoff>,
        attestation_limit: NotaryAttestationLimit,
    ) -> Result<Self, TlsnTransportError> {
        Self::new_with_disclosure_mode(
            notary_endpoint,
            notary_verifying_key,
            notary_id,
            environment,
            handoff,
            attestation_limit,
            false,
        )
    }

    pub fn new_sparse(
        notary_endpoint: String,
        notary_verifying_key: VerifyingKey,
        notary_id: String,
        environment: String,
        handoff: Arc<PresentationHandoff>,
        attestation_limit: NotaryAttestationLimit,
    ) -> Result<Self, TlsnTransportError> {
        Self::new_with_disclosure_mode(
            notary_endpoint,
            notary_verifying_key,
            notary_id,
            environment,
            handoff,
            attestation_limit,
            true,
        )
    }

    fn new_with_disclosure_mode(
        notary_endpoint: String,
        notary_verifying_key: VerifyingKey,
        notary_id: String,
        environment: String,
        handoff: Arc<PresentationHandoff>,
        attestation_limit: NotaryAttestationLimit,
        sparse: bool,
    ) -> Result<Self, TlsnTransportError> {
        let valid_scope = |scope: &str| {
            !scope.is_empty()
                && scope.len() <= 128
                && scope.bytes().all(|byte| byte.is_ascii_graphic())
        };
        if notary_endpoint.trim().is_empty()
            || notary_verifying_key.alg != KeyAlgId::K256
            || !matches!(notary_verifying_key.data.len(), 33 | 65)
            || !valid_scope(&notary_id)
            || !valid_scope(&environment)
        {
            return Err(TlsnTransportError::Unavailable);
        }
        Ok(Self {
            notary_endpoint,
            notary_verifying_key,
            notary_id,
            environment,
            handoff,
            attestation_limit,
            sparse,
            test_attestation_grant_override: None,
            test_extra_attestation_extensions: Vec::new(),
        })
    }

    #[cfg(feature = "local-test-notary-fault-injection")]
    pub fn with_test_attestation_extensions(
        mut self,
        grant_override: Option<Vec<u8>>,
        extra_extensions: Vec<Extension>,
    ) -> Self {
        self.test_attestation_grant_override = grant_override;
        self.test_extra_attestation_extensions = extra_extensions;
        self
    }
}

impl Alpha15OriginTransportFactory for RealAlpha15OriginTransportFactory {
    fn send_once(
        &self,
        _config: OriginTransportConfig,
        _request: SerializedOriginRequest,
    ) -> crate::experimental_tlsn::TlsnTransportFuture {
        Box::pin(async { Err(TlsnTransportError::LifecyclePolicyMissing) })
    }

    fn send_once_with_lifecycle(
        &self,
        config: OriginTransportConfig,
        request: SerializedOriginRequest,
        lifecycle: ExchangeLifecycle,
    ) -> crate::experimental_tlsn::TlsnTransportFuture {
        let notary_endpoint = self.notary_endpoint.clone();
        let notary_verifying_key = self.notary_verifying_key.clone();
        let notary_id = self.notary_id.clone();
        let environment = self.environment.clone();
        let handoff = Arc::clone(&self.handoff);
        let attestation_limit = self.attestation_limit;
        let sparse = self.sparse;
        let test_attestation_grant_override = self.test_attestation_grant_override.clone();
        let test_extra_attestation_extensions = self.test_extra_attestation_extensions.clone();
        Box::pin(async move {
            lifecycle
                .run(run_real_exchange(
                    config,
                    request,
                    notary_endpoint,
                    notary_verifying_key,
                    notary_id,
                    environment,
                    handoff,
                    attestation_limit,
                    sparse,
                    test_attestation_grant_override,
                    test_extra_attestation_extensions,
                    lifecycle.clone(),
                ))
                .await
                .map_err(|reason| match reason {
                    ExchangeStop::Cancelled => TlsnTransportError::Cancelled,
                    ExchangeStop::Deadline => TlsnTransportError::DeadlineExceeded,
                })?
        })
    }
}

async fn run_real_exchange(
    config: OriginTransportConfig,
    request: SerializedOriginRequest,
    notary_endpoint: String,
    notary_verifying_key: VerifyingKey,
    notary_id: String,
    environment: String,
    handoff: Arc<PresentationHandoff>,
    attestation_limit: NotaryAttestationLimit,
    sparse: bool,
    test_attestation_grant_override: Option<Vec<u8>>,
    test_extra_attestation_extensions: Vec<Extension>,
    lifecycle: ExchangeLifecycle,
) -> Result<TlsnOriginCapture, TlsnTransportError> {
    let exchange_started = std::time::Instant::now();
    let session_context_grant = request
        .session_context_grant()
        .cloned()
        .ok_or(TlsnTransportError::RuntimeConfigUnavailable)?;
    let capture_identifier = *request
        .capture_identifier()
        .ok_or(TlsnTransportError::RuntimeConfigUnavailable)?;
    let request_sha256 = sha256(request.bytes());
    fusou_tlsn_verifier::validate_require_info_request_headerless(
        request.bytes(),
        config.target().server_identity(),
        &ParserLimits::default(),
    )
    .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    let max_sent_data = max_sent_data_for_request(request.bytes())?;

    let notary_connect_started = std::time::Instant::now();
    let mut notary_socket = TcpStream::connect(&notary_endpoint)
        .await
        .map_err(|_| TlsnTransportError::NotaryConnectionFailed)?;
    let notary_connect_elapsed = notary_connect_started.elapsed();
    crate::notary_wire::client_admit(
        &mut notary_socket,
        session_context_grant.bytes(),
        &notary_verifying_key,
        &notary_id,
        &environment,
    )
    .await
    .map_err(|error| match error {
        crate::notary_wire::NotaryWireError::InvalidSignature => {
            TlsnTransportError::NotaryPinMismatch
        }
        _ => TlsnTransportError::NotaryAdmissionFailed,
    })?;

    let origin_connect_started = std::time::Instant::now();
    let origin_socket = match config.target().loopback_connect_address() {
        Some(address) => TcpStream::connect(address).await,
        None => TcpStream::connect((config.target().hostname(), config.target().port())).await,
    }
    .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    let origin_connect_elapsed = origin_connect_started.elapsed();

    let worker_lifecycle = lifecycle.clone();
    let session = Session::new_with_worker_spawn(notary_socket.compat(), move |work| {
        spawn_exchange_worker(work, &worker_lifecycle);
        Ok(())
    });
    let (driver, mut handle) = session.split();
    let driver_task = spawn_exchange_task(driver, &lifecycle);
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
                .max_recv_data(MAX_TLSN_RECV_DATA_BYTES)
                .build()
                .map_err(|_| TlsnTransportError::OriginConnectionFailed)?,
        )
        .await
        .map_err(|error| {
            tracing::warn!(
                server_identity = config.target().server_identity(),
                error = %error,
                "TLSN Origin request could not be sent; check the DNS identity, certificate validity, and Web PKI chain"
            );
            if error.is_io() {
                TlsnTransportError::TlsHandshakeFailed {
                    server_identity: config.target().server_identity().to_owned(),
                }
            } else {
                TlsnTransportError::OriginConnectionFailed
            }
        })?;

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
    tlsn::webpki::ServerCertVerifier::new(&root_store)
        .map_err(|_| TlsnTransportError::SystemTrustStoreUnavailable)?;
    let origin_handshake_started = std::time::Instant::now();
    let (connection, prover) = prover
        .connect(
            TlsClientConfig::builder()
                .server_name(ServerName::Dns(server_name))
                .root_store(root_store)
                .build()
                .map_err(|_| TlsnTransportError::OriginConnectionFailed)?,
            origin_socket.compat(),
        )
        .map_err(|_| {
            tracing::warn!(
                server_identity = config.target().server_identity(),
                "TLSN Origin TLS certificate validation or handshake failed"
            );
            TlsnTransportError::TlsHandshakeFailed {
                server_identity: config.target().server_identity().to_owned(),
            }
        })?;
    let origin_handshake_elapsed = origin_handshake_started.elapsed();
    let prover_task = spawn_exchange_task(prover.into_future(), &lifecycle);
    let mut transport = ProverOwnedTlsTransport::new(connection);
    let request_write_elapsed = transport
        .send_headerless_require_info_with_timing(
            request.bytes(),
            config.target().server_identity(),
        )
        .await
        .map_err(|_| TlsnTransportError::AmbiguousOriginSend)?;
    let response_read_started = std::time::Instant::now();
    let raw_response = transport
        .read_response_to_end()
        .await
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    let response_read_elapsed = response_read_started.elapsed();
    let response = parse_http_response(raw_response)?;
    let sparse_ranges = if sparse {
        plan_require_info_response_sparse_ranges(
            &response.raw_response_bytes,
            &ParserLimits::default(),
        )
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?
    } else {
        Vec::new()
    };
    tracing::info!(
        server_identity = config.target().server_identity(),
        request_bytes = request.bytes().len(),
        response_status = response.status.as_u16(),
        response_framing = response.framing.as_str(),
        response_wire_bytes = response.raw_response_bytes.len(),
        response_body_bytes = response.body.len(),
        origin_connect_ms = duration_millis(origin_connect_elapsed),
        notary_connect_ms = duration_millis(notary_connect_elapsed),
        origin_handshake_ms = duration_millis(origin_handshake_elapsed),
        request_write_ms = duration_millis(request_write_elapsed),
        response_read_ms = duration_millis(response_read_elapsed),
        exchange_to_response_ms = duration_millis(exchange_started.elapsed()),
        "TLSN protocol exchange response received"
    );
    let server_identity = config.target().server_identity().to_owned();
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
    let proof_lifecycle = lifecycle.clone();
    let proof_work = async move {
        transport
            .close()
            .await
            .map_err(|_| ProofContinuationError::ProverFinalization)?;

        let mut prover = prover_task
            .await
            .map_err(|_| ProofContinuationError::ProverFinalization)?
            .map_err(|_| ProofContinuationError::ProverFinalization)?;
        let transcript_commit = {
            let mut commit_builder = TranscriptCommitConfig::builder(prover.transcript());
            if sparse {
                let sent_len = prover.transcript().sent().len();
                commit_builder
                    .commit_sent(0..sent_len)
                    .map_err(|_| ProofContinuationError::TranscriptCommit)?;
                for range in &sparse_ranges {
                    commit_builder
                        .commit_recv(range.clone())
                        .map_err(|_| ProofContinuationError::TranscriptCommit)?;
                }
            } else {
                let transcript = HttpTranscript::parse(prover.transcript())
                    .map_err(|_| ProofContinuationError::TranscriptCommit)?;
                DefaultHttpCommitter::default()
                    .commit_transcript(&mut commit_builder, &transcript)
                    .map_err(|_| ProofContinuationError::TranscriptCommit)?;
            }
            commit_builder
                .build()
                .map_err(|_| ProofContinuationError::TranscriptCommit)?
        };

        let mut request_config_builder = RequestConfig::builder();
        request_config_builder.transcript_commit(transcript_commit.clone());
        request_config_builder.extension(Extension {
            id: SESSION_CONTEXT_GRANT_EXTENSION_ID.to_vec(),
            value: test_attestation_grant_override
                .as_deref()
                .unwrap_or_else(|| session_context_grant.bytes())
                .to_vec(),
        });
        for extension in test_extra_attestation_extensions {
            request_config_builder.extension(extension);
        }
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
        if sparse {
            for range in &sparse_ranges {
                prove_builder
                    .reveal_recv(range.clone())
                    .map_err(|_| ProofContinuationError::Prove)?;
            }
        } else {
            prove_builder
                .reveal_recv(0..received_len)
                .map_err(|_| ProofContinuationError::Prove)?;
        }
        let prove_config = prove_builder
            .build()
            .map_err(|_| ProofContinuationError::Prove)?;
        let prover_proof_started = std::time::Instant::now();
        let ProverOutput {
            transcript_commitments,
            transcript_secrets,
            ..
        } = prover
            .prove(&prove_config)
            .await
            .map_err(|_| ProofContinuationError::Prove)?;
        tracing::info!(
            server_identity = server_identity.as_str(),
            elapsed_ms = duration_millis(prover_proof_started.elapsed()),
            "TLSN transcript proof generation completed"
        );
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
        let notary_started = std::time::Instant::now();
        notary_socket
            .write_all(&request_bytes)
            .await
            .map_err(|_| ProofContinuationError::Notary)?;
        notary_socket
            .close()
            .await
            .map_err(|_| ProofContinuationError::Notary)?;
        let attestation_bytes =
            read_notary_attestation(&mut notary_socket, attestation_limit).await?;
        let attestation: Attestation =
            bincode::deserialize(&attestation_bytes).map_err(|_| ProofContinuationError::Notary)?;
        if attestation.body.verifying_key() != &notary_verifying_key {
            return Err(ProofContinuationError::AttestationValidation);
        }
        attestation_request
            .validate(&attestation, &CryptoProvider::default())
            .map_err(|_| ProofContinuationError::AttestationValidation)?;
        tracing::info!(
            server_identity = server_identity.as_str(),
            notary_request_bytes = request_bytes.len(),
            notary_attestation_bytes = attestation_bytes.len(),
            elapsed_ms = duration_millis(notary_started.elapsed()),
            "TLSN Notary attestation exchange and validation completed"
        );
        let presentation_started = std::time::Instant::now();
        let presentation = build_presentation(
            &attestation,
            &secrets,
            sparse.then_some(sparse_ranges.as_slice()),
        )
        .map_err(|_| ProofContinuationError::Presentation)?;
        let presentation_bytes =
            bincode::serialize(&presentation).map_err(|_| ProofContinuationError::Presentation)?;
        let presentation_bytes_len = presentation_bytes.len();
        proof_lifecycle.check().map_err(proof_stop)?;
        handoff
            .publish(
                capture_identifier,
                request_sha256,
                hex_identifier(&presentation_bytes),
                presentation_bytes,
            )
            .map_err(|_| ProofContinuationError::Presentation)?;
        tracing::info!(
            server_identity = server_identity.as_str(),
            presentation_bytes = presentation_bytes_len,
            elapsed_ms = duration_millis(presentation_started.elapsed()),
            "TLSN Presentation serialization and handoff completed"
        );
        Ok(())
    };
    let proof = ProofContinuation::new(Box::pin(async move {
        lifecycle.run(proof_work).await.map_err(proof_stop)?
    }));

    Ok(TlsnOriginCapture {
        exchange: browser_exchange,
        proof,
    })
}

fn spawn_exchange_task<F>(future: F, lifecycle: &ExchangeLifecycle) -> AbortOnDropHandle<F::Output>
where
    F: std::future::Future + Send + 'static,
    F::Output: Send + 'static,
{
    AbortOnDropHandle::new(lifecycle.tasks().spawn(future))
}

fn spawn_exchange_worker(work: Box<dyn FnOnce() + Send + 'static>, lifecycle: &ExchangeLifecycle) {
    // Blocking workers stop via Executor::shutdown, not Tokio abort. The same
    // tracker waits for their actual exit, including already-queued workers.
    drop(lifecycle.tasks().spawn_blocking(work));
}

async fn read_notary_attestation<R: futures::AsyncRead + Unpin>(
    reader: &mut R,
    limit: NotaryAttestationLimit,
) -> Result<Vec<u8>, ProofContinuationError> {
    let sentinel = u64::try_from(limit.max_bytes())
        .ok()
        .and_then(|bytes| bytes.checked_add(1))
        .ok_or(ProofContinuationError::NotaryAttestationLimit)?;
    let mut bytes = Vec::new();
    reader
        .take(sentinel)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| ProofContinuationError::Notary)?;
    if bytes.len() > limit.max_bytes() {
        return Err(ProofContinuationError::NotaryAttestationLimit);
    }
    Ok(bytes)
}

fn proof_stop(reason: ExchangeStop) -> ProofContinuationError {
    match reason {
        ExchangeStop::Cancelled => ProofContinuationError::Cancelled,
        ExchangeStop::Deadline => ProofContinuationError::Deadline,
    }
}
fn build_presentation(
    attestation: &Attestation,
    secrets: &tlsn::attestation::Secrets,
    sparse_ranges: Option<&[std::ops::Range<usize>]>,
) -> Result<tlsn::attestation::presentation::Presentation, TlsnTransportError> {
    let mut builder = secrets.transcript_proof_builder();
    builder
        .reveal_sent(0..secrets.transcript().sent().len())
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    if let Some(ranges) = sparse_ranges {
        for range in ranges {
            builder
                .reveal_recv(range.clone())
                .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
        }
    } else {
        builder
            .reveal_recv(0..secrets.transcript().received().len())
            .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    }
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
    framing: ResponseFraming,
}

fn duration_millis(duration: Duration) -> u64 {
    duration
        .as_secs()
        .saturating_mul(1_000)
        .saturating_add(u64::from(duration.subsec_millis()))
}

fn parse_http_response(raw: Vec<u8>) -> Result<ParsedHttpResponse, TlsnTransportError> {
    let parsed = parse_http_response_for_forwarding(&raw)
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    let mut headers = HeaderMap::new();
    for (name, value) in parsed.headers {
        let name =
            HeaderName::from_bytes(&name).map_err(|_| TlsnTransportError::ResponseReadFailed)?;
        let value =
            HeaderValue::from_bytes(&value).map_err(|_| TlsnTransportError::ResponseReadFailed)?;
        headers.append(name, value);
    }
    Ok(ParsedHttpResponse {
        status: StatusCode::from_u16(parsed.status_code)
            .map_err(|_| TlsnTransportError::ResponseReadFailed)?,
        headers,
        body: Bytes::from(parsed.body),
        raw_response_bytes: Bytes::from(parsed.raw_response_bytes),
        framing: parsed.framing,
    })
}

#[cfg(test)]
mod response_parser_tests {
    use super::*;

    #[test]
    fn chunked_response_is_decoded_for_forwarding_and_kept_raw_for_evidence() {
        let raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n7\r\npayload\r\n0\r\n\r\n";
        let parsed = parse_http_response(raw.to_vec()).unwrap();

        assert_eq!(parsed.status, StatusCode::OK);
        assert_eq!(parsed.framing.as_str(), "chunked");
        assert_eq!(parsed.body.as_ref(), b"payload");
        assert_eq!(parsed.raw_response_bytes.as_ref(), raw);
        assert_eq!(sha256(parsed.raw_response_bytes.as_ref()), sha256(raw));
        assert_ne!(sha256(parsed.body.as_ref()), sha256(raw));
        assert!(!parsed.headers.contains_key(http::header::TRANSFER_ENCODING));
        assert_eq!(
            parsed.headers[http::header::CONTENT_LENGTH]
                .to_str()
                .unwrap(),
            "7"
        );
    }

    #[test]
    fn content_length_response_preserves_http_leading_zero_compatibility() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Length:\t007 \t\r\n\r\npayload";
        let parsed = parse_http_response(raw.to_vec()).unwrap();

        assert_eq!(parsed.framing.as_str(), "content-length");
        assert_eq!(parsed.body.as_ref(), b"payload");
        assert_eq!(parsed.raw_response_bytes.as_ref(), raw);

        let empty =
            parse_http_response(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".to_vec()).unwrap();
        assert!(empty.body.is_empty());
    }

    #[test]
    fn response_parser_rejects_ambiguous_framing_and_chunk_trailers() {
        let conflicting = b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nTransfer-Encoding: chunked\r\n\r\n7\r\npayload\r\n0\r\n\r\n";
        assert!(parse_http_response(conflicting.to_vec()).is_err());

        let with_trailer =
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\nX-Trace: value\r\n\r\n";
        assert!(parse_http_response(with_trailer.to_vec()).is_err());
    }
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
mod task_tests;

#[cfg(test)]
mod tests {
    mod result_binding_tests;

    use super::*;
    use crate::{
        exchange_lifecycle::{ExchangeLifecycle, ExchangePolicy},
        experimental_tlsn::{
            AttestationBindingProvider, BindingError, BindingFuture, BindingRequestContext,
            ExperimentalRequireInfoForwarder, ExperimentalResultBoundary,
            ExperimentalTlsnForwarder, ExperimentalTlsnRuntimeState, ExperimentalVerifierBoundary,
            ForwarderPausePoint, ForwarderTestPause, Http1OriginRequestSerializer,
            OriginRequestSerializer, ResultBoundaryFuture, TlsnOriginCapture, TlsnOriginTransport,
            TlsnTransportError, TlsnTransportFuture, VerificationFuture,
        },
        production_tlsn::{
            HandoffPresentationProvider, OriginTarget, PresentationProvider,
            PresentationRequestContext, PresentationVerifierBoundary, ProductionResultDelivery,
            ResultDeliveryError, ResultDeliveryFuture, RuntimeIdentifiers, SignedResultBoundary,
        },
    };
    use ring::signature::{Ed25519KeyPair, KeyPair};
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::{
        collections::{HashMap, VecDeque},
        net::SocketAddr,
        sync::atomic::{AtomicUsize, Ordering},
    };
    use tokio::{
        io::{AsyncReadExt as TokioAsyncReadExt, AsyncWriteExt as TokioAsyncWriteExt},
        net::TcpListener,
        sync::{mpsc, oneshot},
        task::JoinHandle,
        time::timeout,
    };
    use warp::Filter;

    #[tokio::test]
    async fn remote_worker_clients_reject_cross_endpoint_redirects() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let source = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let source_address = source.local_addr().unwrap();
        let target_address = target.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for _ in 0..3 {
                let (mut stream, _) = source.accept().await.unwrap();
                let mut request = [0; 4096];
                stream.read(&mut request).await.unwrap();
                stream.write_all(format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: http://{target_address}/substituted-worker\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
            }
        });
        for path in [
            "/verify/tlsn",
            "/verify/tlsn/status/job",
            "/attestation/session",
        ] {
            let response = remote_worker_http_client(std::time::Duration::from_secs(20))
                .unwrap()
                .post(format!("http://{source_address}{path}"))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), reqwest::StatusCode::TEMPORARY_REDIRECT);
        }
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(100), target.accept())
                .await
                .is_err()
        );
        server.await.unwrap();
    }

    fn test_session_context() -> SessionBindingContext {
        SessionBindingContext {
            session_id: "550e8400-e29b-41d4-a716-446655440000".to_owned(),
            device_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7".to_owned(),
            device_public_key: STANDARD.encode([0xfb_u8; 32]),
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

    #[test]
    fn remote_session_cleanup_preserves_a_replacement_context() {
        let provider = RemoteSessionBindingProvider::new(
            "https://127.0.0.1/session".to_owned(),
            test_auth_manager(PathBuf::from("unused-session-cleanup.json")),
            PathBuf::from("unused-session-cleanup-device.json"),
            [ED25519_SPKI_PREFIX.as_slice(), &[1_u8; 32]].concat(),
            "test-session-authority".to_owned(),
        )
        .expect("construct offline Remote Session provider");
        let state = provider.state();
        let old_binding = AttestationBinding::new("binding-value".to_owned()).unwrap();
        *state.lock().unwrap() = Some(test_session_context());

        provider.attempt_completed(&old_binding);
        assert!(state.lock().unwrap().is_none());

        let mut replacement = test_session_context();
        replacement.binding = "replacement-binding".to_owned();
        replacement.session_receipt.binding_value = "replacement-binding".to_owned();
        *state.lock().unwrap() = Some(replacement);
        provider.attempt_completed(&old_binding);
        assert_eq!(
            state
                .lock()
                .unwrap()
                .as_ref()
                .map(SessionBindingContext::binding),
            Some("replacement-binding")
        );
    }

    #[tokio::test]
    async fn candidate_bundle_preserves_exact_response_receipt_and_health_without_overwrite() {
        let artifact_root = std::env::temp_dir().join(format!(
            "fusou-tlsn-candidate-bundle-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let presentation_bytes = b"alpha15 presentation fixture";
        let presentation_identifier = URL_SAFE_NO_PAD.encode(sha256(presentation_bytes));
        let directory = artifact_root.join(&presentation_identifier);
        tokio::fs::create_dir_all(&artifact_root)
            .await
            .expect("create artifact root fixture directory");
        #[cfg(unix)]
        tokio::fs::set_permissions(&artifact_root, std::fs::Permissions::from_mode(0o700))
            .await
            .expect("make artifact root private");
        crate::production_tlsn::create_private_candidate_directory(&directory)
            .await
            .expect("create private artifact fixture directory");
        write_private_candidate_file(&directory.join("presentation.bin"), presentation_bytes)
            .await
            .expect("write presentation fixture");
        let health_raw = b"{ \"schema_version\": 3, \"ok\": true }\n";
        write_private_candidate_file(&directory.join("worker-health.json"), health_raw)
            .await
            .expect("write exact Worker health response fixture");

        let presentation =
            TlsnPresentation::new(presentation_identifier, presentation_bytes.to_vec())
                .expect("construct presentation");
        let session = test_session_context();
        let metadata = serde_json::json!({
            "schema_version": 2,
            "candidate_capture_id": presentation.identifier(),
            "session_id": session.session_id(),
            "request_id": "request-fixture-1",
            "authenticated_request_sha256": URL_SAFE_NO_PAD.encode([0x11_u8; 32]),
            "binding_identifier": URL_SAFE_NO_PAD.encode([0x22_u8; 32]),
            "capture_timestamp": "2026-10-01T12:00:00.000Z",
            "presentation_sha256": URL_SAFE_NO_PAD.encode(presentation.sha256()),
            "proxy_provenance": {
                "app_public_configuration_fingerprints": {
                    "schema_version": 2,
                    "scope": "fusou-tlsn-app-public-configuration",
                    "compile_time_sha256": URL_SAFE_NO_PAD.encode([0x31_u8; 32]),
                    "runtime_sha256": URL_SAFE_NO_PAD.encode([0x32_u8; 32]),
                    "combined_sha256": URL_SAFE_NO_PAD.encode([0x33_u8; 32]),
                    "candidate_binding_status": "UNBOUND",
                },
            },
        });
        write_private_candidate_file(
            &directory.join("metadata.json"),
            &canonical_json_bytes(&metadata),
        )
        .await
        .expect("write presentation metadata fixture");
        let payload = serde_json::json!({
            "result": { "result_id": "fixture-result" },
            "consume_receipt": { "used_at": "2026-10-01T12:00:00.000Z" },
        });
        let exact_response = b"{ \"result\":{\"result_id\":\"fixture-result\"} }\n";
        let receipt_bytes = b"detached verifier execution receipt";
        let receipt_header = URL_SAFE_NO_PAD.encode(receipt_bytes).into_bytes();
        for invalid_public_key in [
            URL_SAFE_NO_PAD.encode([0xfb_u8; 32]),
            STANDARD.encode([0xfb_u8; 31]),
            STANDARD.encode([0xfb_u8; 33]),
            "invalid-base64".to_owned(),
        ] {
            let mut invalid_session = session.clone();
            invalid_session.device_public_key = invalid_public_key;
            let error = write_production_capture_bundle(
                &artifact_root,
                &presentation,
                &invalid_session,
                &payload,
                "device-signature",
                exact_response.as_slice(),
                Some(receipt_header.as_slice()),
                Some(receipt_bytes.as_slice()),
                200,
                77,
                None,
            )
            .await
            .expect_err("invalid device public key must not produce a capture bundle");
            assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
            assert!(!directory.exists(), "failed capture must clean its archive");
            crate::production_tlsn::create_private_candidate_directory(&directory)
                .await
                .expect("restore private Presentation directory after rejected key");
            write_private_candidate_file(&directory.join("presentation.bin"), presentation_bytes)
                .await
                .expect("restore Presentation fixture");
            write_private_candidate_file(
                &directory.join("metadata.json"),
                &canonical_json_bytes(&metadata),
            )
            .await
            .expect("restore metadata fixture");
            write_private_candidate_file(&directory.join("worker-health.json"), health_raw)
                .await
                .expect("restore Worker health fixture");
        }
        let args = (
            &artifact_root,
            &presentation,
            &session,
            &payload,
            "device-signature",
            exact_response.as_slice(),
            Some(receipt_header.as_slice()),
            Some(receipt_bytes.as_slice()),
            200,
            77,
        );

        let runtime_materials: BTreeMap<String, Vec<u8>> = [
            "runtime-config-envelope.json",
            "runtime-worker-reference.json",
            "runtime-origin-inventory.json",
            "runtime-target-approval.json",
            "runtime-security-registry-set.json",
            "runtime-result-registry-envelope.json",
            "runtime-result-registry.json",
        ]
        .into_iter()
        .map(|name| {
            (
                name.to_owned(),
                format!("{{\"source\":\"{name}\"}}\n").into_bytes(),
            )
        })
        .collect();
        let store = RemoteWorkerResultStore::new();
        assert!(
            RemoteWorkerResultSigner::new(Arc::clone(&store), artifact_root.clone())
                .with_runtime_config_materials(Arc::new(runtime_materials.clone()))
                .is_ok()
        );
        for mutated in [
            BTreeMap::new(),
            {
                let mut changed = runtime_materials.clone();
                changed.remove("runtime-result-registry.json");
                changed
            },
            {
                let mut changed = runtime_materials.clone();
                changed.insert("../outside".to_owned(), vec![1]);
                changed
            },
            {
                let mut changed = runtime_materials.clone();
                changed.insert("runtime-result-registry.json".to_owned(), Vec::new());
                changed
            },
            {
                let mut changed = runtime_materials.clone();
                changed.insert(
                    "runtime-result-registry.json".to_owned(),
                    vec![0; 16 * 1024 * 1024 + 1],
                );
                changed
            },
        ] {
            assert!(
                RemoteWorkerResultSigner::new(Arc::clone(&store), artifact_root.clone())
                    .with_runtime_config_materials(Arc::new(mutated))
                    .is_err()
            );
        }
        write_production_capture_bundle(
            args.0,
            args.1,
            args.2,
            args.3,
            args.4,
            args.5,
            args.6,
            args.7,
            args.8,
            args.9,
            Some(&runtime_materials),
        )
        .await
        .expect("write candidate proof bundle");

        assert_eq!(
            tokio::fs::read(directory.join("result.json"))
                .await
                .unwrap(),
            serde_json::to_vec(&payload["result"]).unwrap(),
            "inner Result export must be compact; exact outer bytes remain separate",
        );

        let device_identity: serde_json::Value = serde_json::from_slice(
            &tokio::fs::read(directory.join("device-identity.json"))
                .await
                .expect("read captured device identity"),
        )
        .expect("parse captured device identity");
        assert_eq!(
            device_identity["device_public_key"],
            session.device_public_key
        );
        assert_eq!(
            device_identity["device_public_key_sha256"],
            URL_SAFE_NO_PAD.encode(sha256(&[0xfb_u8; 32])),
        );
        assert_eq!(device_identity["authority_state"], "UNVERIFIED");

        let stored_response = tokio::fs::read(directory.join("result-exact.bin"))
            .await
            .expect("read exact response bytes");
        assert_eq!(stored_response, exact_response);
        assert_eq!(
            tokio::fs::read(directory.join("worker-health.json"))
                .await
                .expect("read exact Worker health response"),
            health_raw,
        );
        assert_eq!(
            tokio::fs::read(directory.join("verifier-execution-receipt-header.txt"))
                .await
                .expect("read raw receipt header"),
            receipt_header
        );
        assert_eq!(
            tokio::fs::read(directory.join("verifier-execution-receipt.bin"))
                .await
                .expect("read decoded receipt"),
            receipt_bytes
        );
        let manifest: serde_json::Value = serde_json::from_slice(
            &tokio::fs::read(directory.join("candidate-manifest.json"))
                .await
                .expect("read candidate manifest"),
        )
        .expect("parse candidate manifest");
        assert_eq!(
            manifest["candidate_status"],
            "CAPTURED_PENDING_OFFLINE_VERIFICATION"
        );
        assert_eq!(manifest["approval_status"], "UNAPPROVED");
        assert_eq!(manifest["readiness_effect"], "NONE");
        assert_eq!(manifest["schema_version"], 2);
        assert_eq!(
            manifest["artifacts"]["worker-health.json"]["size_bytes"],
            health_raw.len(),
        );
        assert_eq!(
            manifest["artifacts"]["worker-health.json"]["sha256"],
            URL_SAFE_NO_PAD.encode(sha256(health_raw)),
        );
        let identity_bytes = tokio::fs::read(directory.join("candidate-identity.json"))
            .await
            .expect("read candidate identity artifact");
        let identity: serde_json::Value =
            serde_json::from_slice(&identity_bytes).expect("parse candidate identity");
        assert_eq!(
            identity["candidate_artifact_id"],
            manifest["candidate_artifact_id"]
        );
        assert_eq!(identity["binding_status"], "CRYPTOGRAPHICALLY_BOUND");
        assert_eq!(identity["authority_status"], "LOCAL_CONSISTENCY");
        assert_eq!(identity["independent_authentication"], "UNVERIFIED");
        assert_eq!(
            manifest["artifacts"]["candidate-identity.json"]["sha256"],
            URL_SAFE_NO_PAD.encode(sha256(&identity_bytes))
        );
        assert_eq!(
            manifest["exact_result_sha256"],
            URL_SAFE_NO_PAD.encode(sha256(exact_response))
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let permissions = tokio::fs::metadata(directory.join("result-exact.bin"))
                .await
                .expect("stat exact response artifact")
                .permissions();
            assert_eq!(permissions.mode() & 0o777, 0o600);
        }

        let retry = write_production_capture_bundle(
            args.0, args.1, args.2, args.3, args.4, args.5, args.6, args.7, args.8, args.9, None,
        )
        .await;
        assert_eq!(retry.unwrap_err().kind(), std::io::ErrorKind::AlreadyExists);
        let manifest: serde_json::Value = serde_json::from_slice(
            &tokio::fs::read(directory.join("candidate-manifest.json"))
                .await
                .unwrap(),
        )
        .unwrap();
        for (name, raw) in &runtime_materials {
            assert_eq!(&tokio::fs::read(directory.join(name)).await.unwrap(), raw);
            assert_eq!(manifest["artifacts"][name]["size_bytes"], raw.len());
            assert_eq!(
                manifest["artifacts"][name]["sha256"],
                URL_SAFE_NO_PAD.encode(sha256(raw))
            );
        }
        assert_eq!(
            tokio::fs::read(directory.join("result-exact.bin"))
                .await
                .expect("candidate exact response remains unchanged"),
            exact_response
        );
        tokio::fs::remove_dir_all(artifact_root)
            .await
            .expect("remove candidate bundle fixture");
    }

    fn test_auth_manager(path: PathBuf) -> AuthManager<FileStorage> {
        AuthManager::new(
            fusou_auth::manager::AuthConfig {
                supabase_url: "http://127.0.0.1:1".to_owned(),
                api_key: "unused".to_owned(),
                refresh_path: "/auth/v1/token".to_owned(),
                refresh_margin_secs: 30,
            },
            Arc::new(FileStorage::new(path)),
        )
    }

    #[test]
    fn remote_session_binding_constructor_rejects_invalid_endpoint_and_signer_inputs() {
        let public_key = [ED25519_SPKI_PREFIX.as_slice(), &[1_u8; 32]].concat();
        let invalid_prefix = vec![0_u8; 44];
        for (endpoint, key, key_id) in [
            ("not a URL", public_key.clone(), "session-authority"),
            (
                "http://127.0.0.1/session",
                public_key.clone(),
                "session-authority",
            ),
            (
                "https://127.0.0.1/session",
                public_key[..43].to_vec(),
                "session-authority",
            ),
            (
                "https://127.0.0.1/session",
                invalid_prefix,
                "session-authority",
            ),
            ("https://127.0.0.1/session", public_key, " "),
        ] {
            let provider = RemoteSessionBindingProvider::new(
                endpoint.to_owned(),
                test_auth_manager(PathBuf::from("unused-constructor-session.json")),
                PathBuf::from("unused-constructor-device.json"),
                key,
                key_id.to_owned(),
            );
            assert_eq!(provider.err(), Some(BindingError::NoBindingAuthority));
        }
    }

    #[tokio::test]
    async fn candidate_binding_without_saved_auth_session_fails_before_network_or_device_creation()
    {
        let root = std::env::temp_dir().join(format!(
            "fusou-tlsn-candidate-auth-preflight-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        tokio::fs::create_dir(&root)
            .await
            .expect("create auth preflight fixture directory");
        let session_path = root.join("session.json");
        let device_key_path = root.join("device-key.json");
        let provider = RemoteSessionBindingProvider::new(
            "https://127.0.0.1:1/session".to_owned(),
            test_auth_manager(session_path),
            device_key_path.clone(),
            [ED25519_SPKI_PREFIX.as_slice(), &[1_u8; 32]].concat(),
            "test-session-authority".to_owned(),
        )
        .expect("construct offline candidate provider");
        let result = provider
            .issue_binding(BindingRequestContext::new(1, REQUIRE_INFO_TARGET))
            .await;

        assert_eq!(result, Err(BindingError::CandidateAuthUnavailable));
        assert!(!device_key_path.exists());
        tokio::fs::remove_dir_all(root)
            .await
            .expect("remove auth preflight fixture directory");
    }

    #[tokio::test]
    async fn candidate_binding_requires_a_registered_device_before_refreshing_saved_auth() {
        let root = std::env::temp_dir().join(format!(
            "fusou-tlsn-candidate-device-preflight-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        tokio::fs::create_dir(&root)
            .await
            .expect("create device preflight fixture directory");
        let session_path = root.join("session.json");
        let device_key_path = root.join("device-key.json");
        let auth_manager = test_auth_manager(session_path);
        auth_manager
            .save_session(&fusou_auth::Session {
                access_token: "synthetic-expired-access-token".to_owned(),
                refresh_token: "synthetic-refresh-token".to_owned(),
                expires_at: Some(Utc::now() - chrono::Duration::seconds(60)),
                token_type: Some("Bearer".to_owned()),
            })
            .await
            .expect("save expired synthetic Auth session");
        let mut device_key = DeviceKey::load_or_create(device_key_path.clone())
            .await
            .expect("create registered-device fixture key");
        device_key
            .set_device_id("not-a-uuid".to_owned())
            .await
            .expect("save malformed synthetic device ID");
        drop(device_key);

        let provider = RemoteSessionBindingProvider::new(
            "https://127.0.0.1:1/session".to_owned(),
            auth_manager,
            device_key_path,
            [ED25519_SPKI_PREFIX.as_slice(), &[1_u8; 32]].concat(),
            "test-session-authority".to_owned(),
        )
        .expect("construct offline candidate provider");
        let result = provider
            .issue_binding(BindingRequestContext::new(1, REQUIRE_INFO_TARGET))
            .await;

        assert_eq!(result, Err(BindingError::CandidateDeviceUnavailable));
        tokio::fs::remove_dir_all(root)
            .await
            .expect("remove device preflight fixture directory");
    }

    #[tokio::test]
    async fn candidate_binding_without_registered_device_fails_before_saved_session_refresh() {
        let root = std::env::temp_dir().join(format!(
            "fusou-tlsn-candidate-unregistered-device-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        tokio::fs::create_dir(&root)
            .await
            .expect("create unregistered-device fixture directory");
        let auth_manager = test_auth_manager(root.join("session.json"));
        auth_manager
            .save_session(&fusou_auth::Session {
                access_token: "synthetic-expired-access-token".to_owned(),
                refresh_token: "synthetic-refresh-token".to_owned(),
                expires_at: Some(Utc::now() - chrono::Duration::seconds(60)),
                token_type: Some("Bearer".to_owned()),
            })
            .await
            .expect("save expired synthetic Auth session");
        let provider = RemoteSessionBindingProvider::new(
            "https://127.0.0.1:1/session".to_owned(),
            auth_manager,
            root.join("missing-device-key.json"),
            [ED25519_SPKI_PREFIX.as_slice(), &[1_u8; 32]].concat(),
            "test-session-authority".to_owned(),
        )
        .expect("construct offline candidate provider");

        let result = provider
            .issue_binding(BindingRequestContext::new(1, REQUIRE_INFO_TARGET))
            .await;

        assert_eq!(result, Err(BindingError::CandidateDeviceUnavailable));
        tokio::fs::remove_dir_all(root)
            .await
            .expect("remove unregistered-device fixture directory");
    }

    #[tokio::test]
    async fn candidate_binding_allows_refresh_attempt_only_after_registered_device_validation() {
        let root = std::env::temp_dir().join(format!(
            "fusou-tlsn-candidate-valid-device-refresh-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        tokio::fs::create_dir(&root)
            .await
            .expect("create valid-device fixture directory");
        let auth_manager = test_auth_manager(root.join("session.json"));
        auth_manager
            .save_session(&fusou_auth::Session {
                access_token: "synthetic-expired-access-token".to_owned(),
                refresh_token: "synthetic-refresh-token".to_owned(),
                expires_at: Some(Utc::now() - chrono::Duration::seconds(60)),
                token_type: Some("Bearer".to_owned()),
            })
            .await
            .expect("save expired synthetic Auth session");
        let device_key_path = root.join("device-key.json");
        let mut device_key = DeviceKey::load_or_create(device_key_path.clone())
            .await
            .expect("create registered-device fixture key");
        device_key
            .set_device_id("7c9e6679-7425-40de-944b-e07fc1f90ae7".to_owned())
            .await
            .expect("save valid synthetic device ID");
        drop(device_key);
        let provider = RemoteSessionBindingProvider::new(
            "https://127.0.0.1:1/session".to_owned(),
            auth_manager,
            device_key_path,
            [ED25519_SPKI_PREFIX.as_slice(), &[1_u8; 32]].concat(),
            "test-session-authority".to_owned(),
        )
        .expect("construct offline candidate provider");

        let result = provider
            .issue_binding(BindingRequestContext::new(1, REQUIRE_INFO_TARGET))
            .await;

        assert_eq!(result, Err(BindingError::CandidateAuthUnavailable));
        tokio::fs::remove_dir_all(root)
            .await
            .expect("remove valid-device fixture directory");
    }

    #[test]
    fn candidate_device_id_validation_accepts_only_uuid_v4_and_normalizes_case() {
        assert_eq!(
            validated_candidate_device_id("7C9E6679-7425-40DE-944B-E07FC1F90AE7"),
            Ok("7c9e6679-7425-40de-944b-e07fc1f90ae7".to_owned()),
        );
        assert_eq!(
            validated_candidate_device_id("not-a-uuid"),
            Err(BindingError::CandidateDeviceUnavailable),
        );
        assert_eq!(
            validated_candidate_device_id("7c9e6679-7425-10de-944b-e07fc1f90ae7"),
            Err(BindingError::CandidateDeviceUnavailable),
        );
        assert_eq!(
            validated_candidate_device_id("7c9e6679-7425-40de-744b-e07fc1f90ae7"),
            Err(BindingError::CandidateDeviceUnavailable),
        );
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

    fn result_signature_verifier_for_fixture() -> Arc<ResultSignatureVerifier> {
        let (_, public_key_spki) = signed_result_payload();
        Arc::new(
            ResultSignatureVerifier::new(
                public_key_spki.clone(),
                "result-signer-2026".to_owned(),
                result_registry(&public_key_spki, "ACTIVE", "2020-01-01T00:00:00.000Z", None),
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
            version: 2,
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
            presentation_sha256: sha256(b"synthetic Result signature fixture Presentation"),
            server_identity: "game.example.test".to_owned(),
            origin_inventory_sha256: None,
            target_approval_artifact_sha256: None,
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

    fn signed_result_payload_for_exchange(
        presentation: &TlsnPresentation,
        session: &SessionBindingContext,
        server_identity: &str,
        request: &[u8],
        response: &[u8],
    ) -> (serde_json::Value, Vec<u8>) {
        let session_id = uuid::Uuid::parse_str(&session.session_id).unwrap();
        let binding_nonce: [u8; 32] = URL_SAFE_NO_PAD
            .decode(&session.binding_challenge)
            .unwrap()
            .try_into()
            .unwrap();
        let device_challenge: [u8; 32] = URL_SAFE_NO_PAD
            .decode(&session.device_challenge)
            .unwrap()
            .try_into()
            .unwrap();
        let mut binding_bytes = Vec::new();
        binding_bytes.extend_from_slice(fusou_tlsn_verifier::BINDING_PREFIX);
        binding_bytes.extend_from_slice(&16_u16.to_be_bytes());
        binding_bytes.extend_from_slice(session_id.as_bytes());
        binding_bytes.extend_from_slice(&32_u16.to_be_bytes());
        binding_bytes.extend_from_slice(&binding_nonce);
        assert_eq!(session.binding, URL_SAFE_NO_PAD.encode(&binding_bytes));

        let key_pair = Ed25519KeyPair::from_seed_unchecked(&[11_u8; 32]).unwrap();
        let mut result = fusou_tlsn_verifier::VerifierResult {
            version: 2,
            profile_id: fusou_tlsn_verifier::PROFILE_ID.to_owned(),
            profile_sha256: [1_u8; 32],
            issuer: fusou_tlsn_verifier::ISSUER.to_owned(),
            proof_purpose: fusou_tlsn_verifier::PROOF_PURPOSE.to_owned(),
            canonical_user_id: session.session_receipt.canonical_user_id.clone(),
            canonical_device_id: session.device_id.clone(),
            device_challenge,
            verified_member_id: "16189463".to_owned(),
            attestation_session_id: session_id,
            binding_nonce,
            binding_value: session.binding.clone(),
            verifier_key_id: "verifier-test".to_owned(),
            notary_key_id: "notary-test".to_owned(),
            tlsn_attestation_id: vec![2_u8; 16],
            presentation_sha256: *presentation.sha256(),
            server_identity: server_identity.to_owned(),
            origin_inventory_sha256: None,
            target_approval_artifact_sha256: None,
            request_transcript_size: request.len() as u64,
            request_transcript_sha256: sha256(request),
            response_transcript_size: response.len() as u64,
            response_transcript_sha256: sha256(response),
            revealed_request_ranges: vec![fusou_tlsn_verifier::RevealedRange {
                start: 0,
                length: request.len() as u64,
                bytes: request.to_vec(),
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

    fn session_context_with_nonce(nonce: [u8; 32]) -> SessionBindingContext {
        let mut session = test_session_context();
        let session_id = uuid::Uuid::parse_str(&session.session_id).unwrap();
        let mut binding_bytes = Vec::new();
        binding_bytes.extend_from_slice(fusou_tlsn_verifier::BINDING_PREFIX);
        binding_bytes.extend_from_slice(&16_u16.to_be_bytes());
        binding_bytes.extend_from_slice(session_id.as_bytes());
        binding_bytes.extend_from_slice(&32_u16.to_be_bytes());
        binding_bytes.extend_from_slice(&nonce);
        session.binding = URL_SAFE_NO_PAD.encode(&binding_bytes);
        session.binding_challenge = URL_SAFE_NO_PAD.encode(nonce);
        session.session_receipt.binding_value = session.binding.clone();
        session.session_receipt.nonce = URL_SAFE_NO_PAD.encode(nonce);
        session
    }

    struct FixtureSignedWorkerBackend {
        result_verifier: Arc<ResultSignatureVerifier>,
        results: Arc<RemoteWorkerResultStore>,
        sessions: Arc<HashMap<[u8; 32], SessionBindingContext>>,
    }

    impl TlsnVerificationBackend for FixtureSignedWorkerBackend {
        fn verify(&self, input: PresentationVerificationInput) -> VerificationFuture {
            let result_verifier = Arc::clone(&self.result_verifier);
            let results = Arc::clone(&self.results);
            let sessions = Arc::clone(&self.sessions);
            Box::pin(async move {
                let (context, request, binding, exchange, presentation) = input.into_parts();
                let session = sessions
                    .get(context.binding_identifier())
                    .cloned()
                    .ok_or(VerificationError::WorkerRejected)?;
                let (payload, _) = signed_result_payload_for_exchange(
                    &presentation,
                    &session,
                    context.server_identity(),
                    request.bytes(),
                    &exchange.response.raw_response_bytes,
                );
                let body_bytes =
                    serde_json::to_vec(&payload).map_err(|_| VerificationError::WorkerRejected)?;
                let response = WorkerResponse {
                    payload,
                    body_bytes,
                    verifier_execution_receipt_header_bytes: None,
                    verifier_execution_receipt_bytes: None,
                    status: 200,
                };
                accept_worker_result(
                    PresentationVerificationInput::new(
                        context,
                        request,
                        binding,
                        exchange,
                        presentation,
                    ),
                    session,
                    "fixture-device-signature".to_owned(),
                    response,
                    &result_verifier,
                    &results,
                )
            })
        }
    }

    #[derive(Default)]
    struct CapturingResultDelivery {
        result: Mutex<Option<SignedTlsnResult>>,
    }

    impl ProductionResultDelivery for CapturingResultDelivery {
        fn deliver(&self, result: SignedTlsnResult) -> ResultDeliveryFuture {
            *self.result.lock().unwrap() = Some(result);
            Box::pin(async { Ok::<(), ResultDeliveryError>(()) })
        }
    }

    fn exchange_for_request(request: &[u8]) -> TlsnOriginExchange {
        let response = Bytes::from_static(b"HTTP/1.1 200 OK\r\n\r\n");
        TlsnOriginExchange {
            response: TlsnOriginResponse::new(
                StatusCode::OK,
                HeaderMap::new(),
                Bytes::new(),
                response.clone(),
            ),
            transcript: crate::experimental_tlsn::UnverifiedTlsnTranscript {
                request_sha256: sha256(request),
                response_sha256: sha256(&response),
            },
        }
    }

    const FORWARDER_LOOPBACK_BODY: &[u8] = b"game response";
    const FORWARDER_PRESENTATION_A: &[u8] = b"synthetic Presentation A";
    const FORWARDER_PRESENTATION_B: &[u8] = b"synthetic Presentation B";

    fn forwarder_test_request() -> http::Request<Bytes> {
        http::Request::builder()
            .method(http::Method::POST)
            .uri("https://game.example.test/kcsapi/api_get_member/require_info?x=1")
            .version(http::Version::HTTP_11)
            .header("Host", "game.example.test")
            .header("Content-Length", "3")
            .body(Bytes::from_static(b"abc"))
            .unwrap()
    }

    fn forwarder_loopback_response() -> Vec<u8> {
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            FORWARDER_LOOPBACK_BODY.len()
        )
        .into_bytes();
        response.extend_from_slice(FORWARDER_LOOPBACK_BODY);
        response
    }

    struct ForwarderLoopbackOrigin {
        address: SocketAddr,
        requests: mpsc::UnboundedReceiver<Vec<u8>>,
        request_count: Arc<AtomicUsize>,
        task: Option<JoinHandle<()>>,
    }

    impl ForwarderLoopbackOrigin {
        async fn start() -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let response = forwarder_loopback_response();
            let (request_sender, requests) = mpsc::unbounded_channel();
            let request_count = Arc::new(AtomicUsize::new(0));
            let server_request_count = Arc::clone(&request_count);
            let task = tokio::spawn(async move {
                for _ in 0..2 {
                    let Ok((mut stream, _)) = listener.accept().await else {
                        return;
                    };
                    let mut request = Vec::new();
                    if stream.read_to_end(&mut request).await.is_err() {
                        return;
                    }
                    server_request_count.fetch_add(1, Ordering::AcqRel);
                    if request_sender.send(request).is_err()
                        || stream.write_all(&response).await.is_err()
                    {
                        return;
                    }
                }
            });
            Self {
                address,
                requests,
                request_count,
                task: Some(task),
            }
        }

        async fn next_request(&mut self) -> Vec<u8> {
            timeout(std::time::Duration::from_secs(5), self.requests.recv())
                .await
                .expect("loopback origin request timed out")
                .expect("loopback origin request channel closed")
        }

        fn request_count(&self) -> usize {
            self.request_count.load(Ordering::Acquire)
        }

        async fn stop(&mut self) {
            if let Some(task) = self.task.take() {
                task.abort();
                let _ = task.await;
            }
        }
    }

    impl Drop for ForwarderLoopbackOrigin {
        fn drop(&mut self) {
            if let Some(task) = self.task.as_ref() {
                task.abort();
            }
        }
    }

    struct ForwarderLoopbackTransport {
        address: SocketAddr,
        handoff: Arc<PresentationHandoff>,
        presentations: Mutex<VecDeque<Vec<u8>>>,
        send_counts: Arc<Mutex<HashMap<[u8; 32], usize>>>,
        finished_captures: Arc<Mutex<Vec<[u8; 32]>>>,
    }

    impl TlsnOriginTransport for ForwarderLoopbackTransport {
        fn send_once(&self, request: SerializedOriginRequest) -> TlsnTransportFuture {
            let Some(capture_identifier) = request.capture_identifier().copied() else {
                return Box::pin(async { Err(TlsnTransportError::Unavailable) });
            };
            let request_bytes = request.bytes().to_vec();
            let request_sha256 = sha256(&request_bytes);
            let presentation = self.presentations.lock().unwrap().pop_front();
            let Some(presentation) = presentation else {
                return Box::pin(async { Err(TlsnTransportError::Unavailable) });
            };
            *self
                .send_counts
                .lock()
                .unwrap()
                .entry(capture_identifier)
                .or_default() += 1;
            let address = self.address;
            let handoff = Arc::clone(&self.handoff);
            Box::pin(async move {
                let mut stream = tokio::net::TcpStream::connect(address)
                    .await
                    .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
                stream
                    .write_all(&request_bytes)
                    .await
                    .map_err(|_| TlsnTransportError::AmbiguousOriginSend)?;
                stream
                    .shutdown()
                    .await
                    .map_err(|_| TlsnTransportError::AmbiguousOriginSend)?;
                let mut raw_response = Vec::new();
                stream
                    .read_to_end(&mut raw_response)
                    .await
                    .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
                if raw_response != forwarder_loopback_response() {
                    return Err(TlsnTransportError::ResponseReadFailed);
                }

                let mut headers = HeaderMap::new();
                headers.insert(
                    "Content-Length",
                    HeaderValue::from_str(&FORWARDER_LOOPBACK_BODY.len().to_string())
                        .map_err(|_| TlsnTransportError::ResponseReadFailed)?,
                );
                headers.insert("Connection", HeaderValue::from_static("close"));
                handoff
                    .publish(
                        capture_identifier,
                        request_sha256,
                        URL_SAFE_NO_PAD.encode(sha256(&presentation)),
                        presentation,
                    )
                    .map_err(|_| TlsnTransportError::Unavailable)?;
                let response_bytes = Bytes::from(raw_response);
                let exchange = TlsnOriginExchange {
                    response: TlsnOriginResponse::new(
                        StatusCode::OK,
                        headers,
                        Bytes::from_static(FORWARDER_LOOPBACK_BODY),
                        response_bytes.clone(),
                    ),
                    transcript: crate::experimental_tlsn::UnverifiedTlsnTranscript {
                        request_sha256,
                        response_sha256: sha256(&response_bytes),
                    },
                };
                Ok(TlsnOriginCapture {
                    exchange,
                    proof: ProofContinuation::completed(),
                })
            })
        }

        fn finish_capture(&self, capture_identifier: &[u8; 32]) -> Result<(), String> {
            self.finished_captures
                .lock()
                .map_err(|_| "test transport cleanup state is poisoned".to_owned())?
                .push(*capture_identifier);
            Ok(())
        }
    }

    struct QueuedBindingProvider {
        bindings: Mutex<VecDeque<AttestationBinding>>,
        completed: Arc<Mutex<Vec<[u8; 32]>>>,
    }

    impl AttestationBindingProvider for QueuedBindingProvider {
        fn issue_binding(&self, _context: BindingRequestContext) -> BindingFuture {
            let binding = self.bindings.lock().unwrap().pop_front();
            Box::pin(async move { binding.ok_or(BindingError::BindingNotReady) })
        }

        fn attempt_completed(&self, binding: &AttestationBinding) {
            self.completed
                .lock()
                .unwrap()
                .push(binding.capture_identifier());
        }
    }

    struct CountingPresentationVerifier {
        inner: Arc<PresentationVerifierBoundary>,
        calls: Arc<AtomicUsize>,
    }

    impl ExperimentalVerifierBoundary for CountingPresentationVerifier {
        fn verify(
            &self,
            connection_id: u64,
            request: SerializedOriginRequest,
            binding: AttestationBinding,
            exchange: TlsnOriginExchange,
        ) -> VerificationFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.inner.verify(connection_id, request, binding, exchange)
        }

        fn verify_with_lifecycle(
            &self,
            connection_id: u64,
            request: SerializedOriginRequest,
            binding: AttestationBinding,
            exchange: TlsnOriginExchange,
            lifecycle: ExchangeLifecycle,
        ) -> VerificationFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.inner
                .verify_with_lifecycle(connection_id, request, binding, exchange, lifecycle)
        }

        fn finish_capture(&self, capture_identifier: &[u8; 32]) -> Result<(), String> {
            self.inner.finish_capture(capture_identifier)
        }
    }

    struct CountingSignedResultBoundary {
        inner: Arc<SignedResultBoundary>,
        calls: Arc<AtomicUsize>,
    }

    impl ExperimentalResultBoundary for CountingSignedResultBoundary {
        fn accept(&self, evidence: VerifiedTlsnEvidence) -> ResultBoundaryFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.inner.accept(evidence)
        }

        fn accept_with_lifecycle(
            &self,
            evidence: VerifiedTlsnEvidence,
            lifecycle: ExchangeLifecycle,
        ) -> ResultBoundaryFuture {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.inner.accept_with_lifecycle(evidence, lifecycle)
        }

        fn finish_capture(&self, capture_identifier: &[u8; 32]) -> Result<(), String> {
            self.inner.finish_capture(capture_identifier)
        }
    }

    struct ForwarderCleanupFixture {
        forwarder: Arc<ExperimentalTlsnForwarder>,
        pause_reached: oneshot::Receiver<()>,
        pause_release: Option<oneshot::Sender<()>>,
        origin: ForwarderLoopbackOrigin,
        transport: Arc<ForwarderLoopbackTransport>,
        handoff: Arc<PresentationHandoff>,
        results: Arc<RemoteWorkerResultStore>,
        verifier_calls: Arc<AtomicUsize>,
        result_boundary_calls: Arc<AtomicUsize>,
        delivery: Arc<CapturingResultDelivery>,
        result_verifier: Arc<ResultSignatureVerifier>,
        binding_completed: Arc<Mutex<Vec<[u8; 32]>>>,
        session_a: SessionBindingContext,
        session_b: SessionBindingContext,
        binding_a: AttestationBinding,
        binding_b: AttestationBinding,
        presentation_a: Vec<u8>,
        presentation_b: Vec<u8>,
        expected_request: Vec<u8>,
    }

    async fn forwarder_cleanup_fixture(
        pause_point: ForwarderPausePoint,
    ) -> ForwarderCleanupFixture {
        let origin = ForwarderLoopbackOrigin::start().await;
        let session_a = session_context_with_nonce([0x61; 32]);
        let session_b = session_context_with_nonce([0x62; 32]);
        let binding_a = AttestationBinding::new(session_a.binding.clone()).unwrap();
        let binding_b = AttestationBinding::new(session_b.binding.clone()).unwrap();
        let binding_completed = Arc::new(Mutex::new(Vec::new()));
        let binding_provider = Arc::new(QueuedBindingProvider {
            bindings: Mutex::new(VecDeque::from([binding_a.clone(), binding_b.clone()])),
            completed: Arc::clone(&binding_completed),
        });
        let handoff = PresentationHandoff::new();
        let results = RemoteWorkerResultStore::new();
        let sessions = Arc::new(HashMap::from([
            (binding_a.capture_identifier(), session_a.clone()),
            (binding_b.capture_identifier(), session_b.clone()),
        ]));
        let result_verifier = result_signature_verifier_for_fixture();
        let backend = Arc::new(FixtureSignedWorkerBackend {
            result_verifier: Arc::clone(&result_verifier),
            results: Arc::clone(&results),
            sessions,
        });
        let target = OriginTarget::new(
            "game.example.test".to_owned(),
            443,
            "game.example.test".to_owned(),
        )
        .unwrap();
        let verifier_calls = Arc::new(AtomicUsize::new(0));
        let verifier = Arc::new(CountingPresentationVerifier {
            inner: PresentationVerifierBoundary::new(
                Arc::new(HandoffPresentationProvider::new(Arc::clone(&handoff))),
                backend,
                target,
                RuntimeIdentifiers::default(),
            ),
            calls: Arc::clone(&verifier_calls),
        });
        let delivery = Arc::new(CapturingResultDelivery::default());
        let result_boundary_calls = Arc::new(AtomicUsize::new(0));
        let result_boundary = Arc::new(CountingSignedResultBoundary {
            inner: SignedResultBoundary::new(
                Arc::new(RemoteWorkerResultSigner::new(
                    Arc::clone(&results),
                    PathBuf::new(),
                )),
                delivery.clone() as Arc<dyn ProductionResultDelivery>,
            ),
            calls: Arc::clone(&result_boundary_calls),
        });
        let presentation_a = FORWARDER_PRESENTATION_A.to_vec();
        let presentation_b = FORWARDER_PRESENTATION_B.to_vec();
        let send_counts = Arc::new(Mutex::new(HashMap::new()));
        let finished_captures = Arc::new(Mutex::new(Vec::new()));
        let transport = Arc::new(ForwarderLoopbackTransport {
            address: origin.address,
            handoff: Arc::clone(&handoff),
            presentations: Mutex::new(VecDeque::from([
                presentation_a.clone(),
                presentation_b.clone(),
            ])),
            send_counts,
            finished_captures,
        });
        let forwarder = ExperimentalTlsnForwarder::new_with_policy(
            binding_provider,
            Arc::new(Http1OriginRequestSerializer),
            transport.clone() as Arc<dyn TlsnOriginTransport>,
            verifier as Arc<dyn ExperimentalVerifierBoundary>,
            result_boundary as Arc<dyn ExperimentalResultBoundary>,
            Some(
                ExchangePolicy::from_millis(Some("60000"), Some("5000"))
                    .expect("valid forwarder test lifecycle policy"),
            ),
        );
        let (pause, pause_reached, pause_release) = ForwarderTestPause::channel(pause_point);
        forwarder.set_test_pause(pause).unwrap();
        let (parts, body) = forwarder_test_request().into_parts();
        let expected_request = Http1OriginRequestSerializer
            .serialize(&parts, body, &binding_a)
            .unwrap()
            .bytes()
            .to_vec();
        ForwarderCleanupFixture {
            forwarder,
            pause_reached,
            pause_release: Some(pause_release),
            origin,
            transport,
            handoff,
            results,
            verifier_calls,
            result_boundary_calls,
            delivery,
            result_verifier,
            binding_completed,
            session_a,
            session_b,
            binding_a,
            binding_b,
            presentation_a,
            presentation_b,
            expected_request,
        }
    }

    async fn wait_forwarder_state(
        forwarder: &ExperimentalTlsnForwarder,
        expected: ExperimentalTlsnRuntimeState,
    ) {
        timeout(std::time::Duration::from_secs(5), async {
            loop {
                if forwarder.state().unwrap() == expected && forwarder.capture_ready() {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("forwarder capture did not reach a cleanup-confirmed state");
    }

    fn assert_headerless_forwarder_request(
        bytes: &[u8],
        expected: &[u8],
        binding_a: &AttestationBinding,
        binding_b: &AttestationBinding,
    ) {
        assert_eq!(bytes, expected);
        let lowercase = bytes.to_ascii_lowercase();
        assert!(!lowercase
            .windows(b"x-attestation-binding".len())
            .any(|window| window == b"x-attestation-binding"));
        assert!(!lowercase
            .windows(b"cookie:".len())
            .any(|window| window == b"cookie:"));
        for binding in [binding_a, binding_b] {
            assert!(!bytes
                .windows(binding.value().len())
                .any(|window| window == binding.value().as_bytes()));
        }
    }

    async fn complete_forwarder_capture_b(
        fixture: &mut ForwarderCleanupFixture,
        expected_verifier_calls: usize,
    ) {
        let response = timeout(
            std::time::Duration::from_secs(5),
            fixture.forwarder.forward(2, forwarder_test_request()),
        )
        .await
        .expect("capture B forward timed out")
        .unwrap()
        .expect("capture B returns its origin response");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body().as_ref(), FORWARDER_LOOPBACK_BODY);
        wait_forwarder_state(
            &fixture.forwarder,
            ExperimentalTlsnRuntimeState::ResultReady,
        )
        .await;

        let request_b = fixture.origin.next_request().await;
        assert_headerless_forwarder_request(
            &request_b,
            &fixture.expected_request,
            &fixture.binding_a,
            &fixture.binding_b,
        );
        let capture_a = fixture.binding_a.capture_identifier();
        let capture_b = fixture.binding_b.capture_identifier();
        assert_eq!(
            fixture
                .transport
                .send_counts
                .lock()
                .unwrap()
                .get(&capture_a),
            Some(&1)
        );
        assert_eq!(
            fixture
                .transport
                .send_counts
                .lock()
                .unwrap()
                .get(&capture_b),
            Some(&1)
        );
        assert_eq!(fixture.origin.request_count(), 2);

        let signed_result = fixture
            .delivery
            .result
            .lock()
            .unwrap()
            .take()
            .expect("B signed Result reaches the actual delivery boundary");
        let payload: serde_json::Value = serde_json::from_slice(signed_result.bytes()).unwrap();
        assert!(fixture.result_verifier.verify(&payload).is_ok());
        assert_eq!(
            payload["result"]["presentation_sha256"],
            URL_SAFE_NO_PAD.encode(sha256(&fixture.presentation_b))
        );
        assert_eq!(
            payload["result"]["binding_value"],
            fixture.session_b.binding.as_str()
        );
        assert_eq!(
            payload["result"]["request_transcript_sha256"],
            URL_SAFE_NO_PAD.encode(sha256(&fixture.expected_request))
        );
        assert!(!fixture
            .results
            .results
            .lock()
            .unwrap()
            .contains_key(&capture_b));
        assert_eq!(fixture.handoff.pending_len().unwrap(), 0);
        assert_eq!(
            fixture.verifier_calls.load(Ordering::SeqCst),
            expected_verifier_calls
        );
        assert_eq!(fixture.result_boundary_calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            fixture
                .transport
                .finished_captures
                .lock()
                .unwrap()
                .as_slice(),
            &[capture_a, capture_b]
        );
        assert_eq!(
            fixture.binding_completed.lock().unwrap().as_slice(),
            &[capture_a, capture_b]
        );
        fixture.origin.stop().await;
    }

    #[tokio::test]
    async fn forwarder_cancellation_after_presentation_publish_cleans_before_verifier() {
        let mut fixture =
            forwarder_cleanup_fixture(ForwarderPausePoint::BeforePresentationVerification).await;
        let capture_a = fixture.binding_a.capture_identifier();
        let response = timeout(
            std::time::Duration::from_secs(5),
            fixture.forwarder.forward(1, forwarder_test_request()),
        )
        .await
        .expect("capture A forward timed out")
        .unwrap()
        .expect("capture A must preserve its received origin response");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body().as_ref(), FORWARDER_LOOPBACK_BODY);

        timeout(
            std::time::Duration::from_secs(5),
            &mut fixture.pause_reached,
        )
        .await
        .expect("Presentation verification pause was not reached")
        .expect("forwarder pause channel closed unexpectedly");
        assert_eq!(
            fixture.forwarder.state().unwrap(),
            ExperimentalTlsnRuntimeState::ProofStarted
        );
        assert_eq!(
            fixture
                .handoff
                .pending_presentation_bytes_for_capture(&capture_a)
                .unwrap(),
            Some(fixture.presentation_a.clone())
        );
        assert_eq!(fixture.verifier_calls.load(Ordering::SeqCst), 0);
        assert_eq!(fixture.result_boundary_calls.load(Ordering::SeqCst), 0);
        let request_a = fixture.origin.next_request().await;
        assert_headerless_forwarder_request(
            &request_a,
            &fixture.expected_request,
            &fixture.binding_a,
            &fixture.binding_b,
        );
        assert_eq!(fixture.origin.request_count(), 1);

        fixture.forwarder.cancel().unwrap();
        wait_forwarder_state(&fixture.forwarder, ExperimentalTlsnRuntimeState::Cancelled).await;
        assert_eq!(
            fixture
                .handoff
                .pending_presentation_bytes_for_capture(&capture_a)
                .unwrap(),
            None
        );
        assert!(!fixture
            .results
            .results
            .lock()
            .unwrap()
            .contains_key(&capture_a));
        assert!(fixture.delivery.result.lock().unwrap().is_none());
        assert_eq!(
            fixture
                .transport
                .finished_captures
                .lock()
                .unwrap()
                .as_slice(),
            &[capture_a]
        );
        assert_eq!(
            fixture.binding_completed.lock().unwrap().as_slice(),
            &[capture_a]
        );
        assert!(
            fixture
                .pause_release
                .take()
                .expect("test pause release sender")
                .send(())
                .is_err(),
            "lifecycle cancellation must drop the paused verification future"
        );

        complete_forwarder_capture_b(&mut fixture, 1).await;
    }

    #[tokio::test]
    async fn forwarder_cancellation_after_worker_result_registration_cleans_before_persistence() {
        let mut fixture =
            forwarder_cleanup_fixture(ForwarderPausePoint::BeforeResultBoundary).await;
        let capture_a = fixture.binding_a.capture_identifier();
        let response = timeout(
            std::time::Duration::from_secs(5),
            fixture.forwarder.forward(1, forwarder_test_request()),
        )
        .await
        .expect("capture A forward timed out")
        .unwrap()
        .expect("capture A must preserve its received origin response");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body().as_ref(), FORWARDER_LOOPBACK_BODY);

        timeout(
            std::time::Duration::from_secs(5),
            &mut fixture.pause_reached,
        )
        .await
        .expect("Result boundary pause was not reached")
        .expect("forwarder pause channel closed unexpectedly");
        assert_eq!(
            fixture.forwarder.state().unwrap(),
            ExperimentalTlsnRuntimeState::Verified
        );
        assert_eq!(fixture.verifier_calls.load(Ordering::SeqCst), 1);
        assert_eq!(fixture.result_boundary_calls.load(Ordering::SeqCst), 0);
        {
            let results = fixture.results.results.lock().unwrap();
            let result_a = results
                .get(&capture_a)
                .expect("verified A Worker Result is registered before cancellation");
            assert_eq!(result_a.presentation.bytes(), fixture.presentation_a);
            assert_eq!(result_a.session.binding, fixture.session_a.binding);
            assert_eq!(result_a.request_sha256, sha256(&fixture.expected_request));
            assert_eq!(
                result_a.response_sha256,
                sha256(&forwarder_loopback_response())
            );
            assert!(
                fixture.result_verifier.verify(&result_a.payload).is_ok(),
                "A Worker Result signature must have passed the production verifier"
            );
        }
        assert!(fixture.delivery.result.lock().unwrap().is_none());
        let request_a = fixture.origin.next_request().await;
        assert_headerless_forwarder_request(
            &request_a,
            &fixture.expected_request,
            &fixture.binding_a,
            &fixture.binding_b,
        );
        assert_eq!(fixture.origin.request_count(), 1);

        fixture.forwarder.cancel().unwrap();
        wait_forwarder_state(&fixture.forwarder, ExperimentalTlsnRuntimeState::Cancelled).await;
        assert!(!fixture
            .results
            .results
            .lock()
            .unwrap()
            .contains_key(&capture_a));
        assert!(fixture.delivery.result.lock().unwrap().is_none());
        assert_eq!(
            fixture
                .transport
                .finished_captures
                .lock()
                .unwrap()
                .as_slice(),
            &[capture_a]
        );
        assert_eq!(
            fixture.binding_completed.lock().unwrap().as_slice(),
            &[capture_a]
        );
        assert!(
            fixture
                .pause_release
                .take()
                .expect("test pause release sender")
                .send(())
                .is_err(),
            "lifecycle cancellation must drop the paused Result boundary future"
        );

        complete_forwarder_capture_b(&mut fixture, 2).await;
    }

    #[tokio::test]
    async fn presentation_handoff_cleanup_is_capture_scoped_for_identical_requests() {
        let handoff = PresentationHandoff::new();
        let provider = HandoffPresentationProvider::new(Arc::clone(&handoff));
        let request = SerializedOriginRequest::new(Bytes::from_static(b"POST")).unwrap();
        let request_sha256 = sha256(request.bytes());
        let session_a = session_context_with_nonce([0x41; 32]);
        let session_b = session_context_with_nonce([0x42; 32]);
        let binding_a = AttestationBinding::new(session_a.binding.clone()).unwrap();
        let binding_b = AttestationBinding::new(session_b.binding.clone()).unwrap();
        let capture_a = binding_a.capture_identifier();
        let capture_b = binding_b.capture_identifier();

        assert_ne!(capture_a, capture_b);
        handoff
            .publish(
                capture_a,
                request_sha256,
                "presentation-a".to_owned(),
                b"presentation A".to_vec(),
            )
            .unwrap();
        handoff
            .publish(
                capture_b,
                request_sha256,
                "presentation-b".to_owned(),
                b"presentation B".to_vec(),
            )
            .unwrap();
        assert!(handoff
            .publish(
                capture_a,
                request_sha256,
                "duplicate-a".to_owned(),
                b"duplicate A".to_vec(),
            )
            .is_err());

        provider.discard_capture(&capture_a).unwrap();
        assert_eq!(handoff.pending_len().unwrap(), 1);
        assert_eq!(
            handoff.take_for_capture(&capture_a, &request_sha256),
            Err(crate::production_tlsn::PresentationError::Unavailable)
        );

        let exchange = exchange_for_request(request.bytes());
        let target = OriginTarget::new(
            "game.example.test".to_owned(),
            443,
            "game.example.test".to_owned(),
        )
        .unwrap();
        let context = PresentationRequestContext::from_exchange(
            RuntimeIdentifiers::default(),
            2,
            &binding_b,
            &request,
            &exchange,
            &target,
        );
        let presentation = provider.provide(context).await.unwrap();
        assert_eq!(presentation.identifier(), "presentation-b");
        assert_eq!(presentation.bytes(), b"presentation B");
        assert_eq!(handoff.pending_len().unwrap(), 0);
        assert!(handoff
            .publish(
                capture_b,
                request_sha256,
                "duplicate-b".to_owned(),
                b"duplicate B".to_vec(),
            )
            .is_err());
        provider.discard_capture(&capture_b).unwrap();
    }

    #[tokio::test]
    async fn verified_worker_results_are_capture_scoped_through_cancel_and_late_cleanup() {
        let request = SerializedOriginRequest::new(Bytes::from_static(b"POST")).unwrap();
        let request_sha256 = sha256(request.bytes());
        let session_a = session_context_with_nonce([0x51; 32]);
        let session_b = session_context_with_nonce([0x52; 32]);
        let binding_a = AttestationBinding::new(session_a.binding.clone()).unwrap();
        let binding_b = AttestationBinding::new(session_b.binding.clone()).unwrap();
        let capture_a = binding_a.capture_identifier();
        let capture_b = binding_b.capture_identifier();
        assert_ne!(capture_a, capture_b);

        let presentation_a = b"actual handoff Presentation A".to_vec();
        let presentation_b = b"actual handoff Presentation B".to_vec();
        let handoff = PresentationHandoff::new();
        handoff
            .publish(
                capture_a,
                request_sha256,
                "presentation-a".to_owned(),
                presentation_a.clone(),
            )
            .unwrap();
        handoff
            .publish(
                capture_b,
                request_sha256,
                "presentation-b".to_owned(),
                presentation_b.clone(),
            )
            .unwrap();

        let results = RemoteWorkerResultStore::new();
        let sessions = Arc::new(HashMap::from([
            (capture_a, session_a.clone()),
            (capture_b, session_b.clone()),
        ]));
        let result_verifier = result_signature_verifier_for_fixture();
        let backend = Arc::new(FixtureSignedWorkerBackend {
            result_verifier: Arc::clone(&result_verifier),
            results: Arc::clone(&results),
            sessions,
        });
        let target = OriginTarget::new(
            "game.example.test".to_owned(),
            443,
            "game.example.test".to_owned(),
        )
        .unwrap();
        let verifier_boundary = PresentationVerifierBoundary::new(
            Arc::new(HandoffPresentationProvider::new(Arc::clone(&handoff))),
            backend,
            target.clone(),
            RuntimeIdentifiers::default(),
        );
        let delivery = Arc::new(CapturingResultDelivery::default());
        let signer = Arc::new(RemoteWorkerResultSigner::new(
            Arc::clone(&results),
            PathBuf::new(),
        ));
        let result_boundary = SignedResultBoundary::new(
            signer as Arc<dyn ProductionResultSigner>,
            delivery.clone() as Arc<dyn ProductionResultDelivery>,
        );
        let exchange_a = exchange_for_request(request.bytes());

        let evidence_a = match verifier_boundary
            .verify(51, request.clone(), binding_a.clone(), exchange_a.clone())
            .await
            .unwrap()
        {
            VerificationOutcome::Verified(evidence) => evidence,
            VerificationOutcome::Deferred(_) => panic!("fixture Worker result was deferred"),
        };
        assert_eq!(evidence_a.metadata().binding_identifier(), &capture_a);
        assert_eq!(
            results
                .results
                .lock()
                .unwrap()
                .get(&capture_a)
                .unwrap()
                .presentation
                .bytes(),
            presentation_a
        );

        let duplicate_presentation =
            TlsnPresentation::new("presentation-a".to_owned(), presentation_a.clone()).unwrap();
        let duplicate_context = PresentationRequestContext::from_exchange(
            RuntimeIdentifiers::default(),
            52,
            &binding_a,
            &request,
            &exchange_a,
            &target,
        );
        let duplicate_payload = signed_result_payload_for_exchange(
            &duplicate_presentation,
            &session_a,
            "game.example.test",
            request.bytes(),
            &exchange_a.response.raw_response_bytes,
        )
        .0;
        let duplicate_body = serde_json::to_vec(&duplicate_payload).unwrap();
        assert_eq!(
            accept_worker_result(
                PresentationVerificationInput::new(
                    duplicate_context,
                    request.clone(),
                    binding_a.clone(),
                    exchange_a.clone(),
                    duplicate_presentation,
                ),
                session_a.clone(),
                "duplicate-device-signature".to_owned(),
                WorkerResponse {
                    payload: duplicate_payload,
                    body_bytes: duplicate_body,
                    verifier_execution_receipt_header_bytes: None,
                    verifier_execution_receipt_bytes: None,
                    status: 200,
                },
                &result_verifier,
                &results,
            ),
            Err(VerificationError::WorkerRejected),
            "duplicate Result registration for one capture must be refused",
        );

        verifier_boundary.finish_capture(&capture_a).unwrap();
        result_boundary.finish_capture(&capture_a).unwrap();
        assert!(!results.results.lock().unwrap().contains_key(&capture_a));

        let exchange_b = exchange_for_request(request.bytes());
        let evidence_b = match verifier_boundary
            .verify(53, request.clone(), binding_b.clone(), exchange_b.clone())
            .await
            .unwrap()
        {
            VerificationOutcome::Verified(evidence) => evidence,
            VerificationOutcome::Deferred(_) => panic!("fixture Worker result was deferred"),
        };
        assert_eq!(evidence_b.metadata().binding_identifier(), &capture_b);
        assert_eq!(
            results
                .results
                .lock()
                .unwrap()
                .get(&capture_b)
                .unwrap()
                .presentation
                .bytes(),
            presentation_b
        );

        verifier_boundary
            .finish_capture(&capture_a)
            .expect("late A Presentation cleanup only addresses A's capture key");
        result_boundary
            .finish_capture(&capture_a)
            .expect("late A Result cleanup only addresses A's capture key");
        {
            let stored = results.results.lock().unwrap();
            let result_b = stored.get(&capture_b).expect("B Result remains owned by B");
            assert_eq!(result_b.request_sha256, request_sha256);
            assert_eq!(result_b.response_sha256, sha256(b"HTTP/1.1 200 OK\r\n\r\n"));
            assert_eq!(result_b.presentation.bytes(), presentation_b);
            assert_eq!(result_b.session.binding, session_b.binding);
        }

        result_boundary.accept(evidence_b).await.unwrap();
        let signed_result = delivery
            .result
            .lock()
            .unwrap()
            .take()
            .expect("actual Result signer delivered B's signed Result");
        let payload: serde_json::Value = serde_json::from_slice(signed_result.bytes()).unwrap();
        assert_eq!(
            payload["result"]["presentation_sha256"],
            URL_SAFE_NO_PAD.encode(sha256(&presentation_b))
        );
        assert_eq!(
            payload["result"]["binding_value"],
            session_b.binding.as_str()
        );
        assert!(!results.results.lock().unwrap().contains_key(&capture_b));

        let duplicate_presentation =
            TlsnPresentation::new("presentation-b".to_owned(), presentation_b.clone()).unwrap();
        let duplicate_context = PresentationRequestContext::from_exchange(
            RuntimeIdentifiers::default(),
            54,
            &binding_b,
            &request,
            &exchange_b,
            &target,
        );
        let (duplicate_payload, _) = signed_result_payload_for_exchange(
            &duplicate_presentation,
            &session_b,
            "game.example.test",
            request.bytes(),
            &exchange_b.response.raw_response_bytes,
        );
        let duplicate_body = serde_json::to_vec(&duplicate_payload).unwrap();
        assert_eq!(
            accept_worker_result(
                PresentationVerificationInput::new(
                    duplicate_context,
                    request,
                    binding_b,
                    exchange_b,
                    duplicate_presentation,
                ),
                session_b,
                "duplicate-device-signature".to_owned(),
                WorkerResponse {
                    payload: duplicate_payload,
                    body_bytes: duplicate_body,
                    verifier_execution_receipt_header_bytes: None,
                    verifier_execution_receipt_bytes: None,
                    status: 200,
                },
                &result_verifier,
                &results,
            ),
            Err(VerificationError::WorkerRejected),
            "a consumed capture cannot be registered again before owner cleanup",
        );
        result_boundary.finish_capture(&capture_b).unwrap();
    }

    #[test]
    fn result_signature_verifier_export_bytes_are_canonical() {
        let (payload, _) = signed_result_payload();
        let bytes = serde_json::to_vec(&payload["result"]).unwrap();
        let result = fusou_tlsn_verifier::parse_verifier_result(&bytes, &ParserLimits::default())
            .expect("candidate inner Result must be accepted by the independent strict parser");
        assert_eq!(result.canonical_json().unwrap().as_bytes(), bytes);
        assert!(fusou_tlsn_verifier::parse_verifier_result(
            &serde_json::to_vec_pretty(&payload["result"]).unwrap(),
            &ParserLimits::default(),
        )
        .is_err());
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

        let mut mutated_presentation = payload.clone();
        mutated_presentation["result"]["presentation_sha256"] =
            serde_json::Value::String(URL_SAFE_NO_PAD.encode([0x99_u8; 32]));
        assert!(verifier.verify(&mutated_presentation).is_err());

        let mut mutated_provenance = payload.clone();
        mutated_provenance["result"]["origin_inventory_sha256"] =
            serde_json::Value::String(URL_SAFE_NO_PAD.encode([0x31_u8; 32]));
        mutated_provenance["result"]["target_approval_artifact_sha256"] =
            serde_json::Value::String(URL_SAFE_NO_PAD.encode([0x32_u8; 32]));
        assert!(verifier.verify(&mutated_provenance).is_err());

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

    #[test]
    fn result_registry_not_after_is_inclusive_at_the_boundary() {
        let not_before = DateTime::parse_from_rfc3339("2026-10-23T23:59:59.000Z")
            .unwrap()
            .with_timezone(&Utc);
        let not_after = DateTime::parse_from_rfc3339("2026-10-24T00:00:00.000Z")
            .unwrap()
            .with_timezone(&Utc);
        assert!(result_signer_validity_window_contains(
            &not_before,
            Some(&not_after),
            &not_after,
        ));
        assert!(result_signer_validity_window_contains(
            &not_after, None, &not_after
        ));
        let after_expiry = not_after + chrono::Duration::nanoseconds(1);
        assert!(!result_signer_validity_window_contains(
            &not_before,
            Some(&not_after),
            &after_expiry,
        ));
    }

    #[test]
    fn result_signature_verifier_rejects_invalid_expected_and_registry_key_ids() {
        let (_, public_key_spki) = signed_result_payload();
        let valid_registry =
            result_registry(&public_key_spki, "ACTIVE", "2020-01-01T00:00:00.000Z", None);
        assert!(ResultSignatureVerifier::new(
            public_key_spki.clone(),
            "invalid key ID".to_owned(),
            valid_registry,
        )
        .is_err());

        let invalid_registry =
            result_registry(&public_key_spki, "ACTIVE", "2020-01-01T00:00:00.000Z", None)
                .replace("result-signer-2026", "invalid key ID");
        assert!(ResultSignatureVerifier::new(
            public_key_spki,
            "result-signer-2026".to_owned(),
            invalid_registry,
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
        let binding = AttestationBinding::new(binding.to_owned()).unwrap();
        handoff
            .publish(
                binding.capture_identifier(),
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
        boundary.verify(1, request, binding, exchange).await
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
        let issued_at_ms = DateTime::parse_from_rfc3339(&receipt.created_at)
            .unwrap()
            .timestamp_millis() as u64;
        let expires_at_ms = DateTime::parse_from_rfc3339(&receipt.expires_at)
            .unwrap()
            .timestamp_millis() as u64;
        let device_challenge_bytes = [9_u8; 32];
        let grant_signing_bytes = SessionContextGrant::signing_bytes_for(
            &receipt.signer_key_id,
            &receipt.session_id,
            &receipt.binding_value,
            device_id_commitment(&receipt.device_id).unwrap(),
            device_challenge_bytes,
            issued_at_ms,
            expires_at_ms,
        )
        .unwrap();
        let mut grant_bytes = grant_signing_bytes;
        let grant_signature = key_pair.sign(&grant_bytes);
        grant_bytes.extend_from_slice(grant_signature.as_ref());
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
            session_context_grant: URL_SAFE_NO_PAD.encode(grant_bytes),
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

        assert!(verify_session_receipt(
            &authority.session_receipt,
            &authority,
            &"f".repeat(64),
            &public_key_spki,
            "session-authority-2026",
        )
        .is_err());

        let mut wrong_session = authority.clone();
        wrong_session.session_id = "550e8400-e29b-41d4-a716-446655440001".to_owned();
        assert!(verify_session_receipt(
            &wrong_session.session_receipt,
            &wrong_session,
            &receipt.device_auth_nonce,
            &public_key_spki,
            "session-authority-2026",
        )
        .is_err());

        let mut wrong_device = authority.clone();
        wrong_device.device_id = "7c9e6679-7425-40de-944b-e07fc1f90ae8".to_owned();
        assert!(verify_session_receipt(
            &wrong_device.session_receipt,
            &wrong_device,
            &receipt.device_auth_nonce,
            &public_key_spki,
            "session-authority-2026",
        )
        .is_err());

        let mut expired = authority.clone();
        let expired_at = (Utc::now() - chrono::Duration::seconds(1)).to_rfc3339();
        expired.expires_at = expired_at.clone();
        expired.session_receipt.expires_at = expired_at;
        assert!(verify_session_receipt(
            &expired.session_receipt,
            &expired,
            &receipt.device_auth_nonce,
            &public_key_spki,
            "session-authority-2026",
        )
        .is_err());

        let mut invalid_signature = authority.clone();
        invalid_signature.session_receipt.signature = URL_SAFE_NO_PAD.encode([0_u8; 64]);
        assert!(verify_session_receipt(
            &invalid_signature.session_receipt,
            &invalid_signature,
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
    fn web_device_auth_nonce_requires_lowercase_sha256_hex() {
        assert!(is_web_device_auth_nonce(&"a1".repeat(32)));
        assert!(!is_web_device_auth_nonce(&"A1".repeat(32)));
        assert!(!is_web_device_auth_nonce(&"0".repeat(63)));
        assert!(!is_web_device_auth_nonce(&"g".repeat(64)));
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

    #[tokio::test]
    async fn worker_response_preserves_exact_body_and_detached_receipt_bytes() {
        let exact_body = "{ \"verified\" : true, \"result\" : {\"id\":1} }\n";
        let receipt_bytes = b"detached execution receipt";
        let encoded_receipt = URL_SAFE_NO_PAD.encode(receipt_bytes);
        let expected_receipt_header = encoded_receipt.as_bytes().to_vec();
        let route = warp::any().map(move || {
            warp::reply::with_header(
                warp::reply::with_status(exact_body.to_owned(), warp::http::StatusCode::OK),
                "X-FUSOU-TLSN-Verifier-Execution-Receipt",
                encoded_receipt.clone(),
            )
        });
        let (address, server) = warp::serve(route).bind_ephemeral(([127, 0, 0, 1], 0));
        let server = tokio::spawn(server);
        let response = reqwest::Client::new()
            .get(format!("http://{address}/result"))
            .send()
            .await
            .expect("request local Worker response fixture");

        let captured = worker_response(response)
            .await
            .expect("parse exact Worker response");
        server.abort();
        assert_eq!(captured.status, 200);
        assert_eq!(captured.body_bytes, exact_body.as_bytes());
        assert_eq!(
            captured.verifier_execution_receipt_header_bytes,
            Some(expected_receipt_header)
        );
        assert_eq!(
            captured.verifier_execution_receipt_bytes,
            Some(receipt_bytes.to_vec())
        );
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
                AppPublicConfigurationFingerprints, FilesystemPresentationArtifactSink,
                HandoffPresentationProvider, OriginTarget, OriginTlsConfig,
                ProductionTlsnDependencies, RuntimeIdentifiers, ServerIdentityPolicy,
            },
            synthetic_tlsn::{synthetic_require_info_request, SYNTHETIC_SERVER_IDENTITY},
        };
        use fusou_auth::manager::AuthConfig;
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
            expected_tls: OriginTlsConfig,
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
                let expected_tls = self.expected_tls.clone();
                Box::pin(async move {
                    if config.target().server_identity() != SYNTHETIC_SERVER_IDENTITY
                        || config.tls() != &expected_tls
                        || request.bytes() != expected_request
                    {
                        return Err(TlsnTransportError::OriginConnectionFailed);
                    }
                    let request_sha256 = sha256(request.bytes());
                    let capture_identifier = *request
                        .capture_identifier()
                        .ok_or(TlsnTransportError::RuntimeConfigUnavailable)?;
                    let response_sha256 = sha256(&response);
                    let parsed = parse_http_response(response)?;
                    let presentation_identifier = URL_SAFE_NO_PAD.encode(sha256(&presentation));
                    let proof = ProofContinuation::new(Box::pin(async move {
                        handoff
                            .publish(
                                capture_identifier,
                                request_sha256,
                                presentation_identifier,
                                presentation,
                            )
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
            let challenge_endpoint = required_env("FUSOU_TLSN_APP_E2E_CHALLENGE_ENDPOINT");
            let challenge_url =
                reqwest::Url::parse(&challenge_endpoint).expect("valid local Web challenge URL");
            assert_eq!(challenge_url.scheme(), "http");
            assert!(challenge_url
                .host_str()
                .is_some_and(|host| matches!(host, "127.0.0.1" | "localhost" | "::1")));
            configs::set_user_config(&required_env("FUSOU_TLSN_APP_E2E_CONFIG_PATH"))
                .expect("initialize synthetic APP configuration");
            assert_eq!(
                configs::get_user_configs_for_app()
                    .auth
                    .get_anonymous_sync_v2_challenge_endpoint(),
                Some(challenge_endpoint),
                "APP challenge must use the configured local fixture, not embedded defaults",
            );
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
            assert!(matches!(
                auth_manager
                    .fetch_anonymous_sync_v2_challenge("00000000-0000-4000-8000-000000000000")
                    .await,
                Err(fusou_auth::error::AuthError::DeviceUnknownOrRevoked),
            ));
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
            let origin_tls = OriginTlsConfig::new().expect("platform trust store is available");
            assert!(
                !origin_tls
                    .trusted_root_certificates()
                    .contains(&root_certificate),
                "synthetic Origin CA must not be installed into the platform trust store",
            );
            let origin = OriginTransportConfig::new(
                OriginTarget::new(
                    SYNTHETIC_SERVER_IDENTITY.to_owned(),
                    443,
                    SYNTHETIC_SERVER_IDENTITY.to_owned(),
                )
                .expect("valid synthetic target"),
                origin_tls.clone(),
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
                    expected_tls: origin_tls,
                }),
                Arc::new(HandoffPresentationProvider::new(Arc::clone(&handoff))),
                verification_backend,
                Arc::new(
                    RemoteWorkerResultSigner::new(worker_results, artifact_root.clone())
                        .with_candidate_capture_enabled(true),
                ),
                Arc::new(FilesystemResultDelivery::new(artifact_root.join("results"))),
            )
            .with_presentation_artifact_sink(Arc::new(FilesystemPresentationArtifactSink::new(
                artifact_root.clone(),
            )))
            .with_identifiers(
                RuntimeIdentifiers::new(Some("app-worker-synthetic-e2e".to_owned()), None, None)
                    .with_app_public_configuration_fingerprints(
                        AppPublicConfigurationFingerprints {
                            schema_version: 2,
                            scope: "fusou-tlsn-app-public-configuration".to_owned(),
                            compile_time_sha256: required_env(
                                "FUSOU_TLSN_APP_E2E_COMPILE_TIME_SHA256",
                            ),
                            runtime_sha256: required_env("FUSOU_TLSN_APP_E2E_RUNTIME_SHA256"),
                            combined_sha256: required_env(
                                "FUSOU_TLSN_APP_E2E_CONFIGURATION_SHA256",
                            ),
                            candidate_binding_status: "UNBOUND".to_owned(),
                        },
                    ),
            )
            .build_forwarder()
            .expect("build production TLSN forwarder");

            let response = forwarder
                .forward(1, synthetic_require_info_request())
                .await
                .expect("forward synthetic request")
                .expect("synthetic capture returns an origin response");
            assert_eq!(response.status(), StatusCode::OK);
            let response_body = response.into_body();
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
