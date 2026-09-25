#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  CANARY_INPUTS,
  assertManifest,
} from "./deployment-contract.mjs";
import { profileContractArtifact, profilesForServerIdentity } from "./profile-canonical-contract.mjs";
import { securityRegistrySetHash } from "./security-registry-set-contract.mjs";
import { loadCanaryFixtureOnlyFixture } from "./canary-fixture-only-data.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const provisionerPath = resolve(packageDirectory, "scripts/provision-canary-material.mjs");
const testPath = resolve(packageDirectory, "scripts/fixture-only-provisioning-test.mjs");
const syntheticServerIdentity = "game.example.test";
const forbiddenGameServer = "w16s.kancolle-server.com";
const fixtureOnlyFlag = "TLSN_CANARY_FIXTURE_ONLY";
const runtimeAttestationPrivateKeyInput = "TLSN_CANARY_RUNTIME_ATTESTATION_SIGNING_PRIVATE_KEY_PKCS8";

function fixtureBytes(raw, label) {
  const bytes = Buffer.from(raw, "base64url");
  assert.ok(bytes.length > 0, `${label} must not be empty`);
  assert.equal(bytes.toString("base64url"), raw, `${label} must be canonical base64url`);
  return bytes;
}

function sha256Base64Url(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function parseGeneratedEnv(raw) {
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        assert.ok(separator > 0, `invalid generated env line: ${line}`);
        return [line.slice(0, separator), JSON.parse(line.slice(separator + 1))];
      }),
  );
}

function installIsolationGuards() {
  const deny = (label) => {
    throw new Error(`[fixture-only-isolation] forbidden ${label} call`);
  };
  globalThis.fetch = () => deny("fetch");

  const require = createRequire(import.meta.url);
  const http = require("node:http");
  const https = require("node:https");
  const net = require("node:net");
  const tls = require("node:tls");
  const dns = require("node:dns");
  for (const module of [http, https]) {
    module.request = () => deny(module === http ? "http.request" : "https.request");
    module.get = () => deny(module === http ? "http.get" : "https.get");
  }
  for (const name of ["connect", "createConnection"]) net[name] = () => deny(`net.${name}`);
  tls.connect = () => deny("tls.connect");
  for (const name of ["lookup", "resolve", "resolve4", "resolve6", "reverse"]) dns[name] = () => deny(`dns.${name}`);

  const childProcess = require("node:child_process");
  const originalExecFileSync = childProcess.execFileSync;
  childProcess.execFileSync = (file, argumentsList, ...rest) => {
    const command = typeof file === "string" ? file : "";
    if (command === "git" && Array.isArray(argumentsList) && argumentsList.join(" ") === "rev-parse HEAD") {
      return originalExecFileSync(file, argumentsList, ...rest);
    }
    return deny(`child_process.execFileSync(${command || "unknown"})`);
  };
  for (const name of ["spawnSync", "execFile", "exec", "fork", "spawn"]) {
    childProcess[name] = () => deny(`child_process.${name}`);
  }
}

async function runProvisionerChild(outputDirectory, extraArguments = [], extraEnvironment = {}) {
  const result = spawnSync(process.execPath, [testPath, "--child"], {
    cwd: packageDirectory,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? tmpdir(),
      FIXTURE_ONLY_TEST_OUTPUT: outputDirectory,
      FIXTURE_ONLY_TEST_EXTRA_ARGUMENTS: JSON.stringify(extraArguments),
      ...extraEnvironment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ...result,
    output: result.stdout,
    errorOutput: result.stderr,
  };
}

async function runChild() {
  installIsolationGuards();
  const extraArguments = JSON.parse(process.env.FIXTURE_ONLY_TEST_EXTRA_ARGUMENTS ?? "[]");
  process.argv = [
    process.argv[0],
    provisionerPath,
    "--output",
    process.env.FIXTURE_ONLY_TEST_OUTPUT,
    "--fixture-only",
    "true",
    "--fixture-case",
    "p50",
    ...extraArguments,
  ];
  await import(pathToFileURL(provisionerPath).href);
}

function deterministicSnapshot(manifest, generatedEnv) {
  return {
    environment: Object.fromEntries([
      "TLSN_ENVIRONMENT",
      "TLSN_DEPLOYMENT_ROLE",
      "TLSN_CANARY_FIXTURE_ONLY",
      "TLSN_CANDIDATE_SERVER_IDENTITY",
      "TLSN_CANDIDATE_PROFILE_SHA256",
      "TLSN_CANDIDATE_SPARSE_PROFILE_SHA256",
      "TLSN_CANDIDATE_NOTARY_KEY_ID",
      "TLSN_CANDIDATE_NOTARY_ENDPOINT",
      "TLSN_PRODUCTION_NOTARY_REGISTRY",
      "TLSN_SECURITY_REGISTRY_SET_SHA256",
    ].map((name) => [name, generatedEnv[name]])),
    manifest: {
      artifact: manifest.artifact,
      mode: manifest.mode,
      status: manifest.status,
      commit_sha: manifest.commit_sha,
      notary: manifest.notary,
      fixture_provenance: manifest.fixture_provenance,
      supplied_candidate_inputs: manifest.supplied_candidate_inputs,
      profile_contract: manifest.profile_contract,
      canary_contract: manifest.canary_contract,
      unresolved_inputs: manifest.unresolved_inputs,
      secret_values_written: manifest.secret_values_written,
      secret_values_in_manifest: manifest.secret_values_in_manifest,
    },
  };
}

async function inspectProvisionedOutput(outputDirectory, fixtureManifest, fixtureEntry, fixture) {
  const manifestRaw = await readFile(join(outputDirectory, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestRaw);
  const generatedEnv = parseGeneratedEnv(await readFile(join(outputDirectory, "canary.env"), "utf8"));
  const sparsePresentation = fixtureBytes(fixture.sparse_presentation_base64, "sparse_presentation_base64");
  const rootCertificate = fixtureBytes(fixture.root_certificate_base64, "root_certificate_base64");
  const notaryPublicKey = fixtureBytes(fixture.notary_key_base64, "notary_key_base64");
  const expectedFixtureProvenance = {
    source: "repository-local-synthetic-fixture",
    benchmark: fixtureManifest.benchmark,
    fixture_case: fixtureEntry.caseLabel,
    fixture_file: fixtureEntry.fixtureFile,
    source_epoch: fixtureEntry.sourceEpoch,
    source_file_name: fixtureEntry.sourceFileName,
    presentation_kind: "sparse",
    presentation_sha256: sha256Base64Url(sparsePresentation),
    root_certificate_sha256: sha256Base64Url(rootCertificate),
    notary_public_key_sha256: sha256Base64Url(notaryPublicKey),
  };

  assert.equal(manifest.artifact, "tlsn-canary-provisioning");
  assert.equal(manifest.mode, "fixture-only");
  assert.ok(["complete", "incomplete"].includes(manifest.status));
  assert.match(manifest.commit_sha, /^[0-9a-f]{40}$/);
  assert.equal(manifest.secret_values_written, true);
  assert.equal(manifest.secret_values_in_manifest, false);
  assert.deepEqual(manifest.fixture_provenance, expectedFixtureProvenance);
  assert.equal(manifest.notary.source, "repository-local-synthetic-fixture");
  assert.equal(Object.hasOwn(manifest.notary, "private_key_file"), false);
  assert.equal(generatedEnv[fixtureOnlyFlag], "true");
  assert.equal(generatedEnv.TLSN_ENVIRONMENT, "production");
  assert.equal(generatedEnv.TLSN_DEPLOYMENT_ROLE, "canary");
  assert.equal(generatedEnv.TLSN_CANDIDATE_SERVER_IDENTITY, syntheticServerIdentity);
  assert.equal(generatedEnv.TLSN_CANDIDATE_NOTARY_KEY_ID, manifest.notary.key_id);
  assert.equal(JSON.parse(generatedEnv.TLSN_PRODUCTION_NOTARY_REGISTRY)[manifest.notary.key_id], fixture.notary_key_base64);
  assert.equal(generatedEnv.TLSN_CANDIDATE_PROFILE_SHA256, manifest.supplied_candidate_inputs.profile_sha256);
  assert.equal(generatedEnv.TLSN_CANDIDATE_SPARSE_PROFILE_SHA256, manifest.supplied_candidate_inputs.sparse_profile_sha256);
  const expectedFixtureSecurityRegistrySet = securityRegistrySetHash({
    notaryKeyId: generatedEnv.TLSN_CANDIDATE_NOTARY_KEY_ID,
    notaryRegistryRaw: generatedEnv.TLSN_PRODUCTION_NOTARY_REGISTRY,
    profileSha256: generatedEnv.TLSN_CANDIDATE_PROFILE_SHA256,
    serverIdentity: generatedEnv.TLSN_CANDIDATE_SERVER_IDENTITY,
    sparseProfileSha256: generatedEnv.TLSN_CANDIDATE_SPARSE_PROFILE_SHA256,
  });
  assert.equal(generatedEnv.TLSN_SECURITY_REGISTRY_SET_SHA256, expectedFixtureSecurityRegistrySet.sha256);
  assert.equal(manifest.security_registry_set_sha256, expectedFixtureSecurityRegistrySet.sha256);
  assert.equal(manifest.security_registry_set_source, "derived-from-explicit-inputs");
  assert.equal(generatedEnv.TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER, fixture.root_certificate_base64);
  assert.equal(manifest.supplied_candidate_inputs.trust_root_sha256, sha256Base64Url(rootCertificate));
  assert.deepEqual(await readFile(join(outputDirectory, "trust-root.der")), rootCertificate);
  assert.equal(await readFile(join(outputDirectory, "notary-signing-key.base64url")).catch(() => null), null);

  const completeProfileRaw = await readFile(join(outputDirectory, "complete-profile.canonical.json"), "utf8");
  const sparseProfileRaw = await readFile(join(outputDirectory, "sparse-profile.canonical.json"), "utf8");
  const completeProfile = JSON.parse(completeProfileRaw);
  const sparseProfile = JSON.parse(sparseProfileRaw);
  const expectedProfiles = profilesForServerIdentity(syntheticServerIdentity);
  assert.deepEqual(completeProfile, expectedProfiles.complete.profile);
  assert.deepEqual(sparseProfile, expectedProfiles.sparse.profile);
  assert.equal(completeProfileRaw, `${expectedProfiles.complete.canonical}\n`);
  assert.equal(sparseProfileRaw, `${expectedProfiles.sparse.canonical}\n`);
  assert.equal(generatedEnv.TLSN_CANDIDATE_PROFILE_SHA256, expectedProfiles.complete.sha256);
  assert.equal(generatedEnv.TLSN_CANDIDATE_SPARSE_PROFILE_SHA256, expectedProfiles.sparse.sha256);
  assert.deepEqual(manifest.profile_contract, profileContractArtifact({
    serverIdentity: syntheticServerIdentity,
    profileSha256: expectedProfiles.complete.sha256,
    sparseProfileSha256: expectedProfiles.sparse.sha256,
    disclosureMode: "full|sparse",
    responseModeCapabilities: ["async", "sync"],
  }));
  assert.deepEqual(manifest.canary_contract, {
    environment: "production",
    deployment_role: "canary",
    fixture_only: true,
    response_mode_capabilities: ["async", "sync"],
    profile_hashes_exact: {
      complete: expectedProfiles.complete.sha256,
      sparse: expectedProfiles.sparse.sha256,
    },
  });
  assert.notEqual(generatedEnv.TLSN_CANDIDATE_PROFILE_SHA256, generatedEnv.TLSN_CANDIDATE_SPARSE_PROFILE_SHA256);
  assert.equal(completeProfile.server_identity, sparseProfile.server_identity);
  assert.equal(completeProfile.target, sparseProfile.target);
  assert.notEqual(completeProfile.id, sparseProfile.id);
  assert.equal(sparseProfile.disclosure_mode, "sparse");

  assert.doesNotMatch(manifestRaw, /presentation_base64|sparse_presentation_base64|root_certificate_base64|notary_key_base64/);
  const secretFileNames = [
    "canary-result-signing-private-key.pkcs8.base64url",
    "canary-session-authority-private-key.pkcs8.base64url",
    "canary-binding-authority-private-key.pkcs8.base64url",
  ];
  const secretEnvironmentNames = [
    "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER",
    "TLSN_CANARY_TRIGGER_SECRET_KEY",
    "TLSN_CANARY_TRIGGER_CALLBACK_SECRET",
    "TLSN_CANARY_DIRECT_CALLBACK_SECRET",
  ];
  for (const secret of secretFileNames) {
    const value = (await readFile(join(outputDirectory, secret), "utf8")).trim();
    assert.equal(manifestRaw.includes(value), false, `manifest leaked ${secret}`);
  }
  for (const secret of secretEnvironmentNames) {
    const value = generatedEnv[secret];
    assert.equal(typeof value, "string");
    assert.equal(manifestRaw.includes(value), false, `manifest leaked ${secret}`);
  }
  assert.equal(JSON.stringify(generatedEnv).includes(forbiddenGameServer), false);
  assert.equal(JSON.stringify(generatedEnv).includes("live-key-sentinel"), false);
  assert.equal(JSON.stringify(generatedEnv).includes("live.example.com"), false);
  assert.equal(JSON.stringify(generatedEnv).includes("live-supabase.example.com"), false);

  return { manifest, manifestRaw, generatedEnv };
}

async function runFixturePreflight(outputDirectory, generatedEnv) {
  const reportPath = join(outputDirectory, "preflight.json");
  const privateKeyFiles = {
    TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8: "canary-result-signing-private-key.pkcs8.base64url",
    TLSN_CANARY_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: "canary-session-authority-private-key.pkcs8.base64url",
    TLSN_CANARY_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: "canary-binding-authority-private-key.pkcs8.base64url",
  };
  const privateKeyEnvironment = Object.fromEntries(await Promise.all(
    Object.entries(privateKeyFiles).map(async ([name, fileName]) => [name, (await readFile(join(outputDirectory, fileName), "utf8")).trim()]),
  ));
  const result = spawnSync(process.execPath, [resolve(packageDirectory, "scripts/deployment-preflight.mjs")], {
    cwd: packageDirectory,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? tmpdir(),
      ...generatedEnv,
      ...privateKeyEnvironment,
      TLSN_WORKFLOW_RUN_ID: "1",
      TLSN_WORKFLOW_RUN_ATTEMPT: "1",
      TLSN_REPOSITORY: "fixture/example",
      TLSN_WORKFLOW_FILE_IDENTITY: "dotenvx+pnpm+wrangler",
      TLSN_CANDIDATE_DEVICE_AUTH_URL: "https://api.example.com/api/auth/anonymous-sync/v2/device-proof",
      TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL: "https://api.example.com/api/auth/anonymous-sync/v2/tlsn-device-proof",
      TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS: "api.example.com",
      TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS: "supabase.example.com",
      TLSN_CANDIDATE_SUPABASE_URL: "https://supabase.example.com/",
      TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable-key",
      TLSN_CANARY_TRIGGER_API_URL: "https://trigger.example.com/",
      TLSN_CANARY_TRIGGER_TASK_ID: "verifyTlsnPresentation",
      TLSN_CANARY_WORKER_INTERNAL_URL: "https://worker.example.com/",
      TLSN_PREFLIGHT_REPORT_PATH: reportPath,
    },
  });
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${JSON.stringify(report.failures)}`);
  assert.equal(report.status, "PASS");
  assert.equal(report.failure_count, 0);
}

async function runTest() {
  const { manifest: fixtureManifest, entry: fixtureEntry, fixture } = loadCanaryFixtureOnlyFixture("p50");
  assert.deepEqual(fixtureManifest.source, {
    path: "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/canary-fixture-only-data.mjs",
    fixtureType: "synthetic",
    realTlsnotaryPresentation: false,
    realGameServerCapture: false,
    trustRoot: false,
    deploymentAuthority: false,
    benchmarkMeasurementData: false,
    fixtureSemantics: "synthetic metadata only; no TLSNotary Presentation or HTTP transcript",
    httpTranscriptSize: "NOT_ESTABLISHED",
  });
  const deploymentManifest = JSON.parse(await readFile(resolve(packageDirectory, "scripts/production-inputs.json"), "utf8"));
  const deploymentContract = await readFile(resolve(packageDirectory, "scripts/deployment-contract.mjs"), "utf8");
  const provisionerSource = await readFile(provisionerPath, "utf8");
  assertManifest(deploymentManifest);
  assert.ok(CANARY_INPUTS.includes(fixtureOnlyFlag));
  assert.deepEqual(deploymentManifest.canary_inputs, CANARY_INPUTS);
  assert.match(provisionerSource, /TLSN_CANARY_FIXTURE_ONLY:\s*"true"/);
  assert.doesNotMatch(provisionerSource, /createECDH|notaryKeyMaterial|notary-signing-key/);
  assert.match(deploymentContract, /TLSN_CANARY_FIXTURE_ONLY/);

  const rootDirectory = await mkdtemp(join(tmpdir(), "tlsn-fixture-only-provisioning-test-"));
  try {
    const firstDirectory = join(rootDirectory, "first");
    const secondDirectory = join(rootDirectory, "second");
    const isolatedEnvironment = {
      TLSN_SERVER_IDENTITY: forbiddenGameServer,
      TLSN_CANDIDATE_SERVER_IDENTITY: forbiddenGameServer,
      [runtimeAttestationPrivateKeyInput]: "synthetic-runtime-attestation-private-key-sentinel",
      PUBLIC_SITE_URL_PRODUCTION: "https://live.example.com/",
      PUBLIC_SUPABASE_URL: "https://live-supabase.example.com/",
      PUBLIC_SUPABASE_PUBLISHABLE_KEY: "live-key-sentinel",
    };
    const firstRun = await runProvisionerChild(firstDirectory, [], isolatedEnvironment);
    assert.equal(firstRun.status, 0, `${firstRun.errorOutput}\n${firstRun.output}`);
    const first = await inspectProvisionedOutput(firstDirectory, fixtureManifest, fixtureEntry, fixture);
    assert.equal(first.generatedEnv[runtimeAttestationPrivateKeyInput], undefined);
    assert.equal(first.manifestRaw?.includes("synthetic-runtime-attestation-private-key-sentinel"), false);
    const secondRun = await runProvisionerChild(secondDirectory, [], isolatedEnvironment);
    assert.equal(secondRun.status, 0, `${secondRun.errorOutput}\n${secondRun.output}`);
    const second = await inspectProvisionedOutput(secondDirectory, fixtureManifest, fixtureEntry, fixture);
    assert.deepEqual(deterministicSnapshot(first.manifest, first.generatedEnv), deterministicSnapshot(second.manifest, second.generatedEnv));
    await runFixturePreflight(firstDirectory, first.generatedEnv);

    const mixedInputRun = await runProvisionerChild(
      join(rootDirectory, "mixed-input"),
      ["--profile-file", "/fixture-only/profile.json", "--trust-root-file", "/fixture-only/root.der"],
      isolatedEnvironment,
    );
    assert.notEqual(mixedInputRun.status, 0);
    assert.match(mixedInputRun.errorOutput, /fixture-only mode owns local profile, trust-root, and Notary inputs/);

    const realIdentityRun = await runProvisionerChild(
      join(rootDirectory, "real-identity"),
      ["--server-identity", forbiddenGameServer],
      {},
    );
    assert.notEqual(realIdentityRun.status, 0);
    assert.match(realIdentityRun.errorOutput, new RegExp(`fixture-only canary must use ${syntheticServerIdentity}`));
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }

  console.log("[tlsn-fixture-only-provisioning] contract, provenance, determinism, secret, game-server, and network isolation PASS");
}

if (process.argv[2] === "--child") {
  await runChild();
} else {
  await runTest();
}
