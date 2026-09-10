#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  attach_verifier_result_signature,
  initSync,
  verify_require_info_presentation_with_trust_anchor,
} from "../src/wasm/fusou_tlsn_verifier.js";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = resolve(packageDirectory, "../..");
const proxyManifest = resolve(
  repositoryDirectory,
  "packages/FUSOU-PROXY/proxy-https/Cargo.toml",
);
const wasmPath = resolve(packageDirectory, "src/wasm/fusou_tlsn_verifier_bg.wasm");
const scriptPath = fileURLToPath(import.meta.url);
const MEMORY_LIMIT_BYTES = 128 * 1024 * 1024;
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID = "33333333-3333-4333-8333-333333333333";

function parsePaddingCases() {
  const configured = process.env.TLSN_MEMORY_BENCHMARK_PADDING_BYTES;
  const values = configured
    ? configured.split(",").map((value) => Number.parseInt(value.trim(), 10))
    : [0, 262144, 1048576, 4194304];
  if (
    values.length === 0 ||
    values.some((value) => !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error("TLSN_MEMORY_BENCHMARK_PADDING_BYTES must be comma-separated non-negative integers");
  }
  return [...new Set(values)];
}

function generateFixture(paddingBytes) {
  const result = spawnSync(
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
    {
      cwd: repositoryDirectory,
      env: {
        ...process.env,
        FUSOU_SYNTHETIC_RESPONSE_PADDING_BYTES: String(paddingBytes),
      },
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `synthetic fixture generation failed for ${paddingBytes} bytes:\n${result.stderr.slice(-4000)}`,
    );
  }
  const output = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!output) {
    throw new Error("synthetic fixture generator returned no JSON");
  }
  return JSON.parse(output);
}

function writeFixture(directory, paddingBytes, fixture) {
  const path = resolve(directory, `fixture-${paddingBytes}.json`);
  writeFileSync(path, JSON.stringify(fixture), { mode: 0o600 });
  return path;
}

function runMeasured(fixturePath, retainedRequests, repeats) {
  const result = spawnSync(
    process.execPath,
    ["--expose-gc", scriptPath, "--child", fixturePath, String(retainedRequests), String(repeats)],
    {
      cwd: packageDirectory,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `memory child failed for retained=${retainedRequests}:\n${result.stderr.slice(-4000)}`,
    );
  }
  const output = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!output) {
    throw new Error("memory child returned no JSON");
  }
  return JSON.parse(output);
}

function readResidentMemory() {
  try {
    const status = readFileSync("/proc/self/status", "utf8");
    const readKilobytes = (name) => {
      const match = new RegExp(`^${name}:\\s+(\\d+) kB$`, "m").exec(status);
      return match ? Number.parseInt(match[1], 10) * 1024 : null;
    };
    return {
      rssBytes: readKilobytes("VmRSS"),
      peakRssBytes: readKilobytes("VmHWM"),
    };
  } catch {
    return { rssBytes: null, peakRssBytes: null };
  }
}

function snapshot(wasm) {
  const memory = process.memoryUsage();
  const resident = readResidentMemory();
  return {
    rssBytes: resident.rssBytes,
    peakRssBytes: resident.peakRssBytes,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
    wasmLinearMemoryBytes: wasm?.memory?.buffer?.byteLength ?? null,
  };
}

function requestFor(fixture, challengeBytes) {
  const challenge = Buffer.from(challengeBytes).toString("base64url");
  return {
    presentation_base64: fixture.presentation_base64,
    session_id: SESSION_ID,
    binding: fixture.binding_value,
    device_id: DEVICE_ID,
    device_proof: {
      challenge,
      sig: "synthetic-device-proof",
    },
  };
}

function verifyOne(wasm, request, presentationBytes, rootCertificate, notaryKey, challengeBytes) {
  const preparedResultJson = verify_require_info_presentation_with_trust_anchor(
    presentationBytes,
    "game.example.test",
    new Uint8Array(32).fill(0x11),
    "verifier-test",
    "notary-test",
    USER_ID,
    DEVICE_ID,
    challengeBytes,
    rootCertificate,
    notaryKey,
  );
  const prepared = JSON.parse(preparedResultJson);
  JSON.parse(prepared.unsigned_result);
  const signingBytes = Buffer.from(prepared.signing_bytes, "base64url");
  const signedResultJson = attach_verifier_result_signature(
    prepared.unsigned_result,
    new Uint8Array(64),
  );
  JSON.parse(signedResultJson);
  return {
    preparedResultJson,
    signedResultJson,
    signingBytes,
  };
}

function runChild(fixturePath, retainedRequests, repeats) {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  let presentationBase64 = fixture.presentation_base64;
  const rootCertificate = Buffer.from(fixture.root_certificate_base64, "base64url");
  const notaryKey = Buffer.from(fixture.notary_key_base64, "base64url");
  const stages = {};
  const mark = (name, wasm) => {
    stages[name] = snapshot(wasm);
  };

  globalThis.gc?.();
  mark("baseline", undefined);

  const requests = [];
  for (let index = 0; index < retainedRequests; index += 1) {
    const challengeBytes = new Uint8Array(32).fill((index % 255) + 1);
    const rawBody = JSON.stringify(requestFor(fixture, challengeBytes));
    const parsedBody = JSON.parse(rawBody);
    const presentationBytes = Buffer.from(parsedBody.presentation_base64, "base64url");
    requests.push({ rawBody, parsedBody, presentationBytes, challengeBytes });
  }
  fixture.presentation_base64 = undefined;
  presentationBase64 = "";
  mark("body_parsed_and_decoded", undefined);

  const wasm = initSync(readFileSync(wasmPath));
  mark("wasm_initialized", wasm);

  const results = [];
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const request of requests) {
      results.push(
        verifyOne(
          wasm,
          request.parsedBody,
          request.presentationBytes,
          rootCertificate,
          notaryKey,
          request.challengeBytes,
        ),
      );
    }
  }
  mark("verified_and_signed", wasm);

  const bodyBytes = requests.reduce((total, request) => total + Buffer.byteLength(request.rawBody), 0);
  const presentationBytes = requests[0]?.presentationBytes.length ?? 0;
  const resultBytes = results.at(-1)?.signedResultJson.length ?? 0;
  const signingBytes = results.at(-1)?.signingBytes.length ?? 0;
  const resident = readResidentMemory();
  console.log(JSON.stringify({
    retainedRequests,
    repeats,
    requestBodyBytes: bodyBytes,
    presentationBytes,
    rootCertificateBytes: rootCertificate.length,
    notaryKeyBytes: notaryKey.length,
    resultBytes,
    signingBytes,
    stages,
    finalRssBytes: resident.rssBytes,
    peakRssBytes: resident.peakRssBytes,
    resourceMaxRssBytes: process.resourceUsage().maxRSS * 1024,
    wasmLinearMemoryBytes: wasm.memory.buffer.byteLength,
    memoryLimitBytes: MEMORY_LIMIT_BYTES,
  }));
}

function runParent() {
  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "fusou-tlsn-memory-"));
  try {
    const cases = [];
    for (const paddingBytes of parsePaddingCases()) {
      const fixture = generateFixture(paddingBytes);
      const fixturePath = writeFixture(temporaryDirectory, paddingBytes, fixture);
      const serial = runMeasured(fixturePath, 1, 2);
      const retainedTwo = runMeasured(fixturePath, 2, 1);
      cases.push({
        paddingBytes,
        originRequestBytes: fixture.origin_request_size,
        originResponseBytes: fixture.origin_response_size,
        serial,
        retainedTwo,
      });
    }
    console.log(JSON.stringify({
      benchmark: "tlsn-worker-equivalent-memory-v1",
      runtime: process.version,
      platform: process.platform,
      memoryLimitBytes: MEMORY_LIMIT_BYTES,
      cases,
    }, null, 2));
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--child") {
  runChild(process.argv[3], Number.parseInt(process.argv[4], 10), Number.parseInt(process.argv[5], 10));
} else {
  runParent();
}
