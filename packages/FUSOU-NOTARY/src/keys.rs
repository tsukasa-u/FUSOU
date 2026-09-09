use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Serialize;
use std::{env, fs, path::Path};
use tlsn::attestation::signing::{KeyAlgId, VerifyingKey};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyStatus {
    Active,
    VerifyOnly,
    Retired,
    Revoked,
}

impl KeyStatus {
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "ACTIVE" => Ok(Self::Active),
            "VERIFY_ONLY" => Ok(Self::VerifyOnly),
            "RETIRED" => Ok(Self::Retired),
            "REVOKED" => Ok(Self::Revoked),
            _ => Err(anyhow!("invalid NOTARY_KEY_STATUS: {value}")),
        }
    }

    pub fn can_sign(self) -> bool {
        matches!(self, Self::Active)
    }
}

#[derive(Clone, Debug)]
pub struct KeyMaterial {
    key_id: String,
    status: KeyStatus,
    secret_key: [u8; 32],
}

#[derive(Debug, Serialize)]
struct PublicKeyExport<'a> {
    schema_version: u8,
    protocol: &'static str,
    key_id: &'a str,
    status: &'static str,
    signature_algorithm: &'static str,
    verifying_key_base64url: String,
    sec1_public_key_base64url: String,
}

impl KeyMaterial {
    pub fn from_env() -> Result<Self> {
        let key_id = env::var("NOTARY_KEY_ID").context("NOTARY_KEY_ID is required")?;
        let status = KeyStatus::parse(
            &env::var("NOTARY_KEY_STATUS").unwrap_or_else(|_| "ACTIVE".to_owned()),
        )?;
        let source = env::var("NOTARY_SIGNING_KEY_SOURCE")
            .context("NOTARY_SIGNING_KEY_SOURCE is required")?;
        let encoded = match source.as_str() {
            "env" => env::var("NOTARY_SIGNING_KEY")
                .context("NOTARY_SIGNING_KEY is required when source=env")?,
            "file" => {
                let path = env::var("NOTARY_SIGNING_KEY_FILE")
                    .context("NOTARY_SIGNING_KEY_FILE is required when source=file")?;
                read_key_file(Path::new(&path))?
            }
            _ => {
                return Err(anyhow!(
                    "NOTARY_SIGNING_KEY_SOURCE must be exactly 'env' or 'file'"
                ));
            }
        };
        Self::from_encoded(key_id, status, &encoded)
    }

    pub fn from_encoded(key_id: String, status: KeyStatus, encoded: &str) -> Result<Self> {
        validate_key_id(&key_id)?;
        let bytes = URL_SAFE_NO_PAD
            .decode(encoded.trim())
            .context("NOTARY signing key must be unpadded base64url")?;
        let secret_key: [u8; 32] = bytes
            .try_into()
            .map_err(|_| anyhow!("NOTARY signing key must decode to exactly 32 bytes"))?;
        k256::ecdsa::SigningKey::from_bytes((&secret_key).into())
            .map_err(|_| anyhow!("NOTARY signing key is not a valid secp256k1 scalar"))?;
        if !status.can_sign() {
            return Err(anyhow!(
                "NOTARY_KEY_STATUS={status:?} cannot serve Attestations"
            ));
        }
        Ok(Self {
            key_id,
            status,
            secret_key,
        })
    }

    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    pub fn status(&self) -> KeyStatus {
        self.status
    }

    pub fn signing_key_bytes(&self) -> &[u8; 32] {
        &self.secret_key
    }

    pub fn verifying_key(&self) -> VerifyingKey {
        let signing_key = k256::ecdsa::SigningKey::from_bytes((&self.secret_key).into())
            .expect("validated signing key must remain valid");
        VerifyingKey {
            alg: KeyAlgId::K256,
            data: signing_key.verifying_key().to_sec1_bytes().to_vec(),
        }
    }

    pub fn verifying_key_bincode_base64url(&self) -> Result<String> {
        Ok(URL_SAFE_NO_PAD.encode(bincode::serialize(&self.verifying_key())?))
    }

    pub fn public_key_export_json(&self) -> Result<String> {
        let verifying_key = self.verifying_key();
        let export = PublicKeyExport {
            schema_version: 1,
            protocol: "tlsn-v0.1.0-alpha.15",
            key_id: &self.key_id,
            status: "ACTIVE",
            signature_algorithm: "secp256k1",
            verifying_key_base64url: URL_SAFE_NO_PAD.encode(bincode::serialize(&verifying_key)?),
            sec1_public_key_base64url: URL_SAFE_NO_PAD.encode(verifying_key.data),
        };
        Ok(serde_json::to_string(&export)?)
    }

    pub fn configure_provider(&self) -> Result<tlsn::attestation::CryptoProvider> {
        let mut provider = tlsn::attestation::CryptoProvider::default();
        provider
            .signer
            .set_secp256k1(&self.secret_key)
            .map_err(|error| anyhow!("failed to configure Notary signer: {error}"))?;
        Ok(provider)
    }
}

fn read_key_file(path: &Path) -> Result<String> {
    let value = fs::read_to_string(path)
        .with_context(|| format!("failed to read NOTARY_SIGNING_KEY_FILE: {}", path.display()))?;
    Ok(value.trim().to_owned())
}

fn validate_key_id(key_id: &str) -> Result<()> {
    if key_id.is_empty() || key_id.len() > 64 || !key_id.bytes().all(is_key_id_byte) {
        return Err(anyhow!(
            "NOTARY_KEY_ID must match ASCII [A-Za-z0-9._-]{{1,64}}"
        ));
    }
    Ok(())
}

fn is_key_id_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";

    #[test]
    fn exports_fusou_compatible_bincode_verifying_key() {
        let material = KeyMaterial::from_encoded("notary-test".into(), KeyStatus::Active, KEY)
            .expect("test key is valid");
        let encoded = material
            .verifying_key_bincode_base64url()
            .expect("key serializes");
        let bytes = URL_SAFE_NO_PAD.decode(encoded).expect("base64url");
        let decoded: VerifyingKey = bincode::deserialize(&bytes).expect("bincode");
        assert_eq!(decoded, material.verifying_key());
        assert_eq!(decoded.alg, KeyAlgId::K256);
        assert_eq!(decoded.data.len(), 33);
    }

    #[test]
    fn wrong_status_is_rejected_before_server_start() {
        let error = KeyMaterial::from_encoded("notary-test".into(), KeyStatus::Revoked, KEY)
            .expect_err("revoked key must not sign");
        assert!(error.to_string().contains("cannot serve"));
    }

    #[test]
    fn malformed_key_is_rejected() {
        assert!(KeyMaterial::from_encoded("notary-test".into(), KeyStatus::Active, "bad").is_err());
    }
}
