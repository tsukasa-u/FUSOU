#![allow(dead_code)]

pub mod tlsn_preflight {
    use crate::tlsn_runtime_config_manifest::VerifiedRuntimeConfigManifest;

    pub struct TlsnPreflightReport;

    pub(crate) fn validate_notary_key_bytes(bytes: &[u8]) -> Result<(), &'static str> {
        crate::tlsn_notary_transport::validate_notary_key_bytes(bytes)
    }

    pub fn run_verified_runtime_preflight(
        _verified: &VerifiedRuntimeConfigManifest,
        _proxy_target: &str,
    ) -> TlsnPreflightReport {
        TlsnPreflightReport
    }
}

#[cfg(not(test))]
#[path = "../../src/tlsn_runtime_config_runtime.rs"]
pub(crate) mod tlsn_runtime_config_runtime;

#[cfg(test)]
pub(crate) mod tlsn_runtime_config_runtime {
    use crate::tlsn_runtime_config_manifest::RuntimeConfigManifestError;
    use std::{
        fs::{self, OpenOptions},
        io::Write,
        path::Path,
    };

    pub(crate) const MAX_MANIFEST_LIFETIME_SECONDS: u64 = 3600;
    pub(crate) const MAX_CLOCK_SKEW_SECONDS: u64 = 30;
    pub(crate) const MAX_WORKER_REFERENCE_AGE_SECONDS: u64 = 600;
    pub(crate) const MAX_MANIFEST_ENVELOPE_BYTES: usize = 65_536;

    pub(crate) fn write_state_atomic_bytes(
        path: &Path,
        bytes: &[u8],
        before_replace: impl FnOnce() -> Result<(), RuntimeConfigManifestError>,
        failure_reason: &'static str,
    ) -> Result<(), RuntimeConfigManifestError> {
        let parent = path.parent().ok_or(RuntimeConfigManifestError::State(
            "state path has no parent directory",
        ))?;
        let temporary = parent.join(format!(
            ".manifest-harness-state-{}.tmp",
            uuid::Uuid::new_v4()
        ));
        let result = (|| {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options
                .open(&temporary)
                .map_err(|_| RuntimeConfigManifestError::State(failure_reason))?;
            file.write_all(bytes)
                .map_err(|_| RuntimeConfigManifestError::State(failure_reason))?;
            file.sync_all()
                .map_err(|_| RuntimeConfigManifestError::State(failure_reason))?;
            drop(file);
            before_replace()?;
            fs::rename(&temporary, path)
                .map_err(|_| RuntimeConfigManifestError::State(failure_reason))?;
            #[cfg(unix)]
            fs::File::open(parent)
                .and_then(|directory| directory.sync_all())
                .map_err(|_| RuntimeConfigManifestError::State(failure_reason))?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }
}

#[path = "../../src/tlsn_runtime_config_manifest.rs"]
pub mod tlsn_runtime_config_manifest;

#[path = "../../src/tlsn_notary_transport.rs"]
pub mod tlsn_notary_transport;

#[path = "../../src/tlsn_capture_readiness.rs"]
mod tlsn_capture_readiness;

#[cfg(all(test, feature = "tlsn-production"))]
#[path = "tlsn_capture_readiness_tests.rs"]
mod tlsn_capture_readiness_tests;
