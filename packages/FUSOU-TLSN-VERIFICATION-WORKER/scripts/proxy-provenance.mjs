import { createPublicKey, verify } from "node:crypto";
import {
  assertProductionPresentationCaptureMetadata,
  PRODUCTION_EVIDENCE_CAPTURE_PREDICATE_DEFINITIONS,
} from "./production-evidence-contract.mjs";
import { canonicalJson, sha256Base64Url } from "./deployment-attestation.mjs";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function decodeBase64Url(value, label, expectedLength) {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new Error(`${label} must be canonical base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== value) throw new Error(`${label} is not canonical base64url`);
  if (expectedLength !== undefined && bytes.length !== expectedLength) throw new Error(`${label} has an invalid length`);
  return bytes;
}

export function proxyProvenanceSigningPayload(provenance) {
  return canonicalJson({
    proxy_identity: provenance.proxy_identity,
    proxy_deployment_id: provenance.proxy_deployment_id,
    proxy_binary_identity: provenance.proxy_binary_identity,
    presentation_sha256: provenance.presentation_sha256,
    created_at: provenance.created_at,
    capture_context: provenance.capture_context,
    signer_key_id: provenance.signer_key_id,
  });
}

export function assertProductionProxyProvenancePin(pin) {
  if (!pin || pin.type !== "externally-pinned-production-proxy-key") {
    throw new Error("production proxy provenance pin type is invalid");
  }
  for (const field of ["signer_key_id", "public_key_spki", "proxy_identity", "proxy_deployment_id", "proxy_binary_identity"]) {
    if (typeof pin[field] !== "string" || pin[field].length === 0) {
      throw new Error(`production proxy provenance pin field is invalid: ${field}`);
    }
  }
  decodeBase64Url(pin.public_key_spki, "production proxy provenance pinned public key");
  return pin;
}

function predicateResult(status, verifiedAt, evidenceArtifacts, detail = "", observed = {}) {
  return {
    ...PRODUCTION_EVIDENCE_CAPTURE_PREDICATE_DEFINITIONS.proxy_provenance_cryptographic_authentication,
    status,
    verified_at: verifiedAt,
    evidence_artifacts: [...evidenceArtifacts],
    detail,
    observed,
  };
}

export function verifyProductionProxyProvenance({
  captureMetadata,
  presentationBytes,
  externalPin = null,
  verifiedAt = new Date().toISOString(),
}) {
  try {
    assertProductionPresentationCaptureMetadata(captureMetadata, presentationBytes);
    const provenance = captureMetadata.proxy_provenance;
    const observed = {
      proxy_identity: provenance.proxy_identity,
      proxy_deployment_id: provenance.proxy_deployment_id,
      proxy_binary_identity: provenance.proxy_binary_identity,
      presentation_sha256: provenance.presentation_sha256,
      cryptographic_status: provenance.cryptographic_status,
    };
    if (!externalPin) {
      if (provenance.cryptographic_status !== "UNVERIFIED" || provenance.authority.status !== "UNVERIFIED") {
        throw new Error("proxy provenance without an external pin must remain UNVERIFIED");
      }
      return predicateResult("UNVERIFIED", verifiedAt, ["capture_metadata", "presentation"], "production proxy provenance is declared but has no externally pinned authority", observed);
    }

    assertProductionProxyProvenancePin(externalPin);
    if (provenance.cryptographic_status !== "VERIFIED" || provenance.authority.status !== "EXTERNALLY_PINNED") {
      throw new Error("externally pinned proxy provenance must declare VERIFIED status");
    }
    for (const field of ["signer_key_id", "proxy_identity", "proxy_deployment_id", "proxy_binary_identity"]) {
      if (provenance[field] !== externalPin[field]) throw new Error(`production proxy provenance pin mismatch: ${field}`);
    }
    const publicKey = createPublicKey({
      key: decodeBase64Url(externalPin.public_key_spki, "production proxy provenance pinned public key"),
      format: "der",
      type: "spki",
    });
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("production proxy provenance pinned key is not Ed25519");
    const signature = decodeBase64Url(provenance.signature, "production proxy provenance signature", 64);
    if (!verify(null, Buffer.from(proxyProvenanceSigningPayload(provenance)), publicKey, signature)) {
      throw new Error("production proxy provenance signature is invalid");
    }
    observed.cryptographic_status = "VERIFIED";
    observed.authority_status = "EXTERNALLY_PINNED";
    observed.presentation_sha256 = sha256Base64Url(presentationBytes);
    return predicateResult("PASS", verifiedAt, ["capture_metadata", "presentation"], "production proxy provenance signature matches the externally pinned deployment identity", observed);
  } catch (error) {
    return predicateResult("FAIL", verifiedAt, ["capture_metadata", "presentation"], error instanceof Error ? error.message : String(error));
  }
}
