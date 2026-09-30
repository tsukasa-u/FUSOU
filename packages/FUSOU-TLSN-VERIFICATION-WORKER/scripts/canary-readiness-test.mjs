#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANARY_SECRET_INPUTS,
  assertManifest,
  FORBIDDEN_CANARY_INPUTS,
  WORKFLOW_EVIDENCE_INPUTS,
} from "./deployment-contract.mjs";
import { checkoutCommit, workflowContextFromEnvironment } from "./deployment-attestation.mjs";
import {
  assertCanaryDeploymentRuntimeAttestation,
  CANARY_DEPLOYMENT_READINESS,
  canaryDeploymentAttestationArtifactPath,
} from "./canary-deployment-attestation.mjs";
import { loadCanaryRuntimeAttestationKeyRegistry } from "./canary-runtime-attestation-key-registry.mjs";
import { CANARY_EXTERNAL_INPUT_INTAKE } from "./canary-external-input-intake.mjs";
import { loadCanaryVerifierExecutionEvidenceBundle } from "./canary-execution-evidence.mjs";
import {
  CANARY_OPERATIONAL_SMOKE_COMPONENTS,
  loadCanaryOperationalSmokeArtifact,
} from "./canary-operational-smoke.mjs";
import {
  CANARY_DEPLOYMENT_MANIFEST_INPUT,
  canaryDeploymentManifestVerificationReport,
  loadCanaryDeploymentManifest,
} from "./canary-deployment-manifest.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const repositoryDirectory = resolve(packageDirectory, "../..");
const inputManifestPath = resolve(packageDirectory, "scripts/production-inputs.json");
const currentHead = checkoutCommit(repositoryDirectory);

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

const TARGET_INPUTS = [
  "TLSN_CANDIDATE_SERVER_IDENTITY",
  "TLSN_CANDIDATE_PROFILE_SHA256",
  "TLSN_CANDIDATE_SPARSE_PROFILE_SHA256",
  "TLSN_CANDIDATE_VERIFIER_KEY_ID",
  "TLSN_CANDIDATE_NOTARY_KEY_ID",
];

const DEPLOYMENT_MANIFEST_INPUTS = [CANARY_DEPLOYMENT_MANIFEST_INPUT];
const ACTIVE_INPUT_INTAKE = CANARY_EXTERNAL_INPUT_INTAKE;
const VERIFIER_EXECUTION_EVIDENCE_INPUTS = [
  "TLSN_CANARY_VERIFIER_EXECUTION_EVIDENCE_PATH",
  "TLSN_CANARY_VERIFIER_EXECUTION_JOB_ID",
  "TLSN_CANARY_VERIFIER_EXECUTION_ATTEMPT_ID",
];
const OPERATIONAL_SMOKE_INPUTS = [
  "TLSN_CANARY_OPERATIONAL_SMOKE_PATH",
  "TLSN_CANARY_READINESS_INVOCATION_ID",
];

const DEPLOYMENT_INPUTS = [
  "TLSN_ENVIRONMENT",
  "TLSN_DEPLOYMENT_ROLE",
  "TLSN_BINDING_TTL_SECONDS",
  "TLSN_GIT_COMMIT_SHA",
];

const TRUST_INPUTS = [
  "TLSN_CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID",
  "TLSN_PRODUCTION_NOTARY_REGISTRY",
  "TLSN_SECURITY_REGISTRY_SET_SHA256",
  "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER",
  "TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_RESULT_SIGNER_KEY_ID",
  "TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY",
  "TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE",
  "TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID",
  "TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_VERIFIER_IDENTITY_KEY_ID",
  "TLSN_CANARY_VERIFIER_IDENTITY_KEY_REGISTRY",
  "TLSN_CANDIDATE_VERIFIER_KEY_ID",
  "TLSN_CANDIDATE_NOTARY_KEY_ID",
  "TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_SESSION_AUTHORITY_KEY_ID",
  "TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY",
  "TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_BINDING_AUTHORITY_KEY_ID",
  "TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY",
];

const NOTARY_INPUTS = [
  "TLSN_PRODUCTION_NOTARY_REGISTRY",
  "TLSN_CANDIDATE_NOTARY_KEY_ID",
  "TLSN_CANDIDATE_NOTARY_ENDPOINT",
];

const DEPLOYMENT_AUTH_INPUTS = [
  "TLSN_CANDIDATE_DEVICE_AUTH_URL",
  "TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL",
  "TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS",
  "TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS",
  "TLSN_CANDIDATE_SUPABASE_URL",
  "TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY",
];

const BINDING_INPUTS = [
  "TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_BINDING_AUTHORITY_KEY_ID",
  "TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY",
  "TLSN_CANARY_BINDING_IDENTITY",
  "TLSN_CANARY_BINDING_VALUE",
  "TLSN_CANARY_SYNCHRONOUS_RESPONSE_ENABLED",
];

const WORKFLOW_INPUTS = [...WORKFLOW_EVIDENCE_INPUTS];
const CANARY_RUNTIME_INPUTS = [
  "TLSN_CANARY_DEPLOYMENT_ID",
  "TLSN_CANARY_VERIFIER_DEPLOYMENT_ID",
  "TLSN_CANARY_WORKER_NAME",
  "TLSN_CANARY_TRIGGER_API_URL",
  "TLSN_CANARY_TRIGGER_TASK_ID",
  "TLSN_CANARY_WORKER_INTERNAL_URL",
  "TLSN_CANARY_VERIFIER_WORKER_INTERNAL_URL",
  "TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_CANARY_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_CANARY_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_CANARY_VERIFIER_IDENTITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_CANARY_TRIGGER_SECRET_KEY",
  "TLSN_CANARY_TRIGGER_CALLBACK_SECRET",
  "TLSN_CANARY_DIRECT_CALLBACK_SECRET",
  "TLSN_CANARY_FIXTURE_ONLY",
  "TLSN_BENCHMARK_TIMINGS",
];

const ARTIFACT_PATHS = [
  "artifacts/tlsn-production-provenance.json",
  "artifacts/tlsn-canary-evidence-chain-current.json",
  "artifacts/tlsn-canary-evidence-chain.json",
  "artifacts/tlsn-remote-validation.json",
];

const SYNTHETIC_MARKER = /(?:^|[._/-])(test|synthetic|fixture|local|staging)(?:$|[._/-])/i;
const FIXTURE_SERVER_IDENTITY = "game.example.test";

const EXTERNAL_AUTHORITY_HANDOFF_GROUPS = [
  {
    id: "TARGET_IDENTITY",
    inputs: ["TLSN_CANDIDATE_SERVER_IDENTITY", "TLSN_CANDIDATE_VERIFIER_KEY_ID"],
    depends_on: [],
    owner: "approved target/configuration authority",
    external_authority: true,
    next_action: "Provide the non-fixture target identity and Presentation/Result verifier identity.",
  },
  {
    id: "PROFILE_POLICY",
    inputs: ["TLSN_CANDIDATE_PROFILE_SHA256", "TLSN_CANDIDATE_SPARSE_PROFILE_SHA256"],
    depends_on: ["TARGET_IDENTITY"],
    owner: "FUSOU canonical profile contract",
    external_authority: false,
    next_action: "Derive the canonical complete and sparse profile hashes from the approved target identity using profile-canonical-contract.",
  },
  {
    id: "NOTARY_TRUST",
    inputs: [
      "TLSN_PRODUCTION_NOTARY_REGISTRY",
      "TLSN_SECURITY_REGISTRY_SET_SHA256",
      "TLSN_CANDIDATE_NOTARY_KEY_ID",
      "TLSN_CANDIDATE_NOTARY_ENDPOINT",
      "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER",
    ],
    depends_on: ["TARGET_IDENTITY", "PROFILE_POLICY"],
    owner: "FUSOU deployment/trust configuration authority",
    external_authority: true,
    next_action: "Provide the FUSOU-NOTARY registry/key/endpoint and candidate trust-root material.",
  },
  {
    id: "VERIFIER_IDENTITY",
    inputs: [
      "TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI",
      "TLSN_CANARY_VERIFIER_IDENTITY_KEY_ID",
      "TLSN_CANARY_VERIFIER_IDENTITY_KEY_REGISTRY",
      "TLSN_CANARY_VERIFIER_DEPLOYMENT_ID",
    ],
    depends_on: ["TARGET_IDENTITY"],
    owner: "FUSOU verifier deployment authority",
    external_authority: true,
    next_action: "Provide the independent Canary verifier public key and deployment identity.",
  },
  {
    id: "AUTHENTICATION_POLICY",
    inputs: [
      "TLSN_CANDIDATE_DEVICE_AUTH_URL",
      "TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL",
      "TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS",
      "TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS",
      "TLSN_CANDIDATE_SUPABASE_URL",
      "TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY",
    ],
    depends_on: ["TARGET_IDENTITY"],
    owner: "approved FUSOU-WEB authentication configuration authority",
    external_authority: true,
    next_action: "Provide the exact candidate authentication URLs, host allowlists, and publishable configuration.",
  },
  {
    id: "SESSION_AUTHORITY",
    inputs: [
      "TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
      "TLSN_CANARY_SESSION_AUTHORITY_KEY_ID",
      "TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY",
    ],
    depends_on: ["TARGET_IDENTITY"],
    owner: "FUSOU Canary provisioner",
    external_authority: false,
    next_action: "Run the existing Canary material provisioner after target inputs are approved.",
  },
  {
    id: "BINDING_AUTHORITY",
    inputs: [
      "TLSN_CANARY_BINDING_IDENTITY",
      "TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
      "TLSN_CANARY_BINDING_AUTHORITY_KEY_ID",
      "TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY",
      "TLSN_CANARY_BINDING_VALUE",
    ],
    depends_on: ["TARGET_IDENTITY"],
    owner: "FUSOU Canary provisioner",
    external_authority: false,
    next_action: "Generate a Canary-specific binding authority/value without reusing Replay material.",
  },
  {
    id: "RESULT_REGISTRY",
    inputs: [
      "TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI",
      "TLSN_CANARY_RESULT_SIGNER_KEY_ID",
      "TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY",
      "TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE",
      "TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID",
      "TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI",
    ],
    depends_on: ["VERIFIER_IDENTITY"],
    owner: "FUSOU Canary provisioner",
    external_authority: false,
    next_action: "Generate and validate the Canary Result registry and signed envelope.",
  },
  {
    id: "WORKFLOW_CONTEXT",
    inputs: [
      "TLSN_WORKFLOW_RUN_ID",
      "TLSN_WORKFLOW_RUN_ATTEMPT",
      "TLSN_REPOSITORY",
      "TLSN_WORKFLOW_FILE_IDENTITY",
    ],
    depends_on: ["TARGET_IDENTITY", "PROFILE_POLICY", "NOTARY_TRUST"],
    owner: "approved FUSOU deployment workflow",
    external_authority: true,
    next_action: "Run the approved workflow with the current checked-out HEAD and fixed toolchain identity.",
  },
  {
    id: "DEPLOYMENT_MANIFEST",
    inputs: [CANARY_DEPLOYMENT_MANIFEST_INPUT],
    depends_on: ["TARGET_IDENTITY", "PROFILE_POLICY", "NOTARY_TRUST", "VERIFIER_IDENTITY", "AUTHENTICATION_POLICY", "SESSION_AUTHORITY", "BINDING_AUTHORITY", "RESULT_REGISTRY", "WORKFLOW_CONTEXT"],
    owner: "FUSOU deployment system",
    external_authority: false,
    next_action: "Generate and validate the current deployment manifest; do not hand-edit it.",
  },
  {
    id: "SECRET_PROVIDER",
    inputs: CANARY_SECRET_INPUTS,
    depends_on: ["SESSION_AUTHORITY", "BINDING_AUTHORITY", "RESULT_REGISTRY", "WORKFLOW_CONTEXT"],
    owner: "configured secret provider",
    external_authority: true,
    next_action: "Supply the actual role-scoped secret values to the protected deployment environment; manifest provider_ref values are metadata and are not resolved by deploy-canary.",
  },
];

function present(name, environment = process.env) {
  return typeof environment[name] === "string" && environment[name].trim().length > 0;
}

function statuses(names, environment = process.env) {
  return Object.fromEntries(names.map((name) => [name, present(name, environment) ? "PRESENT" : "MISSING"]));
}

function postDeploymentStatuses(names, environment = process.env) {
  return Object.fromEntries(names.map((name) => [name, present(name, environment) ? "AVAILABLE_POST_DEPLOYMENT" : "NOT_CONFIGURED_POST_DEPLOYMENT"]));
}

function allPresent(names, environment = process.env) {
  return names.every((name) => present(name, environment));
}

function safeArtifactMetadata(value, path, expectedHead = currentHead) {
  const security = value?.security_identity ?? {};
  const deployment = value?.deployment_identity ?? {};
  const safety = value?.safety ?? {};
  const serverIdentity = security.server_identity ?? value?.server_identity ?? value?.supplied_candidate_inputs?.server_identity;
  const commitSha = value?.git_commit_sha ?? value?.commit_sha ?? value?.current_head ?? value?.live_canary?.git_commit_sha;
  const fixtureOnly = safety.fixture_only === true
    || value?.mode === "fixture-only"
    || value?.fixture_provenance !== undefined
    || serverIdentity === FIXTURE_SERVER_IDENTITY;
  const synthetic = fixtureOnly
    || value?.scope === "remote-deployed-synthetic"
    || SYNTHETIC_MARKER.test(String(value?.repository ?? ""));
  const currentCommit = commitSha === expectedHead;
  const productionCanary = value?.status === "PASS"
    && value?.environment === "production"
    && (value?.deployment_role ?? deployment.deployment_role) === "canary";
  const currentTrustArtifact = productionCanary && currentCommit && !synthetic;
  return {
    path,
    status: value?.status ?? value?.diagnosis ?? null,
    scope: value?.scope ?? value?.artifact ?? null,
    commit_sha: commitSha ?? null,
    current_commit: currentCommit,
    deployment_role: value?.deployment_role ?? deployment.deployment_role ?? null,
    environment: value?.environment ?? null,
    server_identity: serverIdentity ?? null,
    fixture_only: fixtureOnly,
    synthetic,
    historical: commitSha !== undefined && !currentCommit,
    production_canary_shape: productionCanary,
    current_trust_artifact: currentTrustArtifact,
  };
}

async function readArtifactMetadata(relativePath, expectedHead = currentHead, baseDirectory = packageDirectory) {
  try {
    const value = JSON.parse(await readFile(resolve(baseDirectory, relativePath), "utf8"));
    return safeArtifactMetadata(value, relativePath, expectedHead);
  } catch {
    return { path: relativePath, status: "MISSING" };
  }
}

async function contractStatus() {
  try {
    const manifest = JSON.parse(await readFile(inputManifestPath, "utf8"));
    assertManifest(manifest);
    return "PASS";
  } catch {
    return "FAIL";
  }
}

function workflowStatus(environment = process.env, expectedHead = currentHead) {
  if (!allPresent(WORKFLOW_INPUTS, environment)) return "MISSING";
  try {
    workflowContextFromEnvironment(environment, "canary");
    if (environment.TLSN_GIT_COMMIT_SHA?.trim().toLowerCase() !== expectedHead.toLowerCase()) return "INVALID";
    return "PASS";
  } catch {
    return "INVALID";
  }
}

function isFixtureOrSyntheticTarget(environment = process.env) {
  const identity = environment.TLSN_CANDIDATE_SERVER_IDENTITY?.trim();
  return identity === FIXTURE_SERVER_IDENTITY || SYNTHETIC_MARKER.test(identity ?? "");
}

function targetStatus(environment = process.env) {
  if (!allPresent(TARGET_INPUTS, environment)) return "MISSING";
  if (isFixtureOrSyntheticTarget(environment)) return "FIXTURE_OR_SYNTHETIC";
  return "PRESENT";
}

function deploymentStatus(environment = process.env, expectedHead = currentHead) {
  if (!allPresent(DEPLOYMENT_INPUTS, environment)) return "MISSING";
  if (
    environment.TLSN_ENVIRONMENT !== "production"
    || environment.TLSN_DEPLOYMENT_ROLE !== "canary"
    || environment.TLSN_GIT_COMMIT_SHA?.trim().toLowerCase() !== expectedHead.toLowerCase()
  ) return "INVALID";
  return "PASS";
}

function trustStatus(environment = process.env) {
  if (!allPresent(TRUST_INPUTS, environment)) return "MISSING";
  return "PRESENT_UNVERIFIED";
}

function notaryStatus(environment = process.env) {
  if (!allPresent(NOTARY_INPUTS, environment)) return "MISSING";
  return "PRESENT_UNVERIFIED";
}

function authStatus(environment = process.env) {
  return allPresent(DEPLOYMENT_AUTH_INPUTS, environment) ? "PRESENT" : "MISSING";
}

function readinessInputDiagnostics({ deployment, target, deploymentManifest, trust, notary, auth, binding, workflow, runtime, environment = process.env }) {
  const missing = new Set(missingInputNames(environment));
  const statusByName = new Map();
  for (const entry of ACTIVE_INPUT_INTAKE) {
    if (entry.phase === "REMOTE_VALIDATION_ONLY") {
      statusByName.set(entry.name, {
        status: present(entry.name, environment) ? "AVAILABLE_POST_DEPLOYMENT" : "NOT_CONFIGURED_POST_DEPLOYMENT",
        reason: "remote validation input is intentionally outside deployment readiness",
      });
      continue;
    }
    if (missing.has(entry.name)) {
      statusByName.set(entry.name, { status: "MISSING", reason: "required input is not present" });
    } else {
      statusByName.set(entry.name, { status: "PRESENT_UNVERIFIED", reason: "present; the owning gate has not completed" });
    }
  }
  const setGroup = (names, status, reason) => {
    for (const name of names) {
      if (statusByName.get(name)?.status !== "MISSING") statusByName.set(name, { status, reason });
    }
  };
  if (deployment === "PASS") setGroup(DEPLOYMENT_INPUTS, "VALID", "deployment identity matches the checked-out HEAD and canary role");
  if (deployment === "INVALID") setGroup(DEPLOYMENT_INPUTS, "PRESENT_MISMATCHED", "deployment environment, role, or commit does not match the current preflight contract");
  if (target === "FIXTURE_OR_SYNTHETIC") setGroup(TARGET_INPUTS, "PRESENT_INVALID", "fixture, synthetic, local, staging, or historical target identity is not a real Canary target");
  if (trust === "PRESENT_UNVERIFIED") setGroup(TRUST_INPUTS, "PRESENT_UNVERIFIED", "trust metadata is present but requires deployment-preflight and validated registry verification");
  if (notary === "PRESENT_UNVERIFIED") setGroup(NOTARY_INPUTS, "PRESENT_UNVERIFIED", "FUSOU-NOTARY public registry, active key ID, and raw endpoint are present but require deployment-preflight verification");
  if (auth === "PRESENT") setGroup(DEPLOYMENT_AUTH_INPUTS, "PRESENT_UNVERIFIED", "deployment authentication inputs are present and remain preflight-gated");
  if (binding === "PRESENT_UNVERIFIED") setGroup(BINDING_INPUTS, "PRESENT_UNVERIFIED", "Canary binding is present but must be verified as distinct from Replay");
  if (workflow === "PASS") setGroup(WORKFLOW_INPUTS, "VALID", "workflow context and current commit passed deployment-attestation checks");
  if (workflow === "INVALID") setGroup(WORKFLOW_INPUTS, "PRESENT_INVALID", "workflow context is present but invalid");
  if (runtime === "PRESENT") setGroup(CANARY_RUNTIME_INPUTS, "PRESENT_UNVERIFIED", "runtime input is present and remains deployment-gated");
  if (deploymentManifest.status === "VALID") setGroup(DEPLOYMENT_MANIFEST_INPUTS, "VALID", "deployment manifest passed input and provenance validation");
  if (deploymentManifest.status === "INVALID") setGroup(DEPLOYMENT_MANIFEST_INPUTS, "PRESENT_INVALID", "deployment manifest validation failed");
  return ACTIVE_INPUT_INTAKE.map((entry) => ({
    name: entry.name,
    category: entry.category,
    phase: entry.phase ?? "DEPLOYMENT_PREFLIGHT",
    secret: entry.secret,
    status: statusByName.get(entry.name)?.status ?? "MISSING",
    reason: statusByName.get(entry.name)?.reason ?? "required input is not present",
  }));
}

function identitySeparationStatus(environment = process.env) {
  const forbidden = FORBIDDEN_CANARY_INPUTS.filter((name) => present(name, environment));
  return forbidden.length === 0 ? "PASS" : "FORBIDDEN_INPUT_PRESENT";
}

function missingInputNames(environment = process.env) {
  const names = ACTIVE_INPUT_INTAKE
    .filter((entry) => entry.phase !== "REMOTE_VALIDATION_ONLY" && entry.required)
    .filter((entry) => !(entry.category === "PROFILE" && entry.ownership === "DERIVED"))
    .map((entry) => entry.name)
    .filter((name) => !present(name, environment));
  return [...names, ...VERIFIER_EXECUTION_EVIDENCE_INPUTS, ...OPERATIONAL_SMOKE_INPUTS]
    .filter((name, index, values) => values.indexOf(name) === index)
    .filter((name) => !present(name, environment));
}

function externalAuthorityHandoff({ environment = process.env, deploymentManifest, ready = false } = {}) {
  const statusByGroup = new Map();
  const groups = EXTERNAL_AUTHORITY_HANDOFF_GROUPS.map((group) => {
    const manifestValid = group.id === "DEPLOYMENT_MANIFEST" && deploymentManifest?.status === "VALID";
    const fixtureTarget = group.id === "TARGET_IDENTITY" && isFixtureOrSyntheticTarget(environment);
    const derivedProfileInputs = group.id === "PROFILE_POLICY"
      && statusByGroup.get("TARGET_IDENTITY") === "PRESENT_UNVERIFIED"
      && group.inputs.every((name) => !present(name, environment));
    const missingInputs = manifestValid || derivedProfileInputs ? [] : group.inputs.filter((name) => !present(name, environment));
    const unmetDependencies = group.depends_on.filter((id) => statusByGroup.get(id) !== "PRESENT_UNVERIFIED");
    const status = fixtureTarget
      ? "INVALID"
      : group.id === "DEPLOYMENT_MANIFEST" && deploymentManifest?.status === "INVALID"
      ? "INVALID"
      : derivedProfileInputs
      ? unmetDependencies.length === 0 ? "DERIVED" : "BLOCKED_BY_DEPENDENCY"
      : missingInputs.length === 0
      ? unmetDependencies.length === 0 ? "PRESENT_UNVERIFIED" : "BLOCKED_BY_DEPENDENCY"
      : unmetDependencies.length === 0 ? "MISSING" : "BLOCKED_BY_DEPENDENCY";
    statusByGroup.set(group.id, status === "DERIVED" ? "PRESENT_UNVERIFIED" : status);
    return {
      id: group.id,
      status,
      inputs: group.inputs,
      missing_inputs: missingInputs,
      source: derivedProfileInputs ? "profile-canonical-contract" : undefined,
      depends_on: group.depends_on,
      unmet_dependencies: unmetDependencies,
      owner: group.owner,
      external_authority: group.external_authority,
      next_action: group.next_action,
    };
  });
  const firstBlocker = groups.find((group) => !["PRESENT_UNVERIFIED", "DERIVED"].includes(group.status));
  return {
    schema_version: 1,
    scope: "tlsn-canary-external-authority-handoff",
    status: ready
      ? "SATISFIED"
      : firstBlocker?.external_authority
        ? "EXTERNAL_AUTHORITY_REQUIRED"
        : firstBlocker
          ? "DEPLOYMENT_INPUTS_REQUIRED"
          : "READINESS_GATES_REQUIRED",
    first_blocker: firstBlocker ?? null,
    groups,
    package_boundary: {
      active_input: CANARY_DEPLOYMENT_MANIFEST_INPUT,
      external_package_gate: "NOT_AN_ACTIVE_GATE",
      reason: "The active Canary trust boundary is the deployment manifest plus production preflight; historical approval-package artifacts are not accepted.",
    },
  };
}

function runtimeAttestationSummary(path, value, status, reason = null) {
  return {
    status,
    path,
    readiness: value?.readiness ?? null,
    git_commit_sha: value?.repository?.git_commit_sha ?? null,
    workflow_run_id: value?.repository?.workflow_run_id ?? null,
    workflow_run_attempt: value?.repository?.workflow_run_attempt ?? null,
    repository: value?.repository?.repository ?? null,
    workflow_file_identity: value?.repository?.workflow_file_identity ?? null,
    deployment_id: value?.deployment?.authorized_deployment_id ?? value?.runtime_self_reported_identity?.deployment_id ?? null,
    worker_name: value?.deployment?.worker_name ?? value?.runtime_self_reported_identity?.worker_name ?? null,
    platform_deployment_id: value?.deployment?.platform_deployment_id ?? null,
    version_id: value?.version?.version_id ?? value?.runtime_self_reported_identity?.runtime_version?.version_id ?? null,
    manifest_id: value?.deployment?.manifest_id ?? null,
    captured_at: value?.captured_at ?? null,
    attestation_signer_key_id: value?.attestation_signer_key_id ?? null,
    verifier_deployment_id: value?.verifier_deployment?.authorized_deployment_id ?? null,
    verifier_platform_deployment_id: value?.verifier_deployment?.platform_deployment_id ?? null,
    verifier_version_id: value?.verifier_version?.version_id ?? null,
    verifier_key_id: value?.verifier_identity?.key_id ?? null,
    signature_algorithm: value?.signature_algorithm ?? null,
    signature_valid: value?.signature_valid ?? false,
    cross_binding: value?.cross_binding ?? {
      status: "BLOCKED",
      workflow_attestation: false,
      manifest_attestation: false,
      environment_attestation: false,
      version_serving: false,
      verifier_identity_binding: false,
      attestation_fresh: false,
      reason: "Runtime Attestation cross-binding was not validated",
    },
    reason,
  };
}

async function readRuntimeAttestation(environment = process.env, expectedHead = currentHead, baseDirectory = packageDirectory, {
  workflow = null,
  deploymentManifest = null,
  runtimeAttestationKeyRegistry = null,
  now = new Date(),
} = {}) {
  const path = canaryDeploymentAttestationArtifactPath({
    baseDirectory,
    explicitPath: environment.TLSN_CANARY_DEPLOYMENT_ATTESTATION_PATH,
    deploymentId: environment.TLSN_CANARY_DEPLOYMENT_ID,
    workflowRunId: environment.TLSN_WORKFLOW_RUN_ID,
    workflowRunAttempt: environment.TLSN_WORKFLOW_RUN_ATTEMPT,
  });
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    const status = error?.code === "ENOENT" ? "MISSING" : "INVALID";
    return runtimeAttestationSummary(path, null, status, error?.code === "ENOENT" ? "Runtime Attestation artifact was not found" : "Runtime Attestation artifact is not valid JSON");
  }
  if (value?.scope === "tlsn-canary-deployment-runtime-attestation-fixture"
    || value?.status === "FIXTURE_ONLY"
    || value?.evidence?.synthetic === true) {
    return runtimeAttestationSummary(path, value, "FIXTURE_ONLY", "synthetic or fixture Runtime Attestation cannot authorize human gameplay");
  }
  try {
    const verified = assertCanaryDeploymentRuntimeAttestation(value, {
      currentHead: expectedHead,
      workflow,
      deploymentManifest,
      environment,
      runtimeAttestationKeyRegistry,
      now,
    });
    return { ...runtimeAttestationSummary(path, value, "VALID"), ...verified };
  } catch (error) {
    return runtimeAttestationSummary(path, value, "INVALID", error instanceof Error ? error.message : String(error));
  }
}

async function readCanaryVerifierExecutionEvidence(environment, runtimeIdentity, now) {
  const missing = VERIFIER_EXECUTION_EVIDENCE_INPUTS.filter((name) => !present(name, environment));
  if (missing.length > 0) {
    return {
      status: "MISSING",
      execution_receipt_evidence: "NOT_RUN",
      missing_inputs: missing,
      reason: "Provide the Canary execution evidence bundle and its independently expected job and attempt IDs.",
    };
  }
  if (runtimeIdentity?.status !== "VALID" || runtimeIdentity.signature_valid !== true) {
    return {
      status: "BLOCKED",
      execution_receipt_evidence: "BLOCKED",
      missing_inputs: [],
      reason: "A validated signed Runtime Attestation is required before the execution receipt can be evaluated.",
    };
  }
  let verifierIdentityKeyRegistry;
  try {
    verifierIdentityKeyRegistry = JSON.parse(environment.TLSN_CANARY_VERIFIER_IDENTITY_KEY_REGISTRY);
  } catch {
    return {
      status: "INVALID",
      execution_receipt_evidence: "INVALID",
      missing_inputs: [],
      reason: "Canary Verifier identity key registry is not valid JSON.",
    };
  }
  try {
    const evidence = await loadCanaryVerifierExecutionEvidenceBundle({
      bundlePath: environment.TLSN_CANARY_VERIFIER_EXECUTION_EVIDENCE_PATH,
      verifierIdentityKeyRegistry,
      trustedRuntimeIdentity: runtimeIdentity,
      expectedJobId: environment.TLSN_CANARY_VERIFIER_EXECUTION_JOB_ID,
      expectedVerificationAttemptId: environment.TLSN_CANARY_VERIFIER_EXECUTION_ATTEMPT_ID,
      now,
    });
    return {
      status: "PASS",
      execution_receipt_evidence: "PASS",
      missing_inputs: [],
      ...evidence,
    };
  } catch (error) {
    return {
      status: "INVALID",
      execution_receipt_evidence: "INVALID",
      missing_inputs: [],
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readCanaryOperationalSmoke(environment, runtimeIdentity, deploymentManifest, expectedHead, runtimeAttestationKeyRegistry, now) {
  const artifactPath = environment.TLSN_CANARY_OPERATIONAL_SMOKE_PATH?.trim();
  const readinessInvocationId = environment.TLSN_CANARY_READINESS_INVOCATION_ID?.trim();
  if (!artifactPath || !readinessInvocationId) {
    return {
      status: "NOT_RUN",
      readiness: "BLOCKED",
      components: Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => [component, "NOT_RUN"])),
      reason: "A signed smoke artifact from the live runner and an independent readiness invocation UUID are required; missing evidence remains NOT_RUN and BLOCKED.",
    };
  }
  if (runtimeIdentity?.status !== "VALID" || runtimeIdentity.signature_valid !== true || !runtimeAttestationKeyRegistry) {
    return {
      status: "BLOCKED",
      readiness: "BLOCKED",
      components: Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => [component, "NOT_RUN"])),
      reason: "A validated signed Runtime Attestation is required before operational smoke evidence can be evaluated.",
    };
  }
  try {
    return await loadCanaryOperationalSmokeArtifact({
      artifactPath,
      trustedRuntimeIdentity: runtimeIdentity,
      deploymentManifest,
      readinessInvocationId,
      runtimeAttestationKeyRegistry,
      currentHead: expectedHead,
      expectedDeploymentId: runtimeIdentity.deployment_id,
      now,
    });
  } catch (error) {
    return {
      status: "INVALID",
      readiness: "BLOCKED",
      components: Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => [component, "NOT_RUN"])),
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * validatedDeploymentManifest is an internal test-fixture injection point.
 * Production callers omit it so the main path loads and validates the manifest artifact.
 */
export async function buildReadinessReport({
  environment = process.env,
  expectedHead = currentHead,
  artifactPaths = ARTIFACT_PATHS,
  baseDirectory = packageDirectory,
  validatedDeploymentManifest = null,
  runtimeAttestationKeyRegistry = null,
  now = new Date(),
} = {}) {
  const artifacts = await Promise.all(artifactPaths.map((path) => readArtifactMetadata(path, expectedHead, baseDirectory)));
  const currentTrustArtifacts = artifacts.filter((artifact) => artifact.current_trust_artifact);
  const deploymentManifestPath = environment[CANARY_DEPLOYMENT_MANIFEST_INPUT]?.trim();
  let deploymentManifest = {
    status: "ABSENT",
    ...canaryDeploymentManifestVerificationReport({
      status: "ABSENT",
      diagnostics: [{ reason: "Canary deployment manifest was not supplied" }],
    }),
  };
  if (validatedDeploymentManifest) {
    deploymentManifest = {
      status: "VALID",
      ...canaryDeploymentManifestVerificationReport({ status: "VALID", manifest: validatedDeploymentManifest }),
    };
  } else if (deploymentManifestPath) {
    try {
      const manifest = await loadCanaryDeploymentManifest(deploymentManifestPath, { environment, currentHead: expectedHead, now });
      validatedDeploymentManifest = manifest;
      deploymentManifest = {
        status: "VALID",
        ...canaryDeploymentManifestVerificationReport({ status: "VALID", manifest }),
      };
    } catch (error) {
      deploymentManifest = {
        status: "INVALID",
        ...canaryDeploymentManifestVerificationReport({
          status: "INVALID",
          diagnostics: Array.isArray(error?.diagnostics) ? error.diagnostics : [{ reason: "Canary deployment manifest validation failed" }],
        }),
      };
    }
  }
  const target = targetStatus(environment);
  const trust = trustStatus(environment);
  const notary = notaryStatus(environment);
  const auth = authStatus(environment);
  const workflow = workflowStatus(environment, expectedHead);
  let currentWorkflow = null;
  if (workflow === "PASS") {
    try {
      currentWorkflow = workflowContextFromEnvironment(environment, "canary");
    } catch {
      currentWorkflow = null;
    }
  }
  if (!runtimeAttestationKeyRegistry) {
    try {
      ({ registry: runtimeAttestationKeyRegistry } = await loadCanaryRuntimeAttestationKeyRegistry());
    } catch {
      runtimeAttestationKeyRegistry = null;
    }
  }
  const runtimeAttestation = await readRuntimeAttestation(environment, expectedHead, baseDirectory, {
    workflow: currentWorkflow,
    deploymentManifest: validatedDeploymentManifest,
    runtimeAttestationKeyRegistry,
    now,
  });
  const verifierIdentityBinding = await readCanaryVerifierExecutionEvidence(environment, runtimeAttestation, now);
  const operationalSmoke = await readCanaryOperationalSmoke(
    environment,
    runtimeAttestation,
    validatedDeploymentManifest,
    expectedHead,
    runtimeAttestationKeyRegistry,
    now,
  );
  const binding = allPresent(BINDING_INPUTS, environment) && environment.TLSN_CANARY_FIXTURE_ONLY !== "true"
    ? "PRESENT_UNVERIFIED"
    : environment.TLSN_CANARY_FIXTURE_ONLY === "true" ? "FIXTURE_ONLY" : "MISSING";
  const runtime = allPresent(CANARY_RUNTIME_INPUTS, environment) ? "PRESENT" : "MISSING";
  const gates = {
    current_head: /^[0-9a-f]{40}$/.test(expectedHead),
    contract: await contractStatus() === "PASS",
    deployment_manifest: deploymentManifest.status === "VALID",
    deployment_contract: deploymentStatus() === "PASS",
    target_provenance: deploymentManifest.status === "VALID" && target === "PRESENT",
    trust_material: trust === "PRESENT_UNVERIFIED" && deploymentManifest.status === "VALID",
    notary_binding: notary === "PRESENT_UNVERIFIED" && deploymentManifest.status === "VALID",
    authentication: auth === "PRESENT",
    binding: binding === "PRESENT_UNVERIFIED",
    workflow_provenance: workflow === "PASS",
    verifier_identity_binding: verifierIdentityBinding.status === "PASS",
    operational_smoke: operationalSmoke.status === "PASS",
    runtime_attestation: runtimeAttestation.status === "VALID"
      && runtimeAttestation.readiness === CANARY_DEPLOYMENT_READINESS,
    cross_binding: runtimeAttestation.cross_binding?.status === "PASS",
    attestation_fresh: runtimeAttestation.cross_binding?.attestation_fresh === true,
    attestation_signature: runtimeAttestation.status === "VALID" && runtimeAttestation.signature_valid === true,
    identity_separation: identitySeparationStatus(environment) === "PASS",
    fixture_contamination_absent: environment.TLSN_CANARY_FIXTURE_ONLY !== "true"
      && target !== "FIXTURE_OR_SYNTHETIC"
      && artifacts.every((artifact) => !artifact.current_trust_artifact || !artifact.fixture_only),
  };
  const ready = Object.values(gates).every(Boolean);
  const externalAuthority = externalAuthorityHandoff({ environment, deploymentManifest, ready });
  return {
    schema_version: 1,
    scope: "tlsn-canary-readiness-audit",
    status: ready ? "READY" : "BLOCKED",
    network_access: "NOT_USED",
    deployment_executed: false,
    current_head: expectedHead,
    inputs: {
      deployment: { status: deploymentStatus(environment, expectedHead), fields: statuses(DEPLOYMENT_INPUTS, environment) },
      target_provenance: { status: target, fields: statuses(TARGET_INPUTS, environment) },
        deployment_manifest: deploymentManifest,
      trust: { status: trust, fields: statuses(TRUST_INPUTS, environment) },
      notary: { status: notary, fields: statuses(NOTARY_INPUTS, environment), owner: "FUSOU", service: "FUSOU-NOTARY", protocol: "tlsn-v0.1.0-alpha.15", transport: "raw_tcp", current_presentation_path: "REQUIRED" },
      authentication: { status: auth, fields: statuses(DEPLOYMENT_AUTH_INPUTS, environment) },
      runtime_attestation: runtimeAttestation,
      verifier_identity_binding: {
        status: verifierIdentityBinding.status,
        runtime_attestation: runtimeAttestation.cross_binding?.verifier_identity_binding === true ? "PASS" : "NOT_RUN",
        execution_receipt_evidence: verifierIdentityBinding.execution_receipt_evidence,
        missing_inputs: verifierIdentityBinding.missing_inputs,
        evidence: verifierIdentityBinding.status === "PASS" ? verifierIdentityBinding : null,
        reason: verifierIdentityBinding.reason ?? null,
      },
      operational_smoke: {
        status: operationalSmoke.status,
        ...Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => [
          component,
          operationalSmoke.components?.[component] ?? "NOT_RUN",
        ])),
        ...(operationalSmoke.artifact_path ? { artifact_path: operationalSmoke.artifact_path } : {}),
        reason: operationalSmoke.reason ?? null,
      },
      cross_binding: runtimeAttestation.cross_binding,
      remote_validation: {
        status: "POST_DEPLOYMENT_ONLY",
        fields: postDeploymentStatuses(REMOTE_VALIDATION_INPUTS, environment),
      },
      binding: { status: binding, fields: statuses(BINDING_INPUTS, environment) },
      workflow: { status: workflow, fields: statuses(WORKFLOW_INPUTS, environment) },
      canary_runtime: { status: runtime, fields: statuses(CANARY_RUNTIME_INPUTS, environment) },
      forbidden_inputs: {
        status: identitySeparationStatus(environment),
        present_names: FORBIDDEN_CANARY_INPUTS.filter((name) => present(name, environment)),
      },
    },
    cross_binding: runtimeAttestation.cross_binding,
    artifacts: {
      current: artifacts.filter((artifact) => artifact.current_commit && !artifact.historical && !artifact.synthetic),
      historical: artifacts.filter((artifact) => artifact.historical),
      fixture_only: artifacts.filter((artifact) => artifact.fixture_only),
      synthetic: artifacts.filter((artifact) => artifact.synthetic),
      remote_test: artifacts.filter((artifact) => artifact.scope === "remote-deployed-synthetic" || artifact.path.includes("remote-")),
      current_trust_artifacts: currentTrustArtifacts,
    },
    gates,
    external_authority: externalAuthority,
    input_diagnostics: readinessInputDiagnostics({ deployment: deploymentStatus(environment, expectedHead), target, deploymentManifest, trust, notary, auth, binding, workflow, runtime, environment }),
    missing_inputs: missingInputNames(environment),
    resume_conditions: {
      target_provenance: "A non-fixture server identity and canonical complete/sparse profiles must be supplied; hostname metadata alone is insufficient.",
      trust: "Candidate trust root, verifier identity, Result registry/envelope/root, and authority registries must be supplied and pass deployment-preflight.",
      notary: "FUSOU-NOTARY public registry, active key ID, and raw host:port endpoint must be supplied; the current Presentation verification path remains blocked without all three.",
      authentication: "Candidate device-auth and Supabase endpoints must be supplied and pass deployment-preflight. User/device credentials belong only to post-deployment remote validation and are not a deployment readiness gate.",
      binding: "A Canary-specific binding authority registry/key and fixed Canary binding must be supplied; replay fixed bindings are not acceptable.",
      workflow: "The deployment workflow must supply positive run ID/attempt, owner/name repository, current HEAD, and workflow_file_identity=dotenvx+pnpm+wrangler.",
      verifier_identity_binding: "Capture a Canary execution evidence bundle and provide its job ID and verification attempt ID independently; readiness binds the signed receipt to exact Presentation/Result bytes and the current Runtime Attestation.",
      operational_smoke: "Run an approved live pre-gameplay smoke and provide its signed artifact plus every referenced raw component observation; offline tests cannot set the operational_smoke gate to PASS.",
      runtime: "Canary deployment/runtime and Trigger inputs must be supplied through the existing role-specific contract; deploy-canary.mjs must remain the only deploy path.",
      validation: "Run deployment-preflight, then the existing bootstrap -> verifier -> main Canary deployment, /health identity comparison, remote-validation, attestation gate, and offline evidence verification.",
    },
  };
}

async function main() {
  const report = await buildReadinessReport();
  const outputPath = process.env.TLSN_CANARY_READINESS_REPORT_PATH?.trim();
  if (outputPath) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[tlsn-canary-readiness] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  });
}