import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkoutCommit } from "./deployment-attestation.mjs";
import {
  CANARY_DEPLOYMENT_MANIFEST_SCOPE,
  assertCanaryDeploymentManifest,
  deploymentManifestIdentity,
} from "./canary-deployment-manifest.mjs";
import {
  assertCanaryDeploymentAuthorized,
  authorizeCanaryDeployment,
} from "./canary-deployment-authorization.mjs";

const packageRoot = resolve(new URL("..", import.meta.url).pathname);
const currentHead = checkoutCommit(packageRoot);
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
};

function hashValue(value) {
  return import("node:crypto").then(({ createHash }) => createHash("sha256").update(value).digest("base64url"));
}

const manifest = {
  schema_version: 1,
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
  workflow: {
    repository: environment.TLSN_REPOSITORY,
    run_id: environment.TLSN_WORKFLOW_RUN_ID,
    run_attempt: environment.TLSN_WORKFLOW_RUN_ATTEMPT,
    workflow_file_identity: environment.TLSN_WORKFLOW_FILE_IDENTITY,
    commit_sha: currentHead,
  },
  inputs: [{
    name: "TLSN_CANDIDATE_PROFILE_SHA256",
    value_sha256: await hashValue(environment.TLSN_CANDIDATE_PROFILE_SHA256),
    provenance: "repository-controlled-input",
  }],
  artifacts: [],
  deployment: {
    deployment_id: environment.TLSN_CANARY_DEPLOYMENT_ID,
    worker_name: "fusou-tlsn-verification-canary",
    verifier_worker_name: "fusou-tlsn-verifier-canary",
  },
  secret_provider: { references: [] },
};
manifest.manifest_id = deploymentManifestIdentity(manifest);

function alteredManifest(change) {
  const altered = structuredClone(manifest);
  change(altered);
  altered.manifest_id = deploymentManifestIdentity(altered);
  return JSON.stringify(altered);
}

const valid = await assertCanaryDeploymentManifest(JSON.stringify(manifest), { packageRoot, environment, currentHead, now: new Date("2026-06-01T00:00:00.000Z") });
assert.equal(valid.manifest_id, manifest.manifest_id);
assert.equal(valid.target.server_identity, "game.example.com");

await assert.rejects(
  () => assertCanaryDeploymentManifest(JSON.stringify({ ...manifest, external_authority: { status: "ACCEPTED" } }), { packageRoot, environment, currentHead, now: new Date("2026-06-01T00:00:00.000Z") }),
  /fields are invalid/,
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

const tempDirectory = await mkdtemp(join(tmpdir(), "tlsn-canary-manifest-test-"));
try {
  const manifestPath = join(tempDirectory, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  const authorization = await authorizeCanaryDeployment({ manifestPath, environment, currentHead, now: new Date("2026-06-01T00:00:00.000Z") });
  assert.equal(authorization.deployment_authorization, "AUTHORIZED");
  assert.equal(authorization.deployment_manifest.status, "VALID");
  assertCanaryDeploymentAuthorized(authorization);
  assert.equal(authorization.deployment_manifest.verification.acceptance, undefined);
  assert.equal(authorization.deployment_manifest.verification.readiness_eligible, undefined);
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

console.log("[tlsn-canary-deployment-manifest] preconditions, provenance, governance removal, expiry, and authorization PASS");
