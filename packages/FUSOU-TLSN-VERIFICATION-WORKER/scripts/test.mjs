#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash, createHmac, generateKeyPairSync, sign, verify as verifySignature } from "node:crypto";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { unstable_dev } from "wrangler";
import { consumeReceiptSigningBytes, sessionReceiptSigningBytes } from "./device-evidence.mjs";

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
const { privateKey: sessionAuthorityPrivateKey, publicKey: sessionAuthorityPublicKey } = generateKeyPairSync("ed25519");
const { privateKey: bindingAuthorityPrivateKey, publicKey: bindingAuthorityPublicKey } = generateKeyPairSync("ed25519");
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
const canaryResultPublicKeySpki = canaryPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const productionResultPublicKeySpki = productionPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const sessionAuthorityPublicKeySpki = sessionAuthorityPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const bindingAuthorityPublicKeySpki = bindingAuthorityPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
const sessionAuthorityKeyRegistry = JSON.stringify({
  schema_version: 1,
  scope: "tlsn-session-authority-key-registry",
  keys: [{
    key_id: "session-authority-test",
    public_key_spki: sessionAuthorityPublicKeySpki,
    status: "ACTIVE",
    not_before: "2026-01-01T00:00:00.000Z",
    not_after: null,
  }],
});
const bindingAuthorityKeyRegistry = JSON.stringify({
  schema_version: 1,
  scope: "tlsn-binding-authority-key-registry",
  keys: [{
    key_id: "binding-authority-test",
    public_key_spki: bindingAuthorityPublicKeySpki,
    status: "ACTIVE",
    not_before: "2026-01-01T00:00:00.000Z",
    not_after: null,
  }],
});
const canaryResultSigningKeyRegistry = JSON.stringify({
  schema_version: 1,
  scope: "tlsn-result-signing-key-registry",
  keys: [{
    key_id: "canary-result-test",
    public_key_spki: canaryResultPublicKeySpki,
    status: "ACTIVE",
    not_before: "2026-01-01T00:00:00.000Z",
    not_after: null,
  }],
});
const productionResultSigningKeyRegistry = JSON.stringify({
  schema_version: 1,
  scope: "tlsn-result-signing-key-registry",
  keys: [{
    key_id: "production-result-test",
    public_key_spki: productionResultPublicKeySpki,
    status: "ACTIVE",
    not_before: "2026-01-01T00:00:00.000Z",
    not_after: null,
  }],
});
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
    ...(isTlsnDeviceProof
      ? { replay_digest_hex: createHash("sha256").update(tlsnDeviceProofMessage(body.device_id, body.session_id, body.binding_value, body.challenge)).digest("hex") }
      : {}),
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
  TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8: signingPrivateKeyPkcs8,
  TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: sessionAuthorityPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
  TLSN_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: sessionAuthorityPublicKeySpki,
  TLSN_SESSION_AUTHORITY_KEY_ID: "session-authority-test",
  TLSN_SESSION_AUTHORITY_KEY_REGISTRY: sessionAuthorityKeyRegistry,
  TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: bindingAuthorityPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
  TLSN_BINDING_AUTHORITY_PUBLIC_KEY_SPKI: bindingAuthorityPublicKeySpki,
  TLSN_BINDING_AUTHORITY_KEY_ID: "binding-authority-test",
  TLSN_BINDING_AUTHORITY_KEY_REGISTRY: bindingAuthorityKeyRegistry,
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

function internalRequestSignature(secret, jobId, body) {
  const bodyDigest = createHash("sha256").update(body).digest("base64url");
  return createHmac("sha256", secret)
    .update(`FUSOU-TLSN-INTERNAL-V1\0${jobId}\0${bodyDigest}`)
    .digest("base64url");
}

async function runAsyncTriggerSmokeTest() {
  const callbackSecret = "callback-test-secret";
  let worker;
  let completionRequest;
  const verifierModule = await import("../src/wasm/fusou_tlsn_verifier.js");
  verifierModule.initSync(await readFile(resolve(packageDirectory, "src/wasm/fusou_tlsn_verifier_bg.wasm")));

  const triggerServer = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || !request.url?.endsWith("/trigger")) {
        response.writeHead(404);
        response.end();
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const payload = requestBody.payload;
      const inputBody = JSON.stringify({
        job_id: payload.job_id,
        binding_id: payload.binding_id,
        session_id: payload.session_id,
        canonical_user_id: payload.canonical_user_id,
        device_id: payload.device_id,
        verification_input_key: payload.verification_input_key,
      });
      const inputResponse = await worker.fetch("https://verify.test/internal/tlsn/verification-input", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-FUSOU-TLSN-Job-Id": payload.job_id,
          "X-FUSOU-TLSN-Signature": internalRequestSignature(callbackSecret, payload.job_id, inputBody),
        },
        body: inputBody,
      });
      if (!inputResponse.ok) throw new Error(`async input handoff failed: ${inputResponse.status}`);
      const presentation = new Uint8Array(await inputResponse.arrayBuffer());
      const preparedResultJson = payload.device_challenge
        ? verifierModule.verify_require_info_presentation_with_trust_anchor(
            presentation,
            testVars.TLSN_SERVER_IDENTITY,
            Buffer.alloc(32),
            testVars.TLSN_VERIFIER_KEY_ID,
            testVars.TLSN_NOTARY_KEY_ID,
            payload.canonical_user_id,
            payload.device_id,
            Buffer.from(payload.device_challenge, "base64url"),
            Buffer.from(testVars.TLSN_TRUST_ROOT_CERTIFICATE_DER, "base64url"),
            Buffer.from(syntheticFixture.notary_key_base64, "base64url"),
          )
        : "";
      const preparedResult = JSON.parse(preparedResultJson);
      const mismatchedSigningBytes = Buffer.from(preparedResult.signing_bytes, "base64url");
      mismatchedSigningBytes[0] ^= 1;
      const mismatchBody = JSON.stringify({
        job_id: payload.job_id,
        binding_id: payload.binding_id,
        session_id: payload.session_id,
        canonical_user_id: payload.canonical_user_id,
        device_id: payload.device_id,
        presentation_id: createHash("sha256").update(presentation).digest("base64url"),
        prepared_result: {
          unsigned_result: preparedResult.unsigned_result,
          signing_bytes: mismatchedSigningBytes.toString("base64url"),
        },
      });
      const mismatchResponse = await worker.fetch("https://verify.test/internal/tlsn/verification-complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-FUSOU-TLSN-Job-Id": payload.job_id,
          "X-FUSOU-TLSN-Signature": internalRequestSignature(callbackSecret, payload.job_id, mismatchBody),
        },
        body: mismatchBody,
      });
      if (mismatchResponse.status !== 422 || (await mismatchResponse.json()).error !== "signing_bytes_mismatch") {
        throw new Error("async completion accepted mismatched signing bytes");
      }
      const completionBody = JSON.stringify({
        job_id: payload.job_id,
        binding_id: payload.binding_id,
        session_id: payload.session_id,
        canonical_user_id: payload.canonical_user_id,
        device_id: payload.device_id,
        presentation_id: createHash("sha256").update(presentation).digest("base64url"),
        prepared_result: {
          unsigned_result: preparedResult.unsigned_result,
          signing_bytes: preparedResult.signing_bytes,
        },
      });
      completionRequest = {
        body: completionBody,
        signature: internalRequestSignature(callbackSecret, payload.job_id, completionBody),
      };
      const completionResponse = await worker.fetch("https://verify.test/internal/tlsn/verification-complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-FUSOU-TLSN-Job-Id": payload.job_id,
          "X-FUSOU-TLSN-Signature": completionRequest.signature,
        },
        body: completionBody,
      });
      if (!completionResponse.ok) {
        throw new Error(`async completion failed: ${completionResponse.status} ${await completionResponse.text()}`);
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: payload.job_id }));
    } catch (error) {
      console.error(`[tlsn-async-test] ${error instanceof Error ? error.message : String(error)}`);
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise((resolveServer) => triggerServer.listen(0, "127.0.0.1", resolveServer));
  triggerServer.unref();
  const triggerUrl = `http://127.0.0.1:${triggerServer.address().port}`;

  worker = await localWorker({
    ...testVars,
    TLSN_EXECUTION_MODE: "trigger",
    TLSN_TRIGGER_API_URL: triggerUrl,
    TLSN_TRIGGER_TASK_ID: "tlsn-verify-presentation",
    TLSN_TRIGGER_SECRET_KEY: "trigger-test-secret",
    TLSN_TRIGGER_CALLBACK_SECRET: callbackSecret,
  });
  try {
    const sessionResponse = await worker.fetch("https://verify.test/attestation/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token-a" },
      body: JSON.stringify({
        device_id: deviceId,
        nonce: deviceNonce,
        sig: deviceSignature,
      }),
    });
    assert.equal(sessionResponse.status, 201);
    const session = await sessionResponse.json();
    const deviceProof = {
      device_id: session.device_id,
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
    const verificationResponse = await worker.fetch("https://verify.test/verify/tlsn", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token-a" },
      body: JSON.stringify({
        presentation_base64: syntheticFixture.presentation_base64,
        session_id: session.session_id,
        binding: session.binding,
        device_id: session.device_id,
        device_proof: {
          challenge: deviceProof.challenge,
          sig: deviceProof.sig,
        },
      }),
    });
    assert.equal(verificationResponse.status, 202);
    const queued = await verificationResponse.json();
    assert.equal(queued.status, "queued");
    assert.match(queued.job_id, /^[0-9a-f-]{36}$/);
    assert.ok(completionRequest);

    const statusResponse = await worker.fetch("https://verify.test/verify/tlsn/status", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token-a" },
      body: JSON.stringify({
        job_id: queued.job_id,
        binding_id: createHash("sha256").update(syntheticFixture.binding_value).digest("base64url"),
        session_id: session.session_id,
        canonical_user_id: "11111111-1111-4111-8111-111111111111",
        device_id: session.device_id,
      }),
    });
    assert.equal(statusResponse.status, 200);
    const finalResponse = await statusResponse.json();
    assert.equal(finalResponse.verified, true);
    assert.equal(finalResponse.result.verified_member_id, "16189463");

    const duplicateCompletion = await worker.fetch("https://verify.test/internal/tlsn/verification-complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-FUSOU-TLSN-Job-Id": queued.job_id,
        "X-FUSOU-TLSN-Signature": completionRequest.signature,
      },
      body: completionRequest.body,
    });
    assert.equal(duplicateCompletion.status, 200);
    assert.deepEqual(await duplicateCompletion.json(), { accepted: true });
  } finally {
    await worker.stop();
    await new Promise((resolveServer) => triggerServer.close(resolveServer));
  }
  console.log("[tlsn-verification-worker] async Trigger handoff, result polling, and idempotent completion paths OK");
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
      if (
        session.session_receipt?.schema_version !== 1 ||
        session.session_receipt?.type !== "attestation-session-issued" ||
        session.session_receipt?.device_auth_nonce !== deviceNonce ||
        session.session_receipt?.session_id !== session.session_id ||
        session.session_receipt?.device_id !== deviceId ||
        session.session_receipt?.binding_value !== session.binding ||
        session.session_receipt?.nonce !== session.challenge
      ) {
        throw new Error("TLSN session receipt is not bound to the issued session");
      }
      if (!verifySignature(
        null,
        sessionReceiptSigningBytes(session.session_receipt),
        sessionAuthorityPublicKey,
        decodeBase64Url(session.session_receipt.signature),
      )) {
        throw new Error("TLSN session receipt signature is invalid");
      }
      const mutatedSessionReceipt = { ...session.session_receipt, binding_value: `${session.binding}A` };
      if (verifySignature(
        null,
        sessionReceiptSigningBytes(mutatedSessionReceipt),
        sessionAuthorityPublicKey,
        decodeBase64Url(session.session_receipt.signature),
      )) {
        throw new Error("TLSN session receipt mutation was accepted");
      }
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
      if (mode === "ok") {
        const verification = await response.clone().json();
        const consumeReceipt = verification.consume_receipt;
        if (
          consumeReceipt?.schema_version !== 1 ||
          consumeReceipt?.type !== "attestation-binding-consumed" ||
          consumeReceipt?.session_id !== session.session_id ||
          consumeReceipt?.device_id !== deviceId ||
          consumeReceipt?.binding_value !== session.binding ||
          consumeReceipt?.presentation_id !== createHash("sha256").update(decodeBase64Url(syntheticFixture.presentation_base64)).digest("base64url")
        ) {
          throw new Error("TLSN consume receipt is not bound to the verification");
        }
        if (
          verification.device_replay_digest_hex !== createHash("sha256")
            .update(tlsnDeviceProofMessage(deviceId, session.session_id, session.binding, deviceProof.challenge))
            .digest("hex")
        ) {
          throw new Error("TLSN authoritative replay digest is not returned");
        }
        if (!verifySignature(
          null,
          consumeReceiptSigningBytes(consumeReceipt),
          bindingAuthorityPublicKey,
          decodeBase64Url(consumeReceipt.signature),
        )) {
          throw new Error("TLSN consume receipt signature is invalid");
        }
        const mutatedConsumeReceipt = { ...consumeReceipt, presentation_id: `${consumeReceipt.presentation_id}A` };
        if (verifySignature(
          null,
          consumeReceiptSigningBytes(mutatedConsumeReceipt),
          bindingAuthorityPublicKey,
          decodeBase64Url(consumeReceipt.signature),
        )) {
          throw new Error("TLSN consume receipt mutation was accepted");
        }
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

await runAsyncTriggerSmokeTest();

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

const productionTrustRootVars = {
  TLSN_ENVIRONMENT: "production",
  TLSN_DEPLOYMENT_ROLE: "production",
  TLSN_GIT_COMMIT_SHA: "a".repeat(40),
  TLSN_BINDING_TTL_SECONDS: "60",
  TLSN_CANDIDATE_SERVER_IDENTITY: "game.example.com",
  TLSN_CANDIDATE_PROFILE_SHA256: Buffer.alloc(32).toString("base64url"),
  TLSN_CANDIDATE_VERIFIER_KEY_ID: "worker-prod",
  TLSN_CANDIDATE_NOTARY_KEY_ID: "notary-prod",
  TLSN_PRODUCTION_NOTARY_REGISTRY: JSON.stringify({ "notary-prod": syntheticFixture.notary_key_base64 }),
  TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8: productionSigningPrivateKeyPkcs8,
  TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER: syntheticFixture.root_certificate_base64,
  TLSN_PRODUCTION_DEPLOYMENT_ID: "local-production-test",
  TLSN_SECURITY_REGISTRY_SET_SHA256: Buffer.alloc(32, 0x53).toString("base64url"),
  TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI: productionResultPublicKeySpki,
  TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID: "production-result-test",
  TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY: productionResultSigningKeyRegistry,
  TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: sessionAuthorityPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
  TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: sessionAuthorityPublicKeySpki,
  TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID: "session-authority-test",
  TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY: sessionAuthorityKeyRegistry,
  TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: bindingAuthorityPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
  TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI: bindingAuthorityPublicKeySpki,
  TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID: "binding-authority-test",
  TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY: bindingAuthorityKeyRegistry,
  TLSN_CANDIDATE_DEVICE_AUTH_URL: "https://fusou.dev/api/auth/anonymous-sync/v2/device-proof",
  TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL: "https://fusou.dev/api/auth/anonymous-sync/v2/tlsn-device-proof",
  TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS: "fusou.dev",
  TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS: "project.supabase.co",
  TLSN_CANDIDATE_SUPABASE_URL: "https://project.supabase.co",
  TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  TLSN_PRODUCTION_WORKER_NAME: "fusou-tlsn-production",
};

const productionTrustRootWorker = await unstable_dev(resolve(packageDirectory, "src/index.ts"), {
  config: resolve(packageDirectory, "wrangler.toml"),
  vars: productionTrustRootVars,
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

const malformedProductionRegistry = JSON.parse(productionResultSigningKeyRegistry);
malformedProductionRegistry.keys.push({ ...malformedProductionRegistry.keys[0] });
malformedProductionRegistry.keys[0].not_before = "not-a-timestamp";
const malformedProductionRegistryWorker = await unstable_dev(resolve(packageDirectory, "src/index.ts"), {
  config: resolve(packageDirectory, "wrangler.toml"),
  vars: {
    ...productionTrustRootVars,
    TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY: JSON.stringify(malformedProductionRegistry),
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
  const { runProductionRegistryFailClosedSmokeTest } = await import("../test/index-smoke.mjs");
  await runProductionRegistryFailClosedSmokeTest(malformedProductionRegistryWorker.fetch);
} finally {
  await malformedProductionRegistryWorker.stop();
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
    TLSN_PRODUCTION_NOTARY_REGISTRY: JSON.stringify({ "notary-test": syntheticFixture.notary_key_base64 }),
    TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8: productionSigningPrivateKeyPkcs8,
    TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER: syntheticFixture.root_certificate_base64,
    TLSN_PRODUCTION_DEPLOYMENT_ID: "local-production-invalid-endpoint",
    TLSN_SECURITY_REGISTRY_SET_SHA256: Buffer.alloc(32, 0x53).toString("base64url"),
    TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI: productionResultPublicKeySpki,
    TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID: "production-result-test",
    TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY: productionResultSigningKeyRegistry,
    TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: sessionAuthorityPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: sessionAuthorityPublicKeySpki,
    TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID: "session-authority-test",
    TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY: sessionAuthorityKeyRegistry,
    TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: bindingAuthorityPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI: bindingAuthorityPublicKeySpki,
    TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID: "binding-authority-test",
    TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY: bindingAuthorityKeyRegistry,
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