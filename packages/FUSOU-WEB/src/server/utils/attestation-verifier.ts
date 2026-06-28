import "reflect-metadata";
import { X509Certificate } from "@peculiar/x509";
import type { AttestationLevel } from "../types";
import type { TrustInput } from "./trust-tag";

export interface AttestationReport {
  attestation_level: AttestationLevel;
  attestation_data?: string;
  attestation_signature?: string;
  public_key?: string;
  certificate_chain?: string[];
  attestation_format?: string;
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

export interface AttestationVerifierOptions {
  secureEnclaveTrustedRootSha256?: string[];
  now?: Date;
}

const ECDSA_CURVE = "P-256";
const BASE64_MIN_LENGTH = 16;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const TPM_GENERATED_VALUE = 0xff54_4347;
const TPM_ST_ATTEST_QUOTE = 0x8018;

type SecureEnclaveEnvelope = {
  signatureB64: string;
  publicKeyB64: string;
  certificateChainB64: string[];
};

type TpmEnvelope = {
  quoteB64: string;
  signatureB64: string;
  publicKeyB64: string;
};

function normalizeBase64(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = normalized.length % 4;
  if (remainder === 0) return normalized;
  return normalized + "=".repeat(4 - remainder);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(normalizeBase64(value));
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

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let i = 0; i < left.byteLength; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return new Uint8Array(digest);
}

function normalizeSha256Hex(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/^sha256:/, "");
  return SHA256_HEX_PATTERN.test(normalized) ? normalized : null;
}

function normalizeTrustedRootSet(values: string[] | undefined): Set<string> {
  const out = new Set<string>();
  if (!values) return out;
  for (const value of values) {
    const normalized = normalizeSha256Hex(value);
    if (normalized) {
      out.add(normalized);
    }
  }
  return out;
}

function parseEmbeddedEnvelope(
  attestationData: string | undefined,
): Record<string, unknown> | null {
  if (!attestationData || attestationData.length < BASE64_MIN_LENGTH) {
    return null;
  }

  try {
    const decoded = base64ToBytes(attestationData);
    const text = new TextDecoder().decode(decoded).trim();
    if (!text.startsWith("{")) {
      return null;
    }
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readEnvelopeString(
  envelope: Record<string, unknown> | null,
  key: string,
): string | undefined {
  if (!envelope) return undefined;
  const value = envelope[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readEnvelopeStringArray(
  envelope: Record<string, unknown> | null,
  key: string,
): string[] | undefined {
  if (!envelope) return undefined;
  const value = envelope[key];
  if (!Array.isArray(value)) return undefined;
  const filtered = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return filtered.length > 0 ? filtered : undefined;
}

function resolveSecureEnclaveEnvelope(
  report: AttestationReport,
): SecureEnclaveEnvelope | null {
  const embedded = parseEmbeddedEnvelope(report.attestation_data);
  const signatureB64 =
    report.attestation_signature?.trim() ||
    readEnvelopeString(embedded, "signature_b64") ||
    readEnvelopeString(embedded, "attestation_signature_b64") ||
    report.attestation_data;
  const publicKeyB64 =
    report.public_key?.trim() ||
    readEnvelopeString(embedded, "public_key_b64") ||
    readEnvelopeString(embedded, "public_key");
  const certificateChainB64 =
    report.certificate_chain?.filter((item) => item.trim().length > 0) ||
    readEnvelopeStringArray(embedded, "certificate_chain_b64") ||
    readEnvelopeStringArray(embedded, "certificate_chain");

  if (
    !signatureB64 ||
    signatureB64.length < BASE64_MIN_LENGTH ||
    !publicKeyB64 ||
    publicKeyB64.length < BASE64_MIN_LENGTH ||
    !certificateChainB64 ||
    certificateChainB64.length < 2
  ) {
    return null;
  }

  return {
    signatureB64,
    publicKeyB64,
    certificateChainB64,
  };
}

function resolveTpmEnvelope(report: AttestationReport): TpmEnvelope | null {
  const embedded = parseEmbeddedEnvelope(report.attestation_data);
  const quoteB64 =
    readEnvelopeString(embedded, "quote_b64") ||
    readEnvelopeString(embedded, "attestation_data_b64") ||
    (embedded ? undefined : report.attestation_data);
  const signatureB64 =
    report.attestation_signature?.trim() ||
    readEnvelopeString(embedded, "signature_b64") ||
    readEnvelopeString(embedded, "quote_signature_b64");
  const publicKeyB64 =
    report.public_key?.trim() ||
    readEnvelopeString(embedded, "public_key_b64") ||
    readEnvelopeString(embedded, "public_key");

  if (
    !quoteB64 ||
    quoteB64.length < BASE64_MIN_LENGTH ||
    !signatureB64 ||
    signatureB64.length < BASE64_MIN_LENGTH ||
    !publicKeyB64 ||
    publicKeyB64.length < BASE64_MIN_LENGTH
  ) {
    return null;
  }

  return {
    quoteB64,
    signatureB64,
    publicKeyB64,
  };
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

async function importRsaPublicKey(
  publicKeyBytes: Uint8Array,
  algorithmName: "RSA-PSS" | "RSASSA-PKCS1-v1_5",
): Promise<CryptoKey | null> {
  try {
    if (!isLikelySpkiDer(publicKeyBytes)) return null;
    return await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(publicKeyBytes),
      { name: algorithmName, hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }
}

async function verifyEcdsaSignatureWithKey(
  signatureB64: string,
  key: CryptoKey,
  nonce: string,
): Promise<boolean> {
  try {
    const signatureBytes = base64ToBytes(signatureB64);
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

async function parseCertificateChain(
  certificateChainB64: string[],
): Promise<X509Certificate[] | null> {
  try {
    return certificateChainB64.map(
      (certificateB64) =>
        new X509Certificate(toArrayBuffer(base64ToBytes(certificateB64))),
    );
  } catch {
    return null;
  }
}

async function verifySecureEnclaveCertificateChain(
  certificateChain: X509Certificate[],
  trustedRootSet: Set<string>,
  now: Date,
): Promise<boolean> {
  if (certificateChain.length < 2 || trustedRootSet.size === 0) {
    return false;
  }

  for (const certificate of certificateChain) {
    if (now < certificate.notBefore || now > certificate.notAfter) {
      return false;
    }
  }

  for (let i = 0; i < certificateChain.length - 1; i += 1) {
    const child = certificateChain[i];
    const issuer = certificateChain[i + 1];
    const issuerVerified = await child.verify({ publicKey: issuer.publicKey });
    if (!issuerVerified) {
      return false;
    }
  }

  const root = certificateChain[certificateChain.length - 1];
  const rootSelfSigned = await root.verify({ publicKey: root.publicKey });
  if (!rootSelfSigned) {
    return false;
  }

  const rootHash = bytesToHex(await sha256Bytes(new Uint8Array(root.rawData)));
  return trustedRootSet.has(rootHash);
}

async function verifySecureEnclaveAttestation(
  report: AttestationReport,
  nonce: string,
  options: AttestationVerifierOptions,
): Promise<boolean> {
  const envelope = resolveSecureEnclaveEnvelope(report);
  if (!envelope) return false;

  const trustedRootSet = normalizeTrustedRootSet(
    options.secureEnclaveTrustedRootSha256,
  );
  const now = options.now ?? new Date();
  const signatureMatchesClientKey = await verifyEnclaveSignature(
    envelope.signatureB64,
    envelope.publicKeyB64,
    nonce,
  );
  if (!signatureMatchesClientKey) {
    return false;
  }

  const certificateChain = await parseCertificateChain(
    envelope.certificateChainB64,
  );
  if (!certificateChain) {
    return false;
  }

  const chainTrusted = await verifySecureEnclaveCertificateChain(
    certificateChain,
    trustedRootSet,
    now,
  );
  if (!chainTrusted) {
    return false;
  }

  const leafCertificate = certificateChain[0];
  let leafKey: CryptoKey;
  try {
    leafKey = await leafCertificate.publicKey.export();
  } catch {
    return false;
  }

  return verifyEcdsaSignatureWithKey(envelope.signatureB64, leafKey, nonce);
}

class ByteReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  readU16(): number | null {
    if (this.offset + 2 > this.bytes.byteLength) return null;
    const value = (this.bytes[this.offset] << 8) | this.bytes[this.offset + 1];
    this.offset += 2;
    return value;
  }

  readU32(): number | null {
    if (this.offset + 4 > this.bytes.byteLength) return null;
    const value =
      (this.bytes[this.offset] << 24) |
      (this.bytes[this.offset + 1] << 16) |
      (this.bytes[this.offset + 2] << 8) |
      this.bytes[this.offset + 3];
    this.offset += 4;
    return value >>> 0;
  }

  readBytes(length: number): Uint8Array | null {
    if (length < 0 || this.offset + length > this.bytes.byteLength) {
      return null;
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  skip(length: number): boolean {
    if (length < 0 || this.offset + length > this.bytes.byteLength) {
      return false;
    }
    this.offset += length;
    return true;
  }
}

function extractTpmsAttestBody(quoteBytes: Uint8Array): Uint8Array {
  if (quoteBytes.byteLength < 2) {
    return quoteBytes;
  }

  const declaredLength = (quoteBytes[0] << 8) | quoteBytes[1];
  if (declaredLength === quoteBytes.byteLength - 2) {
    return quoteBytes.subarray(2);
  }
  return quoteBytes;
}

function parseTpmsAttestExtraData(quoteBytes: Uint8Array): Uint8Array | null {
  const body = extractTpmsAttestBody(quoteBytes);
  const reader = new ByteReader(body);

  const magic = reader.readU32();
  if (magic !== TPM_GENERATED_VALUE) {
    return null;
  }

  const attestType = reader.readU16();
  if (attestType !== TPM_ST_ATTEST_QUOTE) {
    return null;
  }

  const qualifiedSignerLength = reader.readU16();
  if (qualifiedSignerLength == null || !reader.skip(qualifiedSignerLength)) {
    return null;
  }

  const extraDataLength = reader.readU16();
  if (extraDataLength == null) {
    return null;
  }
  const extraData = reader.readBytes(extraDataLength);
  if (!extraData) {
    return null;
  }

  // TPMS_CLOCK_INFO (17 bytes) + firmwareVersion (8 bytes) must exist.
  if (!reader.skip(25)) {
    return null;
  }

  return extraData;
}

async function verifyNonceBinding(
  extraData: Uint8Array,
  nonce: string,
): Promise<boolean> {
  const nonceBytes = new TextEncoder().encode(nonce);
  if (bytesEqual(extraData, nonceBytes)) {
    return true;
  }

  const nonceDigest = await sha256Bytes(nonceBytes);
  return bytesEqual(extraData, nonceDigest);
}

async function verifyTpmQuoteSignature(envelope: TpmEnvelope): Promise<boolean> {
  let quoteBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  let publicKeyBytes: Uint8Array;

  try {
    quoteBytes = base64ToBytes(envelope.quoteB64);
    signatureBytes = base64ToBytes(envelope.signatureB64);
    publicKeyBytes = base64ToBytes(envelope.publicKeyB64);
  } catch {
    return false;
  }

  const quoteData = toArrayBuffer(quoteBytes);
  const signatureData = toArrayBuffer(signatureBytes);

  const rsaPssKey = await importRsaPublicKey(publicKeyBytes, "RSA-PSS");
  if (rsaPssKey) {
    const rsaPssVerified = await crypto.subtle.verify(
      { name: "RSA-PSS", saltLength: 32 },
      rsaPssKey,
      signatureData,
      quoteData,
    );
    if (rsaPssVerified) {
      return true;
    }
  }

  const rsaPkcs1Key = await importRsaPublicKey(
    publicKeyBytes,
    "RSASSA-PKCS1-v1_5",
  );
  if (rsaPkcs1Key) {
    const rsaPkcs1Verified = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      rsaPkcs1Key,
      signatureData,
      quoteData,
    );
    if (rsaPkcs1Verified) {
      return true;
    }
  }

  const ecdsaKey = await importEcdsaPublicKey(publicKeyBytes);
  if (ecdsaKey) {
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      ecdsaKey,
      signatureData,
      quoteData,
    );
  }

  return false;
}

async function verifyTpmAttestation(
  report: AttestationReport,
  nonce: string,
): Promise<boolean> {
  const envelope = resolveTpmEnvelope(report);
  if (!envelope) return false;

  let quoteBytes: Uint8Array;
  try {
    quoteBytes = base64ToBytes(envelope.quoteB64);
  } catch {
    return false;
  }

  const extraData = parseTpmsAttestExtraData(quoteBytes);
  if (!extraData) {
    return false;
  }

  const nonceBound = await verifyNonceBinding(extraData, nonce);
  if (!nonceBound) {
    return false;
  }

  return verifyTpmQuoteSignature(envelope);
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

  // Hardware-backed levels should always carry a software fingerprint payload too
  // so policy checks have stable metadata when attestation verification fails closed.
  if (!isValidSoftwareFingerprint(report)) {
    return false;
  }

  if (report.attestation_level === "secure_enclave") {
    return resolveSecureEnclaveEnvelope(report) != null;
  }

  if (report.attestation_level === "tpm") {
    return resolveTpmEnvelope(report) != null;
  }

  return false;
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
  options: AttestationVerifierOptions = {},
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
    attestationValid = await verifySecureEnclaveAttestation(
      report,
      nonce,
      options,
    );
  } else if (report.attestation_level === "software_fingerprint") {
    attestationValid = isValidSoftwareFingerprint(report);
  } else if (report.attestation_level === "tpm") {
    attestationValid = await verifyTpmAttestation(report, nonce);
  }

  return {
    attestation_level: report.attestation_level,
    attestation_valid: attestationValid,
    environment_flags: toEnvironmentFlags(report),
    schema_fingerprint_valid: schemaFingerprintValid,
  };
}
