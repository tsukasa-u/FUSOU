import { generateKeyPairSync, createHash } from "node:crypto";
import { buildProductionPublicManifest, canonicalJson } from "./production-trust-contract.mjs";
import { approvedProductionRelease } from "./app-worker-deployment-reference.mjs";
import { createSignedResultRegistryEnvelope } from "./result-registry-envelope.mjs";
import { productionSecurityRegistrySetHash } from "./security-registry-set-contract.mjs";
import { DEPLOYMENT_PROVENANCE_SCHEMA_VERSION } from "./deployment-attestation.mjs";
import { loadOriginInventoryContract } from "./origin-inventory-contract.mjs";
import { assertTargetApprovalResolved } from "./target-approval-contract.mjs";
import { PROFILE_CONTRACT_SPEC, productionProfileContractArtifact } from "./profile-canonical-contract.mjs";

export const version1 = "4b064508-1cdb-453c-826b-bdea36a8b1e5";
export const version2 = "5b064508-1cdb-453c-826b-bdea36a8b1e5";
export const deploymentId = "6b064508-1cdb-453c-826b-bdea36a8b1e5";
export const account = "a".repeat(32);
export const now = new Date().toISOString();
const hash = (raw) => createHash("sha256").update(raw).digest("base64url");
export function key() {
  const pair = generateKeyPairSync("ed25519");
  return {
    publicKey: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url"),
  };
}
function registry(scope, keyId, publicKey) {
  return JSON.stringify({
    schema_version: 1, scope,
    keys: [{ key_id: keyId, public_key_spki: publicKey, status: "ACTIVE", not_before: "2020-01-01T00:00:00.000Z", not_after: null }],
  });
}
export const result = key();
export const root = key();
const session = key();
export const resultRaw = registry("tlsn-result-signing-key-registry", "result-production-test", result.publicKey);
const envelopeRaw = JSON.stringify(createSignedResultRegistryEnvelope({
  registry: JSON.parse(resultRaw), registryRaw: resultRaw,
  rootKeyId: "result-root-test", rootPublicKeySpki: root.publicKey, rootPrivateKeyPkcs8: root.privateKey,
}));
export const notaryRaw = JSON.stringify({ "notary-production-test": "ASEAAAAAAAAAAxuExVZ7EmRAmV0-1aq6BWXXHhg0YEgZ_5wX9enV3QeP" });
const trustSet = productionSecurityRegistrySetHash({ notaryKeyId: "notary-production-test", notaryRegistryRaw: notaryRaw }).sha256;
export const manifest = buildProductionPublicManifest({
  notaryEndpoint: "notary.example.com:7047", notaryKeyId: "notary-production-test", notaryRegistryRaw: notaryRaw,
  sessionAuthorityEndpoint: "https://production-worker.example.com/attestation/session",
  sessionAuthorityKeyId: "session-production-test", sessionAuthorityPublicKeySpki: session.publicKey,
  sessionAuthorityKeyRegistryRaw: registry("tlsn-session-authority-key-registry", "session-production-test", session.publicKey),
  resultSignerKeyId: "result-production-test", resultPublicKeySpki: result.publicKey,
  resultSigningKeyRegistryRaw: resultRaw, resultSigningKeyRegistryEnvelopeRaw: envelopeRaw,
  resultRegistryRootKeyId: "result-root-test", resultRegistryRootPublicKeySpki: root.publicKey,
  verificationEndpoint: "https://production-worker.example.com/verify/tlsn",
  securityRegistrySetSha256: trustSet,
});
export const environment = {
  TLSN_DEPLOYMENT_ROLE: "production", TLSN_ENVIRONMENT: "production",
  TLSN_WORKFLOW_RUN_ID: "101", TLSN_WORKFLOW_RUN_ATTEMPT: "1",
  TLSN_REPOSITORY: "tsukasa-u/FUSOU", TLSN_WORKFLOW_FILE_IDENTITY: "dotenvx+pnpm+wrangler",
  TLSN_GIT_COMMIT_SHA: "a".repeat(40),
  TLSN_PRODUCTION_WORKER_NAME: "fusou-tlsn-production",
  TLSN_PRODUCTION_DEPLOYMENT_ID: "production-logical-identity-test",
  TLSN_VERIFY_WORKER_URL: "https://production-worker.example.com",
  TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID: "result-production-test",
  TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI: result.publicKey,
  TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY: resultRaw,
  TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE: envelopeRaw,
  TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID: "result-root-test",
  TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI: root.publicKey,
  CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: "private-control-plane-test-token",
};
const approval = assertTargetApprovalResolved();
export const provenance = {
  schema_version: DEPLOYMENT_PROVENANCE_SCHEMA_VERSION, scope: "tlsn-deployment-provenance",
  status: "PASS", environment: "production", deployment_role: "production", created_at: now,
  workflow_run_id: "101", workflow_run_attempt: "1", repository: environment.TLSN_REPOSITORY,
  workflow_file_identity: environment.TLSN_WORKFLOW_FILE_IDENTITY, git_commit_sha: environment.TLSN_GIT_COMMIT_SHA,
  security_identity: {
    git_commit_sha: environment.TLSN_GIT_COMMIT_SHA,
    verifier_key_id: "verifier-production-test", notary_key_id: manifest.notary.key_id,
    notary_registry_sha256: hash(notaryRaw), binding_authority: "durable-single-use",
    security_registry_set_sha256: trustSet, origin_inventory_sha256: loadOriginInventoryContract().sha256,
    target_approval_artifact_sha256: approval.approval_artifact_sha256,
    profile_policy_sha256: hash(canonicalJson(PROFILE_CONTRACT_SPEC)),
  },
  deployment_identity: {
    deployment_role: "production", binding_mode: "random",
    deployment_id: environment.TLSN_PRODUCTION_DEPLOYMENT_ID, worker_name: environment.TLSN_PRODUCTION_WORKER_NAME,
  },
  result_identity: {
    result_public_key_spki: result.publicKey, result_signer_key_id: "result-production-test",
    result_key_registry_sha256: hash(resultRaw), result_key_registry_envelope_sha256: hash(envelopeRaw),
    result_registry_root_key_id: "result-root-test", result_registry_root_public_key_spki: root.publicKey,
  },
  target_approval: {
    authority_model: approval.authority_model, status: approval.record_status,
    environment: approval.environment, inventory_sha256: approval.inventory_sha256,
    approval_artifact_sha256: approval.approval_artifact_sha256, approved_target_identity: null,
    approved_target_identities: approval.approved_target_identities,
  },
  profile_contract: productionProfileContractArtifact(),
};
export const release = approvedProductionRelease(environment, provenance, manifest);
export function controls(release, versionId = version1) {
  return {
    deployment: { success: true, result: { deployments: [{
      id: deploymentId, created_on: now, versions: [{ version_id: versionId, percentage: 100 }],
    }] } },
    version: { success: true, result: { id: versionId, resources: { bindings: [
      ...Object.entries(release.publicBindings).map(([name, text]) => ({ name, type: "plain_text", text })),
      { name: "CF_VERSION_METADATA", type: "version_metadata" },
      { name: "WORKER_PRIVATE_SECRET", type: "secret_text", text: "must-never-enter-handoff" },
    ] } } },
  };
}

export function customMapping(release) {
  const origin = new URL(release.compile_inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT).origin;
  return {
    schema_version: 1, kind: "custom_domain", origin, account_id: account,
    script_name: release.compile_inputs.FUSOU_TLSN_EXPECTED_WORKER_NAME,
    sources: [
      `https://api.cloudflare.com/client/v4/accounts/${account}/workers/domains?hostname=${new URL(origin).hostname}`,
      `https://api.cloudflare.com/client/v4/zones/${"b".repeat(32)}`,
      `https://api.cloudflare.com/client/v4/zones/${"b".repeat(32)}/workers/routes`,
    ],
    domain_id: "c".repeat(32), zone_id: "b".repeat(32), zone_name: "example.com",
    cloudflare_environment: "production", empty_worker_routes: true,
  };
}

export function controlPlaneResponse(url, selectedRelease = release, versionId = version1) {
  const input = controls(selectedRelease, versionId);
  if (url.endsWith("/deployments")) return input.deployment;
  if (url.includes("/versions/")) return input.version;
  if (url.includes("/workers/domains?")) return { success: true, result: [{
    id: "c".repeat(32), hostname: new URL(selectedRelease.compile_inputs.FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT).hostname,
    service: selectedRelease.compile_inputs.FUSOU_TLSN_EXPECTED_WORKER_NAME, environment: "production",
    zone_id: "b".repeat(32), zone_name: "example.com",
  }], result_info: { total_pages: 1 } };
  if (url.endsWith("/workers/routes")) return { success: true, result: [] };
  if (url.endsWith(`/zones/${"b".repeat(32)}`)) return {
    success: true, result: { id: "b".repeat(32), name: "example.com", account: { id: account }, status: "active" },
  };
  throw new Error("unexpected mock Cloudflare path");
}
