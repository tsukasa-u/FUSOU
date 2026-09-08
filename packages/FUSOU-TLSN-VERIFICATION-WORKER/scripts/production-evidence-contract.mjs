import { randomUUID } from "node:crypto";

export const PRODUCTION_EVIDENCE_SCOPE = "tlsn-production-evidence";
export const PRODUCTION_EVIDENCE_SCHEMA_VERSION = 1;
export const PRODUCTION_EVIDENCE_ITEM_STATUSES = ["PASS", "UNVERIFIED", "BLOCKED", "FAIL"];
export const PRODUCTION_EVIDENCE_CAPTURE_STATUSES = ["CAPTURED", "FAILED", "UNAVAILABLE"];
export const PRODUCTION_EVIDENCE_VERIFICATION_STATUSES = ["VERIFIED", "UNVERIFIED", "FAILED"];
export const PRODUCTION_EVIDENCE_SEMANTIC_PREDICATES = [
  "presentation_cryptography",
  "notary_identity",
  "server_identity",
  "require_info_http_profile",
  "authenticated_member_id",
  "result_presentation_binding",
  "result_signature",
];
export const PRODUCTION_EVIDENCE_SEMANTIC_PREDICATE_DEFINITIONS = {
  presentation_cryptography: {
    required_artifacts: ["presentation"],
    required_fields: ["presentation_sha256", "tlsn_attestation_id"],
    verification_method: "alpha15 Presentation::verify with complete authenticated transcript disclosure",
    authority_identity: "tlsn-alpha15-verifier",
    derived_fields: ["presentation_sha256", "tlsn_attestation_id", "request_transcript_sha256", "response_transcript_sha256"],
  },
  notary_identity: {
    required_artifacts: ["presentation", "health", "notary_registry"],
    required_fields: ["notary_key_id", "notary_key_sha256"],
    verification_method: "Presentation verifying key fingerprint equals the trusted Notary registry entry",
    authority_identity: "tlsn-alpha15-presentation-notary-key",
    derived_fields: ["notary_key_sha256", "notary_key_id"],
  },
  server_identity: {
    required_artifacts: ["presentation", "health"],
    required_fields: ["server_identity"],
    verification_method: "alpha15 verified server_name equals the trusted production server identity",
    authority_identity: "tlsn-alpha15-presentation-server-identity",
    derived_fields: ["server_identity"],
  },
  require_info_http_profile: {
    required_artifacts: ["presentation"],
    required_fields: ["profile_id", "profile_sha256", "http_profile", "request_transcript_sha256", "response_transcript_sha256"],
    verification_method: "strict parser over alpha15 authenticated request and response transcript bytes",
    authority_identity: "fusou-require-info-v1",
    derived_fields: ["server_identity", "request_transcript_sha256", "response_transcript_sha256"],
  },
  authenticated_member_id: {
    required_artifacts: ["presentation"],
    required_fields: ["verified_member_id", "response_transcript_sha256"],
    verification_method: "api_member_id derived from the alpha15 authenticated response transcript",
    authority_identity: "fusou-require-info-v1-response-parser",
    derived_fields: ["verified_member_id", "response_transcript_sha256"],
  },
  result_presentation_binding: {
    required_artifacts: ["presentation", "result"],
    required_fields: ["tlsn_attestation_id", "verified_member_id", "binding_value"],
    verification_method: "independent Presentation-derived Result fields equal the Worker Result payload",
    authority_identity: "offline-production-evidence-verifier",
    derived_fields: ["verified_member_id", "tlsn_attestation_id", "server_identity", "request_transcript_sha256", "response_transcript_sha256"],
  },
  result_signature: {
    required_artifacts: ["result", "result_registry"],
    required_fields: ["signature", "result_signer_key_id", "result_key_registry_sha256"],
    verification_method: "Worker Result signature verifies against the trusted result-key registry",
    authority_identity: "production-result-signing-key-registry",
    derived_fields: ["result_signature_valid", "result_signer_key_id"],
  },
};
export const PRODUCTION_EVIDENCE_DEVICE_PREDICATE_DEFINITIONS = {
  device_identity_ownership: {
    required_artifacts: ["device_identity"],
    required_fields: ["canonical_user_id", "device_id", "device_public_key", "device_public_key_sha256", "revoked_at"],
    verification_method: "authoritative FUSOU-WEB user_devices identity matches the signed Result subject and is not revoked",
    authority_identity: "fusou-web-user-devices",
    derived_fields: ["canonical_user_id", "device_id", "device_public_key_sha256", "revoked_at"],
  },
  device_authentication_signature: {
    required_artifacts: ["device_identity", "device_authentication", "session"],
    required_fields: ["device_id", "nonce", "signature", "attestation_session_id"],
    verification_method: "generic device nonce signature verifies against the authoritative device public key and the issued session",
    authority_identity: "fusou-web-device-authentication",
    derived_fields: ["device_id", "nonce", "attestation_session_id"],
  },
  session_binding_receipt: {
    required_artifacts: ["session", "result"],
    required_fields: ["attestation_session_id", "binding_value", "binding_nonce", "receipt_signature"],
    verification_method: "Worker-signed session receipt binds the authenticated device nonce, binding, and session identity",
    authority_identity: "fusou-tlsn-verification-worker",
    derived_fields: ["attestation_session_id", "binding_value", "binding_nonce"],
  },
  tlsn_device_possession_signature: {
    required_artifacts: ["device_identity", "possession_proof", "session"],
    required_fields: ["device_id", "attestation_session_id", "binding_value", "device_challenge", "signature"],
    verification_method: "canonical TLSN device possession signature verifies against the authoritative device public key",
    authority_identity: "fusou-web-tlsn-device-authentication",
    derived_fields: ["device_id", "attestation_session_id", "binding_value", "device_challenge"],
  },
  binding_framing: {
    required_artifacts: ["session", "result"],
    required_fields: ["attestation_session_id", "binding_value", "binding_nonce"],
    verification_method: "binding bytes decode to the exact issued UUIDv4 session ID and 32-byte nonce",
    authority_identity: "fusou-tlsn-binding-authority",
    derived_fields: ["attestation_session_id", "binding_nonce"],
  },
  replay_digest: {
    required_artifacts: ["possession_proof", "replay"],
    required_fields: ["replay_digest", "replay_digest_hex", "stored_replay_digest_hex", "status", "error"],
    verification_method: "SHA-256 over canonical TLSN possession bytes matches both captured replay encodings and the rejected replay",
    authority_identity: "fusou-web-tlsn-device-authentication",
    derived_fields: ["replay_digest", "replay_digest_hex", "stored_replay_digest_hex", "status", "error"],
  },
  consume_receipt: {
    required_artifacts: ["consume_receipt", "result", "presentation", "session"],
    required_fields: ["session_id", "binding_value", "presentation_id", "used_at", "signature"],
    verification_method: "Worker-signed consume receipt binds the consumed session, binding, Presentation hash, and timestamp",
    authority_identity: "fusou-tlsn-verification-worker",
    derived_fields: ["session_id", "binding_value", "presentation_id", "used_at"],
  },
};
export const PRODUCTION_EVIDENCE_REQUIREMENTS = [
  "real_production_game_server_connection",
  "real_production_tlsn_notary_interaction",
  "real_production_fusou_web_device_authentication",
  "real_production_device_possession_proof",
  "real_production_replay_authority",
  "real_production_binding_authority",
  "real_production_verifier_trust_root",
  "real_production_result_signing_key",
  "real_production_public_key_publication",
  "independently_captured_production_evidence",
];
export const PRODUCTION_EVIDENCE_ITEM_DEFINITIONS = {
  real_production_game_server_connection: {
    required_artifacts: ["presentation", "semantic_verification"],
    required_fields: ["server_identity", "profile_sha256", "tlsn_attestation_id"],
    verification_method: "alpha15 Presentation verification derives the authenticated server identity",
  },
  real_production_tlsn_notary_interaction: {
    required_artifacts: ["presentation", "notary_registry", "semantic_verification"],
    required_fields: ["notary_key_id", "notary_key_sha256"],
    verification_method: "alpha15 Presentation verifying key matches the production Notary registry",
  },
  real_production_fusou_web_device_authentication: {
    required_artifacts: ["health", "subject", "session", "device_identity", "device_authentication"],
    required_fields: ["canonical_user_id", "device_id", "attestation_session_id", "device_public_key", "device_public_key_sha256"],
    verification_method: "FUSOU-WEB authoritative device identity and generic nonce signature are independently verified",
  },
  real_production_device_possession_proof: {
    required_artifacts: ["session", "device_identity", "possession_proof", "result"],
    required_fields: ["device_challenge", "device_id", "binding_value", "replay_digest"],
    verification_method: "canonical TLSN device proof signature and replay digest verify against the authoritative device public key",
  },
  real_production_replay_authority: {
    required_artifacts: ["session", "possession_proof", "consume_receipt", "replay"],
    required_fields: ["session_id", "device_id", "binding", "replay_digest", "stored_replay_digest_hex", "error"],
    verification_method: "canonical proof digest equals the stored FUSOU-WEB replay key, is bound to the signed consume receipt, and the consumed binding rejects replay",
  },
  real_production_binding_authority: {
    required_artifacts: ["session", "result", "consume_receipt"],
    required_fields: ["session_id", "binding", "binding_nonce"],
    verification_method: "signed session and consume receipts bind the verified Result to a one-shot session",
  },
  real_production_verifier_trust_root: {
    required_artifacts: ["health", "trust_root"],
    required_fields: ["trust_root_certificate_sha256"],
    verification_method: "captured trust root bytes match the deployed Worker identity",
  },
  real_production_result_signing_key: {
    required_artifacts: ["result", "result_registry"],
    required_fields: ["signature", "result_signer_key_id", "result_key_registry_sha256"],
    verification_method: "signed Result verifies against the captured active result-key registry",
  },
  real_production_public_key_publication: {
    required_artifacts: ["health", "result_registry"],
    required_fields: ["result_public_key_spki", "result_signer_key_id", "result_key_registry_sha256"],
    verification_method: "Worker health identity matches the captured published result-key registry",
  },
  independently_captured_production_evidence: {
    required_artifacts: ["presentation", "semantic_verification", "result", "session", "device_identity", "device_authentication", "possession_proof", "consume_receipt"],
    required_fields: ["presentation_sha256", "tlsn_attestation_id", "verified_member_id", "device_public_key_sha256", "replay_digest", "stored_replay_digest_hex"],
    verification_method: "capture harness independently verifies Presentation semantics, device signatures, binding receipts, and signed Result binding",
  },
};
export const PRODUCTION_EVIDENCE_REQUIREMENT_PREDICATES = {
  real_production_game_server_connection: ["presentation_cryptography", "server_identity", "require_info_http_profile"],
  real_production_tlsn_notary_interaction: ["presentation_cryptography", "notary_identity"],
  real_production_fusou_web_device_authentication: ["device_identity_ownership", "device_authentication_signature"],
  real_production_device_possession_proof: ["device_identity_ownership", "tlsn_device_possession_signature", "binding_framing"],
  real_production_replay_authority: ["replay_digest", "consume_receipt"],
  real_production_binding_authority: ["session_binding_receipt", "binding_framing", "consume_receipt"],
  real_production_verifier_trust_root: [],
  real_production_result_signing_key: ["result_signature"],
  real_production_public_key_publication: ["result_signature"],
  independently_captured_production_evidence: [
    "presentation_cryptography",
    "notary_identity",
    "server_identity",
    "require_info_http_profile",
    "authenticated_member_id",
    "result_presentation_binding",
    "result_signature",
    "device_identity_ownership",
    "device_authentication_signature",
    "session_binding_receipt",
    "tlsn_device_possession_signature",
    "binding_framing",
    "replay_digest",
    "consume_receipt",
  ],
};
export const PRODUCTION_EVIDENCE_REQUIREMENT_DEVICE_PREDICATES = {
  real_production_game_server_connection: [],
  real_production_tlsn_notary_interaction: [],
  real_production_fusou_web_device_authentication: ["device_identity_ownership", "device_authentication_signature"],
  real_production_device_possession_proof: ["device_identity_ownership", "tlsn_device_possession_signature", "binding_framing"],
  real_production_replay_authority: ["replay_digest", "consume_receipt"],
  real_production_binding_authority: ["session_binding_receipt", "binding_framing", "consume_receipt"],
  real_production_verifier_trust_root: [],
  real_production_result_signing_key: [],
  real_production_public_key_publication: [],
  independently_captured_production_evidence: [
    "device_identity_ownership",
    "device_authentication_signature",
    "session_binding_receipt",
    "tlsn_device_possession_signature",
    "binding_framing",
    "replay_digest",
    "consume_receipt",
  ],
};
export function productionRequirementStatus(requirement, semanticPredicateResults, devicePredicateResults) {
  const semanticNames = PRODUCTION_EVIDENCE_REQUIREMENT_PREDICATES[requirement] ?? [];
  const deviceNames = PRODUCTION_EVIDENCE_REQUIREMENT_DEVICE_PREDICATES[requirement] ?? [];
  const semanticPass = semanticNames.every((name) => semanticPredicateResults?.[name]?.status === "PASS");
  const devicePass = deviceNames.every((name) => devicePredicateResults?.[name]?.status === "PASS");
  return semanticPass && devicePass ? "PASS" : "UNVERIFIED";
}
export const PRODUCTION_EVIDENCE_DOMAINS = {
  game_server: [
    "real_production_game_server_connection",
    "real_production_tlsn_notary_interaction",
  ],
  authenticated_subject: [
    "real_production_fusou_web_device_authentication",
    "real_production_device_possession_proof",
  ],
  binding_and_replay: [
    "real_production_replay_authority",
    "real_production_binding_authority",
  ],
  verifier_trust: [
    "real_production_verifier_trust_root",
    "real_production_result_signing_key",
    "real_production_public_key_publication",
  ],
  capture_independence: ["independently_captured_production_evidence"],
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function assertTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
}

function assertIdentity(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new Error(`${label} must be a non-empty identity`);
  }
}

export function createEvidenceItem({
  evidenceId = randomUUID(),
  status = "UNVERIFIED",
  timestamp = new Date().toISOString(),
  artifactSha256 = null,
  verifierIdentity = "capture-harness",
  authorityIdentity = "production-authority-unverified",
  detail = "",
  requiredArtifacts = [],
  requiredFields = [],
  verificationMethod = "independent production evidence verification",
} = {}) {
  if (!UUID_PATTERN.test(evidenceId)) throw new Error("evidence_id must be a UUIDv4");
  if (!PRODUCTION_EVIDENCE_ITEM_STATUSES.includes(status)) {
    throw new Error(`invalid production evidence item status: ${status}`);
  }
  assertTimestamp(timestamp, "evidence timestamp");
  if (artifactSha256 !== null && !SHA256_BASE64URL_PATTERN.test(artifactSha256)) {
    throw new Error("artifact_sha256 must be a base64url SHA-256 digest or null");
  }
  assertIdentity(verifierIdentity, "verifier_identity");
  assertIdentity(authorityIdentity, "authority_identity");
  if (typeof detail !== "string" || detail.length > 1024) throw new Error("evidence detail is invalid");
  if (!Array.isArray(requiredArtifacts) || requiredArtifacts.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error("evidence required_artifacts is invalid");
  }
  if (!Array.isArray(requiredFields) || requiredFields.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error("evidence required_fields is invalid");
  }
  assertIdentity(verificationMethod, "verification_method");
  return {
    evidence_id: evidenceId,
    status,
    timestamp,
    artifact_sha256: artifactSha256,
    verifier_identity: verifierIdentity,
    authority_identity: authorityIdentity,
    detail,
    required_artifacts: [...requiredArtifacts],
    required_fields: [...requiredFields],
    verification_method: verificationMethod,
  };
}

export function createProductionEvidenceItem(requirement, options = {}) {
  const definition = PRODUCTION_EVIDENCE_ITEM_DEFINITIONS[requirement];
  if (!definition) throw new Error(`unknown production evidence requirement: ${requirement}`);
  return createEvidenceItem({
    ...options,
    requiredArtifacts: definition.required_artifacts,
    requiredFields: definition.required_fields,
    verificationMethod: definition.verification_method,
  });
}

export function blockedProductionEvidenceManifest({
  captureId = randomUUID(),
  now = new Date().toISOString(),
  workflowContext = null,
  deploymentIdentity = null,
  securityIdentity = null,
  resultIdentity = null,
  subjectIdentity = null,
  captureProvenance = "unavailable",
} = {}) {
  if (!UUID_PATTERN.test(captureId)) throw new Error("capture_id must be a UUIDv4");
  assertTimestamp(now, "capture timestamp");
  if (!["production", "unavailable"].includes(captureProvenance)) {
    throw new Error("capture_provenance must be production or unavailable");
  }
  const evidence = Object.fromEntries(PRODUCTION_EVIDENCE_REQUIREMENTS.map((requirement) => [
    requirement,
    createProductionEvidenceItem(requirement, { timestamp: now, detail: `required evidence is not available: ${requirement}` }),
  ]));
  return {
    schema_version: PRODUCTION_EVIDENCE_SCHEMA_VERSION,
    scope: PRODUCTION_EVIDENCE_SCOPE,
    status: "BLOCKED",
    capture_status: "UNAVAILABLE",
    verification_status: "UNVERIFIED",
    production_evidence_status: "BLOCKED",
    p0_05_status: "BLOCKED",
    production_evidence: "BLOCKED",
    p0_05: "BLOCKED",
    capture_id: captureId,
    capture_provenance: captureProvenance,
    capture_started_at: now,
    capture_finished_at: now,
    workflow_context: workflowContext,
    deployment_identity: deploymentIdentity,
    security_identity: securityIdentity,
    result_identity: resultIdentity,
    subject_identity: subjectIdentity,
    evidence_domains: PRODUCTION_EVIDENCE_DOMAINS,
    evidence,
    semantic_predicates: Object.fromEntries(PRODUCTION_EVIDENCE_SEMANTIC_PREDICATES.map((predicate) => [
      predicate,
      {
        ...PRODUCTION_EVIDENCE_SEMANTIC_PREDICATE_DEFINITIONS[predicate],
        status: "UNVERIFIED",
        evidence_artifacts: [],
        verified_at: now,
        detail: "semantic predicate has not been independently verified",
        observed: {},
      },
    ])),
    device_predicates: Object.fromEntries(Object.entries(PRODUCTION_EVIDENCE_DEVICE_PREDICATE_DEFINITIONS).map(([predicate, definition]) => [
      predicate,
      {
        ...definition,
        status: "UNVERIFIED",
        evidence_artifacts: [],
        verified_at: now,
        detail: "device predicate has not been independently verified",
        observed: {},
      },
    ])),
    semantic_verification: null,
    artifacts: {},
    independent_verification: {
      status: "BLOCKED",
      verified_at: now,
      verifier_identity: "offline-production-evidence-verifier",
      detail: "P0-05 remains blocked until every production evidence item is independently verified",
    },
  };
}

export function assertProductionEvidenceManifest(manifest) {
  if (
    manifest?.schema_version !== PRODUCTION_EVIDENCE_SCHEMA_VERSION ||
    manifest?.scope !== PRODUCTION_EVIDENCE_SCOPE ||
    manifest?.status !== "BLOCKED" ||
    !PRODUCTION_EVIDENCE_CAPTURE_STATUSES.includes(manifest?.capture_status) ||
    !PRODUCTION_EVIDENCE_VERIFICATION_STATUSES.includes(manifest?.verification_status) ||
    manifest?.production_evidence_status !== "BLOCKED" ||
    manifest?.p0_05_status !== "BLOCKED" ||
    manifest?.production_evidence !== "BLOCKED" ||
    manifest?.p0_05 !== "BLOCKED"
  ) {
    throw new Error("production evidence manifest must remain blocked");
  }
  if (!UUID_PATTERN.test(manifest.capture_id ?? "")) throw new Error("production evidence capture_id is invalid");
  if (!["production", "unavailable"].includes(manifest.capture_provenance)) {
    throw new Error("production evidence capture provenance is invalid");
  }
  assertTimestamp(manifest.capture_started_at, "capture_started_at");
  assertTimestamp(manifest.capture_finished_at, "capture_finished_at");
  if (Date.parse(manifest.capture_finished_at) < Date.parse(manifest.capture_started_at)) {
    throw new Error("capture_finished_at precedes capture_started_at");
  }
  if (JSON.stringify(manifest.evidence_domains) !== JSON.stringify(PRODUCTION_EVIDENCE_DOMAINS)) {
    throw new Error("production evidence domains are invalid");
  }
  for (const requirement of PRODUCTION_EVIDENCE_REQUIREMENTS) {
    if (!manifest.evidence?.[requirement]) throw new Error(`production evidence item is missing: ${requirement}`);
    const item = manifest.evidence[requirement];
    const definition = PRODUCTION_EVIDENCE_ITEM_DEFINITIONS[requirement];
    createEvidenceItem(item);
    if (
      JSON.stringify(item.required_artifacts) !== JSON.stringify(definition.required_artifacts) ||
      JSON.stringify(item.required_fields) !== JSON.stringify(definition.required_fields) ||
      item.verification_method !== definition.verification_method
    ) {
      throw new Error(`production evidence item contract is invalid: ${requirement}`);
    }
  }
  for (const predicate of PRODUCTION_EVIDENCE_SEMANTIC_PREDICATES) {
    const item = manifest.semantic_predicates?.[predicate];
    if (!item || !["PASS", "UNVERIFIED", "BLOCKED", "FAIL"].includes(item.status)) {
      throw new Error(`semantic evidence predicate is missing: ${predicate}`);
    }
    if (!Array.isArray(item.required_artifacts) || !Array.isArray(item.required_fields)) {
      throw new Error(`semantic evidence predicate schema is invalid: ${predicate}`);
    }
    if (!Array.isArray(item.evidence_artifacts) || !Array.isArray(item.derived_fields)) {
      throw new Error(`semantic evidence predicate result schema is invalid: ${predicate}`);
    }
    assertTimestamp(item.verified_at, "semantic predicate verified_at");
    if (typeof item.detail !== "string" || item.detail.length > 1024 || !item.observed || typeof item.observed !== "object") {
      throw new Error(`semantic evidence predicate observation is invalid: ${predicate}`);
    }
    assertIdentity(item.verification_method, "semantic verification_method");
    assertIdentity(item.authority_identity, "semantic authority_identity");
  }
  for (const [predicate, definition] of Object.entries(PRODUCTION_EVIDENCE_DEVICE_PREDICATE_DEFINITIONS)) {
    const item = manifest.device_predicates?.[predicate];
    if (!item || !["PASS", "UNVERIFIED", "FAIL"].includes(item.status)) {
      throw new Error(`device evidence predicate is missing: ${predicate}`);
    }
    if (
      JSON.stringify(item.required_artifacts) !== JSON.stringify(definition.required_artifacts) ||
      JSON.stringify(item.required_fields) !== JSON.stringify(definition.required_fields) ||
      item.verification_method !== definition.verification_method ||
      item.authority_identity !== definition.authority_identity
    ) {
      throw new Error(`device evidence predicate definition is invalid: ${predicate}`);
    }
    if (!Array.isArray(item.evidence_artifacts) || !Array.isArray(item.derived_fields)) {
      throw new Error(`device evidence predicate schema is invalid: ${predicate}`);
    }
    assertTimestamp(item.verified_at, "device predicate verified_at");
    if (typeof item.detail !== "string" || item.detail.length > 1024 || !item.observed || typeof item.observed !== "object") {
      throw new Error(`device evidence predicate observation is invalid: ${predicate}`);
    }
  }
  if (manifest.semantic_verification !== null && typeof manifest.semantic_verification !== "object") {
    throw new Error("semantic verification artifact reference is invalid");
  }
  if (!manifest.independent_verification || manifest.independent_verification.status !== "BLOCKED") {
    throw new Error("independent production evidence verification must remain blocked");
  }
  assertTimestamp(manifest.independent_verification.verified_at, "independent_verification.verified_at");
  assertIdentity(manifest.independent_verification.verifier_identity, "independent_verification.verifier_identity");
  return manifest;
}

export function blockedProductionEvidenceContract() {
  return {
    scope: PRODUCTION_EVIDENCE_SCOPE,
    status: "BLOCKED",
    independent_capture_required: true,
    requirements: Object.fromEntries(
      PRODUCTION_EVIDENCE_REQUIREMENTS.map((requirement) => [requirement, "UNVERIFIED"]),
    ),
  };
}

export function assertProductionEvidenceBlocked(report) {
  if (report?.production_evidence !== "BLOCKED" || report?.p0_05 !== "BLOCKED") {
    throw new Error("production evidence and P0-05 must remain BLOCKED");
  }
  const contract = report?.production_evidence_contract;
  if (
    contract?.scope !== PRODUCTION_EVIDENCE_SCOPE ||
    contract?.status !== "BLOCKED" ||
    contract?.independent_capture_required !== true
  ) {
    throw new Error("production evidence contract is missing or not blocked");
  }
  for (const requirement of PRODUCTION_EVIDENCE_REQUIREMENTS) {
    if (contract.requirements?.[requirement] !== "UNVERIFIED") {
      throw new Error(`production evidence requirement is not unverified: ${requirement}`);
    }
  }
}