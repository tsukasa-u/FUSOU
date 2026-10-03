import { createHash } from "node:crypto";
import {
  verifyDeviceAuthentication,
  verifyConsumeReceipt,
  verifySessionReceipt,
  verifyTlsnDevicePossession,
} from "./device-evidence.mjs";
import { assertCanaryVerifierExecutionEvidence } from "./canary-execution-evidence.mjs";
import {
  inspectAlpha15Presentation,
  inspectSyntheticFixtureAlpha15Presentation,
  RESULT_PRESENTATION_BINDING_FIELDS,
  verifyProductionPresentation,
  verifySyntheticFixturePresentation,
} from "./production-evidence-semantic.mjs";
import { canonicalJson } from "./deployment-attestation.mjs";
import { assertSignedResult, assertSignedSparseResult } from "./production-evidence.mjs";
import { assertSignedResultRegistryEnvelope, resultRegistryEnvelopeHash } from "./result-registry-envelope.mjs";

export const CANARY_EXISTING_SOURCE_PROOFS_SCHEMA_VERSION = 2;
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
    scope: "signed Worker-issued Session and consume claims; does not establish current Supabase ownership or Durable Object state",
    session_id_sha256: sha256Base64Url(Buffer.from(session.session_id, "utf8")),
    canonical_user_id_sha256: sha256Base64Url(Buffer.from(session.canonical_user_id, "utf8")),
    device_id_sha256: sha256Base64Url(Buffer.from(session.device_id, "utf8")),
    binding_sha256: sha256Base64Url(Buffer.from(session.binding, "utf8")),
    presentation_sha256: presentationSha256,
    session_receipt_object_sha256: sha256Base64Url(Buffer.from(JSON.stringify(receipt), "utf8")),
    consume_receipt_object_sha256: sha256Base64Url(Buffer.from(JSON.stringify(consumeReceipt), "utf8")),
    used_at: consumeReceipt.used_at,
  };
}

export function verifyCanaryDeviceAuthenticationProof({
  deviceAuthentication,
  deviceIdentity,
  session,
} = {}) {
  assertObject(session, "Session proof");
  assertObject(deviceAuthentication, "Device Authentication proof");
  assertObject(deviceIdentity, "Device identity artifact");
  verifyDeviceAuthentication(
    deviceAuthentication,
    deviceIdentity,
    session.canonical_user_id,
    session.device_id,
    session.session_id,
  );
  return {
    status: "PASS",
    signature_algorithm: "Ed25519",
    signed_message: "UTF-8 bytes of the lowercase 64-hex deviceAuthentication.request.nonce",
    public_key_sha256: deviceIdentity.device_public_key_sha256,
    authority_state: "UNVERIFIED",
    nonce_freshness: "UNVERIFIED",
    nonce_replay_state: "UNVERIFIED",
  };
}

export function verifyCanaryTlsnDevicePossessionProof({
  possessionProof,
  deviceIdentity,
  session,
} = {}) {
  assertObject(session, "Session proof");
  assertObject(deviceIdentity, "Device identity artifact");
  assertObject(possessionProof, "TLSN device possession proof");
  const verified = verifyTlsnDevicePossession(
    possessionProof,
    deviceIdentity,
    session.canonical_user_id,
    session.device_id,
    session.session_id,
    session.binding,
    session.device_challenge,
  );
  return {
    status: "PASS",
    signature_algorithm: "Ed25519",
    signed_message: "FUSOU-TLSN-DEVICE-PROOF-V1 domain plus length-prefixed device, Session, binding, and 32-byte challenge",
    replay_digest_sha256: verified.replayDigest,
    public_key_sha256: deviceIdentity.device_public_key_sha256,
    authority_state: "UNVERIFIED",
    nonce_replay_state: "UNVERIFIED",
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
  return body;
}

export function verifyCanaryResultSignature({
  finalResponse,
  resultAuthority,
  trustedRuntimeIdentity,
  now = new Date(),
} = {}) {
  assertObject(finalResponse, "exact Result response");
  assertObject(finalResponse.result, "signed inner Result");
  assertObject(resultAuthority, "trusted Result authority");
  if (finalResponse.verified !== true || finalResponse.signature_algorithm !== "Ed25519") {
    throw new Error("exact Result response signature metadata is invalid");
  }
  if (finalResponse.signer_key_id !== resultAuthority.signerKeyId) {
    throw new Error("exact Result response signer key ID does not match the trusted Result authority");
  }
  const registryBytes = requiredBytes(resultAuthority.keyRegistryRawBytes, "Result signing key registry");
  const envelopeBytes = requiredBytes(resultAuthority.registryEnvelopeRawBytes, "Result signing key registry envelope");
  let parsedRegistry;
  let parsedEnvelope;
  try {
    parsedRegistry = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(registryBytes));
    parsedEnvelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(envelopeBytes));
  } catch {
    throw new Error("trusted Result registry artifacts are not valid UTF-8 JSON");
  }
  if (canonicalJson(parsedRegistry) !== canonicalJson(resultAuthority.keyRegistry)) {
    throw new Error("Result signing key registry object does not match its exact captured bytes");
  }
  if (canonicalJson(parsedEnvelope) !== canonicalJson(resultAuthority.registryEnvelope)) {
    throw new Error("Result signing key registry envelope object does not match its exact captured bytes");
  }
  assertSignedResultRegistryEnvelope(parsedEnvelope, {
    registry: parsedRegistry,
    registryRaw: registryBytes,
    trustedRootKeyId: resultAuthority.trustedRootKeyId,
    trustedRootPublicKeySpki: resultAuthority.trustedRootPublicKeySpki,
  });

  const signedResult = finalResponse.result;
  const resultVerification = signedResult.version === 2
    ? assertSignedSparseResult(signedResult, {
        publicKeySpki: resultAuthority.publicKeySpki,
        keyRegistry: parsedRegistry,
        signerKeyId: resultAuthority.signerKeyId,
        now,
      })
    : signedResult.version === 1
      ? assertSignedResult(signedResult, {
          publicKeySpki: resultAuthority.publicKeySpki,
          keyRegistry: parsedRegistry,
          signerKeyId: resultAuthority.signerKeyId,
          now,
        })
      : (() => { throw new Error("signed Result version is unsupported"); })();

  if (trustedRuntimeIdentity?.status === "VALID") {
    assertObject(trustedRuntimeIdentity, "validated Runtime Attestation identity");
    const runtimeSigner = trustedRuntimeIdentity.result_signer_identity;
    assertObject(runtimeSigner, "validated Runtime Attestation Result signer identity");
    if (trustedRuntimeIdentity.status !== "VALID" || trustedRuntimeIdentity.signature_valid !== true || runtimeSigner.status !== "VALID") {
      throw new Error("Result signer deployment binding requires a valid signed Runtime Attestation identity");
    }
    for (const [field, actual] of Object.entries({
      signer_key_id: resultVerification.result_signer_key_id,
      public_key_spki: resultAuthority.publicKeySpki,
      public_key_spki_sha256: sha256Base64Url(Buffer.from(resultAuthority.publicKeySpki, "base64url")),
      key_registry_sha256: sha256Base64Url(registryBytes),
      key_registry_envelope_sha256: resultRegistryEnvelopeHash(envelopeBytes),
      registry_root_key_id: resultAuthority.trustedRootKeyId,
      registry_root_public_key_spki: resultAuthority.trustedRootPublicKeySpki,
    })) {
      if (runtimeSigner[field] !== actual) {
        throw new Error(`signed Result does not match Runtime Attestation Result signer ${field}`);
      }
    }
    for (const [field, actual] of Object.entries({
      deployment_id: trustedRuntimeIdentity.deployment_id,
      worker_name: trustedRuntimeIdentity.worker_name,
      version_id: trustedRuntimeIdentity.version_id,
    })) {
      if (!actual || runtimeSigner[field] !== actual) {
        throw new Error(`Runtime Attestation Result signer ${field} is not bound to the Main Worker identity`);
      }
    }
  }

  return {
    status: "PASS",
    signature_algorithm: "Ed25519",
    signed_bytes_format: signedResult.version === 2
      ? "FUSOU-VERIFIER-SPARSE-RESULT-V1 domain-separated field encoding"
      : "FUSOU-VERIFIER-RESULT-V1 domain-separated field encoding",
    result_signer_key_id: resultVerification.result_signer_key_id,
    result_signature_valid: resultVerification.result_signature_valid,
    result_key_status: resultVerification.result_signing_key_status,
    result_public_key_spki: resultAuthority.publicKeySpki,
    registry_sha256: sha256Base64Url(registryBytes),
    registry_envelope_sha256: resultRegistryEnvelopeHash(envelopeBytes),
    trusted_registry_root_key_id: resultAuthority.trustedRootKeyId,
    deployment_binding: "UNVERIFIED",
  };
}

export function verifyCanaryOfflineCryptographicProofs({
  session,
  deviceAuthentication,
  deviceIdentity,
  possessionProof,
  finalResponse,
  resultAuthority,
  trustedRuntimeIdentity,
  now = new Date(),
} = {}) {
  const deviceAuthenticationProof = verifyCanaryDeviceAuthenticationProof({
    deviceAuthentication,
    deviceIdentity,
    session,
  });
  const tlsnDevicePossession = verifyCanaryTlsnDevicePossessionProof({
    possessionProof,
    deviceIdentity,
    session,
  });
  const resultSignature = verifyCanaryResultSignature({ finalResponse, resultAuthority, trustedRuntimeIdentity, now });
  return {
    status: "PASS",
    scope: "provided device signatures and root-pinned Result signer registry only",
    components: {
      device_auth_signature: deviceAuthenticationProof,
      tlsn_device_possession: tlsnDevicePossession,
      result_signature: resultSignature,
    },
  };
}

export async function verifyCanaryExistingSourceProofBundle({
  session,
  deviceAuthentication,
  deviceIdentity,
  possessionProof,
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
  resultAuthority,
  deploymentManifest,
  profileSha256,
  notaryRegistry,
  trustAnchorDer,
  disclosureMode = "complete",
  syntheticFixture = false,
  now = new Date(),
} = {}) {
  if (typeof syntheticFixture !== "boolean") {
    throw new Error("synthetic fixture classification must be boolean");
  }
  if (trustAnchorDer !== undefined && !syntheticFixture) {
    throw new Error("custom Origin trust anchors are allowed only for synthetic fixtures");
  }
  assertObject(deploymentManifest, "validated deployment manifest");
  const target = deploymentManifest.target;
  const notary = deploymentManifest.notary;
  const profileArtifact = deploymentManifest.artifacts?.find((artifact) => artifact?.name === "profile");
  if ((target !== undefined && (!target || typeof target !== "object" || Array.isArray(target))) || !notary || !profileArtifact) {
    throw new Error("validated deployment context is missing or malformed for Notary/profile verification");
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
  const finalResponse = parseFinalResult(result);
  const cryptographicProofs = verifyCanaryOfflineCryptographicProofs({
    session,
    deviceAuthentication,
    deviceIdentity,
    possessionProof,
    finalResponse,
    resultAuthority,
    trustedRuntimeIdentity,
    now,
  });
  const deviceAuthenticationProof = cryptographicProofs.components.device_auth_signature;
  const tlsnDevicePossession = cryptographicProofs.components.tlsn_device_possession;
  const resultSignature = cryptographicProofs.components.result_signature;
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
  if (syntheticFixture) {
    execution.evidence.synthetic = true;
  }
  const useSyntheticRoot = syntheticFixture && trustAnchorDer !== undefined;
  const inspectPresentation = useSyntheticRoot
    ? inspectSyntheticFixtureAlpha15Presentation
    : inspectAlpha15Presentation;
  const observation = await inspectPresentation({
    presentationBytes: presentation,
    notaryRegistry,
    notaryKeyId: notary.key_id,
    ...(useSyntheticRoot ? { trustRootDer: trustAnchorDer } : {}),
    disclosureMode,
  });
  const observedServerIdentity = observation.verified_presentation.server_identity;
  if (
    typeof observedServerIdentity !== "string" ||
    observedServerIdentity.length === 0 ||
    (typeof target?.server_identity === "string" && target.server_identity !== observedServerIdentity)
  ) {
    throw new Error("Presentation-derived server identity does not match the declared target identity");
  }
  const verifyPresentation = useSyntheticRoot
    ? verifySyntheticFixturePresentation
    : verifyProductionPresentation;
  const semantic = await verifyPresentation({
    presentationBytes: presentation,
    serverIdentity: observedServerIdentity,
    profileSha256,
    verifierKeyId: trustedRuntimeIdentity?.verifier_identity?.verifier_key_id,
    notaryKeyId: notary.key_id,
    canonicalUserId: session.canonical_user_id,
    canonicalDeviceId: session.device_id,
    deviceChallenge: session.device_challenge,
    notaryRegistry,
    ...(useSyntheticRoot ? { trustRootDer: trustAnchorDer } : {}),
    disclosureMode,
  });
  if (execution.execution.presentation_sha256 !== semantic.presentation_sha256) {
    throw new Error("Verifier execution receipt is not bound to the independently verified Presentation");
  }

  const finalResult = finalResponse.result;
  for (const [resultField, semanticField] of RESULT_PRESENTATION_BINDING_FIELDS) {
    if (canonicalJson(finalResult[resultField]) !== canonicalJson(semantic.result[semanticField])) {
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
    verification_scope: "provided-proof-bundle-only",
    proof_bundle_status: "PASS_LIMITED",
    operational_smoke_effect: "NONE",
    readiness_effect: "NONE",
    gameplay_effect: "NONE",
    evidence: execution.evidence,
    verified_presentation: {
      server_identity: semantic.verified_presentation.server_identity,
      tlsn_attestation_id: semantic.verified_presentation.tlsn_attestation_id,
      notary_key_sha256: semantic.verified_presentation.notary_key_sha256,
      presentation_sha256: semantic.presentation_sha256,
      profile_id: semantic.result.profile_id,
      profile_sha256: semantic.result.profile_sha256,
      disclosure_mode: semantic.disclosure_mode,
    },
    components: {
      session_binding: {
        status: "PASS",
        authority: sessionBinding.authority,
        scope: sessionBinding.scope,
        authenticated_claims: [
          "session_id",
          "canonical_user_id",
          "device_id",
          "device_auth_nonce",
          "nonce",
          "device_challenge",
          "binding_value",
          "created_at",
          "expires_at",
          "presentation_id_sha256",
          "used_at",
        ],
        signature_algorithm: "Ed25519",
        signed_messages: [
          "FUSOU-ATTESTATION-SESSION-V1 domain-separated receipt fields",
          "FUSOU-ATTESTATION-CONSUME-V1 domain-separated receipt fields",
        ],
        job_attempt_binding: "NOT_PRESENT_IN_SESSION_OR_CONSUME_RECEIPT; verified separately by the Verifier execution receipt",
      },
      session_binding_signer_key_provenance: {
        status: "UNVERIFIED",
        reason: "Session and Binding signer public keys/registries are supplied as trust inputs; this adapter verifies receipt signatures and registry-key equality but has no independent root-pinned registry envelope for these authorities.",
      },
      device_auth_signature: {
        status: deviceAuthenticationProof.status,
        signature_algorithm: deviceAuthenticationProof.signature_algorithm,
        signed_message: deviceAuthenticationProof.signed_message,
        public_key_sha256: deviceAuthenticationProof.public_key_sha256,
      },
      tlsn_device_possession: {
        status: tlsnDevicePossession.status,
        signature_algorithm: tlsnDevicePossession.signature_algorithm,
        signed_message: tlsnDevicePossession.signed_message,
        replay_digest_sha256: tlsnDevicePossession.replay_digest_sha256,
      },
      device_identity_ownership: {
        status: "UNVERIFIED",
        authority: "FUSOU-WEB user_devices",
        reason: "The captured identity fields and public key are not accompanied by an independently verifiable FUSOU-WEB ownership/revocation receipt.",
      },
      worker_acceptance_metadata: {
        status: "UNVERIFIED",
        reason: "The deviceAuthentication.worker_acceptance object is self-reported bundle data; Session issuance is independently authenticated by the Session Authority receipt.",
      },
      device_auth_nonce_freshness: {
        status: deviceAuthenticationProof.nonce_freshness,
        reason: "The challenge HMAC secret and an authenticated challenge-issuance artifact are not supplied to the offline adapter.",
      },
      device_auth_nonce_replay: {
        status: deviceAuthenticationProof.nonce_replay_state,
        reason: "The authoritative Supabase nonce-consumption state is unavailable offline.",
      },
      Notary: {
        status: "PASS",
        authority: "tlsn-notary-registry",
        scope: "alpha.15 Presentation verification under the supplied Notary key; deployment-manifest provenance is not verified by this adapter",
      },
      notary_key_provenance: {
        status: "UNVERIFIED",
        reason: "The Notary registry and deployment-manifest key selection are supplied inputs; the Presentation is verified under that key, but this adapter does not establish the registry's external trust provenance.",
      },
      Presentation: {
        status: "PASS",
        authority: "TLSN alpha.15 Notary proof under supplied trust inputs",
        verification: "cryptographic Presentation verification plus profile-specific semantic parse",
        presentation_sha256: semantic.presentation_sha256,
      },
      presentation_execution_binding: {
        status: "PASS",
        authority: "Canary Verifier execution receipt",
        verifier_execution_receipt_sha256: execution.evidence.verifier_execution_receipt_sha256,
      },
      verifier_execution_receipt: {
        status: "PASS",
        authority: "canary-verifier-identity-key; receipt signature and exact Presentation/outer Result byte hashes are verified",
        job_id: execution.execution.job_id,
        verification_attempt_id: execution.execution.verification_attempt_id,
        presentation_sha256: execution.execution.presentation_sha256,
        result_sha256: execution.execution.result_sha256,
        deployment_id: execution.execution.verifier_deployment_id,
        runtime_version_id: execution.execution.verifier_version_id,
        verifier_key_id: execution.execution.verifier_key_id,
      },
      verifier_runtime_provenance: {
        status: "UNVERIFIED",
        reason: "The trustedRuntimeIdentity and its prior Runtime Attestation validation are supplied by the caller; this adapter checks receipt cross-binding but does not reverify that attestation signature.",
      },
      result_signature: {
        status: resultSignature.status,
        authority: "externally pinned Result registry root and root-signed Result signer registry",
        signature_algorithm: resultSignature.signature_algorithm,
        signed_bytes_format: resultSignature.signed_bytes_format,
        result_signer_key_id: resultSignature.result_signer_key_id,
        result_key_status: resultSignature.result_key_status,
        registry_sha256: resultSignature.registry_sha256,
        registry_envelope_sha256: resultSignature.registry_envelope_sha256,
      },
      result_signer_deployment_binding: {
        status: resultSignature.deployment_binding,
        reason: "Signer/key and Main Worker identity fields are compared when a validated Runtime Attestation identity is supplied; this offline adapter does not independently reverify the Runtime Attestation signature.",
      },
      result_exact_outer_bytes_binding: {
        status: "PASS",
        authority: "Canary Verifier execution receipt",
        result_sha256: execution.execution.result_sha256,
      },
      semantic_consistency: {
        status: "PASS",
        verification: "field equality only; not a cryptographic proof by itself",
        result_fields: RESULT_PRESENTATION_BINDING_FIELDS.map(([field]) => field),
        session_fields: ["canonical_user_id", "device_id", "device_challenge", "attestation_session_id", "binding_value"],
      },
      deployment_manifest_provenance: {
        status: "UNVERIFIED",
        reason: "Manifest object signature/root pin is not verified by this adapter; profile and Notary fields are compared as caller-supplied claims only.",
      },
      manifest_artifact_metadata: {
        status: "UNVERIFIED",
        reason: "Artifact names and paths are metadata, not cryptographic proof of the deployed profile or execution source.",
      },
      self_reported_claims: {
        status: "UNVERIFIED",
        claims: [
          "deviceIdentity.authoritative",
          "deviceIdentity.authority",
          "deviceIdentity.revoked_at",
          "deviceAuthentication.worker_acceptance",
          "finalResponse.verified",
          "deploymentManifest artifact names and provenance labels",
        ],
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
    unverified_predicates: [
      "device_identity_ownership",
      "session_binding_signer_key_provenance",
      "device_auth_nonce_freshness",
      "device_auth_nonce_replay",
      "result_signer_deployment_binding",
      "notary_key_provenance",
      "worker_acceptance_metadata",
      "verifier_runtime_provenance",
      "deployment_manifest_provenance",
      "manifest_artifact_metadata",
    ],
  };
}