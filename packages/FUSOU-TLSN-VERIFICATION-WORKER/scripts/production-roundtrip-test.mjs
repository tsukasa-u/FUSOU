#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertPublicManifest,
  notaryRegistrySha256,
} from "./production-trust-contract.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const repositoryDirectory = resolve(packageDirectory, "../..");
const appManifestPath = resolve(repositoryDirectory, "packages/FUSOU-APP/src-tauri/Cargo.toml");
const configTemplatePath = resolve(repositoryDirectory, "packages/configs/configs.toml");

function keyMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    publicKeySpki: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  };
}

function authorityRegistry(scope, keyId, publicKeySpki) {
  return JSON.stringify({
    schema_version: 1,
    scope,
    keys: [{
      key_id: keyId,
      public_key_spki: publicKeySpki,
      status: "ACTIVE",
      not_before: "2020-01-01T00:00:00.000Z",
      not_after: null,
    }],
  });
}

function run(command, argumentsList, options) {
  const result = spawnSync(command, argumentsList, {
    ...options,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit ${result.status}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function createRootCertificate(directory) {
  const keyPath = join(directory, "root-key.pem");
  const certificatePath = join(directory, "root.der");
  run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certificatePath,
    "-outform",
    "DER",
    "-days",
    "1",
    "-subj",
    "/CN=game.example.com",
  ], { cwd: directory });
  return readFile(certificatePath);
}

function generateAlpha15NotaryKeys() {
  const output = run("cargo", [
    "run",
    "--quiet",
    "--manifest-path",
    appManifestPath,
    "--features",
    "tlsn-production",
    "--example",
    "tlsn_alpha15_key",
    "--",
    "01".repeat(32),
    "02".repeat(32),
  ], {
    cwd: repositoryDirectory,
    env: { ...process.env, CARGO_NET_OFFLINE: "true" },
  });
  const keys = output.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(keys.length, 2);
  return keys;
}

function fullAppConfigFromFragment(template, fragment) {
  const fields = fragment
    .replace(/^\[proxy\]\n/, "")
    .trimEnd()
    .split("\n")
    .filter((line) => line.startsWith("tlsn_"));
  assert.equal(fields.length, 11);
  let result = template;
  for (const field of fields) {
    const name = field.slice(0, field.indexOf(" = "));
    const linePattern = new RegExp(`^${name} = .*?$`, "m");
    assert.match(result, linePattern, `config template is missing ${name}`);
    result = result.replace(linePattern, field);
  }
  return result;
}

const rootDirectory = await mkdtemp(join(tmpdir(), "fusou-tlsn-roundtrip-"));
try {
  const [alpha15K256NotaryKey, secondAlpha15K256NotaryKey] = generateAlpha15NotaryKeys();
  const rootCertificateDer = await createRootCertificate(rootDirectory);
  const result = keyMaterial();
  const session = keyMaterial();
  const binding = keyMaterial();
  const attestation = keyMaterial();
  const sessionKeyId = "session-production-roundtrip";
  const bindingKeyId = "binding-production-roundtrip";
  const resultKeyId = "result-production-roundtrip";
  const notaryRegistryRaw = JSON.stringify({
    "notary-production-2026": alpha15K256NotaryKey,
    "notary-production-2025": secondAlpha15K256NotaryKey,
  });
  const sessionRegistryRaw = authorityRegistry(
    "tlsn-session-authority-key-registry",
    sessionKeyId,
    session.publicKeySpki,
  );
  const bindingRegistryRaw = authorityRegistry(
    "tlsn-binding-authority-key-registry",
    bindingKeyId,
    binding.publicKeySpki,
  );
  const resultRegistryRaw = authorityRegistry(
    "tlsn-result-signing-key-registry",
    resultKeyId,
    result.publicKeySpki,
  );
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryDirectory,
    encoding: "utf8",
  }).trim();
  const reportPath = join(rootDirectory, "preflight.json");
  const provenancePath = join(rootDirectory, "provenance.json");
  const manifestPath = join(rootDirectory, "public-manifest.json");
  const fragmentPath = join(rootDirectory, "rendered-proxy-config.toml");
  const configPath = join(rootDirectory, "app-config.toml");
  const artifactPath = join(rootDirectory, "app-artifacts");
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    CARGO_NET_OFFLINE: "true",
    TLSN_ENVIRONMENT: "production",
    TLSN_DEPLOYMENT_ROLE: "production",
    TLSN_BINDING_TTL_SECONDS: "900",
    TLSN_GIT_COMMIT_SHA: commitSha,
    TLSN_CANDIDATE_SERVER_IDENTITY: "game.example.com",
    TLSN_CANDIDATE_PROFILE_SHA256: Buffer.alloc(32, 1).toString("base64url"),
    TLSN_CANDIDATE_VERIFIER_KEY_ID: "verifier-production-roundtrip",
    TLSN_CANDIDATE_NOTARY_KEY_ID: "notary-production-2026",
    TLSN_PRODUCTION_NOTARY_REGISTRY: notaryRegistryRaw,
    TLSN_CANDIDATE_DEVICE_AUTH_URL: "https://api.example.com/api/auth/anonymous-sync/v2/device-proof",
    TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL: "https://api.example.com/api/auth/anonymous-sync/v2/tlsn-device-proof",
    TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS: "api.example.com",
    TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS: "supabase.example.com",
    TLSN_CANDIDATE_SUPABASE_URL: "https://supabase.example.com/",
    TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable-key",
    TLSN_SECURITY_REGISTRY_SET_SHA256: Buffer.alloc(32, 2).toString("base64url"),
    TLSN_WORKFLOW_RUN_ID: "1",
    TLSN_WORKFLOW_RUN_ATTEMPT: "1",
    TLSN_REPOSITORY: "tsukasa-u/FUSOU",
    TLSN_WORKFLOW_FILE_IDENTITY: "tsukasa-u/FUSOU/.github/workflows/tlsn-production-deploy.yml@refs/heads/main",
    TLSN_PRODUCTION_DEPLOYMENT_ID: "production-roundtrip-2026",
    TLSN_PRODUCTION_NOTARY_ENDPOINT: "notary.example.com:7047",
    TLSN_PRODUCTION_SESSION_AUTHORITY_ENDPOINT: "https://worker.example.com/attestation/session",
    TLSN_PRODUCTION_VERIFICATION_ENDPOINT: "https://worker.example.com/verify/tlsn",
    TLSN_PRODUCTION_ORIGIN_PORT: "443",
    TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI: result.publicKeySpki,
    TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID: resultKeyId,
    TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY: resultRegistryRaw,
    TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: session.publicKeySpki,
    TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID: sessionKeyId,
    TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY: sessionRegistryRaw,
    TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI: binding.publicKeySpki,
    TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID: bindingKeyId,
    TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY: bindingRegistryRaw,
    TLSN_PRODUCTION_WORKER_NAME: "fusou-tlsn-production",
    TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8: result.privateKeyPkcs8,
    TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: session.privateKeyPkcs8,
    TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: binding.privateKeyPkcs8,
    TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER: rootCertificateDer.toString("base64url"),
    TLSN_ATTESTATION_SIGNER_KEY_ID: "attestation-production-roundtrip",
    TLSN_ATTESTATION_SIGNER_PUBLIC_KEY_SPKI: attestation.publicKeySpki,
    TLSN_MAX_ATTESTATION_AGE_SECONDS: "900",
    TLSN_PREFLIGHT_REPORT_PATH: reportPath,
    TLSN_PROVENANCE_REPORT_PATH: provenancePath,
    TLSN_PUBLIC_MANIFEST_PATH: manifestPath,
  };
  run(process.execPath, ["scripts/deployment-preflight.mjs"], { cwd: packageDirectory, env });

  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.status, "PASS");
  assert.equal(report.failure_count, 0);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assertPublicManifest(manifest);
  assert.equal(manifest.notary.registry_sha256, notaryRegistrySha256(notaryRegistryRaw));
  assert.equal(manifest.notary.verifying_key, alpha15K256NotaryKey);
  assert.equal(manifest.session_authority.key_id, sessionKeyId);
  assert.equal(manifest.origin.server_identity, "game.example.com");
  const manifestText = JSON.stringify(manifest);
  for (const value of [
    result.privateKeyPkcs8,
    session.privateKeyPkcs8,
    binding.privateKeyPkcs8,
    "synthetic-bearer-token",
    "synthetic-supabase-service-role-key",
    "synthetic-device-private-key",
    "synthetic-cloudflare-token",
  ]) assert.equal(manifestText.includes(value), false);
  for (const name of [
    "signing_private_key",
    "bearer_token",
    "supabase_service_role",
    "device_private_key",
    "cloudflare_api_token",
    "binding_authority",
  ]) assert.equal(manifestText.includes(name), false);

  run(process.execPath, [
    "scripts/render-app-config.mjs",
    "--manifest",
    manifestPath,
    "--output",
    fragmentPath,
    "--artifact-output-path",
    artifactPath,
  ], { cwd: packageDirectory, env });
  const fragment = await readFile(fragmentPath, "utf8");
  assert.match(fragment, /tlsn_notary_verifying_key/);
  assert.doesNotMatch(fragment, /private|secret|token|bearer|supabase|device|cloudflare|binding/i);
  const template = await readFile(configTemplatePath, "utf8");
  await writeFile(configPath, fullAppConfigFromFragment(template, fragment), { encoding: "utf8", mode: 0o600 });

  run("cargo", [
    "test",
    "--manifest-path",
    appManifestPath,
    "--features",
    "tlsn-production",
    "tlsn_preflight::tests::generated_app_config_passes_offline_preflight",
    "--",
    "--exact",
    "--ignored",
    "--nocapture",
  ], {
    cwd: repositoryDirectory,
    env: { ...env, FUSOU_TLSN_ROUNDTRIP_CONFIG_PATH: configPath },
  });
  console.log("[tlsn-production-roundtrip] preflight, manifest, renderer, TOML parse, and APP preflight PASS");
} finally {
  await rm(rootDirectory, { recursive: true, force: true });
}