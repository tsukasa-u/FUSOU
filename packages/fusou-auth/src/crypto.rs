use ed25519_dalek::{Signature, VerifyingKey};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum Ed25519SignatureError {
    #[error("Ed25519 public key must be 32 bytes")]
    InvalidPublicKeyLength,
    #[error("Ed25519 public key is invalid")]
    InvalidPublicKey,
    #[error("Ed25519 signature must be 64 bytes")]
    InvalidSignatureLength,
    #[error("Ed25519 signature verification failed")]
    InvalidSignature,
}

pub fn verify_ed25519_signature(
    public_key: &[u8],
    message: &[u8],
    signature: &[u8],
) -> Result<(), Ed25519SignatureError> {
    let public_key: &[u8; 32] = public_key
        .try_into()
        .map_err(|_| Ed25519SignatureError::InvalidPublicKeyLength)?;
    let verifying_key = VerifyingKey::from_bytes(public_key)
        .map_err(|_| Ed25519SignatureError::InvalidPublicKey)?;
    let signature: &[u8; 64] = signature
        .try_into()
        .map_err(|_| Ed25519SignatureError::InvalidSignatureLength)?;
    verifying_key
        .verify_strict(message, &Signature::from_bytes(signature))
        .map_err(|_| Ed25519SignatureError::InvalidSignature)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    #[test]
    fn verifies_only_the_matching_ed25519_signature() {
        let signing_key = SigningKey::from_bytes(&[0x31; 32]);
        let message = b"FUSOU test-only verification";
        let signature = signing_key.sign(message);

        assert!(verify_ed25519_signature(
            signing_key.verifying_key().as_bytes(),
            message,
            &signature.to_bytes(),
        )
        .is_ok());
        assert_eq!(
            verify_ed25519_signature(
                signing_key.verifying_key().as_bytes(),
                b"changed",
                &signature.to_bytes(),
            ),
            Err(Ed25519SignatureError::InvalidSignature)
        );
    }

    #[test]
    fn rejects_invalid_public_key_and_signature_lengths() {
        let invalid_public_key = (0_u8..=u8::MAX)
            .map(|first_byte| {
                let mut key = [0_u8; 32];
                key[0] = first_byte;
                key
            })
            .find(|key| VerifyingKey::from_bytes(key).is_err())
            .expect("at least one 32-byte value must not encode an Ed25519 point");
        assert_eq!(
            verify_ed25519_signature(&invalid_public_key, b"message", &[0; 64]),
            Err(Ed25519SignatureError::InvalidPublicKey)
        );
        assert_eq!(
            verify_ed25519_signature(&[0; 31], b"message", &[0; 64]),
            Err(Ed25519SignatureError::InvalidPublicKeyLength)
        );
        assert_eq!(
            verify_ed25519_signature(&[0; 32], b"message", &[0; 63]),
            Err(Ed25519SignatureError::InvalidSignatureLength)
        );
    }
}
