use anyhow::Result;
use fusou_notary::{protocol::serve_connection, NotaryConfig};
use std::sync::Arc;
use tokio::{net::TcpListener, signal, sync::Semaphore, time::timeout};
use tokio_util::compat::TokioAsyncReadCompatExt;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_target(false)
        .init();

    let config = NotaryConfig::from_env()?;
    let key = Arc::new(config.key.clone());
    info!(
        listen_addr = %config.listen_addr,
        key_id = %key.key_id(),
        protocol = "tlsn-v0.1.0-alpha.15",
        signature_algorithm = "secp256k1",
        public_key = %key.verifying_key_bincode_base64url()?,
        "starting standalone TLSNotary Notary"
    );
    info!(
        public_key_export = %key.public_key_export_json()?,
        "Notary public key export; register this value out of band"
    );

    let listener = TcpListener::bind(config.listen_addr).await?;
    info!(
        local_addr = %listener.local_addr()?,
        max_concurrent_sessions = config.max_concurrent_sessions,
        "Notary listener ready"
    );

    let timeout_duration = config.session_timeout;
    let max_request_bytes = config.max_attestation_request_bytes;
    let session_slots = Arc::new(Semaphore::new(config.max_concurrent_sessions));
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (socket, peer) = accepted?;
                let Ok(session_permit) = Arc::clone(&session_slots).try_acquire_owned() else {
                    warn!(%peer, "Notary session rejected: concurrent session limit reached");
                    drop(socket);
                    continue;
                };
                let key = Arc::clone(&key);
                tokio::spawn(async move {
                    let _session_permit = session_permit;
                    let result = timeout(
                        timeout_duration,
                        serve_connection(socket.compat(), key, max_request_bytes),
                    )
                    .await;
                    match result {
                        Ok(Ok(())) => info!(%peer, "Notary session completed"),
                        Ok(Err(error)) => warn!(%peer, %error, "Notary session rejected"),
                        Err(_) => warn!(%peer, "Notary session timed out"),
                    }
                });
            }
            signal = signal::ctrl_c() => {
                signal?;
                info!("shutdown signal received");
                break;
            }
        }
    }

    info!("Notary listener stopped");
    Ok(())
}
