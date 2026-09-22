import {
  CANARY_INPUTS,
  CANARY_SECRET_INPUTS,
  WORKFLOW_EVIDENCE_INPUTS,
  inputsForRole,
  secretInputsForRole,
} from "./deployment-contract.mjs";

export const CANARY_EXTERNAL_INPUT_INTAKE_SCHEMA_VERSION = 1;
export const CANARY_EXTERNAL_INPUT_INTAKE_SCOPE = "tlsn-canary-external-input-intake";

const REMOTE_VALIDATION_INPUTS = [
  "TLSN_REMOTE_EXPECTED_PROVENANCE_JSON",
  "TLSN_REMOTE_WORKER_URL",
  "TLSN_REMOTE_WEB_ORIGIN",
  "TLSN_REMOTE_SUPABASE_URL",
  "TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_REMOTE_ACCESS_TOKEN_A",
  "TLSN_REMOTE_DEVICE_ID_A",
  "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE",
  "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL",
  "TLSN_REMOTE_FIXTURE_JSON",
];

const COMMON_METADATA = {
  representation: "environment variable; strings are trimmed before validation",
  approval_requirement: "must be supplied by the declared source and pass the named validator",
  lifetime: "per deployment or validation run",
  rotation: "rotate with the owning deployment, credential, or approval record",
  protected_input_channel: false,
};

function entries(category, names, metadata) {
  return names.map((name) => ({
    name,
    category,
    ...COMMON_METADATA,
    ...metadata,
  }));
}

export const CANARY_EXTERNAL_INPUT_INTAKE = Object.freeze([
  ...entries("TARGET", [
    "TLSN_CANDIDATE_SERVER_IDENTITY",
    "TLSN_CANDIDATE_VERIFIER_KEY_ID",
  ], {
    source: "EXTERNAL_APPROVAL",
    secret: false,
    representation: "DNS hostname, canonical base64url SHA-256 digest, or verifier key ID",
    consumer: "deployment-preflight, canary-approved-input-contract, profile-canonical-contract",
    validator: "deployment-preflight and canary-approved-input-contract",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_EXPIRED", "PRESENT_MISMATCHED", "FIXTURE_ONLY", "HISTORICAL_ONLY"],
  }),
  ...entries("PROFILE", [
    "TLSN_CANDIDATE_PROFILE_SHA256",
    "TLSN_CANDIDATE_SPARSE_PROFILE_SHA256",
  ], {
    source: "EXTERNAL_APPROVAL",
    secret: false,
    representation: "43-character base64url SHA-256 digest derived from canonical UTF-8 JSON",
    canonicalization: "canonicalJson; profile bytes are validated by profile-canonical-contract",
    hash: "SHA-256, base64url without padding",
    consumer: "deployment-preflight, canary-approved-input-contract",
    validator: "profile-canonical-contract and deployment-preflight",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "FIXTURE_ONLY", "HISTORICAL_ONLY"],
  }),
  ...entries("PROVENANCE", [
    "TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON",
  ], {
    source: "EXTERNAL_APPROVAL",
    secret: false,
    representation: "strict JSON contract in an environment variable or a secure, read-only path",
    consumer: "deployment-preflight; remote-validation consumes the provenance path",
    validator: "canary-approved-input-contract, deployment-attestation, verify-remote-gate",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_EXPIRED", "PRESENT_MISMATCHED", "HISTORICAL_ONLY"],
  }),
  ...entries("TRUST", [
    "TLSN_PRODUCTION_NOTARY_REGISTRY",
    "TLSN_SECURITY_REGISTRY_SET_SHA256",
    "TLSN_CANDIDATE_NOTARY_KEY_ID",
  ], {
    source: "EXTERNAL_APPROVAL",
    secret: false,
    representation: "canonical registry JSON, base64url SHA-256 digest, or base64url DER certificate",
    hash: "registry set uses canonicalJson and SHA-256; trust root is bound separately by SHA-256",
    consumer: "deployment-preflight, canary-approved-input-contract, Worker runtime",
    validator: "production-trust-contract, security-registry-set-contract, deployment-preflight",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "FIXTURE_ONLY", "HISTORICAL_ONLY"],
  }),
  ...entries("TRUST", [
    "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER",
  ], {
    source: "EXTERNAL_APPROVAL",
    secret: false,
    protected_input_channel: true,
    representation: "canonical base64url DER certificate in secure deployment environment",
    hash: "SHA-256 hash is bound into deployment identity and approved input contract",
    consumer: "deployment-preflight and Worker runtime",
    validator: "deployment-preflight trust-root hash check",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "FIXTURE_ONLY", "HISTORICAL_ONLY"],
  }),
  ...entries("VERIFIER", [
    "TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI",
    "TLSN_CANARY_VERIFIER_DEPLOYMENT_ID",
  ], {
    source: "EXTERNAL_APPROVAL",
    secret: false,
    representation: "canonical base64url Ed25519 SPKI public key and deployment identifier",
    consumer: "deployment-preflight, canary-approved-input-contract, verifier deployment",
    validator: "deployment-preflight and canary-approved-input-contract",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_EXPIRED", "PRESENT_MISMATCHED", "HISTORICAL_ONLY"],
  }),
  ...entries("AUTHENTICATION", [
    "TLSN_CANDIDATE_DEVICE_AUTH_URL",
    "TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL",
    "TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS",
    "TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS",
    "TLSN_CANDIDATE_SUPABASE_URL",
    "TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY",
  ], {
    source: "EXTERNAL_APPROVAL",
    secret: false,
    representation: "clean HTTPS URL, DNS allowlist, or provider publishable key",
    consumer: "deployment-preflight and remote-validation",
    validator: "deployment-preflight URL/host allowlist checks",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "FIXTURE_ONLY"],
  }),
  ...entries("DEVICE", [
    "TLSN_REMOTE_DEVICE_ID_A",
  ], {
    source: "EXTERNAL_APPROVAL",
    secret: false,
    phase: "REMOTE_VALIDATION_ONLY",
    representation: "approved device reference",
    consumer: "remote-validation only",
    validator: "remote-validation device identity check",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED"],
  }),
  ...entries("DEVICE", [
    "TLSN_REMOTE_ACCESS_TOKEN_A",
    "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE",
    "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL",
  ], {
    source: "SECRET_PROVIDER",
    secret: true,
    phase: "REMOTE_VALIDATION_ONLY",
    representation: "device reference plus short-lived access token and Ed25519 PKCS8 private key file or canonical base64url",
    consumer: "remote-validation only; never deployment-preflight or deploy-canary child environment",
    validator: "remote-validation and device proof verification",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_EXPIRED", "PRESENT_MISMATCHED"],
  }),
  ...entries("SUPABASE", [
    "TLSN_REMOTE_SUPABASE_URL",
    "TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY",
  ], {
    source: "EXTERNAL_APPROVAL",
    secret: false,
    phase: "REMOTE_VALIDATION_ONLY",
    representation: "clean HTTPS origin and publishable key",
    consumer: "remote-validation only",
    validator: "remote-validation origin and user assertions",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "FIXTURE_ONLY"],
  }),
  ...entries("BINDING", [
    "TLSN_CANARY_BINDING_IDENTITY",
    "TLSN_BINDING_TTL_SECONDS",
  ], {
    source: "EXTERNAL_APPROVAL",
    secret: false,
    representation: "Ed25519 SPKI/registry metadata, identity/reference strings, and integer TTL",
    consumer: "deployment-preflight, canary-approved-input-contract, binding authority",
    validator: "authority-key-registry, deployment-preflight, canary-approved-input-contract",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "REPLAY_BINDING_REUSE", "FIXTURE_ONLY"],
  }),
  ...entries("BINDING", [
    "TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
    "TLSN_CANARY_BINDING_AUTHORITY_KEY_ID",
    "TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY",
    "TLSN_CANARY_BINDING_VALUE",
  ], {
    source: "CANARY_GENERATED",
    secret: false,
    representation: "Ed25519 SPKI/registry metadata and a per-provisioning canonical binding value",
    consumer: "deployment-preflight, canary-approved-input-contract, binding authority",
    validator: "authority-key-registry, deployment-preflight, canary-approved-input-contract",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "REPLAY_BINDING_REUSE"],
  }),
  ...entries("TRUST", [
    "TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
    "TLSN_CANARY_SESSION_AUTHORITY_KEY_ID",
    "TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY",
  ], {
    source: "CANARY_GENERATED",
    secret: false,
    representation: "Ed25519 SPKI/registry metadata generated for the Canary session authority",
    consumer: "deployment-preflight and Worker runtime",
    validator: "authority-key-registry and deployment-preflight",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "REPLAY_IDENTITY_REUSE"],
  }),
  ...entries("WORKFLOW", [
    ...WORKFLOW_EVIDENCE_INPUTS,
  ], {
    source: "WORKFLOW_CONTEXT",
    secret: false,
    representation: "positive run/attempt, owner/name repository, and fixed workflow file identity",
    consumer: "deployment-preflight, canary-approved-input-contract, deployment-attestation",
    validator: "workflowContextFromEnvironment and checked-out HEAD comparison",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "HISTORICAL_ONLY"],
  }),
  ...entries("DEPLOYMENT", [
    "TLSN_ENVIRONMENT",
    "TLSN_DEPLOYMENT_ROLE",
    "TLSN_GIT_COMMIT_SHA",
    "TLSN_CANARY_DEPLOYMENT_ID",
    "TLSN_CANARY_WORKER_NAME",
    "TLSN_CANARY_TRIGGER_API_URL",
    "TLSN_CANARY_TRIGGER_TASK_ID",
    "TLSN_CANARY_WORKER_INTERNAL_URL",
  ], {
    source: "WORKFLOW_CONTEXT",
    secret: false,
    representation: "fixed environment/role, current 40-character commit, deployment identity, clean HTTPS origins, and task ID",
    consumer: "deployment-preflight and deploy-canary",
    validator: "deployment-preflight and deploy-canary",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "HISTORICAL_ONLY"],
  }),
  ...entries("RESULT_REGISTRY", [
    "TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI",
    "TLSN_CANARY_RESULT_SIGNER_KEY_ID",
    "TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY",
    "TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE",
    "TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID",
    "TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI",
  ], {
    source: "CANARY_GENERATED",
    secret: false,
    representation: "Ed25519 SPKI public keys, key IDs, canonical registry JSON, and signed registry envelope",
    consumer: "deployment-preflight, Worker runtime, remote result verification",
    validator: "signing-key-registry, result-registry-envelope, deployment-preflight",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "REPLAY_IDENTITY_REUSE"],
  }),
  ...entries("EVIDENCE_ROOT", [
    "TLSN_REMOTE_REPORT_PATH",
    "TLSN_REMOTE_VALIDATION_REPORT_PATH",
    "TLSN_PROVENANCE_REPORT_PATH",
    "TLSN_REMOTE_ATTESTATION_PATH",
    "TLSN_REMOTE_ATTESTATION_OUTPUT_PATH",
  ], {
    source: "DEPLOYMENT_GENERATED",
    secret: false,
    phase: "REMOTE_VALIDATION_ONLY",
    representation: "local paths to immutable JSON provenance, report, and attestation artifacts",
    consumer: "verify-remote-gate",
    validator: "deployment-attestation and verify-remote-gate",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_EXPIRED", "PRESENT_MISMATCHED", "HISTORICAL_ONLY"],
  }),
  ...entries("CREDENTIAL_POLICY", [
    "TLSN_CANARY_FIXTURE_ONLY",
    "TLSN_CANARY_SYNCHRONOUS_RESPONSE_ENABLED",
    "TLSN_BENCHMARK_TIMINGS",
  ], {
    source: "REPOSITORY_STATIC",
    secret: false,
    representation: "explicit boolean/capability flags",
    consumer: "deployment-preflight and canary-approved-input-contract",
    validator: "deployment-preflight and canary-approved-input-contract",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "FIXTURE_ONLY"],
  }),
  ...entries("CREDENTIAL_POLICY", [
    ...CANARY_SECRET_INPUTS.filter((name) => name !== "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER"),
  ], {
    source: "CANARY_GENERATED",
    secret: true,
    representation: "canonical base64url secret material in secure deployment environment",
    consumer: "deploy-canary only; values are written to a mode 0600 temporary Wrangler secrets file and removed",
    validator: "deployment-preflight key derivation and role isolation",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "REPLAY_IDENTITY_REUSE"],
  }),
  ...entries("REMOTE_VALIDATION", [
    "TLSN_REMOTE_WORKER_URL",
    "TLSN_REMOTE_WEB_ORIGIN",
    "TLSN_REMOTE_EXPECTED_PROVENANCE_JSON",
    "TLSN_REMOTE_FIXTURE_JSON",
  ], {
    source: "DEPLOYMENT_GENERATED",
    secret: false,
    phase: "REMOTE_VALIDATION_ONLY",
    representation: "clean HTTPS origins and explicit JSON artifact paths",
    consumer: "remote-validation and verify-remote-gate",
    validator: "remote-validation and verify-remote-gate",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "FIXTURE_ONLY", "HISTORICAL_ONLY"],
  }),
]);

export const CANARY_EXTERNAL_ARTIFACT_INTAKE = Object.freeze([
  {
    name: "target approval record",
    category: "TARGET",
    source: "EXTERNAL_APPROVAL",
    status_when_absent: "MISSING",
    representation: "target_approval section inside TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON",
    consumer: "canary-approved-input-contract and deployment-preflight",
    validator: "target identity, profile, trust, verifier, expiry, environment, and non-production checks",
  },
  {
    name: "canonical complete and sparse profiles",
    category: "PROFILE",
    source: "EXTERNAL_APPROVAL",
    status_when_absent: "MISSING",
    representation: "canonical UTF-8 JSON profile artifacts or their approved hashes",
    consumer: "provision-canary-material and deployment-preflight",
    validator: "profile-canonical-contract",
  },
  {
    name: "target provenance artifact",
    category: "PROVENANCE",
    source: "EXTERNAL_APPROVAL",
    status_when_absent: "MISSING",
    representation: "artifact_sha256 and scope in target_approval.provenance",
    consumer: "canary-approved-input-contract",
    validator: "strict schema, expiry, fixture/historical rejection",
  },
  {
    name: "Notary registry and trust root",
    category: "TRUST",
    source: "EXTERNAL_APPROVAL",
    status_when_absent: "MISSING",
    representation: "canonical registry JSON and DER trust root represented as canonical base64url",
    consumer: "deployment-preflight and Worker runtime",
    validator: "production-trust-contract and deployment-preflight",
  },
  {
    name: "workflow provenance",
    category: "WORKFLOW",
    source: "WORKFLOW_CONTEXT",
    status_when_absent: "MISSING",
    representation: "workflow environment variables and current checked-out commit",
    consumer: "deployment-preflight and canary-approved-input-contract",
    validator: "deployment-attestation",
  },
  {
    name: "remote validation report and attestation",
    category: "EVIDENCE_ROOT",
    source: "DEPLOYMENT_GENERATED",
    status_when_absent: "MISSING",
    representation: "immutable JSON paths produced after deployment and remote validation",
    consumer: "verify-remote-gate",
    validator: "deployment-attestation and remote report gate",
  },
]);

export const CANARY_EXTERNAL_INPUT_INTAKE_EXPECTED_NAMES = Object.freeze([
  ...new Set([
    ...inputsForRole("canary"),
    ...secretInputsForRole("canary"),
    ...WORKFLOW_EVIDENCE_INPUTS,
    ...REMOTE_VALIDATION_INPUTS,
    "TLSN_REMOTE_REPORT_PATH",
    "TLSN_REMOTE_VALIDATION_REPORT_PATH",
    "TLSN_PROVENANCE_REPORT_PATH",
    "TLSN_REMOTE_ATTESTATION_PATH",
    "TLSN_REMOTE_ATTESTATION_OUTPUT_PATH",
  ]),
]);

export function assertCanaryExternalInputIntakeContract() {
  const names = CANARY_EXTERNAL_INPUT_INTAKE.map((entry) => entry.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) throw new Error(`Canary intake contains duplicate inputs: ${[...new Set(duplicates)].join(", ")}`);
  const expected = [...CANARY_EXTERNAL_INPUT_INTAKE_EXPECTED_NAMES].sort();
  const actual = [...names].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Canary intake does not cover the repository input contract");
  for (const entry of CANARY_EXTERNAL_INPUT_INTAKE) {
    for (const field of ["category", "source", "representation", "approval_requirement", "lifetime", "rotation", "consumer", "validator", "failure_conditions"]) {
      if (entry[field] === undefined) throw new Error(`Canary intake entry ${entry.name} is missing ${field}`);
    }
    if (typeof entry.secret !== "boolean") throw new Error(`Canary intake entry ${entry.name} has no secret classification`);
    if (typeof entry.protected_input_channel !== "boolean") throw new Error(`Canary intake entry ${entry.name} has no protected input-channel classification`);
    if (!Array.isArray(entry.failure_conditions) || entry.failure_conditions.length === 0) throw new Error(`Canary intake entry ${entry.name} has no failure conditions`);
  }
  return true;
}

export function canaryInputIntakeEntry(name) {
  return CANARY_EXTERNAL_INPUT_INTAKE.find((entry) => entry.name === name);
}
