export const PREVIOUS_IDENTITY_FIELDS = [
  ["git_commit_sha", "security_identity"],
  ["server_identity", "security_identity"],
  ["profile_sha256", "security_identity"],
  ["verifier_key_id", "security_identity"],
  ["notary_key_id", "security_identity"],
  ["security_registry_set_sha256", "security_identity"],
  ["notary_registry_sha256", "security_identity"],
  ["binding_authority", "security_identity"],
  ["deployment_id", "deployment_identity"],
  ["deployment_role", "deployment_identity"],
  ["binding_mode", "deployment_identity"],
  ["trust_root_certificate_sha256", "deployment_identity"],
  ["worker_name", "deployment_identity"],
  ["result_public_key_spki", "result_identity"],
  ["result_signer_key_id", "result_identity"],
  ["result_key_registry_sha256", "result_identity"],
];

export const DEFAULT_EXPECTED_PREVIOUS_IDENTITY_CHANGES = new Set([
  "git_commit_sha",
  "deployment_id",
]);

export function parseExpectedIdentityChanges(raw) {
  if (!raw?.trim()) return new Set(DEFAULT_EXPECTED_PREVIOUS_IDENTITY_CHANGES);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("TLSN_EXPECTED_PREVIOUS_IDENTITY_CHANGES must be valid JSON");
  }
  if (
    !parsed ||
    Array.isArray(parsed) ||
    parsed.schema_version !== 1 ||
    Object.keys(parsed).sort().join(",") !== "allowed_change_fields,schema_version" ||
    !Array.isArray(parsed.allowed_change_fields) ||
    parsed.allowed_change_fields.some((field) => typeof field !== "string")
  ) {
    throw new Error("TLSN_EXPECTED_PREVIOUS_IDENTITY_CHANGES must use the versioned object schema");
  }
  const allowedFields = new Set(PREVIOUS_IDENTITY_FIELDS.map(([field]) => field));
  const result = new Set();
  for (const field of parsed.allowed_change_fields) {
    if (!allowedFields.has(field)) throw new Error(`unsupported previous identity field: ${field}`);
    if (result.has(field)) throw new Error(`duplicate previous identity field: ${field}`);
    result.add(field);
  }
  return result;
}