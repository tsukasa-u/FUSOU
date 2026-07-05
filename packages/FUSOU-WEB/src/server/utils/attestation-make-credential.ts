/**
 * TPM 2.0 MakeCredential implementation for Cloudflare Workers.
 *
 * Spec: TCG TPM 2.0 Part 1, Section 24 (Credential Protection)
 *
 * MakeCredential creates a credentialBlob that can ONLY be decrypted by the
 * TPM holding BOTH the EK private key AND the AK with the specified name.
 * This is the cryptographic proof that AK and EK reside in the same TPM.
 */

const HASH_SIZE_SHA256 = 32;
const AES_KEY_BITS = 128;
const AES_KEY_BYTES = AES_KEY_BITS / 8;

// ── Utilities ─────────────────────────────────────────────────────────────────

function concatBuffers(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function uint16BE(n: number): Uint8Array {
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff]);
}

function uint32BE(n: number): Uint8Array {
  return new Uint8Array([(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
}

function encodeTpm2B(data: Uint8Array): Uint8Array {
  return concatBuffers(uint16BE(data.length), data);
}

// ── KDFa (TCG TPM 2.0 Part 1, Annex B.10.3) ───────────────────────────────────

/**
 * HMAC-based key derivation function.
 * kdfA(SHA-256, key, label, contextU, contextV, bits) → Uint8Array of bits/8 bytes
 */
export async function kdfA(
  key: Uint8Array,
  label: string,
  contextU: Uint8Array,
  contextV: Uint8Array,
  bits: number,
): Promise<Uint8Array> {
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    toBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const labelBytes = new TextEncoder().encode(label);
  const outputBytes = Math.ceil(bits / 8);
  const result: Uint8Array[] = [];
  let counter = 1;

  while (result.reduce((s, a) => s + a.length, 0) < outputBytes) {
    // data = counter(4 BE) || label || 0x00 || contextU || contextV || bits(4 BE)
    const data = concatBuffers(
      uint32BE(counter),
      labelBytes,
      new Uint8Array([0x00]),
      contextU,
      contextV,
      uint32BE(bits),
    );
    const digest = await crypto.subtle.sign("HMAC", hmacKey, toBuffer(data));
    result.push(new Uint8Array(digest));
    counter++;
  }

  return concatBuffers(...result).slice(0, outputBytes);
}

// ── AES-CFB using AES-CBC trick ────────────────────────────────────────────────
//
// Web Crypto doesn't expose AES-CFB, but AES-CBC with zero IV on a single block
// gives the same result as AES-ECB for that block.  We use this to build CFB:
//   ciphertext[i] = AES-ECB(feedback[i]) XOR plaintext[i]
//   feedback[0]   = IV (zero)
//   feedback[i+1] = ciphertext[i]

async function aesCfb128Encrypt(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const aesKey = await crypto.subtle.importKey(
    "raw",
    toBuffer(key),
    { name: "AES-CBC" },
    false,
    ["encrypt"],
  );

  const result = new Uint8Array(plaintext.length);
  let feedback = new Uint8Array(iv); // 16-byte IV

  for (let offset = 0; offset < plaintext.length; offset += 16) {
    // Encrypt the 16-byte feedback register with AES-CBC(zero IV) = AES-ECB
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-CBC", iv: new Uint8Array(16) as unknown as BufferSource }, // zero IV
      aesKey,
      toBuffer(feedback),
    );
    const keyStream = new Uint8Array(encrypted).slice(0, 16);

    const blockEnd = Math.min(offset + 16, plaintext.length);
    for (let i = offset; i < blockEnd; i++) {
      result[i] = plaintext[i] ^ keyStream[i - offset];
    }

    // Next feedback = this ciphertext block (padded to 16 if partial)
    const cipherBlock = result.slice(offset, blockEnd);
    if (cipherBlock.length < 16) {
      const padded = new Uint8Array(16);
      padded.set(cipherBlock);
      feedback = padded;
    } else {
      feedback = cipherBlock;
    }
  }

  return result;
}

// ── MakeCredential ─────────────────────────────────────────────────────────────

export interface MakeCredentialOutput {
  credentialBlob: Uint8Array;  // TPM2B_ID_OBJECT
  encryptedSeed: Uint8Array;   // TPM2B_ENCRYPTED_SECRET
}

/**
 * TPM2_MakeCredential (software implementation).
 *
 * @param ekPublicKey  EK public key (RSA-2048 CryptoKey, "RSASSA-PKCS1-v1_5" or "RSA-OAEP")
 * @param ekPubDer     EK public key SPKI DER bytes (used for OAEP import)
 * @param credential   32-byte random challenge value to protect
 * @param objectName   AK name = 0x000B (SHA-256 alg ID) || SHA256(TPMT_PUBLIC of AK)
 *
 * @returns credentialBlob and encryptedSeed to send to the client's TPM
 */
export async function makeCredential(
  ekPubDer: Uint8Array,
  credential: Uint8Array,
  objectName: Uint8Array,
): Promise<MakeCredentialOutput> {
  if (credential.length !== HASH_SIZE_SHA256) {
    throw new Error(`credential must be ${HASH_SIZE_SHA256} bytes`);
  }

  // 1. Import EK public key for RSA-OAEP encryption
  const ekKey = await crypto.subtle.importKey(
    "spki",
    toBuffer(ekPubDer),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );

  // 2. Generate random seed (32 bytes = SHA-256 output size)
  const seed = crypto.getRandomValues(new Uint8Array(HASH_SIZE_SHA256));

  // 3. Encrypt seed with EK using RSA-OAEP with label "IDENTITY\x00"
  const label = new TextEncoder().encode("IDENTITY\x00");
  const encryptedSeedBytes = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "RSA-OAEP",
        label: toBuffer(label) as unknown as BufferSource,
      },
      ekKey,
      toBuffer(seed),
    ),
  );

  // 4. Derive symmetric key: KDFa(SHA-256, seed, "STORAGE", objectName, "", 128)
  const symKeyBytes = await kdfA(seed, "STORAGE", objectName, new Uint8Array(0), AES_KEY_BITS);

  // 5. Derive HMAC key: KDFa(SHA-256, seed, "INTEGRITY", "", "", 256)
  const hmacKeyBytes = await kdfA(
    seed,
    "INTEGRITY",
    new Uint8Array(0),
    new Uint8Array(0),
    256,
  );

  // 6. Encode credential as TPM2B (2-byte size prefix)
  const identityBuffer = encodeTpm2B(credential);

  // 7. Encrypt identityBuffer with AES-128-CFB (IV = 16 zero bytes)
  const encIdentity = await aesCfb128Encrypt(
    symKeyBytes,
    new Uint8Array(16), // zero IV
    identityBuffer,
  );

  // 8. Compute outer HMAC over encIdentity || objectName
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    toBuffer(hmacKeyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const outerHMACBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", hmacKey, toBuffer(concatBuffers(encIdentity, objectName))),
  );

  // 9. Build credentialBlob = TPM2B_ID_OBJECT
  //    Structure: size(2) || TPM2B(integrity=outerHMAC)(2+32) || encIdentity
  const credentialBlobInner = concatBuffers(encodeTpm2B(outerHMACBytes), encIdentity);
  const credentialBlob = encodeTpm2B(credentialBlobInner);

  // 10. Build encryptedSeed = TPM2B_ENCRYPTED_SECRET
  const encryptedSeed = encodeTpm2B(encryptedSeedBytes);

  return { credentialBlob, encryptedSeed };
}

/**
 * Parses TPM2B_NAME bytes and validates format (hashAlg || hash).
 * For SHA-256: first 2 bytes = 0x000B, followed by 32-byte hash.
 */
export function validateAkName(nameBytes: Uint8Array): boolean {
  if (nameBytes.length !== 2 + HASH_SIZE_SHA256) return false;
  const algId = (nameBytes[0] << 8) | nameBytes[1];
  return algId === 0x000b; // TPM_ALG_SHA256
}
