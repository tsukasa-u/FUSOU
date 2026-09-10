import { createHash, createPublicKey, X509Certificate } from "node:crypto";
import {
  assertAuthorityKeyRegistry,
  authorityKeyRegistrySha256,
} from "./authority-key-registry.mjs";

export const PRODUCTION_PUBLIC_MANIFEST_SCHEMA_VERSION = 1;
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

function assertCanonicalBase64Url(value, label) {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new Error(`${label} must be canonical base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== value) {
    throw new Error(`${label} must be canonical base64url`);
  }
  return bytes;
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
    assertCanonicalBase64Url(publicKey, `${label} entry`);
  }
  return registry;
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
  const workerRegistry = parseNotaryRegistry(workerRegistryRaw, "Worker Notary registry");
  const evidenceRegistry = parseNotaryRegistry(evidenceRegistryRaw, "Evidence Notary registry");
  const sourceCanonical = canonicalJson(sourceRegistry);
  if (canonicalJson(workerRegistry) !== sourceCanonical) {
    throw new Error("Worker Notary registry does not match the source registry");
  }
  if (canonicalJson(evidenceRegistry) !== sourceCanonical) {
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

function assertTrustRoot(value) {
  const bytes = assertCanonicalBase64Url(value, "origin trust root");
  try {
    new X509Certificate(bytes);
  } catch {
    throw new Error("origin trust root must be a valid DER X.509 certificate");
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
  assertExactKeys(manifest, ["schema_version", "scope", "notary", "session_authority", "verification_endpoint", "origin"], "manifest");
  assertExactKeys(manifest.notary, ["endpoint", "key_id", "verifying_key", "registry_entry", "registry_sha256"], "manifest.notary");
  assertExactKeys(manifest.notary.registry_entry, ["key_id", "verifying_key"], "manifest.notary.registry_entry");
  if (manifest.notary.registry_entry.key_id !== manifest.notary.key_id || manifest.notary.registry_entry.verifying_key !== manifest.notary.verifying_key) {
    throw new Error("manifest Notary registry entry does not match its public key");
  }
  assertRawNotaryEndpoint(manifest.notary.endpoint);
  if (!KEY_ID_PATTERN.test(manifest.notary.key_id)) throw new Error("manifest Notary key ID is invalid");
  assertCanonicalBase64Url(manifest.notary.verifying_key, "manifest Notary verifying key");
  assertSha256(manifest.notary.registry_sha256, "manifest Notary registry hash");
  assertExactKeys(manifest.session_authority, ["endpoint", "key_id", "public_key_spki", "key_registry_sha256"], "manifest.session_authority");
  assertCleanHttpsEndpoint(manifest.session_authority.endpoint, "/attestation/session", "manifest Session Authority endpoint");
  if (!KEY_ID_PATTERN.test(manifest.session_authority.key_id)) throw new Error("manifest Session Authority key ID is invalid");
  assertPublicEd25519Spki(manifest.session_authority.public_key_spki, "manifest Session Authority public key");
  assertSha256(manifest.session_authority.key_registry_sha256, "manifest Session Authority registry hash");
  assertCleanHttpsEndpoint(manifest.verification_endpoint, "/verify/tlsn", "manifest Verification endpoint");
  assertExactKeys(manifest.origin, ["server_identity", "trust_roots", "port"], "manifest.origin");
  assertServerIdentity(manifest.origin.server_identity);
  if (!Array.isArray(manifest.origin.trust_roots) || manifest.origin.trust_roots.length === 0) {
    throw new Error("manifest origin trust roots are required");
  }
  for (const root of manifest.origin.trust_roots) assertTrustRoot(root);
  if (!Number.isInteger(manifest.origin.port) || manifest.origin.port < 1 || manifest.origin.port > 65535) {
    throw new Error("manifest origin port is invalid");
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
  verificationEndpoint,
  serverIdentity,
  trustRootCertificateDer,
  originPort,
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
  assertRawNotaryEndpoint(notaryEndpoint);
  assertCleanHttpsEndpoint(sessionAuthorityEndpoint, "/attestation/session", "Session Authority endpoint");
  assertCleanHttpsEndpoint(verificationEndpoint, "/verify/tlsn", "Verification endpoint");
  assertServerIdentity(serverIdentity);
  assertTrustRoot(trustRootCertificateDer);
  if (!Number.isInteger(Number(originPort)) || Number(originPort) < 1 || Number(originPort) > 65535) {
    throw new Error("origin port is invalid");
  }
  return assertPublicManifest({
    schema_version: PRODUCTION_PUBLIC_MANIFEST_SCHEMA_VERSION,
    scope: PRODUCTION_PUBLIC_MANIFEST_SCOPE,
    notary: {
      endpoint: notaryEndpoint,
      ...notary,
    },
    session_authority: {
      endpoint: sessionAuthorityEndpoint,
      ...sessionAuthority,
      key_registry_sha256: authorityKeyRegistrySha256(sessionAuthorityKeyRegistryRaw),
    },
    verification_endpoint: verificationEndpoint,
    origin: {
      server_identity: serverIdentity,
      trust_roots: [trustRootCertificateDer],
      port: Number(originPort),
    },
  });
}

export function appConfigTomlFromManifest(manifest, artifactOutputPath) {
  assertPublicManifest(manifest);
  if (typeof artifactOutputPath !== "string" || !artifactOutputPath.trim()) {
    throw new Error("APP artifact output path is required separately from the public manifest");
  }
  const quote = (value) => JSON.stringify(value);
  return [
    "[proxy]",
    "tlsn_production_enabled = true",
    `tlsn_notary_endpoint = ${quote(manifest.notary.endpoint)}`,
    `tlsn_session_authority_endpoint = ${quote(manifest.session_authority.endpoint)}`,
    `tlsn_session_authority_public_key = ${quote(manifest.session_authority.public_key_spki)}`,
    `tlsn_session_authority_key_id = ${quote(manifest.session_authority.key_id)}`,
    `tlsn_verification_endpoint = ${quote(manifest.verification_endpoint)}`,
    `tlsn_notary_verifying_key = ${quote(manifest.notary.verifying_key)}`,
    `tlsn_origin_port = ${manifest.origin.port}`,
    `tlsn_server_identity = ${quote(manifest.origin.server_identity)}`,
    `tlsn_origin_trust_roots = [${manifest.origin.trust_roots.map(quote).join(", ")}]`,
    `tlsn_artifact_output_path = ${quote(artifactOutputPath)}`,
    "",
  ].join("\n");
}
