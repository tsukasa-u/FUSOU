import {
  CANARY_INPUTS,
  CANARY_SECRET_INPUTS,
  WORKFLOW_EVIDENCE_INPUTS,
  inputsForRole,
  secretInputsForRole,
} from "./deployment-contract.mjs";

export const CANARY_EXTERNAL_INPUT_INTAKE_SCHEMA_VERSION = 2;
export const CANARY_EXTERNAL_INPUT_INTAKE_SCOPE = "tlsn-canary-external-input-intake";
export const CANARY_INPUT_CLASSIFICATIONS = Object.freeze([
  "REPOSITORY_STATIC",
  "DEPLOYMENT_INPUT",
  "SECRET_PROVIDER",
  "WORKFLOW_CONTEXT",
  "DEPLOYMENT_GENERATED",
  "CANARY_GENERATED",
  "TARGET_RUNTIME",
  "FIXTURE_ONLY",
  "HISTORICAL_ONLY",
  "REMOTE_VALIDATION_ONLY",
]);
export const CANARY_INPUT_OWNERSHIP = Object.freeze([
  "OPERATOR_CONFIGURED",
  "DEPLOYMENT_INPUT_REQUIRED",
  "SECRET_PROVIDER_REQUIRED",
  "WORKFLOW_CONTEXT_REQUIRED",
  "DEPLOYMENT_GENERATED",
  "CANARY_GENERATED",
  "REPOSITORY_STATIC",
  "TARGET_RUNTIME",
  "FIXTURE_ONLY",
  "HISTORICAL_ONLY",
  "REMOTE_VALIDATION_ONLY",
  "OPTIONAL_DELEGATED_NOTARY",
  "DERIVED",
]);

export const CANARY_TLSN_ARCHITECTURE = Object.freeze({
  live_verifier: Object.freeze({
    status: "NOT_IMPLEMENTED",
    role: "FUSOU-owned live MPC Verifier Worker",
  }),
  presentation_verifier: Object.freeze({
    status: "IMPLEMENTED",
    role: "FUSOU-owned offline Presentation verifier and Result signer",
  }),
  delegated_notary: Object.freeze({
    status: "IMPLEMENTED",
    role: "FUSOU-operated alpha.15 MPC Notary",
    optional_in_protocol: true,
    current_presentation_path: "REQUIRED",
  }),
});

const SOURCE_OWNERSHIP = Object.freeze({
  DEPLOYMENT_INPUT: "DEPLOYMENT_INPUT_REQUIRED",
  SECRET_PROVIDER: "SECRET_PROVIDER_REQUIRED",
  WORKFLOW_CONTEXT: "WORKFLOW_CONTEXT_REQUIRED",
  DEPLOYMENT_GENERATED: "DEPLOYMENT_GENERATED",
  CANARY_GENERATED: "CANARY_GENERATED",
  REPOSITORY_STATIC: "REPOSITORY_STATIC",
  FIXTURE_ONLY: "FIXTURE_ONLY",
});

const OWNERSHIP_DEFAULTS = Object.freeze({
  OPERATOR_CONFIGURED: {
    owner: "FUSOU deployment operator or repository configuration",
    generated_by: "operator-supplied deployment configuration",
    generation_stage: "before deployment",
    can_generate_locally: false,
    can_generate_during_deployment: false,
    external_dependency: false,
  },
  DEPLOYMENT_INPUT_REQUIRED: {
    owner: "FUSOU deployment configuration",
    generated_by: "operator-supplied or deployment-generated current input",
    generation_stage: "deployment provisioning",
    can_generate_locally: false,
    can_generate_during_deployment: false,
    external_dependency: false,
  },
  SECRET_PROVIDER_REQUIRED: {
    owner: "configured secret provider",
    generated_by: "credential issuer or secret provider",
    generation_stage: "remote validation setup",
    can_generate_locally: false,
    can_generate_during_deployment: false,
    external_dependency: true,
  },
  WORKFLOW_CONTEXT_REQUIRED: {
    owner: "CI workflow context",
    generated_by: "workflow invocation and checked-out repository",
    generation_stage: "workflow execution",
    can_generate_locally: false,
    can_generate_during_deployment: false,
    external_dependency: false,
  },
  DEPLOYMENT_GENERATED: {
    owner: "FUSOU deployment or attestation path",
    generated_by: "deployment-preflight, deploy-canary, or deployment-attestation",
    generation_stage: "deployment or post-deployment",
    can_generate_locally: false,
    can_generate_during_deployment: true,
    external_dependency: false,
  },
  CANARY_GENERATED: {
    owner: "FUSOU Canary provisioner",
    generated_by: "provision-canary-material.mjs",
    generation_stage: "provisioning before deployment",
    can_generate_locally: true,
    can_generate_during_deployment: false,
    external_dependency: false,
  },
  REPOSITORY_STATIC: {
    owner: "FUSOU repository policy",
    generated_by: "repository contract or explicit mode configuration",
    generation_stage: "repository configuration",
    can_generate_locally: true,
    can_generate_during_deployment: false,
    external_dependency: false,
  },
  TARGET_RUNTIME: {
    owner: "deployed Canary runtime",
    generated_by: "Worker runtime",
    generation_stage: "runtime",
    can_generate_locally: false,
    can_generate_during_deployment: false,
    external_dependency: false,
  },
  FIXTURE_ONLY: {
    owner: "repository fixture harness",
    generated_by: "fixture-only provisioning",
    generation_stage: "fixture test",
    can_generate_locally: true,
    can_generate_during_deployment: false,
    external_dependency: false,
  },
  HISTORICAL_ONLY: {
    owner: "historical evidence store",
    generated_by: "prior deployment or prior validation run",
    generation_stage: "historical",
    can_generate_locally: false,
    can_generate_during_deployment: false,
    external_dependency: false,
  },
  REMOTE_VALIDATION_ONLY: {
    owner: "remote-validation operator and post-deployment evidence path",
    generated_by: "remote-validation setup or deployment-attestation",
    generation_stage: "post-deployment validation",
    can_generate_locally: false,
    can_generate_during_deployment: false,
    external_dependency: true,
  },
  OPTIONAL_DELEGATED_NOTARY: {
    owner: "FUSOU-operated delegated alpha.15 Notary",
    generated_by: "FUSOU Notary deployment and trust registry configuration",
    generation_stage: "deployment provisioning",
    can_generate_locally: false,
    can_generate_during_deployment: false,
    external_dependency: false,
  },
  DERIVED: {
    owner: "FUSOU derivation from declared source inputs",
    generated_by: "provision-canary-material.mjs or contract hash derivation",
    generation_stage: "provisioning before deployment",
    can_generate_locally: true,
    can_generate_during_deployment: false,
    external_dependency: false,
  },
});

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
  phase: "DEPLOYMENT_PREFLIGHT",
  representation: "environment variable; strings are trimmed before validation",
  input_requirement: "must be supplied by the declared source and pass the named validator",
  lifetime: "per deployment or validation run",
  rotation: "rotate with the owning deployment, credential, or configuration record",
  protected_input_channel: false,
  required: true,
  authorization_required: false,
  validity_period: "current deployment or validation run",
  canonicalization: "trimmed UTF-8 environment value",
  fingerprint: "not applicable",
  readiness_effect: "BLOCKS_CANARY_READINESS",
};

function entries(category, names, metadata) {
  return names.map((name) => {
    const ownership = metadata.ownershipByName?.[name] ?? metadata.ownership ?? SOURCE_OWNERSHIP[metadata.source] ?? "OPERATOR_CONFIGURED";
    const architectureRole = metadata.architectureRoleByName?.[name] ?? metadata.architecture_role;
    const entry = {
      name,
      category,
      ...COMMON_METADATA,
      ...OWNERSHIP_DEFAULTS[ownership],
      ...metadata,
      ownership,
    };
    delete entry.ownershipByName;
    delete entry.architectureRoleByName;
    Object.assign(entry, metadata.ownershipMetadata ?? {});
    if (metadata.ownershipMetadataByName?.[name]) Object.assign(entry, metadata.ownershipMetadataByName[name]);
    delete entry.ownershipMetadata;
    delete entry.ownershipMetadataByName;
    if (architectureRole) entry.architecture_role = architectureRole;
    entry.classification = entry.classification
      ?? (entry.phase === "REMOTE_VALIDATION_ONLY"
        ? "REMOTE_VALIDATION_ONLY"
        : entry.source);
    entry.exposure = entry.secret ? "SECRET" : "PUBLIC";
    entry.purpose = entry.purpose ?? `${category} input required by the Canary contract`;
    entry.format = entry.format ?? entry.representation;
    entry.provenance = entry.provenance
      ?? (entry.source === "DEPLOYMENT_INPUT"
        ? "deployment manifest input identity and named validator"
        : `${entry.source} ownership and named validator`);
    return entry;
  });
}

export const CANARY_EXTERNAL_INPUT_INTAKE = Object.freeze([
  ...entries("TARGET", [
    "TLSN_CANDIDATE_SERVER_IDENTITY",
    "TLSN_CANDIDATE_VERIFIER_KEY_ID",
  ], {
    source: "DEPLOYMENT_INPUT",
    secret: false,
    architectureRoleByName: {
      TLSN_CANDIDATE_SERVER_IDENTITY: "TARGET_CONFIGURATION",
      TLSN_CANDIDATE_VERIFIER_KEY_ID: "FUSOU_PRESENTATION_RESULT_VERIFIER_IDENTITY",
    },
    ownership: "OPERATOR_CONFIGURED",
    representation: "DNS hostname, canonical base64url SHA-256 digest, or verifier key ID",
    consumer: "deployment-preflight, deployment-manifest, profile-canonical-contract",
    validator: "deployment-preflight and deployment-manifest",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_EXPIRED", "PRESENT_MISMATCHED", "FIXTURE_ONLY", "HISTORICAL_ONLY"],
  }),
  ...entries("PROFILE", [
    "TLSN_CANDIDATE_PROFILE_SHA256",
    "TLSN_CANDIDATE_SPARSE_PROFILE_SHA256",
  ], {
    source: "DEPLOYMENT_INPUT",
    secret: false,
    architecture_role: "PROFILE_POLICY",
    representation: "43-character base64url SHA-256 digest derived from canonical UTF-8 JSON",
    canonicalization: "canonicalJson; profile bytes are validated by profile-canonical-contract",
    hash: "SHA-256, base64url without padding",
    fingerprint: "SHA-256 of canonical UTF-8 profile JSON, base64url without padding",
    consumer: "deployment-preflight, deployment-manifest",
    validator: "profile-canonical-contract and deployment-preflight",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "FIXTURE_ONLY", "HISTORICAL_ONLY"],
    ownership: "DERIVED",
    external_dependency: false,
    provenance: "profile artifacts and their profile-canonical-contract hashes",
  }),
  ...entries("TRUST", [
    "TLSN_PRODUCTION_NOTARY_REGISTRY",
    "TLSN_SECURITY_REGISTRY_SET_SHA256",
    "TLSN_CANDIDATE_NOTARY_KEY_ID",
  ], {
    source: "DEPLOYMENT_INPUT",
    secret: false,
    ownership: "OPTIONAL_DELEGATED_NOTARY",
    architectureRoleByName: {
      TLSN_PRODUCTION_NOTARY_REGISTRY: "OPTIONAL_DELEGATED_NOTARY",
      TLSN_CANDIDATE_NOTARY_KEY_ID: "OPTIONAL_DELEGATED_NOTARY",
    },
    representation: "canonical registry JSON, base64url SHA-256 digest, or base64url DER certificate",
    hash: "registry set uses canonicalJson and SHA-256; trust root is bound separately by SHA-256",
    fingerprint: "security registry set SHA-256 plus canonical Notary registry SHA-256",
    consumer: "deployment-preflight, deployment-manifest, Worker runtime",
    validator: "production-trust-contract, security-registry-set-contract, deployment-preflight",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "FIXTURE_ONLY", "HISTORICAL_ONLY"],
    ownershipByName: {
      TLSN_SECURITY_REGISTRY_SET_SHA256: "DERIVED",
    },
    ownershipMetadataByName: {
      TLSN_SECURITY_REGISTRY_SET_SHA256: {
        generated_by: "securityRegistrySetHash from target, profile, and Notary inputs",
        external_dependency: false,
      },
    },
  }),
  ...entries("TRUST", [
    "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER",
  ], {
    source: "DEPLOYMENT_INPUT",
    secret: false,
    ownership: "OPERATOR_CONFIGURED",
    protected_input_channel: true,
    representation: "canonical base64url DER certificate in secure deployment environment",
    hash: "SHA-256 hash is bound into deployment identity and deployment manifest",
    fingerprint: "SHA-256 of DER certificate bytes, base64url without padding",
    consumer: "deployment-preflight and Worker runtime",
    validator: "deployment-preflight trust-root hash check",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "FIXTURE_ONLY", "HISTORICAL_ONLY"],
  }),
  ...entries("VERIFIER", [
    "TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI",
    "TLSN_CANARY_VERIFIER_DEPLOYMENT_ID",
  ], {
    source: "DEPLOYMENT_INPUT",
    secret: false,
    architecture_role: "FUSOU_PRESENTATION_RESULT_VERIFIER_IDENTITY",
    representation: "canonical base64url Ed25519 SPKI public key and deployment identifier",
    consumer: "deployment-preflight, deployment-manifest, verifier deployment",
    validator: "deployment-preflight and deployment-manifest",
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
    source: "DEPLOYMENT_INPUT",
    secret: false,
    representation: "clean HTTPS URL, DNS allowlist, or provider publishable key",
    consumer: "deployment-preflight and remote-validation",
    validator: "deployment-preflight URL/host allowlist checks",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "FIXTURE_ONLY"],
    ownership: "DERIVED",
    external_dependency: false,
    generated_by: "provision-canary-material.mjs from declared public site and Supabase configuration",
    provenance: "target authentication endpoints and publishable-key policy",
  }),
  ...entries("DEVICE", [
    "TLSN_REMOTE_DEVICE_ID_A",
  ], {
    source: "DEPLOYMENT_INPUT",
    secret: false,
    phase: "REMOTE_VALIDATION_ONLY",
    representation: "configured device reference",
    consumer: "remote-validation only",
    validator: "remote-validation device identity check",
    classification: "REMOTE_VALIDATION_ONLY",
    authorization_required: true,
    provenance: "authentication.device_identity and credential policy reference",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED"],
  }),
  ...entries("DEVICE", [
    "TLSN_REMOTE_ACCESS_TOKEN_A",
  ], {
    source: "SECRET_PROVIDER",
    secret: true,
    phase: "REMOTE_VALIDATION_ONLY",
    representation: "short-lived access token",
    consumer: "remote-validation only; never deployment-preflight or deploy-canary child environment",
    validator: "remote-validation and device proof verification",
    classification: "REMOTE_VALIDATION_ONLY",
    authorization_required: true,
    provenance: "credential_policy secret_provider_ref and remote device proof result",
    validity_period: "short-lived credential policy window",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_EXPIRED", "PRESENT_MISMATCHED"],
  }),
  ...entries("DEVICE", [
    "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE",
    "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL",
  ], {
    source: "SECRET_PROVIDER",
    secret: true,
    required: false,
    required_group: "REMOTE_DEVICE_PRIVATE_KEY_ONE_OF",
    phase: "REMOTE_VALIDATION_ONLY",
    representation: "device reference plus short-lived access token and Ed25519 PKCS8 private key file or canonical base64url",
    consumer: "remote-validation only; never deployment-preflight or deploy-canary child environment",
    validator: "remote-validation and device proof verification",
    classification: "REMOTE_VALIDATION_ONLY",
    authorization_required: true,
    provenance: "credential_policy secret_provider_ref and remote device proof result",
    validity_period: "short-lived credential policy window; private key representation is one-of",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_EXPIRED", "PRESENT_MISMATCHED"],
  }),
  ...entries("SUPABASE", [
    "TLSN_REMOTE_SUPABASE_URL",
    "TLSN_REMOTE_SUPABASE_PUBLISHABLE_KEY",
  ], {
    source: "DEPLOYMENT_INPUT",
    secret: false,
    phase: "REMOTE_VALIDATION_ONLY",
    representation: "clean HTTPS origin and publishable key",
    consumer: "remote-validation only",
    validator: "remote-validation origin and user assertions",
    classification: "REMOTE_VALIDATION_ONLY",
    authorization_required: true,
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "FIXTURE_ONLY"],
  }),
  ...entries("BINDING", [
    "TLSN_CANARY_BINDING_IDENTITY",
    "TLSN_BINDING_TTL_SECONDS",
  ], {
    source: "DEPLOYMENT_INPUT",
    secret: false,
    representation: "Ed25519 SPKI/registry metadata, identity/reference strings, and integer TTL",
    consumer: "deployment-preflight, deployment-manifest, binding authority",
    validator: "authority-key-registry, deployment-preflight, deployment-manifest",
    provenance: "binding.binding_identity and identity_separation metadata",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "REPLAY_BINDING_REUSE", "FIXTURE_ONLY"],
    ownershipByName: {
      TLSN_BINDING_TTL_SECONDS: "DEPLOYMENT_GENERATED",
    },
    ownershipMetadataByName: {
      TLSN_BINDING_TTL_SECONDS: {
        generated_by: "provision-canary-material.mjs fixed deployment policy",
        external_dependency: false,
      },
    },
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
    consumer: "deployment-preflight, deployment-manifest, binding authority",
    validator: "authority-key-registry, deployment-preflight, deployment-manifest",
    purpose: "bind results to the Canary deployment without reusing Replay authority",
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
    purpose: "provide Canary-owned session authority without reusing Replay authority",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "REPLAY_IDENTITY_REUSE"],
  }),
  ...entries("WORKFLOW", [
    ...WORKFLOW_EVIDENCE_INPUTS,
  ], {
    source: "WORKFLOW_CONTEXT",
    secret: false,
    representation: "positive run/attempt, owner/name repository, and fixed workflow file identity",
    consumer: "deployment-preflight, deployment-manifest, deployment-attestation",
    validator: "workflowContextFromEnvironment and checked-out HEAD comparison",
    validity_period: "current workflow run and checked-out HEAD",
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
    ownershipByName: {
      TLSN_ENVIRONMENT: "WORKFLOW_CONTEXT_REQUIRED",
      TLSN_DEPLOYMENT_ROLE: "WORKFLOW_CONTEXT_REQUIRED",
      TLSN_GIT_COMMIT_SHA: "WORKFLOW_CONTEXT_REQUIRED",
      TLSN_CANARY_DEPLOYMENT_ID: "DEPLOYMENT_GENERATED",
      TLSN_CANARY_WORKER_NAME: "DEPLOYMENT_GENERATED",
      TLSN_CANARY_TRIGGER_API_URL: "DEPLOYMENT_GENERATED",
      TLSN_CANARY_TRIGGER_TASK_ID: "DEPLOYMENT_GENERATED",
      TLSN_CANARY_WORKER_INTERNAL_URL: "DEPLOYMENT_GENERATED",
    },
    ownershipMetadataByName: {
      TLSN_GIT_COMMIT_SHA: {
        generated_by: "checked-out git HEAD and deploy-canary",
        can_generate_locally: true,
        external_dependency: false,
      },
      TLSN_CANARY_DEPLOYMENT_ID: {
        generated_by: "FUSOU deployment configuration or explicit provisioner option",
        can_generate_during_deployment: true,
        external_dependency: false,
      },
      TLSN_CANARY_WORKER_NAME: {
        generated_by: "FUSOU Wrangler deployment configuration",
        can_generate_during_deployment: true,
        external_dependency: false,
      },
      TLSN_CANARY_TRIGGER_API_URL: {
        generated_by: "FUSOU Trigger deployment configuration",
        can_generate_during_deployment: true,
        external_dependency: false,
      },
      TLSN_CANARY_TRIGGER_TASK_ID: {
        generated_by: "FUSOU Trigger provisioning",
        can_generate_during_deployment: true,
        external_dependency: false,
      },
      TLSN_CANARY_WORKER_INTERNAL_URL: {
        generated_by: "FUSOU Worker deployment output",
        can_generate_during_deployment: true,
        external_dependency: false,
      },
    },
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
    classification: "REMOTE_VALIDATION_ONLY",
    validity_period: "current commit, deployment identity, and attestation freshness window",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_EXPIRED", "PRESENT_MISMATCHED", "HISTORICAL_ONLY"],
    ownership: "REMOTE_VALIDATION_ONLY",
    external_dependency: false,
    generated_by: "deployment-attestation and remote-validation after deployment",
    generation_stage: "post-deployment validation",
  }),
  ...entries("CREDENTIAL_POLICY", [
    "TLSN_CANARY_FIXTURE_ONLY",
    "TLSN_CANARY_SYNCHRONOUS_RESPONSE_ENABLED",
    "TLSN_BENCHMARK_TIMINGS",
  ], {
    source: "REPOSITORY_STATIC",
    secret: false,
    representation: "explicit boolean/capability flags",
    consumer: "deployment-preflight and deployment-manifest",
    validator: "deployment-preflight and deployment-manifest",
    classification: "REPOSITORY_STATIC",
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
    validity_period: "credential_policy issued_at <= now < expires_at",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "REPLAY_IDENTITY_REUSE"],
  }),
  ...entries("REMOTE_VALIDATION", [
    "TLSN_REMOTE_WORKER_URL",
    "TLSN_REMOTE_WEB_ORIGIN",
    "TLSN_REMOTE_EXPECTED_PROVENANCE_JSON",
  ], {
    source: "DEPLOYMENT_GENERATED",
    classification: "REMOTE_VALIDATION_ONLY",
    secret: false,
    phase: "REMOTE_VALIDATION_ONLY",
    representation: "clean HTTPS origins and explicit JSON artifact paths",
    consumer: "remote-validation and verify-remote-gate",
    validator: "remote-validation and verify-remote-gate",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "PRESENT_MISMATCHED", "FIXTURE_ONLY", "HISTORICAL_ONLY"],
    ownership: "REMOTE_VALIDATION_ONLY",
    external_dependency: false,
    generated_by: "FUSOU deployment-attestation and remote-validation output paths",
    generation_stage: "post-deployment validation",
  }),
  ...entries("REMOTE_VALIDATION", [
    "TLSN_REMOTE_FIXTURE_JSON",
  ], {
    source: "FIXTURE_ONLY",
    classification: "FIXTURE_ONLY",
    secret: false,
    required: false,
    readiness_effect: "CANNOT_SATISFY_REAL_CANARY_READINESS",
    purpose: "synthetic remote-validation input for fixture-only checks",
    representation: "explicit JSON fixture path",
    consumer: "remote-validation fixture path only",
    validator: "remote-validation fixture-only mode",
    failure_conditions: ["MISSING", "PRESENT_INVALID", "FIXTURE_ONLY"],
  }),
]);

export const CANARY_EXTERNAL_ARTIFACT_INTAKE = Object.freeze([
  {
    name: "deployment manifest target provenance",
    category: "TARGET",
    source: "DERIVED",
    classification: "DERIVED",
    purpose: "bind the selected target to the Canary deployment manifest",
    required: true,
    status_when_absent: "MISSING",
    representation: "target section inside TLSN_CANARY_DEPLOYMENT_MANIFEST",
    format: "strict JSON target object with identity, role, binding identity, and validity fields",
    canonicalization: "canonicalJson of the deployment manifest",
    fingerprint: "manifest_id and referenced artifact SHA-256 values",
    issuer: "deployment workflow",
    validity: "issued_at <= now < expires_at",
    current_head_relation: "workflow commit_sha must identify the current checked-out commit and target scope",
    consumer: "canary-deployment-manifest and deployment-preflight",
    validator: "target identity, profile, trust, verifier, expiry, environment, role, and current HEAD checks",
    failure_conditions: ["MISSING", "INVALID", "EXPIRED", "MISMATCHED", "FIXTURE_ONLY", "HISTORICAL_ONLY"],
    readiness_effect: "BLOCKS_CANARY_READINESS",
  },
  {
    name: "canonical complete and sparse profiles",
    category: "PROFILE",
    source: "DEPLOYMENT_INPUT",
    classification: "DEPLOYMENT_INPUT",
    purpose: "bind the Canary configuration to complete and sparse target profiles",
    required: true,
    status_when_absent: "MISSING",
    representation: "canonical UTF-8 JSON profile artifacts or their deployment input hashes",
    format: "canonical UTF-8 JSON profile artifacts plus 43-character base64url SHA-256 digests",
    canonicalization: "canonicalJson before UTF-8 encoding and hashing",
    fingerprint: "complete and sparse profile SHA-256 digests without base64 padding",
    issuer: "deployment operator or provisioning workflow",
    validity: "valid for the target and deployment window",
    current_head_relation: "hashes must match the profile inputs used by the current provisioning run",
    consumer: "provision-canary-material and deployment-preflight",
    validator: "profile-canonical-contract",
    failure_conditions: ["MISSING", "INVALID", "MISMATCHED", "FIXTURE_ONLY", "HISTORICAL_ONLY"],
    readiness_effect: "BLOCKS_CANARY_READINESS",
  },
  {
    name: "target provenance artifact",
    category: "PROVENANCE",
    source: "DEPLOYMENT_INPUT",
    classification: "DEPLOYMENT_INPUT",
    purpose: "bind the target to a current, scoped, non-fixture provenance record",
    required: true,
    status_when_absent: "MISSING",
    representation: "artifact_sha256 and scope in deployment manifest provenance",
    format: "strict provenance object with artifact hash, scope, and validity window",
    canonicalization: "canonicalJson of the provenance object",
    fingerprint: "provenance.artifact_sha256",
    issuer: "deployment operator or provisioning workflow",
    validity: "issued_at <= now < expires_at and the artifact remains current",
    current_head_relation: "must reject evidence from another commit or target scope",
    consumer: "deployment-manifest",
    validator: "strict schema, expiry, fixture/historical rejection",
    failure_conditions: ["MISSING", "INVALID", "EXPIRED", "MISMATCHED", "FIXTURE_ONLY", "HISTORICAL_ONLY"],
    readiness_effect: "BLOCKS_CANARY_READINESS",
  },
  {
    name: "Notary registry and trust root",
    category: "TRUST",
    source: "DEPLOYMENT_INPUT",
    classification: "DEPLOYMENT_INPUT",
    purpose: "establish the configured production trust and Notary verification roots",
    required: true,
    status_when_absent: "MISSING",
    representation: "canonical registry JSON and DER trust root represented as canonical base64url",
    format: "canonical JSON registry and canonical base64url DER certificate",
    canonicalization: "canonicalJson for registry; DER bytes for certificate fingerprint",
    fingerprint: "canonical registry SHA-256 and trust-root DER SHA-256",
    issuer: "security registry configuration and deployment operator",
    validity: "valid for the deployment window and registry version",
    current_head_relation: "fingerprints must match the current deployment inputs",
    consumer: "deployment-preflight and Worker runtime",
    validator: "production-trust-contract and deployment-preflight",
    failure_conditions: ["MISSING", "INVALID", "MISMATCHED", "FIXTURE_ONLY", "HISTORICAL_ONLY"],
    readiness_effect: "BLOCKS_CANARY_READINESS",
  },
  {
    name: "workflow provenance",
    category: "WORKFLOW",
    source: "WORKFLOW_CONTEXT",
    classification: "WORKFLOW_CONTEXT",
    purpose: "bind provisioning to the current repository workflow and commit",
    required: true,
    status_when_absent: "MISSING",
    representation: "workflow environment variables and current checked-out commit",
    format: "positive run/attempt, repository, workflow identity, and 40-character commit",
    canonicalization: "canonical workflow context fields and checked-out HEAD comparison",
    fingerprint: "current commit SHA plus workflow run identity",
    issuer: "CI workflow context",
    validity: "current workflow run and checked-out HEAD",
    current_head_relation: "workflow commit must equal the checked-out repository HEAD",
    consumer: "deployment-preflight and deployment-manifest",
    validator: "deployment-attestation",
    failure_conditions: ["MISSING", "INVALID", "MISMATCHED", "HISTORICAL_ONLY"],
    readiness_effect: "BLOCKS_CANARY_READINESS",
  },
  {
    name: "remote validation report and attestation",
    category: "EVIDENCE_ROOT",
    source: "DEPLOYMENT_GENERATED",
    classification: "DEPLOYMENT_GENERATED",
    purpose: "record current post-deployment remote validation and its signed attestation",
    required: true,
    status_when_absent: "MISSING",
    representation: "immutable JSON paths produced after deployment and remote validation",
    format: "immutable JSON report and attestation artifacts with deployment identity and current commit",
    canonicalization: "canonical JSON before signing or hashing",
    fingerprint: "artifact SHA-256 and attestation signature",
    issuer: "Canary deployment and authorized remote-validation gate",
    validity: "current deployment identity and attestation freshness window",
    current_head_relation: "artifacts must match the current commit, deployment, and target provenance",
    consumer: "verify-remote-gate",
    validator: "deployment-attestation and remote report gate",
    failure_conditions: ["MISSING", "INVALID", "EXPIRED", "MISMATCHED", "FIXTURE_ONLY", "HISTORICAL_ONLY"],
    readiness_effect: "BLOCKS_POST_DEPLOYMENT_EVIDENCE_GATE",
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
    for (const field of ["category", "source", "representation", "input_requirement", "lifetime", "rotation", "consumer", "validator", "failure_conditions"]) {
      if (entry[field] === undefined) throw new Error(`Canary intake entry ${entry.name} is missing ${field}`);
    }
    if (typeof entry.secret !== "boolean") throw new Error(`Canary intake entry ${entry.name} has no secret classification`);
    if (typeof entry.protected_input_channel !== "boolean") throw new Error(`Canary intake entry ${entry.name} has no protected input-channel classification`);
    if (!CANARY_INPUT_CLASSIFICATIONS.includes(entry.classification)) throw new Error(`Canary intake entry ${entry.name} has an invalid classification`);
    if (!CANARY_INPUT_OWNERSHIP.includes(entry.ownership)) throw new Error(`Canary intake entry ${entry.name} has an invalid ownership`);
    if (typeof entry.required !== "boolean") throw new Error(`Canary intake entry ${entry.name} has no required classification`);
    if (typeof entry.authorization_required !== "boolean") throw new Error(`Canary intake entry ${entry.name} has no authorization classification`);
    for (const field of ["purpose", "format", "provenance", "validity_period", "canonicalization", "fingerprint", "readiness_effect", "exposure"]) {
      if (typeof entry[field] !== "string" || entry[field].length === 0) throw new Error(`Canary intake entry ${entry.name} is missing ${field}`);
    }
    for (const field of ["owner", "generated_by", "generation_stage"]) {
      if (typeof entry[field] !== "string" || entry[field].length === 0) throw new Error(`Canary intake entry ${entry.name} is missing ${field}`);
    }
    for (const field of ["can_generate_locally", "can_generate_during_deployment", "external_dependency"]) {
      if (typeof entry[field] !== "boolean") throw new Error(`Canary intake entry ${entry.name} is missing ${field}`);
    }
    if (entry.secret && entry.exposure !== "SECRET") throw new Error(`Canary intake entry ${entry.name} has an invalid secret exposure`);
    if (!entry.secret && entry.exposure !== "PUBLIC") throw new Error(`Canary intake entry ${entry.name} has an invalid public exposure`);
    if (!Array.isArray(entry.failure_conditions) || entry.failure_conditions.length === 0) throw new Error(`Canary intake entry ${entry.name} has no failure conditions`);
  }
  const groupedInputs = new Map();
  for (const entry of CANARY_EXTERNAL_INPUT_INTAKE) {
    if (!entry.required_group) continue;
    if (entry.required) throw new Error(`Canary intake one-of entry ${entry.name} must not be individually required`);
    if (!groupedInputs.has(entry.required_group)) groupedInputs.set(entry.required_group, []);
    groupedInputs.get(entry.required_group).push(entry.name);
  }
  for (const [group, names] of groupedInputs) {
    if (names.length < 2) throw new Error(`Canary intake one-of group ${group} must have at least two members`);
  }
  const privateKeyGroup = groupedInputs.get("REMOTE_DEVICE_PRIVATE_KEY_ONE_OF") ?? [];
  if (JSON.stringify([...privateKeyGroup].sort()) !== JSON.stringify([
    "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL",
    "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE",
  ])) throw new Error("Canary intake private-key one-of group is invalid");
  if (!canaryInputIntakeEntry("TLSN_REMOTE_ACCESS_TOKEN_A")?.required) throw new Error("Canary intake remote access token must be individually required");
  for (const artifact of CANARY_EXTERNAL_ARTIFACT_INTAKE) {
    for (const field of ["name", "category", "source", "classification", "purpose", "representation", "format", "canonicalization", "fingerprint", "issuer", "validity", "current_head_relation", "consumer", "validator", "readiness_effect"]) {
      if (typeof artifact[field] !== "string" || artifact[field].length === 0) throw new Error(`Canary artifact ${artifact.name ?? "unknown"} is missing ${field}`);
    }
    if (typeof artifact.required !== "boolean") throw new Error(`Canary artifact ${artifact.name} has no required classification`);
    if (!Array.isArray(artifact.failure_conditions) || artifact.failure_conditions.length === 0) throw new Error(`Canary artifact ${artifact.name} has no failure conditions`);
    if (!["MISSING", "HISTORICAL", "FIXTURE_ONLY", "SYNTHETIC", "INVALID", "CURRENT"].includes(artifact.status_when_absent)) throw new Error(`Canary artifact ${artifact.name} has an invalid absent status`);
  }
  return true;
}

export function canaryInputIntakeEntry(name) {
  return CANARY_EXTERNAL_INPUT_INTAKE.find((entry) => entry.name === name);
}
