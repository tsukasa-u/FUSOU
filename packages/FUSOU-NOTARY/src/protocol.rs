use crate::keys::KeyMaterial;
use anyhow::{anyhow, Context, Result};
use futures::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use std::sync::Arc;
use tlsn::{
    attestation::{request::Request as AttestationRequest, Attestation, AttestationConfig},
    config::verifier::VerifierConfig,
    connection::{CertBinding, ConnectionInfo, TranscriptLength},
    transcript::{ContentType, TlsTranscript},
    verifier::{VerifierCommitStart, VerifierOutput},
    webpki::RootCertStore,
    Session,
};

pub const DEFAULT_MAX_ATTESTATION_REQUEST_BYTES: usize = 16 * 1024 * 1024;

struct DriverAbortGuard(Option<tokio::task::AbortHandle>);

impl DriverAbortGuard {
    fn new(handle: tokio::task::AbortHandle) -> Self {
        Self(Some(handle))
    }

    fn disarm(&mut self) {
        self.0 = None;
    }
}

impl Drop for DriverAbortGuard {
    fn drop(&mut self) {
        if let Some(handle) = self.0.take() {
            handle.abort();
        }
    }
}

pub async fn serve_connection<S>(
    socket: S,
    key: Arc<KeyMaterial>,
    max_attestation_request_bytes: usize,
) -> Result<()>
where
    S: AsyncRead + AsyncWrite + Send + Sync + Unpin + 'static,
{
    serve_connection_with_root_store(
        socket,
        key,
        max_attestation_request_bytes,
        RootCertStore::mozilla(),
    )
    .await
}

pub async fn serve_connection_with_root_store<S>(
    socket: S,
    key: Arc<KeyMaterial>,
    max_attestation_request_bytes: usize,
    root_store: RootCertStore,
) -> Result<()>
where
    S: AsyncRead + AsyncWrite + Send + Sync + Unpin + 'static,
{
    let session = Session::new(socket);
    let (driver, mut handle) = session.split();
    let driver_task_handle = tokio::spawn(driver);
    let mut driver_abort_guard = DriverAbortGuard::new(driver_task_handle.abort_handle());
    let mut driver_task = Some(driver_task_handle);

    let result = async {
        let verifier_config = VerifierConfig::builder()
            .root_store(root_store)
            .build()
            .context("failed to build alpha.15 verifier configuration")?;
        let verifier = match handle.new_verifier(verifier_config)?.commit().await? {
            VerifierCommitStart::Mpc(verifier) => verifier.accept().await?.run().await?,
            VerifierCommitStart::Proxy(verifier) => {
                verifier
                    .reject(Some("FUSOU Notary accepts MPC-TLS only"))
                    .await?;
                return Err(anyhow!("received unsupported alpha.15 Proxy-TLS session"));
            }
        };

        let (
            VerifierOutput {
                transcript_commitments,
                ..
            },
            verifier,
        ) = verifier.verify().await?.accept().await?;
        let tls_transcript = verifier.tls_transcript().clone();
        verifier.close().await?;

        handle.close();
        let mut socket = driver_task
            .take()
            .ok_or_else(|| anyhow!("alpha.15 session driver was already consumed"))?
            .await
            .context("alpha.15 session driver task failed")??;
        driver_abort_guard.disarm();

        let request_bytes = read_until_eof(&mut socket, max_attestation_request_bytes).await?;
        let request = decode_attestation_request(&request_bytes)?;
        let attestation =
            build_attestation(&request, &tls_transcript, transcript_commitments, &key)?;
        let response_bytes =
            bincode::serialize(&attestation).context("failed to serialize alpha.15 Attestation")?;
        socket
            .write_all(&response_bytes)
            .await
            .context("failed to write alpha.15 Attestation")?;
        socket
            .flush()
            .await
            .context("failed to flush Attestation")?;
        socket
            .close()
            .await
            .context("failed to close Notary socket")?;
        Ok(())
    }
    .await;

    if result.is_err() {
        handle.close();
        if let Some(driver_task) = driver_task.take() {
            driver_task.abort();
            let _ = driver_task.await;
        }
    }
    result
}

async fn read_until_eof<S>(socket: &mut S, max_bytes: usize) -> Result<Vec<u8>>
where
    S: AsyncRead + Unpin,
{
    if max_bytes == 0 {
        return Err(anyhow!("AttestationRequest limit must be non-zero"));
    }
    let mut request = Vec::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read = socket.read(&mut buffer).await?;
        if read == 0 {
            return Ok(request);
        }
        if request.len().saturating_add(read) > max_bytes {
            return Err(anyhow!("AttestationRequest exceeds configured size limit"));
        }
        request.extend_from_slice(&buffer[..read]);
    }
}

fn decode_attestation_request(bytes: &[u8]) -> Result<AttestationRequest> {
    bincode::deserialize(bytes).context("invalid alpha.15 AttestationRequest bincode")
}

fn build_attestation(
    request: &AttestationRequest,
    tls_transcript: &TlsTranscript,
    transcript_commitments: Vec<tlsn::transcript::TranscriptCommitment>,
    key: &KeyMaterial,
) -> Result<Attestation> {
    let provider = key.configure_provider()?;
    let mut attestation_config_builder = AttestationConfig::builder();
    attestation_config_builder
        .supported_signature_algs(provider.signer.supported_algs().collect::<Vec<_>>());
    let attestation_config = attestation_config_builder.build()?;

    let CertBinding::V1_2(binding) = tls_transcript.certificate_binding() else {
        return Err(anyhow!("unsupported alpha.15 certificate binding version"));
    };
    let mut builder = Attestation::builder(&attestation_config).accept_request(request.clone())?;
    builder
        .connection_info(ConnectionInfo {
            time: tls_transcript.time(),
            version: tls_transcript.version(),
            transcript_length: TranscriptLength {
                sent: application_data_length(tls_transcript, true)?,
                received: application_data_length(tls_transcript, false)?,
            },
        })
        .server_ephemeral_key(binding.server_ephemeral_key.clone())
        .transcript_commitments(transcript_commitments);
    Ok(builder.build(&provider)?)
}

fn application_data_length(transcript: &TlsTranscript, sent: bool) -> Result<u32> {
    let records = if sent {
        transcript.sent()
    } else {
        transcript.recv()
    };
    records
        .iter()
        .filter_map(|record| {
            if record.typ == ContentType::ApplicationData {
                Some(record.ciphertext.len())
            } else {
                None
            }
        })
        .try_fold(0_u32, |total, length| {
            let length = u32::try_from(length).context("TLS application data length overflow")?;
            total
                .checked_add(length)
                .ok_or_else(|| anyhow!("TLS application data length overflow"))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::io::AsyncWriteExt;
    use tokio::io::duplex;
    use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

    #[tokio::test]
    async fn eof_delimited_request_is_read_after_client_half_close() {
        let (client, server) = duplex(128);
        let mut client = client.compat_write();
        let mut server = server.compat();
        let payload = b"protocol-test-request".to_vec();
        let expected = payload.clone();
        let writer = async move {
            client.write_all(&payload).await.unwrap();
            client.close().await.unwrap();
        };
        let ((), request) = tokio::join!(writer, read_until_eof(&mut server, 1024));
        assert_eq!(request.unwrap(), expected);
    }

    #[tokio::test]
    async fn eof_delimited_request_rejects_oversize_input() {
        let (client, server) = duplex(128);
        let mut client = client.compat_write();
        let mut server = server.compat();
        let writer = async move {
            client.write_all(b"0123456789").await.unwrap();
            client.close().await.unwrap();
        };
        let ((), request) = tokio::join!(writer, read_until_eof(&mut server, 4));
        assert!(request.is_err());
    }

    #[test]
    fn truncated_attestation_request_is_rejected() {
        assert!(decode_attestation_request(&[0, 1, 2, 3]).is_err());
    }
}
