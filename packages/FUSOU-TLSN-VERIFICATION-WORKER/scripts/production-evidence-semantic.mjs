import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import initVerifier, {
  inspect_alpha15_presentation,
  inspect_alpha15_presentation_with_trust_anchor,
  verify_require_info_presentation,
  verify_require_info_presentation_with_trust_anchor,
} from "../src/wasm/fusou_tlsn_verifier.js";
import { assertSignedResult } from "./production-evidence.mjs";
import {
  PRODUCTION_EVIDENCE_REQUIREMENT_PREDICATES,
  PRODUCTION_EVIDENCE_SEMANTIC_PREDICATE_DEFINITIONS,
} from "./production-evidence-contract.mjs";
import { canonicalJson, sha256Base64Url } from "./deployment-attestation.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(scriptDirectory, "../src/wasm/fusou_tlsn_verifier_bg.wasm");
let verifierInitialization;

export const PRODUCTION_SEMANTIC_SCHEMA_VERSION = 2;
export const PRODUCTION_SEMANTIC_KIND = "tlsn-production-semantic-verification";
export const PRODUCTION_SEMANTIC_PREDICATE_STATUSES = ["PASS", "UNVERIFIED", "BLOCKED", "FAIL"];
export const PRODUCTION_SEMANTIC_PREDICATES = PRODUCTION_EVIDENCE_SEMANTIC_PREDICATE_DEFINITIONS;

const REQUIRE_INFO_HTTP_PROFILE = {
  request_method: "POST",
  request_target: "/kcsapi/api_get_member/require_info",
  request_http_version: "HTTP/1.1",
  response_status_line: "HTTP/1.1 200 OK",
  response_member_path: "svdata.api_data.api_basic.api_member_id",
};

export const RESULT_PRESENTATION_BINDING_FIELDS = [
  ["verified_member_id", "verified_member_id"],
  ["tlsn_attestation_id", "tlsn_attestation_id"],
  ["server_identity", "server_identity"],
  ["profile_sha256", "profile_sha256"],
  ["verifier_key_id", "verifier_key_id"],
  ["notary_key_id", "notary_key_id"],
  ["request_transcript_sha256", "request_transcript_sha256"],
  ["response_transcript_sha256", "response_transcript_sha256"],
  ["revealed_request_ranges", "revealed_request_ranges"],
  ["revealed_response_ranges", "revealed_response_ranges"],
  ["canonical_user_id", "canonical_user_id"],
  ["device_id", "device_id"],
  ["device_challenge", "device_challenge"],
  ["attestation_session_id", "attestation_session_id"],
  ["binding_value", "binding_value"],
];

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

function parseUint64(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be a canonical UInt64 decimal`);
  }
  const parsed = BigInt(value);
  if (parsed > 18_446_744_073_709_551_615n) throw new Error(`${label} exceeds UInt64`);
  return parsed;
}

function parseVerifiedPresentationOutput(output) {
  const parsed = JSON.parse(output);
  if (!parsed || typeof parsed !== "object") throw new Error("alpha15 verified Presentation output is invalid");
  const requiredStrings = [
    "server_identity",
    "tlsn_attestation_id",
    "notary_key_sha256",
    "request_transcript_size",
    "request_transcript_sha256",
    "response_transcript_size",
    "response_transcript_sha256",
  ];
  for (const field of requiredStrings) {
    if (typeof parsed[field] !== "string") throw new Error(`alpha15 verified Presentation output is missing ${field}`);
  }
  decodeBase64Url(parsed.tlsn_attestation_id, "verified TLSN attestation ID", 16);
  decodeBase64Url(parsed.notary_key_sha256, "verified Notary key SHA-256", 32);
  decodeBase64Url(parsed.request_transcript_sha256, "verified request transcript SHA-256", 32);
  decodeBase64Url(parsed.response_transcript_sha256, "verified response transcript SHA-256", 32);
  parseUint64(parsed.request_transcript_size, "verified request transcript size");
  parseUint64(parsed.response_transcript_size, "verified response transcript size");
  if (!Array.isArray(parsed.revealed_request_ranges) || !Array.isArray(parsed.revealed_response_ranges)) {
    throw new Error("alpha15 verified Presentation ranges are invalid");
  }
  return parsed;
}

function reconstructTranscript(ranges, expectedSize, expectedHash, label) {
  const transcriptSize = parseUint64(expectedSize, `${label} size`);
  let cursor = 0n;
  const chunks = [];
  for (const [index, range] of ranges.entries()) {
    if (!range || typeof range !== "object") throw new Error(`${label} range ${index} is invalid`);
    const start = parseUint64(range.start, `${label} range start`);
    const length = parseUint64(range.length, `${label} range length`);
    if (length === 0n || start !== cursor) throw new Error(`${label} ranges are not contiguous`);
    const bytes = decodeBase64Url(range.bytes, `${label} range bytes`);
    if (BigInt(bytes.length) !== length) throw new Error(`${label} range length does not match bytes`);
    chunks.push(bytes);
    cursor += length;
  }
  if (cursor !== transcriptSize) throw new Error(`${label} ranges do not cover the transcript`);
  const transcript = Buffer.concat(chunks);
  if (sha256Base64Url(transcript) !== expectedHash) throw new Error(`${label} digest does not match verified output`);
  return transcript;
}

function findCrlf(bytes, start) {
  for (let index = start; index + 1 < bytes.length; index += 1) {
    if (bytes[index] === 0x0d && bytes[index + 1] === 0x0a) return index;
  }
  return -1;
}

function headerValues(headers, name) {
  return headers.filter((header) => header.name === name);
}

function decodeChunkedBody(body) {
  let cursor = 0;
  const chunks = [];
  while (true) {
    const lineEnd = findCrlf(body, cursor);
    if (lineEnd < 0) throw new Error("chunk size is not CRLF terminated");
    const sizeLine = body.subarray(cursor, lineEnd).toString("ascii");
    if (!/^[0-9a-fA-F]{1,16}$/.test(sizeLine)) throw new Error("invalid chunk size");
    const size = Number.parseInt(sizeLine, 16);
    cursor = lineEnd + 2;
    if (size === 0) {
      if (!body.subarray(cursor).equals(Buffer.from("\r\n"))) throw new Error("chunk trailers are not allowed");
      return Buffer.concat(chunks);
    }
    const chunkEnd = cursor + size;
    if (chunkEnd + 2 > body.length || !body.subarray(chunkEnd, chunkEnd + 2).equals(Buffer.from("\r\n"))) {
      throw new Error("chunk body is not CRLF terminated");
    }
    chunks.push(body.subarray(cursor, chunkEnd));
    cursor = chunkEnd + 2;
  }
}

function parseHttpMessage(raw, expectedStartLine, label) {
  const firstEnd = findCrlf(raw, 0);
  if (firstEnd < 0 || raw.subarray(0, firstEnd).toString("ascii") !== expectedStartLine) {
    throw new Error(`${label} start line is invalid`);
  }
  const headers = [];
  let cursor = firstEnd + 2;
  while (true) {
    const lineEnd = findCrlf(raw, cursor);
    if (lineEnd < 0) throw new Error(`${label} header is not CRLF terminated`);
    if (lineEnd === cursor) {
      cursor += 2;
      break;
    }
    const line = raw.subarray(cursor, lineEnd);
    const colon = line.indexOf(0x3a);
    if (colon <= 0 || line.subarray(0, colon).some((byte) => byte <= 0x20 || byte === 0x7f)) {
      throw new Error(`${label} header name is invalid`);
    }
    const rawValue = line.subarray(colon + 1);
    if (rawValue.some((byte) => (byte < 0x20 && byte !== 0x20 && byte !== 0x09) || byte === 0x7f)) {
      throw new Error(`${label} header value is invalid`);
    }
    headers.push({
      name: line.subarray(0, colon).toString("ascii").toLowerCase(),
      rawValue,
      value: rawValue.toString("ascii").replace(/^[ \t]+|[ \t]+$/g, ""),
    });
    cursor = lineEnd + 2;
  }
  const body = raw.subarray(cursor);
  const contentLengths = headerValues(headers, "content-length");
  const transferEncodings = headerValues(headers, "transfer-encoding");
  if (contentLengths.length > 1 || transferEncodings.length > 1 || (contentLengths.length > 0 && transferEncodings.length > 0)) {
    throw new Error(`${label} framing headers are invalid`);
  }
  let framedBody;
  if (contentLengths.length === 1) {
    const length = parseUint64(contentLengths[0].value, `${label} content length`);
    if (length !== BigInt(body.length)) throw new Error(`${label} content length does not match body`);
    framedBody = body;
  } else if (transferEncodings.length === 1 && transferEncodings[0].value.toLowerCase() === "chunked") {
    framedBody = decodeChunkedBody(body);
  } else {
    throw new Error(`${label} body framing is missing`);
  }
  const contentEncodings = headerValues(headers, "content-encoding");
  if (contentEncodings.length > 1) throw new Error(`${label} content encoding is duplicated`);
  let decodedBody = framedBody;
  if (contentEncodings.length === 1 && contentEncodings[0].value.toLowerCase() === "gzip") {
    decodedBody = gunzipSync(framedBody);
  } else if (contentEncodings.length === 1 && contentEncodings[0].value.toLowerCase() !== "identity") {
    throw new Error(`${label} content encoding is unsupported`);
  }
  return { headers, body: decodedBody };
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
}

function parseAuthenticatedMemberId(responseBody) {
  const prefix = Buffer.from("svdata=");
  if (!responseBody.subarray(0, prefix.length).equals(prefix)) throw new Error("response body lacks exact svdata= prefix");
  const jsonText = decodeUtf8(responseBody.subarray(prefix.length), "require_info JSON");
  if (jsonText.trimEnd() !== jsonText || jsonText[0] !== "{") throw new Error("require_info JSON has invalid surrounding bytes");
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("require_info JSON is invalid");
  }
  if (
    parsed?.api_result !== 1 ||
    !Number.isSafeInteger(parsed?.api_data?.api_basic?.api_member_id) ||
    !/^[1-9][0-9]{0,15}$/.test(String(parsed.api_data.api_basic.api_member_id))
  ) {
    throw new Error("authenticated api_member_id path is invalid");
  }
  return String(parsed.api_data.api_basic.api_member_id);
}

function parseProfileTranscripts(semanticVerification, trustedServerIdentity, expectedBindingValue) {
  const verifiedPresentation = semanticVerification.verified_presentation;
  const requestTranscript = reconstructTranscript(
    verifiedPresentation.revealed_request_ranges,
    verifiedPresentation.request_transcript_size,
    verifiedPresentation.request_transcript_sha256,
    "request transcript",
  );
  const responseTranscript = reconstructTranscript(
    verifiedPresentation.revealed_response_ranges,
    verifiedPresentation.response_transcript_size,
    verifiedPresentation.response_transcript_sha256,
    "response transcript",
  );
  const request = parseHttpMessage(requestTranscript, `POST ${REQUIRE_INFO_HTTP_PROFILE.request_target} HTTP/1.1`, "require_info request");
  const response = parseHttpMessage(responseTranscript, REQUIRE_INFO_HTTP_PROFILE.response_status_line, "require_info response");
  const hosts = headerValues(request.headers, "host");
  if (hosts.length !== 1 || hosts[0].value !== trustedServerIdentity) throw new Error("require_info Host does not match trusted server identity");
  const bindings = headerValues(request.headers, "x-attestation-binding");
  if (bindings.length !== 1 || bindings[0].rawValue.toString("ascii") !== ` ${bindings[0].value}`) {
    throw new Error("require_info binding header cardinality or spacing is invalid");
  }
  if (expectedBindingValue !== undefined && bindings[0].value !== expectedBindingValue) {
    throw new Error("require_info binding does not match the verified Result");
  }
  return { requestTranscript, responseTranscript, request, response, memberId: parseAuthenticatedMemberId(response.body) };
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

function predicateResult(name, {
  status,
  verifiedAt,
  evidenceArtifacts = [],
  derivedFields = PRODUCTION_SEMANTIC_PREDICATES[name].derived_fields,
  detail = "",
  observed = {},
}) {
  const definition = PRODUCTION_SEMANTIC_PREDICATES[name];
  return {
    ...definition,
    status,
    verified_at: verifiedAt,
    evidence_artifacts: [...evidenceArtifacts],
    derived_fields: [...derivedFields],
    detail,
    observed,
  };
}

function runPredicate(name, verifiedAt, evidenceArtifacts, callback) {
  try {
    return predicateResult(name, {
      status: "PASS",
      verifiedAt,
      evidenceArtifacts,
      ...callback(),
    });
  } catch (error) {
    return predicateResult(name, {
      status: "FAIL",
      verifiedAt,
      evidenceArtifacts,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function assertPredicateResults(predicateResults) {
  if (!predicateResults || typeof predicateResults !== "object") throw new Error("semantic predicate results are required");
  for (const [name, definition] of Object.entries(PRODUCTION_SEMANTIC_PREDICATES)) {
    const result = predicateResults[name];
    if (!result || !PRODUCTION_SEMANTIC_PREDICATE_STATUSES.includes(result.status)) {
      throw new Error(`semantic predicate result is missing or invalid: ${name}`);
    }
    if (
      canonicalJson(result.required_artifacts) !== canonicalJson(definition.required_artifacts) ||
      canonicalJson(result.required_fields) !== canonicalJson(definition.required_fields) ||
      result.verification_method !== definition.verification_method ||
      result.authority_identity !== definition.authority_identity
    ) {
      throw new Error(`semantic predicate definition was substituted: ${name}`);
    }
    if (!Array.isArray(result.evidence_artifacts) || !Array.isArray(result.derived_fields)) {
      throw new Error(`semantic predicate result fields are invalid: ${name}`);
    }
  }
  return predicateResults;
}

export function verifyPresentationCryptography({ presentationBytes, semanticVerification, verifiedAt = new Date().toISOString() }) {
  return runPredicate("presentation_cryptography", verifiedAt, ["presentation"], () => {
    if (semanticVerification?.verified_presentation?.server_identity === undefined) {
      throw new Error("alpha15 verified Presentation context is missing");
    }
    if (semanticVerification.presentation_sha256 !== sha256Base64Url(presentationBytes)) {
      throw new Error("Presentation artifact hash does not match verified input");
    }
    const attestationId = decodeBase64Url(
      semanticVerification.verified_presentation.tlsn_attestation_id,
      "verified TLSN attestation ID",
      16,
    );
    if (attestationId.length !== 16) throw new Error("verified TLSN attestation identity is invalid");
    return {
      observed: {
        presentation_sha256: semanticVerification.presentation_sha256,
        tlsn_attestation_id: semanticVerification.verified_presentation.tlsn_attestation_id,
        request_transcript_sha256: semanticVerification.verified_presentation.request_transcript_sha256,
        response_transcript_sha256: semanticVerification.verified_presentation.response_transcript_sha256,
      },
    };
  });
}

export function verifyNotaryIdentity({ semanticVerification, notaryRegistry, notaryKeyId, verifiedAt = new Date().toISOString() }) {
  return runPredicate("notary_identity", verifiedAt, ["presentation", "notary_registry"], () => {
    const trustedNotaryKey = trustedNotaryKeyFromRegistry(notaryRegistry, notaryKeyId);
    const trustedFingerprint = sha256Base64Url(trustedNotaryKey);
    if (semanticVerification?.verified_presentation?.notary_key_sha256 !== trustedFingerprint) {
      throw new Error("Presentation Notary verifying key does not match the trusted registry entry");
    }
    if (semanticVerification.result?.notary_key_id !== notaryKeyId) {
      throw new Error("semantic Result Notary key ID does not match the trusted registry entry");
    }
    return {
      observed: {
        notary_key_id: notaryKeyId,
        notary_key_sha256: semanticVerification.verified_presentation.notary_key_sha256,
      },
    };
  });
}

export function verifyServerIdentity({ semanticVerification, trustedServerIdentity, verifiedAt = new Date().toISOString() }) {
  return runPredicate("server_identity", verifiedAt, ["presentation", "health"], () => {
    const derivedServerIdentity = semanticVerification?.verified_presentation?.server_identity;
    if (typeof derivedServerIdentity !== "string" || derivedServerIdentity !== trustedServerIdentity) {
      throw new Error("Presentation-derived server identity does not match trusted production identity");
    }
    if (semanticVerification.result?.server_identity !== derivedServerIdentity) {
      throw new Error("Worker Result server identity does not match Presentation-derived identity");
    }
    return { observed: { server_identity: derivedServerIdentity } };
  });
}

export function verifyRequireInfoHttpProfile({
  semanticVerification,
  trustedServerIdentity,
  trustedProfileId = "fusou-require-info-v1",
  trustedProfileSha256,
  trustedVerifierKeyId,
  verifiedAt = new Date().toISOString(),
}) {
  return runPredicate("require_info_http_profile", verifiedAt, ["presentation"], () => {
    if (semanticVerification.result?.profile_id !== trustedProfileId || semanticVerification.result?.profile_sha256 !== trustedProfileSha256) {
      throw new Error("semantic Result profile does not match trusted profile configuration");
    }
    if (semanticVerification.result?.verifier_key_id !== trustedVerifierKeyId) {
      throw new Error("semantic Result verifier key ID does not match trusted configuration");
    }
    const transcripts = parseProfileTranscripts(semanticVerification, trustedServerIdentity, semanticVerification.result?.binding_value);
    if (transcripts.requestTranscript.length !== Number.parseInt(semanticVerification.result.request_transcript_size, 10)) {
      throw new Error("request transcript size does not match the Presentation-derived bytes");
    }
    if (transcripts.responseTranscript.length !== Number.parseInt(semanticVerification.result.response_transcript_size, 10)) {
      throw new Error("response transcript size does not match the Presentation-derived bytes");
    }
    if (sha256Base64Url(transcripts.requestTranscript) !== semanticVerification.result.request_transcript_sha256) {
      throw new Error("request transcript digest does not match the semantic Result");
    }
    if (sha256Base64Url(transcripts.responseTranscript) !== semanticVerification.result.response_transcript_sha256) {
      throw new Error("response transcript digest does not match the semantic Result");
    }
    return {
      observed: {
        request_method: REQUIRE_INFO_HTTP_PROFILE.request_method,
        request_target: REQUIRE_INFO_HTTP_PROFILE.request_target,
        request_http_version: REQUIRE_INFO_HTTP_PROFILE.request_http_version,
        response_status_line: REQUIRE_INFO_HTTP_PROFILE.response_status_line,
        host: trustedServerIdentity,
        request_transcript_sha256: sha256Base64Url(transcripts.requestTranscript),
        response_transcript_sha256: sha256Base64Url(transcripts.responseTranscript),
      },
    };
  });
}

export function deriveAuthenticatedMemberId({ semanticVerification, trustedServerIdentity, verifiedAt = new Date().toISOString() }) {
  return runPredicate("authenticated_member_id", verifiedAt, ["presentation"], () => {
    const transcripts = parseProfileTranscripts(semanticVerification, trustedServerIdentity);
    const verifiedMemberId = transcripts.memberId;
    if (verifiedMemberId !== semanticVerification.result?.verified_member_id) {
      throw new Error("Presentation-derived authenticated member ID does not match the semantic Result");
    }
    return {
      observed: {
        verified_member_id: verifiedMemberId,
        response_transcript_sha256: sha256Base64Url(transcripts.responseTranscript),
      },
    };
  });
}

export function verifyResultPresentationBinding({ semanticVerification, result, verifiedAt = new Date().toISOString() }) {
  return runPredicate("result_presentation_binding", verifiedAt, ["presentation", "result"], () => {
    if (!result || !semanticVerification?.result) throw new Error("semantic and Worker Results are required");
    const mismatches = [];
    for (const [semanticField, resultField] of RESULT_PRESENTATION_BINDING_FIELDS) {
      if (canonicalJson(semanticVerification.result[semanticField]) !== canonicalJson(result[resultField])) {
        mismatches.push(`${semanticField}:${resultField}`);
      }
    }
    if (mismatches.length > 0) throw new Error(`Result-to-Presentation binding mismatch: ${mismatches.join(",")}`);
    return { observed: Object.fromEntries(RESULT_PRESENTATION_BINDING_FIELDS.map(([field]) => [field, semanticVerification.result[field]])) };
  });
}

export function verifyResultSignature({ result, resultRegistry, resultPublicKeySpki, resultSignerKeyId, verifiedAt = new Date().toISOString() }) {
  return runPredicate("result_signature", verifiedAt, ["result", "result_registry"], () => {
    const verification = assertSignedResult(result, {
      publicKeySpki: resultPublicKeySpki,
      keyRegistry: resultRegistry,
      signerKeyId: resultSignerKeyId,
    });
    return {
      observed: {
        result_signature_valid: verification.result_signature_valid,
        result_signer_key_id: verification.result_signer_key_id,
      },
    };
  });
}

export function verifySemanticPredicates({
  presentationBytes,
  semanticVerification,
  result,
  trustedInputs,
  notaryRegistry,
  resultRegistry,
  resultPublicKeySpki,
  resultSignerKeyId,
  verifiedAt = new Date().toISOString(),
}) {
  const predicateResults = {
    presentation_cryptography: verifyPresentationCryptography({ presentationBytes, semanticVerification, verifiedAt }),
    notary_identity: verifyNotaryIdentity({ semanticVerification, notaryRegistry, notaryKeyId: trustedInputs.notary_key_id, verifiedAt }),
    server_identity: verifyServerIdentity({ semanticVerification, trustedServerIdentity: trustedInputs.server_identity, verifiedAt }),
    require_info_http_profile: verifyRequireInfoHttpProfile({
      semanticVerification,
      trustedServerIdentity: trustedInputs.server_identity,
      trustedProfileId: trustedInputs.profile_id,
      trustedProfileSha256: trustedInputs.profile_sha256,
      trustedVerifierKeyId: trustedInputs.verifier_key_id,
      verifiedAt,
    }),
    authenticated_member_id: deriveAuthenticatedMemberId({ semanticVerification, trustedServerIdentity: trustedInputs.server_identity, verifiedAt }),
    result_presentation_binding: verifyResultPresentationBinding({ semanticVerification, result, verifiedAt }),
    result_signature: verifyResultSignature({ result, resultRegistry, resultPublicKeySpki, resultSignerKeyId, verifiedAt }),
  };
  return assertPredicateResults(predicateResults);
}

export function semanticRequirementStatus(requirement, predicateResults) {
  const predicateNames = PRODUCTION_EVIDENCE_REQUIREMENT_PREDICATES[requirement] ?? [];
  if (predicateNames.length === 0) return "PASS";
  return predicateNames.every((name) => predicateResults?.[name]?.status === "PASS") ? "PASS" : "UNVERIFIED";
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
  let inspectionOutput;
  try {
    inspectionOutput = trustAnchorDer
      ? inspect_alpha15_presentation_with_trust_anchor(
        presentationBytes,
        decodeBase64Url(trustAnchorDer, "trust root certificate"),
        trustedNotaryKey,
      )
      : inspect_alpha15_presentation(presentationBytes, trustedNotaryKey);
  } catch (error) {
    throw new Error(`semantic Presentation cryptographic verification failed: ${String(error)}`);
  }
  const verifiedPresentation = parseVerifiedPresentationOutput(inspectionOutput);
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
    throw new Error(`semantic Presentation profile verification failed: ${String(error)}`);
  }
  const parsed = parseVerifierOutput(output);
  for (const [verifiedField, resultField] of [
    ["server_identity", "server_identity"],
    ["tlsn_attestation_id", "tlsn_attestation_id"],
    ["request_transcript_size", "request_transcript_size"],
    ["request_transcript_sha256", "request_transcript_sha256"],
    ["response_transcript_size", "response_transcript_size"],
    ["response_transcript_sha256", "response_transcript_sha256"],
    ["revealed_request_ranges", "revealed_request_ranges"],
    ["revealed_response_ranges", "revealed_response_ranges"],
  ]) {
    if (canonicalJson(verifiedPresentation[verifiedField]) !== canonicalJson(parsed.result[resultField])) {
      throw new Error(`alpha15 verified Presentation context does not match semantic Result: ${verifiedField}`);
    }
  }
  return {
    ...parsed,
    presentation_sha256: sha256Base64Url(presentationBytes),
    verified_presentation: verifiedPresentation,
    notary_key_sha256: verifiedPresentation.notary_key_sha256,
  };
}

export function createSemanticVerificationArtifact({
  presentationBytes,
  semanticVerification,
  result,
  predicateResults,
  trustedInputs,
  verifierIdentity = "capture-harness",
  verifiedAt = new Date().toISOString(),
}) {
  const predicates = assertPredicateResults(predicateResults);
  const semanticResult = semanticVerification.result;
  const allPredicatesPass = Object.values(predicates).every((predicate) => predicate.status === "PASS");
  const authenticatedMemberId = predicates.authenticated_member_id.observed?.verified_member_id ?? null;
  return {
    schema_version: PRODUCTION_SEMANTIC_SCHEMA_VERSION,
    kind: PRODUCTION_SEMANTIC_KIND,
    status: allPredicatesPass ? "VERIFIED" : "BLOCKED",
    verifier_identity: verifierIdentity,
    verified_at: verifiedAt,
    input: {
      presentation_sha256: sha256Base64Url(presentationBytes),
      presentation_size_bytes: presentationBytes.byteLength,
    },
    trusted_inputs: {
      source: "production verification configuration and published registries",
      ...trustedInputs,
    },
    derived_from_presentation: {
      source: "alpha15 cryptographically verified Presentation and authenticated transcript disclosure",
      presentation_sha256: semanticVerification.presentation_sha256,
      tlsn_attestation_id: semanticVerification.verified_presentation.tlsn_attestation_id,
      server_identity: semanticVerification.verified_presentation.server_identity,
      notary_key_sha256: semanticVerification.verified_presentation.notary_key_sha256,
      verified_member_id: authenticatedMemberId,
      request_transcript_size: semanticVerification.verified_presentation.request_transcript_size,
      request_transcript_sha256: semanticVerification.verified_presentation.request_transcript_sha256,
      response_transcript_size: semanticVerification.verified_presentation.response_transcript_size,
      response_transcript_sha256: semanticVerification.verified_presentation.response_transcript_sha256,
      revealed_request_ranges: semanticVerification.verified_presentation.revealed_request_ranges,
      revealed_response_ranges: semanticVerification.verified_presentation.revealed_response_ranges,
    },
    http_profile: {
      ...REQUIRE_INFO_HTTP_PROFILE,
      host: semanticVerification.verified_presentation.server_identity,
    },
    semantic_result: semanticResult,
    predicates,
  };
}

export function assertSemanticVerificationArtifact(artifact, {
  presentationBytes,
  semanticVerification,
  result,
  predicateResults,
  trustedInputs,
}) {
  if (
    artifact?.schema_version !== PRODUCTION_SEMANTIC_SCHEMA_VERSION ||
    artifact?.kind !== PRODUCTION_SEMANTIC_KIND
  ) {
    throw new Error("semantic verification artifact schema is invalid");
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
    predicateResults,
    trustedInputs,
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