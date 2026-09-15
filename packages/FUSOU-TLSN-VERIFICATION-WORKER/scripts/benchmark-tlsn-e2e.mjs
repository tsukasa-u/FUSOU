#!/usr/bin/env node

import { createHash, createHmac, generateKeyPairSync, sign, verify as verifySignature } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unstable_dev } from "wrangler";
import {
  fixtureDirectory,
  fixtureSourcePath,
  generateRealFixture,
  loadRealFixture,
  packageDirectory,
  readRealFixtureManifest,
} from "./tlsn-benchmark-fixtures.mjs";

const wranglerConfig = resolve(packageDirectory, "wrangler.toml");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID = "33333333-3333-4333-8333-333333333333";
const ACCESS_TOKEN = "test-token-a";
const AUTHORIZATION = `Bearer ${ACCESS_TOKEN}`;
const DEVICE_NONCE = "a".repeat(64);
const DEVICE_SIGNATURE = "synthetic-device-signature";
const CALLBACK_SECRET = "benchmark-callback-secret";
const PROFILE_SHA256 = Buffer.alloc(32, 9).toString("base64url");
const BASE_PROFILE_SHA256 = Buffer.alloc(32).toString("base64url");
const maxPollMilliseconds = Number(process.env.TLSN_E2E_MAX_POLL_MS ?? 30_000);
const pollIntervalMilliseconds = Number(process.env.TLSN_E2E_POLL_INTERVAL_MS ?? 25);
const requestedCases = (process.env.TLSN_E2E_CASES ?? "p50,p95,p99,max")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const requestedConcurrency = (process.env.TLSN_E2E_CONCURRENCY ?? "1,2,4")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isSafeInteger(value) && value > 0);

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function nowMilliseconds() {
  return performance.now();
}

function sha256Base64Url(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function internalRequestSignature(secret, jobId, body) {
  const bodyDigest = createHash("sha256").update(body).digest("base64url");
  return createHmac("sha256", secret)
    .update(`FUSOU-TLSN-INTERNAL-V1\0${jobId}\0${bodyDigest}`)
    .digest("base64url");
}

function bindingValue() {
  const prefix = Buffer.from("FUSOU-ATTESTATION-BINDING-V1\0");
  const sessionId = Buffer.from(cryptoRandomUuid().replaceAll("-", ""), "hex");
  const nonce = Buffer.from(cryptoRandomBytes(32));
  const encoded = Buffer.concat([
    prefix,
    Buffer.from([0, sessionId.length]),
    sessionId,
    Buffer.from([0, nonce.length]),
    nonce,
  ]);
  return encoded.toString("base64url");
}

function cryptoRandomBytes(size) {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function cryptoRandomUuid() {
  return globalThis.crypto.randomUUID();
}

function tlsnDeviceProofMessage(deviceId, sessionId, binding, challenge) {
  const chunks = [Buffer.from("FUSOU-TLSN-DEVICE-PROOF-V1\0")];
  for (const value of [deviceId, sessionId, binding, Buffer.from(challenge, "base64url")]) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(bytes.length);
    chunks.push(length, bytes);
  }
  return Buffer.concat(chunks);
}

function signedDeviceProof(privateKey, sessionId, binding, challenge) {
  return sign(null, tlsnDeviceProofMessage(DEVICE_ID, sessionId, binding, challenge), privateKey)
    .toString("base64url");
}

function prepareFixtures(manifest, entry, concurrency) {
  const fixtures = [];
  for (let index = 0; index < concurrency; index += 1) {
    if (index === 0) {
      fixtures.push(loadRealFixture(entry));
    } else {
      fixtures.push(generateRealFixture(fixtureSourcePath(manifest, entry), bindingValue()));
    }
  }
  return fixtures;
}

function createTestVars({ triggerUrl, binding, rootCertificate, notaryKey }) {
  const { privateKey: resultPrivateKey, publicKey: resultPublicKey } = generateKeyPairSync("ed25519");
  const { privateKey: sessionPrivateKey, publicKey: sessionPublicKey } = generateKeyPairSync("ed25519");
  const { privateKey: bindingPrivateKey, publicKey: bindingPublicKey } = generateKeyPairSync("ed25519");
  const resultPublicKeySpki = resultPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const sessionPublicKeySpki = sessionPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const bindingPublicKeySpki = bindingPublicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const sessionAuthorityKeyRegistry = JSON.stringify({
    schema_version: 1,
    scope: "tlsn-session-authority-key-registry",
    keys: [{ key_id: "session-authority-benchmark", public_key_spki: sessionPublicKeySpki, status: "ACTIVE", not_before: "2026-01-01T00:00:00.000Z", not_after: null }],
  });
  const bindingAuthorityKeyRegistry = JSON.stringify({
    schema_version: 1,
    scope: "tlsn-binding-authority-key-registry",
    keys: [{ key_id: "binding-authority-benchmark", public_key_spki: bindingPublicKeySpki, status: "ACTIVE", not_before: "2026-01-01T00:00:00.000Z", not_after: null }],
  });
  return {
    TLSN_ENVIRONMENT: "test",
    TLSN_EXECUTION_MODE: "trigger",
    TLSN_TRIGGER_API_URL: triggerUrl,
    TLSN_TRIGGER_TASK_ID: "tlsn-verify-presentation",
    TLSN_TRIGGER_SECRET_KEY: "trigger-benchmark-secret",
    TLSN_TRIGGER_CALLBACK_SECRET: CALLBACK_SECRET,
    TLSN_BENCHMARK_TIMINGS: "true",
    TLSN_TEST_BINDING_VALUE: binding,
    TLSN_BINDING_TTL_SECONDS: "300",
    TLSN_SERVER_IDENTITY: "game.example.test",
    TLSN_PROFILE_SHA256: BASE_PROFILE_SHA256,
    TLSN_SPARSE_PROFILE_SHA256: PROFILE_SHA256,
    TLSN_VERIFIER_KEY_ID: "verifier-benchmark",
    TLSN_NOTARY_KEY_ID: "notary-benchmark",
    TLSN_NOTARY_REGISTRY: JSON.stringify({ "notary-benchmark": notaryKey }),
    TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8: resultPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: sessionPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    TLSN_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: sessionPublicKeySpki,
    TLSN_SESSION_AUTHORITY_KEY_ID: "session-authority-benchmark",
    TLSN_SESSION_AUTHORITY_KEY_REGISTRY: sessionAuthorityKeyRegistry,
    TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: bindingPrivateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    TLSN_BINDING_AUTHORITY_PUBLIC_KEY_SPKI: bindingPublicKeySpki,
    TLSN_BINDING_AUTHORITY_KEY_ID: "binding-authority-benchmark",
    TLSN_BINDING_AUTHORITY_KEY_REGISTRY: bindingAuthorityKeyRegistry,
    TLSN_TRUST_ROOT_CERTIFICATE_DER: rootCertificate,
    TLSN_DEVICE_AUTH_URL: "",
    TLSN_DEVICE_POSSESSION_AUTH_URL: "",
    TLSN_TEST_AUTH_USERS: JSON.stringify({ [ACCESS_TOKEN]: { id: USER_ID, is_anonymous: false } }),
  };
}

function localWorker(vars) {
  return unstable_dev(resolve(packageDirectory, "src/index.ts"), {
    config: wranglerConfig,
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

function writeJson(response, status, body) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(encoded);
}

async function startAuthServer(devicePublicKey) {
  let currentDevicePublicKey = devicePublicKey;
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "POST" || !requestUrl.pathname.endsWith("/device-proof") && !requestUrl.pathname.endsWith("/tlsn-device-proof")) {
      writeJson(response, 404, { error: "not_found" });
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      writeJson(response, 400, { error: "invalid_json" });
      return;
    }
    if (request.headers.authorization !== AUTHORIZATION || body.device_id !== DEVICE_ID) {
      writeJson(response, 401, { error: "device_unauthorized" });
      return;
    }
    const tlsn = requestUrl.pathname.endsWith("/tlsn-device-proof");
    if (!tlsn) {
      if (body.nonce !== DEVICE_NONCE || body.sig !== DEVICE_SIGNATURE) {
        writeJson(response, 401, { error: "device_unauthorized" });
        return;
      }
    } else {
      const signature = Buffer.from(body.sig ?? "", "base64url");
      const valid = typeof body.session_id === "string"
        && typeof body.binding_value === "string"
        && typeof body.challenge === "string"
        && signature.length === 64
        && verifySignature(
          null,
          tlsnDeviceProofMessage(DEVICE_ID, body.session_id, body.binding_value, body.challenge),
          currentDevicePublicKey,
          signature,
        );
      if (!valid) {
        writeJson(response, 401, { error: "signature_invalid" });
        return;
      }
    }
    writeJson(response, 200, {
      authenticated: true,
      canonical_user_id: USER_ID,
      device_id: DEVICE_ID,
      ...(tlsn ? { replay_digest_hex: sha256Hex(tlsnDeviceProofMessage(DEVICE_ID, body.session_id, body.binding_value, body.challenge)) } : {}),
    });
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    setDevicePublicKey: (key) => { currentDevicePublicKey = key; },
  };
}

async function startTriggerServer(verifierModule, triggerState) {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.endsWith("/trigger")) {
      response.writeHead(404);
      response.end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const payload = requestBody.payload;
    triggerState.submissions += 1;
    writeJson(response, 200, { id: payload.job_id });
    void (async () => {
      try {
        const inputBody = JSON.stringify({
          job_id: payload.job_id,
          binding_id: payload.binding_id,
          session_id: payload.session_id,
          canonical_user_id: payload.canonical_user_id,
          device_id: payload.device_id,
          verification_input_key: payload.verification_input_key,
        });
        const worker = triggerState.workers.get(payload.binding_id);
        const rootCertificate = triggerState.rootCertificates.get(payload.binding_id);
        const notaryKey = triggerState.notaryKeys.get(payload.binding_id);
        if (!worker || !rootCertificate || !notaryKey) throw new Error(`unknown benchmark binding ${payload.binding_id}`);
        const inputResponse = await worker.fetch("https://verify.test/internal/tlsn/verification-input", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-FUSOU-TLSN-Job-Id": payload.job_id,
            "X-FUSOU-TLSN-Signature": internalRequestSignature(CALLBACK_SECRET, payload.job_id, inputBody),
          },
          body: inputBody,
        });
        if (!inputResponse.ok) throw new Error(`input handoff ${inputResponse.status}`);
        const presentation = new Uint8Array(await inputResponse.arrayBuffer());
        const preparedResultJson = verifierModule.verify_sparse_require_info_presentation_with_trust_anchor(
          presentation,
          "game.example.test",
          Buffer.from(PROFILE_SHA256, "base64url"),
          "verifier-benchmark",
          "notary-benchmark",
          payload.canonical_user_id,
          payload.device_id,
          Buffer.from(payload.device_challenge, "base64url"),
          Buffer.from(rootCertificate, "base64url"),
          Buffer.from(notaryKey, "base64url"),
        );
        JSON.parse(preparedResultJson);
        const callbackBody = JSON.stringify({
          job_id: payload.job_id,
          binding_id: payload.binding_id,
          session_id: payload.session_id,
          canonical_user_id: payload.canonical_user_id,
          device_id: payload.device_id,
          presentation_id: sha256Base64Url(presentation),
          verification_status: "verified",
          profile: payload.profile,
          disclosure_mode: payload.disclosure_mode,
        });
        const callbackResponse = await worker.fetch("https://verify.test/internal/tlsn/verification-complete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-FUSOU-TLSN-Job-Id": payload.job_id,
            "X-FUSOU-TLSN-Signature": internalRequestSignature(CALLBACK_SECRET, payload.job_id, callbackBody),
          },
          body: callbackBody,
        });
        if (!callbackResponse.ok) throw new Error(`completion ${callbackResponse.status}`);
        triggerState.completed += 1;
      } catch (error) {
        triggerState.errors.push(error instanceof Error ? error.message : String(error));
      }
    })();
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

function parseTimingHeader(response) {
  const value = response.headers.get("X-FUSOU-TLSN-Benchmark-Timing");
  if (!value) return null;
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

async function issueSession(worker, binding, privateKey) {
  const sessionResponse = await worker.fetch("https://verify.test/attestation/session", {
    method: "POST",
    headers: { Authorization: AUTHORIZATION, "Content-Type": "application/json", "X-FUSOU-TLSN-Test-Binding": binding },
    body: JSON.stringify({ device_id: DEVICE_ID, nonce: DEVICE_NONCE, sig: DEVICE_SIGNATURE }),
  });
  if (sessionResponse.status !== 201) throw new Error(`session issuance failed: ${sessionResponse.status} ${await sessionResponse.text()}`);
  const session = await sessionResponse.json();
  return {
    ...session,
    proofSignature: signedDeviceProof(privateKey, session.session_id, session.binding, session.device_challenge),
  };
}

async function submitVerification(worker, fixture, session) {
  const startedAt = nowMilliseconds();
  const response = await worker.fetch("https://verify.test/verify/tlsn/sparse", {
    method: "POST",
    headers: { Authorization: AUTHORIZATION, "Content-Type": "application/json" },
    body: JSON.stringify({
      presentation_base64: fixture.sparse_presentation_base64,
      session_id: session.session_id,
      binding: session.binding,
      device_id: DEVICE_ID,
      device_proof: { challenge: session.device_challenge, sig: session.proofSignature },
    }),
  });
  const elapsedMilliseconds = nowMilliseconds() - startedAt;
  if (response.status !== 202) throw new Error(`verification was not queued: ${response.status} ${await response.text()}`);
  return { jobId: (await response.json()).job_id, elapsedMilliseconds };
}

async function pollStatus(worker, session, jobId, triggerState, rssState) {
  const bindingId = sha256Base64Url(session.binding);
  const startedAt = nowMilliseconds();
  const deadline = startedAt + maxPollMilliseconds;
  while (nowMilliseconds() < deadline) {
    if (triggerState.errors.length > 0) {
      throw new Error(triggerState.errors.join("; "));
    }
    sampleRss(rssState);
    const response = await worker.fetch("https://verify.test/verify/tlsn/status", {
      method: "POST",
      headers: { Authorization: AUTHORIZATION, "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        binding_id: bindingId,
        session_id: session.session_id,
        canonical_user_id: USER_ID,
        device_id: DEVICE_ID,
      }),
    });
    if (response.status === 200) {
      const body = await response.json();
      if (body.verified !== true) throw new Error("status returned a non-verified response");
      sampleRss(rssState);
      return { elapsedMilliseconds: nowMilliseconds() - startedAt, timing: parseTimingHeader(response) };
    }
    if (response.status !== 202) throw new Error(`status failed: ${response.status} ${await response.text()}`);
    await sleep(pollIntervalMilliseconds);
  }
  throw new Error(`status polling exceeded ${maxPollMilliseconds}ms`);
}

function phaseMilliseconds(timing, start, end) {
  const startValue = timing?.timestamps?.[start];
  const endValue = timing?.timestamps?.[end];
  return startValue !== undefined && endValue !== undefined ? endValue - startValue : null;
}

function rssMegabytes(bytes) {
  return bytes == null ? null : Math.round(bytes / 1024 / 1024 * 10) / 10;
}

function sampleRss(rssState) {
  rssState.peak = Math.max(rssState.peak, process.memoryUsage().rss);
}

async function runCase({ manifest, entry, concurrency, authServer, verifierModule }) {
  const fixtures = prepareFixtures(manifest, entry, concurrency);
  const triggerState = {
    workers: new Map(),
    rootCertificates: new Map(),
    notaryKeys: new Map(),
    submissions: 0,
    completed: 0,
    errors: [],
  };
  const triggerServer = await startTriggerServer(verifierModule, triggerState);
  const { privateKey: devicePrivateKey, publicKey: devicePublicKey } = generateKeyPairSync("ed25519");
  authServer.setDevicePublicKey(devicePublicKey);
  const workers = await Promise.all(fixtures.map((fixture) => {
    const vars = createTestVars({
      triggerUrl: triggerServer.url,
      binding: fixture.binding_value,
      rootCertificate: fixture.root_certificate_base64,
      notaryKey: fixture.notary_key_base64,
    });
    vars.TLSN_DEVICE_AUTH_URL = `${authServer.url}/anonymous-sync/v2/device-proof`;
    vars.TLSN_DEVICE_POSSESSION_AUTH_URL = `${authServer.url}/anonymous-sync/v2/tlsn-device-proof`;
    return localWorker(vars);
  }));
  fixtures.forEach((fixture, index) => {
    const bindingId = sha256Base64Url(fixture.binding_value);
    triggerState.workers.set(bindingId, workers[index]);
    triggerState.rootCertificates.set(bindingId, fixture.root_certificate_base64);
    triggerState.notaryKeys.set(bindingId, fixture.notary_key_base64);
  });
  const baselineRss = process.memoryUsage().rss;
  const rssState = { peak: baselineRss };
  try {
    const sessions = await Promise.all(fixtures.map((fixture, index) => issueSession(workers[index], fixture.binding_value, devicePrivateKey)));
    const submissions = await Promise.all(fixtures.map((fixture, index) => submitVerification(workers[index], fixture, sessions[index])));
    sampleRss(rssState);
    const completed = await Promise.all(submissions.map((submission, index) => pollStatus(workers[index], sessions[index], submission.jobId, triggerState, rssState)));
    sampleRss(rssState);
    if (triggerState.errors.length > 0) throw new Error(triggerState.errors.join("; "));
    const timings = completed.map((item, index) => ({
      fixtureBytes: Buffer.from(fixtures[index].sparse_presentation_base64, "base64url").length,
      bodyBytes: entry.sourceFixtureBodyBytes,
      acceptanceMilliseconds: submissions[index].elapsedMilliseconds,
      statusMilliseconds: item.elapsedMilliseconds,
      timing: item.timing,
    }));
    return {
      caseLabel: entry.caseLabel,
      bodyBytes: entry.sourceFixtureBodyBytes,
      concurrency,
      acceptanceMilliseconds: timings.map((item) => item.acceptanceMilliseconds),
      statusMilliseconds: timings.map((item) => item.statusMilliseconds),
      clientLatencyMilliseconds: timings.map((item) => item.acceptanceMilliseconds + item.statusMilliseconds),
      queueMilliseconds: timings.map((item) => phaseMilliseconds(item.timing, "t2_trigger_submitted", "t3_callback_accepted")),
      workerReadMilliseconds: timings.map((item) => phaseMilliseconds(item.timing, "t4_lease_acquired", "t5_presentation_read")),
      wasmMilliseconds: timings.map((item) => phaseMilliseconds(item.timing, "t5_presentation_read", "t6_wasm_verification_completed")),
      finalizationMilliseconds: timings.map((item) => phaseMilliseconds(item.timing, "t6_wasm_verification_completed", "t9_consume_completed")),
      e2eMilliseconds: timings.map((item) => phaseMilliseconds(item.timing, "t0_accepted", "t10_status_verified")),
      maxVerifierConcurrency: Math.max(...timings.map((item) => item.timing?.max_verifier_concurrency ?? 0)),
      workerInstances: workers.length,
      effectiveVerifierConcurrency: workers.length,
      r2Operations: timings.map((item) => item.timing?.r2_operations ?? {}),
      baselineHarnessRssMegabytes: rssMegabytes(baselineRss),
      peakHarnessRssMegabytes: rssMegabytes(rssState.peak),
      peakHarnessRssDeltaMegabytes: rssMegabytes(rssState.peak - baselineRss),
      workerRss: "NOT_ESTABLISHED",
      triggerScheduling: "local mock",
      result: timings.every((item) => (item.timing?.timestamps?.t10_status_verified ?? 0) > 0)
        ? Math.max(...timings.map((item) => item.acceptanceMilliseconds + item.statusMilliseconds)) <= 3_000
          ? "MEASURED WITHIN TARGET"
          : "EXCEEDS TARGET"
        : "INCOMPLETE",
    };
  } finally {
    await Promise.all(workers.map((worker) => worker.stop()));
    triggerServer.server.close();
  }
}

async function main() {
  if (requestedCases.length === 0 || requestedConcurrency.length === 0) throw new Error("TLSN_E2E_CASES and TLSN_E2E_CONCURRENCY must not be empty");
  const { manifest, entries } = readRealFixtureManifest();
  const missing = requestedCases.filter((caseLabel) => !entries.has(caseLabel));
  if (missing.length > 0) throw new Error(`unknown real fixture cases: ${missing.join(", ")}`);
  const { publicKey: initialDevicePublicKey } = generateKeyPairSync("ed25519");
  const authServer = await startAuthServer(initialDevicePublicKey);
  const verifierModule = await import("../src/wasm/fusou_tlsn_verifier.js");
  verifierModule.initSync(readFileSync(resolve(packageDirectory, "src/wasm/fusou_tlsn_verifier_bg.wasm")));
  try {
    const results = [];
    for (const concurrency of requestedConcurrency) {
      for (const caseLabel of requestedCases) {
        const result = await runCase({ manifest, entry: entries.get(caseLabel), concurrency, authServer, verifierModule });
        results.push(result);
        console.log(JSON.stringify(result));
      }
    }
    console.log("\nCase | Body | Presentation | C | Accept 202 | Poll total | Queue | Worker WASM | Finalize | E2E | Peak RSS | Result");
    console.log("--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---");
    for (const result of results) {
      const median = (values) => {
        const present = values.filter((value) => value != null).sort((left, right) => left - right);
        return present.length === 0 ? "N/A" : String(Math.round(present[Math.floor(present.length / 2)]));
      };
      const presentationBytes = prepareFixtures(manifest, entries.get(result.caseLabel), 1)[0].sparse_presentation_base64;
      console.log(`${result.caseLabel} | ${result.bodyBytes} B | ${Buffer.from(presentationBytes, "base64url").length} B | ${result.concurrency} | ${median(result.acceptanceMilliseconds)} ms | ${median(result.statusMilliseconds)} ms | ${median(result.queueMilliseconds)} ms | ${median(result.wasmMilliseconds)} ms | ${median(result.finalizationMilliseconds)} ms | ${median(result.e2eMilliseconds)} ms | ${result.peakHarnessRssMegabytes ?? "N/A"} MB (+${result.peakHarnessRssDeltaMegabytes ?? "N/A"} MB) + Worker ${result.workerRss} | ${result.result}`);
    }
    console.log(JSON.stringify({ benchmark: "tlsn-worker-e2e", target: "approximately 2-3 seconds (informational)", triggerScheduling: "local mock", workerRss: "NOT_ESTABLISHED", results }, null, 2));
  } finally {
    authServer.server.close();
  }
}

await main();
