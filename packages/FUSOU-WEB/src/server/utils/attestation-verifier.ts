import "reflect-metadata";
import { AsnParser, AsnSerializer, OctetString } from "@peculiar/asn1-schema";
import {
  AlgorithmIdentifier,
  Certificate as AsnX509Certificate,
} from "@peculiar/asn1-x509";
import {
  BasicOCSPResponse,
  CertID,
  OCSPRequest,
  OCSPResponse,
  OCSPResponseStatus,
  Request,
  TBSRequest,
  id_kp_OCSPSigning,
  id_pkix_ocsp_basic,
} from "@peculiar/asn1-ocsp";
import {
  AuthorityInfoAccessExtension,
  BasicConstraintsExtension,
  CRLDistributionPointsExtension,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  X509Certificate,
  X509Crl,
} from "@peculiar/x509";
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
  tpmAkTrustedRootSha256?: string[];
  now?: Date;
}

const ECDSA_CURVE = "P-256";
const BASE64_MIN_LENGTH = 16;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const TPM_GENERATED_VALUE = 0xff54_4347;
const TPM_ST_ATTEST_QUOTE = 0x8018;
const TPM_AIK_EKU_OID = "2.23.133.8.3";
const TPM_AK_ALLOWED_EKU_OIDS = new Set<string>([TPM_AIK_EKU_OID]);
const OCSP_REQUEST_HASH_OID = "1.3.14.3.2.26";
const HASH_OID_SHA1 = "1.3.14.3.2.26";
const HASH_OID_SHA256 = "2.16.840.1.101.3.4.2.1";
const HASH_OID_SHA384 = "2.16.840.1.101.3.4.2.2";
const HASH_OID_SHA512 = "2.16.840.1.101.3.4.2.3";
const SIG_OID_ECDSA_SHA256 = "1.2.840.10045.4.3.2";
const SIG_OID_ECDSA_SHA384 = "1.2.840.10045.4.3.3";
const SIG_OID_ECDSA_SHA512 = "1.2.840.10045.4.3.4";
const SIG_OID_RSA_SHA1 = "1.2.840.113549.1.1.5";
const SIG_OID_RSA_SHA256 = "1.2.840.113549.1.1.11";
const SIG_OID_RSA_SHA384 = "1.2.840.113549.1.1.12";
const SIG_OID_RSA_SHA512 = "1.2.840.113549.1.1.13";
const REVOCATION_FETCH_TIMEOUT_MS = 3000;
const REVOCATION_MAX_RESPONSE_BYTES = 256 * 1024;
const REVOCATION_MAX_URLS = 4;
const MAX_CERTIFICATE_CHAIN_LENGTH = 8;
const REVOCATION_BLOCKED_HOSTNAMES = new Set<string>([
  "localhost",
  "localhost.localdomain",
]);
const REVOCATION_BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".home",
  ".lan",
];

type SecureEnclaveEnvelope = {
  signatureB64: string;
  publicKeyB64: string;
  certificateChainB64: string[];
};

type TpmEnvelope = {
  quoteB64: string;
  signatureB64: string;
  publicKeyB64: string;
  certificateChainB64?: string[];
};

type DecodedTpmEnvelope = {
  quoteBytes: Uint8Array;
  signatureBytes: Uint8Array;
  publicKeyBytes: Uint8Array;
};

type HashName = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";
type RevocationStatus = "good" | "revoked" | "unknown";
type OcspSignatureAlgorithm =
  | { name: "ECDSA"; hash: HashName }
  | { name: "RSASSA-PKCS1-v1_5"; hash: HashName };

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

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim().toLowerCase().replace(/[^0-9a-f]/g, "");
  if (normalized.length === 0) return new Uint8Array();
  const even = normalized.length % 2 === 0 ? normalized : `0${normalized}`;
  const out = new Uint8Array(even.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(even.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function normalizeSerialHex(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^0+/, "");
  return normalized.length > 0 ? normalized : "0";
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return new Uint8Array(digest);
}

async function digestBytes(data: Uint8Array, hash: HashName): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(hash, toArrayBuffer(data));
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

function resolveHashNameFromOid(oid: string): HashName | null {
  if (oid === HASH_OID_SHA1) return "SHA-1";
  if (oid === HASH_OID_SHA256) return "SHA-256";
  if (oid === HASH_OID_SHA384) return "SHA-384";
  if (oid === HASH_OID_SHA512) return "SHA-512";
  return null;
}

function resolveOcspSignatureAlgorithm(oid: string): OcspSignatureAlgorithm | null {
  if (oid === SIG_OID_ECDSA_SHA256) return { name: "ECDSA", hash: "SHA-256" };
  if (oid === SIG_OID_ECDSA_SHA384) return { name: "ECDSA", hash: "SHA-384" };
  if (oid === SIG_OID_ECDSA_SHA512) return { name: "ECDSA", hash: "SHA-512" };
  if (oid === SIG_OID_RSA_SHA1) {
    return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-1" };
  }
  if (oid === SIG_OID_RSA_SHA256) {
    return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  }
  if (oid === SIG_OID_RSA_SHA384) {
    return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" };
  }
  if (oid === SIG_OID_RSA_SHA512) {
    return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" };
  }
  return null;
}

function parseIpv4Octets(hostname: string): number[] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }

    const value = Number.parseInt(part, 10);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return null;
    }
    octets.push(value);
  }

  return octets;
}

function isBlockedIpv4(octets: number[]): boolean {
  const [first, second] = octets;

  if (first === 10) return true;
  if (first === 127) return true;
  if (first === 0) return true;
  if (first === 169 && second === 254) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 198 && (second === 18 || second === 19)) return true;

  return false;
}

function isBlockedIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (!normalized.includes(":")) {
    return false;
  }

  if (normalized === "::" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }

  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice("::ffff:".length);
    const octets = parseIpv4Octets(mappedIpv4);
    return octets ? isBlockedIpv4(octets) : false;
  }

  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }

  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }

  return false;
}

function isBlockedRevocationHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (normalized.length === 0) {
    return true;
  }

  if (REVOCATION_BLOCKED_HOSTNAMES.has(normalized)) {
    return true;
  }

  if (
    REVOCATION_BLOCKED_HOST_SUFFIXES.some((suffix) =>
      normalized.endsWith(suffix),
    )
  ) {
    return true;
  }

  const ipv4Octets = parseIpv4Octets(normalized);
  if (ipv4Octets) {
    return isBlockedIpv4(ipv4Octets);
  }

  return isBlockedIpv6(normalized);
}

function normalizeRevocationUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "https:" && protocol !== "data:") {
    return null;
  }

  if (parsed.username || parsed.password) {
    return null;
  }

  if (protocol === "data:") {
    return parsed.toString();
  }

  if (isBlockedRevocationHostname(parsed.hostname)) {
    return null;
  }

  return parsed.toString();
}

function sanitizeRevocationUrls(urls: string[]): string[] {
  const out = new Set<string>();
  for (const value of urls) {
    const normalized = normalizeRevocationUrl(value);
    if (!normalized) {
      continue;
    }

    out.add(normalized);
    if (out.size >= REVOCATION_MAX_URLS) {
      break;
    }
  }

  return Array.from(out);
}

function parseAsnCertificate(
  certificate: X509Certificate,
): AsnX509Certificate | null {
  try {
    return AsnParser.parse(certificate.rawData, AsnX509Certificate);
  } catch {
    return null;
  }
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
  const certificateChainB64 =
    report.certificate_chain?.filter((item) => item.trim().length > 0) ||
    readEnvelopeStringArray(embedded, "ak_certificate_chain_b64") ||
    readEnvelopeStringArray(embedded, "ak_certificate_chain") ||
    readEnvelopeStringArray(embedded, "certificate_chain_b64") ||
    readEnvelopeStringArray(embedded, "certificate_chain");

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
    certificateChainB64,
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
  if (
    certificateChainB64.length < 2 ||
    certificateChainB64.length > MAX_CERTIFICATE_CHAIN_LENGTH
  ) {
    return null;
  }

  try {
    return certificateChainB64.map(
      (certificateB64) =>
        new X509Certificate(toArrayBuffer(base64ToBytes(certificateB64))),
    );
  } catch {
    return null;
  }
}

function extractOcspResponderUrls(certificate: X509Certificate): string[] {
  const extension = certificate.getExtension(AuthorityInfoAccessExtension);
  if (!extension || extension.ocsp.length === 0) {
    return [];
  }

  return sanitizeRevocationUrls(
    extension.ocsp
      .filter((name) => name.type === "url")
      .map((name) => name.value),
  );
}

function extractCrlDistributionPointUrls(certificate: X509Certificate): string[] {
  const extension = certificate.getExtension(CRLDistributionPointsExtension);
  if (!extension || extension.distributionPoints.length === 0) {
    return [];
  }

  const urls: string[] = [];
  for (const distributionPoint of extension.distributionPoints) {
    const fullName = distributionPoint.distributionPoint?.fullName;
    if (!fullName || fullName.length === 0) {
      continue;
    }
    for (const generalName of fullName) {
      const uri = generalName.uniformResourceIdentifier;
      if (typeof uri === "string" && uri.trim().length > 0) {
        urls.push(uri);
      }
    }
  }

  return sanitizeRevocationUrls(urls);
}

async function fetchBinaryResource(options: {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: Uint8Array;
}): Promise<Uint8Array | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REVOCATION_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body ? toArrayBuffer(options.body) : undefined,
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) {
      return null;
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(contentLength) && contentLength > REVOCATION_MAX_RESPONSE_BYTES) {
        return null;
      }
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > REVOCATION_MAX_RESPONSE_BYTES) {
      return null;
    }
    return bytes;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function buildOcspRequestBody(
  certificate: X509Certificate,
  issuerCertificate: X509Certificate,
): Promise<Uint8Array | null> {
  const serialNumber = hexToBytes(certificate.serialNumber);
  if (serialNumber.byteLength === 0) {
    return null;
  }

  const issuerAsn = parseAsnCertificate(issuerCertificate);
  if (!issuerAsn) {
    return null;
  }
  const issuerNameDer = new Uint8Array(
    AsnSerializer.serialize(issuerAsn.tbsCertificate.subject),
  );

  const issuerNameHash = await digestBytes(
    issuerNameDer,
    "SHA-1",
  );
  const issuerKeyHash = new Uint8Array(
    await issuerCertificate.publicKey.getKeyIdentifier("SHA-1"),
  );

  const certId = new CertID({
    hashAlgorithm: new AlgorithmIdentifier({
      algorithm: OCSP_REQUEST_HASH_OID,
      parameters: null,
    }),
    issuerNameHash: new OctetString(issuerNameHash),
    issuerKeyHash: new OctetString(issuerKeyHash),
    serialNumber: toArrayBuffer(serialNumber),
  });
  const ocspRequest = new OCSPRequest({
    tbsRequest: new TBSRequest({
      requestList: [new Request({ reqCert: certId })],
    }),
  });

  return new Uint8Array(AsnSerializer.serialize(ocspRequest));
}

async function ocspCertIdMatchesCertificate(options: {
  certId: CertID;
  certificate: X509Certificate;
  issuerCertificate: X509Certificate;
}): Promise<boolean> {
  const hashName = resolveHashNameFromOid(options.certId.hashAlgorithm.algorithm);
  if (!hashName) {
    return false;
  }

  const issuerAsn = parseAsnCertificate(options.issuerCertificate);
  if (!issuerAsn) {
    return false;
  }
  const issuerNameDer = new Uint8Array(
    AsnSerializer.serialize(issuerAsn.tbsCertificate.subject),
  );

  const expectedIssuerNameHash = await digestBytes(
    issuerNameDer,
    hashName,
  );
  const expectedIssuerKeyHash = new Uint8Array(
    await options.issuerCertificate.publicKey.getKeyIdentifier(hashName),
  );
  const responseIssuerNameHash = new Uint8Array(options.certId.issuerNameHash.buffer);
  const responseIssuerKeyHash = new Uint8Array(options.certId.issuerKeyHash.buffer);

  if (!bytesEqual(expectedIssuerNameHash, responseIssuerNameHash)) {
    return false;
  }
  if (!bytesEqual(expectedIssuerKeyHash, responseIssuerKeyHash)) {
    return false;
  }

  const expectedSerial = normalizeSerialHex(options.certificate.serialNumber);
  const responseSerial = normalizeSerialHex(
    bytesToHex(new Uint8Array(options.certId.serialNumber)),
  );
  return expectedSerial === responseSerial;
}

function parseOcspEmbeddedCertificates(
  basicResponse: BasicOCSPResponse,
): X509Certificate[] {
  if (!basicResponse.certs || basicResponse.certs.length === 0) {
    return [];
  }

  try {
    return basicResponse.certs.map(
      (certificate) => new X509Certificate(AsnSerializer.serialize(certificate)),
    );
  } catch {
    return [];
  }
}

async function ocspResponderIdMatchesCertificate(
  basicResponse: BasicOCSPResponse,
  certificate: X509Certificate,
): Promise<boolean> {
  const responderId = basicResponse.tbsResponseData.responderID;
  if (responderId.byName) {
    const responderName = new Uint8Array(AsnSerializer.serialize(responderId.byName));
    const certificateAsn = parseAsnCertificate(certificate);
    if (!certificateAsn) {
      return false;
    }
    const certificateSubject = new Uint8Array(
      AsnSerializer.serialize(certificateAsn.tbsCertificate.subject),
    );
    return bytesEqual(responderName, certificateSubject);
  }

  if (responderId.byKey) {
    const responderKeyHash = new Uint8Array(responderId.byKey.buffer);
    const certificateKeyHash = new Uint8Array(
      await certificate.publicKey.getKeyIdentifier("SHA-1"),
    );
    return bytesEqual(responderKeyHash, certificateKeyHash);
  }

  return false;
}

async function isAuthorizedOcspSigner(options: {
  signerCertificate: X509Certificate;
  issuerCertificate: X509Certificate;
  now: Date;
}): Promise<boolean> {
  const signerEqualsIssuer = bytesEqual(
    new Uint8Array(options.signerCertificate.rawData),
    new Uint8Array(options.issuerCertificate.rawData),
  );
  if (signerEqualsIssuer) {
    return true;
  }

  if (
    options.now < options.signerCertificate.notBefore ||
    options.now > options.signerCertificate.notAfter
  ) {
    return false;
  }

  const signerIssuedByIssuer = await options.signerCertificate.verify({
    publicKey: options.issuerCertificate.publicKey,
  });
  if (!signerIssuedByIssuer) {
    return false;
  }

  const signerEku = options.signerCertificate.getExtension(ExtendedKeyUsageExtension);
  if (!signerEku || signerEku.usages.length === 0) {
    return false;
  }

  return signerEku.usages.some(
    (usage) => String(usage).trim() === id_kp_OCSPSigning,
  );
}

async function exportOcspVerifierKey(
  certificate: X509Certificate,
  algorithm: OcspSignatureAlgorithm,
): Promise<CryptoKey | null> {
  try {
    if (algorithm.name === "ECDSA") {
      const keyAlgorithm = certificate.publicKey.algorithm as EcKeyAlgorithm;
      if (
        keyAlgorithm.name !== "ECDSA" ||
        typeof keyAlgorithm.namedCurve !== "string"
      ) {
        return null;
      }
      return await certificate.publicKey.export(
        {
          name: "ECDSA",
          namedCurve: keyAlgorithm.namedCurve,
        },
        ["verify"],
      );
    }

    return await certificate.publicKey.export(
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: algorithm.hash,
      },
      ["verify"],
    );
  } catch {
    return null;
  }
}

async function verifyOcspResponseSignature(options: {
  basicResponse: BasicOCSPResponse;
  signerCertificate: X509Certificate;
}): Promise<boolean> {
  const signatureAlgorithm = resolveOcspSignatureAlgorithm(
    options.basicResponse.signatureAlgorithm.algorithm,
  );
  if (!signatureAlgorithm) {
    return false;
  }

  const verifierKey = await exportOcspVerifierKey(
    options.signerCertificate,
    signatureAlgorithm,
  );
  if (!verifierKey) {
    return false;
  }

  const tbsResponseData = options.basicResponse.tbsResponseDataRaw
    ? new Uint8Array(options.basicResponse.tbsResponseDataRaw)
    : new Uint8Array(AsnSerializer.serialize(options.basicResponse.tbsResponseData));
  const signature = new Uint8Array(options.basicResponse.signature);

  try {
    if (signatureAlgorithm.name === "ECDSA") {
      return await crypto.subtle.verify(
        {
          name: "ECDSA",
          hash: signatureAlgorithm.hash,
        },
        verifierKey,
        toArrayBuffer(signature),
        toArrayBuffer(tbsResponseData),
      );
    }

    return await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      verifierKey,
      toArrayBuffer(signature),
      toArrayBuffer(tbsResponseData),
    );
  } catch {
    return false;
  }
}

async function checkOcspStatusFromUrl(options: {
  url: string;
  certificate: X509Certificate;
  issuerCertificate: X509Certificate;
  now: Date;
}): Promise<RevocationStatus> {
  const requestBody = await buildOcspRequestBody(
    options.certificate,
    options.issuerCertificate,
  );
  if (!requestBody) {
    return "unknown";
  }

  const responseBytes = await fetchBinaryResource({
    url: options.url,
    method: "POST",
    headers: {
      "content-type": "application/ocsp-request",
      accept: "application/ocsp-response",
    },
    body: requestBody,
  });
  if (!responseBytes) {
    return "unknown";
  }

  try {
    const ocspResponse = AsnParser.parse(responseBytes, OCSPResponse);
    if (ocspResponse.responseStatus !== OCSPResponseStatus.successful) {
      return "unknown";
    }
    if (
      !ocspResponse.responseBytes ||
      ocspResponse.responseBytes.responseType !== id_pkix_ocsp_basic
    ) {
      return "unknown";
    }

    const basicResponse = AsnParser.parse(
      ocspResponse.responseBytes.response.buffer,
      BasicOCSPResponse,
    );

    const signerCandidates = [
      options.issuerCertificate,
      ...parseOcspEmbeddedCertificates(basicResponse),
    ];
    let responseSignatureVerified = false;
    for (const signerCandidate of signerCandidates) {
      if (
        !(await ocspResponderIdMatchesCertificate(basicResponse, signerCandidate))
      ) {
        continue;
      }
      const signerAuthorized = await isAuthorizedOcspSigner({
        signerCertificate: signerCandidate,
        issuerCertificate: options.issuerCertificate,
        now: options.now,
      });
      if (!signerAuthorized) {
        continue;
      }
      const signatureVerified = await verifyOcspResponseSignature({
        basicResponse,
        signerCertificate: signerCandidate,
      });
      if (!signatureVerified) {
        continue;
      }
      responseSignatureVerified = true;
      break;
    }
    if (!responseSignatureVerified) {
      return "unknown";
    }

    for (const singleResponse of basicResponse.tbsResponseData.responses) {
      const certIdMatched = await ocspCertIdMatchesCertificate({
        certId: singleResponse.certID,
        certificate: options.certificate,
        issuerCertificate: options.issuerCertificate,
      });
      if (!certIdMatched) {
        continue;
      }

      if (options.now < singleResponse.thisUpdate) {
        return "unknown";
      }
      if (singleResponse.nextUpdate && options.now > singleResponse.nextUpdate) {
        return "unknown";
      }

      if (singleResponse.certStatus.revoked) {
        if (options.now >= singleResponse.certStatus.revoked.revocationTime) {
          return "revoked";
        }
        return "unknown";
      }

      if (singleResponse.certStatus.good !== undefined) {
        return "good";
      }

      return "unknown";
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}

async function checkOcspStatus(options: {
  urls: string[];
  certificate: X509Certificate;
  issuerCertificate: X509Certificate;
  now: Date;
}): Promise<RevocationStatus> {
  let hasGood = false;
  for (const url of options.urls) {
    const status = await checkOcspStatusFromUrl({
      url,
      certificate: options.certificate,
      issuerCertificate: options.issuerCertificate,
      now: options.now,
    });
    if (status === "revoked") {
      return "revoked";
    }
    if (status === "good") {
      hasGood = true;
    }
  }
  return hasGood ? "good" : "unknown";
}

async function checkCrlStatusFromUrl(options: {
  url: string;
  certificate: X509Certificate;
  issuerCertificate: X509Certificate;
  now: Date;
}): Promise<RevocationStatus> {
  const crlBytes = await fetchBinaryResource({
    url: options.url,
    method: "GET",
    headers: {
      accept: "application/pkix-crl, application/x-pkcs7-crl, */*",
    },
  });
  if (!crlBytes) {
    return "unknown";
  }

  let crl: X509Crl;
  try {
    crl = new X509Crl(toArrayBuffer(crlBytes));
  } catch {
    return "unknown";
  }

  if (options.now < crl.thisUpdate) {
    return "unknown";
  }
  if (crl.nextUpdate && options.now > crl.nextUpdate) {
    return "unknown";
  }

  const signatureVerified = await crl.verify({
    publicKey: options.issuerCertificate,
  });
  if (!signatureVerified) {
    return "unknown";
  }

  const revoked = crl.findRevoked(options.certificate);
  if (revoked) {
    if (options.now >= revoked.revocationDate) {
      return "revoked";
    }
    return "unknown";
  }

  return "good";
}

async function checkCrlStatus(options: {
  urls: string[];
  certificate: X509Certificate;
  issuerCertificate: X509Certificate;
  now: Date;
}): Promise<RevocationStatus> {
  let hasGood = false;
  for (const url of options.urls) {
    const status = await checkCrlStatusFromUrl({
      url,
      certificate: options.certificate,
      issuerCertificate: options.issuerCertificate,
      now: options.now,
    });
    if (status === "revoked") {
      return "revoked";
    }
    if (status === "good") {
      hasGood = true;
    }
  }
  return hasGood ? "good" : "unknown";
}

async function verifyLeafCertificateRevocation(
  certificateChain: X509Certificate[],
  now: Date,
): Promise<boolean> {
  if (certificateChain.length < 2) {
    return false;
  }

  const leaf = certificateChain[0];
  const issuer = certificateChain[1];
  const ocspUrls = extractOcspResponderUrls(leaf);
  const crlUrls = extractCrlDistributionPointUrls(leaf);
  if (ocspUrls.length === 0 && crlUrls.length === 0) {
    return false;
  }

  if (ocspUrls.length > 0) {
    const ocspStatus = await checkOcspStatus({
      urls: ocspUrls,
      certificate: leaf,
      issuerCertificate: issuer,
      now,
    });
    if (ocspStatus === "good") {
      return true;
    }
    if (ocspStatus === "revoked") {
      return false;
    }
  }

  if (crlUrls.length > 0) {
    const crlStatus = await checkCrlStatus({
      urls: crlUrls,
      certificate: leaf,
      issuerCertificate: issuer,
      now,
    });
    if (crlStatus === "good") {
      return true;
    }
    if (crlStatus === "revoked") {
      return false;
    }
  }

  return false;
}

async function verifyCertificateChainAgainstTrustedRoot(
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

  // Avoid revocation network calls for chains that are not anchored to trusted roots.
  const rootHash = bytesToHex(await sha256Bytes(new Uint8Array(root.rawData)));
  if (!trustedRootSet.has(rootHash)) {
    return false;
  }

  const leafRevocationValid = await verifyLeafCertificateRevocation(
    certificateChain,
    now,
  );
  if (!leafRevocationValid) {
    return false;
  }

  return true;
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

  const chainTrusted = await verifyCertificateChainAgainstTrustedRoot(
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

function decodeTpmEnvelopePayload(
  envelope: TpmEnvelope,
): DecodedTpmEnvelope | null {
  try {
    return {
      quoteBytes: base64ToBytes(envelope.quoteB64),
      signatureBytes: base64ToBytes(envelope.signatureB64),
      publicKeyBytes: base64ToBytes(envelope.publicKeyB64),
    };
  } catch {
    return null;
  }
}

async function verifyWithCryptoKey(
  key: CryptoKey,
  quoteBytes: Uint8Array,
  signatureBytes: Uint8Array,
): Promise<boolean> {
  const keyAlgorithm = key.algorithm.name;
  const quoteData = toArrayBuffer(quoteBytes);
  const signatureData = toArrayBuffer(signatureBytes);

  if (keyAlgorithm === "ECDSA") {
    try {
      return await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        signatureData,
        quoteData,
      );
    } catch {
      return false;
    }
  }

  if (keyAlgorithm === "RSA-PSS") {
    try {
      if (
        await crypto.subtle.verify(
          { name: "RSA-PSS", saltLength: 32 },
          key,
          signatureData,
          quoteData,
        )
      ) {
        return true;
      }
    } catch {
      // Try PKCS1 as a fallback for certificate-exported keys.
    }
    try {
      return await crypto.subtle.verify(
        { name: "RSASSA-PKCS1-v1_5" },
        key,
        signatureData,
        quoteData,
      );
    } catch {
      return false;
    }
  }

  if (keyAlgorithm === "RSASSA-PKCS1-v1_5") {
    try {
      if (
        await crypto.subtle.verify(
          { name: "RSASSA-PKCS1-v1_5" },
          key,
          signatureData,
          quoteData,
        )
      ) {
        return true;
      }
    } catch {
      // Try RSA-PSS as a fallback for certificate-exported keys.
    }
    try {
      return await crypto.subtle.verify(
        { name: "RSA-PSS", saltLength: 32 },
        key,
        signatureData,
        quoteData,
      );
    } catch {
      return false;
    }
  }

  return false;
}

async function verifyTpmQuoteSignatureWithLeafCertificate(
  decoded: DecodedTpmEnvelope,
  leafCertificate: X509Certificate,
): Promise<boolean> {
  let leafKey: CryptoKey;
  try {
    leafKey = await leafCertificate.publicKey.export();
  } catch {
    return false;
  }

  return verifyWithCryptoKey(leafKey, decoded.quoteBytes, decoded.signatureBytes);
}

async function verifyReportedTpmPublicKeyMatchesLeafCertificate(
  decoded: DecodedTpmEnvelope,
  leafCertificate: X509Certificate,
): Promise<boolean> {
  // TPM report public_key must be SPKI DER and must match AK leaf certificate SPKI.
  if (!isLikelySpkiDer(decoded.publicKeyBytes)) {
    return false;
  }

  const leafAsn = parseAsnCertificate(leafCertificate);
  if (!leafAsn) {
    return false;
  }

  const leafSpki = new Uint8Array(
    AsnSerializer.serialize(leafAsn.tbsCertificate.subjectPublicKeyInfo),
  );
  return bytesEqual(decoded.publicKeyBytes, leafSpki);
}

function hasKeyUsageFlag(usages: KeyUsageFlags, flag: KeyUsageFlags): boolean {
  return (usages & flag) === flag;
}

function verifyTpmAkCertificatePolicy(certificateChain: X509Certificate[]): boolean {
  if (certificateChain.length < 2) {
    return false;
  }

  const leaf = certificateChain[0];
  const leafBasicConstraints = leaf.getExtension(BasicConstraintsExtension);
  if (!leafBasicConstraints || leafBasicConstraints.ca) {
    return false;
  }

  const leafKeyUsage = leaf.getExtension(KeyUsagesExtension);
  if (
    !leafKeyUsage ||
    !hasKeyUsageFlag(leafKeyUsage.usages, KeyUsageFlags.digitalSignature)
  ) {
    return false;
  }

  const leafExtendedKeyUsage = leaf.getExtension(ExtendedKeyUsageExtension);
  if (!leafExtendedKeyUsage || leafExtendedKeyUsage.usages.length === 0) {
    return false;
  }
  const hasAllowedLeafEku = leafExtendedKeyUsage.usages.some((usage) =>
    TPM_AK_ALLOWED_EKU_OIDS.has(String(usage).trim()),
  );
  if (!hasAllowedLeafEku) {
    return false;
  }

  for (let i = 1; i < certificateChain.length; i += 1) {
    const certificate = certificateChain[i];
    const isIntermediate = i < certificateChain.length - 1;
    const basicConstraints = certificate.getExtension(BasicConstraintsExtension);

    if (isIntermediate && (!basicConstraints || !basicConstraints.ca)) {
      return false;
    }
    if (basicConstraints && !basicConstraints.ca) {
      return false;
    }

    const keyUsage = certificate.getExtension(KeyUsagesExtension);
    if (keyUsage && !hasKeyUsageFlag(keyUsage.usages, KeyUsageFlags.keyCertSign)) {
      return false;
    }
  }

  return true;
}

async function verifyTpmAkCertificateChain(
  envelope: TpmEnvelope,
  decoded: DecodedTpmEnvelope,
  options: AttestationVerifierOptions,
): Promise<boolean> {
  const trustedRootSet = normalizeTrustedRootSet(options.tpmAkTrustedRootSha256);
  if (trustedRootSet.size === 0) {
    // Fail closed: TPM trust must be anchored to configured AK roots.
    return false;
  }

  if (!envelope.certificateChainB64 || envelope.certificateChainB64.length < 2) {
    return false;
  }

  const certificateChain = await parseCertificateChain(envelope.certificateChainB64);
  if (!certificateChain) {
    return false;
  }

  const tpmAkPolicyValid = verifyTpmAkCertificatePolicy(certificateChain);
  if (!tpmAkPolicyValid) {
    return false;
  }

  const chainTrusted = await verifyCertificateChainAgainstTrustedRoot(
    certificateChain,
    trustedRootSet,
    options.now ?? new Date(),
  );
  if (!chainTrusted) {
    return false;
  }

  const keyMatchesLeaf = await verifyReportedTpmPublicKeyMatchesLeafCertificate(
    decoded,
    certificateChain[0],
  );
  if (!keyMatchesLeaf) {
    return false;
  }

  return verifyTpmQuoteSignatureWithLeafCertificate(decoded, certificateChain[0]);
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
  attestationFormat?: string,
): Promise<boolean> {
  const nonceBytes = new TextEncoder().encode(nonce);

  if (attestationFormat === "tpm2_quote_rsassa_sha256_v1") {
    const nonceDigest = await sha256Bytes(nonceBytes);
    return bytesEqual(extraData, nonceDigest);
  }

  if (bytesEqual(extraData, nonceBytes)) {
    return true;
  }

  const nonceDigest = await sha256Bytes(nonceBytes);
  return bytesEqual(extraData, nonceDigest);
}

async function verifyTpmAttestation(
  report: AttestationReport,
  nonce: string,
  options: AttestationVerifierOptions,
): Promise<boolean> {
  const normalizedFormat = report.attestation_format?.trim();
  if (
    normalizedFormat &&
    normalizedFormat !== "tpm2_quote_rsassa_sha256_v1"
  ) {
    return false;
  }

  const envelope = resolveTpmEnvelope(report);
  if (!envelope) return false;

  const decoded = decodeTpmEnvelopePayload(envelope);
  if (!decoded) {
    return false;
  }

  const extraData = parseTpmsAttestExtraData(decoded.quoteBytes);
  if (!extraData) {
    return false;
  }

  const nonceBound = await verifyNonceBinding(
    extraData,
    nonce,
    report.attestation_format,
  );
  if (!nonceBound) {
    return false;
  }

  return verifyTpmAkCertificateChain(envelope, decoded, options);
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
    attestationValid = await verifyTpmAttestation(report, nonce, options);
  }

  return {
    attestation_level: report.attestation_level,
    attestation_valid: attestationValid,
    environment_flags: toEnvironmentFlags(report),
    schema_fingerprint_valid: schemaFingerprintValid,
  };
}
