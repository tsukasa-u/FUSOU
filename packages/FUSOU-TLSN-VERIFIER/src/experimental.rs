//! Explicitly opt-in origin probe for TLSNotary transport experiments.
//!
//! This module is not used by FUSOU-PROXY or FUSOU-APP. Callers must provide a
//! Prover-owned alpha.15 TLS connection, so browser input and production proxy
//! traffic cannot enter this path accidentally.

use crate::{
    parse_require_info_request, parse_require_info_response,
    prover_transport::ProverTransportError, ParsedBinding, ParsedRequireInfo, ParserLimits,
    VerifierError,
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
    pub fn from_actual_request(
        server_identity: &str,
        expected_binding: &ParsedBinding,
        request: Vec<u8>,
    ) -> Result<Self> {
        let parsed =
            parse_require_info_request(&request, server_identity, &ParserLimits::default())?;
        if parsed.binding != *expected_binding {
            return Err(ExperimentalProbeError::BindingMismatch);
        }
        Ok(Self {
            server_identity: server_identity.to_owned(),
            binding: parsed.binding,
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
            .send_actual_require_info(&self.request, &self.server_identity, &self.binding)
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
    use crate::parse_binding_value;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use uuid::Uuid;

    fn actual_request(binding: &str) -> Vec<u8> {
        format!(
            "POST /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: game.example.test\r\nX-Attestation-Binding: {binding}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        )
        .into_bytes()
    }

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
        let probe = ExperimentalRequireInfoProbe::from_actual_request(
            "game.example.test",
            &expected,
            actual_request(&binding),
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
            ExperimentalRequireInfoProbe::from_actual_request(
                "Game.example.test",
                &parse_binding_value(&binding_value()).unwrap(),
                actual_request(&binding_value()),
            ),
            Err(ExperimentalProbeError::Configuration(_))
        ));
        assert!(matches!(
            ExperimentalRequireInfoProbe::from_actual_request(
                "game.example.test",
                &parse_binding_value(&binding_value()).unwrap(),
                b"GET / HTTP/1.1\r\nHost: game.example.test\r\n\r\n".to_vec(),
            ),
            Err(ExperimentalProbeError::Configuration(_))
        ));
    }

    #[test]
    fn experimental_probe_rejects_binding_mismatch_input() {
        let expected = parse_binding_value(&binding_value()).unwrap();
        let mut mismatched = expected.clone();
        mismatched.binding_nonce[0] ^= 1;
        assert!(matches!(
            ExperimentalRequireInfoProbe::from_actual_request(
                "game.example.test",
                &mismatched,
                actual_request(&binding_value()),
            ),
            Err(ExperimentalProbeError::BindingMismatch)
        ));
    }
}
