import { createHash } from "node:crypto";
import { canonicalJson, canonicalNotaryRegistryJson } from "./production-trust-contract.mjs";
import { PROFILE_CONTRACT_SPEC } from "./profile-canonical-contract.mjs";
import { loadOriginInventoryContract } from "./origin-inventory-contract.mjs";

export const SECURITY_REGISTRY_SET_CONTRACT = {
  schema_version: 2,
  source_of_truth: "scripts/security-registry-set-contract.mjs",
  roles: {
    canary: {
      schema_version: 1,
      canonicalization: "canonicalJson",
      encoding: "UTF-8",
      whitespace: "none",
      hash_algorithm: "SHA-256",
      digest_encoding: "base64url without padding",
      fields: ["notary_key_id", "notary_registry", "profile_sha256", "server_identity", "sparse_profile_sha256"],
      profile_hash_semantics: "supplied canonical profile hashes bound to this Canary deployment target",
    },
    production: {
      schema_version: 2,
      canonicalization: "canonicalJson",
      encoding: "UTF-8",
      whitespace: "none",
      hash_algorithm: "SHA-256",
      digest_encoding: "base64url without padding",
      fields: ["notary_key_id", "notary_registry", "origin_inventory_sha256", "profile_policy_sha256"],
      origin_inventory_semantics: "byte-level SHA-256 of the shipped 20-host HTTPS Origin inventory",
      profile_policy_semantics: "SHA-256 of the canonical complete/sparse profile policy; per-host profile hashes are derived at verification time",
    },
  },
  notary_key_id_semantics: "selected trust-anchor key ID; it must be present in the canonical Notary registry and is independently bound into the payload",
  notary_registry_semantics: "validated JSON object canonicalized with canonicalJson inside the security registry set payload; runtime receives the normalized registry string separately",
  exclusions: ["deployment_id", "response_mode", "worker_name", "signing keys", "private keys", "callback secrets", "access tokens"],
};

const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DNS_HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function assertHash(value, label) {
  if (typeof value !== "string" || !BASE64URL_SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a SHA-256 base64url digest`);
  }
}

function assertServerIdentity(value) {
  if (typeof value !== "string" || !DNS_HOSTNAME_PATTERN.test(value)) {
    throw new Error("server_identity must be a DNS hostname");
  }
}

export function securityRegistrySetPayload({
  notaryKeyId,
  notaryRegistryRaw,
  profileSha256,
  serverIdentity,
  sparseProfileSha256,
} = {}) {
  if (typeof notaryKeyId !== "string" || !KEY_ID_PATTERN.test(notaryKeyId)) {
    throw new Error("notary_key_id must be a valid key ID");
  }
  assertHash(profileSha256, "profile_sha256");
  assertHash(sparseProfileSha256, "sparse_profile_sha256");
  assertServerIdentity(serverIdentity);
  const canonicalNotaryRegistryRaw = canonicalNotaryRegistryJson(
    notaryRegistryRaw,
    "security registry set Notary registry",
  );
  const notaryRegistry = JSON.parse(canonicalNotaryRegistryRaw);
  if (!Object.hasOwn(notaryRegistry, notaryKeyId)) {
    throw new Error("notary_key_id must be present in the security registry set Notary registry");
  }
  return {
    notary_key_id: notaryKeyId,
    notary_registry: notaryRegistry,
    profile_sha256: profileSha256,
    server_identity: serverIdentity,
    sparse_profile_sha256: sparseProfileSha256,
  };
}

export function securityRegistrySetHash(inputs) {
  const payload = securityRegistrySetPayload(inputs);
  const canonical = canonicalJson(payload);
  return {
    payload,
    canonical,
    utf8_bytes: Buffer.from(canonical, "utf8"),
    sha256: createHash("sha256").update(canonical, "utf8").digest("base64url"),
  };
}

export function productionSecurityRegistrySetHash({ notaryKeyId, notaryRegistryRaw } = {}) {
  if (typeof notaryKeyId !== "string" || !KEY_ID_PATTERN.test(notaryKeyId)) {
    throw new Error("notary_key_id must be a valid key ID");
  }
  const canonicalNotaryRegistryRaw = canonicalNotaryRegistryJson(
    notaryRegistryRaw,
    "Production security registry set Notary registry",
  );
  const notaryRegistry = JSON.parse(canonicalNotaryRegistryRaw);
  if (!Object.hasOwn(notaryRegistry, notaryKeyId)) {
    throw new Error("notary_key_id must be present in the Production security registry set Notary registry");
  }
  const originInventory = loadOriginInventoryContract();
  const profilePolicySha256 = createHash("sha256")
    .update(canonicalJson(PROFILE_CONTRACT_SPEC), "utf8")
    .digest("base64url");
  const payload = {
    notary_key_id: notaryKeyId,
    notary_registry: JSON.parse(canonicalNotaryRegistryRaw),
    origin_inventory_sha256: originInventory.sha256,
    profile_policy_sha256: profilePolicySha256,
  };
  const canonical = canonicalJson(payload);
  return {
    payload,
    canonical,
    utf8_bytes: Buffer.from(canonical, "utf8"),
    sha256: createHash("sha256").update(canonical, "utf8").digest("base64url"),
  };
}