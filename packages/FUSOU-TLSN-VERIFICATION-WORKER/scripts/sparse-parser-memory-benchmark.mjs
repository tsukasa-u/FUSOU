#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseSparseProfileTranscripts } from "./production-evidence-semantic.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const DEFAULT_CASES = [1, 4, 8, 16, 32].map((megabytes) => megabytes * 1024 * 1024);
const BINDING_VALUE = "benchmark-binding";
const MEMBER_ID = "16189463";

function parseCases() {
  const configured = process.env.TLSN_SPARSE_PARSER_BENCHMARK_BYTES;
  const values = configured
    ? configured.split(",").map((value) => Number.parseInt(value.trim(), 10))
    : DEFAULT_CASES;
  if (values.length === 0 || values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("TLSN_SPARSE_PARSER_BENCHMARK_BYTES must be comma-separated non-negative integers");
  }
  return [...new Set(values)];
}

function fullRangeFor(bytes) {
  return [{ start: "0", length: String(bytes.length), bytes: bytes.toString("base64url") }];
}

function sparseResponseRanges(response) {
  const unrelatedKey = Buffer.from('"unrelated":"', "ascii");
  const keyStart = response.indexOf(unrelatedKey);
  if (keyStart < 0) throw new Error("sparse benchmark response lacks unrelated string");
  const gapStart = keyStart + unrelatedKey.length;
  const gapEnd = response.indexOf(0x22, gapStart);
  if (response[gapEnd] !== 0x22) throw new Error("sparse benchmark unrelated string boundary is invalid");
  return [
    { start: "0", length: String(gapStart), bytes: response.subarray(0, gapStart).toString("base64url") },
    { start: String(gapEnd), length: String(response.length - gapEnd), bytes: response.subarray(gapEnd).toString("base64url") },
  ];
}

function requestTranscript() {
  return Buffer.from(
    `POST /kcsapi/api_get_member/require_info HTTP/1.1\r\nHost: game.example.com\r\nX-Attestation-Binding: ${BINDING_VALUE}\r\nContent-Length: 0\r\n\r\n`,
  );
}

function responseTranscript(targetBytes) {
  let paddingBytes = Math.max(0, targetBytes - 1024);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const body = Buffer.from(JSON.stringify({
      api_result: 1,
      unrelated: "x".repeat(paddingBytes),
      api_data: { api_basic: { api_member_id: Number(MEMBER_ID) } },
    }).replace(/^/, "svdata="));
    const transcript = Buffer.concat([
      Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n`),
      body,
    ]);
    if (transcript.length === targetBytes) return transcript;
    paddingBytes = Math.max(0, paddingBytes + targetBytes - transcript.length);
  }
  throw new Error(`could not construct a ${targetBytes}-byte response transcript`);
}

function materializeMemberId(response) {
  const bodyStart = response.indexOf(Buffer.from("\r\n\r\n")) + 4;
  const jsonText = new TextDecoder("utf-8", { fatal: true }).decode(response.subarray(bodyStart)).slice("svdata=".length);
  const parsed = JSON.parse(jsonText);
  return String(parsed.api_data.api_basic.api_member_id);
}

function requireStatus() {
  return process.getBuiltinModule?.("node:fs")?.readFileSync("/proc/self/status", "utf8") ?? "";
}

function residentMemory() {
  try {
    const status = requireStatus();
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
    return {
      rssBytes: null,
      peakRssBytes: null,
      dataBytes: null,
      virtualBytes: null,
    };
  }
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  return {
    ...residentMemory(),
    heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
  };
}

function runChild(targetBytes, mode) {
  const request = requestTranscript();
  let response = responseTranscript(targetBytes);
  const responseRanges = mode === "sparse"
    ? sparseResponseRanges(response)
    : fullRangeFor(response);
  const semanticVerification = {
    verified_presentation: {
      request_transcript_size: String(request.length),
      response_transcript_size: String(targetBytes),
      revealed_request_ranges: fullRangeFor(request),
      revealed_response_ranges: responseRanges,
    },
  };
  const constructionAfter = memorySnapshot();
  if (mode === "sparse") response = undefined;
  globalThis.gc?.();
  const before = memorySnapshot();
  const startedAt = performance.now();
  const parsedMemberId = mode === "materialized"
    ? materializeMemberId(response)
    : parseSparseProfileTranscripts(
      semanticVerification,
      "game.example.com",
      BINDING_VALUE,
    ).memberId;
  const elapsedMilliseconds = performance.now() - startedAt;
  if (parsedMemberId !== MEMBER_ID) throw new Error("sparse parser returned the wrong member ID");
  const after = memorySnapshot();
  const additional = (beforeSnapshot, afterSnapshot) => ({
    rssBytes: afterSnapshot.rssBytes === null || beforeSnapshot.rssBytes === null ? null : afterSnapshot.rssBytes - beforeSnapshot.rssBytes,
    vmDataBytes: afterSnapshot.dataBytes === null || beforeSnapshot.dataBytes === null ? null : afterSnapshot.dataBytes - beforeSnapshot.dataBytes,
    vmSizeBytes: afterSnapshot.virtualBytes === null || beforeSnapshot.virtualBytes === null ? null : afterSnapshot.virtualBytes - beforeSnapshot.virtualBytes,
    heapBytes: afterSnapshot.heapUsedBytes - beforeSnapshot.heapUsedBytes,
    externalBytes: afterSnapshot.externalBytes - beforeSnapshot.externalBytes,
    arrayBuffersBytes: afterSnapshot.arrayBuffersBytes - beforeSnapshot.arrayBuffersBytes,
  });
  console.log(JSON.stringify({
    mode,
    transcriptBytes: targetBytes,
    disclosedBytes: semanticVerification.verified_presentation.revealed_response_ranges
      .reduce((total, range) => total + Number.parseInt(range.length, 10), 0),
    disclosureRatio: semanticVerification.verified_presentation.revealed_response_ranges
      .reduce((total, range) => total + Number.parseInt(range.length, 10), 0) / targetBytes,
    elapsedMilliseconds,
    constructionAfter,
    before,
    after,
    additional: additional(before, after),
  }));
}

function runParent() {
  const cases = ["sparse", "materialized"].flatMap((mode) => parseCases().map((targetBytes) => {
    const result = spawnSync(process.execPath, ["--expose-gc", scriptPath, "--child", String(targetBytes), mode], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `sparse parser benchmark failed for ${mode}/${targetBytes}`);
    return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  }));
  console.log(JSON.stringify({
    benchmark: "tlsn-worker-sparse-parser-memory-v1",
    runtime: process.version,
    platform: process.platform,
    cases,
  }, null, 2));
}

if (process.argv[2] === "--child") {
  runChild(Number.parseInt(process.argv[3], 10), process.argv[4] ?? "streaming");
} else {
  runParent();
}