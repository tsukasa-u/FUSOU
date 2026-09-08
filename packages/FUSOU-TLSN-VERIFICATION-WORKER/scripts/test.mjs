#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign, verify as verifySignature } from "node:crypto";
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
const { privateKey: canaryPrivateKey, publicKey: canaryPublicKey } = generateKeyPairSync("ed25519");
const { privateKey: productionPrivateKey, publicKey: productionPublicKey } = generateKeyPairSync("ed25519");
const { privateKey: devicePrivateKey, publicKey: devicePublicKey } = generateKeyPairSync("ed25519");
const signingPrivateKeyPkcs8 = privateKey
  .export({ format: "der", type: "pkcs8" })
  .toString("base64url");
const canarySigningPrivateKeyPkcs8 = canaryPrivateKey
  .export({ format: "der", type: "pkcs8" })
  .toString("base64url");
const productionSigningPrivateKeyPkcs8 = productionPrivateKey
  .export({ format: "der", type: "pkcs8" })
  .toString("base64url");
const deviceId = "33333333-3333-4333-8333-333333333333";
const deviceNonce = "a".repeat(64);
const deviceSignature = "synthetic-device-signature";
const consumedDeviceProofs = new Set();
const upstreamState = {
  deviceMode: "ok",
  supabaseMode: "ok",
  intendedRequests: [],
  redirectRequests: [],
};
const redirectTargetServer = createServer((request, response) => {
  upstreamState.redirectRequests.push({
    origin: "cross-origin",
    url: request.url,
    authorization: request.headers.authorization ?? null,
    apikey: request.headers.apikey ?? null,
  });
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", is_anonymous: false }));
});
await new Promise((resolve) => redirectTargetServer.listen(0, "127.0.0.1", resolve));
redirectTargetServer.unref();
const redirectTargetOrigin = `http://127.0.0.1:${redirectTargetServer.address().port}`;

function writeUpstreamResponse(response, mode, sameOrigin, payload) {
  if (mode === "ok") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
    return;
  }
  if (mode === "unauthorized") {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }
  if (mode === "server_error") {
    response.writeHead(500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "upstream_failure" }));
    return;
  }
  if (mode === "redirect_same") {
    response.writeHead(302, { Location: `${sameOrigin}/redirect-target` });
    response.end();
    return;
  }
  if (mode === "redirect_cross") {
    response.writeHead(302, { Location: `${redirectTargetOrigin}/redirect-target` });
    response.end();
    return;
  }
  if (mode === "redirect_chain") {
    response.writeHead(302, { Location: `${sameOrigin}/redirect-chain-hop` });
    response.end();
    return;
  }
  throw new Error(`unknown upstream mode: ${mode}`);
}

const deviceAuthServer = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  if (requestUrl.pathname === "/auth/v1/user") {
    upstreamState.intendedRequests.push({
      kind: "supabase",
      authorization: request.headers.authorization ?? null,
      apikey: request.headers.apikey ?? null,
    });
    if (upstreamState.supabaseMode !== "ok") {
      writeUpstreamResponse(
        response,
        upstreamState.supabaseMode,
        `http://${request.headers.host}`,
        { id: "11111111-1111-4111-8111-111111111111", is_anonymous: false },
      );
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", is_anonymous: false }));
    return;
  }
  if (requestUrl.pathname.startsWith("/redirect")) {
    upstreamState.redirectRequests.push({
      origin: "same-origin",
      url: request.url,
      authorization: request.headers.authorization ?? null,
      apikey: request.headers.apikey ?? null,
    });
    if (requestUrl.pathname === "/redirect-chain-hop") {
      response.writeHead(302, { Location: `${redirectTargetOrigin}/redirect-target` });
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", is_anonymous: false }));
    return;
  }
  const isSessionDeviceProof = requestUrl.pathname === "/anonymous-sync/v2/device-proof";
  const isTlsnDeviceProof = requestUrl.pathname === "/anonymous-sync/v2/tlsn-device-proof";
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
  upstreamState.intendedRequests.push({
    kind: isSessionDeviceProof ? "device" : "tlsn-device",
    authorization: request.headers.authorization ?? null,
    apikey: request.headers.apikey ?? null,
  });
  if (
    !["Bearer test-token-a", "Bearer remote-token"].includes(request.headers.authorization) ||
    body.device_id !== deviceId
  ) {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "device_unauthorized" }));
    return;
  }
  if (isSessionDeviceProof && upstreamState.deviceMode !== "ok") {
    writeUpstreamResponse(
      response,
      upstreamState.deviceMode,
      `http://${request.headers.host}`,
      { authenticated: true, canonical_user_id: "11111111-1111-4111-8111-111111111111", device_id: deviceId },
    );
    return;
  }
  if (isTlsnDeviceProof && upstreamState.deviceMode !== "ok") {
    writeUpstreamResponse(
      response,
      upstreamState.deviceMode,
      `http://${request.headers.host}`,
      { authenticated: true, canonical_user_id: "11111111-1111-4111-8111-111111111111", device_id: deviceId },
    );
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

async function runRedirectRegressionTest() {
  const modes = ["ok", "unauthorized", "server_error", "redirect_same", "redirect_cross", "redirect_chain"];
  const expectedSupabaseStatus = new Map([
    ["ok", 201],
    ["unauthorized", 401],
    ["server_error", 401],
    ["redirect_same", 401],
    ["redirect_cross", 401],
    ["redirect_chain", 401],
  ]);
  const expectedDeviceStatus = new Map([
    ["ok", 201],
    ["unauthorized", 401],
    ["server_error", 503],
    ["redirect_same", 503],
    ["redirect_cross", 503],
    ["redirect_chain", 503],
  ]);
  const baseVars = { ...testVars };
  delete baseVars.TLSN_TEST_AUTH_USERS;
  for (const mode of modes) {
    upstreamState.supabaseMode = mode;
    upstreamState.deviceMode = "ok";
    upstreamState.intendedRequests.length = 0;
    upstreamState.redirectRequests.length = 0;
    const worker = await localWorker({
      ...baseVars,
        TLSN_SUPABASE_URL: deviceAuthOrigin,
        TLSN_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
    });
    try {
      const response = await worker.fetch("https://verify.test/attestation/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer remote-token" },
        body: JSON.stringify({ device_id: deviceId, nonce: deviceNonce, sig: deviceSignature }),
      });
      if (response.status !== expectedSupabaseStatus.get(mode)) {
        throw new Error(`Supabase ${mode} expected ${expectedSupabaseStatus.get(mode)}, got ${response.status}`);
      }
      const supabaseRequest = upstreamState.intendedRequests.find((entry) => entry.kind === "supabase");
      if (supabaseRequest?.authorization !== "Bearer remote-token" || supabaseRequest.apikey !== "publishable-test-key") {
        throw new Error(`Supabase ${mode} did not receive the intended credentials`);
      }
      if (upstreamState.redirectRequests.length !== 0) {
        throw new Error(`Supabase ${mode} followed a redirect`);
      }
    } finally {
      await worker.stop();
    }
  }
  for (const mode of modes) {
    upstreamState.supabaseMode = "ok";
    upstreamState.deviceMode = mode;
    upstreamState.intendedRequests.length = 0;
    upstreamState.redirectRequests.length = 0;
    const worker = await localWorker({
      ...baseVars,
      TLSN_SUPABASE_URL: deviceAuthOrigin,
      TLSN_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
    });
    try {
      const response = await worker.fetch("https://verify.test/attestation/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer remote-token" },
        body: JSON.stringify({ device_id: deviceId, nonce: deviceNonce, sig: deviceSignature }),
      });
      if (response.status !== expectedDeviceStatus.get(mode)) {
        throw new Error(`device ${mode} expected ${expectedDeviceStatus.get(mode)}, got ${response.status}`);
      }
      const deviceRequest = upstreamState.intendedRequests.find((entry) => entry.kind === "device");
      if (deviceRequest?.authorization !== "Bearer remote-token") {
        throw new Error(`device ${mode} did not receive the intended bearer token`);
      }
      if (upstreamState.redirectRequests.length !== 0) {
        throw new Error(`device ${mode} followed a redirect`);
      }
    } finally {
      await worker.stop();
    }
  }
  for (const mode of modes) {
    upstreamState.supabaseMode = "ok";
    upstreamState.deviceMode = "ok";
    upstreamState.intendedRequests.length = 0;
    upstreamState.redirectRequests.length = 0;
    const worker = await localWorker({
      ...baseVars,
      TLSN_SUPABASE_URL: deviceAuthOrigin,
      TLSN_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
    });
    try {
      const sessionResponse = await worker.fetch("https://verify.test/attestation/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer remote-token" },
        body: JSON.stringify({ device_id: deviceId, nonce: deviceNonce, sig: deviceSignature }),
      });
      if (sessionResponse.status !== 201) {
        throw new Error(`TLSN ${mode} session expected 201, got ${sessionResponse.status}`);
      }
      const session = await sessionResponse.json();
      upstreamState.deviceMode = mode;
      const deviceProof = {
        device_id: deviceId,
        session_id: session.session_id,
        binding_value: session.binding,
        challenge: session.device_challenge,
      };
      deviceProof.sig = sign(
        null,
        tlsnDeviceProofMessage(
          deviceProof.device_id,
          deviceProof.session_id,
          deviceProof.binding_value,
          deviceProof.challenge,
        ),
        devicePrivateKey,
      ).toString("base64url");
      const response = await worker.fetch("https://verify.test/verify/tlsn", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer remote-token" },
        body: JSON.stringify({
          presentation_base64: syntheticFixture.presentation_base64,
          session_id: session.session_id,
          binding: session.binding,
          device_id: deviceId,
          device_proof: { challenge: deviceProof.challenge, sig: deviceProof.sig },
        }),
      });
      const expectedStatus = new Map([
        ["ok", 200],
        ["unauthorized", 401],
        ["server_error", 503],
        ["redirect_same", 503],
        ["redirect_cross", 503],
        ["redirect_chain", 503],
      ]).get(mode);
      if (response.status !== expectedStatus) {
        throw new Error(`TLSN ${mode} expected ${expectedStatus}, got ${response.status}`);
      }
      const possessionRequest = upstreamState.intendedRequests.find((entry) => entry.kind === "tlsn-device");
      if (possessionRequest?.authorization !== "Bearer remote-token") {
        throw new Error(`TLSN ${mode} did not receive the intended bearer token`);
      }
      if (upstreamState.redirectRequests.length !== 0) {
        throw new Error(`TLSN ${mode} followed a redirect`);
      }
    } finally {
      await worker.stop();
    }
  }
  console.log("[tlsn-verification-worker] upstream redirect and token leakage regression paths OK");
}

await runRedirectRegressionTest();

upstreamState.deviceMode = "ok";
upstreamState.supabaseMode = "ok";
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
    TLSN_DEPLOYMENT_ROLE: "production",
    TLSN_GIT_COMMIT_SHA: "a".repeat(40),
    TLSN_BINDING_TTL_SECONDS: "60",
    TLSN_CANDIDATE_SERVER_IDENTITY: "game.example.com",
    TLSN_CANDIDATE_PROFILE_SHA256: Buffer.alloc(32).toString("base64url"),
    TLSN_CANDIDATE_VERIFIER_KEY_ID: "worker-prod",
    TLSN_CANDIDATE_NOTARY_KEY_ID: "notary-prod",
    TLSN_CANDIDATE_NOTARY_REGISTRY: JSON.stringify({ "notary-prod": syntheticFixture.notary_key_base64 }),
    TLSN_PRODUCTION_SIGNING_PRIVATE_KEY_PKCS8: productionSigningPrivateKeyPkcs8,
    TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER: syntheticFixture.root_certificate_base64,
    TLSN_PRODUCTION_DEPLOYMENT_ID: "local-production-test",
    TLSN_SECURITY_REGISTRY_SET_SHA256: Buffer.alloc(32, 0x53).toString("base64url"),
    TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI: productionPublicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    TLSN_CANDIDATE_DEVICE_AUTH_URL: "https://fusou.dev/api/auth/anonymous-sync/v2/device-proof",
    TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL: "https://fusou.dev/api/auth/anonymous-sync/v2/tlsn-device-proof",
    TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS: "fusou.dev",
    TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS: "project.supabase.co",
    TLSN_CANDIDATE_SUPABASE_URL: "https://project.supabase.co",
    TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    TLSN_PRODUCTION_WORKER_NAME: "fusou-tlsn-production",
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
    TLSN_DEPLOYMENT_ROLE: "production",
    TLSN_GIT_COMMIT_SHA: "a".repeat(40),
    TLSN_BINDING_TTL_SECONDS: "60",
    TLSN_CANDIDATE_SERVER_IDENTITY: "game.example.test",
    TLSN_CANDIDATE_PROFILE_SHA256: Buffer.alloc(32).toString("base64url"),
    TLSN_CANDIDATE_VERIFIER_KEY_ID: "worker-test",
    TLSN_CANDIDATE_NOTARY_KEY_ID: "notary-test",
    TLSN_CANDIDATE_NOTARY_REGISTRY: JSON.stringify({ "notary-test": syntheticFixture.notary_key_base64 }),
    TLSN_PRODUCTION_SIGNING_PRIVATE_KEY_PKCS8: productionSigningPrivateKeyPkcs8,
    TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER: syntheticFixture.root_certificate_base64,
    TLSN_PRODUCTION_DEPLOYMENT_ID: "local-production-invalid-endpoint",
    TLSN_SECURITY_REGISTRY_SET_SHA256: Buffer.alloc(32, 0x53).toString("base64url"),
    TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI: productionPublicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    TLSN_CANDIDATE_DEVICE_AUTH_URL: "https://evil.example/api/auth/anonymous-sync/v2/device-proof",
    TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL: "https://fusou.dev/api/auth/anonymous-sync/v2/tlsn-device-proof",
    TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS: "fusou.dev",
    TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS: "project.supabase.co",
    TLSN_CANDIDATE_SUPABASE_URL: "https://project.supabase.co",
    TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    TLSN_PRODUCTION_WORKER_NAME: "fusou-tlsn-production",
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

await new Promise((resolve) => deviceAuthServer.close(resolve));
await new Promise((resolve) => redirectTargetServer.close(resolve));