export const PROFILE_CONTRACT_SCHEMA_VERSION: number;
export const COMPLETE_PROFILE_ID: string;
export const SPARSE_PROFILE_ID: string;
export const REQUIRE_INFO_TARGET: string;
export const FIXTURE_SERVER_IDENTITY: string;
export const COMPLETE_DISCLOSURE_MODE: string;
export const SPARSE_DISCLOSURE_MODE: string;
export const RESPONSE_MODES: readonly string[];
export const PROFILE_CONTRACT_SPEC: Record<string, unknown>;

export function canonicalJson(value: unknown): string;
export function assertAlpha15NotaryVerifyingKey(value: string, label?: string): void;
export function parseOriginInventory(raw: string): {
  schema_version: 1;
  source: string;
  targets: Array<{ server_index: number; server_identity: string; port: 443 }>;
};
export function sha256Base64Url(bytes: Uint8Array): Promise<string>;
export function securityRegistrySetPayload(input: {
  notaryKeyId: string;
  notaryRegistryRaw: string;
  profileSha256: string;
  serverIdentity: string;
  sparseProfileSha256: string;
}): {
  notary_key_id: string;
  notary_registry: Record<string, string>;
  profile_sha256: string;
  server_identity: string;
  sparse_profile_sha256: string;
};
export function productionSecurityRegistrySetPayload(input: {
  notaryKeyId: string;
  notaryRegistryRaw: string;
  originInventorySha256: string;
  profilePolicySha256: string;
}): {
  notary_key_id: string;
  notary_registry: Record<string, string>;
  origin_inventory_sha256: string;
  profile_policy_sha256: string;
};
export function productionSecurityRegistrySetCanonical(input: {
  notaryKeyId: string;
  notaryRegistryRaw: string;
  originInventorySha256: string;
  profilePolicySha256: string;
}): { payload: ReturnType<typeof productionSecurityRegistrySetPayload>; canonical: string };