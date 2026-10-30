use super::{
    canonical_json, load_bundle_with_artifacts, parse_json, sha256_base64url, verify_loaded_bundle,
    BundleVerificationError, BundleVerifierOptions, LoadedBundle, Result,
};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::Path,
};

const MAX_FILE_BYTES: usize = 32 * 1024 * 1024;
const MAX_INPUT_BYTES: usize = 256 * 1024 * 1024;
const CANDIDATE_ARTIFACTS: [(&str, &str); 5] = [
    ("presentation", "presentation.bin"),
    ("result", "result.json"),
    ("session", "session.json"),
    ("possession_proof", "possession-proof.json"),
    ("consume_receipt", "consume-receipt.json"),
];

fn reject(message: impl Into<String>) -> BundleVerificationError {
    BundleVerificationError::new("evidence_finalization", None, message)
}

fn io_error(error: io::Error) -> BundleVerificationError {
    reject(format!("local bundle IO failed: {error}"))
}

struct ReadBudget(usize);

impl ReadBudget {
    fn read(&mut self, path: &Path) -> io::Result<Vec<u8>> {
        let metadata = fs::symlink_metadata(path)?;
        let limit = MAX_FILE_BYTES.min(self.0);
        if !metadata.is_file() || metadata.len() > limit as u64 {
            return Err(io::Error::other(
                "regular file or finalization byte limit violated",
            ));
        }
        let mut bytes = Vec::new();
        File::open(path)?
            .take(limit as u64 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > limit {
            return Err(io::Error::other(
                "finalization byte limit exceeded while reading",
            ));
        }
        self.0 -= bytes.len();
        Ok(bytes)
    }
}

fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name != "."
        && name != ".."
        && name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
}

struct Candidate {
    files: BTreeMap<String, Vec<u8>>,
}

impl Candidate {
    fn read(root: &Path, budget: &mut ReadBudget) -> Result<Self> {
        let raw = budget
            .read(&root.join("candidate-manifest.json"))
            .map_err(io_error)?;
        let manifest = parse_json(&raw, "candidate_manifest", "evidence_finalization")?;
        if manifest["schema_version"] != 2
            || manifest["scope"] != "fusou-tlsn-human-test-play-candidate"
            || manifest["synthetic_fixture"] != false
            || manifest["capture_provenance"] != "production-proxy-capture"
            || manifest["candidate_status"] != "CAPTURED_PENDING_OFFLINE_VERIFICATION"
            || manifest["verifier_execution_receipt_status"] != "CAPTURED"
        {
            return Err(reject(
                "candidate is incomplete or has unsupported provenance/schema",
            ));
        }
        let inventory = manifest["artifacts"]
            .as_object()
            .filter(|artifacts| artifacts.len() <= 64)
            .ok_or_else(|| reject("candidate artifact inventory is missing or oversized"))?;
        let mut files = BTreeMap::new();
        for (name, descriptor) in inventory {
            if !safe_name(name) || name == "candidate-manifest.json" {
                return Err(reject(
                    "candidate artifact filename is unsafe or self-referential",
                ));
            }
            let bytes = budget.read(&root.join(name)).map_err(io_error)?;
            if descriptor["size_bytes"].as_u64() != Some(bytes.len() as u64)
                || descriptor["sha256"].as_str() != Some(sha256_base64url(&bytes).as_str())
            {
                return Err(reject(format!(
                    "candidate artifact hash/length mismatch: {name}"
                )));
            }
            files.insert(name.clone(), bytes);
        }
        files.insert("candidate-manifest.json".to_owned(), raw);
        let candidate = Self { files };
        for (_, name) in CANDIDATE_ARTIFACTS {
            candidate.bytes(name)?;
        }
        for (field, name) in [
            ("presentation_sha256", "presentation.bin"),
            ("exact_result_sha256", "result-exact.bin"),
            (
                "verifier_execution_receipt_sha256",
                "verifier-execution-receipt.bin",
            ),
        ] {
            if manifest[field].as_str() != Some(sha256_base64url(candidate.bytes(name)?).as_str()) {
                return Err(reject(format!(
                    "candidate top-level digest mismatch: {field}"
                )));
            }
        }
        let envelope = candidate.json("result-exact.bin")?;
        if envelope["verified"] != true
            || envelope["result"] != candidate.json("result.json")?
            || envelope["consume_receipt"] != candidate.json("consume-receipt.json")?
            || envelope != candidate.json("worker-verification.json")?
            || envelope["device_replay_digest_hex"].as_str()
                != candidate.json("possession-proof.json")?["replay_digest_hex"].as_str()
            || envelope["device_replay_digest_hex"].as_str().is_none()
        {
            return Err(reject(
                "exact Result envelope differs from candidate Result/receipt/replay",
            ));
        }
        let header = candidate.bytes("verifier-execution-receipt-header.txt")?;
        let header = std::str::from_utf8(header)
            .map_err(|_| reject("execution receipt header is not UTF-8"))?;
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
        let receipt = candidate.bytes("verifier-execution-receipt.bin")?;
        if receipt.is_empty() || URL_SAFE_NO_PAD.encode(receipt) != header {
            return Err(reject("execution receipt header/exact bytes mismatch"));
        }
        Ok(candidate)
    }

    fn bytes(&self, name: &str) -> Result<&[u8]> {
        self.files
            .get(name)
            .map(Vec::as_slice)
            .ok_or_else(|| reject(format!("candidate artifact is missing: {name}")))
    }

    fn json(&self, name: &str) -> Result<Value> {
        parse_json(self.bytes(name)?, name, "evidence_finalization")
    }

    fn supplied(&self) -> Result<BTreeMap<String, Vec<u8>>> {
        CANDIDATE_ARTIFACTS
            .into_iter()
            .map(|(role, name)| Ok((role.to_owned(), self.bytes(name)?.to_vec())))
            .collect()
    }
}

/// Finalizes only the existing Production Bundle schema. Exact outer response
/// and execution-receipt sidecars are preserved, not assigned a new trust root.
pub fn finalize_candidate(
    candidate_root: impl AsRef<Path>,
    material_bundle: impl AsRef<Path>,
    output: impl AsRef<Path>,
    options: &BundleVerifierOptions,
) -> Result<Value> {
    let mut budget = ReadBudget(MAX_INPUT_BYTES);
    let candidate = Candidate::read(candidate_root.as_ref(), &mut budget)?;
    let mut bundle =
        load_bundle_with_artifacts(material_bundle.as_ref(), &candidate.supplied()?, |path| {
            budget.read(path)
        })?;
    let authentication = parse_json(
        &bundle
            .artifacts
            .get("device_authentication")
            .ok_or_else(|| reject("external device authentication material is missing"))?
            .bytes,
        "device_authentication",
        "evidence_finalization",
    )?;
    let captured_authentication = candidate.json("device-authentication.json")?;
    if authentication.get("request").is_none()
        || authentication.get("request") != captured_authentication.get("request")
    {
        return Err(reject(
            "external device authentication differs from captured request",
        ));
    }
    let output = output.as_ref();
    for (name, descriptor) in bundle.manifest["artifacts"]
        .as_object_mut()
        .ok_or_else(|| reject("bundle artifact descriptors are missing"))?
    {
        if !safe_name(name) {
            return Err(reject("bundle artifact name is unsafe"));
        }
        descriptor["path"] = Value::String(format!("artifacts/{name}.bin"));
    }
    bundle.manifest_path = output.join("manifest.json");
    let report = verify_loaded_bundle(&bundle, options)?;
    publish_local_bundle(output, &bundle, &candidate.files, &report)?;
    Ok(report)
}

fn private_directory(path: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path)
}

fn write_readback(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    if ReadBudget(MAX_INPUT_BYTES).read(path)? != bytes {
        return Err(io::Error::other("local artifact readback mismatch"));
    }
    Ok(())
}

fn sync_directory(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

fn sync_output_parent(output: &Path) -> io::Result<()> {
    sync_directory(
        output
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new(".")),
    )
}

fn publish_local_bundle(
    output: &Path,
    bundle: &LoadedBundle,
    candidate_files: &BTreeMap<String, Vec<u8>>,
    report: &Value,
) -> Result<()> {
    private_directory(output).map_err(io_error)?;
    let result = (|| {
        private_directory(&output.join("artifacts"))?;
        private_directory(&output.join("candidate"))?;
        for (name, artifact) in &bundle.artifacts {
            write_readback(
                &output.join(format!("artifacts/{name}.bin")),
                &artifact.bytes,
            )?;
        }
        for (name, bytes) in candidate_files {
            write_readback(&output.join("candidate").join(name), bytes)?;
        }
        write_readback(
            &output.join("verification-report.json"),
            canonical_json(report).map_err(io::Error::other)?.as_bytes(),
        )?;
        let manifest = canonical_json(&bundle.manifest).map_err(io::Error::other)?;
        write_readback(&output.join(".manifest.pending"), manifest.as_bytes())?;
        sync_directory(&output.join("artifacts"))?;
        sync_directory(&output.join("candidate"))?;
        // Atomic create-if-absent: a partial manifest is never the completion marker.
        fs::hard_link(
            output.join(".manifest.pending"),
            output.join("manifest.json"),
        )?;
        fs::remove_file(output.join(".manifest.pending"))?;
        sync_directory(output)?;
        sync_output_parent(output)?;
        Ok::<(), io::Error>(())
    })();
    if let Err(error) = result {
        return match fs::remove_dir_all(output) {
            Ok(()) => Err(io_error(error)),
            Err(cleanup) => Err(reject(format!(
                "{error}; cleanup unconfirmed at {}: {cleanup}",
                output.display(),
            ))),
        };
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use serde_json::json;
    use std::path::PathBuf;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("fusou-finalization-test-{}", uuid::Uuid::new_v4()));
            private_directory(&root).unwrap();
            private_directory(&root.join("candidate")).unwrap();
            private_directory(&root.join("material")).unwrap();
            let fixture = Self(root);
            let envelope = json!({
                "verified": true, "result": {"not_a_signed_result": true},
                "consume_receipt": {"not_a_signed_receipt": true},
                "device_replay_digest_hex": "a".repeat(64),
            });
            let files = BTreeMap::from([
                ("presentation.bin", b"not a TLSN Presentation".to_vec()),
                (
                    "result.json",
                    serde_json::to_vec(&envelope["result"]).unwrap(),
                ),
                (
                    "consume-receipt.json",
                    serde_json::to_vec(&envelope["consume_receipt"]).unwrap(),
                ),
                (
                    "worker-verification.json",
                    serde_json::to_vec_pretty(&envelope).unwrap(),
                ),
                ("result-exact.bin", serde_json::to_vec(&envelope).unwrap()),
                ("session.json", b"{}".to_vec()),
                (
                    "possession-proof.json",
                    serde_json::to_vec(&json!({"replay_digest_hex": "a".repeat(64)})).unwrap(),
                ),
                (
                    "device-authentication.json",
                    br#"{"request":{"nonce":"captured"}}"#.to_vec(),
                ),
                (
                    "verifier-execution-receipt.bin",
                    b"not an authenticated execution receipt".to_vec(),
                ),
                (
                    "verifier-execution-receipt-header.txt",
                    URL_SAFE_NO_PAD
                        .encode(b"not an authenticated execution receipt")
                        .into_bytes(),
                ),
            ]);
            for (name, bytes) in files {
                fs::write(fixture.candidate().join(name), bytes).unwrap();
            }
            fixture.refresh_manifest();
            fixture
        }

        fn candidate(&self) -> PathBuf {
            self.0.join("candidate")
        }
        fn material(&self) -> PathBuf {
            self.0.join("material")
        }
        fn output(&self) -> PathBuf {
            self.0.join("output")
        }

        fn refresh_manifest(&self) {
            let mut artifacts = serde_json::Map::new();
            for entry in fs::read_dir(self.candidate()).unwrap() {
                let entry = entry.unwrap();
                let name = entry.file_name().into_string().unwrap();
                if name == "candidate-manifest.json" {
                    continue;
                }
                let raw = fs::read(entry.path()).unwrap();
                artifacts.insert(
                    name,
                    json!({"size_bytes": raw.len(), "sha256": sha256_base64url(&raw)}),
                );
            }
            let manifest = json!({
                "schema_version": 2, "scope": "fusou-tlsn-human-test-play-candidate",
                "synthetic_fixture": false, "capture_provenance": "production-proxy-capture",
                "candidate_status": "CAPTURED_PENDING_OFFLINE_VERIFICATION",
                "verifier_execution_receipt_status": "CAPTURED",
                "presentation_sha256": artifacts["presentation.bin"]["sha256"],
                "exact_result_sha256": artifacts["result-exact.bin"]["sha256"],
                "verifier_execution_receipt_sha256": artifacts["verifier-execution-receipt.bin"]["sha256"],
                "artifacts": artifacts,
            });
            fs::write(
                self.candidate().join("candidate-manifest.json"),
                serde_json::to_vec(&manifest).unwrap(),
            )
            .unwrap();
        }

        fn read(&self) -> Result<Candidate> {
            Candidate::read(&self.candidate(), &mut ReadBudget(MAX_INPUT_BYTES))
        }

        fn write_material(&self, auth: Value) {
            fs::write(
                self.material().join("auth.json"),
                serde_json::to_vec(&auth).unwrap(),
            )
            .unwrap();
            let mut descriptors = serde_json::Map::new();
            for (role, name) in CANDIDATE_ARTIFACTS {
                let bytes = fs::read(self.candidate().join(name)).unwrap();
                descriptors.insert(role.to_owned(), json!({
                    "path": name, "artifact_sha256": sha256_base64url(&bytes), "byte_length": bytes.len(),
                    "provenance": "production",
                }));
            }
            let auth = serde_json::to_vec(&auth).unwrap();
            descriptors.insert(
                "device_authentication".to_owned(),
                json!({
                    "path": "auth.json", "artifact_sha256": sha256_base64url(&auth),
                    "byte_length": auth.len(), "provenance": "production",
                }),
            );
            fs::write(
                self.material().join("manifest.json"),
                serde_json::to_vec(&json!({
                    "schema_version": 1, "scope": "tlsn-production-evidence", "status": "BLOCKED",
                    "artifacts": descriptors,
                }))
                .unwrap(),
            )
            .unwrap();
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).expect("remove exact test fixture");
        }
    }

    fn options() -> BundleVerifierOptions {
        BundleVerifierOptions {
            evidence_root_key_id: String::new(),
            evidence_root_public_key_spki: String::new(),
            trusted_notary_registry_raw: vec![],
            session_authority_registry_raw: vec![],
            session_authority_key_id: String::new(),
            session_authority_public_key_spki: String::new(),
            binding_authority_registry_raw: vec![],
            binding_authority_key_id: String::new(),
            binding_authority_public_key_spki: String::new(),
            canonical_user_id: String::new(),
            device_id: String::new(),
            device_public_key: String::new(),
            server_identity: String::new(),
            origin_inventory_raw: vec![],
            target_approval_raw: vec![],
            profile_sha256: String::new(),
            sparse_profile_sha256: None,
            verifier_key_id: String::new(),
            trust_anchor_der: vec![],
        }
    }

    #[test]
    fn synthetic_hash_consistency_is_not_finalization_success() {
        let f = Fixture::new();
        f.write_material(json!({"request": {"nonce": "captured"}}));
        let error =
            finalize_candidate(f.candidate(), f.material(), f.output(), &options()).unwrap_err();
        assert_eq!(error.edge, "artifact_manifest");
        assert_eq!(
            error.message,
            "manifest is not a completed production capture contract"
        );
        assert!(!f.output().exists());
    }

    #[test]
    fn missing_external_material_never_creates_output() {
        let f = Fixture::new();
        assert!(finalize_candidate(f.candidate(), f.material(), f.output(), &options()).is_err());
        assert!(!f.output().exists());
    }

    #[test]
    fn external_authentication_cannot_belong_to_another_capture() {
        let f = Fixture::new();
        f.write_material(json!({"request": {"nonce": "other"}}));
        let error =
            finalize_candidate(f.candidate(), f.material(), f.output(), &options()).unwrap_err();
        assert!(error.message.contains("differs from captured request"));
        assert!(!f.output().exists());
    }

    #[test]
    fn incomplete_or_synthetic_candidates_are_rejected() {
        let f = Fixture::new();
        for (field, value) in [
            (
                "candidate_status",
                json!("INCOMPLETE_MISSING_EXECUTION_RECEIPT"),
            ),
            ("synthetic_fixture", json!(true)),
            ("verifier_execution_receipt_status", json!("MISSING")),
        ] {
            f.refresh_manifest();
            let path = f.candidate().join("candidate-manifest.json");
            let mut manifest: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            manifest[field] = value;
            fs::write(&path, serde_json::to_vec(&manifest).unwrap()).unwrap();
            assert!(f.read().err().unwrap().message.contains("incomplete"));
        }
    }

    #[test]
    fn mutated_hash_length_and_top_level_digest_are_rejected() {
        let f = Fixture::new();
        for field in ["sha256", "size_bytes", "presentation_sha256"] {
            f.refresh_manifest();
            let path = f.candidate().join("candidate-manifest.json");
            let mut manifest: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            if field == "presentation_sha256" {
                manifest[field] = json!("foreign");
            } else {
                manifest["artifacts"]["presentation.bin"][field] = json!(0);
            }
            fs::write(&path, serde_json::to_vec(&manifest).unwrap()).unwrap();
            assert!(f.read().err().unwrap().message.contains("mismatch"));
        }
    }

    #[test]
    fn captured_flags_do_not_replace_the_retained_required_execution_receipt() {
        let f = Fixture::new();
        fs::remove_file(f.candidate().join("verifier-execution-receipt.bin")).unwrap();
        let path = f.candidate().join("candidate-manifest.json");
        let mut manifest: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        manifest["artifacts"]
            .as_object_mut()
            .unwrap()
            .remove("verifier-execution-receipt.bin");
        fs::write(&path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        let error =
            finalize_candidate(f.candidate(), f.material(), f.output(), &options()).unwrap_err();
        assert!(error.message.contains("verifier-execution-receipt.bin"));
        assert!(!f.output().exists());
    }

    #[test]
    fn exact_envelope_must_match_inner_result_receipt_replay_and_parsed_response() {
        for field in [
            "result",
            "consume_receipt",
            "device_replay_digest_hex",
            "verified",
        ] {
            let f = Fixture::new();
            let mut envelope: Value =
                serde_json::from_slice(&fs::read(f.candidate().join("result-exact.bin")).unwrap())
                    .unwrap();
            envelope[field] = json!("foreign");
            fs::write(
                f.candidate().join("result-exact.bin"),
                serde_json::to_vec(&envelope).unwrap(),
            )
            .unwrap();
            fs::write(
                f.candidate().join("worker-verification.json"),
                serde_json::to_vec(&envelope).unwrap(),
            )
            .unwrap();
            f.refresh_manifest();
            assert!(f
                .read()
                .err()
                .unwrap()
                .message
                .contains("exact Result envelope"));
        }
    }

    #[test]
    fn detached_receipt_header_and_missing_required_files_are_rejected() {
        let f = Fixture::new();
        fs::write(
            f.candidate().join("verifier-execution-receipt-header.txt"),
            b"foreign",
        )
        .unwrap();
        f.refresh_manifest();
        assert!(f
            .read()
            .err()
            .unwrap()
            .message
            .contains("header/exact bytes"));
        fs::remove_file(f.candidate().join("result.json")).unwrap();
        f.refresh_manifest();
        assert!(f
            .read()
            .err()
            .unwrap()
            .message
            .contains("missing: result.json"));
    }

    #[test]
    fn candidate_paths_and_symlinks_are_not_followed() {
        let f = Fixture::new();
        let path = f.candidate().join("candidate-manifest.json");
        let mut manifest: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        manifest["artifacts"]["../outside"] = json!({"sha256": "", "size_bytes": 1});
        fs::write(&path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        assert!(f.read().err().unwrap().message.contains("unsafe"));
        #[cfg(unix)]
        {
            fs::remove_file(f.candidate().join("presentation.bin")).unwrap();
            std::os::unix::fs::symlink("../outside", f.candidate().join("presentation.bin"))
                .unwrap();
            assert!(ReadBudget(MAX_INPUT_BYTES)
                .read(&f.candidate().join("presentation.bin"))
                .is_err());
        }
    }

    #[test]
    fn file_and_cumulative_limits_are_checked_before_read_allocation() {
        let f = Fixture::new();
        let path = f.0.join("oversize");
        File::create(&path)
            .unwrap()
            .set_len(MAX_FILE_BYTES as u64 + 1)
            .unwrap();
        assert!(ReadBudget(MAX_INPUT_BYTES).read(&path).is_err());
        fs::write(&path, b"12").unwrap();
        let mut budget = ReadBudget(3);
        assert_eq!(budget.read(&path).unwrap(), b"12");
        assert!(budget.read(&path).is_err());
    }

    #[test]
    fn local_write_readback_is_exclusive_and_never_overwrites() {
        let f = Fixture::new();
        let path = f.0.join("opaque-io-probe");
        write_readback(&path, b"not evidence").unwrap();
        assert!(write_readback(&path, b"replacement").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"not evidence");
    }

    #[test]
    fn bare_relative_output_syncs_current_directory_not_an_empty_path() {
        sync_output_parent(Path::new("unused-relative-output")).unwrap();
        let f = Fixture::new();
        sync_output_parent(&f.output()).unwrap();
    }

    #[test]
    fn publication_io_failure_removes_partial_output_without_completion_marker() {
        let f = Fixture::new();
        let bundle = LoadedBundle {
            manifest_path: f.output().join("manifest.json"),
            manifest: json!({}),
            artifacts: BTreeMap::new(),
        };
        let invalid_io_target = BTreeMap::from([("missing-parent/file".to_owned(), vec![1])]);
        assert!(
            publish_local_bundle(&f.output(), &bundle, &invalid_io_target, &json!({})).is_err()
        );
        assert!(!f.output().exists());
    }

    #[test]
    fn existing_output_is_never_reused_or_removed() {
        let f = Fixture::new();
        private_directory(&f.output()).unwrap();
        fs::write(f.output().join("sentinel"), b"existing owner").unwrap();
        let bundle = LoadedBundle {
            manifest_path: f.output().join("manifest.json"),
            manifest: json!({}),
            artifacts: BTreeMap::new(),
        };
        assert!(publish_local_bundle(&f.output(), &bundle, &BTreeMap::new(), &json!({})).is_err());
        assert_eq!(
            fs::read(f.output().join("sentinel")).unwrap(),
            b"existing owner"
        );
    }
}
