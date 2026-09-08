import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { assertSigningKeyRegistry } from "./signing-key-registry.mjs";

const { publicKey } = generateKeyPairSync("ed25519");
const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
const registry = {
  schema_version: 1,
  scope: "tlsn-result-signing-key-registry",
  keys: [
    {
      key_id: "result-current",
      public_key_spki: publicKeySpki,
      status: "ACTIVE",
      not_before: "2026-01-01T00:00:00.000Z",
      not_after: "2027-01-01T00:00:00.000Z",
    },
    {
      key_id: "result-previous",
      public_key_spki: publicKeySpki,
      status: "VERIFY_ONLY",
      not_before: "2025-01-01T00:00:00.000Z",
      not_after: "2026-12-31T23:59:59.000Z",
    },
  ],
};

assert.doesNotThrow(() => assertSigningKeyRegistry(registry, {
  currentKeyId: "result-current",
  currentPublicKeySpki: publicKeySpki,
  now: "2026-09-08T00:00:00.000Z",
}));
assert.throws(() => assertSigningKeyRegistry({ ...registry, keys: [{ ...registry.keys[0], status: "REVOKED" }, registry.keys[1]] }, {
  currentKeyId: "result-current",
  currentPublicKeySpki: publicKeySpki,
  now: "2026-09-08T00:00:00.000Z",
}), /not ACTIVE/);
assert.throws(() => assertSigningKeyRegistry({ ...registry, keys: [{ ...registry.keys[0], not_after: "2026-01-01T00:00:00.000Z" }, registry.keys[1]] }), /validity window/);
assert.throws(() => assertSigningKeyRegistry(registry, {
  currentKeyId: "result-current",
  currentPublicKeySpki: publicKeySpki,
  now: "2027-02-01T00:00:00.000Z",
}), /outside its validity window/);
assert.throws(() => assertSigningKeyRegistry({ ...registry, keys: [{ ...registry.keys[0], public_key_spki: "wrong" }, registry.keys[1]] }), /canonical Ed25519/);

console.log("[tlsn-signing-key-registry] current, previous, revoked, expired, and malformed key cases OK");