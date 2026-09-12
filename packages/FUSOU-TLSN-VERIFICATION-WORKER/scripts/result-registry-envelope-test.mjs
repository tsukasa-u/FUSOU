import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  assertSignedResultRegistryEnvelope,
  createSignedResultRegistryEnvelope,
  resultRegistryRawSha256,
} from "./result-registry-envelope.mjs";
import { resolveResultSigningKey } from "./signing-key-registry.mjs";

function keyMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    publicKeySpki: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  };
}

const root = keyMaterial();
const result = keyMaterial();
const registry = {
  schema_version: 1,
  scope: "tlsn-result-signing-key-registry",
  keys: [
    {
      key_id: "result-historical",
      public_key_spki: result.publicKeySpki,
      status: "RETIRED",
      not_before: "2025-01-01T00:00:00.000Z",
      not_after: "2026-06-30T23:59:59.000Z",
    },
    {
      key_id: "result-current",
      public_key_spki: result.publicKeySpki,
      status: "ACTIVE",
      not_before: "2026-07-01T00:00:00.000Z",
      not_after: null,
    },
  ],
};
const registryRaw = `${JSON.stringify(registry, null, 2)}\n`;
const envelope = createSignedResultRegistryEnvelope({
  registry,
  registryRaw,
  rootKeyId: "evidence-root-2026",
  rootPublicKeySpki: root.publicKeySpki,
  rootPrivateKeyPkcs8: root.privateKeyPkcs8,
});

assert.equal(envelope.registry_sha256, resultRegistryRawSha256(registryRaw));
assert.doesNotThrow(() => assertSignedResultRegistryEnvelope(envelope, {
  registry,
  registryRaw,
  trustedRootKeyId: "evidence-root-2026",
  trustedRootPublicKeySpki: root.publicKeySpki,
}));
assert.doesNotThrow(() => resolveResultSigningKey(registry, {
  keyId: "result-historical",
  at: "2026-01-01T00:00:00.000Z",
}));
assert.throws(() => resolveResultSigningKey(registry, {
  keyId: "result-historical",
  at: "2026-07-01T00:00:00.000Z",
}), /outside its validity window/);
assert.throws(() => assertSignedResultRegistryEnvelope({
  ...envelope,
  registry_sha256: "mutated",
}, {
  registry,
  registryRaw,
  trustedRootKeyId: "evidence-root-2026",
  trustedRootPublicKeySpki: root.publicKeySpki,
}), /digest/);
assert.throws(() => assertSignedResultRegistryEnvelope({
  ...envelope,
  signature_base64url: envelope.signature_base64url.slice(0, -1) + (envelope.signature_base64url.endsWith("A") ? "B" : "A"),
}, {
  registry,
  registryRaw,
  trustedRootKeyId: "evidence-root-2026",
  trustedRootPublicKeySpki: root.publicKeySpki,
}), /signature is invalid/);
assert.throws(() => assertSignedResultRegistryEnvelope(envelope, {
  registry,
  registryRaw,
  trustedRootKeyId: "other-root",
  trustedRootPublicKeySpki: root.publicKeySpki,
}), /root identity/);

console.log("[tlsn-result-registry-envelope] root signature, digest, historical, and mutation cases OK");
