#!/usr/bin/env node
/**
 * generate-fusou-ak-cert.mjs
 *
 * Generates a TPM AK leaf certificate signed by the FUSOU CA, then:
 *   1. Prints the DER base64 of [AK cert, FUSOU CA cert] (the chain for ATTESTATION_CONFIG_JSON)
 *   2. Prints the FUSOU CA DER SHA-256 hash (to register in trusted roots)
 *
 * Usage:
 *   node scripts/generate-fusou-ak-cert.mjs --ak-pub-b64 <SPKI DER base64>
 */

import "reflect-metadata";
import { readFileSync } from "fs";
import { createHash } from "crypto";
import {
  X509CertificateGenerator,
  X509Certificate,
  KeyUsagesExtension,
  ExtendedKeyUsageExtension,
  BasicConstraintsExtension,
  KeyUsageFlags,
} from "@peculiar/x509";

// Node 18+ has globalThis.crypto built in — no polyfill needed.

// ── parse args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
}

const akPubB64 = getArg("--ak-pub-b64");
if (!akPubB64) {
  console.error("Usage: node generate-fusou-ak-cert.mjs --ak-pub-b64 <SPKI DER base64>");
  process.exit(1);
}

// ── PEM → DER helper ──────────────────────────────────────────────────────────
function pemToDer(pem) {
  const b64 = pem
    .replace(/-----BEGIN[^-]+-----/, "")
    .replace(/-----END[^-]+-----/, "")
    .replace(/\s+/g, "");
  return Buffer.from(b64, "base64");
}

// ── load FUSOU CA cert + key ──────────────────────────────────────────────────
const CA_CERT_PATH = new URL(
  "../../FUSOU-APP/src-tauri/roaming/ca/fusou_ca_cert.pem",
  import.meta.url,
).pathname;
const CA_KEY_PATH = new URL(
  "../../FUSOU-APP/src-tauri/roaming/ca/fusou_ca_key.pem",
  import.meta.url,
).pathname;

const caCertPem = readFileSync(CA_CERT_PATH, "utf-8");
const caKeyPem = readFileSync(CA_KEY_PATH, "utf-8");
const caCertDer = pemToDer(caCertPem);
const caKeyDer = pemToDer(caKeyPem);

const caCertSha256 = createHash("sha256").update(caCertDer).digest("hex");
const caCert = new X509Certificate(caCertDer);

// Import ECDSA CA private key (P-256)
const caPrivateKey = await globalThis.crypto.subtle.importKey(
  "pkcs8",
  caKeyDer,
  { name: "ECDSA", namedCurve: "P-256" },
  false,
  ["sign"],
);

// ── import AK RSA-2048 public key (SPKI DER) ─────────────────────────────────
const akPubDer = Buffer.from(akPubB64.trim(), "base64");
const akPublicKey = await globalThis.crypto.subtle.importKey(
  "spki",
  akPubDer,
  { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  true,
  ["verify"],
);

// ── generate AK leaf certificate ─────────────────────────────────────────────
const TPM_AIK_EKU_OID = "2.23.133.8.3";

const akCert = await X509CertificateGenerator.create({
  serialNumber: "01",
  subject: "CN=FUSOU-TPM-AK, O=FUSOU, C=JP",
  issuer: caCert.subject,
  notBefore: new Date("2026-06-01T00:00:00Z"),
  notAfter: new Date("2028-07-05T00:00:00Z"),
  signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
  publicKey: akPublicKey,
  signingKey: caPrivateKey,
  extensions: [
    new BasicConstraintsExtension(false, undefined, true),
    new KeyUsagesExtension(KeyUsageFlags.digitalSignature, true),
    new ExtendedKeyUsageExtension([TPM_AIK_EKU_OID], true),
  ],
});

const akCertDer = Buffer.from(akCert.rawData);
const akCertB64 = akCertDer.toString("base64");
const caCertB64 = caCertDer.toString("base64");

console.log("\n=== AK Certificate (DER base64) ===");
console.log(akCertB64);
console.log("\n=== FUSOU CA Certificate (DER base64) ===");
console.log(caCertB64);
console.log("\n=== FUSOU CA SHA-256 (for trusted roots) ===");
console.log(caCertSha256);
console.log("\n=== JSON array for ak_cert_chain_b64 ===");
console.log(JSON.stringify([akCertB64, caCertB64]));
