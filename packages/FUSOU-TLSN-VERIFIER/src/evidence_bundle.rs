use crate::tlsn_alpha15::{
    verify_alpha15_presentation_with_trusted_notary_key_and_trust_anchor,
    RequireInfoDisclosureProfile, SparseRequireInfoDisclosureProfile,
};
use crate::{parse_verifier_result, sha256, VerifierResult};
use crate::sparse_result::SparseVerifierResult;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use k256::PublicKey;
use ring::signature::{UnparsedPublicKey, ED25519};
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, HashSet},
    fmt, fs,
    path::{Component, Path, PathBuf},
};

const EVIDENCE_SCOPE: &str = "tlsn-production-evidence";
const RESULT_REGISTRY_SCOPE: &str = "tlsn-result-signing-key-registry";
const RESULT_REGISTRY_ENVELOPE_SCOPE: &str = "fusou-result-signing-key-registry-envelope";
const RESULT_REGISTRY_ENVELOPE_ALGORITHM: &str = "Ed25519";
const RESULT_REGISTRY_ENVELOPE_SCHEMA_VERSION: u64 = 1;
const RESULT_REGISTRY_ROOT_EDGE: &str = "result-registry-root-authorizes-registry";
const RESULT_REGISTRY_EDGE: &str = "result-registry-authorizes-result-signer";
const RESULT_SIGNATURE_EDGE: &str = "result-is-signed";
const PRESENTATION_NOTARY_EDGE: &str = "presentation-is-authenticated-by-notary";
const SPKI_PREFIX: &[u8] = &[
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];
const ALPHA15_K256_KEY_LENGTH: usize = 42;
const ALPHA15_K256_ALGORITHM_ID: u8 = 1;
const ALPHA15_K256_PUBLIC_KEY_LENGTH: u64 = 33;
const KEY_ID_MAX_LENGTH: usize = 128;
const PRODUCTION_SEMANTIC_SCHEMA_VERSION: u64 = 2;
const PRODUCTION_SEMANTIC_KIND: &str = "tlsn-production-semantic-verification";

#[derive(Debug, Clone)]
pub struct BundleVerifierOptions {
    pub evidence_root_key_id: String,
    pub evidence_root_public_key_spki: String,
    pub trusted_notary_registry_raw: Vec<u8>,
    pub session_authority_registry_raw: Vec<u8>,
    pub session_authority_key_id: String,
    pub session_authority_public_key_spki: String,
    pub binding_authority_registry_raw: Vec<u8>,
    pub binding_authority_key_id: String,
    pub binding_authority_public_key_spki: String,
    pub canonical_user_id: String,
    pub device_id: String,
    pub device_public_key: String,
    pub server_identity: String,
    pub profile_sha256: String,
    pub sparse_profile_sha256: Option<String>,
    pub verifier_key_id: String,
    pub trust_anchor_der: Vec<u8>,
}

enum ParsedVerifierResult {
    Complete(VerifierResult),
    Sparse(SparseVerifierResult),
}

trait EvidenceResultView {
    fn unsigned_canonical_json(&self) -> Result<String>;
    fn signing_bytes(&self) -> Result<Vec<u8>>;
    fn signature(&self) -> &[u8; 64];
    fn profile_sha256(&self) -> &[u8; 32];
    fn canonical_user_id(&self) -> &str;
    fn canonical_device_id(&self) -> &str;
    fn device_challenge(&self) -> &[u8; 32];
    fn verified_member_id(&self) -> &str;
    fn attestation_session_id(&self) -> uuid::Uuid;
    fn binding_nonce(&self) -> &[u8; 32];
    fn binding_value(&self) -> &str;
    fn verifier_key_id(&self) -> &str;
    fn notary_key_id(&self) -> &str;
    fn tlsn_attestation_id(&self) -> &[u8];
    fn server_identity(&self) -> &str;
    fn request_transcript_size(&self) -> u64;
    fn response_transcript_size(&self) -> u64;
    fn revealed_request_ranges(&self) -> &[crate::RevealedRange];
    fn revealed_response_ranges(&self) -> &[crate::RevealedRange];
    fn is_sparse(&self) -> bool;
    fn full_transcript_sha256(&self) -> Option<(&[u8; 32], &[u8; 32])>;
}

impl EvidenceResultView for VerifierResult {
    fn unsigned_canonical_json(&self) -> Result<String> {
        let mut value = self.clone();
        value.signature = [0; 64];
        value.canonical_json().map_err(|error| {
            BundleVerificationError::new("result_evidence_binding", Some("result"), error.to_string())
        })
    }

    fn signing_bytes(&self) -> Result<Vec<u8>> {
        self.signing_bytes().map_err(|error| {
            BundleVerificationError::new("result_signature", Some("result"), error.to_string())
        })
    }

    fn signature(&self) -> &[u8; 64] { &self.signature }
    fn profile_sha256(&self) -> &[u8; 32] { &self.profile_sha256 }
    fn canonical_user_id(&self) -> &str { &self.canonical_user_id }
    fn canonical_device_id(&self) -> &str { &self.canonical_device_id }
    fn device_challenge(&self) -> &[u8; 32] { &self.device_challenge }
    fn verified_member_id(&self) -> &str { &self.verified_member_id }
    fn attestation_session_id(&self) -> uuid::Uuid { self.attestation_session_id }
    fn binding_nonce(&self) -> &[u8; 32] { &self.binding_nonce }
    fn binding_value(&self) -> &str { &self.binding_value }
    fn verifier_key_id(&self) -> &str { &self.verifier_key_id }
    fn notary_key_id(&self) -> &str { &self.notary_key_id }
    fn tlsn_attestation_id(&self) -> &[u8] { &self.tlsn_attestation_id }
    fn server_identity(&self) -> &str { &self.server_identity }
    fn request_transcript_size(&self) -> u64 { self.request_transcript_size }
    fn response_transcript_size(&self) -> u64 { self.response_transcript_size }
    fn revealed_request_ranges(&self) -> &[crate::RevealedRange] { &self.revealed_request_ranges }
    fn revealed_response_ranges(&self) -> &[crate::RevealedRange] { &self.revealed_response_ranges }
    fn is_sparse(&self) -> bool { false }
    fn full_transcript_sha256(&self) -> Option<(&[u8; 32], &[u8; 32])> {
        Some((&self.request_transcript_sha256, &self.response_transcript_sha256))
    }
}

impl EvidenceResultView for SparseVerifierResult {
    fn unsigned_canonical_json(&self) -> Result<String> {
        let mut value = self.clone();
        value.signature = [0; 64];
        value.canonical_json().map_err(|error| {
            BundleVerificationError::new("result_evidence_binding", Some("result"), error.to_string())
        })
    }

    fn signing_bytes(&self) -> Result<Vec<u8>> {
        self.signing_bytes().map_err(|error| {
            BundleVerificationError::new("result_signature", Some("result"), error.to_string())
        })
    }

    fn signature(&self) -> &[u8; 64] { &self.signature }
    fn profile_sha256(&self) -> &[u8; 32] { &self.profile_sha256 }
    fn canonical_user_id(&self) -> &str { &self.canonical_user_id }
    fn canonical_device_id(&self) -> &str { &self.canonical_device_id }
    fn device_challenge(&self) -> &[u8; 32] { &self.device_challenge }
    fn verified_member_id(&self) -> &str { &self.verified_member_id }
    fn attestation_session_id(&self) -> uuid::Uuid { self.attestation_session_id }
    fn binding_nonce(&self) -> &[u8; 32] { &self.binding_nonce }
    fn binding_value(&self) -> &str { &self.binding_value }
    fn verifier_key_id(&self) -> &str { &self.verifier_key_id }
    fn notary_key_id(&self) -> &str { &self.notary_key_id }
    fn tlsn_attestation_id(&self) -> &[u8] { &self.tlsn_attestation_id }
    fn server_identity(&self) -> &str { &self.server_identity }
    fn request_transcript_size(&self) -> u64 { self.request_transcript_size }
    fn response_transcript_size(&self) -> u64 { self.response_transcript_size }
    fn revealed_request_ranges(&self) -> &[crate::RevealedRange] { &self.revealed_request_ranges }
    fn revealed_response_ranges(&self) -> &[crate::RevealedRange] { &self.revealed_response_ranges }
    fn is_sparse(&self) -> bool { true }
    fn full_transcript_sha256(&self) -> Option<(&[u8; 32], &[u8; 32])> { None }
}

impl ParsedVerifierResult {
    fn view(&self) -> &dyn EvidenceResultView {
        match self {
            Self::Complete(result) => result,
            Self::Sparse(result) => result,
        }
    }
}

#[derive(Debug, Clone)]
pub struct BundleVerificationError {
    pub edge: String,
    pub artifact: Option<String>,
    pub message: String,
    pub expected: Option<String>,
    pub actual: Option<String>,
}

impl BundleVerificationError {
    pub fn new(edge: &str, artifact: Option<&str>, message: impl Into<String>) -> Self {
        Self {
            edge: edge.to_owned(),
            artifact: artifact.map(str::to_owned),
            message: message.into(),
            expected: None,
            actual: None,
        }
    }

    fn mismatch(
        edge: &str,
        artifact: Option<&str>,
        message: &str,
        expected: impl Into<String>,
        actual: impl Into<String>,
    ) -> Self {
        Self {
            edge: edge.to_owned(),
            artifact: artifact.map(str::to_owned),
            message: message.to_owned(),
            expected: Some(expected.into()),
            actual: Some(actual.into()),
        }
    }

    pub fn report(&self) -> Value {
        let mut error = Map::new();
        error.insert("trust_edge".to_owned(), Value::String(self.edge.clone()));
        if let Some(artifact) = &self.artifact {
            error.insert("artifact".to_owned(), Value::String(artifact.clone()));
        }
        error.insert("message".to_owned(), Value::String(self.message.clone()));
        if let Some(expected) = &self.expected {
            error.insert("expected".to_owned(), Value::String(expected.clone()));
        }
        if let Some(actual) = &self.actual {
            error.insert("actual".to_owned(), Value::String(actual.clone()));
        }
        serde_json::json!({ "status": "REJECTED", "error": error })
    }
}

impl fmt::Display for BundleVerificationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.edge, self.message)
    }
}

impl std::error::Error for BundleVerificationError {}

type Result<T> = std::result::Result<T, BundleVerificationError>;

struct Artifact {
    bytes: Vec<u8>,
}

struct LoadedBundle {
    manifest_path: PathBuf,
    manifest: Value,
    artifacts: BTreeMap<String, Artifact>,
}

struct RegistryKey {
    key_id: String,
    public_key_spki: String,
    status: String,
    not_before: i128,
    not_after: Option<i128>,
}

struct ResolvedResultKey {
    key_id: String,
    public_key_spki: String,
    status: String,
}

pub fn verify_bundle(
    bundle_path: impl AsRef<Path>,
    options: &BundleVerifierOptions,
) -> Result<Value> {
    let bundle = load_bundle(bundle_path.as_ref())?;
    validate_manifest(&bundle.manifest)?;
    let required_artifact_names = [
        "presentation",
        "result",
        "result_registry",
        "result_registry_envelope",
        "notary_registry",
        "health",
        "session",
        "authenticated_user",
        "device_identity",
        "device_authentication",
        "possession_proof",
        "consume_receipt",
        "replay",
        "session_authority_registry",
        "binding_authority_registry",
        "capture_metadata",
        "semantic_verification",
        "trust_root",
        "subject",
    ];
    for name in required_artifact_names {
        require_artifact(&bundle, name)?;
    }

    let presentation = artifact_bytes(&bundle, "presentation")?;
    let result_bytes = artifact_bytes(&bundle, "result")?;
    let registry_raw = artifact_bytes(&bundle, "result_registry")?;
    let envelope_raw = artifact_bytes(&bundle, "result_registry_envelope")?;
    let bundle_notary_registry_raw = artifact_bytes(&bundle, "notary_registry")?;
    let trust_root = artifact_bytes(&bundle, "trust_root")?;

    if bundle_notary_registry_raw != options.trusted_notary_registry_raw.as_slice() {
        return Err(BundleVerificationError::mismatch(
            "notary_registry",
            Some("notary_registry"),
            "bundle Notary registry is not the externally pinned registry",
            sha256_base64url(&options.trusted_notary_registry_raw),
            sha256_base64url(bundle_notary_registry_raw),
        ));
    }
    if artifact_bytes(&bundle, "session_authority_registry")?
        != options.session_authority_registry_raw.as_slice()
    {
        return Err(BundleVerificationError::mismatch(
            "session_authority_registry",
            Some("session_authority_registry"),
            "bundle Session Authority registry is not the externally pinned registry",
            sha256_base64url(&options.session_authority_registry_raw),
            sha256_base64url(artifact_bytes(&bundle, "session_authority_registry")?),
        ));
    }
    if artifact_bytes(&bundle, "binding_authority_registry")?
        != options.binding_authority_registry_raw.as_slice()
    {
        return Err(BundleVerificationError::mismatch(
            "binding_authority_registry",
            Some("binding_authority_registry"),
            "bundle Binding Authority registry is not the externally pinned registry",
            sha256_base64url(&options.binding_authority_registry_raw),
            sha256_base64url(artifact_bytes(&bundle, "binding_authority_registry")?),
        ));
    }
    if trust_root != options.trust_anchor_der.as_slice() {
        return Err(BundleVerificationError::mismatch(
            "tlsn_trust_anchor",
            Some("trust_root"),
            "bundle origin trust root is not the externally supplied trust anchor",
            sha256_base64url(&options.trust_anchor_der),
            sha256_base64url(trust_root),
        ));
    }

    let registry: Value = parse_json(registry_raw, "result_registry", "result_registry")?;
    let envelope: Value = parse_json(
        envelope_raw,
        "result_registry_envelope",
        "result_registry_root",
    )?;
    let notary_registry: Value =
        parse_json(bundle_notary_registry_raw, "notary_registry", "notary")?;
    let session_authority_registry: Value = parse_json(
        artifact_bytes(&bundle, "session_authority_registry")?,
        "session_authority_registry",
        "session_authority",
    )?;
    let binding_authority_registry: Value = parse_json(
        artifact_bytes(&bundle, "binding_authority_registry")?,
        "binding_authority_registry",
        "binding_authority",
    )?;
    let result = parse_result_profile(result_bytes)?;
    let result_view = result.view();
    let capture_time =
        manifest_string(&bundle.manifest, "capture_finished_at", "result_key_window")?;
    let capture_time = parse_timestamp(capture_time).map_err(|message| {
        BundleVerificationError::new("result_key_window", Some("manifest"), message)
    })?;

    let registry_sha256 = verify_result_registry_root(
        &bundle.manifest,
        &registry,
        registry_raw,
        &envelope,
        envelope_raw,
        &options.evidence_root_key_id,
        &options.evidence_root_public_key_spki,
    )?;
    let registry_keys = validate_result_registry(&registry)?;
    let resolved_key = verify_result_signature(
        &bundle.manifest,
        result_view,
        &registry_keys,
        &registry_sha256,
        capture_time,
    )?;
    validate_authority_registry(
        &session_authority_registry,
        "tlsn-session-authority-key-registry",
        &options.session_authority_key_id,
        &options.session_authority_public_key_spki,
        "session authority",
    )?;
    validate_authority_registry(
        &binding_authority_registry,
        "tlsn-binding-authority-key-registry",
        &options.binding_authority_key_id,
        &options.binding_authority_public_key_spki,
        "binding authority",
    )?;

    let notary_key_id = result_view.notary_key_id();
    let notary_key = validate_notary_registry(&notary_registry, notary_key_id)?;
    let notary_registry_sha256 = sha256_base64url(bundle_notary_registry_raw);
    verify_notary_publication(&bundle.manifest, &notary_registry_sha256, notary_key_id)?;

    let profile_sha256 = if result_view.is_sparse() {
        let encoded = options.sparse_profile_sha256.as_deref().ok_or_else(|| {
            BundleVerificationError::new(
                "require_info_profile",
                Some("options"),
                "sparse profile SHA-256 is not configured",
            )
        })?;
        decode_fixed_base64::<32>(encoded, "sparse profile SHA-256", "require_info")?
    } else {
        decode_fixed_base64::<32>(&options.profile_sha256, "profile SHA-256", "require_info")?
    };
    let transcript = verify_alpha15_presentation_with_trusted_notary_key_and_trust_anchor(
        presentation,
        trust_root,
        &notary_key,
    )
    .map_err(|error| {
        BundleVerificationError::new("tlsn_presentation", Some("presentation"), error.to_string())
    })?;
    let authenticated = if result_view.is_sparse() {
        let profile = SparseRequireInfoDisclosureProfile::from_server_identity(&options.server_identity)
            .map_err(|error| BundleVerificationError::new("tlsn_presentation", Some("presentation"), error.to_string()))?;
        transcript
            .verify_require_info_sparse(&profile, &crate::ParserLimits::default())
            .map_err(|error| BundleVerificationError::new("require_info_profile", Some("presentation"), error.to_string()))?
    } else {
        let profile = RequireInfoDisclosureProfile::from_server_identity(&options.server_identity)
            .map_err(|error| BundleVerificationError::new("tlsn_presentation", Some("presentation"), error.to_string()))?;
        transcript
            .verify_require_info(&profile, &crate::ParserLimits::default())
            .map_err(|error| BundleVerificationError::new("require_info_profile", Some("presentation"), error.to_string()))?
    };
    if result_view.server_identity() != options.server_identity {
        return Err(BundleVerificationError::mismatch(
            "server_identity",
            Some("result"),
            "signed Result server identity does not match the external verifier configuration",
            &options.server_identity,
            result_view.server_identity(),
        ));
    }
    if result_view.profile_sha256() != &profile_sha256
        || result_view.verifier_key_id() != options.verifier_key_id
    {
        return Err(BundleVerificationError::new(
            "result_evidence_binding",
            Some("result"),
            "signed Result verifier profile identity does not match external configuration",
        ));
    }
    let derived_result = if result_view.is_sparse() {
        ParsedVerifierResult::Sparse(SparseVerifierResult::from_authenticated(
            &authenticated,
            profile_sha256,
            result_view.verifier_key_id().to_owned(),
            result_view.notary_key_id().to_owned(),
            sha256(&notary_key),
            sha256(presentation),
            result_view.canonical_user_id().to_owned(),
            result_view.canonical_device_id().to_owned(),
            *result_view.device_challenge(),
            [0; 64],
        ).map_err(|error| BundleVerificationError::new("result_evidence_binding", Some("presentation"), error.to_string()))?)
    } else {
        ParsedVerifierResult::Complete(authenticated.into_verifier_result(
            profile_sha256,
            result_view.verifier_key_id().to_owned(),
            result_view.notary_key_id().to_owned(),
            result_view.canonical_user_id().to_owned(),
            result_view.canonical_device_id().to_owned(),
            *result_view.device_challenge(),
            [0; 64],
        ).map_err(|error| BundleVerificationError::new("result_evidence_binding", Some("presentation"), error.to_string()))?)
    };
    assert_unsigned_result_matches(result_view, derived_result.view())?;
    verify_session_binding(&bundle, result_view)?;
    verify_authority_artifacts(
        &bundle,
        result_view,
        &options.canonical_user_id,
        &options.device_id,
        &options.device_public_key,
        &session_authority_registry,
        &options.session_authority_key_id,
        &options.session_authority_public_key_spki,
        &binding_authority_registry,
        &options.binding_authority_key_id,
        &options.binding_authority_public_key_spki,
    )?;
    verify_semantic_artifact(&bundle, result_view, &notary_key)?;
    verify_capture_metadata(&bundle, presentation)?;
    verify_health_identities(
        &bundle,
        result_view,
        &resolved_key,
        &registry_sha256,
        &sha256_base64url(envelope_raw),
        &envelope,
        &notary_registry_sha256,
        &sha256_base64url(artifact_bytes(&bundle, "session_authority_registry")?),
        &options.session_authority_key_id,
        &options.session_authority_public_key_spki,
        &sha256_base64url(artifact_bytes(&bundle, "binding_authority_registry")?),
        &options.binding_authority_key_id,
        &options.binding_authority_public_key_spki,
    )?;
    verify_subject_artifact(&bundle, result_view)?;
    verify_trust_graph(
        &bundle,
        result_view,
        &resolved_key,
        &registry_sha256,
        &notary_key_id,
        &options.evidence_root_key_id,
        &options.evidence_root_public_key_spki,
    )?;

    let report = serde_json::json!({
        "status": "VERIFIED",
        "verification": "FUSOU_TLSN_EVIDENCE_BUNDLE",
        "bundle_manifest": bundle.manifest_path.display().to_string(),
        "trust": {
            "evidence_root": "VERIFIED",
            "result_registry": "VERIFIED",
            "result_signature": "VERIFIED",
            "result_evidence_binding": "VERIFIED",
            "tlsn_presentation": "VERIFIED",
            "notary": "VERIFIED",
            "artifact_manifest": "VERIFIED",
        },
        "derived": {
            "result_signer_key_id": resolved_key.key_id,
            "result_signing_key_status": resolved_key.status,
            "result_key_registry_sha256": registry_sha256,
            "result_key_registry_envelope_sha256": sha256_base64url(envelope_raw),
            "result_registry_root_key_id": object_string(&envelope, "root_key_id", "result_registry_root", "result_registry_envelope")?,
            "notary_key_id": notary_key_id,
            "notary_key_sha256": sha256_base64url(&notary_key),
            "tlsn_attestation_id": URL_SAFE_NO_PAD.encode(result_view.tlsn_attestation_id()),
            "verified_member_id": result_view.verified_member_id(),
            "server_identity": result_view.server_identity(),
        },
    });
    let mut report = report;
    if let Some((request_digest, response_digest)) = result_view.full_transcript_sha256() {
        report["derived"]["request_transcript_sha256"] =
            Value::String(URL_SAFE_NO_PAD.encode(request_digest));
        report["derived"]["response_transcript_sha256"] =
            Value::String(URL_SAFE_NO_PAD.encode(response_digest));
    } else {
        report["derived"]["disclosure_mode"] = Value::String("sparse".to_owned());
    }
    Ok(report)
}

fn parse_result_profile(input: &[u8]) -> Result<ParsedVerifierResult> {
    match parse_verifier_result(input, &crate::ParserLimits::default()) {
        Ok(result) => Ok(ParsedVerifierResult::Complete(result)),
        Err(complete_error) => match crate::sparse_result::parse_sparse_verifier_result(
            input,
            &crate::ParserLimits::default(),
        ) {
            Ok(result) => Ok(ParsedVerifierResult::Sparse(result)),
            Err(sparse_error) => Err(BundleVerificationError::new(
                "result_signature",
                Some("result"),
                format!("unsupported Result profile: complete={complete_error}; sparse={sparse_error}"),
            )),
        },
    }
}

fn load_bundle(bundle_path: &Path) -> Result<LoadedBundle> {
    let (manifest_path, root) = if bundle_path.is_dir() {
        let candidates = [
            "tlsn-production-evidence.json",
            "manifest.json",
            "evidence-manifest.json",
        ];
        let manifest_path = candidates
            .iter()
            .map(|name| bundle_path.join(name))
            .find(|path| path.is_file())
            .ok_or_else(|| {
                BundleVerificationError::new(
                    "bundle_manifest",
                    None,
                    "bundle directory has no evidence manifest",
                )
            })?;
        (manifest_path, bundle_path.to_path_buf())
    } else {
        let root = bundle_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf();
        (bundle_path.to_path_buf(), root)
    };
    let manifest_raw = fs::read(&manifest_path).map_err(|error| {
        BundleVerificationError::new(
            "bundle_manifest",
            Some("manifest"),
            format!("read failed: {error}"),
        )
    })?;
    let manifest = parse_json(&manifest_raw, "manifest", "bundle_manifest")?;
    let descriptors = manifest
        .get("artifacts")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "artifact_manifest",
                Some("manifest"),
                "manifest artifacts are missing",
            )
        })?;
    let canonical_root = fs::canonicalize(&root).map_err(|error| {
        BundleVerificationError::new(
            "artifact_manifest",
            Some("manifest"),
            format!("bundle root is invalid: {error}"),
        )
    })?;
    let mut artifacts = BTreeMap::new();
    for (name, descriptor) in descriptors {
        let path = descriptor
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                BundleVerificationError::new(
                    "artifact_manifest",
                    Some(name),
                    "artifact path is missing",
                )
            })?;
        let relative_path = Path::new(path);
        if relative_path.is_absolute()
            || relative_path.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(BundleVerificationError::new(
                "artifact_manifest",
                Some(name),
                "artifact path must be relative and cannot contain parent traversal",
            ));
        }
        let path = root.join(relative_path);
        let canonical_path = fs::canonicalize(&path).map_err(|error| {
            BundleVerificationError::new(
                "artifact_manifest",
                Some(name),
                format!("read path failed: {error}"),
            )
        })?;
        if !canonical_path.starts_with(&canonical_root) {
            return Err(BundleVerificationError::new(
                "artifact_manifest",
                Some(name),
                "artifact path escapes the bundle directory",
            ));
        }
        let bytes = fs::read(&canonical_path).map_err(|error| {
            BundleVerificationError::new(
                "artifact_manifest",
                Some(name),
                format!("read failed: {error}"),
            )
        })?;
        let expected_hash = descriptor
            .get("artifact_sha256")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                BundleVerificationError::new(
                    "artifact_manifest",
                    Some(name),
                    "artifact hash is missing",
                )
            })?;
        let actual_hash = sha256_base64url(&bytes);
        if expected_hash != actual_hash {
            return Err(BundleVerificationError::mismatch(
                "artifact_manifest",
                Some(name),
                "artifact SHA-256 does not match the manifest",
                expected_hash,
                actual_hash,
            ));
        }
        let expected_length = descriptor
            .get("byte_length")
            .and_then(Value::as_u64)
            .ok_or_else(|| {
                BundleVerificationError::new(
                    "artifact_manifest",
                    Some(name),
                    "artifact byte_length is missing",
                )
            })?;
        if expected_length != bytes.len() as u64 {
            return Err(BundleVerificationError::mismatch(
                "artifact_manifest",
                Some(name),
                "artifact byte length does not match the manifest",
                expected_length.to_string(),
                bytes.len().to_string(),
            ));
        }
        artifacts.insert(name.clone(), Artifact { bytes });
    }
    Ok(LoadedBundle {
        manifest_path,
        manifest,
        artifacts,
    })
}

fn validate_manifest(manifest: &Value) -> Result<()> {
    if manifest.get("schema_version").and_then(Value::as_u64) != Some(1)
        || manifest.get("scope").and_then(Value::as_str) != Some(EVIDENCE_SCOPE)
        || manifest.get("status").and_then(Value::as_str) != Some("BLOCKED")
        || manifest.get("capture_status").and_then(Value::as_str) != Some("PASS")
        || manifest.get("verification_status").and_then(Value::as_str) != Some("VERIFIED")
        || manifest.get("capture_provenance").and_then(Value::as_str) != Some("production")
        || manifest
            .get("production_evidence_status")
            .and_then(Value::as_str)
            != Some("BLOCKED")
        || manifest.get("p0_05_status").and_then(Value::as_str) != Some("BLOCKED")
    {
        return Err(BundleVerificationError::new(
            "artifact_manifest",
            Some("manifest"),
            "manifest is not a completed production capture contract",
        ));
    }
    let started = manifest_string(manifest, "capture_started_at", "artifact_manifest")?;
    let finished = manifest_string(manifest, "capture_finished_at", "artifact_manifest")?;
    if parse_timestamp(started).is_err()
        || parse_timestamp(finished).is_err()
        || parse_timestamp(finished).unwrap() < parse_timestamp(started).unwrap()
    {
        return Err(BundleVerificationError::new(
            "artifact_manifest",
            Some("manifest"),
            "capture window is invalid",
        ));
    }
    let artifacts = manifest
        .get("artifacts")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "artifact_manifest",
                Some("manifest"),
                "manifest artifacts are missing",
            )
        })?;
    for (name, descriptor) in artifacts {
        if descriptor.get("provenance").and_then(Value::as_str) != Some("production") {
            return Err(BundleVerificationError::new(
                "artifact_manifest",
                Some(name),
                "artifact provenance is not production",
            ));
        }
    }
    let evidence = manifest
        .get("evidence")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "evidence_contract",
                Some("manifest"),
                "production evidence items are missing",
            )
        })?;
    for requirement in [
        "real_production_game_server_connection",
        "real_production_tlsn_notary_interaction",
        "real_production_tlsn_proxy_provenance",
        "real_production_fusou_web_device_authentication",
        "real_production_device_possession_proof",
        "real_production_replay_authority",
        "real_production_binding_authority",
        "real_production_session_authority",
        "real_production_binding_receipt_authority",
        "real_production_verifier_trust_root",
        "real_production_result_signing_key",
        "real_production_result_registry_authentication",
        "real_production_public_key_publication",
        "independently_captured_production_evidence",
    ] {
        let item = evidence.get(requirement).ok_or_else(|| {
            BundleVerificationError::new(
                "evidence_contract",
                Some("manifest"),
                format!("production evidence item is missing: {requirement}"),
            )
        })?;
        let status = item.get("status").and_then(Value::as_str);
        if status != Some("PASS")
            && !(requirement == "real_production_tlsn_proxy_provenance"
                && status == Some("UNVERIFIED"))
        {
            return Err(BundleVerificationError::new(
                "evidence_contract",
                Some("manifest"),
                format!("production evidence item is not independently passed: {requirement}"),
            ));
        }
        let required_artifacts = item
            .get("required_artifacts")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                BundleVerificationError::new(
                    "evidence_contract",
                    Some("manifest"),
                    format!("production evidence artifact dependencies are missing: {requirement}"),
                )
            })?;
        for artifact in required_artifacts {
            let artifact = artifact.as_str().ok_or_else(|| {
                BundleVerificationError::new(
                    "evidence_contract",
                    Some("manifest"),
                    format!("production evidence artifact dependency is invalid: {requirement}"),
                )
            })?;
            if !artifacts.contains_key(artifact) {
                return Err(BundleVerificationError::new(
                    "evidence_contract",
                    Some("manifest"),
                    format!(
                        "production evidence item is missing an artifact: {requirement}/{artifact}"
                    ),
                ));
            }
        }
    }
    verify_predicate_statuses(
        manifest,
        "semantic_predicates",
        &[
            "presentation_cryptography",
            "notary_identity",
            "server_identity",
            "require_info_http_profile",
            "presentation_binding_to_session",
            "authenticated_member_id",
            "result_presentation_binding",
            "result_registry_root_authentication",
            "result_signature",
            "result_key_publication",
            "trust_root_publication",
        ],
        false,
    )?;
    verify_predicate_statuses(
        manifest,
        "device_predicates",
        &[
            "device_identity_ownership",
            "device_authentication_signature",
            "session_binding_receipt",
            "tlsn_device_possession_signature",
            "binding_framing",
            "replay_digest",
            "consume_receipt",
        ],
        false,
    )?;
    verify_predicate_statuses(
        manifest,
        "capture_predicates",
        &["proxy_provenance_cryptographic_authentication"],
        true,
    )?;
    Ok(())
}

fn verify_predicate_statuses(
    manifest: &Value,
    field: &str,
    names: &[&str],
    allow_unverified: bool,
) -> Result<()> {
    let predicates = manifest
        .get(field)
        .and_then(Value::as_object)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "evidence_contract",
                Some("manifest"),
                format!("{field} are missing"),
            )
        })?;
    for name in names {
        let status = predicates
            .get(*name)
            .and_then(|predicate| predicate.get("status"))
            .and_then(Value::as_str);
        if status != Some("PASS") && !(allow_unverified && status == Some("UNVERIFIED")) {
            return Err(BundleVerificationError::new(
                "evidence_contract",
                Some("manifest"),
                format!("{field} predicate is not passed: {name}"),
            ));
        }
    }
    Ok(())
}

fn require_artifact<'a>(bundle: &'a LoadedBundle, name: &str) -> Result<&'a [u8]> {
    bundle
        .artifacts
        .get(name)
        .map(|artifact| artifact.bytes.as_slice())
        .ok_or_else(|| {
            BundleVerificationError::new(
                "artifact_manifest",
                Some(name),
                "required artifact is missing",
            )
        })
}

fn artifact_bytes<'a>(bundle: &'a LoadedBundle, name: &str) -> Result<&'a [u8]> {
    require_artifact(bundle, name)
}

fn parse_json(bytes: &[u8], label: &str, edge: &str) -> Result<Value> {
    serde_json::from_slice(bytes).map_err(|error| {
        BundleVerificationError::new(edge, Some(label), format!("invalid JSON: {error}"))
    })
}

fn manifest_string<'a>(manifest: &'a Value, field: &str, edge: &str) -> Result<&'a str> {
    manifest.get(field).and_then(Value::as_str).ok_or_else(|| {
        BundleVerificationError::new(
            edge,
            Some("manifest"),
            format!("manifest field is missing: {field}"),
        )
    })
}

fn object_string<'a>(value: &'a Value, key: &str, edge: &str, artifact: &str) -> Result<&'a str> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            BundleVerificationError::new(
                edge,
                Some(artifact),
                format!("object field is missing: {key}"),
            )
        })
}

fn decode_base64(value: &str, label: &str, edge: &str) -> Result<Vec<u8>> {
    crate::decode_strict_base64url(value)
        .map_err(|error| BundleVerificationError::new(edge, None, format!("{label}: {error}")))
}

fn decode_fixed_base64<const N: usize>(value: &str, label: &str, edge: &str) -> Result<[u8; N]> {
    let bytes = decode_base64(value, label, edge)?;
    bytes.try_into().map_err(|_| {
        BundleVerificationError::new(
            edge,
            None,
            format!("{label} must decode to exactly {N} bytes"),
        )
    })
}

fn sha256_base64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(sha256(bytes))
}

fn ed25519_public_key(spki: &str, edge: &str) -> Result<Vec<u8>> {
    let bytes = decode_base64(spki, "Ed25519 SPKI", edge)?;
    if bytes.len() != SPKI_PREFIX.len() + 32 || !bytes.starts_with(SPKI_PREFIX) {
        return Err(BundleVerificationError::new(
            edge,
            None,
            "invalid Ed25519 SPKI DER",
        ));
    }
    Ok(bytes[SPKI_PREFIX.len()..].to_vec())
}

fn verify_ed25519(
    spki: &str,
    message: &[u8],
    signature: &[u8],
    edge: &str,
    artifact: &str,
) -> Result<()> {
    let raw_key = ed25519_public_key(spki, edge)?;
    UnparsedPublicKey::new(&ED25519, raw_key)
        .verify(message, signature)
        .map_err(|_| {
            BundleVerificationError::new(edge, Some(artifact), "Ed25519 signature is invalid")
        })
}

fn canonical_json(value: &Value) -> Result<String> {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            serde_json::to_string(value).map_err(|error| {
                BundleVerificationError::new("result_registry_root", None, error.to_string())
            })
        }
        Value::Array(values) => Ok(format!(
            "[{}]",
            values
                .iter()
                .map(canonical_json)
                .collect::<Result<Vec<_>>>()?
                .join(",")
        )),
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            let mut fields = Vec::with_capacity(keys.len());
            for key in keys {
                fields.push(format!(
                    "{}:{}",
                    serde_json::to_string(key).map_err(|error| BundleVerificationError::new(
                        "result_registry_root",
                        None,
                        error.to_string()
                    ))?,
                    canonical_json(object.get(key).expect("object key collected from object"))?
                ));
            }
            Ok(format!("{{{}}}", fields.join(",")))
        }
    }
}

fn envelope_payload(envelope: &Value) -> Result<Value> {
    let object = envelope.as_object().ok_or_else(|| {
        BundleVerificationError::new(
            "result_registry_root",
            Some("result_registry_envelope"),
            "envelope is not an object",
        )
    })?;
    let fields = [
        "schema_version",
        "scope",
        "signature_algorithm",
        "root_key_id",
        "root_public_key_spki",
        "registry_sha256",
        "registry",
    ];
    let mut payload = Map::new();
    for field in fields {
        let value = object.get(field).ok_or_else(|| {
            BundleVerificationError::new(
                "result_registry_root",
                Some("result_registry_envelope"),
                format!("envelope field is missing: {field}"),
            )
        })?;
        payload.insert(field.to_owned(), value.clone());
    }
    Ok(Value::Object(payload))
}

fn verify_result_registry_root(
    manifest: &Value,
    registry: &Value,
    registry_raw: &[u8],
    envelope: &Value,
    envelope_raw: &[u8],
    trusted_root_key_id: &str,
    trusted_root_spki: &str,
) -> Result<String> {
    if envelope.get("schema_version").and_then(Value::as_u64)
        != Some(RESULT_REGISTRY_ENVELOPE_SCHEMA_VERSION)
        || envelope.get("scope").and_then(Value::as_str) != Some(RESULT_REGISTRY_ENVELOPE_SCOPE)
        || envelope.get("signature_algorithm").and_then(Value::as_str)
            != Some(RESULT_REGISTRY_ENVELOPE_ALGORITHM)
    {
        return Err(BundleVerificationError::new(
            "result_registry_root",
            Some("result_registry_envelope"),
            "Result registry envelope schema is invalid",
        ));
    }
    let root_key_id = object_string(
        envelope,
        "root_key_id",
        "result_registry_root",
        "result_registry_envelope",
    )?;
    let root_public_key_spki = object_string(
        envelope,
        "root_public_key_spki",
        "result_registry_root",
        "result_registry_envelope",
    )?;
    if root_key_id != trusted_root_key_id {
        return Err(BundleVerificationError::mismatch(
            "result_registry_root",
            Some("result_registry_envelope"),
            "bundle Root key ID does not match the external trust anchor",
            trusted_root_key_id,
            root_key_id,
        ));
    }
    if root_public_key_spki != trusted_root_spki {
        return Err(BundleVerificationError::mismatch(
            "result_registry_root",
            Some("result_registry_envelope"),
            "bundle Root public key does not match the external trust anchor",
            trusted_root_spki,
            root_public_key_spki,
        ));
    }
    let registry_sha256 = sha256_base64url(registry_raw);
    if object_string(
        envelope,
        "registry_sha256",
        "result_registry_root",
        "result_registry_envelope",
    )? != registry_sha256
    {
        return Err(BundleVerificationError::mismatch(
            "result_registry_root",
            Some("result_registry"),
            "registry raw SHA-256 does not match the signed envelope",
            registry_sha256.clone(),
            object_string(
                envelope,
                "registry_sha256",
                "result_registry_root",
                "result_registry_envelope",
            )?,
        ));
    }
    let embedded_registry = envelope.get("registry").ok_or_else(|| {
        BundleVerificationError::new(
            "result_registry_root",
            Some("result_registry_envelope"),
            "envelope registry is missing",
        )
    })?;
    if canonical_json(embedded_registry)? != canonical_json(registry)? {
        return Err(BundleVerificationError::new(
            "result_registry_root",
            Some("result_registry"),
            "envelope registry object does not match the captured registry",
        ));
    }
    let signature = decode_base64(
        object_string(
            envelope,
            "signature_base64url",
            "result_registry_root",
            "result_registry_envelope",
        )?,
        "Result registry envelope signature",
        "result_registry_root",
    )?;
    let payload = canonical_json(&envelope_payload(envelope)?)?;
    verify_ed25519(
        trusted_root_spki,
        payload.as_bytes(),
        &signature,
        "result_registry_root",
        "result_registry_envelope",
    )?;
    if sha256_base64url(envelope_raw) != artifact_hash(manifest, "result_registry_envelope")? {
        return Err(BundleVerificationError::new(
            "artifact_manifest",
            Some("result_registry_envelope"),
            "envelope artifact hash is inconsistent with its descriptor",
        ));
    }
    let identity = manifest.get("result_identity").ok_or_else(|| {
        BundleVerificationError::new(
            "result_registry_root",
            Some("manifest"),
            "result identity is missing",
        )
    })?;
    for (field, expected) in [
        ("result_key_registry_sha256", registry_sha256.as_str()),
        (
            "result_key_registry_envelope_sha256",
            sha256_base64url(envelope_raw).as_str(),
        ),
        ("result_registry_root_key_id", root_key_id),
        ("result_registry_root_public_key_spki", trusted_root_spki),
    ] {
        if identity.get(field).and_then(Value::as_str) != Some(expected) {
            return Err(BundleVerificationError::mismatch(
                "result_registry_root",
                Some("manifest"),
                "manifest Result Root identity does not match the authenticated envelope",
                expected,
                identity
                    .get(field)
                    .and_then(Value::as_str)
                    .unwrap_or("<missing>"),
            ));
        }
    }
    Ok(registry_sha256)
}

fn artifact_hash(manifest: &Value, name: &str) -> Result<String> {
    manifest
        .get("artifacts")
        .and_then(Value::as_object)
        .and_then(|artifacts| artifacts.get(name))
        .and_then(|artifact| artifact.get("artifact_sha256"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "artifact_manifest",
                Some(name),
                "artifact hash is missing",
            )
        })
}

fn validate_result_registry(registry: &Value) -> Result<Vec<RegistryKey>> {
    if registry.get("schema_version").and_then(Value::as_u64) != Some(1)
        || registry.get("scope").and_then(Value::as_str) != Some(RESULT_REGISTRY_SCOPE)
    {
        return Err(BundleVerificationError::new(
            "result_registry",
            Some("result_registry"),
            "Result registry schema is invalid",
        ));
    }
    let keys = registry
        .get("keys")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "result_registry",
                Some("result_registry"),
                "Result registry keys are missing",
            )
        })?;
    if keys.is_empty() {
        return Err(BundleVerificationError::new(
            "result_registry",
            Some("result_registry"),
            "Result registry is empty",
        ));
    }
    let mut seen = HashSet::new();
    let mut result = Vec::with_capacity(keys.len());
    for key in keys {
        let key_id = object_string(key, "key_id", "result_registry", "result_registry")?;
        if key_id.is_empty()
            || key_id.len() > KEY_ID_MAX_LENGTH
            || !key_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
            || !seen.insert(key_id.to_owned())
        {
            return Err(BundleVerificationError::new(
                "result_registry",
                Some("result_registry"),
                "Result registry key ID is invalid or duplicated",
            ));
        }
        let public_key_spki =
            object_string(key, "public_key_spki", "result_registry", "result_registry")?;
        ed25519_public_key(public_key_spki, "result_registry")?;
        let status = object_string(key, "status", "result_registry", "result_registry")?;
        if !matches!(status, "ACTIVE" | "VERIFY_ONLY" | "RETIRED" | "REVOKED") {
            return Err(BundleVerificationError::new(
                "result_registry",
                Some("result_registry"),
                "Result registry key status is invalid",
            ));
        }
        let not_before = parse_timestamp(object_string(
            key,
            "not_before",
            "result_registry",
            "result_registry",
        )?)
        .map_err(|message| {
            BundleVerificationError::new("result_registry", Some("result_registry"), message)
        })?;
        let not_after = match key.get("not_after") {
            Some(Value::Null) | None => None,
            Some(Value::String(value)) => Some(parse_timestamp(value).map_err(|message| {
                BundleVerificationError::new("result_registry", Some("result_registry"), message)
            })?),
            _ => {
                return Err(BundleVerificationError::new(
                    "result_registry",
                    Some("result_registry"),
                    "Result registry not_after is invalid",
                ))
            }
        };
        if let Some(not_after) = not_after {
            if not_after <= not_before {
                return Err(BundleVerificationError::new(
                    "result_registry",
                    Some("result_registry"),
                    "Result registry validity window is invalid",
                ));
            }
        }
        result.push(RegistryKey {
            key_id: key_id.to_owned(),
            public_key_spki: public_key_spki.to_owned(),
            status: status.to_owned(),
            not_before,
            not_after,
        });
    }
    Ok(result)
}

fn verify_result_signature(
    manifest: &Value,
    result: &dyn EvidenceResultView,
    keys: &[RegistryKey],
    registry_sha256: &str,
    capture_time: i128,
) -> Result<ResolvedResultKey> {
    let expected_registry_hash = manifest
        .get("result_identity")
        .and_then(|identity| identity.get("result_key_registry_sha256"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "result_signature",
                Some("manifest"),
                "Result registry identity is missing",
            )
        })?;
    if expected_registry_hash != registry_sha256 {
        return Err(BundleVerificationError::mismatch(
            "result_signature",
            Some("manifest"),
            "Result registry hash mismatch",
            registry_sha256,
            expected_registry_hash,
        ));
    }
    let signing_bytes = result.signing_bytes()?;
    let mut valid = Vec::new();
    let mut revoked_match = false;
    for key in keys {
        let matches_signature = verify_ed25519(
            &key.public_key_spki,
            &signing_bytes,
            result.signature(),
            "result_signature",
            "result",
        )
        .is_ok();
        if !matches_signature {
            continue;
        }
        if key.status == "REVOKED" {
            revoked_match = true;
            continue;
        }
        if capture_time < key.not_before
            || key
                .not_after
                .is_some_and(|not_after| capture_time > not_after)
        {
            continue;
        }
        valid.push(key);
    }
    if revoked_match {
        return Err(BundleVerificationError::new(
            "result_signature",
            Some("result"),
            "Result signature matches a revoked registry key",
        ));
    }
    if valid.len() != 1 {
        return Err(BundleVerificationError::new(
            "result_signature",
            Some("result"),
            "Result signature does not resolve to exactly one valid registry key",
        ));
    }
    let key = valid[0];
    let manifest_key_id = manifest
        .get("result_identity")
        .and_then(|identity| identity.get("result_signer_key_id"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "result_signature",
                Some("manifest"),
                "Result signer key ID is missing",
            )
        })?;
    if manifest_key_id != key.key_id {
        return Err(BundleVerificationError::mismatch(
            "result_signature",
            Some("manifest"),
            "manifest signer key ID does not match the cryptographically resolved key",
            key.key_id.as_str(),
            manifest_key_id,
        ));
    }
    let manifest_public_key = manifest
        .get("result_identity")
        .and_then(|identity| identity.get("result_public_key_spki"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "result_signature",
                Some("manifest"),
                "Result public key is missing",
            )
        })?;
    if manifest_public_key != key.public_key_spki {
        return Err(BundleVerificationError::mismatch(
            "result_signature",
            Some("manifest"),
            "manifest Result public key does not match the registry key",
            key.public_key_spki.as_str(),
            manifest_public_key,
        ));
    }
    Ok(ResolvedResultKey {
        key_id: key.key_id.clone(),
        public_key_spki: key.public_key_spki.clone(),
        status: key.status.clone(),
    })
}

fn verify_notary_publication(
    manifest: &Value,
    registry_sha256: &str,
    notary_key_id: &str,
) -> Result<()> {
    let expected = manifest
        .get("security_identity")
        .and_then(|identity| identity.get("notary_registry_sha256"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "notary",
                Some("manifest"),
                "Notary registry hash is missing",
            )
        })?;
    if expected != registry_sha256 {
        return Err(BundleVerificationError::mismatch(
            "notary",
            Some("notary_registry"),
            "Notary registry hash does not match the manifest",
            expected,
            registry_sha256,
        ));
    }
    let expected_key_id = manifest
        .get("security_identity")
        .and_then(|identity| identity.get("notary_key_id"))
        .and_then(Value::as_str)
        .ok_or_else(|| {
            BundleVerificationError::new("notary", Some("manifest"), "Notary key ID is missing")
        })?;
    if expected_key_id != notary_key_id {
        return Err(BundleVerificationError::mismatch(
            "notary",
            Some("manifest"),
            "Result Notary key ID does not match the manifest",
            expected_key_id,
            notary_key_id,
        ));
    }
    Ok(())
}

fn validate_notary_registry(registry: &Value, key_id: &str) -> Result<Vec<u8>> {
    let object = registry.as_object().ok_or_else(|| {
        BundleVerificationError::new(
            "notary_registry",
            Some("notary_registry"),
            "Notary registry must be a JSON object",
        )
    })?;
    if object.is_empty() {
        return Err(BundleVerificationError::new(
            "notary_registry",
            Some("notary_registry"),
            "Notary registry must contain at least one key",
        ));
    }
    for (entry_key_id, value) in object {
        if !is_key_id(entry_key_id) {
            return Err(BundleVerificationError::new(
                "notary_registry",
                Some("notary_registry"),
                "Notary registry contains an invalid key ID",
            ));
        }
        let encoded = value.as_str().ok_or_else(|| {
            BundleVerificationError::new(
                "notary_registry",
                Some("notary_registry"),
                "Notary registry key value must be a string",
            )
        })?;
        let bytes = decode_base64(encoded, "Notary verifying key", "notary_registry")?;
        validate_alpha15_notary_key(&bytes)?;
    }
    let encoded = object.get(key_id).and_then(Value::as_str).ok_or_else(|| {
        BundleVerificationError::new(
            "notary",
            Some("notary_registry"),
            "Result Notary key ID is not present in the externally pinned registry",
        )
    })?;
    decode_base64(encoded, "Notary verifying key", "notary")
}

fn validate_alpha15_notary_key(bytes: &[u8]) -> Result<()> {
    if bytes.len() != ALPHA15_K256_KEY_LENGTH
        || bytes[0] != ALPHA15_K256_ALGORITHM_ID
        || u64::from_le_bytes(bytes[1..9].try_into().expect("checked key length"))
            != ALPHA15_K256_PUBLIC_KEY_LENGTH
        || !matches!(bytes[9], 0x02 | 0x03)
    {
        return Err(BundleVerificationError::new(
            "notary_registry",
            Some("notary_registry"),
            "Notary key is not a TLSNotary alpha.15 K256 bincode verifying key",
        ));
    }
    PublicKey::from_sec1_bytes(&bytes[9..]).map_err(|_| {
        BundleVerificationError::new(
            "notary_registry",
            Some("notary_registry"),
            "Notary key is not a valid compressed secp256k1 public key",
        )
    })?;
    Ok(())
}

fn is_key_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= KEY_ID_MAX_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn assert_unsigned_result_matches(
    actual: &dyn EvidenceResultView,
    expected: &dyn EvidenceResultView,
) -> Result<()> {
    let actual_json = actual.unsigned_canonical_json()?;
    let expected_json = expected.unsigned_canonical_json()?;
    if actual_json != expected_json {
        return Err(BundleVerificationError::new(
            "result_evidence_binding",
            Some("result"),
            "signed Result fields do not match the independently derived Presentation Result",
        ));
    }
    Ok(())
}

fn verify_session_binding(bundle: &LoadedBundle, result: &dyn EvidenceResultView) -> Result<()> {
    let session = parse_json(
        artifact_bytes(bundle, "session")?,
        "session",
        "result_evidence_binding",
    )?;
    for (field, expected) in [
        ("session_id", result.attestation_session_id().to_string()),
        ("device_id", result.canonical_device_id().to_owned()),
        ("binding", result.binding_value().to_owned()),
        (
            "device_challenge",
            URL_SAFE_NO_PAD.encode(result.device_challenge()),
        ),
        ("challenge", URL_SAFE_NO_PAD.encode(result.binding_nonce())),
    ] {
        if session.get(field).and_then(Value::as_str) != Some(expected.as_str()) {
            return Err(BundleVerificationError::mismatch(
                "result_evidence_binding",
                Some("session"),
                &format!("session field does not match the signed Result: {field}"),
                expected,
                session
                    .get(field)
                    .and_then(Value::as_str)
                    .unwrap_or("<missing>"),
            ));
        }
    }
    Ok(())
}

fn validate_authority_registry(
    registry: &Value,
    expected_scope: &str,
    expected_key_id: &str,
    expected_public_key_spki: &str,
    label: &str,
) -> Result<()> {
    if registry.get("schema_version").and_then(Value::as_u64) != Some(1)
        || registry.get("scope").and_then(Value::as_str) != Some(expected_scope)
    {
        return Err(BundleVerificationError::new(
            "authority_registry",
            Some(label),
            format!("{label} registry schema is invalid"),
        ));
    }
    let keys = registry
        .get("keys")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "authority_registry",
                Some(label),
                format!("{label} registry keys are missing"),
            )
        })?;
    let mut seen = HashSet::new();
    let mut expected_key_found = false;
    for key in keys {
        let key_id = object_string(key, "key_id", "authority_registry", label)?;
        if !is_key_id(key_id) || !seen.insert(key_id.to_owned()) {
            return Err(BundleVerificationError::new(
                "authority_registry",
                Some(label),
                format!("{label} registry key ID is invalid or duplicated"),
            ));
        }
        let public_key_spki = object_string(key, "public_key_spki", "authority_registry", label)?;
        ed25519_public_key(public_key_spki, "authority registry public key")?;
        let status = object_string(key, "status", "authority_registry", label)?;
        if !matches!(status, "ACTIVE" | "VERIFY_ONLY" | "RETIRED" | "REVOKED") {
            return Err(BundleVerificationError::new(
                "authority_registry",
                Some(label),
                format!("{label} registry key status is invalid"),
            ));
        }
        let not_before = object_string(key, "not_before", "authority_registry", label)?;
        parse_timestamp(not_before).map_err(|message| {
            BundleVerificationError::new("authority_registry", Some(label), message)
        })?;
        if let Some(not_after) = key.get("not_after") {
            if !not_after.is_null() {
                let not_after = not_after.as_str().ok_or_else(|| {
                    BundleVerificationError::new(
                        "authority_registry",
                        Some(label),
                        format!("{label} registry not_after is invalid"),
                    )
                })?;
                let not_after_value = parse_timestamp(not_after).map_err(|message| {
                    BundleVerificationError::new("authority_registry", Some(label), message)
                })?;
                if not_after_value
                    <= parse_timestamp(not_before).map_err(|message| {
                        BundleVerificationError::new("authority_registry", Some(label), message)
                    })?
                {
                    return Err(BundleVerificationError::new(
                        "authority_registry",
                        Some(label),
                        format!("{label} registry validity window is invalid"),
                    ));
                }
            }
        }
        if key_id == expected_key_id {
            expected_key_found = true;
            if public_key_spki != expected_public_key_spki {
                return Err(BundleVerificationError::mismatch(
                    "authority_registry",
                    Some(label),
                    &format!("{label} external public key does not match the registry"),
                    expected_public_key_spki,
                    public_key_spki,
                ));
            }
        }
    }
    if !expected_key_found {
        return Err(BundleVerificationError::new(
            "authority_registry",
            Some(label),
            format!("{label} external key ID is not present in the registry"),
        ));
    }
    Ok(())
}

fn resolve_authority_key(registry: &Value, key_id: &str, at: &str, label: &str) -> Result<String> {
    let at = parse_timestamp(at).map_err(|message| {
        BundleVerificationError::new("authority_receipt", Some(label), message)
    })?;
    let keys = registry
        .get("keys")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "authority_receipt",
                Some(label),
                format!("{label} registry keys are missing"),
            )
        })?;
    let key = keys
        .iter()
        .find(|key| key.get("key_id").and_then(Value::as_str) == Some(key_id))
        .ok_or_else(|| {
            BundleVerificationError::new(
                "authority_receipt",
                Some(label),
                format!("{label} receipt signer key is not published"),
            )
        })?;
    if key.get("status").and_then(Value::as_str) == Some("REVOKED") {
        return Err(BundleVerificationError::new(
            "authority_receipt",
            Some(label),
            format!("{label} receipt signer key is revoked"),
        ));
    }
    let not_before = parse_timestamp(object_string(
        key,
        "not_before",
        "authority_receipt",
        label,
    )?)
    .map_err(|message| BundleVerificationError::new("authority_receipt", Some(label), message))?;
    let not_after = match key.get("not_after") {
        Some(Value::String(value)) => Some(parse_timestamp(value).map_err(|message| {
            BundleVerificationError::new("authority_receipt", Some(label), message)
        })?),
        _ => None,
    };
    if at < not_before || not_after.is_some_and(|value| at > value) {
        return Err(BundleVerificationError::new(
            "authority_receipt",
            Some(label),
            format!("{label} receipt signer key is outside its validity window"),
        ));
    }
    Ok(object_string(key, "public_key_spki", "authority_receipt", label)?.to_owned())
}

fn verify_authority_artifacts(
    bundle: &LoadedBundle,
    result: &dyn EvidenceResultView,
    canonical_user_id: &str,
    device_id: &str,
    device_public_key: &str,
    session_authority_registry: &Value,
    session_authority_key_id: &str,
    session_authority_public_key_spki: &str,
    binding_authority_registry: &Value,
    binding_authority_key_id: &str,
    binding_authority_public_key_spki: &str,
) -> Result<()> {
    let authenticated_user = parse_json(
        artifact_bytes(bundle, "authenticated_user")?,
        "authenticated_user",
        "device_identity",
    )?;
    if authenticated_user.get("authoritative") != Some(&Value::Bool(true))
        || authenticated_user.get("authority").and_then(Value::as_str)
            != Some("supabase-authenticated-user")
        || authenticated_user.get("user_id").and_then(Value::as_str) != Some(canonical_user_id)
    {
        return Err(BundleVerificationError::new(
            "device_identity",
            Some("authenticated_user"),
            "authenticated user is not the externally pinned user",
        ));
    }
    if result.canonical_user_id() != canonical_user_id || result.canonical_device_id() != device_id {
        return Err(BundleVerificationError::new(
            "result_evidence_binding",
            Some("result"),
            "signed Result subject does not match the external user/device identity",
        ));
    }
    let device_identity = parse_json(
        artifact_bytes(bundle, "device_identity")?,
        "device_identity",
        "device_identity",
    )?;
    if device_identity.get("authoritative") != Some(&Value::Bool(true))
        || device_identity.get("authority").and_then(Value::as_str)
            != Some("fusou-web-user-devices")
        || device_identity
            .get("canonical_user_id")
            .and_then(Value::as_str)
            != Some(canonical_user_id)
        || device_identity.get("device_id").and_then(Value::as_str) != Some(device_id)
        || !device_identity
            .get("revoked_at")
            .is_some_and(Value::is_null)
    {
        return Err(BundleVerificationError::new(
            "device_identity",
            Some("device_identity"),
            "device identity is not an authoritative, non-revoked external identity",
        ));
    }
    let device_key =
        decode_fixed_base64::<32>(device_public_key, "device public key", "device_identity")?;
    let artifact_device_key = decode_fixed_base64::<32>(
        object_string(
            &device_identity,
            "device_public_key",
            "device_identity",
            "device_identity",
        )?,
        "device public key",
        "device_identity",
    )?;
    if device_key != artifact_device_key {
        return Err(BundleVerificationError::mismatch(
            "device_identity",
            Some("device_identity"),
            "device public key does not match the external device pin",
            device_public_key,
            object_string(
                &device_identity,
                "device_public_key",
                "device_identity",
                "device_identity",
            )?,
        ));
    }
    if object_string(
        &device_identity,
        "device_public_key_sha256",
        "device_identity",
        "device_identity",
    )? != sha256_base64url(&device_key)
    {
        return Err(BundleVerificationError::new(
            "device_identity",
            Some("device_identity"),
            "device public key hash does not match the raw key",
        ));
    }
    let authentication = parse_json(
        artifact_bytes(bundle, "device_authentication")?,
        "device_authentication",
        "device_authentication",
    )?;
    let request = authentication.get("request").ok_or_else(|| {
        BundleVerificationError::new(
            "device_authentication",
            Some("device_authentication"),
            "device authentication request is missing",
        )
    })?;
    let auth_nonce = object_string(
        request,
        "nonce",
        "device_authentication",
        "device_authentication",
    )?;
    if object_string(
        request,
        "device_id",
        "device_authentication",
        "device_authentication",
    )? != device_id
        || auth_nonce.len() != 64
        || !auth_nonce
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(BundleVerificationError::new(
            "device_authentication",
            Some("device_authentication"),
            "device authentication request is invalid",
        ));
    }
    verify_raw_ed25519(
        &device_key,
        auth_nonce.as_bytes(),
        object_string(
            request,
            "sig",
            "device_authentication",
            "device_authentication",
        )?,
        "device_authentication",
    )?;
    let session = parse_json(artifact_bytes(bundle, "session")?, "session", "session")?;
    let session_id = object_string(&session, "session_id", "session", "session")?;
    let binding = object_string(&session, "binding", "session", "session")?;
    let challenge = object_string(&session, "challenge", "session", "session")?;
    let device_challenge = object_string(&session, "device_challenge", "session", "session")?;
    if object_string(&session, "device_id", "session", "session")? != device_id
        || session_id != &result.attestation_session_id().to_string()
        || binding != result.binding_value()
    {
        return Err(BundleVerificationError::new(
            "session_binding",
            Some("session"),
            "session is not bound to the external device and signed Result",
        ));
    }
    let parsed_binding = crate::parse_binding_value(binding).map_err(|error| {
        BundleVerificationError::new("binding_framing", Some("session"), error.to_string())
    })?;
    if parsed_binding.session_id.to_string() != session_id
        || URL_SAFE_NO_PAD.encode(parsed_binding.binding_nonce) != challenge
        || challenge != URL_SAFE_NO_PAD.encode(result.binding_nonce())
    {
        return Err(BundleVerificationError::new(
            "binding_framing",
            Some("session"),
            "session binding framing does not match the signed Result",
        ));
    }
    let acceptance = authentication.get("worker_acceptance").ok_or_else(|| {
        BundleVerificationError::new(
            "device_authentication",
            Some("device_authentication"),
            "device authentication acceptance is missing",
        )
    })?;
    if acceptance.get("status").and_then(Value::as_i64) != Some(201)
        || acceptance.get("device_id").and_then(Value::as_str) != Some(device_id)
        || acceptance.get("session_id").and_then(Value::as_str) != Some(session_id)
    {
        return Err(BundleVerificationError::new(
            "device_authentication",
            Some("device_authentication"),
            "device authentication acceptance is not bound to session issuance",
        ));
    }
    let session_receipt = session.get("session_receipt").ok_or_else(|| {
        BundleVerificationError::new(
            "session_receipt",
            Some("session"),
            "Session Authority receipt is missing",
        )
    })?;
    verify_session_receipt(
        session_receipt,
        &session,
        canonical_user_id,
        auth_nonce,
        session_authority_registry,
        session_authority_key_id,
        session_authority_public_key_spki,
    )?;
    let possession = parse_json(
        artifact_bytes(bundle, "possession_proof")?,
        "possession_proof",
        "device_possession",
    )?;
    verify_possession_proof(
        &possession,
        &device_key,
        device_id,
        session_id,
        binding,
        device_challenge,
    )?;
    let consume = parse_json(
        artifact_bytes(bundle, "consume_receipt")?,
        "consume_receipt",
        "consume_receipt",
    )?;
    verify_consume_receipt(
        &consume,
        &session,
        canonical_user_id,
        sha256_base64url(artifact_bytes(bundle, "presentation")?),
        binding_authority_registry,
        binding_authority_key_id,
        binding_authority_public_key_spki,
    )?;
    let replay = parse_json(artifact_bytes(bundle, "replay")?, "replay", "replay")?;
    let expected_replay_digest = sha256_base64url(&device_possession_signing_bytes(
        device_id,
        session_id,
        binding,
        device_challenge,
    )?);
    let expected_replay_digest_hex = hex_digest(&device_possession_signing_bytes(
        device_id,
        session_id,
        binding,
        device_challenge,
    )?);
    for (field, expected) in [
        ("session_id", session_id),
        ("device_id", device_id),
        ("binding", binding),
        ("replay_digest", expected_replay_digest.as_str()),
        ("replay_digest_hex", expected_replay_digest_hex.as_str()),
        (
            "stored_replay_digest_hex",
            expected_replay_digest_hex.as_str(),
        ),
    ] {
        if replay.get(field).and_then(Value::as_str) != Some(expected) {
            return Err(BundleVerificationError::mismatch(
                "replay_digest",
                Some("replay"),
                &format!("replay field does not match canonical possession: {field}"),
                expected,
                replay
                    .get(field)
                    .and_then(Value::as_str)
                    .unwrap_or("<missing>"),
            ));
        }
    }
    if replay.get("status").and_then(Value::as_i64) != Some(409)
        || !matches!(
            replay.get("error").and_then(Value::as_str),
            Some("binding_consumed") | Some("device_possession_replayed")
        )
        || replay
            .get("consume_receipt_presentation_id")
            .and_then(Value::as_str)
            != consume.get("presentation_id").and_then(Value::as_str)
    {
        return Err(BundleVerificationError::new(
            "replay_digest",
            Some("replay"),
            "replay rejection is not bound to the consumed proof",
        ));
    }
    Ok(())
}

fn verify_session_receipt(
    receipt: &Value,
    session: &Value,
    canonical_user_id: &str,
    device_auth_nonce: &str,
    registry: &Value,
    expected_key_id: &str,
    expected_public_key_spki: &str,
) -> Result<()> {
    for (receipt_field, session_field) in [
        ("session_id", "session_id"),
        ("device_id", "device_id"),
        ("nonce", "challenge"),
        ("device_challenge", "device_challenge"),
        ("binding_value", "binding"),
        ("expires_at", "expires_at"),
    ] {
        if receipt.get(receipt_field) != session.get(session_field) {
            return Err(BundleVerificationError::new(
                "session_receipt",
                Some("session"),
                format!("Session Authority receipt mismatch: {receipt_field}"),
            ));
        }
    }
    if receipt.get("device_auth_nonce").and_then(Value::as_str) != Some(device_auth_nonce)
        || receipt.get("canonical_user_id").and_then(Value::as_str) != Some(canonical_user_id)
    {
        return Err(BundleVerificationError::new(
            "session_receipt",
            Some("session"),
            "Session Authority receipt user or device nonce is invalid",
        ));
    }
    let signer_key_id = object_string(receipt, "signer_key_id", "session_receipt", "session")?;
    let public_key_spki = resolve_authority_key(
        registry,
        signer_key_id,
        object_string(receipt, "created_at", "session_receipt", "session")?,
        "session authority",
    )?;
    if signer_key_id != expected_key_id || public_key_spki != expected_public_key_spki {
        return Err(BundleVerificationError::new(
            "session_receipt",
            Some("session"),
            "Session Authority receipt signer does not match the external pin",
        ));
    }
    verify_receipt_signature(
        receipt,
        "attestation-session-issued",
        session_receipt_signing_bytes(receipt)?,
        &public_key_spki,
        "session_receipt",
    )
}

fn verify_consume_receipt(
    receipt: &Value,
    session: &Value,
    canonical_user_id: &str,
    presentation_id: String,
    registry: &Value,
    expected_key_id: &str,
    expected_public_key_spki: &str,
) -> Result<()> {
    for (receipt_field, session_field) in [
        ("session_id", "session_id"),
        ("device_id", "device_id"),
        ("nonce", "challenge"),
        ("binding_value", "binding"),
    ] {
        if receipt.get(receipt_field) != session.get(session_field) {
            return Err(BundleVerificationError::new(
                "consume_receipt",
                Some("consume_receipt"),
                format!("Binding Authority receipt mismatch: {receipt_field}"),
            ));
        }
    }
    if receipt.get("canonical_user_id").and_then(Value::as_str) != Some(canonical_user_id)
        || receipt.get("presentation_id").and_then(Value::as_str) != Some(presentation_id.as_str())
    {
        return Err(BundleVerificationError::new(
            "consume_receipt",
            Some("consume_receipt"),
            "Binding Authority receipt identity is invalid",
        ));
    }
    let signer_key_id = object_string(
        receipt,
        "signer_key_id",
        "consume_receipt",
        "consume_receipt",
    )?;
    let public_key_spki = resolve_authority_key(
        registry,
        signer_key_id,
        object_string(receipt, "used_at", "consume_receipt", "consume_receipt")?,
        "binding authority",
    )?;
    if signer_key_id != expected_key_id || public_key_spki != expected_public_key_spki {
        return Err(BundleVerificationError::new(
            "consume_receipt",
            Some("consume_receipt"),
            "Binding Authority receipt signer does not match the external pin",
        ));
    }
    verify_receipt_signature(
        receipt,
        "attestation-binding-consumed",
        consume_receipt_signing_bytes(receipt)?,
        &public_key_spki,
        "consume_receipt",
    )
}

fn verify_receipt_signature(
    receipt: &Value,
    expected_type: &str,
    signing_bytes: Vec<u8>,
    public_key_spki: &str,
    artifact: &str,
) -> Result<()> {
    if receipt.get("schema_version").and_then(Value::as_u64) != Some(1)
        || receipt.get("type").and_then(Value::as_str) != Some(expected_type)
        || receipt.get("signature_algorithm").and_then(Value::as_str) != Some("Ed25519")
    {
        return Err(BundleVerificationError::new(
            "authority_receipt",
            Some(artifact),
            "authority receipt metadata is invalid",
        ));
    }
    let signature = decode_fixed_base64::<64>(
        object_string(receipt, "signature", "authority_receipt", artifact)?,
        "authority receipt signature",
        "authority_receipt",
    )?;
    verify_ed25519(
        public_key_spki,
        &signing_bytes,
        &signature,
        "authority_receipt",
        artifact,
    )
}

fn append_length_prefixed(chunks: &mut Vec<u8>, value: &[u8], artifact: &str) -> Result<()> {
    let length = u16::try_from(value.len()).map_err(|_| {
        BundleVerificationError::new(
            "authority_receipt",
            Some(artifact),
            "authority receipt field is too large",
        )
    })?;
    chunks.extend_from_slice(&length.to_be_bytes());
    chunks.extend_from_slice(value);
    Ok(())
}

fn receipt_bytes(prefix: &[u8], values: &[&str], artifact: &str) -> Result<Vec<u8>> {
    let mut output = prefix.to_vec();
    output.extend_from_slice(&[0, 1]);
    for value in values {
        append_length_prefixed(&mut output, value.as_bytes(), artifact)?;
    }
    Ok(output)
}

fn session_receipt_signing_bytes(receipt: &Value) -> Result<Vec<u8>> {
    receipt_bytes(
        b"FUSOU-ATTESTATION-SESSION-V1\0",
        &[
            object_string(receipt, "signer_key_id", "session_receipt", "session")?,
            object_string(receipt, "session_id", "session_receipt", "session")?,
            object_string(receipt, "canonical_user_id", "session_receipt", "session")?,
            object_string(receipt, "device_id", "session_receipt", "session")?,
            object_string(receipt, "device_auth_nonce", "session_receipt", "session")?,
            object_string(receipt, "nonce", "session_receipt", "session")?,
            object_string(receipt, "device_challenge", "session_receipt", "session")?,
            object_string(receipt, "binding_value", "session_receipt", "session")?,
            object_string(receipt, "created_at", "session_receipt", "session")?,
            object_string(receipt, "expires_at", "session_receipt", "session")?,
        ],
        "session",
    )
}

fn consume_receipt_signing_bytes(receipt: &Value) -> Result<Vec<u8>> {
    receipt_bytes(
        b"FUSOU-ATTESTATION-CONSUME-V1\0",
        &[
            object_string(
                receipt,
                "signer_key_id",
                "consume_receipt",
                "consume_receipt",
            )?,
            object_string(receipt, "session_id", "consume_receipt", "consume_receipt")?,
            object_string(
                receipt,
                "canonical_user_id",
                "consume_receipt",
                "consume_receipt",
            )?,
            object_string(receipt, "device_id", "consume_receipt", "consume_receipt")?,
            object_string(receipt, "nonce", "consume_receipt", "consume_receipt")?,
            object_string(
                receipt,
                "binding_value",
                "consume_receipt",
                "consume_receipt",
            )?,
            object_string(
                receipt,
                "presentation_id",
                "consume_receipt",
                "consume_receipt",
            )?,
            object_string(receipt, "used_at", "consume_receipt", "consume_receipt")?,
        ],
        "consume_receipt",
    )
}

fn verify_possession_proof(
    proof: &Value,
    device_key: &[u8; 32],
    device_id: &str,
    session_id: &str,
    binding: &str,
    challenge: &str,
) -> Result<()> {
    for (field, expected) in [
        ("device_id", device_id),
        ("session_id", session_id),
        ("binding_value", binding),
        ("challenge", challenge),
    ] {
        if proof.get(field).and_then(Value::as_str) != Some(expected) {
            return Err(BundleVerificationError::new(
                "device_possession",
                Some("possession_proof"),
                format!("device possession field does not match session: {field}"),
            ));
        }
    }
    let signing_bytes = device_possession_signing_bytes(device_id, session_id, binding, challenge)?;
    verify_raw_ed25519(
        device_key,
        &signing_bytes,
        object_string(proof, "sig", "device_possession", "possession_proof")?,
        "device_possession",
    )?;
    let digest = sha256_base64url(&signing_bytes);
    let digest_hex = hex_digest(&signing_bytes);
    for field in ["replay_digest", "message_sha256"] {
        if proof.get(field).and_then(Value::as_str) != Some(digest.as_str()) {
            return Err(BundleVerificationError::new(
                "replay_digest",
                Some("possession_proof"),
                format!("device possession digest does not match: {field}"),
            ));
        }
    }
    for field in ["replay_digest_hex", "message_sha256_hex"] {
        if proof.get(field).and_then(Value::as_str) != Some(digest_hex.as_str()) {
            return Err(BundleVerificationError::new(
                "replay_digest",
                Some("possession_proof"),
                format!("device possession hex digest does not match: {field}"),
            ));
        }
    }
    Ok(())
}

fn device_possession_signing_bytes(
    device_id: &str,
    session_id: &str,
    binding: &str,
    challenge: &str,
) -> Result<Vec<u8>> {
    validate_uuid_v4(device_id, "device ID")?;
    validate_uuid_v4(session_id, "session ID")?;
    let challenge = decode_fixed_base64::<32>(challenge, "device challenge", "device_possession")?;
    let mut output = b"FUSOU-TLSN-DEVICE-PROOF-V1\0".to_vec();
    append_length_prefixed(&mut output, device_id.as_bytes(), "possession_proof")?;
    append_length_prefixed(&mut output, session_id.as_bytes(), "possession_proof")?;
    append_length_prefixed(&mut output, binding.as_bytes(), "possession_proof")?;
    append_length_prefixed(&mut output, &challenge, "possession_proof")?;
    Ok(output)
}

fn validate_uuid_v4(value: &str, label: &str) -> Result<()> {
    let bytes = value.as_bytes();
    let valid_shape = bytes.len() == 36
        && [8, 13, 18, 23].iter().all(|&index| bytes[index] == b'-')
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| [8, 13, 18, 23].contains(&index) || byte.is_ascii_hexdigit())
        && bytes[14].eq_ignore_ascii_case(&b'4')
        && matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b');
    if !valid_shape {
        return Err(BundleVerificationError::new(
            "device_possession",
            Some("possession_proof"),
            format!("{label} must be UUIDv4"),
        ));
    }
    Ok(())
}

fn verify_raw_ed25519(
    public_key: &[u8; 32],
    message: &[u8],
    signature: &str,
    edge: &str,
) -> Result<()> {
    let signature = decode_fixed_base64::<64>(signature, "Ed25519 signature", edge)?;
    UnparsedPublicKey::new(&ED25519, public_key)
        .verify(message, &signature)
        .map_err(|_| BundleVerificationError::new(edge, None, "Ed25519 signature is invalid"))
}

fn hex_digest(bytes: &[u8]) -> String {
    sha256(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn verify_semantic_artifact(
    bundle: &LoadedBundle,
    result: &dyn EvidenceResultView,
    notary_key: &[u8],
) -> Result<()> {
    let semantic = parse_json(
        artifact_bytes(bundle, "semantic_verification")?,
        "semantic_verification",
        "semantic_verification",
    )?;
    if semantic.get("schema_version").and_then(Value::as_u64)
        != Some(PRODUCTION_SEMANTIC_SCHEMA_VERSION)
        || semantic.get("kind").and_then(Value::as_str) != Some(PRODUCTION_SEMANTIC_KIND)
        || semantic.get("status").and_then(Value::as_str) != Some("VERIFIED")
    {
        return Err(BundleVerificationError::new(
            "semantic_verification",
            Some("semantic_verification"),
            "semantic verification artifact schema or status is invalid",
        ));
    }

    let manifest_metadata = bundle
        .manifest
        .get("semantic_verification")
        .ok_or_else(|| {
            BundleVerificationError::new(
                "semantic_verification",
                Some("manifest"),
                "manifest semantic verification metadata is missing",
            )
        })?;
    for (field, expected) in [
        ("status", "VERIFIED"),
        ("artifact", "semantic_verification"),
    ] {
        if manifest_metadata.get(field).and_then(Value::as_str) != Some(expected) {
            return Err(BundleVerificationError::new(
                "semantic_verification",
                Some("manifest"),
                format!("manifest semantic verification metadata is invalid: {field}"),
            ));
        }
    }
    for field in ["verifier_identity", "verified_at"] {
        if manifest_metadata.get(field) != semantic.get(field) {
            return Err(BundleVerificationError::new(
                "semantic_verification",
                Some("manifest"),
                format!(
                    "manifest semantic verification metadata does not match the artifact: {field}"
                ),
            ));
        }
    }

    let presentation = artifact_bytes(bundle, "presentation")?;
    let input = semantic
        .get("input")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "semantic_verification",
                Some("semantic_verification"),
                "semantic verification input is missing",
            )
        })?;
    let presentation_sha256 = sha256_base64url(presentation);
    if input.get("presentation_sha256").and_then(Value::as_str)
        != Some(presentation_sha256.as_str())
        || input.get("presentation_size_bytes").and_then(Value::as_u64)
            != Some(presentation.len() as u64)
    {
        return Err(BundleVerificationError::new(
            "semantic_verification",
            Some("semantic_verification"),
            "semantic verification input does not match the Presentation artifact",
        ));
    }

    let expected_semantic_result = parse_json(
        result
            .unsigned_canonical_json()?
            .as_bytes(),
        "result",
        "semantic_verification",
    )?;
    if canonical_json(semantic.get("semantic_result").ok_or_else(|| {
        BundleVerificationError::new(
            "semantic_verification",
            Some("semantic_verification"),
            "semantic Result is missing",
        )
    })?)?
        != canonical_json(&expected_semantic_result)?
    {
        return Err(BundleVerificationError::new(
            "semantic_verification",
            Some("semantic_verification"),
            "semantic Result does not match the independently verified Result",
        ));
    }

    let derived = semantic
        .get("derived_from_presentation")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "semantic_verification",
                Some("semantic_verification"),
                "Presentation-derived semantic fields are missing",
            )
        })?;
    let expected_derived = [
        ("presentation_sha256", presentation_sha256),
        (
            "tlsn_attestation_id",
            URL_SAFE_NO_PAD.encode(result.tlsn_attestation_id()),
        ),
        ("server_identity", result.server_identity().to_owned()),
        ("notary_key_sha256", sha256_base64url(notary_key)),
        ("verified_member_id", result.verified_member_id().to_owned()),
        (
            "request_transcript_size",
            result.request_transcript_size().to_string(),
        ),
        (
            "response_transcript_size",
            result.response_transcript_size().to_string(),
        ),
    ];
    for (field, expected) in expected_derived {
        if derived.get(field).and_then(Value::as_str) != Some(expected.as_str()) {
            return Err(BundleVerificationError::mismatch(
                "semantic_verification",
                Some("semantic_verification"),
                &format!("Presentation-derived semantic field does not match the Result: {field}"),
                expected,
                derived
                    .get(field)
                    .and_then(Value::as_str)
                    .unwrap_or("<missing>"),
            ));
        }
    }
    if let Some((request_digest, response_digest)) = result.full_transcript_sha256() {
        for (field, expected) in [
            ("request_transcript_sha256", URL_SAFE_NO_PAD.encode(request_digest)),
            ("response_transcript_sha256", URL_SAFE_NO_PAD.encode(response_digest)),
        ] {
            if derived.get(field).and_then(Value::as_str) != Some(expected.as_str()) {
                return Err(BundleVerificationError::mismatch(
                    "semantic_verification",
                    Some("semantic_verification"),
                    &format!("Presentation-derived semantic field does not match the Result: {field}"),
                    expected,
                    derived.get(field).and_then(Value::as_str).unwrap_or("<missing>"),
                ));
            }
        }
    } else if derived
        .get("request_transcript_sha256")
        .is_some()
        || derived.get("response_transcript_sha256").is_some()
    {
        return Err(BundleVerificationError::new(
            "semantic_verification",
            Some("semantic_verification"),
            "sparse semantic verification must not contain full transcript digests",
        ));
    }
    for (field, expected) in [
        (
            "revealed_request_ranges",
            revealed_ranges_value(result.revealed_request_ranges()),
        ),
        (
            "revealed_response_ranges",
            revealed_ranges_value(result.revealed_response_ranges()),
        ),
    ] {
        if derived.get(field).map(canonical_json).transpose()? != Some(canonical_json(&expected)?) {
            return Err(BundleVerificationError::new(
                "semantic_verification",
                Some("semantic_verification"),
                format!("Presentation-derived semantic ranges do not match the Result: {field}"),
            ));
        }
    }

    let http_profile = semantic
        .get("http_profile")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "semantic_verification",
                Some("semantic_verification"),
                "semantic HTTP profile is missing",
            )
        })?;
    for (field, expected) in [
        ("request_method", "POST"),
        ("request_target", crate::REQUIRE_INFO_TARGET),
        ("request_http_version", "HTTP/1.1"),
        ("response_status_line", "HTTP/1.1 200 OK"),
        (
            "response_member_path",
            "svdata.api_data.api_basic.api_member_id",
        ),
        ("host", result.server_identity()),
    ] {
        if http_profile.get(field).and_then(Value::as_str) != Some(expected) {
            return Err(BundleVerificationError::new(
                "semantic_verification",
                Some("semantic_verification"),
                format!("semantic HTTP profile is invalid: {field}"),
            ));
        }
    }

    let predicates = semantic.get("predicates").ok_or_else(|| {
        BundleVerificationError::new(
            "semantic_verification",
            Some("semantic_verification"),
            "semantic predicate results are missing",
        )
    })?;
    if canonical_json(predicates)?
        != canonical_json(bundle.manifest.get("semantic_predicates").ok_or_else(|| {
            BundleVerificationError::new(
                "evidence_contract",
                Some("manifest"),
                "manifest semantic predicates are missing",
            )
        })?)?
    {
        return Err(BundleVerificationError::new(
            "semantic_verification",
            Some("semantic_verification"),
            "semantic predicate results do not match the manifest",
        ));
    }
    for name in [
        "presentation_cryptography",
        "notary_identity",
        "server_identity",
        "require_info_http_profile",
        "presentation_binding_to_session",
        "authenticated_member_id",
        "result_presentation_binding",
        "result_registry_root_authentication",
        "result_signature",
        "result_key_publication",
        "trust_root_publication",
    ] {
        if predicates
            .get(name)
            .and_then(|predicate| predicate.get("status"))
            .and_then(Value::as_str)
            != Some("PASS")
        {
            return Err(BundleVerificationError::new(
                "semantic_verification",
                Some("semantic_verification"),
                format!("semantic predicate is not independently passed: {name}"),
            ));
        }
    }
    Ok(())
}

fn revealed_ranges_value(ranges: &[crate::RevealedRange]) -> Value {
    Value::Array(
        ranges
            .iter()
            .map(|range| {
                serde_json::json!({
                    "start": range.start.to_string(),
                    "length": range.length.to_string(),
                    "bytes": URL_SAFE_NO_PAD.encode(&range.bytes),
                })
            })
            .collect(),
    )
}

fn verify_capture_metadata(bundle: &LoadedBundle, presentation: &[u8]) -> Result<()> {
    let metadata = parse_json(
        artifact_bytes(bundle, "capture_metadata")?,
        "capture_metadata",
        "tlsn_presentation",
    )?;
    let expected_hash = sha256_base64url(presentation);
    if metadata.get("capture_provenance").and_then(Value::as_str) != Some("production")
        || metadata.get("capture_source").and_then(Value::as_str)
            != Some("fusou-proxy-production-tlsn")
        || metadata.get("synthetic") != Some(&Value::Bool(false))
        || metadata.get("test") != Some(&Value::Bool(false))
        || metadata.get("canary") != Some(&Value::Bool(false))
        || metadata.get("local") != Some(&Value::Bool(false))
    {
        return Err(BundleVerificationError::new(
            "tlsn_presentation",
            Some("capture_metadata"),
            "capture metadata is not an actual production TLSN capture",
        ));
    }
    let request = metadata.get("request").ok_or_else(|| {
        BundleVerificationError::new(
            "tlsn_presentation",
            Some("capture_metadata"),
            "capture metadata request profile is missing",
        )
    })?;
    for (field, expected) in [
        ("method", "POST"),
        ("target", crate::REQUIRE_INFO_TARGET),
        ("http_version", "HTTP/1.1"),
    ] {
        if request.get(field).and_then(Value::as_str) != Some(expected) {
            return Err(BundleVerificationError::new(
                "tlsn_presentation",
                Some("capture_metadata"),
                format!("capture metadata request profile is invalid: {field}"),
            ));
        }
    }
    if metadata.get("presentation_sha256").and_then(Value::as_str) != Some(expected_hash.as_str()) {
        return Err(BundleVerificationError::mismatch(
            "tlsn_presentation",
            Some("capture_metadata"),
            "capture metadata Presentation hash does not match the bytes",
            expected_hash,
            metadata
                .get("presentation_sha256")
                .and_then(Value::as_str)
                .unwrap_or("<missing>"),
        ));
    }
    let proxy = metadata.get("proxy_provenance").ok_or_else(|| {
        BundleVerificationError::new(
            "tlsn_presentation",
            Some("capture_metadata"),
            "production proxy provenance is missing",
        )
    })?;
    if proxy.get("declared").and_then(Value::as_str) != Some("production")
        || proxy.get("cryptographic_status").and_then(Value::as_str) != Some("UNVERIFIED")
        || proxy.get("presentation_sha256").and_then(Value::as_str) != Some(expected_hash.as_str())
        || parse_timestamp(object_string(
            proxy,
            "created_at",
            "tlsn_presentation",
            "capture_metadata",
        )?)
        .is_err()
    {
        return Err(BundleVerificationError::new(
            "tlsn_presentation",
            Some("capture_metadata"),
            "production proxy provenance declaration is invalid or falsely verified",
        ));
    }
    let authority = proxy.get("authority").ok_or_else(|| {
        BundleVerificationError::new(
            "tlsn_presentation",
            Some("capture_metadata"),
            "production proxy provenance authority is missing",
        )
    })?;
    if authority.get("type").and_then(Value::as_str)
        != Some("externally-pinned-production-proxy-key")
        || authority.get("status").and_then(Value::as_str) != Some("UNVERIFIED")
    {
        return Err(BundleVerificationError::new(
            "tlsn_presentation",
            Some("capture_metadata"),
            "production proxy provenance authority is not explicitly unverified",
        ));
    }
    let capture_context = proxy.get("capture_context").ok_or_else(|| {
        BundleVerificationError::new(
            "tlsn_presentation",
            Some("capture_metadata"),
            "production proxy provenance capture context is missing",
        )
    })?;
    for (field, expected) in [
        ("method", "POST"),
        ("target", crate::REQUIRE_INFO_TARGET),
        ("http_version", "HTTP/1.1"),
    ] {
        if capture_context.get(field).and_then(Value::as_str) != Some(expected) {
            return Err(BundleVerificationError::new(
                "tlsn_presentation",
                Some("capture_metadata"),
                format!("production proxy provenance capture context is invalid: {field}"),
            ));
        }
    }
    let signer_key_id = proxy.get("signer_key_id");
    let signature = proxy.get("signature");
    if signer_key_id.is_none() != signature.is_none()
        || signer_key_id.is_some_and(|value| !value.is_null() && value.as_str().is_none())
        || signature.is_some_and(|value| !value.is_null() && value.as_str().is_none())
        || signer_key_id
            .and_then(Value::as_str)
            .is_some_and(str::is_empty)
        || signature.and_then(Value::as_str).is_some_and(str::is_empty)
    {
        return Err(BundleVerificationError::new(
            "tlsn_presentation",
            Some("capture_metadata"),
            "production proxy provenance signature fields are invalid",
        ));
    }
    Ok(())
}

fn verify_health_identities(
    bundle: &LoadedBundle,
    result: &dyn EvidenceResultView,
    resolved_key: &ResolvedResultKey,
    registry_sha256: &str,
    envelope_sha256: &str,
    envelope: &Value,
    notary_registry_sha256: &str,
    session_authority_registry_sha256: &str,
    session_authority_key_id: &str,
    session_authority_public_key_spki: &str,
    binding_authority_registry_sha256: &str,
    binding_authority_key_id: &str,
    binding_authority_public_key_spki: &str,
) -> Result<()> {
    let health = parse_json(
        artifact_bytes(bundle, "health")?,
        "health",
        "artifact_manifest",
    )?;
    let result_identity = health.get("result_identity").ok_or_else(|| {
        BundleVerificationError::new(
            "result_identity",
            Some("health"),
            "health Result identity is missing",
        )
    })?;
    let pairs = [
        (
            "result_public_key_spki",
            resolved_key.public_key_spki.as_str(),
        ),
        ("result_signer_key_id", resolved_key.key_id.as_str()),
        ("result_key_registry_sha256", registry_sha256),
        ("result_key_registry_envelope_sha256", envelope_sha256),
        (
            "result_registry_root_key_id",
            object_string(envelope, "root_key_id", "result_identity", "health")?,
        ),
        (
            "result_registry_root_public_key_spki",
            object_string(
                envelope,
                "root_public_key_spki",
                "result_identity",
                "health",
            )?,
        ),
    ];
    for (field, expected) in pairs {
        if result_identity.get(field).and_then(Value::as_str) != Some(expected) {
            return Err(BundleVerificationError::mismatch(
                "result_identity",
                Some("health"),
                &format!("health Result identity mismatch: {field}"),
                expected,
                result_identity
                    .get(field)
                    .and_then(Value::as_str)
                    .unwrap_or("<missing>"),
            ));
        }
    }
    let security = health.get("security_identity").ok_or_else(|| {
        BundleVerificationError::new(
            "notary",
            Some("health"),
            "health security identity is missing",
        )
    })?;
    if security.get("server_identity").and_then(Value::as_str)
        != Some(result.server_identity())
        || security.get("profile_sha256").and_then(Value::as_str)
            != Some(URL_SAFE_NO_PAD.encode(result.profile_sha256()).as_str())
        || security.get("verifier_key_id").and_then(Value::as_str)
            != Some(result.verifier_key_id())
        || security.get("notary_key_id").and_then(Value::as_str)
            != Some(result.notary_key_id())
        || security
            .get("notary_registry_sha256")
            .and_then(Value::as_str)
            != Some(notary_registry_sha256)
    {
        return Err(BundleVerificationError::new("result_identity", Some("health"), "health security identity does not match independently derived Result and Notary identity"));
    }
    let authority_identity = health.get("authority_identity").ok_or_else(|| {
        BundleVerificationError::new(
            "authority_identity",
            Some("health"),
            "health authority identity is missing",
        )
    })?;
    for (name, expected_authority, expected_key_id, expected_public_key, expected_registry_hash) in [
        (
            "session_authority",
            "fusou-tlsn-session-authority",
            session_authority_key_id,
            session_authority_public_key_spki,
            session_authority_registry_sha256,
        ),
        (
            "binding_authority",
            "fusou-tlsn-binding-authority",
            binding_authority_key_id,
            binding_authority_public_key_spki,
            binding_authority_registry_sha256,
        ),
    ] {
        let identity = authority_identity.get(name).ok_or_else(|| {
            BundleVerificationError::new(
                "authority_identity",
                Some("health"),
                format!("health authority identity is missing: {name}"),
            )
        })?;
        for (field, expected) in [
            ("authority", expected_authority),
            ("key_id", expected_key_id),
            ("public_key_spki", expected_public_key),
            ("key_registry_sha256", expected_registry_hash),
        ] {
            if identity.get(field).and_then(Value::as_str) != Some(expected) {
                return Err(BundleVerificationError::mismatch(
                    "authority_identity",
                    Some("health"),
                    &format!("health authority identity mismatch: {name}.{field}"),
                    expected,
                    identity
                        .get(field)
                        .and_then(Value::as_str)
                        .unwrap_or("<missing>"),
                ));
            }
        }
    }
    Ok(())
}

fn verify_subject_artifact(bundle: &LoadedBundle, result: &dyn EvidenceResultView) -> Result<()> {
    let subject = parse_json(
        artifact_bytes(bundle, "subject")?,
        "subject",
        "result_evidence_binding",
    )?;
    for (field, value) in [
        (
            "canonical_user_id_sha256",
            result.canonical_user_id().as_bytes(),
        ),
        ("device_id_sha256", result.canonical_device_id().as_bytes()),
        (
            "attestation_session_id_sha256",
            result.attestation_session_id().to_string().as_bytes(),
        ),
        (
            "verified_member_id_sha256",
            result.verified_member_id().as_bytes(),
        ),
        ("binding_value_sha256", result.binding_value().as_bytes()),
    ] {
        let expected = sha256_base64url(value);
        if subject.get(field).and_then(Value::as_str) != Some(expected.as_str()) {
            return Err(BundleVerificationError::mismatch(
                "result_evidence_binding",
                Some("subject"),
                &format!("subject identity mismatch: {field}"),
                expected,
                subject
                    .get(field)
                    .and_then(Value::as_str)
                    .unwrap_or("<missing>"),
            ));
        }
    }
    Ok(())
}

fn verify_trust_graph(
    bundle: &LoadedBundle,
    result: &dyn EvidenceResultView,
    resolved_key: &ResolvedResultKey,
    registry_sha256: &str,
    notary_key_id: &str,
    root_key_id: &str,
    root_public_key_spki: &str,
) -> Result<()> {
    let manifest = &bundle.manifest;
    let graph = manifest
        .get("trust_graph")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            BundleVerificationError::new("trust_graph", Some("manifest"), "trust graph is missing")
        })?;
    if graph.get("schema_version").and_then(Value::as_u64) != Some(2) {
        return Err(BundleVerificationError::new(
            "trust_graph",
            Some("manifest"),
            "trust graph schema is invalid",
        ));
    }
    let edges = graph
        .get("edges")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "trust_graph",
                Some("manifest"),
                "trust graph edges are missing",
            )
        })?;
    let mut expected_edges: Vec<(&str, &str, &str, &[&str], &str, &str, &str)> = vec![
        (
            "user-owns-device",
            "authenticated-user",
            "device",
            &["user_id", "device_id", "device_public_key_sha256"],
            "device_identity",
            "device_identity_ownership",
            "fusou-web-user-devices",
        ),
        (
            "device-authenticates",
            "device",
            "device-authentication",
            &["device_id", "device_auth_nonce"],
            "device_authentication",
            "device_authentication_signature",
            "fusou-web-device-authentication",
        ),
        (
            "device-authentication-issues-session",
            "device-authentication",
            "session",
            &["device_id", "device_auth_nonce", "session_id"],
            "session",
            "session_binding_receipt",
            "fusou-tlsn-session-authority",
        ),
        (
            "session-issues-binding",
            "session",
            "binding",
            &["session_id", "binding_value", "binding_nonce"],
            "session",
            "session_binding_receipt",
            "fusou-tlsn-session-authority",
        ),
        (
            "session-binding-authenticates-presentation",
            "session",
            "presentation",
            &["session_id", "binding_value", "request_transcript_sha256"],
            "presentation",
            "presentation_binding_to_session",
            "offline-production-evidence-verifier",
        ),
        (
            "binding-consumes-presentation",
            "binding",
            "presentation",
            &["session_id", "binding_value", "presentation_id"],
            "consume_receipt",
            "consume_receipt",
            "fusou-tlsn-binding-authority",
        ),
        (
            RESULT_REGISTRY_ROOT_EDGE,
            "result-registry-root",
            "result-registry",
            &[
                "result_key_registry_sha256",
                "result_key_registry_envelope_sha256",
                "result_registry_root_key_id",
            ],
            "result_registry_envelope",
            "result_registry_root_authentication",
            "fusou-result-registry-root",
        ),
        (
            RESULT_REGISTRY_EDGE,
            "result-registry",
            "result",
            &[
                "result_key_registry_sha256",
                "result_signer_key_id",
                "result_public_key_spki",
            ],
            "result_registry",
            "result_key_publication",
            "fusou-result-signing-key-registry",
        ),
        (
            RESULT_SIGNATURE_EDGE,
            "result",
            "production-evidence",
            &["result_sha256", "result_signer_key_id"],
            "result",
            "result_signature",
            "fusou-tlsn-result-signer",
        ),
        (
            PRESENTATION_NOTARY_EDGE,
            "presentation",
            "tlsn-notary",
            &["notary_key_id", "notary_key_sha256"],
            "presentation",
            "notary_identity",
            "tlsn-alpha15-presentation-notary-key",
        ),
        (
            "presentation-derives-member-id",
            "presentation",
            "member-id",
            &["verified_member_id", "response_transcript_sha256"],
            "semantic_verification",
            "authenticated_member_id",
            "fusou-require-info-v1-response-parser",
        ),
        (
            "member-id-is-in-result",
            "member-id",
            "result",
            &[
                "verified_member_id",
                "tlsn_attestation_id",
                "transcript_hashes",
            ],
            "semantic_verification",
            "result_presentation_binding",
            "offline-production-evidence-verifier",
        ),
        (
            "presentation-is-cryptographically-verified",
            "presentation",
            "result",
            &["presentation_sha256", "tlsn_attestation_id"],
            "semantic_verification",
            "presentation_cryptography",
            "tlsn-alpha15-verifier",
        ),
        (
            "presentation-provenance-is-declared",
            "presentation",
            "production-proxy",
            &[
                "presentation_sha256",
                "proxy_identity",
                "proxy_deployment_id",
                "proxy_binary_identity",
            ],
            "capture_metadata",
            "proxy_provenance_cryptographic_authentication",
            "externally-pinned-production-proxy-provenance-authority",
        ),
        (
            "remote-attestation-is-unverified",
            "remote-attestation",
            "production-evidence",
            &["status"],
            "health",
            "remote_attestation_unverified",
            "remote-attestation-signer",
        ),
    ];
    if result.is_sparse() {
        for edge in &mut expected_edges {
            match edge.0 {
                "session-binding-authenticates-presentation" => {
                    *edge = (
                        edge.0,
                        edge.1,
                        edge.2,
                        &["session_id", "binding_value", "revealed_request_ranges"],
                        edge.4,
                        edge.5,
                        edge.6,
                    );
                }
                "presentation-derives-member-id" => {
                    *edge = (
                        edge.0,
                        edge.1,
                        edge.2,
                        &["verified_member_id", "revealed_response_ranges"],
                        edge.4,
                        edge.5,
                        "fusou-require-info-v2-sparse-response-parser",
                    );
                }
                "member-id-is-in-result" => {
                    *edge = (
                        edge.0,
                        edge.1,
                        edge.2,
                        &["verified_member_id", "tlsn_attestation_id", "revealed_response_ranges"],
                        edge.4,
                        edge.5,
                        edge.6,
                    );
                }
                _ => {}
            }
        }
    }
    if edges.len() != expected_edges.len() {
        return Err(BundleVerificationError::new(
            "trust_graph",
            Some("manifest"),
            "trust graph edge topology is invalid",
        ));
    }
    for (edge_id, source, target, binding_fields, artifact, predicate, authority) in expected_edges
    {
        let edge = edges
            .iter()
            .find(|edge| edge.get("id").and_then(Value::as_str) == Some(edge_id))
            .ok_or_else(|| {
                BundleVerificationError::new(
                    "trust_graph",
                    Some("manifest"),
                    format!("required trust graph edge is missing: {edge_id}"),
                )
            })?;
        let expected_binding_fields = Value::Array(
            binding_fields
                .iter()
                .map(|field| Value::String((*field).to_owned()))
                .collect(),
        );
        if edge.get("source").and_then(Value::as_str) != Some(source)
            || edge.get("target").and_then(Value::as_str) != Some(target)
            || edge.get("evidence_artifact").and_then(Value::as_str) != Some(artifact)
            || edge.get("verification_predicate").and_then(Value::as_str) != Some(predicate)
            || edge.get("authority").and_then(Value::as_str) != Some(authority)
            || edge.get("binding_fields").map(canonical_json).transpose()?
                != Some(canonical_json(&expected_binding_fields)?)
        {
            return Err(BundleVerificationError::new(
                "trust_graph",
                Some("manifest"),
                format!("trust graph edge protocol is invalid: {edge_id}"),
            ));
        }
    }
    let nodes = graph
        .get("nodes")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            BundleVerificationError::new(
                "trust_graph",
                Some("manifest"),
                "trust graph nodes are missing",
            )
        })?;
    let expected_nodes = [
        (
            "authenticated-user",
            "authenticated_user",
            "supabase-authenticated-user",
            "authenticated_user",
        ),
        (
            "device",
            "device",
            "fusou-web-user-devices",
            "device_identity",
        ),
        (
            "device-authentication",
            "device_authentication",
            "fusou-web-device-authentication",
            "device_authentication",
        ),
        (
            "session",
            "session",
            "fusou-tlsn-session-authority",
            "session",
        ),
        (
            "binding",
            "binding",
            "fusou-tlsn-binding-authority",
            "consume_receipt",
        ),
        (
            "presentation",
            "presentation",
            "tlsn-alpha15-verifier",
            "presentation",
        ),
        (
            "member-id",
            "member_id",
            "fusou-require-info-v1-response-parser",
            "semantic_verification",
        ),
        (
            "tlsn-notary",
            "notary",
            "tlsn-alpha15-presentation-notary-key",
            "notary_registry",
        ),
        (
            "result-registry-root",
            "result_registry_root",
            "fusou-result-registry-root",
            "result_registry_envelope",
        ),
        (
            "result-registry",
            "result_registry",
            "fusou-result-signing-key-registry",
            "result_registry",
        ),
        ("result", "result", "fusou-tlsn-result-signer", "result"),
        (
            "production-proxy",
            "proxy_provenance",
            "externally-pinned-production-proxy-provenance-authority",
            "capture_metadata",
        ),
        (
            "production-evidence",
            "evidence_manifest",
            "production-evidence-signer",
            "health",
        ),
        (
            "remote-attestation",
            "remote_attestation",
            "remote-attestation-signer",
            "health",
        ),
    ];
    if nodes.len() != expected_nodes.len() {
        return Err(BundleVerificationError::new(
            "trust_graph",
            Some("manifest"),
            "trust graph node topology is invalid",
        ));
    }
    for (node_id, node_type, authority, evidence_artifact) in expected_nodes {
        let node = nodes
            .iter()
            .find(|node| node.get("id").and_then(Value::as_str) == Some(node_id))
            .ok_or_else(|| {
                BundleVerificationError::new(
                    "trust_graph",
                    Some("manifest"),
                    format!("required trust graph node is missing: {node_id}"),
                )
            })?;
        if node.get("type").and_then(Value::as_str) != Some(node_type)
            || node.get("authority").and_then(Value::as_str) != Some(authority)
            || node.get("evidence_artifact").and_then(Value::as_str) != Some(evidence_artifact)
        {
            return Err(BundleVerificationError::new(
                "trust_graph",
                Some("manifest"),
                format!("trust graph node protocol is invalid: {node_id}"),
            ));
        }
    }
    let result_node = nodes
        .iter()
        .find(|node| node.get("id").and_then(Value::as_str) == Some("result"));
    if result_node
        .and_then(|node| node.get("identity"))
        .and_then(|identity| identity.get("key_id"))
        .and_then(Value::as_str)
        != Some(resolved_key.key_id.as_str())
    {
        return Err(BundleVerificationError::new(
            "trust_graph",
            Some("manifest"),
            "trust graph Result signer identity does not match the cryptographically resolved key",
        ));
    }
    let registry_node = nodes
        .iter()
        .find(|node| node.get("id").and_then(Value::as_str) == Some("result-registry"));
    if registry_node
        .and_then(|node| node.get("identity"))
        .and_then(|identity| identity.get("registry_sha256"))
        .and_then(Value::as_str)
        != Some(registry_sha256)
    {
        return Err(BundleVerificationError::new(
            "trust_graph",
            Some("manifest"),
            "trust graph registry identity does not match the authenticated registry",
        ));
    }
    let notary_node = nodes
        .iter()
        .find(|node| node.get("id").and_then(Value::as_str) == Some("tlsn-notary"));
    if notary_node
        .and_then(|node| node.get("identity"))
        .and_then(|identity| identity.get("key_id"))
        .and_then(Value::as_str)
        != Some(notary_key_id)
    {
        return Err(BundleVerificationError::new(
            "trust_graph",
            Some("manifest"),
            "trust graph Notary identity does not match the independently verified Presentation",
        ));
    }
    let root_node = nodes
        .iter()
        .find(|node| node.get("id").and_then(Value::as_str) == Some("result-registry-root"));
    if root_node
        .and_then(|node| node.get("identity"))
        .and_then(|identity| identity.get("key_id"))
        .and_then(Value::as_str)
        != Some(root_key_id)
    {
        return Err(BundleVerificationError::new(
            "trust_graph",
            Some("manifest"),
            "trust graph Evidence Root identity does not match the external Root key ID",
        ));
    }

    let authenticated_user = parse_json(
        artifact_bytes(bundle, "authenticated_user")?,
        "authenticated_user",
        "trust_graph",
    )?;
    let device_identity = parse_json(
        artifact_bytes(bundle, "device_identity")?,
        "device_identity",
        "trust_graph",
    )?;
    let device_authentication = parse_json(
        artifact_bytes(bundle, "device_authentication")?,
        "device_authentication",
        "trust_graph",
    )?;
    let session = parse_json(artifact_bytes(bundle, "session")?, "session", "trust_graph")?;
    let capture_metadata = parse_json(
        artifact_bytes(bundle, "capture_metadata")?,
        "capture_metadata",
        "trust_graph",
    )?;
    let session_receipt = session.get("session_receipt").ok_or_else(|| {
        BundleVerificationError::new(
            "trust_graph",
            Some("session"),
            "Session Authority receipt is missing",
        )
    })?;
    let authentication_request = device_authentication.get("request").ok_or_else(|| {
        BundleVerificationError::new(
            "trust_graph",
            Some("device_authentication"),
            "device authentication request is missing",
        )
    })?;
    let proxy = capture_metadata.get("proxy_provenance").ok_or_else(|| {
        BundleVerificationError::new(
            "trust_graph",
            Some("capture_metadata"),
            "production proxy provenance is missing",
        )
    })?;
    let presentation_sha256 = sha256_base64url(artifact_bytes(bundle, "presentation")?);
    let result_sha256 = sha256_base64url(artifact_bytes(bundle, "result")?);
    let envelope_sha256 = sha256_base64url(artifact_bytes(bundle, "result_registry_envelope")?);
    let session_id = object_string(&session, "session_id", "trust_graph", "session")?;
    let binding = object_string(&session, "binding", "trust_graph", "session")?;
    let challenge = object_string(&session, "challenge", "trust_graph", "session")?;
    let auth_nonce = object_string(
        authentication_request,
        "nonce",
        "trust_graph",
        "device_authentication",
    )?;
    let device_public_key_sha256 = object_string(
        &device_identity,
        "device_public_key_sha256",
        "trust_graph",
        "device_identity",
    )?;
    let capture_id = manifest_string(manifest, "capture_id", "trust_graph")?;
    let proxy_value = |field: &str| proxy.get(field).cloned().unwrap_or(Value::Null);

    for (node_id, field, expected) in [
        (
            "authenticated-user",
            "user_id",
            Value::String(
                object_string(
                    &authenticated_user,
                    "user_id",
                    "trust_graph",
                    "authenticated_user",
                )?
                .to_owned(),
            ),
        ),
        (
            "device",
            "user_id",
                Value::String(result.canonical_user_id().to_owned()),
        ),
        (
            "device",
            "device_id",
                Value::String(result.canonical_device_id().to_owned()),
        ),
        (
            "device",
            "public_key_sha256",
            Value::String(device_public_key_sha256.to_owned()),
        ),
        (
            "device-authentication",
            "device_id",
            Value::String(
                object_string(
                    authentication_request,
                    "device_id",
                    "trust_graph",
                    "device_authentication",
                )?
                .to_owned(),
            ),
        ),
        (
            "device-authentication",
            "nonce",
            Value::String(auth_nonce.to_owned()),
        ),
        (
            "session",
            "session_id",
            Value::String(session_id.to_owned()),
        ),
        (
            "session",
            "key_id",
            Value::String(
                object_string(session_receipt, "signer_key_id", "trust_graph", "session")?
                    .to_owned(),
            ),
        ),
        (
            "session",
            "binding_sha256",
            Value::String(sha256_base64url(binding.as_bytes())),
        ),
        (
            "binding",
            "binding_sha256",
            Value::String(sha256_base64url(binding.as_bytes())),
        ),
        (
            "binding",
            "nonce_sha256",
            Value::String(sha256_base64url(challenge.as_bytes())),
        ),
        (
            "presentation",
            "presentation_sha256",
            Value::String(presentation_sha256.clone()),
        ),
        (
            "presentation",
            "attestation_id",
            Value::String(URL_SAFE_NO_PAD.encode(result.tlsn_attestation_id())),
        ),
        (
            "presentation",
            "binding_sha256",
            Value::String(sha256_base64url(result.binding_value().as_bytes())),
        ),
        (
            "member-id",
            "verified_member_id",
            Value::String(result.verified_member_id().to_owned()),
        ),
        (
            "tlsn-notary",
            "key_id",
            Value::String(notary_key_id.to_owned()),
        ),
        (
            "result-registry-root",
            "key_id",
            Value::String(root_key_id.to_owned()),
        ),
        (
            "result-registry-root",
            "public_key_spki",
            Value::String(root_public_key_spki.to_owned()),
        ),
        (
            "result-registry",
            "registry_sha256",
            Value::String(registry_sha256.to_owned()),
        ),
        (
            "result-registry",
            "envelope_sha256",
            Value::String(envelope_sha256),
        ),
        ("result", "result_sha256", Value::String(result_sha256)),
        (
            "result",
            "key_id",
            Value::String(resolved_key.key_id.clone()),
        ),
        ("production-proxy", "declared", proxy_value("declared")),
        (
            "production-proxy",
            "cryptographic_status",
            proxy_value("cryptographic_status"),
        ),
        (
            "production-proxy",
            "proxy_identity",
            proxy_value("proxy_identity"),
        ),
        (
            "production-proxy",
            "proxy_deployment_id",
            proxy_value("proxy_deployment_id"),
        ),
        (
            "production-proxy",
            "proxy_binary_identity",
            proxy_value("proxy_binary_identity"),
        ),
        (
            "production-evidence",
            "capture_id",
            Value::String(capture_id.to_owned()),
        ),
        (
            "remote-attestation",
            "status",
            Value::String("UNVERIFIED".to_owned()),
        ),
    ] {
        verify_graph_identity_value(nodes, node_id, field, &expected)?;
    }
    if let Some((_, response_digest)) = result.full_transcript_sha256() {
        verify_graph_identity_value(
            nodes,
            "member-id",
            "response_transcript_sha256",
            &Value::String(URL_SAFE_NO_PAD.encode(response_digest)),
        )?;
    } else {
        verify_graph_identity_value(
            nodes,
            "member-id",
            "revealed_response_ranges",
            &revealed_ranges_value(result.revealed_response_ranges()),
        )?;
    }
    Ok(())
}

fn verify_graph_identity_value(
    nodes: &[Value],
    node_id: &str,
    field: &str,
    expected: &Value,
) -> Result<()> {
    let node = nodes
        .iter()
        .find(|node| node.get("id").and_then(Value::as_str) == Some(node_id))
        .ok_or_else(|| {
            BundleVerificationError::new(
                "trust_graph",
                Some("manifest"),
                format!("trust graph node is missing: {node_id}"),
            )
        })?;
    let identity = node.get("identity").ok_or_else(|| {
        BundleVerificationError::new(
            "trust_graph",
            Some("manifest"),
            format!("trust graph node identity is missing: {node_id}"),
        )
    })?;
    let actual = identity.get(field).unwrap_or(&Value::Null);
    if canonical_json(actual)? != canonical_json(expected)? {
        return Err(BundleVerificationError::mismatch(
            "trust_graph",
            Some("manifest"),
            &format!("trust graph node identity mismatch: {node_id}.{field}"),
            canonical_json(expected)?,
            canonical_json(actual)?,
        ));
    }
    Ok(())
}

fn parse_timestamp(value: &str) -> std::result::Result<i128, String> {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'.'
        || bytes[23] != b'Z'
        || ![0..4, 5..7, 8..10, 11..13, 14..16, 17..19, 20..23]
            .iter()
            .all(|range| bytes[range.clone()].iter().all(u8::is_ascii_digit))
    {
        return Err(format!("invalid ISO timestamp: {value}"));
    }
    let year = parse_digits(&bytes[0..4]);
    let month = parse_digits(&bytes[5..7]);
    let day = parse_digits(&bytes[8..10]);
    let hour = parse_digits(&bytes[11..13]);
    let minute = parse_digits(&bytes[14..16]);
    let second = parse_digits(&bytes[17..19]);
    let millisecond = parse_digits(&bytes[20..23]);
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return Err(format!("invalid ISO timestamp: {value}"));
    }
    let days = days_from_civil(year, month, day);
    Ok(
        (((days * 24 + hour as i64) * 60 + minute as i64) * 60 + second as i64) as i128 * 1000
            + millisecond as i128,
    )
}

fn parse_digits(bytes: &[u8]) -> u32 {
    bytes
        .iter()
        .fold(0, |value, byte| value * 10 + u32::from(byte - b'0'))
}

fn days_from_civil(year: u32, month: u32, day: u32) -> i64 {
    let year = year as i64 - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month = month as i64;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day as i64 - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146097 + day_of_era - 719468
}

#[cfg(test)]
mod tests {
    use super::*;
    use k256::elliptic_curve::sec1::ToEncodedPoint;

    #[test]
    fn canonical_json_sorts_nested_object_keys() {
        let value = serde_json::json!({"z": 1, "a": {"y": true, "b": ["x", 2]}});
        assert_eq!(
            canonical_json(&value).unwrap(),
            r#"{"a":{"b":["x",2],"y":true},"z":1}"#
        );
    }

    #[test]
    fn timestamp_order_is_independent_of_current_time() {
        assert!(
            parse_timestamp("2026-09-01T00:00:00.000Z").unwrap()
                < parse_timestamp("2026-10-01T00:00:00.000Z").unwrap()
        );
    }

    #[test]
    fn device_possession_signing_requires_uuidv4_ids() {
        let challenge = URL_SAFE_NO_PAD.encode([0_u8; 32]);
        let valid_device_id = "11111111-1111-4111-8111-111111111111";
        let valid_session_id = "22222222-2222-4222-8222-222222222222";
        assert!(device_possession_signing_bytes(
            "11111111-1111-3111-8111-111111111111",
            valid_session_id,
            "binding",
            &challenge,
        )
        .is_err());
        assert!(device_possession_signing_bytes(
            valid_device_id,
            "22222222-2222-1222-8222-222222222222",
            "binding",
            &challenge,
        )
        .is_err());
        assert!(device_possession_signing_bytes(
            valid_device_id,
            valid_session_id,
            "binding",
            &challenge,
        )
        .is_ok());
    }

    #[test]
    fn spki_parser_rejects_bundle_supplied_non_ed25519_key() {
        let error = ed25519_public_key("AQ", "test").unwrap_err();
        assert!(error.message.contains("invalid") || error.message.contains("base64"));
    }

    fn authority_registry(status: &str, not_before: &str, not_after: Value) -> Value {
        let public_key_spki = URL_SAFE_NO_PAD.encode([SPKI_PREFIX, &[0_u8; 32]].concat());
        serde_json::json!({
            "schema_version": 1,
            "scope": "tlsn-session-authority-key-registry",
            "keys": [{
                "key_id": "authority-key",
                "public_key_spki": public_key_spki,
                "status": status,
                "not_before": not_before,
                "not_after": not_after,
            }]
        })
    }

    #[test]
    fn authority_registry_accepts_historical_non_revoked_statuses() {
        for status in ["ACTIVE", "VERIFY_ONLY", "RETIRED"] {
            let registry = authority_registry(status, "2026-01-01T00:00:00.000Z", Value::Null);
            validate_authority_registry(
                &registry,
                "tlsn-session-authority-key-registry",
                "authority-key",
                registry["keys"][0]["public_key_spki"].as_str().unwrap(),
                "session authority",
            )
            .unwrap();
            assert!(resolve_authority_key(
                &registry,
                "authority-key",
                "2026-06-01T00:00:00.000Z",
                "session authority",
            )
            .is_ok());
        }
    }

    #[test]
    fn authority_registry_rejects_revoked_expired_and_future_keys() {
        let revoked = authority_registry("REVOKED", "2026-01-01T00:00:00.000Z", Value::Null);
        assert!(resolve_authority_key(
            &revoked,
            "authority-key",
            "2026-06-01T00:00:00.000Z",
            "session authority",
        )
        .is_err());

        let expired = authority_registry(
            "RETIRED",
            "2025-01-01T00:00:00.000Z",
            Value::String("2025-12-31T23:59:59.999Z".to_owned()),
        );
        assert!(resolve_authority_key(
            &expired,
            "authority-key",
            "2026-01-01T00:00:00.000Z",
            "session authority",
        )
        .is_err());

        let future = authority_registry("ACTIVE", "2027-01-01T00:00:00.000Z", Value::Null);
        assert!(resolve_authority_key(
            &future,
            "authority-key",
            "2026-06-01T00:00:00.000Z",
            "session authority",
        )
        .is_err());
    }

    #[test]
    fn alpha15_notary_registry_requires_a_valid_compressed_curve_point() {
        let secret_key = k256::SecretKey::from_slice(&[1_u8; 32]).unwrap();
        let public_key = secret_key.public_key().to_encoded_point(true);
        let mut serialized = vec![ALPHA15_K256_ALGORITHM_ID];
        serialized.extend_from_slice(&ALPHA15_K256_PUBLIC_KEY_LENGTH.to_le_bytes());
        serialized.extend_from_slice(public_key.as_bytes());
        validate_alpha15_notary_key(&serialized).unwrap();

        let mut invalid = serialized;
        invalid[9..].fill(0);
        assert!(validate_alpha15_notary_key(&invalid).is_err());
    }

    #[test]
    fn rejection_report_preserves_structured_trust_context() {
        let report = BundleVerificationError::mismatch(
            "result_signature",
            Some("result"),
            "signature mismatch",
            "expected-key",
            "actual-key",
        )
        .report();
        assert_eq!(report["status"], "REJECTED");
        assert_eq!(report["error"]["trust_edge"], "result_signature");
        assert_eq!(report["error"]["artifact"], "result");
        assert_eq!(report["error"]["expected"], "expected-key");
        assert_eq!(report["error"]["actual"], "actual-key");
    }
}
