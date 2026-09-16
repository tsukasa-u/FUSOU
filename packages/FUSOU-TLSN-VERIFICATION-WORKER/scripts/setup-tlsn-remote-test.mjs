#!/usr/bin/env node

import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { packageDirectory } from "./tlsn-benchmark-fixtures.mjs";

const repositoryDirectory = resolve(packageDirectory, "../..");
const proxyManifest = resolve(
  repositoryDirectory,
  "packages/FUSOU-PROXY/proxy-https/Cargo.toml",
);

const outputPath = resolve(
  packageDirectory,
  process.env.TLSN_REMOTE_BENCHMARK_ENV_FILE ?? ".cache/tlsn-remote-test.env",
);
const REMOTE_BENCHMARK_BINDING_TTL_SECONDS = "900";
const force = process.argv.includes("--force");

function captureJson(command, argumentsList, cwd, env = process.env) {
  const result = spawnSync(command, argumentsList, {
    cwd,
    encoding: "utf8",
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status ?? "unknown status"}`);
  }
  const output = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!output) throw new Error(`${command} produced no JSON output`);
  return JSON.parse(output);
}

function keyMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeySpkiBytes = publicKey.export({ format: "der", type: "spki" });
  return {
    privateKeyPkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    publicKeySpki: publicKeySpkiBytes.toString("base64url"),
    publicKeyRaw: publicKeySpkiBytes.subarray(-32).toString("base64url"),
  };
}

function keyRegistry(scope, keyId, publicKeySpki) {
  return JSON.stringify({
    schema_version: 1,
    scope,
    keys: [{
      key_id: keyId,
      public_key_spki: publicKeySpki,
      status: "ACTIVE",
      not_before: "2026-01-01T00:00:00.000Z",
      not_after: null,
    }],
  });
}

function envLine(name, value) {
  return `${name}=${value ?? ""}`;
}

async function main() {
  try {
    await stat(outputPath);
    if (!force) {
      throw new Error(`refusing to overwrite existing file: ${outputPath} (use --force to rotate it)`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const syntheticRootKey = keyMaterial();
  const syntheticFixture = captureJson(
    "cargo",
    [
      "+1.95.0",
      "run",
      "--quiet",
      "--manifest-path",
      proxyManifest,
      "--features",
      "synthetic-tlsn",
      "--example",
      "synthetic_tlsn_fixture",
    ],
    repositoryDirectory,
    {
      ...process.env,
      FUSOU_SYNTHETIC_ROOT_KEY_PKCS8: syntheticRootKey.privateKeyPkcs8,
    },
  );
  const resultSigning = keyMaterial();
  const sessionAuthority = keyMaterial();
  const bindingAuthority = keyMaterial();
  const device = keyMaterial();
  const token = `tlsn-test-${randomBytes(24).toString("base64url")}`;
  const userId = randomUUID();
  const deviceId = randomUUID();
  const authUsers = JSON.stringify({
    [token]: { id: userId, is_anonymous: false },
  });
  const sessionAuthorityKeyId = "session-authority-test";
  const bindingAuthorityKeyId = "binding-authority-test";
  const callbackSecret = randomBytes(32).toString("base64url");
  const profileSha256 = Buffer.alloc(32).toString("base64url");
  const sparseProfileSha256 = Buffer.alloc(32, 9).toString("base64url");
  const notaryRegistry = JSON.stringify({ "notary-test": syntheticFixture.notary_key_base64 });
  const triggerSecretKey = process.env.TLSN_TRIGGER_SECRET_KEY?.trim() ?? "";
  const triggerProjectRef = process.env.TRIGGER_PROJECT_REF?.trim() ?? "proj_lmzecjnplfmdbugpacax";
  const workerUrl = process.env.TLSN_REMOTE_BENCHMARK_WORKER_URL?.trim() ?? "";
  const content = [
    "# Generated test-only credentials. Keep mode 0600 and do not commit.",
    envLine("TLSN_REMOTE_AUTH_MODE", "test"),
    envLine("TLSN_ENVIRONMENT", "test"),
    envLine("TLSN_BINDING_TTL_SECONDS", REMOTE_BENCHMARK_BINDING_TTL_SECONDS),
    envLine("TLSN_SERVER_IDENTITY", "game.example.test"),
    envLine("TLSN_PROFILE_SHA256", profileSha256),
    envLine("TLSN_SPARSE_PROFILE_SHA256", sparseProfileSha256),
    envLine("TLSN_VERIFIER_KEY_ID", "worker-test"),
    envLine("TLSN_NOTARY_KEY_ID", "notary-test"),
    envLine("TLSN_NOTARY_REGISTRY", notaryRegistry),
    envLine("TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8", resultSigning.privateKeyPkcs8),
    envLine("TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8", sessionAuthority.privateKeyPkcs8),
    envLine("TLSN_SESSION_AUTHORITY_PUBLIC_KEY_SPKI", sessionAuthority.publicKeySpki),
    envLine("TLSN_SESSION_AUTHORITY_KEY_ID", sessionAuthorityKeyId),
    envLine("TLSN_SESSION_AUTHORITY_KEY_REGISTRY", keyRegistry("tlsn-session-authority-key-registry", sessionAuthorityKeyId, sessionAuthority.publicKeySpki)),
    envLine("TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8", bindingAuthority.privateKeyPkcs8),
    envLine("TLSN_BINDING_AUTHORITY_PUBLIC_KEY_SPKI", bindingAuthority.publicKeySpki),
    envLine("TLSN_BINDING_AUTHORITY_KEY_ID", bindingAuthorityKeyId),
    envLine("TLSN_BINDING_AUTHORITY_KEY_REGISTRY", keyRegistry("tlsn-binding-authority-key-registry", bindingAuthorityKeyId, bindingAuthority.publicKeySpki)),
    envLine("TLSN_TRUST_ROOT_CERTIFICATE_DER", syntheticFixture.root_certificate_base64),
    envLine("FUSOU_SYNTHETIC_ROOT_KEY_PKCS8", syntheticRootKey.privateKeyPkcs8),
    envLine("TLSN_DEVICE_AUTH_URL", "https://tlsn-test-device-auth.invalid/device-proof"),
    envLine("TLSN_DEVICE_POSSESSION_AUTH_URL", "https://tlsn-test-device-auth.invalid/tlsn-device-proof"),
    envLine("TLSN_TEST_AUTH_USERS", authUsers),
    envLine("TLSN_TEST_DEVICE_ID", deviceId),
    envLine("TLSN_TEST_DEVICE_PUBLIC_KEY", device.publicKeyRaw),
    envLine("TLSN_EXECUTION_MODE", "trigger"),
    envLine("TLSN_TRIGGER_API_URL", "https://api.trigger.dev"),
    envLine("TLSN_TRIGGER_TASK_ID", "tlsn-verify-presentation"),
    envLine("TLSN_TRIGGER_SECRET_KEY", triggerSecretKey),
    envLine("TLSN_TRIGGER_CALLBACK_SECRET", callbackSecret),
    envLine("TLSN_WORKER_INTERNAL_URL", workerUrl),
    envLine("TRIGGER_PROJECT_REF", triggerProjectRef),
    envLine("TLSN_TRIGGER_SERVER_IDENTITY", "game.example.test"),
    envLine("TLSN_TRIGGER_PROFILE_SHA256", profileSha256),
    envLine("TLSN_TRIGGER_SPARSE_PROFILE_SHA256", sparseProfileSha256),
    envLine("TLSN_TRIGGER_VERIFIER_KEY_ID", "worker-test"),
    envLine("TLSN_TRIGGER_NOTARY_KEY_ID", "notary-test"),
    envLine("TLSN_TRIGGER_NOTARY_REGISTRY", notaryRegistry),
    envLine("TLSN_TRIGGER_TRUST_ROOT_CERTIFICATE_DER", syntheticFixture.root_certificate_base64),
    envLine("TLSN_BENCHMARK_TIMINGS", "true"),
    envLine("TLSN_REMOTE_BENCHMARK_WORKER_URL", workerUrl),
    envLine("TLSN_REMOTE_ACCESS_TOKEN_A", token),
    envLine("TLSN_REMOTE_DEVICE_ID_A", deviceId),
    envLine("TLSN_REMOTE_DEVICE_A_PRIVATE_KEY_PKCS8_B64URL", device.privateKeyPkcs8),
    "",
  ].join("\n");

  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, content, { encoding: "utf8", mode: 0o600 });
  await chmod(outputPath, 0o600);
  console.log(`[tlsn-remote-test-setup] generated test-only credentials at ${outputPath}`);
  console.log("[tlsn-remote-test-setup] generated Worker/Trigger test configuration without a network request");
  if (!triggerSecretKey) {
    console.log("[tlsn-remote-test-setup] TLSN_TRIGGER_SECRET_KEY is empty; provide the Trigger project secret before deployment");
  }
  console.log("[tlsn-remote-test-setup] set TLSN_REMOTE_BENCHMARK_WORKER_URL after deployment");
}

main().catch((error) => {
  console.error(`[tlsn-remote-test-setup] ${error instanceof Error ? error.message : "generation_failed"}`);
  process.exitCode = 2;
});
