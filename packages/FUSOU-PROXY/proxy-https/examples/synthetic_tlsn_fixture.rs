use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use fusou_tlsn_verifier::BINDING_PREFIX;
use hyper::body::Bytes;
use proxy_https::experimental_tlsn::{SerializedOriginRequest, TlsnOriginTransport};
use proxy_https::synthetic_tlsn::{
    SYNTHETIC_SERVER_IDENTITY, SyntheticAlpha15OriginTransport,
};
use uuid::Uuid;

fn binding_value() -> String {
    let session = Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000").unwrap();
    let mut bytes = Vec::new();
    bytes.extend_from_slice(BINDING_PREFIX);
    bytes.extend_from_slice(&16_u16.to_be_bytes());
    bytes.extend_from_slice(session.as_bytes());
    bytes.extend_from_slice(&32_u16.to_be_bytes());
    bytes.extend_from_slice(&[0x42_u8; 32]);
    URL_SAFE_NO_PAD.encode(bytes)
}

#[tokio::main]
async fn main() {
    let transport = SyntheticAlpha15OriginTransport::new().unwrap();
    let request = format!(
        "POST /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: {SYNTHETIC_SERVER_IDENTITY}\r\nX-Attestation-Binding: {}\r\nContent-Length: 11\r\nConnection: close\r\n\r\nactual body",
        binding_value()
    );
    transport
        .send_once(SerializedOriginRequest::new(Bytes::from(request)).unwrap())
        .await
        .unwrap();
    let evidence = transport.wire_evidence().unwrap();
    println!(
        "{}",
        serde_json::json!({
            "binding_value": binding_value(),
            "presentation_base64": URL_SAFE_NO_PAD.encode(evidence.presentation.unwrap()),
            "root_certificate_base64": URL_SAFE_NO_PAD.encode(evidence.root_certificate.unwrap()),
            "notary_key_base64": URL_SAFE_NO_PAD.encode(evidence.notary_verifying_key.unwrap()),
            "authenticated_request_base64": URL_SAFE_NO_PAD.encode(evidence.authenticated_request),
            "authenticated_response_base64": URL_SAFE_NO_PAD.encode(evidence.authenticated_response),
            "origin_request_size": evidence.origin_request.len(),
            "origin_response_size": evidence.origin_response.len(),
        })
    );
}