//! Explicitly opt-in origin probe for TLSNotary transport experiments.
//!
//! This module is not used by FUSOU-PROXY or FUSOU-APP. Callers must provide a
//! Prover-owned alpha.15 TLS connection, so browser input and production proxy
//! traffic cannot enter this path accidentally.

use crate::{
    parse_binding_value, parse_require_info_response,
    prover_transport::{build_require_info_request, ProverTransportError},
    ParsedBinding, ParsedRequireInfo, ParserLimits, VerifierError,
};
use thiserror::Error;
use tlsn::prover::TlsConnection;

#[derive(Debug, Error)]
pub enum ExperimentalProbeError {
    #[error("experimental probe configuration is invalid: {0}")]
    Configuration(#[from] VerifierError),
    #[error("experimental probe transport failed: {0}")]
    Transport(#[from] ProverTransportError),
    #[error("experimental probe binding does not match the expected Session/nonce binding")]
    BindingMismatch,
}

pub type Result<T> = std::result::Result<T, ExperimentalProbeError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExperimentalRequireInfoProbe {
    server_identity: String,
    binding: ParsedBinding,
    request: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExperimentalRequireInfoEvidence {
    pub request: Vec<u8>,
    pub response: Vec<u8>,
    pub binding: ParsedBinding,
    pub verified_member_id: String,
}

impl ExperimentalRequireInfoProbe {
    pub fn new(server_identity: &str, binding_value: &str) -> Result<Self> {
        let binding = parse_binding_value(binding_value)?;
        Self::from_expected_binding(server_identity, &binding, binding_value)
    }

    pub fn from_expected_binding(
        server_identity: &str,
        expected_binding: &ParsedBinding,
        binding_value: &str,
    ) -> Result<Self> {
        let binding = parse_binding_value(binding_value)?;
        if &binding != expected_binding {
            return Err(ExperimentalProbeError::BindingMismatch);
        }
        let request = build_require_info_request(server_identity, binding_value)?;
        Ok(Self {
            server_identity: server_identity.to_owned(),
            binding,
            request,
        })
    }

    pub fn request(&self) -> &[u8] {
        &self.request
    }

    pub fn binding(&self) -> &ParsedBinding {
        &self.binding
    }

    pub async fn run(self, connection: TlsConnection) -> Result<ExperimentalRequireInfoEvidence> {
        let mut transport = crate::prover_transport::ProverOwnedTlsTransport::new(connection);
        transport
            .send_require_info(&self.server_identity, &self.binding.value)
            .await?;
        let response = transport.read_response_to_end().await?;
        transport.close().await?;

        let ParsedRequireInfo { verified_member_id } =
            parse_require_info_response(&response, &ParserLimits::default())?;
        Ok(ExperimentalRequireInfoEvidence {
            request: self.request,
            response,
            binding: self.binding,
            verified_member_id,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use uuid::Uuid;

    fn binding_value() -> String {
        let session = Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000").unwrap();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(crate::BINDING_PREFIX);
        bytes.extend_from_slice(&16_u16.to_be_bytes());
        bytes.extend_from_slice(session.as_bytes());
        bytes.extend_from_slice(&32_u16.to_be_bytes());
        bytes.extend_from_slice(&[0x42_u8; 32]);
        URL_SAFE_NO_PAD.encode(bytes)
    }

    #[test]
    fn experimental_request_contains_one_binding_before_origin_send() {
        let binding = binding_value();
        let expected = parse_binding_value(&binding).unwrap();
        let probe = ExperimentalRequireInfoProbe::from_expected_binding(
            "game.example.test",
            &expected,
            &binding,
        )
        .unwrap();
        let request = probe.request();
        assert_eq!(
            request
                .windows(crate::BINDING_HEADER.len())
                .filter(|window| *window == crate::BINDING_HEADER.as_bytes())
                .count(),
            1
        );
        assert!(request
            .windows(crate::BINDING_HEADER.len())
            .position(|window| window == crate::BINDING_HEADER.as_bytes())
            .is_some());
        assert_eq!(probe.binding(), &expected);
        assert_eq!(probe.binding().value, binding);
    }

    #[test]
    fn experimental_probe_rejects_invalid_configuration_before_transport() {
        assert!(matches!(
            ExperimentalRequireInfoProbe::new("Game.example.test", &binding_value()),
            Err(ExperimentalProbeError::Transport(
                ProverTransportError::InvalidRequest(_)
            ))
        ));
        assert!(matches!(
            ExperimentalRequireInfoProbe::new("game.example.test", "not-a-binding"),
            Err(ExperimentalProbeError::Configuration(_))
        ));
    }

    #[test]
    fn experimental_probe_rejects_binding_mismatch_input() {
        let expected = parse_binding_value(&binding_value()).unwrap();
        let mut mismatched = expected.clone();
        mismatched.binding_nonce[0] ^= 1;
        assert!(matches!(
            ExperimentalRequireInfoProbe::from_expected_binding(
                "game.example.test",
                &mismatched,
                &binding_value(),
            ),
            Err(ExperimentalProbeError::BindingMismatch)
        ));
        assert!(ExperimentalRequireInfoProbe::new("game.example.test", "not-a-binding").is_err());
    }
}
