export const COMMON_INPUTS = [
  "TLSN_ENVIRONMENT",
  "TLSN_DEPLOYMENT_ROLE",
  "TLSN_BINDING_TTL_SECONDS",
  "TLSN_GIT_COMMIT_SHA",
  "TLSN_CANDIDATE_SERVER_IDENTITY",
  "TLSN_CANDIDATE_PROFILE_SHA256",
  "TLSN_CANDIDATE_VERIFIER_KEY_ID",
  "TLSN_CANDIDATE_NOTARY_KEY_ID",
  "TLSN_CANDIDATE_NOTARY_REGISTRY",
  "TLSN_CANDIDATE_DEVICE_AUTH_URL",
  "TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL",
  "TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS",
  "TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS",
  "TLSN_CANDIDATE_SUPABASE_URL",
  "TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_SECURITY_REGISTRY_SET_SHA256",
];

export const WORKFLOW_EVIDENCE_INPUTS = [
  "TLSN_WORKFLOW_RUN_ID",
  "TLSN_WORKFLOW_RUN_ATTEMPT",
  "TLSN_REPOSITORY",
  "TLSN_WORKFLOW_FILE_IDENTITY",
];

export const PRODUCTION_GATE_INPUTS = [
  "TLSN_ATTESTATION_SIGNER_KEY_ID",
  "TLSN_ATTESTATION_SIGNER_PUBLIC_KEY_SPKI",
  "TLSN_MAX_ATTESTATION_AGE_SECONDS",
];

export const CANARY_INPUTS = [
  "TLSN_CANARY_DEPLOYMENT_ID",
  "TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_RESULT_SIGNER_KEY_ID",
  "TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY",
  "TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_SESSION_AUTHORITY_KEY_ID",
  "TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY",
  "TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_CANARY_BINDING_AUTHORITY_KEY_ID",
  "TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY",
  "TLSN_CANARY_BINDING_VALUE",
  "TLSN_CANARY_WORKER_NAME",
];

export const PRODUCTION_INPUTS = [
  "TLSN_PRODUCTION_DEPLOYMENT_ID",
  "TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI",
  "TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID",
  "TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY",
  "TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID",
  "TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY",
  "TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID",
  "TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY",
  "TLSN_PRODUCTION_WORKER_NAME",
];

export const PRODUCTION_EVIDENCE_INPUTS = [
  "TLSN_PRODUCTION_EVIDENCE_OUTPUT_PATH",
  "TLSN_PRODUCTION_EVIDENCE_WORKER_URL",
  "TLSN_PRODUCTION_EVIDENCE_WEB_ORIGIN",
  "TLSN_PRODUCTION_EVIDENCE_SUPABASE_URL",
  "TLSN_PRODUCTION_EVIDENCE_SUPABASE_PUBLISHABLE_KEY",
  "TLSN_PRODUCTION_EVIDENCE_ACCESS_TOKEN",
  "TLSN_PRODUCTION_EVIDENCE_DEVICE_ID",
  "TLSN_PRODUCTION_EVIDENCE_DEVICE_PRIVATE_KEY_PKCS8_FILE",
  "TLSN_PRODUCTION_EVIDENCE_DEVICE_PRIVATE_KEY_PKCS8_B64URL",
  "TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PATH",
  "TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PROVENANCE_JSON",
  "TLSN_PRODUCTION_PROXY_PROVENANCE_PIN_JSON",
  "TLSN_PRODUCTION_EVIDENCE_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_PRODUCTION_EVIDENCE_SIGNING_PRIVATE_KEY_PKCS8_B64URL",
  "TLSN_PRODUCTION_EVIDENCE_SIGNER_PUBLIC_KEY_SPKI",
  "TLSN_PRODUCTION_EVIDENCE_SIGNER_KEY_ID",
  "TLSN_PRODUCTION_NOTARY_REGISTRY",
  "TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER",
];

export const CANARY_SECRET_INPUTS = [
  "TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_CANARY_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_CANARY_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER",
];

export const PRODUCTION_SECRET_INPUTS = [
  "TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER",
];

export const REMOTE_ATTESTATION_SECRET_INPUTS = [
  "TLSN_REMOTE_ATTESTATION_SIGNING_PRIVATE_KEY_PKCS8",
];

export const SECURITY_IDENTITY_FIELDS = [
  "git_commit_sha",
  "server_identity",
  "profile_sha256",
  "verifier_key_id",
  "notary_key_id",
  "security_registry_set_sha256",
  "notary_registry_sha256",
  "binding_authority",
];

export const DEPLOYMENT_IDENTITY_FIELDS = [
  "deployment_id",
  "deployment_role",
  "binding_mode",
  "trust_root_certificate_sha256",
  "worker_name",
];

export const RESULT_IDENTITY_FIELDS = ["result_public_key_spki"];

export const RUNTIME_INPUTS = [
  "PATH", "HOME", "PWD", "TMPDIR", "TMP", "TEMP", "CI", "NODE_OPTIONS",
  "XDG_CACHE_HOME", "CARGO_HOME", "RUSTUP_HOME", "CC_wasm32_unknown_unknown",
  "AR_wasm32_unknown_unknown", "RUSTFLAGS",
];

export const DEPLOYMENT_AUTH_INPUTS = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "WRANGLER_SEND_METRICS",
  "WRANGLER_LOG",
];

export const FORBIDDEN_CANARY_INPUTS = [
  ...PRODUCTION_SECRET_INPUTS,
  ...PRODUCTION_INPUTS,
];

export const FORBIDDEN_PRODUCTION_INPUTS = [
  ...CANARY_SECRET_INPUTS,
  ...CANARY_INPUTS,
  ...REMOTE_ATTESTATION_SECRET_INPUTS,
];

export function inputsForRole(role) {
  if (role === "canary") return [...COMMON_INPUTS, ...CANARY_INPUTS];
  if (role === "production") return [...COMMON_INPUTS, ...PRODUCTION_INPUTS];
  throw new Error(`unsupported deployment role: ${role}`);
}

export function secretInputsForRole(role) {
  if (role === "canary") return [...CANARY_SECRET_INPUTS];
  if (role === "production") return [...PRODUCTION_SECRET_INPUTS];
  throw new Error(`unsupported deployment role: ${role}`);
}

export function assertManifest(manifest) {
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  if (
    manifest?.schema_version !== 2 ||
    manifest?.scope !== "tlsn-deployment-inputs" ||
    !same(manifest.common_inputs, COMMON_INPUTS) ||
    !same(manifest.canary_inputs, CANARY_INPUTS) ||
    !same(manifest.production_inputs, PRODUCTION_INPUTS) ||
    !same(manifest.production_evidence_inputs, PRODUCTION_EVIDENCE_INPUTS) ||
    !same(manifest.canary_secret_inputs, CANARY_SECRET_INPUTS) ||
    !same(manifest.production_secret_inputs, PRODUCTION_SECRET_INPUTS) ||
    !same(manifest.workflow_evidence_inputs, WORKFLOW_EVIDENCE_INPUTS) ||
    !same(manifest.production_gate_inputs, PRODUCTION_GATE_INPUTS) ||
    !same(manifest.remote_attestation_secret_inputs, REMOTE_ATTESTATION_SECRET_INPUTS)
  ) {
    throw new Error("production input manifest is invalid");
  }
}

export function environmentForNames(source, names) {
  return Object.fromEntries(
    Object.entries(source).filter(([name]) => names.includes(name)),
  );
}

export function assertNoForbiddenInputs(source, forbiddenNames, role) {
  const present = forbiddenNames.filter((name) => source[name] !== undefined);
  if (present.length > 0) {
    throw new Error(`${role} deployment received forbidden inputs: ${present.join(", ")}`);
  }
}

export function assertDistinctResultKeys(canary, production) {
  if (
    canary?.result_identity?.result_public_key_spki ===
    production?.result_identity?.result_public_key_spki
  ) {
    throw new Error("canary and production result public keys must be different");
  }
}

export function securityIdentityFromHealth(health) {
  return health?.security_identity ?? null;
}

export function deploymentIdentityFromHealth(health) {
  return health?.deployment_identity ?? null;
}

export function resultIdentityFromHealth(health) {
  return health?.result_identity ?? null;
}
