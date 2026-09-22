#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertManifest,
  FORBIDDEN_CANARY_INPUTS,
  WORKFLOW_EVIDENCE_INPUTS,
} from "./deployment-contract.mjs";
import { checkoutCommit, workflowContextFromEnvironment } from "./deployment-attestation.mjs";
import { assertCanaryApprovedInputContract } from "./canary-approved-input-contract.mjs";

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

const REMOTE_SECRET_INPUTS = [
  "TLSN_REMOTE_ACCESS_TOKEN_A",
  "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE",
  "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL",
];

const REMOTE_DEVICE_PRIVATE_KEY_INPUTS = [
  "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE",
  "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL",
];

const TARGET_INPUTS = [
  "TLSN_CANDIDATE_SERVER_IDENTITY",
  "TLSN_CANDIDATE_PROFILE_SHA256",
  "TLSN_CANDIDATE_SPARSE_PROFILE_SHA256",
  "TLSN_CANDIDATE_VERIFIER_KEY_ID",
  "TLSN_CANDIDATE_NOTARY_KEY_ID",
  "TLSN_CANDIDATE_DEVICE_AUTH_URL",
  "TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL",
  "TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS",
  "TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS",
  "TLSN_CANDIDATE_SUPABASE_URL",
  "TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY",
];

const APPROVED_INPUT_CONTRACT_INPUTS = [
  "TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON",
  "TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_VERIFIER_DEPLOYMENT_ID",
];

const DEPLOYMENT_INPUTS = [
  "TLSN_ENVIRONMENT",
  "TLSN_DEPLOYMENT_ROLE",
  "TLSN_BINDING_TTL_SECONDS",
  "TLSN_GIT_COMMIT_SHA",
];

const TRUST_INPUTS = [
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
  "TLSN_CANDIDATE_VERIFIER_KEY_ID",
  "TLSN_CANDIDATE_NOTARY_KEY_ID",
  "TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_SESSION_AUTHORITY_KEY_ID",
  "TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY",
  "TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_BINDING_AUTHORITY_KEY_ID",
  "TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY",
];

const AUTH_INPUTS = [
  "TLSN_CANDIDATE_DEVICE_AUTH_URL",
  "TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL",
  "TLSN_CANDIDATE_SUPABASE_URL",
  "TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY",
  ...REMOTE_VALIDATION_INPUTS,
  ...REMOTE_SECRET_INPUTS,
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
  "TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_CANARY_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_CANARY_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
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

function present(name) {
  return typeof process.env[name] === "string" && process.env[name].trim().length > 0;
}

function statuses(names) {
  return Object.fromEntries(names.map((name) => [name, present(name) ? "PRESENT" : "MISSING"]));
}

function allPresent(names) {
  return names.every(present);
}

function safeArtifactMetadata(value, path) {
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
  const currentCommit = commitSha === currentHead;
  const productionCanary = value?.status === "PASS"
    && value?.environment === "production"
    && (value?.deployment_role ?? deployment.deployment_role) === "canary";
  const approvedCurrent = productionCanary && currentCommit && !synthetic;
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
    approved_current_candidate: approvedCurrent,
  };
}

async function readArtifactMetadata(relativePath) {
  try {
    const value = JSON.parse(await readFile(resolve(packageDirectory, relativePath), "utf8"));
    return safeArtifactMetadata(value, relativePath);
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

function workflowStatus() {
  if (!allPresent(WORKFLOW_INPUTS)) return "MISSING";
  try {
    workflowContextFromEnvironment(process.env, "canary");
    return "PASS";
  } catch {
    return "INVALID";
  }
}

function targetStatus() {
  if (!allPresent(TARGET_INPUTS)) return "MISSING";
  const identity = process.env.TLSN_CANDIDATE_SERVER_IDENTITY?.trim();
  if (!identity || identity === FIXTURE_SERVER_IDENTITY || SYNTHETIC_MARKER.test(identity)) return "FIXTURE_OR_SYNTHETIC";
  return "PRESENT_UNAPPROVED";
}

function deploymentStatus() {
  if (!allPresent(DEPLOYMENT_INPUTS)) return "MISSING";
  if (
    process.env.TLSN_ENVIRONMENT !== "production"
    || process.env.TLSN_DEPLOYMENT_ROLE !== "canary"
    || process.env.TLSN_GIT_COMMIT_SHA?.trim().toLowerCase() !== currentHead
  ) return "INVALID";
  return "PASS";
}

function trustStatus() {
  if (!allPresent(TRUST_INPUTS)) return "MISSING";
  return "PRESENT_UNVERIFIED";
}

function authStatus() {
  const privateKeyPresent = present("TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE")
    || present("TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL");
  const requiredWithoutPrivateKeyAlternative = AUTH_INPUTS.filter(
    (name) => !REMOTE_DEVICE_PRIVATE_KEY_INPUTS.includes(name),
  );
  if (!allPresent(requiredWithoutPrivateKeyAlternative) || !privateKeyPresent) return "MISSING";
  return "PRESENT_UNAPPROVED";
}

function approvedInputContractStatus() {
  if (!allPresent(APPROVED_INPUT_CONTRACT_INPUTS)) return "MISSING";
  try {
    assertCanaryApprovedInputContract(process.env.TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON, {
      fixtureOnly: process.env.TLSN_CANARY_FIXTURE_ONLY === "true",
      currentHead,
      expectedServerIdentity: process.env.TLSN_CANDIDATE_SERVER_IDENTITY?.trim(),
      expectedProfileSha256: process.env.TLSN_CANDIDATE_PROFILE_SHA256?.trim(),
      expectedSparseProfileSha256: process.env.TLSN_CANDIDATE_SPARSE_PROFILE_SHA256?.trim(),
      expectedVerifierKeyId: process.env.TLSN_CANDIDATE_VERIFIER_KEY_ID?.trim(),
      expectedVerifierPublicKeySpki: process.env.TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI?.trim(),
      expectedDeploymentId: process.env.TLSN_CANARY_DEPLOYMENT_ID?.trim(),
      expectedVerifierDeploymentId: process.env.TLSN_CANARY_VERIFIER_DEPLOYMENT_ID?.trim(),
      expectedBindingAuthorityKeyId: process.env.TLSN_CANARY_BINDING_AUTHORITY_KEY_ID?.trim(),
      expectedBindingIdentity: process.env.TLSN_CANARY_BINDING_IDENTITY?.trim(),
      expectedBindingValue: process.env.TLSN_CANARY_BINDING_VALUE?.trim(),
      expectedWorkflow: {
        run_id: process.env.TLSN_WORKFLOW_RUN_ID?.trim(),
        attempt: process.env.TLSN_WORKFLOW_RUN_ATTEMPT?.trim(),
        repository: process.env.TLSN_REPOSITORY?.trim(),
        workflow_file_identity: process.env.TLSN_WORKFLOW_FILE_IDENTITY?.trim(),
      },
    });
    return process.env.TLSN_CANARY_FIXTURE_ONLY === "true" ? "FIXTURE_ONLY" : "APPROVED";
  } catch {
    return "INVALID";
  }
}

function identitySeparationStatus() {
  const forbidden = FORBIDDEN_CANARY_INPUTS.filter(present);
  return forbidden.length === 0 ? "PASS" : "FORBIDDEN_INPUT_PRESENT";
}

function missingInputNames() {
  const names = [
    ...DEPLOYMENT_INPUTS,
    ...APPROVED_INPUT_CONTRACT_INPUTS,
    ...TARGET_INPUTS,
    ...TRUST_INPUTS,
    ...BINDING_INPUTS,
    ...WORKFLOW_INPUTS,
    ...CANARY_RUNTIME_INPUTS,
    ...AUTH_INPUTS.filter((name) => !REMOTE_DEVICE_PRIVATE_KEY_INPUTS.includes(name)),
  ].filter((name) => !present(name));
  if (!REMOTE_DEVICE_PRIVATE_KEY_INPUTS.some(present)) names.push(...REMOTE_DEVICE_PRIVATE_KEY_INPUTS);
  return names.filter((name, index, values) => values.indexOf(name) === index);
}

async function buildReadinessReport(artifacts) {
  const artifactCandidates = artifacts.filter((artifact) => artifact.approved_current_candidate);
  const target = targetStatus();
  const trust = trustStatus();
  const auth = authStatus();
  const workflow = workflowStatus();
  const approvedInputContract = approvedInputContractStatus();
  const binding = allPresent(BINDING_INPUTS) && process.env.TLSN_CANARY_FIXTURE_ONLY !== "true"
    ? "PRESENT_UNVERIFIED"
    : process.env.TLSN_CANARY_FIXTURE_ONLY === "true" ? "FIXTURE_ONLY" : "MISSING";
  const runtime = allPresent(CANARY_RUNTIME_INPUTS) ? "PRESENT" : "MISSING";
  const gates = {
    current_head: /^[0-9a-f]{40}$/.test(currentHead),
    contract: await contractStatus() === "PASS",
    deployment_contract: deploymentStatus() === "PASS",
    approved_input_contract: approvedInputContract === "APPROVED",
    target_provenance: approvedInputContract === "APPROVED" && target === "PRESENT_UNAPPROVED" && artifactCandidates.length > 0,
    trust_material: trust === "PRESENT_UNVERIFIED" && approvedInputContract === "APPROVED",
    authentication: auth === "PRESENT_UNAPPROVED",
    binding: binding === "PRESENT_UNVERIFIED",
    workflow_provenance: workflow === "PASS",
    runtime_inputs: runtime === "PRESENT",
    identity_separation: identitySeparationStatus() === "PASS",
    fixture_contamination_absent: process.env.TLSN_CANARY_FIXTURE_ONLY !== "true"
      && target !== "FIXTURE_OR_SYNTHETIC"
      && artifacts.every((artifact) => !artifact.approved_current_candidate || !artifact.fixture_only),
  };
  const ready = Object.values(gates).every(Boolean);
  return {
    schema_version: 1,
    scope: "tlsn-canary-readiness-audit",
    status: ready ? "READY" : "BLOCKED",
    network_access: "NOT_USED",
    deployment_executed: false,
    current_head: currentHead,
    inputs: {
      deployment: { status: deploymentStatus(), fields: statuses(DEPLOYMENT_INPUTS) },
      target_provenance: { status: target, fields: statuses(TARGET_INPUTS) },
      approved_input_contract: { status: approvedInputContract, fields: statuses(APPROVED_INPUT_CONTRACT_INPUTS) },
      trust: { status: trust, fields: statuses(TRUST_INPUTS) },
      authentication: { status: auth, fields: statuses(AUTH_INPUTS) },
      binding: { status: binding, fields: statuses(BINDING_INPUTS) },
      workflow: { status: workflow, fields: statuses(WORKFLOW_INPUTS) },
      canary_runtime: { status: runtime, fields: statuses(CANARY_RUNTIME_INPUTS) },
      forbidden_inputs: {
        status: identitySeparationStatus(),
        present_names: FORBIDDEN_CANARY_INPUTS.filter(present),
      },
    },
    artifacts: {
      current: artifacts.filter((artifact) => artifact.current_commit && !artifact.historical && !artifact.synthetic),
      historical: artifacts.filter((artifact) => artifact.historical),
      fixture_only: artifacts.filter((artifact) => artifact.fixture_only),
      synthetic: artifacts.filter((artifact) => artifact.synthetic),
      remote_test: artifacts.filter((artifact) => artifact.scope === "remote-deployed-synthetic" || artifact.path.includes("remote-")),
      approved_current_candidates: artifactCandidates,
    },
    gates,
    missing_inputs: missingInputNames(),
    resume_conditions: {
      target_provenance: "Externally approved non-fixture server identity, canonical complete/sparse profiles, and target provenance must be supplied; hostname metadata alone is insufficient.",
      trust: "Externally approved candidate trust root, Notary registry/key ID, verifier identity, Result registry/envelope/root, and authority registries must be supplied and pass deployment-preflight.",
      authentication: "An approved short-lived device/User A credential set and candidate device/Supabase endpoints must be supplied through the existing remote-validation inputs; values must not be committed or recorded.",
      binding: "A Canary-specific binding authority registry/key and fixed Canary binding must be supplied; replay fixed bindings are not acceptable.",
      workflow: "An approved workflow must supply positive run ID/attempt, owner/name repository, current HEAD, and workflow_file_identity=dotenvx+pnpm+wrangler.",
      runtime: "Canary deployment/runtime and Trigger inputs must be supplied through the existing role-specific contract; deploy-canary.mjs must remain the only deploy path.",
      validation: "Run deployment-preflight, then the existing bootstrap -> verifier -> main Canary deployment, /health identity comparison, remote-validation, attestation gate, and offline evidence verification.",
    },
  };
}

async function main() {
  const artifacts = await Promise.all(ARTIFACT_PATHS.map(readArtifactMetadata));
  const report = await buildReadinessReport(artifacts);
  const outputPath = process.env.TLSN_CANARY_READINESS_REPORT_PATH?.trim();
  if (outputPath) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`[tlsn-canary-readiness] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});