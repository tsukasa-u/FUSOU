#!/usr/bin/env node

import assert from "node:assert/strict";
import { createPrivateKey, randomUUID, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  blockedProductionEvidenceManifest,
  assertVerifiedTrustGraph,
  assertProductionPresentationCaptureMetadata,
  createProductionEvidenceItem,
  deriveProductionTrustGraph,
  productionRequirementStatus,
} from "./production-evidence-contract.mjs";
import {
  artifactDescriptor,
  assertResultSubjectIdentity,
  assertSignedResult,
} from "./production-evidence.mjs";
import { EvidenceSigner } from "./authority-signers.mjs";
import {
  createSemanticVerificationArtifact,
  verifySemanticPredicates,
  verifyProductionPresentation,
} from "./production-evidence-semantic.mjs";
import { assertSigningKeyRegistry } from "./signing-key-registry.mjs";
import { assertAuthorityKeyRegistry } from "./authority-key-registry.mjs";
import { sha256Base64Url, workflowContextFromEnvironment } from "./deployment-attestation.mjs";
import {
  deviceProofReplayDigest,
  deviceProofReplayDigestHex,
  tlsnDeviceProofSigningBytes,
  verifyConsumeReceipt,
  verifyDeviceAuthentication,
  verifySessionReceipt,
  verifyTlsnDevicePossession,
  verifyDevicePredicates,
} from "./device-evidence.mjs";
import { verifyProductionProxyProvenance } from "./proxy-provenance.mjs";
import {
  createProductionEvidenceFailureBundle,
  finalizeProductionEvidenceFailureBundle,
  recordConsume,
  recordFailure,
  recordHash,
  recordHealth,
  recordHttpExchange,
  recordProvenance,
  recordSession,
} from "./production-evidence-failure.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const DEFAULT_OUTPUT_PATH = resolve(packageDirectory, "artifacts/tlsn-production-evidence.json");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_PRESENTATION_BYTES = 8 * 1024 * 1024;
let captureAllowedOrigins = new Set();

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

async function timedRequest(url, options = {}, failureBundle) {
  const parsedUrl = new URL(url);
  if (!captureAllowedOrigins.has(parsedUrl.origin)) {
    throw new Error(`capture endpoint is outside the Worker/FUSOU-WEB/Supabase allowlist: ${parsedUrl.origin}`);
  }
  try {
    const response = await fetch(url, { redirect: "error", ...options });
    const bytes = Buffer.from(await response.arrayBuffer());
    recordHttpExchange(failureBundle, { url, options, response, responseBytes: bytes });
    let json;
    try {
      json = JSON.parse(bytes.toString("utf8"));
    } catch {
      json = undefined;
    }
    return { response, bytes, json };
  } catch (error) {
    recordHttpExchange(failureBundle, { url, options, error });
    throw error;
  }
}

async function readProductionPresentation() {
  const bundleRoot = optional("TLSN_PRODUCTION_EVIDENCE_BUNDLE_PATH")
    ? resolve(required("TLSN_PRODUCTION_EVIDENCE_BUNDLE_PATH"))
    : null;
  const presentationPath = optional("TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PATH")
    ?? (bundleRoot ? resolve(bundleRoot, "presentation.bin") : required("TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PATH"));
  const provenancePath = optional("TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PROVENANCE_JSON")
    ?? (bundleRoot ? resolve(bundleRoot, "metadata.json") : required("TLSN_PRODUCTION_EVIDENCE_PRESENTATION_PROVENANCE_JSON"));
  const presentationBytes = await readFile(presentationPath);
  if (presentationBytes.length === 0 || presentationBytes.length > MAX_PRESENTATION_BYTES) {
    throw new Error("production Presentation size is invalid");
  }
  let provenance;
  try {
    provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  } catch {
    throw new Error("production Presentation provenance must be valid JSON");
  }
  assertProductionPresentationCaptureMetadata(provenance, presentationBytes);
  return { presentationBytes, provenance, bundleRoot };
}

async function readJsonArtifact(bundleRoot, name) {
  if (!bundleRoot) return null;
  try {
    return JSON.parse(await readFile(resolve(bundleRoot, name), "utf8"));
  } catch {
    throw new Error(`production capture bundle is missing valid ${name}`);
  }
}

async function readProductionEvidenceBundle(bundleRoot) {
  if (!bundleRoot) return null;
  const session = await readJsonArtifact(bundleRoot, "session.json");
  const authentication = await readJsonArtifact(bundleRoot, "device-authentication.json");
  const possessionProof = await readJsonArtifact(bundleRoot, "possession-proof.json");
  const verification = await readJsonArtifact(bundleRoot, "worker-verification.json");
  const result = await readJsonArtifact(bundleRoot, "result.json");
  const consumeReceipt = await readJsonArtifact(bundleRoot, "consume-receipt.json");
  if (
    verification?.verified !== true ||
    verification.result === undefined ||
    verification.consume_receipt === undefined ||
    JSON.stringify(verification.result) !== JSON.stringify(result) ||
    JSON.stringify(verification.consume_receipt) !== JSON.stringify(consumeReceipt)
  ) {
    throw new Error("production capture bundle Worker response is incomplete or inconsistent");
  }
  return { session, authentication, possessionProof, verification };
}

function deviceProof(session, devicePrivateKey) {
  const challenge = session.device_challenge;
  const message = tlsnDeviceProofSigningBytes(session.device_id, session.session_id, session.binding, challenge);
  const replayDigest = deviceProofReplayDigest(session.device_id, session.session_id, session.binding, challenge);
  const replayDigestHex = deviceProofReplayDigestHex(session.device_id, session.session_id, session.binding, challenge);
  return {
    device_id: session.device_id,
    session_id: session.session_id,
    binding_value: session.binding,
    challenge,
    sig: sign(null, message, devicePrivateKey).toString("base64url"),
    message_sha256: replayDigest,
    message_sha256_hex: replayDigestHex,
    replay_digest: replayDigest,
    replay_digest_hex: replayDigestHex,
  };
}

async function readHealth(workerOrigin, failureBundle) {
  const { response, json } = await timedRequest(endpoint(workerOrigin, "/health"), {}, failureBundle);
  assert.equal(response.status, 200);
  if (
    json?.environment !== "production" ||
    json?.deployment_role !== "production" ||
    json?.security_identity?.git_commit_sha === null ||
    json?.deployment_identity?.deployment_role !== "production" ||
    typeof json?.result_identity?.result_public_key_spki !== "string"
    || typeof json?.authority_identity?.session_authority?.public_key_spki !== "string"
    || typeof json?.authority_identity?.binding_authority?.public_key_spki !== "string"
  ) throw new Error("target Worker is not a complete production identity");
  recordHealth(failureBundle, json);
  return json;
}

async function readSupabaseUser(supabaseOrigin, publishableKey, accessToken, failureBundle) {
  const { response, json } = await timedRequest(endpoint(supabaseOrigin, "/auth/v1/user"), {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
  }, failureBundle);
  assert.equal(response.status, 200);
  if (typeof json?.id !== "string" || json.is_anonymous === true) throw new Error("Supabase user is not authenticated and non-anonymous");
  return json;
}

async function readDeviceIdentity(webOrigin, accessToken, deviceId, failureBundle) {
  const identityRequest = await timedRequest(endpoint(webOrigin, `/api/auth/anonymous-sync/v2/device-identity?device_id=${encodeURIComponent(deviceId)}`), {
    headers: { Authorization: `Bearer ${accessToken}` },
  }, failureBundle);
  assert.equal(identityRequest.response.status, 200);
  if (identityRequest.json?.device_id !== deviceId || identityRequest.json?.authoritative !== true) {
    throw new Error("production device identity response is invalid");
  }
  return identityRequest.json;
}

async function issueSession(workerOrigin, webOrigin, accessToken, deviceId, devicePrivateKey, failureBundle) {
  const deviceIdentity = await readDeviceIdentity(webOrigin, accessToken, deviceId, failureBundle);
  const challengeRequest = await timedRequest(endpoint(webOrigin, `/api/auth/anonymous-sync/v2/challenge?device_id=${encodeURIComponent(deviceId)}`), {}, failureBundle);
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
  }, failureBundle);
  assert.equal(sessionRequest.response.status, 201);
  const session = sessionRequest.json;
  if (!UUID_PATTERN.test(session?.session_id ?? "") || typeof session?.binding !== "string" || typeof session?.device_challenge !== "string") {
    throw new Error("production attestation session response is invalid");
  }
  recordSession(failureBundle, session);
  return {
    session,
    deviceIdentity,
    authentication: {
      request: { device_id: deviceId, nonce, sig: nonceSignature },
      worker_acceptance: {
        status: sessionRequest.response.status,
        device_id: deviceId,
        session_id: session.session_id,
      },
    },
  };
}

async function verifyTlsn(workerOrigin, accessToken, session, deviceId, presentationBytes, possessionProof, failureBundle) {
  return timedRequest(endpoint(workerOrigin, "/verify/tlsn"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      presentation_base64: presentationBytes.toString("base64url"),
      session_id: session.session_id,
      binding: session.binding,
      device_id: deviceId,
      device_proof: { challenge: possessionProof.challenge, sig: possessionProof.sig },
    }),
  }, failureBundle);
}

function item(requirement, status, detail, { artifactSha256 = null, authorityIdentity = "production-authority", verifierIdentity = "capture-harness" } = {}) {
  return createProductionEvidenceItem(requirement, { status, detail, artifactSha256, authorityIdentity, verifierIdentity });
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
  let failureStage = "initialization";
  const failureBundle = createProductionEvidenceFailureBundle({ captureId, startedAt: now });

  try {
    failureStage = "configuration";
    const workerOrigin = cleanOrigin("TLSN_PRODUCTION_EVIDENCE_WORKER_URL");
    const webOrigin = cleanOrigin("TLSN_PRODUCTION_EVIDENCE_WEB_ORIGIN");
    const supabaseOrigin = cleanOrigin("TLSN_PRODUCTION_EVIDENCE_SUPABASE_URL");
    const accessToken = required("TLSN_PRODUCTION_EVIDENCE_ACCESS_TOKEN");
    const publishableKey = required("TLSN_PRODUCTION_EVIDENCE_SUPABASE_PUBLISHABLE_KEY");
    const deviceId = required("TLSN_PRODUCTION_EVIDENCE_DEVICE_ID");
    captureAllowedOrigins = new Set([workerOrigin, webOrigin, supabaseOrigin]);
    failureStage = "presentation_capture";
    const productionPresentation = await readProductionPresentation();
    const { presentationBytes } = productionPresentation;
    const productionBundle = await readProductionEvidenceBundle(productionPresentation.bundleRoot);
    const devicePrivateKey = productionBundle ? null : await loadPrivateKeyFromEnvironment();
    recordHash(failureBundle, "presentation", presentationBytes);
    recordProvenance(failureBundle, productionPresentation.provenance);
    const proxyProvenancePin = optional("TLSN_PRODUCTION_PROXY_PROVENANCE_PIN_JSON")
      ? parseJsonEnvironment("TLSN_PRODUCTION_PROXY_PROVENANCE_PIN_JSON")
      : null;
    const capturePredicateResults = {
      proxy_provenance_cryptographic_authentication: verifyProductionProxyProvenance({
        captureMetadata: productionPresentation.provenance,
        presentationBytes,
        externalPin: proxyProvenancePin,
        verifiedAt: now,
      }),
    };
    if (capturePredicateResults.proxy_provenance_cryptographic_authentication.status === "FAIL") {
      throw new Error("production proxy provenance verification did not pass");
    }
    failureStage = "worker_health";
    const health = await readHealth(workerOrigin, failureBundle);
    failureStage = "supabase_user";
    const user = await readSupabaseUser(supabaseOrigin, publishableKey, accessToken, failureBundle);
    const registryRaw = required("TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY");
    const registry = parseJsonEnvironment("TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY");
    const sessionAuthorityRegistryRaw = required("TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY");
    const sessionAuthorityRegistry = parseJsonEnvironment("TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY");
    const sessionAuthorityPublicKeySpki = required("TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI");
    const sessionAuthoritySignerKeyId = required("TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID");
    const bindingAuthorityRegistryRaw = required("TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY");
    const bindingAuthorityRegistry = parseJsonEnvironment("TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY");
    const bindingAuthorityPublicKeySpki = required("TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI");
    const bindingAuthoritySignerKeyId = required("TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID");
    const notaryRegistryRaw = required("TLSN_PRODUCTION_NOTARY_REGISTRY");
    const notaryRegistry = (() => {
      try {
        return JSON.parse(notaryRegistryRaw);
      } catch {
        throw new Error("production Notary registry must contain JSON");
      }
    })();
    const resultPublicKeySpki = required("TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI");
    const resultSignerKeyId = required("TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID");
    assertSigningKeyRegistry(registry, {
      currentKeyId: resultSignerKeyId,
      currentPublicKeySpki: resultPublicKeySpki,
    });
    assertAuthorityKeyRegistry(sessionAuthorityRegistry, {
      scope: "tlsn-session-authority-key-registry",
      currentKeyId: sessionAuthoritySignerKeyId,
      currentPublicKeySpki: sessionAuthorityPublicKeySpki,
      label: "session authority",
    });
    assertAuthorityKeyRegistry(bindingAuthorityRegistry, {
      scope: "tlsn-binding-authority-key-registry",
      currentKeyId: bindingAuthoritySignerKeyId,
      currentPublicKeySpki: bindingAuthorityPublicKeySpki,
      label: "binding authority",
    });
    if (health.result_identity.result_public_key_spki !== resultPublicKeySpki) throw new Error("Worker result public key is not the published production key");
    if (health.result_identity.result_signer_key_id !== resultSignerKeyId) throw new Error("Worker result signer key ID is not the published production key");
    if (health.result_identity.result_key_registry_sha256 !== sha256Base64Url(registryRaw)) throw new Error("Worker result registry hash is not the supplied production registry");
    if (health.authority_identity.session_authority.key_id !== sessionAuthoritySignerKeyId || health.authority_identity.session_authority.public_key_spki !== sessionAuthorityPublicKeySpki || health.authority_identity.session_authority.key_registry_sha256 !== sha256Base64Url(sessionAuthorityRegistryRaw)) throw new Error("Worker Session Authority identity is not the supplied registry");
    if (health.authority_identity.binding_authority.key_id !== bindingAuthoritySignerKeyId || health.authority_identity.binding_authority.public_key_spki !== bindingAuthorityPublicKeySpki || health.authority_identity.binding_authority.key_registry_sha256 !== sha256Base64Url(bindingAuthorityRegistryRaw)) throw new Error("Worker Binding Authority identity is not the supplied registry");
    if (health.security_identity.notary_registry_sha256 !== sha256Base64Url(notaryRegistryRaw)) {
      throw new Error("Worker Notary registry hash is not the supplied production registry");
    }

    failureStage = "session_issue";
    const issued = productionBundle
      ? {
          session: productionBundle.session,
          deviceIdentity: await readDeviceIdentity(webOrigin, accessToken, deviceId, failureBundle),
          authentication: productionBundle.authentication,
        }
      : await issueSession(workerOrigin, webOrigin, accessToken, deviceId, devicePrivateKey, failureBundle);
    const session = issued.session;
    verifyDeviceAuthentication(issued.authentication, issued.deviceIdentity, user.id, deviceId, session.session_id);
    verifySessionReceipt(
      session.session_receipt,
      {
        session_id: session.session_id,
        canonical_user_id: user.id,
        device_id: deviceId,
        device_auth_nonce: issued.authentication.request.nonce,
        nonce: session.challenge,
        device_challenge: session.device_challenge,
        binding_value: session.binding,
        created_at: session.session_receipt.created_at,
        expires_at: session.expires_at,
      },
      {
        publicKeySpki: sessionAuthorityPublicKeySpki,
        signerKeyId: sessionAuthoritySignerKeyId,
        keyRegistry: sessionAuthorityRegistry,
      },
    );
    const trustRootDer = optional("TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER");
    const trustRootBytes = trustRootDer ? decodeBase64Url(trustRootDer, "production trust root") : null;
    if (!health.deployment_identity.trust_root_certificate_sha256 || !trustRootDer) {
      throw new Error("the production trust root is required for independent semantic verification");
    }
    if (
      trustRootDer &&
      health.deployment_identity.trust_root_certificate_sha256 !== sha256Base64Url(trustRootBytes)
    ) {
      throw new Error("production trust root does not match Worker health identity");
    }
    const semanticVerification = await verifyProductionPresentation({
      presentationBytes,
      serverIdentity: health.security_identity.server_identity,
      profileSha256: health.security_identity.profile_sha256,
      verifierKeyId: health.security_identity.verifier_key_id,
      notaryKeyId: health.security_identity.notary_key_id,
      canonicalUserId: user.id,
      canonicalDeviceId: session.device_id,
      deviceChallenge: session.device_challenge,
      notaryRegistry,
      trustAnchorDer: trustRootDer,
    });
    const possessionProof = devicePrivateKey ? deviceProof(session, devicePrivateKey) : null;
    const capturedPossessionProof = productionBundle?.possessionProof ?? possessionProof;
    if (!capturedPossessionProof) throw new Error("production possession proof is missing");
    verifyTlsnDevicePossession(
      capturedPossessionProof,
      issued.deviceIdentity,
      user.id,
      deviceId,
      session.session_id,
      session.binding,
      session.device_challenge,
    );
    recordSession(failureBundle, session);
    failureStage = "tlsn_verify";
    const verification = productionBundle
      ? { response: { status: 200 }, json: productionBundle.verification }
      : await verifyTlsn(workerOrigin, accessToken, session, deviceId, presentationBytes, capturedPossessionProof, failureBundle);
    recordHash(failureBundle, "result", Buffer.from(JSON.stringify(verification.json?.result ?? null)));
    recordConsume(failureBundle, verification.json?.consume_receipt);
    if (verification.response.status !== 200 || verification.json?.verified !== true) {
      throw new Error(`production TLSN verification did not pass: ${verification.response.status}`);
    }
    const storedReplayDigestHex = verification.json.device_replay_digest_hex;
    if (!/^[a-f0-9]{64}$/.test(storedReplayDigestHex ?? "") || storedReplayDigestHex !== capturedPossessionProof.replay_digest_hex) {
      throw new Error("production Worker did not return the authoritative stored replay digest");
    }
    const result = verification.json.result;
    verifyConsumeReceipt(
      verification.json.consume_receipt,
      {
        session_id: session.session_id,
        canonical_user_id: user.id,
        device_id: deviceId,
        nonce: session.challenge,
        binding_value: session.binding,
        presentation_id: sha256Base64Url(presentationBytes),
        used_at: verification.json.consume_receipt?.used_at,
      },
      {
        publicKeySpki: bindingAuthorityPublicKeySpki,
        signerKeyId: bindingAuthoritySignerKeyId,
        keyRegistry: bindingAuthorityRegistry,
      },
    );
    const trustedInputs = {
      server_identity: health.security_identity.server_identity,
      profile_id: "fusou-require-info-v1",
      profile_sha256: health.security_identity.profile_sha256,
      verifier_key_id: health.security_identity.verifier_key_id,
      notary_key_id: health.security_identity.notary_key_id,
      notary_key_sha256: sha256Base64Url(Buffer.from(notaryRegistry[health.security_identity.notary_key_id], "base64url")),
      trust_root_certificate_sha256: health.deployment_identity.trust_root_certificate_sha256,
      result_public_key_spki: health.result_identity.result_public_key_spki,
      result_signer_key_id: health.result_identity.result_signer_key_id,
      result_key_registry_sha256: health.result_identity.result_key_registry_sha256,
    };
    const preSignaturePredicateResults = verifySemanticPredicates({
      presentationBytes,
      semanticVerification,
      result,
      trustedInputs,
      notaryRegistry,
      resultRegistry: registry,
      resultRegistrySha256: sha256Base64Url(Buffer.from(registryRaw)),
      resultPublicKeySpki,
      resultSignerKeyId,
      trustRootCertificateBytes: trustRootBytes,
      sessionBinding: session.binding,
      sessionId: session.session_id,
      includeResultSignature: false,
    });
    if (Object.entries(preSignaturePredicateResults).some(([name, predicate]) => name !== "result_signature" && predicate.status !== "PASS")) {
      throw new Error("one or more independent Presentation predicates did not pass");
    }
    const resultVerification = assertSignedResult(result, {
      publicKeySpki: resultPublicKeySpki,
      keyRegistry: registry,
      signerKeyId: resultSignerKeyId,
    });
    const predicateResults = verifySemanticPredicates({
      presentationBytes,
      semanticVerification,
      result,
      trustedInputs,
      notaryRegistry,
      resultRegistry: registry,
      resultRegistrySha256: sha256Base64Url(Buffer.from(registryRaw)),
      resultPublicKeySpki,
      resultSignerKeyId,
      trustRootCertificateBytes: trustRootBytes,
      sessionBinding: session.binding,
      sessionId: session.session_id,
    });
    if (Object.values(predicateResults).some((predicate) => predicate.status !== "PASS")) {
      throw new Error("one or more semantic predicates did not pass");
    }
    if (result.canonical_user_id !== user.id || result.device_id !== session.device_id || result.attestation_session_id !== session.session_id || result.binding_value !== session.binding) {
      throw new Error("production result subject or binding identity mismatch");
    }
    if (
      result.server_identity !== health.security_identity.server_identity ||
      result.profile_sha256 !== health.security_identity.profile_sha256 ||
      result.verifier_key_id !== health.security_identity.verifier_key_id ||
      result.notary_key_id !== health.security_identity.notary_key_id
    ) throw new Error("production result security identity mismatch");
    const subjectIdentity = {
      canonical_user_id_sha256: sha256Base64Url(result.canonical_user_id),
      device_id_sha256: sha256Base64Url(result.device_id),
      attestation_session_id_sha256: sha256Base64Url(result.attestation_session_id),
      verified_member_id_sha256: sha256Base64Url(result.verified_member_id),
      binding_value_sha256: sha256Base64Url(result.binding_value),
    };
    assertResultSubjectIdentity(result, subjectIdentity);

    failureStage = "tlsn_replay";
    const replay = await verifyTlsn(workerOrigin, accessToken, session, deviceId, presentationBytes, capturedPossessionProof, failureBundle);
    if (replay.response.status !== 409 || !["binding_consumed", "device_possession_replayed"].includes(replay.json?.error)) throw new Error("production replay was not rejected");
    const devicePredicateResults = verifyDevicePredicates({
      deviceIdentity: issued.deviceIdentity,
      deviceAuthentication: issued.authentication,
      session,
      possessionProof: capturedPossessionProof,
      consumeReceipt: verification.json.consume_receipt,
      replay: {
        session_id: session.session_id,
        device_id: session.device_id,
        binding: session.binding,
        status: replay.response.status,
        error: replay.json?.error ?? null,
        replay_digest: capturedPossessionProof.replay_digest,
        replay_digest_hex: capturedPossessionProof.replay_digest_hex,
        stored_replay_digest_hex: storedReplayDigestHex,
        consume_receipt_presentation_id: verification.json.consume_receipt.presentation_id,
      },
      result,
      authoritativeUserId: user.id,
      authoritativeDeviceId: deviceId,
      presentationBytes,
      resultPublicKeySpki,
      resultSignerKeyId,
      sessionAuthorityPublicKeySpki,
      sessionAuthoritySignerKeyId,
      sessionAuthorityKeyRegistry: sessionAuthorityRegistry,
      bindingAuthorityPublicKeySpki,
      bindingAuthoritySignerKeyId,
      bindingAuthorityKeyRegistry: bindingAuthorityRegistry,
    });

    const resultBytes = Buffer.from(JSON.stringify(result));
    const healthBytes = Buffer.from(JSON.stringify(health));
    const subjectBytes = Buffer.from(JSON.stringify({
      ...subjectIdentity,
      user_id_sha256: sha256Base64Url(user.id),
      is_anonymous: user.is_anonymous === true,
    }));
    const authenticatedUserBytes = Buffer.from(JSON.stringify({
      authoritative: true,
      authority: "supabase-authenticated-user",
      user_id: user.id,
      is_anonymous: user.is_anonymous === true,
    }));
    const sessionBytes = Buffer.from(JSON.stringify(session));
    const deviceIdentityBytes = Buffer.from(JSON.stringify(issued.deviceIdentity));
    const deviceAuthenticationBytes = Buffer.from(JSON.stringify(issued.authentication));
    const possessionProofBytes = Buffer.from(JSON.stringify(possessionProof));
    const consumeReceiptBytes = Buffer.from(JSON.stringify(verification.json.consume_receipt));
    const replayBytes = Buffer.from(JSON.stringify({
      session_id: session.session_id,
      device_id: session.device_id,
      binding: session.binding,
      status: replay.response.status,
      error: replay.json?.error ?? null,
      replay_digest: possessionProof.replay_digest,
      replay_digest_hex: possessionProof.replay_digest_hex,
      stored_replay_digest_hex: storedReplayDigestHex,
      consume_receipt_presentation_id: verification.json.consume_receipt.presentation_id,
    }));
    const resultRegistryBytes = Buffer.from(registryRaw);
    const sessionAuthorityRegistryBytes = Buffer.from(sessionAuthorityRegistryRaw);
    const bindingAuthorityRegistryBytes = Buffer.from(bindingAuthorityRegistryRaw);
    const notaryRegistryBytes = Buffer.from(notaryRegistryRaw);
    const trustRootArtifactBytes = trustRootBytes;
    const semanticVerificationArtifact = createSemanticVerificationArtifact({
      presentationBytes,
      semanticVerification,
      result,
      predicateResults,
      trustedInputs,
      verifierIdentity: "capture-harness-semantic-verifier",
    });
    const semanticVerificationBytes = Buffer.from(JSON.stringify(semanticVerificationArtifact));
    const captureMetadataBytes = Buffer.from(JSON.stringify({
      ...productionPresentation.provenance,
      presentation_sha256: sha256Base64Url(presentationBytes),
      observed_result: {
        server_identity: result.server_identity,
        verifier_key_id: result.verifier_key_id,
        notary_key_id: result.notary_key_id,
        verified_member_id: result.verified_member_id,
      },
      authority: "production-tlsn-capture-provenance",
    }));
    artifactBytes = {
      presentation: presentationBytes,
      result: resultBytes,
      health: healthBytes,
      subject: subjectBytes,
      authenticated_user: authenticatedUserBytes,
      session: sessionBytes,
      device_identity: deviceIdentityBytes,
      device_authentication: deviceAuthenticationBytes,
      possession_proof: possessionProofBytes,
      consume_receipt: consumeReceiptBytes,
      replay: replayBytes,
      result_registry: resultRegistryBytes,
      session_authority_registry: sessionAuthorityRegistryBytes,
      binding_authority_registry: bindingAuthorityRegistryBytes,
      notary_registry: notaryRegistryBytes,
      capture_metadata: captureMetadataBytes,
      semantic_verification: semanticVerificationBytes,
    };
    if (trustRootArtifactBytes) artifactBytes.trust_root = trustRootArtifactBytes;
    const presentationArtifact = artifactDescriptor(presentationBytes, { mediaType: "application/tlsn-presentation" });
    const resultArtifact = artifactDescriptor(resultBytes, { mediaType: "application/json" });
    const healthArtifact = artifactDescriptor(healthBytes, { mediaType: "application/json" });
    const subjectArtifact = artifactDescriptor(subjectBytes, { mediaType: "application/json" });
    const authenticatedUserArtifact = artifactDescriptor(authenticatedUserBytes, { mediaType: "application/json" });
    const sessionArtifact = artifactDescriptor(sessionBytes, { mediaType: "application/json" });
    const deviceIdentityArtifact = artifactDescriptor(deviceIdentityBytes, { mediaType: "application/json" });
    const deviceAuthenticationArtifact = artifactDescriptor(deviceAuthenticationBytes, { mediaType: "application/json" });
    const possessionProofArtifact = artifactDescriptor(possessionProofBytes, { mediaType: "application/json" });
    const consumeReceiptArtifact = artifactDescriptor(consumeReceiptBytes, { mediaType: "application/json" });
    const replayArtifact = artifactDescriptor(replayBytes, { mediaType: "application/json" });
    const resultRegistryArtifact = artifactDescriptor(resultRegistryBytes, { mediaType: "application/json" });
    const sessionAuthorityRegistryArtifact = artifactDescriptor(sessionAuthorityRegistryBytes, { mediaType: "application/json" });
    const bindingAuthorityRegistryArtifact = artifactDescriptor(bindingAuthorityRegistryBytes, { mediaType: "application/json" });
    const notaryRegistryArtifact = artifactDescriptor(notaryRegistryBytes, { mediaType: "application/json" });
    const trustRootArtifact = trustRootArtifactBytes
      ? artifactDescriptor(trustRootArtifactBytes, { mediaType: "application/pkix-cert" })
      : null;
    const semanticVerificationArtifactDescriptor = artifactDescriptor(semanticVerificationBytes, { mediaType: "application/json" });
    const captureMetadataArtifact = artifactDescriptor(captureMetadataBytes, { mediaType: "application/json" });
    const trustGraph = deriveProductionTrustGraph({
      captureId,
      authenticatedUserId: user.id,
      deviceId,
      devicePublicKeySha256: issued.deviceIdentity.device_public_key_sha256,
      deviceAuthentication: issued.authentication,
      session,
      presentationBytes,
      semanticVerification,
      result,
      resultBytes,
      resultSignerKeyId,
      proxyProvenance: productionPresentation.provenance.proxy_provenance,
    });
    assertVerifiedTrustGraph(trustGraph, {
      ...predicateResults,
      ...devicePredicateResults,
      ...capturePredicateResults,
      remote_attestation_unverified: { status: "UNVERIFIED" },
    });
    const allPredicateResults = { ...predicateResults, ...devicePredicateResults, ...capturePredicateResults };
    manifest = {
      ...manifest,
      capture_provenance: "production",
      capture_finished_at: new Date().toISOString(),
      deployment_identity: health.deployment_identity,
      security_identity: health.security_identity,
      result_identity: health.result_identity,
      subject_identity: subjectIdentity,
      trust_graph: trustGraph,
      artifacts: {
        presentation: { ...presentationArtifact, path: `${captureId}-presentation.bin` },
        result: { ...resultArtifact, path: `${captureId}-result.json` },
        health: { ...healthArtifact, path: `${captureId}-health.json` },
        subject: { ...subjectArtifact, path: `${captureId}-subject.json` },
        authenticated_user: { ...authenticatedUserArtifact, path: `${captureId}-authenticated-user.json` },
        session: { ...sessionArtifact, path: `${captureId}-session.json` },
        device_identity: { ...deviceIdentityArtifact, path: `${captureId}-device-identity.json` },
        device_authentication: { ...deviceAuthenticationArtifact, path: `${captureId}-device-authentication.json` },
        possession_proof: { ...possessionProofArtifact, path: `${captureId}-possession-proof.json` },
        consume_receipt: { ...consumeReceiptArtifact, path: `${captureId}-consume-receipt.json` },
        replay: { ...replayArtifact, path: `${captureId}-replay.json` },
        result_registry: { ...resultRegistryArtifact, path: `${captureId}-result-registry.json` },
        session_authority_registry: { ...sessionAuthorityRegistryArtifact, path: `${captureId}-session-authority-registry.json` },
        binding_authority_registry: { ...bindingAuthorityRegistryArtifact, path: `${captureId}-binding-authority-registry.json` },
        notary_registry: { ...notaryRegistryArtifact, path: `${captureId}-notary-registry.json` },
        capture_metadata: { ...captureMetadataArtifact, path: `${captureId}-capture-metadata.json` },
        semantic_verification: {
          ...semanticVerificationArtifactDescriptor,
          path: `${captureId}-semantic-verification.json`,
        },
        ...(trustRootArtifact ? { trust_root: { ...trustRootArtifact, path: `${captureId}-trust-root.der` } } : {}),
      },
      semantic_predicates: semanticVerificationArtifact.predicates,
      capture_predicates: capturePredicateResults,
      device_predicates: devicePredicateResults,
      semantic_verification: {
        status: "VERIFIED",
        artifact: "semantic_verification",
        verifier_identity: semanticVerificationArtifact.verifier_identity,
        verified_at: semanticVerificationArtifact.verified_at,
      },
      capture_status: "PASS",
      verification_status: "VERIFIED",
      production_evidence_status: "BLOCKED",
      p0_05_status: "BLOCKED",
      evidence: {
        ...manifest.evidence,
        real_production_game_server_connection: item("real_production_game_server_connection", productionRequirementStatus("real_production_game_server_connection", allPredicateResults), "Independent alpha15 semantic verification derived the authenticated server identity", { artifactSha256: presentationArtifact.artifact_sha256, authorityIdentity: health.security_identity.server_identity }),
        real_production_tlsn_notary_interaction: item("real_production_tlsn_notary_interaction", productionRequirementStatus("real_production_tlsn_notary_interaction", allPredicateResults), "Independent alpha15 semantic verification matched the production Notary registry", { artifactSha256: presentationArtifact.artifact_sha256, authorityIdentity: health.security_identity.notary_key_id }),
        real_production_tlsn_proxy_provenance: item("real_production_tlsn_proxy_provenance", productionRequirementStatus("real_production_tlsn_proxy_provenance", allPredicateResults), "Production proxy provenance remains governed separately from Presentation authority evidence", { artifactSha256: captureMetadataArtifact.artifact_sha256, authorityIdentity: capturePredicateResults.proxy_provenance_cryptographic_authentication.authority_identity }),
        real_production_fusou_web_device_authentication: item("real_production_fusou_web_device_authentication", productionRequirementStatus("real_production_fusou_web_device_authentication", allPredicateResults), "FUSOU-WEB authoritative device identity and generic nonce signature were independently verified", { artifactSha256: deviceAuthenticationArtifact.artifact_sha256, authorityIdentity: "fusou-web-user-devices" }),
        real_production_device_possession_proof: item("real_production_device_possession_proof", productionRequirementStatus("real_production_device_possession_proof", allPredicateResults), "Canonical TLSN device possession signature and replay digest were independently verified", { artifactSha256: possessionProofArtifact.artifact_sha256, authorityIdentity: "fusou-web-tlsn-device-authentication" }),
        real_production_replay_authority: item("real_production_replay_authority", productionRequirementStatus("real_production_replay_authority", allPredicateResults), "The consumed binding rejected the second verification and the replay digest was independently reconstructed", { artifactSha256: replayArtifact.artifact_sha256, authorityIdentity: health.security_identity.binding_authority }),
        real_production_binding_authority: item("real_production_binding_authority", productionRequirementStatus("real_production_binding_authority", allPredicateResults), "Signed Worker session and consume receipts bind the verified Result to a one-shot binding", { artifactSha256: consumeReceiptArtifact.artifact_sha256, authorityIdentity: health.security_identity.binding_authority }),
        real_production_session_authority: item("real_production_session_authority", productionRequirementStatus("real_production_session_authority", allPredicateResults), "Session receipt and the published Session Authority registry were independently verified", { artifactSha256: sessionAuthorityRegistryArtifact.artifact_sha256, authorityIdentity: sessionAuthoritySignerKeyId }),
        real_production_binding_receipt_authority: item("real_production_binding_receipt_authority", productionRequirementStatus("real_production_binding_receipt_authority", allPredicateResults), "Consume receipt and the published Binding Authority registry were independently verified", { artifactSha256: bindingAuthorityRegistryArtifact.artifact_sha256, authorityIdentity: bindingAuthoritySignerKeyId }),
        real_production_verifier_trust_root: item("real_production_verifier_trust_root", productionRequirementStatus("real_production_verifier_trust_root", allPredicateResults), "Captured trust-root bytes matched the deployed Worker identity", { artifactSha256: trustRootArtifact?.artifact_sha256 ?? healthArtifact.artifact_sha256, authorityIdentity: health.deployment_identity.trust_root_certificate_sha256 }),
        real_production_result_signing_key: item("real_production_result_signing_key", productionRequirementStatus("real_production_result_signing_key", allPredicateResults), "Result signature and active production key registry were independently verified", { artifactSha256: resultRegistryArtifact.artifact_sha256, authorityIdentity: resultVerification.result_signer_key_id }),
        real_production_public_key_publication: item("real_production_public_key_publication", productionRequirementStatus("real_production_public_key_publication", allPredicateResults), "Worker health and the supplied production registry published the same result key", { artifactSha256: healthArtifact.artifact_sha256, authorityIdentity: "production-result-key-registry" }),
        independently_captured_production_evidence: item("independently_captured_production_evidence", productionRequirementStatus("independently_captured_production_evidence", allPredicateResults), "Production endpoints, device signatures, binding receipts, and an independently verified Presentation were captured", { artifactSha256: semanticVerificationArtifactDescriptor.artifact_sha256, authorityIdentity: "production-capture-operator" }),
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
    recordFailure(failureBundle, { stage: failureStage, error, finishedAt: new Date().toISOString() });
    manifest = {
      ...manifest,
      capture_finished_at: new Date().toISOString(),
      capture_status: "FAILED",
      verification_status: "FAILED",
      independent_verification: {
        ...manifest.independent_verification,
        verified_at: new Date().toISOString(),
        detail: runError,
      },
    };
    const failureBundleBytes = Buffer.from(`${JSON.stringify(finalizeProductionEvidenceFailureBundle(failureBundle, manifest.capture_finished_at), null, 2)}\n`);
    artifactBytes.failure_bundle = failureBundleBytes;
    manifest.artifacts = {
      ...(manifest.artifacts ?? {}),
      failure_bundle: {
        ...artifactDescriptor(failureBundleBytes, { mediaType: "application/json" }),
        path: `${captureId}-failure-bundle.json`,
      },
    };
  }

  const signerPrivateKeyEncoded = optional("TLSN_PRODUCTION_EVIDENCE_SIGNING_PRIVATE_KEY_PKCS8")
    ?? optional("TLSN_PRODUCTION_EVIDENCE_SIGNING_PRIVATE_KEY_PKCS8_B64URL");
  if (signerPrivateKeyEncoded) {
    const publicKey = required("TLSN_PRODUCTION_EVIDENCE_SIGNER_PUBLIC_KEY_SPKI");
    manifest = new EvidenceSigner({
      keyId: required("TLSN_PRODUCTION_EVIDENCE_SIGNER_KEY_ID"),
      privateKeyPkcs8: signerPrivateKeyEncoded,
      publicKeySpki: publicKey,
    }).signManifest(manifest);
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
    failure_bundle_path: manifest.artifacts?.failure_bundle?.path ?? null,
    error: runError ?? null,
  }));
  process.exitCode = runError || !manifest.manifest_signature_base64url ? 2 : 0;
}

main().catch((error) => {
  console.error(`[tlsn-capture-production-evidence] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
