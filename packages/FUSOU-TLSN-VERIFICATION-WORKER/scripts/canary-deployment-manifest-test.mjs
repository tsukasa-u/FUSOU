import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkoutCommit } from "./deployment-attestation.mjs";
import {
  CANARY_DEPLOYMENT_MANIFEST_SCHEMA_VERSION,
  CANARY_DEPLOYMENT_MANIFEST_SCOPE,
  assertCanaryDeploymentManifest,
  canaryDeploymentManifestBinding,
  createCanaryDeploymentManifest,
  deploymentManifestIdentity,
} from "./canary-deployment-manifest.mjs";
import {
  assertCanaryDeploymentAuthorized,
  authorizeCanaryDeployment,
} from "./canary-deployment-authorization.mjs";
import { inputsForRole, secretInputsForRole } from "./deployment-contract.mjs";
import { canonicalNotaryRegistryJson, notaryRegistrySha256 } from "./production-trust-contract.mjs";
import { loadCanaryFixtureOnlyFixture } from "./canary-fixture-only-data.mjs";

const packageRoot = resolve(new URL("..", import.meta.url).pathname);
const currentHead = checkoutCommit(packageRoot);
const artifactPath = "scripts/canary-deployment-manifest-test.mjs";
const artifactBytes = await readFile(resolve(packageRoot, artifactPath));
const { fixture: notaryFixture } = loadCanaryFixtureOnlyFixture("p50");
const notaryKeyId = "notary-manifest-test";
const notaryRegistryRaw = JSON.stringify({ [notaryKeyId]: notaryFixture.notary_key_base64 });
const notaryRegistryCanonical = canonicalNotaryRegistryJson(notaryRegistryRaw);
const environment = {
  TLSN_ENVIRONMENT: "production",
  TLSN_DEPLOYMENT_ROLE: "canary",
  TLSN_CANDIDATE_SERVER_IDENTITY: "game.example.com",
  TLSN_CANARY_BINDING_IDENTITY: "canary-binding-2026",
  TLSN_CANARY_DEPLOYMENT_ID: "canary-deployment-2026",
  TLSN_REPOSITORY: "fusou/fusou",
  TLSN_WORKFLOW_RUN_ID: "42",
  TLSN_WORKFLOW_RUN_ATTEMPT: "1",
  TLSN_WORKFLOW_FILE_IDENTITY: "dotenvx+pnpm+wrangler",
  TLSN_GIT_COMMIT_SHA: currentHead,
  TLSN_ENVIRONMENT_MARKER: "ignored",
  TLSN_CANDIDATE_PROFILE_SHA256: "profile-value",
  TLSN_CANDIDATE_NOTARY_KEY_ID: notaryKeyId,
  TLSN_PRODUCTION_NOTARY_REGISTRY: notaryRegistryCanonical,
  TLSN_CANDIDATE_NOTARY_ENDPOINT: "notary.example.com:7047",
};

for (const name of inputsForRole("canary")) {
  if (secretInputsForRole("canary").includes(name)) continue;
  environment[name] ??= name === "TLSN_PRODUCTION_NOTARY_REGISTRY" || name.endsWith("_REGISTRY_ENVELOPE")
    ? "{}"
    : `${name}-value`;
}
environment.TLSN_CANARY_WORKER_NAME = "fusou-tlsn-verification-canary";

function hashValue(value) {
  return import("node:crypto").then(({ createHash }) => createHash("sha256").update(value).digest("base64url"));
}

const artifactHash = await hashValue(artifactBytes);
const secretProviderReferences = secretInputsForRole("canary").map((inputName) => ({
  input_name: inputName,
  provider_ref: `deployment-secret/${inputName}`,
}));

const manifest = {
  schema_version: CANARY_DEPLOYMENT_MANIFEST_SCHEMA_VERSION,
  scope: CANARY_DEPLOYMENT_MANIFEST_SCOPE,
  manifest_id: "pending",
  issued_at: "2026-01-01T00:00:00.000Z",
  expires_at: "2099-01-01T00:00:00.000Z",
  target: {
    server_identity: environment.TLSN_CANDIDATE_SERVER_IDENTITY,
    environment: environment.TLSN_ENVIRONMENT,
    deployment_role: environment.TLSN_DEPLOYMENT_ROLE,
    binding_identity: environment.TLSN_CANARY_BINDING_IDENTITY,
  },
  notary: {
    endpoint: environment.TLSN_CANDIDATE_NOTARY_ENDPOINT,
    key_id: notaryKeyId,
    verifying_key: notaryFixture.notary_key_base64,
    registry_sha256: notaryRegistrySha256(notaryRegistryCanonical),
    owner: "FUSOU",
    service: "FUSOU-NOTARY",
    protocol: "tlsn-v0.1.0-alpha.15",
    transport: "raw_tcp",
    mpc_role: "verifier",
    origin_connection: "prover_owned",
    session_timeout_seconds: 300,
    max_concurrent_sessions: 1,
  },
  workflow: {
    repository: environment.TLSN_REPOSITORY,
    run_id: environment.TLSN_WORKFLOW_RUN_ID,
    run_attempt: environment.TLSN_WORKFLOW_RUN_ATTEMPT,
    workflow_file_identity: environment.TLSN_WORKFLOW_FILE_IDENTITY,
    commit_sha: currentHead,
  },
  inputs: await Promise.all(inputsForRole("canary")
    .filter((name) => !secretInputsForRole("canary").includes(name))
    .map(async (name) => ({
      name,
      value_sha256: await hashValue(environment[name]),
      provenance: "deployment-input",
    }))),
  artifacts: [{ name: "manifest-test-source", path: artifactPath, sha256: artifactHash }],
  deployment: {
    deployment_id: environment.TLSN_CANARY_DEPLOYMENT_ID,
    worker_name: "fusou-tlsn-verification-canary",
    verifier_worker_name: "fusou-tlsn-verifier-canary",
  },
  secret_provider: {
    references: secretInputsForRole("canary").map((inputName) => ({
      input_name: inputName,
      provider_ref: `deployment-secret/${inputName}`,
    })),
  },
};
manifest.manifest_id = deploymentManifestIdentity(manifest);

function alteredManifest(change) {
  const altered = structuredClone(manifest);
  change(altered);
  altered.manifest_id = deploymentManifestIdentity(altered);
  return JSON.stringify(altered);
}

function alteredManifestWithoutIdentity(change) {
  const altered = structuredClone(manifest);
  change(altered);
  return JSON.stringify(altered);
}

async function assertManifestRejected(raw, message) {
  await assert.rejects(
    () => assertCanaryDeploymentManifest(raw, { packageRoot, environment, currentHead, now: new Date("2026-06-01T00:00:00.000Z") }),
    message,
  );
}

const valid = await assertCanaryDeploymentManifest(JSON.stringify(manifest), { packageRoot, environment, currentHead, now: new Date("2026-06-01T00:00:00.000Z") });
assert.equal(valid.manifest_id, manifest.manifest_id);
assert.equal(valid.target.server_identity, "game.example.com");
assert.deepEqual(canaryDeploymentManifestBinding(valid), {
  manifest_id: manifest.manifest_id,
  issued_at: manifest.issued_at,
  expires_at: manifest.expires_at,
  deployment_id: environment.TLSN_CANARY_DEPLOYMENT_ID,
  worker_name: environment.TLSN_CANARY_WORKER_NAME,
  deployment_role: environment.TLSN_DEPLOYMENT_ROLE,
  workflow_run_id: environment.TLSN_WORKFLOW_RUN_ID,
  workflow_run_attempt: environment.TLSN_WORKFLOW_RUN_ATTEMPT,
  repository: environment.TLSN_REPOSITORY,
  workflow_file_identity: environment.TLSN_WORKFLOW_FILE_IDENTITY,
  commit_sha: currentHead,
});

const generatedManifest = createCanaryDeploymentManifest({
  environment,
  currentHead,
  issuedAt: new Date("2026-01-01T00:00:00.000Z"),
  expiresAt: new Date("2099-01-01T00:00:00.000Z"),
  artifacts: manifest.artifacts,
  secretProviderReferences,
});
assert.equal(generatedManifest.inputs.length, manifest.inputs.length);
await assertCanaryDeploymentManifest(JSON.stringify(generatedManifest), { packageRoot, environment, currentHead, now: new Date("2026-06-01T00:00:00.000Z") });
assert.throws(
  () => createCanaryDeploymentManifest({
    environment: { ...environment, TLSN_CANARY_TRIGGER_TASK_ID: undefined },
    currentHead,
    artifacts: manifest.artifacts,
    secretProviderReferences,
  }),
  /missing non-secret input TLSN_CANARY_TRIGGER_TASK_ID/,
  "manifest generation must reject an incomplete deployment environment",
);

await assert.rejects(
  () => assertCanaryDeploymentManifest(JSON.stringify({
    ...manifest,
    inputs: manifest.inputs.slice(1),
    manifest_id: deploymentManifestIdentity({ ...manifest, inputs: manifest.inputs.slice(1) }),
  }), { packageRoot, environment, currentHead, now: new Date("2026-06-01T00:00:00.000Z") }),
  /deployment manifest inputs are incomplete/,
  "incomplete non-secret input snapshots must be rejected",
);

await assert.rejects(
  () => assertCanaryDeploymentManifest(alteredManifest((value) => {
    value.inputs[0].name = "TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON";
  }), { packageRoot, environment, currentHead, now: new Date("2026-06-01T00:00:00.000Z") }),
  /unexpected or secret/,
);
await assert.rejects(
  () => assertCanaryDeploymentManifest(alteredManifest((value) => {
    value.expires_at = "2020-01-01T00:00:00.000Z";
  }), { packageRoot, environment, currentHead, now: new Date("2026-06-01T00:00:00.000Z") }),
  /validity window/,
);
await assertManifestRejected(alteredManifest((value) => { value.artifacts = []; }), "missing artifacts must be rejected");
await assertManifestRejected(alteredManifest((value) => { value.artifacts[0].sha256 = "A".repeat(43); }), "artifact hash mismatch must be rejected");
await assertManifestRejected(alteredManifest((value) => { value.artifacts[0].path = "../manifest-test-source.mjs"; }), "artifact path traversal must be rejected");
await assertManifestRejected(alteredManifest((value) => { value.secret_provider.references = value.secret_provider.references.slice(1); }), "missing secret provider must be rejected");
await assertManifestRejected(alteredManifest((value) => { value.secret_provider.references.push({ ...value.secret_provider.references[0] }); }), "duplicate secret provider must be rejected");
await assertManifestRejected(alteredManifest((value) => { value.workflow.commit_sha = "0".repeat(40); }), "wrong HEAD must be rejected");
await assertManifestRejected(alteredManifest((value) => { value.target.server_identity = "other.example.com"; }), "wrong server identity must be rejected");
await assertManifestRejected(alteredManifest((value) => { value.target.binding_identity = "replay-binding-2026"; }), "replay binding identity must be rejected");
await assertManifestRejected(alteredManifest((value) => { value.target.server_identity = "game.example.test"; }), "test server identity must be rejected");
await assertManifestRejected(alteredManifest((value) => { value.deployment.worker_name = "fusou-tlsn-verification-production"; }), "production Worker identity must be rejected");
await assertManifestRejected(alteredManifest((value) => { value.issued_at = "2090-01-01T00:00:00.000Z"; }), "future manifest must be rejected");
await assertManifestRejected(alteredManifestWithoutIdentity((value) => { value.target.binding_identity = "canary-binding-mutated"; }), "mutated manifest identity must be rejected");
await assertManifestRejected("{", "malformed JSON must be rejected");
await assertManifestRejected(alteredManifest((value) => { value.external_authority = { status: "approved" }; }), "external authority field must be rejected");

const tempDirectory = await mkdtemp(join(tmpdir(), "tlsn-canary-manifest-test-"));
try {
  const manifestPath = join(tempDirectory, "manifest.json");
  const preflightReportPath = join(tempDirectory, "preflight.json");
  const authorizationManifest = {
    ...manifest,
    artifacts: [{ name: "manifest-test-source", path: "manifest-test-source.mjs", sha256: artifactHash }],
  };
  authorizationManifest.manifest_id = deploymentManifestIdentity(authorizationManifest);
  await writeFile(join(tempDirectory, "manifest-test-source.mjs"), artifactBytes);
  await writeFile(manifestPath, JSON.stringify(authorizationManifest));
  await writeFile(preflightReportPath, JSON.stringify({
    schema_version: 2,
    environment: "production",
    deployment_role: "canary",
    status: "PASS",
    checks: { required_variables: true, no_test_configuration: true },
    failure_count: 0,
    failures: [],
  }));
  const authorization = await authorizeCanaryDeployment({ manifestPath, environment, currentHead, now: new Date("2026-06-01T00:00:00.000Z") });
  assert.equal(authorization.deployment_authorization, "PREFLIGHT_REQUIRED");
  assert.equal(authorization.deployment_manifest.status, "VALID");
  assert.equal(authorization.deployment_manifest.verification.manifest, "PASS");
  assert.equal(authorization.deployment_manifest.verification.preflight, "NOT_RUN");
  assert.equal(authorization.deployment_manifest.verification.deployment_eligible, false);
  assert.throws(() => assertCanaryDeploymentAuthorized(authorization), /PASS production preflight/);
  const authorized = await authorizeCanaryDeployment({
    manifestPath,
    environment,
    currentHead,
    now: new Date("2026-06-01T00:00:00.000Z"),
    preflightStatus: "PASS",
    preflightReportPath,
  });
  assert.equal(authorized.deployment_authorization, "AUTHORIZED");
  assertCanaryDeploymentAuthorized(authorized);

  const arbitraryPass = await authorizeCanaryDeployment({
    manifestPath,
    environment,
    currentHead,
    now: new Date("2026-06-01T00:00:00.000Z"),
    preflightStatus: "PASS",
  });
  assert.equal(arbitraryPass.deployment_authorization, "PREFLIGHT_REQUIRED");

  await writeFile(preflightReportPath, JSON.stringify({
    schema_version: 2,
    environment: "production",
    deployment_role: "canary",
    status: "FAIL",
    checks: { required_variables: false },
    failure_count: 1,
    failures: [{ check: "TLSN_TEST", reason: "test" }],
  }));
  const failedPreflight = await authorizeCanaryDeployment({ manifestPath, environment, currentHead, preflightReportPath });
  assert.equal(failedPreflight.deployment_authorization, "PREFLIGHT_REQUIRED");
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

console.log("[tlsn-canary-deployment-manifest] preconditions, provenance, governance removal, expiry, and authorization PASS");
