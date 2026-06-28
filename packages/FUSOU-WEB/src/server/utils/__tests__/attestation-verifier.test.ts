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

const validFingerprint = {
  cpu_brand: "Apple M2",
  cpu_cores: 8,
  total_memory_mb: 16384,
  os_name: "macOS",
  os_version: "14.0",
  hostname_hash: "host-hash",
  machine_id_hash: "machine-id-hash",
};

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

  it("keeps secure_enclave fail-closed even when signature matches", async () => {
    const nonce = "nonce-secure-enclave";
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      true,
      ["sign", "verify"],
    );

    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.privateKey,
      new TextEncoder().encode(nonce),
    );
    const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);

    const report: AttestationReport = {
      attestation_level: "secure_enclave",
      attestation_data: toBase64(signature),
      public_key: toBase64(spki),
      fingerprint: validFingerprint,
      environment: {
        environment_type: "Native",
        debugger_attached: false,
        hooks_detected: [],
      },
    };

    const verified = await verifyAttestation(report, nonce);

    expect(verified.attestation_level).toBe("secure_enclave");
    // Fail-closed policy: do not elevate until full chain verification exists.
    expect(verified.attestation_valid).toBe(false);
    expect(verified.schema_fingerprint_valid).toBe(true);
    expect(determineTrustTag(verified)).toBe("suspicious");
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

  it("keeps tpm fail-closed and marks as suspicious", async () => {
    const tpmReport: AttestationReport = {
      attestation_level: "tpm",
      attestation_data: toBase64(new TextEncoder().encode("fake-quote")),
      public_key: toBase64(new TextEncoder().encode("fake-pubkey-material")),
      fingerprint: validFingerprint,
      environment: {
        environment_type: "Native",
        debugger_attached: false,
        hooks_detected: [],
      },
    };

    const verified = await verifyAttestation(tpmReport, "nonce-tpm");

    expect(verified.attestation_valid).toBe(false);
    expect(verified.schema_fingerprint_valid).toBe(true);
    expect(determineTrustTag(verified)).toBe("suspicious");
  });
});
