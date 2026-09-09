use anyhow::Result;
use futures::{AsyncReadExt as _, AsyncWriteExt as _};
use http_body_util::{BodyExt as _, Empty};
use hyper::{body::Bytes, Request, StatusCode};
use hyper_util::rt::TokioIo;
use std::{collections::HashMap, env, fs, future::IntoFuture, sync::Arc};
use tlsn::{
    attestation::{
        request::{Request as AttestationRequest, RequestConfig},
        Attestation, CryptoProvider,
    },
    config::{
        prove::ProveConfig, prover::ProverConfig, tls::TlsClientConfig,
        tls_commit::mpc::MpcTlsConfig,
    },
    connection::{HandshakeData, ServerName},
    prover::ProverOutput,
    transcript::TranscriptCommitConfig,
    webpki::{CertificateDer, RootCertStore},
    Session,
};
use tlsn_formats::http::{DefaultHttpCommitter, HttpCommit, HttpTranscript};
use tlsn_server_fixture_certs::{CA_CERT_DER, SERVER_DOMAIN};
use tokio::net::{TcpListener, TcpStream};
use tokio_util::compat::{FuturesAsyncReadCompatExt, TokioAsyncReadCompatExt};

use fusou_notary::{protocol::serve_connection_with_root_store, KeyMaterial, KeyStatus};

const TEST_SIGNING_KEY: &str = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const FUSOU_MAX_SENT_DATA: usize = 128 * 1024;
const FUSOU_MAX_RECV_DATA: usize = 4 * 1024 * 1024;

fn read_proc_memory(phase: &str) {
    let status = fs::read_to_string("/proc/self/status").unwrap_or_default();
    let status_values = status
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            let value = value.split_whitespace().next()?.parse::<u64>().ok()?;
            Some((key, value))
        })
        .collect::<HashMap<_, _>>();
    let rollup = fs::read_to_string("/proc/self/smaps_rollup").unwrap_or_default();
    let rollup_values = rollup
        .lines()
        .filter_map(|line| {
            let (key, value) = line.split_once(':')?;
            let value = value.split_whitespace().next()?.parse::<u64>().ok()?;
            Some((key, value))
        })
        .collect::<HashMap<_, _>>();

    eprintln!(
        "phase={phase} rss_kib={} hwm_kib={} vm_peak_kib={} anon_kib={} private_dirty_kib={} private_clean_kib={}",
        status_values.get("VmRSS").copied().unwrap_or(0),
        status_values.get("VmHWM").copied().unwrap_or(0),
        status_values.get("VmPeak").copied().unwrap_or(0),
        rollup_values.get("Anonymous").copied().unwrap_or(0),
        rollup_values.get("Private_Dirty").copied().unwrap_or(0),
        rollup_values.get("Private_Clean").copied().unwrap_or(0),
    );
}

/// PROTOCOL E2E TEST: prove, notarize, serialize, and validate alpha.15.
#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn alpha15_mpc_notary_signs_real_attestation_at_official_bounds() -> Result<()> {
    run_protocol_e2e(1 << 12, 1 << 14).await
}

/// PROTOCOL E2E TEST: prove, notarize, serialize, and validate FUSOU capacity.
#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn alpha15_mpc_notary_signs_real_attestation_at_fusou_bounds() -> Result<()> {
    run_protocol_e2e(FUSOU_MAX_SENT_DATA, FUSOU_MAX_RECV_DATA).await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
#[ignore = "explicit local resource benchmark"]
async fn alpha15_mpc_notary_resource_benchmark_cell() -> Result<()> {
    let max_sent_data = env::var("FUSOU_BENCH_MAX_SENT_DATA")?.parse::<usize>()?;
    let max_recv_data = env::var("FUSOU_BENCH_MAX_RECV_DATA")?.parse::<usize>()?;
    run_protocol_e2e(max_sent_data, max_recv_data).await
}

async fn run_protocol_e2e(max_sent_data: usize, max_recv_data: usize) -> Result<()> {
    eprintln!(
        "config max_sent_data={max_sent_data} max_recv_data={max_recv_data} aes_keystream_blocks={}",
        (max_sent_data + 32).div_ceil(16),
    );
    read_proc_memory("before_session");
    let key = Arc::new(KeyMaterial::from_encoded(
        "protocol-test".to_owned(),
        KeyStatus::Active,
        TEST_SIGNING_KEY,
    )?);
    let (notary_socket, prover_socket) = tokio::io::duplex(1 << 23);
    let notary_task = tokio::spawn(serve_connection_with_root_store(
        notary_socket.compat(),
        key,
        16 * 1024 * 1024,
        RootCertStore {
            roots: vec![CertificateDer(CA_CERT_DER.to_vec())],
        },
    ));

    let fixture_listener = TcpListener::bind("127.0.0.1:0").await?;
    let fixture_addr = fixture_listener.local_addr()?;
    let fixture_task = tokio::spawn(async move {
        let (socket, _) = fixture_listener.accept().await?;
        tlsn_server_fixture::bind(socket.compat()).await
    });

    let session = Session::new(prover_socket.compat());
    read_proc_memory("after_session_new");
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);
    let prover = handle
        .new_prover(ProverConfig::builder().build()?)?
        .commit(
            MpcTlsConfig::builder()
                .max_sent_data(max_sent_data)
                .max_recv_data(max_recv_data)
                .build()?,
        )
        .await?;
    read_proc_memory("after_prover_commit");

    let origin_socket = TcpStream::connect(fixture_addr).await?;
    let (tls_connection, prover) = prover.connect(
        TlsClientConfig::builder()
            .server_name(ServerName::Dns(SERVER_DOMAIN.try_into()?))
            .root_store(RootCertStore {
                roots: vec![CertificateDer(CA_CERT_DER.to_vec())],
            })
            .build()?,
        origin_socket.compat(),
    )?;
    read_proc_memory("after_prover_connect");
    let tls_connection = TokioIo::new(tls_connection.compat());
    let prover_task = tokio::spawn(prover.into_future());
    let (mut request_sender, connection) =
        hyper::client::conn::http1::handshake(tls_connection).await?;
    let connection_task = tokio::spawn(connection);

    let request = Request::builder()
        .uri("/")
        .header("Host", SERVER_DOMAIN)
        .header("Accept", "*/*")
        .header("Accept-Encoding", "identity")
        .header("Connection", "close")
        .body(Empty::<Bytes>::new())?;
    let response = request_sender.send_request(request).await?;
    assert_eq!(response.status(), StatusCode::OK);
    let _response_body = response.into_body().collect().await?;
    connection_task.await??;
    read_proc_memory("after_http_response");

    let mut prover = prover_task.await??;
    eprintln!(
        "transcript_application_data_bytes sent={} recv={}",
        prover.transcript().sent().len(),
        prover.transcript().received().len(),
    );
    read_proc_memory("after_prover_finish");
    let transcript = HttpTranscript::parse(prover.transcript())?;
    let mut commit_builder = TranscriptCommitConfig::builder(prover.transcript());
    DefaultHttpCommitter::default().commit_transcript(&mut commit_builder, &transcript)?;
    let transcript_commit = commit_builder.build()?;

    let mut request_config_builder = RequestConfig::builder();
    request_config_builder.transcript_commit(transcript_commit.clone());
    let request_config = request_config_builder.build()?;
    let mut prove_builder = ProveConfig::builder(prover.transcript());
    prove_builder
        .transcript_commit(transcript_commit)
        .server_identity();
    prove_builder.reveal_sent_all()?;
    prove_builder.reveal_recv_all()?;
    let prove_config = prove_builder.build()?;
    let ProverOutput {
        transcript_commitments,
        transcript_secrets,
        ..
    } = prover.prove(&prove_config).await?;
    read_proc_memory("after_prove");
    let prover_transcript = prover.transcript().clone();
    let tls_transcript = prover.tls_transcript().clone();
    let handshake_data = HandshakeData {
        certs: tls_transcript
            .server_cert_chain()
            .expect("fixture must provide server certificates")
            .to_vec(),
        sig: tls_transcript
            .server_signature()
            .expect("fixture must provide server signature")
            .clone(),
        binding: tls_transcript.certificate_binding().clone(),
    };
    let mut attestation_builder = AttestationRequest::builder(&request_config);
    attestation_builder
        .server_name(ServerName::Dns(SERVER_DOMAIN.try_into()?))
        .handshake_data(handshake_data)
        .transcript(prover_transcript)
        .transcript_commitments(transcript_secrets, transcript_commitments);
    let (attestation_request, _secrets) = attestation_builder.build(&CryptoProvider::default())?;
    read_proc_memory("after_attestation_request");
    prover.close().await?;

    handle.close();
    let mut notary_socket = driver_task.await??;
    notary_socket
        .write_all(&bincode::serialize(&attestation_request)?)
        .await?;
    notary_socket.close().await?;
    let mut attestation_bytes = Vec::new();
    notary_socket.read_to_end(&mut attestation_bytes).await?;
    let attestation: Attestation = bincode::deserialize(&attestation_bytes)?;
    attestation_request.validate(&attestation, &CryptoProvider::default())?;

    notary_task.await??;
    fixture_task.await??;
    read_proc_memory("after_cleanup");
    Ok(())
}
