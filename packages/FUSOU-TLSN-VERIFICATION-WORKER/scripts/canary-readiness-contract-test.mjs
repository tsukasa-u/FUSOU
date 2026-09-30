#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildReadinessReport } from "./canary-readiness-test.mjs";
import { CANARY_TLSN_ARCHITECTURE } from "./canary-external-input-intake.mjs";
import { signCanaryRuntimeAttestation } from "./canary-runtime-attestation-signing.mjs";
import { createCanaryDeploymentMessage } from "./canary-deployment-attestation.mjs";
import { CANARY_VERIFIER_WORKER_NAME } from "./canary-deployment-target.mjs";
import { createCanaryVerifierExecutionReceipt } from "./canary-verifier-identity.mjs";
import {
  CANARY_VERIFIER_IDENTITY_KEY_REGISTRY_SCOPE,
  canaryVerifierIdentityKeyRegistrySha256,
} from "./canary-verifier-identity.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const readinessPath = resolve(packageDirectory, "scripts/canary-readiness-test.mjs");
const result = spawnSync(process.execPath, [readinessPath], {
  cwd: packageDirectory,
  encoding: "utf8",
  env: {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
  },
});

assert.equal(result.status, 0, result.stderr);
const report = JSON.parse(result.stdout);
assert.equal(report.network_access, "NOT_USED");
assert.equal(report.deployment_executed, false);
assert.equal(report.status, "BLOCKED");
assert.equal(report.external_authority.status, "EXTERNAL_AUTHORITY_REQUIRED");
assert.equal(report.external_authority.first_blocker.id, "TARGET_IDENTITY");
assert.equal(report.external_authority.first_blocker.status, "MISSING");
assert.deepEqual(report.external_authority.first_blocker.missing_inputs, [
  "TLSN_CANDIDATE_SERVER_IDENTITY",
  "TLSN_CANDIDATE_VERIFIER_KEY_ID",
]);
assert.equal(report.external_authority.package_boundary.active_input, "TLSN_CANARY_DEPLOYMENT_MANIFEST");
assert.equal(report.external_authority.package_boundary.external_package_gate, "NOT_AN_ACTIVE_GATE");
assert.equal(report.inputs.deployment_manifest.status, "ABSENT");
assert.notEqual(
  report.external_authority.groups.find(({ id }) => id === "DEPLOYMENT_MANIFEST").status,
  "PRESENT_UNVERIFIED",
);
const repeatedMissingTargetReport = JSON.parse(spawnSync(process.execPath, [readinessPath], {
  cwd: packageDirectory,
  encoding: "utf8",
  env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp" },
}).stdout);
assert.deepEqual(
  {
    id: repeatedMissingTargetReport.external_authority.first_blocker.id,
    status: repeatedMissingTargetReport.external_authority.first_blocker.status,
    missing_inputs: repeatedMissingTargetReport.external_authority.first_blocker.missing_inputs,
  },
  {
    id: report.external_authority.first_blocker.id,
    status: report.external_authority.first_blocker.status,
    missing_inputs: report.external_authority.first_blocker.missing_inputs,
  },
);
const handoffGroups = Object.fromEntries(report.external_authority.groups.map((group) => [group.id, group]));
const groupPositions = new Map(report.external_authority.groups.map(({ id }, index) => [id, index]));
for (const group of report.external_authority.groups) {
  for (const dependency of group.depends_on) {
    assert.ok(groupPositions.get(dependency) < groupPositions.get(group.id), `${dependency} must precede ${group.id}`);
  }
}
assert.ok(handoffGroups.DEPLOYMENT_MANIFEST.depends_on.includes("SESSION_AUTHORITY"));
assert.ok(!handoffGroups.DEPLOYMENT_MANIFEST.depends_on.includes("SECRET_PROVIDER"));
assert.equal(report.inputs.runtime_attestation.status, "MISSING");
assert.equal(report.gates.runtime_attestation, false);
assert.equal(report.inputs.remote_validation.status, "POST_DEPLOYMENT_ONLY");
assert.ok(Object.values(report.inputs.remote_validation.fields).every((status) => status.endsWith("POST_DEPLOYMENT")));
assert.ok(!report.missing_inputs.some((name) => name.startsWith("TLSN_REMOTE_")));
assert.ok(report.input_diagnostics
  .filter((entry) => entry.phase === "REMOTE_VALIDATION_ONLY")
  .every((entry) => entry.status.endsWith("POST_DEPLOYMENT")));
assert.equal(CANARY_TLSN_ARCHITECTURE.live_verifier.status, "NOT_IMPLEMENTED");
assert.equal(CANARY_TLSN_ARCHITECTURE.delegated_notary.current_presentation_path, "REQUIRED");

const negativeReport = (environment) => buildReadinessReport({
  environment,
  expectedHead: "a".repeat(40),
  artifactPaths: [],
  baseDirectory: packageDirectory,
  now: new Date("2026-09-27T00:00:00.000Z"),
});
const targetInputs = {
  TLSN_CANDIDATE_SERVER_IDENTITY: "authority.example.com",
  TLSN_CANDIDATE_VERIFIER_KEY_ID: "candidate-verifier-1",
  TLSN_CANDIDATE_NOTARY_KEY_ID: "notary-1",
};
const profileInputs = {
  ...targetInputs,
  TLSN_CANDIDATE_PROFILE_SHA256: "profile-sha",
  TLSN_CANDIDATE_SPARSE_PROFILE_SHA256: "sparse-profile-sha",
};
const missingProfileReport = await negativeReport(targetInputs);
assert.equal(missingProfileReport.status, "BLOCKED");
const missingProfileGroups = Object.fromEntries(missingProfileReport.external_authority.groups.map((group) => [group.id, group]));
assert.equal(missingProfileGroups.PROFILE_POLICY.status, "DERIVED");
assert.equal(missingProfileGroups.PROFILE_POLICY.external_authority, false);
assert.equal(missingProfileGroups.PROFILE_POLICY.source, "profile-canonical-contract");
assert.equal(missingProfileReport.external_authority.status, "EXTERNAL_AUTHORITY_REQUIRED");
assert.equal(missingProfileReport.missing_inputs.includes("TLSN_CANDIDATE_PROFILE_SHA256"), false);
assert.equal(missingProfileReport.deployment_executed, false);
const missingTrustReport = await negativeReport(profileInputs);
assert.equal(Object.fromEntries(missingTrustReport.external_authority.groups.map((group) => [group.id, group])).NOTARY_TRUST.status, "MISSING");
assert.equal(missingTrustReport.deployment_executed, false);
const fixtureTargetReport = await negativeReport({ ...profileInputs, TLSN_CANDIDATE_SERVER_IDENTITY: "game.example.test" });
const fixtureGroups = Object.fromEntries(fixtureTargetReport.external_authority.groups.map((group) => [group.id, group]));
assert.equal(fixtureTargetReport.inputs.target_provenance.status, "FIXTURE_OR_SYNTHETIC");
assert.equal(fixtureGroups.TARGET_IDENTITY.status, "INVALID");
assert.equal(fixtureGroups.PROFILE_POLICY.status, "BLOCKED_BY_DEPENDENCY");
assert.equal(fixtureTargetReport.deployment_executed, false);

const expectedHead = "a".repeat(40);
const matchingWorkflow = {
  workflow_run_id: "100",
  workflow_run_attempt: "1",
  repository: "example/FUSOU",
  workflow_file_identity: "dotenvx+pnpm+wrangler",
};
const matchingEnvironment = {
  TLSN_CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID: "test-readiness-runtime-attestation",
  TLSN_CANARY_DEPLOYMENT_ID: "canary-contract-test",
  TLSN_CANARY_WORKER_NAME: "fusou-tlsn-verification-canary",
  TLSN_WORKFLOW_RUN_ID: matchingWorkflow.workflow_run_id,
  TLSN_WORKFLOW_RUN_ATTEMPT: matchingWorkflow.workflow_run_attempt,
  TLSN_REPOSITORY: matchingWorkflow.repository,
  TLSN_WORKFLOW_FILE_IDENTITY: matchingWorkflow.workflow_file_identity,
  TLSN_GIT_COMMIT_SHA: expectedHead,
};
const { privateKey: runtimeAttestationPrivateKey, publicKey: runtimeAttestationPublicKey } = generateKeyPairSync("ed25519");
const runtimeAttestationPrivateKeyPkcs8 = runtimeAttestationPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const runtimeAttestationPublicKeySpki = runtimeAttestationPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const runtimeAttestationKeyRegistry = {
  schema_version: 1,
  scope: "tlsn-canary-runtime-attestation-key-registry",
  keys: [{
    key_id: matchingEnvironment.TLSN_CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID,
    public_key_spki: runtimeAttestationPublicKeySpki,
    status: "ACTIVE",
    not_before: "2026-01-01T00:00:00.000Z",
    not_after: null,
  }],
};
const verifierDeploymentId = "canary-verifier-contract-test";
const verifierVersionId = "6b064508-1cdb-453c-826b-bdea36a8b1e5";
const verifierPlatformDeploymentId = "7b064508-1cdb-453c-826b-bdea36a8b1e5";
const verifierKeyId = "test-canary-verifier-identity";
const { privateKey: verifierIdentityPrivateKey, publicKey: verifierIdentityPublicKey } = generateKeyPairSync("ed25519");
const verifierPublicKeySpki = verifierIdentityPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const { privateKey: bindingAuthorityPrivateKey, publicKey: bindingAuthorityPublicKey } = generateKeyPairSync("ed25519");
const bindingAuthorityPrivateKeyPkcs8 = bindingAuthorityPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const bindingAuthorityPublicKeySpki = bindingAuthorityPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const bindingAuthorityKeyId = "test-canary-binding-authority";
const verifierDeploymentMessage = createCanaryDeploymentMessage({
  deploymentId: verifierDeploymentId,
  workerName: CANARY_VERIFIER_WORKER_NAME,
  gitCommitSha: expectedHead,
  bindingAuthorityKeyId,
  bindingAuthorityPrivateKeyPkcs8,
  expectedBindingAuthorityPublicKeySpki: bindingAuthorityPublicKeySpki,
});
const verifierIdentityKeyRegistry = {
  schema_version: 1,
  scope: CANARY_VERIFIER_IDENTITY_KEY_REGISTRY_SCOPE,
  keys: [{
    key_id: verifierKeyId,
    public_key_spki: verifierPublicKeySpki,
    status: "ACTIVE",
    not_before: "2020-01-01T00:00:00.000Z",
    not_after: null,
    deployment_id: verifierDeploymentId,
    worker_name: CANARY_VERIFIER_WORKER_NAME,
  }],
};
const verifierDeploymentTag = `verifier-canary-${expectedHead.slice(0, 12)}`;
Object.assign(matchingEnvironment, {
  TLSN_CANARY_VERIFIER_DEPLOYMENT_ID: verifierDeploymentId,
  TLSN_CANARY_VERIFIER_IDENTITY_KEY_ID: verifierKeyId,
  TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI: verifierPublicKeySpki,
  TLSN_CANARY_VERIFIER_IDENTITY_KEY_REGISTRY: JSON.stringify(verifierIdentityKeyRegistry),
  TLSN_CANARY_BINDING_AUTHORITY_KEY_ID: bindingAuthorityKeyId,
  TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI: bindingAuthorityPublicKeySpki,
});
const matchingManifest = {
  manifest_id: "B".repeat(43),
  issued_at: "2026-09-01T00:00:00.000Z",
  expires_at: "2026-10-01T00:00:00.000Z",
  target: { deployment_role: "canary" },
  workflow: {
    repository: matchingWorkflow.repository,
    run_id: matchingWorkflow.workflow_run_id,
    run_attempt: matchingWorkflow.workflow_run_attempt,
    workflow_file_identity: matchingWorkflow.workflow_file_identity,
    commit_sha: expectedHead,
  },
  deployment: {
    deployment_id: matchingEnvironment.TLSN_CANARY_DEPLOYMENT_ID,
    worker_name: matchingEnvironment.TLSN_CANARY_WORKER_NAME,
  },
};
const unsignedRuntimeAttestation = {
  schema_version: 1,
  scope: "tlsn-canary-deployment-runtime-attestation",
  status: "PASS",
  readiness: "CANARY_RUNTIME_IDENTITY_VERIFIED",
  evidence: {
    source: "cloudflare-platform-and-live-health",
    synthetic: false,
  },
  repository: {
    git_commit_sha: expectedHead,
    workflow_run_id: matchingWorkflow.workflow_run_id,
    workflow_run_attempt: matchingWorkflow.workflow_run_attempt,
    repository: matchingWorkflow.repository,
    workflow_file_identity: matchingWorkflow.workflow_file_identity,
  },
  deployment: {
    authorized_deployment_id: "canary-contract-test",
    manifest_id: matchingManifest.manifest_id,
    platform_deployment_id: "3b064508-1cdb-453c-826b-bdea36a8b1e5",
    worker_name: "fusou-tlsn-verification-canary",
    deployment_role: "canary",
    versions: [{ version_id: "4b064508-1cdb-453c-826b-bdea36a8b1e5", percentage: 100 }],
  },
  version: {
    version_id: "4b064508-1cdb-453c-826b-bdea36a8b1e5",
    serving_percentage: 100,
  },
  runtime_self_reported_identity: {
    deployment_id: "canary-contract-test",
    worker_name: "fusou-tlsn-verification-canary",
    deployment_role: "canary",
    git_commit_sha: expectedHead,
    runtime_version: { version_id: "4b064508-1cdb-453c-826b-bdea36a8b1e5" },
  },
  verifier_deployment: {
    authorized_deployment_id: verifierDeploymentId,
    platform_deployment_id: verifierPlatformDeploymentId,
    worker_name: CANARY_VERIFIER_WORKER_NAME,
    deployment_role: "canary",
    annotations: {
      "workers/message": verifierDeploymentMessage,
      "workers/tag": verifierDeploymentTag,
    },
    versions: [{ version_id: verifierVersionId, percentage: 100 }],
  },
  verifier_version: {
    version_id: verifierVersionId,
    serving_percentage: 100,
    annotations: {
      "workers/message": verifierDeploymentMessage,
      "workers/tag": verifierDeploymentTag,
    },
  },
  verifier_runtime_identity: {
    deployment_id: verifierDeploymentId,
    worker_name: CANARY_VERIFIER_WORKER_NAME,
    deployment_role: "canary",
    git_commit_sha: expectedHead,
    runtime_version: { version_id: verifierVersionId },
    verifier_identity: {
      key_id: verifierKeyId,
      public_key_spki: verifierPublicKeySpki,
      deployment_id: verifierDeploymentId,
      worker_name: CANARY_VERIFIER_WORKER_NAME,
      keypair_valid: true,
    },
  },
  verifier_identity: {
    key_id: verifierKeyId,
    public_key_spki: verifierPublicKeySpki,
    public_key_spki_sha256: createHash("sha256").update(Buffer.from(verifierPublicKeySpki, "base64url")).digest("base64url"),
    deployment_id: verifierDeploymentId,
    worker_name: CANARY_VERIFIER_WORKER_NAME,
    key_registry_sha256: canaryVerifierIdentityKeyRegistrySha256(verifierIdentityKeyRegistry),
    key_registry: verifierIdentityKeyRegistry,
  },
  checks: {
    synthetic_evidence_rejected: true,
    runtime_is_production_canary: true,
    runtime_deployment_matches_authorized_identity: true,
    runtime_version_matches_platform_version: true,
    runtime_git_sha_matches_head: true,
    verifier_platform_identity_matches_authorized_deployment: true,
    verifier_runtime_matches_platform_version: true,
    verifier_identity_key_matches_active_registry: true,
  },
  captured_at: "2026-09-15T00:00:00.000Z",
};
const validRuntimeAttestation = signCanaryRuntimeAttestation(unsignedRuntimeAttestation, {
  signerKeyId: matchingEnvironment.TLSN_CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID,
  signingPrivateKeyPkcs8: runtimeAttestationPrivateKeyPkcs8,
  registry: runtimeAttestationKeyRegistry,
  now: "2026-09-15T00:00:00.000Z",
});

const root = await mkdtemp(join(tmpdir(), "tlsn-canary-readiness-contract-"));
try {
  const artifactPath = join(root, "runtime-attestation.json");
  const reportFor = async (artifact, reportEnvironment = matchingEnvironment, reportManifest = matchingManifest) => {
    await writeFile(artifactPath, `${JSON.stringify(artifact)}\n`, "utf8");
    return buildReadinessReport({
      environment: { ...reportEnvironment, TLSN_CANARY_DEPLOYMENT_ATTESTATION_PATH: artifactPath },
      expectedHead,
      artifactPaths: [],
      baseDirectory: root,
      validatedDeploymentManifest: reportManifest,
      runtimeAttestationKeyRegistry,
      now: new Date("2026-09-20T00:00:00.000Z"),
    });
  };

  const genericPassReport = await reportFor({ status: "PASS", environment: "production", deployment_role: "canary" });
  assert.equal(genericPassReport.status, "BLOCKED");
  assert.equal(genericPassReport.inputs.runtime_attestation.status, "INVALID");
  assert.equal(genericPassReport.gates.runtime_attestation, false);

  const fixtureReport = await reportFor({
    ...validRuntimeAttestation,
    scope: "tlsn-canary-deployment-runtime-attestation-fixture",
    status: "FIXTURE_ONLY",
    readiness: "NOT_READY",
    evidence: { source: "repository-fixture", synthetic: true },
  });
  assert.equal(fixtureReport.status, "BLOCKED");
  assert.equal(fixtureReport.inputs.runtime_attestation.status, "FIXTURE_ONLY");
  assert.equal(fixtureReport.gates.runtime_attestation, false);

  const validReport = await reportFor(validRuntimeAttestation);
  assert.equal(validReport.inputs.runtime_attestation.status, "VALID");
  assert.equal(validReport.inputs.runtime_attestation.readiness, "CANARY_RUNTIME_IDENTITY_VERIFIED");
  assert.equal(validReport.inputs.runtime_attestation.cross_binding.status, "PASS");
  assert.equal(validReport.cross_binding.status, "PASS");
  assert.equal(validReport.gates.runtime_attestation, true);
  assert.equal(validReport.gates.cross_binding, true);
  assert.equal(validReport.gates.attestation_fresh, true);
  assert.equal(validReport.gates.attestation_signature, true);
  assert.equal(validReport.gates.verifier_identity_binding, false);
  assert.equal(validReport.inputs.verifier_identity_binding.status, "MISSING");
  assert.equal(validReport.inputs.verifier_identity_binding.runtime_attestation, "PASS");
  assert.equal(validReport.inputs.verifier_identity_binding.execution_receipt_evidence, "NOT_RUN");
  assert.equal(validReport.inputs.runtime_attestation.verifier_deployment_id, verifierDeploymentId);
  assert.equal(validReport.gates.operational_smoke, false);
  assert.equal(validReport.inputs.operational_smoke.status, "NOT_RUN");
  for (const component of ["main_worker", "verifier", "callback", "trigger", "session_binding", "DO", "R2", "Notary", "Auth", "Presentation"]) {
    assert.equal(validReport.inputs.operational_smoke[component], "NOT_RUN");
  }
  assert.equal(validReport.inputs.runtime_attestation.signature_valid, true);
  assert.equal(validReport.inputs.runtime_attestation.signature_algorithm, "Ed25519");
  assert.equal(validReport.status, "BLOCKED");

  const executionJobId = "f73fded7-d9af-4f0a-b87b-c626d30d55bd";
  const executionAttemptId = "5f289198-7361-4a92-9d03-c4e506385130";
  const presentationBytes = Buffer.from("readiness Canary Presentation bytes");
  const resultBytes = Buffer.from("readiness signed Canary Result bytes");
  const receipt = createCanaryVerifierExecutionReceipt({
    jobId: executionJobId,
    verificationAttemptId: executionAttemptId,
    deploymentId: verifierDeploymentId,
    workerName: CANARY_VERIFIER_WORKER_NAME,
    runtimeVersionId: verifierVersionId,
    verifierKeyId,
    verifierPublicKeySpki,
    verifierSigningPrivateKeyPkcs8: verifierIdentityPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    presentationBytes,
    resultBytes,
    issuedAt: "2026-09-20T00:00:00.000Z",
  });
  const executionBundlePath = join(root, "canary-execution-bundle.json");
  await Promise.all([
    writeFile(join(root, "canary-presentation.bin"), presentationBytes),
    writeFile(join(root, "canary-result.json"), resultBytes),
    writeFile(join(root, "canary-verifier-execution-receipt.json"), JSON.stringify(receipt)),
  ]);
  await writeFile(executionBundlePath, JSON.stringify({
    schema_version: 1,
    scope: "tlsn-canary-verifier-execution-evidence-bundle",
    main_deployment_id: matchingEnvironment.TLSN_CANARY_DEPLOYMENT_ID,
    main_worker_name: matchingEnvironment.TLSN_CANARY_WORKER_NAME,
    main_version_id: "4b064508-1cdb-453c-826b-bdea36a8b1e5",
    main_platform_deployment_id: "3b064508-1cdb-453c-826b-bdea36a8b1e5",
    git_commit_sha: expectedHead,
    workflow_run_id: matchingWorkflow.workflow_run_id,
    workflow_run_attempt: matchingWorkflow.workflow_run_attempt,
    job_id: executionJobId,
    verification_attempt_id: executionAttemptId,
    artifacts: {
      presentation: "canary-presentation.bin",
      result: "canary-result.json",
      verifier_execution_receipt: "canary-verifier-execution-receipt.json",
    },
  }), "utf8");
  const receiptBoundReport = await reportFor(validRuntimeAttestation, {
    ...matchingEnvironment,
    TLSN_CANARY_VERIFIER_EXECUTION_EVIDENCE_PATH: executionBundlePath,
    TLSN_CANARY_VERIFIER_EXECUTION_JOB_ID: executionJobId,
    TLSN_CANARY_VERIFIER_EXECUTION_ATTEMPT_ID: executionAttemptId,
  });
  assert.equal(receiptBoundReport.inputs.verifier_identity_binding.status, "PASS");
  assert.equal(receiptBoundReport.inputs.verifier_identity_binding.execution_receipt_evidence, "PASS");
  assert.equal(receiptBoundReport.gates.verifier_identity_binding, true);
  assert.equal(receiptBoundReport.gates.operational_smoke, false);
  assert.equal(receiptBoundReport.inputs.operational_smoke.status, "NOT_RUN");
  assert.equal(receiptBoundReport.status, "BLOCKED");
  const replayedAttemptReport = await reportFor(validRuntimeAttestation, {
    ...matchingEnvironment,
    TLSN_CANARY_VERIFIER_EXECUTION_EVIDENCE_PATH: executionBundlePath,
    TLSN_CANARY_VERIFIER_EXECUTION_JOB_ID: executionJobId,
    TLSN_CANARY_VERIFIER_EXECUTION_ATTEMPT_ID: "6f289198-7361-4a92-9d03-c4e506385130",
  });
  assert.equal(replayedAttemptReport.inputs.verifier_identity_binding.status, "INVALID");
  assert.equal(replayedAttemptReport.gates.verifier_identity_binding, false);
  assert.equal(replayedAttemptReport.status, "BLOCKED");

  const completeHandoffEnvironment = Object.fromEntries(
    validReport.external_authority.groups.flatMap((group) => group.inputs).map((name) => [name, "provided-value"]),
  );
  const completeHandoffReport = await buildReadinessReport({
    environment: { ...completeHandoffEnvironment, ...matchingEnvironment },
    expectedHead,
    artifactPaths: [],
    baseDirectory: root,
    validatedDeploymentManifest: matchingManifest,
    runtimeAttestationKeyRegistry,
    now: new Date("2026-09-20T00:00:00.000Z"),
  });
  assert.equal(completeHandoffReport.external_authority.first_blocker, null);
  assert.equal(completeHandoffReport.external_authority.status, "READINESS_GATES_REQUIRED");
  assert.equal(completeHandoffReport.gates.verifier_identity_binding, false);
  assert.equal(completeHandoffReport.gates.operational_smoke, false);

  const unknownSecurityFieldReport = await reportFor(signCanaryRuntimeAttestation({
    ...unsignedRuntimeAttestation,
    security_override: {
      readiness: "CANARY_RUNTIME_IDENTITY_VERIFIED",
      bypass_signature: true,
    },
  }, {
    signerKeyId: matchingEnvironment.TLSN_CANARY_RUNTIME_ATTESTATION_SIGNER_KEY_ID,
    signingPrivateKeyPkcs8: runtimeAttestationPrivateKeyPkcs8,
    registry: runtimeAttestationKeyRegistry,
    now: "2026-09-15T00:00:00.000Z",
  }));
  assert.equal(unknownSecurityFieldReport.inputs.runtime_attestation.status, "VALID");
  assert.equal(unknownSecurityFieldReport.gates.runtime_attestation, true);
  assert.equal(unknownSecurityFieldReport.gates.attestation_signature, true);
  assert.equal(unknownSecurityFieldReport.status, "BLOCKED");

  const tamperedPayloadReport = await reportFor({
    ...validRuntimeAttestation,
    deployment: {
      ...validRuntimeAttestation.deployment,
      platform_deployment_id: "5b064508-1cdb-453c-826b-bdea36a8b1e5",
    },
  });
  assert.equal(tamperedPayloadReport.status, "BLOCKED");
  assert.equal(tamperedPayloadReport.inputs.runtime_attestation.status, "INVALID");
  assert.equal(tamperedPayloadReport.gates.runtime_attestation, false);
  assert.equal(tamperedPayloadReport.gates.attestation_signature, false);

  const manifestIdMismatchReport = await reportFor(validRuntimeAttestation, matchingEnvironment, {
    ...matchingManifest,
    manifest_id: "C".repeat(43),
  });
  assert.equal(manifestIdMismatchReport.status, "BLOCKED");
  assert.equal(manifestIdMismatchReport.inputs.runtime_attestation.status, "INVALID");
  assert.equal(manifestIdMismatchReport.cross_binding.status, "BLOCKED");
  assert.equal(manifestIdMismatchReport.gates.cross_binding, false);
  assert.equal(manifestIdMismatchReport.gates.attestation_fresh, false);

  const expiredManifestReport = await reportFor(validRuntimeAttestation, matchingEnvironment, {
    ...matchingManifest,
    expires_at: "2026-09-10T00:00:00.000Z",
  });
  assert.equal(expiredManifestReport.status, "BLOCKED");
  assert.equal(expiredManifestReport.inputs.runtime_attestation.status, "INVALID");
  assert.equal(expiredManifestReport.gates.attestation_fresh, false);

  for (const [label, capturedAt] of [
    ["future captured_at", "2026-09-21T00:00:00.000Z"],
    ["captured_at before manifest.issued_at", "2026-08-31T23:59:59.999Z"],
    ["captured_at after manifest.expires_at", "2026-10-01T00:00:00.001Z"],
  ]) {
    const timestampReport = await reportFor({ ...validRuntimeAttestation, captured_at: capturedAt });
    assert.equal(timestampReport.status, "BLOCKED", label);
    assert.equal(timestampReport.inputs.runtime_attestation.status, "INVALID", label);
    assert.equal(timestampReport.gates.attestation_fresh, false, label);
  }

  const frankensteinReport = await reportFor(validRuntimeAttestation, {
    ...matchingEnvironment,
    TLSN_CANARY_DEPLOYMENT_ID: "canary-other-deployment",
  });
  assert.equal(frankensteinReport.status, "BLOCKED");
  assert.equal(frankensteinReport.inputs.runtime_attestation.status, "INVALID");
  assert.equal(frankensteinReport.cross_binding.status, "BLOCKED");
  assert.equal(frankensteinReport.gates.cross_binding, false);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("[tlsn-canary-readiness-contract] Runtime Attestation gate, remote validation boundary, and live-verifier status PASS");