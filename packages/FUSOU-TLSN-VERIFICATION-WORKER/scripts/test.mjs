#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, verify as verifySignature } from "node:crypto";
import { createServer } from "node:http";
import { unstable_dev } from "wrangler";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = resolve(packageDirectory, "../..");
const proxyManifest = resolve(
  repositoryDirectory,
  "packages/FUSOU-PROXY/proxy-https/Cargo.toml",
);
const repositoryNodeModules = resolve(packageDirectory, "../../node_modules/.bin");
const typescript = resolve(
  repositoryNodeModules,
  process.platform === "win32" ? "tsc.cmd" : "tsc",
);

function run(command, argumentsList) {
  const result = spawnSync(command, argumentsList, {
    cwd: packageDirectory,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command, argumentsList, cwd) {
  const result = spawnSync(command, argumentsList, {
    cwd,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  const outputLines = result.stdout.trim().split(/\r?\n/);
  return JSON.parse(outputLines.at(-1));
}

function pushLengthPrefixed(chunks, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  chunks.push(length, bytes);
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url");
}

function tlsnDeviceProofMessage(deviceId, sessionId, bindingValue, challenge) {
  const chunks = [Buffer.from("FUSOU-TLSN-DEVICE-PROOF-V1\0")];
  pushLengthPrefixed(chunks, deviceId);
  pushLengthPrefixed(chunks, sessionId);
  pushLengthPrefixed(chunks, bindingValue);
  pushLengthPrefixed(chunks, decodeBase64Url(challenge));
  return Buffer.concat(chunks);
}

run(process.execPath, ["scripts/build-wasm.mjs"]);
run(typescript, ["--noEmit", "--pretty", "false"]);

const syntheticFixture = capture(
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
);

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const { privateKey: devicePrivateKey, publicKey: devicePublicKey } = generateKeyPairSync("ed25519");
const signingPrivateKeyPkcs8 = privateKey
  .export({ format: "der", type: "pkcs8" })
  .toString("base64url");
const deviceId = "33333333-3333-4333-8333-333333333333";
const deviceNonce = "a".repeat(64);
const deviceSignature = "synthetic-device-signature";
const consumedDeviceProofs = new Set();
const deviceAuthServer = createServer(async (request, response) => {
  const isSessionDeviceProof = request.url === "/anonymous-sync/v2/device-proof";
  const isTlsnDeviceProof = request.url === "/anonymous-sync/v2/tlsn-device-proof";
  if (request.method !== "POST" || (!isSessionDeviceProof && !isTlsnDeviceProof)) {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "invalid_json" }));
    return;
  }
  if (request.headers.authorization !== "Bearer test-token-a" || body.device_id !== deviceId) {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "device_unauthorized" }));
    return;
  }
  if (isSessionDeviceProof && (body.nonce !== deviceNonce || body.sig !== deviceSignature)) {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "device_unauthorized" }));
    return;
  }
  if (isTlsnDeviceProof) {
    const proofKey = `${body.device_id}:${body.session_id}:${body.challenge}`;
    const signature = Buffer.from(body.sig ?? "", "base64url");
    const valid =
      typeof body.session_id === "string" &&
      typeof body.binding_value === "string" &&
      typeof body.challenge === "string" &&
      typeof body.sig === "string" &&
      signature.length === 64 &&
      verifySignature(
        null,
        tlsnDeviceProofMessage(body.device_id, body.session_id, body.binding_value, body.challenge),
        devicePublicKey,
        signature,
      );
    if (!valid) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "signature_invalid" }));
      return;
    }
    if (consumedDeviceProofs.has(proofKey)) {
      response.writeHead(409, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "device_proof_replayed" }));
      return;
    }
    consumedDeviceProofs.add(proofKey);
  }
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify({
    authenticated: true,
    canonical_user_id: "11111111-1111-4111-8111-111111111111",
    device_id: deviceId,
  }));
});
await new Promise((resolve) => deviceAuthServer.listen(0, "127.0.0.1", resolve));
deviceAuthServer.unref();
const deviceAuthOrigin = `http://127.0.0.1:${deviceAuthServer.address().port}`;
const deviceAuthUrl = `${deviceAuthOrigin}/anonymous-sync/v2/device-proof`;
const devicePossessionAuthUrl = `${deviceAuthOrigin}/anonymous-sync/v2/tlsn-device-proof`;
const testVars = {
  TLSN_ENVIRONMENT: "test",
  TLSN_BINDING_TTL_SECONDS: "60",
  TLSN_TEST_BINDING_VALUE: syntheticFixture.binding_value,
  TLSN_SERVER_IDENTITY: "game.example.test",
  TLSN_PROFILE_SHA256: Buffer.alloc(32).toString("base64url"),
  TLSN_VERIFIER_KEY_ID: "worker-test",
  TLSN_NOTARY_KEY_ID: "notary-test",
  TLSN_NOTARY_REGISTRY: JSON.stringify({ "notary-test": syntheticFixture.notary_key_base64 }),
  TLSN_SIGNING_PRIVATE_KEY_PKCS8: signingPrivateKeyPkcs8,
  TLSN_TRUST_ROOT_CERTIFICATE_DER: syntheticFixture.root_certificate_base64,
  TLSN_DEVICE_AUTH_URL: deviceAuthUrl,
  TLSN_DEVICE_POSSESSION_AUTH_URL: devicePossessionAuthUrl,
  TLSN_TEST_AUTH_USERS: JSON.stringify({
    "test-token-a": { id: "11111111-1111-4111-8111-111111111111", is_anonymous: false },
    "test-token-b": { id: "22222222-2222-4222-8222-222222222222", is_anonymous: false },
  }),
};

function localWorker(vars) {
  return unstable_dev(resolve(packageDirectory, "src/index.ts"), {
    config: resolve(packageDirectory, "wrangler.toml"),
    vars,
    persist: false,
    bundle: true,
    local: true,
    compatibilityDate: "2026-07-29",
    experimental: {
      disableExperimentalWarning: true,
      forceLocal: true,
      testMode: true,
    },
  });
}

const worker = await localWorker({
  ...testVars,
});

try {
  const { runSmokeTest } = await import("../test/index-smoke.mjs");
  await runSmokeTest(
    worker.fetch,
    syntheticFixture,
    publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    devicePrivateKey,
  );
} finally {
  await worker.stop();
}

const concurrentWorker = await localWorker({
  ...testVars,
});

try {
  const { runConcurrentReplaySmokeTest } = await import("../test/index-smoke.mjs");
  await runConcurrentReplaySmokeTest(concurrentWorker.fetch, syntheticFixture, devicePrivateKey);
} finally {
  await concurrentWorker.stop();
}

const contextWorker = await localWorker({
  ...testVars,
});

try {
  const { runBindingContextNegativeSmokeTest } = await import("../test/index-smoke.mjs");
  await runBindingContextNegativeSmokeTest(contextWorker.fetch, syntheticFixture, devicePrivateKey);
} finally {
  await contextWorker.stop();
}

const ownershipWorker = await localWorker({
  ...testVars,
});

try {
  const { runAuthenticatedOwnershipSmokeTest } = await import("../test/index-smoke.mjs");
  await runAuthenticatedOwnershipSmokeTest(ownershipWorker.fetch, syntheticFixture, devicePrivateKey);
} finally {
  await ownershipWorker.stop();
}

const expiryWorker = await localWorker({
  ...testVars,
  TLSN_BINDING_TTL_SECONDS: "1",
});

try {
  const { runExpiredBindingSmokeTest } = await import("../test/index-smoke.mjs");
  await runExpiredBindingSmokeTest(expiryWorker.fetch, syntheticFixture, devicePrivateKey);
} finally {
  await expiryWorker.stop();
}

const mismatchedIdentityWorker = await localWorker({
  ...testVars,
  TLSN_SERVER_IDENTITY: "other.example.test",
});

try {
  const { runMismatchedIdentitySmokeTest } = await import("../test/index-smoke.mjs");
  await runMismatchedIdentitySmokeTest(mismatchedIdentityWorker.fetch, syntheticFixture, devicePrivateKey);
} finally {
  await mismatchedIdentityWorker.stop();
}

const wrongNotaryKey = Buffer.from(syntheticFixture.notary_key_base64, "base64url");
wrongNotaryKey[wrongNotaryKey.length - 1] ^= 1;
const mismatchedNotaryWorker = await unstable_dev(resolve(packageDirectory, "src/index.ts"), {
  config: resolve(packageDirectory, "wrangler.toml"),
  vars: {
    ...testVars,
    TLSN_NOTARY_KEY_ID: "notary-test",
    TLSN_NOTARY_REGISTRY: JSON.stringify({ "notary-test": wrongNotaryKey.toString("base64url") }),
  },
  persist: false,
  bundle: true,
  local: true,
  compatibilityDate: "2026-07-29",
  experimental: {
    disableExperimentalWarning: true,
    forceLocal: true,
    testMode: true,
  },
});

try {
  const { runMismatchedNotarySmokeTest } = await import("../test/index-smoke.mjs");
  await runMismatchedNotarySmokeTest(mismatchedNotaryWorker.fetch, syntheticFixture, devicePrivateKey);
} finally {
  await mismatchedNotaryWorker.stop();
}

const productionTrustRootWorker = await unstable_dev(resolve(packageDirectory, "src/index.ts"), {
  config: resolve(packageDirectory, "wrangler.toml"),
  vars: {
    TLSN_ENVIRONMENT: "production",
    TLSN_BINDING_TTL_SECONDS: "60",
    TLSN_PRODUCTION_SERVER_IDENTITY: "game.example.test",
    TLSN_PRODUCTION_PROFILE_SHA256: Buffer.alloc(32).toString("base64url"),
    TLSN_PRODUCTION_VERIFIER_KEY_ID: "worker-test",
    TLSN_PRODUCTION_NOTARY_KEY_ID: "notary-test",
    TLSN_PRODUCTION_NOTARY_REGISTRY: JSON.stringify({ "notary-test": syntheticFixture.notary_key_base64 }),
    TLSN_PRODUCTION_SIGNING_PRIVATE_KEY_PKCS8: signingPrivateKeyPkcs8,
    TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER: syntheticFixture.root_certificate_base64,
    TLSN_PRODUCTION_DEVICE_AUTH_URL: "https://fusou.dev/api/auth/anonymous-sync/v2/device-proof",
    TLSN_PRODUCTION_DEVICE_POSSESSION_AUTH_URL: "https://fusou.dev/api/auth/anonymous-sync/v2/tlsn-device-proof",
    TLSN_PRODUCTION_DEVICE_AUTH_ALLOWED_HOSTS: "fusou.dev",
    TLSN_PRODUCTION_SUPABASE_ALLOWED_HOSTS: "project.supabase.co",
    TLSN_SUPABASE_URL: "https://project.supabase.co",
    TLSN_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  },
  persist: false,
  bundle: true,
  local: true,
  compatibilityDate: "2026-07-29",
  experimental: {
    disableExperimentalWarning: true,
    forceLocal: true,
    testMode: true,
  },
});

try {
  const { runProductionTrustRootSmokeTest } = await import("../test/index-smoke.mjs");
  await runProductionTrustRootSmokeTest(productionTrustRootWorker.fetch);
} finally {
  await productionTrustRootWorker.stop();
}

const invalidProductionEndpointWorker = await unstable_dev(resolve(packageDirectory, "src/index.ts"), {
  config: resolve(packageDirectory, "wrangler.toml"),
  vars: {
    TLSN_ENVIRONMENT: "production",
    TLSN_BINDING_TTL_SECONDS: "60",
    TLSN_PRODUCTION_SERVER_IDENTITY: "game.example.test",
    TLSN_PRODUCTION_PROFILE_SHA256: Buffer.alloc(32).toString("base64url"),
    TLSN_PRODUCTION_VERIFIER_KEY_ID: "worker-test",
    TLSN_PRODUCTION_NOTARY_KEY_ID: "notary-test",
    TLSN_PRODUCTION_NOTARY_REGISTRY: JSON.stringify({ "notary-test": syntheticFixture.notary_key_base64 }),
    TLSN_PRODUCTION_SIGNING_PRIVATE_KEY_PKCS8: signingPrivateKeyPkcs8,
    TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER: syntheticFixture.root_certificate_base64,
    TLSN_PRODUCTION_DEVICE_AUTH_URL: "https://evil.example/api/auth/anonymous-sync/v2/device-proof",
    TLSN_PRODUCTION_DEVICE_POSSESSION_AUTH_URL: "https://fusou.dev/api/auth/anonymous-sync/v2/tlsn-device-proof",
    TLSN_PRODUCTION_DEVICE_AUTH_ALLOWED_HOSTS: "fusou.dev",
    TLSN_PRODUCTION_SUPABASE_ALLOWED_HOSTS: "project.supabase.co",
    TLSN_SUPABASE_URL: "https://project.supabase.co",
    TLSN_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  },
  persist: false,
  bundle: true,
  local: true,
  compatibilityDate: "2026-07-29",
  experimental: {
    disableExperimentalWarning: true,
    forceLocal: true,
    testMode: true,
  },
});

try {
  const { runProductionEndpointPolicySmokeTest } = await import("../test/index-smoke.mjs");
  await runProductionEndpointPolicySmokeTest(invalidProductionEndpointWorker.fetch);
} finally {
  await invalidProductionEndpointWorker.stop();
}

const unconfiguredWorker = await unstable_dev(resolve(packageDirectory, "src/index.ts"), {
  config: resolve(packageDirectory, "wrangler.toml"),
  persist: false,
  bundle: true,
  local: true,
  compatibilityDate: "2026-07-29",
  experimental: {
    disableExperimentalWarning: true,
    forceLocal: true,
    testMode: true,
  },
});

try {
  const { runUnconfiguredSmokeTest } = await import("../test/index-smoke.mjs");
  await runUnconfiguredSmokeTest(unconfiguredWorker.fetch);
} finally {
  await unconfiguredWorker.stop();
}

deviceAuthServer.close();