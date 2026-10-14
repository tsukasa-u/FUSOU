use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use fusou_tlsn_verifier::tlsn_alpha15::verify_alpha15_presentation_with_trusted_notary_key;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Output},
};
use tlsn_attestation::presentation::Presentation;
use uuid::Uuid;

fn fixture_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/tlsn-alpha15-upstream-presentation.bin")
}

fn trusted_fixture_notary_key(presentation_bytes: &[u8]) -> Vec<u8> {
    let presentation: Presentation = bincode::deserialize(presentation_bytes).unwrap();
    bincode::serialize(presentation.verifying_key()).unwrap()
}

fn run_require_info_cli(
    presentation_path: &Path,
    server_identity: &str,
    trusted_notary_key: &[u8],
) -> Output {
    let profile_sha256 = URL_SAFE_NO_PAD.encode([0_u8; 32]);
    let device_challenge = URL_SAFE_NO_PAD.encode([0_u8; 32]);
    Command::new(env!("CARGO_BIN_EXE_verify_tlsn_require_info"))
        .arg("--presentation")
        .arg(presentation_path)
        .arg("--server-identity")
        .arg(server_identity)
        .arg("--profile-sha256")
        .arg(profile_sha256)
        .arg("--verifier-key-id")
        .arg("test-verifier")
        .arg("--notary-key-id")
        .arg("test-notary")
        .arg("--canonical-user-id")
        .arg("11111111-1111-4111-8111-111111111111")
        .arg("--canonical-device-id")
        .arg("22222222-2222-4222-8222-222222222222")
        .arg("--device-challenge")
        .arg(device_challenge)
        .arg("--notary-key-base64url")
        .arg(URL_SAFE_NO_PAD.encode(trusted_notary_key))
        .output()
        .unwrap()
}

fn write_temporary_presentation(bytes: &[u8]) -> PathBuf {
    let path = std::env::temp_dir().join(format!("fusou-offline-verifier-{}.bin", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .unwrap();
    file.write_all(bytes).unwrap();
    path
}

#[test]
fn require_info_cli_rejects_a_cryptographically_valid_presentation_for_another_identity() {
    let path = fixture_path();
    let presentation = fs::read(&path).unwrap();
    let notary_key = trusted_fixture_notary_key(&presentation);
    let verified =
        verify_alpha15_presentation_with_trusted_notary_key(&presentation, &notary_key).unwrap();
    assert_eq!(verified.server_identity(), "tlsnotary.org");

    let output = run_require_info_cli(&path, "game.example.test", &notary_key);
    assert_eq!(
        output.status.code(),
        Some(1),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr)
        .contains("authenticated server identity is not in the trusted allowlist"));
}

#[test]
fn require_info_cli_rejects_trailing_presentation_bytes() {
    let original = fs::read(fixture_path()).unwrap();
    let notary_key = trusted_fixture_notary_key(&original);
    let mut presentation_with_trailing_bytes = original;
    presentation_with_trailing_bytes.extend_from_slice(b"trailing");
    let path = write_temporary_presentation(&presentation_with_trailing_bytes);
    let output = run_require_info_cli(&path, "tlsnotary.org", &notary_key);
    fs::remove_file(path).unwrap();

    assert_eq!(
        output.status.code(),
        Some(1),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("trailing Presentation bytes"));
}

#[test]
fn evidence_cli_rejects_missing_external_authority_inputs() {
    let output = Command::new(env!("CARGO_BIN_EXE_verify_fusou_tlsn_evidence"))
        .arg("--bundle")
        .arg("unused-bundle-path")
        .output()
        .unwrap();
    assert_eq!(
        output.status.code(),
        Some(1),
        "stdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["status"], "REJECTED");
    assert_eq!(report["error"]["trust_edge"], "cli");
    assert!(report["error"]["message"]
        .as_str()
        .unwrap()
        .contains("missing --evidence-root-key-id"));
}
