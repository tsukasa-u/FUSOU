use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::tlsn_preflight::canonical_sha256;
use crate::tlsn_worker_identity::{
    validate_active_version_pin, validate_worker_endpoints, WorkerRole,
};

#[derive(Deserialize)]
struct EntryInputContract {
    schema_version: u8,
    scope: String,
    compile_inputs: Vec<String>,
}

fn contract() -> EntryInputContract {
    serde_json::from_str(include_str!(
        "../../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-worker-entry-input-contract-v1.json"
    ))
    .expect("embedded Worker entry input contract must be valid")
}

pub fn entry_input_sha256(inputs: &BTreeMap<String, String>) -> Result<String, String> {
    let contract = contract();
    if inputs.keys().collect::<Vec<_>>() != contract.compile_inputs.iter().collect::<Vec<_>>()
        || inputs.values().any(|value| value.trim().is_empty())
    {
        return Err(
            "compiled Worker entry inputs are missing or outside the versioned contract".into(),
        );
    }
    Ok(canonical_sha256(&serde_json::json!({
        "schema_version": contract.schema_version,
        "scope": contract.scope,
        "compile_inputs": inputs,
    })))
}

#[derive(Debug, Serialize)]
pub struct CompiledWorkerEntryReport {
    pub schema_version: u8,
    pub scope: &'static str,
    pub entry_input_sha256: String,
    pub worker_source_sha: String,
    pub active_version_id: String,
    pub app_source_sha: String,
    pub build_profile: &'static str,
    pub tlsn_production_feature: bool,
    pub custom_protocol_feature: bool,
    pub authority_status: &'static str,
}

pub fn compiled_worker_entry_report() -> Result<CompiledWorkerEntryReport, String> {
    if !cfg!(feature = "tlsn-production") {
        return Err("APP binary lacks the tlsn-production feature".into());
    }
    let inputs = configs::get_tlsn_compile_inputs()
        .into_iter()
        .map(|(name, value)| {
            value
                .map(|value| (name.to_owned(), value))
                .ok_or_else(|| format!("APP binary lacks compile-time input: {name}"))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let digest = entry_input_sha256(&inputs)?;
    WorkerRole::from_binding_mode(&inputs["FUSOU_TLSN_EXPECTED_BINDING_MODE"])?;
    validate_active_version_pin(&inputs["FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID"])?;
    validate_worker_endpoints(
        &inputs["FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT"],
        &inputs["FUSOU_TLSN_VERIFICATION_ENDPOINT"],
    )?;
    let app_source_sha = option_env!("FUSOU_APP_BUILD_SOURCE_SHA")
        .ok_or("APP binary lacks the independently pinned APP source SHA")?;
    for sha in [
        app_source_sha,
        &inputs["FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA"],
    ] {
        if sha.len() != 40
            || !sha
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err("compiled APP/Worker source SHA is invalid".into());
        }
    }
    Ok(CompiledWorkerEntryReport {
        schema_version: 1,
        scope: "fusou-tlsn-app-compiled-worker-entry-report",
        entry_input_sha256: digest,
        worker_source_sha: inputs["FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA"].clone(),
        active_version_id: inputs["FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID"].clone(),
        app_source_sha: app_source_sha.to_owned(),
        build_profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        tlsn_production_feature: true,
        custom_protocol_feature: cfg!(feature = "custom-protocol"),
        authority_status: "UNVERIFIED",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versioned_entry_digest_binds_every_raw_compile_input_including_active_version() {
        let mut inputs: BTreeMap<_, _> = contract()
            .compile_inputs
            .into_iter()
            .map(|name| (name, "public-test-value".to_owned()))
            .collect();
        let baseline = entry_input_sha256(&inputs).unwrap();
        assert_eq!(baseline, "_0KHF_YcD35cRC8zFZ_tGhkAkWEg5aNXMCd8vWfAa-0");
        for name in inputs.keys().cloned().collect::<Vec<_>>() {
            let mut changed = inputs.clone();
            changed.get_mut(&name).unwrap().push('\n');
            assert_ne!(entry_input_sha256(&changed).unwrap(), baseline, "{name}");
            changed.remove(&name);
            assert!(entry_input_sha256(&changed).is_err(), "{name}");
        }
        inputs.insert("UNREVIEWED_INPUT".into(), "value".into());
        assert!(entry_input_sha256(&inputs).is_err());
        assert!(entry_input_sha256(&BTreeMap::new()).is_err());
    }
}
