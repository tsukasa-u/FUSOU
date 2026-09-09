use crate::{
    experimental_tlsn::{
        sha256, AttestationBinding, BindingError, BindingFuture, BindingRequestContext,
        SerializedOriginRequest, TlsnOriginExchange, TlsnOriginResponse, TlsnTransportError,
    },
    production_tlsn::{Alpha15OriginTransportFactory, OriginTransportConfig, PresentationHandoff},
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
use serde::Deserialize;
use std::{
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
    device_challenge: String,
}

pub struct RemoteWorkerResultSigner {
    endpoint: String,
    client: reqwest::Client,
    auth_manager: AuthManager<FileStorage>,
    device_key_path: PathBuf,
    binding_state: Arc<Mutex<Option<SessionBindingContext>>>,
    handoff: Arc<PresentationHandoff>,
}

impl RemoteWorkerResultSigner {
    pub fn new(
        endpoint: String,
        auth_manager: AuthManager<FileStorage>,
        device_key_path: PathBuf,
        binding_state: Arc<Mutex<Option<SessionBindingContext>>>,
        handoff: Arc<PresentationHandoff>,
    ) -> Result<Self, crate::production_tlsn::ResultSignerError> {
        let parsed = reqwest::Url::parse(endpoint.trim())
            .map_err(|_| crate::production_tlsn::ResultSignerError::Unavailable)?;
        if parsed.scheme() != "https" || parsed.host_str().is_none() {
            return Err(crate::production_tlsn::ResultSignerError::Unavailable);
        }
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| crate::production_tlsn::ResultSignerError::Unavailable)?;
        Ok(Self {
            endpoint,
            client,
            auth_manager,
            device_key_path,
            binding_state,
            handoff,
        })
    }
}

impl crate::production_tlsn::ProductionResultSigner for RemoteWorkerResultSigner {
    fn sign(
        &self,
        _evidence: crate::experimental_tlsn::VerifiedTlsnEvidence,
    ) -> crate::production_tlsn::ResultSignerFuture {
        let endpoint = self.endpoint.clone();
        let client = self.client.clone();
        let auth_manager = self.auth_manager.clone();
        let device_key_path = self.device_key_path.clone();
        let binding_state = Arc::clone(&self.binding_state);
        let handoff = Arc::clone(&self.handoff);
        Box::pin(async move {
            let session = binding_state
                .lock()
                .map_err(|_| crate::production_tlsn::ResultSignerError::Failed)?
                .take()
                .ok_or(crate::production_tlsn::ResultSignerError::Unavailable)?;
            let presentation = handoff
                .take_consumed()
                .map_err(|_| crate::production_tlsn::ResultSignerError::Unavailable)?;
            let device_key = DeviceKey::load_or_create(device_key_path)
                .await
                .map_err(|_| crate::production_tlsn::ResultSignerError::Unavailable)?;
            if device_key.device_id() != Some(session.device_id()) {
                return Err(crate::production_tlsn::ResultSignerError::Failed);
            }
            let access_token = auth_manager
                .get_access_token()
                .await
                .map_err(|_| crate::production_tlsn::ResultSignerError::Unavailable)?;
            let challenge = URL_SAFE_NO_PAD
                .decode(session.device_challenge())
                .map_err(|_| crate::production_tlsn::ResultSignerError::Failed)?;
            if challenge.len() != 32 {
                return Err(crate::production_tlsn::ResultSignerError::Failed);
            }
            let signing_bytes = tlsn_device_proof_signing_bytes(
                session.device_id(),
                session.session_id(),
                session.binding(),
                &challenge,
            )
            .map_err(|_| crate::production_tlsn::ResultSignerError::Failed)?;
            let response = client
                .post(endpoint)
                .bearer_auth(access_token)
                .json(&serde_json::json!({
                    "presentation_base64": URL_SAFE_NO_PAD.encode(presentation.bytes()),
                    "session_id": session.session_id(),
                    "device_id": session.device_id(),
                    "binding": session.binding(),
                    "device_proof": {
                        "challenge": session.device_challenge(),
                        "sig": device_key.sign_b64(&signing_bytes),
                    },
                }))
                .send()
                .await
                .map_err(|_| crate::production_tlsn::ResultSignerError::Unavailable)?;
            if !response.status().is_success() {
                return Err(crate::production_tlsn::ResultSignerError::Failed);
            }
            let payload: serde_json::Value = response
                .json()
                .await
                .map_err(|_| crate::production_tlsn::ResultSignerError::Failed)?;
            if payload.get("verified") != Some(&serde_json::Value::Bool(true)) {
                return Err(crate::production_tlsn::ResultSignerError::Failed);
            }
            let result = payload
                .get("result")
                .ok_or(crate::production_tlsn::ResultSignerError::Failed)?;
            let key_id = result
                .get("signer_key_id")
                .and_then(serde_json::Value::as_str)
                .ok_or(crate::production_tlsn::ResultSignerError::Failed)?;
            let bytes = serde_json::to_vec(&payload)
                .map_err(|_| crate::production_tlsn::ResultSignerError::Failed)?;
            crate::production_tlsn::SignedTlsnResult::new(key_id.to_owned(), bytes)
                .map_err(|_| crate::production_tlsn::ResultSignerError::Failed)
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

#[derive(Debug, Clone, Deserialize)]
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
                    "sig": device_key.sign_b64(nonce.as_bytes()),
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
            if authority.challenge != nonce
                || authority.device_id != device_id
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
            verify_session_receipt(
                &authority.session_receipt,
                &authority,
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
                device_challenge: authority.device_challenge,
            });
            AttestationBinding::new(authority.binding).map_err(|_| BindingError::InvalidBinding)
        })
    }
}

fn verify_session_receipt(
    receipt: &SessionReceipt,
    authority: &SessionAuthorityResponse,
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
        || receipt.device_auth_nonce != authority.challenge
        || receipt.nonce != URL_SAFE_NO_PAD.encode(parsed_binding.binding_nonce)
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

impl crate::production_tlsn::DedicatedTlsnVerifier for RealAlpha15DedicatedVerifier {
    fn verify(
        &self,
        context: crate::production_tlsn::PresentationRequestContext,
        request: SerializedOriginRequest,
        binding: crate::experimental_tlsn::AttestationBinding,
        exchange: TlsnOriginExchange,
        presentation: crate::production_tlsn::TlsnPresentation,
    ) -> crate::experimental_tlsn::VerificationFuture {
        let server_identity = self.server_identity.clone();
        let notary_verifying_key = self.notary_verifying_key.clone();
        Box::pin(async move {
            if context.server_identity() != server_identity {
                return Err(crate::experimental_tlsn::VerificationError::ServerIdentityMismatch);
            }
            let transcript = fusou_tlsn_verifier::tlsn_alpha15::verify_alpha15_presentation_with_trusted_notary_key(
                presentation.bytes(),
                &notary_verifying_key,
            )
            .map_err(|_| crate::experimental_tlsn::VerificationError::PresentationInvalid)?;
            if transcript.server_identity() != server_identity
                || transcript.request_transcript_sha256() != context.authenticated_request_sha256()
                || transcript.response_transcript_sha256()
                    != context.authenticated_response_sha256()
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
            Ok(
                crate::experimental_tlsn::VerifiedTlsnEvidence::from_verifier(
                    request_sha256,
                    response_sha256,
                    crate::experimental_tlsn::VerifiedMemberId::from_verifier(
                        verified.verified_member_id,
                    )?,
                ),
            )
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
) -> Result<TlsnOriginExchange, TlsnTransportError> {
    let parsed_request = parse_require_info_request(
        request.bytes(),
        config.target().server_identity(),
        &ParserLimits::default(),
    )
    .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;

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
                .max_sent_data(MAX_SENT_DATA)
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
    let response = parse_http_response(&raw_response)?;
    transport
        .close()
        .await
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;

    let mut prover = prover_task
        .await
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    let transcript_commit = {
        let transcript = HttpTranscript::parse(prover.transcript())
            .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
        let mut commit_builder = TranscriptCommitConfig::builder(prover.transcript());
        DefaultHttpCommitter::default()
            .commit_transcript(&mut commit_builder, &transcript)
            .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
        commit_builder
            .build()
            .map_err(|_| TlsnTransportError::ResponseReadFailed)?
    };

    let mut request_config_builder = RequestConfig::builder();
    request_config_builder.transcript_commit(transcript_commit.clone());
    let request_config = request_config_builder
        .build()
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    let mut prove_builder = ProveConfig::builder(prover.transcript());
    prove_builder
        .transcript_commit(transcript_commit)
        .server_identity();
    prove_builder
        .reveal_sent_all()
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    prove_builder
        .reveal_recv_all()
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    let prove_config = prove_builder
        .build()
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    let ProverOutput {
        transcript_commitments,
        transcript_secrets,
        ..
    } = prover
        .prove(&prove_config)
        .await
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    let prover_transcript = prover.transcript().clone();
    let tls_transcript = prover.tls_transcript().clone();
    let handshake_data = HandshakeData {
        certs: tls_transcript
            .server_cert_chain()
            .ok_or(TlsnTransportError::ResponseReadFailed)?
            .to_vec(),
        sig: tls_transcript
            .server_signature()
            .ok_or(TlsnTransportError::ResponseReadFailed)?
            .clone(),
        binding: tls_transcript.certificate_binding().clone(),
    };
    let mut attestation_builder = AttestationRequest::builder(&request_config);
    attestation_builder
        .server_name(ServerName::Dns(
            DnsName::try_from(config.target().server_identity())
                .map_err(|_| TlsnTransportError::ResponseReadFailed)?,
        ))
        .handshake_data(handshake_data)
        .transcript(prover_transcript)
        .transcript_commitments(transcript_secrets, transcript_commitments);
    let (attestation_request, secrets) = attestation_builder
        .build(&CryptoProvider::default())
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    prover
        .close()
        .await
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;

    handle.close();
    let mut notary_socket = driver_task
        .await
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?
        .map_err(|_| TlsnTransportError::OriginConnectionFailed)?;
    let request_bytes = bincode::serialize(&attestation_request)
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    notary_socket
        .write_all(&request_bytes)
        .await
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    notary_socket
        .close()
        .await
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    let mut attestation_bytes = Vec::new();
    notary_socket
        .read_to_end(&mut attestation_bytes)
        .await
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    let attestation: Attestation = bincode::deserialize(&attestation_bytes)
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    attestation_request
        .validate(&attestation, &CryptoProvider::default())
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    let presentation = build_presentation(&attestation, &secrets)?;
    let presentation_bytes =
        bincode::serialize(&presentation).map_err(|_| TlsnTransportError::ResponseReadFailed)?;
    handoff
        .publish(
            sha256(request.bytes()),
            hex_identifier(&presentation_bytes),
            presentation_bytes,
        )
        .map_err(|_| TlsnTransportError::ResponseReadFailed)?;

    Ok(TlsnOriginExchange {
        response: TlsnOriginResponse::new(
            response.status,
            response.headers,
            response.body,
            response.raw_response_bytes,
        ),
        transcript: crate::experimental_tlsn::UnverifiedTlsnTranscript {
            request_sha256: sha256(request.bytes()),
            response_sha256: sha256(&raw_response),
        },
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

fn parse_http_response(raw: &[u8]) -> Result<ParsedHttpResponse, TlsnTransportError> {
    let header_end = raw
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or(TlsnTransportError::ResponseReadFailed)?;
    let head = &raw[..header_end];
    let body = &raw[header_end + 4..];
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
        body: Bytes::copy_from_slice(body),
        raw_response_bytes: Bytes::copy_from_slice(raw),
    })
}

fn hex_identifier(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = sha256(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::signature::{Ed25519KeyPair, KeyPair};

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
            challenge: receipt.device_auth_nonce.clone(),
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
            &public_key_spki,
            "session-authority-2026",
        )
        .unwrap();

        let mut mutated_receipt = authority.session_receipt.clone();
        mutated_receipt.binding_value.push('A');
        assert!(verify_session_receipt(
            &mutated_receipt,
            &authority,
            &public_key_spki,
            "session-authority-2026",
        )
        .is_err());
    }
}
