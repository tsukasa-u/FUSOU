import type { AttestationLevel } from "../types";
import type { TrustInput } from "./trust-tag";

export interface AttestationReport {
  attestation_level: AttestationLevel;
  attestation_data?: string;
  public_key?: string;
  fingerprint?: {
    cpu_brand: string;
    cpu_cores: number;
    total_memory_mb: number;
    os_name: string;
    os_version: string;
    hostname_hash: string;
    machine_id_hash: string;
  };
  environment?: {
    environment_type?: string;
    debugger_attached?: boolean;
    hooks_detected?: string[];
  };
}

const ECDSA_CURVE = "P-256";

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function isLikelySpkiDer(bytes: Uint8Array): boolean {
  // SPKI DER starts with ASN.1 SEQUENCE tag (0x30)
  return bytes.byteLength > 16 && bytes[0] === 0x30;
}

async function importEcdsaPublicKey(publicKeyBytes: Uint8Array): Promise<CryptoKey | null> {
  try {
    if (isLikelySpkiDer(publicKeyBytes)) {
      return await crypto.subtle.importKey(
        "spki",
        toArrayBuffer(publicKeyBytes),
        { name: "ECDSA", namedCurve: ECDSA_CURVE },
        false,
        ["verify"],
      );
    }

    // Some clients may send uncompressed X9.62 (0x04 + X + Y).
    if (publicKeyBytes.byteLength === 65 && publicKeyBytes[0] === 0x04) {
      return await crypto.subtle.importKey(
        "raw",
        toArrayBuffer(publicKeyBytes),
        { name: "ECDSA", namedCurve: ECDSA_CURVE },
        false,
        ["verify"],
      );
    }
  } catch {
    return null;
  }

  return null;
}

async function verifyEnclaveSignature(
  signatureB64: string,
  publicKeyB64: string,
  nonce: string,
): Promise<boolean> {
  try {
    const signatureBytes = base64ToBytes(signatureB64);
    const publicKeyBytes = base64ToBytes(publicKeyB64);
    const key = await importEcdsaPublicKey(publicKeyBytes);
    if (!key) return false;

    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      toArrayBuffer(signatureBytes),
      toArrayBuffer(new TextEncoder().encode(nonce)),
    );
  } catch {
    return false;
  }
}

function isValidSoftwareFingerprint(report: AttestationReport): boolean {
  const fp = report.fingerprint;
  if (!fp) return false;
  if (typeof fp.machine_id_hash !== "string" || fp.machine_id_hash.length < 8) {
    return false;
  }
  if (typeof fp.os_name !== "string" || fp.os_name.trim().length === 0) {
    return false;
  }
  return true;
}

function hasValidAttestationEnvelope(report: AttestationReport): boolean {
  if (report.attestation_level === "none") {
    return true;
  }

  if (report.attestation_level === "software_fingerprint") {
    return isValidSoftwareFingerprint(report);
  }

  if (
    typeof report.attestation_data !== "string" ||
    report.attestation_data.length < 16
  ) {
    return false;
  }
  if (typeof report.public_key !== "string" || report.public_key.length < 16) {
    return false;
  }

  // Hardware-backed levels should always carry a software fingerprint payload too
  // so policy checks have stable metadata when attestation verification fails closed.
  return isValidSoftwareFingerprint(report);
}

function toEnvironmentFlags(report: AttestationReport | null): TrustInput["environment_flags"] {
  return {
    emulator_detected:
      report?.environment?.environment_type != null &&
      report.environment.environment_type !== "Native",
    debugger_detected: report?.environment?.debugger_attached ?? false,
    hook_detected: (report?.environment?.hooks_detected?.length ?? 0) > 0,
  };
}

export async function verifyAttestation(
  report: AttestationReport | null,
  nonce: string,
): Promise<TrustInput> {
  if (!report) {
    return {
      attestation_level: "none",
      attestation_valid: false,
      environment_flags: toEnvironmentFlags(null),
      schema_fingerprint_valid: true,
    };
  }

  const schemaFingerprintValid = hasValidAttestationEnvelope(report);
  if (!schemaFingerprintValid) {
    return {
      attestation_level: report.attestation_level,
      attestation_valid: false,
      environment_flags: toEnvironmentFlags(report),
      schema_fingerprint_valid: false,
    };
  }

  let attestationValid = false;

  if (report.attestation_level === "secure_enclave") {
    // NOTE:
    // A client-provided public key + signature only proves message possession,
    // not Secure Enclave provenance. Until we validate the full platform
    // attestation chain on the server, this path must fail closed.
    if (
      typeof report.attestation_data === "string" &&
      typeof report.public_key === "string"
    ) {
      const signatureMatchedClientKey = await verifyEnclaveSignature(
        report.attestation_data,
        report.public_key,
        nonce,
      );
      if (signatureMatchedClientKey) {
        console.warn(
          "[attestation] secure_enclave signature matched client key, but hardware chain verification is unavailable; failing closed",
        );
      }
    }
    attestationValid = false;
  } else if (report.attestation_level === "software_fingerprint") {
    attestationValid = isValidSoftwareFingerprint(report);
  } else if (report.attestation_level === "tpm") {
    // TPM quote verification requires TPMS_ATTEST parsing and signature validation.
    // Until parser support is added, fail closed to avoid false trust elevation.
    attestationValid = false;
  }

  return {
    attestation_level: report.attestation_level,
    attestation_valid: attestationValid,
    environment_flags: toEnvironmentFlags(report),
    schema_fingerprint_valid: schemaFingerprintValid,
  };
}
