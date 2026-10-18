use std::collections::{BTreeMap, BTreeSet};

use authenticity_core::{is_valid_key_id, ServerIdentity};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, SecondsFormat, Utc};
#[cfg(feature = "tlsn-production")]
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
#[cfg(feature = "tlsn-production")]
use std::time::Duration;
#[cfg(feature = "tlsn-production")]
use std::{future::Future, pin::Pin};
use url::{Host, Url};

const MANIFEST_SCHEMA_VERSION: u32 = 2;
const MANIFEST_SCOPE: &str = "fusou-tlsn-runtime-config-manifest-v2";
const ENVELOPE_SCOPE: &str = "fusou-tlsn-runtime-config-envelope-v2";
const TRUST_SCOPE: &str = "fusou-tlsn-runtime-config-signing-root-v2";
const SIGNATURE_ALGORITHM: &str = "Ed25519";
const SIGNATURE_DOMAIN: &[u8] = b"FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-V2\0";
const ED25519_SPKI_PREFIX: &[u8] = b"\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00";
const RESULT_REGISTRY_SCOPE: &str = "tlsn-result-signing-key-registry";
#[cfg(feature = "tlsn-production")]
const RESULT_REGISTRY_ENVELOPE_SCOPE: &str = "fusou-result-signing-key-registry-envelope";
#[cfg(feature = "tlsn-production")]
const ORIGIN_INVENTORY_SOURCE: &str =
    "packages/configs/configs.toml:[app.connect_kc_server.server_list]";
const MAX_SAFE_JS_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_SAFE_POLICY_SECONDS: u64 = MAX_SAFE_JS_INTEGER / 1_000;
const COMPILE_INPUT_NAMES: [&str; 15] = [
    "FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID",
    "FUSOU_TLSN_EXPECTED_BINDING_MODE",
    "FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID",
    "FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA",
    "FUSOU_TLSN_EXPECTED_WORKER_NAME",
    "FUSOU_TLSN_NOTARY_ENDPOINT",
    "FUSOU_TLSN_NOTARY_VERIFYING_KEY",
    "FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI",
    "FUSOU_TLSN_RESULT_SIGNER_KEY_ID",
    "FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY",
    "FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT",
    "FUSOU_TLSN_SESSION_AUTHORITY_ENDPOINT",
    "FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID",
    "FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY",
    "FUSOU_TLSN_VERIFICATION_ENDPOINT",
];

#[derive(Debug, PartialEq, Eq)]
pub enum RuntimeConfigManifestError {
    Invalid(&'static str),
    InvalidSignature,
    InvalidResultRegistrySignature,
    Transport(&'static str),
    State(&'static str),
}

impl std::fmt::Display for RuntimeConfigManifestError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(reason) => {
                write!(
                    formatter,
                    "runtime configuration manifest is invalid: {reason}"
                )
            }
            Self::InvalidSignature => {
                formatter.write_str("runtime configuration signature verification failed")
            }
            Self::InvalidResultRegistrySignature => {
                formatter.write_str("Result registry signature verification failed")
            }
            Self::Transport(reason) => {
                write!(
                    formatter,
                    "runtime configuration transport failed: {reason}"
                )
            }
            Self::State(reason) => {
                write!(formatter, "runtime configuration state failed: {reason}")
            }
        }
    }
}

impl std::error::Error for RuntimeConfigManifestError {}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RuntimeConfigManifestSource {
    pub worker_reference_sha256: String,
    pub observed_at: String,
    pub account_id: String,
    pub script_name: String,
    pub logical_deployment_id: String,
    pub cloudflare_deployment_id: String,
    pub active_version_id: String,
    pub worker_git_commit_sha: String,
    pub disclosure_mode: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProductionAuthorityPins {
    pub origin_inventory_sha256: String,
    pub target_approval_artifact_sha256: String,
    pub security_registry_set_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ResultRegistryPins {
    pub result_registry_sha256: String,
    pub result_registry_envelope_sha256: String,
    pub result_registry_root_key_id: String,
    pub result_registry_root_public_key_spki: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RuntimeConfigManifestPayload {
    pub schema_version: u32,
    pub scope: String,
    pub environment: String,
    pub epoch: String,
    pub issued_at: String,
    pub not_before: String,
    pub expires_at: String,
    pub source: RuntimeConfigManifestSource,
    pub compile_inputs: BTreeMap<String, String>,
    pub production_authority_pins: ProductionAuthorityPins,
    pub result_registry_pins: ResultRegistryPins,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RuntimeConfigManifestEnvelope {
    schema_version: u32,
    scope: String,
    signature_algorithm: String,
    signer_key_id: String,
    payload_base64url: String,
    signature_base64url: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeConfigTrustedSigner {
    pub scope: String,
    pub key_id: String,
    pub public_key_spki: String,
}

const RUNTIME_CONFIG_MANIFEST_URL_PATH: &str = "/tlsn/runtime-config/v2/manifest.json";
#[cfg(feature = "tlsn-production")]
const MAX_RUNTIME_CONFIG_ARTIFACT_BYTES: usize = 1_048_576;
const EMBEDDED_RUNTIME_CONFIG_MANIFEST_URL: Option<&str> = None;
const EMBEDDED_RUNTIME_CONFIG_SIGNER_KEY_ID: Option<&str> = None;
const EMBEDDED_RUNTIME_CONFIG_SIGNER_PUBLIC_KEY_SPKI: Option<&str> = None;

#[derive(Clone, Debug)]
pub struct RuntimeConfigBootstrap {
    manifest_url: Url,
    trusted_signer: RuntimeConfigTrustedSigner,
}

impl RuntimeConfigBootstrap {
    pub fn from_embedded() -> Result<Self, RuntimeConfigManifestError> {
        let (Some(manifest_url), Some(key_id), Some(public_key_spki)) = (
            EMBEDDED_RUNTIME_CONFIG_MANIFEST_URL,
            EMBEDDED_RUNTIME_CONFIG_SIGNER_KEY_ID,
            EMBEDDED_RUNTIME_CONFIG_SIGNER_PUBLIC_KEY_SPKI,
        ) else {
            return Err(RuntimeConfigManifestError::Invalid(
                "Production Runtime Config bootstrap is not registered",
            ));
        };
        let bootstrap = Self {
            manifest_url: validate_runtime_config_manifest_url(manifest_url)?,
            trusted_signer: RuntimeConfigTrustedSigner {
                scope: TRUST_SCOPE.to_owned(),
                key_id: key_id.to_owned(),
                public_key_spki: public_key_spki.to_owned(),
            },
        };
        validate_trusted_signer(&bootstrap.trusted_signer)?;
        Ok(bootstrap)
    }

    #[cfg(test)]
    pub(crate) fn for_test(
        manifest_url: &str,
        trusted_signer: RuntimeConfigTrustedSigner,
    ) -> Result<Self, RuntimeConfigManifestError> {
        let bootstrap = Self {
            manifest_url: validate_runtime_config_manifest_url(manifest_url)?,
            trusted_signer,
        };
        validate_trusted_signer(&bootstrap.trusted_signer)?;
        Ok(bootstrap)
    }
}

#[cfg(feature = "tlsn-production")]
pub(crate) trait RuntimeConfigObjectFetcher: Send + Sync {
    fn fetch<'a>(
        &'a self,
        url: Url,
        max_bytes: usize,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<u8>, RuntimeConfigManifestError>> + Send + 'a>>;
}

#[derive(Clone, Debug)]
pub struct RuntimeConfigVerificationPolicy {
    pub now: DateTime<Utc>,
    pub last_accepted_epoch: String,
    pub last_accepted_manifest_sha256: Option<String>,
    pub max_lifetime_seconds: u64,
    pub max_clock_skew_seconds: u64,
    pub max_reference_age_seconds: u64,
    pub max_envelope_bytes: usize,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct RuntimeConfigIndependentVerificationInputs<'a> {
    pub worker_reference_raw: Option<&'a [u8]>,
    pub origin_inventory_raw: Option<&'a [u8]>,
    pub target_approval_raw: Option<&'a [u8]>,
    pub security_registry_set_raw: Option<&'a [u8]>,
    pub result_registry_envelope_raw: Option<&'a [u8]>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeConfigIndependentVerificationSummary {
    pub worker_reference_sha256: String,
    pub origin_inventory_sha256: String,
    pub target_approval_artifact_sha256: String,
    pub security_registry_set_sha256: String,
    pub result_registry_sha256: String,
    pub result_registry_envelope_sha256: String,
    pub result_registry_root_key_id: String,
    pub result_signer_key_id: String,
    pub result_signer_public_key_spki: String,
    pub approved_targets: Vec<RuntimeConfigApprovedTarget>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeConfigApprovedTarget {
    server_index: u32,
    server_identity: String,
    port: u16,
}

impl RuntimeConfigApprovedTarget {
    pub fn server_index(&self) -> u32 {
        self.server_index
    }

    pub fn server_identity(&self) -> &str {
        &self.server_identity
    }

    pub fn port(&self) -> u16 {
        self.port
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeConfigWorkerInput {
    ExpectedActiveVersionId,
    ExpectedBindingMode,
    ExpectedDeploymentId,
    ExpectedGitCommitSha,
    ExpectedWorkerName,
    NotaryEndpoint,
    NotaryVerifyingKey,
    ResultPublicKeySpki,
    ResultSignerKeyId,
    ResultSigningKeyRegistry,
    RuntimeAttestationEndpoint,
    SessionAuthorityEndpoint,
    SessionAuthorityKeyId,
    SessionAuthorityPublicKey,
    VerificationEndpoint,
}

impl RuntimeConfigWorkerInput {
    fn key(self) -> &'static str {
        match self {
            Self::ExpectedActiveVersionId => "FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID",
            Self::ExpectedBindingMode => "FUSOU_TLSN_EXPECTED_BINDING_MODE",
            Self::ExpectedDeploymentId => "FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID",
            Self::ExpectedGitCommitSha => "FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA",
            Self::ExpectedWorkerName => "FUSOU_TLSN_EXPECTED_WORKER_NAME",
            Self::NotaryEndpoint => "FUSOU_TLSN_NOTARY_ENDPOINT",
            Self::NotaryVerifyingKey => "FUSOU_TLSN_NOTARY_VERIFYING_KEY",
            Self::ResultPublicKeySpki => "FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI",
            Self::ResultSignerKeyId => "FUSOU_TLSN_RESULT_SIGNER_KEY_ID",
            Self::ResultSigningKeyRegistry => "FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY",
            Self::RuntimeAttestationEndpoint => "FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT",
            Self::SessionAuthorityEndpoint => "FUSOU_TLSN_SESSION_AUTHORITY_ENDPOINT",
            Self::SessionAuthorityKeyId => "FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID",
            Self::SessionAuthorityPublicKey => "FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY",
            Self::VerificationEndpoint => "FUSOU_TLSN_VERIFICATION_ENDPOINT",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedRuntimeConfigManifest {
    payload: RuntimeConfigManifestPayload,
    independent_verification: RuntimeConfigIndependentVerificationSummary,
    manifest_sha256: String,
}

impl VerifiedRuntimeConfigManifest {
    pub fn payload(&self) -> &RuntimeConfigManifestPayload {
        &self.payload
    }

    pub fn independent_verification(&self) -> &RuntimeConfigIndependentVerificationSummary {
        &self.independent_verification
    }

    pub fn worker_input(&self, input: RuntimeConfigWorkerInput) -> &str {
        self.payload
            .compile_inputs
            .get(input.key())
            .map(String::as_str)
            .expect("verified manifest contains the complete Worker input inventory")
    }

    pub fn approved_targets(&self) -> &[RuntimeConfigApprovedTarget] {
        &self.independent_verification.approved_targets
    }

    pub fn approved_target(&self, server_identity: &str) -> Option<&RuntimeConfigApprovedTarget> {
        let server_identity = ServerIdentity::new(server_identity).ok()?;
        self.approved_targets()
            .iter()
            .find(|target| target.server_identity == server_identity.as_str())
    }

    pub fn manifest_sha256(&self) -> &str {
        &self.manifest_sha256
    }

    pub fn epoch(&self) -> &str {
        &self.payload.epoch
    }
}

pub fn verify_runtime_config_manifest(
    raw_envelope: &[u8],
    trusted_signer: &RuntimeConfigTrustedSigner,
    policy: &RuntimeConfigVerificationPolicy,
    independent_inputs: Option<&RuntimeConfigIndependentVerificationInputs<'_>>,
) -> Result<VerifiedRuntimeConfigManifest, RuntimeConfigManifestError> {
    #[cfg(not(feature = "tlsn-production"))]
    {
        let _ = (raw_envelope, trusted_signer, policy, independent_inputs);
        return Err(RuntimeConfigManifestError::Invalid(
            "independent Production verification requires tlsn-production",
        ));
    }
    #[cfg(feature = "tlsn-production")]
    {
        let payload = verify_signed_runtime_config_manifest(raw_envelope, trusted_signer, policy)?;
        let inputs = independent_inputs.ok_or(RuntimeConfigManifestError::Invalid(
            "independent Production verification inputs are missing",
        ))?;
        let independent_verification =
            verify_independent_runtime_config_inputs(&payload, policy, inputs)?;
        Ok(VerifiedRuntimeConfigManifest {
            payload,
            independent_verification,
            manifest_sha256: sha256_base64url(raw_envelope),
        })
    }
}

#[cfg(feature = "tlsn-production")]
pub(crate) struct HttpRuntimeConfigObjectFetcher {
    client: reqwest::Client,
}

#[cfg(feature = "tlsn-production")]
impl HttpRuntimeConfigObjectFetcher {
    pub(crate) fn new() -> Result<Self, RuntimeConfigManifestError> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| {
                RuntimeConfigManifestError::Transport("HTTP client initialization failed")
            })?;
        Ok(Self { client })
    }
}

#[cfg(feature = "tlsn-production")]
impl RuntimeConfigObjectFetcher for HttpRuntimeConfigObjectFetcher {
    fn fetch<'a>(
        &'a self,
        url: Url,
        max_bytes: usize,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<u8>, RuntimeConfigManifestError>> + Send + 'a>>
    {
        Box::pin(async move { fetch_bounded(&self.client, url, max_bytes).await })
    }
}

#[cfg(feature = "tlsn-production")]
pub(crate) async fn fetch_and_verify_with_fetcher(
    bootstrap: &RuntimeConfigBootstrap,
    policy: &RuntimeConfigVerificationPolicy,
    fetcher: &dyn RuntimeConfigObjectFetcher,
) -> Result<VerifiedRuntimeConfigManifest, RuntimeConfigManifestError> {
    validate_trusted_signer(&bootstrap.trusted_signer)?;
    validate_runtime_config_manifest_url(bootstrap.manifest_url.as_str())?;
    validate_policy(policy)?;
    let manifest_raw = fetcher
        .fetch(bootstrap.manifest_url.clone(), policy.max_envelope_bytes)
        .await?;
    let payload =
        verify_signed_runtime_config_manifest(&manifest_raw, &bootstrap.trusted_signer, policy)?;

    let worker_reference = fetcher
        .fetch(
            runtime_config_artifact_url(
                &bootstrap.manifest_url,
                "worker-reference",
                &payload.source.worker_reference_sha256,
            )?,
            MAX_RUNTIME_CONFIG_ARTIFACT_BYTES,
        )
        .await?;
    let origin_inventory = fetcher
        .fetch(
            runtime_config_artifact_url(
                &bootstrap.manifest_url,
                "origin-inventory",
                &payload.production_authority_pins.origin_inventory_sha256,
            )?,
            MAX_RUNTIME_CONFIG_ARTIFACT_BYTES,
        )
        .await?;
    let target_approval = fetcher
        .fetch(
            runtime_config_artifact_url(
                &bootstrap.manifest_url,
                "target-approval",
                &payload
                    .production_authority_pins
                    .target_approval_artifact_sha256,
            )?,
            MAX_RUNTIME_CONFIG_ARTIFACT_BYTES,
        )
        .await?;
    let security_registry_set = fetcher
        .fetch(
            runtime_config_artifact_url(
                &bootstrap.manifest_url,
                "security-registry-set",
                &payload
                    .production_authority_pins
                    .security_registry_set_sha256,
            )?,
            MAX_RUNTIME_CONFIG_ARTIFACT_BYTES,
        )
        .await?;
    let result_registry_envelope = fetcher
        .fetch(
            runtime_config_artifact_url(
                &bootstrap.manifest_url,
                "result-registry-envelope",
                &payload.result_registry_pins.result_registry_envelope_sha256,
            )?,
            MAX_RUNTIME_CONFIG_ARTIFACT_BYTES,
        )
        .await?;
    let independent_inputs = RuntimeConfigIndependentVerificationInputs {
        worker_reference_raw: Some(&worker_reference),
        origin_inventory_raw: Some(&origin_inventory),
        target_approval_raw: Some(&target_approval),
        security_registry_set_raw: Some(&security_registry_set),
        result_registry_envelope_raw: Some(&result_registry_envelope),
    };
    let independent_verification =
        verify_independent_runtime_config_inputs(&payload, policy, &independent_inputs)?;
    Ok(VerifiedRuntimeConfigManifest {
        payload,
        independent_verification,
        manifest_sha256: sha256_base64url(&manifest_raw),
    })
}

fn validate_runtime_config_manifest_url(raw: &str) -> Result<Url, RuntimeConfigManifestError> {
    let url = Url::parse(raw).map_err(|_| {
        RuntimeConfigManifestError::Invalid("Runtime Config manifest URL is invalid")
    })?;
    if url.scheme() != "https"
        || !matches!(url.host(), Some(Host::Domain(host)) if ServerIdentity::new(host).is_ok())
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != RUNTIME_CONFIG_MANIFEST_URL_PATH
        || url.as_str() != raw
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Runtime Config manifest URL must be a canonical HTTPS DNS URL",
        ));
    }
    Ok(url)
}

#[cfg(feature = "tlsn-production")]
fn runtime_config_artifact_url(
    manifest_url: &Url,
    kind: &str,
    digest: &str,
) -> Result<Url, RuntimeConfigManifestError> {
    validate_digest(digest)?;
    let mut url = manifest_url.clone();
    let mut segments = url.path_segments_mut().map_err(|_| {
        RuntimeConfigManifestError::Invalid("Runtime Config artifact URL cannot be constructed")
    })?;
    segments.pop().push("artifacts").push(kind).push(digest);
    drop(segments);
    Ok(url)
}

#[cfg(feature = "tlsn-production")]
async fn fetch_bounded(
    client: &reqwest::Client,
    url: Url,
    max_bytes: usize,
) -> Result<Vec<u8>, RuntimeConfigManifestError> {
    let response = client
        .get(url.clone())
        .header(
            reqwest::header::ACCEPT,
            "application/json, application/octet-stream",
        )
        .send()
        .await
        .map_err(|_| RuntimeConfigManifestError::Transport("request failed"))?;
    if response.status() != reqwest::StatusCode::OK || response.url() != &url {
        return Err(RuntimeConfigManifestError::Transport(
            "endpoint returned an unexpected status or URL",
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(RuntimeConfigManifestError::Transport(
            "response exceeds the byte limit",
        ));
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk =
            chunk.map_err(|_| RuntimeConfigManifestError::Transport("response body failed"))?;
        append_bounded_chunk(&mut body, &chunk, max_bytes)?;
    }
    if body.is_empty() {
        return Err(RuntimeConfigManifestError::Transport(
            "endpoint returned an empty object",
        ));
    }
    Ok(body)
}

#[cfg(feature = "tlsn-production")]
fn append_bounded_chunk(
    body: &mut Vec<u8>,
    chunk: &[u8],
    max_bytes: usize,
) -> Result<(), RuntimeConfigManifestError> {
    let Some(size) = body.len().checked_add(chunk.len()) else {
        return Err(RuntimeConfigManifestError::Transport(
            "response exceeds the byte limit",
        ));
    };
    if size > max_bytes {
        return Err(RuntimeConfigManifestError::Transport(
            "response exceeds the byte limit",
        ));
    }
    body.extend_from_slice(chunk);
    Ok(())
}

fn verify_signed_runtime_config_manifest(
    raw_envelope: &[u8],
    trusted_signer: &RuntimeConfigTrustedSigner,
    policy: &RuntimeConfigVerificationPolicy,
) -> Result<RuntimeConfigManifestPayload, RuntimeConfigManifestError> {
    validate_trusted_signer(trusted_signer)?;
    validate_policy(policy)?;
    if raw_envelope.len() > policy.max_envelope_bytes {
        return Err(RuntimeConfigManifestError::Invalid(
            "envelope exceeds the supplied byte limit",
        ));
    }

    let envelope: RuntimeConfigManifestEnvelope = serde_json::from_slice(raw_envelope)
        .map_err(|_| RuntimeConfigManifestError::Invalid("envelope JSON is invalid"))?;
    if envelope.schema_version != MANIFEST_SCHEMA_VERSION
        || envelope.scope != ENVELOPE_SCOPE
        || envelope.signature_algorithm != SIGNATURE_ALGORITHM
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "envelope schema or signature algorithm is invalid",
        ));
    }
    if envelope.signer_key_id != trusted_signer.key_id {
        return Err(RuntimeConfigManifestError::Invalid(
            "signer key ID does not match the external trust pin",
        ));
    }
    if canonical_json_bytes(&envelope)? != raw_envelope {
        return Err(RuntimeConfigManifestError::Invalid(
            "envelope is not canonical JSON",
        ));
    }

    let payload_bytes = decode_canonical_base64url(&envelope.payload_base64url, "payload")?;
    let signature = decode_canonical_base64url(&envelope.signature_base64url, "signature")?;
    if signature.len() != 64 {
        return Err(RuntimeConfigManifestError::Invalid(
            "signature must be 64 bytes",
        ));
    }
    let public_key = decode_ed25519_spki(&trusted_signer.public_key_spki)?;
    let message = signature_message(&envelope.signer_key_id, &payload_bytes)?;
    fusou_auth::verify_ed25519_signature(&public_key, &message, &signature)
        .map_err(|_| RuntimeConfigManifestError::InvalidSignature)?;

    let payload: RuntimeConfigManifestPayload = serde_json::from_slice(&payload_bytes)
        .map_err(|_| RuntimeConfigManifestError::Invalid("payload JSON is invalid"))?;
    if canonical_json_bytes(&payload)? != payload_bytes {
        return Err(RuntimeConfigManifestError::Invalid(
            "payload is not canonical JSON",
        ));
    }
    validate_payload(&payload, policy.now)?;
    validate_freshness(&payload, policy, &sha256_base64url(raw_envelope))?;
    Ok(payload)
}

#[cfg(feature = "tlsn-production")]
#[derive(Debug, Deserialize)]
struct OriginInventoryArtifact {
    schema_version: u32,
    source: String,
    targets: Vec<OriginInventoryTarget>,
}

#[cfg(feature = "tlsn-production")]
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct OriginInventoryTarget {
    server_index: u32,
    server_identity: String,
    port: u16,
}

#[cfg(feature = "tlsn-production")]
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TargetApprovalArtifact {
    schema_version: u32,
    authority_model: String,
    environment: String,
    status: String,
    inventory_sha256: String,
    targets: Vec<String>,
    approved_at: String,
}

#[cfg(feature = "tlsn-production")]
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SignedResultRegistryEnvelope {
    schema_version: u32,
    scope: String,
    signature_algorithm: String,
    root_key_id: String,
    root_public_key_spki: String,
    registry_sha256: String,
    registry: Value,
    signature_base64url: String,
}

#[cfg(feature = "tlsn-production")]
#[derive(Serialize)]
struct SignedResultRegistryPayload {
    schema_version: u32,
    scope: String,
    signature_algorithm: String,
    root_key_id: String,
    root_public_key_spki: String,
    registry_sha256: String,
    registry: Value,
}

#[cfg(feature = "tlsn-production")]
fn verify_independent_runtime_config_inputs(
    payload: &RuntimeConfigManifestPayload,
    policy: &RuntimeConfigVerificationPolicy,
    inputs: &RuntimeConfigIndependentVerificationInputs<'_>,
) -> Result<RuntimeConfigIndependentVerificationSummary, RuntimeConfigManifestError> {
    let worker_reference_raw =
        inputs
            .worker_reference_raw
            .ok_or(RuntimeConfigManifestError::Invalid(
                "raw approved Worker reference bytes are missing",
            ))?;
    let origin_inventory_raw =
        inputs
            .origin_inventory_raw
            .ok_or(RuntimeConfigManifestError::Invalid(
                "raw Origin Inventory bytes are missing",
            ))?;
    let target_approval_raw =
        inputs
            .target_approval_raw
            .ok_or(RuntimeConfigManifestError::Invalid(
                "raw Target Approval bytes are missing",
            ))?;
    let security_registry_set_raw =
        inputs
            .security_registry_set_raw
            .ok_or(RuntimeConfigManifestError::Invalid(
                "raw Production security registry set bytes are missing",
            ))?;
    let result_registry_envelope_raw =
        inputs
            .result_registry_envelope_raw
            .ok_or(RuntimeConfigManifestError::Invalid(
                "raw Result registry envelope bytes are missing",
            ))?;

    let pins = &payload.result_registry_pins;
    for digest in [
        payload.source.worker_reference_sha256.as_str(),
        payload
            .production_authority_pins
            .origin_inventory_sha256
            .as_str(),
        payload
            .production_authority_pins
            .target_approval_artifact_sha256
            .as_str(),
        payload
            .production_authority_pins
            .security_registry_set_sha256
            .as_str(),
        pins.result_registry_sha256.as_str(),
        pins.result_registry_envelope_sha256.as_str(),
    ] {
        validate_digest(digest)?;
    }
    validate_key_id(&pins.result_registry_root_key_id)?;
    decode_ed25519_spki(&pins.result_registry_root_public_key_spki)?;

    let worker_reference_sha256 = sha256_base64url(worker_reference_raw);
    if worker_reference_raw.is_empty()
        || worker_reference_sha256 != payload.source.worker_reference_sha256
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Worker reference bytes do not match the signed manifest digest",
        ));
    }
    validate_worker_reference_binding(payload, worker_reference_raw, result_registry_envelope_raw)?;

    let origin_inventory_sha256 = sha256_base64url(origin_inventory_raw);
    let target_approval_artifact_sha256 = sha256_base64url(target_approval_raw);
    let security_registry_set_sha256 = sha256_base64url(security_registry_set_raw);
    if origin_inventory_raw.is_empty()
        || target_approval_raw.is_empty()
        || security_registry_set_raw.is_empty()
        || origin_inventory_sha256 != payload.production_authority_pins.origin_inventory_sha256
        || target_approval_artifact_sha256
            != payload
                .production_authority_pins
                .target_approval_artifact_sha256
        || security_registry_set_sha256
            != payload
                .production_authority_pins
                .security_registry_set_sha256
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Production authority artifact bytes do not match signed manifest digests",
        ));
    }
    let approved_targets = validate_authority_artifacts(
        payload,
        origin_inventory_raw,
        target_approval_raw,
        security_registry_set_raw,
        &origin_inventory_sha256,
        &target_approval_artifact_sha256,
    )?;

    let result_registry_sha256 = sha256_base64url(
        payload
            .compile_inputs
            .get("FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY")
            .expect("complete input inventory checked")
            .as_bytes(),
    );
    let result_registry_envelope_sha256 = sha256_base64url(result_registry_envelope_raw);
    if result_registry_envelope_raw.is_empty()
        || result_registry_sha256 != pins.result_registry_sha256
        || result_registry_envelope_sha256 != pins.result_registry_envelope_sha256
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Result registry bytes do not match signed manifest digests",
        ));
    }
    verify_result_registry_envelope(
        payload,
        policy.now,
        result_registry_envelope_raw,
        pins,
        &result_registry_sha256,
    )?;

    Ok(RuntimeConfigIndependentVerificationSummary {
        worker_reference_sha256,
        origin_inventory_sha256,
        target_approval_artifact_sha256,
        security_registry_set_sha256,
        result_registry_sha256,
        result_registry_envelope_sha256,
        result_registry_root_key_id: pins.result_registry_root_key_id.clone(),
        result_signer_key_id: payload.compile_inputs["FUSOU_TLSN_RESULT_SIGNER_KEY_ID"].clone(),
        result_signer_public_key_spki: payload.compile_inputs["FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI"]
            .clone(),
        approved_targets,
    })
}

#[cfg(feature = "tlsn-production")]
fn validate_worker_reference_binding(
    payload: &RuntimeConfigManifestPayload,
    raw_reference: &[u8],
    result_registry_envelope_raw: &[u8],
) -> Result<(), RuntimeConfigManifestError> {
    let reference: Value = serde_json::from_slice(raw_reference)
        .map_err(|_| RuntimeConfigManifestError::Invalid("Worker reference JSON is invalid"))?;
    let cloudflare = reference
        .get("cloudflare")
        .ok_or(RuntimeConfigManifestError::Invalid(
            "Worker reference Cloudflare identity is missing",
        ))?;
    let checked_public_bindings =
        cloudflare
            .get("checked_public_bindings")
            .ok_or(RuntimeConfigManifestError::Invalid(
                "Worker reference public bindings are missing",
            ))?;
    let result_pins = &payload.result_registry_pins;
    let result_registry_envelope =
        std::str::from_utf8(result_registry_envelope_raw).map_err(|_| {
            RuntimeConfigManifestError::Invalid("Result registry envelope is not UTF-8")
        })?;
    let release_context =
        reference
            .get("release_context")
            .ok_or(RuntimeConfigManifestError::Invalid(
                "Worker reference release context is missing",
            ))?;
    let expected_inputs = serde_json::to_value(&payload.compile_inputs)
        .map_err(|_| RuntimeConfigManifestError::Invalid("compile input serialization failed"))?;
    if reference.get("schema_version").and_then(Value::as_u64) != Some(2)
        || reference.get("scope").and_then(Value::as_str)
            != Some("tlsn-app-approved-worker-deployment-reference")
        || reference.get("authority").and_then(Value::as_str)
            != Some(
                "operator-controlled-approved-release-and-authenticated-cloudflare-control-plane",
            )
        || reference.get("observed_at").and_then(Value::as_str)
            != Some(payload.source.observed_at.as_str())
        || reference.get("disclosure_mode").and_then(Value::as_str)
            != Some(payload.source.disclosure_mode.as_str())
        || cloudflare.get("account_id").and_then(Value::as_str)
            != Some(payload.source.account_id.as_str())
        || cloudflare.get("script_name").and_then(Value::as_str)
            != Some(payload.source.script_name.as_str())
        || cloudflare.get("deployment_id").and_then(Value::as_str)
            != Some(payload.source.cloudflare_deployment_id.as_str())
        || cloudflare.get("version_id").and_then(Value::as_str)
            != Some(payload.source.active_version_id.as_str())
        || cloudflare.get("percentage").and_then(Value::as_u64) != Some(100)
        || reference.get("compile_inputs") != Some(&expected_inputs)
        || release_context
            .get("deployment_role")
            .and_then(Value::as_str)
            != Some("production")
        || release_context
            .get("git_commit_sha")
            .and_then(Value::as_str)
            != Some(payload.source.worker_git_commit_sha.as_str())
        || checked_public_bindings
            .get("TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI")
            .and_then(Value::as_str)
            != payload
                .compile_inputs
                .get("FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI")
                .map(String::as_str)
        || checked_public_bindings
            .get("TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID")
            .and_then(Value::as_str)
            != payload
                .compile_inputs
                .get("FUSOU_TLSN_RESULT_SIGNER_KEY_ID")
                .map(String::as_str)
        || checked_public_bindings
            .get("TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY")
            .and_then(Value::as_str)
            != payload
                .compile_inputs
                .get("FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY")
                .map(String::as_str)
        || checked_public_bindings
            .get("TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE")
            .and_then(Value::as_str)
            != Some(result_registry_envelope)
        || checked_public_bindings
            .get("TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID")
            .and_then(Value::as_str)
            != Some(result_pins.result_registry_root_key_id.as_str())
        || checked_public_bindings
            .get("TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI")
            .and_then(Value::as_str)
            != Some(result_pins.result_registry_root_public_key_spki.as_str())
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Worker reference identity does not match the signed manifest",
        ));
    }
    Ok(())
}

#[cfg(feature = "tlsn-production")]
fn validate_authority_artifacts(
    payload: &RuntimeConfigManifestPayload,
    raw_inventory: &[u8],
    raw_approval: &[u8],
    raw_security_registry_set: &[u8],
    inventory_sha256: &str,
    approval_sha256: &str,
) -> Result<Vec<RuntimeConfigApprovedTarget>, RuntimeConfigManifestError> {
    let inventory_text = std::str::from_utf8(raw_inventory)
        .map_err(|_| RuntimeConfigManifestError::Invalid("Origin Inventory is not UTF-8"))?;
    let inventory: OriginInventoryArtifact = serde_json::from_str(inventory_text)
        .map_err(|_| RuntimeConfigManifestError::Invalid("Origin Inventory JSON is invalid"))?;
    if inventory.schema_version != 1
        || inventory.source != ORIGIN_INVENTORY_SOURCE
        || inventory.targets.len() != 20
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Origin Inventory schema or target count is invalid",
        ));
    }
    let mut inventory_positions = BTreeMap::new();
    for (index, target) in inventory.targets.iter().enumerate() {
        if target.server_index != index as u32 + 1
            || target.port != 443
            || ServerIdentity::new(target.server_identity.as_str()).is_err()
            || inventory_positions
                .insert(target.server_identity.as_str(), index)
                .is_some()
        {
            return Err(RuntimeConfigManifestError::Invalid(
                "Origin Inventory targets are invalid, unordered, or duplicated",
            ));
        }
    }

    let approval_text = std::str::from_utf8(raw_approval)
        .map_err(|_| RuntimeConfigManifestError::Invalid("Target Approval is not UTF-8"))?;
    let approval: TargetApprovalArtifact = serde_json::from_str(approval_text)
        .map_err(|_| RuntimeConfigManifestError::Invalid("Target Approval JSON is invalid"))?;
    let canonical_approval = serde_json::to_string_pretty(&approval)
        .map_err(|_| RuntimeConfigManifestError::Invalid("Target Approval serialization failed"))?;
    if canonical_approval.as_bytes() != raw_approval
        || approval.schema_version != 1
        || approval.authority_model != "FUSOU_DEPLOYMENT_OPERATOR"
        || approval.environment != "production"
        || approval.status != "APPROVED"
        || approval.inventory_sha256 != inventory_sha256
        || approval.targets.is_empty()
        || DateTime::parse_from_rfc3339(&approval.approved_at).is_err()
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Target Approval does not match the canonical Production inventory",
        ));
    }
    let mut previous_position = None;
    let mut seen = BTreeSet::new();
    for identity in &approval.targets {
        if ServerIdentity::new(identity.as_str()).is_err()
            || is_fixture_or_synthetic_server_identity(identity)
            || !seen.insert(identity.as_str())
        {
            return Err(RuntimeConfigManifestError::Invalid(
                "Target Approval contains an invalid or duplicate server identity",
            ));
        }
        let position = inventory_positions.get(identity.as_str()).ok_or(
            RuntimeConfigManifestError::Invalid(
                "Target Approval identity is absent from the Origin Inventory",
            ),
        )?;
        if previous_position.is_some_and(|previous| *position <= previous) {
            return Err(RuntimeConfigManifestError::Invalid(
                "Target Approval identities are not in Origin Inventory order",
            ));
        }
        previous_position = Some(*position);
    }

    let security_set: Value = serde_json::from_slice(raw_security_registry_set).map_err(|_| {
        RuntimeConfigManifestError::Invalid("security registry set JSON is invalid")
    })?;
    if canonical_json_bytes(&security_set)?.as_slice() != raw_security_registry_set {
        return Err(RuntimeConfigManifestError::Invalid(
            "security registry set is not canonical JSON",
        ));
    }
    let expected_fields = BTreeSet::from([
        "notary_key_id",
        "notary_registry",
        "origin_inventory_sha256",
        "target_approval_artifact_sha256",
        "profile_policy_sha256",
    ]);
    let fields: BTreeSet<&str> = security_set
        .as_object()
        .ok_or(RuntimeConfigManifestError::Invalid(
            "security registry set must be an object",
        ))?
        .keys()
        .map(String::as_str)
        .collect();
    if fields != expected_fields
        || security_set
            .get("origin_inventory_sha256")
            .and_then(Value::as_str)
            != Some(inventory_sha256)
        || security_set
            .get("target_approval_artifact_sha256")
            .and_then(Value::as_str)
            != Some(approval_sha256)
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "security registry set does not bind the verified authority artifacts",
        ));
    }
    let notary_key_id = security_set
        .get("notary_key_id")
        .and_then(Value::as_str)
        .ok_or(RuntimeConfigManifestError::Invalid(
            "security registry set Notary key ID is missing",
        ))?;
    validate_key_id(notary_key_id)?;
    let notary_registry = security_set
        .get("notary_registry")
        .and_then(Value::as_object)
        .ok_or(RuntimeConfigManifestError::Invalid(
            "security registry set Notary registry is missing",
        ))?;
    let compile_notary_key = payload
        .compile_inputs
        .get("FUSOU_TLSN_NOTARY_VERIFYING_KEY")
        .expect("complete input inventory checked");
    if notary_registry.is_empty()
        || notary_registry.get(notary_key_id).and_then(Value::as_str) != Some(compile_notary_key)
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "security registry set Notary key does not match the signed compile input",
        ));
    }
    for (key_id, verifying_key) in notary_registry {
        validate_key_id(key_id)?;
        let verifying_key = verifying_key
            .as_str()
            .ok_or(RuntimeConfigManifestError::Invalid(
                "security registry set contains an invalid Notary key",
            ))?;
        let verifying_key = decode_canonical_base64url(verifying_key, "Notary verifying key")?;
        crate::tlsn_preflight::validate_notary_key_bytes(&verifying_key)
            .map_err(RuntimeConfigManifestError::Invalid)?;
    }
    validate_digest(
        security_set
            .get("profile_policy_sha256")
            .and_then(Value::as_str)
            .ok_or(RuntimeConfigManifestError::Invalid(
                "security registry set profile policy digest is missing",
            ))?,
    )?;
    Ok(approval
        .targets
        .iter()
        .map(|identity| {
            let position = inventory_positions[identity.as_str()];
            let target = &inventory.targets[position];
            RuntimeConfigApprovedTarget {
                server_index: target.server_index,
                server_identity: target.server_identity.clone(),
                port: target.port,
            }
        })
        .collect())
}

#[cfg(feature = "tlsn-production")]
fn verify_result_registry_envelope(
    payload: &RuntimeConfigManifestPayload,
    validation_time: DateTime<Utc>,
    raw_envelope: &[u8],
    pins: &ResultRegistryPins,
    result_registry_sha256: &str,
) -> Result<(), RuntimeConfigManifestError> {
    let envelope: SignedResultRegistryEnvelope =
        serde_json::from_slice(raw_envelope).map_err(|_| {
            RuntimeConfigManifestError::Invalid("Result registry envelope JSON is invalid")
        })?;
    if envelope.schema_version != 1
        || envelope.scope != RESULT_REGISTRY_ENVELOPE_SCOPE
        || envelope.signature_algorithm != SIGNATURE_ALGORITHM
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Result registry envelope schema or algorithm is invalid",
        ));
    }
    if envelope.root_key_id != pins.result_registry_root_key_id
        || envelope.root_public_key_spki != pins.result_registry_root_public_key_spki
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Result registry root does not match the signed manifest pin",
        ));
    }
    validate_digest(&envelope.registry_sha256)?;
    if envelope.registry_sha256 != result_registry_sha256 {
        return Err(RuntimeConfigManifestError::Invalid(
            "Result registry envelope digest does not match the registry bytes",
        ));
    }
    let registry_raw = payload
        .compile_inputs
        .get("FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY")
        .expect("complete input inventory checked");
    let registry: Value = serde_json::from_str(registry_raw)
        .map_err(|_| RuntimeConfigManifestError::Invalid("Result key registry JSON is invalid"))?;
    if canonical_json_bytes(&envelope.registry)? != canonical_json_bytes(&registry)? {
        return Err(RuntimeConfigManifestError::Invalid(
            "Result registry envelope content does not match the signed manifest registry",
        ));
    }
    let signature = decode_canonical_base64url(
        &envelope.signature_base64url,
        "Result registry envelope signature",
    )?;
    if signature.len() != 64 {
        return Err(RuntimeConfigManifestError::Invalid(
            "Result registry envelope signature must be 64 bytes",
        ));
    }
    let public_key = decode_ed25519_spki(&pins.result_registry_root_public_key_spki)?;
    let signed_payload = SignedResultRegistryPayload {
        schema_version: envelope.schema_version,
        scope: envelope.scope,
        signature_algorithm: envelope.signature_algorithm,
        root_key_id: envelope.root_key_id,
        root_public_key_spki: envelope.root_public_key_spki,
        registry_sha256: envelope.registry_sha256,
        registry: envelope.registry,
    };
    let signing_bytes = canonical_json_bytes(&signed_payload)?;
    fusou_auth::verify_ed25519_signature(&public_key, &signing_bytes, &signature)
        .map_err(|_| RuntimeConfigManifestError::InvalidResultRegistrySignature)?;
    validate_result_registry(&payload.compile_inputs, validation_time)?;
    Ok(())
}

fn sha256_base64url(raw: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(raw))
}

#[cfg(feature = "tlsn-production")]
fn is_fixture_or_synthetic_server_identity(value: &str) -> bool {
    value.split(['.', '-', '_', '/']).any(|part| {
        matches!(
            part,
            "test"
                | "synthetic"
                | "fixture"
                | "local"
                | "localhost"
                | "staging"
                | "historical"
                | "remote"
                | "example"
                | "invalid"
        )
    })
}

fn validate_trusted_signer(
    trusted_signer: &RuntimeConfigTrustedSigner,
) -> Result<(), RuntimeConfigManifestError> {
    if trusted_signer.scope != TRUST_SCOPE {
        return Err(RuntimeConfigManifestError::Invalid(
            "trusted signer is not scoped to runtime configuration",
        ));
    }
    validate_key_id(&trusted_signer.key_id)?;
    decode_ed25519_spki(&trusted_signer.public_key_spki)?;
    Ok(())
}

fn validate_policy(
    policy: &RuntimeConfigVerificationPolicy,
) -> Result<(), RuntimeConfigManifestError> {
    if policy.now.timestamp_millis().unsigned_abs() > MAX_SAFE_JS_INTEGER {
        return Err(RuntimeConfigManifestError::Invalid(
            "verification time is outside the interoperable range",
        ));
    }
    let last_accepted_epoch = parse_epoch(&policy.last_accepted_epoch, true)?;
    match (
        last_accepted_epoch,
        policy.last_accepted_manifest_sha256.as_deref(),
    ) {
        (0, None) => {}
        (0, Some(_)) | (_, None) => {
            return Err(RuntimeConfigManifestError::Invalid(
                "persisted epoch and manifest digest are inconsistent",
            ));
        }
        (_, Some(digest)) => validate_digest(digest)?,
    }
    for value in [
        policy.max_lifetime_seconds,
        policy.max_clock_skew_seconds,
        policy.max_reference_age_seconds,
    ] {
        seconds_to_millis(value)?;
        if value == 0 {
            return Err(RuntimeConfigManifestError::Invalid(
                "verification policy limits must be positive",
            ));
        }
    }
    if policy.max_envelope_bytes == 0 {
        return Err(RuntimeConfigManifestError::Invalid(
            "maximum envelope size must be positive",
        ));
    }
    let max_envelope_bytes = u64::try_from(policy.max_envelope_bytes).map_err(|_| {
        RuntimeConfigManifestError::Invalid(
            "maximum envelope size is outside the interoperable range",
        )
    })?;
    if max_envelope_bytes > MAX_SAFE_JS_INTEGER {
        return Err(RuntimeConfigManifestError::Invalid(
            "maximum envelope size is outside the interoperable range",
        ));
    }
    Ok(())
}

fn validate_payload(
    payload: &RuntimeConfigManifestPayload,
    validation_time: DateTime<Utc>,
) -> Result<(), RuntimeConfigManifestError> {
    if payload.schema_version != MANIFEST_SCHEMA_VERSION
        || payload.scope != MANIFEST_SCOPE
        || payload.environment != "production"
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "manifest schema or environment is invalid",
        ));
    }
    parse_epoch(&payload.epoch, false)?;
    let issued_at = parse_canonical_utc(&payload.issued_at)?;
    let not_before = parse_canonical_utc(&payload.not_before)?;
    let expires_at = parse_canonical_utc(&payload.expires_at)?;
    if issued_at > not_before || not_before >= expires_at {
        return Err(RuntimeConfigManifestError::Invalid(
            "manifest validity timestamps are out of order",
        ));
    }

    validate_digest(&payload.source.worker_reference_sha256)?;
    parse_canonical_utc(&payload.source.observed_at)?;
    if !is_lower_hex(&payload.source.account_id, 32)
        || !is_worker_name(&payload.source.script_name)
        || !is_uuid(&payload.source.cloudflare_deployment_id)
        || !is_uuid(&payload.source.active_version_id)
        || !is_lower_hex(&payload.source.worker_git_commit_sha, 40)
        || payload.source.logical_deployment_id.trim().is_empty()
        || !matches!(
            payload.source.disclosure_mode.as_str(),
            "complete" | "sparse"
        )
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Worker source identity is invalid",
        ));
    }

    let actual_names: BTreeSet<&str> = payload.compile_inputs.keys().map(String::as_str).collect();
    let expected_names: BTreeSet<&str> = COMPILE_INPUT_NAMES.into_iter().collect();
    if actual_names != expected_names {
        return Err(RuntimeConfigManifestError::Invalid(
            "compile input field inventory is invalid",
        ));
    }
    if payload
        .compile_inputs
        .values()
        .any(|value| value.trim().is_empty() || value.contains('\0'))
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "compile input is missing or invalid",
        ));
    }
    let inputs = &payload.compile_inputs;
    if inputs
        .get("FUSOU_TLSN_EXPECTED_BINDING_MODE")
        .map(String::as_str)
        != Some("random")
        || inputs
            .get("FUSOU_TLSN_EXPECTED_WORKER_NAME")
            .map(String::as_str)
            != Some(payload.source.script_name.as_str())
        || inputs
            .get("FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID")
            .map(String::as_str)
            != Some(payload.source.logical_deployment_id.as_str())
        || inputs
            .get("FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID")
            .map(String::as_str)
            != Some(payload.source.active_version_id.as_str())
        || inputs
            .get("FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA")
            .map(String::as_str)
            != Some(payload.source.worker_git_commit_sha.as_str())
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "compile inputs disagree with the approved Worker source identity",
        ));
    }
    validate_notary_endpoint(
        inputs
            .get("FUSOU_TLSN_NOTARY_ENDPOINT")
            .expect("complete input inventory checked"),
    )?;
    let notary_key_bytes = decode_canonical_base64url(
        inputs
            .get("FUSOU_TLSN_NOTARY_VERIFYING_KEY")
            .expect("complete input inventory checked"),
        "Notary verifying key",
    )?;
    crate::tlsn_preflight::validate_notary_key_bytes(&notary_key_bytes)
        .map_err(RuntimeConfigManifestError::Invalid)?;
    validate_ed25519_spki(
        inputs
            .get("FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI")
            .expect("complete input inventory checked"),
    )?;
    validate_ed25519_spki(
        inputs
            .get("FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY")
            .expect("complete input inventory checked"),
    )?;
    validate_key_id(
        inputs
            .get("FUSOU_TLSN_RESULT_SIGNER_KEY_ID")
            .expect("complete input inventory checked"),
    )?;
    validate_key_id(
        inputs
            .get("FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID")
            .expect("complete input inventory checked"),
    )?;
    validate_result_registry(inputs, validation_time)?;

    let health = validate_https_endpoint(
        inputs
            .get("FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT")
            .expect("complete input inventory checked"),
        "/health",
    )?;
    let session = validate_https_endpoint(
        inputs
            .get("FUSOU_TLSN_SESSION_AUTHORITY_ENDPOINT")
            .expect("complete input inventory checked"),
        "/attestation/session",
    )?;
    let verification_path = if payload.source.disclosure_mode == "complete" {
        "/verify/tlsn"
    } else {
        "/verify/tlsn/sparse"
    };
    let verification = validate_https_endpoint(
        inputs
            .get("FUSOU_TLSN_VERIFICATION_ENDPOINT")
            .expect("complete input inventory checked"),
        verification_path,
    )?;
    if health.origin().ascii_serialization() != session.origin().ascii_serialization()
        || health.origin().ascii_serialization() != verification.origin().ascii_serialization()
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Worker endpoint origins disagree",
        ));
    }

    validate_digest(&payload.production_authority_pins.origin_inventory_sha256)?;
    validate_digest(
        &payload
            .production_authority_pins
            .target_approval_artifact_sha256,
    )?;
    validate_digest(
        &payload
            .production_authority_pins
            .security_registry_set_sha256,
    )?;
    validate_digest(&payload.result_registry_pins.result_registry_sha256)?;
    validate_digest(&payload.result_registry_pins.result_registry_envelope_sha256)?;
    validate_key_id(&payload.result_registry_pins.result_registry_root_key_id)?;
    decode_ed25519_spki(
        &payload
            .result_registry_pins
            .result_registry_root_public_key_spki,
    )?;
    let result_registry_sha256 = sha256_base64url(
        inputs
            .get("FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY")
            .expect("complete input inventory checked")
            .as_bytes(),
    );
    if result_registry_sha256 != payload.result_registry_pins.result_registry_sha256 {
        return Err(RuntimeConfigManifestError::Invalid(
            "Result registry digest does not match the signed compile input",
        ));
    }
    Ok(())
}

fn validate_freshness(
    payload: &RuntimeConfigManifestPayload,
    policy: &RuntimeConfigVerificationPolicy,
    manifest_sha256: &str,
) -> Result<(), RuntimeConfigManifestError> {
    let epoch = parse_epoch(&payload.epoch, false)?;
    let high_water = parse_epoch(&policy.last_accepted_epoch, true)?;
    if epoch < high_water {
        return Err(RuntimeConfigManifestError::Invalid(
            "epoch is older than the persisted high-water mark",
        ));
    }
    if epoch == high_water
        && policy.last_accepted_manifest_sha256.as_deref() != Some(manifest_sha256)
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "epoch was already accepted with different manifest bytes",
        ));
    }

    let now = policy.now.timestamp_millis();
    let issued_at = parse_canonical_utc(&payload.issued_at)?.timestamp_millis();
    let not_before = parse_canonical_utc(&payload.not_before)?.timestamp_millis();
    let expires_at = parse_canonical_utc(&payload.expires_at)?.timestamp_millis();
    let observed_at = parse_canonical_utc(&payload.source.observed_at)?.timestamp_millis();
    let skew = seconds_to_millis(policy.max_clock_skew_seconds)?;
    let max_lifetime = seconds_to_millis(policy.max_lifetime_seconds)?;
    let max_reference_age = seconds_to_millis(policy.max_reference_age_seconds)?;
    let latest_allowed = now
        .checked_add(skew)
        .ok_or(RuntimeConfigManifestError::Invalid(
            "clock policy overflows",
        ))?;
    let earliest_allowed = now
        .checked_sub(skew)
        .ok_or(RuntimeConfigManifestError::Invalid(
            "clock policy overflows",
        ))?;
    if issued_at > not_before
        || not_before >= expires_at
        || expires_at - not_before > max_lifetime
        || issued_at > latest_allowed
        || not_before > latest_allowed
        || expires_at <= earliest_allowed
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "validity window is invalid or not current",
        ));
    }
    let age = now
        .checked_sub(observed_at)
        .ok_or(RuntimeConfigManifestError::Invalid(
            "reference age overflows",
        ))?;
    if observed_at > latest_allowed || age > max_reference_age {
        return Err(RuntimeConfigManifestError::Invalid(
            "Worker reference is not fresh",
        ));
    }
    Ok(())
}

fn validate_result_registry(
    inputs: &BTreeMap<String, String>,
    validation_time: DateTime<Utc>,
) -> Result<(), RuntimeConfigManifestError> {
    let registry_raw = inputs
        .get("FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY")
        .expect("complete input inventory checked");
    let registry: Value = serde_json::from_str(registry_raw)
        .map_err(|_| RuntimeConfigManifestError::Invalid("Result key registry JSON is invalid"))?;
    if registry.get("schema_version").and_then(Value::as_u64) != Some(1)
        || registry.get("scope").and_then(Value::as_str) != Some(RESULT_REGISTRY_SCOPE)
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Result key registry schema or scope is invalid",
        ));
    }
    let keys = registry.get("keys").and_then(Value::as_array).ok_or(
        RuntimeConfigManifestError::Invalid("Result key registry keys are missing"),
    )?;
    let signer_key_id = inputs
        .get("FUSOU_TLSN_RESULT_SIGNER_KEY_ID")
        .expect("complete input inventory checked");
    let public_key = inputs
        .get("FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI")
        .expect("complete input inventory checked");
    if keys.is_empty() {
        return Err(RuntimeConfigManifestError::Invalid(
            "Result key registry is empty",
        ));
    }
    let mut seen = BTreeSet::new();
    let mut current = None;
    for entry in keys {
        let key_id = entry.get("key_id").and_then(Value::as_str).ok_or(
            RuntimeConfigManifestError::Invalid("Result registry key ID is missing"),
        )?;
        validate_key_id(key_id)?;
        if !seen.insert(key_id) {
            return Err(RuntimeConfigManifestError::Invalid(
                "Result key registry contains a duplicate key ID",
            ));
        }
        let key = entry.get("public_key_spki").and_then(Value::as_str).ok_or(
            RuntimeConfigManifestError::Invalid("Result registry public key is missing"),
        )?;
        validate_ed25519_spki(key)?;
        let status = entry.get("status").and_then(Value::as_str).ok_or(
            RuntimeConfigManifestError::Invalid("Result registry key status is missing"),
        )?;
        if !matches!(status, "ACTIVE" | "VERIFY_ONLY" | "RETIRED" | "REVOKED") {
            return Err(RuntimeConfigManifestError::Invalid(
                "Result key registry status is invalid",
            ));
        }
        let not_before = entry.get("not_before").and_then(Value::as_str).ok_or(
            RuntimeConfigManifestError::Invalid("Result registry not_before is missing"),
        )?;
        let not_before = parse_canonical_utc(not_before).map_err(|_| {
            RuntimeConfigManifestError::Invalid(
                "Result registry not_before is not canonical UTC RFC3339",
            )
        })?;
        let not_after = match entry.get("not_after") {
            Some(Value::Null) => None,
            Some(Value::String(value)) => Some(parse_canonical_utc(value).map_err(|_| {
                RuntimeConfigManifestError::Invalid(
                    "Result registry not_after is not canonical UTC RFC3339",
                )
            })?),
            _ => {
                return Err(RuntimeConfigManifestError::Invalid(
                    "Result registry not_after is invalid",
                ))
            }
        };
        if not_after.is_some_and(|end| end <= not_before) {
            return Err(RuntimeConfigManifestError::Invalid(
                "Result registry key validity window is invalid",
            ));
        }
        if key_id == signer_key_id {
            current = Some((key, status, not_before, not_after));
        }
    }
    let Some((current_key, status, not_before, not_after)) = current else {
        return Err(RuntimeConfigManifestError::Invalid(
            "Result signer is not in the published registry",
        ));
    };
    if current_key != public_key {
        return Err(RuntimeConfigManifestError::Invalid(
            "Result signer public key does not match the registry",
        ));
    }
    if status != "ACTIVE"
        || not_before > validation_time
        || not_after.is_some_and(|end| end < validation_time)
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Result signer is not ACTIVE and valid at verification time",
        ));
    }
    Ok(())
}

fn validate_https_endpoint(
    value: &str,
    expected_path: &str,
) -> Result<Url, RuntimeConfigManifestError> {
    let url = Url::parse(value)
        .map_err(|_| RuntimeConfigManifestError::Invalid("HTTPS endpoint URL is invalid"))?;
    let is_dns = match url.host() {
        Some(Host::Domain(host)) => ServerIdentity::new(host).is_ok(),
        Some(Host::Ipv4(_)) | Some(Host::Ipv6(_)) | None => false,
    };
    if url.scheme() != "https"
        || !is_dns
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != expected_path
        || url.as_str() != value
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "HTTPS endpoint is not canonical for its expected route",
        ));
    }
    Ok(url)
}

fn validate_notary_endpoint(value: &str) -> Result<(), RuntimeConfigManifestError> {
    if value.is_empty() || value.contains(char::is_whitespace) || value.contains("://") {
        return Err(RuntimeConfigManifestError::Invalid(
            "Notary endpoint must be a raw host:port value",
        ));
    }
    let (host, port) = if let Some(rest) = value.strip_prefix('[') {
        let (host, port) = rest
            .split_once("]:")
            .ok_or(RuntimeConfigManifestError::Invalid(
                "Notary endpoint IPv6 syntax is invalid",
            ))?;
        if host.is_empty() || host.contains('[') || host.contains(']') {
            return Err(RuntimeConfigManifestError::Invalid(
                "Notary endpoint host is invalid",
            ));
        }
        (host, port)
    } else {
        let (host, port) = value
            .rsplit_once(':')
            .ok_or(RuntimeConfigManifestError::Invalid(
                "Notary endpoint must use host:port syntax",
            ))?;
        if host.is_empty() || host.contains(':') {
            return Err(RuntimeConfigManifestError::Invalid(
                "Notary endpoint host is invalid",
            ));
        }
        (host, port)
    };
    if port.is_empty() || !port.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(RuntimeConfigManifestError::Invalid(
            "Notary port is invalid",
        ));
    }
    let port = port
        .parse::<u16>()
        .map_err(|_| RuntimeConfigManifestError::Invalid("Notary port is invalid"))?;
    if port == 0 || host.is_empty() {
        return Err(RuntimeConfigManifestError::Invalid(
            "Notary endpoint is invalid",
        ));
    }
    Ok(())
}

fn is_worker_name(value: &str) -> bool {
    let bytes = value.as_bytes();
    (3..=64).contains(&bytes.len())
        && bytes[0].is_ascii_lowercase()
        && bytes[bytes.len() - 1].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
}

fn is_uuid(value: &str) -> bool {
    if value.len() != 36 {
        return false;
    }
    for (index, byte) in value.bytes().enumerate() {
        if [8, 13, 18, 23].contains(&index) {
            if byte != b'-' {
                return false;
            }
        } else if !byte.is_ascii_hexdigit() || byte.is_ascii_uppercase() {
            return false;
        }
    }
    value != "00000000-0000-0000-0000-000000000000"
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(crate) fn validate_digest(value: &str) -> Result<(), RuntimeConfigManifestError> {
    let bytes = decode_canonical_base64url(value, "SHA-256 digest")?;
    if bytes.len() != 32 {
        return Err(RuntimeConfigManifestError::Invalid(
            "SHA-256 digest must be 32 bytes",
        ));
    }
    Ok(())
}

fn validate_key_id(value: &str) -> Result<(), RuntimeConfigManifestError> {
    if !is_valid_key_id(value) {
        return Err(RuntimeConfigManifestError::Invalid("key ID is invalid"));
    }
    Ok(())
}

fn validate_ed25519_spki(value: &str) -> Result<(), RuntimeConfigManifestError> {
    decode_ed25519_spki(value).map(|_| ())
}

fn decode_ed25519_spki(value: &str) -> Result<Vec<u8>, RuntimeConfigManifestError> {
    let bytes = decode_canonical_base64url(value, "Ed25519 SPKI key")?;
    if bytes.len() != ED25519_SPKI_PREFIX.len() + 32 || !bytes.starts_with(ED25519_SPKI_PREFIX) {
        return Err(RuntimeConfigManifestError::Invalid(
            "Ed25519 SPKI key format is invalid",
        ));
    }
    Ok(bytes[ED25519_SPKI_PREFIX.len()..].to_vec())
}

fn decode_canonical_base64url(
    value: &str,
    label: &'static str,
) -> Result<Vec<u8>, RuntimeConfigManifestError> {
    if value.is_empty() || value.contains('=') {
        return Err(RuntimeConfigManifestError::Invalid(label));
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| RuntimeConfigManifestError::Invalid(label))?;
    if URL_SAFE_NO_PAD.encode(&bytes) != value {
        return Err(RuntimeConfigManifestError::Invalid(label));
    }
    Ok(bytes)
}

pub(crate) fn parse_epoch(
    value: &str,
    allow_zero: bool,
) -> Result<u64, RuntimeConfigManifestError> {
    let is_canonical = if allow_zero && value == "0" {
        true
    } else {
        !value.is_empty()
            && value.as_bytes()[0].is_ascii_digit()
            && value.as_bytes()[0] != b'0'
            && value.bytes().all(|byte| byte.is_ascii_digit())
    };
    if !is_canonical {
        return Err(RuntimeConfigManifestError::Invalid(
            "epoch must be a canonical UInt64 decimal string",
        ));
    }
    value
        .parse::<u64>()
        .map_err(|_| RuntimeConfigManifestError::Invalid("epoch exceeds UInt64"))
}

fn parse_canonical_utc(value: &str) -> Result<DateTime<Utc>, RuntimeConfigManifestError> {
    let parsed = DateTime::parse_from_rfc3339(value)
        .map_err(|_| RuntimeConfigManifestError::Invalid("timestamp is not RFC3339"))?;
    let utc = parsed.with_timezone(&Utc);
    if parsed.offset().local_minus_utc() != 0
        || utc.to_rfc3339_opts(SecondsFormat::Millis, true) != value
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "timestamp must be canonical UTC RFC3339",
        ));
    }
    Ok(utc)
}

fn seconds_to_millis(value: u64) -> Result<i64, RuntimeConfigManifestError> {
    if value > MAX_SAFE_POLICY_SECONDS {
        return Err(RuntimeConfigManifestError::Invalid(
            "verification policy seconds overflow",
        ));
    }
    i64::try_from(value)
        .ok()
        .and_then(|seconds| seconds.checked_mul(1000))
        .ok_or(RuntimeConfigManifestError::Invalid(
            "verification policy seconds overflow",
        ))
}

fn signature_message(
    key_id: &str,
    payload_bytes: &[u8],
) -> Result<Vec<u8>, RuntimeConfigManifestError> {
    validate_key_id(key_id)?;
    let key_id = key_id.as_bytes();
    let key_length = u16::try_from(key_id.len())
        .map_err(|_| RuntimeConfigManifestError::Invalid("key ID is too long"))?;
    let mut message =
        Vec::with_capacity(SIGNATURE_DOMAIN.len() + 2 + key_id.len() + payload_bytes.len());
    message.extend_from_slice(SIGNATURE_DOMAIN);
    message.extend_from_slice(&key_length.to_be_bytes());
    message.extend_from_slice(key_id);
    message.extend_from_slice(payload_bytes);
    Ok(message)
}

fn canonical_json_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, RuntimeConfigManifestError> {
    let value = serde_json::to_value(value)
        .map_err(|_| RuntimeConfigManifestError::Invalid("JSON serialization failed"))?;
    let mut output = Vec::new();
    write_canonical_json(&value, &mut output)?;
    Ok(output)
}

fn write_canonical_json(
    value: &Value,
    output: &mut Vec<u8>,
) -> Result<(), RuntimeConfigManifestError> {
    match value {
        Value::Null => output.extend_from_slice(b"null"),
        Value::Bool(value) => {
            output.extend_from_slice(if *value { &b"true"[..] } else { &b"false"[..] })
        }
        Value::Number(value) => output.extend_from_slice(value.to_string().as_bytes()),
        Value::String(value) => serde_json::to_writer(output, value)
            .map_err(|_| RuntimeConfigManifestError::Invalid("JSON string encoding failed"))?,
        Value::Array(values) => {
            output.push(b'[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                write_canonical_json(value, output)?;
            }
            output.push(b']');
        }
        Value::Object(values) => {
            output.push(b'{');
            let mut keys: Vec<_> = values.keys().collect();
            keys.sort_unstable();
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                serde_json::to_writer(&mut *output, key)
                    .map_err(|_| RuntimeConfigManifestError::Invalid("JSON key encoding failed"))?;
                output.push(b':');
                write_canonical_json(&values[key], output)?;
            }
            output.push(b'}');
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::read::GzDecoder;
    use std::io::Read;
    #[cfg(feature = "tlsn-production")]
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[derive(Deserialize)]
    struct TestVector {
        test_only: bool,
        trusted_signer: RuntimeConfigTrustedSigner,
        envelope_uncompressed_bytes: usize,
        envelope_gzip_base64url: String,
    }

    #[cfg(feature = "tlsn-production")]
    #[derive(Deserialize)]
    struct IndependentVerificationPolicyVector {
        now_ms: i64,
        last_accepted_epoch: String,
        last_accepted_manifest_sha256: Option<String>,
        max_lifetime_seconds: u64,
        max_clock_skew_seconds: u64,
        max_reference_age_seconds: u64,
        max_envelope_bytes: usize,
    }

    #[cfg(feature = "tlsn-production")]
    #[derive(Deserialize)]
    struct IndependentVerificationVector {
        schema_version: u32,
        test_only: bool,
        trusted_signer: RuntimeConfigTrustedSigner,
        policy: IndependentVerificationPolicyVector,
        manifest_envelope_utf8: String,
        inputs_base64url: BTreeMap<String, String>,
    }

    #[cfg(feature = "tlsn-production")]
    #[derive(Clone)]
    struct IndependentVerificationRawInputs {
        worker_reference: Vec<u8>,
        origin_inventory: Vec<u8>,
        target_approval: Vec<u8>,
        security_registry_set: Vec<u8>,
        result_registry_envelope: Vec<u8>,
    }

    #[cfg(feature = "tlsn-production")]
    impl IndependentVerificationRawInputs {
        fn verification_inputs(&self) -> RuntimeConfigIndependentVerificationInputs<'_> {
            RuntimeConfigIndependentVerificationInputs {
                worker_reference_raw: Some(&self.worker_reference),
                origin_inventory_raw: Some(&self.origin_inventory),
                target_approval_raw: Some(&self.target_approval),
                security_registry_set_raw: Some(&self.security_registry_set),
                result_registry_envelope_raw: Some(&self.result_registry_envelope),
            }
        }
    }

    #[cfg(feature = "tlsn-production")]
    fn load_independent_verification_vector() -> (
        IndependentVerificationVector,
        IndependentVerificationRawInputs,
        RuntimeConfigVerificationPolicy,
    ) {
        let fixture: IndependentVerificationVector = serde_json::from_str(include_str!(
            "../../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/fixtures/tlsn-runtime-config-independent-v2-vector.json"
        ))
        .unwrap();
        assert_eq!(fixture.schema_version, 2);
        assert!(fixture.test_only);
        let bytes = |name: &str| {
            URL_SAFE_NO_PAD
                .decode(fixture.inputs_base64url.get(name).unwrap())
                .unwrap()
        };
        let raw_inputs = IndependentVerificationRawInputs {
            worker_reference: bytes("worker_reference_raw"),
            origin_inventory: bytes("origin_inventory_raw"),
            target_approval: bytes("target_approval_raw"),
            security_registry_set: bytes("security_registry_set_raw"),
            result_registry_envelope: bytes("result_registry_envelope_raw"),
        };
        let policy = RuntimeConfigVerificationPolicy {
            now: DateTime::from_timestamp_millis(fixture.policy.now_ms).unwrap(),
            last_accepted_epoch: fixture.policy.last_accepted_epoch.clone(),
            last_accepted_manifest_sha256: fixture.policy.last_accepted_manifest_sha256.clone(),
            max_lifetime_seconds: fixture.policy.max_lifetime_seconds,
            max_clock_skew_seconds: fixture.policy.max_clock_skew_seconds,
            max_reference_age_seconds: fixture.policy.max_reference_age_seconds,
            max_envelope_bytes: fixture.policy.max_envelope_bytes,
        };
        (fixture, raw_inputs, policy)
    }

    fn load_test_vector() -> (Vec<u8>, TestVector, RuntimeConfigManifestPayload) {
        let fixture: TestVector = serde_json::from_str(include_str!(
            "../../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/fixtures/tlsn-runtime-config-manifest-v2-vector.json"
        ))
        .unwrap();
        assert!(fixture.test_only);
        let compressed = URL_SAFE_NO_PAD
            .decode(&fixture.envelope_gzip_base64url)
            .unwrap();
        let mut decoder = GzDecoder::new(compressed.as_slice());
        let mut raw = Vec::new();
        decoder.read_to_end(&mut raw).unwrap();
        assert_eq!(raw.len(), fixture.envelope_uncompressed_bytes);

        let envelope: RuntimeConfigManifestEnvelope = serde_json::from_slice(&raw).unwrap();
        let payload_bytes =
            decode_canonical_base64url(&envelope.payload_base64url, "payload").unwrap();
        let payload: RuntimeConfigManifestPayload = serde_json::from_slice(&payload_bytes).unwrap();
        (raw, fixture, payload)
    }

    fn policy_for(payload: &RuntimeConfigManifestPayload) -> RuntimeConfigVerificationPolicy {
        let observed_at = parse_canonical_utc(&payload.source.observed_at).unwrap();
        RuntimeConfigVerificationPolicy {
            now: observed_at + chrono::Duration::seconds(1),
            last_accepted_epoch: "0".to_owned(),
            last_accepted_manifest_sha256: None,
            max_lifetime_seconds: 3600,
            max_clock_skew_seconds: 30,
            max_reference_age_seconds: 600,
            max_envelope_bytes: 4096,
        }
    }

    #[cfg(feature = "tlsn-production")]
    async fn serve_http_response(
        response: Vec<u8>,
        delay: Duration,
    ) -> (Url, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request).await;
            tokio::time::sleep(delay).await;
            let _ = stream.write_all(&response).await;
        });
        (
            Url::parse(&format!("http://{address}/object")).unwrap(),
            server,
        )
    }

    #[cfg(feature = "tlsn-production")]
    fn test_http_client(timeout: Duration) -> reqwest::Client {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(timeout)
            .build()
            .unwrap()
    }

    fn trusted_signer(fixture: TestVector) -> RuntimeConfigTrustedSigner {
        RuntimeConfigTrustedSigner {
            scope: fixture.trusted_signer.scope,
            key_id: fixture.trusted_signer.key_id,
            public_key_spki: fixture.trusted_signer.public_key_spki,
        }
    }

    #[test]
    fn production_bootstrap_remains_blocked_until_endpoint_and_root_are_registered() {
        assert_eq!(
            RuntimeConfigBootstrap::from_embedded().unwrap_err(),
            RuntimeConfigManifestError::Invalid(
                "Production Runtime Config bootstrap is not registered"
            )
        );
    }

    #[test]
    fn bootstrap_endpoint_requires_the_canonical_https_dns_path() {
        let valid = "https://runtime-config.example.org/tlsn/runtime-config/v2/manifest.json";
        assert_eq!(
            validate_runtime_config_manifest_url(valid)
                .unwrap()
                .as_str(),
            valid
        );
        for invalid in [
            "http://runtime-config.example.org/tlsn/runtime-config/v2/manifest.json",
            "https://RUNTIME-config.example.org/tlsn/runtime-config/v2/manifest.json",
            "https://localhost/tlsn/runtime-config/v2/manifest.json",
            "https://runtime-config.example.123/tlsn/runtime-config/v2/manifest.json",
            "https://runtime-config.example.xn--p1ai/tlsn/runtime-config/v2/manifest.json",
            "https://user@runtime-config.example.org/tlsn/runtime-config/v2/manifest.json",
            "https://127.0.0.1/tlsn/runtime-config/v2/manifest.json",
            "https://runtime-config.example.org:443/tlsn/runtime-config/v2/manifest.json",
            "https://runtime-config.example.org/tlsn/runtime-config/v2/manifest.json?latest",
            "https://runtime-config.example.org/health",
        ] {
            assert!(
                validate_runtime_config_manifest_url(invalid).is_err(),
                "{invalid}"
            );
        }
    }

    #[cfg(feature = "tlsn-production")]
    #[test]
    fn artifact_locations_are_deterministic_and_chunk_assembly_is_bounded() {
        let manifest_url = validate_runtime_config_manifest_url(
            "https://runtime-config.example.org/tlsn/runtime-config/v2/manifest.json",
        )
        .unwrap();
        let digest = URL_SAFE_NO_PAD.encode([0_u8; 32]);
        assert_eq!(
            runtime_config_artifact_url(&manifest_url, "worker-reference", &digest)
                .unwrap()
                .as_str(),
            format!(
                "https://runtime-config.example.org/tlsn/runtime-config/v2/artifacts/worker-reference/{digest}"
            )
        );

        let mut body = Vec::new();
        append_bounded_chunk(&mut body, b"123", 4).unwrap();
        assert_eq!(
            append_bounded_chunk(&mut body, b"45", 4),
            Err(RuntimeConfigManifestError::Transport(
                "response exceeds the byte limit"
            ))
        );
        assert_eq!(body, b"123");
    }

    #[cfg(feature = "tlsn-production")]
    #[tokio::test]
    async fn fetch_transport_rejects_redirects_and_declared_oversize_bodies() {
        let (redirect_url, redirect_server) = serve_http_response(
            b"HTTP/1.1 302 Found\r\nLocation: https://other.example.org/object\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
            Duration::ZERO,
        )
        .await;
        assert_eq!(
            fetch_bounded(&test_http_client(Duration::from_secs(1)), redirect_url, 16,).await,
            Err(RuntimeConfigManifestError::Transport(
                "endpoint returned an unexpected status or URL"
            ))
        );
        redirect_server.await.unwrap();

        let (oversized_url, oversized_server) = serve_http_response(
            b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\n12345".to_vec(),
            Duration::ZERO,
        )
        .await;
        assert_eq!(
            fetch_bounded(&test_http_client(Duration::from_secs(1)), oversized_url, 4,).await,
            Err(RuntimeConfigManifestError::Transport(
                "response exceeds the byte limit"
            ))
        );
        oversized_server.await.unwrap();
    }

    #[cfg(feature = "tlsn-production")]
    #[tokio::test]
    async fn fetch_transport_caps_streamed_bodies_and_enforces_request_timeout() {
        let (oversized_url, oversized_server) = serve_http_response(
            b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n12345".to_vec(),
            Duration::ZERO,
        )
        .await;
        assert_eq!(
            fetch_bounded(&test_http_client(Duration::from_secs(1)), oversized_url, 4,).await,
            Err(RuntimeConfigManifestError::Transport(
                "response exceeds the byte limit"
            ))
        );
        oversized_server.await.unwrap();

        let (slow_url, slow_server) = serve_http_response(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".to_vec(),
            Duration::from_millis(50),
        )
        .await;
        assert_eq!(
            fetch_bounded(&test_http_client(Duration::from_millis(5)), slow_url, 16,).await,
            Err(RuntimeConfigManifestError::Transport("request failed"))
        );
        slow_server.await.unwrap();
    }

    #[cfg(feature = "tlsn-production")]
    fn assert_registry_rejected(
        payload: &RuntimeConfigManifestPayload,
        validation_time: DateTime<Utc>,
        mutate: impl FnOnce(&mut BTreeMap<String, String>, &mut Value),
        expected: &'static str,
    ) {
        let mut inputs = payload.compile_inputs.clone();
        let registry_input = "FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY";
        let mut registry: Value =
            serde_json::from_str(inputs.get(registry_input).unwrap()).unwrap();
        mutate(&mut inputs, &mut registry);
        inputs.insert(
            registry_input.to_owned(),
            serde_json::to_string(&registry).unwrap(),
        );
        assert_eq!(
            validate_result_registry(&inputs, validation_time),
            Err(RuntimeConfigManifestError::Invalid(expected))
        );
    }

    #[test]
    fn rejects_missing_external_trust_anchor_and_malformed_policy() {
        assert_eq!(
            verify_signed_runtime_config_manifest(
                b"{}",
                &RuntimeConfigTrustedSigner {
                    scope: "fusou-result-signing-key-registry-envelope".to_owned(),
                    key_id: "result-root".to_owned(),
                    public_key_spki: String::new(),
                },
                &RuntimeConfigVerificationPolicy {
                    now: Utc::now(),
                    last_accepted_epoch: "0".to_owned(),
                    last_accepted_manifest_sha256: None,
                    max_lifetime_seconds: 3600,
                    max_clock_skew_seconds: 30,
                    max_reference_age_seconds: 600,
                    max_envelope_bytes: 4096,
                }
            ),
            Err(RuntimeConfigManifestError::Invalid(
                "trusted signer is not scoped to runtime configuration"
            ))
        );
        let (_, fixture, payload) = load_test_vector();
        let policy = policy_for(&payload);
        let mut missing_key = trusted_signer(fixture);
        missing_key.public_key_spki.clear();
        assert_eq!(
            verify_signed_runtime_config_manifest(b"{}", &missing_key, &policy),
            Err(RuntimeConfigManifestError::Invalid("Ed25519 SPKI key"))
        );

        let (_, fixture, payload) = load_test_vector();
        let mut invalid_key_id = trusted_signer(fixture);
        invalid_key_id.key_id = "invalid key ID".to_owned();
        assert_eq!(
            verify_signed_runtime_config_manifest(b"{}", &invalid_key_id, &policy_for(&payload)),
            Err(RuntimeConfigManifestError::Invalid("key ID is invalid"))
        );

        assert!(validate_policy(&RuntimeConfigVerificationPolicy {
            now: Utc::now(),
            last_accepted_epoch: "00".to_owned(),
            last_accepted_manifest_sha256: None,
            max_lifetime_seconds: 3600,
            max_clock_skew_seconds: 30,
            max_reference_age_seconds: 600,
            max_envelope_bytes: 4096,
        })
        .is_err());
    }

    #[test]
    fn manifest_errors_are_static_and_distinguish_invalid_input_from_bad_signature() {
        let invalid = RuntimeConfigManifestError::Invalid("expected error");
        assert_eq!(
            invalid.to_string(),
            "runtime configuration manifest is invalid: expected error"
        );
        assert_eq!(
            RuntimeConfigManifestError::InvalidSignature.to_string(),
            "runtime configuration signature verification failed"
        );
    }

    #[test]
    fn source_and_authority_pin_types_require_all_fields_and_reject_unknown_fields() {
        let (_, _, payload) = load_test_vector();

        let mut source = serde_json::to_value(&payload.source).unwrap();
        source
            .as_object_mut()
            .unwrap()
            .remove("worker_reference_sha256");
        assert!(serde_json::from_value::<RuntimeConfigManifestSource>(source).is_err());

        let mut source = serde_json::to_value(&payload.source).unwrap();
        source.as_object_mut().unwrap().insert(
            "unverified_source".to_owned(),
            Value::String("fixture".to_owned()),
        );
        assert!(serde_json::from_value::<RuntimeConfigManifestSource>(source).is_err());

        let mut pins = serde_json::to_value(&payload.production_authority_pins).unwrap();
        pins.as_object_mut()
            .unwrap()
            .remove("target_approval_artifact_sha256");
        assert!(serde_json::from_value::<ProductionAuthorityPins>(pins).is_err());

        let mut pins = serde_json::to_value(&payload.production_authority_pins).unwrap();
        pins.as_object_mut().unwrap().insert(
            "fixture_authority".to_owned(),
            Value::String("test".to_owned()),
        );
        assert!(serde_json::from_value::<ProductionAuthorityPins>(pins).is_err());
    }

    #[test]
    fn policy_and_canonical_helper_boundaries_are_explicit() {
        let (_, _, payload) = load_test_vector();
        let mut policy = policy_for(&payload);
        assert!(validate_policy(&policy).is_ok());

        for invalid_epoch in ["", "00", "01", "+1", "18446744073709551616"] {
            assert!(parse_epoch(invalid_epoch, true).is_err(), "{invalid_epoch}");
        }
        assert_eq!(parse_epoch("18446744073709551615", false), Ok(u64::MAX));
        assert_eq!(
            seconds_to_millis(MAX_SAFE_POLICY_SECONDS),
            Ok((MAX_SAFE_POLICY_SECONDS * 1000) as i64)
        );
        assert!(seconds_to_millis(MAX_SAFE_POLICY_SECONDS + 1).is_err());
        assert!(parse_canonical_utc("2030-01-01T00:00:00Z").is_err());
        assert!(parse_canonical_utc("2030-01-01T01:00:00.000+01:00").is_err());

        policy.max_lifetime_seconds = 0;
        assert!(validate_policy(&policy).is_err());
        policy = policy_for(&payload);
        policy.max_clock_skew_seconds = MAX_SAFE_POLICY_SECONDS + 1;
        assert!(validate_policy(&policy).is_err());
        policy = policy_for(&payload);
        if let Ok(oversized) = usize::try_from(MAX_SAFE_JS_INTEGER + 1) {
            policy.max_envelope_bytes = oversized;
            assert!(validate_policy(&policy).is_err());
        }
    }

    #[cfg(feature = "tlsn-production")]
    #[test]
    fn result_registry_rejects_invalid_schema_keys_and_validity_windows() {
        let (_, _, payload) = load_test_vector();
        let validation_time = policy_for(&payload).now;
        let registry_input = "FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY";

        let mut invalid_json = payload.compile_inputs.clone();
        invalid_json.insert(registry_input.to_owned(), "{".to_owned());
        assert_eq!(
            validate_result_registry(&invalid_json, validation_time),
            Err(RuntimeConfigManifestError::Invalid(
                "Result key registry JSON is invalid"
            ))
        );

        let cases: Vec<(
            &str,
            Box<dyn FnOnce(&mut BTreeMap<String, String>, &mut Value)>,
        )> = vec![
            (
                "Result key registry schema or scope is invalid",
                Box::new(|_, registry| registry["schema_version"] = Value::from(2)),
            ),
            (
                "Result key registry schema or scope is invalid",
                Box::new(|_, registry| registry["scope"] = Value::String("wrong-scope".to_owned())),
            ),
            (
                "Result key registry keys are missing",
                Box::new(|_, registry| {
                    registry.as_object_mut().unwrap().remove("keys");
                }),
            ),
            (
                "Result key registry is empty",
                Box::new(|_, registry| registry["keys"] = Value::Array(Vec::new())),
            ),
            (
                "Result registry key ID is missing",
                Box::new(|_, registry| {
                    registry["keys"][0]
                        .as_object_mut()
                        .unwrap()
                        .remove("key_id");
                }),
            ),
            (
                "key ID is invalid",
                Box::new(|_, registry| {
                    registry["keys"][0]["key_id"] = Value::String("not a key id".to_owned())
                }),
            ),
            (
                "Result key registry contains a duplicate key ID",
                Box::new(|_, registry| {
                    let key = registry["keys"][0].clone();
                    registry["keys"].as_array_mut().unwrap().push(key);
                }),
            ),
            (
                "Result registry public key is missing",
                Box::new(|_, registry| {
                    registry["keys"][0]
                        .as_object_mut()
                        .unwrap()
                        .remove("public_key_spki");
                }),
            ),
            (
                "Ed25519 SPKI key",
                Box::new(|_, registry| {
                    registry["keys"][0]["public_key_spki"] = Value::String("A".to_owned())
                }),
            ),
            (
                "Result registry key status is missing",
                Box::new(|_, registry| {
                    registry["keys"][0]
                        .as_object_mut()
                        .unwrap()
                        .remove("status");
                }),
            ),
            (
                "Result key registry status is invalid",
                Box::new(|_, registry| {
                    registry["keys"][0]["status"] = Value::String("UNKNOWN".to_owned())
                }),
            ),
            (
                "Result registry not_before is missing",
                Box::new(|_, registry| {
                    registry["keys"][0]
                        .as_object_mut()
                        .unwrap()
                        .remove("not_before");
                }),
            ),
            (
                "Result registry not_before is not canonical UTC RFC3339",
                Box::new(|_, registry| {
                    registry["keys"][0]["not_before"] =
                        Value::String("2020-01-01T00:00:00Z".to_owned())
                }),
            ),
            (
                "Result registry not_after is not canonical UTC RFC3339",
                Box::new(|_, registry| {
                    registry["keys"][0]["not_after"] =
                        Value::String("2099-01-01T00:00:00Z".to_owned())
                }),
            ),
            (
                "Result registry not_after is invalid",
                Box::new(|_, registry| {
                    registry["keys"][0]
                        .as_object_mut()
                        .unwrap()
                        .remove("not_after");
                }),
            ),
            (
                "Result registry not_after is invalid",
                Box::new(|_, registry| registry["keys"][0]["not_after"] = Value::from(1)),
            ),
            (
                "Result registry key validity window is invalid",
                Box::new(|_, registry| {
                    registry["keys"][0]["not_after"] =
                        Value::String("2019-01-01T00:00:00.000Z".to_owned())
                }),
            ),
            (
                "Result signer is not in the published registry",
                Box::new(|inputs, _| {
                    inputs.insert(
                        "FUSOU_TLSN_RESULT_SIGNER_KEY_ID".to_owned(),
                        "unknown-result-key".to_owned(),
                    );
                }),
            ),
            (
                "Result signer public key does not match the registry",
                Box::new(|inputs, _| {
                    let other_key = inputs
                        .get("FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY")
                        .unwrap()
                        .clone();
                    inputs.insert("FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI".to_owned(), other_key);
                }),
            ),
            (
                "Result signer is not ACTIVE and valid at verification time",
                Box::new(|_, registry| {
                    registry["keys"][0]["status"] = Value::String("VERIFY_ONLY".to_owned())
                }),
            ),
            (
                "Result signer is not ACTIVE and valid at verification time",
                Box::new(|_, registry| {
                    registry["keys"][0]["not_before"] =
                        Value::String("2099-01-01T00:00:00.000Z".to_owned())
                }),
            ),
        ];

        for (expected, mutate) in cases {
            assert_registry_rejected(&payload, validation_time, mutate, expected);
        }

        let mut expired_inputs = payload.compile_inputs.clone();
        let mut expired_registry: Value =
            serde_json::from_str(expired_inputs.get(registry_input).unwrap()).unwrap();
        let expired_at = validation_time - chrono::Duration::seconds(1);
        let not_before = expired_at - chrono::Duration::seconds(1);
        expired_registry["keys"][0]["not_before"] =
            Value::String(not_before.to_rfc3339_opts(SecondsFormat::Millis, true));
        expired_registry["keys"][0]["not_after"] =
            Value::String(expired_at.to_rfc3339_opts(SecondsFormat::Millis, true));
        expired_inputs.insert(
            registry_input.to_owned(),
            serde_json::to_string(&expired_registry).unwrap(),
        );
        assert_eq!(
            validate_result_registry(&expired_inputs, validation_time),
            Err(RuntimeConfigManifestError::Invalid(
                "Result signer is not ACTIVE and valid at verification time"
            ))
        );
    }

    #[cfg(not(feature = "tlsn-production"))]
    #[test]
    fn valid_test_signed_manifest_is_rejected_when_production_feature_is_disabled() {
        let (raw, fixture, payload) = load_test_vector();
        let error = verify_signed_runtime_config_manifest(
            &raw,
            &trusted_signer(fixture),
            &policy_for(&payload),
        )
        .unwrap_err();
        assert_eq!(
            error,
            RuntimeConfigManifestError::Invalid(
                "cannot validate alpha.15 Notary key format because tlsn-production is disabled"
            )
        );
    }

    #[cfg(feature = "tlsn-production")]
    #[test]
    fn verifies_the_shared_node_golden_vector_and_rejects_mutations() {
        let (raw, fixture, payload) = load_test_vector();
        let policy = policy_for(&payload);
        let trusted_signer = trusted_signer(fixture);
        let verified =
            verify_signed_runtime_config_manifest(&raw, &trusted_signer, &policy).unwrap();
        assert_eq!(verified.epoch, "1");
        assert_eq!(
            verified
                .production_authority_pins
                .origin_inventory_sha256
                .len(),
            43
        );
        assert_eq!(verified.compile_inputs.len(), COMPILE_INPUT_NAMES.len());

        let registry_input_name = "FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY";
        let mut inactive_registry_inputs = verified.compile_inputs.clone();
        let mut inactive_registry: Value =
            serde_json::from_str(inactive_registry_inputs.get(registry_input_name).unwrap())
                .unwrap();
        let signer_key_id = inactive_registry_inputs
            .get("FUSOU_TLSN_RESULT_SIGNER_KEY_ID")
            .unwrap();
        let signer = inactive_registry["keys"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|entry| entry["key_id"].as_str() == Some(signer_key_id))
            .unwrap();
        signer["status"] = Value::String("VERIFY_ONLY".to_owned());
        inactive_registry_inputs.insert(
            registry_input_name.to_owned(),
            serde_json::to_string(&inactive_registry).unwrap(),
        );
        assert_eq!(
            validate_result_registry(&inactive_registry_inputs, policy.now),
            Err(RuntimeConfigManifestError::Invalid(
                "Result signer is not ACTIVE and valid at verification time"
            ))
        );

        let mut wrong_scope = trusted_signer.clone();
        wrong_scope.scope = "fusou-result-signing-key-registry-envelope".to_owned();
        assert_eq!(
            verify_signed_runtime_config_manifest(&raw, &wrong_scope, &policy),
            Err(RuntimeConfigManifestError::Invalid(
                "trusted signer is not scoped to runtime configuration"
            ))
        );

        let manifest_sha256 = sha256_base64url(&raw);
        let mut exact_epoch_policy = policy.clone();
        exact_epoch_policy.last_accepted_epoch = "1".to_owned();
        exact_epoch_policy.last_accepted_manifest_sha256 = Some(manifest_sha256.clone());
        assert!(
            verify_signed_runtime_config_manifest(&raw, &trusted_signer, &exact_epoch_policy)
                .is_ok()
        );

        let mut same_epoch_mutation_policy = exact_epoch_policy.clone();
        same_epoch_mutation_policy.last_accepted_manifest_sha256 = Some("A".repeat(43));
        assert_eq!(
            verify_signed_runtime_config_manifest(
                &raw,
                &trusted_signer,
                &same_epoch_mutation_policy
            ),
            Err(RuntimeConfigManifestError::Invalid(
                "epoch was already accepted with different manifest bytes"
            ))
        );

        let mut rollback_policy = policy.clone();
        rollback_policy.last_accepted_epoch = "2".to_owned();
        rollback_policy.last_accepted_manifest_sha256 = Some("A".repeat(43));
        assert_eq!(
            verify_signed_runtime_config_manifest(&raw, &trusted_signer, &rollback_policy),
            Err(RuntimeConfigManifestError::Invalid(
                "epoch is older than the persisted high-water mark"
            ))
        );

        let mut size_policy = policy.clone();
        size_policy.max_envelope_bytes = raw.len() - 1;
        assert_eq!(
            verify_signed_runtime_config_manifest(&raw, &trusted_signer, &size_policy),
            Err(RuntimeConfigManifestError::Invalid(
                "envelope exceeds the supplied byte limit"
            ))
        );

        let mut whitespace_mutation = raw.clone();
        whitespace_mutation.push(b' ');
        assert_eq!(
            verify_signed_runtime_config_manifest(&whitespace_mutation, &trusted_signer, &policy),
            Err(RuntimeConfigManifestError::Invalid(
                "envelope is not canonical JSON"
            ))
        );

        let mut signature_mutation = raw.clone();
        let marker = b"\"signature_base64url\":\"";
        let signature_offset = signature_mutation
            .windows(marker.len())
            .position(|window| window == marker)
            .unwrap()
            + marker.len();
        signature_mutation[signature_offset] = if signature_mutation[signature_offset] == b'A' {
            b'B'
        } else {
            b'A'
        };
        assert_eq!(
            verify_signed_runtime_config_manifest(&signature_mutation, &trusted_signer, &policy),
            Err(RuntimeConfigManifestError::InvalidSignature)
        );

        let mut unauthenticated_payload: Value = serde_json::from_slice(&raw).unwrap();
        unauthenticated_payload["payload_base64url"] = Value::String(URL_SAFE_NO_PAD.encode(b"{"));
        let unauthenticated_payload = canonical_json_bytes(&unauthenticated_payload).unwrap();
        assert_eq!(
            verify_signed_runtime_config_manifest(
                &unauthenticated_payload,
                &trusted_signer,
                &policy
            ),
            Err(RuntimeConfigManifestError::InvalidSignature)
        );

        let mut malformed_payload = payload.clone();
        malformed_payload.source.active_version_id =
            "00000000-0000-0000-0000-000000000000".to_owned();
        assert_eq!(
            validate_payload(&malformed_payload, policy.now),
            Err(RuntimeConfigManifestError::Invalid(
                "Worker source identity is invalid"
            ))
        );

        let mut malformed_payload = payload.clone();
        malformed_payload.source.worker_reference_sha256 = "A".to_owned();
        assert!(validate_payload(&malformed_payload, policy.now).is_err());

        let mut malformed_payload = payload.clone();
        malformed_payload.source.account_id = "Z".repeat(32);
        assert_eq!(
            validate_payload(&malformed_payload, policy.now),
            Err(RuntimeConfigManifestError::Invalid(
                "Worker source identity is invalid"
            ))
        );

        let mut malformed_payload = payload.clone();
        malformed_payload.source.script_name = "Uppercase-Worker".to_owned();
        assert_eq!(
            validate_payload(&malformed_payload, policy.now),
            Err(RuntimeConfigManifestError::Invalid(
                "Worker source identity is invalid"
            ))
        );

        let mut sparse_payload = payload.clone();
        sparse_payload.source.disclosure_mode = "sparse".to_owned();
        sparse_payload.compile_inputs.insert(
            "FUSOU_TLSN_VERIFICATION_ENDPOINT".to_owned(),
            payload.compile_inputs["FUSOU_TLSN_VERIFICATION_ENDPOINT"]
                .replace("/verify/tlsn", "/verify/tlsn/sparse"),
        );
        assert_eq!(validate_payload(&sparse_payload, policy.now), Ok(()));

        for endpoint in [
            "https://user@worker.example.test/health",
            "https://worker.example.test:443/health",
            "https://worker.example.test/health?x=1",
            "https://worker.example.test/health#fragment",
            "https://WORKER.example.test/health",
        ] {
            let mut malformed_payload = payload.clone();
            malformed_payload.compile_inputs.insert(
                "FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT".to_owned(),
                endpoint.to_owned(),
            );
            assert!(
                validate_payload(&malformed_payload, policy.now).is_err(),
                "{endpoint}"
            );
        }

        let mut malformed_payload = payload.clone();
        malformed_payload.compile_inputs.insert(
            "FUSOU_TLSN_NOTARY_ENDPOINT".to_owned(),
            "notary.example.test".to_owned(),
        );
        assert_eq!(
            validate_payload(&malformed_payload, policy.now),
            Err(RuntimeConfigManifestError::Invalid(
                "Notary endpoint must use host:port syntax"
            ))
        );

        let mut malformed_payload = payload.clone();
        malformed_payload.compile_inputs.insert(
            "FUSOU_TLSN_NOTARY_ENDPOINT".to_owned(),
            "notary.example.test:+7047".to_owned(),
        );
        assert_eq!(
            validate_payload(&malformed_payload, policy.now),
            Err(RuntimeConfigManifestError::Invalid(
                "Notary port is invalid"
            ))
        );

        let mut malformed_payload = payload.clone();
        malformed_payload.compile_inputs.insert(
            "FUSOU_TLSN_NOTARY_ENDPOINT".to_owned(),
            "[[::1]]:7047".to_owned(),
        );
        assert_eq!(
            validate_payload(&malformed_payload, policy.now),
            Err(RuntimeConfigManifestError::Invalid(
                "Notary endpoint host is invalid"
            ))
        );

        let mut malformed_payload = payload.clone();
        malformed_payload.compile_inputs.insert(
            "FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT".to_owned(),
            "https://worker.example.test/not-health".to_owned(),
        );
        assert!(validate_payload(&malformed_payload, policy.now).is_err());

        let mut malformed_payload = payload.clone();
        malformed_payload.compile_inputs.insert(
            "FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT".to_owned(),
            "https://127.0.0.1/health".to_owned(),
        );
        assert!(validate_payload(&malformed_payload, policy.now).is_err());

        let mut malformed_payload = payload.clone();
        malformed_payload.compile_inputs.insert(
            "FUSOU_TLSN_VERIFICATION_ENDPOINT".to_owned(),
            "https://other.example.test/verify/tlsn".to_owned(),
        );
        assert_eq!(
            validate_payload(&malformed_payload, policy.now),
            Err(RuntimeConfigManifestError::Invalid(
                "Worker endpoint origins disagree"
            ))
        );

        let mut malformed_payload = payload.clone();
        let registry_input = "FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY";
        let mut registry: Value = serde_json::from_str(
            malformed_payload
                .compile_inputs
                .get(registry_input)
                .unwrap(),
        )
        .unwrap();
        registry["keys"][0]["not_before"] = Value::String("2020-01-01T00:00:00Z".to_owned());
        malformed_payload.compile_inputs.insert(
            registry_input.to_owned(),
            serde_json::to_string(&registry).unwrap(),
        );
        assert!(validate_payload(&malformed_payload, policy.now).is_err());

        let mut malformed_payload = payload;
        malformed_payload
            .production_authority_pins
            .target_approval_artifact_sha256
            .clear();
        assert!(validate_payload(&malformed_payload, policy.now).is_err());
    }

    #[cfg(feature = "tlsn-production")]
    #[test]
    fn verifies_the_shared_signed_pin_vector_and_returns_only_matched_bindings() {
        let (fixture, raw_inputs, policy) = load_independent_verification_vector();
        let verified = verify_runtime_config_manifest(
            fixture.manifest_envelope_utf8.as_bytes(),
            &fixture.trusted_signer,
            &policy,
            Some(&raw_inputs.verification_inputs()),
        )
        .unwrap();

        assert_eq!(verified.payload().epoch, "1");
        let approved_identity = verified
            .approved_targets()
            .first()
            .expect("verified Target Approval contains targets")
            .server_identity();
        assert!(verified.approved_target(approved_identity).is_some());
        assert!(verified
            .approved_target(&approved_identity.to_ascii_uppercase())
            .is_none());
        assert!(verified.approved_target("192.0.2.1").is_none());
        assert!(verified
            .approved_target("https://game.example.test")
            .is_none());
        assert_eq!(
            verified.independent_verification().worker_reference_sha256,
            verified.payload().source.worker_reference_sha256
        );
        assert_eq!(
            verified.independent_verification().origin_inventory_sha256,
            verified
                .payload()
                .production_authority_pins
                .origin_inventory_sha256
        );
        assert_eq!(
            verified
                .independent_verification()
                .target_approval_artifact_sha256,
            verified
                .payload()
                .production_authority_pins
                .target_approval_artifact_sha256
        );
        assert_eq!(
            verified
                .independent_verification()
                .result_registry_root_key_id,
            verified
                .payload()
                .result_registry_pins
                .result_registry_root_key_id
        );
    }

    #[cfg(feature = "tlsn-production")]
    #[test]
    fn production_inventory_rejects_noncanonical_server_identity_before_approval_matching() {
        let (fixture, raw_inputs, policy) = load_independent_verification_vector();
        let payload = verify_signed_runtime_config_manifest(
            fixture.manifest_envelope_utf8.as_bytes(),
            &fixture.trusted_signer,
            &policy,
        )
        .unwrap();

        for invalid_identity in [
            "SERVER01.fusou-data.net",
            "192.0.2.1",
            "server01.123",
            "https://server01.fusou-data.net",
        ] {
            let mut inventory: Value =
                serde_json::from_slice(&raw_inputs.origin_inventory).unwrap();
            inventory["targets"][0]["server_identity"] = Value::String(invalid_identity.to_owned());
            let raw_inventory = serde_json::to_vec(&inventory).unwrap();

            assert!(matches!(
                validate_authority_artifacts(
                    &payload,
                    &raw_inventory,
                    &raw_inputs.target_approval,
                    &raw_inputs.security_registry_set,
                    &payload.production_authority_pins.origin_inventory_sha256,
                    &payload
                        .production_authority_pins
                        .target_approval_artifact_sha256,
                ),
                Err(RuntimeConfigManifestError::Invalid(
                    "Origin Inventory targets are invalid, unordered, or duplicated"
                ))
            ));
        }
    }

    #[cfg(feature = "tlsn-production")]
    #[test]
    fn rejects_missing_or_mismatched_independent_production_inputs() {
        let (fixture, raw_inputs, policy) = load_independent_verification_vector();
        assert_eq!(
            verify_runtime_config_manifest(
                fixture.manifest_envelope_utf8.as_bytes(),
                &fixture.trusted_signer,
                &policy,
                None,
            ),
            Err(RuntimeConfigManifestError::Invalid(
                "independent Production verification inputs are missing"
            ))
        );
        assert_eq!(
            verify_independent_runtime_config_inputs(
                &verify_signed_runtime_config_manifest(
                    fixture.manifest_envelope_utf8.as_bytes(),
                    &fixture.trusted_signer,
                    &policy,
                )
                .unwrap(),
                &policy,
                &RuntimeConfigIndependentVerificationInputs::default(),
            ),
            Err(RuntimeConfigManifestError::Invalid(
                "raw approved Worker reference bytes are missing"
            ))
        );

        let mut changed_reference = IndependentVerificationRawInputs {
            worker_reference: raw_inputs.worker_reference.clone(),
            origin_inventory: raw_inputs.origin_inventory.clone(),
            target_approval: raw_inputs.target_approval.clone(),
            security_registry_set: raw_inputs.security_registry_set.clone(),
            result_registry_envelope: raw_inputs.result_registry_envelope.clone(),
        };
        changed_reference.worker_reference[0] ^= 1;
        assert_eq!(
            verify_runtime_config_manifest(
                fixture.manifest_envelope_utf8.as_bytes(),
                &fixture.trusted_signer,
                &policy,
                Some(&changed_reference.verification_inputs()),
            ),
            Err(RuntimeConfigManifestError::Invalid(
                "Worker reference bytes do not match the signed manifest digest"
            ))
        );

        let mut swapped_authority_artifacts = raw_inputs.clone();
        std::mem::swap(
            &mut swapped_authority_artifacts.origin_inventory,
            &mut swapped_authority_artifacts.target_approval,
        );
        assert_eq!(
            verify_runtime_config_manifest(
                fixture.manifest_envelope_utf8.as_bytes(),
                &fixture.trusted_signer,
                &policy,
                Some(&swapped_authority_artifacts.verification_inputs()),
            ),
            Err(RuntimeConfigManifestError::Invalid(
                "Production authority artifact bytes do not match signed manifest digests"
            ))
        );

        let mut changed_approval = raw_inputs.clone();
        changed_approval.target_approval[0] ^= 1;
        assert_eq!(
            verify_runtime_config_manifest(
                fixture.manifest_envelope_utf8.as_bytes(),
                &fixture.trusted_signer,
                &policy,
                Some(&changed_approval.verification_inputs()),
            ),
            Err(RuntimeConfigManifestError::Invalid(
                "Production authority artifact bytes do not match signed manifest digests"
            ))
        );

        let mut changed_manifest = verify_signed_runtime_config_manifest(
            fixture.manifest_envelope_utf8.as_bytes(),
            &fixture.trusted_signer,
            &policy,
        )
        .unwrap();
        changed_manifest
            .production_authority_pins
            .target_approval_artifact_sha256 = "A".repeat(43);
        assert_eq!(
            verify_independent_runtime_config_inputs(
                &changed_manifest,
                &policy,
                &raw_inputs.verification_inputs(),
            ),
            Err(RuntimeConfigManifestError::Invalid(
                "Production authority artifact bytes do not match signed manifest digests"
            ))
        );
    }

    #[cfg(feature = "tlsn-production")]
    #[test]
    fn requires_signed_result_registry_root_and_valid_signature_over_matching_registry() {
        let (fixture, raw_inputs, policy) = load_independent_verification_vector();
        let payload = verify_signed_runtime_config_manifest(
            fixture.manifest_envelope_utf8.as_bytes(),
            &fixture.trusted_signer,
            &policy,
        )
        .unwrap();
        let mut wrong_root = payload.result_registry_pins.clone();
        wrong_root.result_registry_root_key_id = "untrusted-root".to_owned();
        assert_eq!(
            verify_result_registry_envelope(
                &payload,
                policy.now,
                &raw_inputs.result_registry_envelope,
                &wrong_root,
                &payload.result_registry_pins.result_registry_sha256,
            ),
            Err(RuntimeConfigManifestError::Invalid(
                "Result registry root does not match the signed manifest pin"
            ))
        );

        let mut changed_envelope_bytes = serde_json::to_vec(
            &serde_json::from_slice::<Value>(&raw_inputs.result_registry_envelope).unwrap(),
        )
        .unwrap();
        changed_envelope_bytes.insert(0, b' ');
        let mut changed_raw_inputs = raw_inputs.clone();
        changed_raw_inputs.result_registry_envelope = changed_envelope_bytes;
        assert_eq!(
            verify_runtime_config_manifest(
                fixture.manifest_envelope_utf8.as_bytes(),
                &fixture.trusted_signer,
                &policy,
                Some(&changed_raw_inputs.verification_inputs()),
            ),
            Err(RuntimeConfigManifestError::Invalid(
                "Worker reference identity does not match the signed manifest"
            ))
        );

        let mut changed_signature = raw_inputs.result_registry_envelope.clone();
        let marker = b"\"signature_base64url\":\"";
        let signature_offset = changed_signature
            .windows(marker.len())
            .position(|window| window == marker)
            .unwrap()
            + marker.len();
        changed_signature[signature_offset] = if changed_signature[signature_offset] == b'A' {
            b'B'
        } else {
            b'A'
        };
        assert_eq!(
            verify_result_registry_envelope(
                &payload,
                policy.now,
                &changed_signature,
                &payload.result_registry_pins,
                &payload.result_registry_pins.result_registry_sha256,
            ),
            Err(RuntimeConfigManifestError::InvalidResultRegistrySignature)
        );
    }

    #[cfg(feature = "tlsn-production")]
    #[test]
    fn signed_pin_mutation_fails_outer_manifest_signature_verification() {
        let (fixture, raw_inputs, policy) = load_independent_verification_vector();
        let mut envelope: RuntimeConfigManifestEnvelope =
            serde_json::from_str(&fixture.manifest_envelope_utf8).unwrap();
        let payload_bytes =
            decode_canonical_base64url(&envelope.payload_base64url, "payload").unwrap();
        let mut payload: RuntimeConfigManifestPayload =
            serde_json::from_slice(&payload_bytes).unwrap();
        payload.result_registry_pins.result_registry_root_key_id =
            "attacker-controlled-root".to_owned();
        envelope.payload_base64url =
            URL_SAFE_NO_PAD.encode(canonical_json_bytes(&payload).unwrap());
        let tampered_envelope = canonical_json_bytes(&envelope).unwrap();
        assert_eq!(
            verify_runtime_config_manifest(
                &tampered_envelope,
                &fixture.trusted_signer,
                &policy,
                Some(&raw_inputs.verification_inputs()),
            ),
            Err(RuntimeConfigManifestError::InvalidSignature)
        );
    }

    #[cfg(not(feature = "tlsn-production"))]
    #[test]
    fn independent_production_verifier_fails_closed_without_production_feature() {
        let (raw, fixture, payload) = load_test_vector();
        let policy = policy_for(&payload);
        assert_eq!(
            verify_runtime_config_manifest(&raw, &trusted_signer(fixture), &policy, None,),
            Err(RuntimeConfigManifestError::Invalid(
                "independent Production verification requires tlsn-production"
            ))
        );
    }
}
