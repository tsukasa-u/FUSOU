use fusou_tlsn_verifier::evidence_bundle::{
    verify_bundle, BundleVerificationError, BundleVerifierOptions,
};
use serde_json::json;
use std::{env, fs, process};

struct Arguments {
    bundle: String,
    evidence_root_key_id: String,
    evidence_root_public_key_spki: String,
    trusted_notary_registry: String,
    session_authority_registry: String,
    session_authority_key_id: String,
    session_authority_public_key_spki: String,
    binding_authority_registry: String,
    binding_authority_key_id: String,
    binding_authority_public_key_spki: String,
    canonical_user_id: String,
    device_id: String,
    device_public_key: String,
    server_identity: String,
    profile_sha256: String,
    verifier_key_id: String,
    trust_anchor_der: String,
}

fn usage() -> &'static str {
    "usage: verify_fusou_tlsn_evidence --bundle PATH --evidence-root-key-id ID --evidence-root-public-key-spki BASE64URL --trusted-notary-registry PATH --session-authority-registry PATH --session-authority-key-id ID --session-authority-public-key-spki BASE64URL --binding-authority-registry PATH --binding-authority-key-id ID --binding-authority-public-key-spki BASE64URL --canonical-user-id UUID --device-id UUID --device-public-key BASE64URL --server-identity HOST --profile-sha256 BASE64URL --verifier-key-id ID --trust-anchor-der PATH"
}

fn required_value<I>(arguments: &mut I, flag: &str) -> Result<String, String>
where
    I: Iterator<Item = String>,
{
    arguments
        .next()
        .ok_or_else(|| format!("missing value for {flag}\n{}", usage()))
}

fn parse_arguments() -> Result<Arguments, String> {
    let mut arguments = env::args().skip(1);
    let mut bundle = None;
    let mut evidence_root_key_id = None;
    let mut evidence_root_public_key_spki = None;
    let mut trusted_notary_registry = None;
    let mut session_authority_registry = None;
    let mut session_authority_key_id = None;
    let mut session_authority_public_key_spki = None;
    let mut binding_authority_registry = None;
    let mut binding_authority_key_id = None;
    let mut binding_authority_public_key_spki = None;
    let mut canonical_user_id = None;
    let mut device_id = None;
    let mut device_public_key = None;
    let mut server_identity = None;
    let mut profile_sha256 = None;
    let mut verifier_key_id = None;
    let mut trust_anchor_der = None;
    while let Some(flag) = arguments.next() {
        if flag == "--help" {
            println!("{}", usage());
            process::exit(0);
        }
        let value = required_value(&mut arguments, &flag)?;
        match flag.as_str() {
            "--bundle" => bundle = Some(value),
            "--evidence-root-key-id" => evidence_root_key_id = Some(value),
            "--evidence-root-public-key-spki" => evidence_root_public_key_spki = Some(value),
            "--trusted-notary-registry" => trusted_notary_registry = Some(value),
            "--session-authority-registry" => session_authority_registry = Some(value),
            "--session-authority-key-id" => session_authority_key_id = Some(value),
            "--session-authority-public-key-spki" => {
                session_authority_public_key_spki = Some(value)
            }
            "--binding-authority-registry" => binding_authority_registry = Some(value),
            "--binding-authority-key-id" => binding_authority_key_id = Some(value),
            "--binding-authority-public-key-spki" => {
                binding_authority_public_key_spki = Some(value)
            }
            "--canonical-user-id" => canonical_user_id = Some(value),
            "--device-id" => device_id = Some(value),
            "--device-public-key" => device_public_key = Some(value),
            "--server-identity" => server_identity = Some(value),
            "--profile-sha256" => profile_sha256 = Some(value),
            "--verifier-key-id" => verifier_key_id = Some(value),
            "--trust-anchor-der" => trust_anchor_der = Some(value),
            _ => return Err(format!("unknown argument: {flag}\n{}", usage())),
        }
    }
    Ok(Arguments {
        bundle: bundle.ok_or_else(|| format!("missing --bundle\n{}", usage()))?,
        evidence_root_key_id: evidence_root_key_id
            .ok_or_else(|| format!("missing --evidence-root-key-id\n{}", usage()))?,
        evidence_root_public_key_spki: evidence_root_public_key_spki
            .ok_or_else(|| format!("missing --evidence-root-public-key-spki\n{}", usage()))?,
        trusted_notary_registry: trusted_notary_registry
            .ok_or_else(|| format!("missing --trusted-notary-registry\n{}", usage()))?,
        session_authority_registry: session_authority_registry
            .ok_or_else(|| format!("missing --session-authority-registry\n{}", usage()))?,
        session_authority_key_id: session_authority_key_id
            .ok_or_else(|| format!("missing --session-authority-key-id\n{}", usage()))?,
        session_authority_public_key_spki: session_authority_public_key_spki
            .ok_or_else(|| format!("missing --session-authority-public-key-spki\n{}", usage()))?,
        binding_authority_registry: binding_authority_registry
            .ok_or_else(|| format!("missing --binding-authority-registry\n{}", usage()))?,
        binding_authority_key_id: binding_authority_key_id
            .ok_or_else(|| format!("missing --binding-authority-key-id\n{}", usage()))?,
        binding_authority_public_key_spki: binding_authority_public_key_spki
            .ok_or_else(|| format!("missing --binding-authority-public-key-spki\n{}", usage()))?,
        canonical_user_id: canonical_user_id
            .ok_or_else(|| format!("missing --canonical-user-id\n{}", usage()))?,
        device_id: device_id.ok_or_else(|| format!("missing --device-id\n{}", usage()))?,
        device_public_key: device_public_key
            .ok_or_else(|| format!("missing --device-public-key\n{}", usage()))?,
        server_identity: server_identity
            .ok_or_else(|| format!("missing --server-identity\n{}", usage()))?,
        profile_sha256: profile_sha256
            .ok_or_else(|| format!("missing --profile-sha256\n{}", usage()))?,
        verifier_key_id: verifier_key_id
            .ok_or_else(|| format!("missing --verifier-key-id\n{}", usage()))?,
        trust_anchor_der: trust_anchor_der
            .ok_or_else(|| format!("missing --trust-anchor-der\n{}", usage()))?,
    })
}

fn run(arguments: Arguments) -> Result<serde_json::Value, BundleVerificationError> {
    let trusted_notary_registry =
        fs::read(&arguments.trusted_notary_registry).map_err(|error| {
            BundleVerificationError::new(
                "cli",
                Some("trusted_notary_registry"),
                format!("read failed: {error}"),
            )
        })?;
    let session_authority_registry =
        fs::read(&arguments.session_authority_registry).map_err(|error| {
            BundleVerificationError::new(
                "cli",
                Some("session_authority_registry"),
                format!("read failed: {error}"),
            )
        })?;
    let binding_authority_registry =
        fs::read(&arguments.binding_authority_registry).map_err(|error| {
            BundleVerificationError::new(
                "cli",
                Some("binding_authority_registry"),
                format!("read failed: {error}"),
            )
        })?;
    let trust_anchor_der = fs::read(&arguments.trust_anchor_der).map_err(|error| {
        BundleVerificationError::new(
            "cli",
            Some("trust_anchor_der"),
            format!("read failed: {error}"),
        )
    })?;
    verify_bundle(
        arguments.bundle,
        &BundleVerifierOptions {
            evidence_root_key_id: arguments.evidence_root_key_id,
            evidence_root_public_key_spki: arguments.evidence_root_public_key_spki,
            trusted_notary_registry_raw: trusted_notary_registry,
            session_authority_registry_raw: session_authority_registry,
            session_authority_key_id: arguments.session_authority_key_id,
            session_authority_public_key_spki: arguments.session_authority_public_key_spki,
            binding_authority_registry_raw: binding_authority_registry,
            binding_authority_key_id: arguments.binding_authority_key_id,
            binding_authority_public_key_spki: arguments.binding_authority_public_key_spki,
            canonical_user_id: arguments.canonical_user_id,
            device_id: arguments.device_id,
            device_public_key: arguments.device_public_key,
            server_identity: arguments.server_identity,
            profile_sha256: arguments.profile_sha256,
            verifier_key_id: arguments.verifier_key_id,
            trust_anchor_der,
        },
    )
}

fn main() {
    let result = parse_arguments()
        .map_err(|error| json!({ "status": "REJECTED", "error": { "trust_edge": "cli", "message": error } }))
        .and_then(|arguments| match run(arguments) {
            Ok(report) => Ok(report),
            Err(error) => Err(error.report()),
        });
    match result {
        Ok(report) => println!(
            "{}",
            serde_json::to_string(&report).expect("verification report must serialize")
        ),
        Err(report) => {
            println!(
                "{}",
                serde_json::to_string(&report).expect("rejection report must serialize")
            );
            process::exit(1);
        }
    }
}
