import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  blockedProductionEvidenceManifest,
  createEvidenceItem,
  createProductionEvidenceItem,
  assertProductionPresentationCaptureMetadata,
  PRODUCTION_EVIDENCE_REQUIREMENTS,
  assertProductionEvidenceManifest,
  assertTrustGraph,
  assertTrustGraphNodeIdentities,
  assertVerifiedTrustGraph,
  PRODUCTION_EVIDENCE_TRUST_GRAPH_NODE_DEFINITIONS,
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
import {
  assertSemanticResultMatches,
  assertSemanticVerificationArtifact,
  createSemanticVerificationArtifact,
  verifySemanticPredicates,
  verifyProductionPresentation,
} from "./production-evidence-semantic.mjs";
import {
  consumeReceiptSigningBytes,
  sessionReceiptSigningBytes,
  tlsnDeviceProofSigningBytes,
  verifyConsumeReceipt,
  verifySessionReceipt,
  verifyDevicePredicates,
} from "./device-evidence.mjs";
import { BindingAuthority, EvidenceSigner, ResultSigner, SessionAuthority } from "./authority-signers.mjs";
import { proxyProvenanceSigningPayload, verifyProductionProxyProvenance } from "./proxy-provenance.mjs";
import {
  createProductionEvidenceFailureBundle,
  finalizeProductionEvidenceFailureBundle,
  recordHealth,
  recordHttpExchange,
  recordProvenance,
} from "./production-evidence-failure.mjs";

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
const { privateKey: sessionAuthorityPrivateKey, publicKey: sessionAuthorityPublicKey } = generateKeyPairSync("ed25519");
const { privateKey: bindingAuthorityPrivateKey, publicKey: bindingAuthorityPublicKey } = generateKeyPairSync("ed25519");
const sessionAuthorityPublicKeySpki = sessionAuthorityPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const bindingAuthorityPublicKeySpki = bindingAuthorityPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const sessionAuthorityKeyRegistry = {
  schema_version: 1,
  scope: "tlsn-session-authority-key-registry",
  keys: [{ key_id: "session-authority-2026", public_key_spki: sessionAuthorityPublicKeySpki, status: "ACTIVE", not_before: "2026-01-01T00:00:00.000Z", not_after: null }],
};
const bindingAuthorityKeyRegistry = {
  schema_version: 1,
  scope: "tlsn-binding-authority-key-registry",
  keys: [{ key_id: "binding-authority-2026", public_key_spki: bindingAuthorityPublicKeySpki, status: "ACTIVE", not_before: "2026-01-01T00:00:00.000Z", not_after: null }],
};
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
const resultKeyRegistryRaw = JSON.stringify(resultKeyRegistry);
const resultKeyRegistrySha256 = sha256Base64Url(Buffer.from(resultKeyRegistryRaw));
const trustRootBytes = Buffer.from("test-trust-root");
deploymentIdentity.trust_root_certificate_sha256 = sha256Base64Url(trustRootBytes);
const sessionId = "123e4567-e89b-42d3-a456-426614174000";
const bindingNonce = Buffer.alloc(32, 3);
const bindingValue = Buffer.concat([
  Buffer.from("FUSOU-ATTESTATION-BINDING-V1\0"),
  Buffer.from([0, 16]),
  Buffer.from(sessionId.replaceAll("-", ""), "hex"),
  Buffer.from([0, 32]),
  bindingNonce,
]).toString("base64url");
const requestTranscript = Buffer.from(
  `POST /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: game.example.com\r\nX-Attestation-Binding: ${bindingValue}\r\nContent-Length: 0\r\n\r\n`,
);
const responseBody = Buffer.from("svdata={\"api_result\":1,\"api_data\":{\"api_basic\":{\"api_member_id\":16189463}}}");
const responseTranscript = Buffer.concat([
  Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${responseBody.length}\r\n\r\n`),
  responseBody,
]);
function rangeFor(bytes) {
  return [{ start: "0", length: String(bytes.length), bytes: bytes.toString("base64url") }];
}
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
  attestation_session_id: sessionId,
  binding_nonce: bindingNonce.toString("base64url"),
  binding_value: bindingValue,
  verifier_key_id: "verifier-2026",
  notary_key_id: "notary-2026",
  tlsn_attestation_id: Buffer.alloc(16, 4).toString("base64url"),
  server_identity: "game.example.com",
  request_transcript_size: String(requestTranscript.length),
  request_transcript_sha256: sha256Base64Url(requestTranscript),
  revealed_request_ranges: rangeFor(requestTranscript),
  response_transcript_size: String(responseTranscript.length),
  response_transcript_sha256: sha256Base64Url(responseTranscript),
  revealed_response_ranges: rangeFor(responseTranscript),
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
const proxyProvenance = {
  declared: "production",
  cryptographic_status: "UNVERIFIED",
  authority: {
    type: "externally-pinned-production-proxy-key",
    status: "UNVERIFIED",
  },
  proxy_identity: "fusou-proxy-production",
  proxy_deployment_id: "proxy-test-deployment",
  proxy_binary_identity: "proxy-test-binary",
  presentation_sha256: sha256Base64Url(presentationBytes),
  created_at: nowIso,
  capture_context: {
    method: "POST",
    target: "/kcsapi/api_get_member/require_info",
    http_version: "HTTP/1.1",
  },
  signer_key_id: null,
  signature: null,
};
const captureMetadata = {
  capture_provenance: "production",
  capture_source: "fusou-proxy-production-tlsn",
  synthetic: false,
  test: false,
  canary: false,
  local: false,
  request: proxyProvenance.capture_context,
  presentation_sha256: proxyProvenance.presentation_sha256,
  proxy_provenance: proxyProvenance,
};
const captureMetadataBytes = Buffer.from(JSON.stringify(captureMetadata));
const manifest = blockedProductionEvidenceManifest({
  captureId: "323e4567-e89b-42d3-a456-426614174000",
  now: nowIso,
  workflowContext,
  deploymentIdentity,
  securityIdentity,
  resultIdentity: {
    result_public_key_spki: resultPublicKeySpki,
    result_signer_key_id: "result-2026",
    result_key_registry_sha256: resultKeyRegistrySha256,
  },
  subjectIdentity,
  captureProvenance: "production",
});
manifest.artifacts = {
  presentation: { ...artifactDescriptor(presentationBytes, { mediaType: "application/tlsn-presentation" }), path: "presentation.bin" },
  result: { ...artifactDescriptor(resultBytes, { mediaType: "application/json" }), path: "result.json" },
  capture_metadata: { ...artifactDescriptor(captureMetadataBytes, { mediaType: "application/json" }), path: "capture-metadata.json" },
};
const fixtureArtifacts = { presentation: presentationBytes, result: resultBytes, capture_metadata: captureMetadataBytes };
for (const artifactName of ["authenticated_user", "device_identity", "device_authentication", "session", "consume_receipt", "semantic_verification", "notary_registry", "health"]) {
  const bytes = Buffer.from(`fixture-${artifactName}`);
  fixtureArtifacts[artifactName] = bytes;
  manifest.artifacts[artifactName] = { ...artifactDescriptor(bytes), path: `${artifactName}.bin` };
}
manifest.evidence = Object.fromEntries(PRODUCTION_EVIDENCE_REQUIREMENTS.map((name) => [
  name,
  createProductionEvidenceItem(name, {
    status: "PASS",
    timestamp: nowIso,
    artifactSha256: name.includes("result") ? manifest.artifacts.result.artifact_sha256 : manifest.artifacts.presentation.artifact_sha256,
    verifierIdentity: "capture-test",
    authorityIdentity: "production-test-authority",
  }),
]));
manifest.capture_predicates = {
  proxy_provenance_cryptographic_authentication: verifyProductionProxyProvenance({
    captureMetadata,
    presentationBytes,
    verifiedAt: nowIso,
  }),
};
manifest.evidence.real_production_tlsn_proxy_provenance.status = "UNVERIFIED";
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
assertProductionEvidenceArtifacts(signedManifest, fixtureArtifacts);
assert.equal(verifyProductionProxyProvenance({ captureMetadata, presentationBytes }).status, "UNVERIFIED");
assertSignedResult(result, {
  publicKeySpki: resultPublicKeySpki,
  keyRegistry: resultKeyRegistry,
  signerKeyId: "result-2026",
  now,
});
assertResultSubjectIdentity(result, subjectIdentity);

const { signature: ignoredSignature, ...unsignedTestResult } = result;
const notaryKey = Buffer.alloc(32, 7);
const semanticVerification = {
  result: unsignedTestResult,
  presentation_sha256: sha256Base64Url(presentationBytes),
  verified_presentation: {
    server_identity: result.server_identity,
    tlsn_attestation_id: result.tlsn_attestation_id,
    notary_key_sha256: sha256Base64Url(notaryKey),
    request_transcript_size: result.request_transcript_size,
    request_transcript_sha256: result.request_transcript_sha256,
    revealed_request_ranges: result.revealed_request_ranges,
    response_transcript_size: result.response_transcript_size,
    response_transcript_sha256: result.response_transcript_sha256,
    revealed_response_ranges: result.revealed_response_ranges,
  },
  notary_key_sha256: sha256Base64Url(notaryKey),
};
const trustedInputs = {
  server_identity: result.server_identity,
  profile_id: result.profile_id,
  profile_sha256: result.profile_sha256,
  verifier_key_id: result.verifier_key_id,
  notary_key_id: result.notary_key_id,
  notary_key_sha256: sha256Base64Url(notaryKey),
  trust_root_certificate_sha256: deploymentIdentity.trust_root_certificate_sha256,
  result_public_key_spki: resultPublicKeySpki,
  result_signer_key_id: "result-2026",
  result_key_registry_sha256: resultKeyRegistrySha256,
};
const notaryRegistry = { [result.notary_key_id]: notaryKey.toString("base64url") };
const predicateResults = verifySemanticPredicates({
  presentationBytes,
  semanticVerification,
  result,
  trustedInputs,
  notaryRegistry,
  resultRegistry: resultKeyRegistry,
  resultPublicKeySpki,
  resultSignerKeyId: "result-2026",
  resultRegistrySha256: resultKeyRegistrySha256,
  trustRootCertificateBytes: trustRootBytes,
  sessionBinding: bindingValue,
  sessionId,
  verifiedAt: nowIso,
});
assert.ok(Object.values(predicateResults).every((predicate) => predicate.status === "PASS"), JSON.stringify(predicateResults));
const predicateContext = {
  presentationBytes,
  result,
  trustedInputs,
  notaryRegistry,
  resultRegistry: resultKeyRegistry,
  resultRegistrySha256: resultKeyRegistrySha256,
  resultPublicKeySpki,
  resultSignerKeyId: "result-2026",
  trustRootCertificateBytes: trustRootBytes,
  sessionBinding: bindingValue,
  sessionId,
  verifiedAt: nowIso,
};
function predicateMutation(overrides) {
  return verifySemanticPredicates({
    ...predicateContext,
    semanticVerification,
    ...overrides,
  });
}
function semanticWithTranscripts({ request = requestTranscript, response = responseTranscript, updateResult = true } = {}) {
  const mutated = structuredClone(semanticVerification);
  mutated.verified_presentation.revealed_request_ranges = rangeFor(request);
  mutated.verified_presentation.request_transcript_size = String(request.length);
  mutated.verified_presentation.request_transcript_sha256 = sha256Base64Url(request);
  mutated.verified_presentation.revealed_response_ranges = rangeFor(response);
  mutated.verified_presentation.response_transcript_size = String(response.length);
  mutated.verified_presentation.response_transcript_sha256 = sha256Base64Url(response);
  if (updateResult) {
    mutated.result.revealed_request_ranges = rangeFor(request);
    mutated.result.request_transcript_size = String(request.length);
    mutated.result.request_transcript_sha256 = sha256Base64Url(request);
    mutated.result.revealed_response_ranges = rangeFor(response);
    mutated.result.response_transcript_size = String(response.length);
    mutated.result.response_transcript_sha256 = sha256Base64Url(response);
  }
  return mutated;
}
function assertPredicateFailed(label, predicates, predicateNames) {
  for (const name of predicateNames) assert.equal(predicates[name].status, "FAIL", `${label}: ${name}`);
}
function mutateBase64Url(value) {
  return `${value.slice(0, -1)}${value.endsWith("A") ? "B" : "A"}`;
}
const mutatedResponse = Buffer.from(responseTranscript.toString("utf8").replace("16189463", "26189463"));
const memberMutation = predicateMutation({
  semanticVerification: semanticWithTranscripts({ response: mutatedResponse }),
});
assertPredicateFailed("authenticated member response mutation", memberMutation, ["authenticated_member_id", "result_presentation_binding"]);
const methodMutation = predicateMutation({
  semanticVerification: semanticWithTranscripts({
    request: Buffer.from(requestTranscript.toString("utf8").replace("POST ", "GET  ")),
  }),
});
assertPredicateFailed("HTTP method mutation", methodMutation, ["require_info_http_profile"]);
const freshSessionId = "423e4567-e89b-42d3-a456-426614174000";
const freshSessionBinding = Buffer.concat([
  Buffer.from("FUSOU-ATTESTATION-BINDING-V1\0"),
  Buffer.from([0, 16]),
  Buffer.from(freshSessionId.replaceAll("-", ""), "hex"),
  Buffer.from([0, 32]),
  bindingNonce,
]).toString("base64url");
assertPredicateFailed("old Presentation with fresh Session", predicateMutation({
  sessionBinding: freshSessionBinding,
  sessionId: freshSessionId,
}), ["presentation_binding_to_session"]);
const pathMutation = predicateMutation({
  semanticVerification: semanticWithTranscripts({
    request: Buffer.from(requestTranscript.toString("utf8").replace("/kcsapi/api_get_member/require_info", "/kcsapi/api_get_member/other_info")),
  }),
});
assertPredicateFailed("HTTP path mutation", pathMutation, ["require_info_http_profile"]);
const versionMutation = predicateMutation({
  semanticVerification: semanticWithTranscripts({
    request: Buffer.from(requestTranscript.toString("utf8").replace("HTTP/1.1", "HTTP/1.0")),
  }),
});
assertPredicateFailed("HTTP version mutation", versionMutation, ["require_info_http_profile"]);
const statusMutation = predicateMutation({
  semanticVerification: semanticWithTranscripts({
    response: Buffer.from(responseTranscript.toString("utf8").replace("HTTP/1.1 200 OK", "HTTP/1.1 500 OK")),
  }),
});
assertPredicateFailed("HTTP status mutation", statusMutation, ["require_info_http_profile"]);
assertPredicateFailed("Notary registry substitution", predicateMutation({
  notaryRegistry: { [result.notary_key_id]: Buffer.alloc(32, 8).toString("base64url") },
}), ["notary_identity"]);
assertPredicateFailed("Notary key ID substitution", predicateMutation({
  trustedInputs: { ...trustedInputs, notary_key_id: "notary-other" },
  notaryRegistry: { "notary-other": notaryKey.toString("base64url") },
}), ["notary_identity"]);
assertPredicateFailed("server identity substitution", predicateMutation({
  trustedInputs: { ...trustedInputs, server_identity: "other.example.com" },
}), ["server_identity", "require_info_http_profile"]);
assertPredicateFailed("profile substitution", predicateMutation({
  trustedInputs: { ...trustedInputs, profile_sha256: Buffer.alloc(32, 9).toString("base64url") },
}), ["require_info_http_profile"]);
assertPredicateFailed("verifier key ID substitution", predicateMutation({
  trustedInputs: { ...trustedInputs, verifier_key_id: "verifier-other" },
}), ["require_info_http_profile"]);
assertPredicateFailed("Worker Result member mutation", predicateMutation({
  result: { ...result, verified_member_id: "26189463" },
}), ["result_presentation_binding", "result_signature"]);
assertPredicateFailed("Worker Result transcript mutation", predicateMutation({
  result: { ...result, response_transcript_sha256: sha256Base64Url(Buffer.from("other-response")) },
}), ["result_presentation_binding", "result_signature"]);
assertPredicateFailed("Worker Result session mutation", predicateMutation({
  result: { ...result, attestation_session_id: "423e4567-e89b-42d3-a456-426614174000" },
}), ["result_presentation_binding", "result_signature"]);
assertPredicateFailed("Worker Result binding mutation", predicateMutation({
  result: { ...result, binding_value: "other-binding" },
}), ["result_presentation_binding", "result_signature"]);
assertPredicateFailed("unrelated Result and Presentation pair", predicateMutation({
  result: { ...result, tlsn_attestation_id: Buffer.alloc(16, 9).toString("base64url") },
}), ["result_presentation_binding", "result_signature"]);
assertPredicateFailed("result registry substitution", predicateMutation({
  resultRegistry: { ...resultKeyRegistry, keys: [{ ...resultKeyRegistry.keys[0], key_id: "result-other" }] },
}), ["result_signature"]);

const { privateKey: devicePrivateKey, publicKey: devicePublicKey } = generateKeyPairSync("ed25519");
const devicePublicKeyBytes = devicePublicKey.export({ format: "der", type: "spki" }).subarray(-32);
const deviceIdentity = {
  authoritative: true,
  authority: "fusou-web-user-devices",
  canonical_user_id: result.canonical_user_id,
  device_id: result.device_id,
  device_public_key: devicePublicKeyBytes.toString("base64url"),
  device_public_key_sha256: sha256Base64Url(devicePublicKeyBytes),
  revoked_at: null,
};
const deviceAuthNonce = "a".repeat(64);
const session = {
  session_id: result.attestation_session_id,
  challenge: result.binding_nonce,
  binding: result.binding_value,
  device_id: result.device_id,
  device_challenge: result.device_challenge,
  expires_at: "2026-12-31T00:00:00.000Z",
};
const sessionReceipt = {
  schema_version: 1,
  type: "attestation-session-issued",
  signer_key_id: "session-authority-2026",
  signature_algorithm: "Ed25519",
  session_id: session.session_id,
  canonical_user_id: result.canonical_user_id,
  device_id: result.device_id,
  device_auth_nonce: deviceAuthNonce,
  nonce: result.binding_nonce,
  device_challenge: result.device_challenge,
  binding_value: result.binding_value,
  created_at: nowIso,
  expires_at: session.expires_at,
};
sessionReceipt.signature = sign(null, sessionReceiptSigningBytes(sessionReceipt), sessionAuthorityPrivateKey).toString("base64url");
session.session_receipt = sessionReceipt;
const deviceAuthentication = {
  request: {
    device_id: result.device_id,
    nonce: deviceAuthNonce,
    sig: sign(null, Buffer.from(deviceAuthNonce), devicePrivateKey).toString("base64url"),
  },
  worker_acceptance: {
    status: 201,
    device_id: result.device_id,
    session_id: session.session_id,
  },
};
const proofSigningBytes = tlsnDeviceProofSigningBytes(
  result.device_id,
  session.session_id,
  session.binding,
  session.device_challenge,
);
const possessionProof = {
  device_id: result.device_id,
  session_id: session.session_id,
  binding_value: session.binding,
  challenge: session.device_challenge,
  sig: sign(null, proofSigningBytes, devicePrivateKey).toString("base64url"),
  message_sha256: sha256Base64Url(proofSigningBytes),
  message_sha256_hex: createHash("sha256").update(proofSigningBytes).digest("hex"),
  replay_digest: sha256Base64Url(proofSigningBytes),
  replay_digest_hex: createHash("sha256").update(proofSigningBytes).digest("hex"),
};
const consumeReceipt = {
  schema_version: 1,
  type: "attestation-binding-consumed",
  signer_key_id: "binding-authority-2026",
  signature_algorithm: "Ed25519",
  session_id: session.session_id,
  canonical_user_id: result.canonical_user_id,
  device_id: result.device_id,
  nonce: session.challenge,
  binding_value: session.binding,
  presentation_id: sha256Base64Url(presentationBytes),
  used_at: nowIso,
};
consumeReceipt.signature = sign(null, consumeReceiptSigningBytes(consumeReceipt), bindingAuthorityPrivateKey).toString("base64url");
const sessionAuthoritySigner = new SessionAuthority({
  keyId: sessionReceipt.signer_key_id,
  privateKeyPkcs8: sessionAuthorityPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
  publicKeySpki: sessionAuthorityPublicKeySpki,
});
const bindingAuthoritySigner = new BindingAuthority({
  keyId: consumeReceipt.signer_key_id,
  privateKeyPkcs8: bindingAuthorityPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
  publicKeySpki: bindingAuthorityPublicKeySpki,
});
const resultSigner = new ResultSigner({
  keyId: "result-2026",
  privateKeyPkcs8: resultPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
  publicKeySpki: resultPublicKeySpki,
});
const evidenceSigner = new EvidenceSigner({
  keyId: "production-evidence-2026",
  privateKeyPkcs8: manifestPrivateKeyPkcs8,
  publicKeySpki: manifestPublicKeySpki,
});
const roleSessionReceipt = sessionAuthoritySigner.signSessionReceipt({ ...sessionReceipt, signature: undefined });
const roleConsumeReceipt = bindingAuthoritySigner.signConsumeReceipt({ ...consumeReceipt, signature: undefined });
assert.equal(roleSessionReceipt.signature, sessionReceipt.signature);
assert.equal(roleConsumeReceipt.signature, consumeReceipt.signature);
assertSignedResult(resultSigner.signResult(unsignedTestResult), {
  publicKeySpki: resultPublicKeySpki,
  keyRegistry: resultKeyRegistry,
  signerKeyId: "result-2026",
  now,
});
assertSignedProductionEvidenceManifest(evidenceSigner.signManifest(manifest), {
  expectedSignerKeyId: "production-evidence-2026",
  expectedSignerPublicKeySpki: manifestPublicKeySpki,
  expectedWorkflowContext: workflowContext,
  expectedDeploymentIdentity: deploymentIdentity,
  expectedSecurityIdentity: securityIdentity,
  expectedResultIdentity: manifest.result_identity,
  now,
});
const replay = {
  session_id: session.session_id,
  device_id: session.device_id,
  binding: session.binding,
  status: 409,
  error: "device_possession_replayed",
  replay_digest: possessionProof.replay_digest,
  replay_digest_hex: possessionProof.replay_digest_hex,
  stored_replay_digest_hex: possessionProof.replay_digest_hex,
  consume_receipt_presentation_id: consumeReceipt.presentation_id,
};
const devicePredicateContext = {
  deviceIdentity,
  deviceAuthentication,
  session,
  possessionProof,
  consumeReceipt,
  replay,
  result,
  authoritativeUserId: result.canonical_user_id,
  authoritativeDeviceId: result.device_id,
  presentationBytes,
  resultPublicKeySpki,
  resultSignerKeyId: "result-2026",
  sessionAuthorityPublicKeySpki,
  sessionAuthoritySignerKeyId: "session-authority-2026",
  sessionAuthorityKeyRegistry,
  bindingAuthorityPublicKeySpki,
  bindingAuthoritySignerKeyId: "binding-authority-2026",
  bindingAuthorityKeyRegistry,
  verifiedAt: nowIso,
};
const devicePredicateResults = verifyDevicePredicates(devicePredicateContext);
assert.ok(Object.values(devicePredicateResults).every((predicate) => predicate.status === "PASS"), JSON.stringify(devicePredicateResults));
const graphIdentities = {
  "authenticated-user": { user_id: result.canonical_user_id },
  device: { user_id: result.canonical_user_id, device_id: result.device_id, public_key_sha256: deviceIdentity.device_public_key_sha256 },
  "device-authentication": { device_id: result.device_id, nonce: deviceAuthentication.request.nonce },
  session: { session_id: sessionId, key_id: sessionReceipt.signer_key_id },
  binding: { binding_sha256: sha256Base64Url(bindingValue), nonce_sha256: sha256Base64Url(bindingNonce) },
  presentation: { presentation_sha256: sha256Base64Url(presentationBytes), attestation_id: result.tlsn_attestation_id },
  "member-id": { verified_member_id: result.verified_member_id, response_transcript_sha256: result.response_transcript_sha256 },
  "tlsn-notary": { key_id: result.notary_key_id },
  result: { result_sha256: sha256Base64Url(resultBytes), key_id: result.signer_key_id ?? "result-2026" },
  "production-proxy": {
    declared: proxyProvenance.declared,
    cryptographic_status: proxyProvenance.cryptographic_status,
    proxy_identity: proxyProvenance.proxy_identity,
    proxy_deployment_id: proxyProvenance.proxy_deployment_id,
    proxy_binary_identity: proxyProvenance.proxy_binary_identity,
  },
  "production-evidence": { capture_id: manifest.capture_id },
  "remote-attestation": { status: "UNVERIFIED" },
};
const graphArtifactByNode = {
  "authenticated-user": "authenticated_user",
  device: "device_identity",
  "device-authentication": "device_authentication",
  session: "session",
  binding: "consume_receipt",
  presentation: "presentation",
  "member-id": "semantic_verification",
  "tlsn-notary": "notary_registry",
  result: "result",
  "production-proxy": "capture_metadata",
  "production-evidence": "health",
  "remote-attestation": "health",
};
const verifiedGraph = {
  ...manifest.trust_graph,
  nodes: PRODUCTION_EVIDENCE_TRUST_GRAPH_NODE_DEFINITIONS.map(({ id, type, authority }) => ({
    id,
    type,
    authority,
    identity: graphIdentities[id],
    evidence_artifact: graphArtifactByNode[id],
  })),
};
assertTrustGraph(verifiedGraph, { artifactNames: new Set(Object.keys(manifest.artifacts)) });
assertTrustGraphNodeIdentities(verifiedGraph, graphIdentities);
assertVerifiedTrustGraph(verifiedGraph, {
  ...predicateResults,
  ...devicePredicateResults,
  proxy_provenance_cryptographic_authentication: { status: "UNVERIFIED" },
  remote_attestation_unverified: { status: "UNVERIFIED" },
});
for (const [nodeId, identities] of Object.entries(graphIdentities)) {
  for (const field of Object.keys(identities)) {
    const poisoned = structuredClone(verifiedGraph);
    poisoned.nodes.find((node) => node.id === nodeId).identity[field] = "poisoned-root";
    assert.throws(() => assertTrustGraphNodeIdentities(poisoned, graphIdentities), `${nodeId} root poisoning`);
  }
}
assert.throws(() => assertTrustGraph({ ...verifiedGraph, edges: verifiedGraph.edges.slice(1) }), "missing trust graph edge");
assert.throws(() => assertTrustGraph({ ...verifiedGraph, edges: [...verifiedGraph.edges, verifiedGraph.edges[0]] }), "extra trust graph edge");
const wrongAuthorityGraph = structuredClone(verifiedGraph);
wrongAuthorityGraph.edges[0].authority = "fusou-tlsn-result-signer";
assert.throws(() => assertTrustGraph(wrongAuthorityGraph), "wrong trust graph edge authority");
const wrongEndpointGraph = structuredClone(verifiedGraph);
wrongEndpointGraph.edges[0].target = "result";
assert.throws(() => assertTrustGraph(wrongEndpointGraph), "wrong trust graph edge endpoint");
const wrongPredicateGraph = structuredClone(verifiedGraph);
wrongPredicateGraph.edges[0].verification_predicate = "result_signature";
assert.throws(() => assertTrustGraph(wrongPredicateGraph), "wrong trust graph predicate pair");
function devicePredicateMutation(label, overrides, predicateNames) {
  assertPredicateFailed(label, verifyDevicePredicates({ ...devicePredicateContext, ...overrides }), predicateNames);
}
devicePredicateMutation("device owner substitution", {
  deviceIdentity: { ...deviceIdentity, canonical_user_id: "33333333-3333-4333-8333-333333333333" },
}, ["device_identity_ownership", "device_authentication_signature"]);
devicePredicateMutation("device public key substitution", {
  deviceIdentity: { ...deviceIdentity, device_public_key: Buffer.alloc(32, 8).toString("base64url") },
}, ["device_identity_ownership", "device_authentication_signature", "tlsn_device_possession_signature"]);
devicePredicateMutation("device revocation substitution", {
  deviceIdentity: { ...deviceIdentity, revoked_at: nowIso },
}, ["device_identity_ownership", "device_authentication_signature"]);
devicePredicateMutation("generic nonce mutation", {
  deviceAuthentication: { ...deviceAuthentication, request: { ...deviceAuthentication.request, nonce: "b".repeat(64) } },
}, ["device_authentication_signature", "session_binding_receipt"]);
devicePredicateMutation("generic nonce signature mutation", {
  deviceAuthentication: { ...deviceAuthentication, request: { ...deviceAuthentication.request, sig: mutateBase64Url(deviceAuthentication.request.sig) } },
}, ["device_authentication_signature"]);
devicePredicateMutation("session ID mutation", {
  session: { ...session, session_id: "423e4567-e89b-42d3-a456-426614174000" },
}, ["device_authentication_signature", "session_binding_receipt", "tlsn_device_possession_signature", "binding_framing"]);
devicePredicateMutation("binding value mutation", {
  session: { ...session, binding: bindingValue.slice(0, -1) + (bindingValue.endsWith("A") ? "B" : "A") },
}, ["session_binding_receipt", "tlsn_device_possession_signature", "binding_framing", "replay_digest", "consume_receipt"]);
devicePredicateMutation("TLSN possession signature mutation", {
  possessionProof: { ...possessionProof, sig: mutateBase64Url(possessionProof.sig) },
}, ["tlsn_device_possession_signature"]);
devicePredicateMutation("TLSN possession digest mutation", {
  possessionProof: { ...possessionProof, replay_digest_hex: "0".repeat(64) },
}, ["tlsn_device_possession_signature", "replay_digest"]);
devicePredicateMutation("session receipt signature mutation", {
  session: { ...session, session_receipt: { ...session.session_receipt, signature: mutateBase64Url(session.session_receipt.signature) } },
}, ["session_binding_receipt"]);
const resultSignedSessionReceipt = { ...sessionReceipt, signer_key_id: "result-2026" };
resultSignedSessionReceipt.signature = sign(null, sessionReceiptSigningBytes(resultSignedSessionReceipt), resultPrivateKey).toString("base64url");
devicePredicateMutation("Result key cannot forge Session Authority receipt", {
  session: { ...session, session_receipt: resultSignedSessionReceipt },
}, ["session_binding_receipt"]);
const bindingSignedSessionReceipt = { ...sessionReceipt, signer_key_id: "binding-authority-2026" };
bindingSignedSessionReceipt.signature = sign(null, sessionReceiptSigningBytes(bindingSignedSessionReceipt), bindingAuthorityPrivateKey).toString("base64url");
devicePredicateMutation("Binding key cannot forge Session Authority receipt", {
  session: { ...session, session_receipt: bindingSignedSessionReceipt },
}, ["session_binding_receipt"]);
const resultSignedConsumeReceipt = { ...consumeReceipt, signer_key_id: "result-2026" };
resultSignedConsumeReceipt.signature = sign(null, consumeReceiptSigningBytes(resultSignedConsumeReceipt), resultPrivateKey).toString("base64url");
devicePredicateMutation("Result key cannot forge Binding Authority receipt", {
  consumeReceipt: resultSignedConsumeReceipt,
}, ["consume_receipt"]);
const sessionSignedConsumeReceipt = { ...consumeReceipt, signer_key_id: "session-authority-2026" };
sessionSignedConsumeReceipt.signature = sign(null, consumeReceiptSigningBytes(sessionSignedConsumeReceipt), sessionAuthorityPrivateKey).toString("base64url");
devicePredicateMutation("Session key cannot forge Binding Authority receipt", {
  consumeReceipt: sessionSignedConsumeReceipt,
}, ["consume_receipt"]);
devicePredicateMutation("Binding registry substitution", {
  bindingAuthorityKeyRegistry: sessionAuthorityKeyRegistry,
}, ["consume_receipt"]);
devicePredicateMutation("Session registry substitution", {
  sessionAuthorityKeyRegistry: bindingAuthorityKeyRegistry,
}, ["session_binding_receipt"]);
devicePredicateMutation("consume receipt signature mutation", {
  consumeReceipt: { ...consumeReceipt, signature: mutateBase64Url(consumeReceipt.signature) },
}, ["consume_receipt"]);
assert.throws(() => assertSignedResult({ ...result, signature: signedManifest.manifest_signature_base64url }, {
  publicKeySpki: resultPublicKeySpki,
  keyRegistry: resultKeyRegistry,
  signerKeyId: "result-2026",
  now,
}), "Evidence signer cannot forge Result");
assert.throws(() => verifySessionReceipt({ ...sessionReceipt, signature: signedManifest.manifest_signature_base64url }, {
  session_id: session.session_id,
  canonical_user_id: result.canonical_user_id,
  device_id: result.device_id,
  device_auth_nonce: deviceAuthNonce,
  nonce: session.challenge,
  device_challenge: session.device_challenge,
  binding_value: session.binding,
  created_at: sessionReceipt.created_at,
  expires_at: sessionReceipt.expires_at,
}, {
  publicKeySpki: sessionAuthorityPublicKeySpki,
  signerKeyId: sessionReceipt.signer_key_id,
  keyRegistry: sessionAuthorityKeyRegistry,
}), "Evidence signer cannot forge Session Authority receipt");
assert.throws(() => verifyConsumeReceipt({ ...consumeReceipt, signature: signedManifest.manifest_signature_base64url }, {
  session_id: session.session_id,
  canonical_user_id: result.canonical_user_id,
  device_id: result.device_id,
  nonce: session.challenge,
  binding_value: session.binding,
  presentation_id: consumeReceipt.presentation_id,
  used_at: consumeReceipt.used_at,
}, {
  publicKeySpki: bindingAuthorityPublicKeySpki,
  signerKeyId: consumeReceipt.signer_key_id,
  keyRegistry: bindingAuthorityKeyRegistry,
}), "Evidence signer cannot forge Binding Authority receipt");
devicePredicateMutation("replay response mutation", {
  replay: { ...replay, status: 200 },
}, ["replay_digest"]);
devicePredicateMutation("stored replay digest mutation", {
  replay: { ...replay, stored_replay_digest_hex: "0".repeat(64) },
}, ["replay_digest"]);
const fixtureMetadata = {
  expected_member_id: result.verified_member_id,
  capture_provenance: "production",
  synthetic: false,
};
const substitutedFixtureMetadata = { ...fixtureMetadata, expected_member_id: "26189463", capture_provenance: "synthetic", synthetic: true };
const semanticArtifact = createSemanticVerificationArtifact({
  presentationBytes,
  semanticVerification,
  result,
  predicateResults,
  trustedInputs,
  verifierIdentity: "semantic-test-verifier",
  verifiedAt: nowIso,
});
assert.equal(semanticArtifact.derived_from_presentation.verified_member_id, result.verified_member_id);
assert.notEqual(substitutedFixtureMetadata.expected_member_id, result.verified_member_id);
assert.equal(signedManifest.p0_05, "BLOCKED");
assertSemanticResultMatches(result, semanticVerification);
assertSemanticVerificationArtifact(semanticArtifact, {
  presentationBytes,
  semanticVerification,
  result,
  predicateResults,
  trustedInputs,
});
rejects("semantic Presentation hash mutation", () => assertSemanticVerificationArtifact({
  ...semanticArtifact,
  input: { ...semanticArtifact.input, presentation_sha256: sha256Base64Url(Buffer.from("other-presentation")) },
}, {
  presentationBytes,
  semanticVerification,
  result,
  predicateResults,
  trustedInputs,
}));
rejects("semantic Result member mutation", () => assertSemanticResultMatches({ ...result, verified_member_id: "26189463" }, semanticVerification));
rejects("semantic predicate reuse", () => assertSemanticVerificationArtifact({
  ...semanticArtifact,
  predicates: {
    ...semanticArtifact.predicates,
    authenticated_member_id: { ...semanticArtifact.predicates.authenticated_member_id, status: "UNVERIFIED" },
  },
}, {
  presentationBytes,
  semanticVerification,
  result,
  predicateResults,
  trustedInputs,
}));

const upstreamPresentation = await readFile(new URL("../../FUSOU-TLSN-VERIFIER/fixtures/tlsn-alpha15-upstream-presentation.bin", import.meta.url));
await assert.rejects(
  verifyProductionPresentation({
    presentationBytes: upstreamPresentation,
    serverIdentity: securityIdentity.server_identity,
    profileSha256: result.profile_sha256,
    verifierKeyId: securityIdentity.verifier_key_id,
    notaryKeyId: securityIdentity.notary_key_id,
    canonicalUserId: result.canonical_user_id,
    canonicalDeviceId: result.device_id,
    deviceChallenge: result.device_challenge,
    notaryRegistry: { [securityIdentity.notary_key_id]: Buffer.alloc(32, 8).toString("base64url") },
  }),
  /semantic Presentation (cryptographic|profile) verification failed/,
);

function rejects(label, action) {
  assert.throws(action, undefined, label);
}

assertProductionPresentationCaptureMetadata({
  capture_provenance: "production",
  capture_source: "fusou-proxy-production-tlsn",
  synthetic: false,
  test: false,
  canary: false,
  local: false,
  request: {
    method: "POST",
    target: "/kcsapi/api_get_member/require_info",
    http_version: "HTTP/1.1",
  },
  presentation_sha256: sha256Base64Url(presentationBytes),
  proxy_provenance: proxyProvenance,
}, presentationBytes);
const { privateKey: proxyPrivateKey, publicKey: proxyPublicKey } = generateKeyPairSync("ed25519");
const proxyPublicKeySpki = proxyPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const externalProxyPin = {
  type: "externally-pinned-production-proxy-key",
  signer_key_id: "proxy-2026",
  public_key_spki: proxyPublicKeySpki,
  proxy_identity: proxyProvenance.proxy_identity,
  proxy_deployment_id: proxyProvenance.proxy_deployment_id,
  proxy_binary_identity: proxyProvenance.proxy_binary_identity,
};
const signedProxyProvenance = {
  ...proxyProvenance,
  cryptographic_status: "VERIFIED",
  authority: {
    type: "externally-pinned-production-proxy-key",
    status: "EXTERNALLY_PINNED",
  },
  signer_key_id: externalProxyPin.signer_key_id,
};
signedProxyProvenance.signature = sign(null, Buffer.from(proxyProvenanceSigningPayload(signedProxyProvenance)), proxyPrivateKey).toString("base64url");
const selfDeclaredProxyProvenance = {
  ...proxyProvenance,
  signer_key_id: "self-declared-proxy-key",
  signature: signedProxyProvenance.signature,
};
assert.equal(verifyProductionProxyProvenance({
  captureMetadata: { ...captureMetadata, proxy_provenance: selfDeclaredProxyProvenance },
  presentationBytes,
}).status, "UNVERIFIED");
const signedCaptureMetadata = { ...captureMetadata, proxy_provenance: signedProxyProvenance };
assert.equal(verifyProductionProxyProvenance({
  captureMetadata: signedCaptureMetadata,
  presentationBytes,
  externalPin: externalProxyPin,
}).status, "PASS");
assert.equal(verifyProductionProxyProvenance({
  captureMetadata: signedCaptureMetadata,
  presentationBytes,
}).status, "FAIL");
assert.equal(verifyProductionProxyProvenance({
  captureMetadata: signedCaptureMetadata,
  presentationBytes,
  externalPin: { ...externalProxyPin, proxy_binary_identity: "proxy-other-binary" },
}).status, "FAIL");
assert.equal(verifyProductionProxyProvenance({
  captureMetadata: {
    ...captureMetadata,
    proxy_provenance: { ...signedProxyProvenance, signature: mutateBase64Url(signedProxyProvenance.signature) },
  },
  presentationBytes,
  externalPin: externalProxyPin,
}).status, "FAIL");
rejects("synthetic Presentation provenance", () => assertProductionPresentationCaptureMetadata({
  capture_provenance: "production",
  capture_source: "synthetic-tlsn-fixture",
  synthetic: true,
  test: true,
  canary: false,
  local: true,
  request: {
    method: "POST",
    target: "/kcsapi/api_get_member/require_info",
    http_version: "HTTP/1.1",
  },
  presentation_sha256: sha256Base64Url(presentationBytes),
}, presentationBytes));
rejects("Presentation provenance hash mutation", () => assertProductionPresentationCaptureMetadata({
  capture_provenance: "production",
  capture_source: "fusou-proxy-production-tlsn",
  synthetic: false,
  test: false,
  canary: false,
  local: false,
  request: {
    method: "POST",
    target: "/kcsapi/api_get_member/require_info",
    http_version: "HTTP/1.1",
  },
  presentation_sha256: sha256Base64Url(Buffer.from("other-presentation")),
}, presentationBytes));

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
rejects("evidence artifact contract mutation", () => assertProductionEvidenceManifest({
  ...signedManifest,
  evidence: {
    ...signedManifest.evidence,
    real_production_game_server_connection: {
      ...signedManifest.evidence.real_production_game_server_connection,
      required_artifacts: ["presentation"],
    },
  },
}));
rejects("evidence field contract mutation", () => assertProductionEvidenceManifest({
  ...signedManifest,
  evidence: {
    ...signedManifest.evidence,
    real_production_tlsn_notary_interaction: {
      ...signedManifest.evidence.real_production_tlsn_notary_interaction,
      required_fields: ["notary_key_id"],
    },
  },
}));
rejects("device predicate contract mutation", () => assertProductionEvidenceManifest({
  ...signedManifest,
  device_predicates: {
    ...signedManifest.device_predicates,
    replay_digest: {
      ...signedManifest.device_predicates.replay_digest,
      required_fields: ["status"],
    },
  },
}));
rejects("signed device predicate mutation", () => assertSignedProductionEvidenceManifest({
  ...signedManifest,
  device_predicates: {
    ...signedManifest.device_predicates,
    device_identity_ownership: {
      ...signedManifest.device_predicates.device_identity_ownership,
      status: "PASS",
    },
  },
}, {
  expectedSignerKeyId: "production-evidence-2026",
  expectedSignerPublicKeySpki: manifestPublicKeySpki,
  now,
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
assert.equal(verifierProcess.status, 1, verifierProcess.stderr);
assert.match(verifierProcess.stderr, /missing a required artifact|verifier-generated semantic artifact is required/);

const failureBundle = createProductionEvidenceFailureBundle({ captureId: "failure-capture", startedAt: nowIso });
recordHttpExchange(failureBundle, {
  url: "https://worker.example.test/verify/tlsn?token=must-not-be-retained",
  options: {
    method: "POST",
    headers: { Authorization: "Bearer request-secret", "Content-Type": "application/json" },
    body: JSON.stringify({ binding: "binding-secret" }),
  },
  response: new Response(JSON.stringify({ access_token: "response-secret" }), { status: 200, headers: { "Content-Type": "application/json" } }),
  responseBytes: Buffer.from(JSON.stringify({ access_token: "response-secret" })),
});
recordHealth(failureBundle, { deployment_identity: { deployment_id: "deployment-1" }, access_token: "health-secret" });
recordProvenance(failureBundle, { proxy_provenance: { signature: "proxy-secret" }, capture_context: { token: "context-secret" } });
const failureJson = JSON.stringify(finalizeProductionEvidenceFailureBundle(failureBundle, nowIso));
assert.ok(!failureJson.includes("request-secret"), "failure bundle must omit request credentials");
assert.ok(!failureJson.includes("response-secret"), "failure bundle must omit response credentials");
assert.ok(!failureJson.includes("health-secret"), "failure bundle must omit health credentials");
assert.ok(!failureJson.includes("proxy-secret"), "failure bundle must omit provenance signatures");
assert.ok(!failureJson.includes("context-secret"), "failure bundle must omit provenance credentials");

console.log("[tlsn-production-evidence] manifest, signer, artifact, freshness, identity, semantic, replay-block, synthetic, and result mutation matrix OK");
