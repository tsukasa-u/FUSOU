use ring::rand::{SecureRandom, SystemRandom};
use sha2::{Digest, Sha256};
use std::fmt;
use tlsn::attestation::signing::{
    KeyAlgId, Secp256k1Signer, Secp256k1Verifier, SignatureVerifier, Signer, VerifyingKey,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

const MAGIC: &[u8; 8] = b"FUSOU-N1";
const VERSION: u16 = 1;
const ADMIT: u8 = 1;
const QUERY_FINALIZED: u8 = 2;
const ADMISSION_ACK: u8 = 0x81;
const FINALIZED_RESULT: u8 = 0x82;
const REJECTED: u8 = 0xff;
const ACK_DOMAIN: &[u8] = b"FUSOU-TLSN-NOTARY-SESSION-ADMISSION-ACK-V1\0";
const MAX_GRANT_BYTES: usize = 2048;
const MAX_SCOPE_BYTES: usize = 128;
pub const MAX_FINALIZED_RESULT_BYTES: usize = 8 * 1024 * 1024;
const REQUEST_HEADER_BYTES: usize = 8 + 2 + 1 + 32 + 2;
const RESPONSE_HEADER_BYTES: usize = 8 + 2 + 1 + 32 + 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotaryWireError {
    InvalidConfiguration,
    InvalidFrame,
    InvalidSignature,
    Rejected,
    ResultTooLarge,
    Io,
}

impl fmt::Display for NotaryWireError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidConfiguration => "invalid Notary wire configuration",
            Self::InvalidFrame => "invalid Notary wire frame",
            Self::InvalidSignature => "Notary wire signature verification failed",
            Self::Rejected => "Notary rejected the operation",
            Self::ResultTooLarge => "Notary result exceeds the configured size limit",
            Self::Io => "Notary wire I/O failed",
        })
    }
}

impl std::error::Error for NotaryWireError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotaryRequestKind {
    Admit,
    QueryFinalized,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotaryWireRequest {
    pub kind: NotaryRequestKind,
    pub nonce: [u8; 32],
    pub grant: Vec<u8>,
}

pub async fn client_admit(
    socket: &mut TcpStream,
    grant: &[u8],
    notary_key: &VerifyingKey,
    expected_notary_id: &str,
    expected_environment: &str,
) -> Result<(), NotaryWireError> {
    validate_client_config(grant, notary_key, expected_notary_id, expected_environment)?;
    let nonce = random_nonce()?;
    let grant_digest = grant_digest(grant);
    write_request(socket, ADMIT, nonce, grant).await?;

    let mut fixed = [0_u8; 8 + 2 + 1 + 32 + 32 + 1];
    socket
        .read_exact(&mut fixed)
        .await
        .map_err(|_| NotaryWireError::Io)?;
    if &fixed[..8] != MAGIC
        || u16::from_be_bytes([fixed[8], fixed[9]]) != VERSION
        || fixed[10] != ADMISSION_ACK
        || fixed[11..43] != nonce
        || fixed[43..75] != grant_digest
    {
        return Err(NotaryWireError::InvalidFrame);
    }
    let notary_id_len = usize::from(fixed[75]);
    if notary_id_len == 0 || notary_id_len > MAX_SCOPE_BYTES {
        return Err(NotaryWireError::InvalidFrame);
    }
    let mut notary_id_bytes = vec![0_u8; notary_id_len];
    socket
        .read_exact(&mut notary_id_bytes)
        .await
        .map_err(|_| NotaryWireError::Io)?;
    let mut environment_len = [0_u8; 1];
    socket
        .read_exact(&mut environment_len)
        .await
        .map_err(|_| NotaryWireError::Io)?;
    let environment_len = usize::from(environment_len[0]);
    if environment_len == 0 || environment_len > MAX_SCOPE_BYTES {
        return Err(NotaryWireError::InvalidFrame);
    }
    let mut environment_bytes = vec![0_u8; environment_len];
    socket
        .read_exact(&mut environment_bytes)
        .await
        .map_err(|_| NotaryWireError::Io)?;
    let mut signature = [0_u8; 64];
    socket
        .read_exact(&mut signature)
        .await
        .map_err(|_| NotaryWireError::Io)?;

    let notary_id =
        String::from_utf8(notary_id_bytes).map_err(|_| NotaryWireError::InvalidFrame)?;
    let environment =
        String::from_utf8(environment_bytes).map_err(|_| NotaryWireError::InvalidFrame)?;
    if notary_id != expected_notary_id || environment != expected_environment {
        return Err(NotaryWireError::InvalidConfiguration);
    }
    let signed = admission_ack_signing_bytes(&nonce, &grant_digest, &notary_id, &environment)?;
    Secp256k1Verifier
        .verify(notary_key, &signed, &signature)
        .map_err(|_| NotaryWireError::InvalidSignature)
}

pub async fn read_request(
    socket: &mut TcpStream,
) -> Result<NotaryWireRequest, NotaryWireError> {
    let mut fixed = [0_u8; REQUEST_HEADER_BYTES];
    socket
        .read_exact(&mut fixed)
        .await
        .map_err(|_| NotaryWireError::Io)?;
    if &fixed[..8] != MAGIC || u16::from_be_bytes([fixed[8], fixed[9]]) != VERSION {
        return Err(NotaryWireError::InvalidFrame);
    }
    let kind = match fixed[10] {
        ADMIT => NotaryRequestKind::Admit,
        QUERY_FINALIZED => NotaryRequestKind::QueryFinalized,
        _ => return Err(NotaryWireError::InvalidFrame),
    };
    let nonce = fixed[11..43]
        .try_into()
        .map_err(|_| NotaryWireError::InvalidFrame)?;
    let grant_len = usize::from(u16::from_be_bytes([fixed[43], fixed[44]]));
    if grant_len == 0 || grant_len > MAX_GRANT_BYTES {
        return Err(NotaryWireError::InvalidFrame);
    }
    let mut grant = vec![0_u8; grant_len];
    socket
        .read_exact(&mut grant)
        .await
        .map_err(|_| NotaryWireError::Io)?;
    Ok(NotaryWireRequest { kind, nonce, grant })
}

pub async fn write_admission_ack(
    socket: &mut TcpStream,
    nonce: &[u8; 32],
    grant: &[u8],
    signer: &Secp256k1Signer,
    notary_id: &str,
    environment: &str,
) -> Result<(), NotaryWireError> {
    validate_scope(notary_id)?;
    validate_scope(environment)?;
    let grant_digest = grant_digest(grant);
    let signed = admission_ack_signing_bytes(nonce, &grant_digest, notary_id, environment)?;
    let signature = signer
        .sign(&signed)
        .map_err(|_| NotaryWireError::InvalidConfiguration)?;
    if signature.data.len() != 64 {
        return Err(NotaryWireError::InvalidConfiguration);
    }

    let mut frame = Vec::with_capacity(
        8 + 2 + 1 + 32 + 32 + 1 + notary_id.len() + 1 + environment.len() + 64,
    );
    frame.extend_from_slice(MAGIC);
    frame.extend_from_slice(&VERSION.to_be_bytes());
    frame.push(ADMISSION_ACK);
    frame.extend_from_slice(nonce);
    frame.extend_from_slice(&grant_digest);
    frame.push(notary_id.len() as u8);
    frame.extend_from_slice(notary_id.as_bytes());
    frame.push(environment.len() as u8);
    frame.extend_from_slice(environment.as_bytes());
    frame.extend_from_slice(&signature.data);
    socket
        .write_all(&frame)
        .await
        .map_err(|_| NotaryWireError::Io)
}

pub async fn write_rejected(
    socket: &mut TcpStream,
    nonce: &[u8; 32],
) -> Result<(), NotaryWireError> {
    let mut frame = Vec::with_capacity(RESPONSE_HEADER_BYTES);
    frame.extend_from_slice(MAGIC);
    frame.extend_from_slice(&VERSION.to_be_bytes());
    frame.push(REJECTED);
    frame.extend_from_slice(nonce);
    frame.extend_from_slice(&0_u32.to_be_bytes());
    socket
        .write_all(&frame)
        .await
        .map_err(|_| NotaryWireError::Io)
}

pub async fn write_finalized_result(
    socket: &mut TcpStream,
    nonce: &[u8; 32],
    exact_result: &[u8],
) -> Result<(), NotaryWireError> {
    if exact_result.is_empty() || exact_result.len() > MAX_FINALIZED_RESULT_BYTES {
        return Err(NotaryWireError::ResultTooLarge);
    }
    let result_len =
        u32::try_from(exact_result.len()).map_err(|_| NotaryWireError::ResultTooLarge)?;
    let mut frame = Vec::with_capacity(RESPONSE_HEADER_BYTES + exact_result.len());
    frame.extend_from_slice(MAGIC);
    frame.extend_from_slice(&VERSION.to_be_bytes());
    frame.push(FINALIZED_RESULT);
    frame.extend_from_slice(nonce);
    frame.extend_from_slice(&result_len.to_be_bytes());
    frame.extend_from_slice(exact_result);
    socket
        .write_all(&frame)
        .await
        .map_err(|_| NotaryWireError::Io)
}

pub async fn query_finalized_result(
    endpoint: &str,
    grant: &[u8],
) -> Result<Vec<u8>, NotaryWireError> {
    if grant.is_empty() || grant.len() > MAX_GRANT_BYTES {
        return Err(NotaryWireError::InvalidConfiguration);
    }
    let mut socket = TcpStream::connect(endpoint)
        .await
        .map_err(|_| NotaryWireError::Io)?;
    let nonce = random_nonce()?;
    write_request(&mut socket, QUERY_FINALIZED, nonce, grant).await?;

    let mut fixed = [0_u8; RESPONSE_HEADER_BYTES];
    socket
        .read_exact(&mut fixed)
        .await
        .map_err(|_| NotaryWireError::Io)?;
    if &fixed[..8] != MAGIC
        || u16::from_be_bytes([fixed[8], fixed[9]]) != VERSION
        || fixed[11..43] != nonce
    {
        return Err(NotaryWireError::InvalidFrame);
    }
    let result_len = usize::try_from(u32::from_be_bytes(
        fixed[43..47]
            .try_into()
            .map_err(|_| NotaryWireError::InvalidFrame)?,
    ))
    .map_err(|_| NotaryWireError::ResultTooLarge)?;
    if fixed[10] == REJECTED {
        return Err(NotaryWireError::Rejected);
    }
    if fixed[10] != FINALIZED_RESULT
        || result_len == 0
        || result_len > MAX_FINALIZED_RESULT_BYTES
    {
        return Err(NotaryWireError::InvalidFrame);
    }
    let mut exact_result = vec![0_u8; result_len];
    socket
        .read_exact(&mut exact_result)
        .await
        .map_err(|_| NotaryWireError::Io)?;
    Ok(exact_result)
}

pub fn verifying_key_from_private_key(
    private_key: &[u8],
) -> Result<VerifyingKey, NotaryWireError> {
    Secp256k1Signer::new(private_key)
        .map(|signer| signer.verifying_key())
        .map_err(|_| NotaryWireError::InvalidConfiguration)
}

async fn write_request(
    socket: &mut TcpStream,
    kind: u8,
    nonce: [u8; 32],
    grant: &[u8],
) -> Result<(), NotaryWireError> {
    if grant.is_empty() || grant.len() > MAX_GRANT_BYTES {
        return Err(NotaryWireError::InvalidConfiguration);
    }
    let grant_len =
        u16::try_from(grant.len()).map_err(|_| NotaryWireError::InvalidConfiguration)?;
    let mut frame = Vec::with_capacity(REQUEST_HEADER_BYTES + grant.len());
    frame.extend_from_slice(MAGIC);
    frame.extend_from_slice(&VERSION.to_be_bytes());
    frame.push(kind);
    frame.extend_from_slice(&nonce);
    frame.extend_from_slice(&grant_len.to_be_bytes());
    frame.extend_from_slice(grant);
    socket
        .write_all(&frame)
        .await
        .map_err(|_| NotaryWireError::Io)
}

fn validate_client_config(
    grant: &[u8],
    key: &VerifyingKey,
    notary_id: &str,
    environment: &str,
) -> Result<(), NotaryWireError> {
    if grant.is_empty()
        || grant.len() > MAX_GRANT_BYTES
        || key.alg != KeyAlgId::K256
        || !matches!(key.data.len(), 33 | 65)
    {
        return Err(NotaryWireError::InvalidConfiguration);
    }
    validate_scope(notary_id)?;
    validate_scope(environment)
}

fn validate_scope(scope: &str) -> Result<(), NotaryWireError> {
    if scope.is_empty()
        || scope.len() > MAX_SCOPE_BYTES
        || !scope.bytes().all(|byte| byte.is_ascii_graphic())
    {
        return Err(NotaryWireError::InvalidConfiguration);
    }
    Ok(())
}

fn random_nonce() -> Result<[u8; 32], NotaryWireError> {
    let mut nonce = [0_u8; 32];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| NotaryWireError::InvalidConfiguration)?;
    Ok(nonce)
}

fn grant_digest(grant: &[u8]) -> [u8; 32] {
    Sha256::digest(grant).into()
}

fn admission_ack_signing_bytes(
    nonce: &[u8; 32],
    grant_digest: &[u8; 32],
    notary_id: &str,
    environment: &str,
) -> Result<Vec<u8>, NotaryWireError> {
    validate_scope(notary_id)?;
    validate_scope(environment)?;
    let mut bytes = Vec::with_capacity(
        ACK_DOMAIN.len() + 2 + 32 + 32 + 1 + notary_id.len() + 1 + environment.len(),
    );
    bytes.extend_from_slice(ACK_DOMAIN);
    bytes.extend_from_slice(&VERSION.to_be_bytes());
    bytes.extend_from_slice(nonce);
    bytes.extend_from_slice(grant_digest);
    bytes.push(notary_id.len() as u8);
    bytes.extend_from_slice(notary_id.as_bytes());
    bytes.push(environment.len() as u8);
    bytes.extend_from_slice(environment.as_bytes());
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admission_ack_binds_scope_nonce_and_grant() {
        let signer = Secp256k1Signer::new(&[1_u8; 32]).unwrap();
        let key = signer.verifying_key();
        let nonce = [7_u8; 32];
        let grant = b"local-grant";
        let digest = grant_digest(grant);
        let signed =
            admission_ack_signing_bytes(&nonce, &digest, "test-notary", "local-test").unwrap();
        let signature = signer.sign(&signed).unwrap();
        Secp256k1Verifier
            .verify(&key, &signed, &signature.data)
            .unwrap();
        assert!(Secp256k1Verifier
            .verify(
                &key,
                &admission_ack_signing_bytes(&[8_u8; 32], &digest, "test-notary", "local-test")
                    .unwrap(),
                &signature.data
            )
            .is_err());
        assert!(Secp256k1Verifier
            .verify(
                &key,
                &admission_ack_signing_bytes(&nonce, &[9_u8; 32], "test-notary", "local-test")
                    .unwrap(),
                &signature.data
            )
            .is_err());
    }
}
