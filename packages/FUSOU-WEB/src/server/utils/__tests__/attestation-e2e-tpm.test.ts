import "reflect-metadata";
import { readFileSync } from "fs";
import * as x509 from "@peculiar/x509";
import { describe, expect, it } from "vitest";
import { verifyAttestation, type AttestationReport } from "../attestation-verifier";
import { determineTrustTag } from "../trust-tag";

/**
 * E2E attestation verification test using REAL TPM data.
 * Prerequisites:
 *   1. cargo test export_tpm_attestation_json -- --nocapture --ignored
 *      (writes /tmp/tpm_quote_e2e.json)
 *   2. The server ATTESTATION_CONFIG_JSON must include the AK cert chain (version 4)
 */

const FUSOU_CA_SHA256 = "ceee658bdd5591cb707444f6c50a810c3ecf85c40d591f015e5e2f0e4b1f13d3";

function loadTpmQuoteData(): {
  quote_b64: string;
  sig_b64: string;
  pub_key_b64: string;
  nonce: string;
} {
  const raw = readFileSync("/tmp/tpm_quote_e2e.json", "utf-8");
  return JSON.parse(raw);
}

async function fetchAkCertChain(): Promise<string[]> {
  // Use real AMD EK certs (fetched earlier) + AK pub from TPM quote
  const tpmData = loadTpmQuoteData();
  const ekCert = readFileSync("/tmp/ek_cert.der").toString("base64");
  const amdInt = readFileSync("/tmp/amd_intermediate_ca.der").toString("base64");
  const amdRoot = readFileSync("/tmp/amd_root_ca.der").toString("base64");

  const resp = await fetch("https://fusou.dev/api/attestation/ak-cert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ek_cert_chain_b64: [ekCert, amdInt, amdRoot],
      ak_pub_b64: tpmData.pub_key_b64,
    }),
  });
  if (!resp.ok) throw new Error(`Privacy CA returned ${resp.status}`);
  const data = await resp.json() as { ak_cert_chain_b64?: string[]; expires_at?: string };
  const chain = data?.ak_cert_chain_b64;
  if (!chain || chain.length < 2) {
    throw new Error(`Privacy CA returned invalid chain (len=${chain?.length ?? 0})`);
  }
  console.log("Got AK cert chain from Privacy CA, expires:", data.expires_at);
  return chain;
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return Buffer.from(new Uint8Array(digest)).toString("hex");
}

const PRIVACY_CA_SHA256 = "c231036b9e66526a660143d1c24390044b1fa2888fdd31b461b7878270c110cd";

describe("TPM attestation E2E verification (Privacy CA + AMD EK chain)", () => {
  it("diagnoses each step of TPM attestation chain verification", async () => {
    const tpmData = loadTpmQuoteData();
    const certChain = await fetchAkCertChain();

    console.log("\n--- TPM E2E Diagnostics ---");
    console.log("nonce:", tpmData.nonce);
    console.log("cert_chain_len:", certChain.length);

    // 1. Parse certs
    const leafCert = new x509.X509Certificate(toArrayBuffer(base64ToBytes(certChain[0])));
    const caCert = new x509.X509Certificate(toArrayBuffer(base64ToBytes(certChain[1])));
    console.log("leaf cert subject:", leafCert.subject);
    console.log("leaf cert notBefore:", leafCert.notBefore);
    console.log("leaf cert notAfter:", leafCert.notAfter);
    console.log("ca cert subject:", caCert.subject);
    const now = new Date();
    console.log("now:", now);
    console.log("leaf valid now:", now >= leafCert.notBefore && now <= leafCert.notAfter);
    console.log("ca valid now:", now >= caCert.notBefore && now <= caCert.notAfter);

    // 2. Verify chain
    const leafVerified = await leafCert.verify({ publicKey: caCert.publicKey });
    console.log("leaf signed by CA:", leafVerified);
    const caSelfsigned = await caCert.verify({ publicKey: caCert.publicKey });
    console.log("CA self-signed:", caSelfsigned);

    // 3. Root hash
    const rootHash = await sha256Hex(new Uint8Array(caCert.rawData));
    console.log("CA SHA-256:", rootHash);
    console.log("Expected:", FUSOU_CA_SHA256);
    console.log("Hash match:", rootHash === FUSOU_CA_SHA256);

    // 4. Check leaf ext
    const leafBasicConstraints = leafCert.getExtension(x509.BasicConstraintsExtension);
    const leafKeyUsage = leafCert.getExtension(x509.KeyUsagesExtension);
    const leafEku = leafCert.getExtension(x509.ExtendedKeyUsageExtension);
    console.log("leafBasicConstraints.ca:", leafBasicConstraints?.ca);
    console.log("leafKeyUsage present:", !!leafKeyUsage);
    console.log("leafEku usages:", leafEku?.usages);

    // 5. Check public key match (via AsnParser)
    const { AsnParser, AsnSerializer } = await import("@peculiar/asn1-schema");
    const { Certificate } = await import("@peculiar/asn1-x509");
    const reportPubKeyBytes = base64ToBytes(tpmData.pub_key_b64);
    const leafAsn = AsnParser.parse(new Uint8Array(leafCert.rawData), Certificate);
    const leafSpki = new Uint8Array(AsnSerializer.serialize(leafAsn.tbsCertificate.subjectPublicKeyInfo));
    const pubKeyMatch = Buffer.from(reportPubKeyBytes).equals(Buffer.from(leafSpki));
    console.log("pub_key_b64 len:", reportPubKeyBytes.length, "leaf SPKI len:", leafSpki.length);
    console.log("Public key match:", pubKeyMatch);

    // 6. Full verification
    const report: AttestationReport = {
      attestation_level: "tpm",
      attestation_data: tpmData.quote_b64,
      attestation_signature: tpmData.sig_b64,
      public_key: tpmData.pub_key_b64,
      attestation_format: "tpm2_quote_rsassa_sha256_v1",
      certificate_chain: certChain,
      fingerprint: {
        cpu_brand: "Test CPU",
        cpu_cores: 4,
        total_memory_mb: 16384,
        os_name: "Linux",
        os_version: "Ubuntu 24.04",
        hostname_hash: "a".repeat(16),
        machine_id_hash: "b".repeat(16),
      },
      environment: {
        environment_type: "Native",
        debugger_attached: false,
        hooks_detected: [],
      },
    };

    const trustInput = await verifyAttestation(report, tpmData.nonce, {
      tpmAkTrustedRootSha256: [PRIVACY_CA_SHA256],
      now,
    });

    console.log("\n--- Result ---");
    console.log("attestation_level:", trustInput.attestation_level);
    console.log("attestation_valid:", trustInput.attestation_valid);
    console.log("schema_fingerprint_valid:", trustInput.schema_fingerprint_valid);

    expect(trustInput.attestation_level).toBe("tpm");
    expect(trustInput.schema_fingerprint_valid).toBe(true);
    expect(trustInput.attestation_valid).toBe(true);

    const trustTag = determineTrustTag(trustInput);
    console.log("trust_tag:", trustTag);
    expect(trustTag).toBe("hw_verified");
  }, 30_000);
});
