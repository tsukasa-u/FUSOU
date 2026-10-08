#!/usr/bin/env node

import assert from "node:assert/strict";
import { generateKeyPairSync, createHash } from "node:crypto";
import { test } from "node:test";
import {
  acquireAppWorkerReference,
  activeDeployment,
  approvedProductionRelease,
  createAppWorkerReference,
} from "./app-worker-deployment-reference.mjs";
import { buildProductionPublicManifest } from "./production-trust-contract.mjs";
import { createSignedResultRegistryEnvelope } from "./result-registry-envelope.mjs";
import { productionSecurityRegistrySetHash } from "./security-registry-set-contract.mjs";
import { DEPLOYMENT_PROVENANCE_SCHEMA_VERSION } from "./deployment-attestation.mjs";
import { loadOriginInventoryContract } from "./origin-inventory-contract.mjs";
import { assertTargetApprovalResolved } from "./target-approval-contract.mjs";
import { PROFILE_CONTRACT_SPEC, productionProfileContractArtifact } from "./profile-canonical-contract.mjs";
import { canonicalJson } from "./production-trust-contract.mjs";

const version1 = "4b064508-1cdb-453c-826b-bdea36a8b1e5";
const version2 = "5b064508-1cdb-453c-826b-bdea36a8b1e5";
const deploymentId = "6b064508-1cdb-453c-826b-bdea36a8b1e5";
const account = "a".repeat(32);
const now = new Date().toISOString();
const hash = (raw) => createHash("sha256").update(raw).digest("base64url");
function key() {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url"),
  };
}
function registry(scope, keyId, publicKey) {
  return JSON.stringify({
    schema_version: 1, scope,
    keys: [{ key_id: keyId, public_key_spki: publicKey, status: "ACTIVE", not_before: "2020-01-01T00:00:00.000Z", not_after: null }],
  });
}
const result = key();
const root = key();
const session = key();
const resultRaw = registry("tlsn-result-signing-key-registry", "result-production-test", result.publicKey);
const envelopeRaw = JSON.stringify(createSignedResultRegistryEnvelope({
  registry: JSON.parse(resultRaw), registryRaw: resultRaw,
  rootKeyId: "result-root-test", rootPublicKeySpki: root.publicKey, rootPrivateKeyPkcs8: root.privateKey,
}));
const notaryRaw = JSON.stringify({ "notary-production-test": "ASEAAAAAAAAAAxuExVZ7EmRAmV0-1aq6BWXXHhg0YEgZ_5wX9enV3QeP" });
const trustSet = productionSecurityRegistrySetHash({ notaryKeyId: "notary-production-test", notaryRegistryRaw: notaryRaw }).sha256;
const manifest = buildProductionPublicManifest({
  notaryEndpoint: "notary.example.com:7047", notaryKeyId: "notary-production-test", notaryRegistryRaw: notaryRaw,
  sessionAuthorityEndpoint: "https://production-worker.example.com/attestation/session",
  sessionAuthorityKeyId: "session-production-test", sessionAuthorityPublicKeySpki: session.publicKey,
  sessionAuthorityKeyRegistryRaw: registry("tlsn-session-authority-key-registry", "session-production-test", session.publicKey),
  resultSignerKeyId: "result-production-test", resultPublicKeySpki: result.publicKey,
  resultSigningKeyRegistryRaw: resultRaw, resultSigningKeyRegistryEnvelopeRaw: envelopeRaw,
  resultRegistryRootKeyId: "result-root-test", resultRegistryRootPublicKeySpki: root.publicKey,
  verificationEndpoint: "https://production-worker.example.com/verify/tlsn",
  securityRegistrySetSha256: trustSet,
});
const environment = {
  TLSN_DEPLOYMENT_ROLE: "production",
  TLSN_ENVIRONMENT: "production",
  TLSN_WORKFLOW_RUN_ID: "101", TLSN_WORKFLOW_RUN_ATTEMPT: "1",
  TLSN_REPOSITORY: "tsukasa-u/FUSOU", TLSN_WORKFLOW_FILE_IDENTITY: "dotenvx+pnpm+wrangler",
  TLSN_GIT_COMMIT_SHA: "a".repeat(40),
  TLSN_PRODUCTION_WORKER_NAME: "fusou-tlsn-production",
  TLSN_PRODUCTION_DEPLOYMENT_ID: "production-logical-identity-test",
  TLSN_VERIFY_WORKER_URL: "https://production-worker.example.com",
  TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID: "result-production-test",
  TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI: result.publicKey,
  TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY: resultRaw,
  TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE: envelopeRaw,
  TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID: "result-root-test",
  TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI: root.publicKey,
  CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: "private-control-plane-test-token",
};
const approval = assertTargetApprovalResolved();
const provenance = {
  schema_version: DEPLOYMENT_PROVENANCE_SCHEMA_VERSION, scope: "tlsn-deployment-provenance",
  status: "PASS", environment: "production", deployment_role: "production", created_at: now,
  workflow_run_id: "101", workflow_run_attempt: "1", repository: environment.TLSN_REPOSITORY,
  workflow_file_identity: environment.TLSN_WORKFLOW_FILE_IDENTITY, git_commit_sha: environment.TLSN_GIT_COMMIT_SHA,
  security_identity: {
    git_commit_sha: environment.TLSN_GIT_COMMIT_SHA,
    verifier_key_id: "verifier-production-test", notary_key_id: manifest.notary.key_id,
    notary_registry_sha256: hash(notaryRaw), binding_authority: "durable-single-use",
    security_registry_set_sha256: trustSet, origin_inventory_sha256: loadOriginInventoryContract().sha256,
    target_approval_artifact_sha256: approval.approval_artifact_sha256,
    profile_policy_sha256: hash(canonicalJson(PROFILE_CONTRACT_SPEC)),
  },
  deployment_identity: {
    deployment_role: "production", binding_mode: "random",
    deployment_id: environment.TLSN_PRODUCTION_DEPLOYMENT_ID, worker_name: environment.TLSN_PRODUCTION_WORKER_NAME,
  },
  result_identity: {
    result_public_key_spki: result.publicKey, result_signer_key_id: "result-production-test",
    result_key_registry_sha256: hash(resultRaw), result_key_registry_envelope_sha256: hash(envelopeRaw),
    result_registry_root_key_id: "result-root-test", result_registry_root_public_key_spki: root.publicKey,
  },
  target_approval: {
    authority_model: approval.authority_model, status: approval.record_status,
    environment: approval.environment, inventory_sha256: approval.inventory_sha256,
    approval_artifact_sha256: approval.approval_artifact_sha256, approved_target_identity: null,
    approved_target_identities: approval.approved_target_identities,
  },
  profile_contract: productionProfileContractArtifact(),
};
function controls(release, versionId = version1) {
  return {
    deployment: { success: true, result: { deployments: [{
      id: deploymentId, created_on: now, versions: [{ version_id: versionId, percentage: 100 }],
    }] } },
    version: { success: true, result: { id: versionId, resources: { bindings: [
      ...Object.entries(release.publicBindings).map(([name, text]) => ({ name, type: "plain_text", text })),
      { name: "CF_VERSION_METADATA", type: "version_metadata" },
      { name: "WORKER_PRIVATE_SECRET", type: "secret_text", text: "must-never-enter-handoff" },
    ] } } },
  };
}
const release = approvedProductionRelease(environment, provenance, manifest);

test("current single 100% active deployment supplies a distinct public APP version pin", () => {
  const input = controls(release);
  const record = createAppWorkerReference(release, input.deployment, input.version, account, now);
  assert.equal(record.compile_inputs.FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID, version1);
  assert.equal(record.compile_inputs.FUSOU_TLSN_EXPECTED_BINDING_MODE, "random");
  assert.equal(record.compile_inputs.FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY, resultRaw);
  assert.equal(record.compile_inputs.FUSOU_TLSN_NOTARY_VERIFYING_KEY, JSON.parse(notaryRaw)[manifest.notary.key_id]);
  assert.notEqual(record.cloudflare.deployment_id, record.compile_inputs.FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID);
  assert.notEqual(record.cloudflare.deployment_id, record.cloudflare.version_id);
  for (const secret of [environment.CLOUDFLARE_API_TOKEN, result.privateKey, root.privateKey, "must-never-enter-handoff"]) {
    assert.ok(!JSON.stringify(record).includes(secret));
  }
});

test("Sparse handoff selects only the existing same-origin approved verification route", () => {
  const sparse = approvedProductionRelease({ ...environment, TLSN_PRODUCTION_DISCLOSURE_MODE: "sparse" }, provenance, manifest);
  assert.equal(sparse.compile_inputs.FUSOU_TLSN_VERIFICATION_ENDPOINT, "https://production-worker.example.com/verify/tlsn/sparse");
  assert.deepEqual(sparse.publicBindings, release.publicBindings);
  assert.throws(() => approvedProductionRelease({ ...environment, TLSN_PRODUCTION_DISCLOSURE_MODE: "arbitrary" }, provenance, manifest), /disclosure mode/);
});

test("stale historical version cannot supply an active pin; rotation preserves Result and Game Server authorities", () => {
  const input = controls(release, version2);
  input.deployment.result.deployments.push(controls(release).deployment.result.deployments[0]);
  assert.equal(activeDeployment(input.deployment).version_id, version2);
  assert.throws(() => createAppWorkerReference(release, input.deployment, controls(release).version, account, now), /active deployment\/version/);
  const v1 = createAppWorkerReference(release, controls(release).deployment, controls(release).version, account, now);
  const v2 = createAppWorkerReference(release, input.deployment, input.version, account, now);
  const unchanged = { ...v2.compile_inputs, FUSOU_TLSN_EXPECTED_ACTIVE_VERSION_ID: version1 };
  assert.deepEqual(unchanged, v1.compile_inputs);
});

test("missing, partial, split or unrelated control-plane identity is fail-closed", () => {
  for (const [label, mutate, boundary] of [
    ["failed API", (c) => { c.deployment.success = false; }, /active deployment response/],
    ["no active deployment", (c) => { c.deployment.result.deployments = []; }, /deployment ID/],
    ["partial traffic", (c) => { c.deployment.result.deployments[0].versions[0].percentage = 99; }, /100%/],
    ["split traffic", (c) => { c.deployment.result.deployments[0].versions.push({ version_id: version2, percentage: 1 }); }, /100%/],
    ["missing version", (c) => { delete c.deployment.result.deployments[0].versions[0].version_id; }, /active version ID/],
    ["unrelated version", (c) => { c.version.result.id = version2; }, /active deployment\/version/],
    ["missing metadata", (c) => { c.version.result.resources.bindings = c.version.result.resources.bindings.filter((b) => b.name !== "CF_VERSION_METADATA"); }, /CF_VERSION_METADATA/],
    ["test binding", (c) => { c.version.result.resources.bindings.push({ name: "TLSN_TEST_BINDING_VALUE", type: "plain_text", text: "fixed" }); }, /forbidden Canary\/Test/],
    ["canary binding", (c) => { c.version.result.resources.bindings.push({ name: "TLSN_CANARY_BINDING_VALUE", type: "plain_text", text: "fixed" }); }, /forbidden Canary\/Test/],
  ]) {
    const input = controls(release);
    mutate(input);
    assert.throws(() => createAppWorkerReference(release, input.deployment, input.version, account, now), boundary, label);
  }
  for (const name of Object.keys(release.publicBindings)) {
    const input = controls(release);
    input.version.result.resources.bindings.find((b) => b.name === name).text = "substituted";
    assert.throws(() => createAppWorkerReference(release, input.deployment, input.version, account, now), new RegExp(name), name);
    const duplicate = controls(release);
    duplicate.version.result.resources.bindings.push({ name, type: "plain_text", text: release.publicBindings[name] });
    assert.throws(() => createAppWorkerReference(release, duplicate.deployment, duplicate.version, account, now), new RegExp(name), name);
  }
});

test("release identity cannot bootstrap from Canary, substituted endpoints, registry or Root", () => {
  const invalidPair = structuredClone(provenance);
  invalidPair.deployment_identity.binding_mode = "fixed_canary";
  assert.throws(() => approvedProductionRelease(environment, invalidPair, manifest), /role contract/);
  for (const name of ["notary_key_id", "notary_registry_sha256", "security_registry_set_sha256"]) {
    const changed = structuredClone(provenance);
    changed.security_identity[name] = name.endsWith("_sha256") ? "B".repeat(43) : "unrelated-notary";
    assert.throws(() => approvedProductionRelease(environment, changed, manifest), new RegExp(name), name);
  }
  for (const [name, value, boundary] of [
    ["TLSN_DEPLOYMENT_ROLE", "canary", /Canary/],
    ["TLSN_ENVIRONMENT", "test", /production environment/],
    ["TLSN_PRODUCTION_DEPLOYMENT_ID", "unrelated", /deployment pins/],
    ["TLSN_PRODUCTION_WORKER_NAME", "unrelated-worker", /deployment pins/],
    ["TLSN_VERIFY_WORKER_URL", "https://another-worker.example.com", /approved Worker origin/],
    ["TLSN_VERIFY_WORKER_URL", "http://production-worker.example.com", /approved Worker origin/],
    ["TLSN_VERIFY_WORKER_URL", "https://production-worker.example.com/?x=1", /approved Worker origin/],
    ["TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI", key().publicKey, /trusted pin/],
    ["TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY", `${resultRaw}\n`, /digest does not match/],
  ]) {
    assert.throws(() => approvedProductionRelease({ ...environment, [name]: value }, provenance, manifest), boundary, name);
  }
  for (const name of Object.keys(environment)) {
    if (name.startsWith("CLOUDFLARE_")) continue;
    const missing = { ...environment }; delete missing[name];
    assert.throws(() => approvedProductionRelease(missing, provenance, manifest), undefined, name);
  }
});

test("authenticated control plane is read before APP handoff, without health requests or credential disclosure", async () => {
  const input = controls(release);
  const paths = [];
  const record = await acquireAppWorkerReference({
    environment, provenance, publicManifest: manifest,
    fetchImpl: async (url, options) => {
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, `Bearer ${environment.CLOUDFLARE_API_TOKEN}`);
      assert.ok(url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/fusou-tlsn-production/`));
      paths.push(url);
      return new Response(JSON.stringify(url.endsWith("/deployments") ? input.deployment : input.version));
    },
  });
  assert.equal(paths.length, 3);
  assert.ok(!paths.some((path) => path.includes("/health")));
  assert.ok(!JSON.stringify(record).includes(environment.CLOUDFLARE_API_TOKEN));
  let calls = 0;
  await assert.rejects(acquireAppWorkerReference({
    environment, provenance, publicManifest: manifest,
    fetchImpl: async (url) => new Response(JSON.stringify(++calls === 3 ? controls(release, version2).deployment : url.endsWith("/deployments") ? input.deployment : input.version)),
  }), /changed during APP handoff/);
  await assert.rejects(acquireAppWorkerReference({
    environment, provenance, publicManifest: manifest,
    fetchImpl: async () => new Response(null, { status: 302 }),
  }), /control-plane request failed \(302\)/);
  let requests = 0;
  await assert.rejects(acquireAppWorkerReference({
    environment: { ...environment, TLSN_PRODUCTION_DEPLOYMENT_ID: "" }, provenance, publicManifest: manifest,
    fetchImpl: async () => { requests++; throw new Error("must not request"); },
  }), /independent deployment input/);
  assert.equal(requests, 0);
});
