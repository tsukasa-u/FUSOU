import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  blockedProductionEvidenceManifest,
  createEvidenceItem,
  PRODUCTION_EVIDENCE_REQUIREMENTS,
  assertProductionEvidenceManifest,
} from "./production-evidence-contract.mjs";
import {
  artifactDescriptor,
  assertNoSyntheticEvidence,
  assertProductionEvidenceArtifacts,
  assertResultSubjectIdentity,
  assertSignedProductionEvidenceManifest,
  assertSignedResult,
  createSignedProductionEvidenceManifest,
  resultSigningBytes,
} from "./production-evidence.mjs";
import { sha256Base64Url } from "./deployment-attestation.mjs";

const now = new Date();
const nowIso = now.toISOString();
const workflowContext = {
  workflow_run_id: "100",
  workflow_run_attempt: "2",
  git_commit_sha: "a".repeat(40),
  repository: "tsukasa-u/FUSOU",
  workflow_file_identity: "tsukasa-u/FUSOU/.github/workflows/tlsn-production-deploy.yml@refs/heads/main",
  deployment_role: "production",
};
const deploymentIdentity = {
  deployment_id: "production-2026",
  deployment_role: "production",
  binding_mode: "random",
  trust_root_certificate_sha256: "A".repeat(43),
  worker_name: "fusou-tlsn-production",
};
const securityIdentity = {
  git_commit_sha: workflowContext.git_commit_sha,
  server_identity: "game.example.com",
  profile_sha256: "B".repeat(43),
  verifier_key_id: "verifier-2026",
  notary_key_id: "notary-2026",
  security_registry_set_sha256: "C".repeat(43),
  notary_registry_sha256: "D".repeat(43),
  binding_authority: "durable-single-use",
};

const { privateKey: resultPrivateKey, publicKey: resultPublicKey } = generateKeyPairSync("ed25519");
const resultPublicKeySpki = resultPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const resultKeyRegistry = {
  schema_version: 1,
  scope: "tlsn-result-signing-key-registry",
  keys: [{
    key_id: "result-2026",
    public_key_spki: resultPublicKeySpki,
    status: "ACTIVE",
    not_before: "2026-01-01T00:00:00.000Z",
    not_after: null,
  }],
};
const result = {
  version: 1,
  profile_id: "fusou-require-info-v1",
  profile_sha256: Buffer.alloc(32, 1).toString("base64url"),
  issuer: "fusou-tlsn-verifier",
  proof_purpose: "GAME_ACCOUNT_IDENTITY_V1",
  canonical_user_id: "11111111-1111-4111-8111-111111111111",
  device_id: "22222222-2222-4222-8222-222222222222",
  device_challenge: Buffer.alloc(32, 2).toString("base64url"),
  verified_member_id: "16189463",
  attestation_session_id: "123e4567-e89b-42d3-a456-426614174000",
  binding_nonce: Buffer.alloc(32, 3).toString("base64url"),
  binding_value: "binding-value",
  verifier_key_id: "verifier-2026",
  notary_key_id: "notary-2026",
  tlsn_attestation_id: Buffer.alloc(16, 4).toString("base64url"),
  server_identity: "game.example.com",
  request_transcript_size: "7",
  request_transcript_sha256: Buffer.alloc(32, 5).toString("base64url"),
  revealed_request_ranges: [{ start: "0", length: "7", bytes: Buffer.from("request").toString("base64url") }],
  response_transcript_size: "8",
  response_transcript_sha256: Buffer.alloc(32, 6).toString("base64url"),
  revealed_response_ranges: [{ start: "0", length: "8", bytes: Buffer.from("response").toString("base64url") }],
};
result.signature = sign(null, resultSigningBytes(result), resultPrivateKey).toString("base64url");
const subjectIdentity = {
  canonical_user_id_sha256: sha256Base64Url(result.canonical_user_id),
  device_id_sha256: sha256Base64Url(result.device_id),
  attestation_session_id_sha256: sha256Base64Url(result.attestation_session_id),
  verified_member_id_sha256: sha256Base64Url(result.verified_member_id),
  binding_value_sha256: sha256Base64Url(result.binding_value),
};

const presentationBytes = Buffer.from("real-production-presentation");
const resultBytes = Buffer.from(JSON.stringify(result));
const manifest = blockedProductionEvidenceManifest({
  captureId: "323e4567-e89b-42d3-a456-426614174000",
  now: nowIso,
  workflowContext,
  deploymentIdentity,
  securityIdentity,
  resultIdentity: {
    result_public_key_spki: resultPublicKeySpki,
    result_signer_key_id: "result-2026",
    result_key_registry_sha256: "E".repeat(43),
  },
  subjectIdentity,
  captureProvenance: "production",
});
manifest.artifacts = {
  presentation: { ...artifactDescriptor(presentationBytes, { mediaType: "application/tlsn-presentation" }), path: "presentation.bin" },
  result: { ...artifactDescriptor(resultBytes, { mediaType: "application/json" }), path: "result.json" },
};
manifest.evidence = Object.fromEntries(PRODUCTION_EVIDENCE_REQUIREMENTS.map((name) => [
  name,
  createEvidenceItem({
    status: "PASS",
    timestamp: nowIso,
    artifactSha256: name.includes("result") ? manifest.artifacts.result.artifact_sha256 : manifest.artifacts.presentation.artifact_sha256,
    verifierIdentity: "capture-test",
    authorityIdentity: "production-test-authority",
  }),
]));
const { privateKey: manifestPrivateKey, publicKey: manifestPublicKey } = generateKeyPairSync("ed25519");
const manifestPublicKeySpki = manifestPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const manifestPrivateKeyPkcs8 = manifestPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const signedManifest = createSignedProductionEvidenceManifest({
  manifest,
  signerKeyId: "production-evidence-2026",
  signerPublicKeySpki: manifestPublicKeySpki,
  signingPrivateKeyPkcs8: manifestPrivateKeyPkcs8,
});

assertProductionEvidenceManifest(signedManifest);
assertSignedProductionEvidenceManifest(signedManifest, {
  expectedSignerKeyId: "production-evidence-2026",
  expectedSignerPublicKeySpki: manifestPublicKeySpki,
  expectedWorkflowContext: workflowContext,
  expectedDeploymentIdentity: deploymentIdentity,
  expectedSecurityIdentity: securityIdentity,
  expectedResultIdentity: signedManifest.result_identity,
  now,
});
assertNoSyntheticEvidence(signedManifest);
assertProductionEvidenceArtifacts(signedManifest, { presentation: presentationBytes, result: resultBytes });
assertSignedResult(result, {
  publicKeySpki: resultPublicKeySpki,
  keyRegistry: resultKeyRegistry,
  signerKeyId: "result-2026",
  now,
});
assertResultSubjectIdentity(result, subjectIdentity);

function rejects(label, action) {
  assert.throws(action, undefined, label);
}

rejects("manifest signature mutation", () => assertSignedProductionEvidenceManifest({
  ...signedManifest,
  manifest_signature_base64url: `${signedManifest.manifest_signature_base64url.startsWith("A") ? "B" : "A"}${signedManifest.manifest_signature_base64url.slice(1)}`,
}, {
  expectedSignerKeyId: "production-evidence-2026",
  expectedSignerPublicKeySpki: manifestPublicKeySpki,
  now,
}));
rejects("wrong manifest signer key", () => assertSignedProductionEvidenceManifest(signedManifest, {
  expectedSignerKeyId: "other-key",
  expectedSignerPublicKeySpki: manifestPublicKeySpki,
  now,
}));
rejects("workflow run substitution", () => assertSignedProductionEvidenceManifest(signedManifest, {
  expectedSignerKeyId: "production-evidence-2026",
  expectedSignerPublicKeySpki: manifestPublicKeySpki,
  expectedWorkflowContext: { ...workflowContext, workflow_run_id: "101" },
  now,
}));
rejects("stale manifest", () => assertSignedProductionEvidenceManifest(signedManifest, {
  expectedSignerKeyId: "production-evidence-2026",
  expectedSignerPublicKeySpki: manifestPublicKeySpki,
  now: new Date(now.getTime() + 901_000),
}));
rejects("future manifest", () => assertSignedProductionEvidenceManifest(signedManifest, {
  expectedSignerKeyId: "production-evidence-2026",
  expectedSignerPublicKeySpki: manifestPublicKeySpki,
  now: new Date(now.getTime() - 1_000),
}));
rejects("artifact mutation", () => assertProductionEvidenceArtifacts(signedManifest, {
  presentation: Buffer.from("mutated-production-presentation"),
  result: resultBytes,
}));
rejects("synthetic substitution", () => assertNoSyntheticEvidence({ ...signedManifest, capture_provenance: "synthetic" }));
rejects("missing evidence item", () => assertProductionEvidenceManifest({
  ...signedManifest,
  evidence: { ...signedManifest.evidence, [PRODUCTION_EVIDENCE_REQUIREMENTS[0]]: undefined },
}));
rejects("production evidence promotion", () => assertProductionEvidenceManifest({ ...signedManifest, p0_05: "PASS" }));
rejects("result signature mutation", () => assertSignedResult({ ...result, signature: `${result.signature.startsWith("A") ? "B" : "A"}${result.signature.slice(1)}` }, {
  publicKeySpki: resultPublicKeySpki,
  keyRegistry: resultKeyRegistry,
  signerKeyId: "result-2026",
  now,
}));
rejects("cross-user subject substitution", () => assertResultSubjectIdentity({ ...result, canonical_user_id: "33333333-3333-4333-8333-333333333333" }, subjectIdentity));
rejects("cross-device subject substitution", () => assertResultSubjectIdentity({ ...result, device_id: "44444444-4444-4444-8444-444444444444" }, subjectIdentity));
rejects("wrong result key registry", () => assertSignedResult(result, {
  publicKeySpki: resultPublicKeySpki,
  keyRegistry: { ...resultKeyRegistry, keys: [{ ...resultKeyRegistry.keys[0], key_id: "other-key" }] },
  signerKeyId: "result-2026",
  now,
}));

const verifierDirectory = await mkdtemp("/tmp/tlsn-production-evidence-test-");
await writeFile(join(verifierDirectory, "presentation.bin"), presentationBytes);
await writeFile(join(verifierDirectory, "result.json"), resultBytes);
await writeFile(join(verifierDirectory, "manifest.json"), `${JSON.stringify(signedManifest)}\n`);
const verifierProcess = spawnSync(process.execPath, ["scripts/verify-production-evidence.mjs"], {
  cwd: new URL("..", import.meta.url).pathname,
  encoding: "utf8",
  env: {
    ...process.env,
    TLSN_PRODUCTION_EVIDENCE_MANIFEST_PATH: join(verifierDirectory, "manifest.json"),
    TLSN_PRODUCTION_EVIDENCE_SIGNER_KEY_ID: "production-evidence-2026",
    TLSN_PRODUCTION_EVIDENCE_SIGNER_PUBLIC_KEY_SPKI: manifestPublicKeySpki,
    TLSN_PRODUCTION_EVIDENCE_EXPECTED_DEPLOYMENT_IDENTITY_JSON: JSON.stringify(deploymentIdentity),
    TLSN_PRODUCTION_EVIDENCE_EXPECTED_SECURITY_IDENTITY_JSON: JSON.stringify(securityIdentity),
    TLSN_PRODUCTION_EVIDENCE_EXPECTED_RESULT_IDENTITY_JSON: JSON.stringify(signedManifest.result_identity),
    TLSN_PRODUCTION_EVIDENCE_EXPECTED_SUBJECT_IDENTITY_JSON: JSON.stringify(subjectIdentity),
    TLSN_WORKFLOW_RUN_ID: workflowContext.workflow_run_id,
    TLSN_WORKFLOW_RUN_ATTEMPT: workflowContext.workflow_run_attempt,
    TLSN_GIT_COMMIT_SHA: workflowContext.git_commit_sha,
    TLSN_REPOSITORY: workflowContext.repository,
    TLSN_WORKFLOW_FILE_IDENTITY: workflowContext.workflow_file_identity,
    TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY: JSON.stringify(resultKeyRegistry),
    TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI: resultPublicKeySpki,
    TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID: "result-2026",
  },
});
assert.equal(verifierProcess.status, 0, verifierProcess.stderr);
assert.match(verifierProcess.stdout, /"status":"BLOCKED"/);

console.log("[tlsn-production-evidence] manifest, signer, artifact, freshness, identity, replay-block, synthetic, and result mutation matrix OK");
