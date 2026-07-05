#!/usr/bin/env node
/**
 * test-tpm-attestation-e2e.mjs
 *
 * End-to-end attestation verification test:
 * 1. Fetches the attestation config from the production server
 * 2. Simulates the TPM report structure using real TPM data (quote + cert chain from config)
 * 3. Calls the server's verifyAttestation() directly with the real data
 * 4. Reports whether the attestation would produce hw_verified
 *
 * Usage: dotenvx run ... -- node scripts/test-tpm-attestation-e2e.mjs --quote-b64 <> --sig-b64 <> --pub-b64 <>
 * Or via: pnpm run test-attestation-e2e
 */

import "reflect-metadata";
import { createHash } from "crypto";
import { verifyAttestation } from "../src/server/utils/attestation-verifier.ts";

// ── fetch real config from server ────────────────────────────────────────────
const CONFIG_URL = "https://fusou.dev/api/attestation/config";
const configResp = await fetch(CONFIG_URL);
if (!configResp.ok) {
  console.error(`Failed to fetch config: ${configResp.status}`);
  process.exit(1);
}
const config = await configResp.json();
const signature = configResp.headers.get("X-FUSOU-Config-Signature");
console.log("[config] version:", config.version, "chain_len:", config.tpm?.ak_cert_chain_b64?.length);

// ── build attestation report from stdin args ─────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, arr) => {
    if (v.startsWith("--")) acc.push([v.replace("--", ""), arr[i + 1]]);
    return acc;
  }, []),
);

if (!args["quote-b64"] || !args["sig-b64"] || !args["pub-b64"]) {
  console.error("Required: --quote-b64 --sig-b64 --pub-b64 --nonce");
  process.exit(1);
}

const report = {
  attestation_level: "tpm",
  attestation_data: args["quote-b64"],
  attestation_signature: args["sig-b64"],
  public_key: args["pub-b64"],
  attestation_format: "tpm2_quote_rsassa_sha256_v1",
  certificate_chain: config.tpm?.ak_cert_chain_b64 ?? [],
  fingerprint: {
    cpu_brand: "Test CPU",
    cpu_cores: 4,
    total_memory_mb: 16384,
    os_name: "Linux",
    os_version: "Ubuntu 24.04",
    hostname_hash: "test",
    machine_id_hash: "abcdef1234567890",
  },
  environment: {
    environment_type: "Native",
    debugger_attached: false,
    hooks_detected: [],
  },
};

const nonce = args.nonce ?? "test-nonce";

// ── load trusted roots ────────────────────────────────────────────────────────
// For test: use the FUSOU CA SHA256 we know
const FUSOU_CA_SHA256 = "ceee658bdd5591cb707444f6c50a810c3ecf85c40d591f015e5e2f0e4b1f13d3";
const options = {
  tpmAkTrustedRootSha256: [FUSOU_CA_SHA256],
  now: new Date(),
};

console.log("[test] Verifying attestation report...");
console.log("[test] nonce:", nonce);
console.log("[test] certificate_chain length:", report.certificate_chain.length);

const trustInput = await verifyAttestation(report, nonce, options);
console.log("\n=== Trust Input ===");
console.log(JSON.stringify(trustInput, null, 2));

if (trustInput.attestation_valid) {
  console.log("\n✅ ATTESTATION VALID - would produce hw_verified");
} else {
  console.log("\n❌ ATTESTATION INVALID - would not produce hw_verified");
  console.log("attestation_level:", trustInput.attestation_level);
}
