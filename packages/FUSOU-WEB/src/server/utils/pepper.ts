/**
 * Device authentication helpers.
 *
 * This module intentionally contains no member identity derivation. The only
 * HMAC use here is the stateless challenge nonce used for device operations.
 */

/** Challenge nonce bucket size in seconds. */
export const CHALLENGE_BUCKET_SECONDS = 300;

const ED25519_PUBKEY_BYTES = 32;
const ED25519_SIG_BYTES = 64;

function bytesToHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

function utf8(value: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(value);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/** Decode standard or URL-safe base64 into bytes. */
export function decodeBase64ToBytes(value: string): Uint8Array | null {
  if (typeof value !== "string") return null;
  let normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (normalized.length === 0) return null;
  const padding = normalized.length % 4;
  if (padding === 1) return null;
  if (padding > 0) normalized += "=".repeat(4 - padding);

  try {
    const binary = atob(normalized);
    const output = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      output[i] = binary.charCodeAt(i);
    }
    return output;
  } catch {
    return null;
  }
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Verify a domain-separated Ed25519 device signature. */
export async function verifyDeviceSig(options: {
  publicKeyB64: string;
  message: string;
  signatureB64: string;
}): Promise<boolean> {
  const publicKey = decodeBase64ToBytes(options.publicKeyB64);
  if (!publicKey || publicKey.length !== ED25519_PUBKEY_BYTES) return false;

  const signature = decodeBase64ToBytes(options.signatureB64);
  if (!signature || signature.length !== ED25519_SIG_BYTES) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      toArrayBuffer(signature),
      utf8(options.message),
    );
  } catch (error) {
    console.warn("[device-auth] Ed25519 verification failed", error);
    return false;
  }
}

function currentBucket(nowSeconds: number): number {
  return Math.floor(nowSeconds / CHALLENGE_BUCKET_SECONDS);
}

async function nonceForBucket(
  secret: string,
  deviceId: string,
  bucket: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    utf8(`${deviceId}|${bucket}`),
  );
  return bytesToHex(signature);
}

/** Issue an idempotent nonce for the current challenge bucket. */
export async function issueChallengeNonce(
  secret: string,
  deviceId: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<{ nonce: string; bucket: number; expiresAt: number }> {
  const bucket = currentBucket(nowSeconds);
  const nonce = await nonceForBucket(secret, deviceId, bucket);
  const expiresAt = (bucket + 1) * CHALLENGE_BUCKET_SECONDS;
  return { nonce, bucket, expiresAt };
}

/** Accept the current or immediately previous challenge bucket. */
export async function verifyChallengeNonce(
  secret: string,
  deviceId: string,
  nonce: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (typeof nonce !== "string" || !/^[a-f0-9]{64}$/.test(nonce)) return false;

  const bucket = currentBucket(nowSeconds);
  for (const candidateBucket of [bucket, bucket - 1]) {
    const expected = await nonceForBucket(secret, deviceId, candidateBucket);
    if (expected === nonce) return true;
  }
  return false;
}
