import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { TextDecoder } from "node:util";

const corpus = JSON.parse(
  readFileSync(
    new URL("../fixtures/p010-cross-language-corpus-v1.json", import.meta.url),
    "utf8",
  ),
);

const COMPLETE_KEYS = [
  "version",
  "profile_id",
  "profile_sha256",
  "issuer",
  "proof_purpose",
  "canonical_user_id",
  "device_id",
  "device_challenge",
  "verified_member_id",
  "attestation_session_id",
  "binding_nonce",
  "binding_value",
  "verifier_key_id",
  "notary_key_id",
  "tlsn_attestation_id",
  "presentation_sha256",
  "server_identity",
  "origin_inventory_sha256",
  "target_approval_artifact_sha256",
  "request_transcript_size",
  "request_transcript_sha256",
  "response_transcript_size",
  "response_transcript_sha256",
  "revealed_request_ranges",
  "revealed_response_ranges",
  "signature",
];

const SPARSE_KEYS = [
  "version",
  "profile_id",
  "disclosure_mode",
  "profile_sha256",
  "issuer",
  "proof_purpose",
  "canonical_user_id",
  "device_id",
  "device_challenge",
  "verified_member_id",
  "attestation_session_id",
  "binding_nonce",
  "binding_value",
  "verifier_key_id",
  "notary_key_id",
  "notary_key_sha256",
  "tlsn_attestation_id",
  "presentation_sha256",
  "server_identity",
  "origin_inventory_sha256",
  "target_approval_artifact_sha256",
  "request_transcript_size",
  "response_transcript_size",
  "revealed_request_ranges",
  "revealed_response_ranges",
  "signature",
];

const RECEIPT_FIELDS = {
  "session-receipt-v1": [
    "signer_key_id",
    "session_id",
    "canonical_user_id",
    "device_id",
    "device_auth_nonce",
    "nonce",
    "device_challenge",
    "binding_value",
    "created_at",
    "expires_at",
  ],
  "consume-receipt-v1": [
    "signer_key_id",
    "session_id",
    "canonical_user_id",
    "device_id",
    "nonce",
    "binding_value",
    "presentation_id",
    "used_at",
  ],
};

const RECEIPT_DOMAINS = {
  "session-receipt-v1": "FUSOU-ATTESTATION-SESSION-V1\0",
  "consume-receipt-v1": "FUSOU-ATTESTATION-CONSUME-V1\0",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UINT64_MAX = (1n << 64n) - 1n;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function decodeHex(value) {
  if (typeof value !== "string" || value.length % 2 !== 0 || !/^[0-9a-f]*$/.test(value)) {
    throw new Error("invalid lowercase hexadecimal");
  }
  return Buffer.from(value, "hex");
}

function decodeBase64url(value, expectedLength) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.includes("=")
  ) {
    throw new Error("invalid unpadded base64url");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("noncanonical base64url");
  }
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new Error("base64url value has the wrong length");
  }
  return decoded;
}

function parseCanonicalUint(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("invalid canonical unsigned integer");
  }
  const parsed = BigInt(value);
  if (parsed > UINT64_MAX) {
    throw new Error("unsigned integer exceeds UInt64");
  }
  return parsed;
}

function appendU16(output, value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error("value exceeds UInt16");
  }
  const encoded = Buffer.alloc(2);
  encoded.writeUInt16BE(value);
  output.push(encoded);
}

function appendU32(output, value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error("value exceeds UInt32");
  }
  const encoded = Buffer.alloc(4);
  encoded.writeUInt32BE(value);
  output.push(encoded);
}

function appendU64(output, value) {
  const encoded = Buffer.alloc(8);
  encoded.writeBigUInt64BE(BigInt(value));
  output.push(encoded);
}

function appendLengthPrefixed(output, bytes) {
  appendU16(output, bytes.length);
  output.push(bytes);
}

function uuidBytes(value) {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("invalid canonical UUID");
  }
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

function encodeRanges(ranges) {
  const output = [];
  appendU32(output, ranges.length);
  for (const range of ranges) {
    const start = parseCanonicalUint(range.start);
    const length = parseCanonicalUint(range.length);
    const bytes = decodeBase64url(range.bytes);
    if (length === 0n || BigInt(bytes.length) !== length) {
      throw new Error("range byte length mismatch");
    }
    appendU64(output, start);
    appendU64(output, length);
    appendU64(output, bytes.length);
    output.push(bytes);
  }
  return Buffer.concat(output);
}

function validateRanges(ranges, transcriptSize) {
  if (!Array.isArray(ranges)) {
    throw new Error("ranges must be an array");
  }
  const size = parseCanonicalUint(transcriptSize);
  let previousEnd = 0n;
  let previousStart = -1n;
  for (const range of ranges) {
    if (
      range === null ||
      typeof range !== "object" ||
      JSON.stringify(Object.keys(range)) !== JSON.stringify(["start", "length", "bytes"])
    ) {
      throw new Error("range field inventory or order is invalid");
    }
    const start = parseCanonicalUint(range.start);
    const length = parseCanonicalUint(range.length);
    const bytes = decodeBase64url(range.bytes);
    const end = start + length;
    if (length === 0n || BigInt(bytes.length) !== length || end > size) {
      throw new Error("range size or bounds are invalid");
    }
    if (start <= previousStart || start < previousEnd) {
      throw new Error("ranges are not strictly ordered and disjoint");
    }
    previousStart = start;
    previousEnd = end;
  }
  encodeRanges(ranges);
}

function validateServerIdentity(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 253 ||
    value.endsWith(".")
  ) {
    throw new Error("invalid server identity");
  }
  for (const label of value.split(".")) {
    if (
      label.length === 0 ||
      label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    ) {
      throw new Error("invalid server identity");
    }
  }
}

function validateResult(raw, contract) {
  const text = UTF8_DECODER.decode(raw);
  const result = JSON.parse(text);
  const keys = contract === "complete-result-v2" ? COMPLETE_KEYS : SPARSE_KEYS;
  const expectedVersion = contract === "complete-result-v2" ? 2 : 3;
  if (
    result === null ||
    Array.isArray(result) ||
    typeof result !== "object" ||
    JSON.stringify(Object.keys(result)) !== JSON.stringify(keys) ||
    JSON.stringify(result) !== text
  ) {
    throw new Error("Result JSON is not canonical");
  }
  if (result.version !== expectedVersion) {
    throw new Error("Result version does not match its contract");
  }
  if (
    result.profile_id !==
      (contract === "complete-result-v2"
        ? "fusou-require-info-v1"
        : "fusou-require-info-v2-sparse") ||
    (contract === "sparse-result-v3" && result.disclosure_mode !== "sparse") ||
    result.issuer !== "fusou-tlsn-verifier" ||
    result.proof_purpose !== "GAME_ACCOUNT_IDENTITY_V1"
  ) {
    throw new Error("Result identity does not match its contract");
  }
  for (const field of ["canonical_user_id", "device_id"]) {
    if (typeof result[field] !== "string" || !UUID_PATTERN.test(result[field])) {
      throw new Error(`invalid ${field}`);
    }
  }
  if (
    !UUID_PATTERN.test(result.attestation_session_id) ||
    result.attestation_session_id[14] !== "4" ||
    !/[89ab]/.test(result.attestation_session_id[19])
  ) {
    throw new Error("session ID is not canonical UUIDv4");
  }
  if (
    typeof result.verified_member_id !== "string" ||
    !/^[1-9][0-9]{0,15}$/.test(result.verified_member_id)
  ) {
    throw new Error("invalid verified member ID");
  }
  for (const field of [
    "profile_sha256",
    "device_challenge",
    "binding_nonce",
    "presentation_sha256",
  ]) {
    decodeBase64url(result[field], 32);
  }
  decodeBase64url(result.tlsn_attestation_id, 16);
  decodeBase64url(result.signature, 64);
  for (const field of ["verifier_key_id", "notary_key_id"]) {
    if (
      typeof result[field] !== "string" ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(result[field])
    ) {
      throw new Error(`invalid ${field}`);
    }
  }
  if (
    (result.origin_inventory_sha256 === null) !==
    (result.target_approval_artifact_sha256 === null)
  ) {
    throw new Error("Production digests must be present as a pair");
  }
  for (const field of ["origin_inventory_sha256", "target_approval_artifact_sha256"]) {
    if (result[field] !== null) {
      decodeBase64url(result[field], 32);
    }
  }
  validateServerIdentity(result.server_identity);

  const bindingNonce = decodeBase64url(result.binding_nonce, 32);
  const bindingBytes = Buffer.concat([
    Buffer.from("FUSOU-ATTESTATION-BINDING-V1\0", "ascii"),
    Buffer.from([0, 16]),
    uuidBytes(result.attestation_session_id),
    Buffer.from([0, 32]),
    bindingNonce,
  ]);
  if (decodeBase64url(result.binding_value).compare(bindingBytes) !== 0) {
    throw new Error("binding fields do not match binding value");
  }

  const requestSize = parseCanonicalUint(result.request_transcript_size);
  const responseSize = parseCanonicalUint(result.response_transcript_size);
  validateRanges(result.revealed_request_ranges, result.request_transcript_size);
  validateRanges(result.revealed_response_ranges, result.response_transcript_size);
  if (contract === "complete-result-v2") {
    decodeBase64url(result.request_transcript_sha256, 32);
    decodeBase64url(result.response_transcript_sha256, 32);
    return { result, text, requestSize, responseSize };
  }
  decodeBase64url(result.notary_key_sha256, 32);
  return { result, text, requestSize, responseSize };
}

function resultSigningBytes(result, contract) {
  const output = [];
  const complete = contract === "complete-result-v2";
  output.push(
    Buffer.from(
      complete
        ? "FUSOU-VERIFIER-RESULT-V2\0"
        : "FUSOU-VERIFIER-SPARSE-RESULT-V2\0",
      "ascii",
    ),
  );
  appendU16(output, result.version);
  const values = [
    result.profile_id,
    ...(complete ? [] : [result.disclosure_mode]),
    decodeBase64url(result.profile_sha256),
    result.issuer,
    result.proof_purpose,
    result.canonical_user_id,
    result.device_id,
    decodeBase64url(result.device_challenge),
    result.verified_member_id,
    uuidBytes(result.attestation_session_id),
    decodeBase64url(result.binding_nonce),
    result.binding_value,
    result.verifier_key_id,
    result.notary_key_id,
    ...(complete ? [] : [decodeBase64url(result.notary_key_sha256)]),
    decodeBase64url(result.tlsn_attestation_id),
    decodeBase64url(result.presentation_sha256),
    result.server_identity,
  ];
  for (const value of values) {
    appendLengthPrefixed(output, Buffer.isBuffer(value) ? value : Buffer.from(value, "ascii"));
  }
  for (const field of ["origin_inventory_sha256", "target_approval_artifact_sha256"]) {
    appendLengthPrefixed(
      output,
      result[field] === null ? Buffer.alloc(0) : decodeBase64url(result[field], 32),
    );
  }
  appendU64(output, parseCanonicalUint(result.request_transcript_size));
  if (complete) {
    appendLengthPrefixed(output, decodeBase64url(result.request_transcript_sha256, 32));
  }
  output.push(encodeRanges(result.revealed_request_ranges));
  appendU64(output, parseCanonicalUint(result.response_transcript_size));
  if (complete) {
    appendLengthPrefixed(output, decodeBase64url(result.response_transcript_sha256, 32));
  }
  output.push(encodeRanges(result.revealed_response_ranges));
  return Buffer.concat(output);
}

function verifyCompleteTranscript(vector, result, requestSize, responseSize) {
  for (const [kind, size, ranges] of [
    ["request", requestSize, result.revealed_request_ranges],
    ["response", responseSize, result.revealed_response_ranges],
  ]) {
    const transcript = decodeBase64url(vector.input[`${kind}_transcript_base64url`]);
    if (BigInt(transcript.length) !== size) {
      throw new Error(`${kind} transcript size mismatch`);
    }
    const digest = createHash("sha256").update(transcript).digest("base64url");
    if (digest !== result[`${kind}_transcript_sha256`]) {
      throw new Error(`${kind} transcript digest mismatch`);
    }
    for (const range of ranges) {
      const start = Number(parseCanonicalUint(range.start));
      const length = Number(parseCanonicalUint(range.length));
      if (
        transcript.subarray(start, start + length).compare(decodeBase64url(range.bytes)) !== 0
      ) {
        throw new Error(`${kind} range bytes do not match the transcript`);
      }
    }
  }
}

function signatureKey(spkiHex) {
  return createPublicKey({ key: decodeHex(spkiHex), format: "der", type: "spki" });
}

function verifyResultSignature(result, signingBytes, spkiHex) {
  return verify(
    null,
    signingBytes,
    signatureKey(spkiHex),
    decodeBase64url(result.signature, 64),
  );
}

function receiptSigningBytes(receipt, contract) {
  const output = [
    Buffer.from(RECEIPT_DOMAINS[contract], "ascii"),
    Buffer.from([0, 1]),
  ];
  for (const field of RECEIPT_FIELDS[contract]) {
    const value = receipt[field];
    if (typeof value !== "string") {
      throw new Error(`receipt field ${field} is not a string`);
    }
    appendLengthPrefixed(output, Buffer.from(value, "utf8"));
  }
  return Buffer.concat(output);
}

function canonicalTimestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    throw new Error("invalid fixed UTC timestamp");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error("invalid fixed UTC timestamp");
  }
  return parsed.valueOf();
}

function verifyReceiptVector(vector, overrides = {}) {
  const receipt = overrides.receipt ?? JSON.parse(vector.input.receipt_json_utf8);
  const session = overrides.session ?? JSON.parse(vector.input.session_json_utf8);
  const registry = overrides.registry ?? JSON.parse(vector.signer.registry_json_utf8);
  const contract = vector.contract;
  const sessionReceipt = contract === "session-receipt-v1";
  const expectedType = sessionReceipt
    ? "attestation-session-issued"
    : "attestation-binding-consumed";
  const expectedScope = sessionReceipt
    ? "tlsn-session-authority-key-registry"
    : "tlsn-binding-authority-key-registry";
  if (
    receipt.schema_version !== 1 ||
    receipt.type !== expectedType ||
    receipt.signature_algorithm !== "Ed25519" ||
    registry.schema_version !== 1 ||
    registry.scope !== expectedScope ||
    !Array.isArray(registry.keys)
  ) {
    throw new Error("receipt or authority registry schema mismatch");
  }
  const key = registry.keys.find((entry) => entry.key_id === receipt.signer_key_id);
  if (
    key === undefined ||
    key.key_id !== vector.signer.key_id ||
    key.public_key_spki !== Buffer.from(vector.signer.public_key_spki_hex, "hex").toString("base64url") ||
    key.status === "REVOKED"
  ) {
    throw new Error("receipt authority key does not match the test-only pin");
  }

  const keyTime = canonicalTimestamp(sessionReceipt ? receipt.created_at : receipt.used_at);
  const notBefore = canonicalTimestamp(key.not_before);
  const notAfter = key.not_after === null ? null : canonicalTimestamp(key.not_after);
  if (keyTime < notBefore || (notAfter !== null && keyTime > notAfter)) {
    throw new Error("receipt authority key is outside its validity window");
  }
  const expectedBindings = sessionReceipt
    ? [
        ["session_id", "session_id"],
        ["device_id", "device_id"],
        ["nonce", "challenge"],
        ["device_challenge", "device_challenge"],
        ["binding_value", "binding"],
        ["expires_at", "expires_at"],
      ]
    : [
        ["session_id", "session_id"],
        ["device_id", "device_id"],
        ["nonce", "challenge"],
        ["binding_value", "binding"],
      ];
  for (const [receiptField, sessionField] of expectedBindings) {
    if (receipt[receiptField] !== session[sessionField]) {
      throw new Error(`receipt binding mismatch: ${receiptField}`);
    }
  }
  if (receipt.canonical_user_id !== vector.input.canonical_user_id) {
    throw new Error("receipt user ID mismatch");
  }
  if (
    sessionReceipt &&
    receipt.device_auth_nonce !== vector.input.device_auth_nonce
  ) {
    throw new Error("receipt device authentication nonce mismatch");
  }
  if (!sessionReceipt) {
    const presentationDigest = createHash("sha256")
      .update(decodeHex(vector.input.presentation_raw_hex))
      .digest("base64url");
    if (receipt.presentation_id !== presentationDigest) {
      throw new Error("consume receipt Presentation digest mismatch");
    }
  }

  const signingBytes = receiptSigningBytes(receipt, contract);
  if (
    !verify(
      null,
      signingBytes,
      signatureKey(vector.signer.public_key_spki_hex),
      decodeBase64url(receipt.signature, 64),
    )
  ) {
    throw new Error("receipt signature verification failed");
  }
  return signingBytes;
}

test("RFC 8032 Ed25519 primitive reference is independently verified", () => {
  const reference = corpus.primitive_reference;
  assert.equal(reference.id, "rfc8032-ed25519-test-vector-1");
  assert.equal(
    verify(
      null,
      decodeHex(reference.message_hex),
      signatureKey(`302a300506032b6570032100${reference.public_key_raw_hex}`),
      decodeHex(reference.signature_hex),
    ),
    true,
  );
});

test("Complete v2 and Sparse v3 match the shared signing-byte and signature vectors", () => {
  assert.equal(corpus.vectors_count, corpus.vectors.length);
  for (const vector of corpus.vectors.filter((entry) => entry.contract.endsWith("-v2") || entry.contract.endsWith("-v3"))) {
    const raw = Buffer.from(vector.input.result_json_utf8, "utf8");
    const { result, text, requestSize, responseSize } = validateResult(raw, vector.contract);
    const signingBytes = resultSigningBytes(result, vector.contract);
    assert.equal(text, vector.expected.canonical_json_utf8);
    assert.equal(
      createHash("sha256").update(raw).digest("hex"),
      vector.expected.canonical_json_sha256_hex,
    );
    assert.equal(signingBytes.toString("hex"), vector.expected.signing_bytes_hex);
    assert.equal(
      createHash("sha256").update(signingBytes).digest("hex"),
      vector.expected.signing_bytes_sha256_hex,
    );
    assert.equal(
      decodeBase64url(result.signature, 64).toString("hex"),
      vector.expected.signature_hex,
    );
    assert.equal(verifyResultSignature(result, signingBytes, corpus.result_signer.public_key_spki_hex), true);
    assert.equal(
      encodeRanges(result.revealed_request_ranges).toString("hex"),
      vector.expected.request_ranges_wire_hex,
    );
    assert.equal(
      encodeRanges(result.revealed_response_ranges).toString("hex"),
      vector.expected.response_ranges_wire_hex,
    );
    if (vector.contract === "complete-result-v2") {
      verifyCompleteTranscript(vector, result, requestSize, responseSize);
    }
  }
});

test("Result signer registry bytes and identity are test-only and separately pinned", () => {
  const signer = corpus.result_signer;
  const raw = Buffer.from(signer.registry_json_utf8, "utf8");
  const registry = JSON.parse(signer.registry_json_utf8);
  assert.equal(createHash("sha256").update(raw).digest("hex"), signer.registry_sha256_hex);
  assert.equal(
    createHash("sha256").update(raw).digest("base64url"),
    signer.registry_sha256_base64url,
  );
  assert.equal(registry.scope, "tlsn-result-signing-key-registry");
  assert.equal(registry.keys.length, 1);
  assert.equal(registry.keys[0].key_id, signer.key_id);
  assert.equal(registry.keys[0].public_key_spki, Buffer.from(signer.public_key_spki_hex, "hex").toString("base64url"));
  assert.match(signer.registry_root, /^not included;/);
});

test("signed Result payload and signature mutations fail cryptographic verification", () => {
  const vector = corpus.vectors.find((entry) => entry.contract === "complete-result-v2");
  const result = JSON.parse(vector.input.result_json_utf8);
  const originalBytes = resultSigningBytes(result, vector.contract);
  const key = signatureKey(corpus.result_signer.public_key_spki_hex);

  const changedPayload = structuredClone(result);
  changedPayload.server_identity = "other.example.test";
  assert.equal(verify(null, resultSigningBytes(changedPayload, vector.contract), key, decodeBase64url(result.signature)), false);

  const changedKeyId = structuredClone(result);
  changedKeyId.verifier_key_id = "p010-result-other-test-v1";
  assert.equal(verify(null, resultSigningBytes(changedKeyId, vector.contract), key, decodeBase64url(result.signature)), false);

  const changedSignature = Buffer.from(decodeBase64url(result.signature));
  changedSignature[0] ^= 1;
  assert.equal(verify(null, originalBytes, key, changedSignature), false);

  const otherAuthority = corpus.vectors.find((entry) => entry.contract === "session-receipt-v1");
  assert.equal(
    verify(
      null,
      originalBytes,
      signatureKey(otherAuthority.signer.public_key_spki_hex),
      decodeBase64url(result.signature),
    ),
    false,
  );
});

test("all shared malformed Result JSON and range cases are rejected", () => {
  assert.equal(corpus.result_rejection_vectors_count, corpus.result_rejection_vectors.length);
  for (const vector of corpus.result_rejection_vectors) {
    assert.throws(
      () => validateResult(decodeHex(vector.raw_json_hex), vector.contract),
      undefined,
      vector.case_id,
    );
  }
});

test("Session and consume receipts match shared bytes and signatures", () => {
  const vectors = corpus.vectors.filter((entry) => entry.contract.includes("receipt-v1"));
  for (const vector of vectors) {
    const receiptRaw = Buffer.from(vector.input.receipt_json_utf8, "utf8");
    const sessionRaw = Buffer.from(vector.input.session_json_utf8, "utf8");
    const registryRaw = Buffer.from(vector.signer.registry_json_utf8, "utf8");
    const receipt = JSON.parse(vector.input.receipt_json_utf8);
    const signingBytes = verifyReceiptVector(vector);
    assert.equal(
      createHash("sha256").update(receiptRaw).digest("hex"),
      vector.expected.receipt_json_sha256_hex,
    );
    assert.equal(
      createHash("sha256").update(sessionRaw).digest("hex"),
      vector.expected.session_json_sha256_hex,
    );
    assert.equal(
      createHash("sha256").update(registryRaw).digest("hex"),
      vector.signer.registry_sha256_hex,
    );
    assert.equal(signingBytes.toString("hex"), vector.expected.signing_bytes_hex);
    assert.equal(
      createHash("sha256").update(signingBytes).digest("hex"),
      vector.expected.signing_bytes_sha256_hex,
    );
    assert.equal(
      decodeBase64url(receipt.signature, 64).toString("hex"),
      vector.expected.signature_hex,
    );
    assert.deepEqual(
      RECEIPT_FIELDS[vector.contract],
      vector.expected.signing_field_order,
    );
  }
});

test("Result, Session, and consume vectors retain shared identity and Presentation bindings", () => {
  const complete = corpus.vectors.find((entry) => entry.contract === "complete-result-v2");
  const sparse = corpus.vectors.find((entry) => entry.contract === "sparse-result-v3");
  const session = JSON.parse(
    corpus.vectors.find((entry) => entry.contract === "session-receipt-v1")
      .input.receipt_json_utf8,
  );
  const consume = JSON.parse(
    corpus.vectors.find((entry) => entry.contract === "consume-receipt-v1")
      .input.receipt_json_utf8,
  );
  for (const vector of [complete, sparse]) {
    const result = JSON.parse(vector.input.result_json_utf8);
    assert.equal(result.attestation_session_id, session.session_id);
    assert.equal(result.canonical_user_id, session.canonical_user_id);
    assert.equal(result.device_id, session.device_id);
    assert.equal(result.binding_nonce, session.nonce);
    assert.equal(result.device_challenge, session.device_challenge);
    assert.equal(result.binding_value, session.binding_value);
    assert.equal(result.presentation_sha256, consume.presentation_id);
  }
});

test("receipt identity, timestamp, key, and signing-field mutations are rejected", () => {
  const vectors = new Map(corpus.vectors.map((vector) => [vector.vector_id, vector]));
  for (const mutation of corpus.receipt_rejection_cases) {
    const vector = vectors.get(mutation.vector_id);
    assert.ok(vector, mutation.case_id);
    const receipt = JSON.parse(vector.input.receipt_json_utf8);
    const session = JSON.parse(vector.input.session_json_utf8);
    const target = mutation.target === "receipt" ? receipt : session;
    target[mutation.field] = mutation.replacement;
    assert.throws(
      () => verifyReceiptVector(vector, { receipt, session }),
      undefined,
      mutation.case_id,
    );
  }
  const receiptVector = vectors.get("session-receipt-v1-001");
  const wrongRegistryId = JSON.parse(receiptVector.signer.registry_json_utf8);
  wrongRegistryId.keys[0].key_id = "p010-wrong-authority-test-v1";
  assert.throws(() => verifyReceiptVector(receiptVector, { registry: wrongRegistryId }));
  const wrongRegistryKey = JSON.parse(receiptVector.signer.registry_json_utf8);
  wrongRegistryKey.keys[0].public_key_spki = JSON.parse(
    corpus.result_signer.registry_json_utf8,
  ).keys[0].public_key_spki;
  assert.throws(() => verifyReceiptVector(receiptVector, { registry: wrongRegistryKey }));
});
