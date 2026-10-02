export const PROFILE_CONTRACT_SCHEMA_VERSION = 1;
export const COMPLETE_PROFILE_ID = "fusou-require-info-v1";
export const SPARSE_PROFILE_ID = "fusou-require-info-v2-sparse";
export const REQUIRE_INFO_TARGET = "/kcsapi/api_get_member/require_info";
export const FIXTURE_SERVER_IDENTITY = "game.example.test";
export const COMPLETE_DISCLOSURE_MODE = "full";
export const SPARSE_DISCLOSURE_MODE = "sparse";
export const RESPONSE_MODES = ["async", "sync"];

export const PROFILE_CONTRACT_SPEC = {
  schema_version: PROFILE_CONTRACT_SCHEMA_VERSION,
  source_of_truth: "scripts/profile-canonical-contract.mjs",
  canonicalization: "canonicalJson",
  encoding: "UTF-8",
  whitespace: "none",
  hash_algorithm: "SHA-256",
  digest_encoding: "base64url without padding",
  complete: {
    profile_id: COMPLETE_PROFILE_ID,
    field_set: ["id", "server_identity", "target"],
    required_fields: ["id", "server_identity", "target"],
    optional_fields: [],
    field_types: { id: "string", server_identity: "string", target: "string" },
    fixed_fields: { id: COMPLETE_PROFILE_ID, target: REQUIRE_INFO_TARGET },
    disclosure_mode: COMPLETE_DISCLOSURE_MODE,
  },
  sparse: {
    profile_id: SPARSE_PROFILE_ID,
    field_set: ["disclosure_mode", "id", "server_identity", "target", "version"],
    required_fields: ["disclosure_mode", "id", "server_identity", "target", "version"],
    optional_fields: [],
    field_types: {
      disclosure_mode: "string",
      id: "string",
      server_identity: "string",
      target: "string",
      version: "integer",
    },
    fixed_fields: {
      disclosure_mode: SPARSE_DISCLOSURE_MODE,
      id: SPARSE_PROFILE_ID,
      target: REQUIRE_INFO_TARGET,
      version: 2,
    },
    disclosure_mode: SPARSE_DISCLOSURE_MODE,
    profile_version: 2,
  },
  server_identity: {
    meaning: "TLSN attestation target origin/server identity, not a network destination",
    fixture_only_value: FIXTURE_SERVER_IDENTITY,
    production_input: "derived from the verified Presentation and matched to the shipped Origin inventory",
  },
  hash_inputs: ["canonical JSON", "UTF-8 bytes"],
  hash_exclusions: [
    "filename",
    "path",
    "environment",
    "deployment_id",
    "generated_at",
    "response_mode",
    "signing key",
    "Notary private key",
    "callback secret",
    "access token",
  ],
  disclosure_semantics: {
    complete: "full disclosure of the complete profile contract",
    sparse: "sparse disclosure using the sparse profile contract and version 2",
    relation: "complete and sparse profiles must share server_identity and target but have distinct IDs and hashes",
  },
  response_mode_semantics: {
    meaning: "verification result delivery mode, independent from profile semantics",
    allowed_values: RESPONSE_MODES,
    hash_inclusion: false,
    capability_input: "TLSN_CANARY_SYNCHRONOUS_RESPONSE_ENABLED",
  },
  production_inputs: {
    canary: {
      server_identity: "TLSN_CANDIDATE_SERVER_IDENTITY",
      complete_profile_hash: "TLSN_CANDIDATE_PROFILE_SHA256",
      sparse_profile_hash: "TLSN_CANDIDATE_SPARSE_PROFILE_SHA256",
    },
    production: {
      server_identity: "verified Presentation identity matched to shipped Origin inventory",
      profile_hashes: "computed at verification time for the selected identity and disclosure profile",
    },
    disclosure_mode: "request-time profile selection: full or sparse",
    response_mode: "request-time delivery selection: async or sync",
  },
};

const DNS_HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ORIGIN_INVENTORY_SOURCE = "packages/configs/configs.toml:[app.connect_kc_server.server_list]";

export function canonicalJson(value) {
  const canonicalize = (input) => {
    if (Array.isArray(input)) return input.map(canonicalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.keys(input).sort().map((key) => [key, canonicalize(input[key])]),
      );
    }
    return input;
  };
  return JSON.stringify(canonicalize(value));
}

export function parseOriginInventory(raw) {
  let inventory;
  try {
    inventory = JSON.parse(raw);
  } catch {
    throw new Error("shipped Origin inventory must be valid JSON");
  }
  if (
    inventory?.schema_version !== 1 ||
    inventory?.source !== ORIGIN_INVENTORY_SOURCE ||
    !Array.isArray(inventory.targets) ||
    inventory.targets.length !== 20
  ) {
    throw new Error("shipped Origin inventory must contain exactly 20 schema-v1 targets");
  }
  const indices = new Set();
  const identities = new Set();
  inventory.targets.forEach((target, index) => {
    if (
      !target ||
      Object.keys(target).sort().join(",") !== "port,server_identity,server_index" ||
      target.server_index !== index + 1 ||
      target.port !== 443 ||
      typeof target.server_identity !== "string" ||
      !DNS_HOSTNAME_PATTERN.test(target.server_identity) ||
      target.server_identity !== target.server_identity.toLowerCase() ||
      indices.has(target.server_index) ||
      identities.has(target.server_identity)
    ) {
      throw new Error("shipped Origin inventory contains an invalid, unordered, or duplicate target");
    }
    indices.add(target.server_index);
    identities.add(target.server_identity);
  });
  return inventory;
}

export function productionSecurityRegistrySetPayload({
  notaryKeyId,
  notaryRegistryRaw,
  originInventorySha256,
  profilePolicySha256,
} = {}) {
  if (typeof notaryKeyId !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(notaryKeyId)) {
    throw new Error("notary_key_id must be a valid key ID");
  }
  for (const [label, value] of [
    ["origin_inventory_sha256", originInventorySha256],
    ["profile_policy_sha256", profilePolicySha256],
  ]) {
    if (typeof value !== "string" || !SHA256_BASE64URL_PATTERN.test(value)) {
      throw new Error(`${label} must be a SHA-256 base64url digest`);
    }
  }
  let registry;
  try {
    registry = JSON.parse(notaryRegistryRaw);
  } catch {
    throw new Error("Production security registry set Notary registry must be valid JSON");
  }
  if (!registry || typeof registry !== "object" || Array.isArray(registry) || Object.keys(registry).length === 0) {
    throw new Error("Production security registry set Notary registry must be a non-empty object");
  }
  for (const [keyId, key] of Object.entries(registry)) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(keyId) || typeof key !== "string" || !/^[A-Za-z0-9_-]+$/.test(key)) {
      throw new Error("Production security registry set Notary registry contains an invalid entry");
    }
  }
  if (!Object.hasOwn(registry, notaryKeyId)) {
    throw new Error("notary_key_id must be present in the Production security registry set Notary registry");
  }
  return {
    notary_key_id: notaryKeyId,
    notary_registry: JSON.parse(canonicalJson(registry)),
    origin_inventory_sha256: originInventorySha256,
    profile_policy_sha256: profilePolicySha256,
  };
}

export function productionSecurityRegistrySetCanonical(inputs) {
  const payload = productionSecurityRegistrySetPayload(inputs);
  return { payload, canonical: canonicalJson(payload) };
}

export async function sha256Base64Url(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let binary = "";
  for (let offset = 0; offset < digest.length; offset += 0x8000) {
    binary += String.fromCharCode(...digest.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}