const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  if (!keyCache.has(secret)) {
    keyCache.set(
      secret,
      crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
    );
  }
  return keyCache.get(secret)!;
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return base64UrlEncode(new Uint8Array(signature));
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let diff = aBytes.length ^ bBytes.length;
  const maxLen = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < maxLen; i += 1) {
    const aByte = aBytes[i] ?? 0;
    const bByte = bBytes[i] ?? 0;
    diff |= aByte ^ bByte;
  }
  return diff === 0;
}

export type SignedToken = {
  token: string;
  expires: number;
  signature: string;
};

export async function createSignedToken(
  payload: unknown,
  secret: string,
  ttlSeconds: number,
): Promise<SignedToken> {
  const serialized = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const data = `${serialized}.${expires}`;
  const signature = await hmac(secret, data);
  return { token: serialized, expires, signature };
}

export async function verifySignedToken<T = unknown>(
  token: string | null,
  expires: string | null,
  signature: string | null,
  secret: string,
): Promise<T | null> {
  if (!token || !expires || !signature) {
    return null;
  }
  const exp = Number(expires);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  const data = `${token}.${exp}`;
  const expected = await hmac(secret, data);
  if (!timingSafeEqual(expected, signature)) {
    return null;
  }
  try {
    const decoded = decoder.decode(base64UrlDecode(token));
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}
