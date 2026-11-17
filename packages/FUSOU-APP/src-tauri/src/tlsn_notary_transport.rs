use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use proxy_https::{
    exchange_lifecycle::NotaryAttestationLimit, production_tlsn::PresentationHandoff,
    real_tlsn::RealAlpha15OriginTransportFactory,
};
use std::sync::Arc;

use crate::tlsn_runtime_config_manifest::{
    validate_notary_id, RuntimeConfigWorkerInput, VerifiedRuntimeConfigManifest,
};

pub(crate) fn build_production_factory(
    runtime_config: &VerifiedRuntimeConfigManifest,
    handoff: Arc<PresentationHandoff>,
    attestation_limit: NotaryAttestationLimit,
) -> Result<RealAlpha15OriginTransportFactory, String> {
    let encoded_key = runtime_config.worker_input(RuntimeConfigWorkerInput::NotaryVerifyingKey);
    let key_bytes = URL_SAFE_NO_PAD
        .decode(encoded_key)
        .map_err(|_| "Notary verifying key is not canonical base64url".to_owned())?;
    if URL_SAFE_NO_PAD.encode(&key_bytes) != encoded_key {
        return Err("Notary verifying key is not canonical base64url".to_owned());
    }
    validate_notary_key_bytes(&key_bytes).map_err(str::to_owned)?;
    let notary_verifying_key: tlsn_attestation::signing::VerifyingKey =
        bincode::deserialize(&key_bytes)
            .map_err(|_| "Notary verifying key is not an alpha.15 VerifyingKey".to_owned())?;
    let notary_id = runtime_config.worker_input(RuntimeConfigWorkerInput::NotaryId);
    validate_notary_id(notary_id).map_err(|error| error.to_string())?;
    let environment = runtime_config.payload().environment.as_str();
    if environment != "production" {
        return Err("Production Notary environment must be production".to_owned());
    }

    RealAlpha15OriginTransportFactory::new(
        runtime_config
            .worker_input(RuntimeConfigWorkerInput::NotaryEndpoint)
            .to_owned(),
        notary_verifying_key,
        notary_id.to_owned(),
        environment.to_owned(),
        handoff,
        attestation_limit,
    )
    .map_err(|error| error.to_string())
}

pub(crate) fn validate_notary_key_bytes(bytes: &[u8]) -> Result<(), &'static str> {
    const KEY_DATA_LENGTH: usize = 33;
    const SERIALIZED_KEY_LENGTH: usize = 1 + std::mem::size_of::<u64>() + KEY_DATA_LENGTH;
    let serialized_data_length = (KEY_DATA_LENGTH as u64).to_le_bytes();
    if bytes.len() != SERIALIZED_KEY_LENGTH
        || bytes.first().copied() != Some(tlsn_attestation::signing::KeyAlgId::K256.as_u8())
        || bytes.get(1..9) != Some(serialized_data_length.as_slice())
    {
        return Err("Notary key is not the canonical alpha.15 K256 key encoding");
    }
    let key: tlsn_attestation::signing::VerifyingKey =
        bincode::deserialize(bytes).map_err(|_| "decoded key is not an alpha.15 VerifyingKey")?;
    if key.alg != tlsn_attestation::signing::KeyAlgId::K256 {
        return Err("Notary key algorithm is not alpha.15 K256");
    }
    let canonical =
        bincode::serialize(&key).map_err(|_| "alpha.15 VerifyingKey serialization failed")?;
    if canonical != bytes {
        return Err("decoded key is not canonical alpha.15 VerifyingKey serialization");
    }
    k256::ecdsa::VerifyingKey::from_sec1_bytes(&key.data)
        .map_err(|_| "Notary key is not a valid compressed secp256k1 public point")?;
    Ok(())
}
