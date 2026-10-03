import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { finalizeTlsnCandidateBundle } from "./tlsn-candidate-finalize.mjs";
import { createSyntheticCandidateBundle } from "./tlsn-candidate-synthetic-fixture.mjs";
import { verifyCanaryExistingSourceProofBundle } from "./canary-operational-smoke-existing-proofs.mjs";
import { inspectAlpha15Presentation } from "./production-evidence-semantic.mjs";
import { canonicalJson } from "./deployment-attestation.mjs";
import { createCandidateArtifactIdentity } from "./candidate-artifact-identity.mjs";

const artifactNames = [
  "session.json",
  "device-authentication.json",
  "device-identity.json",
  "possession-proof.json",
  "result.json",
  "consume-receipt.json",
  "worker-verification.json",
  "result-exact.bin",
  "verifier-execution-receipt-header.txt",
  "verifier-execution-receipt.bin",
  "presentation.bin",
  "metadata.json",
  "candidate-identity.json",
  "capture-provenance.json",
];

const hash = (bytes) => createHash("sha256").update(bytes).digest("base64url");
const jsonBytes = (value) => Buffer.from(JSON.stringify(value));

async function writeCandidate(directory, { syntheticFixture = true, captureId = "capture-1" } = {}) {
  const session = {
    session_id: "session-1",
    canonical_user_id: "user-1",
    device_id: "device-1",
    challenge: "binding-challenge",
    binding: "binding-value",
    device_challenge: "device-challenge",
    expires_at: "2030-01-01T00:00:00.000Z",
    session_receipt: { canonical_user_id: "user-1" },
  };
  const deviceAuthentication = { request: { nonce: "a".repeat(64) }, worker_acceptance: { status: 201 } };
  const deviceIdentity = {
    canonical_user_id: "user-1",
    device_id: "device-1",
    device_public_key: Buffer.alloc(32, 1).toString("base64url"),
    device_public_key_sha256: hash(Buffer.alloc(32, 1)),
    authority_state: "UNVERIFIED",
  };
  const possessionProof = { device_id: "device-1" };
  const result = { result_id: "result-1" };
  const consumeReceipt = { receipt_id: "consume-1" };
  const workerVerification = { verified: true, result, consume_receipt: consumeReceipt };
  const receiptBytes = jsonBytes({ receipt_id: "execution-1" });
  const presentationBytes = Buffer.from("opaque alpha15 presentation bytes");
  const metadata = {
    schema_version: 2,
    candidate_capture_id: captureId,
    session_id: session.session_id,
    request_id: "request-1",
    request_sha256: hash(Buffer.from("request bytes")),
    authenticated_request_sha256: hash(Buffer.from("authenticated request bytes")),
    binding_identifier: hash(Buffer.from(session.binding)),
    capture_timestamp: "2030-01-01T00:00:00.000Z",
    presentation_sha256: hash(presentationBytes),
    server_identity: "untrusted-config.example",
    proxy_provenance: {
      app_public_configuration_fingerprints: {
        schema_version: 2,
        scope: "fusou-tlsn-app-public-configuration",
        compile_time_sha256: hash(Buffer.from("compile config")),
        runtime_sha256: hash(Buffer.from("runtime config")),
        combined_sha256: hash(Buffer.from("combined config")),
        candidate_binding_status: "UNBOUND",
      },
    },
  };
  const metadataBytes = Buffer.from(canonicalJson(metadata), "utf8");
  const candidateIdentity = createCandidateArtifactIdentity({ metadataBytes, presentationBytes });
  const candidateIdentityBytes = Buffer.from(canonicalJson(candidateIdentity), "utf8");
  const artifacts = {
    "session.json": jsonBytes(session),
    "device-authentication.json": jsonBytes(deviceAuthentication),
    "device-identity.json": jsonBytes(deviceIdentity),
    "possession-proof.json": jsonBytes(possessionProof),
    "result.json": jsonBytes(result),
    "consume-receipt.json": jsonBytes(consumeReceipt),
    "worker-verification.json": jsonBytes(workerVerification),
    "result-exact.bin": jsonBytes({
      consume_receipt: consumeReceipt,
      result,
      verified: true,
    }),
    "verifier-execution-receipt-header.txt": Buffer.from(receiptBytes.toString("base64url")),
    "verifier-execution-receipt.bin": receiptBytes,
    "presentation.bin": presentationBytes,
    "metadata.json": metadataBytes,
    "candidate-identity.json": candidateIdentityBytes,
    "capture-provenance.json": jsonBytes(syntheticFixture
      ? { schema_version: 1, classification: "SYNTHETIC_FIXTURE", source: "synthetic-alpha15-test-fixture" }
      : { schema_version: 1, classification: "UNVERIFIED", source: "production-proxy-capture" }),
  };
  for (const [name, bytes] of Object.entries(artifacts)) {
    await writeFile(path.join(directory, name), bytes, { mode: 0o600 });
  }
  const manifest = {
    schema_version: 2,
    scope: "fusou-tlsn-human-test-play-candidate",
    candidate_status: "CAPTURED_PENDING_OFFLINE_VERIFICATION",
    approval_status: "UNAPPROVED",
    target_identity_status: "NOT_YET_OBSERVED",
    target_identity_source: "alpha15-verified-presentation-required",
    synthetic_fixture: syntheticFixture,
    capture_provenance: syntheticFixture ? "synthetic-alpha15-test-fixture" : "production-proxy-capture",
    presentation_sha256: hash(artifacts["presentation.bin"]),
    candidate_artifact_id: candidateIdentity.candidate_artifact_id,
    exact_result_sha256: hash(artifacts["result-exact.bin"]),
    verifier_execution_receipt_status: "CAPTURED",
    verifier_execution_receipt_sha256: hash(receiptBytes),
    worker_result_http_status: 200,
    connection_id: 5,
    readiness_effect: "NONE",
    gameplay_effect: "NONE",
    artifacts: Object.fromEntries(artifactNames.map((name) => [name, {
      size_bytes: artifacts[name].length,
      sha256: hash(artifacts[name]),
    }])),
  };
  await writeFile(path.join(directory, "candidate-manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
  return { manifest, session, artifacts };
}

async function rewriteArtifact(fixture, name, value) {
  const bytes = Buffer.from(
    name === "metadata.json" || name === "candidate-identity.json" ? canonicalJson(value) : JSON.stringify(value),
    "utf8",
  );
  await writeFile(path.join(fixture.candidateDirectory, name), bytes, { mode: 0o600 });
  fixture.candidateManifest.artifacts[name] = { size_bytes: bytes.length, sha256: hash(bytes) };
  await writeFile(
    path.join(fixture.candidateDirectory, "candidate-manifest.json"),
    JSON.stringify(fixture.candidateManifest),
    { mode: 0o600 },
  );
}

async function rewriteBinaryArtifact(fixture, name, bytes) {
  await writeFile(path.join(fixture.candidateDirectory, name), bytes, { mode: 0o600 });
  fixture.candidateManifest.artifacts[name] = { size_bytes: bytes.length, sha256: hash(bytes) };
  if (name === "presentation.bin") fixture.candidateManifest.presentation_sha256 = hash(bytes);
  if (name === "result-exact.bin") fixture.candidateManifest.exact_result_sha256 = hash(bytes);
  if (name === "verifier-execution-receipt.bin") {
    fixture.candidateManifest.verifier_execution_receipt_sha256 = hash(bytes);
  }
  await writeFile(
    path.join(fixture.candidateDirectory, "candidate-manifest.json"),
    JSON.stringify(fixture.candidateManifest),
    { mode: 0o600 },
  );
}

async function rewriteExactResult(fixture, value) {
  const bytes = Buffer.isBuffer(value) ? value : jsonBytes(value);
  const response = JSON.parse(bytes.toString("utf8"));
  await rewriteBinaryArtifact(fixture, "result-exact.bin", bytes);
  await rewriteArtifact(fixture, "worker-verification.json", response);
  await rewriteArtifact(fixture, "result.json", response.result);
  await rewriteArtifact(fixture, "consume-receipt.json", response.consume_receipt);
}

function trustContext() {
  return {
    verifierIdentityKeyRegistry: {},
    trustedRuntimeIdentity: {},
    expectedJobId: "job-1",
    expectedVerificationAttemptId: "attempt-1",
    sessionAuthority: {},
    bindingAuthority: {},
    resultAuthority: {},
    deploymentManifest: { target: { server_identity: "verified.example.test" } },
    profileSha256: "profile-hash",
    notaryRegistry: {},
  };
}

test("finalizer rejects incomplete candidate captures before verification", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-incomplete-"));
  const candidateDirectory = path.join(root, "candidate");
  await mkdir(candidateDirectory, { mode: 0o700 });
  const { manifest } = await writeCandidate(candidateDirectory);
  manifest.candidate_status = "INCOMPLETE_MISSING_EXECUTION_RECEIPT";
  await writeFile(
    path.join(candidateDirectory, "candidate-manifest.json"),
    JSON.stringify(manifest),
    { mode: 0o600 },
  );

  try {
    await assert.rejects(
      finalizeTlsnCandidateBundle({ candidateDirectory, trustContext: trustContext() }),
      /candidate manifest scope or status is invalid/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real captures reject custom Origin trust anchors", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-web-pki-"));
  const candidateDirectory = path.join(root, "candidate");
  await mkdir(candidateDirectory, { mode: 0o700 });
  await writeCandidate(candidateDirectory, { syntheticFixture: false });

  try {
    await assert.rejects(
      finalizeTlsnCandidateBundle({
        candidateDirectory,
        trustContext: { ...trustContext(), trustAnchorDer: "custom-root" },
      }),
      /custom Origin trust anchors are allowed only for synthetic fixtures/,
    );
    await assert.rejects(
      verifyCanaryExistingSourceProofBundle({ syntheticFixture: false, trustAnchorDer: "custom-root" }),
      /custom Origin trust anchors are allowed only for synthetic fixtures/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer rejects a tampered artifact before offline verification", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-tamper-"));
  const candidateDirectory = path.join(root, "candidate");
  await mkdir(candidateDirectory, { mode: 0o700 });
  await writeCandidate(candidateDirectory);
  await writeFile(path.join(candidateDirectory, "presentation.bin"), "tampered");

  try {
    await assert.rejects(
      finalizeTlsnCandidateBundle({ candidateDirectory, trustContext: trustContext() }),
      /artifact integrity mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer rejects unexpected trust-context fields", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-trust-"));
  const candidateDirectory = path.join(root, "candidate");
  await mkdir(candidateDirectory, { mode: 0o700 });
  await writeCandidate(candidateDirectory);
  const untrustedContext = { ...trustContext(), unexpected: "not-accepted" };

  try {
    await assert.rejects(
      finalizeTlsnCandidateBundle({ candidateDirectory, trustContext: untrustedContext }),
      /fields are incomplete or unexpected/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer rejects absent synthetic classification and provenance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-no-provenance-"));
  const candidateDirectory = path.join(root, "candidate");
  await mkdir(candidateDirectory, { mode: 0o700 });
  const { manifest } = await writeCandidate(candidateDirectory);
  delete manifest.synthetic_fixture;
  delete manifest.capture_provenance;
  await writeFile(path.join(candidateDirectory, "candidate-manifest.json"), JSON.stringify(manifest), { mode: 0o600 });

  try {
    await assert.rejects(
      finalizeTlsnCandidateBundle({ candidateDirectory, trustContext: trustContext() }),
      /synthetic fixture classification is invalid/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer rejects downgrading a synthetic manifest without changing its provenance artifact", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-provenance-downgrade-"));
  const candidateDirectory = path.join(root, "candidate");
  await mkdir(candidateDirectory, { mode: 0o700 });
  const { manifest } = await writeCandidate(candidateDirectory);
  manifest.synthetic_fixture = false;
  manifest.capture_provenance = "production-proxy-capture";
  await writeFile(path.join(candidateDirectory, "candidate-manifest.json"), JSON.stringify(manifest), { mode: 0o600 });

  try {
    await assert.rejects(
      finalizeTlsnCandidateBundle({ candidateDirectory, trustContext: trustContext() }),
      /inconsistent or claim unsupported identity authority/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer requires private regular artifacts and exact bundle inventory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-filesystem-"));
  const candidateDirectory = path.join(root, "candidate");
  await mkdir(candidateDirectory, { mode: 0o700 });
  await writeCandidate(candidateDirectory);

  try {
    await writeFile(path.join(candidateDirectory, "unexpected.txt"), "unexpected", { mode: 0o600 });
    await assert.rejects(
      finalizeTlsnCandidateBundle({ candidateDirectory, trustContext: trustContext() }),
      /candidate directory contains missing or unexpected entries/,
    );
    await rm(path.join(candidateDirectory, "unexpected.txt"));

    if (process.platform !== "win32") {
      await chmod(path.join(candidateDirectory, "presentation.bin"), 0o644);
      await assert.rejects(
        finalizeTlsnCandidateBundle({ candidateDirectory, trustContext: trustContext() }),
        /candidate artifact presentation.bin permissions must be private/,
      );
      await chmod(path.join(candidateDirectory, "presentation.bin"), 0o600);
    }

    if (process.platform !== "win32") {
      const presentationPath = path.join(candidateDirectory, "presentation.bin");
      const externalPresentation = path.join(root, "external-presentation.bin");
      await writeFile(externalPresentation, "outside", { mode: 0o600 });
      await rm(presentationPath);
      await symlink(externalPresentation, presentationPath);
      await assert.rejects(
        finalizeTlsnCandidateBundle({ candidateDirectory, trustContext: trustContext() }),
        /candidate artifact presentation.bin must be a regular file/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer rejects a symbolic-link candidate root", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-root-symlink-"));
  const candidateDirectory = path.join(root, "candidate");
  const candidateAlias = path.join(root, "candidate-alias");
  await mkdir(candidateDirectory, { mode: 0o700 });
  await writeCandidate(candidateDirectory);
  await symlink(candidateDirectory, candidateAlias, "dir");

  try {
    await assert.rejects(
      finalizeTlsnCandidateBundle({ candidateDirectory: candidateAlias, trustContext: trustContext() }),
      /candidate bundle path must be a real directory/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("synthetic alpha.15 Presentation discovers target and finalizes as unapproved", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-positive-"));
  try {
    const fixture = await createSyntheticCandidateBundle(root);
    assert.equal(fixture.trustContext.deploymentManifest.target, undefined);
    const observation = await inspectAlpha15Presentation({
      presentationBytes: fixture.presentationBytes,
      notaryRegistry: fixture.trustContext.notaryRegistry,
      notaryKeyId: fixture.trustContext.deploymentManifest.notary.key_id,
      trustAnchorDer: fixture.trustContext.trustAnchorDer,
    });
    assert.equal(observation.source, "verified-alpha15-presentation");
    assert.equal(observation.verified_presentation.server_identity, "game.example.test");
    assert.equal(observation.presentation_sha256, fixture.candidateManifest.presentation_sha256);

    const tamperedPresentation = Buffer.from(fixture.presentationBytes);
    tamperedPresentation[tamperedPresentation.length - 1] ^= 1;
    await assert.rejects(() => inspectAlpha15Presentation({
      presentationBytes: tamperedPresentation,
      notaryRegistry: fixture.trustContext.notaryRegistry,
      notaryKeyId: fixture.trustContext.deploymentManifest.notary.key_id,
      trustAnchorDer: fixture.trustContext.trustAnchorDer,
    }), /alpha\.15 Presentation cryptographic inspection failed/);

    const finalization = await finalizeTlsnCandidateBundle(fixture);
    assert.equal(finalization.status, "OBSERVED_UNAPPROVED");
    assert.equal(finalization.approval_status, "UNAPPROVED");
    assert.equal(finalization.proof_bundle_status, "PASS_LIMITED");
    assert.equal(finalization.target_identity.source, "verified-alpha15-presentation");
    assert.equal(finalization.target_identity.server_identity, "game.example.test");
    assert.equal(finalization.target_identity.presentation_sha256, fixture.candidateManifest.presentation_sha256);
    assert.equal(finalization.human_play_provenance, "UNVERIFIED");
    assert.equal(finalization.synthetic_fixture_status, "DECLARED_SYNTHETIC_FIXTURE");
    assert.equal(finalization.verification.evidence.synthetic, true);
    assert.equal(finalization.verification.evidence.synthetic_classification, "DECLARED_SYNTHETIC_FIXTURE");
    assert.equal(finalization.readiness_effect, "NONE");
    assert.equal(finalization.candidate_artifact_identity.binding_status, "CRYPTOGRAPHICALLY_BOUND");
    assert.equal(finalization.candidate_artifact_identity.authority_status, "LOCAL_CONSISTENCY");
    assert.equal(finalization.candidate_artifact_identity.independent_authentication, "UNVERIFIED");
    assert.equal(finalization.gameplay_effect, "NONE");
    assert.equal(finalization.verification.readiness_effect, "NONE");
    assert.equal(finalization.verification.gameplay_effect, "NONE");
    assert.equal(finalization.verification.components.Presentation.status, "PASS");
    assert.equal(finalization.verification.components.device_identity_ownership.status, "UNVERIFIED");
    assert.equal(finalization.target_identity.server_identity, "game.example.test");
    console.log("[tlsn-candidate-finalize:synthetic-alpha15] cryptographic discovery and offline finalizer PASS; not real gameplay evidence");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer accepts an independently declared matching target", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-target-match-"));
  try {
    const fixture = await createSyntheticCandidateBundle(root);
    const trustContext = {
      ...fixture.trustContext,
      deploymentManifest: {
        ...fixture.trustContext.deploymentManifest,
        target: { server_identity: "game.example.test" },
      },
    };
    const finalization = await finalizeTlsnCandidateBundle({
      candidateDirectory: fixture.candidateDirectory,
      trustContext,
    });
    assert.equal(finalization.target_identity.server_identity, "game.example.test");
    assert.equal(finalization.status, "OBSERVED_UNAPPROVED");
    assert.equal(finalization.readiness_effect, "NONE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("metadata and authority-shaped identity fields cannot upgrade provenance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-spoofed-metadata-"));
  try {
    const fixture = await createSyntheticCandidateBundle(root);
    const originalMetadataBytes = await readFile(path.join(fixture.candidateDirectory, "metadata.json"));
    const identityBytes = await readFile(path.join(fixture.candidateDirectory, "device-identity.json"));
    const identity = JSON.parse(identityBytes.toString("utf8"));
    await rewriteArtifact(fixture, "device-identity.json", {
      ...identity,
      authority_state: "AUTHORITATIVE",
    });
    await assert.rejects(
      finalizeTlsnCandidateBundle(fixture),
      /inconsistent or claim unsupported identity authority/,
    );

    await rewriteArtifact(fixture, "device-identity.json", {
      ...identity,
      authoritative: true,
      authority: "fusou-web-user-devices",
      revoked_at: null,
    });
    const originalMetadata = JSON.parse(originalMetadataBytes.toString("utf8"));
    await assert.rejects(
      rewriteArtifact(fixture, "metadata.json", { ...originalMetadata, server_identity: "game.example.test" })
        .then(() => finalizeTlsnCandidateBundle(fixture)),
      /candidate artifact identity does not match its exact bytes or capture context/,
    );
    await rewriteArtifact(
      fixture,
      "metadata.json",
      JSON.parse(originalMetadataBytes.toString("utf8")),
    );

    const finalization = await finalizeTlsnCandidateBundle(fixture);
    assert.equal(finalization.target_identity.server_identity, "game.example.test");
    assert.equal(finalization.verification.components.device_identity_ownership.status, "UNVERIFIED");
    assert.equal(finalization.human_play_provenance, "UNVERIFIED");
    assert.equal(finalization.synthetic_fixture_status, "DECLARED_SYNTHETIC_FIXTURE");

    const finalizationPath = path.join(fixture.candidateDirectory, "candidate-finalization.json");
    const originalFinalizationBytes = await readFile(finalizationPath);
    await assert.rejects(finalizeTlsnCandidateBundle(fixture), { code: "EEXIST" });
    assert.deepEqual(await readFile(finalizationPath), originalFinalizationBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate identity rejects metadata, fingerprint, request, and binding tampering after outer hashes refresh", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-identity-tamper-"));
  try {
    const fixture = await createSyntheticCandidateBundle(root);
    const metadataBytes = await readFile(path.join(fixture.candidateDirectory, "metadata.json"));
    const originalMetadata = JSON.parse(metadataBytes.toString("utf8"));
    const mutations = [
      (metadata) => ({ ...metadata, capture_timestamp: "2030-01-01T00:00:00.000Z" }),
      (metadata) => ({ ...metadata, request_id: "replayed-request" }),
      (metadata) => ({ ...metadata, session_id: "replayed-session" }),
      (metadata) => ({ ...metadata, binding_identifier: hash(Buffer.from("other-binding")) }),
      (metadata) => ({
        ...metadata,
        proxy_provenance: {
          ...metadata.proxy_provenance,
          app_public_configuration_fingerprints: {
            ...metadata.proxy_provenance.app_public_configuration_fingerprints,
            combined_sha256: hash(Buffer.from("substituted configuration")),
          },
        },
      }),
    ];
    for (const mutate of mutations) {
      await rewriteArtifact(fixture, "metadata.json", mutate(originalMetadata));
      await assert.rejects(
        finalizeTlsnCandidateBundle(fixture),
        /candidate artifact identity does not match its exact bytes or capture context/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate identity rejects metadata replayed from a different Presentation bundle", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-identity-frankenstein-"));
  try {
    const fixture = await createSyntheticCandidateBundle(root);
    const originalMetadata = JSON.parse(
      (await readFile(path.join(fixture.candidateDirectory, "metadata.json"))).toString("utf8"),
    );
    const foreignPresentationBytes = Buffer.from("different Presentation bytes");
    const foreignMetadata = {
      ...originalMetadata,
      candidate_capture_id: "foreign-capture-id",
      presentation_sha256: hash(foreignPresentationBytes),
    };
    const foreignMetadataBytes = Buffer.from(canonicalJson(foreignMetadata), "utf8");
    const foreignIdentity = createCandidateArtifactIdentity({
      metadataBytes: foreignMetadataBytes,
      presentationBytes: foreignPresentationBytes,
    });
    await rewriteArtifact(fixture, "metadata.json", foreignMetadata);
    await rewriteArtifact(fixture, "candidate-identity.json", foreignIdentity);
    fixture.candidateManifest.candidate_artifact_id = foreignIdentity.candidate_artifact_id;
    await writeFile(
      path.join(fixture.candidateDirectory, "candidate-manifest.json"),
      JSON.stringify(fixture.candidateManifest),
      { mode: 0o600 },
    );

    await assert.rejects(
      finalizeTlsnCandidateBundle(fixture),
      /candidate metadata Presentation digest does not match exact bytes/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer rejects a discovered identity that conflicts with a declared target", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-target-mismatch-"));
  try {
    const fixture = await createSyntheticCandidateBundle(root);
    const trustContext = {
      ...fixture.trustContext,
      deploymentManifest: {
        ...fixture.trustContext.deploymentManifest,
        target: { server_identity: "forged-config.invalid" },
      },
    };
    await assert.rejects(
      finalizeTlsnCandidateBundle({ candidateDirectory: fixture.candidateDirectory, trustContext }),
      /Presentation-derived server identity does not match the declared target identity/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer detects outer Result byte mutation against the execution receipt", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-result-mutation-"));
  try {
    const fixture = await createSyntheticCandidateBundle(root);
    const manifestPath = path.join(fixture.candidateDirectory, "candidate-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const mutatedResult = Buffer.concat([fixture.resultBytes, Buffer.from(" ")]);
    await writeFile(path.join(fixture.candidateDirectory, "result-exact.bin"), mutatedResult, { mode: 0o600 });
    manifest.exact_result_sha256 = hash(mutatedResult);
    manifest.artifacts["result-exact.bin"] = {
      size_bytes: mutatedResult.length,
      sha256: hash(mutatedResult),
    };
    await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });

    await assert.rejects(
      finalizeTlsnCandidateBundle(fixture),
      /Verifier execution receipt Result hash mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer rejects outer Result field mutations after all local hashes are refreshed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-result-fields-"));
  try {
    const fixture = await createSyntheticCandidateBundle(root);
    const originalResponse = JSON.parse(fixture.resultBytes.toString("utf8"));
    const mutations = [
      {
        mutate: (response) => { response.verified = false; },
        message: /exact Result response signature metadata is invalid/,
      },
      {
        mutate: (response) => { response.signer_key_id = "substituted-signer"; },
        message: /exact Result response signer key ID does not match/,
      },
      {
        mutate: (response) => { response.unbound_outer_claim = "changed"; },
        message: /Verifier execution receipt Result hash mismatch/,
      },
    ];

    for (const mutation of mutations) {
      const response = structuredClone(originalResponse);
      mutation.mutate(response);
      await rewriteExactResult(fixture, response);
      await assert.rejects(finalizeTlsnCandidateBundle(fixture), mutation.message);
      await rewriteExactResult(fixture, fixture.resultBytes);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer rejects inner Result and detached receipt byte mutations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-signed-bytes-"));
  try {
    const fixture = await createSyntheticCandidateBundle(root);
    const response = JSON.parse(fixture.resultBytes.toString("utf8"));
    response.result.verified_member_id = "mutated-member-id";
    await rewriteExactResult(fixture, response);
    await assert.rejects(
      finalizeTlsnCandidateBundle(fixture),
      /production verifier result signature is invalid/,
    );

    await rewriteExactResult(fixture, fixture.resultBytes);
    const receiptPath = path.join(fixture.candidateDirectory, "verifier-execution-receipt.bin");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt.signature_base64url = `${receipt.signature_base64url[0] === "A" ? "B" : "A"}${receipt.signature_base64url.slice(1)}`;
    const receiptBytes = jsonBytes(receipt);
    await rewriteBinaryArtifact(fixture, "verifier-execution-receipt.bin", receiptBytes);
    await rewriteBinaryArtifact(
      fixture,
      "verifier-execution-receipt-header.txt",
      Buffer.from(receiptBytes.toString("base64url"), "ascii"),
    );
    await assert.rejects(finalizeTlsnCandidateBundle(fixture), /Verifier execution receipt signature is invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer rejects detached receipt header and body mismatch after manifest refresh", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-receipt-header-"));
  try {
    const fixture = await createSyntheticCandidateBundle(root);
    const headerPath = path.join(fixture.candidateDirectory, "verifier-execution-receipt-header.txt");
    const header = await readFile(headerPath);
    header[0] = header[0] === 0x41 ? 0x42 : 0x41;
    await rewriteBinaryArtifact(fixture, "verifier-execution-receipt-header.txt", header);
    await assert.rejects(
      finalizeTlsnCandidateBundle(fixture),
      /candidate proof bytes do not match the capture manifest/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer rejects Presentation mutation even when local hashes are recomputed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-presentation-mutation-"));
  try {
    const fixture = await createSyntheticCandidateBundle(root);
    const mutated = Buffer.from(fixture.presentationBytes);
    mutated[mutated.length - 1] ^= 1;
    await rewriteBinaryArtifact(fixture, "presentation.bin", mutated);

    await assert.rejects(
      finalizeTlsnCandidateBundle(fixture),
      /candidate metadata Presentation digest does not match exact bytes/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer rejects Notary key mutation against the Presentation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-notary-mutation-"));
  try {
    const fixture = await createSyntheticCandidateBundle(root);
    const trustContext = {
      ...fixture.trustContext,
      notaryRegistry: {
        ...fixture.trustContext.notaryRegistry,
        [fixture.trustContext.deploymentManifest.notary.key_id]: Buffer.alloc(32, 0x7f).toString("base64url"),
      },
    };

    await assert.rejects(
      finalizeTlsnCandidateBundle({ candidateDirectory: fixture.candidateDirectory, trustContext }),
      /Notary registry does not match the key selected by the validated deployment manifest/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});