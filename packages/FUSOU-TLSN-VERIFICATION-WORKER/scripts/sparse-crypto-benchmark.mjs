#!/usr/bin/env node

import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
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
const realFixtureDirectory = resolve(
  packageDirectory,
  process.env.TLSN_SPARSE_REAL_FIXTURE_DIR ?? ".cache/sparse-crypto-real-fixtures",
);
const realFixtureManifestPath = resolve(realFixtureDirectory, "manifest.json");
const realDataRoot = resolve(
  repositoryDirectory,
  process.env.FUSOU_PROXY_DATA_PATH ?? "packages/FUSOU-PROXY-DATA",
);
const requireInfoSuffix = "S@api_get_member@require_info";

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

function extractFixturePayload(bytes, filePath) {
  const opening = bytes.subarray(0, 5).equals(Buffer.from("---\r\n", "ascii"))
    ? 5
    : bytes.subarray(0, 4).equals(Buffer.from("---\n", "ascii"))
      ? 4
      : -1;
  if (opening < 0) throw new Error(`${filePath}: missing metadata opening delimiter`);
  const closingStart = bytes.indexOf(Buffer.from("\n---", "ascii"), opening);
  if (closingStart < 0) throw new Error(`${filePath}: missing metadata closing delimiter`);
  const delimiterEnd = closingStart + 4;
  const payloadStart = bytes.subarray(delimiterEnd, delimiterEnd + 2).equals(Buffer.from("\r\n", "ascii"))
    ? delimiterEnd + 2
    : bytes[delimiterEnd] === 0x0a
      ? delimiterEnd + 1
      : -1;
  if (payloadStart < 0) throw new Error(`${filePath}: metadata closing delimiter is not newline terminated`);
  return { metadataBytes: payloadStart, payload: bytes.subarray(payloadStart) };
}

function longestStringInterior(bytes, start = 0) {
  let position = start;
  let longest = null;
  while (position < bytes.length) {
    if (bytes[position] !== 0x22) {
      position += 1;
      continue;
    }
    const stringStart = position;
    position += 1;
    while (position < bytes.length) {
      if (bytes[position] === 0x5c) {
        position += 2;
      } else if (bytes[position] === 0x22) {
        break;
      } else {
        position += 1;
      }
    }
    if (position >= bytes.length) break;
    const stringEnd = position;
    position += 1;
    let next = position;
    while (next < bytes.length && (bytes[next] === 0x20 || bytes[next] === 0x09
      || bytes[next] === 0x0a || bytes[next] === 0x0d)) {
      next += 1;
    }
    if (bytes[next] === 0x3a) continue;
    const interior = { start: stringStart + 1, end: stringEnd };
    if (interior.start < interior.end
      && (longest == null || interior.end - interior.start > longest.end - longest.start)) {
      longest = interior;
    }
  }
  return longest;
}

function memberIdDigits(payload) {
  const marker = Buffer.from('"api_member_id"', "ascii");
  const markerStart = payload.indexOf(marker);
  if (markerStart < 0) throw new Error("real response lacks api_member_id key");
  let position = markerStart + marker.length;
  while (position < payload.length && Buffer.from(" \t\r\n", "ascii").includes(payload[position])) {
    position += 1;
  }
  if (payload[position] !== 0x3a) throw new Error("api_member_id key lacks colon");
  position += 1;
  while (position < payload.length && Buffer.from(" \t\r\n", "ascii").includes(payload[position])) {
    position += 1;
  }
  const start = position;
  while (position < payload.length && payload[position] >= 0x30 && payload[position] <= 0x39) {
    position += 1;
  }
  if (start === position) throw new Error("api_member_id value is not a decimal number");
  return { start, end: position };
}

function mutateVisibleByte(bytes, range, mutation) {
  const mutated = Buffer.from(bytes);
  const position = mutation === "member-id"
    ? range.start
    : [...Array(range.end - range.start).keys()]
      .map((offset) => range.start + offset)
      .find((candidate) => bytes[candidate] >= 0x20
        && bytes[candidate] < 0x80
        && bytes[candidate] !== 0x22
        && bytes[candidate] !== 0x5c);
  if (position == null) throw new Error(`no safe ${mutation} mutation byte found`);
  mutated[position] = mutation === "member-id"
    ? (bytes[position] === 0x39 ? 0x38 : bytes[position] + 1)
    : (bytes[position] === 0x61 ? 0x62 : 0x61);
  return mutated;
}

function mutateHiddenStringInterior(bytes, range) {
  const mutated = Buffer.from(bytes);
  for (let position = range.start; position < range.end; position += 1) {
    if (bytes[position] === 0x5c
      && bytes[position + 1] === 0x75
      && position + 5 < range.end
      && [...bytes.subarray(position + 2, position + 6)].every((byte) => {
        return (byte >= 0x30 && byte <= 0x39)
          || (byte >= 0x41 && byte <= 0x46)
          || (byte >= 0x61 && byte <= 0x66);
      })) {
      const digitPosition = position + 5;
      mutated[digitPosition] = bytes[digitPosition] === 0x30 ? 0x31 : 0x30;
      return mutated;
    }
    if (bytes[position] >= 0x20
      && bytes[position] < 0x80
      && bytes[position] !== 0x22
      && bytes[position] !== 0x5c
      && bytes[position - 1] !== 0x5c) {
      mutated[position] = bytes[position] === 0x61 ? 0x62 : 0x61;
      return mutated;
    }
  }
  throw new Error("no safe hidden mutation byte found");
}

function collectRealResponseFixtures() {
  const records = [];
  for (const epoch of readdirSync(realDataRoot).sort()) {
    const kcsapiDirectory = resolve(realDataRoot, epoch, "kcsapi");
    let fileNames;
    try {
      fileNames = readdirSync(kcsapiDirectory).sort();
    } catch {
      continue;
    }
    for (const fileName of fileNames) {
      if (!fileName.endsWith(requireInfoSuffix)) continue;
      const fixturePath = resolve(kcsapiDirectory, fileName);
      const rawBytes = readFileSync(fixturePath);
      const { metadataBytes, payload } = extractFixturePayload(rawBytes, fixturePath);
      if (!payload.subarray(0, 7).equals(Buffer.from("svdata=", "ascii"))) {
        throw new Error(`${fixturePath}: response does not start with svdata=`);
      }
      const response = JSON.parse(payload.subarray(7).toString("utf8"));
      if (response.api_result !== 1 || response.api_data?.api_basic == null) {
        throw new Error(`${fixturePath}: response lacks require_info api_result/api_basic`);
      }
      memberIdDigits(payload);
      records.push({
        epoch,
        fileName,
        fixturePath,
        metadataBytes,
        bodyBytes: payload.length,
        bodySha256: sha256(payload),
      });
    }
  }
  if (records.length === 0) throw new Error(`no require_info response fixtures under ${realDataRoot}`);
  return records;
}

function percentileIndex(length, fraction) {
  return Math.max(0, Math.ceil(length * fraction) - 1);
}

function selectRealResponseCases() {
  const records = collectRealResponseFixtures()
    .sort((left, right) => left.bodyBytes - right.bodyBytes || left.fixturePath.localeCompare(right.fixturePath));
  return [
    ["p50", 0.5],
    ["p95", 0.95],
    ["p99", 0.99],
    ["max", 1],
  ].map(([caseLabel, fraction]) => {
    const source = records[percentileIndex(records.length, fraction)];
    return { caseLabel, percentile: fraction, source };
  });
}

function encodedByteLength(value) {
  return value == null ? null : Buffer.from(value, "base64url").length;
}

function generateFixture(paddingBytes, proofMode = "sparse", hiddenByte = "a", responseFixturePath = null) {
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
        FUSOU_SYNTHETIC_PROOF_MODE: proofMode,
        FUSOU_SYNTHETIC_RESPONSE_PADDING_BYTES: String(paddingBytes),
        FUSOU_SYNTHETIC_RESPONSE_HIDDEN_BYTE: hiddenByte,
        ...(responseFixturePath
          ? { FUSOU_SYNTHETIC_RESPONSE_FIXTURE_PATH: responseFixturePath }
          : {}),
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

function fixtureFileName(paddingBytes, proofMode = "sparse", hiddenByte = "a") {
  const suffix = proofMode === "sparse" && hiddenByte === "a" ? "" : `-${proofMode}-${hiddenByte}`;
  return `fixture-${paddingBytes}${suffix}.json`;
}

function fixtureMetadata(paddingBytes, fixture, rawBytes, wallClockMilliseconds, proofMode = "sparse", hiddenByte = "a") {
  const committedRequestBytes = fixture.committed_request_bytes;
  const committedResponseBytes = fixture.committed_response_bytes;
  return {
    paddingBytes,
    proofMode,
    hiddenByte,
    fixtureFile: fixtureFileName(paddingBytes, proofMode, hiddenByte),
    fixtureBytes: rawBytes.length,
    fixtureSha256: sha256(rawBytes),
    wallClockMilliseconds,
    generationElapsedMilliseconds: fixture.generation_elapsed_milliseconds,
    originResponseBytes: fixture.origin_response_size,
    committedRequestBytes,
    committedResponseBytes,
    committedResponseRangeCount: fixture.committed_response_range_count,
    committedResponseLargestRangeBytes: fixture.committed_response_largest_range_bytes,
    disclosedResponseRangeCount: fixture.disclosed_response_range_count,
    disclosedResponseLargestRangeBytes: fixture.disclosed_response_largest_range_bytes,
    committedBytes: committedRequestBytes + committedResponseBytes,
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
    benchmark: "tlsn-worker-sparse-crypto-fixtures-v3",
    schemaVersion: 3,
    generator: "synthetic_tlsn_fixture",
    cargoProfile: "release",
    offline: true,
    cases,
  };
  writeFileSync(fixtureManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ fixtureDirectory, manifest }, null, 2));
}

function runRealGeneration() {
  mkdirSync(realFixtureDirectory, { recursive: true, mode: 0o700 });
  const selectedCases = selectRealResponseCases();
  const cases = selectedCases.map(({ caseLabel, percentile, source }) => {
    const generated = generateFixture(0, "sparse", "a", source.fixturePath);
    const rawBytes = Buffer.from(JSON.stringify(generated.fixture));
    const fixtureFile = `real-${caseLabel}.json`;
    writeFileSync(resolve(realFixtureDirectory, fixtureFile), rawBytes, { mode: 0o600 });
    return {
      caseLabel,
      percentile,
      sourceEpoch: source.epoch,
      sourceFileName: source.fileName,
      sourceFixtureBodyBytes: source.bodyBytes,
      sourceFixtureBodySha256: source.bodySha256,
      sourceMetadataBytes: source.metadataBytes,
      sourceSemantics: "real require_info API body; HTTP status, headers, and TLS framing are reconstructed locally",
      requestTranscriptStatus: "NOT_ESTABLISHED",
      fixtureFile,
      fixtureBytes: rawBytes.length,
      fixtureSha256: sha256(rawBytes),
      wallClockMilliseconds: generated.wallClockMilliseconds,
      generationElapsedMilliseconds: generated.fixture.generation_elapsed_milliseconds,
      originResponseBytes: generated.fixture.origin_response_size,
      committedRequestBytes: generated.fixture.committed_request_bytes,
      committedResponseBytes: generated.fixture.committed_response_bytes,
      committedResponseRangeCount: generated.fixture.committed_response_range_count,
      committedResponseLargestRangeBytes: generated.fixture.committed_response_largest_range_bytes,
      disclosedResponseRangeCount: generated.fixture.disclosed_response_range_count,
      disclosedResponseLargestRangeBytes: generated.fixture.disclosed_response_largest_range_bytes,
      committedBytes: generated.fixture.committed_request_bytes + generated.fixture.committed_response_bytes,
      sparsePresentationBytes: encodedByteLength(generated.fixture.sparse_presentation_base64),
      generationTiming: generated.fixture.generation_timing,
    };
  });
  const manifest = {
    benchmark: "tlsn-worker-sparse-crypto-real-fixtures-v1",
    schemaVersion: 1,
    generator: "synthetic_tlsn_fixture",
    cargoProfile: "release",
    offline: true,
    source: {
      path: realDataRoot,
      fixtureSemantics: "metadata plus API body; HTTP status, headers, and TLS framing are absent",
      httpTranscriptSize: "NOT_ESTABLISHED",
    },
    cases,
  };
  writeFileSync(realFixtureManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ realFixtureDirectory, manifest }, null, 2));
}

function writeGeneratedRealFixture(directory, sourcePath, fixtureFile) {
  const generated = generateFixture(0, "sparse", "a", sourcePath);
  const rawBytes = Buffer.from(JSON.stringify(generated.fixture));
  const fixturePath = resolve(directory, fixtureFile);
  writeFileSync(fixturePath, rawBytes, { mode: 0o600 });
  return {
    fixture: generated.fixture,
    fixturePath,
    fixtureSha256: sha256(rawBytes),
  };
}

function writeMutatedSourceFixture(directory, source, mutation) {
  const rawBytes = readFileSync(source.fixturePath);
  const { metadataBytes, payload } = extractFixturePayload(rawBytes, source.fixturePath);
  const range = mutation === "hidden"
    ? longestStringInterior(payload, 7)
    : memberIdDigits(payload);
  if (!range) throw new Error(`real response has no ${mutation} mutation range`);
  const mutatedPayload = mutation === "hidden"
    ? mutateHiddenStringInterior(payload, range)
    : mutateVisibleByte(payload, range, "member-id");
  const mutatedBytes = Buffer.from(rawBytes);
  mutatedPayload.copy(mutatedBytes, metadataBytes);
  const fixturePath = resolve(directory, `real-${mutation}-source`);
  writeFileSync(fixturePath, mutatedBytes, { mode: 0o600 });
  return fixturePath;
}

function writeMutatedPresentationFixture(directory, sourceFixture, mutation) {
  const fixture = structuredClone(sourceFixture.fixture);
  const presentation = Buffer.from(fixture.sparse_presentation_base64, "base64url");
  const response = Buffer.from(fixture.authenticated_response_base64, "base64url");
  let mutatedPresentation;
  if (mutation === "member-id") {
    const bodyStart = response.indexOf(Buffer.from("svdata=", "ascii"));
    const memberRange = memberIdDigits(response.subarray(bodyStart + 7));
    const memberBytes = response.subarray(bodyStart + 7 + memberRange.start, bodyStart + 7 + memberRange.end);
    const presentationStart = presentation.indexOf(memberBytes);
    if (presentationStart < 0) throw new Error("sparse Presentation lacks disclosed member ID bytes");
    mutatedPresentation = mutateVisibleByte(
      presentation,
      { start: presentationStart, end: presentationStart + memberBytes.length },
      "member-id",
    );
  } else if (mutation === "disclosed") {
    const disclosedBytes = Buffer.from("HTTP/1.1 200 OK", "ascii");
    const presentationStart = presentation.indexOf(disclosedBytes);
    if (presentationStart < 0) throw new Error("sparse Presentation lacks disclosed response headers");
    mutatedPresentation = mutateVisibleByte(
      presentation,
      { start: presentationStart, end: presentationStart + disclosedBytes.length },
      "disclosed",
    );
  } else {
    const lastByte = presentation.length - 1;
    mutatedPresentation = Buffer.from(presentation);
    mutatedPresentation[lastByte] ^= 1;
  }
  fixture.sparse_presentation_base64 = mutatedPresentation.toString("base64url");
  const rawBytes = Buffer.from(JSON.stringify(fixture));
  const fixturePath = resolve(directory, `real-${mutation}-presentation.json`);
  writeFileSync(fixturePath, rawBytes, { mode: 0o600 });
  return { fixturePath, fixtureSha256: sha256(rawBytes) };
}

function runRealRegression() {
  const directory = mkdtempSync(resolve(tmpdir(), "tlsn-sparse-real-scope-"));
  try {
    const manifest = JSON.parse(readFileSync(realFixtureManifestPath, "utf8"));
    const sourceCase = manifest.cases.find((entry) => entry.caseLabel === "max") ?? manifest.cases.at(-1);
    if (!sourceCase) throw new Error("real sparse manifest has no cases");
    const originalPath = resolve(realFixtureDirectory, sourceCase.fixtureFile);
    const originalBytes = readFileSync(originalPath);
    const original = {
      fixture: JSON.parse(originalBytes.toString("utf8")),
      fixturePath: originalPath,
      fixtureSha256: sha256(originalBytes),
    };
    const mutatedSourcePath = writeMutatedSourceFixture(directory, {
      fixturePath: resolve(realDataRoot, sourceCase.sourceEpoch, "kcsapi", sourceCase.sourceFileName),
    }, "hidden");
    const hidden = writeGeneratedRealFixture(directory, mutatedSourcePath, "real-hidden-generated.json");
    const originalResult = runChildResult(
      original.fixturePath,
      sourceCase.sourceFixtureBodyBytes,
      original.fixtureSha256,
      "sparse",
    );
    const hiddenResult = runChildResult(
      hidden.fixturePath,
      sourceCase.sourceFixtureBodyBytes,
      hidden.fixtureSha256,
      "sparse",
    );
    const hiddenMutation = {
      originalStatus: originalResult.status,
      mutatedStatus: hiddenResult.status,
      rawResponseChanged: sha256(Buffer.from(original.fixture.authenticated_response_base64, "base64url"))
        !== sha256(Buffer.from(hidden.fixture.authenticated_response_base64, "base64url")),
      sameTranscriptBytes: originalResult.responseTranscriptBytes === hiddenResult.responseTranscriptBytes,
      sameDisclosedResponseBytes: originalResult.disclosedResponseBytes === hiddenResult.disclosedResponseBytes,
      sameDisclosedResponseSha256: originalResult.disclosedResponseSha256 === hiddenResult.disclosedResponseSha256,
      sameVerifiedMemberId: originalResult.verifiedMemberId === hiddenResult.verifiedMemberId,
    };
    if (hiddenMutation.originalStatus !== "PASS"
      || hiddenMutation.mutatedStatus !== "PASS"
      || !hiddenMutation.rawResponseChanged
      || !hiddenMutation.sameTranscriptBytes
      || !hiddenMutation.sameDisclosedResponseBytes
      || !hiddenMutation.sameDisclosedResponseSha256
      || !hiddenMutation.sameVerifiedMemberId) {
      throw new Error(`real hidden response mutation regression failed: ${JSON.stringify(hiddenMutation)}`);
    }

    const mutationResults = {};
    for (const mutation of ["disclosed", "member-id", "presentation"]) {
      const mutated = writeMutatedPresentationFixture(directory, original, mutation);
      const result = runChildResult(
        mutated.fixturePath,
        sourceCase.sourceFixtureBodyBytes,
        mutated.fixtureSha256,
        "sparse",
      );
      mutationResults[mutation] = { status: result.status, rejected: result.status === "BLOCKED" };
    }
    const signedResultMutation = {
      checks: originalResult.mutationChecks,
      rejected: originalResult.mutationRejected,
      scopeChecks: originalResult.scopeMutationChecks,
      scopeRejected: originalResult.scopeMutationRejected,
    };
    if (Object.values(mutationResults).some((result) => !result.rejected)
      || signedResultMutation.rejected !== signedResultMutation.checks
      || signedResultMutation.scopeRejected !== signedResultMutation.scopeChecks) {
      throw new Error(`real presentation mutation regression failed: ${JSON.stringify({ mutationResults, signedResultMutation })}`);
    }
    console.log(JSON.stringify({
      status: "PASS",
      sourceCase: sourceCase.caseLabel,
      hiddenMutation,
      presentationMutations: mutationResults,
      signedResultMutation,
    }, null, 2));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
  const scopeMutationCases = [
    ["revealed_response_prefix_bytes", (mutated) => {
      const bytes = Buffer.from(mutated.revealed_response_ranges[0].bytes, "base64url");
      bytes[0] ^= 1;
      mutated.revealed_response_ranges[0].bytes = bytes.toString("base64url");
    }],
    ["revealed_response_suffix_bytes", (mutated) => {
      const last = mutated.revealed_response_ranges.at(-1);
      const bytes = Buffer.from(last.bytes, "base64url");
      bytes[bytes.length - 1] ^= 1;
      last.bytes = bytes.toString("base64url");
    }],
  ];
  let mutationRejected = 0;
  const mutationResults = [];
  for (const [, mutate] of mutationCases) {
    const mutated = structuredClone(signedResult);
    mutate(mutated);
    delete mutated.signature;
    let rejected = false;
    try {
      const mutatedSigningBytes = derive_sparse_verifier_result_signing_bytes(JSON.stringify(mutated));
      rejected = !verify(null, mutatedSigningBytes, publicKey, signature);
    } catch {
      rejected = true;
    }
    if (rejected) mutationRejected += 1;
    mutationResults.push({ name: mutationCases[mutationResults.length][0], rejected });
  }
  let scopeMutationRejected = 0;
  const scopeMutationResults = [];
  for (const [, mutate] of scopeMutationCases) {
    const mutated = structuredClone(signedResult);
    mutate(mutated);
    delete mutated.signature;
    let rejected = false;
    try {
      const mutatedSigningBytes = derive_sparse_verifier_result_signing_bytes(JSON.stringify(mutated));
      rejected = !verify(null, mutatedSigningBytes, publicKey, signature);
    } catch {
      rejected = true;
    }
    if (rejected) scopeMutationRejected += 1;
    scopeMutationResults.push({ name: scopeMutationCases[scopeMutationResults.length][0], rejected });
  }
  return {
    signedJsonBytes: Buffer.byteLength(signedJson),
    signatureBytes: signature.length,
    signatureVerified: true,
    mutationChecks: mutationCases.length,
    mutationRejected,
    mutationResults,
    scopeMutationChecks: scopeMutationCases.length,
    scopeMutationRejected,
    scopeMutationResults,
  };
}

function runChild(fixturePath, requestedPaddingBytes, expectedSha256, mode, caseMetadata = {}) {
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
  const verifierMode = mode === "full" || mode === "full-sparse" ? "full" : "sparse";
  const presentationMode = mode === "full" || mode === "sparse-full" ? "full" : "sparse";
  const presentationBase64 = presentationMode === "full"
    ? fixture.presentation_base64
    : fixture.sparse_presentation_base64;
  if (presentationBase64 == null) {
    console.log(JSON.stringify({
      status: "BLOCKED",
      mode,
      verifierMode,
      presentationMode,
      ...caseMetadata,
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
    const verifyPresentation = verifierMode === "full"
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
    const requestTranscriptBytes = Number.parseInt(unsignedResult.request_transcript_size, 10);
    const responseTranscriptBytes = Number.parseInt(unsignedResult.response_transcript_size, 10);
    const responseBytes = Buffer.from(fixture.authenticated_response_base64, "base64url");
    const responseHeaderEnd = responseBytes.indexOf(Buffer.from("\r\n\r\n", "ascii"));
    const responseHeaderBytes = responseHeaderEnd < 0 ? null : responseHeaderEnd + 4;
    const committedRequestBytes = fixture.committed_request_bytes ?? null;
    const committedResponseBytes = fixture.committed_response_bytes ?? null;
    const committedBytes = committedRequestBytes == null || committedResponseBytes == null
      ? null
      : committedRequestBytes + committedResponseBytes;
    const transcriptBytes = requestTranscriptBytes + responseTranscriptBytes;
    const disclosedResponseRangeLengths = unsignedResult.revealed_response_ranges
      .map((range) => Number.parseInt(range.length, 10));
    const disclosedResponseBodyBytes = responseHeaderBytes == null
      ? null
      : disclosedResponseBytes - responseHeaderBytes;
    const committedResponseBodyBytes = committedResponseBytes == null || responseHeaderBytes == null
      ? null
      : committedResponseBytes - responseHeaderBytes;
    const disclosedResponseSha256 = sha256(Buffer.concat(
      unsignedResult.revealed_response_ranges.map((range) => Buffer.from(range.bytes, "base64url")),
    ));
    console.log(JSON.stringify({
      status: "PASS",
      mode,
      verifierMode,
      presentationMode,
      fixtureSha256: actualSha256,
      requestedPaddingBytes,
      presentationBytes: presentation.length,
      fullPresentationBytes: encodedByteLength(fixture.presentation_base64),
      sparsePresentationBytes: encodedByteLength(fixture.sparse_presentation_base64),
      originResponseBytes: fixture.origin_response_size ?? null,
      responseHeaderBytes,
      responseBodyBytes: responseHeaderBytes == null ? null : responseTranscriptBytes - responseHeaderBytes,
      requestTranscriptBytes,
      responseTranscriptBytes,
      transcriptBytes,
      committedRequestBytes,
      committedResponseBytes,
      committedResponseRangeCount: fixture.committed_response_range_count ?? null,
      committedResponseLargestRangeBytes: fixture.committed_response_largest_range_bytes ?? null,
      committedResponseBodyBytes,
      committedResponseBodyRatio: committedResponseBodyBytes == null || responseHeaderBytes == null
        ? null
        : committedResponseBodyBytes / (responseTranscriptBytes - responseHeaderBytes),
      committedBytes,
      committedRatio: committedBytes == null ? null : committedBytes / transcriptBytes,
      disclosedRequestBytes,
      disclosedResponseBytes,
      disclosedResponseRangeCount: disclosedResponseRangeLengths.length,
      disclosedResponseLargestRangeBytes: Math.max(0, ...disclosedResponseRangeLengths),
      disclosedResponseBodyBytes,
      disclosedResponseBodyRatio: disclosedResponseBodyBytes == null || responseHeaderBytes == null
        ? null
        : disclosedResponseBodyBytes / (responseTranscriptBytes - responseHeaderBytes),
      disclosedBytes: disclosedRequestBytes + disclosedResponseBytes,
      disclosedRatio: disclosedResponseBytes / responseTranscriptBytes,
      disclosureRatio: disclosedResponseBytes / responseTranscriptBytes,
      disclosedResponseSha256,
      verifiedMemberId: unsignedResult.verified_member_id,
      resultBytes: Buffer.byteLength(unsignedResultJson),
      signingBytes: signed?.signingBytes ?? null,
      signatureBytes: signed?.signatureBytes ?? null,
      signedResultBytes: signed?.signedJsonBytes ?? null,
      signatureVerified: signed?.signatureVerified ?? null,
      mutationChecks: signed?.mutationChecks ?? null,
      mutationRejected: signed?.mutationRejected ?? null,
      mutationResults: signed?.mutationResults ?? null,
      scopeMutationChecks: signed?.scopeMutationChecks ?? null,
      scopeMutationRejected: signed?.scopeMutationRejected ?? null,
      scopeMutationResults: signed?.scopeMutationResults ?? null,
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
      verifierMode,
      presentationMode,
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

function runChildResult(fixturePath, requestedPaddingBytes, expectedSha256, mode) {
  const result = spawnSync(
    process.execPath,
    ["--expose-gc", scriptPath, "--child", fixturePath, String(requestedPaddingBytes), expectedSha256, mode],
    { cwd: packageDirectory, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `sparse crypto child failed for ${mode}/${requestedPaddingBytes}`);
  }
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
}

function writeGeneratedFixture(directory, paddingBytes, proofMode, hiddenByte) {
  const generated = generateFixture(paddingBytes, proofMode, hiddenByte);
  const rawBytes = Buffer.from(JSON.stringify(generated.fixture));
  const fixturePath = resolve(directory, fixtureFileName(paddingBytes, proofMode, hiddenByte));
  writeFileSync(fixturePath, rawBytes, { mode: 0o600 });
  return {
    fixture: generated.fixture,
    fixturePath,
    fixtureSha256: sha256(rawBytes),
  };
}

function runScopeRegression() {
  const directory = mkdtempSync(resolve(tmpdir(), "tlsn-sparse-scope-"));
  try {
    const hiddenA = writeGeneratedFixture(directory, 4096, "sparse", "a");
    const hiddenB = writeGeneratedFixture(directory, 4096, "sparse", "b");
    const hiddenAResult = runChildResult(hiddenA.fixturePath, 4096, hiddenA.fixtureSha256, "sparse");
    const hiddenBResult = runChildResult(hiddenB.fixturePath, 4096, hiddenB.fixtureSha256, "sparse");
    const hiddenMutation = {
      originalStatus: hiddenAResult.status,
      mutatedStatus: hiddenBResult.status,
      rawResponseChanged: sha256(Buffer.from(hiddenA.fixture.authenticated_response_base64, "base64url"))
        !== sha256(Buffer.from(hiddenB.fixture.authenticated_response_base64, "base64url")),
      sameTranscriptBytes: hiddenAResult.responseTranscriptBytes === hiddenBResult.responseTranscriptBytes,
      sameDisclosedResponseBytes: hiddenAResult.disclosedResponseBytes === hiddenBResult.disclosedResponseBytes,
      sameDisclosedResponseSha256: hiddenAResult.disclosedResponseSha256 === hiddenBResult.disclosedResponseSha256,
      sameVerifiedMemberId: hiddenAResult.verifiedMemberId === hiddenBResult.verifiedMemberId,
      bothSparseResultsSigned: hiddenAResult.signatureVerified === true && hiddenBResult.signatureVerified === true,
    };
    if (!hiddenMutation.rawResponseChanged
      || hiddenMutation.originalStatus !== "PASS"
      || hiddenMutation.mutatedStatus !== "PASS"
      || !hiddenMutation.sameTranscriptBytes
      || !hiddenMutation.sameDisclosedResponseBytes
      || !hiddenMutation.sameDisclosedResponseSha256
      || !hiddenMutation.sameVerifiedMemberId
      || !hiddenMutation.bothSparseResultsSigned) {
      throw new Error(`hidden response mutation regression failed: ${JSON.stringify(hiddenMutation)}`);
    }

    const complete = writeGeneratedFixture(directory, 4096, "full", "a");
    const completeResult = runChildResult(complete.fixturePath, 4096, complete.fixtureSha256, "full");
    const crossSparseFull = runChildResult(complete.fixturePath, 4096, complete.fixtureSha256, "sparse-full");
    const crossFullSparse = runChildResult(complete.fixturePath, 4096, complete.fixtureSha256, "full-sparse");
    const completeMode = {
      status: completeResult.status,
      verifiedMemberId: completeResult.verifiedMemberId,
      sparseStatus: hiddenAResult.status,
      sameVerifiedMemberId: completeResult.verifiedMemberId === hiddenAResult.verifiedMemberId,
    };
    if (completeMode.status !== "PASS" || completeMode.sparseStatus !== "PASS" || !completeMode.sameVerifiedMemberId) {
      throw new Error(`complete/sparse semantic regression failed: ${JSON.stringify(completeMode)}`);
    }
    const crossProfile = {
      fullPresentationWithSparseVerifier: crossSparseFull.status,
      sparsePresentationWithFullVerifier: crossFullSparse.status,
      rejected: crossSparseFull.status === "BLOCKED" && crossFullSparse.status === "BLOCKED",
    };
    if (!crossProfile.rejected) {
      throw new Error(`cross-profile confusion regression failed: ${JSON.stringify(crossProfile)}`);
    }

    console.log(JSON.stringify({
      status: "PASS",
      hiddenResponseMutation: hiddenMutation,
      revealedRangeMutation: {
        checks: hiddenAResult.scopeMutationChecks,
        rejected: hiddenAResult.scopeMutationRejected,
      },
      transcriptSizeMutation: {
        checks: hiddenAResult.mutationChecks,
        rejected: hiddenAResult.mutationRejected,
      },
      completeMode,
      crossProfile,
    }, null, 2));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runParent() {
  const manifest = JSON.parse(readFileSync(fixtureManifestPath, "utf8"));
  if (manifest.schemaVersion !== 3 || !Array.isArray(manifest.cases)) {
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
    return runChildResult(entry.fixturePath, entry.paddingBytes, entry.fixtureSha256, mode);
  }));
  console.log(JSON.stringify({
    benchmark: "tlsn-worker-sparse-crypto-v3",
    runtime: process.version,
    platform: process.platform,
    fixtureDirectory,
    fixtureManifestSha256: sha256(readFileSync(fixtureManifestPath)),
    fixtureManifest: manifest,
    cases,
  }, null, 2));
}

function runRealParent() {
  const manifest = JSON.parse(readFileSync(realFixtureManifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.cases)) {
    throw new Error(`invalid real sparse fixture manifest: ${realFixtureManifestPath}`);
  }
  const cases = manifest.cases.map((entry) => {
    const fixturePath = resolve(realFixtureDirectory, entry.fixtureFile);
    const rawBytes = readFileSync(fixturePath);
    const actualSha256 = sha256(rawBytes);
    if (actualSha256 !== entry.fixtureSha256) {
      throw new Error(`real fixture SHA-256 mismatch for ${entry.caseLabel}: expected ${entry.fixtureSha256}, got ${actualSha256}`);
    }
    const result = runChildResult(
      fixturePath,
      entry.sourceFixtureBodyBytes,
      entry.fixtureSha256,
      "sparse",
    );
    return {
      ...result,
      caseLabel: entry.caseLabel,
      percentile: entry.percentile,
      sourceEpoch: entry.sourceEpoch,
      sourceFileName: entry.sourceFileName,
      sourceFixtureBodyBytes: entry.sourceFixtureBodyBytes,
      sourceFixtureBodySha256: entry.sourceFixtureBodySha256,
      sourceSemantics: entry.sourceSemantics,
      requestTranscriptStatus: entry.requestTranscriptStatus,
    };
  });
  console.log(JSON.stringify({
    benchmark: "tlsn-worker-sparse-crypto-real-v1",
    runtime: process.version,
    platform: process.platform,
    realFixtureDirectory,
    realFixtureManifestSha256: sha256(readFileSync(realFixtureManifestPath)),
    realFixtureManifest: manifest,
    cases,
  }, null, 2));
}

if (process.argv[2] === "--child") {
  runChild(process.argv[3], Number.parseInt(process.argv[4], 10), process.argv[5], process.argv[6] ?? "sparse");
} else if (process.argv[2] === "--generate") {
  runGeneration();
} else if (process.argv[2] === "--generate-real") {
  runRealGeneration();
} else if (process.argv[2] === "--real") {
  runRealParent();
} else if (process.argv[2] === "--real-regression") {
  runRealRegression();
} else if (process.argv[2] === "--scope-regression") {
  runScopeRegression();
} else {
  runParent();
}
