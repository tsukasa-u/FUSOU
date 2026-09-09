use anyhow::Result;
use futures::{AsyncReadExt as _, AsyncWriteExt as _};
use http_body_util::{BodyExt as _, Empty};
use hyper::{body::Bytes, Request, StatusCode};
use hyper_util::rt::TokioIo;
use std::{future::IntoFuture, sync::Arc};
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
const MAX_SENT_DATA: usize = 1 << 12;
const MAX_RECV_DATA: usize = 1 << 14;

/// PROTOCOL E2E TEST: prove, notarize, serialize, and validate alpha.15.
#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn alpha15_mpc_notary_signs_real_attestation() -> Result<()> {
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
    let (driver, mut handle) = session.split();
    let driver_task = tokio::spawn(driver);
    let prover = handle
        .new_prover(ProverConfig::builder().build()?)?
        .commit(
            MpcTlsConfig::builder()
                .max_sent_data(MAX_SENT_DATA)
                .max_recv_data(MAX_RECV_DATA)
                .build()?,
        )
        .await?;

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

    let mut prover = prover_task.await??;
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
    Ok(())
}
