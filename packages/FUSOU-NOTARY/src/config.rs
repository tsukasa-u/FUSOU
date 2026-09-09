use crate::keys::KeyMaterial;
use anyhow::{anyhow, Context, Result};
use std::{env, net::SocketAddr, time::Duration};

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 7047;
const DEFAULT_SESSION_TIMEOUT_SECS: u64 = 300;
const DEFAULT_MAX_ATTESTATION_REQUEST_BYTES: usize = 16 * 1024 * 1024;
const MAX_SESSION_TIMEOUT_SECS: u64 = 3600;
const MAX_ATTESTATION_REQUEST_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct NotaryConfig {
    pub listen_addr: SocketAddr,
    pub session_timeout: Duration,
    pub max_attestation_request_bytes: usize,
    pub key: KeyMaterial,
}

impl NotaryConfig {
    pub fn from_env() -> Result<Self> {
        let host = env::var("NOTARY_LISTEN_HOST").unwrap_or_else(|_| DEFAULT_HOST.to_owned());
        let port = parse_u16_env("NOTARY_LISTEN_PORT", DEFAULT_PORT)?;
        let listen_addr = format!("{host}:{port}")
            .parse()
            .with_context(|| format!("invalid NOTARY_LISTEN_HOST/PORT address: {host}:{port}"))?;

        let timeout_secs =
            parse_u64_env("NOTARY_SESSION_TIMEOUT_SECS", DEFAULT_SESSION_TIMEOUT_SECS)?;
        if timeout_secs == 0 || timeout_secs > MAX_SESSION_TIMEOUT_SECS {
            return Err(anyhow!(
                "NOTARY_SESSION_TIMEOUT_SECS must be between 1 and {MAX_SESSION_TIMEOUT_SECS}"
            ));
        }

        let max_request_bytes = parse_usize_env(
            "NOTARY_MAX_ATTESTATION_REQUEST_BYTES",
            DEFAULT_MAX_ATTESTATION_REQUEST_BYTES,
        )?;
        if max_request_bytes == 0 || max_request_bytes > MAX_ATTESTATION_REQUEST_BYTES {
            return Err(anyhow!(
                "NOTARY_MAX_ATTESTATION_REQUEST_BYTES must be between 1 and {MAX_ATTESTATION_REQUEST_BYTES}"
            ));
        }

        Ok(Self {
            listen_addr,
            session_timeout: Duration::from_secs(timeout_secs),
            max_attestation_request_bytes: max_request_bytes,
            key: KeyMaterial::from_env()?,
        })
    }
}

fn parse_u16_env(name: &str, default: u16) -> Result<u16> {
    env::var(name)
        .map(|value| {
            value
                .parse()
                .with_context(|| format!("invalid {name}: {value}"))
        })
        .unwrap_or(Ok(default))
}

fn parse_u64_env(name: &str, default: u64) -> Result<u64> {
    env::var(name)
        .map(|value| {
            value
                .parse()
                .with_context(|| format!("invalid {name}: {value}"))
        })
        .unwrap_or(Ok(default))
}

fn parse_usize_env(name: &str, default: usize) -> Result<usize> {
    env::var(name)
        .map(|value| {
            value
                .parse()
                .with_context(|| format!("invalid {name}: {value}"))
        })
        .unwrap_or(Ok(default))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_bind_to_loopback() {
        assert_eq!(DEFAULT_HOST, "127.0.0.1");
        assert_eq!(DEFAULT_PORT, 7047);
        assert_eq!(DEFAULT_SESSION_TIMEOUT_SECS, 300);
    }
}
