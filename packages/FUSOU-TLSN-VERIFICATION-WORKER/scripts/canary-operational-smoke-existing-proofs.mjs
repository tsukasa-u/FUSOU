import { createHash } from "node:crypto";
import {
  verifyConsumeReceipt,
  verifySessionReceipt,
} from "./device-evidence.mjs";
import { assertCanaryVerifierExecutionEvidence } from "./canary-execution-evidence.mjs";
import { RESULT_PRESENTATION_BINDING_FIELDS, verifyProductionPresentation } from "./production-evidence-semantic.mjs";
import { canonicalJson } from "./deployment-attestation.mjs";

export const CANARY_EXISTING_SOURCE_PROOFS_SCHEMA_VERSION = 1;
export const CANARY_EXISTING_SOURCE_PROOFS_SCOPE = "tlsn-canary-operational-smoke-existing-source-proofs";

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is malformed`);
  }
}

function assertTimestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return milliseconds;
}

function requiredBytes(value, label) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);
  throw new Error(`${label} bytes are required`);
}

function sha256Base64Url(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function assertAuthorityTrust(authority, label) {
  assertObject(authority, `${label} trust inputs`);
  if (
    typeof authority.publicKeySpki !== "string" ||
    typeof authority.signerKeyId !== "string" ||
    !authority.keyRegistry || typeof authority.keyRegistry !== "object"
  ) {
    throw new Error(`${label} independently trusted public key, key ID, and registry are required`);
  }
}

export function verifyCanarySessionBindingReceipts({
  session,
  deviceAuthentication,
  consumeReceipt,
  presentationBytes,
  sessionAuthority,
  bindingAuthority,
  now = new Date(),
} = {}) {
  assertObject(session, "Session proof");
  assertObject(deviceAuthentication, "Device Authentication proof");
  assertObject(deviceAuthentication.request, "Device Authentication request");
  assertObject(session.session_receipt, "Session Authority receipt");
  assertObject(consumeReceipt, "Binding Authority consume receipt");
  assertAuthorityTrust(sessionAuthority, "Session Authority");
  assertAuthorityTrust(bindingAuthority, "Binding Authority");
  const presentation = requiredBytes(presentationBytes, "Presentation");
  if (typeof deviceAuthentication.request.nonce !== "string") {
    throw new Error("Device Authentication request nonce is required");
  }
  const nowMilliseconds = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMilliseconds)) throw new Error("source-proof validation time is invalid");

  const receipt = session.session_receipt;
  const issuedAt = assertTimestamp(receipt.created_at, "Session receipt created_at");
  const expiresAt = assertTimestamp(session.expires_at, "Session expires_at");
  if (receipt.expires_at !== session.expires_at || issuedAt > nowMilliseconds || nowMilliseconds >= expiresAt) {
    throw new Error("Session receipt is stale or its expiry does not match the Session");
  }
  const usedAt = assertTimestamp(consumeReceipt.used_at, "consume receipt used_at");
  if (usedAt < issuedAt || usedAt > nowMilliseconds || usedAt >= expiresAt) {
    throw new Error("consume receipt is outside the Session validity window");
  }

  const expectedSession = {
    session_id: session.session_id,
    canonical_user_id: session.canonical_user_id,
    device_id: session.device_id,
    device_auth_nonce: deviceAuthentication.request.nonce,
    nonce: session.challenge,
    device_challenge: session.device_challenge,
    binding_value: session.binding,
    created_at: receipt.created_at,
    expires_at: session.expires_at,
  };
  verifySessionReceipt(receipt, expectedSession, {
    publicKeySpki: sessionAuthority.publicKeySpki,
    signerKeyId: sessionAuthority.signerKeyId,
    keyRegistry: sessionAuthority.keyRegistry,
  });

  const presentationSha256 = sha256Base64Url(presentation);
  verifyConsumeReceipt(consumeReceipt, {
    session_id: session.session_id,
    canonical_user_id: session.canonical_user_id,
    device_id: session.device_id,
    nonce: session.challenge,
    binding_value: session.binding,
    presentation_id: presentationSha256,
    used_at: consumeReceipt.used_at,
  }, {
    publicKeySpki: bindingAuthority.publicKeySpki,
    signerKeyId: bindingAuthority.signerKeyId,
    keyRegistry: bindingAuthority.keyRegistry,
  });

  return {
    status: "PASS",
    authority: "session-and-binding-authorities",
    session_id_sha256: sha256Base64Url(Buffer.from(session.session_id, "utf8")),
    canonical_user_id_sha256: sha256Base64Url(Buffer.from(session.canonical_user_id, "utf8")),
    device_id_sha256: sha256Base64Url(Buffer.from(session.device_id, "utf8")),
    binding_sha256: sha256Base64Url(Buffer.from(session.binding, "utf8")),
    presentation_sha256: presentationSha256,
    session_receipt_sha256: sha256Base64Url(Buffer.from(JSON.stringify(receipt), "utf8")),
    consume_receipt_sha256: sha256Base64Url(Buffer.from(JSON.stringify(consumeReceipt), "utf8")),
    used_at: consumeReceipt.used_at,
  };
}

function parseFinalResult(resultBytes) {
  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(resultBytes));
  } catch {
    throw new Error("exact Canary Result bytes are not valid UTF-8 JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || !body.result || typeof body.result !== "object" || Array.isArray(body.result)) {
    throw new Error("exact Canary Result body does not contain the signed Result object");
  }
  return body.result;
}

export async function verifyCanaryExistingSourceProofBundle({
  session,
  deviceAuthentication,
  consumeReceipt,
  presentationBytes,
  resultBytes,
  verifierExecutionReceiptBytes,
  verifierIdentityKeyRegistry,
  trustedRuntimeIdentity,
  expectedJobId,
  expectedVerificationAttemptId,
  sessionAuthority,
  bindingAuthority,
  deploymentManifest,
  profileSha256,
  notaryRegistry,
  trustAnchorDer,
  disclosureMode = "complete",
  now = new Date(),
} = {}) {
  assertObject(deploymentManifest, "validated deployment manifest");
  const target = deploymentManifest.target;
  const notary = deploymentManifest.notary;
  const profileArtifact = deploymentManifest.artifacts?.find((artifact) => artifact?.name === "profile");
  if (!target || !notary || !profileArtifact) {
    throw new Error("validated deployment manifest is missing server, Notary, or profile identity");
  }
  if (profileArtifact.sha256 !== profileSha256) {
    throw new Error("TLSN profile does not match the validated deployment manifest");
  }
  if (notaryRegistry?.[notary.key_id] !== notary.verifying_key) {
    throw new Error("Notary registry does not match the key selected by the validated deployment manifest");
  }
  const notaryRegistrySha256 = sha256Base64Url(Buffer.from(canonicalJson(notaryRegistry), "utf8"));
  if (notaryRegistrySha256 !== notary.registry_sha256) {
    throw new Error("Notary registry does not match the validated deployment manifest digest");
  }

  const presentation = requiredBytes(presentationBytes, "Presentation");
  const result = requiredBytes(resultBytes, "Result");
  const receiptBytes = requiredBytes(verifierExecutionReceiptBytes, "Verifier execution receipt");
  const sessionBinding = verifyCanarySessionBindingReceipts({
    session,
    deviceAuthentication,
    consumeReceipt,
    presentationBytes: presentation,
    sessionAuthority,
    bindingAuthority,
    now,
  });
  const execution = assertCanaryVerifierExecutionEvidence({
    receiptBytes,
    presentationBytes: presentation,
    resultBytes: result,
    verifierIdentityKeyRegistry,
    trustedRuntimeIdentity,
    expectedJobId,
    expectedVerificationAttemptId,
    now,
  });
  const semantic = await verifyProductionPresentation({
    presentationBytes: presentation,
    serverIdentity: target.server_identity,
    profileSha256,
    verifierKeyId: trustedRuntimeIdentity?.verifier_identity?.verifier_key_id,
    notaryKeyId: notary.key_id,
    canonicalUserId: session.canonical_user_id,
    canonicalDeviceId: session.device_id,
    deviceChallenge: session.device_challenge,
    notaryRegistry,
    trustAnchorDer,
    disclosureMode,
  });
  if (execution.execution.presentation_sha256 !== semantic.presentation_sha256) {
    throw new Error("Verifier execution receipt is not bound to the independently verified Presentation");
  }

  const finalResult = parseFinalResult(result);
  for (const [resultField, semanticField] of RESULT_PRESENTATION_BINDING_FIELDS) {
    if (finalResult[resultField] !== semantic.result[semanticField]) {
      throw new Error(`exact Result bytes do not match the Presentation-derived field: ${resultField}`);
    }
  }
  const sessionBindings = {
    canonical_user_id: session.canonical_user_id,
    device_id: session.device_id,
    device_challenge: session.device_challenge,
    attestation_session_id: session.session_id,
    binding_value: session.binding,
  };
  for (const [field, expected] of Object.entries(sessionBindings)) {
    if (semantic.result[field] !== expected) {
      throw new Error(`Presentation-derived Result does not match the signed Session context: ${field}`);
    }
  }

  return {
    schema_version: CANARY_EXISTING_SOURCE_PROOFS_SCHEMA_VERSION,
    scope: CANARY_EXISTING_SOURCE_PROOFS_SCOPE,
    status: "PASS",
    operational_smoke_effect: "NONE",
    components: {
      session_binding: { status: "PASS", authority: sessionBinding.authority },
      Notary: { status: "PASS", authority: "tlsn-notary-registry" },
      Presentation: {
        status: "PASS",
        authority: "canary-verifier-execution-identity",
        verifier_execution_receipt_sha256: execution.evidence.verifier_execution_receipt_sha256,
      },
    },
    binding: {
      job_id: execution.execution.job_id,
      verification_attempt_id: execution.execution.verification_attempt_id,
      session_id_sha256: sessionBinding.session_id_sha256,
      presentation_sha256: semantic.presentation_sha256,
      result_sha256: execution.execution.result_sha256,
      notary_key_id: notary.key_id,
      verifier_key_id: execution.execution.verifier_key_id,
      verifier_deployment_id: execution.execution.verifier_deployment_id,
      verifier_version_id: execution.execution.verifier_version_id,
    },
    blocked_components: ["callback", "trigger", "DO", "R2", "Auth"],
  };
}