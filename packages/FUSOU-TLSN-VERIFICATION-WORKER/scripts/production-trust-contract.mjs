import { createHash, createPublicKey } from "node:crypto";
import {
  assertAuthorityKeyRegistry,
  authorityKeyRegistrySha256,
} from "./authority-key-registry.mjs";
import {
  assertSigningKeyRegistry,
  signingKeyRegistrySha256,
} from "./signing-key-registry.mjs";
import {
  assertSignedResultRegistryEnvelope,
  resultRegistryEnvelopeHash,
} from "./result-registry-envelope.mjs";
import { loadOriginInventoryContract } from "./origin-inventory-contract.mjs";
import {
  assertAlpha15NotaryVerifyingKey,
  PROFILE_CONTRACT_SPEC,
  productionSecurityRegistrySetPayload,
} from "../src/origin-trust-contract.mjs";
export { assertAlpha15NotaryVerifyingKey };

export const PRODUCTION_PUBLIC_MANIFEST_SCHEMA_VERSION = 4;
export const PRODUCTION_PUBLIC_MANIFEST_SCOPE = "tlsn-production-public-config";
export const CANONICAL_NOTARY_REGISTRY_INPUT = "TLSN_PRODUCTION_NOTARY_REGISTRY";
export const LEGACY_NOTARY_REGISTRY_INPUTS = ["TLSN_CANDIDATE_NOTARY_REGISTRY"];

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const DNS_HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SHA256_BASE64URL_LENGTH = 43;
const PUBLIC_KEY_LENGTH = 59;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function parseJsonObject(raw, label) {
  let parsed;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function assertSha256(value, label) {
  if (
    typeof value !== "string" ||
    value.length !== SHA256_BASE64URL_LENGTH ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new Error(`${label} must be a SHA-256 base64url digest`);
  }
}

function assertPublicEd25519Spki(value, label) {
  if (
    typeof value !== "string" ||
    value.length !== PUBLIC_KEY_LENGTH ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new Error(`${label} must be a canonical Ed25519 SPKI public key`);
  }
  try {
    const key = createPublicKey({
      key: Buffer.from(value, "base64url"),
      format: "der",
      type: "spki",
    });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
  } catch {
    throw new Error(`${label} must be a valid Ed25519 SPKI public key`);
  }
}

export function parseNotaryRegistry(raw, label = CANONICAL_NOTARY_REGISTRY_INPUT) {
  const registry = parseJsonObject(raw, label);
  const entries = Object.entries(registry);
  if (entries.length === 0) throw new Error(`${label} must contain at least one key`);
  for (const [keyId, publicKey] of entries) {
    if (!KEY_ID_PATTERN.test(keyId)) throw new Error(`${label} contains an invalid key ID`);
    assertAlpha15NotaryVerifyingKey(publicKey, `${label} entry`);
  }
  return registry;
}

export function canonicalNotaryRegistryJson(raw, label = CANONICAL_NOTARY_REGISTRY_INPUT) {
  return canonicalJson(parseNotaryRegistry(raw, label));
}

export function notaryRegistrySha256(raw) {
  return createHash("sha256").update(raw).digest("base64url");
}

export function assertNotaryRegistryConsistency({
  sourceRegistryRaw,
  workerRegistryRaw = sourceRegistryRaw,
  evidenceRegistryRaw = sourceRegistryRaw,
  keyId,
  appVerifyingKey,
} = {}) {
  const sourceRegistry = parseNotaryRegistry(sourceRegistryRaw, "source Notary registry");
  parseNotaryRegistry(workerRegistryRaw, "Worker Notary registry");
  parseNotaryRegistry(evidenceRegistryRaw, "Evidence Notary registry");
  if (workerRegistryRaw !== sourceRegistryRaw) {
    throw new Error("Worker Notary registry does not match the source registry");
  }
  if (evidenceRegistryRaw !== sourceRegistryRaw) {
    throw new Error("Evidence Notary registry does not match the source registry");
  }
  if (!KEY_ID_PATTERN.test(keyId ?? "")) throw new Error("Notary key ID is invalid");
  const verifyingKey = sourceRegistry[keyId];
  if (typeof verifyingKey !== "string") {
    throw new Error("Notary key ID is not present in the source registry");
  }
  if (appVerifyingKey !== undefined && appVerifyingKey !== verifyingKey) {
    throw new Error("APP Notary verifying key does not match the registry entry");
  }
  return {
    key_id: keyId,
    verifying_key: verifyingKey,
    registry_entry: { key_id: keyId, verifying_key: verifyingKey },
    registry_sha256: notaryRegistrySha256(sourceRegistryRaw),
  };
}

export function assertSessionAuthorityIdentity({
  registry,
  keyId,
  publicKeySpki,
  label = "Session Authority",
} = {}) {
  const parsedRegistry = typeof registry === "string"
    ? parseJsonObject(registry, `${label} registry`)
    : registry;
  assertAuthorityKeyRegistry(parsedRegistry, {
    scope: "tlsn-session-authority-key-registry",
    currentKeyId: keyId,
    currentPublicKeySpki: publicKeySpki,
    label,
  });
  return {
    key_id: keyId,
    public_key_spki: publicKeySpki,
    key_registry_sha256: typeof registry === "string" ? authorityKeyRegistrySha256(registry) : null,
  };
}

export function assertResultSigningIdentity({
  registry,
  keyId,
  publicKeySpki,
  registryEnvelope,
  registryRaw,
  registryRootKeyId,
  registryRootPublicKeySpki,
  label = "Result signing",
} = {}) {
  const parsedRegistry = typeof registry === "string"
    ? parseJsonObject(registry, `${label} registry`)
    : registry;
  assertSigningKeyRegistry(parsedRegistry, {
    currentKeyId: keyId,
    currentPublicKeySpki: publicKeySpki,
    label,
  });
  const identity = {
    key_id: keyId,
    public_key_spki: publicKeySpki,
    key_registry: parsedRegistry,
    key_registry_sha256: typeof registry === "string" ? signingKeyRegistrySha256(registry) : null,
  };
  const envelopeInputs = [registryEnvelope, registryRaw, registryRootKeyId, registryRootPublicKeySpki];
  if (envelopeInputs.some((value) => value !== undefined)) {
    if (envelopeInputs.some((value) => value === undefined)) {
      throw new Error(`${label} registry envelope inputs are incomplete`);
    }
    const parsedEnvelope = typeof registryEnvelope === "string"
      ? parseJsonObject(registryEnvelope, `${label} registry envelope`)
      : registryEnvelope;
    assertSignedResultRegistryEnvelope(parsedEnvelope, {
      registry: parsedRegistry,
      registryRaw,
      trustedRootKeyId: registryRootKeyId,
      trustedRootPublicKeySpki: registryRootPublicKeySpki,
    });
    identity.result_key_registry_envelope_sha256 = resultRegistryEnvelopeHash(registryEnvelope);
    identity.result_registry_root_key_id = registryRootKeyId;
    identity.result_registry_root_public_key_spki = registryRootPublicKeySpki;
  }
  return identity;
}

export function assertRequiredProductionSecrets(environment, names) {
  const missing = names.filter((name) => !environment[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`required production secrets are missing: ${missing.join(", ")}`);
  }
}

function assertRawNotaryEndpoint(value) {
  if (typeof value !== "string" || !value || /\s|:\/\//.test(value)) {
    throw new Error("Notary endpoint must be a raw host:port value");
  }
  let host;
  let port;
  if (value.startsWith("[")) {
    const separator = value.lastIndexOf("]:" );
    if (separator < 0) throw new Error("Notary endpoint must use [host]:port syntax");
    host = value.slice(1, separator);
    port = value.slice(separator + 2);
  } else {
    const separator = value.lastIndexOf(":");
    if (separator <= 0 || value.indexOf(":") !== separator) {
      throw new Error("Notary endpoint must use host:port syntax");
    }
    host = value.slice(0, separator);
    port = value.slice(separator + 1);
  }
  if (!host || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("Notary endpoint must contain a valid port");
  }
}

function assertCleanHttpsEndpoint(value, path, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== path ||
    !DNS_HOSTNAME_PATTERN.test(parsed.hostname.toLowerCase())
  ) {
    throw new Error(`${label} must be a clean HTTPS URL with path ${path}`);
  }
}

function assertServerIdentity(value) {
  if (typeof value !== "string" || !DNS_HOSTNAME_PATTERN.test(value.toLowerCase())) {
    throw new Error("server identity must be a DNS hostname");
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(sortedExpected)) {
    throw new Error(`${label} contains fields outside the public manifest schema`);
  }
}

export function assertPublicManifest(manifest) {
  if (
    manifest?.schema_version !== PRODUCTION_PUBLIC_MANIFEST_SCHEMA_VERSION ||
    manifest?.scope !== PRODUCTION_PUBLIC_MANIFEST_SCOPE
  ) {
    throw new Error("public Production TLSN manifest schema is invalid");
  }
  assertExactKeys(manifest, ["schema_version", "scope", "notary", "session_authority", "result_signing", "verification_endpoint", "origin_inventory", "security_registry_set_sha256"], "manifest");
  assertExactKeys(manifest.notary, ["endpoint", "key_id", "verifying_key", "registry_entry", "registry_raw", "registry_sha256"], "manifest.notary");
  assertExactKeys(manifest.notary.registry_entry, ["key_id", "verifying_key"], "manifest.notary.registry_entry");
  if (manifest.notary.registry_entry.key_id !== manifest.notary.key_id || manifest.notary.registry_entry.verifying_key !== manifest.notary.verifying_key) {
    throw new Error("manifest Notary registry entry does not match its public key");
  }
  assertRawNotaryEndpoint(manifest.notary.endpoint);
  if (!KEY_ID_PATTERN.test(manifest.notary.key_id)) throw new Error("manifest Notary key ID is invalid");
  assertAlpha15NotaryVerifyingKey(manifest.notary.verifying_key, "manifest Notary verifying key");
  const manifestNotaryRegistry = parseNotaryRegistry(manifest.notary.registry_raw, "manifest Notary registry");
  if (manifestNotaryRegistry[manifest.notary.key_id] !== manifest.notary.verifying_key) {
    throw new Error("manifest Notary registry does not contain the selected public key");
  }
  if (notaryRegistrySha256(manifest.notary.registry_raw) !== manifest.notary.registry_sha256) {
    throw new Error("manifest Notary registry hash does not match its registry bytes");
  }
  assertSha256(manifest.notary.registry_sha256, "manifest Notary registry hash");
  assertExactKeys(manifest.session_authority, ["endpoint", "key_id", "public_key_spki", "key_registry_sha256"], "manifest.session_authority");
  assertCleanHttpsEndpoint(manifest.session_authority.endpoint, "/attestation/session", "manifest Session Authority endpoint");
  if (!KEY_ID_PATTERN.test(manifest.session_authority.key_id)) throw new Error("manifest Session Authority key ID is invalid");
  assertPublicEd25519Spki(manifest.session_authority.public_key_spki, "manifest Session Authority public key");
  assertSha256(manifest.session_authority.key_registry_sha256, "manifest Session Authority registry hash");
  assertExactKeys(manifest.result_signing, [
    "key_id",
    "public_key_spki",
    "key_registry",
    "key_registry_sha256",
    "result_key_registry_envelope_sha256",
    "result_registry_root_key_id",
    "result_registry_root_public_key_spki",
  ], "manifest.result_signing");
  assertResultSigningIdentity({
    registry: manifest.result_signing.key_registry,
    keyId: manifest.result_signing.key_id,
    publicKeySpki: manifest.result_signing.public_key_spki,
  });
  assertSha256(manifest.result_signing.key_registry_sha256, "manifest Result signing registry hash");
  assertSha256(manifest.result_signing.result_key_registry_envelope_sha256, "manifest Result registry envelope hash");
  if (!KEY_ID_PATTERN.test(manifest.result_signing.result_registry_root_key_id)) {
    throw new Error("manifest Result registry Root key ID is invalid");
  }
  assertPublicEd25519Spki(
    manifest.result_signing.result_registry_root_public_key_spki,
    "manifest Result registry Root public key",
  );
  assertCleanHttpsEndpoint(manifest.verification_endpoint, "/verify/tlsn", "manifest Verification endpoint");
  assertExactKeys(manifest.origin_inventory, ["schema_version", "sha256", "target_count", "port"], "manifest.origin_inventory");
  const shippedInventory = loadOriginInventoryContract();
  if (
    manifest.origin_inventory.schema_version !== shippedInventory.schema_version ||
    manifest.origin_inventory.sha256 !== shippedInventory.sha256 ||
    manifest.origin_inventory.target_count !== shippedInventory.target_count ||
    manifest.origin_inventory.port !== shippedInventory.port
  ) {
    throw new Error("manifest Origin inventory does not match the shipped inventory contract");
  }
  assertSha256(manifest.security_registry_set_sha256, "manifest security registry set hash");
  const profilePolicySha256 = createHash("sha256")
    .update(canonicalJson(PROFILE_CONTRACT_SPEC), "utf8")
    .digest("base64url");
  const trustSetPayload = productionSecurityRegistrySetPayload({
    notaryKeyId: manifest.notary.key_id,
    notaryRegistryRaw: canonicalJson(manifestNotaryRegistry),
    originInventorySha256: shippedInventory.sha256,
    profilePolicySha256,
  });
  const expectedSecurityRegistrySetSha256 = createHash("sha256")
    .update(canonicalJson(trustSetPayload), "utf8")
    .digest("base64url");
  if (manifest.security_registry_set_sha256 !== expectedSecurityRegistrySetSha256) {
    throw new Error("manifest security registry set does not match its Notary, inventory, and profile inputs");
  }
  return manifest;
}

export function buildProductionPublicManifest({
  notaryEndpoint,
  notaryKeyId,
  notaryRegistryRaw,
  sessionAuthorityEndpoint,
  sessionAuthorityKeyId,
  sessionAuthorityPublicKeySpki,
  sessionAuthorityKeyRegistryRaw,
  resultSignerKeyId,
  resultPublicKeySpki,
  resultSigningKeyRegistryRaw,
  resultSigningKeyRegistryEnvelopeRaw,
  resultRegistryRootKeyId,
  resultRegistryRootPublicKeySpki,
  verificationEndpoint,
  securityRegistrySetSha256,
} = {}) {
  const notary = assertNotaryRegistryConsistency({
    sourceRegistryRaw: notaryRegistryRaw,
    keyId: notaryKeyId,
  });
  const sessionAuthority = assertSessionAuthorityIdentity({
    registry: sessionAuthorityKeyRegistryRaw,
    keyId: sessionAuthorityKeyId,
    publicKeySpki: sessionAuthorityPublicKeySpki,
  });
  const resultSigning = assertResultSigningIdentity({
    registry: resultSigningKeyRegistryRaw,
    keyId: resultSignerKeyId,
    publicKeySpki: resultPublicKeySpki,
    registryEnvelope: resultSigningKeyRegistryEnvelopeRaw,
    registryRaw: resultSigningKeyRegistryRaw,
    registryRootKeyId: resultRegistryRootKeyId,
    registryRootPublicKeySpki: resultRegistryRootPublicKeySpki,
  });
  assertRawNotaryEndpoint(notaryEndpoint);
  assertCleanHttpsEndpoint(sessionAuthorityEndpoint, "/attestation/session", "Session Authority endpoint");
  assertCleanHttpsEndpoint(verificationEndpoint, "/verify/tlsn", "Verification endpoint");
  assertSha256(securityRegistrySetSha256, "security registry set hash");
  const originInventory = loadOriginInventoryContract();
  return assertPublicManifest({
    schema_version: PRODUCTION_PUBLIC_MANIFEST_SCHEMA_VERSION,
    scope: PRODUCTION_PUBLIC_MANIFEST_SCOPE,
    notary: {
      endpoint: notaryEndpoint,
      ...notary,
      registry_raw: notaryRegistryRaw,
    },
    session_authority: {
      endpoint: sessionAuthorityEndpoint,
      ...sessionAuthority,
      key_registry_sha256: authorityKeyRegistrySha256(sessionAuthorityKeyRegistryRaw),
    },
    result_signing: resultSigning,
    verification_endpoint: verificationEndpoint,
    security_registry_set_sha256: securityRegistrySetSha256,
    origin_inventory: {
      schema_version: originInventory.schema_version,
      sha256: originInventory.sha256,
      target_count: originInventory.target_count,
      port: originInventory.port,
    },
  });
}

export function assertCanaryDeploymentIdentity(manifest) {
  if (
    manifest?.schema_version !== 2 ||
    manifest?.scope !== "tlsn-canary-deployment-manifest" ||
    !manifest.deployment ||
    !manifest.workflow ||
    !manifest.target ||
    manifest.target.environment !== "production" ||
    manifest.target.deployment_role !== "canary" ||
    manifest.deployment.deployment_id?.trim() === "" ||
    manifest.deployment.worker_name?.trim() === "" ||
    !/^[0-9a-f]{40}$/i.test(manifest.workflow.commit_sha)
  ) {
    throw new Error("Canary deployment manifest identity is invalid");
  }
  return {
    deployment_id: manifest.deployment.deployment_id,
    worker_name: manifest.deployment.worker_name,
    git_commit_sha: manifest.workflow.commit_sha,
    binding_mode: "fixed_canary",
  };
}

export function appConfigTomlFromManifest(
  manifest,
  artifactOutputPath,
  canaryDeploymentManifest,
  workerHealthEndpoint,
) {
  assertPublicManifest(manifest);
  assertCanaryDeploymentIdentity(canaryDeploymentManifest);
  if (typeof artifactOutputPath !== "string" || !artifactOutputPath.trim()) {
    throw new Error("APP artifact output path is required separately from the public manifest");
  }
  assertCleanHttpsEndpoint(workerHealthEndpoint, "/health", "Worker health endpoint");
  const quote = (value) => JSON.stringify(value);
  return [
    "[proxy.tlsn]",
    "enabled = true",
    'disclosure_mode = "complete"',
    'response_mode = "async"',
    `artifact_output_path = ${quote(artifactOutputPath)}`,
    "",
  ].join("\n");
}
