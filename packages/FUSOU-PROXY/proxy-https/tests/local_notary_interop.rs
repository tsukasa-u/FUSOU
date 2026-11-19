#![cfg(feature = "local-test-notary-fault-injection")]

#[cfg(all(unix, feature = "operational-notary"))]
#[path = "local_notary_interop/operational.rs"]
mod operational;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use fusou_tlsn_verifier::{
    session_context::{
        device_id_commitment, SessionContextGrant, NOTARY_SESSION_CONTEXT_ACCEPTED_EXTENSION_ID,
        NOTARY_SESSION_CONTEXT_POLICY_ID,
    },
    tlsn_alpha15::{
        verify_alpha15_presentation_with_trusted_notary_key_and_trust_anchor,
        SessionExtensionRequireInfoDisclosureProfile,
    },
    ParserLimits, RevealedRange, BINDING_PREFIX,
};
use proxy_https::{
    exchange_lifecycle::{ExchangeLifecycle, ExchangePolicy, NotaryAttestationLimit},
    experimental_tlsn::{sha256, SerializedOriginRequest, TlsnOriginCapture, TlsnOriginTransport},
    notary_wire::{self, verifying_key_from_private_key},
    production_tlsn::{
        Alpha15OriginTransportFactory, OriginTarget, OriginTlsConfig, OriginTransportConfig,
        PresentationHandoff, ProductionAlpha15OriginTransport, ServerIdentityPolicy,
    },
    real_tlsn::RealAlpha15OriginTransportFactory,
    synthetic_notary::{
        LocalTestNotary, NotaryGrantStatus, LOCAL_TEST_ENVIRONMENT, LOCAL_TEST_NOTARY_ID,
        LOCAL_TEST_SESSION_AUTHORITY_KEY_ID,
    },
    synthetic_tlsn::{
        synthetic_session_authority_public_key_spki, synthetic_test_request_with_grant,
    },
};
use rcgen::{
    BasicConstraints, CertificateParams, ExtendedKeyUsagePurpose, IsCa, KeyPair, KeyUsagePurpose,
};
use ring::signature::Ed25519KeyPair;
use std::{
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    net::SocketAddr,
    path::{Path, PathBuf},
    process::{Child, ChildStderr, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tlsn::{
    attestation::signing::VerifyingKey,
    attestation::{Attestation, Extension},
    config::{prover::ProverConfig, tls_commit::mpc::MpcTlsConfig},
    Session,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::mpsc,
    task::JoinHandle,
    time::{sleep, timeout},
};
use tokio_rustls::{
    rustls::pki_types::{CertificateDer, PrivateKeyDer},
    TlsAcceptor,
};
use tokio_util::compat::TokioAsyncReadCompatExt;
use uuid::Uuid;

const AUTHORITY_SEED: [u8; 32] = [42; 32];
const NOTARY_SIGNING_KEY: [u8; 32] = [1; 32];
const NOTARY_ID: &str = LOCAL_TEST_NOTARY_ID;
const ENVIRONMENT: &str = LOCAL_TEST_ENVIRONMENT;
const AUTHORITY_KEY_ID: &str = LOCAL_TEST_SESSION_AUTHORITY_KEY_ID;
const DEVICE_ID: &str = "22222222-2222-4222-8222-222222222222";
const OTHER_DEVICE_ID: &str = "33333333-3333-4333-8333-333333333333";
const ORIGIN_IDENTITY: &str = "game.example.test";
const ORIGIN_RESPONSE_BODY: &[u8] =
    br#"svdata={"api_result":1,"api_data":{"api_basic":{"api_member_id":16189463}}}"#;
static RUSTLS_PROVIDER: OnceLock<()> = OnceLock::new();

struct TestWorkspace(PathBuf);

impl TestWorkspace {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "fusou-notary-interop-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        fs::create_dir(&path).expect("create isolated Notary test directory");
        Self(path)
    }

    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for TestWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct Credentials {
    root_der: Vec<u8>,
    origin_certificate_der: Vec<u8>,
    origin_private_key_der: Vec<u8>,
}

impl Credentials {
    fn new() -> Self {
        let root_key_pair = KeyPair::generate().expect("generate test trust-anchor key");
        let mut root_params = CertificateParams::default();
        root_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        root_params.key_usages = vec![
            KeyUsagePurpose::KeyCertSign,
            KeyUsagePurpose::CrlSign,
            KeyUsagePurpose::DigitalSignature,
        ];
        let root = root_params
            .self_signed(&root_key_pair)
            .expect("create test trust anchor");

        let mut origin_params =
            CertificateParams::new(vec![ORIGIN_IDENTITY.to_owned()]).expect("origin SAN");
        origin_params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        origin_params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        let origin_key_pair = KeyPair::generate().expect("generate test origin key");
        let origin_certificate = origin_params
            .signed_by(&origin_key_pair, &root, &root_key_pair)
            .expect("sign loopback origin certificate");

        Self {
            root_der: root.der().to_vec(),
            origin_certificate_der: origin_certificate.der().to_vec(),
            origin_private_key_der: origin_key_pair.serialize_der(),
        }
    }
}

struct NotaryFiles {
    store: PathBuf,
    authority_key: PathBuf,
    notary_key: PathBuf,
    root_certificate: PathBuf,
}

impl NotaryFiles {
    fn initialize(workspace: &TestWorkspace, credentials: &Credentials) -> Self {
        let store = workspace.path("notary-state.json");
        let authority_key = workspace.path("authority-public-key.der");
        let notary_key = workspace.path("notary-signing-key.der");
        let root_certificate = workspace.path("origin-root.der");
        write_file(
            &authority_key,
            &synthetic_session_authority_public_key_spki(),
            false,
        );
        write_file(&notary_key, &NOTARY_SIGNING_KEY, true);
        write_file(&root_certificate, &credentials.root_der, false);

        drop(
            LocalTestNotary::initialize_new(
                store.clone(),
                synthetic_session_authority_public_key_spki(),
                AUTHORITY_KEY_ID,
                NOTARY_ID,
                ENVIRONMENT,
            )
            .expect("explicitly initialize the dedicated test Notary store"),
        );
        Self {
            store,
            authority_key,
            notary_key,
            root_certificate,
        }
    }
}

fn write_file(path: &Path, bytes: &[u8], private: bool) {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    if private {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .expect("create test key/configuration file");
    file.write_all(bytes)
        .expect("write test key/configuration file");
    file.sync_all().expect("sync test key/configuration file");
}

struct NotaryProcess {
    child: Child,
    ready_file: PathBuf,
    endpoint: String,
    stderr: Option<ChildStderr>,
}

impl NotaryProcess {
    fn spawn(workspace: &TestWorkspace, files: &NotaryFiles, fault: &str) -> Result<Self, String> {
        Self::spawn_inner(workspace, files, fault, false)
    }

    fn spawn_capturing_stderr(
        workspace: &TestWorkspace,
        files: &NotaryFiles,
        fault: &str,
    ) -> Result<Self, String> {
        Self::spawn_inner(workspace, files, fault, true)
    }

    fn spawn_inner(
        workspace: &TestWorkspace,
        files: &NotaryFiles,
        fault: &str,
        capture_stderr: bool,
    ) -> Result<Self, String> {
        let ready_file = workspace.path("notary-ready.txt");
        match fs::remove_file(&ready_file) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("remove stale Notary readiness file: {error}")),
        }
        let mut command = Command::new(env!("CARGO_BIN_EXE_fusou-local-test-notary"));
        command
            .arg("--listen")
            .arg("127.0.0.1:0")
            .arg("--store")
            .arg(&files.store)
            .arg("--authority-public-key")
            .arg(&files.authority_key)
            .arg("--authority-key-id")
            .arg(AUTHORITY_KEY_ID)
            .arg("--notary-signing-key")
            .arg(&files.notary_key)
            .arg("--root-certificate")
            .arg(&files.root_certificate)
            .arg("--ready-file")
            .arg(&ready_file)
            .arg("--fault")
            .arg(fault)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(if capture_stderr {
                Stdio::piped()
            } else {
                Stdio::inherit()
            });
        Self::guard_notary_child(&mut command);
        let mut child = command
            .spawn()
            .map_err(|error| format!("start separate local Notary process: {error}"))?;
        let stderr = child.stderr.take();
        let mut process = Self {
            child,
            ready_file,
            endpoint: String::new(),
            stderr,
        };
        for _ in 0..500 {
            if let Ok(value) = fs::read_to_string(&process.ready_file) {
                process.endpoint = value
                    .trim()
                    .parse::<SocketAddr>()
                    .map_err(|error| format!("parse Notary readiness address: {error}"))?
                    .to_string();
                return Ok(process);
            }
            if let Some(status) = process
                .child
                .try_wait()
                .map_err(|error| format!("inspect Notary process readiness: {error}"))?
            {
                return Err(format!(
                    "Notary process exited before readiness with status {status}"
                ));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        Err("local Notary did not publish its readiness address".to_owned())
    }

    fn read_stderr(&mut self) -> Result<Vec<u8>, String> {
        let Some(mut stderr) = self.stderr.take() else {
            return Ok(Vec::new());
        };
        let mut output = Vec::new();
        stderr
            .read_to_end(&mut output)
            .map_err(|error| format!("read Notary standard error: {error}"))?;
        Ok(output)
    }

    fn guard_notary_child(command: &mut Command) {
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::process::CommandExt;
            let parent = std::process::id();
            unsafe {
                command.pre_exec(move || {
                    if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) != 0 {
                        return Err(io::Error::last_os_error());
                    }
                    if libc::getppid() as u32 != parent {
                        return Err(io::Error::other(
                            "integration-test parent exited before Notary startup",
                        ));
                    }
                    Ok(())
                });
            }
        }
        #[cfg(not(target_os = "linux"))]
        let _ = command;
    }

    fn stop(&mut self) -> Result<ExitStatus, String> {
        if self
            .child
            .try_wait()
            .map_err(|error| format!("inspect local Notary process: {error}"))?
            .is_none()
        {
            #[cfg(unix)]
            {
                let result = unsafe {
                    libc::kill(
                        i32::try_from(self.child.id())
                            .map_err(|_| "local Notary process ID is out of range")?,
                        libc::SIGTERM,
                    )
                };
                if result != 0 {
                    return Err(format!(
                        "send termination signal to local Notary process: {}",
                        std::io::Error::last_os_error()
                    ));
                }
            }
            #[cfg(not(unix))]
            self.child
                .kill()
                .map_err(|error| format!("stop local Notary process: {error}"))?;
        }
        let status = self
            .child
            .wait()
            .map_err(|error| format!("wait for local Notary process: {error}"))?;
        match fs::remove_file(&self.ready_file) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("remove Notary readiness file: {error}")),
        }
        Ok(status)
    }
}

impl Drop for NotaryProcess {
    fn drop(&mut self) {
        if matches!(self.child.try_wait(), Ok(None)) {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
        let _ = fs::remove_file(&self.ready_file);
    }
}

struct LoopbackOrigin {
    address: SocketAddr,
    requests: mpsc::UnboundedReceiver<Vec<u8>>,
    request_count: Arc<AtomicUsize>,
    task: JoinHandle<()>,
    response: Vec<u8>,
}

impl LoopbackOrigin {
    async fn start(credentials: &Credentials) -> Self {
        RUSTLS_PROVIDER.get_or_init(|| {
            let _ = tokio_rustls::rustls::crypto::ring::default_provider().install_default();
        });
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind loopback HTTPS origin");
        let address = listener.local_addr().expect("read loopback origin address");
        let server_config = tokio_rustls::rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                vec![CertificateDer::from(
                    credentials.origin_certificate_der.clone(),
                )],
                PrivateKeyDer::try_from(credentials.origin_private_key_der.clone())
                    .expect("parse test origin private key"),
            )
            .expect("configure loopback HTTPS origin");
        let acceptor = TlsAcceptor::from(Arc::new(server_config));
        let (sender, requests) = mpsc::unbounded_channel();
        let request_count = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&request_count);
        let response = http_response();
        let response_for_server = response.clone();
        let task = tokio::spawn(async move {
            loop {
                let Ok((socket, _)) = listener.accept().await else {
                    return;
                };
                let Ok(mut stream) = acceptor.accept(socket).await else {
                    continue;
                };
                let mut request = Vec::new();
                let mut buffer = [0_u8; 2048];
                loop {
                    let Ok(read) = stream.read(&mut buffer).await else {
                        break;
                    };
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..read]);
                    if request.windows(4).any(|window| window == b"\r\n\r\n") {
                        count.fetch_add(1, Ordering::AcqRel);
                        let _ = sender.send(request);
                        let _ = stream.write_all(&response_for_server).await;
                        let _ = stream.shutdown().await;
                        break;
                    }
                    if request.len() > 64 * 1024 {
                        break;
                    }
                }
            }
        });
        Self {
            address,
            requests,
            request_count,
            task,
            response,
        }
    }

    async fn next_request(&mut self) -> Vec<u8> {
        timeout(Duration::from_secs(30), self.requests.recv())
            .await
            .expect("loopback origin request timed out")
            .expect("loopback origin request channel closed")
    }

    async fn assert_request_count(&self, expected: usize) {
        sleep(Duration::from_millis(200)).await;
        assert_eq!(
            self.request_count.load(Ordering::Acquire),
            expected,
            "origin request count must not increase"
        );
    }

    fn request_count(&self) -> usize {
        self.request_count.load(Ordering::Acquire)
    }

    async fn stop(self) {
        self.task.abort();
        let _ = self.task.await;
    }
}

fn http_response() -> Vec<u8> {
    let mut response = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        ORIGIN_RESPONSE_BODY.len()
    )
    .into_bytes();
    response.extend_from_slice(ORIGIN_RESPONSE_BODY);
    response
}

#[derive(Clone, Copy)]
enum DisclosureMode {
    Complete,
    Sparse,
}

struct GrantFixture {
    binding: String,
    bytes: Vec<u8>,
    session_id: String,
    device_id: String,
}

fn make_grant(
    authority_seed: [u8; 32],
    device_id: &str,
    session_id: Uuid,
    binding_nonce: [u8; 32],
    issued_at_ms: u64,
    expires_at_ms: u64,
) -> GrantFixture {
    let binding = binding_value(session_id, binding_nonce);
    let authority = Ed25519KeyPair::from_seed_unchecked(&authority_seed)
        .expect("construct test Session Authority key");
    let signing_bytes = SessionContextGrant::signing_bytes_for(
        AUTHORITY_KEY_ID,
        &session_id.to_string(),
        &binding,
        device_id_commitment(device_id).expect("commit test device identity"),
        [binding_nonce[0].wrapping_add(1); 32],
        issued_at_ms,
        expires_at_ms,
    )
    .expect("encode test Session Authority grant");
    let signature = authority.sign(&signing_bytes);
    let mut bytes = signing_bytes;
    bytes.extend_from_slice(signature.as_ref());
    SessionContextGrant::parse(&bytes).expect("parse test Session Authority grant");
    GrantFixture {
        binding,
        bytes,
        session_id: session_id.to_string(),
        device_id: device_id.to_owned(),
    }
}

fn fresh_grant(device_id: &str, nonce: u8) -> GrantFixture {
    let now = now_ms();
    make_grant(
        AUTHORITY_SEED,
        device_id,
        Uuid::new_v4(),
        [nonce; 32],
        now.saturating_sub(100),
        now + 10 * 60 * 1000,
    )
}

fn binding_value(session_id: Uuid, nonce: [u8; 32]) -> String {
    let mut bytes = Vec::with_capacity(BINDING_PREFIX.len() + 2 + 16 + 2 + 32);
    bytes.extend_from_slice(BINDING_PREFIX);
    bytes.extend_from_slice(&16_u16.to_be_bytes());
    bytes.extend_from_slice(session_id.as_bytes());
    bytes.extend_from_slice(&32_u16.to_be_bytes());
    bytes.extend_from_slice(&nonce);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn now_ms() -> u64 {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_millis(),
    )
    .expect("current time fits u64")
}

fn request_for(grant: &GrantFixture) -> SerializedOriginRequest {
    synthetic_test_request_with_grant(ORIGIN_IDENTITY, grant.binding.clone(), grant.bytes.clone())
        .expect("serialize headerless loopback request")
}

fn notary_verifying_key() -> VerifyingKey {
    verifying_key_from_private_key(&NOTARY_SIGNING_KEY).expect("derive pinned local Notary key")
}

fn notary_key_bytes() -> Vec<u8> {
    bincode::serialize(&notary_verifying_key()).expect("serialize local Notary public key")
}

fn origin_config(address: SocketAddr, root_der: &[u8]) -> OriginTransportConfig {
    let target = OriginTarget::new(
        ORIGIN_IDENTITY.to_owned(),
        address.port(),
        ORIGIN_IDENTITY.to_owned(),
    )
    .expect("configure canonical loopback TLS identity")
    .with_local_test_connect_address(address)
    .expect("restrict origin connection to loopback");
    let tls =
        OriginTlsConfig::for_local_test(root_der.to_vec()).expect("pin loopback test trust anchor");
    let identity_policy = ServerIdentityPolicy::from_approved_targets(vec![(
        ORIGIN_IDENTITY.to_owned(),
        address.port(),
    )])
    .expect("allow the single loopback DNS identity");
    OriginTransportConfig::new(target, tls, identity_policy, true)
}

fn lifecycle() -> ExchangeLifecycle {
    ExchangePolicy::from_millis(Some("60000"), Some("5000"))
        .expect("configure test exchange timeouts")
        .start()
        .expect("start test exchange lifecycle")
}

fn make_transport(
    config: OriginTransportConfig,
    endpoint: &str,
    verifying_key: VerifyingKey,
    mode: DisclosureMode,
    grant_override: Option<Vec<u8>>,
    extra_extensions: Vec<Extension>,
) -> (ProductionAlpha15OriginTransport, Arc<PresentationHandoff>) {
    make_transport_with_scope(
        config,
        endpoint,
        verifying_key,
        mode,
        NOTARY_ID,
        ENVIRONMENT,
        grant_override,
        extra_extensions,
    )
}

fn make_transport_with_scope(
    config: OriginTransportConfig,
    endpoint: &str,
    verifying_key: VerifyingKey,
    mode: DisclosureMode,
    expected_notary_id: &str,
    expected_environment: &str,
    grant_override: Option<Vec<u8>>,
    extra_extensions: Vec<Extension>,
) -> (ProductionAlpha15OriginTransport, Arc<PresentationHandoff>) {
    let handoff = PresentationHandoff::new();
    let limit = NotaryAttestationLimit::from_bytes(Some("8388608"))
        .expect("set bounded Notary result size");
    let factory = match mode {
        DisclosureMode::Complete => RealAlpha15OriginTransportFactory::new(
            endpoint.to_owned(),
            verifying_key,
            expected_notary_id.to_owned(),
            expected_environment.to_owned(),
            Arc::clone(&handoff),
            limit,
        ),
        DisclosureMode::Sparse => RealAlpha15OriginTransportFactory::new_sparse(
            endpoint.to_owned(),
            verifying_key,
            expected_notary_id.to_owned(),
            expected_environment.to_owned(),
            Arc::clone(&handoff),
            limit,
        ),
    }
    .expect("construct real alpha.15 transport");
    let factory = factory.with_test_attestation_extensions(grant_override, extra_extensions);
    let factory: Arc<dyn Alpha15OriginTransportFactory> = Arc::new(factory);
    (
        ProductionAlpha15OriginTransport::new(config, factory)
            .expect("construct production transport with loopback-only config"),
        handoff,
    )
}

struct RunOutcome {
    response: Vec<u8>,
    presentation: Result<Vec<u8>, String>,
}

async fn run_once(
    config: OriginTransportConfig,
    endpoint: &str,
    request: SerializedOriginRequest,
    verifying_key: VerifyingKey,
    mode: DisclosureMode,
    grant_override: Option<Vec<u8>>,
    extra_extensions: Vec<Extension>,
) -> Result<RunOutcome, String> {
    run_once_with_scope(
        config,
        endpoint,
        request,
        verifying_key,
        mode,
        NOTARY_ID,
        ENVIRONMENT,
        grant_override,
        extra_extensions,
    )
    .await
}

async fn run_once_with_scope(
    config: OriginTransportConfig,
    endpoint: &str,
    request: SerializedOriginRequest,
    verifying_key: VerifyingKey,
    mode: DisclosureMode,
    expected_notary_id: &str,
    expected_environment: &str,
    grant_override: Option<Vec<u8>>,
    extra_extensions: Vec<Extension>,
) -> Result<RunOutcome, String> {
    let (transport, handoff) = make_transport_with_scope(
        config,
        endpoint,
        verifying_key,
        mode,
        expected_notary_id,
        expected_environment,
        grant_override,
        extra_extensions,
    );
    let capture: TlsnOriginCapture = transport
        .send_once_with_lifecycle(request.clone(), lifecycle())
        .await
        .map_err(|error| format!("Production transport failed: {error}"))?;
    let response = capture.exchange.response.raw_response_bytes.to_vec();
    let request_digest = sha256(request.bytes());
    let presentation = match capture.proof.run().await {
        Ok(()) => handoff
            .take_for_capture(
                request
                    .capture_identifier()
                    .expect("transport request must be bound to a capture"),
                &request_digest,
            )
            .map(|presentation| presentation.bytes().to_vec())
            .map_err(|error| format!("take TLSN Presentation: {error}")),
        Err(error) => Err(format!("TLSN proof continuation failed: {error}")),
    };
    Ok(RunOutcome {
        response,
        presentation,
    })
}

fn verify_presentation(
    presentation_bytes: &[u8],
    grant: &GrantFixture,
    request_bytes: &[u8],
    credentials: &Credentials,
    mode: DisclosureMode,
) {
    let authenticated = verify_alpha15_presentation_with_trusted_notary_key_and_trust_anchor(
        presentation_bytes,
        &credentials.root_der,
        &notary_key_bytes(),
    )
    .expect("independently verify TLSN Presentation, Web PKI, and Notary signature");
    let profile =
        SessionExtensionRequireInfoDisclosureProfile::from_server_identity_and_session_authority(
            ORIGIN_IDENTITY,
            AUTHORITY_KEY_ID,
            &synthetic_session_authority_public_key_spki(),
        )
        .expect("configure independent Session Authority pin");
    let result = match mode {
        DisclosureMode::Complete => authenticated
            .verify_require_info_with_session_extension(&profile, &ParserLimits::default()),
        DisclosureMode::Sparse => authenticated
            .verify_require_info_sparse_with_session_extension(&profile, &ParserLimits::default()),
    }
    .expect("verify authenticated require-info and Notary acceptance extensions");
    assert_eq!(result.server_identity(), ORIGIN_IDENTITY);
    assert_eq!(
        result.session_context().unwrap().grant.encoded(),
        grant.bytes
    );
    assert_eq!(
        result.session_context().unwrap().acceptance.policy_id(),
        NOTARY_SESSION_CONTEXT_POLICY_ID
    );
    if matches!(mode, DisclosureMode::Complete) {
        assert!(result.request_transcript_sha256().is_some());
    }
    if let Some(request_digest) = result.request_transcript_sha256() {
        assert_eq!(request_digest, &sha256(request_bytes));
    }
    assert_eq!(
        reconstruct_ranges(
            result.revealed_request_ranges(),
            result.request_transcript_size()
        ),
        request_bytes
    );
}

fn reconstruct_ranges(ranges: &[RevealedRange], size: u64) -> Vec<u8> {
    let size = usize::try_from(size).expect("authenticated transcript size fits usize");
    let mut bytes = vec![None; size];
    for range in ranges {
        assert_eq!(
            usize::try_from(range.length).expect("range length fits usize"),
            range.bytes.len()
        );
        let start = usize::try_from(range.start).expect("range start fits usize");
        let end = start
            .checked_add(range.bytes.len())
            .expect("revealed range end fits usize");
        assert!(end <= size, "revealed range is within transcript");
        for (slot, byte) in bytes[start..end].iter_mut().zip(&range.bytes) {
            assert!(
                slot.replace(*byte).is_none(),
                "transcript ranges do not overlap"
            );
        }
    }
    bytes
        .into_iter()
        .map(|byte| byte.expect("complete request transcript is disclosed"))
        .collect()
}

fn assert_headerless_request(actual: &[u8], expected: &[u8]) {
    assert_eq!(
        actual, expected,
        "origin receives exact serialized HTTP bytes"
    );
    for forbidden in [
        b"X-Attestation-Binding:".as_slice(),
        b"Cookie:".as_slice(),
        b"X-FUSOU-".as_slice(),
    ] {
        assert!(
            !actual
                .windows(forbidden.len())
                .any(|window| window.eq_ignore_ascii_case(forbidden)),
            "origin request does not contain FUSOU correlation headers"
        );
    }
    assert!(!actual.windows(1).any(|window| window == b"?"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn separate_notary_completes_complete_and_sparse_roundtrips_and_replays_exact_results() {
    let workspace = TestWorkspace::new();
    let credentials = Credentials::new();
    let files = NotaryFiles::initialize(&workspace, &credentials);
    let mut notary =
        NotaryProcess::spawn(&workspace, &files, "none").expect("start separate local Notary");
    let mut origin = LoopbackOrigin::start(&credentials).await;
    let config = origin_config(origin.address, &credentials.root_der);
    let mut finalized = Vec::new();

    for (mode, nonce) in [
        (DisclosureMode::Complete, 0x31),
        (DisclosureMode::Sparse, 0x32),
    ] {
        let grant = fresh_grant(DEVICE_ID, nonce);
        let request = request_for(&grant);
        let request_bytes = request.bytes().to_vec();
        let outcome = run_once(
            config.clone(),
            &notary.endpoint,
            request.clone(),
            notary_verifying_key(),
            mode,
            None,
            Vec::new(),
        )
        .await
        .expect("run actual alpha.15 TCP transport");
        assert_eq!(outcome.response, origin.response);
        let origin_request = origin.next_request().await;
        assert_headerless_request(&origin_request, &request_bytes);
        let presentation = outcome
            .presentation
            .expect("separate Notary signs the live TLSN Attestation");
        verify_presentation(&presentation, &grant, &request_bytes, &credentials, mode);

        let exact_result = notary_wire::query_finalized_result(&notary.endpoint, &grant.bytes)
            .await
            .expect("query stored exact finalized Attestation");
        let _: Attestation =
            bincode::deserialize(&exact_result).expect("decode stored Notary Attestation");
        finalized.push((grant, request, exact_result));
    }
    assert_eq!(origin.request_count(), 2);

    let stopped = notary.stop().expect("stop first Notary process");
    assert!(
        stopped.success(),
        "normal Notary stop should exit successfully"
    );
    let mut restarted =
        NotaryProcess::spawn(&workspace, &files, "none").expect("restart existing Notary store");
    for (grant, _, previous_exact_result) in &finalized {
        let exact_result = notary_wire::query_finalized_result(&restarted.endpoint, &grant.bytes)
            .await
            .expect("read exact finalized result after Notary restart");
        assert_eq!(&exact_result, previous_exact_result);
    }

    let (grant, request, _) = &finalized[0];
    let duplicate = run_once(
        config,
        &restarted.endpoint,
        request.clone(),
        notary_verifying_key(),
        DisclosureMode::Complete,
        None,
        Vec::new(),
    )
    .await;
    assert!(duplicate.is_err(), "finalized grant cannot be re-admitted");
    origin.assert_request_count(2).await;
    assert_eq!(origin.request_count(), 2);
    let stopped = restarted.stop().expect("stop restarted Notary");
    assert!(
        stopped.success(),
        "restarted Notary stop should exit successfully"
    );
    assert_eq!(
        LocalTestNotary::open_existing(
            files.store.clone(),
            synthetic_session_authority_public_key_spki(),
            AUTHORITY_KEY_ID,
            NOTARY_ID,
            ENVIRONMENT,
        )
        .expect("inspect persistent Notary state after restart")
        .status(&grant.bytes)
        .expect("read finalized status"),
        NotaryGrantStatus::Finalized
    );
    origin.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn shared_transport_isolates_identical_request_bytes_by_capture_binding() {
    let workspace = TestWorkspace::new();
    let credentials = Credentials::new();
    let files = NotaryFiles::initialize(&workspace, &credentials);
    let mut notary =
        NotaryProcess::spawn(&workspace, &files, "none").expect("start separate local Notary");
    let mut origin = LoopbackOrigin::start(&credentials).await;
    let config = origin_config(origin.address, &credentials.root_der);
    let (transport, handoff) = make_transport_with_scope(
        config,
        &notary.endpoint,
        notary_verifying_key(),
        DisclosureMode::Complete,
        NOTARY_ID,
        ENVIRONMENT,
        None,
        Vec::new(),
    );
    let mut first_request = None;
    let mut first_serialized_request = None;

    for nonce in [0x61, 0x62] {
        let grant = fresh_grant(DEVICE_ID, nonce);
        let request = request_for(&grant);
        let request_bytes = request.bytes().to_vec();
        if let Some(first_request) = first_request.as_ref() {
            assert_eq!(request_bytes, *first_request);
        } else {
            first_request = Some(request_bytes.clone());
            first_serialized_request = Some(request.clone());
        }

        let capture = transport
            .send_once_with_lifecycle(request.clone(), lifecycle())
            .await
            .expect("shared transport permits a distinct capture binding");
        assert_eq!(
            capture.exchange.response.raw_response_bytes.as_ref(),
            origin.response
        );
        assert_headerless_request(&origin.next_request().await, &request_bytes);
        capture
            .proof
            .run()
            .await
            .expect("Notary completes this capture's Presentation");
        let presentation = handoff
            .take_for_capture(
                request
                    .capture_identifier()
                    .expect("serialized request has a capture identifier"),
                &sha256(request.bytes()),
            )
            .expect("take this capture's Presentation")
            .bytes()
            .to_vec();
        verify_presentation(
            &presentation,
            &grant,
            &request_bytes,
            &credentials,
            DisclosureMode::Complete,
        );
        transport
            .finish_capture(
                request
                    .capture_identifier()
                    .expect("serialized request has a capture identifier"),
            )
            .expect("release transport state for completed capture");
    }

    assert_eq!(origin.request_count(), 2);
    assert!(
        transport
            .send_once_with_lifecycle(
                first_serialized_request.expect("retain first capture for replay test"),
                lifecycle(),
            )
            .await
            .is_err(),
        "a finalized grant cannot cause another origin send",
    );
    origin.assert_request_count(2).await;
    origin.stop().await;
    let stopped = notary.stop().expect("stop separate local Notary");
    assert!(stopped.success(), "Notary should stop successfully");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn notary_rejects_unsupported_mpc_config_before_setup_without_publishing_result() {
    let workspace = TestWorkspace::new();
    let credentials = Credentials::new();
    let files = NotaryFiles::initialize(&workspace, &credentials);
    let mut notary =
        NotaryProcess::spawn(&workspace, &files, "none").expect("start separate local Notary");
    let grant = fresh_grant(DEVICE_ID, 0x63);

    let mut socket = TcpStream::connect(&notary.endpoint)
        .await
        .expect("connect to loopback Notary");
    notary_wire::client_admit(
        &mut socket,
        &grant.bytes,
        &notary_verifying_key(),
        NOTARY_ID,
        ENVIRONMENT,
    )
    .await
    .expect("complete signed Session grant admission");

    let session = Session::new(socket.compat());
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);
    let prover = handle
        .new_prover(
            ProverConfig::builder()
                .build()
                .expect("build test prover configuration"),
        )
        .expect("create test prover");
    let unsupported_config = MpcTlsConfig::builder()
        .max_sent_data(128 * 1024 + 1)
        .max_recv_data(4 * 1024 * 1024)
        .build()
        .expect("build over-limit MPC-TLS proposal");
    let commit_result = timeout(Duration::from_secs(10), prover.commit(unsupported_config)).await;
    assert!(
        matches!(commit_result, Ok(Err(_))),
        "Notary must reject the proposal before accepting or setting up MPC-TLS"
    );
    handle.close();
    let driver_result = timeout(Duration::from_secs(10), driver_task)
        .await
        .expect("client TLSN session driver terminates after rejection");
    assert!(
        driver_result.is_ok(),
        "client TLSN session driver must not panic after rejection"
    );

    let stopped = notary.stop().expect("stop Notary after config rejection");
    assert!(
        stopped.success(),
        "Notary should stop cleanly after rejecting the config"
    );
    let reopened = LocalTestNotary::open_existing(
        files.store.clone(),
        synthetic_session_authority_public_key_spki(),
        AUTHORITY_KEY_ID,
        NOTARY_ID,
        ENVIRONMENT,
    )
    .expect("reopen the same Notary ledger");
    assert_eq!(
        reopened.status(&grant.bytes).expect("read grant state"),
        NotaryGrantStatus::Unknown,
        "rejected configuration must not return an admitted grant to Unused"
    );
    assert!(
        reopened.exact_result(&grant.bytes).is_err(),
        "rejected configuration must not publish a finalized Attestation"
    );
    assert!(
        reopened.admit_grant(&grant.bytes, now_ms()).is_err(),
        "a grant admitted before config rejection cannot be reused"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn finalized_parent_directory_sync_failure_hides_result_until_same_ledger_reopens() {
    let workspace = TestWorkspace::new();
    let credentials = Credentials::new();
    let files = NotaryFiles::initialize(&workspace, &credentials);
    let mut notary = NotaryProcess::spawn_capturing_stderr(
        &workspace,
        &files,
        "after-finalized-parent-directory-sync",
    )
    .expect("start Notary with parent-directory sync fault injection");
    let mut origin = LoopbackOrigin::start(&credentials).await;
    let config = origin_config(origin.address, &credentials.root_der);
    let grant = fresh_grant(DEVICE_ID, 0x7d);
    let request = request_for(&grant);
    let outcome = run_once(
        config.clone(),
        &notary.endpoint,
        request.clone(),
        notary_verifying_key(),
        DisclosureMode::Complete,
        None,
        Vec::new(),
    )
    .await
    .expect("capture preserves the received origin response after proof failure");
    assert_eq!(outcome.response, origin.response);
    assert!(
        outcome.presentation.is_err(),
        "uncertain Finalized persistence must not complete the TLSN result"
    );
    assert_headerless_request(&origin.next_request().await, request.bytes());
    assert_eq!(origin.request_count(), 1);
    for _ in 0..3 {
        assert!(
            notary_wire::query_finalized_result(&notary.endpoint, &grant.bytes)
                .await
                .is_err(),
            "a separate QueryFinalized connection cannot expose uncertain bytes"
        );
    }

    let ledger: serde_json::Value = serde_json::from_slice(
        &fs::read(&files.store).expect("read visible ledger after successful rename"),
    )
    .expect("parse visible Notary ledger");
    let grant_digest =
        URL_SAFE_NO_PAD.encode(SessionContextGrant::parse(&grant.bytes).unwrap().digest());
    let state = &ledger["grants"][&grant_digest]["state"];
    assert_eq!(
        state["state"].as_str(),
        Some("finalized"),
        "the injected failure occurs after the Finalized rename"
    );
    let persisted_result = URL_SAFE_NO_PAD
        .decode(
            state["exact_result_base64url"]
                .as_str()
                .expect("Finalized ledger row contains exact result bytes"),
        )
        .expect("decode exact result bytes from renamed ledger");
    let _: Attestation =
        bincode::deserialize(&persisted_result).expect("renamed result is a signed Attestation");

    assert!(
        notary
            .stop()
            .expect("stop quarantined Notary process")
            .success(),
        "fault-injected Notary exits cleanly after the connection failure"
    );
    let diagnostic_bytes = notary
        .read_stderr()
        .expect("capture durability diagnostics from standard error");
    let diagnostics = String::from_utf8_lossy(&diagnostic_bytes);
    assert_eq!(
        diagnostics
            .matches("notary_ledger_persistence_uncertain")
            .count(),
        1,
        "the durability transition emits one stable diagnostic, even after repeated queries: {diagnostics}"
    );
    assert!(
        diagnostics.contains("Notary ledger durability is unconfirmed"),
        "the diagnostic identifies the fail-closed persistence state: {diagnostics}"
    );
    for secret_bytes in [grant.bytes.as_slice(), persisted_result.as_slice()] {
        assert!(
            !diagnostic_bytes
                .windows(secret_bytes.len())
                .any(|window| window == secret_bytes),
            "standard error does not contain raw grant or Attestation bytes"
        );
        let encoded_secret = URL_SAFE_NO_PAD.encode(secret_bytes);
        assert!(
            !diagnostics.contains(encoded_secret.as_str()),
            "standard error does not contain a base64url grant or Attestation"
        );
    }
    let mut restarted =
        NotaryProcess::spawn(&workspace, &files, "none").expect("reopen the same ledger");
    let recovered = notary_wire::query_finalized_result(&restarted.endpoint, &grant.bytes)
        .await
        .expect("read exact result only after same-ledger durability verification");
    assert_eq!(recovered, persisted_result);
    let _: Attestation =
        bincode::deserialize(&recovered).expect("recovered exact Attestation remains valid");

    assert!(
        run_once(
            config,
            &restarted.endpoint,
            request,
            notary_verifying_key(),
            DisclosureMode::Complete,
            None,
            Vec::new(),
        )
        .await
        .is_err(),
        "the finalized grant cannot be re-admitted or re-signed after restart"
    );
    origin.assert_request_count(1).await;
    origin.stop().await;
    assert!(restarted.stop().expect("stop recovered Notary").success());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn wrong_authority_signature_expiry_and_notary_pin_never_send_origin_http() {
    let workspace = TestWorkspace::new();
    let credentials = Credentials::new();
    let files = NotaryFiles::initialize(&workspace, &credentials);
    let mut notary =
        NotaryProcess::spawn(&workspace, &files, "none").expect("start separate local Notary");
    let origin = LoopbackOrigin::start(&credentials).await;
    let config = origin_config(origin.address, &credentials.root_der);
    let now = now_ms();

    let wrong_authority = make_grant(
        [43; 32],
        DEVICE_ID,
        Uuid::new_v4(),
        [0x41; 32],
        now.saturating_sub(100),
        now + 60_000,
    );
    let mut invalid_signature = fresh_grant(DEVICE_ID, 0x42);
    let last = invalid_signature.bytes.len() - 1;
    invalid_signature.bytes[last] ^= 1;
    let expired = make_grant(
        AUTHORITY_SEED,
        DEVICE_ID,
        Uuid::new_v4(),
        [0x43; 32],
        now.saturating_sub(20_000),
        now.saturating_sub(10_000),
    );
    for grant in [&wrong_authority, &invalid_signature, &expired] {
        let rejected = run_once(
            config.clone(),
            &notary.endpoint,
            request_for(grant),
            notary_verifying_key(),
            DisclosureMode::Complete,
            None,
            Vec::new(),
        )
        .await;
        assert!(
            rejected.is_err(),
            "invalid grant is rejected before origin send"
        );
    }

    let valid_grant = fresh_grant(DEVICE_ID, 0x44);
    let wrong_notary_pin = notary_wire::verifying_key_from_private_key(&[2_u8; 32])
        .expect("derive deliberately wrong local Notary pin");
    let rejected = run_once(
        config.clone(),
        &notary.endpoint,
        request_for(&valid_grant),
        wrong_notary_pin,
        DisclosureMode::Complete,
        None,
        Vec::new(),
    )
    .await;
    assert!(
        rejected.is_err(),
        "incorrect Notary signature pin is rejected before origin send"
    );
    for (expected_notary_id, expected_environment, nonce) in [
        ("unexpected-notary", ENVIRONMENT, 0x45),
        (NOTARY_ID, "unexpected-environment", 0x46),
    ] {
        let grant = fresh_grant(DEVICE_ID, nonce);
        let rejected = run_once_with_scope(
            config.clone(),
            &notary.endpoint,
            request_for(&grant),
            notary_verifying_key(),
            DisclosureMode::Complete,
            expected_notary_id,
            expected_environment,
            None,
            Vec::new(),
        )
        .await;
        assert!(
            rejected.is_err(),
            "wrong Notary ID or environment acknowledgement is rejected before origin send"
        );
    }
    origin.assert_request_count(0).await;
    assert_eq!(origin.request_count(), 0);
    let stopped = notary.stop().expect("stop Notary after rejection cases");
    assert!(
        stopped.success(),
        "Notary exits normally after rejected grants"
    );
    origin.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn foreign_live_grant_and_client_acceptance_are_rejected_after_one_origin_send() {
    let workspace = TestWorkspace::new();
    let credentials = Credentials::new();
    let files = NotaryFiles::initialize(&workspace, &credentials);
    let mut notary =
        NotaryProcess::spawn(&workspace, &files, "none").expect("start separate local Notary");
    let mut origin = LoopbackOrigin::start(&credentials).await;
    let config = origin_config(origin.address, &credentials.root_der);

    let foreign_grant = fresh_grant(OTHER_DEVICE_ID, 0x51);
    let local_grant = fresh_grant(DEVICE_ID, 0x52);
    assert_ne!(foreign_grant.session_id, local_grant.session_id);
    assert_ne!(foreign_grant.device_id, local_grant.device_id);
    assert_ne!(foreign_grant.binding, local_grant.binding);
    let foreign_request = request_for(&foreign_grant);
    let foreign_bytes = foreign_request.bytes().to_vec();
    let foreign_result = run_once(
        config.clone(),
        &notary.endpoint,
        foreign_request,
        notary_verifying_key(),
        DisclosureMode::Complete,
        None,
        Vec::new(),
    )
    .await
    .expect("complete a second, independent live TLSN connection");
    assert_eq!(foreign_result.response, origin.response);
    assert_headerless_request(&origin.next_request().await, &foreign_bytes);
    let foreign_presentation = foreign_result
        .presentation
        .expect("foreign operation itself finalizes successfully");
    verify_presentation(
        &foreign_presentation,
        &foreign_grant,
        &foreign_bytes,
        &credentials,
        DisclosureMode::Complete,
    );

    let local_request = request_for(&local_grant);
    let local_bytes = local_request.bytes().to_vec();
    let substituted = run_once(
        config.clone(),
        &notary.endpoint,
        local_request,
        notary_verifying_key(),
        DisclosureMode::Complete,
        Some(foreign_grant.bytes.clone()),
        Vec::new(),
    )
    .await
    .expect("origin response is preserved when proof binding fails");
    assert_eq!(substituted.response, origin.response);
    assert!(substituted.presentation.is_err());
    assert_headerless_request(&origin.next_request().await, &local_bytes);

    let acceptance_grant = fresh_grant(DEVICE_ID, 0x53);
    let acceptance_request = request_for(&acceptance_grant);
    let acceptance_bytes = acceptance_request.bytes().to_vec();
    let client_acceptance = Extension {
        id: NOTARY_SESSION_CONTEXT_ACCEPTED_EXTENSION_ID.to_vec(),
        value: vec![1, 2, 3],
    };
    let forged = run_once(
        config,
        &notary.endpoint,
        acceptance_request,
        notary_verifying_key(),
        DisclosureMode::Complete,
        None,
        vec![client_acceptance],
    )
    .await
    .expect("game response remains available after proof rejection");
    assert_eq!(forged.response, origin.response);
    assert!(forged.presentation.is_err());
    assert_headerless_request(&origin.next_request().await, &acceptance_bytes);
    assert_eq!(origin.request_count(), 3);

    let stopped = notary
        .stop()
        .expect("stop Notary after proof rejection cases");
    assert!(
        stopped.success(),
        "Notary exits normally after rejected proof extensions"
    );
    origin.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_same_grant_admission_has_one_origin_send_and_one_final_result() {
    let workspace = TestWorkspace::new();
    let credentials = Credentials::new();
    let files = NotaryFiles::initialize(&workspace, &credentials);
    let mut notary =
        NotaryProcess::spawn(&workspace, &files, "none").expect("start separate local Notary");
    let mut origin = LoopbackOrigin::start(&credentials).await;
    let config = origin_config(origin.address, &credentials.root_der);
    let grant = fresh_grant(DEVICE_ID, 0x61);
    let request = request_for(&grant);

    let left = run_once(
        config.clone(),
        &notary.endpoint,
        request.clone(),
        notary_verifying_key(),
        DisclosureMode::Complete,
        None,
        Vec::new(),
    );
    let right = run_once(
        config,
        &notary.endpoint,
        request.clone(),
        notary_verifying_key(),
        DisclosureMode::Complete,
        None,
        Vec::new(),
    );
    let (left, right) = tokio::join!(left, right);
    let mut successes = 0;
    let mut proof_failures = 0;
    for result in [left, right] {
        match result {
            Ok(outcome) if outcome.presentation.is_ok() => successes += 1,
            Ok(_) => proof_failures += 1,
            Err(_) => {}
        }
    }
    assert_eq!(
        successes, 1,
        "exactly one same-grant transport may finalize"
    );
    assert_eq!(proof_failures, 0, "winning Notary proof must verify");
    let origin_request = origin.next_request().await;
    assert_headerless_request(&origin_request, request.bytes());
    sleep(Duration::from_millis(200)).await;
    assert_eq!(origin.request_count(), 1);
    assert!(
        notary_wire::query_finalized_result(&notary.endpoint, &grant.bytes)
            .await
            .is_ok(),
        "the single winning grant has one finalized result"
    );
    let stopped = notary.stop().expect("stop concurrent-use Notary");
    assert!(
        stopped.success(),
        "Notary exits normally after concurrency test"
    );
    origin.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn interrupted_admission_and_signing_claim_restart_as_unknown_without_retry() {
    for (fault, nonce, expected_state) in [
        ("after-admission", 0x71, NotaryGrantStatus::Unknown),
        ("after-signing-claim", 0x72, NotaryGrantStatus::Unknown),
    ] {
        let workspace = TestWorkspace::new();
        let credentials = Credentials::new();
        let files = NotaryFiles::initialize(&workspace, &credentials);
        let mut notary =
            NotaryProcess::spawn(&workspace, &files, fault).expect("start fault-injected Notary");
        let mut origin = LoopbackOrigin::start(&credentials).await;
        let config = origin_config(origin.address, &credentials.root_der);
        let grant = fresh_grant(DEVICE_ID, nonce);
        let request = request_for(&grant);
        let first = run_once(
            config.clone(),
            &notary.endpoint,
            request.clone(),
            notary_verifying_key(),
            DisclosureMode::Complete,
            None,
            Vec::new(),
        )
        .await;
        if fault == "after-signing-claim" {
            let outcome = first.expect("origin response returns before the signing fault");
            assert_eq!(outcome.response, origin.response);
            assert!(outcome.presentation.is_err());
            assert_headerless_request(&origin.next_request().await, request.bytes());
            assert_eq!(origin.request_count(), 1);
        } else {
            assert!(
                first.is_err(),
                "Notary interruption prevents proof completion"
            );
            sleep(Duration::from_millis(200)).await;
            assert_eq!(
                origin.request_count(),
                0,
                "admission interruption happens before origin HTTP bytes"
            );
        }
        let exit = timeout(Duration::from_secs(10), async {
            loop {
                if let Some(status) = notary
                    .child
                    .try_wait()
                    .expect("poll fault-injected Notary child")
                {
                    return status;
                }
                sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("fault-injected Notary exits");
        assert_eq!(exit.code(), Some(86));
        let _ = notary.stop().expect("reap interrupted Notary process");

        let reopened = LocalTestNotary::open_existing(
            files.store.clone(),
            synthetic_session_authority_public_key_spki(),
            AUTHORITY_KEY_ID,
            NOTARY_ID,
            ENVIRONMENT,
        )
        .expect("open existing interrupted store without reinitialization");
        assert_eq!(
            reopened
                .status(&grant.bytes)
                .expect("read interrupted grant status"),
            expected_state
        );
        assert!(reopened.admit_grant(&grant.bytes, now_ms()).is_err());
        drop(reopened);

        let mut restarted =
            NotaryProcess::spawn(&workspace, &files, "none").expect("restart Unknown state");
        let retry = run_once(
            config.clone(),
            &restarted.endpoint,
            request,
            notary_verifying_key(),
            DisclosureMode::Complete,
            None,
            Vec::new(),
        )
        .await;
        assert!(
            retry.is_err(),
            "Unknown grant cannot be admitted after restart"
        );
        let sends_before_new_capture = if fault == "after-signing-claim" { 1 } else { 0 };
        origin.assert_request_count(sends_before_new_capture).await;

        let next_grant = fresh_grant(DEVICE_ID, nonce + 1);
        assert_ne!(next_grant.session_id, grant.session_id);
        let next_request = request_for(&next_grant);
        let next_request_bytes = next_request.bytes().to_vec();
        let next_capture = run_once(
            config,
            &restarted.endpoint,
            next_request,
            notary_verifying_key(),
            DisclosureMode::Complete,
            None,
            Vec::new(),
        )
        .await
        .expect("new client request starts a new capture with a new grant");
        assert_eq!(next_capture.response, origin.response);
        assert_headerless_request(&origin.next_request().await, &next_request_bytes);
        verify_presentation(
            &next_capture
                .presentation
                .expect("new capture finalizes independently"),
            &next_grant,
            &next_request_bytes,
            &credentials,
            DisclosureMode::Complete,
        );
        assert_eq!(
            origin.request_count(),
            sends_before_new_capture + 1,
            "new capture sends once and does not retry the interrupted one"
        );
        let stopped = restarted
            .stop()
            .expect("stop restarted Unknown-state Notary");
        assert!(stopped.success(), "Unknown-state Notary exits normally");
        origin.stop().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn missing_and_corrupt_existing_store_do_not_start_as_empty_notary() {
    for corrupt in [false, true] {
        let workspace = TestWorkspace::new();
        let credentials = Credentials::new();
        let files = NotaryFiles::initialize(&workspace, &credentials);
        if corrupt {
            fs::write(&files.store, b"{").expect("truncate initialized Notary state");
        } else {
            fs::remove_file(&files.store).expect("remove initialized Notary state");
        }
        let result = NotaryProcess::spawn(&workspace, &files, "none");
        assert!(
            result.is_err(),
            "missing/corrupt Notary store cannot go online"
        );
        assert!(
            LocalTestNotary::initialize_new(
                files.store.clone(),
                synthetic_session_authority_public_key_spki(),
                AUTHORITY_KEY_ID,
                NOTARY_ID,
                ENVIRONMENT,
            )
            .is_err(),
            "existing location is never silently reinitialized"
        );
    }
}
