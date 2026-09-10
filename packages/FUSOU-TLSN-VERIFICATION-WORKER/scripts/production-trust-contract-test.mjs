#!/usr/bin/env node

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  appConfigTomlFromManifest,
  assertNotaryRegistryConsistency,
  assertPublicManifest,
  assertRequiredProductionSecrets,
  assertSessionAuthorityIdentity,
  buildProductionPublicManifest,
} from "./production-trust-contract.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const workflowPath = resolve(packageDirectory, "../../.github/workflows/tlsn-production-deploy.yml");
const workflow = await readFile(workflowPath, "utf8");

const notaryKeyId = "notary-production-2026";
const notaryVerifyingKey = Buffer.from("synthetic-notary-public-key").toString("base64url");
const notaryRegistryRaw = JSON.stringify({ [notaryKeyId]: notaryVerifyingKey });
const { publicKey: sessionPublicKey, privateKey: sessionPrivateKey } = generateKeyPairSync("ed25519");
const sessionPublicKeySpki = sessionPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const sessionPrivateKeyPkcs8 = sessionPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const sessionKeyId = "session-production-2026";
const sessionRegistryRaw = JSON.stringify({
  schema_version: 1,
  scope: "tlsn-session-authority-key-registry",
  keys: [{
    key_id: sessionKeyId,
    public_key_spki: sessionPublicKeySpki,
    status: "ACTIVE",
    not_before: new Date(Date.now() - 60_000).toISOString(),
    not_after: null,
  }],
});
const validManifest = buildProductionPublicManifest({
  notaryEndpoint: "notary.example.com:7047",
  notaryKeyId,
  notaryRegistryRaw,
  sessionAuthorityEndpoint: "https://worker.example.com/attestation/session",
  sessionAuthorityKeyId: sessionKeyId,
  sessionAuthorityPublicKeySpki: sessionPublicKeySpki,
  sessionAuthorityKeyRegistryRaw: sessionRegistryRaw,
  verificationEndpoint: "https://worker.example.com/verify/tlsn",
  serverIdentity: "game.example.com",
  trustRootCertificateDer: "MIIDHTCCAgWgAwIBAgIURFLGpUM33H6qfikrMs9kAcoFXeAwDQYJKoZIhvcNAQELBQAwHjEcMBoGA1UEAwwTc3ludGhldGljLXJvb3QudGVzdDAeFw0yNjA5MTAxMDI1NTZaFw0yNjA5MTExMDI1NTZaMB4xHDAaBgNVBAMME3N5bnRoZXRpYy1yb290LnRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC18xeL1tLhMKNSDiGanvSR7FXt-CCAfEF60IWNN_hglz-0PA4JK-HWECRX0j3ojTsnyzGV6ZDNo5lEHB77_VyXYyx2Y5R28XbUOb0xGHbsYbiW4U_EzzUZj_0PHIHTQb_MLj_zAC8mqRaV3vHdkVI47nItFrZ2Rm1D3plOkcnBBKcrNxg9s3AnCTwjKPbt_P_5E44MMzOreDgvxtTlqZbUZn_6sHLXJlGHIX4zsNFF_K3x4Oy1cy7IpQbKZ5UNcR9H8zI2Q4hJJdHIJxd6rWWy_rtGNmyfYkDD4fEh-bD8qouy3LQ9PRfTfQrtgNc7DQed0l4Ixj36krAVCunZ0cxZAgMBAAGjUzBRMB0GA1UdDgQWBBRbvwVkpyDft-BSPr0wEm-4GBiwrjAfBgNVHSMEGDAWgBRbvwVkpyDft-BSPr0wEm-4GBiwrjAPBgNVHRMBAf8EBTADAQH_MA0GCSqGSIb3DQEBCwUAA4IBAQAUusLzQLfde1UR_BVsN9g3eI9zV05tlLkRbTz1RmHBqp1Yjwc7_MpjWy1a8nl6JZY4KgfBlomu8NnhDtmRcN7m2smPOTHyEi8mMZdl44N22ZAZAl77hZXWTzb3mLBrbgw72J44tsZDPPx3kT1SJ9saxSPm3Q23ZbycIdLcDhPhFj3TEKdX4gmV0r3BBA9K9qmmJrwO_fqu8-dUfAObbEIX2-o8EYEyXaicIm-ob7UonkrZebJuh7yMkNQTwZnj21ONAJ0ubp4hd49KQCDtqDr-yFjPoxZPfUh6jgEM4EhVr0Wq8M56q_Sz2cz4dcd6CeoL91rPyTo6n7U55fKH_vCv",
  originPort: 443,
});

assert.doesNotThrow(() => assertNotaryRegistryConsistency({
  sourceRegistryRaw: notaryRegistryRaw,
  workerRegistryRaw: notaryRegistryRaw,
  evidenceRegistryRaw: notaryRegistryRaw,
  keyId: notaryKeyId,
  appVerifyingKey: notaryVerifyingKey,
}));

assert.throws(() => assertNotaryRegistryConsistency({
  sourceRegistryRaw: notaryRegistryRaw,
  workerRegistryRaw: JSON.stringify({ [notaryKeyId]: Buffer.from("different-worker-key").toString("base64url") }),
  evidenceRegistryRaw: notaryRegistryRaw,
  keyId: notaryKeyId,
  appVerifyingKey: notaryVerifyingKey,
}), /Worker Notary registry/);

assert.throws(() => assertNotaryRegistryConsistency({
  sourceRegistryRaw: notaryRegistryRaw,
  workerRegistryRaw: notaryRegistryRaw,
  evidenceRegistryRaw: JSON.stringify({ [notaryKeyId]: Buffer.from("different-evidence-key").toString("base64url") }),
  keyId: notaryKeyId,
  appVerifyingKey: notaryVerifyingKey,
}), /Evidence Notary registry/);

assert.throws(() => assertNotaryRegistryConsistency({
  sourceRegistryRaw: notaryRegistryRaw,
  keyId: notaryKeyId,
  appVerifyingKey: Buffer.from("different-app-key").toString("base64url"),
}), /APP Notary verifying key/);

assert.throws(() => assertSessionAuthorityIdentity({
  registry: sessionRegistryRaw,
  keyId: sessionKeyId,
  publicKeySpki: sessionPublicKeySpki.slice(0, -1) + (sessionPublicKeySpki.endsWith("A") ? "B" : "A"),
}), /published registry key/);

assert.throws(() => assertRequiredProductionSecrets({}, [
  "TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
]), /required production secrets are missing/);
assert.equal(typeof sessionPrivateKeyPkcs8, "string");

assert.doesNotThrow(() => assertPublicManifest(validManifest));
const manifestWithInvalidTrustRoot = structuredClone(validManifest);
manifestWithInvalidTrustRoot.origin.trust_roots = [Buffer.from("not-a-certificate").toString("base64url")];
assert.throws(() => assertPublicManifest(manifestWithInvalidTrustRoot), /DER X\.509 certificate/);
const manifestWithPrivateField = structuredClone(validManifest);
manifestWithPrivateField.session_authority.signing_private_key_pkcs8 = "must-never-be-published";
assert.throws(() => assertPublicManifest(manifestWithPrivateField), /outside the public manifest schema/);
assert.doesNotMatch(appConfigTomlFromManifest(validManifest, "/local/tlsn-artifacts"), /private|secret|token/i);

const productionJob = workflow.slice(workflow.indexOf("\n  production:"));
for (const name of [
  "TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
  "TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID",
  "TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY",
  "TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI",
  "TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID",
  "TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY",
]) {
  assert.match(productionJob, new RegExp(name));
}

console.log("[tlsn-production-trust-contract] registry, authority, workflow-secret, and public-manifest cases PASS");
