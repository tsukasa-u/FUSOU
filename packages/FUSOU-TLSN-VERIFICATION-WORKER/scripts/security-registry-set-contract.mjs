import { createHash } from "node:crypto";
import { canonicalJson, canonicalNotaryRegistryJson } from "./production-trust-contract.mjs";

export const SECURITY_REGISTRY_SET_CONTRACT = {
  schema_version: 1,
  source_of_truth: "scripts/security-registry-set-contract.mjs",
  canonicalization: "canonicalJson",
  encoding: "UTF-8",
  whitespace: "none",
  hash_algorithm: "SHA-256",
  digest_encoding: "base64url without padding",
  fields: [
    "notary_registry",
    "profile_sha256",
    "server_identity",
    "sparse_profile_sha256",
  ],
  profile_hash_semantics: "supplied canonical profile hashes; profile bytes are not recomputed here",
  notary_registry_semantics: "validated JSON object canonicalized with canonicalJson inside the security registry set payload; runtime receives the normalized registry string separately",
  exclusions: [
    "deployment_id",
    "response_mode",
    "worker_name",
    "trust_root",
    "signing keys",
    "private keys",
    "callback secrets",
    "access tokens",
  ],
};

const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DNS_HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

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
  notaryRegistryRaw,
  profileSha256,
  serverIdentity,
  sparseProfileSha256,
} = {}) {
  assertHash(profileSha256, "profile_sha256");
  assertHash(sparseProfileSha256, "sparse_profile_sha256");
  assertServerIdentity(serverIdentity);
  const canonicalNotaryRegistryRaw = canonicalNotaryRegistryJson(
    notaryRegistryRaw,
    "security registry set Notary registry",
  );
  return {
    notary_registry: JSON.parse(canonicalNotaryRegistryRaw),
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