import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  verifyRuntimeConfigProductionArtifacts,
  verifyRuntimeConfigPublicationObjects,
} from "../src/index.ts";
import {
  verifyTlsnRuntimeConfigIndependentInputs,
} from "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-independent-verification.mjs";
import {
  canonicalJson,
} from "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/production-trust-contract.mjs";

const vector = JSON.parse(
  readFileSync(
    new URL(
      "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/fixtures/tlsn-runtime-config-independent-v2-vector.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const ARTIFACTS = [
  ["worker-reference", "worker_reference_raw"],
  ["origin-inventory", "origin_inventory_raw"],
  ["target-approval", "target_approval_raw"],
  ["security-registry-set", "security_registry_set_raw"],
  ["result-registry-envelope", "result_registry_envelope_raw"],
];

function payloadFromVector() {
  const envelope = JSON.parse(vector.manifest_envelope_utf8);
  return JSON.parse(
    Buffer.from(envelope.payload_base64url, "base64url").toString("utf8"),
  );
}

function inputsFromVector() {
  return Object.fromEntries(
    Object.entries(vector.inputs_base64url).map(([name, value]) => [
      name,
      Buffer.from(value, "base64url"),
    ]),
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function setJsonInput(inputs, name, value, canonical = false) {
  inputs[name] = Buffer.from(
    canonical ? canonicalJson(value) : `${JSON.stringify(value, null, 2)}\n`,
  );
}

function updateArtifactDigests(payload, inputs) {
  payload.source.worker_reference_sha256 = sha256(
    inputs.worker_reference_raw,
  );
  payload.production_authority_pins.origin_inventory_sha256 = sha256(
    inputs.origin_inventory_raw,
  );
  payload.production_authority_pins.target_approval_artifact_sha256 = sha256(
    inputs.target_approval_raw,
  );
  payload.production_authority_pins.security_registry_set_sha256 = sha256(
    inputs.security_registry_set_raw,
  );
  payload.result_registry_pins.result_registry_envelope_sha256 = sha256(
    inputs.result_registry_envelope_raw,
  );
}

function setApprovalRaw(inputs, approval) {
  const fields = [
    "schema_version",
    "authority_model",
    "environment",
    "status",
    "inventory_sha256",
    "targets",
    "approved_at",
  ];
  const ordered = Object.fromEntries(fields.map((field) => [field, approval[field]]));
  inputs.target_approval_raw = Buffer.from(
    `${JSON.stringify(ordered, null, 2)}\n`,
  );
}

function setSecurityRegistryRaw(inputs, securityRegistrySet) {
  inputs.security_registry_set_raw = Buffer.from(
    canonicalJson(securityRegistrySet),
  );
}

function verifyCore(payload, inputs, overrides = {}) {
  return verifyRuntimeConfigProductionArtifacts({
    payload,
    inputs,
    nowMs: overrides.nowMs ?? vector.policy.now_ms,
    maxReferenceAgeSeconds:
      overrides.maxReferenceAgeSeconds ?? vector.policy.max_reference_age_seconds,
    maxClockSkewSeconds:
      overrides.maxClockSkewSeconds ?? vector.policy.max_clock_skew_seconds,
  });
}

function verifyNode(payload, inputs, validationTime = vector.policy.now_ms) {
  return verifyTlsnRuntimeConfigIndependentInputs(
    payload,
    inputs,
    validationTime,
  );
}

test("Workers-compatible Production artifact verification matches the Node verifier", async () => {
  const payload = payloadFromVector();
  const inputs = inputsFromVector();
  const [workers, node] = await Promise.all([
    verifyCore(payload, inputs),
    Promise.resolve(verifyNode(payload, inputs)),
  ]);
  assert.deepEqual(workers, node);

  const objects = ARTIFACTS.map(([role, inputName]) => {
    const body = inputs[inputName];
    const digest = sha256(body);
    return {
      key: `tlsn/runtime-config/v2/artifacts/${role}/${digest}`,
      body,
      sha256: digest,
    };
  });
  const publication = await verifyRuntimeConfigPublicationObjects({
    payload,
    objects,
    nowMs: vector.policy.now_ms,
    maxReferenceAgeSeconds: vector.policy.max_reference_age_seconds,
    maxClockSkewSeconds: vector.policy.max_clock_skew_seconds,
  });
  assert.deepEqual(publication, workers);
});

test("a correctly hashed Worker reference with a different identity is rejected by both verifiers", async () => {
  const payload = payloadFromVector();
  const inputs = inputsFromVector();
  const workerReference = JSON.parse(
    inputs.worker_reference_raw.toString("utf8"),
  );
  workerReference.cloudflare.script_name = "unapproved-worker";
  setJsonInput(inputs, "worker_reference_raw", workerReference);
  payload.source.worker_reference_sha256 = sha256(
    inputs.worker_reference_raw,
  );

  await assert.rejects(
    verifyCore(payload, inputs),
    /Worker reference identity does not match the signed manifest/,
  );
  assert.throws(
    () => verifyNode(payload, inputs),
    /Worker reference identity does not match the signed manifest/,
  );
});

test("Worker reference observation binding, freshness, JSON, and required fields are enforced", async () => {
  const mismatchedObservationPayload = payloadFromVector();
  const mismatchedObservationInputs = inputsFromVector();
  const mismatchedObservation = JSON.parse(
    mismatchedObservationInputs.worker_reference_raw.toString("utf8"),
  );
  mismatchedObservation.observed_at = "2026-10-13T06:48:08.010Z";
  setJsonInput(
    mismatchedObservationInputs,
    "worker_reference_raw",
    mismatchedObservation,
  );
  mismatchedObservationPayload.source.worker_reference_sha256 = sha256(
    mismatchedObservationInputs.worker_reference_raw,
  );
  await assert.rejects(
    verifyCore(mismatchedObservationPayload, mismatchedObservationInputs),
    /Worker reference identity does not match the signed manifest/,
  );
  assert.throws(
    () => verifyNode(mismatchedObservationPayload, mismatchedObservationInputs),
    /Worker reference identity does not match the signed manifest/,
  );

  const stalePayload = payloadFromVector();
  const staleInputs = inputsFromVector();
  const staleAfterMs = vector.policy.now_ms + 601_000;
  await assert.rejects(
    verifyCore(stalePayload, staleInputs, { nowMs: staleAfterMs }),
    /Worker reference is not fresh/,
  );

  for (const raw of [
    Buffer.from("{not-json", "utf8"),
    Buffer.from('{"schema_version":2}', "utf8"),
  ]) {
    const payload = payloadFromVector();
    const inputs = inputsFromVector();
    inputs.worker_reference_raw = raw;
    payload.source.worker_reference_sha256 = sha256(raw);
    await assert.rejects(verifyCore(payload, inputs));
    assert.throws(() => verifyNode(payload, inputs));
  }
});

test("publication objects reject missing, duplicate, and swapped artifact roles", async () => {
  const payload = payloadFromVector();
  const inputs = inputsFromVector();
  const objects = ARTIFACTS.map(([role, inputName]) => {
    const body = inputs[inputName];
    const digest = sha256(body);
    return {
      key: `tlsn/runtime-config/v2/artifacts/${role}/${digest}`,
      body,
    };
  });
  const options = {
    payload,
    nowMs: vector.policy.now_ms,
    maxReferenceAgeSeconds: vector.policy.max_reference_age_seconds,
    maxClockSkewSeconds: vector.policy.max_clock_skew_seconds,
  };
  await assert.rejects(
    verifyRuntimeConfigPublicationObjects({
      ...options,
      objects: objects.slice(0, -1),
    }),
    /exactly five artifacts/,
  );
  const duplicate = [...objects];
  duplicate[1] = duplicate[0];
  await assert.rejects(
    verifyRuntimeConfigPublicationObjects({
      ...options,
      objects: duplicate,
    }),
    /origin-inventory bytes do not match/,
  );
  const swapped = [...objects];
  [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  await assert.rejects(
    verifyRuntimeConfigPublicationObjects({
      ...options,
      objects: swapped,
    }),
    /origin-inventory bytes do not match/,
  );
});

test("Origin Inventory, Target Approval, and security registry semantics are checked after hashes match", async () => {
  const inventoryPayload = payloadFromVector();
  const inventoryInputs = inputsFromVector();
  const inventory = JSON.parse(
    inventoryInputs.origin_inventory_raw.toString("utf8"),
  );
  inventory.targets[0].server_identity = "replacement.example.com";
  setJsonInput(inventoryInputs, "origin_inventory_raw", inventory);
  const approval = JSON.parse(
    inventoryInputs.target_approval_raw.toString("utf8"),
  );
  approval.inventory_sha256 = sha256(inventoryInputs.origin_inventory_raw);
  setApprovalRaw(inventoryInputs, approval);
  const inventorySecuritySet = JSON.parse(
    inventoryInputs.security_registry_set_raw.toString("utf8"),
  );
  inventorySecuritySet.origin_inventory_sha256 = sha256(
    inventoryInputs.origin_inventory_raw,
  );
  inventorySecuritySet.target_approval_artifact_sha256 = sha256(
    inventoryInputs.target_approval_raw,
  );
  setSecurityRegistryRaw(inventoryInputs, inventorySecuritySet);
  updateArtifactDigests(inventoryPayload, inventoryInputs);
  await assert.rejects(verifyCore(inventoryPayload, inventoryInputs));
  assert.throws(() => verifyNode(inventoryPayload, inventoryInputs));

  const approvalPayload = payloadFromVector();
  const approvalInputs = inputsFromVector();
  const invalidApproval = JSON.parse(
    approvalInputs.target_approval_raw.toString("utf8"),
  );
  invalidApproval.status = "REVOKED";
  setApprovalRaw(approvalInputs, invalidApproval);
  const approvalSecuritySet = JSON.parse(
    approvalInputs.security_registry_set_raw.toString("utf8"),
  );
  approvalSecuritySet.target_approval_artifact_sha256 = sha256(
    approvalInputs.target_approval_raw,
  );
  setSecurityRegistryRaw(approvalInputs, approvalSecuritySet);
  updateArtifactDigests(approvalPayload, approvalInputs);
  await assert.rejects(verifyCore(approvalPayload, approvalInputs));
  assert.throws(() => verifyNode(approvalPayload, approvalInputs));

  const registryPayload = payloadFromVector();
  const registryInputs = inputsFromVector();
  const invalidRegistry = JSON.parse(
    registryInputs.security_registry_set_raw.toString("utf8"),
  );
  invalidRegistry.notary_key_id = "unpublished-notary-key";
  setSecurityRegistryRaw(registryInputs, invalidRegistry);
  updateArtifactDigests(registryPayload, registryInputs);
  await assert.rejects(verifyCore(registryPayload, registryInputs));
  assert.throws(() => verifyNode(registryPayload, registryInputs));
});

test("Result registry envelope signature is verified after exact bytes and Worker binding are updated", async () => {
  const payload = payloadFromVector();
  const inputs = inputsFromVector();
  const envelope = JSON.parse(
    inputs.result_registry_envelope_raw.toString("utf8"),
  );
  const signature = Buffer.from(envelope.signature_base64url, "base64url");
  signature[0] ^= 1;
  envelope.signature_base64url = signature.toString("base64url");
  inputs.result_registry_envelope_raw = Buffer.from(
    canonicalJson(envelope),
    "utf8",
  );
  const workerReference = JSON.parse(
    inputs.worker_reference_raw.toString("utf8"),
  );
  workerReference.cloudflare.checked_public_bindings.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE =
    inputs.result_registry_envelope_raw.toString("utf8");
  setJsonInput(inputs, "worker_reference_raw", workerReference);
  updateArtifactDigests(payload, inputs);

  await assert.rejects(verifyCore(payload, inputs), /signature is invalid/i);
  assert.throws(() => verifyNode(payload, inputs), /signature is invalid/i);
});
