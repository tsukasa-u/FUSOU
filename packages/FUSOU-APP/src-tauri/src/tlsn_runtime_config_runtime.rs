use crate::tlsn_runtime_config_manifest::{
    fetch_and_verify_with_fetcher, parse_epoch, validate_digest, HttpRuntimeConfigObjectFetcher,
    RuntimeConfigBootstrap, RuntimeConfigManifestError, RuntimeConfigObjectFetcher,
    RuntimeConfigVerificationPolicy, VerifiedRuntimeConfigManifest,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::sync::Mutex;

const EPOCH_STATE_SCHEMA_VERSION: u32 = 1;
const EPOCH_STATE_SCOPE: &str = "fusou-tlsn-runtime-config-epoch-state-v1";
const EPOCH_STATE_MAX_BYTES: u64 = 1024;
const MAX_MANIFEST_LIFETIME_SECONDS: u64 = 3600;
const MAX_CLOCK_SKEW_SECONDS: u64 = 30;
const MAX_WORKER_REFERENCE_AGE_SECONDS: u64 = 600;
const MAX_MANIFEST_ENVELOPE_BYTES: usize = 65_536;

#[derive(Clone)]
pub(crate) struct RuntimeConfigManager {
    epoch_state: RuntimeConfigEpochStateStore,
    refresh_lock: Arc<Mutex<()>>,
}

impl RuntimeConfigManager {
    pub(crate) fn new(state_path: PathBuf) -> Self {
        Self {
            epoch_state: RuntimeConfigEpochStateStore::new(state_path),
            refresh_lock: Arc::new(Mutex::new(())),
        }
    }

    pub(crate) async fn refresh(
        &self,
    ) -> Result<VerifiedRuntimeConfigManifest, RuntimeConfigManifestError> {
        let bootstrap = RuntimeConfigBootstrap::from_embedded()?;
        let fetcher = HttpRuntimeConfigObjectFetcher::new()?;
        self.refresh_with_fetcher_at(&bootstrap, &fetcher, Utc::now())
            .await
    }

    async fn refresh_with_fetcher_at(
        &self,
        bootstrap: &RuntimeConfigBootstrap,
        fetcher: &dyn RuntimeConfigObjectFetcher,
        now: DateTime<Utc>,
    ) -> Result<VerifiedRuntimeConfigManifest, RuntimeConfigManifestError> {
        let _guard = self.refresh_lock.lock().await;
        let accepted = self.epoch_state.read()?;
        let policy = RuntimeConfigVerificationPolicy {
            now,
            last_accepted_epoch: accepted.last_accepted_epoch.clone(),
            last_accepted_manifest_sha256: accepted.last_accepted_manifest_sha256.clone(),
            max_lifetime_seconds: MAX_MANIFEST_LIFETIME_SECONDS,
            max_clock_skew_seconds: MAX_CLOCK_SKEW_SECONDS,
            max_reference_age_seconds: MAX_WORKER_REFERENCE_AGE_SECONDS,
            max_envelope_bytes: MAX_MANIFEST_ENVELOPE_BYTES,
        };
        let verified = fetch_and_verify_with_fetcher(bootstrap, &policy, fetcher).await?;
        self.epoch_state.accept(&verified)?;
        Ok(verified)
    }
}

#[derive(Clone)]
struct RuntimeConfigEpochStateStore {
    path: PathBuf,
}

impl RuntimeConfigEpochStateStore {
    fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn read(&self) -> Result<PersistedEpochState, RuntimeConfigManifestError> {
        let parent = self.path.parent().ok_or(RuntimeConfigManifestError::State(
            "state path has no parent directory",
        ))?;
        let parent_metadata = fs::symlink_metadata(parent)
            .map_err(|_| RuntimeConfigManifestError::State("state directory is unavailable"))?;
        if !parent_metadata.is_dir() || parent_metadata.file_type().is_symlink() {
            return Err(RuntimeConfigManifestError::State(
                "state directory is not a regular directory",
            ));
        }
        let metadata = match fs::symlink_metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(PersistedEpochState::initial())
            }
            Err(_) => {
                return Err(RuntimeConfigManifestError::State(
                    "persisted epoch state cannot be inspected",
                ))
            }
        };
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > EPOCH_STATE_MAX_BYTES
        {
            return Err(RuntimeConfigManifestError::State(
                "persisted epoch state is not a bounded regular file",
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err(RuntimeConfigManifestError::State(
                    "persisted epoch state permissions are too broad",
                ));
            }
        }
        let bytes = fs::read(&self.path).map_err(|_| {
            RuntimeConfigManifestError::State("persisted epoch state cannot be read")
        })?;
        let state: PersistedEpochState = serde_json::from_slice(&bytes)
            .map_err(|_| RuntimeConfigManifestError::State("persisted epoch state is malformed"))?;
        let canonical = serde_json::to_vec(&state)
            .map_err(|_| RuntimeConfigManifestError::State("persisted epoch state is malformed"))?;
        if bytes != canonical
            || state.schema_version != EPOCH_STATE_SCHEMA_VERSION
            || state.scope != EPOCH_STATE_SCOPE
        {
            return Err(RuntimeConfigManifestError::State(
                "persisted epoch state schema or canonical form is invalid",
            ));
        }
        let epoch = parse_epoch(&state.last_accepted_epoch, true)?;
        match (epoch, state.last_accepted_manifest_sha256.as_deref()) {
            (0, None) => {}
            (0, Some(_)) | (_, None) => {
                return Err(RuntimeConfigManifestError::State(
                    "persisted epoch and manifest digest are inconsistent",
                ))
            }
            (_, Some(digest)) => validate_digest(digest)?,
        }
        Ok(state)
    }

    fn accept(
        &self,
        verified: &VerifiedRuntimeConfigManifest,
    ) -> Result<(), RuntimeConfigManifestError> {
        let current = self.read()?;
        let current_epoch = parse_epoch(&current.last_accepted_epoch, true)?;
        let verified_epoch = parse_epoch(verified.epoch(), false)?;
        if verified_epoch < current_epoch
            || (verified_epoch == current_epoch
                && current.last_accepted_manifest_sha256.as_deref()
                    != Some(verified.manifest_sha256()))
        {
            return Err(RuntimeConfigManifestError::State(
                "verified manifest does not advance or exactly match persisted state",
            ));
        }
        if verified_epoch == current_epoch {
            return Ok(());
        }

        let next = PersistedEpochState {
            schema_version: EPOCH_STATE_SCHEMA_VERSION,
            scope: EPOCH_STATE_SCOPE.to_owned(),
            last_accepted_epoch: verified.epoch().to_owned(),
            last_accepted_manifest_sha256: Some(verified.manifest_sha256().to_owned()),
        };
        self.write_atomic(&next)
    }

    fn write_atomic(&self, state: &PersistedEpochState) -> Result<(), RuntimeConfigManifestError> {
        let parent = self.path.parent().ok_or(RuntimeConfigManifestError::State(
            "state path has no parent directory",
        ))?;
        let bytes = serde_json::to_vec(state)
            .map_err(|_| RuntimeConfigManifestError::State("epoch state serialization failed"))?;
        let temporary = parent.join(format!(
            ".fusou-runtime-config-epoch-{}.tmp",
            uuid::Uuid::new_v4()
        ));
        let write_result = (|| {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temporary)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            replace_state_file(&temporary, &self.path)?;
            sync_parent_directory(parent)?;
            Ok::<(), std::io::Error>(())
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temporary);
            return Err(RuntimeConfigManifestError::State(
                "epoch state could not be atomically persisted",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PersistedEpochState {
    schema_version: u32,
    scope: String,
    last_accepted_epoch: String,
    last_accepted_manifest_sha256: Option<String>,
}

impl PersistedEpochState {
    fn initial() -> Self {
        Self {
            schema_version: EPOCH_STATE_SCHEMA_VERSION,
            scope: EPOCH_STATE_SCOPE.to_owned(),
            last_accepted_epoch: "0".to_owned(),
            last_accepted_manifest_sha256: None,
        }
    }
}

fn sync_parent_directory(parent: &Path) -> Result<(), std::io::Error> {
    #[cfg(unix)]
    fs::File::open(parent)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = parent;
    Ok(())
}

#[cfg(windows)]
fn replace_state_file(source: &Path, destination: &Path) -> Result<(), std::io::Error> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_state_file(source: &Path, destination: &Path) -> Result<(), std::io::Error> {
    fs::rename(source, destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tlsn_runtime_config_manifest::RuntimeConfigManifestError;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use serde::Deserialize;
    use std::{collections::BTreeMap, future::Future, pin::Pin, sync::Mutex as StdMutex};
    use url::Url;

    const TEST_MANIFEST_URL: &str =
        "https://runtime-config.example.com/tlsn/runtime-config/v2/manifest.json";

    #[derive(Deserialize)]
    struct TestVector {
        trusted_signer: crate::tlsn_runtime_config_manifest::RuntimeConfigTrustedSigner,
        policy: TestPolicy,
        manifest_envelope_utf8: String,
        inputs_base64url: BTreeMap<String, String>,
    }

    #[derive(Deserialize)]
    struct TestPolicy {
        now_ms: i64,
    }

    struct TestFetcher {
        objects: StdMutex<BTreeMap<String, Vec<u8>>>,
    }

    impl TestFetcher {
        fn replace(&self, path_fragment: &str, bytes: Vec<u8>) {
            let mut objects = self.objects.lock().unwrap();
            let path = objects
                .keys()
                .find(|path| path.contains(path_fragment))
                .expect("fixture object path exists")
                .clone();
            objects.insert(path, bytes);
        }
    }

    impl RuntimeConfigObjectFetcher for TestFetcher {
        fn fetch<'a>(
            &'a self,
            url: Url,
            _max_bytes: usize,
        ) -> Pin<Box<dyn Future<Output = Result<Vec<u8>, RuntimeConfigManifestError>> + Send + 'a>>
        {
            let object =
                self.objects
                    .lock()
                    .map_err(|_| RuntimeConfigManifestError::Transport("test fetcher is poisoned"))
                    .and_then(|objects| {
                        objects.get(url.path()).cloned().ok_or(
                            RuntimeConfigManifestError::Transport(
                                "test fixture does not contain requested object",
                            ),
                        )
                    });
            Box::pin(async move { object })
        }
    }

    fn test_fixture() -> (
        crate::tlsn_runtime_config_manifest::RuntimeConfigBootstrap,
        TestFetcher,
        DateTime<Utc>,
    ) {
        let fixture: TestVector = serde_json::from_str(include_str!(
            "../../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/fixtures/tlsn-runtime-config-independent-v2-vector.json"
        ))
        .unwrap();
        let raw_manifest = fixture.manifest_envelope_utf8.into_bytes();
        let envelope: serde_json::Value = serde_json::from_slice(&raw_manifest).unwrap();
        let payload_bytes = URL_SAFE_NO_PAD
            .decode(envelope["payload_base64url"].as_str().unwrap())
            .unwrap();
        let payload: serde_json::Value = serde_json::from_slice(&payload_bytes).unwrap();
        let bytes = |name: &str| {
            URL_SAFE_NO_PAD
                .decode(fixture.inputs_base64url.get(name).unwrap())
                .unwrap()
        };
        let mut objects = BTreeMap::new();
        objects.insert(
            Url::parse(TEST_MANIFEST_URL).unwrap().path().to_owned(),
            raw_manifest,
        );
        for (kind, digest, input_name) in [
            (
                "worker-reference",
                payload["source"]["worker_reference_sha256"]
                    .as_str()
                    .unwrap(),
                "worker_reference_raw",
            ),
            (
                "origin-inventory",
                payload["production_authority_pins"]["origin_inventory_sha256"]
                    .as_str()
                    .unwrap(),
                "origin_inventory_raw",
            ),
            (
                "target-approval",
                payload["production_authority_pins"]["target_approval_artifact_sha256"]
                    .as_str()
                    .unwrap(),
                "target_approval_raw",
            ),
            (
                "security-registry-set",
                payload["production_authority_pins"]["security_registry_set_sha256"]
                    .as_str()
                    .unwrap(),
                "security_registry_set_raw",
            ),
            (
                "result-registry-envelope",
                payload["result_registry_pins"]["result_registry_envelope_sha256"]
                    .as_str()
                    .unwrap(),
                "result_registry_envelope_raw",
            ),
        ] {
            objects.insert(
                format!("/tlsn/runtime-config/v2/artifacts/{kind}/{digest}"),
                bytes(input_name),
            );
        }
        (
            crate::tlsn_runtime_config_manifest::RuntimeConfigBootstrap::for_test(
                TEST_MANIFEST_URL,
                fixture.trusted_signer,
            )
            .unwrap(),
            TestFetcher {
                objects: StdMutex::new(objects),
            },
            DateTime::from_timestamp_millis(fixture.policy.now_ms).unwrap(),
        )
    }

    fn test_store() -> (PathBuf, PathBuf) {
        let directory = std::env::temp_dir().join(format!(
            "fusou-runtime-config-epoch-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("state.json");
        (directory, path)
    }

    #[test]
    fn epoch_state_starts_empty_and_roundtrips_canonical_state_atomically() {
        let (directory, path) = test_store();
        let store = RuntimeConfigEpochStateStore::new(path.clone());
        assert_eq!(store.read().unwrap().last_accepted_epoch, "0");
        let state = PersistedEpochState {
            schema_version: EPOCH_STATE_SCHEMA_VERSION,
            scope: EPOCH_STATE_SCOPE.to_owned(),
            last_accepted_epoch: "4".to_owned(),
            last_accepted_manifest_sha256: Some("A".repeat(43)),
        };
        store.write_atomic(&state).unwrap();
        assert_eq!(store.read().unwrap().last_accepted_epoch, "4");
        assert_eq!(
            store.read().unwrap().last_accepted_manifest_sha256,
            state.last_accepted_manifest_sha256
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn epoch_state_rejects_corruption_wrong_permissions_and_symlink_files() {
        let (directory, path) = test_store();
        let store = RuntimeConfigEpochStateStore::new(path.clone());
        fs::write(&path, br#"{"schema_version":1,"scope":"wrong","last_accepted_epoch":"1","last_accepted_manifest_sha256":null}"#).unwrap();
        assert!(matches!(
            store.read(),
            Err(RuntimeConfigManifestError::State(_))
        ));

        fs::remove_file(&path).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::write(
                &path,
                serde_json::to_vec(&PersistedEpochState::initial()).unwrap(),
            )
            .unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
            assert!(matches!(
                store.read(),
                Err(RuntimeConfigManifestError::State(_))
            ));
            fs::remove_file(&path).unwrap();
            let target = directory.join("target.json");
            fs::write(
                &target,
                serde_json::to_vec(&PersistedEpochState::initial()).unwrap(),
            )
            .unwrap();
            std::os::unix::fs::symlink(&target, &path).unwrap();
            assert!(matches!(
                store.read(),
                Err(RuntimeConfigManifestError::State(_))
            ));
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn manager_persists_only_fully_verified_manifest_and_rejects_tampered_artifact() {
        let (bootstrap, fetcher, now) = test_fixture();
        let (directory, path) = test_store();
        let manager = RuntimeConfigManager::new(path.clone());

        let verified = manager
            .refresh_with_fetcher_at(&bootstrap, &fetcher, now)
            .await
            .unwrap();
        let accepted = manager.epoch_state.read().unwrap();
        assert_eq!(accepted.last_accepted_epoch, verified.epoch());
        assert_eq!(
            accepted.last_accepted_manifest_sha256.as_deref(),
            Some(verified.manifest_sha256())
        );

        let original = {
            let objects = fetcher.objects.lock().unwrap();
            objects
                .iter()
                .find(|(path, _)| path.contains("/worker-reference/"))
                .unwrap()
                .1
                .clone()
        };
        let mut tampered = original.clone();
        tampered[0] ^= 1;
        fetcher.replace("/worker-reference/", tampered);
        assert!(matches!(
            manager
                .refresh_with_fetcher_at(&bootstrap, &fetcher, now)
                .await,
            Err(RuntimeConfigManifestError::Invalid(_))
        ));
        assert_eq!(manager.epoch_state.read().unwrap().last_accepted_epoch, "1");

        fetcher.replace("/worker-reference/", original);
        let repeated = manager
            .refresh_with_fetcher_at(&bootstrap, &fetcher, now)
            .await
            .unwrap();
        assert_eq!(repeated.manifest_sha256(), verified.manifest_sha256());
        assert_eq!(manager.epoch_state.read().unwrap().last_accepted_epoch, "1");

        fs::remove_dir_all(directory).unwrap();
    }
}
