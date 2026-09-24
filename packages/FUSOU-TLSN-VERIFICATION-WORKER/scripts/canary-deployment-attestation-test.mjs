#!/usr/bin/env node

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CANARY_DEPLOYMENT_ATTESTATION_SCOPE,
  CANARY_DEPLOYMENT_FIXTURE_SCOPE,
  CANARY_DEPLOYMENT_NOT_READY,
  CANARY_DEPLOYMENT_READINESS,
  createCanaryDeploymentMessage,
  createCanaryDeploymentAttestation,
  fetchCanaryHealth,
  normalizeCanaryPlatformMetadata,
  verifyCanaryDeploymentRuntime,
  writeImmutableCanaryAttestation,
} from "./canary-deployment-attestation.mjs";

const workerName = "fusou-tlsn-verification-canary";
const deploymentId = "canary-deployment-2026";
const platformDeploymentId = "3b064508-1cdb-453c-826b-bdea36a8b1e5";
const versionId = "4b064508-1cdb-453c-826b-bdea36a8b1e5";
const gitCommitSha = "a".repeat(40);
const deploymentTag = `canary-${gitCommitSha.slice(0, 12)}`;
const createdOn = "2026-09-08T00:00:00.000Z";
const bindingAuthorityKeyId = "canary-binding-authority-2026";
const { privateKey: bindingAuthorityPrivateKey, publicKey: bindingAuthorityPublicKey } = generateKeyPairSync("ed25519");
const bindingAuthorityPrivateKeyPkcs8 = bindingAuthorityPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const bindingAuthorityPublicKeySpki = bindingAuthorityPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const deploymentMessage = createCanaryDeploymentMessage({
  deploymentId,
  workerName,
  gitCommitSha,
  bindingAuthorityKeyId,
  bindingAuthorityPrivateKeyPkcs8,
  expectedBindingAuthorityPublicKeySpki: bindingAuthorityPublicKeySpki,
});

function platformPayload(overrides = {}) {
  return {
    deployments: [{
      id: platformDeploymentId,
      created_on: createdOn,
      source: "wrangler",
      strategy: "percentage",
      annotations: { "workers/message": deploymentMessage, "workers/tag": deploymentTag },
      versions: [{ version_id: versionId, percentage: 100 }],
      ...overrides.deployment,
    }],
    version: {
      id: versionId,
      metadata: { created_on: createdOn, author_email: "deploy@example.invalid" },
      annotations: { "workers/message": deploymentMessage, "workers/tag": deploymentTag },
      ...overrides.version,
    },
  };
}

function health(overrides = {}) {
  return {
    schema_version: 2,
    ok: true,
    environment: "production",
    deployment_role: "canary",
    git_commit_sha: gitCommitSha,
    deployment_id: deploymentId,
    binding_mode: "fixed_canary",
    runtime_version: { version_id: versionId, version_tag: deploymentTag, version_timestamp: createdOn },
    deployment_identity: {
      deployment_id: deploymentId,
      deployment_role: "canary",
      binding_mode: "fixed_canary",
      worker_name: workerName,
    },
    ...overrides,
  };
}

const payload = platformPayload();
const platform = normalizeCanaryPlatformMetadata({
  deploymentPayload: payload,
  versionPayload: [payload.version],
  workerName,
  expectedVersionId: versionId,
});
const verificationInput = {
  platform,
  runtimeHealth: health(),
  workerName,
  expectedDeploymentId: deploymentId,
  expectedGitCommitSha: gitCommitSha,
  expectedVersionId: versionId,
  expectedDeploymentMessage: deploymentMessage,
  expectedDeploymentTag: deploymentTag,
  expectedBindingAuthorityKeyId: bindingAuthorityKeyId,
  expectedBindingAuthorityPublicKeySpki: bindingAuthorityPublicKeySpki,
  deploymentStartedAt: new Date("2026-09-07T23:59:00.000Z"),
};
const verification = verifyCanaryDeploymentRuntime(verificationInput);
assert.deepEqual(verification, {
  platform_deployment_id: platformDeploymentId,
  platform_version_id: versionId,
  runtime_deployment_id: deploymentId,
  runtime_version_id: versionId,
  worker_name: workerName,
  deployment_role: "canary",
  git_commit_sha: gitCommitSha,
  deployment_binding: { schema_version: 1, authority_key_id: bindingAuthorityKeyId },
});

function platformWith({ deployment = {}, version = {} } = {}) {
  return {
    ...platform,
    deployment: {
      ...platform.deployment,
      ...deployment,
      annotations: { ...platform.deployment.annotations, ...deployment.annotations },
    },
    version: {
      ...platform.version,
      ...version,
      annotations: { ...platform.version.annotations, ...version.annotations },
    },
  };
}

const wrongDeploymentMessage = createCanaryDeploymentMessage({
  deploymentId: "another-logical-canary-deployment",
  workerName,
  gitCommitSha,
  bindingAuthorityKeyId,
  bindingAuthorityPrivateKeyPkcs8,
  expectedBindingAuthorityPublicKeySpki: bindingAuthorityPublicKeySpki,
});

function rejects(label, action) {
  assert.throws(action, undefined, label);
}

async function rejectsAsync(label, action) {
  await assert.rejects(action, undefined, label);
}

for (const [label, mutation] of [
  ["platform deployment belongs to another logical deployment", { platform: platformWith({ deployment: { annotations: { "workers/message": wrongDeploymentMessage } } }) }],
  ["authorized deployment identity is not bound to platform deployment", { platform: platformWith({ version: { annotations: { "workers/message": wrongDeploymentMessage } } }) }],
  ["platform deployment/version are correct but logical binding is wrong", {
    expectedDeploymentId: "another-logical-canary-deployment",
    runtimeHealth: health({
      deployment_id: "another-logical-canary-deployment",
      deployment_identity: { ...health().deployment_identity, deployment_id: "another-logical-canary-deployment" },
    }),
  }],
  ["runtime deployment identity belongs to another logical deployment", {
    runtimeHealth: health({
      deployment_id: "another-logical-canary-deployment",
      deployment_identity: { ...health().deployment_identity, deployment_id: "another-logical-canary-deployment" },
    }),
  }],
  ["wrong deployment ID", { expectedDeploymentId: "other-deployment" }],
  ["wrong version ID", { expectedVersionId: "5b064508-1cdb-453c-826b-bdea36a8b1e5" }],
  ["wrong Worker name", { workerName: "fusou-tlsn-verification-production" }],
  ["wrong Git SHA", { expectedGitCommitSha: "b".repeat(40) }],
  ["wrong deployment role", { runtimeHealth: health({ deployment_role: "production" }) }],
  ["production instead of Canary", { runtimeHealth: health({ environment: "test" }) }],
  ["runtime version differs from platform version", { runtimeHealth: health({ runtime_version: { version_id: "5b064508-1cdb-453c-826b-bdea36a8b1e5" } }) }],
  ["runtime Git SHA differs from HEAD", { runtimeHealth: health({ git_commit_sha: "b".repeat(40) }) }],
  ["wrong binding mode", { runtimeHealth: health({ binding_mode: "random" }) }],
  ["stale deployment artifact", { deploymentStartedAt: new Date("2026-09-08T01:00:00.000Z") }],
  ["historical deployment artifact", { expectedDeploymentTag: "canary-bbbbbbbbbbbb" }],
  ["successful deployment with mismatching health", { runtimeHealth: health({ deployment_identity: { ...health().deployment_identity, worker_name: "other-worker" } }) }],
]) {
  rejects(label, () => verifyCanaryDeploymentRuntime({ ...verificationInput, ...mutation }));
}

for (const [label, deploymentMutation, versionMutation] of [
  ["missing platform deployment metadata", null, null],
  ["malformed deployment metadata", { versions: [{ version_id: versionId, percentage: 50 }] }, null],
  ["platform deployment differs from expected version", { versions: [{ version_id: "5b064508-1cdb-453c-826b-bdea36a8b1e5", percentage: 100 }] }, null],
  ["wrong platform version metadata", null, { id: "5b064508-1cdb-453c-826b-bdea36a8b1e5" }],
]) {
  rejects(label, () => normalizeCanaryPlatformMetadata({
    deploymentPayload: label === "missing platform deployment metadata" ? { deployments: [] } : platformPayload({ deployment: deploymentMutation, version: versionMutation }),
    versionPayload: label === "missing platform deployment metadata" ? [] : [platformPayload({ version: versionMutation }).version],
    workerName,
    expectedVersionId: versionId,
  }));
}

rejects("fixture or synthetic deployment", () => verifyCanaryDeploymentRuntime({ ...verificationInput, fixtureOnly: true }));
const fixtureAttestation = createCanaryDeploymentAttestation({
  verification,
  platform,
  runtimeHealth: health(),
  expectedDeploymentId: deploymentId,
  expectedGitCommitSha: gitCommitSha,
  evidenceMode: "fixture",
});
assert.equal(fixtureAttestation.scope, CANARY_DEPLOYMENT_FIXTURE_SCOPE);
assert.equal(fixtureAttestation.status, "FIXTURE_ONLY");
assert.equal(fixtureAttestation.readiness, CANARY_DEPLOYMENT_NOT_READY);
assert.equal(fixtureAttestation.evidence.synthetic, true);

const realShape = createCanaryDeploymentAttestation({
  verification,
  platform,
  runtimeHealth: health(),
  expectedDeploymentId: deploymentId,
  expectedGitCommitSha: gitCommitSha,
  expectedDeploymentMessage: deploymentMessage,
  expectedDeploymentTag: deploymentTag,
  workflow: {
    workflow_run_id: "100",
    workflow_run_attempt: "1",
    repository: "example/FUSOU",
    workflow_file_identity: "dotenvx+pnpm+wrangler",
  },
});
assert.equal(realShape.scope, CANARY_DEPLOYMENT_ATTESTATION_SCOPE);
assert.equal(realShape.status, "PASS");
assert.equal(realShape.readiness, CANARY_DEPLOYMENT_READINESS);
assert.equal(realShape.evidence.synthetic, false);

const root = await mkdtemp(join(tmpdir(), "tlsn-canary-attestation-test-"));
try {
  const artifactPath = join(root, "attestation.json");
  await writeImmutableCanaryAttestation(artifactPath, fixtureAttestation);
  assert.equal(JSON.parse(await readFile(artifactPath, "utf8")).status, "FIXTURE_ONLY");
  await rejectsAsync("attestation overwrite", () => writeImmutableCanaryAttestation(artifactPath, fixtureAttestation));
} finally {
  await rm(root, { recursive: true, force: true });
}

const response = await fetchCanaryHealth("https://canary.example.com", async (url, options) => {
  assert.equal(url, "https://canary.example.com/health");
  assert.equal(options.redirect, "error");
  return {
    ok: true,
    status: 200,
    url,
    redirected: false,
    json: async () => health(),
  };
});
assert.equal(response.deployment_id, deploymentId);
for (const status of [301, 302, 307, 308]) {
  await rejectsAsync(`health HTTP ${status} redirect`, () => fetchCanaryHealth("https://canary.example.com", async (url, options) => {
    assert.equal(options.redirect, "error");
    return { ok: false, status, url, redirected: false, json: async () => health() };
  }));
}
await rejectsAsync("health redirect to another HTTPS origin", () => fetchCanaryHealth("https://canary.example.com", async () => ({
  ok: true,
  status: 200,
  url: "https://another-worker.example/health",
  redirected: true,
  json: async () => health(),
})));
await rejectsAsync("invalid health URL", () => fetchCanaryHealth("http://canary.example.com", async () => new Response()));

console.log("[tlsn-canary-deployment-attestation] platform, runtime, stale, identity, fixture, and immutable-artifact rejection matrix PASS");
