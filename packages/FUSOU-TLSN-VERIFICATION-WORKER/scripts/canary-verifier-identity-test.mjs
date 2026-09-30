#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  assertCanaryVerifierExecutionReceipt,
  assertCanaryVerifierIdentityKeyRegistry,
  canaryVerifierIdentityKeyRegistrySha256,
  CANARY_VERIFIER_IDENTITY_KEY_REGISTRY_SCOPE,
  CANARY_VERIFIER_WORKER_NAME,
  createCanaryVerifierExecutionReceipt,
} from "./canary-verifier-identity.mjs";

const now = "2026-09-30T12:00:00.000Z";
const capturedAt = "2026-09-30T11:50:00.000Z";
const expiresAt = "2026-09-30T12:20:00.000Z";
const deploymentId = "canary-verifier-deployment-2026-09-30";
const runtimeVersionId = "4b064508-1cdb-453c-826b-bdea36a8b1e5";
const jobId = "f73fded7-d9af-4f0a-b87b-c626d30d55bd";
const attemptId = "5f289198-7361-4a92-9d03-c4e506385130";
const issuedAt = "2026-09-30T11:55:00.000Z";
const presentationBytes = Buffer.from("fresh live presentation bytes");
const resultBytes = Buffer.from("signed worker result bytes");
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const { privateKey: otherPrivateKey, publicKey: otherPublicKey } = generateKeyPairSync("ed25519");
const privateKeyPkcs8 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
const otherPublicKeySpki = otherPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const verifierKeyId = "verifier-canary-2026-09-30";
const registry = {
  schema_version: 1,
  scope: CANARY_VERIFIER_IDENTITY_KEY_REGISTRY_SCOPE,
  keys: [{
    key_id: verifierKeyId,
    public_key_spki: publicKeySpki,
    status: "ACTIVE",
    not_before: "2026-09-30T11:00:00.000Z",
    not_after: "2026-09-30T13:00:00.000Z",
    deployment_id: deploymentId,
    worker_name: CANARY_VERIFIER_WORKER_NAME,
  }],
};
const trustedRuntimeIdentity = {
  status: "VALID",
  signature_valid: true,
  cross_binding: { attestation_fresh: true },
  verifier_identity: {
    status: "VALID",
    deployment_id: deploymentId,
    worker_name: CANARY_VERIFIER_WORKER_NAME,
    version_id: runtimeVersionId,
    verifier_key_id: verifierKeyId,
    public_key_spki: publicKeySpki,
    public_key_spki_sha256: createHash("sha256").update(Buffer.from(publicKeySpki, "base64url")).digest("base64url"),
    key_registry_sha256: canaryVerifierIdentityKeyRegistrySha256(registry),
    attestation_captured_at: capturedAt,
    attestation_expires_at: expiresAt,
  },
};
const runtimeIdentityForRegistry = (keyRegistry) => ({
  ...trustedRuntimeIdentity,
  verifier_identity: {
    ...trustedRuntimeIdentity.verifier_identity,
    key_registry_sha256: canaryVerifierIdentityKeyRegistrySha256(keyRegistry),
  },
});

const receipt = createCanaryVerifierExecutionReceipt({
  jobId,
  verificationAttemptId: attemptId,
  deploymentId,
  workerName: CANARY_VERIFIER_WORKER_NAME,
  runtimeVersionId,
  verifierKeyId,
  verifierPublicKeySpki: publicKeySpki,
  verifierSigningPrivateKeyPkcs8: privateKeyPkcs8,
  presentationBytes,
  resultBytes,
  issuedAt,
  receiptId: "394dc8cc-d4bc-4b8c-9813-7bc4a04a9603",
});

assert.equal(assertCanaryVerifierIdentityKeyRegistry(registry, {
  currentIdentity: {
    status: "VALID",
    verifier_key_id: verifierKeyId,
    public_key_spki: publicKeySpki,
    deployment_id: deploymentId,
    worker_name: CANARY_VERIFIER_WORKER_NAME,
  },
  now,
}), registry);
assert.equal(assertCanaryVerifierExecutionReceipt(receipt, {
  presentationBytes,
  resultBytes,
  verifierIdentityKeyRegistry: registry,
  trustedRuntimeIdentity,
  expectedJobId: jobId,
  expectedVerificationAttemptId: attemptId,
  now,
}).status, "PASS");

assert.throws(() => createCanaryVerifierExecutionReceipt({
  jobId,
  verificationAttemptId: attemptId,
  deploymentId,
  workerName: CANARY_VERIFIER_WORKER_NAME,
  runtimeVersionId,
  verifierKeyId,
  verifierPublicKeySpki: publicKeySpki,
  verifierSigningPrivateKeyPkcs8: otherPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
  presentationBytes,
  resultBytes,
  issuedAt,
}), /does not match its published SPKI/);

assert.throws(() => assertCanaryVerifierExecutionReceipt(receipt, {
  presentationBytes,
  resultBytes,
  verifierIdentityKeyRegistry: { ...registry, keys: [{ ...registry.keys[0], public_key_spki: otherPublicKeySpki }] },
  trustedRuntimeIdentity,
  now,
}), /not bound to the signed Runtime Attestation/);

assert.throws(() => assertCanaryVerifierExecutionReceipt(receipt, {
  presentationBytes,
  resultBytes,
  verifierIdentityKeyRegistry: registry,
  trustedRuntimeIdentity: {
    ...trustedRuntimeIdentity,
    verifier_identity: { ...trustedRuntimeIdentity.verifier_identity, deployment_id: "unauthorized-verifier-deployment" },
  },
  now,
}), /does not match the attested deployment/);

assert.throws(() => assertCanaryVerifierExecutionReceipt(receipt, {
  presentationBytes,
  resultBytes,
  verifierIdentityKeyRegistry: registry,
  trustedRuntimeIdentity: {
    ...trustedRuntimeIdentity,
    verifier_identity: { ...trustedRuntimeIdentity.verifier_identity, version_id: "6b064508-1cdb-453c-826b-bdea36a8b1e5" },
  },
  now,
}), /does not match the attested deployment/);

assert.throws(() => assertCanaryVerifierExecutionReceipt(receipt, {
  presentationBytes,
  resultBytes,
  verifierIdentityKeyRegistry: registry,
  trustedRuntimeIdentity: {
    ...trustedRuntimeIdentity,
    verifier_identity: { ...trustedRuntimeIdentity.verifier_identity, verifier_key_id: "unexpected-key" },
  },
  now,
}), /does not match the attested deployment/);

assert.throws(() => assertCanaryVerifierIdentityKeyRegistry({
  ...registry,
  keys: [{ ...registry.keys[0], deployment_id: "different-deployment" }],
}, {
  currentIdentity: {
    status: "VALID",
    verifier_key_id: verifierKeyId,
    public_key_spki: publicKeySpki,
    deployment_id: deploymentId,
    worker_name: CANARY_VERIFIER_WORKER_NAME,
  },
  now,
}), /does not match the ACTIVE registry association/);

assert.throws(() => assertCanaryVerifierExecutionReceipt(receipt, {
  presentationBytes,
  resultBytes,
  verifierIdentityKeyRegistry: registry,
  trustedRuntimeIdentity: {
    ...trustedRuntimeIdentity,
    cross_binding: { attestation_fresh: false },
  },
  now,
}), /fresh signed Runtime Attestation/);

assert.throws(() => assertCanaryVerifierExecutionReceipt(receipt, {
  presentationBytes,
  resultBytes,
  verifierIdentityKeyRegistry: registry,
  trustedRuntimeIdentity,
  expectedJobId: "different-job",
  now,
}), /job ID mismatch/);

assert.throws(() => assertCanaryVerifierExecutionReceipt(receipt, {
  presentationBytes: Buffer.from("another presentation"),
  resultBytes,
  verifierIdentityKeyRegistry: registry,
  trustedRuntimeIdentity,
  now,
}), /Presentation hash mismatch/);

assert.throws(() => assertCanaryVerifierExecutionReceipt(receipt, {
  presentationBytes,
  resultBytes: Buffer.from("another result"),
  verifierIdentityKeyRegistry: registry,
  trustedRuntimeIdentity,
  now,
}), /Result hash mismatch/);

assert.throws(() => assertCanaryVerifierExecutionReceipt(null, {
  presentationBytes,
  resultBytes,
  verifierIdentityKeyRegistry: registry,
  trustedRuntimeIdentity,
  now,
}), /receipt is missing/);

const expiredRegistry = {
  ...registry,
  keys: [{ ...registry.keys[0], not_after: "2026-09-30T11:54:00.000Z" }],
};
assert.throws(() => assertCanaryVerifierExecutionReceipt(receipt, {
  presentationBytes,
  resultBytes,
  verifierIdentityKeyRegistry: expiredRegistry,
  trustedRuntimeIdentity: runtimeIdentityForRegistry(expiredRegistry),
  now,
}), /outside its validity window/);

const unauthorizedRegistry = {
  ...registry,
  keys: [{ ...registry.keys[0], status: "REVOKED" }],
};
assert.throws(() => assertCanaryVerifierExecutionReceipt(receipt, {
  presentationBytes,
  resultBytes,
  verifierIdentityKeyRegistry: unauthorizedRegistry,
  trustedRuntimeIdentity: runtimeIdentityForRegistry(unauthorizedRegistry),
  now,
}), /ACTIVE key|not valid for verification/);

const rotatedRegistry = {
  ...registry,
  keys: [
    {
      key_id: "verifier-canary-previous",
      public_key_spki: otherPublicKeySpki,
      status: "VERIFY_ONLY",
      not_before: "2026-09-01T00:00:00.000Z",
      not_after: "2026-10-01T00:00:00.000Z",
      deployment_id: "canary-verifier-deployment-previous",
      worker_name: CANARY_VERIFIER_WORKER_NAME,
      superseded_by: verifierKeyId,
    },
    registry.keys[0],
  ],
};
assert.equal(assertCanaryVerifierIdentityKeyRegistry(rotatedRegistry, {
  currentIdentity: {
    status: "VALID",
    verifier_key_id: verifierKeyId,
    public_key_spki: publicKeySpki,
    deployment_id: deploymentId,
    worker_name: CANARY_VERIFIER_WORKER_NAME,
  },
  now,
}), rotatedRegistry);

console.log("[tlsn-canary-verifier-identity] PASS");