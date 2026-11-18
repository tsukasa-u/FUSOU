use super::*;
use serde_json::{json, Value};

fn binary() -> PathBuf {
    let path = PathBuf::from(
        std::env::var_os("FUSOU_OPERATIONAL_NOTARY_BIN")
            .expect("supply the normal release binary, built without test features"),
    );
    assert!(path.is_absolute() && path.is_file());
    path
}

fn write_config(path: &Path, config: &Value) {
    if path.exists() {
        fs::remove_file(path).unwrap();
    }
    write_file(path, &serde_json::to_vec(config).unwrap(), true);
}

fn invoke(command: &str, path: &Path) -> std::process::Output {
    let mut process = Command::new(binary());
    NotaryProcess::guard_notary_child(&mut process);
    process.arg(command).arg(path).output().unwrap()
}

fn wait_for_exit(child: &mut Child) -> ExitStatus {
    for _ in 0..500 {
        if let Some(status) = child.try_wait().unwrap() {
            return status;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    child.kill().unwrap();
    child.wait().unwrap();
    panic!("operational Notary did not exit");
}

fn assert_start_fails(path: &Path, expected: &str) {
    let mut command = Command::new(binary());
    NotaryProcess::guard_notary_child(&mut command);
    let mut child = command
        .arg("serve")
        .arg(path)
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    assert!(!wait_for_exit(&mut child).success());
    let output = child.wait_with_output().unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains(expected), "{stderr}");
}

async fn start(workspace: &TestWorkspace, config: &Path, listen: &str) -> NotaryProcess {
    let mut command = Command::new(binary());
    command.arg("serve").arg(config).stdin(Stdio::null());
    NotaryProcess::guard_notary_child(&mut command);
    let mut process = NotaryProcess {
        child: command.spawn().unwrap(),
        ready_file: workspace.path("unused-operational-ready-file"),
        endpoint: listen.to_owned(),
    };
    for _ in 0..500 {
        assert!(process.child.try_wait().unwrap().is_none());
        if tokio::net::TcpStream::connect(listen).await.is_ok() {
            return process;
        }
        sleep(Duration::from_millis(10)).await;
    }
    panic!("normal Notary did not bind to loopback");
}

fn check_export_against_signed_vector(path: &Path, workspace: &TestWorkspace, config: &Value) {
    let worker =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../FUSOU-TLSN-VERIFICATION-WORKER/scripts");
    let vector: Value = serde_json::from_slice(
        &fs::read(worker.join("fixtures/tlsn-runtime-config-independent-v2-vector.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(vector["test_only"], true);
    let decode = |value: &Value| -> Value {
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(value.as_str().unwrap()).unwrap()).unwrap()
    };
    let envelope: Value =
        serde_json::from_str(vector["manifest_envelope_utf8"].as_str().unwrap()).unwrap();
    let payload = decode(&envelope["payload_base64url"]);
    let signed = &payload["compile_inputs"];
    let set = decode(&vector["inputs_base64url"]["security_registry_set_raw"]);
    let mut snapshot = config.clone();
    snapshot["public"] = json!({
        "endpoint": signed["FUSOU_TLSN_NOTARY_ENDPOINT"],
        "environment": payload["environment"],
        "notary_id": signed["FUSOU_TLSN_NOTARY_ID"],
        "notary_key_id": set["notary_key_id"],
        "notary_verifying_key": signed["FUSOU_TLSN_NOTARY_VERIFYING_KEY"],
        "session_authority_key_id": signed["FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID"],
        "session_authority_public_key_spki": signed["FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY"],
        "wire_version": notary_wire::VERSION,
    });
    write_config(path, &snapshot);
    let exported = invoke("export-public", path);
    assert!(
        exported.status.success(),
        "{}",
        String::from_utf8_lossy(&exported.stderr)
    );
    let export_path = workspace.path("operational-notary-public-export.json");
    write_file(&export_path, &exported.stdout, true);
    let checked = Command::new("node")
        .arg("--test")
        .arg("--test-name-pattern=^coherent independently approved public settings")
        .arg(worker.join("notary-operational-preflight.test.mjs"))
        .env("FUSOU_TEST_NOTARY_PUBLIC_EXPORT", export_path)
        .output()
        .expect("run existing offline preflight against the actual public export");
    assert!(
        checked.status.success()
            && String::from_utf8_lossy(&checked.stdout)
                .lines()
                .any(|line| line == "# pass 1"),
        "{}\n{}",
        String::from_utf8_lossy(&checked.stdout),
        String::from_utf8_lossy(&checked.stderr)
    );
    write_config(path, config);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn normal_binary_complete_and_restarts_using_the_same_ledger() {
    let workspace = TestWorkspace::new();
    let credentials = Credentials::new();
    let ledger = workspace.path("ledger");
    fs::create_dir(&ledger).unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&ledger, fs::Permissions::from_mode(0o700)).unwrap();
    let key = workspace.path("notary-key");
    let root = workspace.path("origin-root.der");
    write_file(&key, &NOTARY_SIGNING_KEY, true);
    write_file(&root, &credentials.root_der, false);
    let listen = {
        let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        socket.local_addr().unwrap().to_string()
    };
    let path = workspace.path("operator.json");
    let config = json!({
        "schema_version": 1,
        "listen": listen,
        "public": {
            "endpoint": listen,
            "environment": ENVIRONMENT,
            "notary_id": NOTARY_ID,
            "notary_key_id": "fixture-k256",
            "notary_verifying_key": URL_SAFE_NO_PAD.encode(notary_key_bytes()),
            "session_authority_key_id": AUTHORITY_KEY_ID,
            "session_authority_public_key_spki": URL_SAFE_NO_PAD.encode(synthetic_session_authority_public_key_spki()),
            "wire_version": notary_wire::VERSION,
        },
        "ledger_directory": ledger,
        "notary_signing_key_file": key,
        "origin_trust_anchor_der": root,
    });
    check_export_against_signed_vector(&path, &workspace, &config);
    assert_start_fails(&path, "cannot open operational Notary instance lock");
    let initialized = invoke("init", &path);
    assert!(
        initialized.status.success(),
        "{}",
        String::from_utf8_lossy(&initialized.stderr)
    );
    assert!(!invoke("init", &path).status.success());
    for (field, value, diagnostic) in [
        ("notary_id", json!("wrong-id"), "does not match"),
        ("environment", json!("wrong-env"), "does not match"),
        (
            "session_authority_key_id",
            json!("wrong-authority"),
            "does not match",
        ),
        (
            "session_authority_public_key_spki",
            json!("not-spki"),
            "invalid Session Authority Ed25519 SPKI pin",
        ),
        ("wire_version", json!(2), "unsupported or invalid"),
        (
            "notary_verifying_key",
            json!("wrong-key"),
            "K256 pin does not match",
        ),
    ] {
        let mut bad = config.clone();
        bad["public"][field] = value;
        write_config(&path, &bad);
        assert_start_fails(&path, diagnostic);
    }
    write_config(&path, &config);
    let status = Command::new(binary())
        .arg("serve")
        .arg(&path)
        .args(["--fault", "after-admission"])
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(2));

    let mut running = start(&workspace, &path, &listen).await;
    assert_start_fails(&path, "ledger already in use");
    let mut origin = LoopbackOrigin::start(&credentials).await;
    let route = origin_config(origin.address, &credentials.root_der);
    let complete = fresh_grant(DEVICE_ID, 0x76);
    let request = request_for(&complete);
    let outcome = run_once(
        route.clone(),
        &listen,
        request.clone(),
        notary_verifying_key(),
        DisclosureMode::Complete,
        None,
        Vec::new(),
    )
    .await
    .unwrap();
    assert_eq!(outcome.response, origin.response);
    assert_headerless_request(&origin.next_request().await, request.bytes());
    verify_presentation(
        &outcome.presentation.unwrap(),
        &complete,
        request.bytes(),
        &credentials,
        DisclosureMode::Complete,
    );
    let saved = notary_wire::query_finalized_result(&listen, &complete.bytes)
        .await
        .unwrap();
    let _: Attestation = bincode::deserialize(&saved).unwrap();

    let pending = fresh_grant(DEVICE_ID, 0x77);
    let mut pending_socket = tokio::net::TcpStream::connect(&listen).await.unwrap();
    timeout(
        Duration::from_secs(5),
        notary_wire::client_admit(
            &mut pending_socket,
            &pending.bytes,
            &notary_verifying_key(),
            NOTARY_ID,
            ENVIRONMENT,
        ),
    )
    .await
    .unwrap()
    .unwrap();
    running.child.kill().unwrap();
    running.child.wait().unwrap();
    drop(pending_socket);

    let mut restarted = start(&workspace, &path, &listen).await;
    assert_eq!(
        notary_wire::query_finalized_result(&listen, &complete.bytes)
            .await
            .unwrap(),
        saved
    );
    assert!(notary_wire::query_finalized_result(&listen, &pending.bytes)
        .await
        .is_err());
    for grant in [&complete, &pending] {
        assert!(run_once(
            route.clone(),
            &listen,
            request_for(grant),
            notary_verifying_key(),
            DisclosureMode::Complete,
            None,
            Vec::new(),
        )
        .await
        .is_err());
    }
    origin.assert_request_count(1).await;
    origin.stop().await;
    assert!(restarted.stop().unwrap().success());
    let ledger_path = ledger.join("ledger.json");
    let state: Value = serde_json::from_slice(&fs::read(&ledger_path).unwrap()).unwrap();
    let grants = state["grants"].as_object().unwrap();
    assert_eq!(grants.len(), 2);
    assert!(grants.values().any(|grant| grant["state"]
        .as_object()
        .is_some_and(|s| s["state"] == "unknown")));
    let mut incompatible = state;
    incompatible["schema_version"] = json!(0);
    fs::write(&ledger_path, serde_json::to_vec(&incompatible).unwrap()).unwrap();
    assert_start_fails(&path, "unsupported Notary store schema version");
    fs::write(&ledger_path, b"{").unwrap();
    assert_start_fails(&path, "parse Notary store");
    fs::remove_file(&ledger_path).unwrap();
    assert_start_fails(&path, "open existing Notary store");
    assert!(!invoke("init", &path).status.success());
}
