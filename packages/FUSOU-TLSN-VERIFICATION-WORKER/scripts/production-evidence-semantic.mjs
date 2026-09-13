import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import initVerifier, {
  inspect_alpha15_presentation,
  inspect_alpha15_presentation_with_trust_anchor,
  verify_require_info_presentation,
  verify_require_info_presentation_with_trust_anchor,
  verify_sparse_require_info_presentation,
  verify_sparse_require_info_presentation_with_trust_anchor,
} from "../src/wasm/fusou_tlsn_verifier.js";
import { assertSignedResult, assertSignedSparseResult } from "./production-evidence.mjs";
import { assertSignedResultRegistryEnvelope, resultRegistryEnvelopeHash } from "./result-registry-envelope.mjs";
import { parseBindingValue } from "./device-evidence.mjs";
import {
  PRODUCTION_EVIDENCE_REQUIREMENT_PREDICATES,
  PRODUCTION_EVIDENCE_SEMANTIC_PREDICATE_DEFINITIONS,
  PRODUCTION_EVIDENCE_SPARSE_SEMANTIC_PREDICATE_DEFINITIONS,
} from "./production-evidence-contract.mjs";
import { canonicalJson, sha256Base64Url } from "./deployment-attestation.mjs";
import { assertSigningKeyRegistry } from "./signing-key-registry.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(scriptDirectory, "../src/wasm/fusou_tlsn_verifier_bg.wasm");
let verifierInitialization;

export const PRODUCTION_SEMANTIC_SCHEMA_VERSION = 2;
export const PRODUCTION_SEMANTIC_KIND = "tlsn-production-semantic-verification";
export const PRODUCTION_SEMANTIC_PREDICATE_STATUSES = ["PASS", "UNVERIFIED", "BLOCKED", "FAIL"];
export const PRODUCTION_SEMANTIC_PREDICATES = PRODUCTION_EVIDENCE_SEMANTIC_PREDICATE_DEFINITIONS;
export const PRODUCTION_SPARSE_SEMANTIC_PREDICATES = PRODUCTION_EVIDENCE_SPARSE_SEMANTIC_PREDICATE_DEFINITIONS;

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

function parseSparseVerifierOutput(output) {
  const parsed = parseVerifierOutput(output);
  if (
    parsed.result?.version !== 2 ||
    parsed.result.profile_id !== "fusou-require-info-v2-sparse" ||
    parsed.result.disclosure_mode !== "sparse" ||
    Object.hasOwn(parsed.result, "request_transcript_sha256") ||
    Object.hasOwn(parsed.result, "response_transcript_sha256")
  ) {
    throw new Error("sparse semantic verifier output has the wrong profile or exposes a full transcript digest");
  }
  return parsed;
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

function parseSparseVerifiedPresentationOutput(output) {
  const parsed = JSON.parse(output);
  if (!parsed || typeof parsed !== "object") throw new Error("alpha15 sparse verified Presentation output is invalid");
  for (const field of ["server_identity", "tlsn_attestation_id", "notary_key_sha256", "request_transcript_size", "response_transcript_size"]) {
    if (typeof parsed[field] !== "string") throw new Error(`alpha15 sparse verified Presentation output is missing ${field}`);
  }
  if (parsed.request_transcript_sha256 !== null || parsed.response_transcript_sha256 !== null) {
    throw new Error("sparse verified Presentation unexpectedly exposes a full transcript digest");
  }
  decodeBase64Url(parsed.tlsn_attestation_id, "verified TLSN attestation ID", 16);
  decodeBase64Url(parsed.notary_key_sha256, "verified Notary key SHA-256", 32);
  parseUint64(parsed.request_transcript_size, "verified request transcript size");
  parseUint64(parsed.response_transcript_size, "verified response transcript size");
  for (const [label, ranges] of [["request", parsed.revealed_request_ranges], ["response", parsed.revealed_response_ranges]]) {
    if (!Array.isArray(ranges)) throw new Error(`alpha15 sparse ${label} ranges are invalid`);
    let previousEnd = 0n;
    for (const [index, range] of ranges.entries()) {
      const start = parseUint64(range?.start, `${label} range ${index} start`);
      const length = parseUint64(range?.length, `${label} range ${index} length`);
      if (length === 0n || start < previousEnd) throw new Error(`alpha15 sparse ${label} ranges overlap`);
      const bytes = decodeBase64Url(range.bytes, `${label} range ${index} bytes`);
      if (BigInt(bytes.length) !== length) throw new Error(`alpha15 sparse ${label} range ${index} length mismatch`);
      previousEnd = start + length;
    }
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

function sparseRangePrefix(ranges, maxBytes, label) {
  if (!Array.isArray(ranges)) throw new Error(`${label} ranges are invalid`);
  let expectedStart = 0n;
  const chunks = [];
  let total = 0;
  for (const [index, range] of ranges.entries()) {
    const start = parseUint64(range?.start, `${label} range ${index} start`);
    const length = parseUint64(range?.length, `${label} range ${index} length`);
    const bytes = decodeBase64Url(range?.bytes, `${label} range ${index} bytes`);
    if (length === 0n || BigInt(bytes.length) !== length || start < expectedStart) {
      throw new Error(`${label} range ${index} is invalid`);
    }
    if (start !== expectedStart) break;
    const remaining = maxBytes - total;
    if (remaining > 0) {
      chunks.push(bytes.subarray(0, remaining));
      total += Math.min(bytes.length, remaining);
    }
    expectedStart = start + length;
    if (total >= maxBytes) break;
  }
  if (chunks.length === 0) throw new Error(`${label} does not disclose an authenticated prefix`);
  return Buffer.concat(chunks);
}

function parseHttpHead(raw, expectedStartLine, label) {
  const firstEnd = findCrlf(raw, 0);
  if (firstEnd < 0 || raw.subarray(0, firstEnd).toString("ascii") !== expectedStartLine) {
    throw new Error(`${label} start line is invalid`);
  }
  const headers = [];
  let cursor = firstEnd + 2;
  while (true) {
    const lineEnd = findCrlf(raw, cursor);
    if (lineEnd < 0) throw new Error(`${label} header is not CRLF terminated`);
    if (lineEnd === cursor) return { headers, bodyStart: cursor + 2 };
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
}

class SparseRangeReader {
  constructor(ranges, size, label) {
    let previousEnd = 0n;
    this.ranges = ranges.map((range, index) => {
      const start = parseUint64(range?.start, `${label} range ${index} start`);
      const length = parseUint64(range?.length, `${label} range ${index} length`);
      const bytes = decodeBase64Url(range?.bytes, `${label} range ${index} bytes`);
      if (length === 0n || BigInt(bytes.length) !== length || start < previousEnd || start + length > size) {
        throw new Error(`${label} range ${index} is invalid`);
      }
      previousEnd = start + length;
      return { start, end: start + length, bytes };
    });
    this.size = size;
    this.label = label;
  }

  readByte(position) {
    const offset = BigInt(position);
    if (offset < 0n || offset >= this.size) throw new Error(`${this.label} read is outside the transcript`);
    const range = this.ranges.find((candidate) => candidate.start <= offset && offset < candidate.end);
    if (!range) throw new Error(`${this.label} read crosses an undisclosed range at ${offset}`);
    return range.bytes[Number(offset - range.start)];
  }

  readBytes(start, length) {
    const first = BigInt(start);
    const count = BigInt(length);
    if (count < 0n || first + count > this.size) throw new Error(`${this.label} read is outside the transcript`);
    const output = Buffer.alloc(Number(count));
    for (let index = 0n; index < count; index += 1n) output[Number(index)] = this.readByte(first + index);
    return output;
  }
}

function sparseJsonWhitespace(byte) {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function sparseJsonString(reader, cursor, label) {
  const start = cursor.position;
  if (reader.readByte(cursor.position) !== 0x22) throw new Error(`${label} JSON string is missing`);
  cursor.position += 1n;
  while (true) {
    const byte = reader.readByte(cursor.position);
    if (byte === 0x22) {
      cursor.position += 1n;
      const raw = reader.readBytes(start, cursor.position - start);
      let value;
      try {
        value = JSON.parse(decodeUtf8(raw, `${label} JSON string`));
      } catch {
        throw new Error(`${label} JSON string is invalid`);
      }
      return value;
    }
    if (byte < 0x20) throw new Error(`${label} JSON string contains a control byte`);
    if (byte === 0x5c) {
      cursor.position += 1n;
      const escape = reader.readByte(cursor.position);
      if (![0x22, 0x5c, 0x2f, 0x62, 0x66, 0x6e, 0x72, 0x74, 0x75].includes(escape)) {
        throw new Error(`${label} JSON string escape is invalid`);
      }
      cursor.position += 1n;
      if (escape === 0x75) {
        for (let index = 0; index < 4; index += 1) {
          if (!/[0-9a-fA-F]/.test(String.fromCharCode(reader.readByte(cursor.position)))) {
            throw new Error(`${label} JSON Unicode escape is invalid`);
          }
          cursor.position += 1n;
        }
      }
    } else {
      cursor.position += 1n;
    }
  }
}

function sparseJsonNumber(reader, cursor, label) {
  const start = cursor.position;
  while (cursor.position < reader.size) {
    const byte = reader.readByte(cursor.position);
    if (sparseJsonWhitespace(byte) || [0x2c, 0x5d, 0x7d].includes(byte)) break;
    cursor.position += 1n;
  }
  const raw = decodeUtf8(reader.readBytes(start, cursor.position - start), `${label} JSON number`);
  if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw)) {
    throw new Error(`${label} JSON number is invalid`);
  }
  return { kind: "number", raw };
}

function parseSparseJsonValue(reader, cursor, label, depth = 0) {
  if (depth > 128) throw new Error(`${label} JSON nesting is too deep`);
  while (cursor.position < reader.size && sparseJsonWhitespace(reader.readByte(cursor.position))) cursor.position += 1n;
  const byte = reader.readByte(cursor.position);
  if (byte === 0x22) return sparseJsonString(reader, cursor, label);
  if (byte === 0x7b) {
    const object = {};
    const keys = new Set();
    cursor.position += 1n;
    while (true) {
      while (cursor.position < reader.size && sparseJsonWhitespace(reader.readByte(cursor.position))) cursor.position += 1n;
      if (reader.readByte(cursor.position) === 0x7d) {
        cursor.position += 1n;
        return object;
      }
      const key = sparseJsonString(reader, cursor, label);
      if (keys.has(key)) throw new Error(`${label} JSON object contains a duplicate key`);
      keys.add(key);
      while (cursor.position < reader.size && sparseJsonWhitespace(reader.readByte(cursor.position))) cursor.position += 1n;
      if (reader.readByte(cursor.position) !== 0x3a) throw new Error(`${label} JSON object colon is missing`);
      cursor.position += 1n;
      object[key] = parseSparseJsonValue(reader, cursor, label, depth + 1);
      while (cursor.position < reader.size && sparseJsonWhitespace(reader.readByte(cursor.position))) cursor.position += 1n;
      const separator = reader.readByte(cursor.position);
      if (separator === 0x2c) {
        cursor.position += 1n;
        continue;
      }
      if (separator === 0x7d) {
        cursor.position += 1n;
        return object;
      }
      throw new Error(`${label} JSON object separator is invalid`);
    }
  }
  if (byte === 0x5b) {
    const array = [];
    cursor.position += 1n;
    while (true) {
      while (cursor.position < reader.size && sparseJsonWhitespace(reader.readByte(cursor.position))) cursor.position += 1n;
      if (reader.readByte(cursor.position) === 0x5d) {
        cursor.position += 1n;
        return array;
      }
      array.push(parseSparseJsonValue(reader, cursor, label, depth + 1));
      while (cursor.position < reader.size && sparseJsonWhitespace(reader.readByte(cursor.position))) cursor.position += 1n;
      const separator = reader.readByte(cursor.position);
      if (separator === 0x2c) {
        cursor.position += 1n;
        continue;
      }
      if (separator === 0x5d) {
        cursor.position += 1n;
        return array;
      }
      throw new Error(`${label} JSON array separator is invalid`);
    }
  }
  if (byte === 0x74 && reader.readBytes(cursor.position, 4).toString("ascii") === "true") {
    cursor.position += 4n;
    return true;
  }
  if (byte === 0x66 && reader.readBytes(cursor.position, 5).toString("ascii") === "false") {
    cursor.position += 5n;
    return false;
  }
  if (byte === 0x6e && reader.readBytes(cursor.position, 4).toString("ascii") === "null") {
    cursor.position += 4n;
    return null;
  }
  if (byte === 0x2d || (byte >= 0x30 && byte <= 0x39)) return sparseJsonNumber(reader, cursor, label);
  throw new Error(`${label} JSON value is invalid`);
}

export function parseSparseProfileTranscripts(semanticVerification, trustedServerIdentity, expectedBindingValue) {
  const verifiedPresentation = semanticVerification.verified_presentation;
  const requestPrefix = sparseRangePrefix(verifiedPresentation.revealed_request_ranges, 65_536, "request transcript");
  const responsePrefix = sparseRangePrefix(verifiedPresentation.revealed_response_ranges, 65_536, "response transcript");
  const request = parseHttpHead(requestPrefix, `POST ${REQUIRE_INFO_HTTP_PROFILE.request_target} HTTP/1.1`, "require_info request");
  const response = parseHttpHead(responsePrefix, REQUIRE_INFO_HTTP_PROFILE.response_status_line, "require_info response");
  const hosts = headerValues(request.headers, "host");
  if (hosts.length !== 1 || hosts[0].value !== trustedServerIdentity) throw new Error("require_info Host does not match trusted server identity");
  const bindings = headerValues(request.headers, "x-attestation-binding");
  if (bindings.length !== 1 || bindings[0].rawValue.toString("ascii") !== ` ${bindings[0].value}`) {
    throw new Error("require_info binding header cardinality or spacing is invalid");
  }
  if (expectedBindingValue !== undefined && bindings[0].value !== expectedBindingValue) {
    throw new Error("require_info binding does not match the verified Result");
  }
  const requestLengths = headerValues(request.headers, "content-length");
  const requestTransfers = headerValues(request.headers, "transfer-encoding");
  if (requestLengths.length !== 1 || requestTransfers.length !== 0 || parseUint64(requestLengths[0].value, "request content length") !== 0n) {
    throw new Error("sparse require_info request framing is unsupported");
  }
  if (BigInt(request.bodyStart) !== parseUint64(verifiedPresentation.request_transcript_size, "request transcript size")) {
    throw new Error("request Content-Length does not match the authenticated transcript size");
  }
  const responseLengths = headerValues(response.headers, "content-length");
  const responseTransfers = headerValues(response.headers, "transfer-encoding");
  if (responseLengths.length !== 1 || responseTransfers.length !== 0) {
    throw new Error("sparse require_info response framing is unsupported");
  }
  const responseLength = parseUint64(responseLengths[0].value, "response content length");
  if (BigInt(response.bodyStart) + responseLength !== parseUint64(verifiedPresentation.response_transcript_size, "response transcript size")) {
    throw new Error("response Content-Length does not match the authenticated transcript size");
  }
  const contentEncodings = headerValues(response.headers, "content-encoding");
  if (contentEncodings.length > 1 || (contentEncodings.length === 1 && contentEncodings[0].value.toLowerCase() !== "identity")) {
    throw new Error("sparse compressed response bodies are unsupported");
  }
  const responseBodyStart = BigInt(response.bodyStart);
  const responseTranscriptSize = parseUint64(verifiedPresentation.response_transcript_size, "response transcript size");
  const responseReader = new SparseRangeReader(verifiedPresentation.revealed_response_ranges, responseTranscriptSize, "response transcript");
  const prefix = Buffer.from("svdata=");
  if (!responseReader.readBytes(responseBodyStart, BigInt(prefix.length)).equals(prefix)) {
    throw new Error("response body lacks exact svdata= prefix");
  }
  const cursor = { position: responseBodyStart + BigInt(prefix.length) };
  const parsed = parseSparseJsonValue(responseReader, cursor, "require_info JSON");
  while (cursor.position < responseTranscriptSize && sparseJsonWhitespace(responseReader.readByte(cursor.position))) cursor.position += 1n;
  if (cursor.position !== responseTranscriptSize) throw new Error("require_info JSON has invalid trailing bytes");
  if (!parsed || parsed.api_result?.kind !== "number" || parsed.api_result.raw !== "1") {
    throw new Error("require_info JSON api_result is invalid");
  }
  const member = parsed.api_data?.api_basic?.api_member_id;
  if (!member || member.kind !== "number" || !/^[1-9][0-9]{0,15}$/.test(member.raw)) {
    throw new Error("authenticated api_member_id path is invalid");
  }
  return { request, response, memberId: member.raw };
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
  derivedFields,
  detail = "",
  observed = {},
  definitions = PRODUCTION_SEMANTIC_PREDICATES,
}) {
  const definition = definitions[name];
  return {
    ...definition,
    status,
    verified_at: verifiedAt,
    evidence_artifacts: [...evidenceArtifacts],
    derived_fields: [...(derivedFields ?? definition.derived_fields)],
    detail,
    observed,
  };
}

function runPredicate(name, verifiedAt, evidenceArtifacts, callback, definitions = PRODUCTION_SEMANTIC_PREDICATES) {
  try {
    return predicateResult(name, {
      status: "PASS",
      verifiedAt,
      evidenceArtifacts,
      definitions,
      ...callback(),
    });
  } catch (error) {
    return predicateResult(name, {
      status: "FAIL",
      verifiedAt,
      evidenceArtifacts,
      definitions,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function assertPredicateResults(predicateResults, definitions = PRODUCTION_SEMANTIC_PREDICATES) {
  if (!predicateResults || typeof predicateResults !== "object") throw new Error("semantic predicate results are required");
  for (const [name, definition] of Object.entries(definitions)) {
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

export function verifyPresentationBindingToSession({
  semanticVerification,
  sessionBinding,
  sessionId,
  verifiedAt = new Date().toISOString(),
}) {
  return runPredicate("presentation_binding_to_session", verifiedAt, ["presentation", "session", "result"], () => {
    if (typeof sessionBinding !== "string" || typeof sessionId !== "string") {
      throw new Error("current Session Authority binding and session ID are required");
    }
    const framedBinding = parseBindingValue(sessionBinding);
    if (framedBinding.sessionId !== sessionId) {
      throw new Error("current session binding framing does not match the current session");
    }
    const transcripts = parseProfileTranscripts(semanticVerification, semanticVerification.result?.server_identity, sessionBinding);
    if (semanticVerification.result?.binding_value !== sessionBinding) {
      throw new Error("semantic Result binding does not match the current Session Authority binding");
    }
    if (semanticVerification.result?.attestation_session_id !== sessionId) {
      throw new Error("semantic Result session does not match the current Session Authority session");
    }
    return {
      observed: {
        attestation_session_id: sessionId,
        binding_value: sessionBinding,
        binding_sha256: sha256Base64Url(sessionBinding),
        request_transcript_sha256: sha256Base64Url(transcripts.requestTranscript),
      },
    };
  });
}

function remapSparsePredicate(name, result) {
  return {
    ...result,
    ...PRODUCTION_SPARSE_SEMANTIC_PREDICATES[name],
    derived_fields: [...PRODUCTION_SPARSE_SEMANTIC_PREDICATES[name].derived_fields],
  };
}

export function verifySparsePresentationCryptography({ presentationBytes, semanticVerification, verifiedAt = new Date().toISOString() }) {
  return runPredicate("presentation_cryptography", verifiedAt, ["presentation"], () => {
    const verifiedPresentation = semanticVerification?.verified_presentation;
    if (verifiedPresentation?.server_identity === undefined || semanticVerification.presentation_sha256 !== sha256Base64Url(presentationBytes)) {
      throw new Error("sparse Presentation cryptographic identity is invalid");
    }
    decodeBase64Url(verifiedPresentation.tlsn_attestation_id, "verified TLSN attestation ID", 16);
    if (!Array.isArray(verifiedPresentation.revealed_request_ranges) || !Array.isArray(verifiedPresentation.revealed_response_ranges)) {
      throw new Error("sparse Presentation ranges are missing");
    }
    return {
      definitions: PRODUCTION_SPARSE_SEMANTIC_PREDICATES,
      observed: {
        presentation_sha256: semanticVerification.presentation_sha256,
        tlsn_attestation_id: verifiedPresentation.tlsn_attestation_id,
        request_transcript_size: verifiedPresentation.request_transcript_size,
        response_transcript_size: verifiedPresentation.response_transcript_size,
        revealed_request_ranges: verifiedPresentation.revealed_request_ranges,
        revealed_response_ranges: verifiedPresentation.revealed_response_ranges,
      },
    };
  }, PRODUCTION_SPARSE_SEMANTIC_PREDICATES);
}

export function verifySparseRequireInfoHttpProfile({
  semanticVerification,
  trustedServerIdentity,
  trustedProfileId = "fusou-require-info-v2-sparse",
  trustedProfileSha256,
  trustedVerifierKeyId,
  verifiedAt = new Date().toISOString(),
}) {
  return runPredicate("require_info_http_profile", verifiedAt, ["presentation"], () => {
    const result = semanticVerification.result;
    if (result?.profile_id !== trustedProfileId || result?.disclosure_mode !== "sparse" || result?.profile_sha256 !== trustedProfileSha256) {
      throw new Error("sparse semantic Result profile does not match trusted configuration");
    }
    if (result?.verifier_key_id !== trustedVerifierKeyId) throw new Error("sparse semantic Result verifier key ID mismatch");
    const transcripts = parseSparseProfileTranscripts(semanticVerification, trustedServerIdentity, result.binding_value);
    if (transcripts.memberId !== result.verified_member_id) throw new Error("sparse parser member ID does not match the semantic Result");
    return {
      observed: {
        request_method: REQUIRE_INFO_HTTP_PROFILE.request_method,
        request_target: REQUIRE_INFO_HTTP_PROFILE.request_target,
        request_http_version: REQUIRE_INFO_HTTP_PROFILE.request_http_version,
        response_status_line: REQUIRE_INFO_HTTP_PROFILE.response_status_line,
        host: trustedServerIdentity,
        request_transcript_size: result.request_transcript_size,
        response_transcript_size: result.response_transcript_size,
        revealed_request_ranges: result.revealed_request_ranges,
        revealed_response_ranges: result.revealed_response_ranges,
      },
    };
  }, PRODUCTION_SPARSE_SEMANTIC_PREDICATES);
}

export function verifySparsePresentationBindingToSession({
  semanticVerification,
  sessionBinding,
  sessionId,
  verifiedAt = new Date().toISOString(),
}) {
  return runPredicate("presentation_binding_to_session", verifiedAt, ["presentation", "session", "result"], () => {
    const framedBinding = parseBindingValue(sessionBinding);
    if (framedBinding.sessionId !== sessionId || semanticVerification.result?.binding_value !== sessionBinding || semanticVerification.result?.attestation_session_id !== sessionId) {
      throw new Error("sparse Presentation binding does not match the current session");
    }
    parseSparseProfileTranscripts(semanticVerification, semanticVerification.result.server_identity, sessionBinding);
    return {
      observed: {
        attestation_session_id: sessionId,
        binding_value: sessionBinding,
        binding_sha256: sha256Base64Url(sessionBinding),
        revealed_request_ranges: semanticVerification.result.revealed_request_ranges,
      },
    };
  }, PRODUCTION_SPARSE_SEMANTIC_PREDICATES);
}

export function deriveSparseAuthenticatedMemberId({ semanticVerification, trustedServerIdentity, verifiedAt = new Date().toISOString() }) {
  return runPredicate("authenticated_member_id", verifiedAt, ["presentation"], () => {
    const transcripts = parseSparseProfileTranscripts(semanticVerification, trustedServerIdentity);
    if (!/^[1-9][0-9]{0,15}$/.test(transcripts.memberId ?? "")) throw new Error("sparse authenticated member ID is invalid");
    if (transcripts.memberId !== semanticVerification.result?.verified_member_id) throw new Error("sparse authenticated member ID does not match the semantic Result");
    return { observed: { verified_member_id: transcripts.memberId, revealed_response_ranges: semanticVerification.result.revealed_response_ranges } };
  }, PRODUCTION_SPARSE_SEMANTIC_PREDICATES);
}

export function verifySparseResultPresentationBinding({ semanticVerification, result, verifiedAt = new Date().toISOString() }) {
  return runPredicate("result_presentation_binding", verifiedAt, ["presentation", "result"], () => {
    const fields = [
      ["verified_member_id", "verified_member_id"],
      ["tlsn_attestation_id", "tlsn_attestation_id"],
      ["server_identity", "server_identity"],
      ["profile_sha256", "profile_sha256"],
      ["presentation_sha256", "presentation_sha256"],
      ["revealed_request_ranges", "revealed_request_ranges"],
      ["revealed_response_ranges", "revealed_response_ranges"],
      ["canonical_user_id", "canonical_user_id"],
      ["device_id", "device_id"],
      ["device_challenge", "device_challenge"],
      ["attestation_session_id", "attestation_session_id"],
      ["binding_value", "binding_value"],
    ];
    const mismatches = fields.filter(([left, right]) => canonicalJson(semanticVerification.result?.[left]) !== canonicalJson(result?.[right]));
    if (mismatches.length > 0) throw new Error(`Sparse Result-to-Presentation binding mismatch: ${mismatches.map(([left, right]) => `${left}:${right}`).join(",")}`);
    return { observed: Object.fromEntries(fields.map(([field]) => [field, semanticVerification.result[field]])) };
  }, PRODUCTION_SPARSE_SEMANTIC_PREDICATES);
}

export function verifySparseResultSignature({ result, resultRegistry, resultPublicKeySpki, resultSignerKeyId, verifiedAt = new Date().toISOString() }) {
  return runPredicate("result_signature", verifiedAt, ["result", "result_registry"], () => {
    const verification = assertSignedSparseResult(result, {
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
  }, PRODUCTION_SPARSE_SEMANTIC_PREDICATES);
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

export function verifyResultRegistryRootAuthentication({
  resultRegistry,
  resultRegistryRaw,
  resultRegistryEnvelope,
  resultRegistryEnvelopeRaw,
  resultRegistrySha256,
  trustedInputs,
  verifiedAt = new Date().toISOString(),
}) {
  return runPredicate("result_registry_root_authentication", verifiedAt, ["health", "result_registry", "result_registry_envelope"], () => {
    assertSignedResultRegistryEnvelope(resultRegistryEnvelope, {
      registry: resultRegistry,
      registryRaw: resultRegistryRaw,
      trustedRootKeyId: trustedInputs.result_registry_root_key_id,
      trustedRootPublicKeySpki: trustedInputs.result_registry_root_public_key_spki,
    });
    const envelopeHash = resultRegistryEnvelopeHash(resultRegistryEnvelopeRaw);
    if (
      trustedInputs.result_key_registry_sha256 !== resultRegistrySha256 ||
      trustedInputs.result_key_registry_envelope_sha256 !== envelopeHash ||
      trustedInputs.result_registry_root_key_id !== resultRegistryEnvelope.root_key_id ||
      trustedInputs.result_registry_root_public_key_spki !== resultRegistryEnvelope.root_public_key_spki
    ) {
      throw new Error("published Result registry Root identity does not match the authenticated envelope");
    }
    return {
      observed: {
        result_key_registry_sha256: resultRegistrySha256,
        result_key_registry_envelope_sha256: envelopeHash,
        result_registry_root_key_id: resultRegistryEnvelope.root_key_id,
        result_registry_root_public_key_spki: resultRegistryEnvelope.root_public_key_spki,
      },
    };
  });
}

export function verifyResultKeyPublication({ resultRegistry, resultRegistrySha256, resultPublicKeySpki, resultSignerKeyId, trustedInputs, verifiedAt = new Date().toISOString() }) {
  return runPredicate("result_key_publication", verifiedAt, ["health", "result_registry"], () => {
    assertSigningKeyRegistry(resultRegistry, {
      currentKeyId: resultSignerKeyId,
      currentPublicKeySpki: resultPublicKeySpki,
    });
    if (
      trustedInputs.result_public_key_spki !== resultPublicKeySpki ||
      trustedInputs.result_signer_key_id !== resultSignerKeyId ||
      trustedInputs.result_key_registry_sha256 !== resultRegistrySha256
    ) {
      throw new Error("published Result key identity does not match the trusted registry");
    }
    return {
      observed: {
        result_public_key_spki: resultPublicKeySpki,
        result_signer_key_id: resultSignerKeyId,
        result_key_registry_sha256: resultRegistrySha256,
      },
    };
  });
}

export function verifyTrustRootPublication({ trustRootCertificateBytes, trustedTrustRootCertificateSha256, verifiedAt = new Date().toISOString() }) {
  return runPredicate("trust_root_publication", verifiedAt, ["health", "trust_root"], () => {
    if (!trustRootCertificateBytes || !(Buffer.isBuffer(trustRootCertificateBytes) || trustRootCertificateBytes instanceof Uint8Array)) {
      throw new Error("captured trust-root bytes are required");
    }
    const observedHash = sha256Base64Url(trustRootCertificateBytes);
    if (observedHash !== trustedTrustRootCertificateSha256) {
      throw new Error("captured trust-root bytes do not match the trusted Worker identity");
    }
    return { observed: { trust_root_certificate_sha256: observedHash } };
  });
}

export function verifySemanticPredicates({
  presentationBytes,
  semanticVerification,
  result,
  trustedInputs,
  notaryRegistry,
  resultRegistry,
  resultRegistryRaw,
  resultRegistryEnvelope,
  resultRegistryEnvelopeRaw,
  resultRegistrySha256,
  resultPublicKeySpki,
  resultSignerKeyId,
  trustRootCertificateBytes,
  sessionBinding,
  sessionId,
  includeResultSignature = true,
  verifiedAt = new Date().toISOString(),
}) {
  const sparse = semanticVerification?.result?.disclosure_mode === "sparse";
  if (sparse) {
    const predicateResults = {
      presentation_cryptography: verifySparsePresentationCryptography({ presentationBytes, semanticVerification, verifiedAt }),
      notary_identity: remapSparsePredicate("notary_identity", verifyNotaryIdentity({ semanticVerification, notaryRegistry, notaryKeyId: trustedInputs.notary_key_id, verifiedAt })),
      server_identity: remapSparsePredicate("server_identity", verifyServerIdentity({ semanticVerification, trustedServerIdentity: trustedInputs.server_identity, verifiedAt })),
      require_info_http_profile: verifySparseRequireInfoHttpProfile({
        semanticVerification,
        trustedServerIdentity: trustedInputs.server_identity,
        trustedProfileId: trustedInputs.profile_id,
        trustedProfileSha256: trustedInputs.profile_sha256,
        trustedVerifierKeyId: trustedInputs.verifier_key_id,
        verifiedAt,
      }),
      presentation_binding_to_session: verifySparsePresentationBindingToSession({ semanticVerification, sessionBinding, sessionId, verifiedAt }),
      authenticated_member_id: deriveSparseAuthenticatedMemberId({ semanticVerification, trustedServerIdentity: trustedInputs.server_identity, verifiedAt }),
      result_presentation_binding: verifySparseResultPresentationBinding({ semanticVerification, result, verifiedAt }),
      result_registry_root_authentication: remapSparsePredicate("result_registry_root_authentication", verifyResultRegistryRootAuthentication({
        resultRegistry,
        resultRegistryRaw,
        resultRegistryEnvelope,
        resultRegistryEnvelopeRaw,
        resultRegistrySha256,
        trustedInputs,
        verifiedAt,
      })),
      result_signature: includeResultSignature
        ? verifySparseResultSignature({ result, resultRegistry, resultPublicKeySpki, resultSignerKeyId, verifiedAt })
        : predicateResult("result_signature", {
          status: "UNVERIFIED",
          verifiedAt,
          evidenceArtifacts: ["result", "result_registry"],
          detail: "Result signature verification is deferred until sparse Presentation semantics are established",
          definitions: PRODUCTION_SPARSE_SEMANTIC_PREDICATES,
        }),
      result_key_publication: remapSparsePredicate("result_key_publication", verifyResultKeyPublication({ resultRegistry, resultRegistrySha256, resultPublicKeySpki, resultSignerKeyId, trustedInputs, verifiedAt })),
      trust_root_publication: remapSparsePredicate("trust_root_publication", verifyTrustRootPublication({ trustRootCertificateBytes, trustedTrustRootCertificateSha256: trustedInputs.trust_root_certificate_sha256, verifiedAt })),
    };
    return assertPredicateResults(predicateResults, PRODUCTION_SPARSE_SEMANTIC_PREDICATES);
  }
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
    presentation_binding_to_session: verifyPresentationBindingToSession({
      semanticVerification,
      sessionBinding,
      sessionId,
      verifiedAt,
    }),
    authenticated_member_id: deriveAuthenticatedMemberId({ semanticVerification, trustedServerIdentity: trustedInputs.server_identity, verifiedAt }),
    result_presentation_binding: verifyResultPresentationBinding({ semanticVerification, result, verifiedAt }),
    result_registry_root_authentication: verifyResultRegistryRootAuthentication({
      resultRegistry,
      resultRegistryRaw,
      resultRegistryEnvelope,
      resultRegistryEnvelopeRaw,
      resultRegistrySha256,
      trustedInputs,
      verifiedAt,
    }),
    result_signature: includeResultSignature
      ? verifyResultSignature({ result, resultRegistry, resultPublicKeySpki, resultSignerKeyId, verifiedAt })
      : predicateResult("result_signature", {
        status: "UNVERIFIED",
        verifiedAt,
        evidenceArtifacts: ["result", "result_registry"],
        detail: "Result signature verification is deferred until Presentation semantics are established",
      }),
    result_key_publication: verifyResultKeyPublication({
      resultRegistry,
      resultRegistrySha256,
      resultPublicKeySpki,
      resultSignerKeyId,
      trustedInputs,
      verifiedAt,
    }),
    trust_root_publication: verifyTrustRootPublication({
      trustRootCertificateBytes,
      trustedTrustRootCertificateSha256: trustedInputs.trust_root_certificate_sha256,
      verifiedAt,
    }),
  };
  return assertPredicateResults(predicateResults);
}

export function semanticRequirementStatus(requirement, predicateResults) {
  const predicateNames = PRODUCTION_EVIDENCE_REQUIREMENT_PREDICATES[requirement];
  if (!Array.isArray(predicateNames) || predicateNames.length === 0) {
    throw new Error(`unknown or empty production evidence requirement: ${requirement}`);
  }
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
  disclosureMode = "complete",
}) {
  if (!Buffer.isBuffer(presentationBytes) && !(presentationBytes instanceof Uint8Array)) {
    throw new Error("semantic verifier Presentation bytes are required");
  }
  if (disclosureMode !== "complete" && disclosureMode !== "sparse") {
    throw new Error("unknown TLSN disclosure mode");
  }
  const sparse = disclosureMode === "sparse";
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
  const verifiedPresentation = sparse
    ? parseSparseVerifiedPresentationOutput(inspectionOutput)
    : parseVerifiedPresentationOutput(inspectionOutput);
  let output;
  try {
    output = sparse
      ? trustAnchorDer
        ? verify_sparse_require_info_presentation_with_trust_anchor(
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
        : verify_sparse_require_info_presentation(
          presentationBytes,
          serverIdentity,
          profileBytes,
          verifierKeyId,
          notaryKeyId,
          canonicalUserId,
          canonicalDeviceId,
          challengeBytes,
          trustedNotaryKey,
        )
      : trustAnchorDer
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
  const parsed = sparse ? parseSparseVerifierOutput(output) : parseVerifierOutput(output);
  const commonFields = [
    ["server_identity", "server_identity"],
    ["tlsn_attestation_id", "tlsn_attestation_id"],
    ["request_transcript_size", "request_transcript_size"],
    ["response_transcript_size", "response_transcript_size"],
    ["revealed_request_ranges", "revealed_request_ranges"],
    ["revealed_response_ranges", "revealed_response_ranges"],
  ];
  if (!sparse) {
    commonFields.splice(3, 0, ["request_transcript_sha256", "request_transcript_sha256"]);
    commonFields.splice(4, 0, ["response_transcript_sha256", "response_transcript_sha256"]);
  }
  for (const [verifiedField, resultField] of commonFields) {
    if (canonicalJson(verifiedPresentation[verifiedField]) !== canonicalJson(parsed.result[resultField])) {
      throw new Error(`alpha15 verified Presentation context does not match semantic Result: ${verifiedField}`);
    }
  }
  return {
    ...parsed,
    presentation_sha256: sha256Base64Url(presentationBytes),
    disclosure_mode: disclosureMode,
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
  const sparse = semanticResult?.disclosure_mode === "sparse";
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
      source: sparse
        ? "alpha15 cryptographically verified Presentation and authenticated sparse transcript ranges"
        : "alpha15 cryptographically verified Presentation and authenticated transcript disclosure",
      presentation_sha256: semanticVerification.presentation_sha256,
      tlsn_attestation_id: semanticVerification.verified_presentation.tlsn_attestation_id,
      server_identity: semanticVerification.verified_presentation.server_identity,
      notary_key_sha256: semanticVerification.verified_presentation.notary_key_sha256,
      verified_member_id: authenticatedMemberId,
      request_transcript_size: semanticVerification.verified_presentation.request_transcript_size,
      response_transcript_size: semanticVerification.verified_presentation.response_transcript_size,
      revealed_request_ranges: semanticVerification.verified_presentation.revealed_request_ranges,
      revealed_response_ranges: semanticVerification.verified_presentation.revealed_response_ranges,
      ...(sparse ? {} : {
        request_transcript_sha256: semanticVerification.verified_presentation.request_transcript_sha256,
        response_transcript_sha256: semanticVerification.verified_presentation.response_transcript_sha256,
      }),
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