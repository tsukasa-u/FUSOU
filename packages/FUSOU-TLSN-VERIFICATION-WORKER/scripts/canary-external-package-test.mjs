#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCanaryExternalPackage,
  CANARY_EXTERNAL_PACKAGE_ARTIFACT_SCOPE,
  CANARY_EXTERNAL_PACKAGE_ARTIFACTS,
  CANARY_EXTERNAL_PACKAGE_MANIFEST_INPUT,
  CANARY_EXTERNAL_PACKAGE_INPUTS,
  canaryExternalPackageIdentity,
  canaryExternalPackageVerificationReport,
  loadCanaryExternalPackageManifest,
} from "./canary-external-package.mjs";
import {
  CANARY_APPROVED_INPUT_CONTRACT_SCOPE,
  CANARY_APPROVED_INPUT_CONTRACT_SCHEMA_VERSION,
} from "./canary-approved-input-contract.mjs";
import { canonicalJson } from "./production-trust-contract.mjs";
import { profilesForServerIdentity } from "./profile-canonical-contract.mjs";

const currentHead = "a".repeat(40);
const now = new Date("2026-01-01T00:00:00.000Z");
const profileHashes = profilesForServerIdentity("canary.example.com");
const { publicKey } = generateKeyPairSync("ed25519");
const verifierPublicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
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
  TLSN_CANARY_DEPLOYMENT_ID: "canary-2026",
  TLSN_CANDIDATE_NOTARY_KEY_ID: "notary-canary-2026",
  TLSN_SECURITY_REGISTRY_SET_SHA256: hash(4),
  TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID: "result-root-canary-2026",
  TLSN_CANARY_BINDING_AUTHORITY_KEY_ID: "binding-canary-2026",
  TLSN_CANARY_BINDING_VALUE: "canary-binding-value",
  TLSN_PRODUCTION_NOTARY_REGISTRY: JSON.stringify({ keys: ["notary-key"] }),
  TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER: Buffer.from("trust-root").toString("base64url"),
};

function hash(byte) {
  return Buffer.alloc(32, byte).toString("base64url");
}

const approvedContract = {
  schema_version: CANARY_APPROVED_INPUT_CONTRACT_SCHEMA_VERSION,
  scope: CANARY_APPROVED_INPUT_CONTRACT_SCOPE,
  status: "APPROVED",
  fixture_only: false,
  target_approval: {
    target_identity: "canary.example.com",
    target_hostname: "canary.example.com",
    provenance: { scope: "tlsn-approved-target-provenance", artifact_sha256: hash(3) },
    approval_reference: "approval/canary-2026-01-01",
    approver: "security@example.com",
    approved_at: "2025-12-31T00:00:00.000Z",
    expires_at: "2026-01-02T00:00:00.000Z",
    environment: "canary",
    profile: { complete_sha256: profileHashes.complete.sha256, sparse_sha256: profileHashes.sparse.sha256 },
    trust: {
      security_registry_set_sha256: hash(4),
      trust_root_certificate_sha256: hash(5),
      notary_registry_sha256: hash(6),
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

function sha256(value) {
  return createHash("sha256").update(value).digest("base64url");
}

approvedContract.target_approval.trust.trust_root_certificate_sha256 = sha256(Buffer.from("trust-root"));
approvedContract.target_approval.trust.notary_registry_sha256 = sha256(canonicalJson(JSON.parse(environment.TLSN_PRODUCTION_NOTARY_REGISTRY)));
environment.TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON = JSON.stringify(approvedContract);

function inputFingerprint(name) {
  return inputFingerprintFor(name, environment);
}

function inputFingerprintFor(name, sourceEnvironment) {
  const raw = sourceEnvironment[name].trim();
  const bytes = name === "TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON"
    ? canonicalJson(JSON.parse(raw))
    : name === "TLSN_PRODUCTION_NOTARY_REGISTRY"
      ? canonicalJson(JSON.parse(raw))
      : name === "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER"
        ? Buffer.from(raw, "base64url")
        : raw;
  return sha256(bytes);
}

async function createManifest(packageRoot) {
  const artifacts = [];
  await mkdir(join(packageRoot, "artifacts"));
  const targetApprovalPath = "artifacts/target-approval.json";
  const targetApprovalBytes = Buffer.from(canonicalJson(approvedContract), "utf8");
  await writeFile(join(packageRoot, targetApprovalPath), targetApprovalBytes);
  const targetApprovalHash = sha256(targetApprovalBytes);
  artifacts.push({
    name: "target-approval",
    path: targetApprovalPath,
    sha256: targetApprovalHash,
    current: true,
    fixture_only: false,
    historical: false,
  });
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
      validity: {
        issued_at: "2025-12-31T00:00:00.000Z",
        expires_at: "2026-01-02T00:00:00.000Z",
      },
      content: { kind: name, source: "external-authority" },
    }), "utf8");
    await writeFile(join(packageRoot, path), bytes);
    artifacts.push({
      name,
      path,
      sha256: sha256(bytes),
      current: true,
      fixture_only: false,
      historical: false,
    });
  }
  return {
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
      approval_artifact_sha256: artifacts[0].sha256,
    },
    target: {
      server_identity: "canary.example.com",
      environment: "production",
      deployment_role: "canary",
      binding_identity: "canary-binding-authority",
    },
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
}

const packageRoot = await mkdtemp(join(tmpdir(), "tlsn-canary-package-"));
try {
  const manifest = await createManifest(packageRoot);
  const originalArtifactFiles = new Map();
  for (const artifact of manifest.artifacts) originalArtifactFiles.set(artifact.path, await readFile(join(packageRoot, artifact.path)));
  const acceptedManifest = await assertCanaryExternalPackage(manifest, { packageRoot, environment, currentHead, now });
  assert.equal(acceptedManifest.scope, "tlsn-canary-external-input-package");
  const packageIdentity = canaryExternalPackageIdentity(acceptedManifest);
  assert.match(packageIdentity.manifest_sha256, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(packageIdentity.package_id, manifest.package_id);
  assert.equal(packageIdentity.authority.approval_artifact_sha256, manifest.artifacts[0].sha256);
  assert.deepEqual(Object.keys(packageIdentity.artifacts).sort(), CANARY_EXTERNAL_PACKAGE_ARTIFACTS.toSorted());
  const artifactIdentityMutation = structuredClone(manifest);
  artifactIdentityMutation.artifacts[1].sha256 = sha256("replacement-artifact");
  assert.notDeepEqual(
    canaryExternalPackageIdentity(artifactIdentityMutation).artifacts,
    packageIdentity.artifacts,
    "artifact identity mutation must change the package identity map",
  );
  assert.deepEqual(
    canaryExternalPackageVerificationReport({ status: "VALID", manifest: acceptedManifest }),
    {
      package_state: "VALID",
      package_id: manifest.package_id,
      identity: packageIdentity,
      target: manifest.target,
      workflow: manifest.workflow,
      validity: { issued_at: manifest.issued_at, expires_at: manifest.expires_at },
      verification: { acceptance: "PASS", readiness_eligible: true },
      diagnostics: [],
    },
  );

  const manifestMutation = structuredClone(manifest);
  manifestMutation.package_id = "A".repeat(43);
  assert.notEqual(
    canaryExternalPackageIdentity(manifestMutation).manifest_sha256,
    packageIdentity.manifest_sha256,
    "manifest mutation must change canonical package identity",
  );

  const candidateIdentityAccepted = await assertCanaryExternalPackage(manifestMutation, { packageRoot, environment, currentHead, now });
  assert.equal(candidateIdentityAccepted.package_id, "A".repeat(43));

  const wrongTrustEnvironment = {
    ...environment,
    TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER: Buffer.from("other-trust-root").toString("base64url"),
  };
  await assert.rejects(
    () => assertCanaryExternalPackage(manifest, { packageRoot, environment: wrongTrustEnvironment, currentHead, now }),
    /TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER fingerprint does not match deployment input/,
    "approved trust root must bind to the current trust-root input",
  );

  const tamperedArtifact = structuredClone(manifest);
  tamperedArtifact.artifacts[0].sha256 = sha256("tampered");
  await assert.rejects(
    () => assertCanaryExternalPackage(tamperedArtifact, { packageRoot, environment, currentHead, now }),
    /authority approval artifact hash does not match/,
  );

  const wrongTarget = structuredClone(manifest);
  wrongTarget.target.server_identity = "other.example.com";
  await assert.rejects(
    () => assertCanaryExternalPackage(wrongTarget, { packageRoot, environment, currentHead, now }),
    /target identity does not match/,
  );

  const wrongBinding = structuredClone(manifest);
  wrongBinding.target.binding_identity = "other-canary-binding";
  await assert.rejects(
    () => assertCanaryExternalPackage(wrongBinding, { packageRoot, environment, currentHead, now }),
    /binding identity does not match deployment input/,
    "binding mismatch must be rejected",
  );

  const wrongProvenance = structuredClone(manifest);
  const provenanceArtifact = JSON.parse((await readFile(join(packageRoot, wrongProvenance.artifacts[1].path))).toString("utf8"));
  provenanceArtifact.provenance.authority_artifact_sha256 = sha256("other-authority-artifact");
  const provenanceBytes = Buffer.from(JSON.stringify(provenanceArtifact), "utf8");
  await writeFile(join(packageRoot, wrongProvenance.artifacts[1].path), provenanceBytes);
  wrongProvenance.artifacts[1].sha256 = sha256(provenanceBytes);
  await assert.rejects(
    () => assertCanaryExternalPackage(wrongProvenance, { packageRoot, environment, currentHead, now }),
    /authority provenance does not bind target approval/,
    "artifact provenance mismatch must be rejected",
  );
  await writeFile(join(packageRoot, wrongProvenance.artifacts[1].path), originalArtifactFiles.get(wrongProvenance.artifacts[1].path));

  const pathTraversal = structuredClone(manifest);
  pathTraversal.artifacts[1].path = "../outside-package.json";
  await assert.rejects(
    () => assertCanaryExternalPackage(pathTraversal, { packageRoot, environment, currentHead, now }),
    /escapes the package directory/,
    "artifact path traversal must be rejected",
  );

  const secretValue = structuredClone(manifest);
  secretValue.secret_provider.access_token.access_token_value = "secret-marker";
  await assert.rejects(
    () => assertCanaryExternalPackage(secretValue, { packageRoot, environment, currentHead, now }),
    /secret value field/,
  );

  const bothPrivateKeys = structuredClone(manifest);
  const bothPrivateKeyEnvironment = {
    ...environment,
    TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL: "selected-marker",
    TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_FILE: "other-marker",
  };
  await assert.rejects(
    () => assertCanaryExternalPackage(bothPrivateKeys, {
      packageRoot,
      environment: bothPrivateKeyEnvironment,
      currentHead,
      now,
    }),
    /both remote private key representations are present/,
  );

  const futureIssued = structuredClone(manifest);
  futureIssued.issued_at = "2026-01-01T00:00:01.000Z";
  await assert.rejects(
    () => assertCanaryExternalPackage(futureIssued, { packageRoot, environment, currentHead, now }),
    /validity window is not current/,
  );

  const selfApproved = structuredClone(manifest);
  selfApproved.authority.reference = "authority/manifest/self";
  await assert.rejects(
    () => assertCanaryExternalPackage(selfApproved, { packageRoot, environment, currentHead, now }),
    /self-asserted/,
  );

  const malformedArtifact = structuredClone(manifest);
  malformedArtifact.artifacts[1].sha256 = sha256(JSON.stringify({ malformed: true }));
  await assert.rejects(
    () => assertCanaryExternalPackage(malformedArtifact, { packageRoot, environment, currentHead, now }),
    /artifact hash does not match/,
  );

  await assert.rejects(
    () => loadCanaryExternalPackageManifest(join(packageRoot, "missing-manifest.json"), { environment, currentHead, now }),
    /ENOENT/,
  );

  for (const [label, mutate, expected] of [
    ["unknown manifest field", (value) => { value.unknown = true; }, /fields are invalid/],
    ["missing manifest field", (value) => { delete value.authority; }, /fields are invalid/],
    ["wrong schema type", (value) => { value.schema_version = "2"; }, /schema is invalid/],
    ["wrong inputs type", (value) => { value.inputs = {}; }, /inputs are incomplete/],
    ["wrong input value type", (value) => { value.inputs[0].value_sha256 = 7; }, /is invalid/],
    ["workflow HEAD mismatch", (value) => { value.workflow.commit_sha = "b".repeat(40); }, /commit does not match workflow input/],
    ["workflow binding mismatch", (value) => { value.workflow.run_attempt = "3"; }, /workflow attempt does not match/],
    ["expired package", (value) => { value.expires_at = "2025-12-31T23:59:59.000Z"; }, /validity window is not current/],
    ["invalid authority reference", (value) => { value.authority.reference = "authority with spaces"; }, /is invalid/],
  ]) {
    const invalid = structuredClone(manifest);
    mutate(invalid);
    await assert.rejects(
      () => assertCanaryExternalPackage(invalid, { packageRoot, environment, currentHead, now }),
      expected,
      label,
    );
  }

  for (const name of CANARY_EXTERNAL_PACKAGE_INPUTS) {
    const missingEnvironment = { ...environment };
    delete missingEnvironment[name];
    await assert.rejects(
      () => assertCanaryExternalPackage(manifest, { packageRoot, environment: missingEnvironment, currentHead, now }),
      new RegExp(`${name} is missing|does not match deployment input`),
      `missing public input ${name}`,
    );
    const tamperedEnvironment = { ...environment };
    if (name === "TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON" || name === "TLSN_PRODUCTION_NOTARY_REGISTRY") {
      tamperedEnvironment[name] = JSON.stringify({ tampered: name });
    } else if (name === "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER") {
      tamperedEnvironment[name] = Buffer.from(`${name}-tampered`).toString("base64url");
    } else {
      tamperedEnvironment[name] = `${environment[name]}-tampered`;
    }
    await assert.rejects(
      () => assertCanaryExternalPackage(manifest, { packageRoot, environment: tamperedEnvironment, currentHead, now }),
      /fingerprint does not match|canonical base64url|does not match deployment input/,
      `tampered public input ${name}`,
    );
  }

  const onePrivateKeyEnvironment = {
    ...environment,
    TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL: "private-key-marker",
  };
  assert.doesNotThrow(() => assertCanaryExternalPackage(manifest, {
    packageRoot,
    environment: onePrivateKeyEnvironment,
    currentHead,
    now,
  }), "one private-key representation must not affect package acceptance");

  const missingAccessTokenReference = structuredClone(manifest);
  delete missingAccessTokenReference.secret_provider.access_token.provider_ref;
  await assert.rejects(
    () => assertCanaryExternalPackage(missingAccessTokenReference, { packageRoot, environment, currentHead, now }),
    /external package access token reference fields are invalid/,
    "missing access-token provider reference must be rejected",
  );

  const invalidSecretProviderReference = structuredClone(manifest);
  invalidSecretProviderReference.secret_provider.access_token.provider_ref = "invalid ref";
  await assert.rejects(
    () => assertCanaryExternalPackage(invalidSecretProviderReference, { packageRoot, environment, currentHead, now }),
    /provider_ref is invalid/,
  );

  const fixturePackage = structuredClone(manifest);
  fixturePackage.fixture_only = true;
  fixturePackage.target.server_identity = "game.example.test";
  fixturePackage.artifacts = fixturePackage.artifacts.map((artifact) => ({ ...artifact, fixture_only: true }));
  const fixtureProfileHashes = profilesForServerIdentity("game.example.test");
  const fixtureContract = structuredClone(approvedContract);
  fixtureContract.status = "FIXTURE_ONLY";
  fixtureContract.fixture_only = true;
  fixtureContract.target_approval.target_identity = "game.example.test";
  fixtureContract.target_approval.target_hostname = "game.example.test";
  fixtureContract.target_approval.provenance.scope = "repository-local-synthetic-fixture";
  fixtureContract.target_approval.approval_reference = "fixture:approval";
  fixtureContract.target_approval.approver = "fixture";
  fixtureContract.target_approval.profile.complete_sha256 = fixtureProfileHashes.complete.sha256;
  fixtureContract.target_approval.profile.sparse_sha256 = fixtureProfileHashes.sparse.sha256;
  fixtureContract.credential_policy.credentials[0].secret_provider_ref = "fixture:secret-provider";
  fixtureContract.workflow.approval_reference = "fixture:approval";
  fixtureContract.identity_separation.canary_target_identity = "game.example.test";
  const fixtureEnvironment = {
    ...environment,
    TLSN_CANARY_FIXTURE_ONLY: "true",
    TLSN_CANDIDATE_SERVER_IDENTITY: "game.example.test",
    TLSN_CANDIDATE_PROFILE_SHA256: fixtureProfileHashes.complete.sha256,
    TLSN_CANDIDATE_SPARSE_PROFILE_SHA256: fixtureProfileHashes.sparse.sha256,
    TLSN_CANARY_APPROVED_INPUT_CONTRACT_JSON: JSON.stringify(fixtureContract),
  };
  const fixtureTargetApprovalBytes = Buffer.from(canonicalJson(fixtureContract), "utf8");
  await writeFile(join(packageRoot, fixturePackage.artifacts[0].path), fixtureTargetApprovalBytes);
  fixturePackage.artifacts[0].sha256 = sha256(fixtureTargetApprovalBytes);
  for (const artifact of fixturePackage.artifacts.slice(1)) {
    const path = join(packageRoot, artifact.path);
    const content = JSON.parse((await readFile(path)).toString("utf8"));
    content.fixture_only = true;
    content.subject.server_identity = "game.example.test";
    content.provenance.authority_artifact_sha256 = fixturePackage.artifacts[0].sha256;
    const bytes = Buffer.from(JSON.stringify(content), "utf8");
    await writeFile(path, bytes);
    artifact.sha256 = sha256(bytes);
  }
  fixturePackage.authority.reference = "authority/test-harness-2026";
  fixturePackage.authority.approval_artifact_sha256 = fixturePackage.artifacts[0].sha256;
  fixturePackage.inputs = fixturePackage.inputs.map((input) => ({
    ...input,
    value_sha256: inputFingerprintFor(input.name, fixtureEnvironment),
  }));
  await assert.rejects(
    () => assertCanaryExternalPackage(fixturePackage, { packageRoot, environment: fixtureEnvironment, currentHead, now }),
    /fixture-only external package is not accepted/,
  );
  assert.equal(
    (await assertCanaryExternalPackage(fixturePackage, {
      packageRoot,
      environment: fixtureEnvironment,
      currentHead,
      now,
      allowSyntheticFixture: true,
    })).fixture_only,
    true,
  );
  for (const [path, bytes] of originalArtifactFiles) await writeFile(join(packageRoot, path), bytes);

  for (const field of ["current", "fixture_only", "historical"]) {
    const invalidArtifactStatus = structuredClone(manifest);
    invalidArtifactStatus.artifacts[1][field] = field === "current" ? false : true;
    await assert.rejects(
      () => assertCanaryExternalPackage(invalidArtifactStatus, { packageRoot, environment, currentHead, now }),
      /current\/fixture status is invalid/,
      `artifact ${field} status`,
    );
  }

  const genericArtifactPath = join(packageRoot, manifest.artifacts[1].path);
  const originalGenericArtifact = await readFile(genericArtifactPath);
  const genericContent = JSON.parse(originalGenericArtifact.toString("utf8"));
  genericContent.subject.commit_sha = "b".repeat(40);
  const rewrittenGenericArtifact = Buffer.from(JSON.stringify(genericContent), "utf8");
  await writeFile(genericArtifactPath, rewrittenGenericArtifact);
  const mismatchedSubject = structuredClone(manifest);
  mismatchedSubject.artifacts[1].sha256 = sha256(rewrittenGenericArtifact);
  await assert.rejects(
    () => assertCanaryExternalPackage(mismatchedSubject, { packageRoot, environment, currentHead, now }),
    /artifact subject mismatch: commit_sha/,
  );
  const malformedGenericContent = structuredClone(genericContent);
  delete malformedGenericContent.provenance;
  const malformedGenericBytes = Buffer.from(JSON.stringify(malformedGenericContent), "utf8");
  await writeFile(genericArtifactPath, malformedGenericBytes);
  const malformedGeneric = structuredClone(manifest);
  malformedGeneric.artifacts[1].sha256 = sha256(malformedGenericBytes);
  await assert.rejects(
    () => assertCanaryExternalPackage(malformedGeneric, { packageRoot, environment, currentHead, now }),
    /artifact content fields are invalid/,
  );
  const futureGenericContent = JSON.parse(originalGenericArtifact.toString("utf8"));
  futureGenericContent.validity.issued_at = "2026-01-01T00:00:01.000Z";
  const futureGenericBytes = Buffer.from(JSON.stringify(futureGenericContent), "utf8");
  await writeFile(genericArtifactPath, futureGenericBytes);
  const futureGeneric = structuredClone(manifest);
  futureGeneric.artifacts[1].sha256 = sha256(futureGenericBytes);
  await assert.rejects(
    () => assertCanaryExternalPackage(futureGeneric, { packageRoot, environment, currentHead, now }),
    /validity window is not current/,
  );
  await writeFile(genericArtifactPath, originalGenericArtifact);

  const diagnosticsCase = structuredClone(manifest);
  diagnosticsCase.authority.reference = "authority/manifest/self";
  let diagnosticsError;
  try {
    await assertCanaryExternalPackage(diagnosticsCase, { packageRoot, environment, currentHead, now });
  } catch (error) {
    diagnosticsError = error;
  }
  assert.match(diagnosticsError?.message ?? "", /self-asserted/);
  assert.equal(diagnosticsError.name, "CanaryExternalPackageValidationError");
  assert.deepEqual(Object.keys(diagnosticsError.diagnostics[0]).sort(), ["actual", "category", "expected", "field", "owner", "reason"]);
  assert.doesNotMatch(JSON.stringify(diagnosticsError.diagnostics), /secret-marker|private-key-marker/);

  const cliEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== CANARY_EXTERNAL_PACKAGE_MANIFEST_INPUT),
  );
  const missingManifestCli = spawnSync(process.execPath, [fileURLToPath(new URL("./canary-external-package.mjs", import.meta.url))], {
    env: cliEnvironment,
    encoding: "utf8",
  });
  assert.equal(missingManifestCli.status, 2);
  assert.match(missingManifestCli.stderr, new RegExp(`${CANARY_EXTERNAL_PACKAGE_MANIFEST_INPUT} is required`));
} finally {
  await rm(packageRoot, { recursive: true, force: true });
}

console.log("[tlsn-canary-external-package] manifest, artifact, identity, secret-boundary, and one-of contract PASS");