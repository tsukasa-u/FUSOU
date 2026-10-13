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
    let payload: RuntimeConfigManifestPayload = serde_json::from_slice(&payload_bytes)
        .map_err(|_| RuntimeConfigManifestError::Invalid("payload JSON is invalid"))?;
    if canonical_json_bytes(&payload)? != payload_bytes {
        return Err(RuntimeConfigManifestError::Invalid(
            "payload is not canonical JSON",
        ));
    }
    validate_payload(&payload, policy.now)?;

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
    crate::tlsn_preflight::validate_notary_key_bytes(&notary_key_bytes).map_err(|_| {
        RuntimeConfigManifestError::Invalid(
            "Notary verifying key is not a canonical alpha.15 key or tlsn-production is disabled",
        )
    })?;
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
        let not_before = DateTime::parse_from_rfc3339(not_before)
            .map_err(|_| {
                RuntimeConfigManifestError::Invalid("Result registry not_before is invalid")
            })?
            .with_timezone(&Utc);
        let not_after = match entry.get("not_after") {
            Some(Value::Null) => None,
            Some(Value::String(value)) => Some(
                DateTime::parse_from_rfc3339(value)
                    .map_err(|_| {
                        RuntimeConfigManifestError::Invalid("Result registry not_after is invalid")
                    })?
                    .with_timezone(&Utc),
            ),
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
    #[cfg(feature = "tlsn-production")]
    use flate2::read::GzDecoder;
    #[cfg(feature = "tlsn-production")]
    use std::io::Read;

    #[cfg(feature = "tlsn-production")]
    #[derive(Deserialize)]
    struct TestVector {
        test_only: bool,
        trusted_signer: RuntimeConfigTrustedSigner,
        envelope_uncompressed_bytes: usize,
        envelope_gzip_base64url: String,
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

    #[cfg(feature = "tlsn-production")]
    #[test]
    fn verifies_the_shared_node_golden_vector_and_rejects_mutations() {
        let fixture: TestVector = serde_json::from_str(include_str!(
            "../../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/fixtures/tlsn-runtime-config-manifest-v1-vector.json"
        ))
        .unwrap();
        assert!(fixture.test_only);
        let compressed = URL_SAFE_NO_PAD
            .decode(fixture.envelope_gzip_base64url)
            .unwrap();
        let mut decoder = GzDecoder::new(compressed.as_slice());
        let mut raw = Vec::new();
        decoder.read_to_end(&mut raw).unwrap();
        assert_eq!(raw.len(), fixture.envelope_uncompressed_bytes);

        let envelope: RuntimeConfigManifestEnvelope = serde_json::from_slice(&raw).unwrap();
        let payload_bytes =
            decode_canonical_base64url(&envelope.payload_base64url, "payload").unwrap();
        let payload: RuntimeConfigManifestPayload = serde_json::from_slice(&payload_bytes).unwrap();
        let observed_at = parse_canonical_utc(&payload.source.observed_at).unwrap();
        let policy = RuntimeConfigVerificationPolicy {
            now: observed_at + chrono::Duration::seconds(1),
            last_accepted_epoch: "0".to_owned(),
            max_lifetime_seconds: 3600,
            max_clock_skew_seconds: 30,
            max_reference_age_seconds: 600,
            max_envelope_bytes: 4096,
        };
        let trusted_signer = RuntimeConfigTrustedSigner {
            scope: fixture.trusted_signer.scope,
            key_id: fixture.trusted_signer.key_id,
            public_key_spki: fixture.trusted_signer.public_key_spki,
        };
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

        let mut malformed_payload = payload;
        let observed_at = parse_canonical_utc(&malformed_payload.source.observed_at).unwrap();
        malformed_payload
            .production_authority_pins
            .target_approval_artifact_sha256
            .clear();
        assert!(validate_payload(&malformed_payload, observed_at).is_err());
    }
}
