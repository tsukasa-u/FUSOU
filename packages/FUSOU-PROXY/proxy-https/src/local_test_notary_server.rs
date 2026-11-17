use crate::{
    notary_wire::{self, NotaryRequestKind, MAX_FINALIZED_RESULT_BYTES},
    synthetic_notary::{
        sign_and_persist_attestation, LocalTestNotary, LOCAL_TEST_ENVIRONMENT, LOCAL_TEST_NOTARY_ID,
    },
};
use authenticity_core::is_valid_key_id;
use futures::io::AsyncReadExt as FuturesAsyncReadExt;
use futures::io::AsyncWriteExt as FuturesAsyncWriteExt;
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::SocketAddr,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tlsn::{
    attestation::request::Request as AttestationRequest,
    config::verifier::VerifierConfig,
    verifier::VerifierCommitStart,
    webpki::{CertificateDer, RootCertStore},
    Session,
};
use tokio::{
    io::AsyncWriteExt as TokioAsyncWriteExt,
    net::{TcpListener, TcpStream},
    sync::Semaphore,
};
use tokio_util::compat::TokioAsyncReadCompatExt;

const MAX_AUTHORITY_KEY_BYTES: usize = 96;
const MAX_NOTARY_SIGNING_KEY_BYTES: usize = 32;
const MAX_ROOT_CERTIFICATE_BYTES: usize = 1024 * 1024;
const MAX_ATTESTATION_REQUEST_BYTES: usize = MAX_FINALIZED_RESULT_BYTES;
const CONNECTION_LIMIT: usize = 32;
#[cfg(feature = "local-test-notary-fault-injection")]
const FAULT_EXIT_CODE: i32 = 86;

#[derive(Debug)]
pub struct LocalTestNotaryServerConfig {
    pub listen: SocketAddr,
    pub store_path: PathBuf,
    pub session_authority_public_key_path: PathBuf,
    pub session_authority_key_id: String,
    pub notary_signing_key_path: PathBuf,
    pub root_certificate_path: PathBuf,
    pub ready_file: Option<PathBuf>,
    #[cfg(feature = "local-test-notary-fault-injection")]
    pub fault: LocalTestNotaryFault,
}

#[cfg(feature = "local-test-notary-fault-injection")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalTestNotaryFault {
    None,
    ExitAfterAdmission,
    ExitAfterSigningClaim,
}

pub async fn run_local_test_notary(config: LocalTestNotaryServerConfig) -> Result<(), String> {
    if !config.listen.ip().is_loopback() {
        return Err("local test Notary must bind to a loopback address".to_owned());
    }
    if !is_valid_key_id(&config.session_authority_key_id) {
        return Err("invalid Session Authority key ID".to_owned());
    }
    let config_fault = fault_from_config(&config);
    let authority_key = read_bounded_file(
        &config.session_authority_public_key_path,
        MAX_AUTHORITY_KEY_BYTES,
    )?;
    if !authority_key.starts_with(b"\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00")
        || authority_key.len() != 44
    {
        return Err("invalid pinned Session Authority public key".to_owned());
    }
    let notary_signing_key = read_private_file(
        &config.notary_signing_key_path,
        MAX_NOTARY_SIGNING_KEY_BYTES,
    )?;
    if notary_signing_key.len() != MAX_NOTARY_SIGNING_KEY_BYTES {
        return Err("invalid Notary signing key length".to_owned());
    }
    let notary_signer = tlsn::attestation::signing::Secp256k1Signer::new(&notary_signing_key)
        .map_err(|_| "invalid local Notary signing key".to_owned())?;
    let root_certificate =
        read_bounded_file(&config.root_certificate_path, MAX_ROOT_CERTIFICATE_BYTES)?;
    if root_certificate.is_empty() {
        return Err("empty local Notary trust anchor".to_owned());
    }
    let root_store = RootCertStore {
        roots: vec![CertificateDer(root_certificate)],
    };
    tlsn::webpki::ServerCertVerifier::new(&root_store)
        .map_err(|_| "invalid local Notary trust anchor".to_owned())?;
    let notary = LocalTestNotary::open_existing(
        config.store_path,
        authority_key,
        config.session_authority_key_id,
        LOCAL_TEST_NOTARY_ID,
        LOCAL_TEST_ENVIRONMENT,
    )?;
    let listener = TcpListener::bind(config.listen)
        .await
        .map_err(|error| format!("bind local Notary listener: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("read local Notary listener address: {error}"))?;
    if !address.ip().is_loopback() {
        return Err("local test Notary listener escaped loopback".to_owned());
    }
    if let Some(path) = &config.ready_file {
        write_ready_file(path, address)?;
    }

    let root_store = std::sync::Arc::new(root_store);
    let notary = std::sync::Arc::clone(&notary);
    let signing_key = std::sync::Arc::new(notary_signing_key);
    let signer = std::sync::Arc::new(notary_signer);
    let permits = std::sync::Arc::new(Semaphore::new(CONNECTION_LIMIT));
    #[cfg(unix)]
    let mut terminate =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .map_err(|error| format!("register local Notary termination signal: {error}"))?;
    loop {
        #[cfg(unix)]
        let accepted = tokio::select! {
            accepted = listener.accept() => accepted,
            signal = tokio::signal::ctrl_c() => {
                signal.map_err(|error| format!("receive local Notary interrupt signal: {error}"))?;
                break;
            }
            _ = terminate.recv() => break,
        };
        #[cfg(not(unix))]
        let accepted = tokio::select! {
            accepted = listener.accept() => accepted,
            signal = tokio::signal::ctrl_c() => {
                signal.map_err(|error| format!("receive local Notary interrupt signal: {error}"))?;
                break;
            }
        };
        let (socket, peer) =
            accepted.map_err(|error| format!("accept local Notary connection: {error}"))?;
        if !peer.ip().is_loopback() {
            drop(socket);
            continue;
        }
        let Ok(permit) = std::sync::Arc::clone(&permits).try_acquire_owned() else {
            drop(socket);
            continue;
        };
        let notary = std::sync::Arc::clone(&notary);
        let root_store = std::sync::Arc::clone(&root_store);
        let signing_key = std::sync::Arc::clone(&signing_key);
        let signer = std::sync::Arc::clone(&signer);
        tokio::spawn(async move {
            let _permit = permit;
            if let Err(error) = handle_connection(
                socket,
                notary,
                root_store,
                signing_key,
                signer,
                config_fault,
            )
            .await
            {
                tracing::warn!(%error, "local test Notary connection failed");
            }
        });
    }
    Ok(())
}

#[cfg(feature = "local-test-notary-fault-injection")]
fn fault_from_config(config: &LocalTestNotaryServerConfig) -> LocalTestNotaryFault {
    config.fault
}

#[cfg(not(feature = "local-test-notary-fault-injection"))]
fn fault_from_config(_config: &LocalTestNotaryServerConfig) {}

async fn handle_connection(
    mut socket: TcpStream,
    notary: std::sync::Arc<LocalTestNotary>,
    root_store: std::sync::Arc<RootCertStore>,
    signing_key: std::sync::Arc<Vec<u8>>,
    signer: std::sync::Arc<tlsn::attestation::signing::Secp256k1Signer>,
    #[cfg(feature = "local-test-notary-fault-injection")] fault: LocalTestNotaryFault,
    #[cfg(not(feature = "local-test-notary-fault-injection"))] _fault: (),
) -> Result<(), String> {
    let request = notary_wire::read_request(&mut socket)
        .await
        .map_err(|error| format!("read Notary request: {error}"))?;
    match request.kind {
        NotaryRequestKind::QueryFinalized => match notary.exact_result(&request.grant) {
            Ok(Some(exact_result)) => {
                notary_wire::write_finalized_result(&mut socket, &request.nonce, &exact_result)
                    .await
                    .map_err(|error| format!("write finalized Notary result: {error}"))?;
                socket
                    .shutdown()
                    .await
                    .map_err(|error| format!("close finalized-result response: {error}"))?;
                Ok(())
            }
            Ok(None) => {
                notary_wire::write_rejected(&mut socket, &request.nonce)
                    .await
                    .map_err(|error| format!("write Notary query rejection: {error}"))?;
                Ok(())
            }
            Err(error) => Err(format!("read finalized Notary result: {error}")),
        },
        NotaryRequestKind::Admit => {
            let now_ms = now_ms()?;
            let live_session = notary
                .admit_grant(&request.grant, now_ms)
                .map_err(|error| format!("reject Session Authority grant: {error}"))?;
            notary_wire::write_admission_ack(
                &mut socket,
                &request.nonce,
                &request.grant,
                &signer,
                LOCAL_TEST_NOTARY_ID,
                LOCAL_TEST_ENVIRONMENT,
            )
            .await
            .map_err(|error| format!("send signed Notary admission: {error}"))?;
            #[cfg(feature = "local-test-notary-fault-injection")]
            if fault == LocalTestNotaryFault::ExitAfterAdmission {
                std::process::exit(FAULT_EXIT_CODE);
            }
            #[cfg(feature = "local-test-notary-fault-injection")]
            let fault = fault;
            #[cfg(not(feature = "local-test-notary-fault-injection"))]
            let fault = _fault;
            run_tlsn_attestation(socket, live_session, root_store, signing_key, fault).await
        }
    }
}

async fn run_tlsn_attestation(
    socket: TcpStream,
    live_session: crate::synthetic_notary::LiveNotarySessionContext,
    root_store: std::sync::Arc<RootCertStore>,
    signing_key: std::sync::Arc<Vec<u8>>,
    #[cfg(feature = "local-test-notary-fault-injection")] fault: LocalTestNotaryFault,
    #[cfg(not(feature = "local-test-notary-fault-injection"))] _fault: (),
) -> Result<(), String> {
    let session = Session::new(socket.compat());
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);
    let verifier_result = async {
        let verifier = handle
            .new_verifier(
                VerifierConfig::builder()
                    .root_store((*root_store).clone())
                    .build()
                    .map_err(|error| format!("build TLSN verifier config: {error}"))?,
            )
            .map_err(|error| format!("create TLSN verifier: {error}"))?
            .commit()
            .await
            .map_err(|error| format!("start TLSN verifier commitment: {error}"))?;
        let VerifierCommitStart::Mpc(verifier) = verifier else {
            return Err("Notary accepts only the pinned TLSN MPC profile".to_owned());
        };
        let verifier = verifier
            .accept()
            .await
            .map_err(|error| format!("accept TLSN MPC configuration: {error}"))?
            .run()
            .await
            .map_err(|error| format!("run TLSN MPC verifier: {error}"))?;
        let verify = verifier
            .verify()
            .await
            .map_err(|error| format!("receive TLSN proving request: {error}"))?;
        let (output, verifier) = verify
            .accept()
            .await
            .map_err(|error| format!("verify TLSN transcript proof: {error}"))?;
        let tls_transcript = verifier.tls_transcript().clone();
        verifier
            .close()
            .await
            .map_err(|error| format!("close TLSN verifier: {error}"))?;
        if output.server_name.is_none() {
            return Err("TLSN verifier did not authenticate a DNS server identity".to_owned());
        }
        Ok((output, tls_transcript))
    }
    .await;
    handle.close();
    let mut socket = driver_task
        .await
        .map_err(|error| format!("join TLSN session driver: {error}"))?
        .map_err(|error| format!("close TLSN session: {error}"))?;
    let (output, tls_transcript) = verifier_result?;
    let request_bytes = read_attestation_request(&mut socket).await?;
    let request: AttestationRequest = bincode::deserialize(&request_bytes)
        .map_err(|error| format!("decode TLSN AttestationRequest: {error}"))?;
    #[cfg(feature = "local-test-notary-fault-injection")]
    let after_claim = move || {
        if fault == LocalTestNotaryFault::ExitAfterSigningClaim {
            std::process::exit(FAULT_EXIT_CODE);
        }
    };
    #[cfg(not(feature = "local-test-notary-fault-injection"))]
    let after_claim = || {};
    let (_, exact_result) = sign_and_persist_attestation(
        request,
        &tls_transcript,
        output.transcript_commitments,
        live_session,
        &signing_key,
        after_claim,
    )?;
    socket
        .write_all(&exact_result)
        .await
        .map_err(|error| format!("write exact signed Notary result: {error}"))?;
    socket
        .close()
        .await
        .map_err(|error| format!("close exact signed Notary result: {error}"))?;
    Ok(())
}

async fn read_attestation_request(
    socket: &mut (impl futures::io::AsyncRead + Unpin),
) -> Result<Vec<u8>, String> {
    let limit = u64::try_from(MAX_ATTESTATION_REQUEST_BYTES)
        .ok()
        .and_then(|bytes| bytes.checked_add(1))
        .ok_or_else(|| "invalid Notary AttestationRequest size limit".to_owned())?;
    let mut bytes = Vec::new();
    socket
        .take(limit)
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| format!("read Notary AttestationRequest: {error}"))?;
    if bytes.is_empty() || bytes.len() > MAX_ATTESTATION_REQUEST_BYTES {
        return Err("Notary AttestationRequest is empty or too large".to_owned());
    }
    Ok(bytes)
}

fn read_bounded_file(path: &PathBuf, limit: usize) -> Result<Vec<u8>, String> {
    let file = File::open(path)
        .map_err(|error| format!("open local Notary configuration file: {error}"))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("inspect local Notary configuration file: {error}"))?;
    if metadata.len() > limit as u64 {
        return Err("local Notary configuration file exceeds its size limit".to_owned());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((limit as u64) + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("read local Notary configuration file: {error}"))?;
    if bytes.len() > limit {
        return Err("local Notary configuration file exceeds its size limit".to_owned());
    }
    Ok(bytes)
}

fn read_private_file(path: &PathBuf, limit: usize) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("inspect local Notary private-key file: {error}"))?;
    #[cfg(unix)]
    if metadata.permissions().mode() & 0o077 != 0 {
        return Err("local Notary private key must not be group/world accessible".to_owned());
    }
    read_bounded_file(path, limit)
}

fn write_ready_file(path: &PathBuf, address: SocketAddr) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(path)
        .map_err(|error| format!("create local Notary ready file: {error}"))?;
    writeln!(file, "{address}")
        .map_err(|error| format!("write local Notary ready file: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("sync local Notary ready file: {error}"))?;
    if let Some(parent) = path.parent() {
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("sync local Notary ready-file directory: {error}"))?;
    }
    Ok(())
}

fn now_ms() -> Result<u64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Notary clock is before the epoch: {error}"))?
        .as_millis();
    u64::try_from(millis).map_err(|error| format!("Notary clock is out of range: {error}"))
}
