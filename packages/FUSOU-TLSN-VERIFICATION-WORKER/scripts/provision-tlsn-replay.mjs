#!/usr/bin/env node

import { createPrivateKey, createPublicKey, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const outputPath = resolve(
  packageDirectory,
  process.env.TLSN_REPLAY_ENV_FILE ?? ".cache/tlsn-replay.env",
);
const force = process.argv.includes("--force");
const encodedJsonNames = new Set([
  "TLSN_NOTARY_REGISTRY",
  "TLSN_SESSION_AUTHORITY_KEY_REGISTRY",
  "TLSN_BINDING_AUTHORITY_KEY_REGISTRY",
  "TLSN_REPLAY_AUTH_USERS",
]);

function runSetup(sourcePath) {
  const result = spawnSync(
    process.execPath,
    [resolve(packageDirectory, "scripts/setup-tlsn-remote-test.mjs"), "--force"],
    {
      cwd: packageDirectory,
      env: { ...process.env, TLSN_REMOTE_BENCHMARK_ENV_FILE: sourcePath },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function parseEnv(content) {
  const values = new Map();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) throw new Error("synthetic credential output contains an invalid line");
    values.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  return values;
}

function required(values, name) {
  const value = values.get(name)?.trim();
  if (!value) throw new Error(`synthetic credential output is missing ${name}`);
  return value;
}

function createBindingValue() {
  const prefix = Buffer.from("FUSOU-ATTESTATION-BINDING-V1\0");
  const sessionId = Buffer.from(randomUUID().replaceAll("-", ""), "hex");
  const nonce = randomBytes(32);
  const binding = Buffer.alloc(prefix.length + 2 + sessionId.length + 2 + nonce.length);
  let offset = 0;
  prefix.copy(binding, offset);
  offset += prefix.length;
  binding.writeUInt16BE(sessionId.length, offset);
  offset += 2;
  sessionId.copy(binding, offset);
  offset += sessionId.length;
  binding.writeUInt16BE(nonce.length, offset);
  offset += 2;
  nonce.copy(binding, offset);
  return binding.toString("base64url");
}

function isCanonicalBindingValue(value) {
  try {
    const bytes = Buffer.from(value, "base64url");
    const prefix = Buffer.from("FUSOU-ATTESTATION-BINDING-V1\0");
    const expectedLength = prefix.length + 2 + 16 + 2 + 32;
    return bytes.length === expectedLength
      && bytes.toString("base64url") === value
      && bytes.subarray(0, prefix.length).equals(prefix)
      && bytes.readUInt16BE(prefix.length) === 16
      && bytes.readUInt16BE(prefix.length + 2 + 16) === 32;
  } catch {
    return false;
  }
}

function formatEnvValue(name, value) {
  if (encodedJsonNames.has(name)) {
    return `base64json:${Buffer.from(value).toString("base64url")}`;
  }
  if (value.includes("'")) {
    throw new Error("generated replay env values must not contain single quotes");
  }
  return `'${value}'`;
}

function gitCommitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: resolve(packageDirectory, "../.."),
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error("unable to resolve current git commit");
  }
  return result.stdout.trim();
}

async function main() {
  try {
    await stat(outputPath);
    if (!force) throw new Error(`refusing to overwrite ${outputPath}; use --force to rotate replay material`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "fusou-tlsn-replay-source-"));
  const sourcePath = join(temporaryDirectory, "synthetic.env");
  try {
    runSetup(sourcePath);
    const generated = parseEnv(await readFile(sourcePath, "utf8"));
    const commitSha = gitCommitSha();
    const deploymentId = process.env.TLSN_REPLAY_DEPLOYMENT_ID?.trim() || `replay-${commitSha.slice(0, 12)}`;
    const workerName = process.env.TLSN_REPLAY_WORKER_NAME?.trim() || "fusou-tlsn-verification-replay";
    const bindingValue = process.env.TLSN_REPLAY_BINDING_VALUE?.trim() || createBindingValue();
    if (!isCanonicalBindingValue(bindingValue)) {
      throw new Error("TLSN_REPLAY_BINDING_VALUE must be a canonical fixed binding value");
    }
    const authOrigin = "https://replay-auth.synthetic.local";
    const output = new Map([
      ["TLSN_ENVIRONMENT", "test"],
      ["TLSN_DEPLOYMENT_ROLE", "replay"],
      ["TLSN_EXECUTION_MODE", "direct"],
      ["TLSN_BENCHMARK_TIMINGS", "true"],
      ["TLSN_GIT_COMMIT_SHA", commitSha],
      ["TLSN_BINDING_TTL_SECONDS", required(generated, "TLSN_BINDING_TTL_SECONDS")],
      ["TLSN_SERVER_IDENTITY", required(generated, "TLSN_SERVER_IDENTITY")],
      ["TLSN_PROFILE_SHA256", required(generated, "TLSN_PROFILE_SHA256")],
      ["TLSN_SPARSE_PROFILE_SHA256", required(generated, "TLSN_SPARSE_PROFILE_SHA256")],
      ["TLSN_VERIFIER_KEY_ID", required(generated, "TLSN_VERIFIER_KEY_ID")],
      ["TLSN_NOTARY_KEY_ID", required(generated, "TLSN_NOTARY_KEY_ID")],
      ["TLSN_NOTARY_REGISTRY", required(generated, "TLSN_NOTARY_REGISTRY")],
      ["TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8", required(generated, "TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8")],
      ["TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8", required(generated, "TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8")],
      ["TLSN_SESSION_AUTHORITY_PUBLIC_KEY_SPKI", required(generated, "TLSN_SESSION_AUTHORITY_PUBLIC_KEY_SPKI")],
      ["TLSN_SESSION_AUTHORITY_KEY_ID", required(generated, "TLSN_SESSION_AUTHORITY_KEY_ID")],
      ["TLSN_SESSION_AUTHORITY_KEY_REGISTRY", required(generated, "TLSN_SESSION_AUTHORITY_KEY_REGISTRY")],
      ["TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8", required(generated, "TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8")],
      ["TLSN_BINDING_AUTHORITY_PUBLIC_KEY_SPKI", required(generated, "TLSN_BINDING_AUTHORITY_PUBLIC_KEY_SPKI")],
      ["TLSN_BINDING_AUTHORITY_KEY_ID", required(generated, "TLSN_BINDING_AUTHORITY_KEY_ID")],
      ["TLSN_BINDING_AUTHORITY_KEY_REGISTRY", required(generated, "TLSN_BINDING_AUTHORITY_KEY_REGISTRY")],
      ["TLSN_TRUST_ROOT_CERTIFICATE_DER", required(generated, "TLSN_TRUST_ROOT_CERTIFICATE_DER")],
      ["TLSN_DIRECT_CALLBACK_SECRET", required(generated, "TLSN_TRIGGER_CALLBACK_SECRET")],
      ["FUSOU_SYNTHETIC_ROOT_KEY_PKCS8", required(generated, "FUSOU_SYNTHETIC_ROOT_KEY_PKCS8")],
      ["TLSN_REPLAY_ENVIRONMENT_CONFIRMATION", "non-production-synthetic"],
      ["TLSN_REPLAY_DEPLOYMENT_ID", deploymentId],
      ["TLSN_REPLAY_WORKER_NAME", workerName],
      ["TLSN_REPLAY_BINDING_VALUE", bindingValue],
      ["TLSN_REPLAY_SUPABASE_URL", authOrigin],
      ["TLSN_REPLAY_SUPABASE_PUBLISHABLE_KEY", "replay-synthetic-publishable-key"],
      ["TLSN_REPLAY_DEVICE_AUTH_URL", `${authOrigin}/api/auth/anonymous-sync/v2/device-proof`],
      ["TLSN_REPLAY_DEVICE_POSSESSION_AUTH_URL", `${authOrigin}/api/auth/anonymous-sync/v2/tlsn-device-proof`],
      ["TLSN_REPLAY_AUTH_USERS", required(generated, "TLSN_TEST_AUTH_USERS")],
      ["TLSN_REPLAY_DEVICE_ID", required(generated, "TLSN_TEST_DEVICE_ID")],
      ["TLSN_REPLAY_DEVICE_PUBLIC_KEY", required(generated, "TLSN_TEST_DEVICE_PUBLIC_KEY")],
      ["TLSN_REPLAY_ACCESS_TOKEN", required(generated, "TLSN_REMOTE_ACCESS_TOKEN_A")],
      ["TLSN_REPLAY_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL", required(generated, "TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL")],
      ["TLSN_REPLAY_RESULT_PUBLIC_KEY_SPKI", createPublicKey(createPrivateKey({
        key: Buffer.from(required(generated, "TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8"), "base64url"),
        format: "der",
        type: "pkcs8",
      })).export({ format: "der", type: "spki" }).toString("base64url")],
      ["TLSN_REPLAY_RESULT_SIGNER_KEY_ID", required(generated, "TLSN_VERIFIER_KEY_ID")],
    ]);

    await writeFile(
      outputPath,
      `${[...output].map(([name, value]) => `${name}=${formatEnvValue(name, value)}`).join("\n")}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await chmod(outputPath, 0o600);
    console.log(`[tlsn-replay-provisioning] generated isolated replay material at ${outputPath}`);
    console.log(`[tlsn-replay-provisioning] mapped synthetic generator output into replay namespace for ${deploymentId}`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[tlsn-replay-provisioning] ${error instanceof Error ? error.message : "provisioning_failed"}`);
  process.exitCode = 2;
});
