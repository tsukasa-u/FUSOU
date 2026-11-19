use crate::{notary_server, notary_wire, synthetic_notary::DurableNotary};
use authenticity_core::is_valid_key_id;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::OpenOptions,
    io::Read,
    net::{Ipv4Addr, SocketAddrV4},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};
use tlsn::webpki::{CertificateDer, RootCertStore, ServerCertVerifier};
use tokio::net::TcpListener;

const ED25519_SPKI_PREFIX: &[u8] = b"\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00";

// Field order is the canonical lexical order expected by the offline checker.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PublicConfig {
    endpoint: String,
    environment: String,
    notary_id: String,
    notary_key_id: String,
    notary_verifying_key: String,
    session_authority_key_id: String,
    session_authority_public_key_spki: String,
    wire_version: u16,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Config {
    schema_version: u16,
    public: PublicConfig,
    listen: String,
    ledger_directory: PathBuf,
    notary_signing_key_file: PathBuf,
    origin_trust_anchor_der: PathBuf,
}

pub enum Command {
    Init,
    ExportPublic,
    Serve,
}

pub async fn run(command: Command, path: &Path) -> Result<(), String> {
    let raw = read_regular(path, 16 * 1024, true, "operator configuration")?;
    let config: Config = serde_json::from_slice(&raw)
        .map_err(|_| "invalid Notary operator configuration fields".to_owned())?;
    let public = &config.public;
    if config.schema_version != 1
        || public.wire_version != notary_wire::VERSION
        || !is_valid_key_id(&public.environment)
        || !is_valid_key_id(&public.notary_key_id)
        || !is_valid_key_id(&public.session_authority_key_id)
        || public.notary_id.is_empty()
        || public.notary_id.len() > 128
        || !public.notary_id.bytes().all(|byte| byte.is_ascii_graphic())
        || ![
            &config.ledger_directory,
            &config.notary_signing_key_file,
            &config.origin_trust_anchor_der,
        ]
        .into_iter()
        .all(|path| path.is_absolute())
    {
        return Err("unsupported or invalid Notary configuration".to_owned());
    }

    let authority_key = URL_SAFE_NO_PAD
        .decode(&public.session_authority_public_key_spki)
        .map_err(|_| "invalid Session Authority Ed25519 SPKI pin".to_owned())?;
    if authority_key.len() != 44
        || !authority_key.starts_with(ED25519_SPKI_PREFIX)
        || URL_SAFE_NO_PAD.encode(&authority_key) != public.session_authority_public_key_spki
    {
        return Err("invalid Session Authority Ed25519 SPKI pin".to_owned());
    }
    let listen = validate_loopback_endpoint(&config.listen, &public.endpoint)?;
    let signing_key = read_regular(
        &config.notary_signing_key_file,
        32,
        true,
        "Notary signing key",
    )?;
    let verifying_key = notary_wire::verifying_key_from_private_key(&signing_key)
        .map_err(|_| "invalid K256 Notary signing key".to_owned())?;
    let verifying_key = bincode::serialize(&verifying_key)
        .map_err(|_| "could not encode Notary verifying key".to_owned())?;
    if URL_SAFE_NO_PAD.encode(verifying_key) != public.notary_verifying_key {
        return Err("configured Notary K256 pin does not match the signing key".to_owned());
    }
    let anchor = read_regular(
        &config.origin_trust_anchor_der,
        1024 * 1024,
        false,
        "origin trust anchor",
    )?;
    let anchor_digest = Sha256::digest(&anchor);
    let roots = RootCertStore {
        roots: vec![CertificateDer(anchor)],
    };
    ServerCertVerifier::new(&roots).map_err(|_| "invalid origin trust anchor".to_owned())?;
    let public_json = serde_json::to_string(public)
        .map_err(|_| "could not serialize public configuration".to_owned())?;

    if matches!(command, Command::ExportPublic) {
        use std::io::Write;
        std::io::stdout()
            .lock()
            .write_all(public_json.as_bytes())
            .map_err(|_| "could not write public Notary configuration".to_owned())?;
        return Ok(());
    }

    let mut hash = Sha256::new();
    hash.update(b"FUSOU-NOTARY-LEDGER-CONFIG-V1\0");
    hash.update(anchor_digest);
    hash.update(public_json.as_bytes());
    let notary = DurableNotary::operational(
        &config.ledger_directory,
        URL_SAFE_NO_PAD.encode(hash.finalize()),
        authority_key,
        public.session_authority_key_id.clone(),
        public.notary_id.clone(),
        public.environment.clone(),
        matches!(command, Command::Init),
    )?;
    if matches!(command, Command::Init) {
        return Ok(());
    }
    let listener = TcpListener::bind(listen)
        .await
        .map_err(|_| "could not bind configured Notary listener".to_owned())?;
    notary_server::serve(
        listener,
        notary,
        roots,
        signing_key,
        public.notary_id.clone(),
        public.environment.clone(),
        listen.ip().is_loopback(),
        notary_server::ServerFault::None,
    )
    .await
}

fn validate_loopback_endpoint(listen: &str, public_endpoint: &str) -> Result<SocketAddrV4, String> {
    let listen_address = listen
        .parse::<SocketAddrV4>()
        .map_err(|_| "Notary listen must be canonical 127.0.0.1:<non-zero-port>".to_owned())?;
    if listen_address.ip() != &Ipv4Addr::LOCALHOST
        || listen_address.port() == 0
        || listen_address.to_string() != listen
    {
        return Err("Notary listen must be canonical 127.0.0.1:<non-zero-port>".to_owned());
    }

    let expected_endpoint = format!("127.0.0.1:{}", listen_address.port());
    if public_endpoint != expected_endpoint {
        return Err("public.endpoint must exactly match Notary listen".to_owned());
    }
    Ok(listen_address)
}

fn read_regular(path: &Path, limit: u64, private: bool, label: &str) -> Result<Vec<u8>, String> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| format!("could not open {label}"))?;
    let metadata = file
        .metadata()
        .map_err(|_| format!("could not inspect {label}"))?;
    if !metadata.is_file()
        || metadata.len() > limit
        || (private && metadata.permissions().mode() & 0o077 != 0)
    {
        return Err(format!("invalid file type, size or permissions: {label}"));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| format!("could not read {label}"))?;
    if bytes.is_empty() || bytes.len() as u64 > limit {
        return Err(format!("invalid file size: {label}"));
    }
    Ok(bytes)
}
