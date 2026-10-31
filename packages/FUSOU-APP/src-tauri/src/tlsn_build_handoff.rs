use serde::Serialize;

use crate::tlsn_runtime_config_manifest::{
    RuntimeConfigBootstrap, RuntimeConfigBootstrapBuildReport,
};

#[derive(Debug, Serialize)]
pub struct CompiledAppBootstrapReport {
    pub schema_version: u8,
    pub scope: &'static str,
    pub app_source_sha: String,
    pub build_profile: &'static str,
    pub tlsn_production_feature: bool,
    pub custom_protocol_feature: bool,
    pub runtime_config_bootstrap: RuntimeConfigBootstrapBuildReport,
    pub authority_status: &'static str,
}

pub fn compiled_app_bootstrap_report() -> Result<CompiledAppBootstrapReport, String> {
    if !cfg!(feature = "tlsn-production") {
        return Err("APP binary lacks the tlsn-production feature".into());
    }
    let app_source_sha = option_env!("FUSOU_APP_BUILD_SOURCE_SHA")
        .ok_or("APP binary lacks the independently pinned APP source SHA")?;
    if app_source_sha.len() != 40
        || !app_source_sha
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("compiled APP source SHA is invalid".into());
    }
    let runtime_config_bootstrap =
        RuntimeConfigBootstrap::compiled_build_report().map_err(|error| error.to_string())?;
    Ok(CompiledAppBootstrapReport {
        schema_version: 1,
        scope: "fusou-tlsn-app-compiled-bootstrap-report-v1",
        app_source_sha: app_source_sha.to_owned(),
        build_profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        tlsn_production_feature: true,
        custom_protocol_feature: cfg!(feature = "custom-protocol"),
        runtime_config_bootstrap,
        authority_status: "UNVERIFIED",
    })
}
