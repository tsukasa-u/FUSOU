#!/usr/bin/env node

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acquireAppWorkerReference,
  activeDeployment,
  approvedProductionRelease,
  createAppWorkerReference as createReference,
} from "./app-worker-deployment-reference.mjs";
import {
  version1, version2, account, now, key, result, root, resultRaw, notaryRaw, environment, manifest,
  provenance, release, controls, customMapping, controlPlaneResponse,
} from "./app-worker-reference-fixture.mjs";

function createAppWorkerReference(release, ...args) {
  return createReference(release, ...args, customMapping(release));
}

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
      assert.ok(url.startsWith(`https://api.cloudflare.com/client/v4/`));
      paths.push(url);
      return new Response(JSON.stringify(controlPlaneResponse(url)));
    },
  });
  assert.equal(paths.length, 9);
  assert.equal(paths.filter((url) => url.endsWith("/deployments")).length, 2);
  assert.equal(paths.filter((url) => url.includes("/workers/domains?")).length, 2);
  assert.ok(!paths.some((path) => path.includes("/health")));
  assert.ok(!JSON.stringify(record).includes(environment.CLOUDFLARE_API_TOKEN));
  let calls = 0;
  await assert.rejects(acquireAppWorkerReference({
    environment, provenance, publicManifest: manifest,
    fetchImpl: async (url) => {
      if (url.endsWith("/deployments") && ++calls === 2) return new Response(JSON.stringify(controls(release, version2).deployment));
      return new Response(JSON.stringify(controlPlaneResponse(url)));
    },
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
