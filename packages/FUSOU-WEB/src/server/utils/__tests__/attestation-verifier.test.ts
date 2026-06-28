import "reflect-metadata";
import * as x509 from "@peculiar/x509";
import { describe, expect, it } from "vitest";
import {
  verifyAttestation,
  type AttestationReport,
} from "../attestation-verifier";
import { determineTrustTag } from "../trust-tag";

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Buffer.from(arr).toString("base64");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

const validFingerprint = {
  cpu_brand: "Apple M2",
  cpu_cores: 8,
  total_memory_mb: 16384,
  os_name: "macOS",
  os_version: "14.0",
  hostname_hash: "host-hash",
  machine_id_hash: "machine-id-hash",
};

const tpmMagic = 0xff54_4347;
const tpmQuoteType = 0x8018;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return Buffer.from(new Uint8Array(digest)).toString("hex");
}

function writeU16(buffer: Uint8Array, offset: number, value: number): number {
  buffer[offset] = (value >>> 8) & 0xff;
  buffer[offset + 1] = value & 0xff;
  return offset + 2;
}

function writeU32(buffer: Uint8Array, offset: number, value: number): number {
  buffer[offset] = (value >>> 24) & 0xff;
  buffer[offset + 1] = (value >>> 16) & 0xff;
  buffer[offset + 2] = (value >>> 8) & 0xff;
  buffer[offset + 3] = value & 0xff;
  return offset + 4;
}

function buildTpmsQuote(extraData: Uint8Array): Uint8Array {
  const totalLength = 4 + 2 + 2 + 2 + extraData.byteLength + 17 + 8;
  const out = new Uint8Array(totalLength);
  let offset = 0;
  offset = writeU32(out, offset, tpmMagic);
  offset = writeU16(out, offset, tpmQuoteType);
  offset = writeU16(out, offset, 0); // qualifiedSigner length
  offset = writeU16(out, offset, extraData.byteLength);
  out.set(extraData, offset);
  offset += extraData.byteLength;
  // 17 bytes TPMS_CLOCK_INFO + 8 bytes firmware version.
  offset += 25;
  expect(offset).toBe(totalLength);
  return out;
}

async function createSecureEnclaveFixture(nonce: string): Promise<{
  report: AttestationReport;
  trustedRootHash: string;
}> {
  const keyGen = { name: "ECDSA", namedCurve: "P-256" } as const;
  const signAlg = { name: "ECDSA", hash: "SHA-256" } as const;
  const rootKeys = await crypto.subtle.generateKey(keyGen, true, ["sign", "verify"]);
  const intermediateKeys = await crypto.subtle.generateKey(keyGen, true, ["sign", "verify"]);
  const leafKeys = await crypto.subtle.generateKey(keyGen, true, ["sign", "verify"]);

  const now = Date.now();
  const notBefore = new Date(now - 60_000);
  const notAfter = new Date(now + 60_000);

  const root = await x509.X509CertificateGenerator.createSelfSigned({
    name: "CN=FUSOU Test Root",
    keys: rootKeys,
    notBefore,
    notAfter,
    signingAlgorithm: signAlg,
  });
  const intermediate = await x509.X509CertificateGenerator.create({
    subject: "CN=FUSOU Test Intermediate",
    issuer: root.subject,
    publicKey: intermediateKeys.publicKey,
    signingKey: rootKeys.privateKey,
    notBefore,
    notAfter,
    signingAlgorithm: signAlg,
  });
  const leaf = await x509.X509CertificateGenerator.create({
    subject: "CN=FUSOU Test Leaf",
    issuer: intermediate.subject,
    publicKey: leafKeys.publicKey,
    signingKey: intermediateKeys.privateKey,
    notBefore,
    notAfter,
    signingAlgorithm: signAlg,
  });

  const signature = await crypto.subtle.sign(
    signAlg,
    leafKeys.privateKey,
    toArrayBuffer(new TextEncoder().encode(nonce)),
  );
  const leafPublicSpki = await crypto.subtle.exportKey("spki", leafKeys.publicKey);
  const trustedRootHash = await sha256Hex(new Uint8Array(root.rawData));

  return {
    report: {
      attestation_level: "secure_enclave",
      attestation_signature: toBase64(signature),
      public_key: toBase64(leafPublicSpki),
      certificate_chain: [
        toBase64(leaf.rawData),
        toBase64(intermediate.rawData),
        toBase64(root.rawData),
      ],
      fingerprint: validFingerprint,
      environment: {
        environment_type: "Native",
        debugger_attached: false,
        hooks_detected: [],
      },
    },
    trustedRootHash,
  };
}

describe("verifyAttestation", () => {
  it("returns unverified baseline for null report", async () => {
    const verified = await verifyAttestation(null, "nonce-1");

    expect(verified.attestation_level).toBe("none");
    expect(verified.attestation_valid).toBe(false);
    expect(verified.schema_fingerprint_valid).toBe(true);
    expect(verified.environment_flags).toEqual({
      emulator_detected: false,
      debugger_detected: false,
      hook_detected: false,
    });
    expect(determineTrustTag(verified)).toBe("unverified");
  });

  it("keeps secure_enclave fail-closed when trusted roots are not configured", async () => {
    const nonce = "nonce-secure-enclave-no-trust-root";
    const { report } = await createSecureEnclaveFixture(nonce);

    const verified = await verifyAttestation(report, nonce);

    expect(verified.attestation_level).toBe("secure_enclave");
    expect(verified.attestation_valid).toBe(false);
    expect(verified.schema_fingerprint_valid).toBe(true);
    expect(determineTrustTag(verified)).toBe("suspicious");
  });

  it("verifies secure_enclave attestation when cert chain and trusted root match", async () => {
    const nonce = "nonce-secure-enclave-valid";
    const { report, trustedRootHash } = await createSecureEnclaveFixture(nonce);

    const verified = await verifyAttestation(report, nonce, {
      secureEnclaveTrustedRootSha256: [trustedRootHash],
      now: new Date(),
    });

    expect(verified.attestation_level).toBe("secure_enclave");
    expect(verified.attestation_valid).toBe(true);
    expect(verified.schema_fingerprint_valid).toBe(true);
    expect(determineTrustTag(verified)).toBe("hw_verified");
  });

  it("marks malformed hardware envelope as schema-invalid", async () => {
    const malformed: AttestationReport = {
      attestation_level: "secure_enclave",
      attestation_data: "Zm9v", // "foo"
      public_key: "YmFy", // "bar"
    };

    const verified = await verifyAttestation(malformed, "nonce-malformed");

    expect(verified.attestation_valid).toBe(false);
    expect(verified.schema_fingerprint_valid).toBe(false);
    expect(determineTrustTag(verified)).toBe("suspicious");
  });

  it("verifies tpm quote with nonce-bound extraData", async () => {
    const nonce = "nonce-tpm-valid";
    const nonceBytes = new TextEncoder().encode(nonce);
    const nonceDigest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", toArrayBuffer(nonceBytes)),
    );
    const quote = buildTpmsQuote(nonceDigest);
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.privateKey,
      toArrayBuffer(quote),
    );
    const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);

    const tpmReport: AttestationReport = {
      attestation_level: "tpm",
      attestation_data: toBase64(quote),
      attestation_signature: toBase64(signature),
      public_key: toBase64(spki),
      fingerprint: validFingerprint,
      environment: {
        environment_type: "Native",
        debugger_attached: false,
        hooks_detected: [],
      },
    };

    const verified = await verifyAttestation(tpmReport, nonce);

    expect(verified.attestation_valid).toBe(true);
    expect(verified.schema_fingerprint_valid).toBe(true);
    expect(determineTrustTag(verified)).toBe("hw_verified");
  });

  it("rejects tpm quote when nonce binding does not match", async () => {
    const quote = buildTpmsQuote(new TextEncoder().encode("different-nonce"));
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.privateKey,
      toArrayBuffer(quote),
    );
    const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);

    const tpmReport: AttestationReport = {
      attestation_level: "tpm",
      attestation_data: toBase64(quote),
      attestation_signature: toBase64(signature),
      public_key: toBase64(spki),
      fingerprint: validFingerprint,
      environment: {
        environment_type: "Native",
        debugger_attached: false,
        hooks_detected: [],
      },
    };

    const verified = await verifyAttestation(tpmReport, "nonce-tpm-mismatch");

    expect(verified.attestation_valid).toBe(false);
    expect(verified.schema_fingerprint_valid).toBe(true);
    expect(determineTrustTag(verified)).toBe("suspicious");
  });
});
