use crate::tlsn_worker_identity::{
    health_http_client, validate_active_version_pin, validate_worker_endpoints, WorkerRole,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use proxy_https::production_tlsn::WorkerHealthObservation;
use serde::Deserialize;
use sha2::{Digest, Sha256};

const GIT_COMMIT_SHA_LENGTH: usize = 40;

#[derive(Debug, Deserialize)]
struct WorkerHealth {
    schema_version: Option<u8>,
    ok: bool,
    environment: String,
    deployment_role: Option<String>,
    binding_mode: Option<String>,
    git_commit_sha: Option<String>,
    deployment_id: Option<String>,
    runtime_version: Option<WorkerRuntimeVersion>,
    security_identity: WorkerSecurityIdentity,
    deployment_identity: WorkerDeploymentIdentity,
    result_public_key_spki: Option<String>,
    result_identity: WorkerResultIdentity,
}

#[derive(Debug, Deserialize)]
struct WorkerRuntimeVersion {
    version_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WorkerSecurityIdentity {
    git_commit_sha: Option<String>,
    trust_contract_valid: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct WorkerDeploymentIdentity {
    deployment_id: Option<String>,
    deployment_role: Option<String>,
    binding_mode: Option<String>,
    worker_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WorkerResultIdentity {
    result_public_key_spki: Option<String>,
    result_signer_key_id: Option<String>,
    result_key_registry_sha256: Option<String>,
}

#[derive(Clone, Copy)]
pub struct ExpectedWorkerIdentity<'a> {
    pub health_endpoint: &'a str,
    pub verification_endpoint: &'a str,
    pub deployment_id: &'a str,
    pub worker_name: &'a str,
    pub git_commit_sha: &'a str,
    pub binding_mode: &'a str,
    pub active_version_id: &'a str,
    pub result_public_key_spki: &'a str,
    pub result_signer_key_id: &'a str,
    pub result_key_registry: &'a str,
}

impl ExpectedWorkerIdentity<'_> {
    fn validate(&self) -> Result<WorkerRole, String> {
        for value in [
            self.deployment_id,
            self.worker_name,
            self.result_public_key_spki,
            self.result_signer_key_id,
            self.result_key_registry,
        ] {
            if value.trim().is_empty() {
                return Err(
                    "TLSN expected Worker deployment/Result identity is incomplete".to_owned(),
                );
            }
        }
        if self.git_commit_sha.len() != GIT_COMMIT_SHA_LENGTH
            || !self
                .git_commit_sha
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("TLSN expected Worker Git SHA is invalid".to_owned());
        }
        validate_active_version_pin(self.active_version_id)?;
        validate_worker_endpoints(self.health_endpoint, self.verification_endpoint)?;
        WorkerRole::from_binding_mode(self.binding_mode)
    }
}

pub async fn fetch_and_validate_health_observation(
    expected: &ExpectedWorkerIdentity<'_>,
) -> Result<WorkerHealthObservation, String> {
    expected.validate()?;
    let client = health_http_client()
        .map_err(|error| format!("failed to build TLSN Worker health client: {error}"))?;
    let response = client
        .get(expected.health_endpoint)
        .send()
        .await
        .map_err(|error| format!("TLSN Worker health request failed: {error}"))?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(format!(
            "TLSN Worker health observation returned HTTP {}",
            response.status()
        ));
    }
    let health = response
        .json::<WorkerHealth>()
        .await
        .map_err(|error| format!("TLSN Worker health JSON is invalid: {error}"))?;
    validate_worker_health(&health, expected)
}

fn validate_worker_health(
    health: &WorkerHealth,
    expected: &ExpectedWorkerIdentity<'_>,
) -> Result<WorkerHealthObservation, String> {
    let role = expected.validate()?;
    if health.schema_version != Some(3)
        || !health.ok
        || health.security_identity.trust_contract_valid != Some(true)
    {
        return Err("TLSN health schema or runtime trust contract is invalid".to_owned());
    }
    if health.environment != "production"
        || health.deployment_role.as_deref() != Some(role.as_str())
    {
        return Err(match role {
            WorkerRole::Canary => {
                "TLSN health observation is not the expected production Canary Worker"
            }
            WorkerRole::Production => {
                "TLSN health observation is not the expected production Worker"
            }
        }
        .to_owned());
    }
    if health.binding_mode.as_deref() != Some(expected.binding_mode) {
        return Err("TLSN health root role/binding pair mismatch".to_owned());
    }
    let deployment_id = health
        .deployment_id
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "TLSN health observation deployment ID is missing".to_owned())?;
    let identity = &health.deployment_identity;
    if deployment_id != expected.deployment_id
        || identity.deployment_id.as_deref() != Some(expected.deployment_id)
        || identity.deployment_role.as_deref() != Some(role.as_str())
        || identity.binding_mode.as_deref() != Some(expected.binding_mode)
        || identity.worker_name.as_deref() != Some(expected.worker_name)
    {
        return Err(
            "TLSN health observation deployment identity does not match APP configuration"
                .to_owned(),
        );
    }
    let git_commit_sha = health
        .git_commit_sha
        .as_deref()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "TLSN health observation Git SHA is missing".to_owned())?;
    if git_commit_sha != expected.git_commit_sha
        || health.security_identity.git_commit_sha.as_deref() != Some(expected.git_commit_sha)
    {
        return Err("TLSN health observation Git SHA does not match APP configuration".to_owned());
    }
    let runtime_version_id = health
        .runtime_version
        .as_ref()
        .and_then(|version| version.version_id.as_deref())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "TLSN health observation Cloudflare version ID is missing".to_owned())?;
    if runtime_version_id != expected.active_version_id {
        return Err(
            "TLSN health version does not match the independent active-version pin".to_owned(),
        );
    }

    let expected_registry_sha256 =
        URL_SAFE_NO_PAD.encode(Sha256::digest(expected.result_key_registry.as_bytes()));
    if health.result_public_key_spki.as_deref() != Some(expected.result_public_key_spki)
        || health.result_identity.result_public_key_spki.as_deref()
            != Some(expected.result_public_key_spki)
        || health.result_identity.result_signer_key_id.as_deref()
            != Some(expected.result_signer_key_id)
        || health.result_identity.result_key_registry_sha256.as_deref()
            != Some(expected_registry_sha256.as_str())
    {
        return Err(
            "TLSN health Result signer observation does not match APP compile-time configuration"
                .to_owned(),
        );
    }

    Ok(WorkerHealthObservation::new(
        expected.deployment_id.to_owned(),
        expected.worker_name.to_owned(),
        expected.git_commit_sha.to_owned(),
        expected.binding_mode.to_owned(),
        runtime_version_id.to_owned(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const VERSION: &str = "4b064508-1cdb-453c-826b-bdea36a8b1e5";

    fn expected(mode: &str) -> ExpectedWorkerIdentity<'_> {
        let production = mode == "random";
        ExpectedWorkerIdentity {
            health_endpoint: if production {
                "https://production-worker.example/health"
            } else {
                "https://worker.example/health"
            },
            verification_endpoint: if production {
                "https://production-worker.example/verify/tlsn"
            } else {
                "https://worker.example/verify/tlsn"
            },
            deployment_id: if production {
                "production-2026"
            } else {
                "canary-2026"
            },
            worker_name: if production {
                "fusou-tlsn-verification-production"
            } else {
                "fusou-tlsn-verification-canary"
            },
            git_commit_sha: "0123456789abcdef0123456789abcdef01234567",
            binding_mode: mode,
            active_version_id: VERSION,
            result_public_key_spki: if production {
                "production-result-public-key-spki"
            } else {
                "result-public-key-spki"
            },
            result_signer_key_id: if production {
                "result-production-2026"
            } else {
                "result-canary-2026"
            },
            result_key_registry: if production {
                "production-result-registry"
            } else {
                "result-registry"
            },
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn validate_health(
        health: &WorkerHealth,
        deployment_id: &str,
        worker_name: &str,
        git_commit_sha: &str,
        binding_mode: &str,
        result_public_key_spki: &str,
        result_signer_key_id: &str,
        result_key_registry: &str,
    ) -> Result<WorkerHealthObservation, String> {
        validate_worker_health(
            health,
            &ExpectedWorkerIdentity {
                deployment_id,
                worker_name,
                git_commit_sha,
                binding_mode,
                result_public_key_spki,
                result_signer_key_id,
                result_key_registry,
                ..expected(binding_mode)
            },
        )
    }

    fn validate_health_endpoint(endpoint: &str) -> Result<(), String> {
        validate_worker_endpoints(endpoint, "https://worker.example/verify/tlsn")
    }

    fn health() -> WorkerHealth {
        serde_json::from_value(serde_json::json!({
            "schema_version": 3,
            "ok": true,
            "environment": "production",
            "deployment_role": "canary",
            "binding_mode": "fixed_canary",
            "git_commit_sha": "0123456789abcdef0123456789abcdef01234567",
            "deployment_id": "canary-2026",
            "runtime_version": { "version_id": VERSION },
            "security_identity": { "git_commit_sha": "0123456789abcdef0123456789abcdef01234567", "trust_contract_valid": true },
            "deployment_identity": {
                "deployment_id": "canary-2026",
                "deployment_role": "canary",
                "binding_mode": "fixed_canary",
                "worker_name": "fusou-tlsn-verification-canary"
            },
            "result_public_key_spki": "result-public-key-spki",
            "result_identity": {
                "result_public_key_spki": "result-public-key-spki",
                "result_signer_key_id": "result-canary-2026",
                "result_key_registry_sha256": URL_SAFE_NO_PAD.encode(Sha256::digest(b"result-registry"))
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
            "result-public-key-spki",
            "result-canary-2026",
            "result-registry",
        )
        .expect("matching health identity");
        assert_eq!(identity.deployment_id(), "canary-2026");
        assert_eq!(identity.runtime_version_id(), VERSION);
    }

    #[test]
    fn health_result_identity_rejects_signer_key_substitution() {
        let mut value = health();
        value.result_identity.result_signer_key_id = Some("substituted-key".to_owned());
        let error = validate_health(
            &value,
            "canary-2026",
            "fusou-tlsn-verification-canary",
            "0123456789abcdef0123456789abcdef01234567",
            "fixed_canary",
            "result-public-key-spki",
            "result-canary-2026",
            "result-registry",
        )
        .expect_err("substituted signer key must fail");
        assert!(error.contains("Result signer observation"));
    }

    #[test]
    fn health_result_identity_rejects_registry_substitution() {
        let error = validate_health(
            &health(),
            "canary-2026",
            "fusou-tlsn-verification-canary",
            "0123456789abcdef0123456789abcdef01234567",
            "fixed_canary",
            "result-public-key-spki",
            "result-canary-2026",
            "substituted-result-registry",
        )
        .expect_err("substituted registry must fail");
        assert!(error.contains("Result signer observation"));
    }

    #[test]
    fn health_identity_rejects_wrong_deployment() {
        let error = validate_health(
            &health(),
            "different-canary",
            "fusou-tlsn-verification-canary",
            "0123456789abcdef0123456789abcdef01234567",
            "fixed_canary",
            "result-public-key-spki",
            "result-canary-2026",
            "result-registry",
        )
        .expect_err("wrong deployment must fail");
        assert!(error.contains("deployment identity"));
    }

    #[test]
    fn health_identity_rejects_wrong_role() {
        let mut value = health();
        value.deployment_role = Some("production".to_owned());
        let error = validate_health(
            &value,
            "canary-2026",
            "fusou-tlsn-verification-canary",
            "0123456789abcdef0123456789abcdef01234567",
            "fixed_canary",
            "result-public-key-spki",
            "result-canary-2026",
            "result-registry",
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
            "result-public-key-spki",
            "result-canary-2026",
            "result-registry",
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
            "result-public-key-spki",
            "result-canary-2026",
            "result-registry",
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

    fn health_for(expected: &ExpectedWorkerIdentity<'_>) -> WorkerHealth {
        let role = WorkerRole::from_binding_mode(expected.binding_mode)
            .unwrap()
            .as_str();
        serde_json::from_value(serde_json::json!({
            "schema_version": 3, "ok": true, "environment": "production",
            "deployment_role": role, "binding_mode": expected.binding_mode,
            "git_commit_sha": expected.git_commit_sha, "deployment_id": expected.deployment_id,
            "runtime_version": { "version_id": VERSION },
            "security_identity": { "git_commit_sha": expected.git_commit_sha, "trust_contract_valid": true },
            "deployment_identity": {
                "deployment_id": expected.deployment_id, "deployment_role": role,
                "binding_mode": expected.binding_mode, "worker_name": expected.worker_name,
            },
            "result_public_key_spki": expected.result_public_key_spki,
            "result_identity": {
                "result_public_key_spki": expected.result_public_key_spki,
                "result_signer_key_id": expected.result_signer_key_id,
                "result_key_registry_sha256": URL_SAFE_NO_PAD.encode(Sha256::digest(expected.result_key_registry.as_bytes())),
            },
        })).unwrap()
    }

    #[test]
    fn both_roles_require_exact_independent_identity_and_reject_substitutions() {
        let mutations: &[(&str, &str, fn(&mut WorkerHealth))] = &[
            ("environment", "expected production", |h| {
                h.environment = "test".to_owned()
            }),
            ("root role", "expected production", |h| {
                h.deployment_role = Some("unrelated".to_owned())
            }),
            ("missing role", "expected production", |h| {
                h.deployment_role = None
            }),
            ("nested role", "deployment identity", |h| {
                h.deployment_identity.deployment_role = Some("unrelated".to_owned())
            }),
            ("missing nested role", "deployment identity", |h| {
                h.deployment_identity.deployment_role = None
            }),
            ("root binding", "role/binding", |h| {
                h.binding_mode = Some("arbitrary".to_owned())
            }),
            ("missing binding", "role/binding", |h| h.binding_mode = None),
            ("nested binding", "deployment identity", |h| {
                h.deployment_identity.binding_mode = Some("arbitrary".to_owned())
            }),
            ("missing nested binding", "deployment identity", |h| {
                h.deployment_identity.binding_mode = None
            }),
            ("root deployment", "deployment identity", |h| {
                h.deployment_id = Some("other".to_owned())
            }),
            ("nested deployment", "deployment identity", |h| {
                h.deployment_identity.deployment_id = Some("other".to_owned())
            }),
            ("Worker name", "deployment identity", |h| {
                h.deployment_identity.worker_name = Some("other".to_owned())
            }),
            ("root Git SHA", "Git SHA", |h| {
                h.git_commit_sha = Some("f".repeat(40))
            }),
            ("nested Git SHA", "Git SHA", |h| {
                h.security_identity.git_commit_sha = Some("f".repeat(40))
            }),
            ("unrelated or stale version", "active-version pin", |h| {
                h.runtime_version.as_mut().unwrap().version_id =
                    Some("5b064508-1cdb-453c-826b-bdea36a8b1e5".to_owned())
            }),
            ("missing version object", "version ID is missing", |h| {
                h.runtime_version = None
            }),
            ("missing version ID", "version ID is missing", |h| {
                h.runtime_version.as_mut().unwrap().version_id = None
            }),
            ("signer", "Result signer observation", |h| {
                h.result_identity.result_signer_key_id = Some("substituted".to_owned())
            }),
            ("root public key", "Result signer observation", |h| {
                h.result_public_key_spki = Some("substituted".to_owned())
            }),
            ("nested public key", "Result signer observation", |h| {
                h.result_identity.result_public_key_spki = Some("substituted".to_owned())
            }),
            ("registry digest", "Result signer observation", |h| {
                h.result_identity.result_key_registry_sha256 = Some("substituted".to_owned())
            }),
            ("invalid trust contract", "runtime trust contract", |h| {
                h.security_identity.trust_contract_valid = Some(false)
            }),
            ("wrong health schema", "health schema", |h| {
                h.schema_version = Some(2)
            }),
        ];
        for mode in ["random", "fixed_canary"] {
            let pin = expected(mode);
            let observed = validate_worker_health(&health_for(&pin), &pin).unwrap();
            assert_eq!(observed.runtime_version_id(), VERSION);
            assert_eq!(observed.binding_mode(), mode);
            for (name, boundary, mutate) in mutations {
                let mut value = health_for(&pin);
                mutate(&mut value);
                let error = validate_worker_health(&value, &pin).expect_err(name);
                assert!(error.contains(boundary), "{mode} {name}: {error}");
            }
            let other = expected(if mode == "random" {
                "fixed_canary"
            } else {
                "random"
            });
            assert!(validate_worker_health(&health_for(&other), &pin)
                .unwrap_err()
                .contains("expected production"));
            let mut invalid_pair = health_for(&pin);
            invalid_pair.binding_mode = Some(other.binding_mode.to_owned());
            invalid_pair.deployment_identity.binding_mode = Some(other.binding_mode.to_owned());
            assert!(validate_worker_health(&invalid_pair, &pin)
                .unwrap_err()
                .contains("role/binding"));
        }
    }

    #[test]
    fn unavailable_or_partial_expectations_never_bootstrap_from_health() {
        let mutations: &[fn(&mut ExpectedWorkerIdentity<'_>)] = &[
            |e| e.active_version_id = "",
            |e| e.deployment_id = "",
            |e| e.worker_name = "",
            |e| e.git_commit_sha = "",
            |e| e.binding_mode = "",
            |e| e.result_public_key_spki = "",
            |e| e.result_signer_key_id = "",
            |e| e.result_key_registry = "",
            |e| e.health_endpoint = "",
            |e| e.verification_endpoint = "",
        ];
        for mode in ["random", "fixed_canary"] {
            let original = expected(mode);
            let value = health_for(&original);
            for mutate in mutations {
                let mut pin = original;
                mutate(&mut pin);
                assert!(validate_worker_health(&value, &pin).is_err());
            }
            let mut rotated = original;
            rotated.active_version_id = "5b064508-1cdb-453c-826b-bdea36a8b1e5";
            assert!(validate_worker_health(&value, &rotated)
                .unwrap_err()
                .contains("active-version pin"));
            let mut new_health = health_for(&rotated);
            new_health.runtime_version.as_mut().unwrap().version_id =
                Some(rotated.active_version_id.to_owned());
            assert!(validate_worker_health(&new_health, &rotated).is_ok());
        }
    }
}
