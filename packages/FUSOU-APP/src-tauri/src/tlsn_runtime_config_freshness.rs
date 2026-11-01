use super::*;
use crate::tlsn_runtime_config_runtime::{
    write_state_atomic_bytes, MAX_CLOCK_SKEW_SECONDS, MAX_MANIFEST_ENVELOPE_BYTES,
    MAX_MANIFEST_LIFETIME_SECONDS, MAX_WORKER_REFERENCE_AGE_SECONDS,
};
use futures::StreamExt;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    pin::Pin,
    time::Duration,
};
use tokio::time::Instant;

const REQUEST_SCOPE: &str = "fusou-tlsn-runtime-config-freshness-request-v1";
const RESPONSE_ENVELOPE_SCOPE: &str = "fusou-tlsn-runtime-config-freshness-envelope-v1";
const RESPONSE_PAYLOAD_SCOPE: &str = "fusou-tlsn-runtime-config-freshness-response-v1";
const DELEGATION_ENVELOPE_SCOPE: &str = "fusou-tlsn-runtime-config-delegation-envelope-v1";
const DELEGATION_PAYLOAD_SCOPE: &str = "fusou-tlsn-runtime-config-delegation-v1";
const RELEASE_ENVELOPE_SCOPE: &str = "fusou-tlsn-runtime-config-release-commit-envelope-v1";
const RELEASE_PAYLOAD_SCOPE: &str = "fusou-tlsn-runtime-config-release-commit-v1";
const REQUEST_PATH: &str = "/tlsn/runtime-config/v2/freshness/v1";
const IMMUTABLE_MANIFEST_PREFIX: &str = "tlsn/runtime-config/v2/manifests/";
const RELEASE_AUDIENCE_PREFIX: &str = "fusou-tlsn-runtime-config-v2:";
const FRESHNESS_DELEGATION_DOMAIN: &[u8] = b"FUSOU-TLSN-RUNTIME-CONFIG-DELEGATION-V1\0";
const RELEASE_COMMIT_DOMAIN: &[u8] = b"FUSOU-TLSN-RUNTIME-CONFIG-RELEASE-COMMIT-V1\0";
const FRESHNESS_RESPONSE_DOMAIN: &[u8] = b"FUSOU-TLSN-RUNTIME-CONFIG-FRESHNESS-RESPONSE-V1\0";
const MAX_FRESHNESS_REQUEST_BYTES: usize = 1_024;
const MAX_FRESHNESS_RESPONSE_BYTES: usize = 65_536;
const MAX_FRESHNESS_LIFETIME_SECONDS: u64 = 86_400;
const MAX_RELEASE_LIFETIME_SECONDS: u64 = 2_592_000;
const MAX_FRESHNESS_RESPONSE_LIFETIME_SECONDS: i64 = 30;
const MAX_FRESHNESS_DEADLINE: Duration = Duration::from_secs(10);
const MAX_FRESHNESS_CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_FRESHNESS_REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_FRESHNESS_STATE_BYTES: u64 = 4_096;
const FRESHNESS_STATE_SCHEMA_VERSION: u32 = 2;
const FRESHNESS_STATE_SCOPE: &str = "fusou-tlsn-runtime-config-epoch-state-v2";
const LEGACY_EPOCH_STATE_SCOPE: &str = "fusou-tlsn-runtime-config-epoch-state-v1";

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FreshnessRequest {
    schema_version: u32,
    scope: String,
    environment: String,
    audience_manifest_url_sha256: String,
    request_nonce: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct DelegationEnvelope {
    schema_version: u32,
    scope: String,
    signature_algorithm: String,
    root_key_id: String,
    payload_base64url: String,
    signature_base64url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct DelegationPayload {
    schema_version: u32,
    scope: String,
    delegation_id: String,
    delegation_generation: String,
    environment: String,
    purpose: String,
    key_id: String,
    public_key_spki: String,
    signature_algorithm: String,
    audience: String,
    issued_at: String,
    not_before: String,
    not_after: String,
    max_validity_seconds: u64,
    revocation_mode: String,
    previous_delegation_sha256: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ReleaseCommitEnvelope {
    schema_version: u32,
    scope: String,
    signature_algorithm: String,
    signer_key_id: String,
    payload_base64url: String,
    signature_base64url: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ReleaseCommitPayload {
    schema_version: u32,
    scope: String,
    environment: String,
    commit_authorization: String,
    commit_generation: String,
    release_commit_id: String,
    manifest_schema_version: u32,
    manifest_epoch: String,
    manifest_sha256: String,
    manifest_ref: String,
    pointer_etag: String,
    previous_commit_generation: Option<String>,
    previous_commit_record_sha256: Option<String>,
    authorized_at: String,
    release_authority_delegation_id: String,
    release_authority_delegation_sha256: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FreshnessEnvelope {
    schema_version: u32,
    scope: String,
    signature_algorithm: String,
    signer_key_id: String,
    freshness_delegation_base64url: String,
    release_authority_delegation_base64url: String,
    release_commit_record_base64url: String,
    payload_base64url: String,
    signature_base64url: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FreshnessPayload {
    schema_version: u32,
    scope: String,
    freshness_semantics: String,
    environment: String,
    audience_manifest_url_sha256: String,
    request_nonce: String,
    issued_at: String,
    expires_at: String,
    latest_epoch: String,
    manifest_schema_version: u32,
    manifest_sha256: String,
    manifest_ref: String,
    pointer_generation: String,
    release_commit_id: String,
    release_commit_record_sha256: String,
    release_commit_record_appended_at: String,
    freshness_signer_key_id: String,
    freshness_delegation_id: String,
    freshness_delegation_sha256: String,
    release_authority_key_id: String,
    release_authority_delegation_id: String,
    release_authority_delegation_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct LegacyEpochState {
    schema_version: u32,
    scope: String,
    last_accepted_epoch: String,
    last_accepted_manifest_sha256: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct FreshnessEpochState {
    schema_version: u32,
    scope: String,
    last_accepted_epoch: String,
    last_accepted_manifest_sha256: Option<String>,
    commit_generation: Option<String>,
    release_commit_record_sha256: Option<String>,
    freshness_delegation_generation: Option<String>,
    freshness_delegation_sha256: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum PriorState {
    Missing,
    Legacy(LegacyEpochState),
    Current(FreshnessEpochState),
}

impl PriorState {
    fn manifest_high_water(&self) -> (&str, Option<&str>) {
        match self {
            Self::Missing => ("0", None),
            Self::Legacy(state) => (
                &state.last_accepted_epoch,
                state.last_accepted_manifest_sha256.as_deref(),
            ),
            Self::Current(state) => (
                &state.last_accepted_epoch,
                state.last_accepted_manifest_sha256.as_deref(),
            ),
        }
    }

    fn delegation_high_water(&self) -> Option<(&str, &str)> {
        match self {
            Self::Current(state) => Some((
                state.freshness_delegation_generation.as_deref()?,
                state.freshness_delegation_sha256.as_deref()?,
            )),
            _ => None,
        }
    }
}

struct VerifiedDelegation {
    payload: DelegationPayload,
    digest: String,
    not_before: DateTime<Utc>,
    not_after: DateTime<Utc>,
}

struct VerifiedReleaseCommit {
    payload: ReleaseCommitPayload,
    digest: String,
}

struct VerifiedFreshnessResponse {
    payload: FreshnessPayload,
    freshness_delegation: VerifiedDelegation,
    release_commit: VerifiedReleaseCommit,
    issued_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
}

struct FreshnessHttpClient {
    client: reqwest::Client,
}

impl FreshnessHttpClient {
    fn new() -> Result<Self, RuntimeConfigManifestError> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(MAX_FRESHNESS_CONNECT_TIMEOUT)
            .timeout(MAX_FRESHNESS_REQUEST_TIMEOUT)
            .build()
            .map_err(|_| {
                RuntimeConfigManifestError::Transport("Freshness HTTP client initialization failed")
            })?;
        Ok(Self { client })
    }

    async fn post_freshness(
        &self,
        url: Url,
        body: Vec<u8>,
        deadline: Instant,
    ) -> Result<Vec<u8>, RuntimeConfigManifestError> {
        tokio::time::timeout_at(deadline, async {
            let response = self
                .client
                .post(url.clone())
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .header(reqwest::header::ACCEPT, "application/json")
                .header(reqwest::header::CACHE_CONTROL, "no-store")
                .body(body)
                .send()
                .await
                .map_err(|_| {
                    RuntimeConfigManifestError::Transport("Freshness POST request failed")
                })?;
            read_bounded_response(response, &url, MAX_FRESHNESS_RESPONSE_BYTES).await
        })
        .await
        .map_err(|_| freshness_deadline_error())?
    }
}

struct DeadlineObjectFetcher<'a> {
    client: &'a FreshnessHttpClient,
    deadline: Instant,
}

impl RuntimeConfigObjectFetcher for DeadlineObjectFetcher<'_> {
    fn fetch<'a>(
        &'a self,
        url: Url,
        max_bytes: usize,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<u8>, RuntimeConfigManifestError>> + Send + 'a>>
    {
        Box::pin(async move {
            tokio::time::timeout_at(
                self.deadline,
                super::fetch_bounded(&self.client.client, url, max_bytes),
            )
            .await
            .map_err(|_| freshness_deadline_error())?
        })
    }
}

async fn read_bounded_response(
    response: reqwest::Response,
    expected_url: &Url,
    max_bytes: usize,
) -> Result<Vec<u8>, RuntimeConfigManifestError> {
    if response.status() != reqwest::StatusCode::OK || response.url() != expected_url {
        return Err(RuntimeConfigManifestError::Transport(
            "Freshness endpoint returned an unexpected status or URL",
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(RuntimeConfigManifestError::Transport(
            "Freshness response exceeds its byte limit",
        ));
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream
        .next()
        .await
        .transpose()
        .map_err(|_| RuntimeConfigManifestError::Transport("Freshness response read failed"))?
    {
        if body.len().saturating_add(chunk.len()) > max_bytes {
            return Err(RuntimeConfigManifestError::Transport(
                "Freshness response exceeds its byte limit",
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn freshness_deadline_error() -> RuntimeConfigManifestError {
    RuntimeConfigManifestError::Transport(
        "Freshness verification exceeded the 10-second acceptance deadline",
    )
}

fn ensure_deadline(deadline: Instant) -> Result<(), RuntimeConfigManifestError> {
    if Instant::now() >= deadline {
        return Err(freshness_deadline_error());
    }
    Ok(())
}

pub(crate) async fn refresh(
    bootstrap: &RuntimeConfigBootstrap,
    state_path: &Path,
) -> Result<VerifiedRuntimeConfigManifest, RuntimeConfigManifestError> {
    validate_runtime_config_manifest_url(bootstrap.manifest_url.as_str())?;
    let state_store = FreshnessEpochStateStore::new(state_path.to_path_buf());
    let prior_state = state_store.read()?;
    let (last_accepted_epoch, last_accepted_manifest_sha256) = prior_state.manifest_high_water();
    let policy = RuntimeConfigVerificationPolicy {
        now: Utc::now(),
        last_accepted_epoch: last_accepted_epoch.to_owned(),
        last_accepted_manifest_sha256: last_accepted_manifest_sha256.map(str::to_owned),
        max_lifetime_seconds: MAX_MANIFEST_LIFETIME_SECONDS,
        max_clock_skew_seconds: MAX_CLOCK_SKEW_SECONDS,
        max_reference_age_seconds: MAX_WORKER_REFERENCE_AGE_SECONDS,
        max_envelope_bytes: MAX_MANIFEST_ENVELOPE_BYTES,
    };
    let mut nonce = [0_u8; 32];
    nonce[..16].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    nonce[16..].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
    let audience = sha256_base64url(bootstrap.manifest_url.as_str().as_bytes());
    let request = FreshnessRequest {
        schema_version: 1,
        scope: REQUEST_SCOPE.to_owned(),
        environment: "production".to_owned(),
        audience_manifest_url_sha256: audience,
        request_nonce: URL_SAFE_NO_PAD.encode(nonce),
    };
    let request_raw = canonical_json_bytes(&request)?;
    if request_raw.len() > MAX_FRESHNESS_REQUEST_BYTES {
        return Err(RuntimeConfigManifestError::Invalid(
            "Freshness request exceeds its byte limit",
        ));
    }
    let mut freshness_url = bootstrap.manifest_url.clone();
    freshness_url.set_path(REQUEST_PATH);
    let client = FreshnessHttpClient::new()?;
    let deadline = Instant::now() + MAX_FRESHNESS_DEADLINE;
    let freshness_raw = client
        .post_freshness(freshness_url, request_raw, deadline)
        .await?;
    ensure_deadline(deadline)?;
    let response = verify_freshness_response(
        &freshness_raw,
        bootstrap,
        &request,
        Utc::now(),
        prior_state.delegation_high_water(),
    )?;
    ensure_deadline(deadline)?;
    let mut snapshot_url = bootstrap.manifest_url.clone();
    snapshot_url.set_path(&format!("/{}", response.payload.manifest_ref));
    let fetcher = DeadlineObjectFetcher {
        client: &client,
        deadline,
    };
    let manifest_raw = fetcher
        .fetch(snapshot_url, MAX_MANIFEST_ENVELOPE_BYTES)
        .await?;
    ensure_deadline(deadline)?;
    let manifest_digest = sha256_base64url(&manifest_raw);
    if manifest_digest != response.payload.manifest_sha256
        || manifest_digest != response.release_commit.payload.manifest_sha256
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "immutable Manifest bytes do not match the signed Freshness digest",
        ));
    }
    let payload =
        verify_signed_runtime_config_manifest(&manifest_raw, &bootstrap.trusted_signer, &policy)?;
    verify_freshness_manifest_metadata(&response, &payload, &manifest_digest)?;

    let worker_reference = fetch_checked_artifact(
        &fetcher,
        &bootstrap.manifest_url,
        "worker-reference",
        &payload.source.worker_reference_sha256,
        deadline,
    )
    .await?;
    let origin_inventory = fetch_checked_artifact(
        &fetcher,
        &bootstrap.manifest_url,
        "origin-inventory",
        &payload.production_authority_pins.origin_inventory_sha256,
        deadline,
    )
    .await?;
    let target_approval = fetch_checked_artifact(
        &fetcher,
        &bootstrap.manifest_url,
        "target-approval",
        &payload
            .production_authority_pins
            .target_approval_artifact_sha256,
        deadline,
    )
    .await?;
    let security_registry_set = fetch_checked_artifact(
        &fetcher,
        &bootstrap.manifest_url,
        "security-registry-set",
        &payload
            .production_authority_pins
            .security_registry_set_sha256,
        deadline,
    )
    .await?;
    let result_registry_envelope = fetch_checked_artifact(
        &fetcher,
        &bootstrap.manifest_url,
        "result-registry-envelope",
        &payload.result_registry_pins.result_registry_envelope_sha256,
        deadline,
    )
    .await?;
    let independent_inputs = RuntimeConfigIndependentVerificationInputs {
        worker_reference_raw: Some(&worker_reference),
        origin_inventory_raw: Some(&origin_inventory),
        target_approval_raw: Some(&target_approval),
        security_registry_set_raw: Some(&security_registry_set),
        result_registry_envelope_raw: Some(&result_registry_envelope),
    };
    ensure_deadline(deadline)?;
    let verified = verify_runtime_config_manifest(
        &manifest_raw,
        &bootstrap.trusted_signer,
        &policy,
        Some(&independent_inputs),
    )?;
    verify_freshness_manifest_metadata(&response, verified.payload(), verified.manifest_sha256())?;
    validate_state_transition(&prior_state, &response)?;
    ensure_deadline(deadline)?;

    let next_state = FreshnessEpochState {
        schema_version: FRESHNESS_STATE_SCHEMA_VERSION,
        scope: FRESHNESS_STATE_SCOPE.to_owned(),
        last_accepted_epoch: response.payload.latest_epoch.clone(),
        last_accepted_manifest_sha256: Some(response.payload.manifest_sha256.clone()),
        commit_generation: Some(response.payload.pointer_generation.clone()),
        release_commit_record_sha256: Some(response.payload.release_commit_record_sha256.clone()),
        freshness_delegation_generation: Some(
            response
                .freshness_delegation
                .payload
                .delegation_generation
                .clone(),
        ),
        freshness_delegation_sha256: Some(response.payload.freshness_delegation_sha256.clone()),
    };
    validate_freshness_state(&next_state)?;
    let state_bytes = serde_json::to_vec(&next_state)
        .map_err(|_| RuntimeConfigManifestError::State("Freshness state serialization failed"))?;
    let response_for_commit = &response;
    let state_for_commit = &state_store;
    let prior_for_commit = &prior_state;
    write_state_atomic_bytes(
        state_path,
        &state_bytes,
        || {
            if state_for_commit.read()? != *prior_for_commit {
                return Err(RuntimeConfigManifestError::State(
                    "Runtime Config state changed during Freshness verification",
                ));
            }
            ensure_deadline(deadline)?;
            let final_now = Utc::now();
            let mut final_policy = policy.clone();
            final_policy.now = final_now;
            validate_freshness(
                verified.payload(),
                &final_policy,
                verified.manifest_sha256(),
            )?;
            validate_response_time_at(response_for_commit, final_now)?;
            validate_freshness_delegation_active(
                &response_for_commit.freshness_delegation,
                final_now,
            )?;
            ensure_deadline(deadline)?;
            Ok(())
        },
        "Freshness epoch state could not be atomically persisted",
    )?;
    Ok(verified)
}

async fn fetch_checked_artifact(
    fetcher: &dyn RuntimeConfigObjectFetcher,
    manifest_url: &Url,
    kind: &str,
    digest: &str,
    deadline: Instant,
) -> Result<Vec<u8>, RuntimeConfigManifestError> {
    let bytes = fetcher
        .fetch(
            runtime_config_artifact_url(manifest_url, kind, digest)?,
            MAX_RUNTIME_CONFIG_ARTIFACT_BYTES,
        )
        .await?;
    ensure_deadline(deadline)?;
    if sha256_base64url(&bytes) != digest {
        return Err(RuntimeConfigManifestError::Invalid(
            "Runtime Config artifact exact-byte digest does not match",
        ));
    }
    Ok(bytes)
}

fn verify_freshness_manifest_metadata(
    response: &VerifiedFreshnessResponse,
    payload: &RuntimeConfigManifestPayload,
    raw_manifest_digest: &str,
) -> Result<(), RuntimeConfigManifestError> {
    if payload.schema_version != 2
        || payload.epoch != response.payload.latest_epoch
        || payload.epoch != response.release_commit.payload.manifest_epoch
        || raw_manifest_digest != response.payload.manifest_sha256
        || raw_manifest_digest != response.release_commit.payload.manifest_sha256
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Freshness response, Release Commit Record, and Manifest metadata disagree",
        ));
    }
    Ok(())
}

fn verify_freshness_response(
    raw: &[u8],
    bootstrap: &RuntimeConfigBootstrap,
    request: &FreshnessRequest,
    app_now: DateTime<Utc>,
    delegation_high_water: Option<(&str, &str)>,
) -> Result<VerifiedFreshnessResponse, RuntimeConfigManifestError> {
    if raw.len() > MAX_FRESHNESS_RESPONSE_BYTES {
        return Err(RuntimeConfigManifestError::Invalid(
            "Freshness response exceeds its byte limit",
        ));
    }
    let envelope: FreshnessEnvelope = parse_canonical_json(raw, "Freshness response envelope")?;
    if envelope.schema_version != 1
        || envelope.scope != RESPONSE_ENVELOPE_SCOPE
        || envelope.signature_algorithm != SIGNATURE_ALGORITHM
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Freshness response envelope schema or algorithm is invalid",
        ));
    }
    validate_key_id(&envelope.signer_key_id)?;
    let freshness_delegation_raw = decode_canonical_base64url(
        &envelope.freshness_delegation_base64url,
        "Freshness delegation",
    )?;
    let release_delegation_raw = decode_canonical_base64url(
        &envelope.release_authority_delegation_base64url,
        "Release Authority delegation",
    )?;
    let release_record_raw = decode_canonical_base64url(
        &envelope.release_commit_record_base64url,
        "Release Commit Record",
    )?;
    let payload_bytes =
        decode_canonical_base64url(&envelope.payload_base64url, "Freshness payload")?;
    let expected_audience = sha256_base64url(bootstrap.manifest_url.as_str().as_bytes());
    if request.schema_version != 1
        || request.scope != REQUEST_SCOPE
        || request.environment != "production"
        || request.audience_manifest_url_sha256 != expected_audience
        || decode_canonical_base64url(&request.request_nonce, "Freshness nonce")?.len() != 32
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "outstanding Freshness challenge is invalid",
        ));
    }

    let freshness_delegation = verify_delegation(
        &freshness_delegation_raw,
        &bootstrap.trusted_signer,
        "freshness-response-v1",
        "production",
        &expected_audience,
    )?;
    validate_freshness_delegation_active(&freshness_delegation, app_now)?;
    if envelope.signer_key_id != freshness_delegation.payload.key_id {
        return Err(RuntimeConfigManifestError::Invalid(
            "Freshness signer key ID does not match its delegation",
        ));
    }
    verify_signature(
        &freshness_delegation.payload.public_key_spki,
        FRESHNESS_RESPONSE_DOMAIN,
        &envelope.signer_key_id,
        &payload_bytes,
        &envelope.signature_base64url,
        "Freshness response",
    )?;
    let payload: FreshnessPayload = parse_canonical_json(&payload_bytes, "Freshness payload")?;
    if payload.schema_version != 1
        || payload.scope != RESPONSE_PAYLOAD_SCOPE
        || payload.freshness_semantics != "LATEST_AT_ISSUANCE"
        || payload.environment != "production"
        || payload.audience_manifest_url_sha256 != expected_audience
        || payload.request_nonce != request.request_nonce
        || payload.freshness_signer_key_id != envelope.signer_key_id
        || payload.freshness_delegation_id != freshness_delegation.payload.delegation_id
        || payload.freshness_delegation_sha256 != freshness_delegation.digest
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Freshness response does not bind the outstanding APP challenge",
        ));
    }
    check_delegation_high_water(&freshness_delegation, delegation_high_water)?;
    let issued_at = parse_canonical_utc(&payload.issued_at)?;
    let expires_at = parse_canonical_utc(&payload.expires_at)?;
    let release_appended_at = parse_canonical_utc(&payload.release_commit_record_appended_at)?;
    validate_response_time_values(issued_at, expires_at, app_now)?;
    if issued_at < freshness_delegation.not_before
        || issued_at >= freshness_delegation.not_after
        || expires_at > freshness_delegation.not_after
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Freshness response validity exceeds its delegation",
        ));
    }

    let release_delegation = verify_delegation(
        &release_delegation_raw,
        &bootstrap.trusted_signer,
        "release-commit-record-v1",
        "production",
        &format!("{RELEASE_AUDIENCE_PREFIX}production"),
    )?;
    if payload.release_authority_key_id != release_delegation.payload.key_id
        || payload.release_authority_delegation_id != release_delegation.payload.delegation_id
        || payload.release_authority_delegation_sha256 != release_delegation.digest
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Freshness response Release Authority delegation binding is invalid",
        ));
    }
    let release_commit = verify_release_commit_record(
        &release_record_raw,
        release_delegation,
        "production",
        release_appended_at,
    )?;
    if payload.release_commit_record_sha256 != release_commit.digest
        || payload.release_commit_id != release_commit.payload.release_commit_id
        || payload.pointer_generation != release_commit.payload.commit_generation
        || payload.latest_epoch != release_commit.payload.manifest_epoch
        || payload.manifest_schema_version != release_commit.payload.manifest_schema_version
        || payload.manifest_sha256 != release_commit.payload.manifest_sha256
        || payload.manifest_ref != release_commit.payload.manifest_ref
        || release_appended_at < parse_canonical_utc(&release_commit.payload.authorized_at)?
        || release_appended_at > issued_at
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Freshness response does not bind the current Release Commit Record",
        ));
    }
    parse_epoch(&payload.latest_epoch, false)?;
    parse_epoch(&payload.pointer_generation, false)?;
    validate_digest(&payload.manifest_sha256)?;
    validate_digest(&payload.release_commit_record_sha256)?;
    if payload.manifest_ref != format!("{IMMUTABLE_MANIFEST_PREFIX}{}", payload.manifest_sha256) {
        return Err(RuntimeConfigManifestError::Invalid(
            "Freshness Manifest reference is not content addressed",
        ));
    }
    validate_uuid_v4(&payload.release_commit_id)?;

    Ok(VerifiedFreshnessResponse {
        payload,
        freshness_delegation,
        release_commit,
        issued_at,
        expires_at,
    })
}

fn parse_canonical_json<T: for<'de> Deserialize<'de> + Serialize>(
    raw: &[u8],
    label: &'static str,
) -> Result<T, RuntimeConfigManifestError> {
    let parsed: T =
        serde_json::from_slice(raw).map_err(|_| RuntimeConfigManifestError::Invalid(label))?;
    if canonical_json_bytes(&parsed)? != raw {
        return Err(RuntimeConfigManifestError::Invalid(
            "protocol JSON is not canonical",
        ));
    }
    Ok(parsed)
}

fn verify_delegation(
    raw: &[u8],
    root: &RuntimeConfigTrustedSigner,
    purpose: &str,
    environment: &str,
    audience: &str,
) -> Result<VerifiedDelegation, RuntimeConfigManifestError> {
    if root.scope != "fusou-tlsn-runtime-config-signing-root-v2" {
        return Err(RuntimeConfigManifestError::Invalid(
            "Bootstrap signer is not scoped to Runtime Config",
        ));
    }
    let envelope: DelegationEnvelope = parse_canonical_json(raw, "delegation envelope")?;
    if envelope.schema_version != 1
        || envelope.scope != DELEGATION_ENVELOPE_SCOPE
        || envelope.signature_algorithm != SIGNATURE_ALGORITHM
        || envelope.root_key_id != root.key_id
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "delegation envelope schema, root key, or algorithm is invalid",
        ));
    }
    let payload_bytes =
        decode_canonical_base64url(&envelope.payload_base64url, "delegation payload")?;
    verify_signature(
        &root.public_key_spki,
        FRESHNESS_DELEGATION_DOMAIN,
        &envelope.root_key_id,
        &payload_bytes,
        &envelope.signature_base64url,
        "delegation",
    )?;
    let payload: DelegationPayload = parse_canonical_json(&payload_bytes, "delegation payload")?;
    let expected_lifetime = match purpose {
        "freshness-response-v1" => MAX_FRESHNESS_LIFETIME_SECONDS,
        "release-commit-record-v1" => MAX_RELEASE_LIFETIME_SECONDS,
        _ => {
            return Err(RuntimeConfigManifestError::Invalid(
                "delegation purpose is unsupported",
            ))
        }
    };
    if payload.schema_version != 1
        || payload.scope != DELEGATION_PAYLOAD_SCOPE
        || payload.signature_algorithm != SIGNATURE_ALGORITHM
        || payload.revocation_mode != "expiry-only-v1"
        || payload.purpose != purpose
        || payload.environment != environment
        || payload.audience != audience
        || payload.max_validity_seconds != expected_lifetime
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "delegation purpose, scope, audience, or validity cap is invalid",
        ));
    }
    validate_uuid_v4(&payload.delegation_id)?;
    validate_key_id(&payload.key_id)?;
    validate_ed25519_spki(&payload.public_key_spki)?;
    let generation = parse_epoch(&payload.delegation_generation, false)?;
    let issued_at = parse_canonical_utc(&payload.issued_at)?;
    let not_before = parse_canonical_utc(&payload.not_before)?;
    let not_after = parse_canonical_utc(&payload.not_after)?;
    let max_lifetime_ms = i64::try_from(expected_lifetime * 1_000).map_err(|_| {
        RuntimeConfigManifestError::Invalid("delegation maximum lifetime is invalid")
    })?;
    if issued_at > not_before
        || not_before >= not_after
        || not_after
            .signed_duration_since(issued_at)
            .num_milliseconds()
            > max_lifetime_ms
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "delegation validity interval exceeds its strict lifetime",
        ));
    }
    match (generation, payload.previous_delegation_sha256.as_deref()) {
        (1, None) => {}
        (1, Some(_)) | (_, None) => {
            return Err(RuntimeConfigManifestError::Invalid(
                "delegation generation and previous digest are inconsistent",
            ))
        }
        (_, Some(digest)) => validate_digest(digest)?,
    }
    Ok(VerifiedDelegation {
        payload,
        digest: sha256_base64url(raw),
        not_before,
        not_after,
    })
}

fn verify_release_commit_record(
    raw: &[u8],
    delegation: VerifiedDelegation,
    environment: &str,
    appended_at: DateTime<Utc>,
) -> Result<VerifiedReleaseCommit, RuntimeConfigManifestError> {
    let envelope: ReleaseCommitEnvelope =
        parse_canonical_json(raw, "Release Commit Record envelope")?;
    if envelope.schema_version != 1
        || envelope.scope != RELEASE_ENVELOPE_SCOPE
        || envelope.signature_algorithm != SIGNATURE_ALGORITHM
        || envelope.signer_key_id != delegation.payload.key_id
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Release Commit Record envelope schema or delegated key is invalid",
        ));
    }
    let payload_bytes =
        decode_canonical_base64url(&envelope.payload_base64url, "Release Commit Record payload")?;
    verify_signature(
        &delegation.payload.public_key_spki,
        RELEASE_COMMIT_DOMAIN,
        &envelope.signer_key_id,
        &payload_bytes,
        &envelope.signature_base64url,
        "Release Commit Record",
    )?;
    let payload: ReleaseCommitPayload =
        parse_canonical_json(&payload_bytes, "Release Commit Record payload")?;
    if payload.schema_version != 1
        || payload.scope != RELEASE_PAYLOAD_SCOPE
        || payload.environment != environment
        || payload.commit_authorization != "AUTHORIZE_JOURNAL_APPEND"
        || payload.manifest_schema_version != 2
        || payload.release_authority_delegation_id != delegation.payload.delegation_id
        || payload.release_authority_delegation_sha256 != delegation.digest
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Release Commit Record authorization fields are invalid",
        ));
    }
    let generation = parse_epoch(&payload.commit_generation, false)?;
    parse_epoch(&payload.manifest_epoch, false)?;
    validate_uuid_v4(&payload.release_commit_id)?;
    validate_digest(&payload.manifest_sha256)?;
    validate_digest(&payload.release_authority_delegation_sha256)?;
    if payload.manifest_ref != format!("{IMMUTABLE_MANIFEST_PREFIX}{}", payload.manifest_sha256)
        || payload.pointer_etag.trim().is_empty()
        || payload.pointer_etag.trim() != payload.pointer_etag
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Release Commit Record Manifest reference or pointer ETag is invalid",
        ));
    }
    if generation == 1 {
        if payload.previous_commit_generation.is_some()
            || payload.previous_commit_record_sha256.is_some()
        {
            return Err(RuntimeConfigManifestError::Invalid(
                "genesis Release Commit Record has an invalid previous head",
            ));
        }
    } else {
        let previous = payload.previous_commit_generation.as_deref().ok_or(
            RuntimeConfigManifestError::Invalid(
                "Release Commit Record previous generation is missing",
            ),
        )?;
        if parse_epoch(previous, false)?.checked_add(1) != Some(generation) {
            return Err(RuntimeConfigManifestError::Invalid(
                "Release Commit Record generation is not contiguous",
            ));
        }
        validate_digest(payload.previous_commit_record_sha256.as_deref().ok_or(
            RuntimeConfigManifestError::Invalid("Release Commit Record previous digest is missing"),
        )?)?;
    }
    let authorized_at = parse_canonical_utc(&payload.authorized_at)?;
    if authorized_at < delegation.not_before
        || authorized_at >= delegation.not_after
        || appended_at < delegation.not_before
        || appended_at >= delegation.not_after
        || authorized_at > appended_at
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Release authorization and Journal append times are outside delegation",
        ));
    }
    let digest = sha256_base64url(raw);
    Ok(VerifiedReleaseCommit { payload, digest })
}

fn verify_signature(
    public_key_spki: &str,
    domain: &[u8],
    key_id: &str,
    payload_bytes: &[u8],
    signature_base64url: &str,
    label: &'static str,
) -> Result<(), RuntimeConfigManifestError> {
    validate_key_id(key_id)?;
    let public_key = decode_ed25519_spki(public_key_spki)?;
    let signature = decode_canonical_base64url(signature_base64url, "Ed25519 signature")?;
    if signature.len() != 64 {
        return Err(RuntimeConfigManifestError::Invalid(
            "Ed25519 signature must be 64 bytes",
        ));
    }
    let key_id_bytes = key_id.as_bytes();
    let key_id_length = u16::try_from(key_id_bytes.len())
        .map_err(|_| RuntimeConfigManifestError::Invalid("signature key ID is too long"))?;
    let mut message =
        Vec::with_capacity(domain.len() + 2 + key_id_bytes.len() + payload_bytes.len());
    message.extend_from_slice(domain);
    message.extend_from_slice(&key_id_length.to_be_bytes());
    message.extend_from_slice(key_id_bytes);
    message.extend_from_slice(payload_bytes);
    fusou_auth::verify_ed25519_signature(&public_key, &message, &signature).map_err(|_| {
        if label == "Freshness response" {
            RuntimeConfigManifestError::InvalidSignature
        } else {
            RuntimeConfigManifestError::Invalid("delegated Ed25519 signature verification failed")
        }
    })
}

fn validate_freshness_delegation_active(
    delegation: &VerifiedDelegation,
    app_now: DateTime<Utc>,
) -> Result<(), RuntimeConfigManifestError> {
    let margin = chrono::Duration::seconds(MAX_CLOCK_SKEW_SECONDS as i64);
    let early_bound = app_now - margin;
    let late_bound = app_now + margin;
    if early_bound < delegation.not_before || late_bound >= delegation.not_after {
        return Err(RuntimeConfigManifestError::Invalid(
            "Freshness delegation is outside the conservative APP validity window",
        ));
    }
    Ok(())
}

fn validate_response_time_at(
    response: &VerifiedFreshnessResponse,
    app_now: DateTime<Utc>,
) -> Result<(), RuntimeConfigManifestError> {
    validate_response_time_values(response.issued_at, response.expires_at, app_now)?;
    if response.issued_at < response.freshness_delegation.not_before
        || response.issued_at >= response.freshness_delegation.not_after
        || response.expires_at > response.freshness_delegation.not_after
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Freshness response is outside its delegated validity",
        ));
    }
    Ok(())
}

fn validate_response_time_values(
    issued_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    app_now: DateTime<Utc>,
) -> Result<(), RuntimeConfigManifestError> {
    let skew = chrono::Duration::seconds(MAX_CLOCK_SKEW_SECONDS as i64);
    let ttl = chrono::Duration::seconds(MAX_FRESHNESS_RESPONSE_LIFETIME_SECONDS);
    if expires_at <= issued_at
        || expires_at - issued_at > ttl
        || issued_at > app_now + skew
        || expires_at <= app_now - skew
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Freshness response is outside its permitted time window",
        ));
    }
    Ok(())
}

fn check_delegation_high_water(
    delegation: &VerifiedDelegation,
    high_water: Option<(&str, &str)>,
) -> Result<(), RuntimeConfigManifestError> {
    let Some((generation, digest)) = high_water else {
        return Ok(());
    };
    let prior_generation = parse_epoch(generation, false)?;
    let current_generation = parse_epoch(&delegation.payload.delegation_generation, false)?;
    if current_generation < prior_generation {
        return Err(RuntimeConfigManifestError::Invalid(
            "Freshness delegation generation rollback",
        ));
    }
    if current_generation == prior_generation {
        if delegation.digest != digest {
            return Err(RuntimeConfigManifestError::Invalid(
                "same Freshness delegation generation has different bytes",
            ));
        }
        return Ok(());
    }
    if current_generation != prior_generation.saturating_add(1)
        || delegation.payload.previous_delegation_sha256.as_deref() != Some(digest)
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "Freshness delegation chain does not extend persisted state",
        ));
    }
    Ok(())
}

fn validate_state_transition(
    prior: &PriorState,
    response: &VerifiedFreshnessResponse,
) -> Result<(), RuntimeConfigManifestError> {
    let next_epoch = parse_epoch(&response.payload.latest_epoch, false)?;
    let next_generation = parse_epoch(&response.payload.pointer_generation, false)?;
    match prior {
        PriorState::Missing => Ok(()),
        PriorState::Legacy(state) => {
            let previous_epoch = parse_epoch(&state.last_accepted_epoch, true)?;
            if next_epoch < previous_epoch
                || (next_epoch == previous_epoch
                    && state.last_accepted_manifest_sha256.as_deref()
                        != Some(response.payload.manifest_sha256.as_str()))
            {
                return Err(RuntimeConfigManifestError::State(
                    "Freshness response does not advance or exactly match legacy state",
                ));
            }
            Ok(())
        }
        PriorState::Current(state) => {
            let previous_epoch = parse_epoch(&state.last_accepted_epoch, false)?;
            let previous_generation = parse_epoch(
                state
                    .commit_generation
                    .as_deref()
                    .ok_or(RuntimeConfigManifestError::State(
                        "Freshness commit generation is missing",
                    ))?,
                false,
            )?;
            let previous_delegation_generation = parse_epoch(
                state.freshness_delegation_generation.as_deref().ok_or(
                    RuntimeConfigManifestError::State("Freshness delegation high-water is missing"),
                )?,
                false,
            )?;
            let next_delegation_generation = parse_epoch(
                &response.freshness_delegation.payload.delegation_generation,
                false,
            )?;
            if next_epoch < previous_epoch
                || next_generation < previous_generation
                || next_delegation_generation < previous_delegation_generation
            {
                return Err(RuntimeConfigManifestError::State(
                    "Freshness response is below persisted state high-water",
                ));
            }
            if next_epoch == previous_epoch
                && (state.last_accepted_manifest_sha256.as_deref()
                    != Some(response.payload.manifest_sha256.as_str())
                    || state.commit_generation.as_deref()
                        != Some(response.payload.pointer_generation.as_str())
                    || state.release_commit_record_sha256.as_deref()
                        != Some(response.payload.release_commit_record_sha256.as_str()))
            {
                return Err(RuntimeConfigManifestError::State(
                    "same Manifest epoch does not match persisted commit state",
                ));
            }
            if next_generation == previous_generation && next_epoch != previous_epoch {
                return Err(RuntimeConfigManifestError::State(
                    "Manifest advanced without a Release Commit generation",
                ));
            }
            if next_delegation_generation == previous_delegation_generation
                && state.freshness_delegation_sha256.as_deref()
                    != Some(response.payload.freshness_delegation_sha256.as_str())
            {
                return Err(RuntimeConfigManifestError::State(
                    "same Freshness delegation generation has different bytes",
                ));
            }
            Ok(())
        }
    }
}

fn validate_uuid_v4(value: &str) -> Result<(), RuntimeConfigManifestError> {
    let parsed = uuid::Uuid::parse_str(value)
        .map_err(|_| RuntimeConfigManifestError::Invalid("UUIDv4 field is invalid"))?;
    if parsed.to_string() != value
        || value.as_bytes().get(14) != Some(&b'4')
        || !matches!(
            value.as_bytes().get(19).copied(),
            Some(b'8' | b'9' | b'a' | b'b')
        )
    {
        return Err(RuntimeConfigManifestError::Invalid(
            "UUIDv4 field is not canonical lowercase UUIDv4",
        ));
    }
    Ok(())
}

fn validate_freshness_state(state: &FreshnessEpochState) -> Result<(), RuntimeConfigManifestError> {
    if state.schema_version != FRESHNESS_STATE_SCHEMA_VERSION
        || state.scope != FRESHNESS_STATE_SCOPE
    {
        return Err(RuntimeConfigManifestError::State(
            "Freshness state schema is invalid",
        ));
    }
    let epoch = parse_epoch(&state.last_accepted_epoch, true)?;
    match (
        epoch,
        state.last_accepted_manifest_sha256.as_deref(),
        state.commit_generation.as_deref(),
        state.release_commit_record_sha256.as_deref(),
        state.freshness_delegation_generation.as_deref(),
        state.freshness_delegation_sha256.as_deref(),
    ) {
        (0, None, None, None, None, None) => {}
        (0, _, _, _, _, _) | (_, None, _, _, _, _) => {
            return Err(RuntimeConfigManifestError::State(
                "Freshness state epoch and digest are inconsistent",
            ))
        }
        (
            _,
            Some(manifest),
            Some(generation),
            Some(record),
            Some(delegation_generation),
            Some(delegation),
        ) => {
            validate_digest(manifest)?;
            parse_epoch(generation, false)?;
            validate_digest(record)?;
            parse_epoch(delegation_generation, false)?;
            validate_digest(delegation)?;
        }
        _ => {
            return Err(RuntimeConfigManifestError::State(
                "Freshness state high-water fields are incomplete",
            ))
        }
    }
    Ok(())
}

struct FreshnessEpochStateStore {
    path: PathBuf,
}

impl FreshnessEpochStateStore {
    fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn read(&self) -> Result<PriorState, RuntimeConfigManifestError> {
        let parent = self.path.parent().ok_or(RuntimeConfigManifestError::State(
            "state path has no parent directory",
        ))?;
        let parent_metadata = fs::symlink_metadata(parent)
            .map_err(|_| RuntimeConfigManifestError::State("state directory is unavailable"))?;
        if !parent_metadata.is_dir() || parent_metadata.file_type().is_symlink() {
            return Err(RuntimeConfigManifestError::State(
                "state directory is not a regular directory",
            ));
        }
        let metadata = match fs::symlink_metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(PriorState::Missing)
            }
            Err(_) => {
                return Err(RuntimeConfigManifestError::State(
                    "Freshness state cannot be inspected",
                ))
            }
        };
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_FRESHNESS_STATE_BYTES
        {
            return Err(RuntimeConfigManifestError::State(
                "Freshness state is not a bounded regular file",
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err(RuntimeConfigManifestError::State(
                    "Freshness state permissions are too broad",
                ));
            }
        }
        let mut bytes = Vec::new();
        fs::File::open(&self.path)
            .map_err(|_| RuntimeConfigManifestError::State("Freshness state cannot be read"))?
            .take(MAX_FRESHNESS_STATE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| RuntimeConfigManifestError::State("Freshness state cannot be read"))?;
        if bytes.len() as u64 > MAX_FRESHNESS_STATE_BYTES {
            return Err(RuntimeConfigManifestError::State(
                "Freshness state exceeds its byte limit",
            ));
        }
        if let Ok(legacy) = serde_json::from_slice::<LegacyEpochState>(&bytes) {
            if serde_json::to_vec(&legacy).ok().as_deref() == Some(bytes.as_slice())
                && legacy.schema_version == 1
                && legacy.scope == LEGACY_EPOCH_STATE_SCOPE
                && validate_legacy_epoch_state(&legacy).is_ok()
            {
                return Ok(PriorState::Legacy(legacy));
            }
        }
        if let Ok(current) = serde_json::from_slice::<FreshnessEpochState>(&bytes) {
            if serde_json::to_vec(&current).ok().as_deref() == Some(bytes.as_slice())
                && validate_freshness_state(&current).is_ok()
            {
                return Ok(PriorState::Current(current));
            }
        }
        Err(RuntimeConfigManifestError::State(
            "Freshness state is malformed or has an unsupported schema",
        ))
    }
}

fn validate_legacy_epoch_state(state: &LegacyEpochState) -> Result<(), RuntimeConfigManifestError> {
    let epoch = parse_epoch(&state.last_accepted_epoch, true)?;
    match (epoch, state.last_accepted_manifest_sha256.as_deref()) {
        (0, None) => Ok(()),
        (0, Some(_)) | (_, None) => Err(RuntimeConfigManifestError::State(
            "legacy epoch and digest are inconsistent",
        )),
        (_, Some(digest)) => validate_digest(digest),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_directory() -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "fusou-runtime-config-freshness-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&directory).unwrap();
        directory
    }

    fn restrict_file_permissions(path: &Path) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
        }
        #[cfg(not(unix))]
        let _ = path;
    }

    #[test]
    fn reads_legacy_epoch_state_for_authenticated_migration() {
        let directory = test_directory();
        let path = directory.join("runtime-config-epoch-state.json");
        let legacy = LegacyEpochState {
            schema_version: 1,
            scope: LEGACY_EPOCH_STATE_SCOPE.to_owned(),
            last_accepted_epoch: "7".to_owned(),
            last_accepted_manifest_sha256: Some(URL_SAFE_NO_PAD.encode([7_u8; 32])),
        };
        fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
        restrict_file_permissions(&path);

        assert_eq!(
            FreshnessEpochStateStore::new(path).read().unwrap(),
            PriorState::Legacy(legacy)
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn malformed_epoch_state_fails_closed_instead_of_resetting_high_water() {
        let directory = test_directory();
        let path = directory.join("runtime-config-epoch-state.json");
        fs::write(&path, b"{malformed").unwrap();
        restrict_file_permissions(&path);

        assert!(matches!(
            FreshnessEpochStateStore::new(path).read(),
            Err(RuntimeConfigManifestError::State(_))
        ));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn failed_final_acceptance_check_preserves_existing_state() {
        let directory = test_directory();
        let path = directory.join("runtime-config-epoch-state.json");
        fs::write(&path, b"prior-state").unwrap();
        let result = write_state_atomic_bytes(
            &path,
            b"new-state",
            || Err(RuntimeConfigManifestError::Transport("deadline expired")),
            "state write failed",
        );

        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"prior-state");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }
}
