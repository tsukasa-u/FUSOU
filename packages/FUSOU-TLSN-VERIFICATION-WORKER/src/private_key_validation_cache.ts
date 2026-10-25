export type PrivateKeyPairValidator = (
  privateKeyBytes: Uint8Array,
  publicKeySpki: string,
) => Promise<boolean>;

export type PrivateKeyValidationObservation = {
  valid: boolean;
  elapsedMilliseconds: number;
  fingerprintElapsedMilliseconds: number;
  cryptoElapsedMilliseconds: number;
  cacheHit: boolean;
  concurrentDeduplication: boolean;
};

export async function privateKeyMatchesPublicKey(
  privateKeyBytes: Uint8Array,
  publicKeySpki: string,
): Promise<boolean> {
  try {
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      privateKeyBytes,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const publicKey = await crypto.subtle.importKey(
      "spki",
      decodeBase64Url(publicKeySpki),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const probe = new TextEncoder().encode("FUSOU-TLSN-AUTHORITY-KEY-CHECK-V1");
    const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, probe);
    return await crypto.subtle.verify({ name: "Ed25519" }, publicKey, signature, probe);
  } catch {
    return false;
  }
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function sha256Hex(bytes: Uint8Array): Promise<string> {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) => {
    const digestBytes = new Uint8Array(digest);
    let hexadecimal = "";
    for (const byte of digestBytes) hexadecimal += byte.toString(16).padStart(2, "0");
    return hexadecimal;
  });
}

export class PrivateKeyValidationCache {
  private readonly successfulEntries = new Map<string, true>();
  private readonly inFlightEntries = new Map<string, Promise<boolean>>();

  public constructor(
    private readonly maxEntries = 16,
    private readonly validator: PrivateKeyPairValidator = privateKeyMatchesPublicKey,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error("maxEntries must be a positive safe integer");
    }
  }

  public get size(): number {
    return this.successfulEntries.size;
  }

  public async validate(
    privateKeyBytes: Uint8Array,
    publicKeySpki: string,
    scope = "default",
  ): Promise<PrivateKeyValidationObservation> {
    const startedAt = performance.now();
    const fingerprintStartedAt = performance.now();
    const [privateKeyFingerprint, publicKeyFingerprint] = await Promise.all([
      sha256Hex(privateKeyBytes),
      sha256Hex(new TextEncoder().encode(publicKeySpki)),
    ]);
    const fingerprintElapsedMilliseconds = performance.now() - fingerprintStartedAt;
    const identity = `${scope}:${privateKeyFingerprint}:${publicKeyFingerprint}`;
    if (this.successfulEntries.has(identity)) {
      this.touch(identity);
      return {
        valid: true,
        elapsedMilliseconds: performance.now() - startedAt,
        fingerprintElapsedMilliseconds,
        cryptoElapsedMilliseconds: 0,
        cacheHit: true,
        concurrentDeduplication: false,
      };
    }
    const inFlight = this.inFlightEntries.get(identity);
    if (inFlight) {
      const valid = await inFlight;
      return {
        valid,
        elapsedMilliseconds: performance.now() - startedAt,
        fingerprintElapsedMilliseconds,
        cryptoElapsedMilliseconds: 0,
        cacheHit: false,
        concurrentDeduplication: true,
      };
    }

    const cryptoStartedAt = performance.now();
    const validation = Promise.resolve().then(() => this.validator(privateKeyBytes, publicKeySpki));
    this.inFlightEntries.set(identity, validation);
    try {
      const valid = await validation;
      if (valid) {
        this.successfulEntries.set(identity, true);
        this.touch(identity);
        this.evictOldest();
      }
      return {
        valid,
        elapsedMilliseconds: performance.now() - startedAt,
        fingerprintElapsedMilliseconds,
        cryptoElapsedMilliseconds: performance.now() - cryptoStartedAt,
        cacheHit: false,
        concurrentDeduplication: false,
      };
    } finally {
      if (this.inFlightEntries.get(identity) === validation) this.inFlightEntries.delete(identity);
    }
  }

  private touch(identity: string): void {
    if (!this.successfulEntries.has(identity)) return;
    this.successfulEntries.delete(identity);
    this.successfulEntries.set(identity, true);
  }

  private evictOldest(): void {
    while (this.successfulEntries.size > this.maxEntries) {
      const oldestIdentity = this.successfulEntries.keys().next().value;
      if (oldestIdentity === undefined) return;
      this.successfulEntries.delete(oldestIdentity);
    }
  }
}