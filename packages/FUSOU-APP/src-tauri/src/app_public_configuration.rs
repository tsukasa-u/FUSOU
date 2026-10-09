use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::tlsn_preflight::canonical_sha256;

#[derive(Deserialize)]
struct PublicConfigurationContract {
    schema_version: u8,
    scope: String,
    compile_inputs: Vec<String>,
    required_inputs: Vec<String>,
}

fn contract() -> PublicConfigurationContract {
    serde_json::from_str(include_str!(
        "../../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-public-configuration-contract-v1.json"
    ))
    .expect("embedded APP public configuration contract must be valid")
}

pub fn public_configuration_sha256(
    inputs: &BTreeMap<String, Option<String>>,
) -> Result<String, String> {
    let contract = contract();
    if inputs.keys().collect::<Vec<_>>() != contract.compile_inputs.iter().collect::<Vec<_>>()
        || contract.required_inputs.iter().any(|name| {
            inputs
                .get(name)
                .and_then(|value| value.as_deref())
                .map_or(true, |value| value.trim().is_empty())
        })
    {
        return Err("compiled APP public configuration lacks required Auth inputs".into());
    }
    Ok(canonical_sha256(&serde_json::json!({
        "schema_version": contract.schema_version,
        "scope": contract.scope,
        "compile_inputs": inputs,
    })))
}

#[derive(Debug, Serialize)]
pub struct CompiledPublicConfigurationReport {
    pub schema_version: u8,
    pub scope: &'static str,
    pub public_app_configuration_sha256: String,
    pub discord_client_id_present: bool,
    pub authority_status: &'static str,
}

pub fn compiled_public_configuration_report() -> Result<CompiledPublicConfigurationReport, String> {
    let (supabase_url, supabase_key) = fusou_auth::manager::compiled_supabase_configuration();
    let discord_id = crate::integration::discord::compiled_discord_client_id();
    let inputs = BTreeMap::from([
        ("DISCORD_CLIENT_ID".into(), discord_id.map(str::to_owned)),
        (
            "PUBLIC_SUPABASE_PUBLISHABLE_KEY".into(),
            supabase_key.map(str::to_owned),
        ),
        (
            "PUBLIC_SUPABASE_URL".into(),
            supabase_url.map(str::to_owned),
        ),
    ]);
    Ok(CompiledPublicConfigurationReport {
        schema_version: 1,
        scope: "fusou-app-compiled-public-configuration-report",
        public_app_configuration_sha256: public_configuration_sha256(&inputs)?,
        discord_client_id_present: discord_id.is_some(),
        authority_status: "UNVERIFIED",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_configuration_requires_auth_and_binds_optional_discord() {
        let vector: serde_json::Value = serde_json::from_str(include_str!(
            "../../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/app-public-configuration-contract-v1.json"
        ))
        .unwrap();
        let mut inputs: BTreeMap<String, Option<String>> =
            serde_json::from_value(vector["test_vector"]["compile_inputs"].clone()).unwrap();
        let baseline = public_configuration_sha256(&inputs).unwrap();
        assert_eq!(baseline, vector["test_vector"]["sha256"].as_str().unwrap());
        for name in contract().required_inputs {
            let mut missing = inputs.clone();
            missing.insert(name.clone(), None);
            assert!(public_configuration_sha256(&missing).is_err());
            let mut changed = inputs.clone();
            changed.insert(name, Some("changed-public-fixture".into()));
            assert_ne!(public_configuration_sha256(&changed).unwrap(), baseline);
        }
        inputs.insert("DISCORD_CLIENT_ID".into(), Some("123456789".into()));
        assert_ne!(public_configuration_sha256(&inputs).unwrap(), baseline);
        inputs.insert("UNAPPROVED_INPUT".into(), None);
        assert!(public_configuration_sha256(&inputs).is_err());
    }
}
