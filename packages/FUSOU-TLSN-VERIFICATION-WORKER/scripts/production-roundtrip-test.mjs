#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertPublicManifest,
  notaryRegistrySha256,
} from "./production-trust-contract.mjs";
import { createSignedResultRegistryEnvelope } from "./result-registry-envelope.mjs";
import { profilesForServerIdentity } from "./profile-canonical-contract.mjs";
import { securityRegistrySetHash } from "./security-registry-set-contract.mjs";
import {
  createCanaryDeploymentManifest,
} from "./canary-deployment-manifest.mjs";
import { inputsForRole, secretInputsForRole } from "./deployment-contract.mjs";

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
  const fragmentLines = fragment.trimEnd().split("\n");
  assert.deepEqual(fragmentLines.slice(0, 4), [
    "[proxy.tlsn]",
    "enabled = true",
    'disclosure_mode = "complete"',
    'response_mode = "async"',
  ]);
  assert.match(fragmentLines[4] ?? "", /^artifact_output_path = ".*"$/);
  assert.equal(fragmentLines.length, 5);

  const sectionPattern = /^\[proxy\.tlsn\]\n[\s\S]*?(?=^\s*\[proxy\.[^\]]+\]\s*$)/m;
  assert.match(template, sectionPattern, "config template is missing [proxy.tlsn]");
  return template.replace(sectionPattern, `${fragment.trimEnd()}\n`);
}

const rootDirectory = await mkdtemp(join(tmpdir(), "fusou-tlsn-roundtrip-"));
try {
  const [alpha15K256NotaryKey, secondAlpha15K256NotaryKey] = generateAlpha15NotaryKeys();
  const rootCertificateDer = await createRootCertificate(rootDirectory);
  const result = keyMaterial();
  const resultRegistryRoot = keyMaterial();
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
  const resultRegistryRootKeyId = "result-registry-root-roundtrip";
  const resultRegistryEnvelopeRaw = JSON.stringify(createSignedResultRegistryEnvelope({
    registry: JSON.parse(resultRegistryRaw),
    registryRaw: resultRegistryRaw,
    rootKeyId: resultRegistryRootKeyId,
    rootPublicKeySpki: resultRegistryRoot.publicKeySpki,
    rootPrivateKeyPkcs8: resultRegistryRoot.privateKeyPkcs8,
  }));
  const productionProfiles = profilesForServerIdentity("game.example.com");
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryDirectory,
    encoding: "utf8",
  }).trim();
  const reportPath = join(rootDirectory, "preflight.json");
  const provenancePath = join(rootDirectory, "provenance.json");
  const manifestPath = join(rootDirectory, "public-manifest.json");
  const canaryManifestPath = join(rootDirectory, "canary-deployment-manifest.json");
  const fragmentPath = join(rootDirectory, "rendered-proxy-config.toml");
  const configPath = join(rootDirectory, "app-config.toml");
  const artifactPath = join(rootDirectory, "app-artifacts");
  const securityRegistrySetSha256 = securityRegistrySetHash({
    notaryKeyId: "notary-production-2026",
    notaryRegistryRaw,
    profileSha256: productionProfiles.complete.sha256,
    serverIdentity: "game.example.com",
    sparseProfileSha256: productionProfiles.sparse.sha256,
  }).sha256;
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    CARGO_NET_OFFLINE: "true",
    TLSN_ENVIRONMENT: "production",
    TLSN_DEPLOYMENT_ROLE: "production",
    TLSN_BINDING_TTL_SECONDS: "900",
    TLSN_GIT_COMMIT_SHA: commitSha,
    TLSN_CANDIDATE_SERVER_IDENTITY: "game.example.com",
    TLSN_CANDIDATE_PROFILE_SHA256: productionProfiles.complete.sha256,
    TLSN_CANDIDATE_SPARSE_PROFILE_SHA256: productionProfiles.sparse.sha256,
    TLSN_CANDIDATE_VERIFIER_KEY_ID: "verifier-production-roundtrip",
    TLSN_CANDIDATE_NOTARY_KEY_ID: "notary-production-2026",
    TLSN_CANDIDATE_NOTARY_ENDPOINT: "notary.example.com:7047",
    TLSN_PRODUCTION_NOTARY_REGISTRY: notaryRegistryRaw,
    TLSN_CANDIDATE_DEVICE_AUTH_URL: "https://api.example.com/api/auth/anonymous-sync/v2/device-proof",
    TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL: "https://api.example.com/api/auth/anonymous-sync/v2/tlsn-device-proof",
    TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS: "api.example.com",
    TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS: "supabase.example.com",
    TLSN_CANDIDATE_SUPABASE_URL: "https://supabase.example.com/",
    TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable-key",
    TLSN_SECURITY_REGISTRY_SET_SHA256: securityRegistrySetSha256,
    TLSN_WORKFLOW_RUN_ID: "1",
    TLSN_WORKFLOW_RUN_ATTEMPT: "1",
    TLSN_REPOSITORY: "tsukasa-u/FUSOU",
    TLSN_WORKFLOW_FILE_IDENTITY: "dotenvx+pnpm+wrangler",
    TLSN_PRODUCTION_DEPLOYMENT_ID: "production-roundtrip-2026",
    TLSN_PRODUCTION_NOTARY_ENDPOINT: "notary.example.com:7047",
    TLSN_PRODUCTION_SESSION_AUTHORITY_ENDPOINT: "https://worker.example.com/attestation/session",
    TLSN_PRODUCTION_VERIFICATION_ENDPOINT: "https://worker.example.com/verify/tlsn",
    TLSN_PRODUCTION_ORIGIN_PORT: "443",
    TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI: result.publicKeySpki,
    TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID: resultKeyId,
    TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY: resultRegistryRaw,
    TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE: resultRegistryEnvelopeRaw,
    TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID: resultRegistryRootKeyId,
    TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI: resultRegistryRoot.publicKeySpki,
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
    TLSN_PRODUCTION_TRIGGER_API_URL: "https://trigger.example.com/",
    TLSN_PRODUCTION_TRIGGER_TASK_ID: "verifyTlsnPresentation",
    TLSN_PRODUCTION_WORKER_INTERNAL_URL: "https://worker.example.com/",
    TLSN_PRODUCTION_TRIGGER_SECRET_KEY: Buffer.alloc(32, 3).toString("base64url"),
    TLSN_PRODUCTION_TRIGGER_CALLBACK_SECRET: Buffer.alloc(32, 4).toString("base64url"),
    TLSN_ATTESTATION_SIGNER_KEY_ID: "attestation-production-roundtrip",
    TLSN_ATTESTATION_SIGNER_PUBLIC_KEY_SPKI: attestation.publicKeySpki,
    TLSN_MAX_ATTESTATION_AGE_SECONDS: "900",
    TLSN_PREFLIGHT_REPORT_PATH: reportPath,
    TLSN_PROVENANCE_REPORT_PATH: provenancePath,
    TLSN_PUBLIC_MANIFEST_PATH: manifestPath,
  };
  const canaryEnvironment = {
    ...env,
    TLSN_DEPLOYMENT_ROLE: "canary",
    TLSN_CANARY_DEPLOYMENT_ID: "canary-roundtrip-2026",
    TLSN_CANARY_WORKER_NAME: "fusou-tlsn-verification-canary",
    TLSN_CANARY_BINDING_IDENTITY: "canary-binding-roundtrip-2026",
  };
  const appBuildEnvironment = {
    ...env,
    FUSOU_TLSN_NOTARY_ENDPOINT: env.TLSN_PRODUCTION_NOTARY_ENDPOINT,
    FUSOU_TLSN_SESSION_AUTHORITY_ENDPOINT: env.TLSN_PRODUCTION_SESSION_AUTHORITY_ENDPOINT,
    FUSOU_TLSN_SESSION_AUTHORITY_PUBLIC_KEY: env.TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI,
    FUSOU_TLSN_SESSION_AUTHORITY_KEY_ID: env.TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID,
    FUSOU_TLSN_RESULT_PUBLIC_KEY_SPKI: env.TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI,
    FUSOU_TLSN_RESULT_SIGNER_KEY_ID: env.TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID,
    FUSOU_TLSN_RESULT_SIGNING_KEY_REGISTRY: env.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY,
    FUSOU_TLSN_VERIFICATION_ENDPOINT: env.TLSN_PRODUCTION_VERIFICATION_ENDPOINT,
    FUSOU_TLSN_RUNTIME_ATTESTATION_ENDPOINT: "https://worker.example.com/health",
    FUSOU_TLSN_EXPECTED_DEPLOYMENT_ID: canaryEnvironment.TLSN_CANARY_DEPLOYMENT_ID,
    FUSOU_TLSN_EXPECTED_WORKER_NAME: canaryEnvironment.TLSN_CANARY_WORKER_NAME,
    FUSOU_TLSN_EXPECTED_GIT_COMMIT_SHA: commitSha,
    FUSOU_TLSN_EXPECTED_BINDING_MODE: "fixed_canary",
    FUSOU_TLSN_NOTARY_VERIFYING_KEY: alpha15K256NotaryKey,
    FUSOU_TLSN_ORIGIN_PORT: env.TLSN_PRODUCTION_ORIGIN_PORT,
    FUSOU_TLSN_SERVER_IDENTITY: env.TLSN_CANDIDATE_SERVER_IDENTITY,
    FUSOU_TLSN_ORIGIN_TRUST_ROOTS: env.TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER,
  };
  for (const name of inputsForRole("canary")) {
    if (secretInputsForRole("canary").includes(name)) continue;
    canaryEnvironment[name] ??= name === "TLSN_PRODUCTION_NOTARY_REGISTRY"
      ? notaryRegistryRaw
      : name.endsWith("_REGISTRY_ENVELOPE")
        ? resultRegistryEnvelopeRaw
        : `${name}-roundtrip`;
  }
  const canaryArtifactBytes = await readFile(resolve(packageDirectory, "scripts/production-roundtrip-test.mjs"));
  const canaryManifest = createCanaryDeploymentManifest({
    environment: canaryEnvironment,
    currentHead: commitSha,
    artifacts: [{
      name: "production-roundtrip-source",
      path: "scripts/production-roundtrip-test.mjs",
      sha256: createHash("sha256").update(canaryArtifactBytes).digest("base64url"),
    }],
    secretProviderReferences: secretInputsForRole("canary").map((inputName) => ({
      input_name: inputName,
      provider_ref: `deployment-secret/${inputName}`,
    })),
  });
  await writeFile(canaryManifestPath, JSON.stringify(canaryManifest), { encoding: "utf8", mode: 0o600 });
  run(process.execPath, ["scripts/deployment-preflight.mjs"], { cwd: packageDirectory, env });

  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.status, "PASS");
  assert.equal(report.failure_count, 0);
  const mutatedReportPath = join(rootDirectory, "mutated-preflight.json");
  const mutatedPreflight = spawnSync(process.execPath, ["scripts/deployment-preflight.mjs"], {
    cwd: packageDirectory,
    encoding: "utf8",
    env: {
      ...env,
      TLSN_SECURITY_REGISTRY_SET_SHA256: Buffer.alloc(32, 0x7f).toString("base64url"),
      TLSN_PREFLIGHT_REPORT_PATH: mutatedReportPath,
    },
  });
  assert.notEqual(mutatedPreflight.status, 0, `${mutatedPreflight.stdout}\n${mutatedPreflight.stderr}`);
  const mutatedReport = JSON.parse(await readFile(mutatedReportPath, "utf8"));
  assert.equal(mutatedReport.status, "FAIL");
  assert.ok(mutatedReport.failures.some(({ check }) => check === "TLSN_SECURITY_REGISTRY_SET_SHA256"));
  const missingReportPath = join(rootDirectory, "missing-security-hash-preflight.json");
  const { TLSN_SECURITY_REGISTRY_SET_SHA256: _ignoredSecurityRegistrySetSha256, ...envWithoutSecurityRegistrySetSha256 } = env;
  const missingSecurityRegistrySet = spawnSync(process.execPath, ["scripts/deployment-preflight.mjs"], {
    cwd: packageDirectory,
    encoding: "utf8",
    env: {
      ...envWithoutSecurityRegistrySetSha256,
      TLSN_PREFLIGHT_REPORT_PATH: missingReportPath,
    },
  });
  assert.notEqual(missingSecurityRegistrySet.status, 0, `${missingSecurityRegistrySet.stdout}\n${missingSecurityRegistrySet.stderr}`);
  const missingReport = JSON.parse(await readFile(missingReportPath, "utf8"));
  assert.equal(missingReport.status, "FAIL");
  assert.ok(missingReport.failures.some(({ check }) => check === "TLSN_SECURITY_REGISTRY_SET_SHA256"));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assertPublicManifest(manifest);
  assert.equal(manifest.notary.registry_sha256, notaryRegistrySha256(notaryRegistryRaw));
  assert.equal(manifest.notary.verifying_key, alpha15K256NotaryKey);
  assert.equal(manifest.session_authority.key_id, sessionKeyId);
  assert.equal(manifest.result_signing.key_id, resultKeyId);
  assert.equal(manifest.result_signing.public_key_spki, result.publicKeySpki);
  assert.equal(manifest.result_signing.result_registry_root_key_id, resultRegistryRootKeyId);
  assert.equal(manifest.result_signing.result_registry_root_public_key_spki, resultRegistryRoot.publicKeySpki);
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
    "--canary-manifest",
    canaryManifestPath,
    "--output",
    fragmentPath,
    "--artifact-output-path",
    artifactPath,
    "--runtime-attestation-endpoint",
    "https://worker.example.com/health",
  ], { cwd: packageDirectory, env: canaryEnvironment });
  const fragment = await readFile(fragmentPath, "utf8");
  const deploymentOnlyFields = [
    "tlsn_notary_endpoint",
    "tlsn_session_authority_endpoint",
    "tlsn_session_authority_public_key",
    "tlsn_session_authority_key_id",
    "tlsn_result_public_key_spki",
    "tlsn_result_signer_key_id",
    "tlsn_result_signing_key_registry",
    "tlsn_verification_endpoint",
    "tlsn_runtime_attestation_endpoint",
    "tlsn_expected_deployment_id",
    "tlsn_expected_worker_name",
    "tlsn_expected_git_commit_sha",
    "tlsn_expected_binding_mode",
    "tlsn_notary_verifying_key",
    "tlsn_origin_port",
    "tlsn_server_identity",
    "tlsn_origin_trust_roots",
  ];
  for (const field of deploymentOnlyFields) {
    assert.doesNotMatch(fragment, new RegExp(`^${field}\\s*=`, "m"));
  }
  assert.doesNotMatch(fragment, /private|secret|token|bearer|supabase|device|cloudflare/i);
  const template = await readFile(configTemplatePath, "utf8");
  const fullConfig = fullAppConfigFromFragment(template, fragment);
  for (const field of deploymentOnlyFields) {
    assert.doesNotMatch(fullConfig, new RegExp(`^${field}\\s*=`, "m"));
  }
  await writeFile(configPath, fullConfig, { encoding: "utf8", mode: 0o600 });

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
    env: { ...appBuildEnvironment, FUSOU_TLSN_ROUNDTRIP_CONFIG_PATH: configPath },
  });
  console.log("[tlsn-production-roundtrip] preflight, manifest, renderer, TOML parse, and APP preflight PASS");
} finally {
  await rm(rootDirectory, { recursive: true, force: true });
}