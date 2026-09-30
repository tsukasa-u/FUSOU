#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANARY_OPERATIONAL_SMOKE_COMPONENTS,
  CANARY_OPERATIONAL_SMOKE_REPLAY_POLICY,
  assertCanaryOperationalSmokeArtifact,
  createCanaryOperationalSmokeArtifact,
  createCanaryOperationalSmokeNotRun,
  loadCanaryOperationalSmokeArtifact,
  runCanaryOperationalSmokeFromLiveEvidence,
} from "./canary-operational-smoke.mjs";
import { deploymentManifestIdentity } from "./canary-deployment-manifest.mjs";
import { signCanaryRuntimeAttestation } from "./canary-runtime-attestation-signing.mjs";

const capturedAt = "2026-09-30T12:00:00.000Z";
const readinessInvocationId = "f73fded7-d9af-4f0a-b87b-c626d30d55bd";
const mainHealthOrigin = "https://main-canary.example.net";
const verifierHealthOrigin = "https://verifier-canary.example.net";
const signerKeyId = "test-runtime-attestation";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privateKeyPkcs8 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
const runtimeAttestationKeyRegistry = {
  schema_version: 1,
  scope: "tlsn-canary-runtime-attestation-key-registry",
  keys: [{
    key_id: signerKeyId,
    public_key_spki: publicKeySpki,
    status: "ACTIVE",
    not_before: "2026-01-01T00:00:00.000Z",
    not_after: null,
  }],
};
const deploymentManifestBody = {
  target: {
    server_identity: "game.example.net",
    environment: "production",
    deployment_role: "canary",
    binding_identity: "canary-binding-2026-09-30",
  },
  notary: { owner: "FUSOU", service: "FUSOU-NOTARY", key_id: "notary-2026-09-30" },
  inputs: [
    { name: "TLSN_CANDIDATE_PROFILE_SHA256", value_sha256: "A".repeat(43), provenance: "deployment-input" },
    { name: "TLSN_CANARY_WORKER_INTERNAL_URL", value_sha256: createHash("sha256").update(mainHealthOrigin).digest("base64url"), provenance: "deployment-input" },
    { name: "TLSN_CANARY_VERIFIER_WORKER_INTERNAL_URL", value_sha256: createHash("sha256").update(verifierHealthOrigin).digest("base64url"), provenance: "deployment-input" },
  ],
  artifacts: [{ name: "profile", path: "profile.json", sha256: "B".repeat(43) }],
};
const deploymentManifest = {
  ...deploymentManifestBody,
  manifest_id: deploymentManifestIdentity(deploymentManifestBody),
};
const trustedRuntimeIdentity = {
  status: "VALID",
  signature_valid: true,
  cross_binding: { attestation_fresh: true },
  git_commit_sha: "a".repeat(40),
  workflow_run_id: "123456",
  workflow_run_attempt: "2",
  deployment_id: "canary-main-2026-09-30",
  worker_name: "fusou-tlsn-verification-canary",
  version_id: "4b064508-1cdb-453c-826b-bdea36a8b1e5",
  platform_deployment_id: "3b064508-1cdb-453c-826b-bdea36a8b1e5",
  manifest_id: deploymentManifest.manifest_id,
  attestation_signer_key_id: signerKeyId,
  verifier_identity: {
    status: "VALID",
    deployment_id: "canary-verifier-2026-09-30",
    worker_name: "fusou-tlsn-verifier-canary",
    version_id: "5b064508-1cdb-453c-826b-bdea36a8b1e5",
    verifier_key_id: "verifier-canary-2026-09-30",
    key_registry_sha256: "A".repeat(43),
    attestation_captured_at: "2026-09-30T11:50:00.000Z",
    attestation_expires_at: "2026-09-30T12:20:00.000Z",
  },
};

const defaultArtifact = createCanaryOperationalSmokeNotRun({ capturedAt });
assert.equal(defaultArtifact.status, "NOT_RUN");
assert.equal(defaultArtifact.readiness, "BLOCKED");
assert.equal(defaultArtifact.evidence.synthetic, true);
for (const component of CANARY_OPERATIONAL_SMOKE_COMPONENTS) {
  assert.equal(defaultArtifact.checks[component].status, "NOT_RUN");
}
let healthFetchCount = 0;
const blockedRunner = await runCanaryOperationalSmokeFromLiveEvidence({
  fetchImpl: async () => {
    healthFetchCount += 1;
    throw new Error("network access must not occur without approved inputs");
  },
});
assert.equal(blockedRunner.status, "NOT_RUN");
assert.equal(blockedRunner.readiness, "BLOCKED");
assert.ok(blockedRunner.missing_inputs.includes("TLSN_CANARY_OPERATIONAL_SMOKE_LIVE_EVIDENCE_DIR"));
assert.ok(blockedRunner.missing_inputs.includes("TLSN_CANARY_WORKER_INTERNAL_URL"));
assert.ok(blockedRunner.missing_inputs.includes("TLSN_CANARY_VERIFIER_WORKER_INTERNAL_URL"));
assert.equal(healthFetchCount, 0);

assert.match(blockedRunner.reason, /no fixture fallback/);
const runnerCli = spawnSync(process.execPath, [new URL("./canary-operational-smoke-runner.mjs", import.meta.url).pathname], {
  env: { PATH: process.env.PATH ?? "" },
  encoding: "utf8",
});
assert.equal(runnerCli.status, 2);
assert.equal(JSON.parse(runnerCli.stdout).status, "NOT_RUN");
assert.equal(JSON.parse(runnerCli.stdout).readiness, "BLOCKED");
assert.equal(runnerCli.stderr, "");

const observations = Object.fromEntries(CANARY_OPERATIONAL_SMOKE_COMPONENTS.map((component) => [component, {
  status: "NOT_RUN",
  observed_at: null,
  probe_id: null,
  evidence_artifact: null,
}]));
const partialArtifact = createCanaryOperationalSmokeArtifact({
  observations,
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  capturedAt,
  signingNow: capturedAt,
});
assert.equal(partialArtifact.status, "NOT_RUN");
assert.equal(partialArtifact.readiness, "BLOCKED");
assert.equal(partialArtifact.checks.main_worker.status, "NOT_RUN");
assert.equal(partialArtifact.evidence.source, "live-inputs-unavailable");
assert.equal(partialArtifact.evidence.synthetic, false);
assert.equal(partialArtifact.evidence.replay_policy, CANARY_OPERATIONAL_SMOKE_REPLAY_POLICY);
assert.equal(partialArtifact.bound_identity.manifest_id, deploymentManifest.manifest_id);
assert.equal(partialArtifact.readiness_invocation_id, readinessInvocationId);
assert.throws(() => createCanaryOperationalSmokeArtifact({
  observations: {
    ...observations,
    main_worker: {
      status: "PASS",
      observed_at: "2026-09-30T11:59:00.000Z",
      probe_id: "394dc8cc-d4bc-4b8c-9813-7bc4a04a9603",
      evidence_artifact: "observations/main-worker.json",
    },
  },
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  capturedAt,
  signingNow: capturedAt,
}), /complete ten-component live evidence set/);
assert.throws(() => createCanaryOperationalSmokeArtifact({
  observations: {
    ...observations,
    main_worker: { ...observations.main_worker, probe_id: "394dc8cc-d4bc-4b8c-9813-7bc4a04a9603" },
  },
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  capturedAt,
  signingNow: capturedAt,
}), /non-run status cannot claim live evidence/);
assert.throws(() => createCanaryOperationalSmokeArtifact({
  observations: {
    ...observations,
    main_worker: {
      status: "PASS",
      observed_at: capturedAt,
      probe_id: "394dc8cc-d4bc-4b8c-9813-7bc4a04a9603",
      evidence_artifact: "../outside.json",
    },
  },
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  capturedAt,
  signingNow: capturedAt,
}), /safe relative path/);
assert.throws(() => assertCanaryOperationalSmokeArtifact(partialArtifact, {
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  runtimeAttestationKeyRegistry,
  currentHead: trustedRuntimeIdentity.git_commit_sha,
  expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
  now: new Date(capturedAt),
}), /not a complete PASS/);
assert.equal(assertCanaryOperationalSmokeArtifact(partialArtifact, {
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  runtimeAttestationKeyRegistry,
  currentHead: trustedRuntimeIdentity.git_commit_sha,
  expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
  allowNonPass: true,
  now: new Date(capturedAt),
}).status, "NOT_RUN");
assert.throws(() => assertCanaryOperationalSmokeArtifact(partialArtifact, {
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId: "a73fded7-d9af-4f0a-b87b-c626d30d55bd",
  runtimeAttestationKeyRegistry,
  currentHead: trustedRuntimeIdentity.git_commit_sha,
  expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
  allowNonPass: true,
  now: new Date(capturedAt),
}), /another readiness invocation/);
assert.throws(() => assertCanaryOperationalSmokeArtifact(partialArtifact, {
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  runtimeAttestationKeyRegistry,
  currentHead: "b".repeat(40),
  expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
  allowNonPass: true,
  now: new Date(capturedAt),
}), /another HEAD or deployment/);
assert.throws(() => createCanaryOperationalSmokeArtifact({
  observations,
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  signerKeyId: "unbound-smoke-signer",
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  capturedAt,
  signingNow: capturedAt,
}), /must use the Runtime Attestation signer/);
assert.throws(() => createCanaryOperationalSmokeArtifact({
  observations,
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  runtimeAttestationKeyRegistry,
  capturedAt: "2026-09-30T12:21:00.000Z",
  signingNow: capturedAt,
}), /outside the Verifier Runtime Attestation validity window/);

const { attestation_signer_key_id, signature_algorithm, signature_base64url, ...unsignedPartialArtifact } = partialArtifact;
const forgedPassArtifact = signCanaryRuntimeAttestation({
  ...unsignedPartialArtifact,
  status: "PASS",
  readiness: "OPERATIONAL_SMOKE_VERIFIED",
  evidence: {
    source: "live-service-observations",
    synthetic: false,
    replay_policy: CANARY_OPERATIONAL_SMOKE_REPLAY_POLICY,
  },
  checks: {
    ...partialArtifact.checks,
    main_worker: {
      status: "PASS",
      source: "live-service-observation",
      observed_at: "2026-09-30T11:59:00.000Z",
      probe_id: "394dc8cc-d4bc-4b8c-9813-7bc4a04a9603",
      evidence_artifact: "observations/main-worker.json",
      evidence_sha256: "C".repeat(43),
    },
  },
}, {
  signerKeyId,
  signingPrivateKeyPkcs8: privateKeyPkcs8,
  registry: runtimeAttestationKeyRegistry,
  now: capturedAt,
});
assert.throws(() => assertCanaryOperationalSmokeArtifact(forgedPassArtifact, {
  trustedRuntimeIdentity,
  deploymentManifest,
  readinessInvocationId,
  runtimeAttestationKeyRegistry,
  currentHead: trustedRuntimeIdentity.git_commit_sha,
  expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
  allowNonPass: true,
  now: new Date(capturedAt),
}), /raw evidence artifacts are required/);

const tempDir = await mkdtemp(join(tmpdir(), "canary-operational-smoke-"));
try {
  const missingEvidenceRunner = await runCanaryOperationalSmokeFromLiveEvidence({
    evidenceDirectory: join(tempDir, "absent-live-evidence"),
    outputPath: join(tempDir, "blocked-smoke.json"),
    mainWorkerOrigin: mainHealthOrigin,
    verifierOrigin: verifierHealthOrigin,
    readinessInvocationId,
    fetchImpl: async () => {
      healthFetchCount += 1;
      throw new Error("health fetch must not run without all component evidence");
    },
  });
  assert.equal(missingEvidenceRunner.status, "NOT_RUN");
  assert.equal(missingEvidenceRunner.readiness, "BLOCKED");
  assert.equal(healthFetchCount, 0);

  await assert.rejects(() => runCanaryOperationalSmokeFromLiveEvidence({
    evidenceDirectory: join(tempDir, "absent-live-evidence"),
    outputPath: join(tempDir, "unapproved-origin.json"),
    mainWorkerOrigin: "https://unapproved.example.net",
    verifierOrigin: verifierHealthOrigin,
    trustedRuntimeIdentity,
    deploymentManifest,
    readinessInvocationId,
    signerKeyId,
    signingPrivateKeyPkcs8: privateKeyPkcs8,
    runtimeAttestationKeyRegistry,
    now: new Date(capturedAt),
    fetchImpl: async () => {
      healthFetchCount += 1;
      throw new Error("unapproved health origin must not be contacted");
    },
  }), /does not match its validated deployment manifest input/);
  assert.equal(healthFetchCount, 0);

  const liveEvidenceDirectory = join(tempDir, "live-evidence");
  await mkdir(liveEvidenceDirectory);
  const jobId = "a73fded7-d9af-4f0a-b87b-c626d30d55bd";
  const attemptId = "b73fded7-d9af-4f0a-b87b-c626d30d55bd";
  const sessionId = "session-smoke-2026-09-30";
  const resultSha256 = "A".repeat(43);
  const presentationSha256 = "B".repeat(43);
  const subjectSha256 = "C".repeat(43);
  const deviceSha256 = "D".repeat(43);
  const smokeJobAttempt = { job_id: jobId, attempt_id: attemptId };
  const liveClaims = {
    callback: {
      ...smokeJobAttempt, http_status: 200, mode: "trigger", session_id: sessionId,
      result_sha256: resultSha256, presentation_sha256: presentationSha256, receipt_sha256: "E".repeat(43),
    },
    trigger: {
      ...smokeJobAttempt, state: "COMPLETED", task_id: "tlsn-verify-presentation", run_id: "run_123",
      session_id: sessionId, result_sha256: resultSha256,
    },
    session_binding: {
      ...smokeJobAttempt, session_id: sessionId, binding_sha256: "F".repeat(43),
      canonical_user_id_sha256: subjectSha256, device_id_sha256: deviceSha256,
      session_receipt_valid: true, consume_receipt_valid: true,
    },
    DO: {
      ...smokeJobAttempt, status: "consumed", result_sha256: resultSha256,
      result_object_key: `tlsn-verification/${attemptId}/result.json`,
    },
    R2: {
      ...smokeJobAttempt, object_key: `tlsn-verification/${attemptId}/result.json`, byte_length: 1024,
      readback_byte_length: 1024, result_sha256: resultSha256, readback_sha256: resultSha256,
    },
    Notary: {
      ...smokeJobAttempt, key_id: deploymentManifest.notary.key_id, registry_sha256: "G".repeat(43),
      signature_valid: true, presentation_sha256: presentationSha256,
    },
    Auth: {
      ...smokeJobAttempt, authority: "supabase+fusou-web", authenticated: true, is_anonymous: false,
      device_owner_match: true, canonical_user_id_sha256: subjectSha256, device_id_sha256: deviceSha256,
    },
    Presentation: {
      ...smokeJobAttempt, verified: true, profile_sha256: "H".repeat(43),
      server_identity: deploymentManifest.target.server_identity, notary_key_id: deploymentManifest.notary.key_id,
      presentation_sha256: presentationSha256, result_sha256: resultSha256,
    },
  };
  for (const [index, [component, claims]] of Object.entries(liveClaims).entries()) {
    await writeFile(join(liveEvidenceDirectory, `${component}.json`), JSON.stringify({
      schema_version: 1,
      scope: "tlsn-canary-operational-smoke-live-evidence",
      component,
      source: "canary-live-runner",
      synthetic: false,
      readiness_invocation_id: readinessInvocationId,
      probe_id: `${(index + 1).toString(16).padStart(8, "0")}-d9af-4f0a-b87b-c626d30d55bd`,
      observed_at: capturedAt,
      bound_identity: partialArtifact.bound_identity,
      claims,
    }));
  }

  const symlinkEvidenceDirectory = join(tempDir, "symlink-evidence");
  await mkdir(symlinkEvidenceDirectory);
  await symlink(join(liveEvidenceDirectory, "callback.json"), join(symlinkEvidenceDirectory, "callback.json"));
  await assert.rejects(() => runCanaryOperationalSmokeFromLiveEvidence({
    evidenceDirectory: symlinkEvidenceDirectory,
    outputPath: join(tempDir, "symlink-smoke.json"),
    mainWorkerOrigin: mainHealthOrigin,
    verifierOrigin: verifierHealthOrigin,
    trustedRuntimeIdentity,
    deploymentManifest,
    readinessInvocationId,
    signerKeyId,
    signingPrivateKeyPkcs8: privateKeyPkcs8,
    runtimeAttestationKeyRegistry,
    now: new Date(capturedAt),
    fetchImpl: async () => {
      healthFetchCount += 1;
      throw new Error("escaped evidence path must not trigger health probes");
    },
  }), /escapes its input directory/);
  assert.equal(healthFetchCount, 0);

  let liveHealthFetchCount = 0;
  const runnerInputs = {
    evidenceDirectory: liveEvidenceDirectory,
    mainWorkerOrigin: mainHealthOrigin,
    verifierOrigin: verifierHealthOrigin,
    trustedRuntimeIdentity,
    deploymentManifest,
    readinessInvocationId,
    signerKeyId,
    signingPrivateKeyPkcs8: privateKeyPkcs8,
    runtimeAttestationKeyRegistry,
    now: new Date(capturedAt),
  };
  const liveRunnerResult = await runCanaryOperationalSmokeFromLiveEvidence({
    ...runnerInputs,
    outputPath: join(tempDir, "live-smoke.json"),
    fetchImpl: async (request) => {
      liveHealthFetchCount += 1;
      const url = new URL(request);
      if (url.href === `${mainHealthOrigin}/health`) {
        return new Response(JSON.stringify({
          deployment_identity: {
            deployment_id: trustedRuntimeIdentity.deployment_id,
            worker_name: trustedRuntimeIdentity.worker_name,
            deployment_role: "canary",
          },
          runtime_version: { version_id: trustedRuntimeIdentity.version_id },
          git_commit_sha: trustedRuntimeIdentity.git_commit_sha,
          execution_mode: "trigger",
        }), { status: 200 });
      }
      assert.equal(url.href, `${verifierHealthOrigin}/health`);
      return new Response(JSON.stringify({
        deployment_id: trustedRuntimeIdentity.verifier_identity.deployment_id,
        worker_name: trustedRuntimeIdentity.verifier_identity.worker_name,
        runtime_version: { version_id: trustedRuntimeIdentity.verifier_identity.version_id },
        verifier_identity: {
          key_id: trustedRuntimeIdentity.verifier_identity.verifier_key_id,
          keypair_valid: true,
        },
      }), { status: 200 });
    },
  });
  assert.equal(liveRunnerResult.status, "PASS");
  assert.equal(liveRunnerResult.readiness, "OPERATIONAL_SMOKE_VERIFIED");
  assert.equal(liveHealthFetchCount, 2);
  const writtenSmoke = JSON.parse(await readFile(liveRunnerResult.artifact_path, "utf8"));
  assert.equal(writtenSmoke.evidence.source, "canary-operational-smoke-live-runner");
  assert.equal((await stat(liveRunnerResult.artifact_path)).mode & 0o777, 0o600);

  const oversizedResult = await runCanaryOperationalSmokeFromLiveEvidence({
    ...runnerInputs,
    outputPath: join(tempDir, "oversized-smoke.json"),
    fetchImpl: async () => new Response("x".repeat(65 * 1024), { status: 200 }),
  });
  assert.equal(oversizedResult.status, "FAIL");
  assert.equal(oversizedResult.readiness, "BLOCKED");

  const artifactPath = join(tempDir, "smoke.json");
  await writeFile(artifactPath, JSON.stringify(partialArtifact));
  const loadedPartial = await loadCanaryOperationalSmokeArtifact({
    artifactPath,
    trustedRuntimeIdentity,
    deploymentManifest,
    readinessInvocationId,
    runtimeAttestationKeyRegistry,
    currentHead: trustedRuntimeIdentity.git_commit_sha,
    expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
    now: new Date(capturedAt),
  });
  assert.equal(loadedPartial.status, "NOT_RUN");
  assert.equal(loadedPartial.readiness, "BLOCKED");
  assert.equal(loadedPartial.components.main_worker, "NOT_RUN");
  assert.equal(loadedPartial.manifest_id, deploymentManifest.manifest_id);
  assert.equal(loadedPartial.readiness_invocation_id, readinessInvocationId);

  const tamperedPath = join(tempDir, "smoke.json");
  await writeFile(tamperedPath, JSON.stringify({ ...partialArtifact, status: "FAIL" }));
  await assert.rejects(() => loadCanaryOperationalSmokeArtifact({
    artifactPath: tamperedPath,
    trustedRuntimeIdentity,
    deploymentManifest,
    readinessInvocationId,
    runtimeAttestationKeyRegistry,
    currentHead: trustedRuntimeIdentity.git_commit_sha,
    expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
    now: new Date(capturedAt),
  }), /signature is invalid/);

  const forgedPassPath = join(tempDir, "smoke-pass.json");
  await writeFile(forgedPassPath, JSON.stringify(forgedPassArtifact));
  await assert.rejects(() => loadCanaryOperationalSmokeArtifact({
    artifactPath: forgedPassPath,
    trustedRuntimeIdentity,
    deploymentManifest,
    readinessInvocationId,
    runtimeAttestationKeyRegistry,
    currentHead: trustedRuntimeIdentity.git_commit_sha,
    expectedDeploymentId: trustedRuntimeIdentity.deployment_id,
    now: new Date(capturedAt),
  }), /does not have live-runner evidence provenance/);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("[tlsn-canary-operational-smoke] manifest binding, synthetic default, missing-input runner block, traversal rejection, and forged PASS tests PASS");