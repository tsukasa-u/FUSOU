import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import initVerifier, {
  verify_require_info_presentation,
  verify_require_info_presentation_with_trust_anchor,
} from "../src/wasm/fusou_tlsn_verifier.js";
import { canonicalJson, sha256Base64Url } from "./deployment-attestation.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(scriptDirectory, "../src/wasm/fusou_tlsn_verifier_bg.wasm");
let verifierInitialization;

export const PRODUCTION_SEMANTIC_SCHEMA_VERSION = 1;
export const PRODUCTION_SEMANTIC_KIND = "tlsn-production-semantic-verification";
export const PRODUCTION_SEMANTIC_PREDICATES = {
  presentation_cryptography: {
    required_artifacts: ["presentation"],
    required_fields: ["presentation_sha256", "tlsn_attestation_id"],
    verification_method: "alpha15 Presentation::verify with complete transcript disclosure",
    authority_identity: "tlsn-alpha15-verifier",
  },
  notary_identity: {
    required_artifacts: ["presentation", "health", "notary_registry"],
    required_fields: ["notary_key_id", "notary_key_sha256"],
    verification_method: "Presentation verifying key equals the configured Notary registry entry",
    authority_identity: "production-notary-registry",
  },
  server_identity: {
    required_artifacts: ["presentation", "health"],
    required_fields: ["server_identity"],
    verification_method: "verified alpha15 server_name equals the trusted Worker profile",
    authority_identity: "production-verifier-profile",
  },
  require_info_http_profile: {
    required_artifacts: ["presentation"],
    required_fields: ["profile_id", "profile_sha256", "http_profile", "request_transcript_sha256", "response_transcript_sha256"],
    verification_method: "strict authenticated require_info request and response parser",
    authority_identity: "fusou-require-info-v1",
  },
  authenticated_member_id: {
    required_artifacts: ["presentation"],
    required_fields: ["verified_member_id", "response_transcript_sha256"],
    verification_method: "api_member_id derived from the authenticated response transcript",
    authority_identity: "fusou-require-info-v1-response-parser",
  },
  result_presentation_binding: {
    required_artifacts: ["presentation", "result"],
    required_fields: ["tlsn_attestation_id", "verified_member_id", "binding_value"],
    verification_method: "independent semantic Result equals the signed Worker Result",
    authority_identity: "offline-production-evidence-verifier",
  },
};

const REQUIRE_INFO_HTTP_PROFILE = {
  request_method: "POST",
  request_target: "/kcsapi/api_get_member/require_info",
  request_http_version: "HTTP/1.1",
  response_status_line: "HTTP/1.1 200 OK",
  response_member_path: "svdata.api_data.api_basic.api_member_id",
};

function decodeBase64Url(value, label, expectedLength) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error(`${label} must be canonical base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== value) {
    throw new Error(`${label} is not canonical base64url`);
  }
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new Error(`${label} has an invalid length`);
  }
  return bytes;
}

async function ensureVerifierInitialized() {
  verifierInitialization ??= readFile(wasmPath).then((wasmBytes) => initVerifier({ module_or_path: wasmBytes }));
  await verifierInitialization;
}

function parseVerifierOutput(output) {
  const parsed = JSON.parse(output);
  if (!parsed || typeof parsed !== "object" || typeof parsed.unsigned_result !== "string" || typeof parsed.signing_bytes !== "string") {
    throw new Error("semantic verifier output is invalid");
  }
  return {
    result: JSON.parse(parsed.unsigned_result),
    signing_bytes: decodeBase64Url(parsed.signing_bytes, "semantic verifier signing bytes"),
  };
}

function unsignedResult(result) {
  const copy = { ...result };
  delete copy.signature;
  return copy;
}

function assertCanonicalEqual(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} does not match independent semantic verification`);
  }
}

function trustedNotaryKeyFromRegistry(registry, notaryKeyId) {
  const encodedKey = registry?.[notaryKeyId];
  if (typeof encodedKey !== "string") {
    throw new Error("semantic verifier Notary key is missing from the trusted registry");
  }
  return decodeBase64Url(encodedKey, "trusted Notary public key");
}

export async function verifyProductionPresentation({
  presentationBytes,
  serverIdentity,
  profileSha256,
  verifierKeyId,
  notaryKeyId,
  canonicalUserId,
  canonicalDeviceId,
  deviceChallenge,
  notaryRegistry,
  trustAnchorDer,
}) {
  if (!Buffer.isBuffer(presentationBytes) && !(presentationBytes instanceof Uint8Array)) {
    throw new Error("semantic verifier Presentation bytes are required");
  }
  await ensureVerifierInitialized();
  const profileBytes = decodeBase64Url(profileSha256, "profile SHA-256", 32);
  const challengeBytes = decodeBase64Url(deviceChallenge, "device challenge", 32);
  const trustedNotaryKey = trustedNotaryKeyFromRegistry(notaryRegistry, notaryKeyId);
  let output;
  try {
    output = trustAnchorDer
      ? verify_require_info_presentation_with_trust_anchor(
        presentationBytes,
        serverIdentity,
        profileBytes,
        verifierKeyId,
        notaryKeyId,
        canonicalUserId,
        canonicalDeviceId,
        challengeBytes,
        decodeBase64Url(trustAnchorDer, "trust root certificate"),
        trustedNotaryKey,
      )
      : verify_require_info_presentation(
        presentationBytes,
        serverIdentity,
        profileBytes,
        verifierKeyId,
        notaryKeyId,
        canonicalUserId,
        canonicalDeviceId,
        challengeBytes,
        trustedNotaryKey,
      );
  } catch (error) {
    throw new Error(`semantic Presentation verification failed: ${String(error)}`);
  }
  const parsed = parseVerifierOutput(output);
  return {
    ...parsed,
    notary_key_sha256: sha256Base64Url(trustedNotaryKey),
  };
}

export function createSemanticVerificationArtifact({
  presentationBytes,
  semanticVerification,
  result,
  verifierIdentity = "capture-harness",
  verifiedAt = new Date().toISOString(),
}) {
  assertCanonicalEqual(unsignedResult(result), semanticVerification.result, "Worker Result");
  const semanticResult = semanticVerification.result;
  const predicates = Object.fromEntries(
    Object.entries(PRODUCTION_SEMANTIC_PREDICATES).map(([name, definition]) => [
      name,
      {
        ...definition,
        status: "PASS",
        verified_at: verifiedAt,
      },
    ]),
  );
  return {
    schema_version: PRODUCTION_SEMANTIC_SCHEMA_VERSION,
    kind: PRODUCTION_SEMANTIC_KIND,
    status: "VERIFIED",
    verifier_identity: verifierIdentity,
    verified_at: verifiedAt,
    input: {
      presentation_sha256: sha256Base64Url(presentationBytes),
      presentation_size_bytes: presentationBytes.byteLength,
    },
    authorities: {
      profile_id: semanticResult.profile_id,
      profile_sha256: semanticResult.profile_sha256,
      server_identity: semanticResult.server_identity,
      notary_key_id: semanticResult.notary_key_id,
      notary_key_sha256: semanticVerification.notary_key_sha256,
    },
    derived: {
      tlsn_attestation_id: semanticResult.tlsn_attestation_id,
      verified_member_id: semanticResult.verified_member_id,
      request_transcript_size: semanticResult.request_transcript_size,
      request_transcript_sha256: semanticResult.request_transcript_sha256,
      response_transcript_size: semanticResult.response_transcript_size,
      response_transcript_sha256: semanticResult.response_transcript_sha256,
      revealed_request_ranges: semanticResult.revealed_request_ranges,
      revealed_response_ranges: semanticResult.revealed_response_ranges,
    },
    http_profile: {
      ...REQUIRE_INFO_HTTP_PROFILE,
      host: semanticResult.server_identity,
    },
    semantic_result: semanticResult,
    predicates,
  };
}

export function assertSemanticVerificationArtifact(artifact, {
  presentationBytes,
  semanticVerification,
  result,
}) {
  if (
    artifact?.schema_version !== PRODUCTION_SEMANTIC_SCHEMA_VERSION ||
    artifact?.kind !== PRODUCTION_SEMANTIC_KIND ||
    artifact?.status !== "VERIFIED"
  ) {
    throw new Error("semantic verification artifact schema or status is invalid");
  }
  if (artifact.input?.presentation_sha256 !== sha256Base64Url(presentationBytes)) {
    throw new Error("semantic verification artifact Presentation hash mismatch");
  }
  if (artifact.input?.presentation_size_bytes !== presentationBytes.byteLength) {
    throw new Error("semantic verification artifact Presentation size mismatch");
  }
  const expected = createSemanticVerificationArtifact({
    presentationBytes,
    semanticVerification,
    result,
    verifierIdentity: artifact.verifier_identity,
    verifiedAt: artifact.verified_at,
  });
  assertCanonicalEqual(artifact, expected, "semantic verification artifact");
  return artifact;
}

export function assertSemanticResultMatches(result, semanticVerification) {
  assertCanonicalEqual(unsignedResult(result), semanticVerification.result, "Worker Result");
  return result;
}