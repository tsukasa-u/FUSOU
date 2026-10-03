import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { canonicalJson } from "./deployment-attestation.mjs";
import {
  APP_CONFIGURATION_FINGERPRINT_CONTRACT,
  appConfigurationProjectionSha256,
  assertCandidateArtifactIdentity,
  createCandidateArtifactIdentity,
  recomputeAppConfigurationCombinedSha256,
} from "./candidate-artifact-identity.mjs";
import { candidateConfigurationBindingAssessment } from "./candidate-configuration-binding.mjs";
import { assessCandidateConfigurationBindingInputs } from "./candidate-configuration-binding-inputs.mjs";
import { createSyntheticCandidateBundle } from "./tlsn-candidate-synthetic-fixture.mjs";
import { buildReadinessReport } from "./canary-readiness-test.mjs";

const vector = APP_CONFIGURATION_FINGERPRINT_CONTRACT.test_vector;
const now = new Date("2026-10-03T12:00:00.000Z");
const hash = (bytes) => createHash("sha256").update(bytes).digest("base64url");
const signature = () => Buffer.alloc(64, 7).toString("base64url");

function fingerprintFor(deploymentId = "contract-test-deployment") {
  const compileTimeFields = {
    ...vector.compile_time_fields,
    expected_deployment_id: deploymentId,
  };
  const compileTimeSha256 = appConfigurationProjectionSha256("compile_time", compileTimeFields);
  const combinedSha256 = recomputeAppConfigurationCombinedSha256({
    schema_version: APP_CONFIGURATION_FINGERPRINT_CONTRACT.schema_version,
    scope: APP_CONFIGURATION_FINGERPRINT_CONTRACT.scope,
    compile_time_sha256: compileTimeSha256,
    runtime_sha256: vector.runtime_sha256,
  });
  return {
    schema_version: APP_CONFIGURATION_FINGERPRINT_CONTRACT.schema_version,
    scope: APP_CONFIGURATION_FINGERPRINT_CONTRACT.scope,
    compile_time_sha256: compileTimeSha256,
    runtime_sha256: vector.runtime_sha256,
    combined_sha256: combinedSha256,
    candidate_binding_status: "UNBOUND",
  };
}

function createVerifiedCandidate({
  captureId = "capture-A",
  sessionId = "session-A",
  requestId = "request-A",
  requestSha256 = hash(Buffer.from("request-A")),
  authenticatedRequestSha256 = hash(Buffer.from("authenticated-request-A")),
  bindingIdentifier = hash(Buffer.from("binding-A")),
  fingerprint = fingerprintFor(),
} = {}) {
  const presentationBytes = Buffer.from(`presentation-${captureId}`);
  const metadata = {
    schema_version: 2,
    candidate_capture_id: captureId,
    session_id: sessionId,
    request_id: requestId,
    request_sha256: requestSha256,
    authenticated_request_sha256: authenticatedRequestSha256,
    binding_identifier: bindingIdentifier,
    capture_timestamp: "2030-01-01T00:00:00.000Z",
    presentation_sha256: hash(presentationBytes),
    proxy_provenance: {
      app_public_configuration_fingerprints: fingerprint,
    },
  };
  const metadataBytes = Buffer.from(canonicalJson(metadata), "utf8");
  const identity = createCandidateArtifactIdentity({ metadataBytes, presentationBytes });
  return assertCandidateArtifactIdentity({
    identityBytes: Buffer.from(canonicalJson(identity), "utf8"),
    metadataBytes,
    presentationBytes,
    expectedCandidateArtifactId: identity.candidate_artifact_id,
  });
}

function approvedFingerprint(identity, fingerprint = identity.app_configuration, overrides = {}) {
  return {
    schema_version: 1,
    scope: "fusou-tlsn-approved-expected-app-configuration-fingerprint",
    combined_sha256: fingerprint.combined_sha256,
    approval_id: "approval-A",
    candidate_artifact_id: identity.candidate_artifact_id,
    candidate_capture_id: identity.candidate_capture_id,
    valid_from: "2026-10-01T00:00:00.000Z",
    valid_until: "2026-10-05T00:00:00.000Z",
    provenance_source: "offline-authority-export",
    evidence_sha256: hash(Buffer.from("approval-evidence-A")),
    authority_identity: { authority_id: "config-authority", key_id: "config-key-1" },
    signature: { algorithm: "Ed25519", key_id: "config-key-1", value: signature() },
    ...overrides,
  };
}

function currentBinaryIdentity({
  digest = hash(Buffer.from("binary-A")),
  commit = "a".repeat(40),
  artifactIdentity = "app-artifact-A",
} = {}) {
  return {
    schema_version: 1,
    scope: "fusou-tlsn-current-binary-identity",
    artifact_identity: artifactIdentity,
    binary_sha256: digest,
    source_commit: commit,
    provenance_source: "offline-binary-inspection",
    evidence_sha256: hash(Buffer.from("binary-evidence-A")),
  };
}

function builderReceipt(identity, binary, overrides = {}) {
  return {
    schema_version: 1,
    scope: "fusou-tlsn-trusted-builder-provenance",
    candidate_artifact_id: identity.candidate_artifact_id,
    artifact_identity: binary.artifact_identity,
    binary_sha256: binary.binary_sha256,
    source_commit: binary.source_commit,
    build_workflow_identity: "owner/FUSOU/.github/workflows/release.yml@main",
    toolchain_identity: "rust-1.95.0+locked-node-toolchain",
    builder_identity: "managed-build-service-A",
    builder_signing_key_id: "builder-key-1",
    valid_from: "2026-10-01T00:00:00.000Z",
    valid_until: "2026-10-05T00:00:00.000Z",
    evidence_sha256: hash(Buffer.from("builder-evidence-A")),
    signature: { algorithm: "Ed25519", key_id: "builder-key-1", value: signature() },
    ...overrides,
  };
}

const deploymentIdentity = {
  deployment_id: "main-deployment-A",
  worker_name: "fusou-tlsn-verification-canary",
  git_commit_sha: "a".repeat(40),
};

function authorityReceipt(identity, binary, overrides = {}) {
  return {
    schema_version: 1,
    scope: "fusou-tlsn-independent-candidate-configuration-authority-receipt",
    candidate_artifact_id: identity.candidate_artifact_id,
    app_configuration_fingerprint: identity.app_configuration,
    binary_sha256: binary.binary_sha256,
    deployment_identity: deploymentIdentity,
    capture_identity: {
      candidate_capture_id: identity.candidate_capture_id,
      session_id: identity.session_id,
      request_id: identity.request_id,
      request_sha256: identity.request_sha256,
      authenticated_request_sha256: identity.authenticated_request_sha256,
      binding_identifier: identity.binding_identifier,
    },
    authority_identity: { authority_id: "independent-authority-A", key_id: "authority-key-1" },
    issued_at: "2026-10-03T11:00:00.000Z",
    expires_at: "2026-10-04T11:00:00.000Z",
    evidence_sha256: hash(Buffer.from("authority-evidence-A")),
    signature: { algorithm: "Ed25519", key_id: "authority-key-1", value: signature() },
    ...overrides,
  };
}

test("empty assessment is UNVERIFIED with all authority gates blocked", () => {
  const report = candidateConfigurationBindingAssessment({ now });
  assert.equal(report.status, "UNVERIFIED");
  assert.equal(report.stages.candidate_fingerprint_present, "NOT_EVALUATED");
  assert.equal(report.stages.candidate_artifact_cryptographically_bound, "NOT_EVALUATED");
  assert.equal(report.stages.approved_expected_fingerprint_match, "BLOCKED_MISSING_INPUT");
  assert.equal(report.stages.binary_provenance_authenticated, "BLOCKED_NO_TRUSTED_BUILDER");
  assert.equal(report.stages.independent_authority_provenance_verified, "BLOCKED_MISSING_AUTHORITY");
  assert.equal(report.readiness_effect, "NONE");
  assert.equal(report.gameplay_effect, "NONE");
});

test("verified identity reports local consistency without promoting configuration authority", () => {
  const identity = createVerifiedCandidate();
  const report = candidateConfigurationBindingAssessment({ candidateArtifactIdentity: identity, now });
  assert.equal(report.status, "UNVERIFIED");
  assert.equal(report.candidate_artifact_identity.status, "PASS_LOCAL_CONSISTENCY");
  assert.equal(report.candidate_artifact_identity.authority_status, "LOCAL_CONSISTENCY");
  assert.equal(report.candidate_artifact_identity.independent_authentication, "UNVERIFIED");
  assert.equal(report.stages.candidate_artifact_cryptographically_bound, "PASS_LOCAL_CONSISTENCY");
  assert.equal(report.stages.approved_expected_fingerprint_match, "BLOCKED_MISSING_INPUT");
  assert.equal(report.stages.binary_provenance_authenticated, "BLOCKED_NO_TRUSTED_BUILDER");
  assert.equal(report.stages.independent_authority_provenance_verified, "BLOCKED_MISSING_AUTHORITY");
});

test("actual candidate bundle input reports synthetic local consistency but cannot clear readiness", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-candidate-binding-input-"));
  try {
    const fixture = await createSyntheticCandidateBundle(root);
    const report = await assessCandidateConfigurationBindingInputs({
      environment: { TLSN_CANDIDATE_ARTIFACT_BUNDLE_PATH: fixture.candidateDirectory },
      now,
    });
    assert.equal(report.input_sources.candidate_artifact_bundle, "PASS_SYNTHETIC_LOCAL_CONSISTENCY");
    assert.equal(report.candidate_artifact_identity.status, "PASS_SYNTHETIC_LOCAL_CONSISTENCY");
    assert.equal(report.status, "UNVERIFIED");
    assert.equal(report.stages.approved_expected_fingerprint_match, "BLOCKED_MISSING_INPUT");
    assert.equal(report.stages.binary_provenance_authenticated, "BLOCKED_NO_TRUSTED_BUILDER");
    assert.equal(report.stages.independent_authority_provenance_verified, "BLOCKED_MISSING_AUTHORITY");
    assert.equal(report.readiness_effect, "NONE");
    assert.equal(report.gameplay_effect, "NONE");

    const readiness = await buildReadinessReport({
      environment: { TLSN_CANDIDATE_ARTIFACT_BUNDLE_PATH: fixture.candidateDirectory },
      expectedHead: "a".repeat(40),
      artifactPaths: [],
      now,
    });
    assert.equal(readiness.status, "BLOCKED");
    assert.equal(readiness.gates.candidate_configuration_binding, false);
    assert.equal(readiness.inputs.candidate_configuration_binding.status, "UNVERIFIED");
    assert.equal(
      readiness.inputs.candidate_configuration_binding.candidate_artifact_identity.status,
      "PASS_SYNTHETIC_LOCAL_CONSISTENCY",
    );
    assert.equal(readiness.inputs.candidate_configuration_binding.readiness_gate, "BLOCKED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("schema-valid matching external evidence remains unverified without authority verifiers", () => {
  const identity = createVerifiedCandidate();
  const binary = currentBinaryIdentity();
  const report = candidateConfigurationBindingAssessment({
    candidateArtifactIdentity: identity,
    approvedExpectedConfigurationFingerprint: approvedFingerprint(identity),
    currentBinaryIdentity: binary,
    trustedBuilderProvenance: builderReceipt(identity, binary),
    independentAuthorityReceipt: authorityReceipt(identity, binary),
    expectedSourceCommit: binary.source_commit,
    expectedDeploymentIdentity: deploymentIdentity,
    now,
  });
  assert.equal(report.status, "UNVERIFIED");
  assert.equal(report.stages.approved_expected_fingerprint_match, "MATCH_UNVERIFIED");
  assert.equal(report.approved_expected_fingerprint.signature_verification, "NOT_IMPLEMENTED");
  assert.equal(report.current_binary_identity.source_authentication, "UNVERIFIED");
  assert.equal(report.trusted_builder_provenance.status, "PRESENT_UNVERIFIED");
  assert.equal(report.stages.binary_provenance_authenticated, "BLOCKED_NO_TRUSTED_BUILDER");
  assert.equal(report.independent_authority_receipt.status, "PRESENT_UNVERIFIED");
  assert.equal(report.stages.independent_authority_provenance_verified, "BLOCKED_MISSING_AUTHORITY");
});

test("authority receipt remains blocked without an independent deployment identity", () => {
  const identity = createVerifiedCandidate();
  const binary = currentBinaryIdentity();
  const report = candidateConfigurationBindingAssessment({
    candidateArtifactIdentity: identity,
    currentBinaryIdentity: binary,
    independentAuthorityReceipt: authorityReceipt(identity, binary),
    now,
  });
  assert.equal(report.independent_authority_receipt.status, "BLOCKED_NO_TRUSTED_DEPLOYMENT_IDENTITY");
  assert.equal(report.stages.independent_authority_provenance_verified, "BLOCKED_MISSING_AUTHORITY");
  assert.ok(report.unresolved_authority_requirements.includes("AUTHENTICATED_CURRENT_DEPLOYMENT_IDENTITY_SOURCE"));
});

test("signature key IDs must match their declared authority or builder identity", () => {
  const identity = createVerifiedCandidate();
  const binary = currentBinaryIdentity();

  const approved = candidateConfigurationBindingAssessment({
    candidateArtifactIdentity: identity,
    approvedExpectedConfigurationFingerprint: approvedFingerprint(identity, identity.app_configuration, {
      signature: { algorithm: "Ed25519", key_id: "different-key", value: signature() },
    }),
    now,
  });
  assert.equal(approved.approved_expected_fingerprint.status, "INVALID");

  const builder = candidateConfigurationBindingAssessment({
    candidateArtifactIdentity: identity,
    currentBinaryIdentity: binary,
    trustedBuilderProvenance: builderReceipt(identity, binary, {
      signature: { algorithm: "Ed25519", key_id: "different-key", value: signature() },
    }),
    now,
  });
  assert.equal(builder.trusted_builder_provenance.status, "INVALID");

  const authority = candidateConfigurationBindingAssessment({
    candidateArtifactIdentity: identity,
    currentBinaryIdentity: binary,
    independentAuthorityReceipt: authorityReceipt(identity, binary, {
      signature: { algorithm: "Ed25519", key_id: "different-key", value: signature() },
    }),
    now,
  });
  assert.equal(authority.independent_authority_receipt.status, "INVALID");
});

test("candidate, approval, builder, binary, and authority Frankensteins are rejected", async (t) => {
  const identityA = createVerifiedCandidate();
  const identityB = createVerifiedCandidate({
    captureId: "capture-B",
    sessionId: "session-B",
    requestId: "request-B",
    bindingIdentifier: hash(Buffer.from("binding-B")),
    fingerprint: fingerprintFor("new-config-B"),
  });
  const binaryA = currentBinaryIdentity();
  const binaryB = currentBinaryIdentity({ digest: hash(Buffer.from("binary-B")), commit: "b".repeat(40) });

  await t.test("fingerprint A plus approval B", () => {
    const report = candidateConfigurationBindingAssessment({
      candidateArtifactIdentity: identityA,
      approvedExpectedConfigurationFingerprint: approvedFingerprint(identityA, identityB.app_configuration),
      now,
    });
    assert.equal(report.stages.approved_expected_fingerprint_match, "MISMATCH");
  });

  await t.test("stale approval for capture A plus new capture B", () => {
    const report = candidateConfigurationBindingAssessment({
      candidateArtifactIdentity: identityB,
      approvedExpectedConfigurationFingerprint: approvedFingerprint(identityA),
      now,
    });
    assert.equal(report.stages.approved_expected_fingerprint_match, "MISMATCH");
  });

  await t.test("builder provenance A plus candidate B", () => {
    const report = candidateConfigurationBindingAssessment({
      candidateArtifactIdentity: identityB,
      currentBinaryIdentity: binaryA,
      trustedBuilderProvenance: builderReceipt(identityA, binaryA),
      now,
    });
    assert.equal(report.trusted_builder_provenance.status, "MISMATCH");
  });

  await t.test("old builder receipt plus new binary", () => {
    const report = candidateConfigurationBindingAssessment({
      candidateArtifactIdentity: identityA,
      currentBinaryIdentity: binaryB,
      trustedBuilderProvenance: builderReceipt(identityA, binaryA),
      expectedSourceCommit: binaryB.source_commit,
      now,
    });
    assert.equal(report.trusted_builder_provenance.status, "MISMATCH");
  });

  await t.test("builder receipt for artifact A plus binary artifact B", () => {
    const binaryWithNewArtifact = currentBinaryIdentity({ artifactIdentity: "app-artifact-B" });
    const report = candidateConfigurationBindingAssessment({
      candidateArtifactIdentity: identityA,
      currentBinaryIdentity: binaryWithNewArtifact,
      trustedBuilderProvenance: builderReceipt(identityA, binaryA),
      now,
    });
    assert.equal(report.trusted_builder_provenance.status, "MISMATCH");
  });

  await t.test("new binary plus old expected fingerprint", () => {
    const report = candidateConfigurationBindingAssessment({
      candidateArtifactIdentity: identityB,
      approvedExpectedConfigurationFingerprint: approvedFingerprint(identityA),
      currentBinaryIdentity: binaryB,
      now,
    });
    assert.equal(report.approved_expected_fingerprint.status, "MISMATCH");
  });

  await t.test("authority receipt A plus candidate B", () => {
    const report = candidateConfigurationBindingAssessment({
      candidateArtifactIdentity: identityB,
      currentBinaryIdentity: binaryB,
      independentAuthorityReceipt: authorityReceipt(identityA, binaryA),
      expectedDeploymentIdentity: deploymentIdentity,
      now,
    });
    assert.equal(report.independent_authority_receipt.status, "MISMATCH");
  });

  await t.test("authority receipt for deployment A plus expected deployment B", () => {
    const report = candidateConfigurationBindingAssessment({
      candidateArtifactIdentity: identityA,
      currentBinaryIdentity: binaryA,
      independentAuthorityReceipt: authorityReceipt(identityA, binaryA),
      expectedDeploymentIdentity: {
        ...deploymentIdentity,
        deployment_id: "main-deployment-B",
      },
      now,
    });
    assert.equal(report.independent_authority_receipt.status, "MISMATCH");
  });

  await t.test("request A plus session B in authority receipt", () => {
    const receipt = authorityReceipt(identityA, binaryA);
    receipt.capture_identity.session_id = "session-B";
    const report = candidateConfigurationBindingAssessment({
      candidateArtifactIdentity: identityA,
      currentBinaryIdentity: binaryA,
      independentAuthorityReceipt: receipt,
      expectedDeploymentIdentity: deploymentIdentity,
      now,
    });
    assert.equal(report.independent_authority_receipt.status, "MISMATCH");
  });

  await t.test("session A plus binding B in authority receipt", () => {
    const receipt = authorityReceipt(identityA, binaryA);
    receipt.capture_identity.binding_identifier = hash(Buffer.from("binding-B"));
    const report = candidateConfigurationBindingAssessment({
      candidateArtifactIdentity: identityA,
      currentBinaryIdentity: binaryA,
      independentAuthorityReceipt: receipt,
      expectedDeploymentIdentity: deploymentIdentity,
      now,
    });
    assert.equal(report.independent_authority_receipt.status, "MISMATCH");
  });
});

test("expired approval is not reusable for a later capture", () => {
  const identity = createVerifiedCandidate();
  const report = candidateConfigurationBindingAssessment({
    candidateArtifactIdentity: identity,
    approvedExpectedConfigurationFingerprint: approvedFingerprint(identity, identity.app_configuration, {
      valid_until: "2026-10-02T00:00:00.000Z",
    }),
    now,
  });
  assert.equal(report.stages.approved_expected_fingerprint_match, "EXPIRED");
});

test("operator-shaped local result cannot impersonate identity verifier output", () => {
  const report = candidateConfigurationBindingAssessment({
    candidateArtifactIdentity: {
      candidate_artifact_id: hash(Buffer.from("fake")),
      authority_status: "LOCAL_CONSISTENCY",
      independent_authentication: "UNVERIFIED",
    },
    now,
  });
  assert.equal(report.status, "UNVERIFIED");
  assert.equal(report.candidate_artifact_identity.status, "INVALID");
  assert.equal(report.stages.candidate_artifact_cryptographically_bound, "INVALID");
});