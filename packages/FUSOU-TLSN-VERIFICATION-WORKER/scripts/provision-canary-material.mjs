#!/usr/bin/env node

import { createECDH, createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { createSignedResultRegistryEnvelope } from "./result-registry-envelope.mjs";
import { canonicalJson } from "./production-trust-contract.mjs";
import { loadRealFixture, readRealFixtureManifest } from "./tlsn-benchmark-fixtures.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const repositoryDirectory = resolve(packageDirectory, "../..");
const SYNTHETIC_SERVER_IDENTITY = "game.example.test";
const REQUIRE_INFO_TARGET = "/kcsapi/api_get_member/require_info";

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
    "  --trust-root-file FILE       DER trust root for the candidate origin",
    "  --notary-key-id ID            generated Notary key ID",
    "  --verifier-key-id ID         candidate verifier key ID",
    "  --deployment-id ID            generated canary deployment ID",
    "  --worker-name NAME            generated canary Worker name",
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

function notaryKeyMaterial() {
  const ecdh = createECDH("secp256k1");
  ecdh.generateKeys();
  const privateKey = ecdh.getPrivateKey();
  const compressedPublicKey = ecdh.getPublicKey(undefined, "compressed");
  const serializedVerifyingKey = Buffer.alloc(42);
  serializedVerifyingKey[0] = 1;
  serializedVerifyingKey.writeBigUInt64LE(33n, 1);
  compressedPublicKey.copy(serializedVerifyingKey, 9);
  return {
    privateKeyBase64url: privateKey.toString("base64url"),
    verifyingKeyBase64url: serializedVerifyingKey.toString("base64url"),
  };
}

function randomSecret() {
  return randomBytes(32).toString("base64url");
}

function profileHash(document) {
  const canonical = canonicalJson(document);
  return {
    canonical,
    sha256: createHash("sha256").update(canonical).digest("base64url"),
  };
}

function fixtureProfile(serverIdentity, sparse) {
  return profileHash(sparse
    ? {
        disclosure_mode: "sparse",
        id: "fusou-require-info-v2-sparse",
        server_identity: serverIdentity,
        target: REQUIRE_INFO_TARGET,
        version: 2,
      }
    : {
        id: "fusou-require-info-v1",
        server_identity: serverIdentity,
        target: REQUIRE_INFO_TARGET,
      });
}

async function readProfile(path, label) {
  if (!path) return null;
  let parsed;
  try {
    parsed = JSON.parse(await readFile(resolve(path), "utf8"));
  } catch (error) {
    throw new Error(`${label} must be readable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return profileHash(parsed);
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
  let fixture;
  if (fixtureOnly) {
    if (options["server-identity"] && options["server-identity"] !== SYNTHETIC_SERVER_IDENTITY) {
      throw new Error(`fixture-only canary must use ${SYNTHETIC_SERVER_IDENTITY}`);
    }
    const { entries } = readRealFixtureManifest();
    const fixtureCase = options["fixture-case"] ?? "p50";
    const entry = entries.get(fixtureCase);
    if (!entry) throw new Error(`unknown synthetic fixture case: ${fixtureCase}`);
    fixture = loadRealFixture(entry);
    for (const field of ["sparse_presentation_base64", "root_certificate_base64", "notary_key_base64"]) {
      if (typeof fixture[field] !== "string" || fixture[field].length === 0) {
        throw new Error(`synthetic fixture is missing ${field}`);
      }
    }
  }

  const outputDirectory = resolve(options.output);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await chmod(outputDirectory, 0o700);

  const notary = fixtureOnly ? null : notaryKeyMaterial();
  const notaryKeyId = options["notary-key-id"] ?? "notary-canary-2026";
  const result = keyMaterial();
  const resultRoot = keyMaterial();
  const session = keyMaterial();
  const binding = keyMaterial();
  const resultKeyId = "result-canary-2026";
  const resultRootKeyId = "result-registry-root-canary-2026";
  const sessionKeyId = "session-canary-2026";
  const bindingKeyId = "binding-canary-2026";
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
  const serverIdentity = options["server-identity"] ?? (fixtureOnly ? SYNTHETIC_SERVER_IDENTITY : undefined);
  const completeProfile = await readProfile(options["profile-file"], "--profile-file")
    ?? (fixtureOnly ? fixtureProfile(serverIdentity, false) : null);
  const sparseProfile = await readProfile(options["sparse-profile-file"], "--sparse-profile-file")
    ?? (fixtureOnly ? fixtureProfile(serverIdentity, true) : null);
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryDirectory,
    encoding: "utf8",
  }).trim();
  const deploymentId = options["deployment-id"] ?? `canary-${new Date().toISOString().replace(/[-:.TZ]/g, "")}`;
  const workerName = options["worker-name"] ?? "fusou-tlsn-verification-canary";
  const bindingValue = `canary-binding-${randomBytes(18).toString("base64url")}`;
  const trustRoot = options["trust-root-file"]
    ? (await readFile(resolve(options["trust-root-file"]))).toString("base64url")
    : fixture?.root_certificate_base64;
  const notaryRegistryKey = fixture?.notary_key_base64 ?? notary?.verifyingKeyBase64url;
  const notaryRegistryRaw = JSON.stringify({ [notaryKeyId]: notaryRegistryKey });
  const securityRegistrySetSha256 = fixtureOnly
    ? createHash("sha256").update(canonicalJson({
        notary_registry: JSON.parse(notaryRegistryRaw),
        profile_sha256: completeProfile?.sha256,
        server_identity: serverIdentity,
        sparse_profile_sha256: sparseProfile?.sha256,
      })).digest("base64url")
    : undefined;
  const siteOrigin = publicOrigin(
    process.env.PUBLIC_SITE_URL_PRODUCTION ?? process.env.PUBLIC_SITE_URL,
    "PUBLIC_SITE_URL",
  );
  const supabaseOrigin = publicOrigin(process.env.PUBLIC_SUPABASE_URL, "PUBLIC_SUPABASE_URL");
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
    TLSN_PRODUCTION_NOTARY_REGISTRY: notaryRegistryRaw,
    ...(fixtureOnly ? { TLSN_CANARY_FIXTURE_ONLY: "true" } : {}),
    TLSN_CANARY_DEPLOYMENT_ID: deploymentId,
    TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI: result.publicKeySpki,
    TLSN_CANARY_RESULT_SIGNER_KEY_ID: resultKeyId,
    TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY: resultRegistryRaw,
    TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE: resultRegistryEnvelopeRaw,
    TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID: resultRootKeyId,
    TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI: resultRoot.publicKeySpki,
    TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: session.publicKeySpki,
    TLSN_CANARY_SESSION_AUTHORITY_KEY_ID: sessionKeyId,
    TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY: sessionRegistryRaw,
    TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI: binding.publicKeySpki,
    TLSN_CANARY_BINDING_AUTHORITY_KEY_ID: bindingKeyId,
    TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY: bindingRegistryRaw,
    TLSN_CANARY_BINDING_VALUE: bindingValue,
    TLSN_CANARY_WORKER_NAME: workerName,
    TLSN_CANARY_SYNCHRONOUS_RESPONSE_ENABLED: "true",
    TLSN_BENCHMARK_TIMINGS: "true",
    ...(options["verifier-key-id"] || fixtureOnly ? {
      TLSN_CANDIDATE_VERIFIER_KEY_ID: options["verifier-key-id"] ?? "verifier-canary-2026",
    } : {}),
    ...(serverIdentity ? { TLSN_CANDIDATE_SERVER_IDENTITY: serverIdentity } : {}),
    ...(fixtureOnly ? { TLSN_CANDIDATE_NOTARY_KEY_ID: notaryKeyId } : {}),
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
  };
  const privateFiles = {
    ...(notary ? { "notary-signing-key.base64url": `${notary.privateKeyBase64url}\n` } : {}),
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

  const unresolvedInputs = [
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
  ].filter((name) => generatedEnv[name] === undefined);
  if (!generatedEnv.TLSN_CANDIDATE_SERVER_IDENTITY) unresolvedInputs.push("TLSN_CANDIDATE_SERVER_IDENTITY");
  if (!generatedEnv.TLSN_CANDIDATE_VERIFIER_KEY_ID) unresolvedInputs.push("TLSN_CANDIDATE_VERIFIER_KEY_ID");
  if (!generatedEnv.TLSN_CANDIDATE_NOTARY_KEY_ID) unresolvedInputs.push("TLSN_CANDIDATE_NOTARY_KEY_ID");
  if (!generatedEnv.TLSN_CANDIDATE_PROFILE_SHA256) unresolvedInputs.push("TLSN_CANDIDATE_PROFILE_SHA256");
  if (!generatedEnv.TLSN_CANDIDATE_SPARSE_PROFILE_SHA256) unresolvedInputs.push("TLSN_CANDIDATE_SPARSE_PROFILE_SHA256");
  if (!generatedEnv.TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER) unresolvedInputs.push("TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER");
  const manifest = {
    schema_version: 1,
    artifact: "tlsn-canary-provisioning",
    status: unresolvedInputs.length === 0 ? "complete" : "incomplete",
    generated_at: new Date().toISOString(),
    commit_sha: commitSha,
    output_directory: outputDirectory,
    notary: {
      key_id: notaryKeyId,
      registry_sha256: createHash("sha256").update(generatedEnv.TLSN_PRODUCTION_NOTARY_REGISTRY).digest("base64url"),
      source: fixtureOnly ? "embedded_fixture_presentation" : "generated_canary_material",
      ...(notary ? { private_key_file: "notary-signing-key.base64url" } : {}),
    },
    generated_public_identity: {
      deployment_id: deploymentId,
      worker_name: workerName,
      result_signer_key_id: resultKeyId,
      session_authority_key_id: sessionKeyId,
      binding_authority_key_id: bindingKeyId,
    },
    supplied_candidate_inputs: {
      server_identity: generatedEnv.TLSN_CANDIDATE_SERVER_IDENTITY ?? null,
      profile_sha256: generatedEnv.TLSN_CANDIDATE_PROFILE_SHA256 ?? null,
      sparse_profile_sha256: generatedEnv.TLSN_CANDIDATE_SPARSE_PROFILE_SHA256 ?? null,
      trust_root_sha256: trustRoot ? createHash("sha256").update(Buffer.from(trustRoot, "base64url")).digest("base64url") : null,
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