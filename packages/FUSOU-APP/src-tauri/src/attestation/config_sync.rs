use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use chrono::{DateTime, Utc};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use url::Url;

const CONFIG_SIGNING_PUBLIC_KEY_ENV: &str = "APP_ATTESTATION_CONFIG_SIGNING_PUBLIC_KEY";
const CONFIG_SIGNATURE_HEADER: &str = "X-FUSOU-Config-Signature";
const SYNC_INTERVAL_SECS: u64 = 6 * 60 * 60;
const FAILURE_RETRY_SECS: u64 = 5 * 60;
const MAX_CONFIG_RESPONSE_BYTES: usize = 128 * 1024;
const MAX_ISSUED_AT_FUTURE_SKEW_SECS: i64 = 10 * 60;

static SYNC_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
static LAST_SYNC_ATTEMPT_EPOCH_SECS: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncedAttestationConfig {
    pub version: u64,
    pub issued_at: String,
    pub expires_at: String,
    #[serde(default)]
    pub attestation_required: bool,
    #[serde(default)]
    pub tpm: Option<TpmConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TpmConfig {
    #[serde(default)]
    pub persistent_handle: Option<String>,
    #[serde(default)]
    pub ak_cert_chain_b64: Option<Vec<String>>,
}

fn config_file_path() -> PathBuf {
    crate::util::get_ROAMING_DIR()
        .join("attestation")
        .join("config.json")
}

fn signature_file_path() -> PathBuf {
    crate::util::get_ROAMING_DIR()
        .join("attestation")
        .join("config.sig")
}

fn parse_datetime(value: &str, field: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|err| format!("invalid {field}: {err}"))
}

fn parse_persistent_handle_value(value: &str) -> Result<u32, std::num::ParseIntError> {
    if let Some(hex) = value.strip_prefix("0x").or_else(|| value.strip_prefix("0X")) {
        return u32::from_str_radix(hex, 16);
    }

    value.parse::<u32>()
}

fn validate_config(config: &SyncedAttestationConfig, now: DateTime<Utc>) -> Result<(), String> {
    let issued_at = parse_datetime(&config.issued_at, "issued_at")?;
    let expires_at = parse_datetime(&config.expires_at, "expires_at")?;

    if expires_at <= now {
        return Err("attestation config expired".to_string());
    }

    if issued_at > expires_at {
        return Err("issued_at is newer than expires_at".to_string());
    }

    if issued_at > now + chrono::Duration::seconds(MAX_ISSUED_AT_FUTURE_SKEW_SECS) {
        return Err("issued_at is too far in the future".to_string());
    }

    if let Some(tpm) = &config.tpm {
        if let Some(handle) = &tpm.persistent_handle {
            let trimmed = handle.trim();
            if trimmed.is_empty() {
                return Err("tpm.persistent_handle is empty".to_string());
            }

            let parsed = parse_persistent_handle_value(trimmed)
                .map_err(|_| "tpm.persistent_handle is invalid".to_string())?;
            if (parsed >> 24) != 0x81 {
                return Err("tpm.persistent_handle is outside TPM persistent range".to_string());
            }
        }

        if let Some(chain) = &tpm.ak_cert_chain_b64 {
            if chain.len() < 2 {
                return Err("tpm.ak_cert_chain_b64 must contain at least leaf and root".to_string());
            }

            for (idx, cert) in chain.iter().enumerate() {
                let trimmed = cert.trim();
                if trimmed.is_empty() {
                    return Err(format!("tpm.ak_cert_chain_b64[{idx}] is empty"));
                }
                B64.decode(trimmed)
                    .map_err(|_| format!("tpm.ak_cert_chain_b64[{idx}] is not valid base64"))?;
            }
        }
    }

    Ok(())
}

fn canonicalize_json(value: &Value) -> Result<String, String> {
    match value {
        Value::Null => Ok("null".to_string()),
        Value::Bool(v) => Ok(if *v { "true" } else { "false" }.to_string()),
        Value::Number(v) => Ok(v.to_string()),
        Value::String(v) => Ok(serde_json::to_string(v).map_err(|err| err.to_string())?),
        Value::Array(items) => {
            let mut out = String::from("[");
            for (idx, item) in items.iter().enumerate() {
                if idx > 0 {
                    out.push(',');
                }
                out.push_str(&canonicalize_json(item)?);
            }
            out.push(']');
            Ok(out)
        }
        Value::Object(map) => {
            let mut keys: Vec<&str> = map.keys().map(String::as_str).collect();
            keys.sort_unstable();

            let mut out = String::from("{");
            for (idx, key) in keys.iter().enumerate() {
                if idx > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(key).map_err(|err| err.to_string())?);
                out.push(':');
                out.push_str(&canonicalize_json(
                    map.get(*key)
                        .ok_or_else(|| "missing canonicalization key".to_string())?,
                )?);
            }
            out.push('}');
            Ok(out)
        }
    }
}

fn resolve_config_endpoint() -> Result<String, String> {
    let endpoint = configs::get_user_configs_for_app()
        .auth
        .get_attestation_config_endpoint()
        .ok_or_else(|| {
            "app.auth.attestation_config_endpoint is not configured in configs.toml".to_string()
        })?;

    let url = Url::parse(&endpoint)
        .map_err(|err| format!("app.auth.attestation_config_endpoint is invalid: {err}"))?;
    if url.scheme() != "https" {
        return Err("app.auth.attestation_config_endpoint must use https://".to_string());
    }

    Ok(url.to_string())
}

fn resolve_signing_public_key() -> Result<String, String> {
    if let Ok(value) = std::env::var(CONFIG_SIGNING_PUBLIC_KEY_ENV) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    Err(format!(
        "{} is not configured (set via dotenvx for tauri build/run)",
        CONFIG_SIGNING_PUBLIC_KEY_ENV
    ))
}

fn verify_signature_with_public_key(
    canonical_json: &str,
    signature_b64: &str,
    public_key_b64: &str,
) -> Result<(), String> {
    let key_bytes = B64
        .decode(public_key_b64.trim())
        .map_err(|err| {
            format!(
                "invalid {} (expected base64 32-byte key): {}",
                CONFIG_SIGNING_PUBLIC_KEY_ENV, err
            )
        })?;

    let key_array: [u8; 32] = key_bytes
        .as_slice()
        .try_into()
        .map_err(|_| {
            format!(
                "{} must decode to 32 bytes",
                CONFIG_SIGNING_PUBLIC_KEY_ENV
            )
        })?;

    let verifying_key =
        VerifyingKey::from_bytes(&key_array).map_err(|err| format!("invalid public key: {err}"))?;

    let signature_bytes = B64
        .decode(signature_b64.trim())
        .map_err(|err| format!("invalid signature header base64: {err}"))?;
    let signature_array: [u8; 64] = signature_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "signature must decode to 64 bytes".to_string())?;
    let signature = Signature::from_bytes(&signature_array);

    verifying_key
        .verify(canonical_json.as_bytes(), &signature)
        .map_err(|err| format!("config signature verification failed: {err}"))
}

fn verify_signature(canonical_json: &str, signature_b64: &str) -> Result<(), String> {
    let public_key_b64 = resolve_signing_public_key()?;
    verify_signature_with_public_key(canonical_json, signature_b64, &public_key_b64)
}

fn save_config(path: &Path, raw_json: &str, signature_b64: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create config directory: {err}"))?;
    }

    fs::write(path, raw_json).map_err(|err| format!("failed to write config: {err}"))?;
    fs::write(signature_file_path(), signature_b64)
        .map_err(|err| format!("failed to write config signature: {err}"))
}

pub fn load_active_attestation_config() -> Option<SyncedAttestationConfig> {
    // Fail closed for cached config usage when verifier key is missing.
    if resolve_signing_public_key().is_err() {
        return None;
    }

    let path = config_file_path();
    let raw = fs::read_to_string(path).ok()?;
    let signature = fs::read_to_string(signature_file_path()).ok()?;
    if verify_signature(&raw, signature.trim()).is_err() {
        return None;
    }

    let config: SyncedAttestationConfig = serde_json::from_str(&raw).ok()?;
    if validate_config(&config, Utc::now()).is_err() {
        return None;
    }
    Some(config)
}

pub fn has_cached_tpm_ak_chain() -> bool {
    load_active_attestation_config()
        .and_then(|config| config.tpm)
        .and_then(|tpm| tpm.ak_cert_chain_b64)
        .map(|chain| !chain.is_empty())
        .unwrap_or(false)
}

pub fn resolve_tpm_chain_from_cached_config() -> Option<Vec<String>> {
    load_active_attestation_config()
        .and_then(|config| config.tpm)
        .and_then(|tpm| tpm.ak_cert_chain_b64)
        .map(|chain| {
            chain
                .into_iter()
                .map(|cert| cert.trim().to_string())
                .filter(|cert| !cert.is_empty())
                .collect::<Vec<String>>()
        })
        .filter(|chain| !chain.is_empty())
}

pub fn resolve_tpm_persistent_handle_from_cached_config() -> Option<String> {
    load_active_attestation_config()
        .and_then(|config| config.tpm)
        .and_then(|tpm| tpm.persistent_handle)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

async fn sync_attestation_config_once() -> Result<(), String> {
    let endpoint = resolve_config_endpoint()?;
    let response = reqwest::Client::new()
        .get(&endpoint)
        .send()
        .await
        .map_err(|err| format!("failed to fetch attestation config: {err}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "attestation config request failed with status {}",
            response.status()
        ));
    }

    let signature = response
        .headers()
        .get(CONFIG_SIGNATURE_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "attestation config response missing {} header",
                CONFIG_SIGNATURE_HEADER
            )
        })?;

    if let Some(content_length) = response.content_length() {
        if content_length as usize > MAX_CONFIG_RESPONSE_BYTES {
            return Err(format!(
                "attestation config response too large: {} bytes",
                content_length
            ));
        }
    }

    let body_bytes = response
        .bytes()
        .await
        .map_err(|err| format!("failed to read attestation config body: {err}"))?;

    if body_bytes.len() > MAX_CONFIG_RESPONSE_BYTES {
        return Err(format!(
            "attestation config response too large after read: {} bytes",
            body_bytes.len()
        ));
    }

    let body = std::str::from_utf8(&body_bytes)
        .map_err(|err| format!("attestation config body is not utf-8: {err}"))?
        .to_string();

    let json_value: Value = serde_json::from_str(&body)
        .map_err(|err| format!("attestation config body is not valid JSON: {err}"))?;
    if !json_value.is_object() {
        return Err("attestation config body must be a JSON object".to_string());
    }

    let canonical = canonicalize_json(&json_value)?;
    verify_signature(&canonical, &signature)?;

    let config: SyncedAttestationConfig = serde_json::from_value(json_value)
        .map_err(|err| format!("invalid attestation config schema: {err}"))?;
    validate_config(&config, Utc::now())?;

    if let Some(existing) = load_active_attestation_config() {
        let existing_issued_at = parse_datetime(&existing.issued_at, "existing.issued_at")?;
        let new_issued_at = parse_datetime(&config.issued_at, "issued_at")?;

        if config.version < existing.version {
            return Err(format!(
                "attestation config rollback detected (existing version {}, received {})",
                existing.version, config.version
            ));
        }

        if config.version == existing.version && new_issued_at <= existing_issued_at {
            return Err(
                "attestation config rollback detected: same version with non-increasing issued_at"
                    .to_string(),
            );
        }
    }

    save_config(&config_file_path(), &canonical, &signature)
}

pub fn maybe_schedule_attestation_config_sync() {
    let now_secs = Utc::now().timestamp().max(0) as u64;
    let last = LAST_SYNC_ATTEMPT_EPOCH_SECS.load(Ordering::SeqCst);
    if now_secs.saturating_sub(last) < SYNC_INTERVAL_SECS {
        return;
    }

    if SYNC_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return;
    }

    match tokio::runtime::Handle::try_current() {
        Ok(handle) => {
            handle.spawn(async {
                let sync_result = sync_attestation_config_once().await;
                let now = Utc::now().timestamp().max(0) as u64;

                if let Err(err) = sync_result {
                    tracing::warn!("attestation config sync failed: {}", err);
                    let backoff_anchor = now.saturating_sub(SYNC_INTERVAL_SECS - FAILURE_RETRY_SECS);
                    LAST_SYNC_ATTEMPT_EPOCH_SECS.store(backoff_anchor, Ordering::SeqCst);
                } else {
                    LAST_SYNC_ATTEMPT_EPOCH_SECS.store(now, Ordering::SeqCst);
                }
                SYNC_IN_PROGRESS.store(false, Ordering::SeqCst);
            });
        }
        Err(err) => {
            tracing::warn!("attestation config sync skipped: no runtime available ({})", err);
            SYNC_IN_PROGRESS.store(false, Ordering::SeqCst);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn sample_config(expires_at: &str) -> SyncedAttestationConfig {
        SyncedAttestationConfig {
            version: 1,
            issued_at: "2026-07-01T00:00:00Z".to_string(),
            expires_at: expires_at.to_string(),
            attestation_required: false,
            tpm: Some(TpmConfig {
                persistent_handle: Some("0x81010001".to_string()),
                ak_cert_chain_b64: Some(vec![
                    B64.encode([1_u8, 2, 3]),
                    B64.encode([4_u8, 5, 6]),
                ]),
            }),
        }
    }

    #[test]
    fn verify_signature_accepts_valid_signature() {
        let secret = [7_u8; 32];
        let signing_key = SigningKey::from_bytes(&secret);
        let public_key_b64 = B64.encode(signing_key.verifying_key().to_bytes());

        let message = "{\"version\":1}";
        let signature = signing_key.sign(message.as_bytes());
        let signature_b64 = B64.encode(signature.to_bytes());

        let verified = verify_signature_with_public_key(message, &signature_b64, &public_key_b64);
        assert!(verified.is_ok(), "expected signature to verify: {verified:?}");
    }

    #[test]
    fn validate_config_rejects_expired_config() {
        let cfg = sample_config("2026-07-01T00:00:00Z");
        let now = DateTime::parse_from_rfc3339("2026-07-03T00:00:00Z")
            .expect("parse datetime")
            .with_timezone(&Utc);

        let result = validate_config(&cfg, now);
        assert!(result.is_err());
    }

    #[test]
    fn validate_config_rejects_non_persistent_handle_range() {
        let mut cfg = sample_config("2026-07-10T00:00:00Z");
        cfg.tpm = Some(TpmConfig {
            persistent_handle: Some("0x71010001".to_string()),
            ak_cert_chain_b64: Some(vec![
                B64.encode([1_u8, 2, 3]),
                B64.encode([4_u8, 5, 6]),
            ]),
        });

        let now = DateTime::parse_from_rfc3339("2026-07-03T00:00:00Z")
            .expect("parse datetime")
            .with_timezone(&Utc);
        let result = validate_config(&cfg, now);
        assert!(result.is_err());
    }
}
