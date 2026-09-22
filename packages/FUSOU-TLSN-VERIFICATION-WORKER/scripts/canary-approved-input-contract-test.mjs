#!/usr/bin/env node

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  assertCanaryApprovedInputContract,
  CANARY_APPROVED_INPUT_CONTRACT_SCOPE,
  CANARY_APPROVED_INPUT_CONTRACT_SCHEMA_VERSION,
} from "./canary-approved-input-contract.mjs";
import { profilesForServerIdentity } from "./profile-canonical-contract.mjs";

const now = new Date("2026-09-22T12:00:00.000Z");
const future = (seconds) => new Date(now.getTime() + seconds * 1000).toISOString();
const { publicKey } = generateKeyPairSync("ed25519");
const verifierPublicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
const hash = (byte) => Buffer.alloc(32, byte).toString("base64url");
const currentHead = "a".repeat(40);
const profileHashes = profilesForServerIdentity("canary-target.example.com");
const fixtureProfileHashes = profilesForServerIdentity("game.example.test");

function contract({ fixtureOnly = false } = {}) {
  const targetIdentity = fixtureOnly ? "game.example.test" : "canary-target.example.com";
  const selectedProfileHashes = fixtureOnly ? fixtureProfileHashes : profileHashes;
  const profile = { complete_sha256: selectedProfileHashes.complete.sha256, sparse_sha256: selectedProfileHashes.sparse.sha256 };
  return {
    schema_version: CANARY_APPROVED_INPUT_CONTRACT_SCHEMA_VERSION,
    scope: CANARY_APPROVED_INPUT_CONTRACT_SCOPE,
    status: fixtureOnly ? "FIXTURE_ONLY" : "APPROVED",
    fixture_only: fixtureOnly,
    target_approval: {
      target_identity: targetIdentity,
      target_hostname: targetIdentity,
      provenance: { scope: fixtureOnly ? "repository-local-synthetic-fixture" : "tlsn-approved-target-provenance", artifact_sha256: hash(3) },
      approval_reference: fixtureOnly ? "fixture:approval" : "approval:canary-2026-09-22",
      approver: fixtureOnly ? "fixture" : "security@example.com",
      approved_at: now.toISOString(),
      expires_at: future(3600),
      environment: "canary",
      profile,
      trust: {
        security_registry_set_sha256: hash(4),
        trust_root_certificate_sha256: hash(5),
        notary_registry_sha256: hash(6),
        notary_key_id: "notary-canary-2026",
        result_registry_root_key_id: "result-root-canary-2026",
      },
      verifier_key_id: "verifier-canary-2026",
      workflow_repository: "fusou/fusou",
      not_production: true,
    },
    verifier: {
      key_id: "verifier-canary-2026",
      public_key_spki: verifierPublicKeySpki,
      algorithm: "Ed25519",
      environment: "canary",
      purpose: "tlsn-result-verification",
      not_before: now.toISOString(),
      not_after: null,
      registry_reference: "registry://canary/verifier/2026",
      deployment_id: "canary-verifier-2026",
      binding_identity: "canary-binding-2026",
    },
    credential_policy: {
      schema_version: 1,
      scope: "tlsn-canary-credential-lifetime-policy",
      credentials: [{
        credential_id: "user-a-device-2026",
        purpose: "User A device authentication",
        environment: "canary",
        issuer: "secret-provider",
        issued_at: now.toISOString(),
        expires_at: future(1800),
        max_lifetime_seconds: 3600,
        rotation: { mode: "on_expiry", rotate_before_expiry_seconds: 300 },
        revocation_conditions: ["manual-revocation", "target-change"],
        allowed_consumers: ["remote-validation"],
        secret_provider_ref: "secret://canary/user-a-device-2026",
      }],
    },
    authentication: {
      user_a_identity: "user-a",
      device_identity: "device-a",
      supabase_project_identity: "supabase-canary",
      credentials: [{ credential_id: "user-a-device-2026", secret_provider_ref: "secret://canary/user-a-device-2026", allowed_consumer: "remote-validation" }],
    },
    binding: {
      environment: "canary",
      binding_identity: "canary-binding-2026",
      fixed_binding_id: "canary-fixed-binding-2026",
      authority_key_id: "binding-canary-2026",
      replay_binding_identity: "replay-binding-2026",
      verifier_binding_identity: "canary-binding-2026",
    },
    workflow: {
      run_id: "42",
      attempt: "1",
      repository: "fusou/fusou",
      workflow_file_identity: "dotenvx+pnpm+wrangler",
      commit_sha: currentHead,
      approval_reference: fixtureOnly ? "fixture:approval" : "approval:canary-2026-09-22",
    },
    identity_separation: {
      replay_binding_identity: "replay-binding-2026",
      canary_binding_identity: "canary-binding-2026",
      replay_trust_identity: "replay-trust-2026",
      canary_trust_identity: "canary-trust-2026",
      fixture_target_identity: "game.example.test",
      canary_target_identity: targetIdentity,
      not_production: true,
    },
    evidence_semantics: {
      authority: ["evidence_root", "approved_trust_registry", "cryptographic_signatures", "verified_tlsn_presentation_binding", "independent_verifier_result"],
      non_authority_metadata: ["callback_metadata", "workflow_metadata", "r2_archive", "deployment_response", "http_status", "worker_self_reported_identity"],
    },
  };
}

const valid = contract();
assert.doesNotThrow(() => assertCanaryApprovedInputContract(valid, {
  now,
  currentHead,
  expectedServerIdentity: "canary-target.example.com",
  expectedProfileSha256: profileHashes.complete.sha256,
  expectedSparseProfileSha256: profileHashes.sparse.sha256,
  expectedSecurityRegistrySetSha256: hash(4),
  expectedTrustRootCertificateSha256: hash(5),
  expectedNotaryRegistrySha256: hash(6),
  expectedNotaryKeyId: "notary-canary-2026",
  expectedResultRegistryRootKeyId: "result-root-canary-2026",
  expectedVerifierKeyId: "verifier-canary-2026",
  expectedVerifierPublicKeySpki: verifierPublicKeySpki,
  expectedDeploymentId: "canary-2026",
  expectedVerifierDeploymentId: "canary-verifier-2026",
  expectedBindingAuthorityKeyId: "binding-canary-2026",
  expectedBindingIdentity: "canary-binding-2026",
  expectedBindingValue: "canary-binding-value",
  expectedWorkflow: { run_id: "42", attempt: "1", repository: "fusou/fusou", workflow_file_identity: "dotenvx+pnpm+wrangler" },
}));

assert.doesNotThrow(() => assertCanaryApprovedInputContract(contract({ fixtureOnly: true }), {
  fixtureOnly: true,
  now,
  currentHead,
  expectedServerIdentity: "game.example.test",
  expectedProfileSha256: fixtureProfileHashes.complete.sha256,
  expectedSparseProfileSha256: fixtureProfileHashes.sparse.sha256,
  expectedSecurityRegistrySetSha256: hash(4),
  expectedTrustRootCertificateSha256: hash(5),
  expectedNotaryRegistrySha256: hash(6),
  expectedNotaryKeyId: "notary-canary-2026",
  expectedResultRegistryRootKeyId: "result-root-canary-2026",
  expectedVerifierKeyId: "verifier-canary-2026",
  expectedVerifierPublicKeySpki: verifierPublicKeySpki,
  expectedBindingAuthorityKeyId: "binding-canary-2026",
  expectedBindingIdentity: "canary-binding-2026",
  expectedBindingValue: "canary-binding-value",
}));

for (const mutate of [
  (value) => { value.target_approval.target_identity = "game.example.test"; },
  (value) => { value.target_approval.environment = "production"; },
  (value) => { value.target_approval.profile.complete_sha256 = profileHashes.sparse.sha256; },
  (value) => { value.target_approval.verifier_key_id = "verifier-other-2026"; },
  (value) => { value.target_approval.provenance.scope = "historical-canary-evidence"; },
  (value) => { value.verifier.public_key_spki = "secret-value"; },
  (value) => { value.credential_policy.credentials[0].expires_at = now.toISOString(); },
  (value) => { value.workflow.run_id = ""; },
  (value) => { value.binding.replay_binding_identity = value.binding.binding_identity; },
  (value) => { value.identity_separation.canary_trust_identity = value.identity_separation.replay_trust_identity; },
  (value) => { value.workflow.commit_sha = "b".repeat(40); },
]) {
  const invalid = structuredClone(valid);
  mutate(invalid);
  assert.throws(() => assertCanaryApprovedInputContract(invalid, {
    now,
    currentHead,
    expectedServerIdentity: "canary-target.example.com",
    expectedProfileSha256: profileHashes.complete.sha256,
    expectedSparseProfileSha256: profileHashes.sparse.sha256,
    expectedSecurityRegistrySetSha256: hash(4),
    expectedTrustRootCertificateSha256: hash(5),
    expectedNotaryRegistrySha256: hash(6),
    expectedResultRegistryRootKeyId: "result-root-canary-2026",
    expectedVerifierKeyId: "verifier-canary-2026",
    expectedVerifierPublicKeySpki: verifierPublicKeySpki,
    expectedBindingAuthorityKeyId: "binding-canary-2026",
    expectedBindingIdentity: "canary-binding-2026",
    expectedBindingValue: "canary-binding-value",
  }));
}

console.log("[tlsn-canary-approved-input-contract] approved, fixture-only, expiry, key, binding, workflow, and secret-field cases PASS");