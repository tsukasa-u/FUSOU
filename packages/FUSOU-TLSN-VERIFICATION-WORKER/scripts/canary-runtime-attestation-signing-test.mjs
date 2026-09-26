#!/usr/bin/env node

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  assertCanaryRuntimeAttestationSigner,
  assertCanaryRuntimeAttestationSignature,
  signCanaryRuntimeAttestation,
} from "./canary-runtime-attestation-signing.mjs";

const signerKeyId = "test-runtime-attestation-current";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyPkcs8 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
const baseRegistry = {
  schema_version: 1,
  scope: "tlsn-canary-runtime-attestation-key-registry",
  keys: [{
    key_id: signerKeyId,
    public_key_spki: publicKeySpki,
    status: "ACTIVE",
    not_before: "2026-01-01T00:00:00.000Z",
    not_after: null,
  }],
};
const unsignedAttestation = {
  schema_version: 1,
  scope: "tlsn-canary-deployment-runtime-attestation",
  status: "PASS",
  captured_at: "2026-09-15T00:00:00.000Z",
  repository: {
    workflow_run_attempt: "1",
    workflow_run_id: "100",
    git_commit_sha: "a".repeat(40),
  },
  deployment: {
    authorized_deployment_id: "canary-test-deployment",
    manifest_id: "A".repeat(43),
    versions: [{ version_id: "4b064508-1cdb-453c-826b-bdea36a8b1e5", percentage: 100 }],
  },
  runtime_self_reported_identity: {
    deployment_id: "canary-test-deployment",
    runtime_version: { version_id: "4b064508-1cdb-453c-826b-bdea36a8b1e5" },
  },
};
const signedAttestation = signCanaryRuntimeAttestation(unsignedAttestation, {
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  registry: baseRegistry,
  now: "2026-09-15T00:00:00.000Z",
});

assert.equal(assertCanaryRuntimeAttestationSignature(signedAttestation, { registry: baseRegistry }).status, "VALID");
assert.deepEqual(assertCanaryRuntimeAttestationSigner({
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  registry: baseRegistry,
  now: "2026-09-15T00:00:00.000Z",
}), {
  signer_key_id: signerKeyId,
  public_key_spki: publicKeySpki,
});

const signedWithUnknownSecurityField = signCanaryRuntimeAttestation({
  ...unsignedAttestation,
  security_override: {
    readiness: "READY_FOR_HUMAN_GAMEPLAY",
    bypass_signature: true,
  },
}, {
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  registry: baseRegistry,
  now: "2026-09-15T00:00:00.000Z",
});
assert.equal(assertCanaryRuntimeAttestationSignature(signedWithUnknownSecurityField, { registry: baseRegistry }).status, "VALID");

function reverseObject(value) {
  if (Array.isArray(value)) return value.map(reverseObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseObject(child)]));
}

assert.equal(assertCanaryRuntimeAttestationSignature(reverseObject(signedAttestation), { registry: baseRegistry }).status, "VALID");

for (const [label, mutate] of [
  ["captured_at", (value) => ({ ...value, captured_at: "2026-09-15T00:00:01.000Z" })],
  ["manifest_id", (value) => ({ ...value, deployment: { ...value.deployment, manifest_id: "B".repeat(43) } })],
  ["deployment ID", (value) => ({ ...value, deployment: { ...value.deployment, authorized_deployment_id: "other-deployment" } })],
  ["workflow attempt", (value) => ({ ...value, repository: { ...value.repository, workflow_run_attempt: "2" } })],
  ["version ID", (value) => ({ ...value, deployment: { ...value.deployment, versions: [{ version_id: "5b064508-1cdb-453c-826b-bdea36a8b1e5", percentage: 100 }] } })],
  ["runtime identity", (value) => ({ ...value, runtime_self_reported_identity: { ...value.runtime_self_reported_identity, deployment_id: "other-deployment" } })],
  ["signer key ID", (value) => ({ ...value, attestation_signer_key_id: "other-signer" })],
  ["algorithm", (value) => ({ ...value, signature_algorithm: "other" })],
]) {
  assert.throws(() => assertCanaryRuntimeAttestationSignature(mutate(signedAttestation), { registry: baseRegistry }), undefined, `${label} tamper must fail`);
}

assert.throws(() => assertCanaryRuntimeAttestationSignature({ ...signedAttestation, signature_base64url: undefined }, { registry: baseRegistry }), /canonical base64url/);
assert.throws(() => assertCanaryRuntimeAttestationSignature({ ...signedAttestation, signature_base64url: "not-a-signature" }, { registry: baseRegistry }), /canonical base64url/);
assert.throws(() => assertCanaryRuntimeAttestationSignature({ ...signedAttestation, signature_base64url: "AA" }, { registry: baseRegistry }), /invalid length/);
const mutatedPublicKeySpki = publicKeySpki.slice(0, -1)
  + (publicKeySpki.at(-1) === "A" ? "B" : "A");
assert.notEqual(mutatedPublicKeySpki, publicKeySpki);
assert.throws(() => signCanaryRuntimeAttestation(unsignedAttestation, {
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  registry: { ...baseRegistry, keys: [{ ...baseRegistry.keys[0], public_key_spki: mutatedPublicKeySpki }] },
  now: "2026-09-15T00:00:00.000Z",
}), /does not match|canonical Ed25519|published registry/);
assert.throws(() => signCanaryRuntimeAttestation(unsignedAttestation, {
  signerKeyId: "unknown-signer",
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  registry: baseRegistry,
  now: "2026-09-15T00:00:00.000Z",
}), /published registry/);

const retiredRegistry = {
  ...baseRegistry,
  keys: [{ ...baseRegistry.keys[0], status: "RETIRED" }],
};
assert.equal(assertCanaryRuntimeAttestationSignature(signedAttestation, { registry: retiredRegistry }).status, "VALID");
assert.throws(() => signCanaryRuntimeAttestation(unsignedAttestation, {
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  registry: retiredRegistry,
  now: "2026-09-15T00:00:00.000Z",
}), /not ACTIVE/);
assert.throws(() => assertCanaryRuntimeAttestationSignature(signedAttestation, {
  registry: { ...baseRegistry, keys: [{ ...baseRegistry.keys[0], status: "REVOKED" }] },
}), /not valid for verification/);
assert.throws(() => assertCanaryRuntimeAttestationSignature(signedAttestation, {
  registry: { ...baseRegistry, keys: [{ ...baseRegistry.keys[0], not_before: "2026-10-01T00:00:00.000Z" }] },
}), /outside its validity window/);
assert.throws(() => assertCanaryRuntimeAttestationSignature(signedAttestation, {
  registry: { ...baseRegistry, keys: [{ ...baseRegistry.keys[0], not_after: "2026-09-14T23:59:59.999Z" }] },
}), /outside its validity window/);

console.log("[tlsn-canary-runtime-attestation-signing] canonical Ed25519 signing, tamper, rotation, revocation, and validity tests PASS");