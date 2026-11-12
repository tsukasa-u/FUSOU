use base64::Engine;
use fusou_tlsn_manifest_verification_harness::tlsn_runtime_config_manifest::{
    verify_runtime_config_manifest, RuntimeConfigIndependentVerificationInputs,
    RuntimeConfigTrustedSigner, RuntimeConfigVerificationPolicy,
};
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Deserialize)]
struct GoldenPolicy {
    now_ms: i64,
    last_accepted_epoch: String,
    last_accepted_manifest_sha256: Option<String>,
    max_lifetime_seconds: u64,
    max_clock_skew_seconds: u64,
    max_reference_age_seconds: u64,
    max_envelope_bytes: usize,
    manifest_url: String,
    last_accepted_manifest_authority_generation: String,
    last_accepted_manifest_authority_delegation_sha256: Option<String>,
}

#[derive(Deserialize)]
struct GoldenCase {
    name: String,
    expected_accept: bool,
    expected_authority_generation: Option<String>,
    expected_epoch: Option<String>,
    #[serde(default)]
    inputs_base64url: BTreeMap<String, String>,
    manifest_envelope_base64url: String,
    trusted_signer: Option<RuntimeConfigTrustedSigner>,
    policy_overrides: serde_json::Value,
}

#[derive(Deserialize)]
struct GoldenVector {
    test_only: bool,
    trusted_signer: RuntimeConfigTrustedSigner,
    policy: GoldenPolicy,
    inputs_base64url: BTreeMap<String, String>,
    vectors: Vec<GoldenCase>,
}

#[test]
fn app_manifest_verifier_matches_shared_delegation_golden_vectors() {
    let vector: GoldenVector = serde_json::from_str(include_str!(
        "../../../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/fixtures/tlsn-runtime-config-manifest-delegation-v1-golden.json"
    ))
    .expect("shared Manifest delegation golden vector parses");
    assert!(vector.test_only);

    for case in vector.vectors {
        let mut input_values = vector.inputs_base64url.clone();
        input_values.extend(case.inputs_base64url.clone());
        let decode_input = |name: &str| {
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(input_values.get(name).expect("fixture input exists"))
                .expect("fixture input uses canonical base64url")
        };
        let worker_reference = decode_input("worker_reference_raw");
        let origin_inventory = decode_input("origin_inventory_raw");
        let target_approval = decode_input("target_approval_raw");
        let security_registry_set = decode_input("security_registry_set_raw");
        let result_registry_envelope = decode_input("result_registry_envelope_raw");
        let independent_inputs = RuntimeConfigIndependentVerificationInputs {
            worker_reference_raw: Some(&worker_reference),
            origin_inventory_raw: Some(&origin_inventory),
            target_approval_raw: Some(&target_approval),
            security_registry_set_raw: Some(&security_registry_set),
            result_registry_envelope_raw: Some(&result_registry_envelope),
        };
        let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(&case.manifest_envelope_base64url)
            .expect("vector envelope uses canonical base64url");
        let policy_override = case.policy_overrides;
        let policy = RuntimeConfigVerificationPolicy {
            now: chrono::DateTime::from_timestamp_millis(
                policy_override
                    .get("now_ms")
                    .and_then(serde_json::Value::as_i64)
                    .unwrap_or(vector.policy.now_ms),
            )
            .expect("vector time is representable"),
            manifest_url: policy_override
                .get("manifest_url")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(&vector.policy.manifest_url)
                .to_owned(),
            last_accepted_epoch: policy_override
                .get("last_accepted_epoch")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(&vector.policy.last_accepted_epoch)
                .to_owned(),
            last_accepted_manifest_sha256: policy_override
                .get("last_accepted_manifest_sha256")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
                .or_else(|| {
                    if policy_override
                        .get("last_accepted_manifest_sha256")
                        .is_some_and(serde_json::Value::is_null)
                    {
                        None
                    } else {
                        vector.policy.last_accepted_manifest_sha256.clone()
                    }
                }),
            last_accepted_manifest_authority_generation: policy_override
                .get("last_accepted_manifest_authority_generation")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(&vector.policy.last_accepted_manifest_authority_generation)
                .to_owned(),
            last_accepted_manifest_authority_delegation_sha256: policy_override
                .get("last_accepted_manifest_authority_delegation_sha256")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
                .or_else(|| {
                    if policy_override
                        .get("last_accepted_manifest_authority_delegation_sha256")
                        .is_some_and(serde_json::Value::is_null)
                    {
                        None
                    } else {
                        vector
                            .policy
                            .last_accepted_manifest_authority_delegation_sha256
                            .clone()
                    }
                }),
            max_lifetime_seconds: vector.policy.max_lifetime_seconds,
            max_clock_skew_seconds: vector.policy.max_clock_skew_seconds,
            max_reference_age_seconds: vector.policy.max_reference_age_seconds,
            max_envelope_bytes: vector.policy.max_envelope_bytes,
        };
        let signer = case.trusted_signer.unwrap_or_else(|| {
            RuntimeConfigTrustedSigner {
                scope: vector.trusted_signer.scope.clone(),
                key_id: vector.trusted_signer.key_id.clone(),
                public_key_spki: vector.trusted_signer.public_key_spki.clone(),
            }
        });
        let result = verify_runtime_config_manifest(
            &raw,
            &signer,
            &policy,
            Some(&independent_inputs),
        );
        assert_eq!(
            result.is_ok(),
            case.expected_accept,
            "{}: APP source verification outcome",
            case.name,
        );
        if case.expected_accept {
            let verified = result.expect("accepted vector returns verified Manifest");
            assert_eq!(verified.authority().envelope_schema_version(), 3);
            assert_eq!(
                verified.authority().delegation_generation(),
                case.expected_authority_generation.as_deref()
            );
            if let Some(expected_epoch) = case.expected_epoch {
                assert_eq!(verified.epoch(), expected_epoch);
            }
            assert!(verified.authority().delegation_sha256().is_some());
            assert!(verified.authority().approved_config_sha256().is_some());
        }
    }
}
