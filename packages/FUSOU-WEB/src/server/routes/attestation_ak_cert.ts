/**
 * Privacy CA endpoint: POST /attestation/ak-cert  (two-step flow)
 *
 * Step 1 – POST /attestation/ak-cert/challenge
 *   Input:  { ek_cert_chain_b64, ek_pub_b64, ak_pub_b64, ak_name_b64 }
 *   Action: Verify EK chain, run MakeCredential, return challenge blob
 *   Output: { challenge_id, credential_blob_b64, encrypted_seed_b64 }
 *
 * Step 2 – POST /attestation/ak-cert/complete
 *   Input:  { challenge_id, plaintext_b64 }   (plaintext from TPM ActivateCredential)
 *   Action: Verify plaintext matches original challenge, issue AK cert
 *   Output: { ak_cert_chain_b64, expires_at }
 *
 * Security:
 * - EK cert chain must trace to a trusted manufacturer root (AMD, Intel, Infineon…)
 * - MakeCredential mathematically proves AK and EK reside in the SAME physical TPM
 *   (only the TPM with the EK private key can decrypt the credential blob, and
 *    only when the AK name matches the supplied name)
 * - AK certs valid for 7 days; challenge tokens valid for 5 minutes
 */

import "reflect-metadata";
import * as x509 from "@peculiar/x509";
import { resolveAttestationTrustedRoots } from "../utils/attestation-trusted-roots";
import { makeCredential, validateAkName } from "../utils/attestation-make-credential";
import type { Bindings } from "../types";
import type { Context } from "hono";

const PRIVACY_CA_CERT_DER_B64 =
  "MIIBoDCCAUagAwIBAgIBATAKBggqhkjOPQQDAjBHMSgwJgYDVQQDEx9GVVNPVSBBdHRlc3RhdGlvbiBQcml2YWN5IENBIHYxMQ4wDAYDVQQKEwVGVVNPVTELMAkGA1UEBhMCSlAwHhcNMjYwNjAxMDAwMDAwWhcNMzAwMTAxMDAwMDAwWjBHMSgwJgYDVQQDEx9GVVNPVSBBdHRlc3RhdGlvbiBQcml2YWN5IENBIHYxMQ4wDAYDVQQKEwVGVVNPVTELMAkGA1UEBhMCSlAwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASQzTBXoO2KX0jTZn8HKXennF+VsbXlTVuN99RDge9XGMzZFH1i1q5q1UBeSKmA0voN6MfAvScaknxrLx0CNzeyoyMwITAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAKBggqhkjOPQQDAgNIADBFAiEAjWQl4RJ/5kBlDFQkN/yMJ7bb9O0ytOGOtEtBY9+PLQ0CIEZKIJXUVIaTP82Sv8VNtX6YleSK+pXXrmr1nXf0dDQK";

const AK_CERT_VALIDITY_DAYS = 7;
const MAX_EK_CHAIN_LENGTH = 8;
// Each DER cert base64 should be <= 16 KiB
const MAX_EK_CERT_B64_BYTES = 16 * 1024;
const MAX_AK_PUB_B64_BYTES = 4 * 1024;
const CHALLENGE_TTL_SECONDS = 300; // 5 minutes
const CHALLENGE_KEY_PREFIX = "ak-cert-challenge:";

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64.trim(), "base64"));
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", buf as unknown as BufferSource);
  return Buffer.from(new Uint8Array(digest)).toString("hex");
}

async function loadPrivacyCaKey(
  c: Context<{ Bindings: Bindings }>,
): Promise<CryptoKey | null> {
  const jwkStr = ((c.env as unknown as Record<string, string | undefined>)["ATTESTATION_PRIVACY_CA_PRIVATE_KEY_JWK"]) ?? "";
  if (!jwkStr.trim()) return null;
  try {
    const jwk = JSON.parse(jwkStr) as JsonWebKey;
    return await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
  } catch {
    return null;
  }
}

async function verifyCertChainAgainstRoots(
  chain: x509.X509Certificate[],
  trustedRootSha256: string[],
  now: Date,
): Promise<boolean> {
  if (chain.length < 1 || chain.length > MAX_EK_CHAIN_LENGTH) return false;
  if (trustedRootSha256.length === 0) return false;

  // All certs must be within validity period.
  for (const cert of chain) {
    if (now < cert.notBefore || now > cert.notAfter) return false;
  }

  // Verify chain signatures: chain[i] signed by chain[i+1]
  for (let i = 0; i < chain.length - 1; i++) {
    const child = chain[i];
    const issuer = chain[i + 1];
    const ok = await child.verify({ publicKey: issuer.publicKey });
    if (!ok) return false;
  }

  // Root must be self-signed
  const root = chain[chain.length - 1];
  const rootSelfSigned = await root.verify({ publicKey: root.publicKey });
  if (!rootSelfSigned) return false;

  // Root SHA-256 must be in trusted set
  const rootHash = await sha256Hex(new Uint8Array(root.rawData));
  return trustedRootSha256.includes(rootHash);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function resolveKvStore(c: Context<{ Bindings: Bindings }>): KVNamespace | null {
  return (
    ((c as any)?.env?.DATA_LOADER_CACHE_KV as KVNamespace | undefined) ?? null
  );
}

async function storeChallenge(
  c: Context<{ Bindings: Bindings }>,
  challengeId: string,
  data: {
    challenge_b64: string;
    ak_pub_b64: string;
    ek_serial: string;
    ek_root_sha256: string;
  },
): Promise<boolean> {
  const kv = resolveKvStore(c);
  if (!kv) return false;
  await kv.put(
    `${CHALLENGE_KEY_PREFIX}${challengeId}`,
    JSON.stringify(data),
    { expirationTtl: CHALLENGE_TTL_SECONDS },
  );
  return true;
}

async function consumeChallenge(
  c: Context<{ Bindings: Bindings }>,
  challengeId: string,
): Promise<{ challenge_b64: string; ak_pub_b64: string; ek_serial: string; ek_root_sha256: string } | null> {
  const kv = resolveKvStore(c);
  if (!kv) return null;
  const key = `${CHALLENGE_KEY_PREFIX}${challengeId}`;
  const raw = await kv.get(key);
  if (!raw) return null;
  // Delete immediately to prevent replay.
  await kv.delete(key);
  try {
    return JSON.parse(raw) as ReturnType<typeof consumeChallenge> extends Promise<infer T> ? NonNullable<T> : never;
  } catch {
    return null;
  }
}

// ── Step 1: Issue MakeCredential challenge ────────────────────────────────────

/**
 * POST /attestation/ak-cert/challenge
 * Input: { ek_cert_chain_b64, ek_pub_b64, ak_pub_b64, ak_name_b64 }
 * Output: { challenge_id, credential_blob_b64, encrypted_seed_b64 }
 */
export async function handleAttestationAkCertChallenge(
  c: Context<{ Bindings: Bindings }>,
): Promise<Response> {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  if (!body || typeof body !== "object") return c.json({ error: "body must be object" }, 400);

  const { ek_cert_chain_b64, ek_pub_b64, ak_pub_b64, ak_name_b64 } =
    body as Record<string, unknown>;

  // ── Input validation ──
  if (!Array.isArray(ek_cert_chain_b64) || ek_cert_chain_b64.length < 2 || ek_cert_chain_b64.length > MAX_EK_CHAIN_LENGTH)
    return c.json({ error: "ek_cert_chain_b64 must be 2-8 items" }, 400);

  for (const entry of ek_cert_chain_b64 as unknown[]) {
    if (typeof entry !== "string" || entry.length > MAX_EK_CERT_B64_BYTES)
      return c.json({ error: "ek_cert_chain_b64 entry exceeds max size" }, 400);
  }
  if (typeof ak_pub_b64 !== "string" || !ak_pub_b64.trim() || ak_pub_b64.length > MAX_AK_PUB_B64_BYTES)
    return c.json({ error: "ak_pub_b64 required and <= 4KiB" }, 400);
  if (typeof ek_pub_b64 !== "string" || !ek_pub_b64.trim() || ek_pub_b64.length > MAX_AK_PUB_B64_BYTES)
    return c.json({ error: "ek_pub_b64 required and <= 4KiB" }, 400);
  if (typeof ak_name_b64 !== "string" || !ak_name_b64.trim())
    return c.json({ error: "ak_name_b64 (TPM AK name) required" }, 400);

  const akNameBytes = base64ToBytes(ak_name_b64);
  if (!validateAkName(akNameBytes))
    return c.json({ error: "ak_name_b64 must be 34 bytes: 0x000B || SHA256(TPMT_PUBLIC)" }, 400);

  // ── Parse and verify EK certificate chain ──
  let ekChain: x509.X509Certificate[];
  try {
    ekChain = (ek_cert_chain_b64 as string[]).map(
      (b) => new x509.X509Certificate(bytesToArrayBuffer(base64ToBytes(b))),
    );
  } catch { return c.json({ error: "failed to parse ek_cert_chain_b64" }, 400); }

  const now = new Date();
  const { tpmAkTrustedRoots } = await resolveAttestationTrustedRoots(c);
  const ekChainValid = await verifyCertChainAgainstRoots(ekChain, tpmAkTrustedRoots, now);
  if (!ekChainValid)
    return c.json({ error: "ek_cert_chain_verification_failed", reason: "EK chain does not trace to trusted manufacturer root" }, 401);

  // ── Run MakeCredential ──
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const ekPubDer = base64ToBytes(ek_pub_b64);

  let credentialBlob: Uint8Array;
  let encryptedSeed: Uint8Array;
  try {
    ({ credentialBlob, encryptedSeed } = await makeCredential(ekPubDer, challenge, akNameBytes));
  } catch (e) {
    console.error("[ak-cert] MakeCredential failed:", e);
    return c.json({ error: "make_credential_failed" }, 500);
  }

  // ── Store challenge for step 2 ──
  const challengeId = crypto.randomUUID();
  const ekLeafCert = ekChain[0];
  const ekRootCert = ekChain[ekChain.length - 1];
  const ekRootHash = await sha256Hex(new Uint8Array(ekRootCert.rawData));

  const stored = await storeChallenge(c, challengeId, {
    challenge_b64: Buffer.from(challenge).toString("base64"),
    ak_pub_b64: ak_pub_b64 as string,
    ek_serial: ekLeafCert.serialNumber,
    ek_root_sha256: ekRootHash,
  });
  if (!stored)
    return c.json({ error: "challenge_storage_unavailable" }, 503);

  console.info("[ak-cert] challenge issued", {
    challenge_id: challengeId,
    ek_root_sha256: ekRootHash,
    ek_serial: ekLeafCert.serialNumber,
  });

  return c.json({
    challenge_id: challengeId,
    credential_blob_b64: Buffer.from(credentialBlob).toString("base64"),
    encrypted_seed_b64: Buffer.from(encryptedSeed).toString("base64"),
    expires_in_seconds: CHALLENGE_TTL_SECONDS,
  });
}

// ── Step 2: Verify ActivateCredential result and issue AK cert ─────────────────

/**
 * POST /attestation/ak-cert/complete
 * Input: { challenge_id, plaintext_b64 }
 * Output: { ak_cert_chain_b64, expires_at }
 */
export async function handleAttestationAkCertComplete(
  c: Context<{ Bindings: Bindings }>,
): Promise<Response> {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  if (!body || typeof body !== "object") return c.json({ error: "body must be object" }, 400);

  const { challenge_id, plaintext_b64 } = body as Record<string, unknown>;
  if (typeof challenge_id !== "string" || !challenge_id.trim())
    return c.json({ error: "challenge_id required" }, 400);
  if (typeof plaintext_b64 !== "string" || !plaintext_b64.trim())
    return c.json({ error: "plaintext_b64 required" }, 400);

  // ── Retrieve and consume the challenge (one-time use) ──
  const stored = await consumeChallenge(c, challenge_id);
  if (!stored)
    return c.json({ error: "challenge_not_found_or_expired" }, 401);

  // ── Verify ActivateCredential output matches the original challenge ──
  const expectedChallenge = base64ToBytes(stored.challenge_b64);
  const actualPlaintext = base64ToBytes(plaintext_b64);

  if (expectedChallenge.length !== actualPlaintext.length)
    return c.json({ error: "activate_credential_failed: length mismatch" }, 401);

  // Constant-time comparison to prevent timing attacks
  let diff = 0;
  for (let i = 0; i < expectedChallenge.length; i++) {
    diff |= expectedChallenge[i] ^ actualPlaintext[i];
  }
  if (diff !== 0) {
    console.warn("[ak-cert] ActivateCredential verification failed", { challenge_id });
    return c.json({ error: "activate_credential_failed: plaintext mismatch" }, 401);
  }

  // ── Issue AK certificate ──
  const caPrivKey = await loadPrivacyCaKey(c);
  if (!caPrivKey) {
    console.error("[ak-cert] Privacy CA key not configured");
    return c.json({ error: "privacy_ca_unconfigured" }, 503);
  }

  const caCert = new x509.X509Certificate(
    bytesToArrayBuffer(base64ToBytes(PRIVACY_CA_CERT_DER_B64)),
  );

  let akPublicKey: CryptoKey;
  try {
    const akPubDer = base64ToBytes(stored.ak_pub_b64);
    akPublicKey = await crypto.subtle.importKey(
      "spki",
      bytesToArrayBuffer(akPubDer),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      true,
      ["verify"],
    );
  } catch { return c.json({ error: "failed to import ak_pub_b64" }, 400); }

  const now = new Date();
  const serial = Date.now().toString(16).padStart(16, "0");
  const notBefore = new Date(now);
  const notAfter = new Date(now);
  notAfter.setDate(notAfter.getDate() + AK_CERT_VALIDITY_DAYS);

  // Subject binds the AK cert to the EK serial for audit trail.
  const ekSerialShort = stored.ek_serial.replace(/\s/g, "").toLowerCase().slice(0, 32);
  const subject = `CN=FUSOU-AK-${ekSerialShort}, O=FUSOU, C=JP`;
  const TPM_AIK_EKU_OID = "2.23.133.8.3";

  const akCert = await x509.X509CertificateGenerator.create({
    serialNumber: serial,
    subject,
    issuer: caCert.subject,
    notBefore,
    notAfter,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    publicKey: akPublicKey,
    signingKey: caPrivKey,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([TPM_AIK_EKU_OID], true),
    ],
  });

  const akCertDerB64 = Buffer.from(akCert.rawData).toString("base64");

  console.info("[ak-cert] AK cert issued (ActivateCredential verified)", {
    serial,
    ek_serial: stored.ek_serial,
    ek_root_sha256: stored.ek_root_sha256,
    ak_not_after: notAfter.toISOString(),
  });

  return c.json({
    ak_cert_chain_b64: [akCertDerB64, PRIVACY_CA_CERT_DER_B64],
    expires_at: notAfter.toISOString(),
  });
}

// ── Legacy single-step endpoint (kept for backward compat) ───────────────────
export async function handleAttestationAkCert(
  c: Context<{ Bindings: Bindings }>,
): Promise<Response> {
  return c.json({ error: "use_two_step_flow", challenge_endpoint: "/attestation/ak-cert/challenge", complete_endpoint: "/attestation/ak-cert/complete" }, 410);
}
