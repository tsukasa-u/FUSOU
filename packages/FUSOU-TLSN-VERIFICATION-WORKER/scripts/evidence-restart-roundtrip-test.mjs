#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, createHmac, createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { unstable_dev } from "wrangler";
import { verifyProductionPresentation, verifySemanticPredicates, assertSemanticResultMatches } from "./production-evidence-semantic.mjs";
import { assertSignedResult } from "./production-evidence.mjs";
import { createSignedResultRegistryEnvelope, resultRegistryEnvelopeHash } from "./result-registry-envelope.mjs";
import { sha256Base64Url } from "./deployment-attestation.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const packageDirectory = resolve(dirname(scriptPath), "..");
const repositoryDirectory = resolve(packageDirectory, "../..");
const proxyManifest = resolve(repositoryDirectory, "packages/FUSOU-PROXY/proxy-https/Cargo.toml");
const childMode = process.argv[2] === "--child";
const controlPort = Number(process.argv[3] ?? 0);
const runDirectory = process.argv[4];
const configPath = process.argv[5];

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID = "33333333-3333-4333-8333-333333333333";
const ACCESS_TOKEN = "restart-roundtrip-token";
const CALLBACK_SECRET = "restart-roundtrip-callback-secret";
const TEST_SECRET = "restart-roundtrip-trigger-secret";
const PROFILE_SHA256 = Buffer.alloc(32).toString("base64url");

function jsonResponse(response, status, body) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": bytes.length });
  response.end(bytes);
}

async function requestJson(port, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { text };
  }
  return { status: response.status, body: parsed };
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function internalRequestSignature(secret, jobId, body) {
  const digest = createHash("sha256").update(body).digest("base64url");
  return createHmac("sha256", secret)
    .update(`FUSOU-TLSN-INTERNAL-V1\0${jobId}\0${digest}`)
    .digest("base64url");
}

function pushLengthPrefixed(chunks, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  chunks.push(length, bytes);
}

function tlsnDeviceProofMessage(deviceId, sessionId, bindingValue, challenge) {
  const chunks = [Buffer.from("FUSOU-TLSN-DEVICE-PROOF-V1\0")];
  pushLengthPrefixed(chunks, deviceId);
  pushLengthPrefixed(chunks, sessionId);
  pushLengthPrefixed(chunks, bindingValue);
  pushLengthPrefixed(chunks, Buffer.from(challenge, "base64url"));
  return Buffer.concat(chunks);
}

async function readJson(path) {
  return JSON.parse((await readFile(path)).toString("utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2));
}

async function walkFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

async function findPersistedBytes(directory, expectedBytes) {
  const matches = [];
  for (const path of await walkFiles(directory)) {
    let bytes;
    try {
      bytes = await readFile(path);
    } catch {
      continue;
    }
    if (Buffer.compare(bytes, expectedBytes) === 0) matches.push(path);
  }
  return matches;
}

async function childMain() {
  assert(runDirectory && configPath, "child runtime paths are required");
  const config = await readJson(configPath);
  const payloadPath = join(runDirectory, "trigger-payload.json");
  const sessionPath = join(runDirectory, "session.json");
  const presentationPath = join(runDirectory, "presentation.bin");
  const attemptPath = join(runDirectory, "attempt.json");

  const triggerServer = createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.endsWith("/trigger")) {
      jsonResponse(response, 404, { error: "not_found" });
      return;
    }
    const body = await readRequestBody(request);
    const parsed = JSON.parse(body.toString("utf8"));
    await writeJson(payloadPath, parsed.payload);
    jsonResponse(response, 200, { id: parsed.payload.job_id });
  });
  await new Promise((resolveServer) => triggerServer.listen(0, "127.0.0.1", resolveServer));
  const triggerOrigin = `http://127.0.0.1:${triggerServer.address().port}`;
  const worker = await unstable_dev(resolve(packageDirectory, "src/index.ts"), {
    config: resolve(packageDirectory, "wrangler.toml"),
    env: "test",
    envFiles: [],
    persist: true,
    persistTo: config.persistDirectory,
    vars: { ...config.vars, TLSN_TRIGGER_API_URL: triggerOrigin },
    bundle: true,
    local: true,
    compatibilityDate: "2026-07-29",
    experimental: {
      disableExperimentalWarning: true,
      forceLocal: true,
      testMode: true,
    },
  });

  const invokeWorker = async (path, options = {}) => {
    const response = await worker.fetch(`https://restart.test${path}`, options);
    const bytes = Buffer.from(await response.arrayBuffer());
    let body = null;
    if (bytes.length > 0) {
      try {
        body = JSON.parse(bytes.toString("utf8"));
      } catch {
        body = { raw: bytes.toString("utf8") };
      }
    }
    return { status: response.status, body, bytes };
  };

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await worker.stop().catch(() => undefined);
    await new Promise((resolveServer) => triggerServer.close(resolveServer));
  };
  process.once("SIGTERM", async () => { await shutdown(); process.exit(0); });
  process.once("SIGINT", async () => { await shutdown(); process.exit(130); });

  const controlServer = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://restart.test").pathname;
      const body = request.method === "POST" ? JSON.parse((await readRequestBody(request)).toString("utf8") || "{}") : {};
      if (path === "/issue") {
        const result = await invokeWorker("/attestation/session", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ACCESS_TOKEN}` },
          body: JSON.stringify({ device_id: DEVICE_ID, nonce: body.nonce, sig: body.sig }),
        });
        if (result.body) await writeJson(sessionPath, result.body);
        jsonResponse(response, result.status, result.body);
        return;
      }
      if (path === "/submit") {
        const session = await readJson(sessionPath);
        const presentation = Buffer.from(body.presentation_base64, "base64url");
        await writeFile(presentationPath, presentation);
        const result = await invokeWorker("/verify/tlsn", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ACCESS_TOKEN}` },
          body: JSON.stringify({
            presentation_base64: body.presentation_base64,
            session_id: session.session_id,
            binding: session.binding,
            device_id: DEVICE_ID,
            device_proof: { challenge: session.device_challenge, sig: body.device_proof_sig },
          }),
        });
        await writeJson(join(runDirectory, "submit-response.json"), result.body);
        jsonResponse(response, result.status, result.body);
        return;
      }
      if (path === "/callback-begin" || path === "/callback") {
        const payload = await readJson(payloadPath);
        let attempt;
        if (existsSync(attemptPath)) attempt = (await readJson(attemptPath)).verification_attempt_id;
        if (!attempt) {
          attempt = crypto.randomUUID();
          await writeJson(attemptPath, { verification_attempt_id: attempt });
        }
        const callbackBody = JSON.stringify({
          job_id: payload.job_id,
          binding_id: payload.binding_id,
          session_id: payload.session_id,
          canonical_user_id: payload.canonical_user_id,
          device_id: payload.device_id,
          presentation_id: createHash("sha256").update(await readFile(presentationPath)).digest("base64url"),
          verification_status: "verified",
          profile: payload.profile,
          disclosure_mode: payload.disclosure_mode,
          verification_attempt_id: attempt,
        });
        const callbackPromise = invokeWorker("/internal/tlsn/verification-complete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-FUSOU-TLSN-Job-Id": payload.job_id,
            "X-FUSOU-TLSN-Signature": internalRequestSignature(CALLBACK_SECRET, payload.job_id, callbackBody),
            ...(body.fault ? { "X-FUSOU-TLSN-Test-Fault": body.fault } : {}),
          },
          body: callbackBody,
        });
        if (path === "/callback-begin") {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, Number(body.wait_ms ?? 200)));
          jsonResponse(response, 202, { started: true, verification_attempt_id: attempt });
          callbackPromise.then((result) => writeJson(join(runDirectory, "callback-response.json"), result.body)).catch(() => undefined);
          return;
        }
        const result = await callbackPromise;
        await writeJson(join(runDirectory, "callback-response.json"), result.body);
        jsonResponse(response, result.status, result.body);
        return;
      }
      if (path === "/status") {
        const payload = await readJson(payloadPath);
        const result = await invokeWorker("/verify/tlsn/status", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${ACCESS_TOKEN}` },
          body: JSON.stringify({ job_id: payload.job_id, binding_id: payload.binding_id, session_id: payload.session_id, canonical_user_id: payload.canonical_user_id, device_id: payload.device_id }),
        });
        await writeJson(join(runDirectory, "status-response.json"), result.body);
        jsonResponse(response, result.status, result.body);
        return;
      }
      jsonResponse(response, 404, { error: "not_found" });
    } catch (error) {
      jsonResponse(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise((resolveServer) => controlServer.listen(controlPort, "127.0.0.1", resolveServer));
  process.stdout.write(`READY ${controlServer.address().port}\n`);
  await new Promise(() => undefined);
}

function runFixture() {
  const result = spawnSync("cargo", [
    "+1.95.0", "run", "--quiet", "--manifest-path", proxyManifest,
    "--features", "synthetic-tlsn", "--example", "synthetic_tlsn_fixture",
  ], { cwd: repositoryDirectory, encoding: "utf8" });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

function createConfig(fixture) {
  const resultKeys = generateKeyPairSync("ed25519");
  const sessionKeys = generateKeyPairSync("ed25519");
  const bindingKeys = generateKeyPairSync("ed25519");
  const deviceKeys = generateKeyPairSync("ed25519");
  const resultPublicKeySpki = resultKeys.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const sessionPublicKeySpki = sessionKeys.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const bindingPublicKeySpki = bindingKeys.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const devicePublicKeyRaw = deviceKeys.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const registry = {
    schema_version: 1,
    scope: "tlsn-result-signing-key-registry",
    keys: [{ key_id: "worker-restart", public_key_spki: resultPublicKeySpki, status: "ACTIVE", not_before: "2026-01-01T00:00:00.000Z", not_after: null }],
  };
  const registryRaw = JSON.stringify(registry);
  const rootKeys = generateKeyPairSync("ed25519");
  const rootPublicKeySpki = rootKeys.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const envelope = createSignedResultRegistryEnvelope({ registry, registryRaw, rootKeyId: "registry-root-restart", rootPublicKeySpki, rootPrivateKeyPkcs8: rootKeys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url") });
  return {
    fixture,
    resultPublicKeySpki,
    registry,
    registryRaw,
    envelope,
    rootPublicKeySpki,
    devicePrivateKeyPkcs8: deviceKeys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    vars: {
      TLSN_ENVIRONMENT: "test",
      TLSN_EXECUTION_MODE: "trigger",
      TLSN_TRIGGER_TASK_ID: "tlsn-verify-presentation",
      TLSN_TRIGGER_SECRET_KEY: TEST_SECRET,
      TLSN_TRIGGER_CALLBACK_SECRET: CALLBACK_SECRET,
      TLSN_BINDING_TTL_SECONDS: "300",
      TLSN_TEST_BINDING_VALUE: fixture.binding_value,
      TLSN_SERVER_IDENTITY: "game.example.test",
      TLSN_PROFILE_SHA256: PROFILE_SHA256,
      TLSN_VERIFIER_KEY_ID: "worker-restart",
      TLSN_NOTARY_KEY_ID: "notary-restart",
      TLSN_NOTARY_REGISTRY: JSON.stringify({ "notary-restart": fixture.notary_key_base64 }),
      TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8: resultKeys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
      TLSN_RESULT_SIGNING_KEY_REGISTRY: registryRaw,
      TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: sessionKeys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
      TLSN_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: sessionPublicKeySpki,
      TLSN_SESSION_AUTHORITY_KEY_ID: "session-restart",
      TLSN_SESSION_AUTHORITY_KEY_REGISTRY: JSON.stringify({ schema_version: 1, scope: "tlsn-session-authority-key-registry", keys: [{ key_id: "session-restart", public_key_spki: sessionPublicKeySpki, status: "ACTIVE", not_before: "2026-01-01T00:00:00.000Z", not_after: null }] }),
      TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: bindingKeys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
      TLSN_BINDING_AUTHORITY_PUBLIC_KEY_SPKI: bindingPublicKeySpki,
      TLSN_BINDING_AUTHORITY_KEY_ID: "binding-restart",
      TLSN_BINDING_AUTHORITY_KEY_REGISTRY: JSON.stringify({ schema_version: 1, scope: "tlsn-binding-authority-key-registry", keys: [{ key_id: "binding-restart", public_key_spki: bindingPublicKeySpki, status: "ACTIVE", not_before: "2026-01-01T00:00:00.000Z", not_after: null }] }),
      TLSN_TRUST_ROOT_CERTIFICATE_DER: fixture.root_certificate_base64,
      TLSN_DEVICE_AUTH_URL: "http://127.0.0.1/device-proof",
      TLSN_DEVICE_POSSESSION_AUTH_URL: "http://127.0.0.1/tlsn-device-proof",
      TLSN_TEST_AUTH_USERS: JSON.stringify({ [ACCESS_TOKEN]: { id: USER_ID, is_anonymous: false } }),
      TLSN_TEST_DEVICE_ID: DEVICE_ID,
      TLSN_TEST_DEVICE_PUBLIC_KEY: devicePublicKeyRaw.toString("base64url"),
      TLSN_TEST_COMPLETION_DELAY_MS: "3000",
    },
  };
}

async function startChild(runDirectory, configPath) {
  const child = spawn(process.execPath, [scriptPath, "--child", "0", runDirectory, configPath], { cwd: packageDirectory, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const ready = new Promise((resolveReady, rejectReady) => {
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/READY (\d+)/);
      if (match) {
        child.stdout.off("data", onData);
        resolveReady(Number(match[1]));
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", rejectReady);
    child.once("exit", (code, signal) => rejectReady(new Error(`child exited before READY: ${code ?? signal}\n${output}`)));
  });
  return { child, port: await ready };
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => rejectExit(new Error("persisted worker did not stop")), 15_000);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0 || code === 143 || signal === "SIGTERM") resolveExit();
      else rejectExit(new Error(`persisted worker stopped with ${code ?? signal}`));
    });
  });
}

async function childCall(port, path, body = {}) {
  return requestJson(port, path, body);
}

async function runScenario(name, config, fixture, rootDirectory, mode) {
  const scenarioDirectory = join(rootDirectory, name);
  const persistDirectory = join(scenarioDirectory, "persisted");
  await mkdir(persistDirectory, { recursive: true });
  const configPath = join(scenarioDirectory, "config.json");
  await writeJson(configPath, { ...config, persistDirectory });
  const devicePrivateKey = createPrivateKey({ key: Buffer.from(config.devicePrivateKeyPkcs8, "base64url"), format: "der", type: "pkcs8" });
  let runtime = await startChild(scenarioDirectory, configPath);
  const nonce = randomBytes(32).toString("hex");
  const issue = await childCall(runtime.port, "/issue", { nonce, sig: sign(null, Buffer.from(nonce), devicePrivateKey).toString("base64url") });
  assert.equal(issue.status, 201, `${name}: session issuance ${JSON.stringify(issue.body)}`);
  const session = issue.body;
  const presentation = mode === "failed" ? Buffer.from("invalid-presentation") : Buffer.from(fixture.presentation_base64, "base64url");
  const proof = sign(null, tlsnDeviceProofMessage(DEVICE_ID, session.session_id, session.binding, session.device_challenge), devicePrivateKey).toString("base64url");
  const submit = await childCall(runtime.port, "/submit", { presentation_base64: presentation.toString("base64url"), device_proof_sig: proof });
  assert.equal(submit.status, 202, `${name}: verification submission`);
  await stopChild(runtime.child);

  runtime = await startChild(scenarioDirectory, configPath);
  if (mode === "acquire-resume" || mode === "late-callback") {
    const begin = await childCall(runtime.port, "/callback-begin", { wait_ms: 250 });
    assert.equal(begin.status, 202, `${name}: callback begin`);
    await stopChild(runtime.child);
    runtime = await startChild(scenarioDirectory, configPath);
  }
  const callback = await childCall(runtime.port, "/callback");
  if (mode === "failed") assert.equal(callback.status, 422, `${name}: failed callback`);
  else assert.equal(callback.status, 200, `${name}: callback ${JSON.stringify(callback.body)}`);
  const status = await childCall(runtime.port, "/status");
  if (mode === "failed") {
    assert.equal(status.status, 200, `${name}: failed status`);
    assert.equal(status.body.verified, false);
    assert.equal(status.body.status, "not_verified");
  } else {
    assert.equal(status.status, 200, `${name}: verified status`);
    assert.equal(status.body.verified, true);
  }
  if (mode === "duplicate") {
    await stopChild(runtime.child);
    runtime = await startChild(scenarioDirectory, configPath);
    const duplicate = await childCall(runtime.port, "/callback");
    assert.equal(duplicate.status, 200, `${name}: duplicate callback`);
    assert.deepEqual(duplicate.body, { accepted: true });
  }
  await stopChild(runtime.child);
  return {
    name,
    session,
    payload: await readJson(join(scenarioDirectory, "trigger-payload.json")),
    presentation,
    finalResponse: status.body.verified ? status.body : null,
    callback: await readJson(join(scenarioDirectory, "callback-response.json")).catch(() => null),
    persistDirectory,
  };
}

async function verifyBundle(bundleDirectory, config) {
  const bundle = await readJson(join(bundleDirectory, "bundle.json"));
  const presentationBytes = await readFile(join(bundleDirectory, "presentation.bin"));
  const result = bundle.final_response.result;
  assert.equal(bundle.artifacts.presentation_sha256, sha256Base64Url(presentationBytes));
  assert.equal(bundle.artifacts.result_sha256, sha256Base64Url(Buffer.from(JSON.stringify(bundle.final_response))));
  const semanticVerification = await verifyProductionPresentation({
    presentationBytes,
    serverIdentity: bundle.trusted_inputs.server_identity,
    profileSha256: bundle.trusted_inputs.profile_sha256,
    verifierKeyId: bundle.trusted_inputs.verifier_key_id,
    notaryKeyId: bundle.trusted_inputs.notary_key_id,
    canonicalUserId: result.canonical_user_id,
    canonicalDeviceId: result.device_id,
    deviceChallenge: result.device_challenge,
    notaryRegistry: bundle.notary_registry,
    trustAnchorDer: bundle.trusted_inputs.trust_root_certificate_der,
  });
  assertSemanticResultMatches(result, semanticVerification);
  assertSignedResult(result, { publicKeySpki: config.resultPublicKeySpki, keyRegistry: config.registry, signerKeyId: "worker-restart" });
  const predicates = verifySemanticPredicates({
    presentationBytes,
    semanticVerification,
    result,
    trustedInputs: bundle.trusted_inputs,
    notaryRegistry: bundle.notary_registry,
    resultRegistry: config.registry,
    resultRegistryRaw: config.registryRaw,
    resultRegistryEnvelope: config.envelope,
    resultRegistryEnvelopeRaw: Buffer.from(JSON.stringify(config.envelope)),
    resultRegistrySha256: sha256Base64Url(Buffer.from(config.registryRaw)),
    resultPublicKeySpki: config.resultPublicKeySpki,
    resultSignerKeyId: "worker-restart",
    trustRootCertificateBytes: Buffer.from(bundle.trusted_inputs.trust_root_certificate_der, "base64url"),
    sessionBinding: bundle.session.binding,
    sessionId: bundle.session.session_id,
  });
  assert.ok(Object.values(predicates).every((item) => item.status === "PASS"), JSON.stringify(predicates));
  return { bundle, presentationBytes, semanticVerification, predicates };
}

async function runTamperMatrix(config, verified) {
  const { bundle, presentationBytes } = verified;
  const expectReject = async (name, action) => {
    let rejected = false;
    try { await action(); } catch { rejected = true; }
    assert.equal(rejected, true, `${name}: tamper was accepted`);
  };
  await expectReject("presentation", () => verifyProductionPresentation({
    presentationBytes: Buffer.from(presentationBytes).subarray(1),
    serverIdentity: bundle.trusted_inputs.server_identity,
    profileSha256: bundle.trusted_inputs.profile_sha256,
    verifierKeyId: bundle.trusted_inputs.verifier_key_id,
    notaryKeyId: bundle.trusted_inputs.notary_key_id,
    canonicalUserId: bundle.final_response.result.canonical_user_id,
    canonicalDeviceId: bundle.final_response.result.device_id,
    deviceChallenge: bundle.final_response.result.device_challenge,
    notaryRegistry: bundle.notary_registry,
    trustAnchorDer: bundle.trusted_inputs.trust_root_certificate_der,
  }));
  const predicateContext = {
    presentationBytes,
    semanticVerification: verified.semanticVerification,
    result: bundle.final_response.result,
    trustedInputs: bundle.trusted_inputs,
    notaryRegistry: bundle.notary_registry,
    resultRegistry: config.registry,
    resultRegistryRaw: config.registryRaw,
    resultRegistryEnvelope: config.envelope,
    resultRegistryEnvelopeRaw: Buffer.from(JSON.stringify(config.envelope)),
    resultRegistrySha256: sha256Base64Url(Buffer.from(config.registryRaw)),
    resultPublicKeySpki: config.resultPublicKeySpki,
    resultSignerKeyId: "worker-restart",
    trustRootCertificateBytes: Buffer.from(bundle.trusted_inputs.trust_root_certificate_der, "base64url"),
    sessionBinding: bundle.session.binding,
    sessionId: bundle.session.session_id,
  };
  for (const [name, overrides] of [
    ["server identity", { trustedInputs: { ...bundle.trusted_inputs, server_identity: "other.example" } }],
    ["binding", { sessionBinding: `${bundle.session.binding}A` }],
    ["profile", { trustedInputs: { ...bundle.trusted_inputs, profile_sha256: Buffer.alloc(32, 9).toString("base64url") } }],
    ["verifier identity", { trustedInputs: { ...bundle.trusted_inputs, verifier_key_id: "other-verifier" } }],
    ["result", { result: { ...bundle.final_response.result, verified_member_id: "00000000" } }],
    ["result signature", { result: { ...bundle.final_response.result, signature: `${bundle.final_response.result.signature}A` } }],
  ]) {
    const predicates = verifySemanticPredicates({ ...predicateContext, ...overrides });
    assert.ok(Object.values(predicates).some((item) => item.status === "FAIL"), `${name}: tamper was accepted`);
  }
  const metadataTamper = structuredClone(bundle);
  metadataTamper.artifacts.presentation_sha256 = "tampered";
  assert.notEqual(metadataTamper.artifacts.presentation_sha256, sha256Base64Url(presentationBytes), "evidence metadata tamper was accepted");
  return 8;
}

async function parentMain() {
  const fixture = runFixture();
  const config = createConfig(fixture);
  const rootDirectory = await mkdtemp(join(tmpdir(), "fusou-tlsn-restart-roundtrip-"));
  try {
    const scenarios = {};
    scenarios.a = await runScenario("a-start-stop-restart-callback", config, fixture, rootDirectory, "restart");
    scenarios.b = await runScenario("b-acquire-stop-restart-callback", config, fixture, rootDirectory, "acquire-resume");
    scenarios.c = await runScenario("c-late-callback-after-restart", config, fixture, rootDirectory, "late-callback");
    scenarios.d = await runScenario("d-duplicate-after-restart", config, fixture, rootDirectory, "duplicate");
    scenarios.e = await runScenario("e-failed-stale-after-restart", config, fixture, rootDirectory, "failed");

    const primary = scenarios.a;
    const bundleDirectory = join(rootDirectory, "evidence-bundle");
    await mkdir(bundleDirectory, { recursive: true });
    await writeFile(join(bundleDirectory, "presentation.bin"), primary.presentation);
    const finalResponse = primary.finalResponse;
    assert(finalResponse?.verified === true, "primary result is missing");
    const trustedInputs = {
      server_identity: "game.example.test",
      profile_id: "fusou-require-info-v1",
      profile_sha256: PROFILE_SHA256,
      verifier_key_id: "worker-restart",
      notary_key_id: "notary-restart",
      trust_root_certificate_sha256: sha256Base64Url(Buffer.from(fixture.root_certificate_base64, "base64url")),
      trust_root_certificate_der: fixture.root_certificate_base64,
      result_public_key_spki: config.resultPublicKeySpki,
      result_signer_key_id: "worker-restart",
      result_key_registry_sha256: sha256Base64Url(Buffer.from(config.registryRaw)),
      result_key_registry_envelope_sha256: resultRegistryEnvelopeHash(Buffer.from(JSON.stringify(config.envelope))),
      result_registry_root_key_id: "registry-root-restart",
      result_registry_root_public_key_spki: config.rootPublicKeySpki,
    };
    const archiveMatches = await findPersistedBytes(primary.persistDirectory, Buffer.from(JSON.stringify(finalResponse)));
    const bundle = {
      schema_version: 1,
      kind: "synthetic-test-worker-evidence-roundtrip",
      runtime: "wrangler-unstable-dev-persisted-local",
      session: primary.session,
      payload: primary.payload,
      final_response: finalResponse,
      notary_registry: { "notary-restart": fixture.notary_key_base64 },
      trusted_inputs: trustedInputs,
      artifacts: {
        presentation_sha256: sha256Base64Url(primary.presentation),
        result_sha256: sha256Base64Url(Buffer.from(JSON.stringify(finalResponse))),
        result_object_key: primary.payload.verification_result_key,
        archive_exact_result_matches: archiveMatches.length,
      },
      observations: {
        commit: "authoritative Durable Object result/state commit observed through status",
        archive: archiveMatches.length > 0 ? "R2 persisted result bytes observed" : "R2 archive bytes not found",
        process_restart: "five separate child process stop/start transitions completed",
      },
    };
    await writeJson(join(bundleDirectory, "bundle.json"), bundle);
    assert.ok(archiveMatches.length > 0, "R2 result archive was not observed in persisted local storage");
    const verified = await verifyBundle(bundleDirectory, config);
    const tamperCount = await runTamperMatrix(config, verified);
    console.log(JSON.stringify({
      "EVIDENCE ROUND TRIP": "CLOSED",
      "EVIDENCE TAMPER": "PASS",
      "PROCESS RESTART": "CLOSED",
      "RESTART INVARIANTS": "PASS",
      "RESULT ↔ EVIDENCE BINDING": "PASS",
      "EXTERNAL AUTHORITY": "NOT PROVIDED",
      "REAL CANARY": "NOT EXECUTED",
      "tamper_cases": tamperCount,
      "archive_exact_result_matches": archiveMatches.length,
      "bundle_directory": bundleDirectory,
    }, null, 2));
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
}

if (childMode) await childMain();
else await parentMain();