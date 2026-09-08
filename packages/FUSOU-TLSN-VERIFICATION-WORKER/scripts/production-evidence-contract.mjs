import { randomUUID } from "node:crypto";

export const PRODUCTION_EVIDENCE_SCOPE = "tlsn-production-evidence";
export const PRODUCTION_EVIDENCE_SCHEMA_VERSION = 1;
export const PRODUCTION_EVIDENCE_ITEM_STATUSES = ["PASS", "UNVERIFIED", "BLOCKED", "FAIL"];
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
  return {
    evidence_id: evidenceId,
    status,
    timestamp,
    artifact_sha256: artifactSha256,
    verifier_identity: verifierIdentity,
    authority_identity: authorityIdentity,
    detail,
  };
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
    createEvidenceItem({ timestamp: now, detail: `required evidence is not available: ${requirement}` }),
  ]));
  return {
    schema_version: PRODUCTION_EVIDENCE_SCHEMA_VERSION,
    scope: PRODUCTION_EVIDENCE_SCOPE,
    status: "BLOCKED",
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
    createEvidenceItem(manifest.evidence?.[requirement]);
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