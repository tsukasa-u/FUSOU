#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertAlpha15NotaryVerifyingKey,
  appConfigTomlFromManifest,
  assertNotaryRegistryConsistency,
  assertPublicManifest,
  assertRequiredProductionSecrets,
  assertSessionAuthorityIdentity,
  buildProductionPublicManifest,
} from "./production-trust-contract.mjs";
import { createSignedResultRegistryEnvelope } from "./result-registry-envelope.mjs";
import { PRODUCTION_INPUTS, PRODUCTION_SECRET_INPUTS } from "./deployment-contract.mjs";
import { CANARY_DEPLOYMENT_MANIFEST_SCHEMA_VERSION } from "./canary-deployment-manifest.mjs";
import { productionSecurityRegistrySetHash } from "./security-registry-set-contract.mjs";
import { loadOriginInventoryContract } from "./origin-inventory-contract.mjs";
import { PROFILE_CONTRACT_SPEC, productionSecurityRegistrySetPayload } from "../src/origin-trust-contract.mjs";
import { canonicalJson } from "./production-trust-contract.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);

const canaryDeploymentManifest = {
  schema_version: CANARY_DEPLOYMENT_MANIFEST_SCHEMA_VERSION,
  scope: "tlsn-canary-deployment-manifest",
  deployment: {
    deployment_id: "canary-deployment-2026",
    worker_name: "fusou-tlsn-verification-canary",
  },
  workflow: {
    commit_sha: "0123456789abcdef0123456789abcdef01234567",
  },
  target: {
    environment: "production",
    deployment_role: "canary",
  },
};

const notaryKeyId = "notary-production-2026";
const notaryVerifyingKey = "ASEAAAAAAAAAAxuExVZ7EmRAmV0-1aq6BWXXHhg0YEgZ_5wX9enV3QeP";
const secp256k1FieldPrime = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const previousNotaryKeyId = "notary-production-2025";
const previousNotaryVerifyingKey = "ASEAAAAAAAAAAwdAv1ROf_qFyznpNgrsGYoIZ-ACK18PYlD8vV2IuVmO";
const notaryRegistryRaw = JSON.stringify({
  [notaryKeyId]: notaryVerifyingKey,
  [previousNotaryKeyId]: previousNotaryVerifyingKey,
});
const hashNotaryRegistryRaw = (raw) => createHash("sha256").update(raw, "utf8").digest("base64url");
const { publicKey: sessionPublicKey, privateKey: sessionPrivateKey } = generateKeyPairSync("ed25519");
const sessionPublicKeySpki = sessionPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const sessionPrivateKeyPkcs8 = sessionPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const sessionKeyId = "session-production-2026";
const sessionRegistryRaw = JSON.stringify({
  schema_version: 1,
  scope: "tlsn-session-authority-key-registry",
  keys: [{
    key_id: sessionKeyId,
    public_key_spki: sessionPublicKeySpki,
    status: "ACTIVE",
    not_before: new Date(Date.now() - 60_000).toISOString(),
    not_after: null,
  }],
});
const { publicKey: resultPublicKey, privateKey: resultPrivateKey } = generateKeyPairSync("ed25519");
const resultPublicKeySpki = resultPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const resultPrivateKeyPkcs8 = resultPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const resultKeyId = "result-production-2026";
const resultRegistryRaw = JSON.stringify({
  schema_version: 1,
  scope: "tlsn-result-signing-key-registry",
  keys: [{
    key_id: resultKeyId,
    public_key_spki: resultPublicKeySpki,
    status: "ACTIVE",
    not_before: new Date(Date.now() - 60_000).toISOString(),
    not_after: null,
  }],
});
const { publicKey: resultRegistryRootPublicKey, privateKey: resultRegistryRootPrivateKey } = generateKeyPairSync("ed25519");
const resultRegistryRootPublicKeySpki = resultRegistryRootPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const resultRegistryRootPrivateKeyPkcs8 = resultRegistryRootPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const resultRegistryRootKeyId = "result-registry-root-2026";
const resultRegistryEnvelopeRaw = JSON.stringify(createSignedResultRegistryEnvelope({
  registry: JSON.parse(resultRegistryRaw),
  registryRaw: resultRegistryRaw,
  rootKeyId: resultRegistryRootKeyId,
  rootPublicKeySpki: resultRegistryRootPublicKeySpki,
  rootPrivateKeyPkcs8: resultRegistryRootPrivateKeyPkcs8,
}));
const validManifest = buildProductionPublicManifest({
  notaryEndpoint: "notary.example.com:7047",
  notaryKeyId,
  notaryRegistryRaw,
  sessionAuthorityEndpoint: "https://worker.example.com/attestation/session",
  sessionAuthorityKeyId: sessionKeyId,
  sessionAuthorityPublicKeySpki: sessionPublicKeySpki,
  sessionAuthorityKeyRegistryRaw: sessionRegistryRaw,
  resultSignerKeyId: resultKeyId,
  resultPublicKeySpki,
  resultSigningKeyRegistryRaw: resultRegistryRaw,
  resultSigningKeyRegistryEnvelopeRaw: resultRegistryEnvelopeRaw,
  resultRegistryRootKeyId,
  resultRegistryRootPublicKeySpki,
  verificationEndpoint: "https://worker.example.com/verify/tlsn",
  securityRegistrySetSha256: productionSecurityRegistrySetHash({ notaryKeyId, notaryRegistryRaw }).sha256,
});

assert.doesNotThrow(() => assertAlpha15NotaryVerifyingKey(notaryVerifyingKey));
const notaryVerifyingKeyBytes = Buffer.from(notaryVerifyingKey, "base64url");
assert.equal(notaryVerifyingKeyBytes.length, 42);
assert.deepEqual([...notaryVerifyingKeyBytes.subarray(0, 9)], [1, 33, 0, 0, 0, 0, 0, 0, 0]);
assert.equal(notaryVerifyingKeyBytes[9], 0x03, "the production alpha.15 fixture uses the odd compressed SEC1 root");
assert.equal(notaryVerifyingKeyBytes[9] & 1, 1, "SEC1 prefix 0x03 selects an odd y-coordinate");

function modPow(base, exponent, modulus) {
  let result = 1n;
  let factor = base % modulus;
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    power >>= 1n;
  }
  return result;
}

const fixtureX = BigInt(`0x${notaryVerifyingKeyBytes.subarray(10).toString("hex")}`);
const fixtureYSquared = (fixtureX ** 3n + 7n) % secp256k1FieldPrime;
const fixtureSquareRoot = modPow(fixtureYSquared, (secp256k1FieldPrime + 1n) / 4n, secp256k1FieldPrime);
assert.equal(fixtureSquareRoot ** 2n % secp256k1FieldPrime, fixtureYSquared);
const fixtureOppositeRoot = (secp256k1FieldPrime - fixtureSquareRoot) % secp256k1FieldPrime;
assert.equal(fixtureOppositeRoot ** 2n % secp256k1FieldPrime, fixtureYSquared);
assert.notEqual(fixtureSquareRoot & 1n, fixtureOppositeRoot & 1n, "the two valid roots must have opposite parity");
assert.ok(
  Number(fixtureSquareRoot & 1n) === (notaryVerifyingKeyBytes[9] & 1)
    || Number(fixtureOppositeRoot & 1n) === (notaryVerifyingKeyBytes[9] & 1),
  "the production fixture prefix must select one of the two valid curve roots",
);

for (const prefix of [0x02, 0x03]) {
  const parityVariant = Buffer.from(notaryVerifyingKeyBytes);
  parityVariant[9] = prefix;
  assert.doesNotThrow(
    () => assertAlpha15NotaryVerifyingKey(parityVariant.toString("base64url")),
    `the fixture x-coordinate must accept compressed SEC1 prefix 0x${prefix.toString(16)}`,
  );
}

assert.throws(
  () => assertAlpha15NotaryVerifyingKey(Buffer.alloc(32, 7).toString("base64url")),
  /TLSNotary alpha\.15 K256 bincode VerifyingKey/,
);
assert.throws(() => assertAlpha15NotaryVerifyingKey(`${notaryVerifyingKey}=`), /canonical base64url/);
assert.throws(
  () => assertAlpha15NotaryVerifyingKey(notaryVerifyingKeyBytes.subarray(1).toString("base64url")),
  /TLSNotary alpha\.15 K256 bincode VerifyingKey/,
);
const invalidAlgorithmKey = Buffer.from(notaryVerifyingKey, "base64url");
invalidAlgorithmKey[0] = 2;
assert.throws(
  () => assertAlpha15NotaryVerifyingKey(invalidAlgorithmKey.toString("base64url")),
  /TLSNotary alpha\.15 K256 bincode VerifyingKey/,
);
const invalidPrefixKey = Buffer.from(notaryVerifyingKeyBytes);
invalidPrefixKey[9] = 0x04;
assert.throws(
  () => assertAlpha15NotaryVerifyingKey(invalidPrefixKey.toString("base64url")),
  /TLSNotary alpha\.15 K256 bincode VerifyingKey/,
);
const invalidEmbeddedLengthKey = Buffer.from(notaryVerifyingKey, "base64url");
invalidEmbeddedLengthKey.writeBigUInt64LE(32n, 1);
assert.throws(
  () => assertAlpha15NotaryVerifyingKey(invalidEmbeddedLengthKey.toString("base64url")),
  /TLSNotary alpha\.15 K256 bincode VerifyingKey/,
);
function alpha15KeyWithX(x) {
  const encodedX = Buffer.alloc(32);
  for (let index = encodedX.length - 1; index >= 0; index -= 1) {
    encodedX[index] = Number(x >> BigInt((encodedX.length - index - 1) * 8) & 0xffn);
  }
  const key = Buffer.from(notaryVerifyingKeyBytes);
  key.set(encodedX, 10);
  return key.toString("base64url");
}

assert.throws(
  () => assertAlpha15NotaryVerifyingKey(alpha15KeyWithX(0n)),
  /valid compressed secp256k1 public key/,
  "x=0 makes x^3+7 a quadratic non-residue modulo the secp256k1 field prime",
);
assert.equal(
  modPow(7n, (secp256k1FieldPrime - 1n) / 2n, secp256k1FieldPrime),
  secp256k1FieldPrime - 1n,
  "Euler's criterion confirms that x=0 is a non-residue test vector",
);
assert.throws(
  () => assertAlpha15NotaryVerifyingKey(alpha15KeyWithX(secp256k1FieldPrime)),
  /valid compressed secp256k1 public key/,
  "compressed SEC1 x must be strictly less than the field prime",
);

assert.doesNotThrow(() => assertNotaryRegistryConsistency({
  sourceRegistryRaw: notaryRegistryRaw,
  workerRegistryRaw: notaryRegistryRaw,
  evidenceRegistryRaw: notaryRegistryRaw,
  keyId: notaryKeyId,
  appVerifyingKey: notaryVerifyingKey,
}));

assert.throws(() => assertNotaryRegistryConsistency({
  sourceRegistryRaw: notaryRegistryRaw,
  workerRegistryRaw: JSON.stringify({
    [previousNotaryKeyId]: previousNotaryVerifyingKey,
    [notaryKeyId]: notaryVerifyingKey,
  }),
  evidenceRegistryRaw: notaryRegistryRaw,
  keyId: notaryKeyId,
}), /Worker Notary registry/);

assert.throws(() => assertNotaryRegistryConsistency({
  sourceRegistryRaw: notaryRegistryRaw,
  workerRegistryRaw: `{ "${notaryKeyId}": "${notaryVerifyingKey}", "${previousNotaryKeyId}": "${previousNotaryVerifyingKey}" }`,
  evidenceRegistryRaw: notaryRegistryRaw,
  keyId: notaryKeyId,
}), /Worker Notary registry/);

assert.throws(() => assertNotaryRegistryConsistency({
  sourceRegistryRaw: notaryRegistryRaw,
  workerRegistryRaw: `${notaryRegistryRaw}\n`,
  evidenceRegistryRaw: notaryRegistryRaw,
  keyId: notaryKeyId,
}), /Worker Notary registry/);

assert.throws(() => assertNotaryRegistryConsistency({
  sourceRegistryRaw: notaryRegistryRaw,
  workerRegistryRaw: JSON.stringify({
    [notaryKeyId]: previousNotaryVerifyingKey,
    [previousNotaryKeyId]: previousNotaryVerifyingKey,
  }),
  evidenceRegistryRaw: notaryRegistryRaw,
  keyId: notaryKeyId,
}), /Worker Notary registry/);

assert.throws(() => assertNotaryRegistryConsistency({
  sourceRegistryRaw: notaryRegistryRaw,
  workerRegistryRaw: JSON.stringify({ [notaryKeyId]: Buffer.from("different-worker-key").toString("base64url") }),
  evidenceRegistryRaw: notaryRegistryRaw,
  keyId: notaryKeyId,
  appVerifyingKey: notaryVerifyingKey,
}), /Worker Notary registry/);

assert.throws(() => assertNotaryRegistryConsistency({
  sourceRegistryRaw: notaryRegistryRaw,
  workerRegistryRaw: notaryRegistryRaw,
  evidenceRegistryRaw: JSON.stringify({ [notaryKeyId]: Buffer.from("different-evidence-key").toString("base64url") }),
  keyId: notaryKeyId,
  appVerifyingKey: notaryVerifyingKey,
}), /Evidence Notary registry/);

assert.throws(() => assertNotaryRegistryConsistency({
  sourceRegistryRaw: JSON.stringify({ [notaryKeyId]: Buffer.from("not-alpha15").toString("base64url") }),
  keyId: notaryKeyId,
}), /alpha\.15/);

assert.throws(() => assertNotaryRegistryConsistency({
  sourceRegistryRaw: notaryRegistryRaw,
  keyId: notaryKeyId,
  appVerifyingKey: Buffer.from("different-app-key").toString("base64url"),
}), /APP Notary verifying key/);

assert.throws(() => assertSessionAuthorityIdentity({
  registry: sessionRegistryRaw,
  keyId: sessionKeyId,
  publicKeySpki: sessionPublicKeySpki.slice(0, -1) + (sessionPublicKeySpki.endsWith("A") ? "B" : "A"),
}), /published registry key/);

assert.throws(() => assertRequiredProductionSecrets({}, [
  "TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
]), /required production secrets are missing/);
assert.equal(typeof sessionPrivateKeyPkcs8, "string");
assert.equal(typeof resultPrivateKeyPkcs8, "string");

assert.doesNotThrow(() => assertPublicManifest(validManifest));
assert.equal(validManifest.schema_version, 5);
assert.equal(validManifest.notary.registry_sha256, hashNotaryRegistryRaw(validManifest.notary.registry_raw));
assert.equal(validManifest.origin_inventory.target_count, 20);
assert.equal(validManifest.origin_inventory.port, 443);
assert.match(validManifest.origin_inventory.sha256, /^[A-Za-z0-9_-]{43}$/);
const manifestWithMismatchedOriginInventory = structuredClone(validManifest);
manifestWithMismatchedOriginInventory.origin_inventory.sha256 = Buffer.alloc(32, 1).toString("base64url");
assert.throws(() => assertPublicManifest(manifestWithMismatchedOriginInventory), /does not match the shipped inventory contract/);
const manifestWithMutatedSecuritySet = structuredClone(validManifest);
manifestWithMutatedSecuritySet.security_registry_set_sha256 = Buffer.alloc(32, 9).toString("base64url");
assert.throws(() => assertPublicManifest(manifestWithMutatedSecuritySet), /security registry set does not match/);
const changedProfilePolicy = createHash("sha256")
  .update(canonicalJson({ ...PROFILE_CONTRACT_SPEC, schema_version: PROFILE_CONTRACT_SPEC.schema_version + 1 }), "utf8")
  .digest("base64url");
const changedProfilePolicyPayload = productionSecurityRegistrySetPayload({
  notaryKeyId,
  notaryRegistryRaw: canonicalJson(JSON.parse(validManifest.notary.registry_raw)),
  originInventorySha256: loadOriginInventoryContract().sha256,
  targetApprovalArtifactSha256: validManifest.target_approval.approval_artifact_sha256,
  profilePolicySha256: changedProfilePolicy,
});
const manifestWithMutatedProfilePolicy = structuredClone(validManifest);
manifestWithMutatedProfilePolicy.security_registry_set_sha256 = createHash("sha256")
  .update(canonicalJson(changedProfilePolicyPayload), "utf8")
  .digest("base64url");
assert.throws(() => assertPublicManifest(manifestWithMutatedProfilePolicy), /security registry set does not match/);
const manifestWithMutatedNotaryRegistry = structuredClone(validManifest);
manifestWithMutatedNotaryRegistry.notary.registry_raw = JSON.stringify({
  [notaryKeyId]: notaryVerifyingKey,
  "notary-extra": previousNotaryVerifyingKey,
});
manifestWithMutatedNotaryRegistry.notary.registry_sha256 = hashNotaryRegistryRaw(manifestWithMutatedNotaryRegistry.notary.registry_raw);
assert.throws(() => assertPublicManifest(manifestWithMutatedNotaryRegistry), /security registry set does not match/);
const manifestWithMutatedNotaryRegistryHash = structuredClone(validManifest);
manifestWithMutatedNotaryRegistryHash.notary.registry_raw = JSON.stringify({
  [notaryKeyId]: previousNotaryVerifyingKey,
});
manifestWithMutatedNotaryRegistryHash.notary.registry_sha256 = hashNotaryRegistryRaw(manifestWithMutatedNotaryRegistryHash.notary.registry_raw);
assert.throws(() => assertPublicManifest(manifestWithMutatedNotaryRegistryHash), /selected public key/);
const manifestWithMutatedTargetApproval = structuredClone(validManifest);
manifestWithMutatedTargetApproval.target_approval.approval_artifact_sha256 = Buffer.alloc(32, 0xa5).toString("base64url");
assert.throws(() => assertPublicManifest(manifestWithMutatedTargetApproval), /Target Approval/);
const manifestWithMissingNotary = structuredClone(validManifest);
delete manifestWithMissingNotary.notary;
assert.throws(() => assertPublicManifest(manifestWithMissingNotary), /public manifest schema|notary/i);
const manifestWithInvalidNotaryKey = structuredClone(validManifest);
manifestWithInvalidNotaryKey.notary.verifying_key = Buffer.from("not-alpha15").toString("base64url");
manifestWithInvalidNotaryKey.notary.registry_entry.verifying_key = manifestWithInvalidNotaryKey.notary.verifying_key;
assert.throws(() => assertPublicManifest(manifestWithInvalidNotaryKey), /alpha\.15/);
const manifestWithLegacyTrustRoots = structuredClone(validManifest);
manifestWithLegacyTrustRoots.origin_inventory.trust_roots = ["legacy-root-value"];
assert.throws(() => assertPublicManifest(manifestWithLegacyTrustRoots), /outside the public manifest schema/);
const manifestWithInvalidResultRegistry = structuredClone(validManifest);
manifestWithInvalidResultRegistry.result_signing.key_registry.scope = "wrong-scope";
assert.throws(() => assertPublicManifest(manifestWithInvalidResultRegistry), /result signing key registry schema/);
const manifestWithRevokedResultSigner = structuredClone(validManifest);
manifestWithRevokedResultSigner.result_signing.key_registry.keys[0].status = "REVOKED";
assert.throws(() => assertPublicManifest(manifestWithRevokedResultSigner), /current result signing key is not ACTIVE/);
const manifestWithMismatchedResultKey = structuredClone(validManifest);
manifestWithMismatchedResultKey.result_signing.public_key_spki = sessionPublicKeySpki;
assert.throws(() => assertPublicManifest(manifestWithMismatchedResultKey), /published registry key/);
const manifestWithMismatchedResultRegistryRoot = structuredClone(validManifest);
manifestWithMismatchedResultRegistryRoot.result_signing.result_registry_root_key_id = "";
assert.throws(() => assertPublicManifest(manifestWithMismatchedResultRegistryRoot), /Result registry Root key ID/);
const manifestWithPrivateField = structuredClone(validManifest);
manifestWithPrivateField.session_authority.signing_private_key_pkcs8 = "must-never-be-published";
assert.throws(() => assertPublicManifest(manifestWithPrivateField), /outside the public manifest schema/);
for (const [section, field] of [
  ["notary", "signing_private_key_pkcs8"],
  ["session_authority", "signing_private_key_pkcs8"],
  ["session_authority", "bearer_token"],
  ["origin_inventory", "device_private_key_pkcs8"],
  ["origin_inventory", "supabase_service_role_key"],
  ["origin_inventory", "cloudflare_api_token"],
]) {
  const manifestWithPrivateCategory = structuredClone(validManifest);
  manifestWithPrivateCategory[section][field] = `must-never-be-published-${field}`;
  assert.throws(() => assertPublicManifest(manifestWithPrivateCategory), /outside the public manifest schema/);
}
const manifestWithBindingAuthority = structuredClone(validManifest);
manifestWithBindingAuthority.binding_authority = { public_key_spki: "must-never-be-published" };
assert.throws(() => assertPublicManifest(manifestWithBindingAuthority), /outside the public manifest schema/);
const appConfig = appConfigTomlFromManifest(
  validManifest,
  "/local/tlsn-artifacts",
  canaryDeploymentManifest,
  "https://worker.example.com/health",
);
assert.match(appConfig, /\[proxy\.tlsn\]/);
assert.match(appConfig, /^enabled = true$/m);
assert.doesNotMatch(appConfig, /tlsn_(?:notary|session_authority|result|verification|runtime|expected|origin|server_identity)/);
assert.doesNotMatch(appConfig, /private|secret|token|bearer|supabase|device|cloudflare/i);

for (const name of [
  "TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID",
  "TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY",
  "TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID",
  "TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY",
]) {
  assert.ok([...PRODUCTION_INPUTS, ...PRODUCTION_SECRET_INPUTS].includes(name), `${name} must be in the dotenvx deployment contract`);
}

console.log("[tlsn-production-trust-contract] registry, authority, dotenvx-secret, and public-manifest cases PASS");
