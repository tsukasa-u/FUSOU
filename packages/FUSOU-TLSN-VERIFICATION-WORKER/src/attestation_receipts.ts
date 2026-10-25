const SESSION_RECEIPT_PREFIX = new TextEncoder().encode("FUSOU-ATTESTATION-SESSION-V1\0");
const CONSUME_RECEIPT_PREFIX = new TextEncoder().encode("FUSOU-ATTESTATION-CONSUME-V1\0");

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
