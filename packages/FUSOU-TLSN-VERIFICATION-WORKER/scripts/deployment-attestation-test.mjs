#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  canonicalJson,
  assertEvidenceContext,
  assertProvenanceEvidence,
  assertRemoteAttestation,
  assertRemoteReportGate,
  createSignedRemoteAttestation,
  DEPLOYMENT_PROVENANCE_SCHEMA_VERSION,
} from "./deployment-attestation.mjs";
import { PRODUCTION_SECURITY_IDENTITY_FIELDS } from "./deployment-contract.mjs";
import { PRODUCTION_EVIDENCE_REQUIREMENTS } from "./production-evidence-contract.mjs";
import {
  profileContractArtifact,
  productionProfileContractArtifact,
  profilesForServerIdentity,
  PROFILE_CONTRACT_SPEC,
} from "./profile-canonical-contract.mjs";
import { loadOriginInventoryContract } from "./origin-inventory-contract.mjs";

const { privateKey: signerPrivateKey, publicKey: signerPublicKey } = generateKeyPairSync("ed25519");
const signerPrivateKeyPkcs8 = signerPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const signerPublicKeySpki = signerPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const context = {
  workflow_run_id: "100",
  workflow_run_attempt: "2",
  git_commit_sha: "a".repeat(40),
  repository: "tsukasa-u/FUSOU",
  workflow_file_identity: "dotenvx+pnpm+wrangler",
  deployment_role: "canary",
};
const canaryProfiles = profilesForServerIdentity("game.example.com");
const securityIdentity = {
  git_commit_sha: context.git_commit_sha,
  server_identity: "game.example.com",
  profile_sha256: canaryProfiles.complete.sha256,
  sparse_profile_sha256: canaryProfiles.sparse.sha256,
  verifier_key_id: "verifier",
  notary_key_id: "notary",
  security_registry_set_sha256: "B".repeat(43),
  notary_registry_sha256: "C".repeat(43),
  binding_authority: "durable-single-use",
};
const canaryProvenance = {
  schema_version: DEPLOYMENT_PROVENANCE_SCHEMA_VERSION,
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
    worker_name: "fusou-tlsn-canary",
  },
  result_identity: {
    result_public_key_spki: "canary-result-key",
    result_signer_key_id: "canary-result-2026",
    result_key_registry_sha256: "E".repeat(43),
    result_key_registry_envelope_sha256: "F".repeat(43),
    result_registry_root_key_id: "canary-result-registry-root-2026",
    result_registry_root_public_key_spki: "canary-result-registry-root-key",
  },
  profile_contract: profileContractArtifact({
    serverIdentity: securityIdentity.server_identity,
    profileSha256: securityIdentity.profile_sha256,
    sparseProfileSha256: securityIdentity.sparse_profile_sha256,
  }),
};
const productionSecurityIdentity = {
  git_commit_sha: context.git_commit_sha,
  verifier_key_id: "verifier",
  notary_key_id: "notary",
  notary_registry_sha256: "C".repeat(43),
  binding_authority: "durable-single-use",
  security_registry_set_sha256: "G".repeat(43),
  origin_inventory_sha256: loadOriginInventoryContract().sha256,
  profile_policy_sha256: createHash("sha256").update(canonicalJson(PROFILE_CONTRACT_SPEC), "utf8").digest("base64url"),
};
const productionProvenance = {
  ...canaryProvenance,
  deployment_role: "production",
  security_identity: productionSecurityIdentity,
  deployment_identity: { ...canaryProvenance.deployment_identity, deployment_role: "production", binding_mode: "random", worker_name: "fusou-tlsn-production" },
  profile_contract: productionProfileContractArtifact(),
};
assertProvenanceEvidence(canaryProvenance, context, "canary");
assertProvenanceEvidence(productionProvenance, { ...context, deployment_role: "production" }, "production");
assert.deepEqual(PRODUCTION_SECURITY_IDENTITY_FIELDS.filter((field) => !(field in productionSecurityIdentity)), []);
assert.throws(() => assertProvenanceEvidence({
  ...canaryProvenance,
  security_identity: { ...securityIdentity, origin_inventory_sha256: "H".repeat(43) },
}, context, "canary"), /canary provenance security identity contains production-specific fields/);
assert.throws(() => assertProvenanceEvidence({
  ...productionProvenance,
  security_identity: { ...productionSecurityIdentity, profile_sha256: "A".repeat(43) },
}, { ...context, deployment_role: "production" }, "production"), /production provenance security identity contains canary-specific fields/);
assert.throws(() => assertProvenanceEvidence({
  ...canaryProvenance,
  deployment_role: "production",
  security_identity: productionSecurityIdentity,
}, { ...context, deployment_role: "production" }, "production"));
assert.throws(() => assertProvenanceEvidence({
  ...productionProvenance,
  profile_contract: canaryProvenance.profile_contract,
}, { ...context, deployment_role: "production" }, "production"), /Production provenance profile_contract/);
assert.throws(() => assertProvenanceEvidence({
  ...canaryProvenance,
  profile_contract: productionProfileContractArtifact(),
}, context, "canary"), /Canary provenance profile_contract/);
for (const [field, value] of [
  ["server_identity", "game.example.com"],
  ["profile_sha256", canaryProfiles.complete.sha256],
  ["sparse_profile_sha256", canaryProfiles.sparse.sha256],
  ["origin_inventory_sha256", "H".repeat(43)],
  ["profile_policy_sha256", "I".repeat(43)],
]) {
  assert.throws(() => assertProvenanceEvidence({
    ...productionProvenance,
    profile_contract: { ...productionProvenance.profile_contract, [field]: value },
  }, { ...context, deployment_role: "production" }, "production"), /Production provenance profile_contract/);
}
assert.throws(() => assertProvenanceEvidence({
  ...productionProvenance,
  profile_contract: { ...productionProvenance.profile_contract, identity_selection: "static Canary hostname" },
}, { ...context, deployment_role: "production" }, "production"), /Production provenance profile_contract/);
assert.throws(() => assertProvenanceEvidence({
  ...productionProvenance,
  profile_contract: { ...productionProvenance.profile_contract, profile_hashing: "supplied fixed hashes" },
}, { ...context, deployment_role: "production" }, "production"), /Production provenance profile_contract/);
for (const [label, mutate] of [
  ["complete server identity", (contract) => ({ ...contract, complete: { ...contract.complete, server_identity: "other.example.com" } })],
  ["complete profile hash", (contract) => ({ ...contract, complete: { ...contract.complete, canonical_json_sha256: "J".repeat(43) } })],
  ["sparse profile hash", (contract) => ({ ...contract, sparse: { ...contract.sparse, canonical_json_sha256: "K".repeat(43) } })],
  ["disclosure mode", (contract) => ({ ...contract, disclosure_mode: "sparse" })],
  ["response mode hash inclusion", (contract) => ({ ...contract, response_mode: { ...contract.response_mode, hash_inclusion: true } })],
  ["Production inventory field", (contract) => ({ ...contract, origin_inventory_sha256: productionSecurityIdentity.origin_inventory_sha256 })],
  ["Production profile policy field", (contract) => ({ ...contract, profile_policy_sha256: productionSecurityIdentity.profile_policy_sha256 })],
]) {
  assert.throws(() => assertProvenanceEvidence({
    ...canaryProvenance,
    profile_contract: mutate(canaryProvenance.profile_contract),
  }, context, "canary"), undefined, `Canary profile contract ${label} mutation must be rejected`);
}
assert.throws(() => assertProvenanceEvidence({
  ...canaryProvenance,
  deployment_identity: { ...canaryProvenance.deployment_identity, binding_mode: "random" },
}, context, "canary"), /does not match its role contract/);
assert.throws(() => assertProvenanceEvidence({
  ...productionProvenance,
  deployment_identity: { ...productionProvenance.deployment_identity, binding_mode: "fixed_canary" },
}, { ...context, deployment_role: "production" }, "production"), /does not match its role contract/);
assert.throws(() => assertProvenanceEvidence({
  ...productionProvenance,
  security_identity: { ...productionSecurityIdentity, origin_inventory_sha256: "L".repeat(43) },
}, { ...context, deployment_role: "production" }, "production"), /does not match the shipped inventory/);
assert.throws(() => assertProvenanceEvidence({
  ...productionProvenance,
  security_identity: { ...productionSecurityIdentity, profile_policy_sha256: "M".repeat(43) },
}, { ...context, deployment_role: "production" }, "production"), /does not match the shipped inventory/);
assert.throws(() => assertProvenanceEvidence({
  ...canaryProvenance,
  security_identity: { ...securityIdentity, origin_inventory_sha256: "H".repeat(43) },
}, context, "canary"), /canary provenance security identity contains production-specific fields/);
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
            ? "other-deployment-tool"
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