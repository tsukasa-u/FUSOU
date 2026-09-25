#!/usr/bin/env node

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertCanaryRuntimeAttestationSigner } from "./canary-runtime-attestation-signing.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const preflightSource = await readFile(resolve(packageDirectory, "scripts/deployment-preflight.mjs"), "utf8");
assert.match(preflightSource, /assertCanaryRuntimeAttestationSigner/);
assert.match(preflightSource, /role === "canary" && !fixtureOnlyCanary/);

const current = generateKeyPairSync("ed25519");
const other = generateKeyPairSync("ed25519");
const privateKeyPkcs8 = current.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const publicKeySpki = current.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
const otherPublicKeySpki = other.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
const signerKeyId = "preflight-runtime-attestation-current";
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
const validationTime = "2026-09-25T00:00:00.000Z";

assert.equal(assertCanaryRuntimeAttestationSigner({
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  registry: baseRegistry,
  now: validationTime,
}).signer_key_id, signerKeyId);

for (const [label, options] of [
  ["missing private key", { signerKeyId, signingPrivateKeyPkcs8: undefined, registry: baseRegistry }],
  ["invalid private key", { signerKeyId, signingPrivateKeyPkcs8: "invalid-private-key", registry: baseRegistry }],
  ["private/public mismatch", { signerKeyId, signingPrivateKeyPkcs8: other.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"), registry: baseRegistry }],
  ["unknown key ID", { signerKeyId: "unknown-signer", signingPrivateKeyPkcs8: privateKeyPkcs8, registry: baseRegistry }],
  ["non-ACTIVE key", { signerKeyId, signingPrivateKeyPkcs8: privateKeyPkcs8, registry: { ...baseRegistry, keys: [{ ...baseRegistry.keys[0], status: "RETIRED" }] } }],
  ["expired key", { signerKeyId, signingPrivateKeyPkcs8: privateKeyPkcs8, registry: { ...baseRegistry, keys: [{ ...baseRegistry.keys[0], not_after: "2026-09-24T23:59:59.999Z" }] } }],
  ["not-yet-valid key", { signerKeyId, signingPrivateKeyPkcs8: privateKeyPkcs8, registry: { ...baseRegistry, keys: [{ ...baseRegistry.keys[0], not_before: "2026-09-26T00:00:00.000Z" }] } }],
  ["revoked key", { signerKeyId, signingPrivateKeyPkcs8: privateKeyPkcs8, registry: { ...baseRegistry, keys: [{ ...baseRegistry.keys[0], status: "REVOKED" }] } }],
  ["registry/public key mismatch", { signerKeyId, signingPrivateKeyPkcs8: privateKeyPkcs8, registry: { ...baseRegistry, keys: [{ ...baseRegistry.keys[0], public_key_spki: otherPublicKeySpki }] } }],
]) {
  assert.throws(() => assertCanaryRuntimeAttestationSigner({ ...options, now: validationTime }), undefined, `${label} must fail closed`);
}

console.log("[tlsn-canary-runtime-attestation-preflight] non-fixture signer presence, key match, registry, status, and validity failures PASS");
