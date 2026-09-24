use proxy_https::production_tlsn::RuntimeIdentity;
use serde::Deserialize;
use std::time::Duration;
use url::Url;

const GIT_COMMIT_SHA_LENGTH: usize = 40;

#[derive(Debug, Deserialize)]
struct WorkerHealth {
    ok: bool,
    environment: String,
    deployment_role: String,
    git_commit_sha: Option<String>,
    deployment_id: Option<String>,
    runtime_version: Option<WorkerRuntimeVersion>,
    security_identity: WorkerSecurityIdentity,
    deployment_identity: WorkerDeploymentIdentity,
}

#[derive(Debug, Deserialize)]
struct WorkerRuntimeVersion {
    version_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WorkerSecurityIdentity {
    git_commit_sha: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WorkerDeploymentIdentity {
    deployment_id: Option<String>,
    deployment_role: Option<String>,
    binding_mode: Option<String>,
    worker_name: Option<String>,
}

pub async fn fetch_and_validate(
    endpoint: &str,
    expected_deployment_id: &str,
    expected_worker_name: &str,
    expected_git_commit_sha: &str,
    expected_binding_mode: &str,
) -> Result<RuntimeIdentity, String> {
    validate_health_endpoint(endpoint)?;
    validate_expected_identity(
        expected_deployment_id,
        expected_worker_name,
        expected_git_commit_sha,
        expected_binding_mode,
    )?;

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("failed to build TLSN runtime attestation client: {error}"))?;
    let response = client
        .get(endpoint)
        .send()
        .await
        .map_err(|error| format!("TLSN runtime attestation request failed: {error}"))?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(format!(
            "TLSN runtime attestation returned HTTP {}",
            response.status()
        ));
    }
    let health = response
        .json::<WorkerHealth>()
        .await
        .map_err(|error| format!("TLSN runtime attestation JSON is invalid: {error}"))?;
    validate_health(
        &health,
        expected_deployment_id,
        expected_worker_name,
        expected_git_commit_sha,
        expected_binding_mode,
    )
}

fn validate_health_endpoint(endpoint: &str) -> Result<(), String> {
    let parsed = Url::parse(endpoint)
        .map_err(|_| "TLSN runtime attestation endpoint is invalid".to_owned())?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.path() != "/health"
    {
        return Err(
            "TLSN runtime attestation endpoint must be an HTTPS /health URL without query or credentials"
                .to_owned(),
        );
    }
    Ok(())
}

fn validate_expected_identity(
    deployment_id: &str,
    worker_name: &str,
    git_commit_sha: &str,
    binding_mode: &str,
) -> Result<(), String> {
    if deployment_id.trim().is_empty() || worker_name.trim().is_empty() {
        return Err("TLSN runtime attestation expected identity is incomplete".to_owned());
    }
    if git_commit_sha.len() != GIT_COMMIT_SHA_LENGTH
        || !git_commit_sha.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("TLSN runtime attestation expected Git SHA is invalid".to_owned());
    }
    if binding_mode != "fixed_canary" {
        return Err(
            "TLSN runtime attestation expected binding mode must be fixed_canary".to_owned(),
        );
    }
    Ok(())
}

fn validate_health(
    health: &WorkerHealth,
    expected_deployment_id: &str,
    expected_worker_name: &str,
    expected_git_commit_sha: &str,
    expected_binding_mode: &str,
) -> Result<RuntimeIdentity, String> {
    validate_expected_identity(
        expected_deployment_id,
        expected_worker_name,
        expected_git_commit_sha,
        expected_binding_mode,
    )?;
    if !health.ok || health.environment != "production" || health.deployment_role != "canary" {
        return Err("TLSN runtime attestation is not a production Canary Worker".to_owned());
    }
    let deployment_id = health
        .deployment_id
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "TLSN runtime attestation deployment ID is missing".to_owned())?;
    let identity = &health.deployment_identity;
    if deployment_id != expected_deployment_id
        || identity.deployment_id.as_deref() != Some(expected_deployment_id)
        || identity.deployment_role.as_deref() != Some("canary")
        || identity.binding_mode.as_deref() != Some(expected_binding_mode)
        || identity.worker_name.as_deref() != Some(expected_worker_name)
    {
        return Err(
            "TLSN runtime attestation deployment identity does not match APP configuration"
                .to_owned(),
        );
    }
    let git_commit_sha = health
        .git_commit_sha
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "TLSN runtime attestation Git SHA is missing".to_owned())?;
    if git_commit_sha != expected_git_commit_sha
        || health.security_identity.git_commit_sha.as_deref() != Some(expected_git_commit_sha)
    {
        return Err("TLSN runtime attestation Git SHA does not match APP configuration".to_owned());
    }
    let runtime_version_id = health
        .runtime_version
        .as_ref()
        .and_then(|version| version.version_id.as_deref())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "TLSN runtime attestation Cloudflare version ID is missing".to_owned())?;

    Ok(RuntimeIdentity::new(
        expected_deployment_id.to_owned(),
        expected_worker_name.to_owned(),
        expected_git_commit_sha.to_owned(),
        expected_binding_mode.to_owned(),
        runtime_version_id.to_owned(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn health() -> WorkerHealth {
        serde_json::from_value(serde_json::json!({
            "ok": true,
            "environment": "production",
            "deployment_role": "canary",
            "git_commit_sha": "0123456789abcdef0123456789abcdef01234567",
            "deployment_id": "canary-2026",
            "runtime_version": { "version_id": "cf-version-1" },
            "security_identity": { "git_commit_sha": "0123456789abcdef0123456789abcdef01234567" },
            "deployment_identity": {
                "deployment_id": "canary-2026",
                "deployment_role": "canary",
                "binding_mode": "fixed_canary",
                "worker_name": "fusou-tlsn-verification-canary"
            }
        }))
        .expect("health fixture")
    }

    #[test]
    fn health_identity_must_match_expected_canary() {
        let identity = validate_health(
            &health(),
            "canary-2026",
            "fusou-tlsn-verification-canary",
            "0123456789abcdef0123456789abcdef01234567",
            "fixed_canary",
        )
        .expect("matching health identity");
        assert_eq!(identity.deployment_id(), "canary-2026");
        assert_eq!(identity.runtime_version_id(), "cf-version-1");
    }

    #[test]
    fn health_identity_rejects_wrong_deployment() {
        let error = validate_health(
            &health(),
            "different-canary",
            "fusou-tlsn-verification-canary",
            "0123456789abcdef0123456789abcdef01234567",
            "fixed_canary",
        )
        .expect_err("wrong deployment must fail");
        assert!(error.contains("deployment identity"));
    }

    #[test]
    fn health_identity_rejects_wrong_role() {
        let mut value = health();
        value.deployment_role = "production".to_owned();
        let error = validate_health(
            &value,
            "canary-2026",
            "fusou-tlsn-verification-canary",
            "0123456789abcdef0123456789abcdef01234567",
            "fixed_canary",
        )
        .expect_err("wrong role must fail");
        assert!(error.contains("production Canary"));
    }

    #[test]
    fn health_identity_rejects_wrong_git_sha() {
        let mut value = health();
        value.security_identity.git_commit_sha =
            Some("fedcba9876543210fedcba9876543210fedcba98".to_owned());
        let error = validate_health(
            &value,
            "canary-2026",
            "fusou-tlsn-verification-canary",
            "0123456789abcdef0123456789abcdef01234567",
            "fixed_canary",
        )
        .expect_err("wrong Git SHA must fail");
        assert!(error.contains("Git SHA"));
    }

    #[test]
    fn health_identity_rejects_wrong_binding_mode() {
        let mut value = health();
        value.deployment_identity.binding_mode = Some("random".to_owned());
        let error = validate_health(
            &value,
            "canary-2026",
            "fusou-tlsn-verification-canary",
            "0123456789abcdef0123456789abcdef01234567",
            "fixed_canary",
        )
        .expect_err("wrong binding mode must fail");
        assert!(error.contains("deployment identity"));
    }

    #[test]
    fn health_endpoint_rejects_non_health_urls() {
        assert!(validate_health_endpoint("https://worker.example/attestation/session").is_err());
        assert!(validate_health_endpoint("https://worker.example/health?x=1").is_err());
        assert!(validate_health_endpoint("http://worker.example/health").is_err());
        assert!(validate_health_endpoint("https://worker.example/health").is_ok());
    }
}
