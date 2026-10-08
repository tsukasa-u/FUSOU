import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Base64Url } from "./deployment-attestation.mjs";
import {
  artifactDescriptor,
  assertProductionEvidenceArtifacts,
  assertSignedResult,
  assertSignedSparseResult,
  createSignedProductionEvidenceManifest,
  resultSigningBytes,
  sparseResultSigningBytes,
} from "./production-evidence.mjs";
import { deriveProductionTrustGraph } from "./production-evidence-contract.mjs";
import { inspectAlpha15Presentation } from "./production-evidence-semantic.mjs";
import { assertExactProductionResultResponse, assertProductionOriginConsistency, deriveProductionOriginFromInspection } from "./production-evidence-origin.mjs";
import { profilesForServerIdentity } from "./profile-canonical-contract.mjs";
import { serializeTargetApprovalRecord } from "./target-approval-contract.mjs";
import { createSignedResultRegistryEnvelope, resultRegistryEnvelopeHash } from "./result-registry-envelope.mjs";
import { consumeReceiptSigningBytes, sessionReceiptSigningBytes, tlsnDeviceProofSigningBytes } from "./device-evidence.mjs";
import { parseOriginInventory, parseTargetApproval } from "../src/origin-trust-contract.mjs";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const root = await mkdtemp(join(tmpdir(), "tlsn-evidence-consumer-"));
const inventoryBytes = await readFile(new URL("../../configs/tlsn-origin-inventory.json", import.meta.url));
const inventory = JSON.parse(inventoryBytes);
const serverIdentity = inventory.targets[0].server_identity;
const approvalRecord = {
  ...JSON.parse(await readFile(new URL("../../configs/tlsn-target-approval.json", import.meta.url))),
  targets: [serverIdentity],
};
const approvalBytes = Buffer.from(serializeTargetApprovalRecord(approvalRecord));
const jsonBytes = (value) => Buffer.from(JSON.stringify(value));
const spki = (key) => key.export({ format: "der", type: "spki" }).toString("base64url");
const pkcs8 = (key) => key.export({ format: "der", type: "pkcs8" }).toString("base64url");
const now = new Date().toISOString();
const key = () => generateKeyPairSync("ed25519");
const evidenceKey = key();
const resultKey = key();
const rootKey = key();
const sessionKey = key();
const bindingKey = key();
const deviceKey = key();
const registry = (scope, keyId, publicKey) => ({
  schema_version: 1,
  scope,
  keys: [{ key_id: keyId, public_key_spki: spki(publicKey), status: "ACTIVE", not_before: "2026-01-01T00:00:00Z", not_after: null }],
});
const resultRegistry = registry("tlsn-result-signing-key-registry", "consumer-fixture-result", resultKey.publicKey);
const resultRegistryRaw = JSON.stringify(resultRegistry);
const sessionRegistry = registry("tlsn-session-authority-key-registry", "consumer-fixture-session", sessionKey.publicKey);
const bindingRegistry = registry("tlsn-binding-authority-key-registry", "consumer-fixture-binding", bindingKey.publicKey);
const registryEnvelope = createSignedResultRegistryEnvelope({
  registry: resultRegistry,
  registryRaw: resultRegistryRaw,
  rootKeyId: "consumer-fixture-root",
  rootPublicKeySpki: spki(rootKey.publicKey),
  rootPrivateKeyPkcs8: pkcs8(rootKey.privateKey),
});
const registryEnvelopeRaw = JSON.stringify(registryEnvelope);
const notaryRegistry = { "consumer-fixture-notary": "ASEAAAAAAAAAAxuExVZ7EmRAmV0-1aq6BWXXHhg0YEgZ_5wX9enV3QeP" };
const sessionId = "123e4567-e89b-42d3-a456-426614174000";
const userId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const nonce = Buffer.alloc(32, 3);
const binding = Buffer.concat([
  Buffer.from("FUSOU-ATTESTATION-BINDING-V1\0"), Buffer.from([0, 16]),
  Buffer.from(sessionId.replaceAll("-", ""), "hex"), Buffer.from([0, 32]), nonce,
]).toString("base64url");
const challenge = Buffer.alloc(32, 2).toString("base64url");
const authNonce = "a".repeat(64);
const session = {
  session_id: sessionId, challenge: nonce.toString("base64url"), binding, device_id: deviceId,
  device_challenge: challenge, expires_at: new Date(Date.now() + 3600_000).toISOString(),
};
session.session_receipt = {
  schema_version: 1, type: "attestation-session-issued", signer_key_id: sessionRegistry.keys[0].key_id,
  signature_algorithm: "Ed25519", session_id: sessionId, canonical_user_id: userId,
  device_id: deviceId, device_auth_nonce: authNonce, nonce: session.challenge,
  device_challenge: challenge, binding_value: binding, created_at: now, expires_at: session.expires_at,
};
session.session_receipt.signature = sign(null, sessionReceiptSigningBytes(session.session_receipt), sessionKey.privateKey).toString("base64url");
const authentication = {
  request: { device_id: deviceId, nonce: authNonce, sig: sign(null, Buffer.from(authNonce), deviceKey.privateKey).toString("base64url") },
  worker_acceptance: { status: 201, device_id: deviceId, session_id: sessionId },
};
const devicePublicKeyBytes = deviceKey.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
const deviceIdentity = {
  authoritative: true, authority: "fusou-web-user-devices", canonical_user_id: userId, device_id: deviceId,
  device_public_key: devicePublicKeyBytes.toString("base64url"), device_public_key_sha256: sha256Base64Url(devicePublicKeyBytes), revoked_at: null,
};
const proofBytes = tlsnDeviceProofSigningBytes(deviceId, sessionId, binding, challenge);
const proof = {
  device_id: deviceId, session_id: sessionId, binding_value: binding, challenge,
  sig: sign(null, proofBytes, deviceKey.privateKey).toString("base64url"),
  message_sha256: sha256Base64Url(proofBytes), replay_digest: sha256Base64Url(proofBytes),
  message_sha256_hex: createHash("sha256").update(proofBytes).digest("hex"),
  replay_digest_hex: createHash("sha256").update(proofBytes).digest("hex"),
};
const referenceRoot = join(root, "independent-reference");
await mkdir(referenceRoot);
const inventoryPath = join(referenceRoot, "inventory.raw");
const approvalPath = join(referenceRoot, "approval.raw");
await writeFile(inventoryPath, inventoryBytes);
await writeFile(approvalPath, approvalBytes);
const baseEnvironment = {
  PATH: process.env.PATH ?? "",
  TLSN_ENVIRONMENT: "production", TLSN_DEPLOYMENT_ROLE: "production",
  TLSN_GIT_COMMIT_SHA: "15d50b8894b01306108d949797a2b8f240c734a3",
  TLSN_WORKFLOW_RUN_ID: "100", TLSN_WORKFLOW_RUN_ATTEMPT: "2",
  TLSN_REPOSITORY: "tsukasa-u/FUSOU", TLSN_WORKFLOW_FILE_IDENTITY: "dotenvx+pnpm+wrangler",
  TLSN_PRODUCTION_EVIDENCE_WORKER_URL: "https://worker.example.test",
  TLSN_PRODUCTION_EVIDENCE_WEB_ORIGIN: "https://web.example.test",
  TLSN_PRODUCTION_EVIDENCE_SUPABASE_URL: "https://auth.example.test",
  TLSN_PRODUCTION_EVIDENCE_ACCESS_TOKEN: "consumer-test-only-token",
  TLSN_PRODUCTION_EVIDENCE_SUPABASE_PUBLISHABLE_KEY: "consumer-test-only-public-key",
  TLSN_PRODUCTION_EVIDENCE_DEVICE_ID: deviceId,
  TLSN_PRODUCTION_EVIDENCE_NOTARY_KEY_ID: "consumer-fixture-notary",
  TLSN_PRODUCTION_EVIDENCE_VERIFIER_KEY_ID: "consumer-fixture-verifier",
  TLSN_PRODUCTION_ORIGIN_INVENTORY_REFERENCE_PATH: inventoryPath,
  TLSN_PRODUCTION_TARGET_APPROVAL_REFERENCE_PATH: approvalPath,
  TLSN_PRODUCTION_NOTARY_REGISTRY: JSON.stringify(notaryRegistry),
  TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI: spki(resultKey.publicKey),
  TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID: resultRegistry.keys[0].key_id,
  TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY: resultRegistryRaw,
  TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE: registryEnvelopeRaw,
  TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID: registryEnvelope.root_key_id,
  TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI: spki(rootKey.publicKey),
  TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: spki(sessionKey.publicKey),
  TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID: sessionRegistry.keys[0].key_id,
  TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY: JSON.stringify(sessionRegistry),
  TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI: spki(bindingKey.publicKey),
  TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID: bindingRegistry.keys[0].key_id,
  TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY: JSON.stringify(bindingRegistry),
  TLSN_PRODUCTION_EVIDENCE_SIGNER_KEY_ID: "consumer-fixture-evidence",
  TLSN_PRODUCTION_EVIDENCE_SIGNER_PUBLIC_KEY_SPKI: spki(evidenceKey.publicKey),
  TLSN_PRODUCTION_EVIDENCE_SIGNING_PRIVATE_KEY_PKCS8: pkcs8(evidenceKey.privateKey),
};

function stateFor(disclosureMode) {
  const presentationBytes = Buffer.from(`opaque ${disclosureMode} consumer-test Presentation`);
  const request = Buffer.from(`POST /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: ${serverIdentity}\r\nX-Attestation-Binding: ${binding}\r\nContent-Length: 0\r\n\r\n`);
  const body = Buffer.from('svdata={"api_result":1,"private":"consumer-hidden","api_data":{"api_basic":{"api_member_id":16189463}}}');
  const response = Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n`), body]);
  const ranges = (bytes) => [{ start: "0", length: String(bytes.length), bytes: bytes.toString("base64url") }];
  const result = {
    version: disclosureMode === "sparse" ? 3 : 2,
    profile_id: disclosureMode === "sparse" ? "fusou-require-info-v2-sparse" : "fusou-require-info-v1",
    profile_sha256: profilesForServerIdentity(serverIdentity)[disclosureMode].sha256,
    issuer: "fusou-tlsn-verifier", proof_purpose: "GAME_ACCOUNT_IDENTITY_V1",
    canonical_user_id: userId, device_id: deviceId, device_challenge: challenge, verified_member_id: "16189463",
    attestation_session_id: sessionId, binding_nonce: session.challenge, binding_value: binding,
    verifier_key_id: baseEnvironment.TLSN_PRODUCTION_EVIDENCE_VERIFIER_KEY_ID,
    notary_key_id: baseEnvironment.TLSN_PRODUCTION_EVIDENCE_NOTARY_KEY_ID,
    tlsn_attestation_id: Buffer.alloc(16, 4).toString("base64url"),
    presentation_sha256: sha256Base64Url(presentationBytes), server_identity: serverIdentity,
    origin_inventory_sha256: sha256Base64Url(inventoryBytes), target_approval_artifact_sha256: sha256Base64Url(approvalBytes),
    request_transcript_size: String(request.length), revealed_request_ranges: ranges(request),
    response_transcript_size: String(response.length), revealed_response_ranges: ranges(response),
  };
  const verifiedPresentation = {
    server_identity: serverIdentity, tlsn_attestation_id: result.tlsn_attestation_id,
    notary_key_sha256: sha256Base64Url(Buffer.from(notaryRegistry[result.notary_key_id], "base64url")),
    request_transcript_size: result.request_transcript_size, revealed_request_ranges: result.revealed_request_ranges,
    response_transcript_size: result.response_transcript_size, revealed_response_ranges: result.revealed_response_ranges,
  };
  if (disclosureMode === "sparse") {
    result.disclosure_mode = "sparse";
    result.notary_key_sha256 = verifiedPresentation.notary_key_sha256;
    const hiddenStart = response.indexOf(Buffer.from("consumer-hidden"));
    const hiddenEnd = hiddenStart + Buffer.byteLength("consumer-hidden");
    result.revealed_response_ranges = verifiedPresentation.revealed_response_ranges = [
      { start: "0", length: String(hiddenStart), bytes: response.subarray(0, hiddenStart).toString("base64url") },
      { start: String(hiddenEnd), length: String(response.length - hiddenEnd), bytes: response.subarray(hiddenEnd).toString("base64url") },
    ];
  } else {
    result.request_transcript_sha256 = verifiedPresentation.request_transcript_sha256 = sha256Base64Url(request);
    result.response_transcript_sha256 = verifiedPresentation.response_transcript_sha256 = sha256Base64Url(response);
  }
  const semanticVerification = {
    result: structuredClone(result), presentation_sha256: result.presentation_sha256,
    disclosure_mode: disclosureMode, verified_presentation: verifiedPresentation,
    notary_key_sha256: verifiedPresentation.notary_key_sha256,
  };
  result.signature = sign(null, disclosureMode === "sparse" ? sparseResultSigningBytes(result) : resultSigningBytes(result), resultKey.privateKey).toString("base64url");
  const consumeReceipt = {
    schema_version: 1, type: "attestation-binding-consumed", signer_key_id: bindingRegistry.keys[0].key_id,
    signature_algorithm: "Ed25519", session_id: sessionId, canonical_user_id: userId, device_id: deviceId,
    nonce: session.challenge, binding_value: binding, presentation_id: result.presentation_sha256, used_at: now,
  };
  consumeReceipt.signature = sign(null, consumeReceiptSigningBytes(consumeReceipt), bindingKey.privateKey).toString("base64url");
  const security = {
    git_commit_sha: baseEnvironment.TLSN_GIT_COMMIT_SHA,
    verifier_key_id: result.verifier_key_id, notary_key_id: result.notary_key_id,
    origin_inventory_sha256: result.origin_inventory_sha256, target_approval_artifact_sha256: result.target_approval_artifact_sha256,
    notary_registry_sha256: sha256Base64Url(JSON.stringify(notaryRegistry)), binding_authority: "durable-single-use",
    security_registry_set_sha256: Buffer.alloc(32, 5).toString("base64url"),
  };
  const authority = (keyRegistry) => ({
    key_id: keyRegistry.keys[0].key_id, public_key_spki: keyRegistry.keys[0].public_key_spki,
    key_registry_sha256: sha256Base64Url(JSON.stringify(keyRegistry)),
  });
  return {
    disclosureMode, observedIdentity: serverIdentity, presentationBase64: presentationBytes.toString("base64"),
    result, consumeReceipt, semanticVerification, notaryRegistry, deviceIdentity, user: { id: userId, is_anonymous: false },
    health: {
      environment: "production", deployment_role: "production",
      deployment_identity: { deployment_id: "consumer-fixture-deployment", deployment_role: "production", binding_mode: "random", worker_name: "consumer-fixture-worker" },
      security_identity: security,
      result_identity: {
        result_public_key_spki: spki(resultKey.publicKey), result_signer_key_id: resultRegistry.keys[0].key_id,
        result_key_registry_sha256: sha256Base64Url(resultRegistryRaw),
        result_key_registry_envelope_sha256: resultRegistryEnvelopeHash(registryEnvelopeRaw),
        result_registry_root_key_id: registryEnvelope.root_key_id, result_registry_root_public_key_spki: spki(rootKey.publicKey),
      },
      authority_identity: {
        session_authority: { ...authority(sessionRegistry), authority: "fusou-tlsn-session-authority" },
        binding_authority: { ...authority(bindingRegistry), authority: "fusou-tlsn-binding-authority" },
      },
    },
  };
}

async function writeBundle(directory, state) {
  await mkdir(directory, { recursive: true });
  const bytes = Buffer.from(state.presentationBase64, "base64");
  const context = { method: "POST", target: "/kcsapi/api_get_member/require_info", http_version: "HTTP/1.1" };
  const metadata = {
    capture_provenance: "production", capture_source: "fusou-proxy-production-tlsn",
    synthetic: false, test: false, canary: false, local: false, request: context,
    server_identity: "untrusted-candidate.invalid", presentation_sha256: sha256Base64Url(bytes),
    proxy_provenance: {
      declared: "production", cryptographic_status: "UNVERIFIED",
      authority: { type: "externally-pinned-production-proxy-key", status: "UNVERIFIED" },
      proxy_identity: "consumer-fixture-proxy", proxy_deployment_id: "consumer-fixture-proxy-deployment",
      proxy_binary_identity: "consumer-fixture-proxy-binary", presentation_sha256: sha256Base64Url(bytes),
      created_at: now, capture_context: context, signer_key_id: null, signature: null,
    },
  };
  const verification = { verified: true, result: state.result, consume_receipt: state.consumeReceipt, device_replay_digest_hex: proof.replay_digest_hex };
  const artifacts = {
    "presentation.bin": bytes, "metadata.json": jsonBytes(metadata), "session.json": jsonBytes(session),
    "device-authentication.json": jsonBytes(authentication), "possession-proof.json": jsonBytes(proof),
    "worker-verification.json": jsonBytes(verification), "result.json": jsonBytes(state.result),
    "consume-receipt.json": jsonBytes(state.consumeReceipt), "result-exact.bin": Buffer.from(JSON.stringify(verification, null, 4) + "\n"),
  };
  for (const [name, value] of Object.entries(artifacts)) await writeFile(join(directory, name), value);
  return artifacts;
}

let caseNumber = 0;
async function runCli(script, state, environment) {
  const id = ++caseNumber;
  const statePath = join(root, `state-${id}.json`);
  const tracePath = join(root, `trace-${id}.json`);
  await writeFile(statePath, JSON.stringify(state));
  await writeFile(tracePath, "[]");
  const child = spawnSync(process.execPath, [
    "--experimental-test-module-mocks", "--import", join(scriptsDirectory, "fixtures/production-evidence-consumer-preload.mjs"),
    join(scriptsDirectory, script),
  ], {
    env: { ...baseEnvironment, TLSN_PRODUCTION_DISCLOSURE_MODE: state.disclosureMode, ...environment, TLSN_CONSUMER_TEST_STATE_PATH: statePath, TLSN_CONSUMER_TEST_TRACE_PATH: tracePath },
    encoding: "utf8",
  });
  if (child.error) throw child.error;
  return { ...child, trace: JSON.parse(await readFile(tracePath, "utf8")) };
}

function resign(manifest) {
  return createSignedProductionEvidenceManifest({
    manifest, signerKeyId: baseEnvironment.TLSN_PRODUCTION_EVIDENCE_SIGNER_KEY_ID,
    signerPublicKeySpki: spki(evidenceKey.publicKey), signingPrivateKeyPkcs8: pkcs8(evidenceKey.privateKey),
  });
}

function mutateExactResponseField(bytes, field, before, after) {
  const needle = Buffer.from(`${JSON.stringify(field)}: ${JSON.stringify(before)}`);
  const offset = bytes.indexOf(needle);
  assert.notEqual(offset, -1, `exact response field is missing: ${field}`);
  assert.equal(bytes.indexOf(needle, offset + needle.length), -1, `exact response field is ambiguous: ${field}`);
  return Buffer.concat([
    bytes.subarray(0, offset),
    Buffer.from(`${JSON.stringify(field)}: ${JSON.stringify(after)}`),
    bytes.subarray(offset + needle.length),
  ]);
}

try {
  for (const mode of ["complete", "sparse"]) {
    const state = stateFor(mode);
    const bundlePath = join(root, `app-${mode}`);
    const bundleArtifacts = await writeBundle(bundlePath, state);
    const outputPath = join(root, `evidence-${mode}`, "manifest.json");
    const captureEnv = { TLSN_PRODUCTION_EVIDENCE_BUNDLE_PATH: bundlePath, TLSN_PRODUCTION_EVIDENCE_OUTPUT_PATH: outputPath };
    const capture = await runCli("capture-production-evidence.mjs", state, captureEnv);
    assert.equal(capture.status, 0, capture.stdout + capture.stderr + JSON.stringify(capture.trace));
    const originalManifest = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(originalManifest.capture_status, "PASS");
    assert.equal(originalManifest.production_evidence, "BLOCKED");
    assert.equal(Object.hasOwn(originalManifest.security_identity, "server_identity"), false);
    assert.equal(Object.hasOwn(originalManifest.security_identity, "profile_sha256"), false);
    assert.equal(Object.hasOwn(originalManifest.security_identity, "sparse_profile_sha256"), false);
    for (const [name, expected] of [["origin_inventory", inventoryBytes], ["target_approval", approvalBytes], ["result_exact", bundleArtifacts["result-exact.bin"]]]) {
      const descriptor = originalManifest.artifacts[name];
      const actual = await readFile(join(dirname(outputPath), descriptor.path));
      assert.deepEqual(actual, expected);
      assert.equal(descriptor.byte_length, actual.length);
      assert.equal(descriptor.artifact_sha256, sha256Base64Url(actual));
    }
    assert.deepEqual(capture.trace.filter((event) => event.boundary === "http").map((event) => new URL(event.url).pathname), [
      "/health", "/auth/v1/user", "/api/auth/anonymous-sync/v2/device-identity", mode === "sparse" ? "/verify/tlsn/sparse" : "/verify/tlsn",
    ]);
    const offlineEnv = {
      TLSN_PRODUCTION_EVIDENCE_MANIFEST_PATH: outputPath,
      TLSN_PRODUCTION_EVIDENCE_EXPECTED_DEPLOYMENT_IDENTITY_JSON: JSON.stringify(state.health.deployment_identity),
      TLSN_PRODUCTION_EVIDENCE_EXPECTED_SECURITY_IDENTITY_JSON: JSON.stringify(state.health.security_identity),
      TLSN_PRODUCTION_EVIDENCE_EXPECTED_RESULT_IDENTITY_JSON: JSON.stringify(state.health.result_identity),
      TLSN_PRODUCTION_EVIDENCE_EXPECTED_SUBJECT_IDENTITY_JSON: JSON.stringify(originalManifest.subject_identity),
      TLSN_PRODUCTION_EVIDENCE_SIGNING_PRIVATE_KEY_PKCS8: "",
    };
    const verified = await runCli("verify-production-evidence.mjs", state, offlineEnv);
    assert.equal(verified.status, 0, verified.stdout + verified.stderr);
    assert.equal(JSON.parse(verified.stdout).verification_status, "VERIFIED");
    assert.equal(JSON.parse(verified.stdout).status, "BLOCKED");
    assert.equal(verified.trace.some((event) => event.boundary === "http"), false);
    for (const observed of ["outside.kancolle-server.com", inventory.targets[1].server_identity]) {
      const substituted = { ...state, observedIdentity: observed };
      const captureFailure = await runCli("capture-production-evidence.mjs", substituted, captureEnv);
      assert.equal(captureFailure.status, 2);
      assert.equal(JSON.parse(captureFailure.stdout).signed, false);
      const failureManifest = JSON.parse(await readFile(outputPath, "utf8"));
      assert.equal(failureManifest.capture_status, "FAILED");
      assert.equal(failureManifest.production_evidence, "BLOCKED");
      assert.equal(captureFailure.trace.some((event) => event.boundary === "semantic"), false);
      await writeFile(outputPath, JSON.stringify(originalManifest));
      const offlineFailure = await runCli("verify-production-evidence.mjs", substituted, offlineEnv);
      assert.notEqual(offlineFailure.status, 0);
      assert.match(offlineFailure.stderr, /outside the shipped Origin inventory|outside the current Target Approval/);
      assert.equal(offlineFailure.trace.some((event) => event.boundary === "semantic"), false);
    }
    for (const name of ["origin_inventory", "target_approval", "result_exact"]) {
      const descriptor = originalManifest.artifacts[name];
      const path = join(dirname(outputPath), descriptor.path);
      const original = await readFile(path);
      await writeFile(path, Buffer.concat([original, Buffer.from(" ")]));
      const digestFailure = await runCli("verify-production-evidence.mjs", state, offlineEnv);
      assert.notEqual(digestFailure.status, 0);
      assert.match(digestFailure.stderr, new RegExp(`artifact hash mismatch: ${name}`));
      if (name !== "result_exact") {
        const rebound = structuredClone(originalManifest);
        rebound.artifacts[name] = { ...descriptor, ...artifactDescriptor(await readFile(path), { mediaType: descriptor.media_type }) };
        await writeFile(outputPath, JSON.stringify(resign(rebound)));
        const reapproved = await runCli("verify-production-evidence.mjs", state, offlineEnv);
        assert.notEqual(reapproved.status, 0);
        assert.match(reapproved.stderr, /does not match the independently supplied Production reference/);
      }
      await writeFile(path, original);
      await writeFile(outputPath, JSON.stringify(originalManifest));
    }
    for (const [variable, bytes] of [
      ["TLSN_PRODUCTION_ORIGIN_INVENTORY_REFERENCE_PATH", inventoryBytes],
      ["TLSN_PRODUCTION_TARGET_APPROVAL_REFERENCE_PATH", approvalBytes],
    ]) {
      const changedReference = join(referenceRoot, `${mode}-${variable}.raw`);
      await writeFile(changedReference, Buffer.concat([bytes, Buffer.from(" ")]));
      const rejectedReference = await runCli("verify-production-evidence.mjs", state, { ...offlineEnv, [variable]: changedReference });
      assert.notEqual(rejectedReference.status, 0);
      assert.match(rejectedReference.stderr, /does not match the independently supplied Production reference/);
    }
    const missing = structuredClone(originalManifest);
    delete missing.artifacts.result_exact;
    await writeFile(outputPath, JSON.stringify(resign(missing)));
    const missingExact = await runCli("verify-production-evidence.mjs", state, offlineEnv);
    assert.notEqual(missingExact.status, 0);
    assert.match(missingExact.stderr, /missing a required artifact: result_exact/);
    await writeFile(outputPath, JSON.stringify(originalManifest));

    const exactPath = join(dirname(outputPath), originalManifest.artifacts.result_exact.path);
    const outerSubstitution = mutateExactResponseField(
      bundleArtifacts["result-exact.bin"], "device_replay_digest_hex", proof.replay_digest_hex, "0".repeat(64),
    );
    await writeFile(exactPath, outerSubstitution);
    const reboundOuter = structuredClone(originalManifest);
    reboundOuter.artifacts.result_exact = { ...reboundOuter.artifacts.result_exact, ...artifactDescriptor(outerSubstitution, { mediaType: "application/json" }) };
    await writeFile(outputPath, JSON.stringify(resign(reboundOuter)));
    const rejectedOuter = await runCli("verify-production-evidence.mjs", state, offlineEnv);
    assert.notEqual(rejectedOuter.status, 0);
    assert.match(rejectedOuter.stderr, /exact outer response differs from the replay digest/);
    await writeFile(exactPath, bundleArtifacts["result-exact.bin"]);
    await writeFile(outputPath, JSON.stringify(originalManifest));

    const exactBytes = bundleArtifacts["result-exact.bin"];
    const signedResultArtifacts = (changes) => {
      const changed = { ...state.result, ...changes };
      changed.signature = sign(null, mode === "sparse" ? sparseResultSigningBytes(changed) : resultSigningBytes(changed), resultKey.privateKey).toString("base64url");
      (mode === "sparse" ? assertSignedSparseResult : assertSignedResult)(changed, {
        publicKeySpki: spki(resultKey.publicKey), keyRegistry: resultRegistry, signerKeyId: resultRegistry.keys[0].key_id,
      });
      let changedExact = exactBytes;
      for (const [field, value] of Object.entries({ ...changes, signature: changed.signature })) {
        changedExact = mutateExactResponseField(changedExact, field, state.result[field], value);
      }
      assert.deepEqual(JSON.parse(changedExact).result, changed);
      return { result: jsonBytes(changed), result_exact: changedExact };
    };
    const rejectPackageMutation = async (label, expectedError, {
      artifacts = {}, mutateManifest, rebindDescriptors = true, inspected = false,
    } = {}) => {
      const changedManifest = structuredClone(originalManifest);
      const originals = new Map();
      try {
        for (const [name, bytes] of Object.entries(artifacts)) {
          const descriptor = originalManifest.artifacts[name];
          const path = join(dirname(outputPath), descriptor.path);
          originals.set(path, await readFile(path));
          await writeFile(path, bytes);
          if (rebindDescriptors) {
            changedManifest.artifacts[name] = { ...descriptor, ...artifactDescriptor(bytes, { mediaType: descriptor.media_type }) };
            for (const evidence of Object.values(changedManifest.evidence)) {
              if (evidence.artifact_sha256 === descriptor.artifact_sha256) {
                evidence.artifact_sha256 = changedManifest.artifacts[name].artifact_sha256;
              }
            }
          }
        }
        mutateManifest?.(changedManifest);
        await writeFile(outputPath, JSON.stringify(resign(changedManifest)));
        const rejected = await runCli("verify-production-evidence.mjs", state, offlineEnv);
        assert.equal(rejected.status, 1, `${label}: ${rejected.stdout}${rejected.stderr}`);
        assert.match(rejected.stderr, expectedError, label);
        assert.equal(rejected.trace.some((event) => event.boundary === "inspection"), inspected, label);
        assert.equal(rejected.trace.some((event) => event.boundary === "semantic"), false, label);
        assert.equal(rejected.trace.some((event) => event.boundary === "http"), false, label);
        assert.deepEqual(await readFile(inventoryPath), inventoryBytes, label);
        assert.deepEqual(await readFile(approvalPath), approvalBytes, label);
        console.log(`[tlsn-production-evidence-consumer] ${mode}/${label}: rejected at ${expectedError.source}`);
      } finally {
        for (const [path, bytes] of originals) await writeFile(path, bytes);
        await writeFile(outputPath, JSON.stringify(originalManifest));
      }
    };

    const substitutedIdentity = inventory.targets[1].server_identity;
    const substitutedProfile = profilesForServerIdentity(substitutedIdentity)[mode].sha256;
    const substitutedApproval = Buffer.from(serializeTargetApprovalRecord({ ...approvalRecord, targets: [substitutedIdentity] }));
    parseTargetApproval(substitutedApproval.toString("utf8"), inventory, sha256Base64Url(inventoryBytes));
    await rejectPackageMutation("captured-only approved identity substitution", /captured Target Approval does not match the independently supplied Production reference/, {
      artifacts: {
        ...signedResultArtifacts({
          server_identity: substitutedIdentity, profile_sha256: substitutedProfile,
          target_approval_artifact_sha256: sha256Base64Url(substitutedApproval),
        }),
        target_approval: substitutedApproval,
      },
      inspected: true,
    });
    const substitutedInventory = structuredClone(inventory);
    substitutedInventory.targets[0].server_identity = substitutedIdentity;
    substitutedInventory.targets[1].server_identity = serverIdentity;
    const substitutedInventoryBytes = jsonBytes(substitutedInventory);
    const substitutedInventorySha256 = sha256Base64Url(substitutedInventoryBytes);
    const substitutedInventoryApproval = Buffer.from(serializeTargetApprovalRecord({
      ...approvalRecord, inventory_sha256: substitutedInventorySha256, targets: [substitutedIdentity],
    }));
    parseTargetApproval(substitutedInventoryApproval.toString("utf8"), parseOriginInventory(substitutedInventoryBytes.toString("utf8")), substitutedInventorySha256);
    const substitutedPolicy = {
      origin_inventory_sha256: substitutedInventorySha256,
      target_approval_artifact_sha256: sha256Base64Url(substitutedInventoryApproval),
    };
    const substitutedPackage = {
      ...signedResultArtifacts({ server_identity: substitutedIdentity, profile_sha256: substitutedProfile, ...substitutedPolicy }),
      origin_inventory: substitutedInventoryBytes,
      target_approval: substitutedInventoryApproval,
    };
    await rejectPackageMutation("captured-only inventory identity substitution", /captured Origin Inventory does not match the independently supplied Production reference/, {
      artifacts: substitutedPackage, inspected: true,
    });
    await rejectPackageMutation("captured policy cannot replace independent digest pins", /security identity mismatch: origin_inventory_sha256/, {
      artifacts: {
        ...substitutedPackage,
        health: jsonBytes({ ...state.health, security_identity: { ...state.health.security_identity, ...substitutedPolicy } }),
      },
      mutateManifest: (manifest) => Object.assign(manifest.security_identity, substitutedPolicy),
    });
    await rejectPackageMutation("manifest-only server identity mutation", /health security identity mismatch: server_identity/, {
      mutateManifest: (manifest) => { manifest.security_identity.server_identity = substitutedIdentity; },
    });
    await rejectPackageMutation("coordinated captured identity cannot replace Presentation identity", /manifest policy Presentation-derived identity mismatch: server_identity/, {
      artifacts: { health: jsonBytes({ ...state.health, security_identity: { ...state.health.security_identity, server_identity: substitutedIdentity } }) },
      mutateManifest: (manifest) => { manifest.security_identity.server_identity = substitutedIdentity; },
      inspected: true,
    });
    await rejectPackageMutation("signed Result-only server identity mutation", /signed Result security identity mismatch: server_identity/, {
      artifacts: signedResultArtifacts({ server_identity: substitutedIdentity }), inspected: true,
    });
    assert.notEqual(substitutedProfile, state.result.profile_sha256);
    await rejectPackageMutation("consumer derived profile hash mismatch", /signed Result security identity mismatch: profile_sha256/, {
      artifacts: signedResultArtifacts({ profile_sha256: substitutedProfile }), inspected: true,
    });

    const equivalentExact = Buffer.concat([exactBytes.subarray(0, -1), Buffer.from(" ")]);
    assert.deepEqual(JSON.parse(equivalentExact), JSON.parse(exactBytes));
    assert.equal(equivalentExact.length, exactBytes.length);
    assert.notEqual(sha256Base64Url(equivalentExact), sha256Base64Url(exactBytes));
    await rejectPackageMutation("equivalent outer JSON cannot replace exact bytes", /artifact hash mismatch: result_exact/, {
      artifacts: { result_exact: equivalentExact }, rebindDescriptors: false,
    });
    const truncatedExact = exactBytes.subarray(0, exactBytes.length - 2);
    await rejectPackageMutation("exact outer Result truncation", /artifact hash mismatch: result_exact/, {
      artifacts: { result_exact: truncatedExact }, rebindDescriptors: false,
    });
    await rejectPackageMutation("rebound truncation still fails outer decoding", /exact outer Worker Result response is not valid UTF-8 JSON/, {
      artifacts: { result_exact: truncatedExact },
    });
    await rejectPackageMutation("exact outer descriptor length mismatch", /artifact size mismatch: result_exact/, {
      mutateManifest: (manifest) => { manifest.artifacts.result_exact.byte_length += 1; },
    });
    await rejectPackageMutation("exact outer descriptor SHA-256 mismatch", /artifact hash mismatch: result_exact/, {
      mutateManifest: (manifest) => { manifest.artifacts.result_exact.artifact_sha256 = Buffer.alloc(32, 9).toString("base64url"); },
    });
    await rejectPackageMutation("outer parsed Result differs from inner Result", /exact outer response differs from the inner signed Result/, {
      artifacts: { result_exact: mutateExactResponseField(exactBytes, "verified_member_id", state.result.verified_member_id, "26189463") },
    });
    await rejectPackageMutation("inner signed Result differs from original outer bytes", /exact outer response differs from the inner signed Result/, {
      artifacts: { result: signedResultArtifacts({ server_identity: substitutedIdentity }).result },
    });
    await rejectPackageMutation("outer consume receipt inconsistency", /exact outer response differs from the consume receipt/, {
      artifacts: { result_exact: mutateExactResponseField(exactBytes, "presentation_id", state.consumeReceipt.presentation_id, Buffer.alloc(32, 9).toString("base64url")) },
    });
    assert.deepEqual(await readFile(exactPath), exactBytes);

    const innerPath = join(dirname(outputPath), originalManifest.artifacts.result.path);
    const innerBytes = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(state.result).reverse()), null, 2));
    await writeFile(innerPath, innerBytes);
    const reformatted = structuredClone(originalManifest);
    reformatted.artifacts.result = { ...reformatted.artifacts.result, ...artifactDescriptor(innerBytes, { mediaType: "application/json" }) };
    const readJson = async (name) => JSON.parse(await readFile(join(dirname(outputPath), originalManifest.artifacts[name].path), "utf8"));
    const captureMetadata = await readJson("capture_metadata");
    reformatted.trust_graph = deriveProductionTrustGraph({
      captureId: reformatted.capture_id, authenticatedUserId: userId, deviceId,
      devicePublicKeySha256: deviceIdentity.device_public_key_sha256, deviceAuthentication: authentication,
      session, presentationBytes: Buffer.from(state.presentationBase64, "base64"),
      semanticVerification: state.semanticVerification, result: state.result, resultBytes: innerBytes,
      resultSignerKeyId: resultRegistry.keys[0].key_id, resultRegistrySha256: sha256Base64Url(resultRegistryRaw),
      resultRegistryEnvelopeSha256: resultRegistryEnvelopeHash(registryEnvelopeRaw),
      resultRegistryRootKeyId: registryEnvelope.root_key_id, resultRegistryRootPublicKeySpki: spki(rootKey.publicKey),
      proxyProvenance: captureMetadata.proxy_provenance,
    });
    await writeFile(outputPath, JSON.stringify(resign(reformatted)));
    const equivalentInner = await runCli("verify-production-evidence.mjs", state, offlineEnv);
    assert.equal(equivalentInner.status, 0, equivalentInner.stdout + equivalentInner.stderr);
    assert.deepEqual(reformatted.artifacts.result_exact, originalManifest.artifacts.result_exact);
    assert.deepEqual(await readFile(join(dirname(outputPath), reformatted.artifacts.result_exact.path)), bundleArtifacts["result-exact.bin"]);

    const rawOnly = await runCli("capture-production-evidence.mjs", state, {
      TLSN_PRODUCTION_EVIDENCE_OUTPUT_PATH: join(root, `raw-only-${mode}.json`),
      TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PATH: join(bundlePath, "presentation.bin"),
      TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PROVENANCE_JSON: join(bundlePath, "metadata.json"),
      TLSN_PRODUCTION_EVIDENCE_DEVICE_PRIVATE_KEY_PKCS8_FILE: join(root, "must-not-load-device-key"),
    });
    assert.equal(rawOnly.status, 2);
    assert.match(JSON.parse(rawOnly.stdout).error, /BUNDLE_PATH.*raw-only capture is unsupported/);
    assert.equal(rawOnly.trace.length, 0);
    const missingBundleFile = join(bundlePath, "result-exact.bin");
    await rm(missingBundleFile);
    const missingBundleExact = await runCli("capture-production-evidence.mjs", state, captureEnv);
    assert.equal(missingBundleExact.status, 2);
    assert.equal(missingBundleExact.trace.length, 0);
    await writeFile(missingBundleFile, bundleArtifacts["result-exact.bin"]);
    const override = await runCli("capture-production-evidence.mjs", state, {
      ...captureEnv, TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PATH: join(bundlePath, "presentation.bin"),
    });
    assert.equal(override.status, 2);
    assert.equal(override.trace.length, 0);
    console.log(`[tlsn-production-evidence-consumer] ${mode}: capture, independent re-approval, policy pins, exact outer bytes, equivalent inner serialization, bundle-only PASS (test doubles; acceptance BLOCKED)`);
  }
  const bytes = Buffer.from("invalid Presentation");
  await assert.rejects(() => inspectAlpha15Presentation({
    presentationBytes: bytes, notaryRegistry, notaryKeyId: "consumer-fixture-notary",
  }), /cryptographic inspection failed/);
  assert.throws(() => assertProductionEvidenceArtifacts({
    artifacts: { exact: { ...artifactDescriptor(bytes), byte_length: bytes.length + 1 } },
  }, { exact: bytes }), /artifact size mismatch/);
  const inspection = { source: "verified-alpha15-presentation", presentation_sha256: sha256Base64Url(bytes), verified_presentation: { server_identity: serverIdentity } };
  const origin = deriveProductionOriginFromInspection({
    presentationBytes: bytes, inspection, inventoryBytes, approvalBytes,
    referenceInventoryBytes: inventoryBytes, referenceApprovalBytes: approvalBytes,
  });
  assert.throws(() => assertProductionOriginConsistency({
    origin_inventory_sha256: origin.inventorySha256, target_approval_artifact_sha256: origin.approvalSha256,
    server_identity: "outside.kancolle-server.com",
  }, origin, "health"), /Presentation-derived identity mismatch/);
  assert.throws(() => assertProductionOriginConsistency({
    origin_inventory_sha256: Buffer.alloc(32, 0).toString("base64url"),
    target_approval_artifact_sha256: origin.approvalSha256,
  }, origin, "independent pin"), /origin_inventory_sha256/);
  assert.throws(() => deriveProductionOriginFromInspection({
    presentationBytes: bytes, inspection: { ...inspection, source: "capture-metadata" }, inventoryBytes, approvalBytes,
    referenceInventoryBytes: inventoryBytes, referenceApprovalBytes: approvalBytes,
  }), /requires cryptographic inspection/);
  const nonCanonicalInventory = jsonBytes({ ...inventory, extra: true });
  assert.throws(() => deriveProductionOriginFromInspection({
    presentationBytes: bytes, inspection, inventoryBytes: nonCanonicalInventory, approvalBytes,
    referenceInventoryBytes: nonCanonicalInventory, referenceApprovalBytes: approvalBytes,
  }), /non-canonical fields/);
  const nonCanonicalApproval = Buffer.concat([approvalBytes, Buffer.from("\n")]);
  assert.throws(() => deriveProductionOriginFromInspection({
    presentationBytes: bytes, inspection, inventoryBytes, approvalBytes: nonCanonicalApproval,
    referenceInventoryBytes: inventoryBytes, referenceApprovalBytes: nonCanonicalApproval,
  }), /not canonically serialized/);
  const invalidApproval = Buffer.from(serializeTargetApprovalRecord({ ...approvalRecord, inventory_sha256: Buffer.alloc(32, 9).toString("base64url") }));
  assert.throws(() => deriveProductionOriginFromInspection({
    presentationBytes: bytes, inspection, inventoryBytes, approvalBytes: invalidApproval,
    referenceInventoryBytes: inventoryBytes, referenceApprovalBytes: invalidApproval,
  }), /does not match the current approved Production inventory/);
  assert.throws(() => assertExactProductionResultResponse({
    bytes: Buffer.from('{"verified":true}'), result: {}, consumeReceipt: {}, replayDigestHex: "a".repeat(64),
  }), /incomplete/);
} finally {
  await rm(root, { recursive: true, force: true });
}
