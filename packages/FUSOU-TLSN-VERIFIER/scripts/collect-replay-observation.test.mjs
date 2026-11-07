import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import {
  collectReplayObservation,
  writeReplayObservation,
} from "./collect-replay-observation.mjs";
import { tlsnDeviceProofSigningBytes } from "../../FUSOU-TLSN-VERIFICATION-WORKER/src/device-proof-framing.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const token = "offline-test-only";
const digest = (bytes) => createHash("sha256").update(bytes).digest();

async function createCandidate() {
  const root = await mkdtemp(join(tmpdir(), "fusou-replay-candidate-"));
  const presentation = Buffer.from("synthetic TLSN Presentation bytes");
  const challenge = Buffer.alloc(32, 7);
  const challengeB64 = challenge.toString("base64url");
  const binding = "synthetic-binding-context";
  const proofInput = {
    device_id: deviceId,
    session_id: sessionId,
    binding_value: binding,
    challenge: challengeB64,
    sig: "synthetic-signature-not-production-evidence",
  };
  const proofDigest = digest(tlsnDeviceProofSigningBytes(proofInput, challenge)).toString("hex");
  const result = {
    canonical_user_id: userId,
    canonical_device_id: deviceId,
    attestation_session_id: sessionId,
    binding_value: binding,
    device_challenge: challengeB64,
  };
  const consumeReceipt = {
    canonical_user_id: userId,
    device_id: deviceId,
    session_id: sessionId,
    binding_value: binding,
    presentation_id: digest(presentation).toString("base64url"),
  };
  const envelope = {
    verified: true,
    result,
    consume_receipt: consumeReceipt,
    device_replay_digest_hex: proofDigest,
  };
  const receipt = Buffer.from("synthetic execution receipt bytes");
  const files = new Map([
    ["presentation.bin", presentation],
    ["result.json", Buffer.from(JSON.stringify(result))],
    ["result-exact.bin", Buffer.from(JSON.stringify(envelope))],
    ["worker-verification.json", Buffer.from(JSON.stringify(envelope, null, 2))],
    ["consume-receipt.json", Buffer.from(JSON.stringify(consumeReceipt))],
    ["session.json", Buffer.from(JSON.stringify({
      canonical_user_id: userId,
      device_id: deviceId,
      session_id: sessionId,
      binding,
      device_challenge: challengeB64,
    }))],
    ["possession-proof.json", Buffer.from(JSON.stringify({
      ...proofInput,
      message_sha256_hex: proofDigest,
      replay_digest_hex: proofDigest,
    }))],
    ["verifier-execution-receipt.bin", receipt],
    ["verifier-execution-receipt-header.txt", Buffer.from(receipt.toString("base64url"))],
  ]);
  const artifacts = {};
  for (const [name, bytes] of files) {
    await writeFile(join(root, name), bytes, { mode: 0o600 });
    artifacts[name] = {
      size_bytes: bytes.length,
      sha256: digest(bytes).toString("base64url"),
    };
  }
  const manifest = {
    schema_version: 2,
    scope: "fusou-tlsn-human-test-play-candidate",
    synthetic_fixture: false,
    capture_provenance: "production-proxy-capture",
    candidate_status: "CAPTURED_PENDING_OFFLINE_VERIFICATION",
    verifier_execution_receipt_status: "CAPTURED",
    presentation_sha256: artifacts["presentation.bin"].sha256,
    exact_result_sha256: artifacts["result-exact.bin"].sha256,
    verifier_execution_receipt_sha256: artifacts["verifier-execution-receipt.bin"].sha256,
    artifacts,
  };
  await writeFile(join(root, "candidate-manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
  return {
    root,
    proof: proofInput,
    proofDigest,
    presentationId: consumeReceipt.presentation_id,
    sessionId,
    userId,
    deviceId,
    binding,
    challenge,
  };
}

async function startServer(handler) {
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    await handler(request, response, Buffer.concat(chunks));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    server,
    endpoint: `http://127.0.0.1:${address.port}/api/auth/anonymous-sync/v2/tlsn-device-proof`,
  };
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function storedProof(candidate, overrides = {}) {
  return {
    canonical_user_id: candidate.userId,
    device_id: candidate.deviceId,
    proof_kind: "possession",
    proof_digest: candidate.proofDigest,
    session_id: candidate.sessionId,
    binding_sha256: digest(Buffer.from(candidate.binding)).toString("hex"),
    challenge_sha256: digest(candidate.challenge).toString("hex"),
    consumed_at: "2026-11-07T12:00:00.000Z",
    ...overrides,
  };
}

function replayResponse(candidate, overrides = {}) {
  return Buffer.from(JSON.stringify({
    error: "device_proof_replayed",
    stored_proof: storedProof(candidate, overrides),
  }));
}

test("collects one exact matching HTTP 409 and preserves body bytes and capture context", async () => {
  const candidate = await createCandidate();
  const bodyBytes = replayResponse(candidate);
  const requests = [];
  const { server, endpoint } = await startServer((request, response, requestBody) => {
    requests.push({ request, body: JSON.parse(requestBody.toString("utf8")) });
    response.writeHead(409, { "Content-Type": "application/json", "Content-Length": bodyBytes.length });
    response.end(bodyBytes);
  });
  try {
    const material = await collectReplayObservation(candidate.root, endpoint, token);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].request.method, "POST");
    assert.equal(requests[0].request.url, "/api/auth/anonymous-sync/v2/tlsn-device-proof");
    assert.equal(requests[0].request.headers["x-fusou-tlsn-replay-observation"], "true");
    assert.equal(requests[0].request.headers.authorization, `Bearer ${token}`);
    assert.deepEqual(requests[0].body, candidate.proof);
    assert.equal(material.status, 409);
    assert.equal(material.session_id, candidate.sessionId);
    assert.equal(material.device_id, candidate.deviceId);
    assert.equal(material.consume_receipt_presentation_id, candidate.presentationId);
    assert.equal(material.stored_replay_digest_hex, candidate.proofDigest);
    assert.equal(material.authority_observation_signed, false);
    assert.deepEqual(Buffer.from(material.response_body_base64url, "base64url"), bodyBytes);
    assert.equal(material.response_body_byte_length, bodyBytes.length);
    assert.equal(material.response_body_sha256, digest(bodyBytes).toString("base64url"));
    assert.equal(material.response_body_sha256_hex, digest(bodyBytes).toString("hex"));
  } finally {
    await closeServer(server);
    await rm(candidate.root, { recursive: true, force: true });
  }
});

test("a cached-result HTTP 200 is not a replay rejection", async () => {
  const candidate = await createCandidate();
  const cachedResult = Buffer.from(JSON.stringify({ verified: true, result: { cached: true } }));
  const { server, endpoint } = await startServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(cachedResult);
  });
  try {
    await assert.rejects(
      collectReplayObservation(candidate.root, endpoint, token),
      /requires HTTP 409; received 200/,
    );
  } finally {
    await closeServer(server);
    await rm(candidate.root, { recursive: true, force: true });
  }
});

test("a 409 for another proof context is rejected", async () => {
  const candidate = await createCandidate();
  const bodyBytes = replayResponse(candidate, { session_id: "44444444-4444-4444-8444-444444444444" });
  const { server, endpoint } = await startServer((_request, response) => {
    response.writeHead(409, { "Content-Type": "application/json" });
    response.end(bodyBytes);
  });
  try {
    await assert.rejects(
      collectReplayObservation(candidate.root, endpoint, token),
      /does not match this candidate/,
    );
  } finally {
    await closeServer(server);
    await rm(candidate.root, { recursive: true, force: true });
  }
});

for (const status of [401, 403, 500, 503]) {
  test(`HTTP ${status} is not replay evidence`, async () => {
    const candidate = await createCandidate();
    const { server, endpoint } = await startServer((_request, response) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not_a_replay_observation" }));
    });
    try {
      await assert.rejects(collectReplayObservation(candidate.root, endpoint, token), new RegExp(`received ${status}`));
    } finally {
      await closeServer(server);
      await rm(candidate.root, { recursive: true, force: true });
    }
  });
}

test("malformed and oversized response bodies are rejected", async () => {
  const candidate = await createCandidate();
  const malformed = await startServer((_request, response) => {
    response.writeHead(409, { "Content-Type": "application/json" });
    response.end("{");
  });
  try {
    await assert.rejects(
      collectReplayObservation(candidate.root, malformed.endpoint, token),
      /not valid UTF-8 JSON/,
    );
  } finally {
    await closeServer(malformed.server);
  }

  const oversized = await startServer((_request, response) => {
    response.writeHead(409, { "Content-Type": "application/json" });
    response.end(Buffer.alloc(16 * 1024 + 1, 0x20));
  });
  try {
    await assert.rejects(
      collectReplayObservation(candidate.root, oversized.endpoint, token),
      /exceeds the streamed byte limit/,
    );
  } finally {
    await closeServer(oversized.server);
    await rm(candidate.root, { recursive: true, force: true });
  }
});

test("redirects are not followed and timeout does not retry or call another endpoint", async () => {
  const candidate = await createCandidate();
  let requests = 0;
  const redirect = await startServer((_request, response) => {
    requests++;
    response.writeHead(302, { Location: "http://127.0.0.1:1/origin" });
    response.end();
  });
  try {
    await assert.rejects(collectReplayObservation(candidate.root, redirect.endpoint, token), /received 302/);
    assert.equal(requests, 1);
  } finally {
    await closeServer(redirect.server);
  }

  requests = 0;
  const stalled = await startServer(() => { requests++; });
  try {
    const fastAbortFetcher = (url, init) => {
      assert.ok(init.signal instanceof AbortSignal);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("offline test timeout")), 20);
      return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
    };
    await assert.rejects(
      collectReplayObservation(candidate.root, stalled.endpoint, token, fastAbortFetcher),
      /single replay observation request failed/,
    );
    assert.equal(requests, 1);
  } finally {
    await closeServer(stalled.server);
    await rm(candidate.root, { recursive: true, force: true });
  }
});

test("sidecar creation never overwrites an existing file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fusou-replay-sidecar-"));
  const output = join(directory, "replay.json");
  await mkdir(directory, { recursive: true });
  try {
    const material = { schema_version: 1, status: 409 };
    await writeReplayObservation(output, material);
    const original = await readFile(output);
    await assert.rejects(writeReplayObservation(output, { schema_version: 1, status: 200 }));
    assert.deepEqual(await readFile(output), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
