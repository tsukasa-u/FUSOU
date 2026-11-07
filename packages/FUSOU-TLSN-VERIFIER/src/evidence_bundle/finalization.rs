use super::{
    canonical_json, load_bundle_with_artifacts, parse_json, parse_result_profile, sha256_base64url,
    verify_material_bundle, Artifact, BundleVerificationError, BundleVerifierOptions, LoadedBundle,
    Result,
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
        for name in ["device-authentication.json", "metadata.json"] {
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
        let mut supplied = CANDIDATE_ARTIFACTS
            .into_iter()
            .map(|(role, name)| Ok((role.to_owned(), self.bytes(name)?.to_vec())))
            .collect::<Result<BTreeMap<_, _>>>()?;

        for (role, name) in [
            ("device_authentication", "device-authentication.json"),
            ("capture_metadata", "metadata.json"),
        ] {
            if let Some(bytes) = self.files.get(name) {
                supplied.insert(role.to_owned(), bytes.clone());
            }
        }
        if let Some(bytes) = self.files.get("worker-health.json") {
            supplied.insert("health".to_owned(), bytes.clone());
        }

        match (
            self.files.get("runtime-result-registry.json"),
            self.files.get("runtime-result-registry-envelope.json"),
        ) {
            (Some(registry), Some(envelope)) => {
                supplied.insert("result_registry".to_owned(), registry.clone());
                supplied.insert("result_registry_envelope".to_owned(), envelope.clone());
            }
            (None, None) => {}
            _ => {
                return Err(reject(
                    "candidate Result registry and envelope materials must be present together",
                ));
            }
        }

        supplied.insert(
            "subject".to_owned(),
            subject_material(self.bytes("result.json")?)?,
        );
        Ok(supplied)
    }
}

fn subject_material(result_bytes: &[u8]) -> Result<Vec<u8>> {
    let result = parse_result_profile(result_bytes)?;
    let result = result.view();
    let session_id = result.attestation_session_id().to_string();
    let subject = serde_json::json!({
        "canonical_user_id_sha256": sha256_base64url(result.canonical_user_id().as_bytes()),
        "device_id_sha256": sha256_base64url(result.canonical_device_id().as_bytes()),
        "attestation_session_id_sha256": sha256_base64url(session_id.as_bytes()),
        "verified_member_id_sha256": sha256_base64url(result.verified_member_id().as_bytes()),
        "binding_value_sha256": sha256_base64url(result.binding_value().as_bytes()),
    });
    serde_json::to_vec(&subject).map_err(|error| {
        reject(format!(
            "could not serialize subject binding derived from candidate Result: {error}"
        ))
    })
}

/// Finalizes only the existing Production Bundle schema. Exact outer response
/// and execution-receipt sidecars are preserved, not assigned a new trust root.
pub fn finalize_candidate(
    candidate_root: impl AsRef<Path>,
    material_bundle: impl AsRef<Path>,
    output: impl AsRef<Path>,
    options: &BundleVerifierOptions,
) -> Result<Value> {
    finalize_candidate_with_replay_observation(
        candidate_root,
        material_bundle,
        None,
        output,
        options,
    )
}

pub fn finalize_candidate_with_replay_observation(
    candidate_root: impl AsRef<Path>,
    material_bundle: impl AsRef<Path>,
    replay_observation: Option<&Path>,
    output: impl AsRef<Path>,
    options: &BundleVerifierOptions,
) -> Result<Value> {
    let mut budget = ReadBudget(MAX_INPUT_BYTES);
    let candidate = Candidate::read(candidate_root.as_ref(), &mut budget)?;
    let replay_observation = replay_observation
        .map(|path| budget.read(path).map_err(io_error))
        .transpose()?;
    let mut bundle =
        load_bundle_with_artifacts(material_bundle.as_ref(), &candidate.supplied()?, |path| {
            budget.read(path)
        })?;
    if let Some(replay_bytes) = replay_observation {
        if let Some(existing) = bundle.artifacts.get("replay") {
            if existing.bytes != replay_bytes {
                return Err(reject(
                    "collected replay observation differs from the external replay role",
                ));
            }
        } else {
            let descriptors = bundle.manifest["artifacts"]
                .as_object_mut()
                .ok_or_else(|| reject("bundle artifact descriptors are missing"))?;
            if descriptors.contains_key("replay") {
                return Err(reject(
                    "external replay descriptor exists without a matching replay artifact",
                ));
            }
            descriptors.insert(
                "replay".to_owned(),
                serde_json::json!({
                    "path": "artifacts/replay.bin",
                    "artifact_sha256": sha256_base64url(&replay_bytes),
                    "byte_length": replay_bytes.len(),
                    "provenance": "production",
                }),
            );
            bundle.artifacts.insert(
                "replay".to_owned(),
                Artifact {
                    bytes: replay_bytes,
                },
            );
        }
    }
    let authentication = parse_json(
        &bundle
            .artifacts
            .get("device_authentication")
            .ok_or_else(|| reject("candidate device-authentication material is missing"))?
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
    if !bundle.artifacts.contains_key("semantic_verification") {
        super::generate_semantic_verification_for_finalization(&mut bundle, options)?;
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
    let report = verify_material_bundle(&bundle, options)?;
    bundle.manifest["verification_status"] = Value::String("VERIFIED".to_owned());
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
    use super::super::ParsedVerifierResult;
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use ring::signature::KeyPair;
    use serde_json::json;
    use std::{path::PathBuf, process::Command};

    fn run_node_semantic_contract(mode: &str, path: &Path) {
        let helper =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/semantic-report-node-compat.mjs");
        let output = Command::new("node")
            .arg(helper)
            .arg(mode)
            .arg(path)
            .output()
            .expect("Node must be available for semantic report contract verification");
        assert!(
            output.status.success(),
            "Node semantic contract {mode} failed:\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
    }

    struct Fixture(PathBuf);

    fn fixture_result_bytes() -> Vec<u8> {
        let session_id = uuid::Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000").unwrap();
        let binding_nonce = [0x42_u8; 32];
        let mut binding_bytes = crate::BINDING_PREFIX.to_vec();
        binding_bytes.extend_from_slice(&16_u16.to_be_bytes());
        binding_bytes.extend_from_slice(session_id.as_bytes());
        binding_bytes.extend_from_slice(&32_u16.to_be_bytes());
        binding_bytes.extend_from_slice(&binding_nonce);
        let response = b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".to_vec();
        crate::VerifierResult {
            version: 2,
            profile_id: crate::PROFILE_ID.to_owned(),
            profile_sha256: [1_u8; 32],
            issuer: crate::ISSUER.to_owned(),
            proof_purpose: crate::PROOF_PURPOSE.to_owned(),
            canonical_user_id: "11111111-1111-4111-8111-111111111111".to_owned(),
            canonical_device_id: "22222222-2222-4222-8222-222222222222".to_owned(),
            device_challenge: [6_u8; 32],
            verified_member_id: "16189463".to_owned(),
            attestation_session_id: session_id,
            binding_nonce,
            binding_value: URL_SAFE_NO_PAD.encode(binding_bytes),
            verifier_key_id: "verifier-test".to_owned(),
            notary_key_id: "notary-test".to_owned(),
            tlsn_attestation_id: vec![2_u8; crate::MAX_ATTESTATION_ID_BYTES],
            presentation_sha256: [7_u8; 32],
            server_identity: "game.example.test".to_owned(),
            origin_inventory_sha256: None,
            target_approval_artifact_sha256: None,
            request_transcript_size: 4,
            request_transcript_sha256: [3_u8; 32],
            response_transcript_size: response.len() as u64,
            response_transcript_sha256: [4_u8; 32],
            revealed_request_ranges: vec![crate::RevealedRange {
                start: 0,
                length: 4,
                bytes: b"POST".to_vec(),
            }],
            revealed_response_ranges: vec![crate::RevealedRange {
                start: 0,
                length: response.len() as u64,
                bytes: response,
            }],
            signature: [5_u8; 64],
        }
        .canonical_json()
        .unwrap()
        .into_bytes()
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .join(format!("fusou-finalization-test-{}", uuid::Uuid::new_v4()));
            private_directory(&root).unwrap();
            private_directory(&root.join("candidate")).unwrap();
            private_directory(&root.join("material")).unwrap();
            let fixture = Self(root);
            let result_bytes = fixture_result_bytes();
            let result: Value = serde_json::from_slice(&result_bytes).unwrap();
            let consume_receipt = json!({"used_at": "2026-10-01T12:00:00.000Z"});
            let envelope = json!({
                "verified": true, "result": result,
                "consume_receipt": consume_receipt,
                "device_replay_digest_hex": "a".repeat(64),
            });
            let files = BTreeMap::from([
                ("presentation.bin", b"not a TLSN Presentation".to_vec()),
                ("result.json", result_bytes),
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
                    "metadata.json",
                    br#"{"candidate":"capture-metadata"}"#.to_vec(),
                ),
                ("runtime-result-registry.json", br#"{"keys":[]}"#.to_vec()),
                (
                    "runtime-result-registry-envelope.json",
                    br#"{"signature":"synthetic"}"#.to_vec(),
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
            let receipt_sha256 = artifacts
                .get("verifier-execution-receipt.bin")
                .map(|descriptor| descriptor["sha256"].clone())
                .unwrap_or_else(|| json!("missing"));
            let manifest = json!({
                "schema_version": 2, "scope": "fusou-tlsn-human-test-play-candidate",
                "synthetic_fixture": false, "capture_provenance": "production-proxy-capture",
                "candidate_status": "CAPTURED_PENDING_OFFLINE_VERIFICATION",
                "verifier_execution_receipt_status": "CAPTURED",
                "presentation_sha256": artifacts["presentation.bin"]["sha256"],
                "exact_result_sha256": artifacts["result-exact.bin"]["sha256"],
                "verifier_execution_receipt_sha256": receipt_sha256,
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

        fn write_diagnostic_material(&self) {
            let evidence_names = [
                "real_production_game_server_connection",
                "real_production_tlsn_notary_interaction",
                "real_production_tlsn_proxy_provenance",
                "real_production_fusou_web_device_authentication",
                "real_production_device_possession_proof",
                "real_production_replay_authority",
                "real_production_binding_authority",
                "real_production_session_authority",
                "real_production_binding_receipt_authority",
                "real_production_origin_web_pki_validation",
                "real_production_result_signing_key",
                "real_production_result_registry_authentication",
                "real_production_public_key_publication",
                "independently_captured_production_evidence",
            ];
            let evidence = evidence_names
                .into_iter()
                .map(|name| {
                    (
                        name.to_owned(),
                        json!({
                            "status": if name == "real_production_tlsn_proxy_provenance" {
                                "UNVERIFIED"
                            } else {
                                "PASS"
                            },
                            "required_artifacts": super::super::REQUIRED_ARTIFACT_NAMES,
                        }),
                    )
                })
                .collect::<serde_json::Map<_, _>>();
            let predicates = |names: &[&str], allow_unverified: bool| {
                names
                    .iter()
                    .map(|name| {
                        (
                            (*name).to_owned(),
                            json!({
                                "status": if allow_unverified { "UNVERIFIED" } else { "PASS" },
                            }),
                        )
                    })
                    .collect::<serde_json::Map<_, _>>()
            };
            let manifest = json!({
                "schema_version": 1,
                "scope": "tlsn-production-evidence",
                "status": "BLOCKED",
                "capture_status": "PASS",
                "verification_status": "NOT_CHECKED",
                "capture_provenance": "production",
                "production_evidence_status": "BLOCKED",
                "p0_05_status": "BLOCKED",
                "capture_id": "22222222-2222-4222-8222-222222222222",
                "capture_started_at": "2026-10-01T12:00:00.000Z",
                "capture_finished_at": "2026-10-01T12:00:01.000Z",
                "artifacts": {},
                "evidence": evidence,
                "semantic_predicates": predicates(&[
                    "presentation_cryptography",
                    "notary_identity",
                    "server_identity",
                    "require_info_http_profile",
                    "presentation_binding_to_session",
                    "authenticated_member_id",
                    "result_presentation_binding",
                    "result_registry_root_authentication",
                    "result_signature",
                    "result_key_publication",
                    "trust_root_publication",
                ], false),
                "device_predicates": predicates(&[
                    "device_identity_ownership",
                    "device_authentication_signature",
                    "session_binding_receipt",
                    "tlsn_device_possession_signature",
                    "binding_framing",
                    "replay_digest",
                    "consume_receipt",
                ], false),
                "capture_predicates": predicates(&[
                    "proxy_provenance_cryptographic_authentication",
                ], true),
            });
            fs::write(
                self.material().join("manifest.json"),
                serde_json::to_vec(&manifest).unwrap(),
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

    const FIXTURE_SERVER_IDENTITY: &str = "server01.fusou-data.net";
    const FIXTURE_USER_ID: &str = "11111111-1111-4111-8111-111111111111";
    const FIXTURE_DEVICE_ID: &str = "22222222-2222-4222-8222-222222222222";
    const FIXTURE_TIME: &str = "2026-10-01T12:00:00.000Z";
    const FIXTURE_SESSION_EXPIRY: &str = "2026-10-01T13:00:00.000Z";

    fn signing_key(seed: u8) -> ring::signature::Ed25519KeyPair {
        ring::signature::Ed25519KeyPair::from_seed_unchecked(&[seed; 32]).unwrap()
    }

    fn public_key_spki(key: &ring::signature::Ed25519KeyPair) -> String {
        let mut spki = super::super::SPKI_PREFIX.to_vec();
        spki.extend_from_slice(key.public_key().as_ref());
        URL_SAFE_NO_PAD.encode(spki)
    }

    fn sign_bytes(key: &ring::signature::Ed25519KeyPair, message: &[u8]) -> String {
        URL_SAFE_NO_PAD.encode(key.sign(message).as_ref())
    }

    fn signed_authority_receipt(
        mut receipt: Value,
        key: &ring::signature::Ed25519KeyPair,
        signing_bytes: impl FnOnce(&Value) -> Result<Vec<u8>>,
    ) -> Value {
        receipt["signature"] = Value::String(String::new());
        receipt["signature"] = Value::String(sign_bytes(key, &signing_bytes(&receipt).unwrap()));
        receipt
    }

    fn fixture_trust_graph(
        result: &dyn super::super::EvidenceResultView,
        presentation: &[u8],
        result_bytes: &[u8],
        registry_sha256: &str,
        envelope_sha256: &str,
        root_public_key_spki: &str,
        notary_key: &[u8],
        device_public_key_sha256: &str,
        proxy: &Value,
    ) -> Value {
        let mut edge_specs = [
            (
                "user-owns-device",
                "authenticated-user",
                "device",
                &["user_id", "device_id", "device_public_key_sha256"][..],
                "device_identity",
                "device_identity_ownership",
                "fusou-web-user-devices",
            ),
            (
                "device-authenticates",
                "device",
                "device-authentication",
                &["device_id", "device_auth_nonce"][..],
                "device_authentication",
                "device_authentication_signature",
                "fusou-web-device-authentication",
            ),
            (
                "device-authentication-issues-session",
                "device-authentication",
                "session",
                &["device_id", "device_auth_nonce", "session_id"][..],
                "session",
                "session_binding_receipt",
                "fusou-tlsn-session-authority",
            ),
            (
                "session-issues-binding",
                "session",
                "binding",
                &["session_id", "binding_value", "binding_nonce"][..],
                "session",
                "session_binding_receipt",
                "fusou-tlsn-session-authority",
            ),
            (
                "session-binding-authenticates-presentation",
                "session",
                "presentation",
                &["session_id", "binding_value", "request_transcript_sha256"][..],
                "presentation",
                "presentation_binding_to_session",
                "offline-production-evidence-verifier",
            ),
            (
                "binding-consumes-presentation",
                "binding",
                "presentation",
                &["session_id", "binding_value", "presentation_id"][..],
                "consume_receipt",
                "consume_receipt",
                "fusou-tlsn-binding-authority",
            ),
            (
                "result-registry-root-authorizes-registry",
                "result-registry-root",
                "result-registry",
                &[
                    "result_key_registry_sha256",
                    "result_key_registry_envelope_sha256",
                    "result_registry_root_key_id",
                ][..],
                "result_registry_envelope",
                "result_registry_root_authentication",
                "fusou-result-registry-root",
            ),
            (
                "result-registry-authorizes-result-signer",
                "result-registry",
                "result",
                &[
                    "result_key_registry_sha256",
                    "result_signer_key_id",
                    "result_public_key_spki",
                ][..],
                "result_registry",
                "result_key_publication",
                "fusou-result-signing-key-registry",
            ),
            (
                "result-is-signed",
                "result",
                "production-evidence",
                &["result_sha256", "result_signer_key_id"][..],
                "result",
                "result_signature",
                "fusou-tlsn-result-signer",
            ),
            (
                "presentation-is-authenticated-by-notary",
                "presentation",
                "tlsn-notary",
                &["notary_key_id", "notary_key_sha256"][..],
                "presentation",
                "notary_identity",
                "tlsn-alpha15-presentation-notary-key",
            ),
            (
                "presentation-derives-member-id",
                "presentation",
                "member-id",
                &["verified_member_id", "response_transcript_sha256"][..],
                "semantic_verification",
                "authenticated_member_id",
                "fusou-require-info-v1-response-parser",
            ),
            (
                "member-id-is-in-result",
                "member-id",
                "result",
                &[
                    "verified_member_id",
                    "tlsn_attestation_id",
                    "transcript_hashes",
                ][..],
                "semantic_verification",
                "result_presentation_binding",
                "offline-production-evidence-verifier",
            ),
            (
                "presentation-is-cryptographically-verified",
                "presentation",
                "result",
                &["presentation_sha256", "tlsn_attestation_id"][..],
                "semantic_verification",
                "presentation_cryptography",
                "tlsn-alpha15-verifier",
            ),
            (
                "presentation-provenance-is-declared",
                "presentation",
                "production-proxy",
                &[
                    "presentation_sha256",
                    "proxy_identity",
                    "proxy_deployment_id",
                    "proxy_binary_identity",
                ][..],
                "capture_metadata",
                "proxy_provenance_cryptographic_authentication",
                "externally-pinned-production-proxy-provenance-authority",
            ),
            (
                "remote-attestation-is-unverified",
                "remote-attestation",
                "production-evidence",
                &["status"][..],
                "health",
                "remote_attestation_unverified",
                "remote-attestation-signer",
            ),
        ];
        if result.is_sparse() {
            for edge in &mut edge_specs {
                match edge.0 {
                    "session-binding-authenticates-presentation" => {
                        *edge = (
                            edge.0,
                            edge.1,
                            edge.2,
                            &["session_id", "binding_value", "revealed_request_ranges"],
                            edge.4,
                            edge.5,
                            edge.6,
                        );
                    }
                    "presentation-derives-member-id" => {
                        *edge = (
                            edge.0,
                            edge.1,
                            edge.2,
                            &["verified_member_id", "revealed_response_ranges"],
                            edge.4,
                            edge.5,
                            "fusou-require-info-v2-sparse-response-parser",
                        );
                    }
                    "member-id-is-in-result" => {
                        *edge = (
                            edge.0,
                            edge.1,
                            edge.2,
                            &[
                                "verified_member_id",
                                "tlsn_attestation_id",
                                "revealed_response_ranges",
                            ],
                            edge.4,
                            edge.5,
                            edge.6,
                        );
                    }
                    _ => {}
                }
            }
        }
        let edges = edge_specs
            .into_iter()
            .map(
                |(id, source, target, binding_fields, evidence_artifact, predicate, authority)| {
                    json!({
                        "id": id,
                        "source": source,
                        "target": target,
                        "binding_fields": binding_fields,
                        "evidence_artifact": evidence_artifact,
                        "verification_predicate": predicate,
                        "authority": authority,
                    })
                },
            )
            .collect::<Vec<_>>();
        let presentation_sha256 = sha256_base64url(presentation);
        let result_sha256 = sha256_base64url(result_bytes);
        let session_id = result.attestation_session_id().to_string();
        let binding_sha256 = sha256_base64url(result.binding_value().as_bytes());
        let binding_nonce_sha256 =
            sha256_base64url(URL_SAFE_NO_PAD.encode(result.binding_nonce()).as_bytes());
        let notary_key_sha256 = sha256_base64url(notary_key);
        let member_identity = if let Some((_, response_digest)) = result.full_transcript_sha256() {
            json!({
                "verified_member_id": result.verified_member_id(),
                "response_transcript_sha256": URL_SAFE_NO_PAD.encode(response_digest),
            })
        } else {
            json!({
                "verified_member_id": result.verified_member_id(),
                "revealed_response_ranges": super::super::revealed_ranges_value(
                    result.revealed_response_ranges()
                ),
            })
        };
        let member_authority = if result.is_sparse() {
            "fusou-require-info-v2-sparse-response-parser"
        } else {
            "fusou-require-info-v1-response-parser"
        };
        let proxy_identity = |field: &str| proxy.get(field).cloned().unwrap_or(Value::Null);
        let node_specs = [
            (
                "authenticated-user",
                "authenticated_user",
                "supabase-authenticated-user",
                "authenticated_user",
                json!({"user_id": FIXTURE_USER_ID}),
            ),
            (
                "device",
                "device",
                "fusou-web-user-devices",
                "device_identity",
                json!({
                    "user_id": FIXTURE_USER_ID,
                    "device_id": FIXTURE_DEVICE_ID,
                    "public_key_sha256": device_public_key_sha256,
                }),
            ),
            (
                "device-authentication",
                "device_authentication",
                "fusou-web-device-authentication",
                "device_authentication",
                json!({"device_id": FIXTURE_DEVICE_ID, "nonce": "ab".repeat(32)}),
            ),
            (
                "session",
                "session",
                "fusou-tlsn-session-authority",
                "session",
                json!({
                    "session_id": session_id,
                    "key_id": "fixture-session-authority",
                    "binding_sha256": binding_sha256,
                }),
            ),
            (
                "binding",
                "binding",
                "fusou-tlsn-binding-authority",
                "consume_receipt",
                json!({
                    "binding_sha256": binding_sha256,
                    "nonce_sha256": binding_nonce_sha256,
                }),
            ),
            (
                "presentation",
                "presentation",
                "tlsn-alpha15-verifier",
                "presentation",
                json!({
                    "presentation_sha256": presentation_sha256,
                    "attestation_id": URL_SAFE_NO_PAD.encode(result.tlsn_attestation_id()),
                    "binding_sha256": binding_sha256,
                }),
            ),
            (
                "member-id",
                "member_id",
                member_authority,
                "semantic_verification",
                member_identity,
            ),
            (
                "tlsn-notary",
                "notary",
                "tlsn-alpha15-presentation-notary-key",
                "notary_registry",
                json!({
                    "key_id": "fixture-notary",
                    "key_sha256": notary_key_sha256,
                }),
            ),
            (
                "result-registry-root",
                "result_registry_root",
                "fusou-result-registry-root",
                "result_registry_envelope",
                json!({
                    "key_id": "fixture-root",
                    "public_key_spki": root_public_key_spki,
                }),
            ),
            (
                "result-registry",
                "result_registry",
                "fusou-result-signing-key-registry",
                "result_registry",
                json!({
                    "registry_sha256": registry_sha256,
                    "envelope_sha256": envelope_sha256,
                }),
            ),
            (
                "result",
                "result",
                "fusou-tlsn-result-signer",
                "result",
                json!({
                    "result_sha256": result_sha256,
                    "key_id": "fixture-result-signer",
                }),
            ),
            (
                "production-proxy",
                "proxy_provenance",
                "externally-pinned-production-proxy-provenance-authority",
                "capture_metadata",
                json!({
                    "declared": proxy_identity("declared"),
                    "cryptographic_status": proxy_identity("cryptographic_status"),
                    "proxy_identity": proxy_identity("proxy_identity"),
                    "proxy_deployment_id": proxy_identity("proxy_deployment_id"),
                    "proxy_binary_identity": proxy_identity("proxy_binary_identity"),
                }),
            ),
            (
                "production-evidence",
                "evidence_manifest",
                "production-evidence-signer",
                "health",
                json!({"capture_id": "33333333-3333-4333-8333-333333333333"}),
            ),
            (
                "remote-attestation",
                "remote_attestation",
                "remote-attestation-signer",
                "health",
                json!({"status": "UNVERIFIED"}),
            ),
        ];
        let nodes = node_specs
            .into_iter()
            .map(|(id, node_type, authority, evidence_artifact, identity)| {
                json!({
                    "id": id,
                    "type": node_type,
                    "authority": authority,
                    "evidence_artifact": evidence_artifact,
                    "identity": identity,
                })
            })
            .collect::<Vec<_>>();
        json!({"schema_version": 2, "nodes": nodes, "edges": edges})
    }

    struct SyntheticBundleFixture {
        root: PathBuf,
        candidate_files: BTreeMap<String, Vec<u8>>,
        external_files: BTreeMap<String, Vec<u8>>,
        manifest_fields: Value,
        options: BundleVerifierOptions,
    }

    impl SyntheticBundleFixture {
        async fn new() -> Self {
            Self::new_with_disclosure(false).await
        }

        async fn new_sparse() -> Self {
            Self::new_with_disclosure(true).await
        }

        async fn new_with_disclosure(sparse_disclosure: bool) -> Self {
            let generated = crate::prover_transport::tests::build_synthetic_presentation(
                FIXTURE_SERVER_IDENTITY,
                sparse_disclosure,
            )
            .await;
            let root_key = signing_key(11);
            let result_key = signing_key(12);
            let session_key = signing_key(13);
            let binding_key = signing_key(14);
            let device_key = signing_key(15);
            let root_public_key_spki = public_key_spki(&root_key);
            let result_public_key_spki = public_key_spki(&result_key);
            let session_public_key_spki = public_key_spki(&session_key);
            let binding_public_key_spki = public_key_spki(&binding_key);
            let device_public_key = device_key.public_key().as_ref().to_vec();
            let device_public_key_base64 = URL_SAFE_NO_PAD.encode(&device_public_key);

            let inventory = json!({
                "schema_version": 1,
                "source": "packages/configs/configs.toml:[app.connect_kc_server.server_list]",
                "targets": (1..=20).map(|index| json!({
                    "server_index": index,
                    "server_identity": format!("server{index:02}.fusou-data.net"),
                    "port": 443,
                })).collect::<Vec<_>>(),
            });
            let inventory_raw = serde_json::to_vec(&inventory).unwrap();
            let inventory_sha256 = crate::sha256(&inventory_raw);
            let approval = json!({
                "schema_version": 1,
                "authority_model": "FUSOU_DEPLOYMENT_OPERATOR",
                "environment": "production",
                "status": "APPROVED",
                "inventory_sha256": URL_SAFE_NO_PAD.encode(inventory_sha256),
                "targets": ["server01.fusou-data.net", "server02.fusou-data.net"],
                "approved_at": FIXTURE_TIME,
            });
            let approval_raw = super::super::serialize_target_approval_record(&approval).unwrap();
            let approval_sha256 = crate::sha256(&approval_raw);
            let profile_sha256 = [0x11_u8; 32];
            let authenticated = crate::tlsn_alpha15::
                verify_alpha15_presentation_with_trusted_notary_key_and_trust_anchor(
                    &generated.presentation,
                    &generated.trust_anchor_der,
                    &generated.notary_key,
                )
                .unwrap();
            let profile = crate::tlsn_alpha15::RequireInfoDisclosureProfile::from_server_identity(
                FIXTURE_SERVER_IDENTITY,
            )
            .unwrap();
            let require_info = if sparse_disclosure {
                let sparse_profile =
                    crate::tlsn_alpha15::SparseRequireInfoDisclosureProfile::from_server_identity(
                        FIXTURE_SERVER_IDENTITY,
                    )
                    .unwrap();
                authenticated
                    .verify_require_info_sparse(&sparse_profile, &crate::ParserLimits::default())
                    .unwrap()
            } else {
                authenticated
                    .verify_require_info(&profile, &crate::ParserLimits::default())
                    .unwrap()
            };
            let mut result = if sparse_disclosure {
                assert!(
                    require_info.response_transcript_sha256.is_none(),
                    "sparse Presentation must leave at least one response range undisclosed"
                );
                ParsedVerifierResult::Sparse(
                    crate::sparse_result::SparseVerifierResult::from_authenticated(
                        &require_info,
                        profile_sha256,
                        "fixture-verifier".to_owned(),
                        "fixture-notary".to_owned(),
                        crate::sha256(&generated.notary_key),
                        crate::sha256(&generated.presentation),
                        Some(inventory_sha256),
                        Some(approval_sha256),
                        FIXTURE_USER_ID.to_owned(),
                        FIXTURE_DEVICE_ID.to_owned(),
                        [9_u8; 32],
                        [0_u8; 64],
                    )
                    .unwrap(),
                )
            } else {
                ParsedVerifierResult::Complete(
                    require_info
                        .into_verifier_result(
                            profile_sha256,
                            "fixture-verifier".to_owned(),
                            "fixture-notary".to_owned(),
                            FIXTURE_USER_ID.to_owned(),
                            FIXTURE_DEVICE_ID.to_owned(),
                            [9_u8; 32],
                            crate::sha256(&generated.presentation),
                            Some(inventory_sha256),
                            Some(approval_sha256),
                            [0_u8; 64],
                        )
                        .unwrap(),
                )
            };
            let signature = result_key
                .sign(&result.view().signing_bytes().unwrap())
                .as_ref()
                .try_into()
                .unwrap();
            match &mut result {
                ParsedVerifierResult::Complete(result) => result.signature = signature,
                ParsedVerifierResult::Sparse(result) => result.signature = signature,
            }
            let result_raw = match &result {
                ParsedVerifierResult::Complete(result) => result.canonical_json().unwrap(),
                ParsedVerifierResult::Sparse(result) => result.canonical_json().unwrap(),
            }
            .into_bytes();
            let result_value: Value = serde_json::from_slice(&result_raw).unwrap();
            let result = result.view();

            let registry = json!({
                "schema_version": 1,
                "scope": "tlsn-result-signing-key-registry",
                "keys": [{
                    "key_id": "fixture-result-signer",
                    "public_key_spki": result_public_key_spki,
                    "status": "ACTIVE",
                    "not_before": "2026-10-01T00:00:00.000Z",
                    "not_after": Value::Null,
                }],
            });
            let registry_raw = serde_json::to_vec(&registry).unwrap();
            let mut envelope = json!({
                "schema_version": 1,
                "scope": "fusou-result-signing-key-registry-envelope",
                "signature_algorithm": "Ed25519",
                "root_key_id": "fixture-root",
                "root_public_key_spki": root_public_key_spki,
                "registry_sha256": sha256_base64url(&registry_raw),
                "registry": registry,
            });
            envelope["signature_base64url"] = Value::String(sign_bytes(
                &root_key,
                canonical_json(&super::super::envelope_payload(&envelope).unwrap())
                    .unwrap()
                    .as_bytes(),
            ));
            let envelope_raw = serde_json::to_vec(&envelope).unwrap();
            let result_registry_hash = sha256_base64url(&registry_raw);
            let result_registry_envelope_hash = sha256_base64url(&envelope_raw);

            let session_registry = json!({
                "schema_version": 1,
                "scope": "tlsn-session-authority-key-registry",
                "keys": [{
                    "key_id": "fixture-session-authority",
                    "public_key_spki": session_public_key_spki,
                    "status": "ACTIVE",
                    "not_before": "2026-10-01T00:00:00.000Z",
                    "not_after": Value::Null,
                }],
            });
            let session_registry_raw = serde_json::to_vec(&session_registry).unwrap();
            let binding_registry = json!({
                "schema_version": 1,
                "scope": "tlsn-binding-authority-key-registry",
                "keys": [{
                    "key_id": "fixture-binding-authority",
                    "public_key_spki": binding_public_key_spki,
                    "status": "ACTIVE",
                    "not_before": "2026-10-01T00:00:00.000Z",
                    "not_after": Value::Null,
                }],
            });
            let binding_registry_raw = serde_json::to_vec(&binding_registry).unwrap();

            let notary_registry = json!({
                "fixture-notary": URL_SAFE_NO_PAD.encode(&generated.notary_key),
            });
            let notary_registry_raw = serde_json::to_vec(&notary_registry).unwrap();
            let binding = result.binding_value().to_owned();
            let session_id = result.attestation_session_id().to_string();
            let challenge = URL_SAFE_NO_PAD.encode(result.binding_nonce());
            let device_challenge = URL_SAFE_NO_PAD.encode(result.device_challenge());
            let auth_nonce = "ab".repeat(32);

            let mut session_receipt = json!({
                "schema_version": 1,
                "type": "attestation-session-issued",
                "signature_algorithm": "Ed25519",
                "signer_key_id": "fixture-session-authority",
                "session_id": session_id,
                "canonical_user_id": FIXTURE_USER_ID,
                "device_id": FIXTURE_DEVICE_ID,
                "device_auth_nonce": auth_nonce,
                "nonce": challenge,
                "device_challenge": device_challenge,
                "binding_value": binding,
                "created_at": FIXTURE_TIME,
                "expires_at": FIXTURE_SESSION_EXPIRY,
            });
            session_receipt = signed_authority_receipt(
                session_receipt,
                &session_key,
                super::super::session_receipt_signing_bytes,
            );
            let session = json!({
                "session_id": result.attestation_session_id().to_string(),
                "device_id": FIXTURE_DEVICE_ID,
                "binding": result.binding_value(),
                "challenge": URL_SAFE_NO_PAD.encode(result.binding_nonce()),
                "device_challenge": URL_SAFE_NO_PAD.encode(result.device_challenge()),
                "expires_at": FIXTURE_SESSION_EXPIRY,
                "session_receipt": session_receipt,
            });
            let session_raw = serde_json::to_vec(&session).unwrap();

            let mut consume_receipt = json!({
                "schema_version": 1,
                "type": "attestation-binding-consumed",
                "signature_algorithm": "Ed25519",
                "signer_key_id": "fixture-binding-authority",
                "session_id": result.attestation_session_id().to_string(),
                "canonical_user_id": FIXTURE_USER_ID,
                "device_id": FIXTURE_DEVICE_ID,
                "nonce": URL_SAFE_NO_PAD.encode(result.binding_nonce()),
                "binding_value": result.binding_value(),
                "presentation_id": sha256_base64url(&generated.presentation),
                "used_at": FIXTURE_TIME,
            });
            consume_receipt = signed_authority_receipt(
                consume_receipt,
                &binding_key,
                super::super::consume_receipt_signing_bytes,
            );
            let consume_receipt_raw = serde_json::to_vec(&consume_receipt).unwrap();

            let auth_signature = sign_bytes(&device_key, auth_nonce.as_bytes());
            let device_authentication = json!({
                "request": {
                    "nonce": auth_nonce,
                    "device_id": FIXTURE_DEVICE_ID,
                    "sig": auth_signature,
                },
                "worker_acceptance": {
                    "status": 201,
                    "device_id": FIXTURE_DEVICE_ID,
                    "session_id": result.attestation_session_id().to_string(),
                },
            });
            let device_authentication_raw = serde_json::to_vec(&device_authentication).unwrap();
            let possession_signing_bytes = super::super::device_possession_signing_bytes(
                FIXTURE_DEVICE_ID,
                &result.attestation_session_id().to_string(),
                result.binding_value(),
                &URL_SAFE_NO_PAD.encode(result.device_challenge()),
            )
            .unwrap();
            let replay_digest = sha256_base64url(&possession_signing_bytes);
            let replay_digest_hex = super::super::hex_digest(&possession_signing_bytes);
            let possession_proof = json!({
                "device_id": FIXTURE_DEVICE_ID,
                "session_id": result.attestation_session_id().to_string(),
                "binding_value": result.binding_value(),
                "challenge": URL_SAFE_NO_PAD.encode(result.device_challenge()),
                "sig": sign_bytes(&device_key, &possession_signing_bytes),
                "replay_digest": replay_digest,
                "message_sha256": replay_digest,
                "replay_digest_hex": replay_digest_hex,
                "message_sha256_hex": replay_digest_hex,
            });
            let possession_proof_raw = serde_json::to_vec(&possession_proof).unwrap();
            let authority_observation = json!({
                "canonical_user_id": FIXTURE_USER_ID,
                "device_id": FIXTURE_DEVICE_ID,
                "proof_kind": "possession",
                "proof_digest": replay_digest_hex,
                "session_id": result.attestation_session_id().to_string(),
                "binding_sha256": super::super::hex_digest(result.binding_value().as_bytes()),
                "challenge_sha256": super::super::hex_digest(result.device_challenge()),
                "consumed_at": FIXTURE_TIME,
            });
            let replay_response = json!({
                "error": "device_proof_replayed",
                "stored_proof": authority_observation.clone(),
            });
            let replay_response_bytes = serde_json::to_vec(&replay_response).unwrap();
            let replay = json!({
                "schema_version": 1,
                "observation_type": "tlsn-device-proof-replay-observation",
                "observation_source": "authenticated_web_read_only_observation",
                "authority_observation_signed": false,
                "session_id": result.attestation_session_id().to_string(),
                "device_id": FIXTURE_DEVICE_ID,
                "binding": result.binding_value(),
                "replay_digest": replay_digest,
                "replay_digest_hex": replay_digest_hex,
                "stored_replay_digest_hex": replay_digest_hex,
                "status": 409,
                "error": "device_proof_replayed",
                "consume_receipt_presentation_id": sha256_base64url(&generated.presentation),
                "response_body_base64url": URL_SAFE_NO_PAD.encode(&replay_response_bytes),
                "response_body_byte_length": replay_response_bytes.len(),
                "response_body_sha256": sha256_base64url(&replay_response_bytes),
                "response_body_sha256_hex": super::super::hex_digest(&replay_response_bytes),
                "authority_observation": authority_observation,
            });
            let replay_raw = serde_json::to_vec(&replay).unwrap();
            let authenticated_user = json!({
                "authoritative": true,
                "authority": "supabase-authenticated-user",
                "user_id": FIXTURE_USER_ID,
            });
            let device_identity = json!({
                "authoritative": true,
                "authority": "fusou-web-user-devices",
                "canonical_user_id": FIXTURE_USER_ID,
                "device_id": FIXTURE_DEVICE_ID,
                "device_public_key": device_public_key_base64,
                "device_public_key_sha256": sha256_base64url(&device_public_key),
                "revoked_at": Value::Null,
            });
            let authenticated_user_raw = serde_json::to_vec(&authenticated_user).unwrap();
            let device_identity_raw = serde_json::to_vec(&device_identity).unwrap();
            let semantic_predicates = json!({
                "presentation_cryptography": {"status": "PASS"},
                "notary_identity": {"status": "PASS"},
                "server_identity": {"status": "PASS"},
                "require_info_http_profile": {"status": "PASS"},
                "presentation_binding_to_session": {"status": "PASS"},
                "authenticated_member_id": {"status": "PASS"},
                "result_presentation_binding": {"status": "PASS"},
                "result_registry_root_authentication": {"status": "PASS"},
                "result_signature": {"status": "PASS"},
                "result_key_publication": {"status": "PASS"},
                "trust_root_publication": {"status": "PASS"},
            });
            let unsigned_result: Value =
                serde_json::from_str(&result.unsigned_canonical_json().unwrap()).unwrap();
            let mut derived_from_presentation = json!({
                "presentation_sha256": sha256_base64url(&generated.presentation),
                "tlsn_attestation_id": URL_SAFE_NO_PAD.encode(result.tlsn_attestation_id()),
                "server_identity": result.server_identity(),
                "notary_key_sha256": sha256_base64url(&generated.notary_key),
                "verified_member_id": result.verified_member_id(),
                "request_transcript_size": result.request_transcript_size().to_string(),
                "response_transcript_size": result.response_transcript_size().to_string(),
                "revealed_request_ranges": super::super::revealed_ranges_value(
                    result.revealed_request_ranges()
                ),
                "revealed_response_ranges": super::super::revealed_ranges_value(
                    result.revealed_response_ranges()
                ),
            });
            if let Some((request_digest, response_digest)) = result.full_transcript_sha256() {
                derived_from_presentation["request_transcript_sha256"] =
                    Value::String(URL_SAFE_NO_PAD.encode(request_digest));
                derived_from_presentation["response_transcript_sha256"] =
                    Value::String(URL_SAFE_NO_PAD.encode(response_digest));
            }
            let semantic_verification = json!({
                "schema_version": 2,
                "kind": "tlsn-production-semantic-verification",
                "status": "VERIFIED",
                "verifier_identity": "fixture-independent-verifier",
                "verified_at": FIXTURE_TIME,
                "input": {
                    "presentation_sha256": sha256_base64url(&generated.presentation),
                    "presentation_size_bytes": generated.presentation.len(),
                },
                "semantic_result": unsigned_result,
                "derived_from_presentation": derived_from_presentation,
                "http_profile": {
                    "request_method": "POST",
                    "request_target": crate::REQUIRE_INFO_TARGET,
                    "request_http_version": "HTTP/1.1",
                    "response_status_line": "HTTP/1.1 200 OK",
                    "response_member_path": "svdata.api_data.api_basic.api_member_id",
                    "host": FIXTURE_SERVER_IDENTITY,
                },
                "predicates": semantic_predicates,
            });
            let semantic_raw = serde_json::to_vec(&semantic_verification).unwrap();

            let proxy_provenance = json!({
                "declared": "production",
                "cryptographic_status": "UNVERIFIED",
                "presentation_sha256": sha256_base64url(&generated.presentation),
                "created_at": FIXTURE_TIME,
                "authority": {
                    "type": "externally-pinned-production-proxy-key",
                    "status": "UNVERIFIED",
                },
                "capture_context": {
                    "method": "POST",
                    "target": crate::REQUIRE_INFO_TARGET,
                    "http_version": "HTTP/1.1",
                },
                "proxy_identity": Value::Null,
                "proxy_deployment_id": Value::Null,
                "proxy_binary_identity": Value::Null,
            });
            let capture_metadata = json!({
                "capture_provenance": "production",
                "capture_source": "fusou-proxy-production-tlsn",
                "synthetic": false,
                "test": false,
                "canary": false,
                "local": false,
                "request": {
                    "method": "POST",
                    "target": crate::REQUIRE_INFO_TARGET,
                    "http_version": "HTTP/1.1",
                },
                "presentation_sha256": sha256_base64url(&generated.presentation),
                "proxy_provenance": proxy_provenance,
            });
            let capture_metadata_raw = serde_json::to_vec(&capture_metadata).unwrap();

            let result_identity = json!({
                "result_public_key_spki": result_public_key_spki,
                "result_signer_key_id": "fixture-result-signer",
                "result_key_registry_sha256": result_registry_hash,
                "result_key_registry_envelope_sha256": result_registry_envelope_hash,
                "result_registry_root_key_id": "fixture-root",
                "result_registry_root_public_key_spki": root_public_key_spki,
            });
            let security_identity = json!({
                "git_commit_sha": "0123456789abcdef0123456789abcdef01234567",
                "trust_contract_valid": true,
                "server_identity": FIXTURE_SERVER_IDENTITY,
                "profile_sha256": URL_SAFE_NO_PAD.encode(profile_sha256),
                "verifier_key_id": "fixture-verifier",
                "notary_key_id": "fixture-notary",
                "notary_registry_sha256": sha256_base64url(&notary_registry_raw),
            });
            let authority_identity = json!({
                "session_authority": {
                    "authority": "fusou-tlsn-session-authority",
                    "key_id": "fixture-session-authority",
                    "public_key_spki": session_public_key_spki,
                    "key_registry_sha256": sha256_base64url(&session_registry_raw),
                },
                "binding_authority": {
                    "authority": "fusou-tlsn-binding-authority",
                    "key_id": "fixture-binding-authority",
                    "public_key_spki": binding_public_key_spki,
                    "key_registry_sha256": sha256_base64url(&binding_registry_raw),
                },
            });
            let health = json!({
                "schema_version": 3,
                "ok": true,
                "verifier": "tlsn-alpha15-wasm",
                "environment": "production",
                "auth_mode": "supabase",
                "device_auth_mode": "external-endpoint",
                "deployment_role": "canary",
                "git_commit_sha": "0123456789abcdef0123456789abcdef01234567",
                "deployment_id": "fixture-deployment",
                "verifier_key_id": "fixture-verifier",
                "notary_key_id": "fixture-notary",
                "profile_sha256": URL_SAFE_NO_PAD.encode(profile_sha256),
                "notary_registry_sha256": sha256_base64url(&notary_registry_raw),
                "result_public_key_spki": result_public_key_spki,
                "runtime_version": {
                    "version_id": "4b064508-1cdb-453c-826b-bdea36a8b1e5",
                },
                "binding_mode": "fixed_canary",
                "execution_mode": "sync",
                "result_identity": result_identity,
                "security_identity": security_identity,
                "deployment_identity": {
                    "deployment_id": "fixture-deployment",
                    "deployment_role": "canary",
                    "binding_mode": "fixed_canary",
                    "worker_name": "fixture-worker",
                },
                "authority_identity": authority_identity,
            });
            let health_raw = serde_json::to_vec(&health).unwrap();
            let trust_graph = fixture_trust_graph(
                result,
                &generated.presentation,
                &result_raw,
                &result_registry_hash,
                &result_registry_envelope_hash,
                &root_public_key_spki,
                &generated.notary_key,
                device_identity["device_public_key_sha256"]
                    .as_str()
                    .unwrap(),
                &capture_metadata["proxy_provenance"],
            );
            let manifest_fields = json!({
                "result_identity": result_identity,
                "security_identity": security_identity,
                "trust_graph": trust_graph,
            });

            let mut candidate_files = BTreeMap::new();
            candidate_files.insert("presentation.bin".to_owned(), generated.presentation);
            candidate_files.insert("result.json".to_owned(), result_raw);
            candidate_files.insert(
                "result-exact.bin".to_owned(),
                serde_json::to_vec(&json!({
                    "verified": true,
                    "result": result_value,
                    "consume_receipt": consume_receipt,
                    "device_replay_digest_hex": replay_digest_hex,
                }))
                .unwrap(),
            );
            candidate_files.insert(
                "worker-verification.json".to_owned(),
                serde_json::to_vec(&json!({
                    "verified": true,
                    "result": result_value,
                    "consume_receipt": consume_receipt,
                    "device_replay_digest_hex": replay_digest_hex,
                }))
                .unwrap(),
            );
            candidate_files.insert("session.json".to_owned(), session_raw);
            candidate_files.insert("possession-proof.json".to_owned(), possession_proof_raw);
            candidate_files.insert("consume-receipt.json".to_owned(), consume_receipt_raw);
            candidate_files.insert(
                "device-authentication.json".to_owned(),
                device_authentication_raw,
            );
            candidate_files.insert("metadata.json".to_owned(), capture_metadata_raw);
            candidate_files.insert("runtime-result-registry.json".to_owned(), registry_raw);
            candidate_files.insert(
                "runtime-result-registry-envelope.json".to_owned(),
                envelope_raw,
            );
            candidate_files.insert("worker-health.json".to_owned(), health_raw.clone());
            let execution_receipt = b"test-only candidate execution receipt bytes".to_vec();
            candidate_files.insert(
                "verifier-execution-receipt.bin".to_owned(),
                execution_receipt.clone(),
            );
            candidate_files.insert(
                "verifier-execution-receipt-header.txt".to_owned(),
                URL_SAFE_NO_PAD.encode(execution_receipt).into_bytes(),
            );

            let external_files = BTreeMap::from([
                ("notary_registry".to_owned(), notary_registry_raw.clone()),
                ("health".to_owned(), health_raw),
                ("authenticated_user".to_owned(), authenticated_user_raw),
                ("device_identity".to_owned(), device_identity_raw),
                (
                    "session_authority_registry".to_owned(),
                    session_registry_raw.clone(),
                ),
                (
                    "binding_authority_registry".to_owned(),
                    binding_registry_raw.clone(),
                ),
                ("replay".to_owned(), replay_raw),
                ("semantic_verification".to_owned(), semantic_raw),
                ("trust_root".to_owned(), generated.trust_anchor_der.clone()),
            ]);
            let options = BundleVerifierOptions {
                evidence_root_key_id: "fixture-root".to_owned(),
                evidence_root_public_key_spki: public_key_spki(&root_key),
                trusted_notary_registry_raw: notary_registry_raw,
                session_authority_registry_raw: session_registry_raw,
                session_authority_key_id: "fixture-session-authority".to_owned(),
                session_authority_public_key_spki: session_public_key_spki,
                binding_authority_registry_raw: binding_registry_raw,
                binding_authority_key_id: "fixture-binding-authority".to_owned(),
                binding_authority_public_key_spki: binding_public_key_spki,
                canonical_user_id: FIXTURE_USER_ID.to_owned(),
                device_id: FIXTURE_DEVICE_ID.to_owned(),
                device_public_key: device_public_key_base64,
                server_identity: FIXTURE_SERVER_IDENTITY.to_owned(),
                origin_inventory_raw: inventory_raw,
                target_approval_raw: approval_raw,
                profile_sha256: URL_SAFE_NO_PAD.encode(profile_sha256),
                sparse_profile_sha256: sparse_disclosure
                    .then(|| URL_SAFE_NO_PAD.encode(profile_sha256)),
                verifier_key_id: "fixture-verifier".to_owned(),
                trust_anchor_der: generated.trust_anchor_der,
            };
            let root = std::env::temp_dir().join(format!(
                "fusou-19-role-finalization-{}",
                uuid::Uuid::new_v4()
            ));
            private_directory(&root).unwrap();
            let fixture = Self {
                root,
                candidate_files,
                external_files,
                manifest_fields,
                options,
            };
            fixture.write_candidate();
            fixture.write_material();
            fixture
        }

        fn candidate(&self) -> PathBuf {
            self.root.join("candidate")
        }

        fn material(&self) -> PathBuf {
            self.root.join("material")
        }

        fn output(&self, name: &str) -> PathBuf {
            self.root.join(name)
        }

        fn replay_observation(&self) -> PathBuf {
            self.root.join("replay-observation.json")
        }

        fn write_candidate(&self) {
            let path = self.candidate();
            if path.exists() {
                fs::remove_dir_all(&path).unwrap();
            }
            private_directory(&path).unwrap();
            for (name, bytes) in &self.candidate_files {
                fs::write(path.join(name), bytes).unwrap();
            }
            let artifacts = self
                .candidate_files
                .iter()
                .map(|(name, bytes)| {
                    (
                        name.clone(),
                        json!({
                            "size_bytes": bytes.len(),
                            "sha256": sha256_base64url(bytes),
                        }),
                    )
                })
                .collect::<serde_json::Map<_, _>>();
            let receipt_sha256 = artifacts
                .get("verifier-execution-receipt.bin")
                .map(|descriptor| descriptor["sha256"].clone())
                .unwrap_or_else(|| json!("missing"));
            let manifest = json!({
                "schema_version": 2,
                "scope": "fusou-tlsn-human-test-play-candidate",
                "synthetic_fixture": false,
                "capture_provenance": "production-proxy-capture",
                "candidate_status": "CAPTURED_PENDING_OFFLINE_VERIFICATION",
                "verifier_execution_receipt_status": "CAPTURED",
                "presentation_sha256": artifacts["presentation.bin"]["sha256"],
                "exact_result_sha256": artifacts["result-exact.bin"]["sha256"],
                "verifier_execution_receipt_sha256": receipt_sha256,
                "artifacts": artifacts,
            });
            fs::write(
                path.join("candidate-manifest.json"),
                serde_json::to_vec(&manifest).unwrap(),
            )
            .unwrap();
        }

        fn write_material(&self) {
            let path = self.material();
            if path.exists() {
                fs::remove_dir_all(&path).unwrap();
            }
            private_directory(&path).unwrap();
            let artifacts = self
                .external_files
                .iter()
                .map(|(role, bytes)| {
                    let filename = format!("{role}.bin");
                    fs::write(path.join(&filename), bytes).unwrap();
                    (
                        role.clone(),
                        json!({
                            "path": filename,
                            "artifact_sha256": sha256_base64url(bytes),
                            "byte_length": bytes.len(),
                            "provenance": "production",
                        }),
                    )
                })
                .collect::<serde_json::Map<_, _>>();
            let evidence_names = [
                "real_production_game_server_connection",
                "real_production_tlsn_notary_interaction",
                "real_production_tlsn_proxy_provenance",
                "real_production_fusou_web_device_authentication",
                "real_production_device_possession_proof",
                "real_production_replay_authority",
                "real_production_binding_authority",
                "real_production_session_authority",
                "real_production_binding_receipt_authority",
                "real_production_origin_web_pki_validation",
                "real_production_result_signing_key",
                "real_production_result_registry_authentication",
                "real_production_public_key_publication",
                "independently_captured_production_evidence",
            ];
            let evidence = evidence_names
                .into_iter()
                .map(|name| {
                    (
                        name.to_owned(),
                        json!({
                            "status": if name == "real_production_tlsn_proxy_provenance" {
                                "UNVERIFIED"
                            } else {
                                "PASS"
                            },
                            "required_artifacts": super::super::REQUIRED_ARTIFACT_NAMES,
                        }),
                    )
                })
                .collect::<serde_json::Map<_, _>>();
            let semantic_predicates = json!({
                "presentation_cryptography": {"status": "PASS"},
                "notary_identity": {"status": "PASS"},
                "server_identity": {"status": "PASS"},
                "require_info_http_profile": {"status": "PASS"},
                "presentation_binding_to_session": {"status": "PASS"},
                "authenticated_member_id": {"status": "PASS"},
                "result_presentation_binding": {"status": "PASS"},
                "result_registry_root_authentication": {"status": "PASS"},
                "result_signature": {"status": "PASS"},
                "result_key_publication": {"status": "PASS"},
                "trust_root_publication": {"status": "PASS"},
            });
            let device_predicates = json!({
                "device_identity_ownership": {"status": "PASS"},
                "device_authentication_signature": {"status": "PASS"},
                "session_binding_receipt": {"status": "PASS"},
                "tlsn_device_possession_signature": {"status": "PASS"},
                "binding_framing": {"status": "PASS"},
                "replay_digest": {"status": "PASS"},
                "consume_receipt": {"status": "PASS"},
            });
            let capture_predicates = json!({
                "proxy_provenance_cryptographic_authentication": {"status": "UNVERIFIED"},
            });
            let mut manifest = json!({
                "schema_version": 1,
                "scope": "tlsn-production-evidence",
                "status": "BLOCKED",
                "capture_status": "PASS",
                "verification_status": "NOT_CHECKED",
                "capture_provenance": "production",
                "production_evidence_status": "BLOCKED",
                "p0_05_status": "BLOCKED",
                "capture_id": "33333333-3333-4333-8333-333333333333",
                "capture_started_at": "2026-10-01T12:00:00.000Z",
                "capture_finished_at": "2026-10-01T12:00:01.000Z",
                "artifacts": artifacts,
                "evidence": evidence,
                "semantic_predicates": semantic_predicates,
                "device_predicates": device_predicates,
                "capture_predicates": capture_predicates,
                "semantic_verification": {
                    "status": "VERIFIED",
                    "artifact": "semantic_verification",
                    "verifier_identity": "fixture-independent-verifier",
                    "verified_at": FIXTURE_TIME,
                },
            });
            for (field, value) in self.manifest_fields.as_object().unwrap() {
                manifest[field] = value.clone();
            }
            fs::write(
                path.join("manifest.json"),
                serde_json::to_vec(&manifest).unwrap(),
            )
            .unwrap();
        }
    }

    impl Drop for SyntheticBundleFixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).expect("remove exact synthetic evidence fixture");
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
        let error =
            finalize_candidate(f.candidate(), f.material(), f.output(), &options()).unwrap_err();
        assert!(error.message.contains("evidence manifest"));
        assert!(!f.output().exists());
    }

    #[test]
    fn candidate_materials_are_forwarded_exactly_and_missing_roles_are_listed() {
        let f = Fixture::new();
        let candidate = f.read().unwrap();
        let supplied = candidate.supplied().unwrap();

        for (role, name) in [
            ("presentation", "presentation.bin"),
            ("result", "result.json"),
            ("session", "session.json"),
            ("possession_proof", "possession-proof.json"),
            ("consume_receipt", "consume-receipt.json"),
            ("device_authentication", "device-authentication.json"),
            ("capture_metadata", "metadata.json"),
            ("result_registry", "runtime-result-registry.json"),
            (
                "result_registry_envelope",
                "runtime-result-registry-envelope.json",
            ),
        ] {
            assert_eq!(supplied[role], candidate.bytes(name).unwrap());
        }

        let result = parse_result_profile(&supplied["result"]).unwrap();
        let result = result.view();
        let subject: Value = serde_json::from_slice(&supplied["subject"]).unwrap();
        let session_id = result.attestation_session_id().to_string();
        for (field, value) in [
            (
                "canonical_user_id_sha256",
                result.canonical_user_id().as_bytes(),
            ),
            ("device_id_sha256", result.canonical_device_id().as_bytes()),
            ("attestation_session_id_sha256", session_id.as_bytes()),
            (
                "verified_member_id_sha256",
                result.verified_member_id().as_bytes(),
            ),
            ("binding_value_sha256", result.binding_value().as_bytes()),
        ] {
            assert_eq!(subject[field], sha256_base64url(value));
        }

        for external_role in [
            "notary_registry",
            "health",
            "authenticated_user",
            "device_identity",
            "replay",
            "session_authority_registry",
            "binding_authority_registry",
            "semantic_verification",
            "trust_root",
        ] {
            assert!(!supplied.contains_key(external_role));
        }

        fs::write(f.material().join("manifest.json"), br#"{"artifacts":{}}"#).unwrap();
        let loaded =
            load_bundle_with_artifacts(&f.material(), &supplied, |path| fs::read(path)).unwrap();
        assert_eq!(loaded.artifacts.len(), supplied.len());
        for (name, bytes) in &supplied {
            assert_eq!(loaded.artifacts[name].bytes, *bytes);
            assert_eq!(
                loaded.manifest["artifacts"][name]["artifact_sha256"],
                sha256_base64url(bytes)
            );
        }
        let missing = super::super::REQUIRED_ARTIFACT_NAMES
            .iter()
            .copied()
            .filter(|role| !supplied.contains_key(*role))
            .collect::<Vec<_>>();
        let error = super::super::require_bundle_artifacts(&loaded).unwrap_err();
        assert_eq!(
            error.message,
            format!(
                "required evidence roles are missing: {}",
                missing.join(", ")
            )
        );
    }

    #[test]
    fn candidate_result_registry_material_must_be_a_complete_pair_at_finalize_entry() {
        let f = Fixture::new();
        fs::remove_file(f.candidate().join("runtime-result-registry-envelope.json")).unwrap();
        f.refresh_manifest();
        f.write_diagnostic_material();

        let error =
            finalize_candidate(f.candidate(), f.material(), f.output(), &options()).unwrap_err();
        assert!(error
            .message
            .contains("Result registry and envelope materials must be present together"));
        assert!(!f.output().exists());
    }

    #[test]
    fn finalize_entry_reports_all_missing_external_roles_in_stable_order() {
        let f = Fixture::new();
        f.write_diagnostic_material();

        let error =
            finalize_candidate(f.candidate(), f.material(), f.output(), &options()).unwrap_err();
        assert_eq!(error.edge, "artifact_manifest");
        assert_eq!(
            error.message,
            "required evidence roles are missing: notary_registry, health, authenticated_user, device_identity, replay, session_authority_registry, binding_authority_registry, trust_root"
        );
        assert!(!f.output().exists());
    }

    #[test]
    fn finalize_entry_reports_missing_result_registry_pair_roles() {
        let f = Fixture::new();
        for name in [
            "runtime-result-registry.json",
            "runtime-result-registry-envelope.json",
        ] {
            fs::remove_file(f.candidate().join(name)).unwrap();
        }
        f.refresh_manifest();
        f.write_diagnostic_material();

        let error =
            finalize_candidate(f.candidate(), f.material(), f.output(), &options()).unwrap_err();
        assert_eq!(
            error.message,
            "required evidence roles are missing: result_registry, result_registry_envelope, notary_registry, health, authenticated_user, device_identity, replay, session_authority_registry, binding_authority_registry, trust_root"
        );
        assert!(!f.output().exists());
    }

    #[test]
    fn malformed_unknown_manifest_dependency_is_not_reported_as_missing_roles() {
        let f = Fixture::new();
        f.write_diagnostic_material();
        let manifest_path = f.material().join("manifest.json");
        let mut manifest: Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["evidence"]["independently_captured_production_evidence"]["required_artifacts"]
            .as_array_mut()
            .unwrap()
            .push(Value::String("undeclared-material".to_owned()));
        fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();

        let error =
            finalize_candidate(f.candidate(), f.material(), f.output(), &options()).unwrap_err();
        assert_eq!(error.edge, "evidence_contract");
        assert!(error.message.contains("missing an artifact"));
        assert!(error.message.contains("undeclared-material"));
        assert!(!f.output().exists());
    }

    #[test]
    fn external_authentication_cannot_belong_to_another_capture() {
        let f = Fixture::new();
        f.write_material(json!({"request": {"nonce": "other"}}));
        let error =
            finalize_candidate(f.candidate(), f.material(), f.output(), &options()).unwrap_err();
        assert!(error.message.contains("artifact SHA-256 does not match"));
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

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn synthetic_nineteen_role_bundle_finalizes_publishes_and_reverifies() {
        let mut fixture = SyntheticBundleFixture::new().await;
        let original_candidate = fixture.candidate_files.clone();
        let original_external = fixture.external_files.clone();
        let replay_observation = fixture.replay_observation();
        fs::write(&replay_observation, &original_external["replay"]).unwrap();
        fixture.external_files.remove("health");
        fixture.external_files.remove("replay");
        fixture.external_files.remove("semantic_verification");
        fixture.write_material();
        run_node_semantic_contract("prepare", &fixture.material().join("manifest.json"));
        let material_manifest: Value =
            serde_json::from_slice(&fs::read(fixture.material().join("manifest.json")).unwrap())
                .unwrap();
        assert_eq!(material_manifest["verification_status"], "NOT_CHECKED");

        let report = finalize_candidate_with_replay_observation(
            fixture.candidate(),
            fixture.material(),
            Some(&replay_observation),
            fixture.output("success"),
            &fixture.options,
        )
        .unwrap();
        assert_eq!(report["status"], "VERIFIED");

        let output = fixture.output("success");
        let manifest: Value =
            serde_json::from_slice(&fs::read(output.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest["verification_status"], "VERIFIED");
        assert_eq!(manifest["status"], "BLOCKED");
        assert_eq!(manifest["production_evidence_status"], "BLOCKED");
        assert_eq!(manifest["p0_05_status"], "BLOCKED");
        assert_eq!(manifest["semantic_verification"]["status"], "VERIFIED");
        assert_eq!(
            manifest["semantic_verification"]["source"],
            "offline_finalizer"
        );
        assert_eq!(
            manifest["artifacts"]["semantic_verification"]["provenance"],
            "offline_finalizer"
        );
        let semantic_raw = fs::read(output.join("artifacts/semantic_verification.bin")).unwrap();
        let semantic: Value = serde_json::from_slice(&semantic_raw).unwrap();
        assert_eq!(semantic["generation_origin"], "offline_finalizer");
        assert_eq!(
            manifest["semantic_verification"]["verifier_identity"],
            semantic["verifier_identity"]
        );
        assert_eq!(
            manifest["semantic_verification"]["verified_at"],
            semantic["verified_at"]
        );

        let candidate =
            Candidate::read(&fixture.candidate(), &mut ReadBudget(MAX_INPUT_BYTES)).unwrap();
        let mut expected = candidate.supplied().unwrap();
        expected.extend(fixture.external_files.clone());
        expected.insert("replay".to_owned(), original_external["replay"].clone());
        expected.insert("semantic_verification".to_owned(), semantic_raw);
        assert_eq!(expected.len(), super::super::REQUIRED_ARTIFACT_NAMES.len());
        for role in super::super::REQUIRED_ARTIFACT_NAMES {
            let bytes = &expected[role];
            assert_eq!(
                fs::read(output.join(format!("artifacts/{role}.bin"))).unwrap(),
                *bytes
            );
            let descriptor = &manifest["artifacts"][role];
            assert_eq!(descriptor["byte_length"].as_u64(), Some(bytes.len() as u64));
            assert_eq!(descriptor["artifact_sha256"], sha256_base64url(bytes));
        }

        let verification = crate::evidence_bundle::verify_bundle(&output, &fixture.options)
            .expect("published Bundle must pass the ordinary independent verifier");
        assert_eq!(verification["status"], "VERIFIED");
        run_node_semantic_contract("validate", &output);

        fixture.external_files = original_external.clone();
        fixture
            .external_files
            .insert("replay".to_owned(), b"mismatched replay".to_vec());
        fixture.write_material();
        let replay_mismatch_output = fixture.output("replay-mismatch");
        assert!(finalize_candidate_with_replay_observation(
            fixture.candidate(),
            fixture.material(),
            Some(&replay_observation),
            &replay_mismatch_output,
            &fixture.options,
        )
        .is_err());
        assert!(!replay_mismatch_output.exists());

        fixture.candidate_files = original_candidate.clone();
        fixture.candidate_files.remove("worker-health.json");
        fixture.write_candidate();
        fixture.external_files = original_external.clone();
        fixture.write_material();
        let external_fallback_output = fixture.output("external-health-fallback");
        finalize_candidate(
            fixture.candidate(),
            fixture.material(),
            &external_fallback_output,
            &fixture.options,
        )
        .expect("existing external health material must remain supported");
        assert_eq!(
            fs::read(external_fallback_output.join("artifacts/health.bin")).unwrap(),
            original_external["health"],
        );
        crate::evidence_bundle::verify_bundle(&external_fallback_output, &fixture.options)
            .expect("external health fallback must pass the independent verifier");

        fixture.external_files = original_external.clone();
        let mut invalid_semantic: Value =
            serde_json::from_slice(&fixture.external_files["semantic_verification"]).unwrap();
        invalid_semantic["predicates"]["presentation_cryptography"]["status"] =
            Value::String("FAIL".to_owned());
        fixture.external_files.insert(
            "semantic_verification".to_owned(),
            serde_json::to_vec(&invalid_semantic).unwrap(),
        );
        fixture.write_material();
        let invalid_external_semantic_output = fixture.output("invalid-external-semantic");
        assert!(finalize_candidate(
            fixture.candidate(),
            fixture.material(),
            &invalid_external_semantic_output,
            &fixture.options,
        )
        .is_err());
        assert!(!invalid_external_semantic_output.exists());

        fixture.candidate_files = original_candidate.clone();
        fixture.candidate_files.remove("worker-health.json");
        fixture.write_candidate();
        fixture.external_files = original_external.clone();
        fixture.external_files.remove("health");
        fixture.external_files.remove("semantic_verification");
        fixture.write_material();
        let missing_role_output = fixture.output("missing-role");
        let missing_role = finalize_candidate(
            fixture.candidate(),
            fixture.material(),
            &missing_role_output,
            &fixture.options,
        )
        .unwrap_err();
        assert!(missing_role
            .message
            .contains("required evidence roles are missing: health"));
        assert!(!missing_role_output.exists());

        fixture.candidate_files = original_candidate.clone();
        fixture.write_candidate();
        fixture.external_files = original_external.clone();
        fixture.write_material();
        let mut mismatched_health = fixture.external_files["health"].clone();
        mismatched_health.extend_from_slice(b"\n ");
        fixture
            .external_files
            .insert("health".to_owned(), mismatched_health);
        fixture.write_material();
        let mismatched_health_output = fixture.output("mismatched-health");
        let mismatched_health_error = finalize_candidate(
            fixture.candidate(),
            fixture.material(),
            &mismatched_health_output,
            &fixture.options,
        )
        .unwrap_err();
        assert!(mismatched_health_error
            .message
            .contains("candidate health bytes differ from external health material"));
        assert!(!mismatched_health_output.exists());

        fixture.candidate_files = original_candidate.clone();
        fixture.write_candidate();
        fixture.external_files = original_external.clone();
        fixture.write_material();
        fixture.external_files.insert(
            "authenticated_user".to_owned(),
            serde_json::to_vec(&json!({
                "authoritative": true,
                "authority": "supabase-authenticated-user",
                "user_id": "99999999-9999-4999-8999-999999999999",
            }))
            .unwrap(),
        );
        fixture.write_material();
        let mixed_user_output = fixture.output("mixed-user");
        assert!(finalize_candidate(
            fixture.candidate(),
            fixture.material(),
            &mixed_user_output,
            &fixture.options,
        )
        .is_err());
        assert!(!mixed_user_output.exists());

        fixture.external_files = original_external.clone();
        fixture.write_material();
        let mut foreign_device: Value =
            serde_json::from_slice(&fixture.external_files["device_identity"]).unwrap();
        foreign_device["device_id"] =
            Value::String("99999999-9999-4999-8999-999999999999".to_owned());
        fixture.external_files.insert(
            "device_identity".to_owned(),
            serde_json::to_vec(&foreign_device).unwrap(),
        );
        fixture.write_material();
        let mixed_device_output = fixture.output("mixed-device");
        assert!(finalize_candidate(
            fixture.candidate(),
            fixture.material(),
            &mixed_device_output,
            &fixture.options,
        )
        .is_err());
        assert!(!mixed_device_output.exists());

        fixture.external_files = original_external.clone();
        fixture.write_material();
        let mut foreign_session: Value =
            serde_json::from_slice(&fixture.candidate_files["session.json"]).unwrap();
        foreign_session["session_id"] =
            Value::String("99999999-9999-4999-8999-999999999999".to_owned());
        fixture.candidate_files.insert(
            "session.json".to_owned(),
            serde_json::to_vec(&foreign_session).unwrap(),
        );
        fixture.write_candidate();
        let mixed_session_output = fixture.output("mixed-session");
        assert!(finalize_candidate(
            fixture.candidate(),
            fixture.material(),
            &mixed_session_output,
            &fixture.options,
        )
        .is_err());
        assert!(!mixed_session_output.exists());

        fixture.candidate_files = original_candidate.clone();
        fixture.write_candidate();
        let mut changed_presentation = fixture.candidate_files["presentation.bin"].clone();
        let last = changed_presentation.len() - 1;
        changed_presentation[last] ^= 1;
        fixture
            .candidate_files
            .insert("presentation.bin".to_owned(), changed_presentation);
        fixture.write_candidate();
        let changed_presentation_output = fixture.output("changed-presentation");
        assert!(finalize_candidate(
            fixture.candidate(),
            fixture.material(),
            &changed_presentation_output,
            &fixture.options,
        )
        .is_err());
        assert!(!changed_presentation_output.exists());

        fixture.candidate_files = original_candidate.clone();
        fixture.write_candidate();
        let mut changed_result: Value =
            serde_json::from_slice(&fixture.candidate_files["result.json"]).unwrap();
        let signature = changed_result["signature"].as_str().unwrap();
        let replacement = if signature.starts_with('A') { 'B' } else { 'A' };
        changed_result["signature"] = Value::String(format!("{replacement}{}", &signature[1..]));
        let changed_result_raw = serde_json::to_vec(&changed_result).unwrap();
        fixture
            .candidate_files
            .insert("result.json".to_owned(), changed_result_raw);
        for name in ["result-exact.bin", "worker-verification.json"] {
            let mut envelope: Value =
                serde_json::from_slice(&fixture.candidate_files[name]).unwrap();
            envelope["result"] = changed_result.clone();
            fixture
                .candidate_files
                .insert(name.to_owned(), serde_json::to_vec(&envelope).unwrap());
        }
        fixture.write_candidate();
        let changed_result_output = fixture.output("changed-result");
        assert!(finalize_candidate(
            fixture.candidate(),
            fixture.material(),
            &changed_result_output,
            &fixture.options,
        )
        .is_err());
        assert!(!changed_result_output.exists());

        fixture.candidate_files = original_candidate.clone();
        fixture.write_candidate();
        let mut wrong_trust_options = fixture.options.clone();
        wrong_trust_options.trust_anchor_der.push(0);
        let wrong_trust_output = fixture.output("wrong-trust-pin");
        assert!(finalize_candidate(
            fixture.candidate(),
            fixture.material(),
            &wrong_trust_output,
            &wrong_trust_options,
        )
        .is_err());
        assert!(!wrong_trust_output.exists());

        let mut wrong_notary_options = fixture.options.clone();
        wrong_notary_options.trusted_notary_registry_raw = b"{}".to_vec();
        let wrong_notary_output = fixture.output("wrong-notary-pin");
        assert!(finalize_candidate(
            fixture.candidate(),
            fixture.material(),
            &wrong_notary_output,
            &wrong_notary_options,
        )
        .is_err());
        assert!(!wrong_notary_output.exists());

        let mut wrong_profile_options = fixture.options.clone();
        wrong_profile_options.profile_sha256 = URL_SAFE_NO_PAD.encode([0x22_u8; 32]);
        let wrong_profile_output = fixture.output("wrong-profile-pin");
        assert!(finalize_candidate(
            fixture.candidate(),
            fixture.material(),
            &wrong_profile_output,
            &wrong_profile_options,
        )
        .is_err());
        assert!(!wrong_profile_output.exists());

        let mut wrong_identity_options = fixture.options.clone();
        wrong_identity_options.server_identity = "other.example.test".to_owned();
        let wrong_identity_output = fixture.output("wrong-target-identity");
        assert!(finalize_candidate(
            fixture.candidate(),
            fixture.material(),
            &wrong_identity_output,
            &wrong_identity_options,
        )
        .is_err());
        assert!(!wrong_identity_output.exists());

        fixture.candidate_files = original_candidate.clone();
        fixture.candidate_files.insert(
            "verifier-execution-receipt-header.txt".to_owned(),
            b"mismatch".to_vec(),
        );
        fixture.write_candidate();
        let changed_receipt_output = fixture.output("changed-receipt");
        assert!(finalize_candidate(
            fixture.candidate(),
            fixture.material(),
            &changed_receipt_output,
            &fixture.options,
        )
        .is_err());
        assert!(!changed_receipt_output.exists());

        fixture.candidate_files = original_candidate;
        fixture
            .candidate_files
            .remove("verifier-execution-receipt.bin");
        fixture.write_candidate();
        let missing_receipt_output = fixture.output("missing-receipt");
        assert!(finalize_candidate(
            fixture.candidate(),
            fixture.material(),
            &missing_receipt_output,
            &fixture.options,
        )
        .is_err());
        assert!(!missing_receipt_output.exists());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn sparse_result_generates_semantic_report_and_reverifies_without_full_digests() {
        let mut fixture = SyntheticBundleFixture::new_sparse().await;
        fixture.external_files.remove("semantic_verification");
        fixture.write_material();
        run_node_semantic_contract("prepare", &fixture.material().join("manifest.json"));

        let output = fixture.output("sparse-semantic-generation");
        let report = finalize_candidate(
            fixture.candidate(),
            fixture.material(),
            &output,
            &fixture.options,
        )
        .expect("sparse Result must generate and verify its semantic report");
        assert_eq!(report["status"], "VERIFIED");

        let result = parse_result_profile(&fixture.candidate_files["result.json"]).unwrap();
        assert!(result.view().is_sparse());
        let semantic_raw = fs::read(output.join("artifacts/semantic_verification.bin")).unwrap();
        let semantic: Value = serde_json::from_slice(&semantic_raw).unwrap();
        assert_eq!(semantic["generation_origin"], "offline_finalizer");
        assert!(semantic["derived_from_presentation"]["request_transcript_sha256"].is_null());
        assert!(semantic["derived_from_presentation"]["response_transcript_sha256"].is_null());
        assert_eq!(
            semantic["derived_from_presentation"]["revealed_response_ranges"],
            semantic["semantic_result"]["revealed_response_ranges"]
        );
        crate::evidence_bundle::verify_bundle(&output, &fixture.options)
            .expect("published sparse Bundle must pass the ordinary independent verifier");
        run_node_semantic_contract("validate", &output);
    }
}
