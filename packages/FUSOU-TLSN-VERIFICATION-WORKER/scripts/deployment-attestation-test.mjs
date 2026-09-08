#!/usr/bin/env node

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  assertEvidenceContext,
  assertRemoteAttestation,
  assertRemoteReportGate,
  createSignedRemoteAttestation,
} from "./deployment-attestation.mjs";
import { PRODUCTION_EVIDENCE_REQUIREMENTS } from "./production-evidence-contract.mjs";

const { privateKey: signerPrivateKey, publicKey: signerPublicKey } = generateKeyPairSync("ed25519");
const signerPrivateKeyPkcs8 = signerPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const signerPublicKeySpki = signerPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const context = {
  workflow_run_id: "100",
  workflow_run_attempt: "2",
  git_commit_sha: "a".repeat(40),
  repository: "tsukasa-u/FUSOU",
  workflow_file_identity: "tsukasa-u/FUSOU/.github/workflows/tlsn-production-deploy.yml@refs/heads/main",
  deployment_role: "canary",
};
const securityIdentity = {
  git_commit_sha: context.git_commit_sha,
  server_identity: "game.example.com",
  profile_sha256: "A".repeat(43),
  verifier_key_id: "verifier",
  notary_key_id: "notary",
  security_registry_set_sha256: "B".repeat(43),
  notary_registry_sha256: "C".repeat(43),
  binding_authority: "durable-single-use",
};
const canaryProvenance = {
  schema_version: 2,
  scope: "tlsn-deployment-provenance",
  status: "PASS",
  environment: "production",
  created_at: "2026-09-08T00:00:00.000Z",
  ...context,
  security_identity: securityIdentity,
  deployment_identity: {
    deployment_id: "canary-deployment",
    deployment_role: "canary",
    binding_mode: "fixed_canary",
    trust_root_certificate_sha256: "D".repeat(43),
    worker_name: "fusou-tlsn-canary",
  },
  result_identity: {
    result_public_key_spki: "canary-result-key",
    result_signer_key_id: "canary-result-2026",
    result_key_registry_sha256: "E".repeat(43),
  },
};
const remoteReport = {
  schema_version: 2,
  scope: "remote-deployed-synthetic",
  created_at: "2026-09-08T00:01:00.000Z",
  validation_started_at: "2026-09-08T00:01:00.000Z",
  validation_finished_at: "2026-09-08T00:02:00.000Z",
  validation_id: "123e4567-e89b-42d3-a456-426614174000",
  ...context,
  worker_origin: "https://canary.example.com",
  summary: { fail: 0, blocking_blocked: 0 },
  checks: { remote_worker_identity: { status: "PASS" } },
  production_evidence: "BLOCKED",
  p0_05: "BLOCKED",
  production_evidence_contract: {
    scope: "tlsn-production-evidence",
    status: "BLOCKED",
    independent_capture_required: true,
    requirements: Object.fromEntries(PRODUCTION_EVIDENCE_REQUIREMENTS.map((field) => [field, "UNVERIFIED"])),
  },
  security_identity: securityIdentity,
  deployment_identity: canaryProvenance.deployment_identity,
  result_identity: canaryProvenance.result_identity,
};
const canaryBytes = Buffer.from(JSON.stringify(canaryProvenance));
const reportBytes = Buffer.from(JSON.stringify(remoteReport));
const attestation = createSignedRemoteAttestation({
  expectedContext: context,
  canaryProvenance,
  remoteReport,
  canaryBytes,
  reportBytes,
  signerKeyId: "remote-attestation-2026",
  signerPublicKeySpki,
  signingPrivateKeyPkcs8: signerPrivateKeyPkcs8,
});

const verificationOptions = {
  expectedSignerKeyId: "remote-attestation-2026",
  expectedSignerPublicKeySpki: signerPublicKeySpki,
  now: "2026-09-08T00:03:00.000Z",
  maxAgeSeconds: 300,
};

function assertAttestation(value, expected = context, provenance = canaryProvenance, report = remoteReport, provenanceBytes = canaryBytes, validationReportBytes = reportBytes, options = verificationOptions) {
  return assertRemoteAttestation(value, expected, provenance, report, provenanceBytes, validationReportBytes, options);
}

assertAttestation(attestation);
assertEvidenceContext(attestation, context, "base attestation");

function rejects(label, action) {
  assert.throws(action, undefined, label);
}

for (const field of ["workflow_run_id", "workflow_run_attempt", "git_commit_sha", "repository", "workflow_file_identity"]) {
  rejects(`different ${field}`, () => assertAttestation(
    attestation,
    {
      ...context,
      [field]: field === "git_commit_sha"
        ? "b".repeat(40)
        : field === "repository"
          ? "other/repository"
          : field === "workflow_file_identity"
            ? "other/repository/.github/workflows/other.yml@refs/heads/main"
            : "999",
    },
    canaryProvenance,
    remoteReport,
    canaryBytes,
    reportBytes,
  ));
}
rejects("old remote report replay", () => assertAttestation(attestation, context, canaryProvenance, remoteReport, canaryBytes, Buffer.from("old-report")));
rejects("old canary provenance replay", () => assertAttestation(attestation, context, canaryProvenance, remoteReport, Buffer.from("old-provenance"), reportBytes));
rejects("tampered remote report", () => assertAttestation(attestation, context, canaryProvenance, remoteReport, canaryBytes, Buffer.from(`${reportBytes}x`)));
rejects("tampered canary provenance", () => assertAttestation(attestation, context, canaryProvenance, remoteReport, Buffer.from(`${canaryBytes}x`), reportBytes));
rejects("different validation_id", () => assertAttestation({ ...attestation, validation_id: "123e4567-e89b-42d3-a456-426614174001" }));
rejects("missing hash", () => assertAttestation({ ...attestation, remote_report_sha256: undefined }));
rejects("wrong hash", () => assertAttestation({ ...attestation, remote_report_sha256: "wrong" }));
rejects("different security identity", () => assertAttestation(attestation, context, canaryProvenance, { ...remoteReport, security_identity: { ...securityIdentity, verifier_key_id: "other" } }));
rejects("wrong deployment role", () => assertAttestation({ ...attestation, deployment_role: "production" }));
rejects("production provenance used as canary", () => assertAttestation(attestation, context, { ...canaryProvenance, deployment_role: "production", deployment_identity: { ...canaryProvenance.deployment_identity, deployment_role: "production" } }));
rejects("signature mutation", () => assertAttestation({
  ...attestation,
  signature_base64url: `${attestation.signature_base64url[0] === "A" ? "B" : "A"}${attestation.signature_base64url.slice(1)}`,
}));
rejects("payload mutation", () => assertAttestation({ ...attestation, status: "FAIL" }));
rejects("signer key ID mutation", () => assertAttestation({ ...attestation, attestation_signer_key_id: "other-signer" }));
rejects("signature algorithm mutation", () => assertAttestation({ ...attestation, signature_algorithm: "RSA-SHA256" }));
rejects("truncated signature", () => assertAttestation({ ...attestation, signature_base64url: attestation.signature_base64url.slice(0, -4) }));
rejects("wrong public key", () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  assertAttestation(attestation, context, canaryProvenance, remoteReport, canaryBytes, reportBytes, {
    ...verificationOptions,
    expectedSignerPublicKeySpki: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  });
});
rejects("stale attestation", () => assertRemoteAttestation(attestation, context, canaryProvenance, remoteReport, canaryBytes, reportBytes, {
  ...verificationOptions,
  now: "2026-09-08T01:00:00.000Z",
}));
rejects("future timestamp", () => assertRemoteAttestation(attestation, context, canaryProvenance, remoteReport, canaryBytes, reportBytes, {
  ...verificationOptions,
  now: "2026-09-08T00:01:30.000Z",
}));
rejects("old attestation from another workflow run", () => assertAttestation(attestation, { ...context, workflow_run_id: "101" }));
rejects("production evidence must remain blocked", () => assertRemoteReportGate({ ...remoteReport, production_evidence: "PASS" }));
rejects("P0-05 must remain blocked", () => assertRemoteReportGate({ ...remoteReport, p0_05: "PASS" }));
rejects("missing report hash is not accepted", () => assertRemoteAttestation({ ...attestation, remote_report_sha256: null }, context, canaryProvenance, remoteReport, canaryBytes, reportBytes));

console.log("[tlsn-deployment-attestation] replay, substitution, hash, identity, role, and blocked-status rejection matrix OK");