use super::{
    decode_base64, object_string, parse_json, parse_timestamp, sha256_base64url, verify_ed25519,
    BundleVerificationError, Result,
};
use serde_json::{json, Value};

pub(super) const SCOPE: &str = "tlsn-production-queue-verifier-execution-receipt";
const TRUST_SCOPE: &str = "tlsn-production-queue-verifier-execution-trust";
const DOMAIN: &[u8] = b"FUSOU-TLSN-PRODUCTION-QUEUE-VERIFIER-EXECUTION-V1\0";
const EDGE: &str = "production_queue_execution_receipt";
const RECEIPT: &str = "verifier-execution-receipt.bin";
const TRUST: &str = "queue-execution-trust";
pub(super) const MAX_RECEIPT_BYTES: usize = 4096;

const SIGNED_FIELDS: [&str; 17] = [
    "schema_version",
    "scope",
    "environment",
    "deployment_role",
    "execution_mode",
    "job_id",
    "verification_attempt_id",
    "deployment_id",
    "worker_name",
    "runtime_version_id",
    "source_sha",
    "verifier_execution_key_id",
    "verifier_public_key_spki_sha256",
    "verification_profile",
    "presentation_sha256",
    "result_sha256",
    "issued_at",
];

const TRUST_FIELDS: [&str; 11] = [
    "schema_version",
    "scope",
    "deployment_id",
    "worker_name",
    "runtime_version_id",
    "source_sha",
    "verifier_execution_key_id",
    "verifier_public_key_spki",
    "not_before",
    "not_after",
    "execution_mode",
];

fn reject(message: &str) -> BundleVerificationError {
    BundleVerificationError::new(EDGE, Some(RECEIPT), message)
}

fn bounded_json(raw: &[u8], label: &str) -> Result<Value> {
    if raw.len() > MAX_RECEIPT_BYTES {
        return Err(BundleVerificationError::new(
            EDGE,
            Some(label),
            "execution receipt input exceeds byte limit",
        ));
    }
    parse_json(raw, label, EDGE)
}

fn string<'a>(value: &'a Value, field: &str, artifact: &str) -> Result<&'a str> {
    object_string(value, field, EDGE, artifact)
}

fn canonical_time(value: &str) -> Result<i128> {
    let bytes = value.as_bytes();
    if bytes.len() != 24 || bytes[19] != b'.' || bytes[23] != b'Z' {
        return Err(reject(
            "execution receipt timestamp is outside the canonical format",
        ));
    }
    parse_timestamp(value).map_err(|_| reject("execution receipt timestamp is invalid"))
}

fn uuid(value: &str, v4: bool) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| {
        id.to_string() == value
            && (!v4
                || id.get_version() == Some(uuid::Version::Random)
                    && id.get_variant() == uuid::Variant::RFC4122)
    })
}

pub(super) fn claims_queue_receipt(raw: &[u8]) -> bool {
    serde_json::from_slice::<Value>(raw).is_ok_and(|receipt| {
        receipt["scope"] == SCOPE
            || receipt["execution_mode"] == "queue"
            || receipt.get("verifier_execution_key_id").is_some()
    })
}

fn signing_bytes(receipt: &Value) -> Result<Vec<u8>> {
    let payload = Value::Array(
        SIGNED_FIELDS
            .iter()
            .map(|field| receipt[*field].clone())
            .collect(),
    );
    let mut bytes = DOMAIN.to_vec();
    bytes.extend_from_slice(
        &serde_json::to_vec(&payload)
            .map_err(|_| reject("could not encode receipt signing bytes"))?,
    );
    Ok(bytes)
}

pub(super) fn verify(
    raw: &[u8],
    trust_raw: &[u8],
    presentation: &[u8],
    result_outer: &[u8],
) -> Result<Value> {
    let receipt = bounded_json(raw, RECEIPT)?;
    let trust = bounded_json(trust_raw, TRUST)?;
    if receipt.as_object().is_none_or(|object| {
        object.len() != SIGNED_FIELDS.len() + 2
            || SIGNED_FIELDS
                .iter()
                .any(|field| !object.contains_key(*field))
    }) || trust.as_object().is_none_or(|object| {
        object.len() != TRUST_FIELDS.len()
            || TRUST_FIELDS
                .iter()
                .any(|field| !object.contains_key(*field))
    }) || receipt["schema_version"] != 1
        || receipt["scope"] != SCOPE
        || receipt["environment"] != "production"
        || receipt["deployment_role"] != "production"
        || receipt["execution_mode"] != "queue"
        || receipt["signature_algorithm"] != "Ed25519"
        || trust["schema_version"] != 1
        || trust["scope"] != TRUST_SCOPE
        || trust["execution_mode"] != "queue"
    {
        return Err(reject(
            "execution receipt or trust policy schema is invalid",
        ));
    }

    for field in [
        "deployment_id",
        "worker_name",
        "runtime_version_id",
        "source_sha",
        "verifier_execution_key_id",
    ] {
        if string(&receipt, field, RECEIPT)? != string(&trust, field, TRUST)? {
            return Err(reject(
                "execution receipt deployment or signer differs from the independent pin",
            ));
        }
    }
    let job_id = string(&receipt, "job_id", RECEIPT)?;
    let attempt_id = string(&receipt, "verification_attempt_id", RECEIPT)?;
    if !uuid(job_id, true)
        || !uuid(attempt_id, true)
        || !uuid(string(&receipt, "runtime_version_id", RECEIPT)?, false)
    {
        return Err(reject(
            "execution receipt operation or runtime version is invalid",
        ));
    }
    let issued_at = string(&receipt, "issued_at", RECEIPT)?;
    let timestamp = canonical_time(issued_at)?;
    if timestamp < canonical_time(string(&trust, "not_before", TRUST)?)?
        || timestamp >= canonical_time(string(&trust, "not_after", TRUST)?)?
    {
        return Err(reject(
            "execution receipt time is outside the independent pin validity",
        ));
    }

    let spki = string(&trust, "verifier_public_key_spki", TRUST)?;
    let spki_bytes = decode_base64(spki, "execution receipt SPKI", EDGE)?;
    let presentation_digest = sha256_base64url(presentation);
    let result_digest = sha256_base64url(result_outer);
    if receipt["verifier_public_key_spki_sha256"] != sha256_base64url(&spki_bytes)
        || receipt["presentation_sha256"] != presentation_digest
        || receipt["result_sha256"] != result_digest
    {
        return Err(reject(
            "execution receipt exact bytes or public-key digest mismatch",
        ));
    }
    let outer = parse_json(result_outer, "result-exact.bin", EDGE)?;
    let version = match string(&receipt, "verification_profile", RECEIPT)? {
        "complete" => 2,
        "sparse" => 3,
        _ => return Err(reject("execution receipt profile is invalid")),
    };
    if outer["verified"] != true
        || outer["result"]["version"] != version
        || outer["result"]["presentation_sha256"] != presentation_digest
        || outer["consume_receipt"]["presentation_id"] != presentation_digest
        || outer["consume_receipt"]["used_at"] != issued_at
    {
        return Err(reject(
            "execution receipt differs from the Result profile or consume context",
        ));
    }

    let signature = decode_base64(
        string(&receipt, "signature_base64url", RECEIPT)?,
        "execution receipt signature",
        EDGE,
    )?;
    verify_ed25519(spki, &signing_bytes(&receipt)?, &signature, EDGE, RECEIPT)?;
    Ok(json!({
        "status": "SIGNATURE_AND_EXACT_BYTES_VERIFIED",
        "job_id": job_id,
        "verification_attempt_id": attempt_id,
        "receipt_sha256": sha256_base64url(raw),
        "presentation_sha256": presentation_digest,
        "result_sha256": result_digest,
    }))
}

#[cfg(test)]
pub(super) fn sign_fixture(presentation: &[u8], result: &[u8]) -> (Vec<u8>, Vec<u8>) {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use ring::signature::{Ed25519KeyPair, KeyPair};

    let fixture = tests::vector();
    let mut trust = fixture["independent_trust"].clone();
    let result_json: Value = serde_json::from_slice(result).unwrap();
    let mut receipt: Value =
        serde_json::from_str(fixture["receipt_utf8"].as_str().unwrap()).unwrap();
    let signing_key = Ed25519KeyPair::from_seed_unchecked(&[4; 32]).unwrap();
    let spki = [super::SPKI_PREFIX, signing_key.public_key().as_ref()].concat();
    trust["not_before"] = json!("2026-01-01T00:00:00.000Z");
    trust["not_after"] = json!("2027-01-01T00:00:00.000Z");
    trust["verifier_public_key_spki"] = json!(URL_SAFE_NO_PAD.encode(&spki));
    receipt["verifier_public_key_spki_sha256"] = json!(sha256_base64url(&spki));
    receipt["presentation_sha256"] = json!(sha256_base64url(presentation));
    receipt["result_sha256"] = json!(sha256_base64url(result));
    receipt["issued_at"] = result_json["consume_receipt"]["used_at"].clone();
    if result_json["result"]["version"] == 3 {
        receipt["verification_profile"] = json!("sparse");
    }
    receipt["signature_base64url"] =
        json!(URL_SAFE_NO_PAD.encode(signing_key.sign(&signing_bytes(&receipt).unwrap())));
    (
        serde_json::to_vec(&receipt).unwrap(),
        serde_json::to_vec(&trust).unwrap(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(super) fn vector() -> Value {
        serde_json::from_str(include_str!(
            "../../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/fixtures/production-queue-execution-receipt-v1.json"
        ))
        .unwrap()
    }

    #[test]
    fn verifies_worker_vector_and_rejects_changed_trust_context_or_bytes() {
        let vector = vector();
        let receipt = vector["receipt_utf8"].as_str().unwrap();
        let trust = &vector["independent_trust"];
        let trust_raw = serde_json::to_vec(trust).unwrap();
        let result = vector["result_outer_utf8"].as_str().unwrap().as_bytes();
        let presentation = decode_base64(
            vector["presentation_base64url"].as_str().unwrap(),
            "fixture",
            EDGE,
        )
        .unwrap();
        assert_eq!(
            verify(receipt.as_bytes(), &trust_raw, &presentation, result).unwrap()["status"],
            "SIGNATURE_AND_EXACT_BYTES_VERIFIED",
        );
        for (field, value) in [
            ("deployment_id", json!("unapproved")),
            (
                "runtime_version_id",
                json!("00000000-0000-0000-0000-000000000000"),
            ),
            ("verifier_execution_key_id", json!("wrong")),
            ("verifier_public_key_spki", json!("wrong")),
            ("not_after", json!("2026-11-25T03:30:00.000Z")),
        ] {
            let mut changed = trust.clone();
            changed[field] = value;
            assert!(
                verify(
                    receipt.as_bytes(),
                    &serde_json::to_vec(&changed).unwrap(),
                    &presentation,
                    result
                )
                .is_err(),
                "{field}"
            );
        }
        for (field, value) in [
            ("scope", json!("tlsn-canary-verifier-execution-receipt")),
            (
                "verification_attempt_id",
                json!("c52e6378-6589-422b-9043-18db85bf57cf"),
            ),
            ("signature_base64url", json!("invalid")),
        ] {
            let mut changed: Value = serde_json::from_str(receipt).unwrap();
            changed[field] = value;
            assert!(
                verify(
                    &serde_json::to_vec(&changed).unwrap(),
                    &trust_raw,
                    &presentation,
                    result
                )
                .is_err(),
                "{field}"
            );
        }
        let mut changed_result = result.to_vec();
        changed_result.push(b' ');
        assert!(verify(
            receipt.as_bytes(),
            &trust_raw,
            &presentation,
            &changed_result
        )
        .is_err());
        let mut changed_presentation = presentation;
        changed_presentation.push(0);
        assert!(verify(
            receipt.as_bytes(),
            &trust_raw,
            &changed_presentation,
            result
        )
        .is_err());
    }
}
