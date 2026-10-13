use std::collections::{BTreeMap, BTreeSet};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::{Host, Url};

const MANIFEST_SCHEMA_VERSION: u32 = 1;
const MANIFEST_SCOPE: &str = "fusou-tlsn-runtime-config-manifest-v1";
const ENVELOPE_SCOPE: &str = "fusou-tlsn-runtime-config-envelope-v1";
const TRUST_SCOPE: &str = "fusou-tlsn-runtime-config-signing-root-v1";
const SIGNATURE_ALGORITHM: &str = "Ed25519";
const SIGNATURE_DOMAIN: &[u8] = b"FUSOU-TLSN-RUNTIME-CONFIG-MANIFEST-V1\0";
const ED25519_SPKI_PREFIX: &[u8] = b"\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00";
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

#[derive(Clone, Debug)]
pub struct RuntimeConfigVerificationPolicy {
    pub now: DateTime<Utc>,
    pub last_accepted_epoch: String,
    pub max_lifetime_seconds: u64,
    pub max_clock_skew_seconds: u64,
    pub max_reference_age_seconds: u64,
    pub max_envelope_bytes: usize,
}

pub fn verify_runtime_config_manifest(
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
    validate_freshness(&payload, policy)?;
    Ok(payload)
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
    parse_epoch(&policy.last_accepted_epoch, true)?;
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
    Ok(())
}

fn validate_freshness(
    payload: &RuntimeConfigManifestPayload,
    policy: &RuntimeConfigVerificationPolicy,
) -> Result<(), RuntimeConfigManifestError> {
    let epoch = parse_epoch(&payload.epoch, false)?;
    let high_water = parse_epoch(&policy.last_accepted_epoch, true)?;
    if epoch <= high_water {
        return Err(RuntimeConfigManifestError::Invalid(
            "epoch is not newer than the persisted high-water mark",
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
        || registry.get("scope").and_then(Value::as_str) != Some("tlsn-result-signing-key-registry")
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
        Some(Host::Domain(host)) => is_dns_hostname(host),
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

fn is_dns_hostname(host: &str) -> bool {
    if host.len() > 253 || !host.is_ascii() {
        return false;
    }
    let mut labels = host.split('.');
    let Some(last) = labels.next_back() else {
        return false;
    };
    if !(2..=63).contains(&last.len()) || !last.bytes().all(|byte| byte.is_ascii_lowercase()) {
        return false;
    }
    labels.all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && label.as_bytes()[0].is_ascii_alphanumeric()
            && label.as_bytes()[label.len() - 1].is_ascii_alphanumeric()
            && label
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    })
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

fn validate_digest(value: &str) -> Result<(), RuntimeConfigManifestError> {
    let bytes = decode_canonical_base64url(value, "SHA-256 digest")?;
    if bytes.len() != 32 {
        return Err(RuntimeConfigManifestError::Invalid(
            "SHA-256 digest must be 32 bytes",
        ));
    }
    Ok(())
}

fn validate_key_id(value: &str) -> Result<(), RuntimeConfigManifestError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
    {
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

fn parse_epoch(value: &str, allow_zero: bool) -> Result<u64, RuntimeConfigManifestError> {
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

    #[derive(Deserialize)]
    struct TestVector {
        test_only: bool,
        trusted_signer: RuntimeConfigTrustedSigner,
        envelope_uncompressed_bytes: usize,
        envelope_gzip_base64url: String,
    }

    fn load_test_vector() -> (Vec<u8>, TestVector, RuntimeConfigManifestPayload) {
        let fixture: TestVector = serde_json::from_str(include_str!(
            "../../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/fixtures/tlsn-runtime-config-manifest-v1-vector.json"
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
            max_lifetime_seconds: 3600,
            max_clock_skew_seconds: 30,
            max_reference_age_seconds: 600,
            max_envelope_bytes: 4096,
        }
    }

    fn trusted_signer(fixture: TestVector) -> RuntimeConfigTrustedSigner {
        RuntimeConfigTrustedSigner {
            scope: fixture.trusted_signer.scope,
            key_id: fixture.trusted_signer.key_id,
            public_key_spki: fixture.trusted_signer.public_key_spki,
        }
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
            verify_runtime_config_manifest(
                b"{}",
                &RuntimeConfigTrustedSigner {
                    scope: "fusou-result-signing-key-registry-envelope".to_owned(),
                    key_id: "result-root".to_owned(),
                    public_key_spki: String::new(),
                },
                &RuntimeConfigVerificationPolicy {
                    now: Utc::now(),
                    last_accepted_epoch: "0".to_owned(),
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
            verify_runtime_config_manifest(b"{}", &missing_key, &policy),
            Err(RuntimeConfigManifestError::Invalid("Ed25519 SPKI key"))
        );

        let (_, fixture, payload) = load_test_vector();
        let mut invalid_key_id = trusted_signer(fixture);
        invalid_key_id.key_id = "invalid key ID".to_owned();
        assert_eq!(
            verify_runtime_config_manifest(b"{}", &invalid_key_id, &policy_for(&payload)),
            Err(RuntimeConfigManifestError::Invalid("key ID is invalid"))
        );

        assert!(validate_policy(&RuntimeConfigVerificationPolicy {
            now: Utc::now(),
            last_accepted_epoch: "00".to_owned(),
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
        let error =
            verify_runtime_config_manifest(&raw, &trusted_signer(fixture), &policy_for(&payload))
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
        let verified = verify_runtime_config_manifest(&raw, &trusted_signer, &policy).unwrap();
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
            verify_runtime_config_manifest(&raw, &wrong_scope, &policy),
            Err(RuntimeConfigManifestError::Invalid(
                "trusted signer is not scoped to runtime configuration"
            ))
        );

        let mut rollback_policy = policy.clone();
        rollback_policy.last_accepted_epoch = "1".to_owned();
        assert_eq!(
            verify_runtime_config_manifest(&raw, &trusted_signer, &rollback_policy),
            Err(RuntimeConfigManifestError::Invalid(
                "epoch is not newer than the persisted high-water mark"
            ))
        );

        let mut size_policy = policy.clone();
        size_policy.max_envelope_bytes = raw.len() - 1;
        assert_eq!(
            verify_runtime_config_manifest(&raw, &trusted_signer, &size_policy),
            Err(RuntimeConfigManifestError::Invalid(
                "envelope exceeds the supplied byte limit"
            ))
        );

        let mut whitespace_mutation = raw.clone();
        whitespace_mutation.push(b' ');
        assert_eq!(
            verify_runtime_config_manifest(&whitespace_mutation, &trusted_signer, &policy),
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
            verify_runtime_config_manifest(&signature_mutation, &trusted_signer, &policy),
            Err(RuntimeConfigManifestError::InvalidSignature)
        );

        let mut unauthenticated_payload: Value = serde_json::from_slice(&raw).unwrap();
        unauthenticated_payload["payload_base64url"] = Value::String(URL_SAFE_NO_PAD.encode(b"{"));
        let unauthenticated_payload = canonical_json_bytes(&unauthenticated_payload).unwrap();
        assert_eq!(
            verify_runtime_config_manifest(&unauthenticated_payload, &trusted_signer, &policy),
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
}
