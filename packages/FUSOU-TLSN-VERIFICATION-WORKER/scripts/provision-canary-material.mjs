#!/usr/bin/env node

import { createHash, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { createSignedResultRegistryEnvelope } from "./result-registry-envelope.mjs";
import { canonicalJson, notaryRegistrySha256, parseNotaryRegistry } from "./production-trust-contract.mjs";
import { securityRegistrySetHash } from "./security-registry-set-contract.mjs";
import {
  FIXTURE_SERVER_IDENTITY,
  canonicalProfileHash,
  parseProfileDocument,
  profileContractArtifact,
  profilesForServerIdentity,
} from "./profile-canonical-contract.mjs";
import { loadRealFixture, readRealFixtureManifest } from "./tlsn-benchmark-fixtures.mjs";
import {
  assertCanonicalCanaryWorkerName,
  CANARY_WORKER_NAME,
} from "./canary-deployment-target.mjs";
import { createCanaryDeploymentManifest } from "./canary-deployment-manifest.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const repositoryDirectory = resolve(packageDirectory, "../..");
const FIXTURE_PROVENANCE_SOURCE = "repository-local-synthetic-fixture";
const DEPLOYMENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function parseArguments(argumentsList) {
  const options = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--") continue;
    if (!argument.startsWith("--")) throw new Error(`unexpected argument: ${argument}`);
    const name = argument.slice(2);
    if (name === "help") return { help: true };
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${name}`);
    options[name] = value;
    index += 1;
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/provision-canary-material.mjs --output DIR [options]",
    "",
    "Generates only locally-owned canary authority material. Production-bound",
    "identity, profile, trust-root, endpoint, and workflow values must be supplied",
    "explicitly and are never invented by this command.",
    "",
    "Options:",
    "  --output DIR                  output directory (recommended: .cache/tlsn-canary)",
    "  --server-identity HOST        candidate origin identity",
    "  --profile-file FILE           canonical complete profile JSON",
    "  --sparse-profile-file FILE    canonical sparse profile JSON",
    "  --trust-root-file FILE        DER trust root for the candidate origin",
    "  --notary-registry-file FILE  explicit alpha15 Notary registry JSON",
    "  --notary-key-id ID           explicit Notary key ID in that registry",
    "  --verifier-key-id ID         candidate verifier key ID",
    "  --verifier-public-key-spki KEY  candidate verifier Ed25519 SPKI public key",
    "  --verifier-deployment-id ID  candidate verifier deployment ID",
    "  --deployment-id ID           explicit canary deployment ID",
    "  --worker-name NAME           canonical canary Worker name (must match repository config)",
    "  --fixture-only true|false     use a repository-local synthetic fixture only",
    "  --fixture-case CASE           synthetic fixture case (default: p50)",
    "",
  ].join("\n");
}

function keyMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    publicKeySpki: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  };
}

function generatedCanaryKeyId(deploymentIdentity, purpose, publicKeySpki) {
  const deploymentPart = deploymentIdentity.length <= 80
    ? deploymentIdentity
    : createHash("sha256").update(deploymentIdentity, "utf8").digest("base64url").slice(0, 24);
  const materialFingerprint = createHash("sha256")
    .update(Buffer.from(publicKeySpki, "base64url"))
    .digest("base64url")
    .slice(0, 16);
  return `canary-${deploymentPart}-${purpose}-${materialFingerprint}`;
}

function assertDeploymentId(value) {
  if (typeof value !== "string" || !DEPLOYMENT_ID_PATTERN.test(value)) {
    throw new Error("--deployment-id must be an alphanumeric deployment identifier");
  }
}

function assertVerifierPublicKey(value) {
  if (typeof value !== "string" || value.length !== 59 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("--verifier-public-key-spki must be a canonical Ed25519 SPKI public key");
  }
  try {
    if (createPublicKey({ key: Buffer.from(value, "base64url"), format: "der", type: "spki" }).asymmetricKeyType !== "ed25519") {
      throw new Error("wrong key type");
    }
  } catch {
    throw new Error("--verifier-public-key-spki must be a canonical Ed25519 SPKI public key");
  }
  return value;
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

function randomSecret() {
  return randomBytes(32).toString("base64url");
}

function fixtureBytes(raw, label) {
  const bytes = Buffer.from(raw, "base64url");
  if (bytes.length === 0 || bytes.toString("base64url") !== raw) {
    throw new Error(`synthetic fixture ${label} must be canonical base64url`);
  }
  return bytes;
}

function sha256Base64Url(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function fixtureProvenance(fixtureManifest, fixtureEntry, fixture) {
  const presentationField = typeof fixture.presentation_base64 === "string"
    ? "presentation_base64"
    : "sparse_presentation_base64";
  const presentation = fixtureBytes(fixture[presentationField], presentationField);
  const rootCertificate = fixtureBytes(fixture.root_certificate_base64, "root_certificate_base64");
  const notaryPublicKey = fixtureBytes(fixture.notary_key_base64, "notary_key_base64");
  return {
    source: FIXTURE_PROVENANCE_SOURCE,
    benchmark: fixtureManifest.benchmark,
    fixture_case: fixtureEntry.caseLabel,
    fixture_file: fixtureEntry.fixtureFile,
    source_epoch: fixtureEntry.sourceEpoch,
    source_file_name: fixtureEntry.sourceFileName,
    presentation_kind: presentationField === "presentation_base64" ? "complete" : "sparse",
    presentation_sha256: sha256Base64Url(presentation),
    root_certificate_sha256: sha256Base64Url(rootCertificate),
    notary_public_key_sha256: sha256Base64Url(notaryPublicKey),
  };
}

function fixtureProfile(serverIdentity, sparse) {
  return profilesForServerIdentity(serverIdentity)[sparse ? "sparse" : "complete"];
}

async function readProfile(path, label, kind, expectedServerIdentity) {
  if (!path) return null;
  let parsed;
  try {
    parsed = JSON.parse(await readFile(resolve(path), "utf8"));
  } catch (error) {
    throw new Error(`${label} must be readable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const profile = canonicalProfileHash(parsed, kind);
  if (expectedServerIdentity !== undefined && profile.profile.server_identity !== expectedServerIdentity) {
    throw new Error(`${label} server_identity does not match --server-identity`);
  }
  return profile;
}

async function readNotaryRegistry(path, keyId) {
  if (!path) return null;
  if (!keyId) throw new Error("--notary-key-id is required with --notary-registry-file");
  let raw;
  try {
    raw = (await readFile(resolve(path), "utf8")).trim();
  } catch (error) {
    throw new Error(`--notary-registry-file must be readable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const registry = parseNotaryRegistry(raw, "--notary-registry-file");
  if (!registry[keyId]) throw new Error(`--notary-registry-file does not contain --notary-key-id ${keyId}`);
  return JSON.stringify(registry);
}

function writeEnvValue(name, value) {
  return `${name}=${JSON.stringify(value)}`;
}

function publicOrigin(value, label) {
  if (!value?.trim()) return null;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`${label} must be a clean HTTPS origin`);
  }
  return parsed;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.output) throw new Error("--output is required\n\n" + usage());
  if (options["fixture-only"] !== undefined && !["true", "false"].includes(options["fixture-only"])) {
    throw new Error("--fixture-only must be true or false");
  }
  const fixtureOnly = options["fixture-only"] === "true";
  if (fixtureOnly) {
    const forbiddenFixtureOptions = ["profile-file", "sparse-profile-file", "trust-root-file", "notary-registry-file"];
    const suppliedFixtureOptions = forbiddenFixtureOptions.filter((name) => options[name] !== undefined);
    if (suppliedFixtureOptions.length > 0) {
      throw new Error(`fixture-only mode owns local profile, trust-root, and Notary inputs; remove ${suppliedFixtureOptions.join(", ")}`);
    }
  }
  let fixture;
  let fixtureManifest;
  let fixtureEntry;
  let fixtureCase;
  if (fixtureOnly) {
    if (options["server-identity"] && options["server-identity"] !== FIXTURE_SERVER_IDENTITY) {
      throw new Error(`fixture-only canary must use ${FIXTURE_SERVER_IDENTITY}`);
    }
    const loadedFixtureManifest = readRealFixtureManifest();
    fixtureManifest = loadedFixtureManifest.manifest;
    fixtureCase = options["fixture-case"] ?? "p50";
    fixtureEntry = loadedFixtureManifest.entries.get(fixtureCase);
    if (!fixtureEntry) throw new Error(`unknown synthetic fixture case: ${fixtureCase}`);
    fixture = loadRealFixture(fixtureEntry);
    for (const field of ["sparse_presentation_base64", "root_certificate_base64", "notary_key_base64"]) {
      if (typeof fixture[field] !== "string" || fixture[field].length === 0) {
        throw new Error(`synthetic fixture is missing ${field}`);
      }
    }
  }

  const outputDirectory = resolve(options.output);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(outputDirectory, 0o700);

  const notaryKeyId = options["notary-key-id"] ?? (fixtureOnly ? "notary-canary-2026" : undefined);
  const deploymentId = options["deployment-id"] ?? (fixtureOnly ? `canary-${new Date().toISOString().replace(/[-:.TZ]/g, "")}` : undefined);
  if (deploymentId) assertDeploymentId(deploymentId);
  const deploymentIdentity = deploymentId ?? `unresolved-${randomBytes(12).toString("hex")}`;
  const result = keyMaterial();
  const resultRoot = keyMaterial();
  const session = keyMaterial();
  const binding = keyMaterial();
  const verifier = fixtureOnly ? keyMaterial() : null;
  const resultKeyId = generatedCanaryKeyId(deploymentIdentity, "result", result.publicKeySpki);
  const resultRootKeyId = generatedCanaryKeyId(deploymentIdentity, "result-root", resultRoot.publicKeySpki);
  const sessionKeyId = generatedCanaryKeyId(deploymentIdentity, "session", session.publicKeySpki);
  const bindingKeyId = generatedCanaryKeyId(deploymentIdentity, "binding", binding.publicKeySpki);
  const verifierDeploymentId = fixtureOnly
    ? (deploymentId ? `${deploymentId}-verifier` : null)
    : options["verifier-deployment-id"];
  if (verifierDeploymentId) assertDeploymentId(verifierDeploymentId);
  const verifierPublicKeySpki = verifier?.publicKeySpki
    ?? (options["verifier-public-key-spki"] ? assertVerifierPublicKey(options["verifier-public-key-spki"].trim()) : null);
  const resultRegistryRaw = authorityRegistry(
    "tlsn-result-signing-key-registry",
    resultKeyId,
    result.publicKeySpki,
  );
  const resultRegistry = JSON.parse(resultRegistryRaw);
  const resultRegistryEnvelopeRaw = JSON.stringify(createSignedResultRegistryEnvelope({
    registry: resultRegistry,
    registryRaw: resultRegistryRaw,
    rootKeyId: resultRootKeyId,
    rootPublicKeySpki: resultRoot.publicKeySpki,
    rootPrivateKeyPkcs8: resultRoot.privateKeyPkcs8,
  }));
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
  const serverIdentity = options["server-identity"] ?? (fixtureOnly ? FIXTURE_SERVER_IDENTITY : undefined);
  if ((options["profile-file"] || options["sparse-profile-file"]) && !serverIdentity) {
    throw new Error("--server-identity is required when profile files are supplied");
  }
  const completeProfile = await readProfile(options["profile-file"], "--profile-file", "complete", serverIdentity)
    ?? (fixtureOnly ? fixtureProfile(serverIdentity, false) : null);
  const sparseProfile = await readProfile(options["sparse-profile-file"], "--sparse-profile-file", "sparse", serverIdentity)
    ?? (fixtureOnly ? fixtureProfile(serverIdentity, true) : null);
  if ((completeProfile && !sparseProfile) || (!completeProfile && sparseProfile)) {
    throw new Error("complete and sparse profile inputs must be supplied together");
  }
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryDirectory,
    encoding: "utf8",
  }).trim();
  const workerName = options["worker-name"] === undefined
    ? (fixtureOnly ? CANARY_WORKER_NAME : undefined)
    : assertCanonicalCanaryWorkerName(options["worker-name"].trim());
  const bindingValue = `canary-binding-${randomBytes(18).toString("base64url")}`;
  const trustRoot = options["trust-root-file"]
    ? (await readFile(resolve(options["trust-root-file"]))).toString("base64url")
    : fixture?.root_certificate_base64;
  const notaryRegistryRaw = fixtureOnly
    ? JSON.stringify({ [notaryKeyId]: fixture.notary_key_base64 })
    : await readNotaryRegistry(options["notary-registry-file"], notaryKeyId);
  const securityRegistrySet = notaryRegistryRaw && completeProfile && sparseProfile && serverIdentity
    ? securityRegistrySetHash({
        notaryKeyId,
        notaryRegistryRaw,
        profileSha256: completeProfile.sha256,
        serverIdentity,
        sparseProfileSha256: sparseProfile.sha256,
      })
    : null;
  const securityRegistrySetSha256 = securityRegistrySet?.sha256;
  const trustRootCertificateSha256 = trustRoot
    ? createHash("sha256").update(Buffer.from(trustRoot, "base64url")).digest("base64url")
    : null;
  const fixturePresentationSha256 = fixtureOnly
    ? sha256Base64Url(fixtureBytes(fixture.sparse_presentation_base64, "sparse_presentation_base64"))
    : null;
  const siteOrigin = fixtureOnly ? null : publicOrigin(
    process.env.PUBLIC_SITE_URL_PRODUCTION ?? process.env.PUBLIC_SITE_URL,
    "PUBLIC_SITE_URL",
  );
  const supabaseOrigin = fixtureOnly ? null : publicOrigin(process.env.PUBLIC_SUPABASE_URL, "PUBLIC_SUPABASE_URL");
  const deviceAuthUrl = siteOrigin
    ? `${siteOrigin.origin}/api/auth/anonymous-sync/v2/device-proof`
    : undefined;
  const devicePossessionAuthUrl = siteOrigin
    ? `${siteOrigin.origin}/api/auth/anonymous-sync/v2/tlsn-device-proof`
    : undefined;

  const generatedEnv = {
    TLSN_ENVIRONMENT: "production",
    TLSN_DEPLOYMENT_ROLE: "canary",
    TLSN_BINDING_TTL_SECONDS: "900",
    TLSN_GIT_COMMIT_SHA: commitSha,
    ...(notaryRegistryRaw ? { TLSN_PRODUCTION_NOTARY_REGISTRY: notaryRegistryRaw } : {}),
    ...(fixtureOnly
      ? { TLSN_CANARY_FIXTURE_ONLY: "true" }
      : { TLSN_CANARY_FIXTURE_ONLY: "false" }),
    ...(deploymentId ? { TLSN_CANARY_DEPLOYMENT_ID: deploymentId } : {}),
    TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI: result.publicKeySpki,
    TLSN_CANARY_RESULT_SIGNER_KEY_ID: resultKeyId,
    TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY: resultRegistryRaw,
    TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE: resultRegistryEnvelopeRaw,
    TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID: resultRootKeyId,
    TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI: resultRoot.publicKeySpki,
    ...(verifierPublicKeySpki ? {
      TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI: verifierPublicKeySpki,
    } : {}),
    ...(verifierDeploymentId ? {
      TLSN_CANARY_VERIFIER_DEPLOYMENT_ID: verifierDeploymentId,
    } : {}),
    TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: session.publicKeySpki,
    TLSN_CANARY_SESSION_AUTHORITY_KEY_ID: sessionKeyId,
    TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY: sessionRegistryRaw,
    TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI: binding.publicKeySpki,
    TLSN_CANARY_BINDING_AUTHORITY_KEY_ID: bindingKeyId,
    TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY: bindingRegistryRaw,
    ...(fixtureOnly ? { TLSN_CANARY_BINDING_IDENTITY: `canary-binding-${deploymentId}` } : {}),
    ...(process.env.TLSN_CANARY_BINDING_IDENTITY ? { TLSN_CANARY_BINDING_IDENTITY: process.env.TLSN_CANARY_BINDING_IDENTITY.trim() } : {}),
    TLSN_CANARY_BINDING_VALUE: bindingValue,
    ...(workerName ? { TLSN_CANARY_WORKER_NAME: workerName } : {}),
    ...(process.env.TLSN_CANARY_TRIGGER_API_URL ? { TLSN_CANARY_TRIGGER_API_URL: process.env.TLSN_CANARY_TRIGGER_API_URL.trim() } : {}),
    ...(process.env.TLSN_CANARY_TRIGGER_TASK_ID ? { TLSN_CANARY_TRIGGER_TASK_ID: process.env.TLSN_CANARY_TRIGGER_TASK_ID.trim() } : {}),
    ...(process.env.TLSN_CANARY_WORKER_INTERNAL_URL ? { TLSN_CANARY_WORKER_INTERNAL_URL: process.env.TLSN_CANARY_WORKER_INTERNAL_URL.trim() } : {}),
    TLSN_CANARY_SYNCHRONOUS_RESPONSE_ENABLED: "true",
    TLSN_BENCHMARK_TIMINGS: "true",
    ...(options["verifier-key-id"] || fixtureOnly ? {
      TLSN_CANDIDATE_VERIFIER_KEY_ID: options["verifier-key-id"] ?? "verifier-canary-2026",
    } : {}),
    ...(serverIdentity ? { TLSN_CANDIDATE_SERVER_IDENTITY: serverIdentity } : {}),
    ...(notaryKeyId ? { TLSN_CANDIDATE_NOTARY_KEY_ID: notaryKeyId } : {}),
    ...(securityRegistrySetSha256 ? { TLSN_SECURITY_REGISTRY_SET_SHA256: securityRegistrySetSha256 } : {}),
    TLSN_CANARY_TRIGGER_SECRET_KEY: randomSecret(),
    TLSN_CANARY_TRIGGER_CALLBACK_SECRET: randomSecret(),
    TLSN_CANARY_DIRECT_CALLBACK_SECRET: randomSecret(),
    ...(deviceAuthUrl ? {
      TLSN_CANDIDATE_DEVICE_AUTH_URL: deviceAuthUrl,
      TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL: devicePossessionAuthUrl,
      TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS: siteOrigin.hostname,
    } : {}),
    ...(supabaseOrigin && process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ? {
      TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS: supabaseOrigin.hostname,
      TLSN_CANDIDATE_SUPABASE_URL: `${supabaseOrigin.origin}/`,
      TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY: process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY.trim(),
    } : {}),
    ...(completeProfile ? { TLSN_CANDIDATE_PROFILE_SHA256: completeProfile.sha256 } : {}),
    ...(sparseProfile ? { TLSN_CANDIDATE_SPARSE_PROFILE_SHA256: sparseProfile.sha256 } : {}),
    ...(trustRoot ? { TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER: trustRoot } : {}),
    ...(process.env.TLSN_WORKFLOW_RUN_ID ? { TLSN_WORKFLOW_RUN_ID: process.env.TLSN_WORKFLOW_RUN_ID.trim() } : {}),
    ...(process.env.TLSN_WORKFLOW_RUN_ATTEMPT ? { TLSN_WORKFLOW_RUN_ATTEMPT: process.env.TLSN_WORKFLOW_RUN_ATTEMPT.trim() } : {}),
    ...(process.env.TLSN_REPOSITORY ? { TLSN_REPOSITORY: process.env.TLSN_REPOSITORY.trim() } : {}),
    ...(process.env.TLSN_WORKFLOW_FILE_IDENTITY ? { TLSN_WORKFLOW_FILE_IDENTITY: process.env.TLSN_WORKFLOW_FILE_IDENTITY.trim() } : {}),
  };
  const privateFiles = {
    "canary-result-signing-private-key.pkcs8.base64url": `${result.privateKeyPkcs8}\n`,
    "canary-session-authority-private-key.pkcs8.base64url": `${session.privateKeyPkcs8}\n`,
    "canary-binding-authority-private-key.pkcs8.base64url": `${binding.privateKeyPkcs8}\n`,
    "canary.env": `${Object.entries(generatedEnv).map(([name, value]) => writeEnvValue(name, value)).join("\n")}\n`,
  };
  for (const [name, content] of Object.entries(privateFiles)) {
    const path = join(outputDirectory, name);
    await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
    await chmod(path, 0o600);
  }
  if (completeProfile) await writeFile(join(outputDirectory, "complete-profile.canonical.json"), `${completeProfile.canonical}\n`, { mode: 0o644 });
  if (sparseProfile) await writeFile(join(outputDirectory, "sparse-profile.canonical.json"), `${sparseProfile.canonical}\n`, { mode: 0o644 });
  if (trustRoot) await writeFile(join(outputDirectory, "trust-root.der"), Buffer.from(trustRoot, "base64url"), { mode: 0o644 });

  const fixtureProvenanceValue = fixtureOnly
    ? fixtureProvenance(fixtureManifest, fixtureEntry, fixture)
    : null;

  const unresolvedInputs = [
    "TLSN_CANARY_DEPLOYMENT_ID",
    "TLSN_CANARY_WORKER_NAME",
    "TLSN_PRODUCTION_NOTARY_REGISTRY",
    "TLSN_WORKFLOW_RUN_ID",
    "TLSN_WORKFLOW_RUN_ATTEMPT",
    "TLSN_REPOSITORY",
    "TLSN_WORKFLOW_FILE_IDENTITY",
    "TLSN_CANDIDATE_VERIFIER_KEY_ID",
    "TLSN_CANDIDATE_DEVICE_AUTH_URL",
    "TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL",
    "TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS",
    "TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS",
    "TLSN_CANDIDATE_SUPABASE_URL",
    "TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY",
    "TLSN_SECURITY_REGISTRY_SET_SHA256",
    "TLSN_CANARY_TRIGGER_API_URL",
    "TLSN_CANARY_TRIGGER_TASK_ID",
    "TLSN_CANARY_WORKER_INTERNAL_URL",
    "TLSN_CANARY_VERIFIER_PUBLIC_KEY_SPKI",
    "TLSN_CANARY_VERIFIER_DEPLOYMENT_ID",
  ].filter((name) => generatedEnv[name] === undefined);
  if (!generatedEnv.TLSN_CANDIDATE_SERVER_IDENTITY) unresolvedInputs.push("TLSN_CANDIDATE_SERVER_IDENTITY");
  if (!generatedEnv.TLSN_CANDIDATE_VERIFIER_KEY_ID) unresolvedInputs.push("TLSN_CANDIDATE_VERIFIER_KEY_ID");
  if (!generatedEnv.TLSN_CANDIDATE_NOTARY_KEY_ID) unresolvedInputs.push("TLSN_CANDIDATE_NOTARY_KEY_ID");
  if (!generatedEnv.TLSN_CANDIDATE_PROFILE_SHA256) unresolvedInputs.push("TLSN_CANDIDATE_PROFILE_SHA256");
  if (!generatedEnv.TLSN_CANDIDATE_SPARSE_PROFILE_SHA256) unresolvedInputs.push("TLSN_CANDIDATE_SPARSE_PROFILE_SHA256");
  if (!generatedEnv.TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER) unresolvedInputs.push("TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER");
  if (!generatedEnv.TLSN_CANARY_DEPLOYMENT_ID) unresolvedInputs.push("TLSN_CANARY_DEPLOYMENT_ID");
  if (!generatedEnv.TLSN_CANARY_WORKER_NAME) unresolvedInputs.push("TLSN_CANARY_WORKER_NAME");
  if (!generatedEnv.TLSN_PRODUCTION_NOTARY_REGISTRY) unresolvedInputs.push("TLSN_PRODUCTION_NOTARY_REGISTRY");
  if (!fixtureOnly && unresolvedInputs.length === 0) {
    const artifactFiles = [
      ...(completeProfile ? [{ name: "complete-profile", path: "complete-profile.canonical.json" }] : []),
      ...(sparseProfile ? [{ name: "sparse-profile", path: "sparse-profile.canonical.json" }] : []),
      ...(trustRoot ? [{ name: "trust-root", path: "trust-root.der" }] : []),
    ];
    const artifacts = [];
    for (const artifact of artifactFiles) {
      const bytes = await readFile(join(outputDirectory, artifact.path));
      artifacts.push({ name: artifact.name, path: artifact.path, sha256: sha256Base64Url(bytes) });
    }
    const deploymentManifest = createCanaryDeploymentManifest({
      environment: generatedEnv,
      currentHead: commitSha,
      artifacts,
      secretProviderReferences: [
        "TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8",
        "TLSN_CANARY_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
        "TLSN_CANARY_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8",
        "TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER",
        "TLSN_CANARY_TRIGGER_SECRET_KEY",
        "TLSN_CANARY_TRIGGER_CALLBACK_SECRET",
        "TLSN_CANARY_DIRECT_CALLBACK_SECRET",
      ].map((inputName) => ({ input_name: inputName, provider_ref: `deployment-secret/${inputName}` })),
    });
    const manifestPath = join(outputDirectory, "canary-deployment-manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(deploymentManifest, null, 2)}\n`, { mode: 0o644 });
    generatedEnv.TLSN_CANARY_DEPLOYMENT_MANIFEST = manifestPath;
    await writeFile(join(outputDirectory, "canary.env"), `${Object.entries(generatedEnv).map(([name, value]) => writeEnvValue(name, value)).join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  }
  const manifest = {
    schema_version: 1,
    artifact: "tlsn-canary-provisioning",
    mode: fixtureOnly ? "fixture-only" : "supplied",
    status: unresolvedInputs.length === 0 ? "complete" : "incomplete",
    generated_at: new Date().toISOString(),
    commit_sha: commitSha,
    output_directory: outputDirectory,
    notary: {
      key_id: notaryKeyId ?? null,
      registry_sha256: notaryRegistryRaw ? notaryRegistrySha256(notaryRegistryRaw) : null,
      source: fixtureOnly
        ? "embedded_fixture_presentation"
        : notaryRegistryRaw
          ? "explicit_input_file"
          : "unresolved_explicit_input",
    },
    security_registry_set_sha256: securityRegistrySetSha256 ?? null,
    security_registry_set_source: securityRegistrySetSha256
      ? "derived-from-explicit-inputs"
      : "unresolved-explicit-inputs",
    fixture_provenance: fixtureProvenanceValue,
    generated_public_identity: {
      deployment_id: deploymentId ?? null,
      worker_name: workerName ?? null,
      result_signer_key_id: resultKeyId,
      result_registry_root_key_id: resultRootKeyId,
      session_authority_key_id: sessionKeyId,
      binding_authority_key_id: bindingKeyId,
      key_id_strategy: "deployment-id-plus-public-key-sha256-prefix",
    },
    supplied_candidate_inputs: {
      server_identity: generatedEnv.TLSN_CANDIDATE_SERVER_IDENTITY ?? null,
      profile_sha256: generatedEnv.TLSN_CANDIDATE_PROFILE_SHA256 ?? null,
      sparse_profile_sha256: generatedEnv.TLSN_CANDIDATE_SPARSE_PROFILE_SHA256 ?? null,
      trust_root_sha256: trustRoot ? createHash("sha256").update(Buffer.from(trustRoot, "base64url")).digest("base64url") : null,
    },
    profile_contract: completeProfile && sparseProfile
      ? profileContractArtifact({
          serverIdentity,
          profileSha256: completeProfile.sha256,
          sparseProfileSha256: sparseProfile.sha256,
          disclosureMode: "full|sparse",
          responseModeCapabilities: ["async", "sync"],
        })
      : null,
    canary_contract: {
      environment: "production",
      deployment_role: "canary",
      fixture_only: fixtureOnly,
      response_mode_capabilities: ["async", "sync"],
      profile_hashes_exact: completeProfile && sparseProfile
        ? {
            complete: completeProfile.sha256,
            sparse: sparseProfile.sha256,
          }
        : null,
    },
    unresolved_inputs: [...new Set(unresolvedInputs)],
    secret_values_written: true,
    secret_values_in_manifest: false,
  };
  await writeFile(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  console.log(JSON.stringify({ status: manifest.status, output: outputDirectory, unresolved_inputs: manifest.unresolved_inputs }, null, 2));
}

main().catch((error) => {
  console.error(`[tlsn-provision-canary] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});