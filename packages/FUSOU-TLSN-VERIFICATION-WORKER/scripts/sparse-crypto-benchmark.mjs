#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import {
  attach_sparse_verifier_result_signature,
  derive_sparse_verifier_result_signing_bytes,
  initSync,
  verify_require_info_presentation_with_trust_anchor,
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
const fixtureDirectory = resolve(
  packageDirectory,
  process.env.TLSN_SPARSE_FIXTURE_DIR ?? ".cache/sparse-crypto-fixtures",
);
const fixtureManifestPath = resolve(fixtureDirectory, "manifest.json");

function parseCases() {
  const configured = process.env.TLSN_SPARSE_CRYPTO_BENCHMARK_PADDING_BYTES
    ?? process.env.TLSN_SPARSE_CRYPTO_PADDING_BYTES;
  const values = configured
    ? configured.split(",").map((value) => Number.parseInt(value.trim(), 10))
    : [1, 4, 8, 16, 32].map((megabytes) => megabytes * 1024 * 1024);
  if (values.length === 0 || values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("TLSN_SPARSE_CRYPTO_BENCHMARK_PADDING_BYTES must be comma-separated non-negative integers");
  }
  return [...new Set(values)];
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function encodedByteLength(value) {
  return value == null ? null : Buffer.from(value, "base64url").length;
}

function generateFixture(paddingBytes) {
  const startedAt = performance.now();
  const result = spawnSync(
    "cargo",
    [
      "+1.95.0",
      "run",
      "--quiet",
      "--release",
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
        FUSOU_SYNTHETIC_PROOF_MODE: "sparse",
        FUSOU_SYNTHETIC_RESPONSE_PADDING_BYTES: String(paddingBytes),
      },
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`synthetic fixture generation failed for ${paddingBytes} bytes:\n${result.stderr.slice(-4000)}`);
  }
  const output = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!output) throw new Error("synthetic fixture generator returned no JSON");
  const fixture = JSON.parse(output);
  return {
    fixture,
    wallClockMilliseconds: performance.now() - startedAt,
  };
}

function fixtureFileName(paddingBytes) {
  return `fixture-${paddingBytes}.json`;
}

function fixtureMetadata(paddingBytes, fixture, rawBytes, wallClockMilliseconds) {
  return {
    paddingBytes,
    fixtureFile: fixtureFileName(paddingBytes),
    fixtureBytes: rawBytes.length,
    fixtureSha256: sha256(rawBytes),
    wallClockMilliseconds,
    generationElapsedMilliseconds: fixture.generation_elapsed_milliseconds,
    originResponseBytes: fixture.origin_response_size,
    fullPresentationBytes: encodedByteLength(fixture.presentation_base64),
    sparsePresentationBytes: encodedByteLength(fixture.sparse_presentation_base64),
    generationTiming: fixture.generation_timing,
  };
}

function runGeneration() {
  mkdirSync(fixtureDirectory, { recursive: true, mode: 0o700 });
  const cases = parseCases().map((paddingBytes) => {
    const generated = generateFixture(paddingBytes);
    const rawBytes = Buffer.from(JSON.stringify(generated.fixture));
    writeFileSync(resolve(fixtureDirectory, fixtureFileName(paddingBytes)), rawBytes, { mode: 0o600 });
    return fixtureMetadata(paddingBytes, generated.fixture, rawBytes, generated.wallClockMilliseconds);
  });
  const manifest = {
    benchmark: "tlsn-worker-sparse-crypto-fixtures-v2",
    schemaVersion: 2,
    generator: "synthetic_tlsn_fixture",
    cargoProfile: "release",
    offline: true,
    cases,
  };
  writeFileSync(fixtureManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ fixtureDirectory, manifest }, null, 2));
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

function runChild(fixturePath, requestedPaddingBytes, expectedSha256, mode) {
  const fixtureBytes = readFileSync(fixturePath);
  const actualSha256 = sha256(fixtureBytes);
  if (expectedSha256 && actualSha256 !== expectedSha256) {
    throw new Error(`fixture SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
  }
  const fixture = JSON.parse(fixtureBytes.toString("utf8"));
  const afterFixtureLoad = snapshot(null);
  const wasm = initSync(readFileSync(wasmPath));
  globalThis.gc?.();
  const before = snapshot(wasm);
  const presentationBase64 = mode === "full"
    ? fixture.presentation_base64
    : fixture.sparse_presentation_base64;
  if (presentationBase64 == null) {
    console.log(JSON.stringify({
      status: "BLOCKED",
      mode,
      fixtureSha256: actualSha256,
      requestedPaddingBytes,
      presentationBytes: null,
      error: `${mode} Presentation is unavailable in this fixture`,
    }));
    return;
  }
  const presentation = Buffer.from(presentationBase64, "base64url");
  const rootCertificate = Buffer.from(fixture.root_certificate_base64, "base64url");
  const notaryKey = Buffer.from(fixture.notary_key_base64, "base64url");
  const afterDeserialize = snapshot(wasm);
  const startedAt = performance.now();
  try {
    const verifyPresentation = mode === "full"
      ? verify_require_info_presentation_with_trust_anchor
      : verify_sparse_require_info_presentation_with_trust_anchor;
    const verificationStarted = performance.now();
    const preparedJson = verifyPresentation(
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
    );
    const afterVerification = snapshot(wasm);
    const verificationElapsedMilliseconds = performance.now() - verificationStarted;
    const semanticStarted = performance.now();
    const prepared = JSON.parse(preparedJson);
    const unsignedResultJson = prepared.unsigned_result;
    const unsignedResult = JSON.parse(unsignedResultJson);
    const semanticParseElapsedMilliseconds = performance.now() - semanticStarted;
    const signed = mode === "sparse"
      ? (() => {
        const signingStarted = performance.now();
        const signingBytes = derive_sparse_verifier_result_signing_bytes(unsignedResultJson);
        const signedResult = signSparseResult(unsignedResultJson, signingBytes);
        return {
          ...signedResult,
          signingBytes: signingBytes.length,
          signingElapsedMilliseconds: performance.now() - signingStarted,
        };
      })()
      : null;
    const afterSigning = snapshot(wasm);
    const elapsedMilliseconds = performance.now() - startedAt;
    const disclosedRequestBytes = unsignedResult.revealed_request_ranges
      .reduce((total, range) => total + Number.parseInt(range.length, 10), 0);
    const disclosedResponseBytes = unsignedResult.revealed_response_ranges
      .reduce((total, range) => total + Number.parseInt(range.length, 10), 0);
    console.log(JSON.stringify({
      status: "PASS",
      mode,
      fixtureSha256: actualSha256,
      requestedPaddingBytes,
      presentationBytes: presentation.length,
      fullPresentationBytes: encodedByteLength(fixture.presentation_base64),
      sparsePresentationBytes: encodedByteLength(fixture.sparse_presentation_base64),
      requestTranscriptBytes: Number.parseInt(unsignedResult.request_transcript_size, 10),
      responseTranscriptBytes: Number.parseInt(unsignedResult.response_transcript_size, 10),
      disclosedRequestBytes,
      disclosedResponseBytes,
      disclosedBytes: disclosedRequestBytes + disclosedResponseBytes,
      disclosureRatio: disclosedResponseBytes / Number.parseInt(unsignedResult.response_transcript_size, 10),
      resultBytes: Buffer.byteLength(unsignedResultJson),
      signingBytes: signed?.signingBytes ?? null,
      signatureBytes: signed?.signatureBytes ?? null,
      signedResultBytes: signed?.signedJsonBytes ?? null,
      signatureVerified: signed?.signatureVerified ?? null,
      mutationChecks: signed?.mutationChecks ?? null,
      mutationRejected: signed?.mutationRejected ?? null,
      verificationElapsedMilliseconds,
      semanticParseElapsedMilliseconds,
      signingElapsedMilliseconds: signed?.signingElapsedMilliseconds ?? null,
      elapsedMilliseconds,
      generationElapsedMilliseconds: fixture.generation_elapsed_milliseconds,
      generationTiming: fixture.generation_timing,
      memorySnapshots: {
        afterFixtureLoad,
        beforeDeserialize: before,
        afterDeserialize,
        afterVerification,
        afterSigning,
      },
      before,
      after: afterSigning,
      delta: delta(before, afterSigning),
      phaseDelta: {
        deserialize: delta(before, afterDeserialize),
        verification: delta(afterDeserialize, afterVerification),
        signing: delta(afterVerification, afterSigning),
      },
    }));
  } catch (error) {
    const after = snapshot(wasm);
    console.log(JSON.stringify({
      status: "BLOCKED",
      mode,
      fixtureSha256: actualSha256,
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
  const manifest = JSON.parse(readFileSync(fixtureManifestPath, "utf8"));
  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.cases)) {
    throw new Error(`invalid sparse fixture manifest: ${fixtureManifestPath}`);
  }
  const entries = parseCases().map((paddingBytes) => {
    const entry = manifest.cases.find((candidate) => candidate.paddingBytes === paddingBytes);
    if (!entry) throw new Error(`fixture manifest lacks padding case ${paddingBytes}`);
    const fixturePath = resolve(fixtureDirectory, entry.fixtureFile);
    const rawBytes = readFileSync(fixturePath);
    const actualSha256 = sha256(rawBytes);
    if (actualSha256 !== entry.fixtureSha256) {
      throw new Error(`fixture SHA-256 mismatch for ${paddingBytes}: expected ${entry.fixtureSha256}, got ${actualSha256}`);
    }
    return { ...entry, fixturePath };
  });
  const cases = ["sparse", "full"].flatMap((mode) => entries.map((entry) => {
    const result = spawnSync(
      process.execPath,
      ["--expose-gc", scriptPath, "--child", entry.fixturePath, String(entry.paddingBytes), entry.fixtureSha256, mode],
      { cwd: packageDirectory, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `sparse crypto child failed for ${mode}/${entry.paddingBytes}`);
    return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  }));
  console.log(JSON.stringify({
    benchmark: "tlsn-worker-sparse-crypto-v2",
    runtime: process.version,
    platform: process.platform,
    fixtureDirectory,
    fixtureManifestSha256: sha256(readFileSync(fixtureManifestPath)),
    fixtureManifest: manifest,
    cases,
  }, null, 2));
}

if (process.argv[2] === "--child") {
  runChild(process.argv[3], Number.parseInt(process.argv[4], 10), process.argv[5], process.argv[6] ?? "sparse");
} else if (process.argv[2] === "--generate") {
  runGeneration();
} else {
  runParent();
}
