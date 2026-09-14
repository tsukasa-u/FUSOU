use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use fusou_tlsn_verifier::{
    plan_require_info_response_sparse_range_report, ParserLimits, SparseResponseRangeKind,
    BINDING_PREFIX,
};
use proxy_https::experimental_tlsn::{AttestationBinding, TlsnOriginTransport};
use proxy_https::synthetic_tlsn::{
    synthetic_serialized_require_info_request, SyntheticAlpha15Memory,
    SyntheticAlpha15OriginTransport, SyntheticAlpha15Timing,
};
use std::time::Instant;
use uuid::Uuid;

fn binding_value() -> String {
    if let Ok(configured_binding) = std::env::var("FUSOU_SYNTHETIC_BINDING_VALUE") {
        return configured_binding;
    }
    let session = Uuid::parse_str("123e4567-e89b-42d3-a456-426614174000").unwrap();
    let mut bytes = Vec::new();
    bytes.extend_from_slice(BINDING_PREFIX);
    bytes.extend_from_slice(&16_u16.to_be_bytes());
    bytes.extend_from_slice(session.as_bytes());
    bytes.extend_from_slice(&32_u16.to_be_bytes());
    bytes.extend_from_slice(&[0x42_u8; 32]);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn memory_json(memory: SyntheticAlpha15Memory) -> serde_json::Value {
    serde_json::json!({
        "rssBytes": memory.rss_bytes,
        "peakRssBytes": memory.peak_rss_bytes,
        "dataBytes": memory.data_bytes,
        "virtualBytes": memory.virtual_bytes,
    })
}

fn duration_milliseconds(duration: Option<std::time::Duration>) -> Option<f64> {
    duration.map(|value| value.as_secs_f64() * 1000.0)
}

fn timing_json(timing: Option<SyntheticAlpha15Timing>) -> serde_json::Value {
    let Some(timing) = timing else {
        return serde_json::Value::Null;
    };
    serde_json::json!({
        "originCaptureMilliseconds": timing.origin_capture_latency.as_secs_f64() * 1000.0,
        "proofGenerationMilliseconds": duration_milliseconds(timing.proof_generation_latency),
        "proverCommitMilliseconds": duration_milliseconds(timing.prover_commit_latency),
        "proverConnectMilliseconds": duration_milliseconds(timing.prover_connect_latency),
        "transcriptCommitMilliseconds": duration_milliseconds(timing.transcript_commit_latency),
        "proveConfigMilliseconds": duration_milliseconds(timing.prove_config_latency),
        "proveMilliseconds": duration_milliseconds(timing.prove_latency),
        "attestationMilliseconds": duration_milliseconds(timing.attestation_latency),
        "presentationBuildMilliseconds": duration_milliseconds(timing.presentation_build_latency),
        "presentationSerializationMilliseconds": duration_milliseconds(timing.presentation_serialization_latency),
        "memoryAfterExchange": memory_json(timing.memory_after_exchange),
        "memoryAfterTranscriptCommit": timing.memory_after_transcript_commit.map(memory_json),
        "memoryAfterProveConfig": timing.memory_after_prove_config.map(memory_json),
        "memoryAfterProve": timing.memory_after_prove.map(memory_json),
        "memoryAfterAttestation": timing.memory_after_attestation.map(memory_json),
        "memoryAfterPresentationBuild": timing.memory_after_presentation_build.map(memory_json),
        "memoryAfterPresentationSerialization": timing
            .memory_after_presentation_serialization
            .map(memory_json),
    })
}

fn sparse_response_range_report(response: &[u8]) -> Vec<serde_json::Value> {
    let (_, report) =
        plan_require_info_response_sparse_range_report(response, &ParserLimits::default())
            .expect("synthetic response must produce a sparse range report");
    report
        .into_iter()
        .map(|entry| {
            let kind = match entry.kind {
                SparseResponseRangeKind::HttpHeaders => "http_headers",
                SparseResponseRangeKind::SvdataPrefix => "svdata_prefix",
                SparseResponseRangeKind::JsonStructure => "json_structure",
                SparseResponseRangeKind::RootKey => "root_key",
                SparseResponseRangeKind::ApiResultValue => "api_result_value",
                SparseResponseRangeKind::ApiDataKey => "api_data_key",
                SparseResponseRangeKind::ApiBasicKey => "api_basic_key",
                SparseResponseRangeKind::ApiMemberIdValue => "api_member_id_value",
            };
            serde_json::json!({
                "kind": kind,
                "start": entry.start,
                "length": entry.length,
            })
        })
        .collect()
}

#[tokio::main]
async fn main() {
    let started = Instant::now();
    let transport = SyntheticAlpha15OriginTransport::new().unwrap();
    let binding = AttestationBinding::new(binding_value()).unwrap();
    let capture = transport
        .send_once(synthetic_serialized_require_info_request(&binding).unwrap())
        .await
        .unwrap();
    capture.proof.run().await.unwrap();
    let evidence = transport.wire_evidence().unwrap();
    let sparse_range_report = sparse_response_range_report(&evidence.authenticated_response);
    println!(
        "{}",
        serde_json::json!({
            "binding_value": binding_value(),
            "presentation_base64": evidence
                .presentation
                .map(|presentation| URL_SAFE_NO_PAD.encode(presentation)),
            "sparse_presentation_base64": URL_SAFE_NO_PAD.encode(evidence.sparse_presentation.unwrap()),
            "root_certificate_base64": URL_SAFE_NO_PAD.encode(evidence.root_certificate.unwrap()),
            "notary_key_base64": URL_SAFE_NO_PAD.encode(evidence.notary_verifying_key.unwrap()),
            "authenticated_request_base64": URL_SAFE_NO_PAD.encode(evidence.authenticated_request),
            "authenticated_response_base64": URL_SAFE_NO_PAD.encode(evidence.authenticated_response),
            "origin_request_size": evidence.origin_request.len(),
            "origin_response_size": evidence.origin_response.len(),
            "sparse_response_range_report": sparse_range_report,
            "committed_request_bytes": evidence.committed_request_bytes,
            "committed_response_bytes": evidence.committed_response_bytes,
            "committed_response_range_count": evidence.committed_response_range_count,
            "committed_response_largest_range_bytes": evidence.committed_response_largest_range_bytes,
            "disclosed_response_range_count": evidence.disclosed_response_range_count,
            "disclosed_response_largest_range_bytes": evidence.disclosed_response_largest_range_bytes,
            "generation_elapsed_milliseconds": started.elapsed().as_secs_f64() * 1000.0,
            "generation_timing": timing_json(transport.timing()),
        })
    );
}
