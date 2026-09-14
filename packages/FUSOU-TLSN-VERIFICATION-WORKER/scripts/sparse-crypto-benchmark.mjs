#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import {
  attach_sparse_verifier_result_signature,
  derive_sparse_verifier_result_signing_bytes,
  initSync,
  verify_sparse_require_info_presentation_with_trust_anchor,
} from "../src/wasm/fusou_tlsn_verifier.js";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDirectory = resolve(packageDirectory, "../..");
const proxyManifest = resolve(repositoryDirectory, "packages/FUSOU-PROXY/proxy-https/Cargo.toml");
const wasmPath = resolve(packageDirectory, "src/wasm/fusou_tlsn_verifier_bg.wasm");
const scriptPath = fileURLToPath(import.meta.url);
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID = "33333333-3333-4333-8333-333333333333";
const PROFILE_SHA256 = new Uint8Array(32).fill(0x22);
const CHALLENGE = new Uint8Array(32).fill(0x33);

function parseCases() {
  const configured = process.env.TLSN_SPARSE_CRYPTO_BENCHMARK_PADDING_BYTES;
  const values = configured
    ? configured.split(",").map((value) => Number.parseInt(value.trim(), 10))
    : [0, 1024 * 1024, 4 * 1024 * 1024, 8 * 1024 * 1024, 16 * 1024 * 1024, 32 * 1024 * 1024];
  if (values.length === 0 || values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("TLSN_SPARSE_CRYPTO_BENCHMARK_PADDING_BYTES must be comma-separated non-negative integers");
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
        CARGO_NET_OFFLINE: "true",
        FUSOU_SYNTHETIC_RESPONSE_PADDING_BYTES: String(paddingBytes),
      },
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`synthetic fixture generation failed for ${paddingBytes} bytes:\n${result.stderr.slice(-4000)}`);
  }
  const output = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!output) throw new Error("synthetic fixture generator returned no JSON");
  return JSON.parse(output);
}

function residentMemory() {
  try {
    const status = readFileSync("/proc/self/status", "utf8");
    const readKilobytes = (name) => {
      const match = new RegExp(`^${name}:\\s+(\\d+) kB$`, "m").exec(status);
      return match ? Number.parseInt(match[1], 10) * 1024 : null;
    };
    return {
      rssBytes: readKilobytes("VmRSS"),
      peakRssBytes: readKilobytes("VmHWM"),
      dataBytes: readKilobytes("VmData"),
      virtualBytes: readKilobytes("VmSize"),
    };
  } catch {
    return { rssBytes: null, peakRssBytes: null, dataBytes: null, virtualBytes: null };
  }
}

function snapshot(wasm) {
  const memory = process.memoryUsage();
  return {
    ...residentMemory(),
    heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
    wasmLinearMemoryBytes: wasm?.memory?.buffer?.byteLength ?? null,
  };
}

function delta(before, after) {
  return Object.fromEntries(Object.keys(after).map((key) => [
    key,
    typeof before[key] === "number" && typeof after[key] === "number" ? after[key] - before[key] : null,
  ]));
}

function signSparseResult(unsignedResultJson, signingBytes) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signature = sign(null, signingBytes, privateKey);
  if (!verify(null, signingBytes, publicKey, signature)) {
    throw new Error("generated sparse Result signature did not verify");
  }
  const signedJson = attach_sparse_verifier_result_signature(unsignedResultJson, signature);
  const signedResult = JSON.parse(signedJson);
  const mutationCases = [
    ["revealed_response_range_bytes", (mutated) => {
      const bytes = Buffer.from(mutated.revealed_response_ranges[0].bytes, "base64url");
      bytes[0] ^= 1;
      mutated.revealed_response_ranges[0].bytes = bytes.toString("base64url");
    }],
    ["response_transcript_size", (mutated) => {
      mutated.response_transcript_size = String(BigInt(mutated.response_transcript_size) + 1n);
    }],
    ["profile_sha256", (mutated) => {
      const bytes = Buffer.from(mutated.profile_sha256, "base64url");
      bytes[0] ^= 1;
      mutated.profile_sha256 = bytes.toString("base64url");
    }],
    ["disclosure_mode", (mutated) => {
      mutated.disclosure_mode = "full";
    }],
    ["presentation_sha256", (mutated) => {
      const bytes = Buffer.from(mutated.presentation_sha256, "base64url");
      bytes[0] ^= 1;
      mutated.presentation_sha256 = bytes.toString("base64url");
    }],
    ["binding_value", (mutated) => {
      mutated.binding_value = `${mutated.binding_value.slice(0, -1)}${mutated.binding_value.endsWith("A") ? "B" : "A"}`;
    }],
    ["profile_id", (mutated) => {
      mutated.profile_id = "fusou-require-info-v2-other";
    }],
    ["response_range_boundary", (mutated) => {
      mutated.revealed_response_ranges[0].start = "1";
    }],
  ];
  let mutationRejected = 0;
  for (const [, mutate] of mutationCases) {
    const mutated = structuredClone(signedResult);
    mutate(mutated);
    delete mutated.signature;
    try {
      const mutatedSigningBytes = derive_sparse_verifier_result_signing_bytes(JSON.stringify(mutated));
      if (!verify(null, mutatedSigningBytes, publicKey, signature)) mutationRejected += 1;
    } catch {
      mutationRejected += 1;
    }
  }
  return {
    signedJsonBytes: Buffer.byteLength(signedJson),
    signatureBytes: signature.length,
    signatureVerified: true,
    mutationChecks: mutationCases.length,
    mutationRejected,
  };
}

function runChild(fixturePath, requestedPaddingBytes) {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const presentation = Buffer.from(fixture.sparse_presentation_base64, "base64url");
  const rootCertificate = Buffer.from(fixture.root_certificate_base64, "base64url");
  const notaryKey = Buffer.from(fixture.notary_key_base64, "base64url");
  const wasm = initSync(readFileSync(wasmPath));
  globalThis.gc?.();
  const before = snapshot(wasm);
  const startedAt = performance.now();
  try {
    const prepared = JSON.parse(verify_sparse_require_info_presentation_with_trust_anchor(
      presentation,
      "game.example.test",
      PROFILE_SHA256,
      "verifier-test",
      "notary-test",
      USER_ID,
      DEVICE_ID,
      CHALLENGE,
      rootCertificate,
      notaryKey,
    ));
    const unsignedResultJson = prepared.unsigned_result;
    const unsignedResult = JSON.parse(unsignedResultJson);
    const signingBytes = derive_sparse_verifier_result_signing_bytes(unsignedResultJson);
    const signed = signSparseResult(unsignedResultJson, signingBytes);
    const after = snapshot(wasm);
    const elapsedMilliseconds = performance.now() - startedAt;
    const disclosedRequestBytes = unsignedResult.revealed_request_ranges
      .reduce((total, range) => total + Number.parseInt(range.length, 10), 0);
    const disclosedResponseBytes = unsignedResult.revealed_response_ranges
      .reduce((total, range) => total + Number.parseInt(range.length, 10), 0);
    console.log(JSON.stringify({
      status: "PASS",
      requestedPaddingBytes,
      presentationBytes: presentation.length,
      requestTranscriptBytes: Number.parseInt(unsignedResult.request_transcript_size, 10),
      responseTranscriptBytes: Number.parseInt(unsignedResult.response_transcript_size, 10),
      disclosedRequestBytes,
      disclosedResponseBytes,
      disclosedBytes: disclosedRequestBytes + disclosedResponseBytes,
      disclosureRatio: disclosedResponseBytes / Number.parseInt(unsignedResult.response_transcript_size, 10),
      resultBytes: Buffer.byteLength(unsignedResultJson),
      signingBytes: signingBytes.length,
      signatureBytes: signed.signatureBytes,
      signedResultBytes: signed.signedJsonBytes,
      signatureVerified: signed.signatureVerified,
      mutationChecks: signed.mutationChecks,
      mutationRejected: signed.mutationRejected,
      elapsedMilliseconds,
      before,
      after,
      delta: delta(before, after),
    }));
  } catch (error) {
    const after = snapshot(wasm);
    console.log(JSON.stringify({
      status: "BLOCKED",
      requestedPaddingBytes,
      presentationBytes: presentation.length,
      elapsedMilliseconds: performance.now() - startedAt,
      error: String(error?.message ?? error),
      before,
      after,
      delta: delta(before, after),
    }));
  }
}

function runParent() {
  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "fusou-tlsn-sparse-crypto-"));
  try {
    const cases = parseCases().map((paddingBytes) => {
      const fixture = generateFixture(paddingBytes);
      const fixturePath = resolve(temporaryDirectory, `fixture-${paddingBytes}.json`);
      writeFileSync(fixturePath, JSON.stringify(fixture), { mode: 0o600 });
      const result = spawnSync(
        process.execPath,
        ["--expose-gc", scriptPath, "--child", fixturePath, String(paddingBytes)],
        { cwd: packageDirectory, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(result.stderr || `sparse crypto child failed for ${paddingBytes}`);
      return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    });
    console.log(JSON.stringify({
      benchmark: "tlsn-worker-sparse-crypto-v1",
      runtime: process.version,
      platform: process.platform,
      cases,
    }, null, 2));
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--child") {
  runChild(process.argv[3], Number.parseInt(process.argv[4], 10));
} else {
  runParent();
}
