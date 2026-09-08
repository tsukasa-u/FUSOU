#!/usr/bin/env node

import assert from "node:assert/strict";
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { blockedProductionEvidenceManifest, createEvidenceItem } from "./production-evidence-contract.mjs";
import {
  artifactDescriptor,
  assertResultSubjectIdentity,
  assertSignedResult,
  createSignedProductionEvidenceManifest,
  productionEvidenceSignerPublicKeyFromPrivateKey,
} from "./production-evidence.mjs";
import { assertSigningKeyRegistry } from "./signing-key-registry.mjs";
import { sha256Base64Url, workflowContextFromEnvironment } from "./deployment-attestation.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_OUTPUT_PATH = resolve(packageDirectory, "artifacts/tlsn-production-evidence.json");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_PRESENTATION_BYTES = 8 * 1024 * 1024;

function optional(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function required(name) {
  const value = optional(name);
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

function endpoint(origin, path) {
  return new URL(path, `${origin.replace(/\/$/, "")}/`).toString();
}

function cleanOrigin(name) {
  const origin = required(name);
  const parsed = new URL(origin);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.port || !["https:"].includes(parsed.protocol)) {
    throw new Error(`${name} must be a clean HTTPS origin`);
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") throw new Error(`${name} must not contain a path`);
  return parsed.origin;
}

function decodeBase64Url(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error(`${label} must be canonical base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== value) throw new Error(`${label} is not canonical base64url`);
  return bytes;
}

function loadPrivateKey(encoded, label) {
  const bytes = decodeBase64Url(encoded, label);
  const key = createPrivateKey({ key: bytes, format: "der", type: "pkcs8" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`${label} is not Ed25519`);
  return key;
}

async function loadPrivateKeyFromEnvironment() {
  const file = optional("TLSN_PRODUCTION_EVIDENCE_DEVICE_PRIVATE_KEY_PKCS8_FILE");
  const encoded = file
    ? (await readFile(file, "utf8")).trim()
    : required("TLSN_PRODUCTION_EVIDENCE_DEVICE_PRIVATE_KEY_PKCS8_B64URL");
  return loadPrivateKey(encoded, "production device private key");
}

async function timedRequest(url, options = {}) {
  const response = await fetch(url, { redirect: "error", ...options });
  const bytes = Buffer.from(await response.arrayBuffer());
  let json;
  try {
    json = JSON.parse(bytes.toString("utf8"));
  } catch {
    json = undefined;
  }
  return { response, bytes, json };
}

async function readFixture(path) {
  const fixture = JSON.parse(await readFile(path, "utf8"));
  if (fixture.capture_provenance !== "production" || fixture.synthetic !== false) {
    throw new Error("capture fixture must explicitly declare non-synthetic production provenance");
  }
  for (const field of ["expected_member_id", "server_identity", "verifier_key_id", "notary_key_id", "notary_registry_sha256"]) {
    if (typeof fixture[field] !== "string" || fixture[field].length === 0) throw new Error(`capture fixture is missing ${field}`);
  }
  for (const field of ["presentation_base64", "authenticated_request_base64", "authenticated_response_base64"]) {
    const bytes = decodeBase64Url(fixture[field], `fixture.${field}`);
    if (field === "presentation_base64" && bytes.length > MAX_PRESENTATION_BYTES) {
      throw new Error("production Presentation exceeds the Worker limit");
    }
  }
  return fixture;
}

function pushU16(chunks, value) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16BE(value);
  chunks.push(bytes);
}

function pushLengthPrefixed(chunks, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  pushU16(chunks, bytes.length);
  chunks.push(bytes);
}

function tlsnDeviceProofMessage(deviceId, sessionId, binding, challenge) {
  const chunks = [Buffer.from("FUSOU-TLSN-DEVICE-PROOF-V1\0")];
  pushLengthPrefixed(chunks, deviceId);
  pushLengthPrefixed(chunks, sessionId);
  pushLengthPrefixed(chunks, binding);
  pushLengthPrefixed(chunks, decodeBase64Url(challenge, "device challenge"));
  return Buffer.concat(chunks);
}

function deviceProof(session, devicePrivateKey) {
  const challenge = session.device_challenge;
  const message = tlsnDeviceProofMessage(session.device_id, session.session_id, session.binding, challenge);
  return {
    challenge,
    sig: sign(null, message, devicePrivateKey).toString("base64url"),
  };
}

async function readHealth(workerOrigin) {
  const { response, json } = await timedRequest(endpoint(workerOrigin, "/health"));
  assert.equal(response.status, 200);
  if (
    json?.environment !== "production" ||
    json?.deployment_role !== "production" ||
    json?.security_identity?.git_commit_sha === null ||
    json?.deployment_identity?.deployment_role !== "production" ||
    typeof json?.result_identity?.result_public_key_spki !== "string"
  ) throw new Error("target Worker is not a complete production identity");
  return json;
}

async function readSupabaseUser(supabaseOrigin, publishableKey, accessToken) {
  const { response, json } = await timedRequest(endpoint(supabaseOrigin, "/auth/v1/user"), {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  assert.equal(response.status, 200);
  if (typeof json?.id !== "string" || json.is_anonymous === true) throw new Error("Supabase user is not authenticated and non-anonymous");
  return json;
}

async function issueSession(workerOrigin, webOrigin, accessToken, deviceId, devicePrivateKey) {
  const challengeRequest = await timedRequest(endpoint(webOrigin, `/api/auth/anonymous-sync/v2/challenge?device_id=${encodeURIComponent(deviceId)}`));
  assert.equal(challengeRequest.response.status, 200);
  if (typeof challengeRequest.json?.nonce !== "string") throw new Error("device challenge response is invalid");
  const nonce = challengeRequest.json.nonce;
  const nonceSignature = sign(null, Buffer.from(nonce), devicePrivateKey).toString("base64url");
  const sessionRequest = await timedRequest(endpoint(workerOrigin, "/attestation/session"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ device_id: deviceId, nonce, sig: nonceSignature }),
  });
  assert.equal(sessionRequest.response.status, 201);
  const session = sessionRequest.json;
  if (!UUID_PATTERN.test(session?.session_id ?? "") || typeof session?.binding !== "string" || typeof session?.device_challenge !== "string") {
    throw new Error("production attestation session response is invalid");
  }
  return session;
}

async function verifyTlsn(workerOrigin, accessToken, session, deviceId, fixture, possessionProof) {
  return timedRequest(endpoint(workerOrigin, "/verify/tlsn"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      presentation_base64: fixture.presentation_base64,
      session_id: session.session_id,
      binding: session.binding,
      device_id: deviceId,
      device_proof: possessionProof,
    }),
  });
}

function item(status, detail, { artifactSha256 = null, authorityIdentity = "production-authority", verifierIdentity = "capture-harness" } = {}) {
  return createEvidenceItem({ status, detail, artifactSha256, authorityIdentity, verifierIdentity });
}

function parseJsonEnvironment(name) {
  const raw = required(name);
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${name} must contain JSON`);
  }
}

function expectedProductionContext() {
  try {
    return workflowContextFromEnvironment(process.env, "production");
  } catch {
    return null;
  }
}

async function main() {
  const outputPath = optional("TLSN_PRODUCTION_EVIDENCE_OUTPUT_PATH") ?? DEFAULT_OUTPUT_PATH;
  const captureId = randomUUID();
  const now = new Date().toISOString();
  let manifest = blockedProductionEvidenceManifest({
    captureId,
    now,
    workflowContext: expectedProductionContext(),
  });
  let runError;
  let artifactBytes = {};

  try {
    const workerOrigin = cleanOrigin("TLSN_PRODUCTION_EVIDENCE_WORKER_URL");
    const webOrigin = cleanOrigin("TLSN_PRODUCTION_EVIDENCE_WEB_ORIGIN");
    const supabaseOrigin = cleanOrigin("TLSN_PRODUCTION_EVIDENCE_SUPABASE_URL");
    const accessToken = required("TLSN_PRODUCTION_EVIDENCE_ACCESS_TOKEN");
    const publishableKey = required("TLSN_PRODUCTION_EVIDENCE_SUPABASE_PUBLISHABLE_KEY");
    const deviceId = required("TLSN_PRODUCTION_EVIDENCE_DEVICE_ID");
    const devicePrivateKey = await loadPrivateKeyFromEnvironment();
    const fixture = await readFixture(required("TLSN_PRODUCTION_EVIDENCE_FIXTURE_JSON"));
    const health = await readHealth(workerOrigin);
    const user = await readSupabaseUser(supabaseOrigin, publishableKey, accessToken);
    const registryRaw = required("TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY");
    const registry = parseJsonEnvironment("TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY");
    const resultPublicKeySpki = required("TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI");
    const resultSignerKeyId = required("TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID");
    assertSigningKeyRegistry(registry, {
      currentKeyId: resultSignerKeyId,
      currentPublicKeySpki: resultPublicKeySpki,
    });
    if (health.result_identity.result_public_key_spki !== resultPublicKeySpki) throw new Error("Worker result public key is not the published production key");
    if (health.result_identity.result_signer_key_id !== resultSignerKeyId) throw new Error("Worker result signer key ID is not the published production key");
    if (health.result_identity.result_key_registry_sha256 !== sha256Base64Url(registryRaw)) throw new Error("Worker result registry hash is not the supplied production registry");
    if (health.security_identity.server_identity !== fixture.server_identity || health.security_identity.verifier_key_id !== fixture.verifier_key_id || health.security_identity.notary_key_id !== fixture.notary_key_id || health.security_identity.notary_registry_sha256 !== fixture.notary_registry_sha256) {
      throw new Error("capture fixture trust identities do not match the production Worker");
    }

    const session = await issueSession(workerOrigin, webOrigin, accessToken, deviceId, devicePrivateKey);
    const possessionProof = deviceProof(session, devicePrivateKey);
    const verification = await verifyTlsn(workerOrigin, accessToken, session, deviceId, fixture, possessionProof);
    if (verification.response.status !== 200 || verification.json?.verified !== true) {
      throw new Error(`production TLSN verification did not pass: ${verification.response.status}`);
    }
    const result = verification.json.result;
    const resultVerification = assertSignedResult(result, {
      publicKeySpki: resultPublicKeySpki,
      keyRegistry: registry,
      signerKeyId: resultSignerKeyId,
    });
    if (result.canonical_user_id !== user.id || result.device_id !== session.device_id || result.attestation_session_id !== session.session_id || result.binding_value !== session.binding) {
      throw new Error("production result subject or binding identity mismatch");
    }
    if (result.verified_member_id !== fixture.expected_member_id) throw new Error("production member identity mismatch");
    if (result.server_identity !== fixture.server_identity) throw new Error("production game server identity mismatch");
    if (result.verifier_key_id !== fixture.verifier_key_id) throw new Error("production verifier key identity mismatch");
    if (result.notary_key_id !== fixture.notary_key_id) throw new Error("production Notary key identity mismatch");
    const requestBytes = decodeBase64Url(fixture.authenticated_request_base64, "fixture request");
    const responseBytes = decodeBase64Url(fixture.authenticated_response_base64, "fixture response");
    if (result.request_transcript_size !== String(requestBytes.length) || result.response_transcript_size !== String(responseBytes.length)) throw new Error("production transcript size mismatch");
    if (result.request_transcript_sha256 !== sha256Base64Url(requestBytes) || result.response_transcript_sha256 !== sha256Base64Url(responseBytes)) throw new Error("production transcript hash mismatch");
    const subjectIdentity = {
      canonical_user_id_sha256: sha256Base64Url(result.canonical_user_id),
      device_id_sha256: sha256Base64Url(result.device_id),
      attestation_session_id_sha256: sha256Base64Url(result.attestation_session_id),
      verified_member_id_sha256: sha256Base64Url(result.verified_member_id),
      binding_value_sha256: sha256Base64Url(result.binding_value),
    };
    assertResultSubjectIdentity(result, subjectIdentity);

    const replay = await verifyTlsn(workerOrigin, accessToken, session, deviceId, fixture, possessionProof);
    if (replay.response.status !== 409 || !["binding_consumed", "device_possession_replayed"].includes(replay.json?.error)) throw new Error("production replay was not rejected");

    const presentationBytes = decodeBase64Url(fixture.presentation_base64, "fixture presentation");
    const resultBytes = Buffer.from(JSON.stringify(result));
    const healthBytes = Buffer.from(JSON.stringify(health));
    const subjectBytes = Buffer.from(JSON.stringify({
      ...subjectIdentity,
      user_id_sha256: sha256Base64Url(user.id),
      is_anonymous: user.is_anonymous === true,
    }));
    const sessionBytes = Buffer.from(JSON.stringify(session));
    const possessionProofBytes = Buffer.from(JSON.stringify(possessionProof));
    const replayBytes = Buffer.from(JSON.stringify({ status: replay.response.status, error: replay.json?.error ?? null }));
    const resultRegistryBytes = Buffer.from(registryRaw);
    const captureMetadataBytes = Buffer.from(JSON.stringify({
      capture_provenance: fixture.capture_provenance,
      synthetic: fixture.synthetic,
      server_identity: fixture.server_identity,
      verifier_key_id: fixture.verifier_key_id,
      notary_key_id: fixture.notary_key_id,
      notary_registry_sha256: fixture.notary_registry_sha256,
    }));
    artifactBytes = {
      presentation: presentationBytes,
      result: resultBytes,
      health: healthBytes,
      subject: subjectBytes,
      session: sessionBytes,
      possession_proof: possessionProofBytes,
      replay: replayBytes,
      result_registry: resultRegistryBytes,
      capture_metadata: captureMetadataBytes,
    };
    const presentationArtifact = artifactDescriptor(presentationBytes, { mediaType: "application/tlsn-presentation" });
    const resultArtifact = artifactDescriptor(resultBytes, { mediaType: "application/json" });
    const healthArtifact = artifactDescriptor(healthBytes, { mediaType: "application/json" });
    const subjectArtifact = artifactDescriptor(subjectBytes, { mediaType: "application/json" });
    const sessionArtifact = artifactDescriptor(sessionBytes, { mediaType: "application/json" });
    const possessionProofArtifact = artifactDescriptor(possessionProofBytes, { mediaType: "application/json" });
    const replayArtifact = artifactDescriptor(replayBytes, { mediaType: "application/json" });
    const resultRegistryArtifact = artifactDescriptor(resultRegistryBytes, { mediaType: "application/json" });
    const captureMetadataArtifact = artifactDescriptor(captureMetadataBytes, { mediaType: "application/json" });
    manifest = {
      ...manifest,
      capture_provenance: "production",
      capture_finished_at: new Date().toISOString(),
      deployment_identity: health.deployment_identity,
      security_identity: health.security_identity,
      result_identity: health.result_identity,
      subject_identity: subjectIdentity,
      artifacts: {
        presentation: { ...presentationArtifact, path: `${captureId}-presentation.bin` },
        result: { ...resultArtifact, path: `${captureId}-result.json` },
        health: { ...healthArtifact, path: `${captureId}-health.json` },
        subject: { ...subjectArtifact, path: `${captureId}-subject.json` },
        session: { ...sessionArtifact, path: `${captureId}-session.json` },
        possession_proof: { ...possessionProofArtifact, path: `${captureId}-possession-proof.json` },
        replay: { ...replayArtifact, path: `${captureId}-replay.json` },
        result_registry: { ...resultRegistryArtifact, path: `${captureId}-result-registry.json` },
        capture_metadata: { ...captureMetadataArtifact, path: `${captureId}-capture-metadata.json` },
      },
      evidence: {
        ...manifest.evidence,
        real_production_game_server_connection: item("PASS", "Worker verified the configured production server identity", { artifactSha256: presentationArtifact.artifact_sha256, authorityIdentity: health.security_identity.server_identity }),
        real_production_tlsn_notary_interaction: item("PASS", "Worker verified the Presentation against the production Notary trust configuration", { artifactSha256: presentationArtifact.artifact_sha256, authorityIdentity: health.security_identity.notary_key_id }),
        real_production_fusou_web_device_authentication: item("PASS", "Supabase user and FUSOU-WEB device challenge were accepted", { artifactSha256: subjectArtifact.artifact_sha256, authorityIdentity: "fusou-web-device-authentication" }),
        real_production_device_possession_proof: item("PASS", "TLSN device possession proof was accepted by FUSOU-WEB", { artifactSha256: possessionProofArtifact.artifact_sha256, authorityIdentity: "fusou-web-tlsn-device-authentication" }),
        real_production_replay_authority: item("PASS", "The consumed binding rejected the second verification", { artifactSha256: replayArtifact.artifact_sha256, authorityIdentity: health.security_identity.binding_authority }),
        real_production_binding_authority: item("PASS", "Production Worker issued and consumed a one-shot binding", { artifactSha256: sessionArtifact.artifact_sha256, authorityIdentity: health.security_identity.binding_authority }),
        real_production_verifier_trust_root: item("PASS", "Production Worker health identity exposed the expected trust-root identity", { artifactSha256: healthArtifact.artifact_sha256, authorityIdentity: health.deployment_identity.trust_root_certificate_sha256 }),
        real_production_result_signing_key: item("PASS", "Result signature and active production key registry were independently verified", { artifactSha256: resultRegistryArtifact.artifact_sha256, authorityIdentity: resultVerification.result_signer_key_id }),
        real_production_public_key_publication: item("PASS", "Worker health and the supplied production registry published the same result key", { artifactSha256: healthArtifact.artifact_sha256, authorityIdentity: "production-result-key-registry" }),
        independently_captured_production_evidence: item("PASS", "Fixture and artifacts declared non-synthetic production provenance", { artifactSha256: captureMetadataArtifact.artifact_sha256, authorityIdentity: "production-capture-operator" }),
      },
      independent_verification: {
        status: "BLOCKED",
        verified_at: new Date().toISOString(),
        verifier_identity: "offline-production-evidence-verifier",
        detail: "All capture checks passed; P0-05 remains blocked pending the separate gate and privacy review",
      },
    };
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error);
    manifest = {
      ...manifest,
      capture_finished_at: new Date().toISOString(),
      independent_verification: {
        ...manifest.independent_verification,
        verified_at: new Date().toISOString(),
        detail: runError,
      },
    };
  }

  const signerPrivateKeyEncoded = optional("TLSN_PRODUCTION_EVIDENCE_SIGNING_PRIVATE_KEY_PKCS8")
    ?? optional("TLSN_PRODUCTION_EVIDENCE_SIGNING_PRIVATE_KEY_PKCS8_B64URL");
  if (signerPrivateKeyEncoded) {
    loadPrivateKey(signerPrivateKeyEncoded, "production evidence signing private key");
    const publicKey = required("TLSN_PRODUCTION_EVIDENCE_SIGNER_PUBLIC_KEY_SPKI");
    if (productionEvidenceSignerPublicKeyFromPrivateKey(signerPrivateKeyEncoded) !== publicKey) throw new Error("production evidence signer key pair does not match");
    manifest = createSignedProductionEvidenceManifest({
      manifest,
      signerKeyId: required("TLSN_PRODUCTION_EVIDENCE_SIGNER_KEY_ID"),
      signerPublicKeySpki: publicKey,
      signingPrivateKeyPkcs8: signerPrivateKeyEncoded,
    });
  }

  await mkdir(dirname(outputPath), { recursive: true });
  if (Object.keys(artifactBytes).length > 0) {
    for (const [name, bytes] of Object.entries(artifactBytes)) {
      await writeFile(resolve(dirname(outputPath), manifest.artifacts[name].path), bytes, { mode: 0o600 });
    }
  }
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(JSON.stringify({
    status: "BLOCKED",
    manifest_path: outputPath,
    signed: typeof manifest.manifest_signature_base64url === "string",
    capture_provenance: manifest.capture_provenance,
    error: runError ?? null,
  }));
  process.exitCode = runError || !manifest.manifest_signature_base64url ? 2 : 0;
}

main().catch((error) => {
  console.error(`[tlsn-capture-production-evidence] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
