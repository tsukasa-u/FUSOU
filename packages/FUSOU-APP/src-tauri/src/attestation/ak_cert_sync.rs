/// AK (Attestation Key) certificate synchronization via the FUSOU Privacy CA.
///
/// Flow:
///   1. Read EK (Endorsement Key) cert from TPM NV memory (discrete TPMs)
///      or fetch from manufacturer server (AMD fTPM via tpm2_getekcertificate).
///   2. POST to /api/attestation/ak-cert with EK cert chain + AK public key.
///   3. Privacy CA verifies EK chain → manufacturer root and issues AK cert.
///   4. Cache AK cert chain in ROAMING_DIR/attestation/ak_cert_chain.json.
///
/// The cached chain [AK cert (DER b64), Privacy CA cert (DER b64)] is then
/// included in every TPM attestation report.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(all(target_os = "linux", feature = "linux-tpm-attestation"))]
use tss_esapi::{
    handles::NvIndexTpmHandle,
    interface_types::resource_handles::NvAuth,
};

const AK_CERT_CHAIN_CACHE_FILE: &str = "attestation/ak_cert_chain.json";
/// How many hours before expiry to trigger a refresh.
const REFRESH_HOURS_BEFORE_EXPIRY: i64 = 24;
/// AMD fTPM EK cert provisioning binary name (must be on PATH via tpm2-tools).
const TPM2_GETEKCERTIFICATE_BIN: &str = "tpm2_getekcertificate";
/// Standard TPM 2.0 RSA EK NV indices (TCG spec).
const EK_NV_INDICES: &[(u32, &str)] = &[
    (0x01C00002, "rsa2048"),
    (0x01C0000A, "ecc_p256"),
    (0x01C00012, "rsa2048_alt"),
];

static SYNC_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedAkCertChain {
    /// DER base64 array: [AK cert, Privacy CA cert]
    pub ak_cert_chain_b64: Vec<String>,
    /// ISO-8601 expiry from Privacy CA response
    pub expires_at: String,
}

fn ak_cert_chain_cache_path() -> PathBuf {
    crate::util::get_ROAMING_DIR().join(AK_CERT_CHAIN_CACHE_FILE)
}

pub fn load_cached_ak_cert_chain() -> Option<CachedAkCertChain> {
    let path = ak_cert_chain_cache_path();
    let raw = fs::read_to_string(path).ok()?;
    let cached: CachedAkCertChain = serde_json::from_str(&raw).ok()?;

    // Check if still valid with margin.
    let expires =
        DateTime::parse_from_rfc3339(&cached.expires_at).ok()?.with_timezone(&Utc);
    let margin = chrono::Duration::hours(REFRESH_HOURS_BEFORE_EXPIRY);
    if Utc::now() + margin >= expires {
        return None; // Expired or about to expire.
    }

    if cached.ak_cert_chain_b64.len() < 2 {
        return None;
    }

    Some(cached)
}

fn save_ak_cert_chain(chain: &CachedAkCertChain) -> Result<(), String> {
    let path = ak_cert_chain_cache_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
    }
    let json = serde_json::to_string(chain).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("write failed: {e}"))
}

/// Reads the EK certificate bytes from standard TPM NV indices.
/// Returns the first found certificate as raw DER bytes.
#[cfg(all(target_os = "linux", feature = "linux-tpm-attestation"))]
fn read_ek_cert_from_nv() -> Option<Vec<u8>> {
    use super::tpm_linux::linux_impl::initialize_tpm_context_pub;
    use tss_esapi::{
        handles::NvIndexTpmHandle,
        interface_types::resource_handles::NvAuth,
    };

    let mut ctx = initialize_tpm_context_pub().ok()?;

    for &(index, _label) in EK_NV_INDICES {
        let nv_tpm_handle = NvIndexTpmHandle::new(index).ok()?;
        let nv_handle = match ctx.tr_from_tpm_public(nv_tpm_handle.into()) {
            Ok(h) => tss_esapi::handles::NvIndexHandle::from(h),
            Err(_) => continue,
        };
        let (nv_public, _) = match ctx.nv_read_public(nv_handle) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let size = nv_public.data_size() as u16;
        if let Ok(data) = ctx.nv_read(NvAuth::Owner, nv_handle, size, 0) {            let bytes = data.as_slice().to_vec();
            if bytes.len() > 16 && bytes[0] == 0x30 {
                tracing::info!(
                    handle = format_args!("0x{:08X}", index),
                    "Read EK certificate from NV"
                );
                return Some(bytes);
            }
        }
    }
    None
}

/// Fetches the EK certificate using tpm2_getekcertificate (AMD fTPM).
/// Requires tpm2-tools installed and tpm2_createek run first.
fn fetch_ek_cert_via_tool() -> Option<Vec<u8>> {
    use std::process::Command;

    // Use PID-specific temp paths to avoid /tmp race conditions.
    let pid = std::process::id();
    let ek_pub_path = std::env::temp_dir().join(format!("fusou_ek_pub_{pid}.bin"));
    let ek_ctx_path = std::env::temp_dir().join(format!("fusou_ek_ctx_{pid}.bin"));
    let cert_path = std::env::temp_dir().join(format!("fusou_ek_cert_{pid}.der"));

    let result = fetch_ek_cert_inner(
        &ek_pub_path,
        &ek_ctx_path,
        &cert_path,
    );
    // Always clean up, regardless of result.
    let _ = fs::remove_file(&ek_pub_path);
    let _ = fs::remove_file(&ek_ctx_path);
    let _ = fs::remove_file(&cert_path);
    result
}

fn fetch_ek_cert_inner(
    ek_pub_path: &std::path::Path,
    ek_ctx_path: &std::path::Path,
    cert_path: &std::path::Path,
) -> Option<Vec<u8>> {
    use std::process::Command;

    let create_ok = Command::new("tpm2_createek")
        .args([
            "-c",
            ek_ctx_path.to_str()?,
            "-G",
            "rsa",
            "-u",
            ek_pub_path.to_str()?,
        ])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !create_ok {
        tracing::debug!("tpm2_createek failed; skipping AMD fTPM EK cert fetch");
        return None;
    }

    // Try AMD encoding first, then Intel.
    for encoding in &["a", "i"] {
        let get_ok = Command::new(TPM2_GETEKCERTIFICATE_BIN)
            .args([
                "-u",
                ek_pub_path.to_str()?,
                "-o",
                cert_path.to_str()?,
                "-E",
                encoding,
            ])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if get_ok {
            let bytes = fs::read(cert_path).ok()?;
            if bytes.len() > 16 && bytes[0] == 0x30 {
                tracing::info!(encoding = %encoding, "Fetched EK cert via tpm2_getekcertificate");
                return Some(bytes);
            }
        }
    }
    tracing::debug!("tpm2_getekcertificate failed for all encodings");
    None
}


/// Builds the EK cert chain by following AIA (Authority Information Access) URLs.
/// Returns DER base64 array: [leaf, intermediate..., root]
/// Stops when no AIA CA Issuers URL is present (reached the root).
async fn build_ek_cert_chain(ek_cert_der: Vec<u8>) -> Option<Vec<String>> {
    let mut chain = vec![B64.encode(&ek_cert_der)];
    let mut current_der = ek_cert_der;

    // Follow AIA chain up to 4 levels deep.
    for _ in 0..4 {
        let aia_url = match extract_aia_ca_issuers_url(&current_der) {
            Some(url) => url,
            None => break, // No AIA CA Issuers URL → reached the chain root.
        };

        // Validate: only allow http:// and https:// URLs pointing to external servers.
        if !is_safe_aia_url(&aia_url) {
            tracing::warn!(url = %aia_url, "AIA URL rejected by safety check");
            break;
        }

        let response = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .ok()?
            .get(&aia_url)
            .send()
            .await
            .ok()?;

        if !response.status().is_success() {
            break;
        }

        let bytes = response
            .bytes()
            .await
            .ok()?;
        // Must look like a DER-encoded certificate (starts with SEQUENCE tag 0x30).
        if bytes.len() < 16 || bytes[0] != 0x30 || bytes.len() > 64 * 1024 {
            break;
        }

        chain.push(B64.encode(&bytes));
        current_der = bytes.to_vec();
    }

    if chain.len() >= 2 {
        Some(chain)
    } else {
        None
    }
}

/// Returns true only for http/https URLs that are not localhost or RFC-1918 ranges.
fn is_safe_aia_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return false;
    }
    // Block private/loopback hostnames.
    let blocked = [
        "localhost", "127.", "::1", "10.", "172.16.", "172.17.", "172.18.",
        "172.19.", "172.20.", "172.21.", "172.22.", "172.23.", "172.24.",
        "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.",
        "172.31.", "192.168.", "169.254.",
    ];
    let host_start = lower.find("://").map(|i| i + 3).unwrap_or(0);
    let host_end = lower[host_start..]
        .find(['/', ':', '?'])
        .map(|i| host_start + i)
        .unwrap_or(lower.len());
    let host = &lower[host_start..host_end];
    !blocked.iter().any(|b| host.starts_with(b))
}

fn extract_aia_ca_issuers_url(cert_der: &[u8]) -> Option<String> {
    // Minimal DER parser to extract AIA CA Issuers URI.
    // AIA OID: 1.3.6.1.5.5.7.1.1 = 2b 06 01 05 05 07 01 01
    let aia_oid: &[u8] = &[0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x01, 0x01];
    // CA Issuers access method OID: 1.3.6.1.5.5.7.48.2 = 2b 06 01 05 05 07 30 02
    let ca_issuers_oid: &[u8] = &[0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x02];

    let pos = cert_der.windows(aia_oid.len()).position(|w| w == aia_oid)?;
    let after_oid = &cert_der[pos + aia_oid.len()..];

    // Find CA Issuers OID after AIA OID
    let ca_pos = after_oid
        .windows(ca_issuers_oid.len())
        .position(|w| w == ca_issuers_oid)?;
    let after_ca = &after_oid[ca_pos + ca_issuers_oid.len()..];

    // Skip type byte (0x86 = IA5String / URI) and length
    if after_ca.len() < 3 || after_ca[0] != 0x86 {
        return None;
    }
    let url_len = after_ca[1] as usize;
    if after_ca.len() < 2 + url_len {
        return None;
    }
    let url_bytes = &after_ca[2..2 + url_len];
    String::from_utf8(url_bytes.to_vec()).ok()
}

fn is_self_signed_cert(_cert_der: &[u8]) -> bool {
    // REMOVED: do not use — was incorrectly based on cert size.
    // Chain termination is determined by absence of AIA CA Issuers URL.
    false
}

/// POST to Privacy CA endpoint to get an AK cert.
async fn request_ak_cert_from_privacy_ca(
    ek_cert_chain_b64: Vec<String>,
    ak_pub_b64: String,
    privacy_ca_endpoint: &str,
    dataset_id: Option<&str>,
) -> Result<CachedAkCertChain, String> {
    let body = serde_json::json!({
        "ek_cert_chain_b64": ek_cert_chain_b64,
        "ak_pub_b64": ak_pub_b64,
        "dataset_id": dataset_id.unwrap_or(""),
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client
        .post(privacy_ca_endpoint)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Privacy CA request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let err_body = response.text().await.unwrap_or_default();
        return Err(format!("Privacy CA returned {status}: {err_body}"));
    }

    let resp: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Privacy CA response parse error: {e}"))?;

    let chain = resp["ak_cert_chain_b64"]
        .as_array()
        .ok_or("missing ak_cert_chain_b64")?
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect::<Vec<_>>();

    if chain.len() < 2 {
        return Err("Privacy CA returned fewer than 2 certs".to_string());
    }

    let expires_at = resp["expires_at"]
        .as_str()
        .unwrap_or("2026-01-01T00:00:00Z")
        .to_string();

    Ok(CachedAkCertChain {
        ak_cert_chain_b64: chain,
        expires_at,
    })
}

/// Resolves the Privacy CA endpoint from the attestation config endpoint.
/// Maps https://host/api/attestation/config → https://host/api/attestation/ak-cert
fn resolve_privacy_ca_endpoint() -> Option<String> {
    let attestation_endpoint = configs::get_user_configs_for_app()
        .auth
        .get_attestation_config_endpoint()?;

    // Parse as URL to safely replace the path.
    let url = url::Url::parse(&attestation_endpoint).ok()?;
    let base_path = url.path().trim_end_matches("/config");
    let ak_cert_path = format!("{base_path}/ak-cert");

    let mut ak_url = url.clone();
    ak_url.set_path(&ak_cert_path);
    // Only allow https:// Privacy CA endpoints.
    if ak_url.scheme() != "https" {
        return None;
    }
    Some(ak_url.to_string())
}

/// Performs TPM2_ActivateCredential to prove AK and EK reside in the same TPM.
///
/// This is the cryptographic proof that the AK private key is hardware-bound
/// in the same physical TPM as the EK whose certificate was provided to the
/// Privacy CA.
#[cfg(all(target_os = "linux", feature = "linux-tpm-attestation"))]
async fn activate_credential_on_tpm(
    _ak_pub_b64: &str,
    credential_blob_b64: &str,
    encrypted_seed_b64: &str,
) -> Result<Vec<u8>, String> {
    use tss_esapi::{
        constants::SessionType,
        handles::AuthHandle,
        interface_types::{
            algorithm::HashingAlgorithm,
            resource_handles::Hierarchy,
            session_handles::{AuthSession, PolicySession},
        },
        structures::{
            Digest, EncryptedSecret, IdObject, Nonce,
            SymmetricDefinition,
        },
    };
    use super::tpm_linux;

    let credential_blob_der = B64.decode(credential_blob_b64.trim())
        .map_err(|e| format!("bad credential_blob_b64: {e}"))?;
    let encrypted_seed_der = B64.decode(encrypted_seed_b64.trim())
        .map_err(|e| format!("bad encrypted_seed_b64: {e}"))?;

    // Parse TPM2B_ID_OBJECT and TPM2B_ENCRYPTED_SECRET (2-byte big-endian size prefix).
    let parse_tpm2b_inner = |buf: &[u8]| -> Result<Vec<u8>, String> {
        if buf.len() < 2 { return Err("tpm2b too short".into()); }
        let sz = (buf[0] as usize) << 8 | buf[1] as usize;
        if buf.len() < 2 + sz { return Err(format!("tpm2b size mismatch: declared {sz}, have {}", buf.len() - 2)); }
        Ok(buf[2..2 + sz].to_vec())
    };

    let credential_inner = parse_tpm2b_inner(&credential_blob_der)?;
    let seed_bytes = parse_tpm2b_inner(&encrypted_seed_der)?;

    let id_object = IdObject::try_from(credential_inner.as_slice())
        .map_err(|e| format!("IdObject parse: {e}"))?;
    let encrypted_secret = EncryptedSecret::try_from(seed_bytes.as_slice())
        .map_err(|e| format!("EncryptedSecret parse: {e}"))?;

    let mut ctx = tpm_linux::linux_impl::initialize_tpm_context_pub()
        .map_err(|e| format!("TPM init: {e}"))?;

    // Load AK at its persistent handle.
    let ak_handle = tpm_linux::linux_impl::load_or_create_attestation_key_pub(&mut ctx)
        .map_err(|e| format!("AK load: {e}"))?;

    // Create EK from endorsement hierarchy (use standard EK template).
    let ek_pub = tpm_linux::linux_impl::create_ek_public_template();
    let ek_primary = ctx
        .execute_with_nullauth_session(|c| {
            c.create_primary(Hierarchy::Endorsement, ek_pub, None, None, None, None)
        })
        .map_err(|e| format!("EK create_primary: {e}"))?;
    let ek_handle = ek_primary.key_handle;

    // Start a policy session for the EK (requires PolicySecret(ENDORSEMENT)).
    let session_opt = ctx
        .start_auth_session(
            None,
            None,
            None,
            SessionType::Policy,
            SymmetricDefinition::AES_128_CFB,
            HashingAlgorithm::Sha256,
        )
        .map_err(|e| format!("start_auth_session: {e}"))?;

    let policy_session = PolicySession::try_from(
        session_opt.ok_or("no policy session returned")?
    )
    .map_err(|e| format!("PolicySession: {e}"))?;

    // Apply PolicySecret(ENDORSEMENT).
    ctx.policy_secret(
        policy_session,
        AuthHandle::Endorsement,
        Nonce::default(),
        Digest::default(),
        Nonce::default(),
        None,
    )
    .map_err(|e| format!("policy_secret: {e}"))?;

    let plaintext = ctx
        .execute_with_sessions(
            (
                Some(AuthSession::Password),
                Some(AuthSession::PolicySession(policy_session)),
                None,
            ),
            |c| c.activate_credential(ak_handle, ek_handle, id_object, encrypted_secret),
        )
        .map_err(|e| format!("activate_credential: {e}"))?;

    let _ = ctx.flush_context(ek_handle.into());

    Ok(plaintext.to_vec())
}

/// Attempts to synchronize the AK certificate.
/// - Reads EK cert from NV (discrete TPMs) or fetches via tpm2-tools (fTPM).
/// - Requests an AK cert from the Privacy CA.
/// - Caches the result.
pub async fn sync_ak_cert(ak_pub_b64: String) -> Result<CachedAkCertChain, String> {
    if SYNC_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return Err("AK cert sync already in progress".to_string());
    }

    let result = sync_ak_cert_inner(ak_pub_b64).await;
    SYNC_IN_PROGRESS.store(false, Ordering::SeqCst);
    result
}

async fn sync_ak_cert_inner(ak_pub_b64: String) -> Result<CachedAkCertChain, String> {
    // 1. Get EK certificate.
    let ek_cert_der = {
        #[cfg(all(target_os = "linux", feature = "linux-tpm-attestation"))]
        {
            read_ek_cert_from_nv()
                .or_else(fetch_ek_cert_via_tool)
                .ok_or_else(|| {
                    "Could not obtain EK certificate from NV or manufacturer server".to_string()
                })?
        }
        #[cfg(not(all(target_os = "linux", feature = "linux-tpm-attestation")))]
        {
            return Err("EK cert reading requires linux-tpm-attestation feature".to_string());
        }
    };

    // 2. Build EK cert chain by following AIA URLs.
    let ek_chain = build_ek_cert_chain(ek_cert_der.clone())
        .await
        .ok_or("Failed to build EK certificate chain from AIA")?;

    tracing::info!(chain_len = ek_chain.len(), "EK cert chain built");

    let endpoint = resolve_privacy_ca_endpoint()
        .ok_or("Privacy CA endpoint not configured")?;
    let challenge_endpoint = format!("{endpoint}/challenge");
    let complete_endpoint = format!("{endpoint}/complete");

    // 3. Get the EK public key (needed for MakeCredential on server).
    let ek_pub_b64 = B64.encode(&ek_cert_der[..]) ; // This is the raw DER of EK cert...
    // Actually we need the EK public key (SPKI DER), not the cert.
    // Derive EK pub key from the EK cert DER.
    let ek_pub_spki_b64 = extract_spki_from_cert_der(&ek_cert_der)?;

    // 4. Get AK name from TPM (hashAlg || SHA256(TPMT_PUBLIC)).
    #[cfg(all(target_os = "linux", feature = "linux-tpm-attestation"))]
    let ak_name_b64 = get_ak_name_from_tpm().await?;
    #[cfg(not(all(target_os = "linux", feature = "linux-tpm-attestation")))]
    let ak_name_b64: String = return Err("linux-tpm-attestation required".into());

    // 5. Request MakeCredential challenge from Privacy CA.
    let challenge_resp = request_challenge(
        &challenge_endpoint,
        &ek_chain,
        &ek_pub_spki_b64,
        &ak_pub_b64,
        &ak_name_b64,
    ).await?;

    tracing::info!("Received MakeCredential challenge from Privacy CA");

    // 6. Run ActivateCredential on the TPM to prove AK-EK co-residency.
    #[cfg(all(target_os = "linux", feature = "linux-tpm-attestation"))]
    let plaintext = activate_credential_on_tpm(
        &ak_pub_b64,
        &challenge_resp.credential_blob_b64,
        &challenge_resp.encrypted_seed_b64,
    ).await?;
    #[cfg(not(all(target_os = "linux", feature = "linux-tpm-attestation")))]
    let plaintext: Vec<u8> = return Err("linux-tpm-attestation required".into());

    tracing::info!("ActivateCredential succeeded: AK-EK co-residency proven");

    // 7. Complete the challenge: send plaintext back to Privacy CA, receive AK cert.
    let cached = complete_challenge(
        &complete_endpoint,
        &challenge_resp.challenge_id,
        &B64.encode(&plaintext),
    ).await?;

    // 8. Save to cache.
    save_ak_cert_chain(&cached)
        .map_err(|e| format!("Failed to save AK cert chain: {e}"))?;

    tracing::info!(
        expires_at = %cached.expires_at,
        "AK cert cached (ActivateCredential verified)"
    );
    Ok(cached)
}

#[derive(Deserialize)]
struct ChallengeResponse {
    challenge_id: String,
    credential_blob_b64: String,
    encrypted_seed_b64: String,
}

async fn request_challenge(
    endpoint: &str,
    ek_chain: &[String],
    ek_pub_spki_b64: &str,
    ak_pub_b64: &str,
    ak_name_b64: &str,
) -> Result<ChallengeResponse, String> {
    let body = serde_json::json!({
        "ek_cert_chain_b64": ek_chain,
        "ek_pub_b64": ek_pub_spki_b64,
        "ak_pub_b64": ak_pub_b64,
        "ak_name_b64": ak_name_b64,
    });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;
    let resp = client.post(endpoint).json(&body).send().await
        .map_err(|e| format!("challenge request failed: {e}"))?;
    if !resp.status().is_success() {
        let s = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("challenge endpoint {s}: {t}"));
    }
    resp.json::<ChallengeResponse>().await
        .map_err(|e| format!("challenge response parse: {e}"))
}

async fn complete_challenge(
    endpoint: &str,
    challenge_id: &str,
    plaintext_b64: &str,
) -> Result<CachedAkCertChain, String> {
    let body = serde_json::json!({
        "challenge_id": challenge_id,
        "plaintext_b64": plaintext_b64,
    });
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;
    let resp = client.post(endpoint).json(&body).send().await
        .map_err(|e| format!("complete request failed: {e}"))?;
    if !resp.status().is_success() {
        let s = resp.status();
        let t = resp.text().await.unwrap_or_default();
        return Err(format!("complete endpoint {s}: {t}"));
    }
    let v: serde_json::Value = resp.json().await
        .map_err(|e| format!("complete response parse: {e}"))?;
    let chain: Vec<String> = v["ak_cert_chain_b64"]
        .as_array()
        .ok_or("missing ak_cert_chain_b64")?
        .iter()
        .filter_map(|x| x.as_str().map(|s| s.to_string()))
        .collect();
    if chain.len() < 2 { return Err("complete: fewer than 2 certs".into()); }
    let expires_at = v["expires_at"].as_str().unwrap_or("2026-01-01T00:00:00Z").to_string();
    Ok(CachedAkCertChain { ak_cert_chain_b64: chain, expires_at })
}

/// Extracts the SPKI public key from a DER-encoded X.509 certificate.
/// Returns base64-encoded SPKI DER.
fn extract_spki_from_cert_der(cert_der: &[u8]) -> Result<String, String> {
    // X.509 structure: SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
    // tbsCertificate: SEQUENCE { version, serialNumber, signature, issuer, validity, subject,
    //                            subjectPublicKeyInfo, ... }
    // We need to find subjectPublicKeyInfo.
    // Minimal parser: look for the SPKI SEQUENCE containing the RSA OID.
    // RSA SPKI OID: 30 82 xx xx 30 0d 06 09 2a 86 48 86 f7 0d 01 01 01 05 00 03 ...
    let rsa_spki_marker: &[u8] = &[0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
    if let Some(pos) = cert_der.windows(rsa_spki_marker.len()).position(|w| w == rsa_spki_marker) {
        // Walk back to the SEQUENCE tag that wraps AlgorithmIdentifier + bit string.
        if pos >= 2 {
            let spki_start = pos - 2; // 0x30 0x82 (or 0x30 0x8x) before the OID seq
            // Find the outer SEQUENCE that starts right before the algorithm identifier.
            // Look for 0x30 before pos.
            if let Some(outer) = cert_der[..pos].iter().rposition(|&b| b == 0x30) {
                let spki_bytes = &cert_der[outer..];
                // Parse length of this SEQUENCE.
                if spki_bytes.len() >= 4 {
                    let (len, hdr) = parse_der_length(&spki_bytes[1..]);
                    let total = 1 + hdr + len;
                    if total <= spki_bytes.len() {
                        return Ok(B64.encode(&spki_bytes[..total]));
                    }
                }
            }
        }
    }
    Err("Could not extract SPKI from EK cert DER".to_string())
}

fn parse_der_length(buf: &[u8]) -> (usize, usize) {
    if buf.is_empty() { return (0, 0); }
    if buf[0] < 0x80 {
        (buf[0] as usize, 1)
    } else {
        let n = (buf[0] & 0x7f) as usize;
        if n == 0 || n > 4 || buf.len() < 1 + n { return (0, 1 + n); }
        let mut len = 0usize;
        for i in 0..n { len = (len << 8) | buf[1 + i] as usize; }
        (len, 1 + n)
    }
}

/// Gets the AK name (TPM2B_NAME = hashAlg(2 bytes) || SHA256(TPMT_PUBLIC)) from the TPM.
#[cfg(all(target_os = "linux", feature = "linux-tpm-attestation"))]
async fn get_ak_name_from_tpm() -> Result<String, String> {
    use super::tpm_linux;
    let mut ctx = tpm_linux::linux_impl::initialize_tpm_context_pub()
        .map_err(|e| format!("TPM init: {e}"))?;
    let ak_handle = tpm_linux::linux_impl::load_or_create_attestation_key_pub(&mut ctx)
        .map_err(|e| format!("AK load: {e}"))?;
    let (_public, name, _qualified) = ctx.read_public(ak_handle)
        .map_err(|e| format!("read_public: {e}"))?;
    let name_bytes = name.value();
    Ok(B64.encode(name_bytes))
}

