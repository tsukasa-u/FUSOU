#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANARY_EXTERNAL_PACKAGE_ARTIFACT_SCOPE,
  CANARY_EXTERNAL_PACKAGE_ARTIFACTS,
  CANARY_EXTERNAL_PACKAGE_INPUTS,
} from "./canary-external-package.mjs";
import {
  CANARY_APPROVED_INPUT_CONTRACT_SCOPE,
  CANARY_APPROVED_INPUT_CONTRACT_SCHEMA_VERSION,
} from "./canary-approved-input-contract.mjs";
import {
  assertCanaryDeploymentAuthorized,
  authorizeCanaryDeployment,
} from "./canary-deployment-authorization.mjs";
import { canonicalJson } from "./production-trust-contract.mjs";
import { profilesForServerIdentity } from "./profile-canonical-contract.mjs";

const currentHead = "a".repeat(40);
const now = new Date("2026-01-01T00:00:00.000Z");
const profileHashes = profilesForServerIdentity("canary.example.com");
const { publicKey } = generateKeyPairSync("ed25519");
const verifierPublicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");

function hash(value) {
  return createHash("sha256").update(value).digest("base64url");
}

const environment = {
  TLSN_CANDIDATE_SERVER_IDENTITY: "canary.example.com",
  TLSN_ENVIRONMENT: "production",
  TLSN_DEPLOYMENT_ROLE: "canary",
  TLSN_REPOSITORY: "owner/repository",
  TLSN_GIT_COMMIT_SHA: currentHead,
  TLSN_WORKFLOW_RUN_ID: "12345",
  TLSN_WORKFLOW_RUN_ATTEMPT: "2",
  TLSN_WORKFLOW_FILE_IDENTITY: "dotenvx+pnpm+wrangler",
  TLSN_CANARY_BINDING_IDENTITY: "canary-binding-authority",
  TLSN_CANDIDATE_PROFILE_SHA256: profileHashes.complete.sha256,
  TLSN_CANDIDATE_SPARSE_PROFILE_SHA256: profileHashes.sparse.sha256,
  TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI: verifierPublicKeySpki,
  TLSN_CANDIDATE_VERIFIER_KEY_ID: "verifier-canary-2026",
  TLSN_CANARY_VERIFIER_DEPLOYMENT_ID: "canary-2026",
  TLSN_CANDIDATE_VERIFIER_DEPLOYMENT_ID: "canary-2026",
  TLSN_CANARY_DEPLOYMENT_ID: "canary-2026",
  TLSN_CANDIDATE_NOTARY_KEY_ID: "notary-canary-2026",
  TLSN_SECURITY_REGISTRY_SET_SHA256: hash(Buffer.alloc(32, 4)),
  TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID: "result-root-canary-2026",
  TLSN_CANARY_BINDING_AUTHORITY_KEY_ID: "binding-canary-2026",
  TLSN_CANARY_BINDING_VALUE: "canary-binding-value",
  TLSN_PRODUCTION_NOTARY_REGISTRY: JSON.stringify({ keys: ["notary-key"] }),
  TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER: Buffer.from("trust-root").toString("base64url"),
};

const approvedContract = {
  schema_version: CANARY_APPROVED_INPUT_CONTRACT_SCHEMA_VERSION,
  scope: CANARY_APPROVED_INPUT_CONTRACT_SCOPE,
  status: "APPROVED",
  fixture_only: false,
  target_approval: {
    target_identity: "canary.example.com",
    target_hostname: "canary.example.com",
    provenance: { scope: "tlsn-approved-target-provenance", artifact_sha256: hash(Buffer.alloc(32, 3)) },
    approval_reference: "approval/canary-2026-01-01",
    approver: "security@example.com",
    approved_at: "2025-12-31T00:00:00.000Z",
    expires_at: "2026-01-02T00:00:00.000Z",
    environment: "canary",
    profile: { complete_sha256: profileHashes.complete.sha256, sparse_sha256: profileHashes.sparse.sha256 },
    trust: {
      security_registry_set_sha256: hash(Buffer.alloc(32, 4)),
      trust_root_certificate_sha256: hash(Buffer.from("trust-root")),
      notary_registry_sha256: hash(canonicalJson(JSON.parse(environment.TLSN_PRODUCTION_NOTARY_REGISTRY))),
      notary_key_id: "notary-canary-2026",
      result_registry_root_key_id: "result-root-canary-2026",
    },
    verifier_key_id: "verifier-canary-2026",
    workflow_repository: "owner/repository",
    not_production: true,
  },
  verifier: {
    key_id: "verifier-canary-2026",
    public_key_spki: verifierPublicKeySpki,
    algorithm: "Ed25519",
    environment: "canary",
    purpose: "tlsn-result-verification",
    not_before: "2025-12-31T00:00:00.000Z",
    not_after: null,
    registry_reference: "registry://canary/verifier/2026",
    deployment_id: "canary-2026",
    binding_identity: "canary-binding-authority",
  },
  credential_policy: {
    schema_version: 1,
    scope: "tlsn-canary-credential-lifetime-policy",
    credentials: [{
      credential_id: "user-a-device-2026",
      purpose: "User A device authentication",
      environment: "canary",
      issuer: "secret-provider",
      issued_at: "2025-12-31T01:00:00.000Z",
      expires_at: "2026-01-01T01:00:00.000Z",
      max_lifetime_seconds: 86_400,
      rotation: { mode: "on_expiry", rotate_before_expiry_seconds: 300 },
      revocation_conditions: ["manual-revocation"],
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
    binding_identity: "canary-binding-authority",
    fixed_binding_id: "canary-fixed-binding-2026",
    authority_key_id: "binding-canary-2026",
    replay_binding_identity: "replay-binding-2026",
    verifier_binding_identity: "canary-binding-authority",
  },
  workflow: {
    run_id: "12345",
    attempt: "2",
    repository: "owner/repository",
    workflow_file_identity: "dotenvx+pnpm+wrangler",
    commit_sha: currentHead,
    approval_reference: "approval/canary-2026-01-01",
  },
  identity_separation: {
    replay_binding_identity: "replay-binding-2026",
    canary_binding_identity: "canary-binding-authority",
    replay_trust_identity: "replay-trust-2026",
    canary_trust_identity: "canary-trust-2026",
    fixture_target_identity: "game.example.test",
    canary_target_identity: "canary.example.com",
    not_production: true,
  },
  evidence_semantics: {
    authority: ["evidence_root", "approved_trust_registry", "cryptographic_signatures", "verified_tlsn_presentation_binding", "independent_verifier_result"],
    non_authority_metadata: ["callback_metadata", "workflow_metadata", "r2_archive", "deployment_response", "http_status", "worker_self_reported_identity"],
  },
};
environment.TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON = JSON.stringify(approvedContract);

for (const [index, name] of CANARY_EXTERNAL_PACKAGE_INPUTS.entries()) {
  if (environment[name] === undefined) environment[name] = `${name.toLowerCase()}-${index}`;
}

environment.TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON = JSON.stringify(approvedContract);

function inputFingerprint(name) {
  const raw = environment[name].trim();
  const bytes = name === "TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON" || name === "TLSN_PRODUCTION_NOTARY_REGISTRY"
    ? canonicalJson(JSON.parse(raw))
    : name === "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER"
      ? Buffer.from(raw, "base64url")
      : raw;
  return hash(bytes);
}

async function createAcceptedPackage(packageRoot) {
  const artifacts = [];
  await mkdir(join(packageRoot, "artifacts"));
  const targetApprovalPath = "artifacts/target-approval.json";
  const targetApprovalBytes = Buffer.from(canonicalJson(approvedContract), "utf8");
  await writeFile(join(packageRoot, targetApprovalPath), targetApprovalBytes);
  const targetApprovalHash = hash(targetApprovalBytes);
  artifacts.push({ name: "target-approval", path: targetApprovalPath, sha256: targetApprovalHash, current: true, fixture_only: false, historical: false });

  for (const name of CANARY_EXTERNAL_PACKAGE_ARTIFACTS.filter((artifactName) => artifactName !== "target-approval")) {
    const path = `artifacts/${name}.json`;
    const bytes = Buffer.from(JSON.stringify({
      schema_version: 1,
      scope: CANARY_EXTERNAL_PACKAGE_ARTIFACT_SCOPE,
      artifact_name: name,
      status: "CURRENT",
      fixture_only: false,
      historical: false,
      subject: {
        server_identity: "canary.example.com",
        environment: "production",
        deployment_role: "canary",
        binding_identity: "canary-binding-authority",
        repository: "owner/repository",
        run_id: "12345",
        run_attempt: "2",
        commit_sha: currentHead,
      },
      provenance: {
        authority_artifact_sha256: targetApprovalHash,
        approval_reference: "approval/canary-2026-01-01",
        provenance_reference: `provenance/${name}-2026-01-01`,
        evidence_level: "AUTHORITY_SIGNED",
      },
      validity: { issued_at: "2025-12-31T00:00:00.000Z", expires_at: "2026-01-02T00:00:00.000Z" },
      content: { kind: name, source: "external-authority" },
    }), "utf8");
    await writeFile(join(packageRoot, path), bytes);
    artifacts.push({ name, path, sha256: hash(bytes), current: true, fixture_only: false, historical: false });
  }

  const manifest = {
    schema_version: 2,
    scope: "tlsn-canary-external-input-package",
    package_id: "approval-package-2026-01-01",
    issued_at: "2025-12-31T00:00:00.000Z",
    expires_at: "2026-01-02T00:00:00.000Z",
    fixture_only: false,
    authority: {
      type: "external-authority",
      reference: "authority/security-review-2026-01-01",
      approval_artifact: "target-approval",
      approval_artifact_sha256: targetApprovalHash,
    },
    target: { server_identity: "canary.example.com", environment: "production", deployment_role: "canary", binding_identity: "canary-binding-authority" },
    workflow: {
      repository: "owner/repository",
      run_id: "12345",
      run_attempt: "2",
      workflow_file_identity: "dotenvx+pnpm+wrangler",
      commit_sha: currentHead,
    },
    inputs: CANARY_EXTERNAL_PACKAGE_INPUTS.map((name) => ({
      name,
      value_sha256: inputFingerprint(name),
      approval_reference: `approval/${name.toLowerCase()}`,
      provenance_reference: `provenance/${name.toLowerCase()}`,
      evidence_level: "AUTHORITY_SIGNED",
    })),
    artifacts,
    secret_provider: {
      access_token: {
        input_name: "TLSN_REMOTE_ACCESS_TOKEN_A",
        provider_ref: "secret-provider/user-a/access-token",
        issued_at: "2025-12-31T00:00:00.000Z",
        expires_at: "2026-01-01T01:00:00.000Z",
      },
      private_key: {
        selected_input_name: "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL",
        provider_ref: "secret-provider/user-a/device-key-b64url",
        issued_at: "2025-12-31T00:00:00.000Z",
        expires_at: "2026-01-01T01:00:00.000Z",
      },
    },
  };
  const manifestPath = join(packageRoot, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  return { manifest, manifestPath };
}

const packageRoot = await mkdtemp(join(tmpdir(), "tlsn-canary-authorization-test-"));
try {
  const absent = await authorizeCanaryDeployment({ environment, currentHead, now });
  assert.equal(absent.deployment_authorization, "DENIED");
  assert.equal(absent.external_package.status, "ABSENT");
  assert.equal(absent.deployment_executed, false);
  assert.throws(() => assertCanaryDeploymentAuthorized(absent), /requires a VALID accepted external package/);

  const invalidPath = await authorizeCanaryDeployment({
    manifestPath: join(packageRoot, "missing.json"),
    environment,
    currentHead,
    now,
  });
  assert.equal(invalidPath.deployment_authorization, "DENIED");
  assert.equal(invalidPath.external_package.status, "INVALID");
  assert.doesNotMatch(JSON.stringify(invalidPath), /secret|private|token/i);

  const { manifestPath, manifest } = await createAcceptedPackage(packageRoot);
  const accepted = await authorizeCanaryDeployment({ manifestPath, environment, currentHead, now });
  assert.equal(accepted.deployment_authorization, "AUTHORIZED", JSON.stringify(accepted));
  assert.equal(accepted.external_package.status, "VALID");
  assert.equal(accepted.external_package.verification.readiness_eligible, true);
  assert.equal(accepted.deployment_executed, false);
  assert.equal(accepted.external_package.manifest, undefined);
  assert.equal(accepted.external_package.identity.package_id, manifest.package_id);
  assert.doesNotMatch(JSON.stringify(accepted), /secret-provider\/user-a|private-key-marker|access-token/i);
  assert.doesNotThrow(() => assertCanaryDeploymentAuthorized(accepted));

  const candidate = { ...manifest, scope: "tlsn-canary-external-input-package-candidate" };
  await writeFile(manifestPath, JSON.stringify(candidate), "utf8");
  const candidateResult = await authorizeCanaryDeployment({ manifestPath, environment, currentHead, now });
  assert.equal(candidateResult.deployment_authorization, "DENIED");
  assert.equal(candidateResult.external_package.status, "INVALID");
  assert.equal(candidateResult.external_package.verification.readiness_eligible, false);
  assert.throws(() => assertCanaryDeploymentAuthorized(candidateResult), /requires a VALID accepted external package/);
} finally {
  await rm(packageRoot, { recursive: true, force: true });
}

console.log("[tlsn-canary-deployment-authorization] absent, invalid, accepted, and candidate packages PASS");
