pub mod environment_check;
pub mod fingerprint;
pub mod secure_enclave_macos;
pub mod config_sync;
pub mod tpm_linux;
pub mod tpm_windows;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde_json::json;
#[cfg(target_os = "linux")]
use std::fs::OpenOptions;
#[cfg(target_os = "linux")]
use std::process::Command;
#[cfg(target_os = "linux")]
use std::sync::{LazyLock, Mutex};

#[cfg(any(target_os = "windows", target_os = "linux"))]
use std::sync::atomic::Ordering;

#[cfg(target_os = "linux")]
use std::sync::atomic::AtomicU8;

const TPM_AK_PERSISTENT_HANDLE_ENV: &str = "FUSOU_TPM_AK_PERSISTENT_HANDLE";
const TPM_AK_CERT_CHAIN_B64_ENV: &str = "FUSOU_TPM_AK_CERT_CHAIN_B64";

#[cfg(target_os = "linux")]
const LINUX_TPM_USABLE_UNKNOWN: u8 = 0;
#[cfg(target_os = "linux")]
const LINUX_TPM_USABLE_YES: u8 = 1;
#[cfg(target_os = "linux")]
const LINUX_TPM_USABLE_NO: u8 = 2;
#[cfg(target_os = "linux")]
static LINUX_TPM_RUNTIME_USABLE: AtomicU8 = AtomicU8::new(LINUX_TPM_USABLE_UNKNOWN);
#[cfg(target_os = "linux")]
static LINUX_TPM_RUNTIME_LAST_ERROR: LazyLock<Mutex<Option<String>>> =
    LazyLock::new(|| Mutex::new(None));

#[derive(Debug, Clone)]
pub struct AttestationPreflightWarning {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct HardwareAttestationRuntimeStatus {
    pub available: bool,
    pub attestation_level: &'static str,
    pub detail: Option<String>,
    pub platform: &'static str,
    pub distribution: Option<String>,
    pub diagnostics: Vec<String>,
    pub remediation_steps: Vec<String>,
}

fn build_software_report() -> serde_json::Value {
    json!({
        "attestation_level": "software_fingerprint",
        "fingerprint": fingerprint::collect_fingerprint(),
        "environment": environment_check::detect_environment(),
    })
}

pub fn initialize_hardware_attestation_runtime() -> bool {
    #[cfg(target_os = "linux")]
    {
        return probe_linux_tpm_runtime(true);
    }

    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

pub fn get_hardware_attestation_runtime_status() -> HardwareAttestationRuntimeStatus {
    #[cfg(target_os = "linux")]
    {
        let available = probe_linux_tpm_runtime(false);
        let diagnostics = linux_tpm_diagnostics();
        let remediation_steps = linux_tpm_remediation_steps(available, &diagnostics);
        return HardwareAttestationRuntimeStatus {
            available,
            attestation_level: if available {
                "tpm"
            } else {
                "software_fingerprint"
            },
            detail: linux_tpm_last_error(),
            platform: "linux",
            distribution: linux_distribution_name(),
            diagnostics,
            remediation_steps,
        };
    }

    #[cfg(target_os = "windows")]
    {
        return HardwareAttestationRuntimeStatus {
            available: true,
            attestation_level: "unknown",
            detail: None,
            platform: "windows",
            distribution: None,
            diagnostics: Vec::new(),
            remediation_steps: Vec::new(),
        };
    }

    #[cfg(target_os = "macos")]
    {
        return HardwareAttestationRuntimeStatus {
            available: true,
            attestation_level: "unknown",
            detail: None,
            platform: "macos",
            distribution: None,
            diagnostics: Vec::new(),
            remediation_steps: Vec::new(),
        };
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        HardwareAttestationRuntimeStatus {
            available: true,
            attestation_level: "unknown",
            detail: None,
            platform: "unknown",
            distribution: None,
            diagnostics: Vec::new(),
            remediation_steps: Vec::new(),
        }
    }
}

pub fn run_hardware_attestation_runtime_check() -> HardwareAttestationRuntimeStatus {
    #[cfg(target_os = "linux")]
    {
        let available = probe_linux_tpm_runtime(true);
        let diagnostics = linux_tpm_diagnostics();
        let remediation_steps = linux_tpm_remediation_steps(available, &diagnostics);
        return HardwareAttestationRuntimeStatus {
            available,
            attestation_level: if available {
                "tpm"
            } else {
                "software_fingerprint"
            },
            detail: linux_tpm_last_error(),
            platform: "linux",
            distribution: linux_distribution_name(),
            diagnostics,
            remediation_steps,
        };
    }

    #[cfg(target_os = "windows")]
    {
        return HardwareAttestationRuntimeStatus {
            available: true,
            attestation_level: "unknown",
            detail: None,
            platform: "windows",
            distribution: None,
            diagnostics: Vec::new(),
            remediation_steps: Vec::new(),
        };
    }

    #[cfg(target_os = "macos")]
    {
        return HardwareAttestationRuntimeStatus {
            available: true,
            attestation_level: "unknown",
            detail: None,
            platform: "macos",
            distribution: None,
            diagnostics: Vec::new(),
            remediation_steps: Vec::new(),
        };
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        HardwareAttestationRuntimeStatus {
            available: true,
            attestation_level: "unknown",
            detail: None,
            platform: "unknown",
            distribution: None,
            diagnostics: Vec::new(),
            remediation_steps: Vec::new(),
        }
    }
}

#[cfg(target_os = "linux")]
fn probe_linux_tpm_runtime(force: bool) -> bool {
    if force {
        LINUX_TPM_RUNTIME_USABLE.store(LINUX_TPM_USABLE_UNKNOWN, Ordering::SeqCst);
    }

    match LINUX_TPM_RUNTIME_USABLE.load(Ordering::SeqCst) {
        LINUX_TPM_USABLE_YES => return true,
        LINUX_TPM_USABLE_NO => return false,
        _ => {}
    }

    #[cfg(not(feature = "linux-tpm-attestation"))]
    {
        LINUX_TPM_RUNTIME_USABLE.store(LINUX_TPM_USABLE_NO, Ordering::SeqCst);
        linux_tpm_set_last_error(Some(
            "linux-tpm-attestation feature is disabled in this build".to_string(),
        ));
        tracing::warn!(
            "linux-tpm-attestation feature is disabled; hardware attestation will remain in software mode"
        );
        return false;
    }

    #[cfg(feature = "linux-tpm-attestation")]
    {
        let probe_nonce = b"fusou-tpm-preflight";
        match tpm_linux::collect_tpm_attestation(probe_nonce) {
            Ok(_) => {
                LINUX_TPM_RUNTIME_USABLE.store(LINUX_TPM_USABLE_YES, Ordering::SeqCst);
                linux_tpm_set_last_error(None);
                tracing::info!("TPM runtime preflight succeeded; hardware attestation is available");
                true
            }
            Err(err) => {
                LINUX_TPM_RUNTIME_USABLE.store(LINUX_TPM_USABLE_NO, Ordering::SeqCst);
                linux_tpm_set_last_error(Some(err.clone()));
                tracing::warn!(
                    error = %err,
                    "TPM runtime preflight failed; hardware attestation will be downgraded to software mode"
                );
                false
            }
        }
    }
}

pub fn collect_attestation_report(nonce_hint: Option<&str>) -> serde_json::Value {
    let nonce = nonce_hint.unwrap_or_default().as_bytes();

    config_sync::maybe_schedule_attestation_config_sync();

    #[cfg(target_os = "windows")]
    if let Ok((attestation_data, attestation_signature, public_key)) =
        tpm_windows::collect_tpm_attestation(nonce)
    {
        let tpm_certificate_chain = resolve_tpm_ak_certificate_chain_b64();
        let mut report = json!({
            "attestation_level": "tpm",
            "attestation_data": B64.encode(attestation_data),
            "attestation_signature": B64.encode(attestation_signature),
            "attestation_format": "tpm2_quote_rsassa_sha256_v1",
            "public_key": B64.encode(public_key),
            "fingerprint": fingerprint::collect_fingerprint(),
            "environment": environment_check::detect_environment(),
        });
        if !tpm_certificate_chain.is_empty() {
            report["certificate_chain"] = json!(tpm_certificate_chain);
        }
        return report;
    }

    #[cfg(target_os = "linux")]
    {
        if probe_linux_tpm_runtime(false) {
            if let Ok((attestation_data, attestation_signature, public_key)) =
                tpm_linux::collect_tpm_attestation(nonce)
            {
                let tpm_certificate_chain = resolve_tpm_ak_certificate_chain_b64();
                let mut report = json!({
                    "attestation_level": "tpm",
                    "attestation_data": B64.encode(attestation_data),
                    "attestation_signature": B64.encode(attestation_signature),
                    "attestation_format": "tpm2_quote_rsassa_sha256_v1",
                    "public_key": B64.encode(public_key),
                    "fingerprint": fingerprint::collect_fingerprint(),
                    "environment": environment_check::detect_environment(),
                });
                if !tpm_certificate_chain.is_empty() {
                    report["certificate_chain"] = json!(tpm_certificate_chain);
                }
                return report;
            }

            LINUX_TPM_RUNTIME_USABLE.store(LINUX_TPM_USABLE_NO, Ordering::SeqCst);
            linux_tpm_set_last_error(Some(
                "TPM quote failed during attestation collection".to_string(),
            ));
            tracing::warn!(
                "TPM attestation failed at report collection time; disabling further TPM attempts for this process"
            );
        }
    }

    #[cfg(target_os = "macos")]
    if let Ok(attestation) = secure_enclave_macos::collect_enclave_attestation(nonce) {
        return json!({
            "attestation_level": "secure_enclave",
            "attestation_data": B64.encode(attestation.attestation_data),
            "attestation_signature": B64.encode(attestation.attestation_signature),
            "public_key": B64.encode(attestation.public_key),
            "certificate_chain": attestation
                .certificate_chain
                .iter()
                .map(|certificate| B64.encode(certificate))
                .collect::<Vec<String>>(),
            "attestation_format": attestation.attestation_format,
            "fingerprint": fingerprint::collect_fingerprint(),
            "environment": environment_check::detect_environment(),
        });
    }

    build_software_report()
}

pub fn collect_upload_attestation_report(nonce: &str) -> serde_json::Value {
    collect_attestation_report(Some(nonce))
}

#[cfg(target_os = "linux")]
fn linux_tpm_set_last_error(message: Option<String>) {
    if let Ok(mut guard) = LINUX_TPM_RUNTIME_LAST_ERROR.lock() {
        *guard = message;
    }
}

#[cfg(target_os = "linux")]
fn linux_tpm_last_error() -> Option<String> {
    LINUX_TPM_RUNTIME_LAST_ERROR
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

#[cfg(target_os = "linux")]
fn linux_tpm_diagnostics() -> Vec<String> {
    let mut diagnostics = Vec::new();

    let username = std::env::var("USER").unwrap_or_else(|_| "unknown".to_string());
    diagnostics.push(format!("user={username}"));

    let current_groups = command_stdout("id", &["-nG"]).unwrap_or_else(|| "unknown".to_string());
    diagnostics.push(format!("current_session_groups={current_groups}"));

    let tss_group = command_stdout("getent", &["group", "tss"]).unwrap_or_else(|| "missing".to_string());
    diagnostics.push(format!("system_tss_group={tss_group}"));

    let can_open_tpmrm = OpenOptions::new()
        .read(true)
        .write(true)
        .open("/dev/tpmrm0")
        .is_ok();
    diagnostics.push(format!("open_/dev/tpmrm0={can_open_tpmrm}"));

    diagnostics
}

#[cfg(target_os = "linux")]
fn linux_distribution_name() -> Option<String> {
    let content = std::fs::read_to_string("/etc/os-release").ok()?;
    for line in content.lines() {
        if let Some(raw) = line.strip_prefix("PRETTY_NAME=") {
            return Some(raw.trim_matches('"').to_string());
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn linux_tpm_remediation_steps(available: bool, diagnostics: &[String]) -> Vec<String> {
    if available {
        return vec!["TPM is usable in the current session.".to_string()];
    }

    let mut steps = Vec::new();
    let current_groups = diagnostics
        .iter()
        .find_map(|line| line.strip_prefix("current_session_groups="))
        .unwrap_or_default();
    let tss_group = diagnostics
        .iter()
        .find_map(|line| line.strip_prefix("system_tss_group="))
        .unwrap_or_default();
    let username = diagnostics
        .iter()
        .find_map(|line| line.strip_prefix("user="))
        .unwrap_or("$USER");

    if !current_groups.split_whitespace().any(|g| g == "tss") {
        if !tss_group.contains(username) {
            steps.push(format!(
                "Run: sudo usermod -aG tss {username}"
            ));
        }
        steps.push("Log out and log back in (or reboot) so new group membership is applied to the desktop/app session.".to_string());
    }

    steps.push("After re-login, open FUSOU-APP Settings and press 'Run TPM Check'.".to_string());
    steps.push("If still unavailable, verify /dev/tpmrm0 exists and tpm2-tss runtime packages are installed.".to_string());

    steps
}

#[cfg(target_os = "linux")]
fn command_stdout(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    Some(text.trim().to_string())
}

pub fn runtime_preflight_warnings() -> Vec<AttestationPreflightWarning> {
    let mut warnings = Vec::new();

    #[cfg(target_os = "linux")]
    collect_linux_preflight_warnings(&mut warnings);

    #[cfg(target_os = "windows")]
    collect_windows_preflight_warnings(&mut warnings);

    #[cfg(target_os = "macos")]
    collect_macos_preflight_warnings(&mut warnings);

    warnings
}

#[cfg(target_os = "linux")]
fn collect_linux_preflight_warnings(warnings: &mut Vec<AttestationPreflightWarning>) {
    use std::fs::OpenOptions;
    use std::path::Path;
    use std::process::Command;

    let tpmrm_path = Path::new("/dev/tpmrm0");
    let tpm_path = Path::new("/dev/tpm0");
    let has_tpm_device = tpmrm_path.exists() || tpm_path.exists();
    let feature_enabled = cfg!(feature = "linux-tpm-attestation");

    if has_tpm_device && !feature_enabled {
        warnings.push(AttestationPreflightWarning {
            code: "linux_feature_disabled",
            message: "TPM device was detected, but this app build has linux-tpm-attestation disabled. Hardware attestation will be downgraded to software mode.".to_string(),
        });
    }

    if !feature_enabled {
        return;
    }

    if let Some(message) = validate_persistent_handle_env() {
        warnings.push(AttestationPreflightWarning {
            code: "linux_persistent_handle_invalid",
            message,
        });
    }

    if let Some(message) = validate_tpm_ak_cert_chain_env() {
        warnings.push(AttestationPreflightWarning {
            code: "linux_tpm_ak_cert_chain_invalid",
            message,
        });
    }

    if !has_explicit_tpm_ak_certificate_chain_env() && !config_sync::has_cached_tpm_ak_chain() {
        warnings.push(AttestationPreflightWarning {
            code: "linux_tpm_ak_cert_chain_missing",
            message: format!(
                "Neither {TPM_AK_CERT_CHAIN_B64_ENV} nor synced attestation config provides tpm.ak_cert_chain_b64. Hardware trust may be downgraded."
            ),
        });
    }

    if has_tpm_device {
        let preferred = if tpmrm_path.exists() { tpmrm_path } else { tpm_path };
        let can_open = OpenOptions::new().read(true).write(true).open(preferred).is_ok();
        if !can_open {
            warnings.push(AttestationPreflightWarning {
                code: "linux_tpm_permission",
                message: format!(
                    "TPM device {} is present but cannot be opened read/write. Check device permissions (for example tss group membership).",
                    preferred.display()
                ),
            });
        }
    }

    let pkg_config_exists = Command::new("pkg-config")
        .arg("--version")
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if !pkg_config_exists {
        warnings.push(AttestationPreflightWarning {
            code: "linux_pkg_config_missing",
            message: "pkg-config is not available; cannot verify tpm2-tss runtime dependencies automatically.".to_string(),
        });
        return;
    }

    let required = ["tss2-sys", "tss2-esys", "tss2-tctildr"];
    let missing: Vec<&str> = required
        .iter()
        .copied()
        .filter(|name| {
            !Command::new("pkg-config")
                .arg("--exists")
                .arg(name)
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        })
        .collect();

    if !missing.is_empty() {
        warnings.push(AttestationPreflightWarning {
            code: "linux_tpm2_tss_missing",
            message: format!(
                "Missing tpm2-tss development/runtime packages detected by pkg-config: {}.",
                missing.join(", ")
            ),
        });
    }
}

#[cfg(target_os = "windows")]
fn collect_windows_preflight_warnings(warnings: &mut Vec<AttestationPreflightWarning>) {
    let feature_enabled = cfg!(feature = "windows-tpm-attestation");

    if !feature_enabled {
        warnings.push(AttestationPreflightWarning {
            code: "windows_feature_disabled",
            message: "This app build has windows-tpm-attestation disabled. Hardware attestation will be downgraded to software mode.".to_string(),
        });
        return;
    }

    if let Some(message) = validate_persistent_handle_env() {
        warnings.push(AttestationPreflightWarning {
            code: "windows_persistent_handle_invalid",
            message,
        });
    }

    if let Some(message) = validate_tpm_ak_cert_chain_env() {
        warnings.push(AttestationPreflightWarning {
            code: "windows_tpm_ak_cert_chain_invalid",
            message,
        });
    }

    if !has_explicit_tpm_ak_certificate_chain_env() && !config_sync::has_cached_tpm_ak_chain() {
        warnings.push(AttestationPreflightWarning {
            code: "windows_tpm_ak_cert_chain_missing",
            message: format!(
                "Neither {TPM_AK_CERT_CHAIN_B64_ENV} nor synced attestation config provides tpm.ak_cert_chain_b64. Hardware trust may be downgraded."
            ),
        });
    }

    // Windows TPM collector now attempts automatic TBS fallback when TCTI
    // environment variables are not configured.
}

#[cfg(target_os = "macos")]
fn collect_macos_preflight_warnings(warnings: &mut Vec<AttestationPreflightWarning>) {
    warnings.push(AttestationPreflightWarning {
        code: "macos_secure_enclave_unimplemented",
        message: "Secure Enclave attestation collector is not implemented in this build yet; attestation may fall back to software mode.".to_string(),
    });
}

fn validate_persistent_handle_env() -> Option<String> {
    let raw = std::env::var(TPM_AK_PERSISTENT_HANDLE_ENV).ok()?;
    let trimmed = raw.trim();

    if trimmed.is_empty() {
        return Some(format!(
            "{TPM_AK_PERSISTENT_HANDLE_ENV} is set but empty. Use a valid TPM persistent handle such as 0x81010001."
        ));
    }

    let parsed = match parse_persistent_handle_value(trimmed) {
        Ok(value) => value,
        Err(_) => {
            return Some(format!(
                "{TPM_AK_PERSISTENT_HANDLE_ENV} has an invalid value '{trimmed}'. Use decimal or 0x-prefixed hexadecimal format."
            ));
        }
    };

    if (parsed >> 24) != 0x81 {
        return Some(format!(
            "{TPM_AK_PERSISTENT_HANDLE_ENV} value '{trimmed}' is outside the TPM persistent-handle range. Use a handle starting with 0x81...."
        ));
    }

    None
}

fn parse_persistent_handle_value(value: &str) -> Result<u32, std::num::ParseIntError> {
    if let Some(hex) = value.strip_prefix("0x").or_else(|| value.strip_prefix("0X")) {
        return u32::from_str_radix(hex, 16);
    }

    value.parse::<u32>()
}

fn has_explicit_tpm_ak_certificate_chain_env() -> bool {
    match std::env::var(TPM_AK_CERT_CHAIN_B64_ENV) {
        Ok(value) => !value.trim().is_empty(),
        Err(_) => false,
    }
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn resolve_tpm_ak_certificate_chain_b64() -> Vec<String> {
    if let Some(configured) = config_sync::resolve_tpm_chain_from_cached_config() {
        if !configured.is_empty() {
            return configured;
        }
    }

    let configured = collect_tpm_ak_certificate_chain_b64();
    if !configured.is_empty() {
        return configured;
    }

    Vec::new()
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn resolve_tpm_ak_certificate_chain_b64() -> Vec<String> {
    collect_tpm_ak_certificate_chain_b64()
}

fn collect_tpm_ak_certificate_chain_b64() -> Vec<String> {
    let raw = match std::env::var(TPM_AK_CERT_CHAIN_B64_ENV) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    parse_tpm_cert_chain_entries(raw.trim()).unwrap_or_default()
}

fn validate_tpm_ak_cert_chain_env() -> Option<String> {
    let raw = std::env::var(TPM_AK_CERT_CHAIN_B64_ENV).ok()?;
    let parsed = match parse_tpm_cert_chain_entries(raw.trim()) {
        Ok(entries) => entries,
        Err(message) => return Some(message),
    };

    if parsed.len() < 2 {
        return Some(format!(
            "{TPM_AK_CERT_CHAIN_B64_ENV} should contain at least leaf and root certificates (2+ entries)."
        ));
    }

    for (index, cert_b64) in parsed.iter().enumerate() {
        if B64.decode(cert_b64).is_err() {
            return Some(format!(
                "{TPM_AK_CERT_CHAIN_B64_ENV} entry #{index} is not valid base64 DER certificate data."
            ));
        }
    }

    None
}

fn parse_tpm_cert_chain_entries(value: &str) -> Result<Vec<String>, String> {
    if value.is_empty() {
        return Err(format!(
            "{TPM_AK_CERT_CHAIN_B64_ENV} is set but empty. Use a JSON array or comma-separated base64 certificates."
        ));
    }

    if value.starts_with('[') {
        let parsed: serde_json::Value = serde_json::from_str(value).map_err(|err| {
            format!(
                "{TPM_AK_CERT_CHAIN_B64_ENV} JSON parsing failed: {err}. Expected JSON string array."
            )
        })?;

        let Some(items) = parsed.as_array() else {
            return Err(format!(
                "{TPM_AK_CERT_CHAIN_B64_ENV} must be a JSON array of base64 certificate strings."
            ));
        };

        let values: Vec<String> = items
            .iter()
            .filter_map(|item| item.as_str().map(|s| s.trim().to_string()))
            .filter(|item| !item.is_empty())
            .collect();
        if values.is_empty() {
            return Err(format!(
                "{TPM_AK_CERT_CHAIN_B64_ENV} JSON array does not contain any non-empty certificate strings."
            ));
        }
        return Ok(values);
    }

    let values: Vec<String> = value
        .split(|ch: char| ch == ',' || ch == ';' || ch.is_whitespace())
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
        .collect();

    if values.is_empty() {
        return Err(format!(
            "{TPM_AK_CERT_CHAIN_B64_ENV} does not contain any certificate values."
        ));
    }

    Ok(values)
}
