use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use fusou_tlsn_verifier::{
    decode_strict_base64url,
    tlsn_alpha15::{
        verify_alpha15_presentation_with_trusted_notary_key,
        verify_alpha15_presentation_with_trusted_notary_key_and_trust_anchor,
        RequireInfoDisclosureProfile,
    },
    ParserLimits,
};
use serde_json::json;
use std::{env, fs, process};

struct Arguments {
    presentation_path: String,
    server_identity: String,
    profile_sha256: [u8; 32],
    verifier_key_id: String,
    notary_key_id: String,
    canonical_user_id: String,
    canonical_device_id: String,
    device_challenge: [u8; 32],
    notary_key: Vec<u8>,
    trust_anchor_path: Option<String>,
}

fn usage() -> &'static str {
    "usage: verify_tlsn_require_info --presentation PATH --server-identity HOST --profile-sha256 BASE64URL --verifier-key-id ID --notary-key-id ID --canonical-user-id UUID --canonical-device-id UUID --device-challenge BASE64URL --notary-key-base64url BASE64URL [--trust-anchor-der PATH]"
}

fn required_value<I>(arguments: &mut I, flag: &str) -> Result<String, String>
where
    I: Iterator<Item = String>,
{
    arguments
        .next()
        .ok_or_else(|| format!("missing value for {flag}\n{}", usage()))
}

fn fixed_base64<const N: usize>(value: &str, label: &str) -> Result<[u8; N], String> {
    let bytes = decode_strict_base64url(value).map_err(|error| format!("{label}: {error}"))?;
    bytes
        .try_into()
        .map_err(|_| format!("{label} must decode to exactly {N} bytes"))
}

fn parse_arguments() -> Result<Arguments, String> {
    let mut arguments = env::args().skip(1);
    let mut presentation_path = None;
    let mut server_identity = None;
    let mut profile_sha256 = None;
    let mut verifier_key_id = None;
    let mut notary_key_id = None;
    let mut canonical_user_id = None;
    let mut canonical_device_id = None;
    let mut device_challenge = None;
    let mut notary_key = None;
    let mut trust_anchor_path = None;
    while let Some(flag) = arguments.next() {
        if flag == "--help" {
            println!("{}", usage());
            process::exit(0);
        }
        let value = required_value(&mut arguments, &flag)?;
        match flag.as_str() {
            "--presentation" => presentation_path = Some(value),
            "--server-identity" => server_identity = Some(value),
            "--profile-sha256" => profile_sha256 = Some(fixed_base64(&value, "profile SHA-256")?),
            "--verifier-key-id" => verifier_key_id = Some(value),
            "--notary-key-id" => notary_key_id = Some(value),
            "--canonical-user-id" => canonical_user_id = Some(value),
            "--canonical-device-id" => canonical_device_id = Some(value),
            "--device-challenge" => device_challenge = Some(fixed_base64(&value, "device challenge")?),
            "--notary-key-base64url" => {
                notary_key = Some(decode_strict_base64url(&value).map_err(|error| format!("Notary key: {error}"))?)
            }
            "--trust-anchor-der" => trust_anchor_path = Some(value),
            _ => return Err(format!("unknown argument: {flag}\n{}", usage())),
        }
    }
    Ok(Arguments {
        presentation_path: presentation_path.ok_or_else(|| format!("missing --presentation\n{}", usage()))?,
        server_identity: server_identity.ok_or_else(|| format!("missing --server-identity\n{}", usage()))?,
        profile_sha256: profile_sha256.ok_or_else(|| format!("missing --profile-sha256\n{}", usage()))?,
        verifier_key_id: verifier_key_id.ok_or_else(|| format!("missing --verifier-key-id\n{}", usage()))?,
        notary_key_id: notary_key_id.ok_or_else(|| format!("missing --notary-key-id\n{}", usage()))?,
        canonical_user_id: canonical_user_id.ok_or_else(|| format!("missing --canonical-user-id\n{}", usage()))?,
        canonical_device_id: canonical_device_id.ok_or_else(|| format!("missing --canonical-device-id\n{}", usage()))?,
        device_challenge: device_challenge.ok_or_else(|| format!("missing --device-challenge\n{}", usage()))?,
        notary_key: notary_key.ok_or_else(|| format!("missing --notary-key-base64url\n{}", usage()))?,
        trust_anchor_path,
    })
}

fn run() -> Result<(), String> {
    let arguments = parse_arguments()?;
    let presentation = fs::read(&arguments.presentation_path)
        .map_err(|error| format!("read Presentation: {error}"))?;
    let transcript = if let Some(path) = arguments.trust_anchor_path.as_deref() {
        let trust_anchor = fs::read(path).map_err(|error| format!("read trust anchor: {error}"))?;
        verify_alpha15_presentation_with_trusted_notary_key_and_trust_anchor(
            &presentation,
            &trust_anchor,
            &arguments.notary_key,
        )
        .map_err(|error| error.to_string())?
    } else {
        verify_alpha15_presentation_with_trusted_notary_key(
            &presentation,
            &arguments.notary_key,
        )
        .map_err(|error| error.to_string())?
    };
    let profile = RequireInfoDisclosureProfile::from_server_identity(&arguments.server_identity)
        .map_err(|error| error.to_string())?;
    let authenticated = transcript
        .verify_require_info(&profile, &ParserLimits::default())
        .map_err(|error| error.to_string())?;
    let result = authenticated
        .into_verifier_result(
            arguments.profile_sha256,
            arguments.verifier_key_id,
            arguments.notary_key_id,
            arguments.canonical_user_id,
            arguments.canonical_device_id,
            arguments.device_challenge,
            [0; 64],
        )
        .map_err(|error| error.to_string())?;
    let unsigned_result: serde_json::Value = serde_json::from_str(
        &result.canonical_json().map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("serialize unsigned Result: {error}"))?;
    let output = json!({
        "status": "VERIFIED",
        "verification": "REAL_ALPHA15_FUSOU_REQUIRE_INFO",
        "server_identity": &result.server_identity,
        "tlsn_attestation_id": URL_SAFE_NO_PAD.encode(&result.tlsn_attestation_id),
        "notary_key_sha256": URL_SAFE_NO_PAD.encode(transcript.notary_key_sha256()),
        "verified_member_id": &result.verified_member_id,
        "attestation_session_id": result.attestation_session_id.to_string(),
        "binding_value": &result.binding_value,
        "request_transcript_sha256": URL_SAFE_NO_PAD.encode(result.request_transcript_sha256),
        "response_transcript_sha256": URL_SAFE_NO_PAD.encode(result.response_transcript_sha256),
        "unsigned_result": unsigned_result,
        "signing_bytes": URL_SAFE_NO_PAD.encode(result.signing_bytes().map_err(|error| error.to_string())?),
    });
    println!("{}", serde_json::to_string(&output).map_err(|error| error.to_string())?);
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("[verify_tlsn_require_info] {error}");
        process::exit(1);
    }
}