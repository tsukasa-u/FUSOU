const SESSION_RECEIPT_PREFIX = new TextEncoder().encode("FUSOU-ATTESTATION-SESSION-V1\0");
const CONSUME_RECEIPT_PREFIX = new TextEncoder().encode("FUSOU-ATTESTATION-CONSUME-V1\0");
const SESSION_CONTEXT_GRANT_PREFIX = new TextEncoder().encode("FUSOU-TLSN-SESSION-CONTEXT-GRANT-V1\0");
const SESSION_CONTEXT_PURPOSE = "fusou-require-info-v3-session-binding";

function appendLengthPrefixed(chunks: Uint8Array[], value: string): void {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 0xffff) throw new Error("attestation receipt field is too large");
  chunks.push(new Uint8Array([bytes.length >> 8, bytes.length & 0xff]), bytes);
}

function appendReceiptFields(prefix: Uint8Array, fields: string[]): Uint8Array {
  const chunks: Uint8Array[] = [prefix, new Uint8Array([0, 1])];
  for (const field of fields) appendLengthPrefixed(chunks, field);
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function attestationSessionReceiptSigningBytes(input: {
  signerKeyId: string;
  sessionId: string;
  canonicalUserId: string;
  deviceId: string;
  deviceAuthNonce: string;
  nonce: string;
  deviceChallenge: string;
  bindingValue: string;
  createdAt: string;
  expiresAt: string;
}): Uint8Array {
  return appendReceiptFields(SESSION_RECEIPT_PREFIX, [
    input.signerKeyId,
    input.sessionId,
    input.canonicalUserId,
    input.deviceId,
    input.deviceAuthNonce,
    input.nonce,
    input.deviceChallenge,
    input.bindingValue,
    input.createdAt,
    input.expiresAt,
  ]);
}

export function attestationSessionContextGrantSigningBytes(input: {
  signerKeyId: string;
  sessionId: string;
  bindingValue: string;
  deviceIdSha256: Uint8Array;
  deviceChallenge: Uint8Array;
  issuedAtMs: number;
  expiresAtMs: number;
}): Uint8Array {
  if (
    input.deviceIdSha256.length !== 32 ||
    input.deviceChallenge.length !== 32 ||
    !Number.isSafeInteger(input.issuedAtMs) ||
    !Number.isSafeInteger(input.expiresAtMs) ||
    input.issuedAtMs < 0 ||
    input.expiresAtMs <= input.issuedAtMs
  ) {
    throw new Error("Session context grant fields are invalid");
  }
  const chunks: Uint8Array[] = [
    SESSION_CONTEXT_GRANT_PREFIX,
    new Uint8Array([0, 1]),
  ];
  for (const field of [
    input.signerKeyId,
    SESSION_CONTEXT_PURPOSE,
    input.sessionId,
    input.bindingValue,
  ]) {
    appendLengthPrefixed(chunks, field);
  }
  chunks.push(
    input.deviceIdSha256,
    input.deviceChallenge,
    encodeU64(input.issuedAtMs),
    encodeU64(input.expiresAtMs),
  );
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function attestationConsumeReceiptSigningBytes(input: {
  signerKeyId: string;
  sessionId: string;
  canonicalUserId: string;
  deviceId: string;
  nonce: string;
  bindingValue: string;
  presentationId: string;
  usedAt: string;
}): Uint8Array {
  return appendReceiptFields(CONSUME_RECEIPT_PREFIX, [
    input.signerKeyId,
    input.sessionId,
    input.canonicalUserId,
    input.deviceId,
    input.nonce,
    input.bindingValue,
    input.presentationId,
    input.usedAt,
  ]);
}

function encodeU64(value: number): Uint8Array {
  let remaining = BigInt(value);
  const output = new Uint8Array(8);
  for (let index = output.length - 1; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) throw new Error("Session context grant time exceeds UInt64");
  return output;
}
