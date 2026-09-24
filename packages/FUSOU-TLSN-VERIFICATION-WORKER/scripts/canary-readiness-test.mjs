#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertManifest,
  FORBIDDEN_CANARY_INPUTS,
  WORKFLOW_EVIDENCE_INPUTS,
} from "./deployment-contract.mjs";
import { checkoutCommit, workflowContextFromEnvironment } from "./deployment-attestation.mjs";
import { CANARY_EXTERNAL_INPUT_INTAKE } from "./canary-external-input-intake.mjs";
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

function postDeploymentStatuses(names) {
  return Object.fromEntries(names.map((name) => [name, present(name) ? "AVAILABLE_POST_DEPLOYMENT" : "NOT_CONFIGURED_POST_DEPLOYMENT"]));
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
  return "PRESENT";
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

function notaryStatus() {
  if (!allPresent(NOTARY_INPUTS)) return "MISSING";
  return "PRESENT_UNVERIFIED";
}

function authStatus() {
  return allPresent(DEPLOYMENT_AUTH_INPUTS) ? "PRESENT" : "MISSING";
}

function readinessInputDiagnostics({ deployment, target, deploymentManifest, trust, notary, auth, binding, workflow, runtime }) {
  const missing = new Set(missingInputNames());
  const statusByName = new Map();
  for (const entry of ACTIVE_INPUT_INTAKE) {
    if (entry.phase === "REMOTE_VALIDATION_ONLY") {
      statusByName.set(entry.name, {
        status: present(entry.name) ? "AVAILABLE_POST_DEPLOYMENT" : "NOT_CONFIGURED_POST_DEPLOYMENT",
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

function identitySeparationStatus() {
  const forbidden = FORBIDDEN_CANARY_INPUTS.filter(present);
  return forbidden.length === 0 ? "PASS" : "FORBIDDEN_INPUT_PRESENT";
}

function missingInputNames() {
  const names = ACTIVE_INPUT_INTAKE
    .filter((entry) => entry.phase !== "REMOTE_VALIDATION_ONLY" && entry.required)
    .map((entry) => entry.name)
    .filter((name) => !present(name));
  return names.filter((name, index, values) => values.indexOf(name) === index);
}

async function buildReadinessReport(artifacts) {
  const currentTrustArtifacts = artifacts.filter((artifact) => artifact.current_trust_artifact);
  const deploymentManifestPath = process.env[CANARY_DEPLOYMENT_MANIFEST_INPUT]?.trim();
  let deploymentManifest = {
    status: "ABSENT",
    ...canaryDeploymentManifestVerificationReport({
      status: "ABSENT",
      diagnostics: [{ reason: "Canary deployment manifest was not supplied" }],
    }),
  };
  if (deploymentManifestPath) {
    try {
      const manifest = await loadCanaryDeploymentManifest(deploymentManifestPath, { environment: process.env, currentHead });
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
  const target = targetStatus();
  const trust = trustStatus();
  const notary = notaryStatus();
  const auth = authStatus();
  const workflow = workflowStatus();
  const binding = allPresent(BINDING_INPUTS) && process.env.TLSN_CANARY_FIXTURE_ONLY !== "true"
    ? "PRESENT_UNVERIFIED"
    : process.env.TLSN_CANARY_FIXTURE_ONLY === "true" ? "FIXTURE_ONLY" : "MISSING";
  const runtime = allPresent(CANARY_RUNTIME_INPUTS) ? "PRESENT" : "MISSING";
  const gates = {
    current_head: /^[0-9a-f]{40}$/.test(currentHead),
    contract: await contractStatus() === "PASS",
    deployment_manifest: deploymentManifest.status === "VALID",
    deployment_contract: deploymentStatus() === "PASS",
    target_provenance: deploymentManifest.status === "VALID" && target === "PRESENT" && currentTrustArtifacts.length > 0,
    trust_material: trust === "PRESENT_UNVERIFIED" && deploymentManifest.status === "VALID",
    notary_binding: notary === "PRESENT_UNVERIFIED" && deploymentManifest.status === "VALID",
    authentication: auth === "PRESENT",
    binding: binding === "PRESENT_UNVERIFIED",
    workflow_provenance: workflow === "PASS",
    runtime_inputs: runtime === "PRESENT",
    identity_separation: identitySeparationStatus() === "PASS",
    fixture_contamination_absent: process.env.TLSN_CANARY_FIXTURE_ONLY !== "true"
      && target !== "FIXTURE_OR_SYNTHETIC"
      && artifacts.every((artifact) => !artifact.current_trust_artifact || !artifact.fixture_only),
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
        deployment_manifest: deploymentManifest,
      trust: { status: trust, fields: statuses(TRUST_INPUTS) },
      notary: { status: notary, fields: statuses(NOTARY_INPUTS), owner: "FUSOU", service: "FUSOU-NOTARY", protocol: "tlsn-v0.1.0-alpha.15", transport: "raw_tcp", current_presentation_path: "REQUIRED" },
      authentication: { status: auth, fields: statuses(DEPLOYMENT_AUTH_INPUTS) },
      remote_validation: {
        status: "POST_DEPLOYMENT_ONLY",
        fields: postDeploymentStatuses(REMOTE_VALIDATION_INPUTS),
      },
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
      current_trust_artifacts: currentTrustArtifacts,
    },
    gates,
    input_diagnostics: readinessInputDiagnostics({ deployment: deploymentStatus(), target, deploymentManifest, trust, notary, auth, binding, workflow, runtime }),
    missing_inputs: missingInputNames(),
    resume_conditions: {
      target_provenance: "A non-fixture server identity and canonical complete/sparse profiles must be supplied; hostname metadata alone is insufficient.",
      trust: "Candidate trust root, verifier identity, Result registry/envelope/root, and authority registries must be supplied and pass deployment-preflight.",
      notary: "FUSOU-NOTARY public registry, active key ID, and raw host:port endpoint must be supplied; the current Presentation verification path remains blocked without all three.",
      authentication: "Candidate device-auth and Supabase endpoints must be supplied and pass deployment-preflight. User/device credentials belong only to post-deployment remote validation and are not a deployment readiness gate.",
      binding: "A Canary-specific binding authority registry/key and fixed Canary binding must be supplied; replay fixed bindings are not acceptable.",
      workflow: "The deployment workflow must supply positive run ID/attempt, owner/name repository, current HEAD, and workflow_file_identity=dotenvx+pnpm+wrangler.",
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