import { createPublicKey } from "node:crypto";
import { assertProfileContractInputs } from "./profile-canonical-contract.mjs";

export const CANARY_APPROVED_INPUT_CONTRACT_SCHEMA_VERSION = 1;
export const CANARY_APPROVED_INPUT_CONTRACT_SCOPE = "tlsn-canary-approved-input-contract";
export const CANARY_APPROVED_INPUT_CONTRACT_INPUT = "TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON";
export const FIXTURE_SERVER_IDENTITY = "game.example.test";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const DNS_HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9._:/-]{1,512}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export const CANARY_APPROVED_INPUT_CONTRACT_SCHEMA = {
  schema_version: CANARY_APPROVED_INPUT_CONTRACT_SCHEMA_VERSION,
  scope: CANARY_APPROVED_INPUT_CONTRACT_SCOPE,
  status: ["APPROVED", "FIXTURE_ONLY"],
  sections: [
    "target_approval",
    "verifier",
    "credential_policy",
    "authentication",
    "binding",
    "workflow",
    "identity_separation",
    "evidence_semantics",
  ],
  secret_policy: "metadata and secret-provider references only; secret values are forbidden",
};

const AUTHORITY_METADATA = [
  "evidence_root",
  "approved_trust_registry",
  "cryptographic_signatures",
  "verified_tlsn_presentation_binding",
  "independent_verifier_result",
];

const NON_AUTHORITY_METADATA = [
  "callback_metadata",
  "workflow_metadata",
  "r2_archive",
  "deployment_response",
  "http_status",
  "worker_self_reported_identity",
];

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort().join("\0");
  const expected = [...keys].sort().join("\0");
  if (actual !== expected) throw new Error(`${label} fields are invalid`);
}

function assertString(value, label, pattern = null) {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function assertBoolean(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
}

function assertHash(value, label) {
  return assertString(value, label, HASH_PATTERN);
}

function assertKeyId(value, label) {
  return assertString(value, label, KEY_ID_PATTERN);
}

function assertTimestamp(value, label) {
  assertString(value, label, ISO_TIMESTAMP_PATTERN);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} is invalid`);
  return value;
}

function assertPublicKey(value, label) {
  assertString(value, label, BASE64URL_PATTERN);
  if (value.length !== 59) throw new Error(`${label} must be an Ed25519 SPKI public key`);
  try {
    const key = createPublicKey({ key: Buffer.from(value, "base64url"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
  } catch {
    throw new Error(`${label} must be an Ed25519 SPKI public key`);
  }
  return value;
}

function assertReference(value, label) {
  return assertString(value, label, REFERENCE_PATTERN);
}

function assertFutureWindow(issuedAt, expiresAt, label, now) {
  const issuedMs = Date.parse(issuedAt);
  const expiresMs = Date.parse(expiresAt);
  if (expiresMs <= issuedMs || expiresMs <= now.getTime()) throw new Error(`${label} is expired or has an invalid validity window`);
}

function assertSame(actual, expected, label) {
  if (expected !== undefined && actual !== expected) throw new Error(`${label} does not match the deployment input`);
}

function assertNoSecretFields(value, label = "contract") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/(?:private|secret|password|bearer|access[_-]?token|credential[_-]?value|token[_-]?value)/i.test(key)
      && key !== "secret_provider_ref") {
      throw new Error(`${label} contains a secret value field`);
    }
    assertNoSecretFields(child, `${label}.${key}`);
  }
}

function assertTargetApproval(target, { fixtureOnly, now }) {
  assertExactKeys(target, [
    "target_identity", "target_hostname", "provenance", "approval_reference", "approver",
    "approved_at", "expires_at", "environment", "profile", "trust", "verifier_key_id",
    "workflow_repository", "not_production",
  ], "target_approval");
  assertString(target.target_identity, "target_approval.target_identity");
  assertString(target.target_hostname, "target_approval.target_hostname");
  if (target.target_identity !== target.target_hostname || !DNS_HOSTNAME_PATTERN.test(target.target_identity)) {
    throw new Error("target approval identity must be a DNS hostname and match target_hostname");
  }
  assertObject(target.provenance, "target_approval.provenance");
  assertExactKeys(target.provenance, ["scope", "artifact_sha256"], "target_approval.provenance");
  assertReference(target.provenance.scope, "target_approval.provenance.scope");
  assertHash(target.provenance.artifact_sha256, "target_approval.provenance.artifact_sha256");
  assertReference(target.approval_reference, "target_approval.approval_reference");
  assertString(target.approver, "target_approval.approver");
  assertTimestamp(target.approved_at, "target_approval.approved_at");
  assertTimestamp(target.expires_at, "target_approval.expires_at");
  assertFutureWindow(target.approved_at, target.expires_at, "target approval", now);
  assertSame(target.environment, "canary", "target approval environment");
  assertObject(target.profile, "target_approval.profile");
  assertExactKeys(target.profile, ["complete_sha256", "sparse_sha256"], "target_approval.profile");
  assertHash(target.profile.complete_sha256, "target_approval.profile.complete_sha256");
  assertHash(target.profile.sparse_sha256, "target_approval.profile.sparse_sha256");
  assertObject(target.trust, "target_approval.trust");
  assertExactKeys(target.trust, [
    "security_registry_set_sha256", "trust_root_certificate_sha256", "notary_registry_sha256",
    "notary_key_id", "result_registry_root_key_id",
  ], "target_approval.trust");
  assertHash(target.trust.security_registry_set_sha256, "target_approval.trust.security_registry_set_sha256");
  assertHash(target.trust.trust_root_certificate_sha256, "target_approval.trust.trust_root_certificate_sha256");
  assertHash(target.trust.notary_registry_sha256, "target_approval.trust.notary_registry_sha256");
  assertKeyId(target.trust.notary_key_id, "target_approval.trust.notary_key_id");
  assertKeyId(target.trust.result_registry_root_key_id, "target_approval.trust.result_registry_root_key_id");
  assertKeyId(target.verifier_key_id, "target_approval.verifier_key_id");
  assertString(target.workflow_repository, "target_approval.workflow_repository");
  assertBoolean(target.not_production, "target_approval.not_production");
  if (!target.not_production) throw new Error("target approval must be explicitly non-production");
  if (fixtureOnly) {
    if (target.target_identity !== FIXTURE_SERVER_IDENTITY || target.provenance.scope !== "repository-local-synthetic-fixture") {
      throw new Error("fixture-only target approval must use the repository synthetic fixture identity");
    }
  } else if (
    target.target_identity === FIXTURE_SERVER_IDENTITY
    || /(?:test|synthetic|fixture|local|staging)/i.test(target.target_identity)
    || /(?:historical|synthetic|fixture|remote-test)/i.test(target.provenance.scope)
  ) {
    throw new Error("real Canary target approval contains a fixture, synthetic, or historical identity");
  }
}

function assertVerifier(verifier, { fixtureOnly, expectedDeploymentId, expectedVerifierDeploymentId, expectedKeyId, expectedPublicKey, now }) {
  assertExactKeys(verifier, [
    "key_id", "public_key_spki", "algorithm", "environment", "purpose", "not_before", "not_after",
    "registry_reference", "deployment_id", "binding_identity",
  ], "verifier");
  assertKeyId(verifier.key_id, "verifier.key_id");
  assertPublicKey(verifier.public_key_spki, "verifier.public_key_spki");
  assertSame(verifier.algorithm, "Ed25519", "verifier algorithm");
  assertSame(verifier.environment, "canary", "verifier environment");
  assertSame(verifier.purpose, "tlsn-result-verification", "verifier purpose");
  assertTimestamp(verifier.not_before, "verifier.not_before");
  if (verifier.not_after !== null) assertTimestamp(verifier.not_after, "verifier.not_after");
  if (verifier.not_after !== null && Date.parse(verifier.not_after) <= Date.parse(verifier.not_before)) throw new Error("verifier validity window is invalid");
  if (Date.parse(verifier.not_before) > now.getTime() || (verifier.not_after !== null && Date.parse(verifier.not_after) <= now.getTime())) throw new Error("verifier key is outside its validity window");
  assertReference(verifier.registry_reference, "verifier.registry_reference");
  assertReference(verifier.deployment_id, "verifier.deployment_id");
  assertReference(verifier.binding_identity, "verifier.binding_identity");
  assertSame(verifier.key_id, expectedKeyId, "verifier key ID");
  assertSame(verifier.public_key_spki, expectedPublicKey, "verifier public key");
  if (!fixtureOnly) assertSame(verifier.deployment_id, expectedVerifierDeploymentId ?? expectedDeploymentId, "verifier deployment ID");
}

function assertCredentialPolicy(policy, { fixtureOnly, now }) {
  assertExactKeys(policy, ["schema_version", "scope", "credentials"], "credential_policy");
  if (policy.schema_version !== 1 || policy.scope !== "tlsn-canary-credential-lifetime-policy" || !Array.isArray(policy.credentials) || policy.credentials.length === 0) {
    throw new Error("credential policy schema is invalid");
  }
  const ids = new Set();
  for (const credential of policy.credentials) {
    assertExactKeys(credential, [
      "credential_id", "purpose", "environment", "issuer", "issued_at", "expires_at",
      "max_lifetime_seconds", "rotation", "revocation_conditions", "allowed_consumers", "secret_provider_ref",
    ], "credential policy entry");
    assertReference(credential.credential_id, "credential_id");
    if (ids.has(credential.credential_id)) throw new Error("credential policy contains duplicate credential IDs");
    ids.add(credential.credential_id);
    assertString(credential.purpose, "credential purpose");
    assertSame(credential.environment, "canary", "credential environment");
    assertString(credential.issuer, "credential issuer");
    assertTimestamp(credential.issued_at, "credential issued_at");
    assertTimestamp(credential.expires_at, "credential expires_at");
    if (!Number.isSafeInteger(credential.max_lifetime_seconds) || credential.max_lifetime_seconds < 1 || credential.max_lifetime_seconds > 86_400) throw new Error("credential max lifetime is invalid");
    const lifetime = (Date.parse(credential.expires_at) - Date.parse(credential.issued_at)) / 1000;
    if (lifetime > credential.max_lifetime_seconds) throw new Error("credential exceeds its maximum lifetime");
    assertFutureWindow(credential.issued_at, credential.expires_at, "credential", now);
    assertObject(credential.rotation, "credential rotation");
    assertExactKeys(credential.rotation, ["mode", "rotate_before_expiry_seconds"], "credential rotation");
    if (!["per_use", "on_expiry", "periodic"].includes(credential.rotation.mode)) throw new Error("credential rotation mode is invalid");
    if (!Number.isSafeInteger(credential.rotation.rotate_before_expiry_seconds) || credential.rotation.rotate_before_expiry_seconds < 0 || credential.rotation.rotate_before_expiry_seconds >= credential.max_lifetime_seconds) throw new Error("credential rotation window is invalid");
    if (!Array.isArray(credential.revocation_conditions) || credential.revocation_conditions.length === 0 || credential.revocation_conditions.some((condition) => typeof condition !== "string" || condition.length === 0)) throw new Error("credential revocation conditions are invalid");
    if (!Array.isArray(credential.allowed_consumers) || credential.allowed_consumers.length === 0 || credential.allowed_consumers.some((consumer) => !REFERENCE_PATTERN.test(consumer))) throw new Error("credential allowed consumers are invalid");
    assertReference(credential.secret_provider_ref, "credential secret provider reference");
  }
  if (!fixtureOnly && policy.credentials.some((credential) => credential.secret_provider_ref.startsWith("fixture:"))) throw new Error("real Canary credentials must not use fixture secret providers");
  return ids;
}

function assertAuthentication(authentication, credentialIds) {
  assertExactKeys(authentication, ["user_a_identity", "device_identity", "supabase_project_identity", "credentials"], "authentication");
  assertReference(authentication.user_a_identity, "authentication.user_a_identity");
  assertReference(authentication.device_identity, "authentication.device_identity");
  assertReference(authentication.supabase_project_identity, "authentication.supabase_project_identity");
  if (!Array.isArray(authentication.credentials) || authentication.credentials.length === 0) throw new Error("authentication credentials are invalid");
  const seen = new Set();
  for (const credential of authentication.credentials) {
    assertExactKeys(credential, ["credential_id", "secret_provider_ref", "allowed_consumer"], "authentication credential");
    assertReference(credential.credential_id, "authentication credential ID");
    assertReference(credential.secret_provider_ref, "authentication secret provider reference");
    assertReference(credential.allowed_consumer, "authentication allowed consumer");
    if (!credentialIds.has(credential.credential_id) || seen.has(credential.credential_id)) throw new Error("authentication credential does not match credential policy");
    seen.add(credential.credential_id);
  }
}

function assertBinding(binding, { expectedBindingAuthorityKeyId, expectedBindingIdentity, expectedBindingValue }) {
  assertExactKeys(binding, ["environment", "binding_identity", "fixed_binding_id", "authority_key_id", "replay_binding_identity", "verifier_binding_identity"], "binding");
  assertSame(binding.environment, "canary", "binding environment");
  assertReference(binding.binding_identity, "binding identity");
  assertReference(binding.fixed_binding_id, "fixed binding ID");
  assertKeyId(binding.authority_key_id, "binding authority key ID");
  assertReference(binding.replay_binding_identity, "replay binding identity");
  assertReference(binding.verifier_binding_identity, "verifier binding identity");
  assertSame(binding.authority_key_id, expectedBindingAuthorityKeyId, "binding authority key ID");
  assertSame(binding.binding_identity, expectedBindingIdentity, "binding identity");
  assertSame(binding.verifier_binding_identity, binding.binding_identity, "verifier binding identity");
  if (binding.binding_identity === binding.replay_binding_identity) throw new Error("Canary binding identity reuses the Replay binding identity");
  if (expectedBindingValue !== undefined && (!/^[A-Za-z0-9_-]{1,512}$/.test(expectedBindingValue) || expectedBindingValue === binding.fixed_binding_id)) {
    throw new Error("Canary fixed binding value is invalid or collides with the binding ID");
  }
}

function assertWorkflow(workflow, { expectedWorkflow, currentHead }) {
  assertExactKeys(workflow, ["run_id", "attempt", "repository", "workflow_file_identity", "commit_sha", "approval_reference"], "workflow");
  if (!/^\d+$/.test(workflow.run_id) || BigInt(workflow.run_id) < 1n) throw new Error("workflow run ID is invalid");
  if (!/^\d+$/.test(workflow.attempt) || BigInt(workflow.attempt) < 1n) throw new Error("workflow attempt is invalid");
  if (!/^[^/\s]+\/[^/\s]+$/.test(workflow.repository)) throw new Error("workflow repository is invalid");
  assertSame(workflow.workflow_file_identity, "dotenvx+pnpm+wrangler", "workflow file identity");
  assertString(workflow.commit_sha, "workflow commit SHA", /^[0-9a-f]{40}$/i);
  assertSame(workflow.commit_sha.toLowerCase(), currentHead?.toLowerCase(), "workflow commit SHA");
  assertReference(workflow.approval_reference, "workflow approval reference");
  for (const [field, expected] of Object.entries(expectedWorkflow ?? {})) assertSame(workflow[field], expected, `workflow ${field}`);
}

function assertIdentitySeparation(identity, { fixtureOnly, targetIdentity, bindingIdentity }) {
  assertExactKeys(identity, [
    "replay_binding_identity", "canary_binding_identity", "replay_trust_identity", "canary_trust_identity",
    "fixture_target_identity", "canary_target_identity", "not_production",
  ], "identity_separation");
  for (const [field, value] of Object.entries(identity)) {
    if (field !== "not_production") assertReference(value, `identity separation ${field}`);
  }
  assertBoolean(identity.not_production, "identity separation not_production");
  if (!identity.not_production) throw new Error("Canary identity must be explicitly non-production");
  assertSame(identity.canary_target_identity, targetIdentity, "Canary target identity");
  assertSame(identity.canary_binding_identity, bindingIdentity, "Canary binding identity");
  if (identity.replay_binding_identity === identity.canary_binding_identity) throw new Error("Replay and Canary binding identities must differ");
  if (identity.replay_trust_identity === identity.canary_trust_identity) throw new Error("Replay and Canary trust identities must differ");
  if (identity.fixture_target_identity !== FIXTURE_SERVER_IDENTITY) throw new Error("fixture target identity is invalid");
  if (!fixtureOnly && identity.canary_target_identity === identity.fixture_target_identity) throw new Error("Canary target identity must not be the fixture identity");
}

function assertEvidenceSemantics(evidence) {
  assertExactKeys(evidence, ["authority", "non_authority_metadata"], "evidence_semantics");
  if (JSON.stringify(evidence.authority) !== JSON.stringify(AUTHORITY_METADATA) || JSON.stringify(evidence.non_authority_metadata) !== JSON.stringify(NON_AUTHORITY_METADATA)) {
    throw new Error("evidence authority semantics are invalid");
  }
}

export function parseCanaryApprovedInputContract(raw) {
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new Error("Canary approved input contract must be valid JSON");
  }
  assertObject(parsed, "Canary approved input contract");
  return parsed;
}

export function assertCanaryApprovedInputContract(raw, {
  fixtureOnly = false,
  now = new Date(),
  currentHead,
  expectedServerIdentity,
  expectedProfileSha256,
  expectedSparseProfileSha256,
  expectedSecurityRegistrySetSha256,
  expectedTrustRootCertificateSha256,
  expectedNotaryRegistrySha256,
  expectedNotaryKeyId,
  expectedResultRegistryRootKeyId,
  expectedVerifierKeyId,
  expectedVerifierPublicKeySpki,
  expectedDeploymentId,
  expectedVerifierDeploymentId,
  expectedBindingAuthorityKeyId,
  expectedBindingIdentity,
  expectedBindingValue,
  expectedWorkflow,
} = {}) {
  const contract = parseCanaryApprovedInputContract(raw);
  assertNoSecretFields(contract);
  assertExactKeys(contract, [
    "schema_version", "scope", "status", "fixture_only", "target_approval", "verifier",
    "credential_policy", "authentication", "binding", "workflow", "identity_separation", "evidence_semantics",
  ], "Canary approved input contract");
  if (contract.schema_version !== CANARY_APPROVED_INPUT_CONTRACT_SCHEMA_VERSION || contract.scope !== CANARY_APPROVED_INPUT_CONTRACT_SCOPE) throw new Error("Canary approved input contract schema is invalid");
  assertBoolean(contract.fixture_only, "Canary approved input contract fixture_only");
  if (contract.fixture_only !== fixtureOnly) throw new Error("Canary approved input contract fixture_only does not match deployment mode");
  if (![(fixtureOnly ? "FIXTURE_ONLY" : "APPROVED")].includes(contract.status)) throw new Error("Canary approved input contract status is invalid");
  const validationTime = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(validationTime.getTime())) throw new Error("Canary contract validation time is invalid");
  assertTargetApproval(contract.target_approval, { fixtureOnly, now: validationTime });
  assertSame(contract.target_approval.target_identity, expectedServerIdentity, "approved target identity");
  assertSame(contract.target_approval.profile.complete_sha256, expectedProfileSha256, "approved complete profile hash");
  assertSame(contract.target_approval.profile.sparse_sha256, expectedSparseProfileSha256, "approved sparse profile hash");
  assertProfileContractInputs({ serverIdentity: contract.target_approval.target_identity, profileSha256: contract.target_approval.profile.complete_sha256, sparseProfileSha256: contract.target_approval.profile.sparse_sha256 });
  assertSame(contract.target_approval.trust.security_registry_set_sha256, expectedSecurityRegistrySetSha256, "approved security registry set hash");
  assertSame(contract.target_approval.trust.trust_root_certificate_sha256, expectedTrustRootCertificateSha256, "approved trust root hash");
  assertSame(contract.target_approval.trust.notary_registry_sha256, expectedNotaryRegistrySha256, "approved Notary registry hash");
  assertSame(contract.target_approval.trust.notary_key_id, expectedNotaryKeyId, "approved Notary key ID");
  assertSame(contract.target_approval.trust.result_registry_root_key_id, expectedResultRegistryRootKeyId, "approved Result registry root key ID");
  assertSame(contract.target_approval.verifier_key_id, expectedVerifierKeyId, "approved verifier key ID");
  assertVerifier(contract.verifier, { fixtureOnly, expectedDeploymentId, expectedVerifierDeploymentId, expectedKeyId: expectedVerifierKeyId, expectedPublicKey: expectedVerifierPublicKeySpki, now: validationTime });
  const credentialIds = assertCredentialPolicy(contract.credential_policy, { fixtureOnly, now: validationTime });
  assertAuthentication(contract.authentication, credentialIds);
  assertBinding(contract.binding, { expectedBindingAuthorityKeyId, expectedBindingIdentity, expectedBindingValue });
  assertWorkflow(contract.workflow, { expectedWorkflow, currentHead });
  assertIdentitySeparation(contract.identity_separation, { fixtureOnly, targetIdentity: contract.target_approval.target_identity, bindingIdentity: contract.binding.binding_identity });
  assertEvidenceSemantics(contract.evidence_semantics);
  return contract;
}
