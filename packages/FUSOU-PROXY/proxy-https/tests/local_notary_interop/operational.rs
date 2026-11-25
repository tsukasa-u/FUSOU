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

fn ledger_snapshot(path: &Path) -> std::collections::BTreeMap<std::ffi::OsString, Vec<u8>> {
    fs::read_dir(path)
        .unwrap()
        .map(|entry| {
            let entry = entry.unwrap();
            (entry.file_name(), fs::read(entry.path()).unwrap())
        })
        .collect()
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
    command
        .arg("serve")
        .arg(config)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    NotaryProcess::guard_notary_child(&mut command);
    let mut child = command.spawn().unwrap();
    let stderr = child.stderr.take();
    let mut process = NotaryProcess {
        child,
        ready_file: workspace.path("unused-operational-ready-file"),
        endpoint: listen.to_owned(),
        stderr,
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

fn check_export_against_signed_vector(
    path: &Path,
    workspace: &TestWorkspace,
    config: &Value,
    endpoint: &str,
) {
    assert_eq!(config["listen"].as_str(), Some(endpoint));
    assert_eq!(config["public"]["endpoint"].as_str(), Some(endpoint));
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
        "endpoint": endpoint,
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
        .env("FUSOU_TEST_NOTARY_ENDPOINT", endpoint)
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
    check_export_against_signed_vector(&path, &workspace, &config, &listen);
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
    let unavailable_listen = {
        let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = socket.local_addr().unwrap().to_string();
        drop(socket);
        address
    };
    let unavailable = fresh_grant(DEVICE_ID, 0x75);
    assert!(run_once(
        route.clone(),
        &unavailable_listen,
        request_for(&unavailable),
        notary_verifying_key(),
        DisclosureMode::Complete,
        None,
        Vec::new(),
    )
    .await
    .is_err());
    origin.assert_request_count(0).await;

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
    let stderr = restarted.read_stderr().expect("read normal serve stderr");
    let stderr = String::from_utf8_lossy(&stderr);
    assert!(
        stderr.contains("Notary connection rejected or failed"),
        "normal serve connection rejections reach standard error: {stderr}"
    );
    assert!(
        !stderr.contains("notary_ledger_persistence_uncertain"),
        "ordinary connection rejections remain distinct from ledger-stop diagnostics"
    );
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

#[test]
fn normal_binary_rejects_invalid_loopback_settings_before_side_effects() {
    const LISTEN_ERROR: &str = "Notary listen must be canonical 127.0.0.1:<non-zero-port>";
    const ENDPOINT_ERROR: &str = "public.endpoint must exactly match Notary listen";

    let workspace = TestWorkspace::new();
    let credentials = Credentials::new();
    let signing_key = workspace.path("notary-key");
    let trust_anchor = workspace.path("origin-root.der");
    write_file(&signing_key, &NOTARY_SIGNING_KEY, true);
    write_file(&trust_anchor, &credentials.root_der, false);

    let held_loopback = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let listen = held_loopback.local_addr().unwrap().to_string();
    let port = held_loopback.local_addr().unwrap().port();
    let other_port = if port == u16::MAX { port - 1 } else { port + 1 };
    let wildcard = format!("0.0.0.0:{port}");
    let non_loopback = format!("192.0.2.1:{port}");
    let hostname = format!("localhost:{port}");
    let ipv6_loopback = format!("[::1]:{port}");
    let mismatched_port = format!("127.0.0.1:{other_port}");
    let invalid_cases = [
        ("wildcard-listen", wildcard.clone(), wildcard, LISTEN_ERROR),
        (
            "non-loopback-listen",
            non_loopback.clone(),
            non_loopback,
            LISTEN_ERROR,
        ),
        (
            "ipv6-listen",
            ipv6_loopback.clone(),
            ipv6_loopback,
            LISTEN_ERROR,
        ),
        (
            "hostname-listen",
            hostname.clone(),
            hostname.clone(),
            LISTEN_ERROR,
        ),
        (
            "zero-port-listen",
            "127.0.0.1:0".to_owned(),
            "127.0.0.1:0".to_owned(),
            LISTEN_ERROR,
        ),
        (
            "hostname-endpoint",
            listen.clone(),
            hostname,
            ENDPOINT_ERROR,
        ),
        (
            "wildcard-endpoint",
            listen.clone(),
            format!("0.0.0.0:{port}"),
            ENDPOINT_ERROR,
        ),
        (
            "mismatched-port",
            listen.clone(),
            mismatched_port,
            ENDPOINT_ERROR,
        ),
    ];

    let ledger = workspace.path("existing-ledger");
    fs::create_dir(&ledger).unwrap();
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&ledger, fs::Permissions::from_mode(0o700)).unwrap();
    let config_path = workspace.path("operator.json");
    let valid_config = json!({
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
        "notary_signing_key_file": signing_key,
        "origin_trust_anchor_der": trust_anchor,
    });
    let valid_endpoint = valid_config["public"]["endpoint"]
        .as_str()
        .unwrap()
        .to_owned();
    write_config(&config_path, &valid_config);
    let initialized = invoke("init", &config_path);
    assert!(
        initialized.status.success(),
        "{}",
        String::from_utf8_lossy(&initialized.stderr)
    );
    let ledger_before = ledger_snapshot(&ledger);

    for (name, invalid_listen, invalid_endpoint, diagnostic) in invalid_cases {
        let mut invalid = valid_config.clone();
        invalid["listen"] = json!(invalid_listen);
        invalid["public"]["endpoint"] = json!(invalid_endpoint);

        let init_ledger = workspace.path(&format!("invalid-init-{name}"));
        let mut init_config = invalid.clone();
        init_config["ledger_directory"] = json!(init_ledger);
        write_config(&config_path, &init_config);
        let init = invoke("init", &config_path);
        assert!(!init.status.success(), "{name}: invalid init succeeded");
        assert!(
            String::from_utf8_lossy(&init.stderr).contains(diagnostic),
            "{name}: {}",
            String::from_utf8_lossy(&init.stderr)
        );
        assert!(!init_ledger.exists(), "{name}: init created a ledger");

        let export_ledger = workspace.path(&format!("invalid-export-{name}"));
        let mut export_config = invalid.clone();
        export_config["ledger_directory"] = json!(export_ledger);
        write_config(&config_path, &export_config);
        let exported = invoke("export-public", &config_path);
        assert!(
            !exported.status.success(),
            "{name}: invalid export succeeded"
        );
        assert!(
            exported.stdout.is_empty(),
            "{name}: export emitted public JSON"
        );
        assert!(
            String::from_utf8_lossy(&exported.stderr).contains(diagnostic),
            "{name}: {}",
            String::from_utf8_lossy(&exported.stderr)
        );
        assert!(!export_ledger.exists(), "{name}: export created a ledger");

        let mut serve_config = invalid;
        if serve_config["listen"].as_str() != Some(valid_endpoint.as_str()) {
            serve_config["public"]["endpoint"] = json!(valid_endpoint);
        }
        serve_config["ledger_directory"] = json!(ledger);
        write_config(&config_path, &serve_config);
        assert_start_fails(&config_path, diagnostic);
        assert_eq!(
            ledger_snapshot(&ledger),
            ledger_before,
            "{name}: serve modified the existing ledger"
        );
    }
}

fn required_path(name: &str) -> PathBuf {
    PathBuf::from(std::env::var_os(name).unwrap_or_else(|| panic!("{name} is required")))
}

fn worker_session_credentials(directory: &Path) -> Credentials {
    Credentials {
        root_der: fs::read(directory.join("origin-root.der")).expect("read test trust anchor"),
        origin_certificate_der: fs::read(directory.join("origin-certificate.der"))
            .expect("read loopback origin certificate"),
        origin_private_key_der: fs::read(directory.join("origin-private-key.der"))
            .expect("read loopback origin private key"),
    }
}

#[test]
fn prepare_worker_session_fixture_credentials() {
    let directory = required_path("FUSOU_TEST_TLSN_CREDENTIALS_DIR");
    let server_identity = std::env::var("FUSOU_TEST_ORIGIN_IDENTITY")
        .unwrap_or_else(|_| ORIGIN_IDENTITY.to_owned());
    let credentials = Credentials::new_for(&server_identity);
    write_file(&directory.join("origin-root.der"), &credentials.root_der, false);
    write_file(
        &directory.join("origin-certificate.der"),
        &credentials.origin_certificate_der,
        false,
    );
    write_file(
        &directory.join("origin-private-key.der"),
        &credentials.origin_private_key_der,
        true,
    );
}

#[test]
fn export_worker_session_fixture_notary_key() {
    write_file(
        &required_path("FUSOU_TEST_NOTARY_KEY_OUTPUT"),
        &notary_key_bytes(),
        false,
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn worker_session_grant_produces_independently_verified_complete_presentation() {
    let workspace = TestWorkspace::new();
    let server_identity = std::env::var("FUSOU_TEST_ORIGIN_IDENTITY")
        .unwrap_or_else(|_| ORIGIN_IDENTITY.to_owned());
    let notary_id = std::env::var("FUSOU_TEST_NOTARY_ID")
        .unwrap_or_else(|_| NOTARY_ID.to_owned());
    let notary_key_id = std::env::var("FUSOU_TEST_NOTARY_KEY_ID")
        .unwrap_or_else(|_| "fixture-k256".to_owned());
    let environment = std::env::var("FUSOU_TEST_NOTARY_ENVIRONMENT")
        .unwrap_or_else(|_| ENVIRONMENT.to_owned());
    let credential_directory = required_path("FUSOU_TEST_TLSN_CREDENTIALS_DIR");
    let credentials = worker_session_credentials(&credential_directory);
    let session: Value = serde_json::from_slice(
        &fs::read(required_path("FUSOU_TEST_SESSION_INPUT")).expect("read Worker session"),
    )
    .expect("parse Worker session");
    let session_id = session["session_id"].as_str().expect("session ID");
    let device_id = session["device_id"].as_str().expect("device ID");
    let binding = session["binding"].as_str().expect("binding");
    let session_authority_key_id =
        std::env::var("FUSOU_TEST_SESSION_AUTHORITY_KEY_ID").expect("Session Authority key ID");
    let session_authority_public_key_spki = URL_SAFE_NO_PAD
        .decode(
            std::env::var("FUSOU_TEST_SESSION_AUTHORITY_PUBLIC_KEY_SPKI")
                .expect("Session Authority public key"),
        )
        .expect("decode Session Authority public key");
    let grant_bytes = URL_SAFE_NO_PAD
        .decode(
            session["session_context_grant"]
                .as_str()
                .expect("Session Context Grant"),
        )
        .expect("decode Session Context Grant");
    let grant_context =
        SessionContextGrant::parse(&grant_bytes).expect("parse Worker Session Context Grant");
    grant_context
        .verify(
            &session_authority_public_key_spki,
            &session_authority_key_id,
        )
        .expect("verify Worker Session Context Grant signature");
    assert_eq!(grant_context.session_id(), session_id);
    assert_eq!(grant_context.binding_value(), binding);
    assert_eq!(
        grant_context.device_id_sha256(),
        &device_id_commitment(device_id).expect("commit registered device ID")
    );
    assert_eq!(
        grant_context.device_challenge().as_slice(),
        URL_SAFE_NO_PAD
            .decode(
                session["device_challenge"]
                    .as_str()
                    .expect("device challenge")
            )
            .expect("decode device challenge")
            .as_slice()
    );
    assert!(grant_context.issued_at_ms() <= now_ms());
    assert!(grant_context.expires_at_ms() > now_ms());

    let grant = GrantFixture {
        binding: binding.to_owned(),
        bytes: grant_bytes,
        session_id: session_id.to_owned(),
        device_id: device_id.to_owned(),
    };
    let signing_key = workspace.path("notary-signing-key.der");
    let root_certificate = workspace.path("origin-root.der");
    write_file(&signing_key, &NOTARY_SIGNING_KEY, true);
    write_file(&root_certificate, &credentials.root_der, false);
    let ledger = workspace.path("ledger");
    fs::create_dir(&ledger).expect("create isolated operational Notary ledger");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&ledger, fs::Permissions::from_mode(0o700))
            .expect("restrict isolated Notary ledger");
    }
    let listen = {
        let socket = std::net::TcpListener::bind("127.0.0.1:0")
            .expect("reserve ephemeral loopback Notary port");
        socket.local_addr().expect("read Notary port").to_string()
    };
    let config_path = workspace.path("operator.json");
    let config = json!({
        "schema_version": 1,
        "listen": listen,
        "public": {
            "endpoint": listen,
            "environment": environment,
            "notary_id": notary_id,
            "notary_key_id": notary_key_id,
            "notary_verifying_key": URL_SAFE_NO_PAD.encode(notary_key_bytes()),
            "session_authority_key_id": session_authority_key_id,
            "session_authority_public_key_spki": URL_SAFE_NO_PAD.encode(&session_authority_public_key_spki),
            "wire_version": notary_wire::VERSION,
        },
        "ledger_directory": ledger,
        "notary_signing_key_file": signing_key,
        "origin_trust_anchor_der": root_certificate,
    });
    write_config(&config_path, &config);
    let exported = invoke("export-public", &config_path);
    assert!(
        exported.status.success(),
        "export-public failed: {}",
        String::from_utf8_lossy(&exported.stderr)
    );
    let exported: Value =
        serde_json::from_slice(&exported.stdout).expect("parse normal Notary public export");
    assert_eq!(exported["endpoint"], listen);
    assert_eq!(exported["notary_id"], notary_id);
    assert_eq!(exported["environment"], environment);
    assert_eq!(exported["notary_key_id"], notary_key_id);
    assert_eq!(
        exported["notary_verifying_key"],
        URL_SAFE_NO_PAD.encode(notary_key_bytes())
    );
    assert_eq!(
        exported["session_authority_key_id"],
        session_authority_key_id
    );
    assert_eq!(
        exported["session_authority_public_key_spki"],
        URL_SAFE_NO_PAD.encode(&session_authority_public_key_spki)
    );
    let initialized = invoke("init", &config_path);
    assert!(
        initialized.status.success(),
        "normal Notary init failed: {}",
        String::from_utf8_lossy(&initialized.stderr)
    );
    let mut notary = start(&workspace, &config_path, &listen).await;
    let mut origin = LoopbackOrigin::start(&credentials).await;
    let request = request_for_identity(&grant, &server_identity);
    let request_bytes = request.bytes().to_vec();
    let outcome = run_once_with_scope(
        origin_config_for(origin.address, &credentials.root_der, &server_identity),
        &listen,
        request.clone(),
        notary_verifying_key(),
        DisclosureMode::Complete,
        &notary_id,
        &environment,
        Some(grant.bytes.clone()),
        Vec::new(),
    )
    .await
    .expect("run complete TLSN exchange against local normal Notary");
    assert_eq!(outcome.response, origin.response);
    let origin_request = origin.next_request().await;
    assert_headerless_request(&origin_request, &request_bytes);
    origin.assert_request_count(1).await;

    let presentation = outcome
        .presentation
        .expect("normal Notary must produce a Complete Presentation");
    let authenticated = verify_alpha15_presentation_with_trusted_notary_key_and_trust_anchor(
        &presentation,
        &credentials.root_der,
        &notary_key_bytes(),
    )
    .expect("independently verify Presentation, Web PKI, and Notary signature");
    let profile =
        SessionExtensionRequireInfoDisclosureProfile::from_server_identity_and_session_authority(
            &server_identity,
            &session_authority_key_id,
            &session_authority_public_key_spki,
        )
        .expect("pin Worker Session Authority for independent verification");
    let verified = authenticated
        .verify_require_info_with_session_extension(&profile, &ParserLimits::default())
        .expect("verify Complete require-info transcript and Session extension");
    assert_eq!(verified.server_identity(), server_identity);
    assert_eq!(
        verified
            .session_context()
            .expect("verified session context")
            .grant
            .encoded(),
        grant.bytes
    );
    assert_eq!(
        verified
            .session_context()
            .expect("verified session context")
            .acceptance
            .policy_id(),
        NOTARY_SESSION_CONTEXT_POLICY_ID
    );
    assert_eq!(
        verified.request_transcript_size(),
        request_bytes.len() as u64
    );
    assert_eq!(
        verified.request_transcript_sha256(),
        Some(&sha256(&request_bytes))
    );
    assert_eq!(
        verified.response_transcript_size(),
        outcome.response.len() as u64
    );
    assert_eq!(
        verified.response_transcript_sha256(),
        Some(&sha256(&outcome.response))
    );
    assert_eq!(
        reconstruct_ranges(
            &verified.revealed_request_ranges(),
            verified.request_transcript_size()
        ),
        request_bytes
    );
    assert_eq!(
        reconstruct_ranges(
            &verified.revealed_response_ranges(),
            verified.response_transcript_size()
        ),
        outcome.response
    );

    write_file(
        &required_path("FUSOU_TEST_PRESENTATION_OUTPUT"),
        &presentation,
        true,
    );
    write_file(
        &required_path("FUSOU_TEST_ORIGIN_REQUEST_OUTPUT"),
        &origin_request,
        true,
    );
    write_file(
        &required_path("FUSOU_TEST_ORIGIN_RESPONSE_OUTPUT"),
        &origin.response,
        true,
    );
    let metadata = json!({
        "session_id": session_id,
        "device_id": device_id,
        "binding": binding,
        "server_identity": verified.server_identity(),
        "presentation_sha256": URL_SAFE_NO_PAD.encode(sha256(&presentation)),
        "presentation_bytes": presentation.len(),
        "request_transcript_sha256": URL_SAFE_NO_PAD.encode(sha256(&request_bytes)),
        "request_transcript_bytes": request_bytes.len(),
        "origin_request_sha256": URL_SAFE_NO_PAD.encode(sha256(&origin_request)),
        "origin_request_bytes": origin_request.len(),
        "response_transcript_sha256": URL_SAFE_NO_PAD.encode(sha256(&outcome.response)),
        "response_transcript_bytes": outcome.response.len(),
        "origin_response_sha256": URL_SAFE_NO_PAD.encode(sha256(&origin.response)),
        "origin_response_bytes": origin.response.len(),
        "notary_id": notary_id,
        "notary_key_id": notary_key_id,
        "environment": environment,
        "independent_verification": "PASS",
    });
    write_file(
        &required_path("FUSOU_TEST_PRESENTATION_METADATA_OUTPUT"),
        &serde_json::to_vec(&metadata).expect("serialize Presentation metadata"),
        true,
    );
    assert!(notary.stop().expect("stop normal Notary").success());
    origin.stop().await;
}
