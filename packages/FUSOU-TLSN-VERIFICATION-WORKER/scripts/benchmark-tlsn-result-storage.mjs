#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TARGETS = [
  4 * 1024,
  16 * 1024,
  64 * 1024,
  256 * 1024,
  1024 * 1024,
  4 * 1024 * 1024,
  16 * 1024 * 1024,
];
const RESULT_SIGNATURE = "A".repeat(86);

function integerEnvironment(name, fallback, minimum, maximum) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function targetSizes() {
  const configured = process.env.TLSN_RESULT_STORAGE_TARGET_BYTES;
  const values = configured
    ? configured.split(",").map((value) => Number.parseInt(value.trim(), 10))
    : DEFAULT_TARGETS;
  if (values.length === 0 || values.some((value) => !Number.isSafeInteger(value) || value < 4 * 1024 || value > 16 * 1024 * 1024)) {
    throw new Error("TLSN_RESULT_STORAGE_TARGET_BYTES must contain values from 4096 to 16777216");
  }
  return [...new Set(values)];
}

function pQuantile(values, quantile) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  return sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function summarize(observations, field) {
  const values = observations.map((observation) => observation[field]).filter(Number.isFinite);
  return {
    count: values.length,
    p50_ms: pQuantile(values, 0.5),
    p95_ms: pQuantile(values, 0.95),
    maximum_ms: values.length ? Math.max(...values) : null,
  };
}

function syntheticResponseForTarget(targetBytes) {
  const resultTemplate = {
    version: 1,
    profile_id: "synthetic-result-storage-v1",
    battle_data: "",
    result_signature: RESULT_SIGNATURE,
  };
  const responseTemplate = {
    verified: true,
    result: resultTemplate,
    signer_key_id: "synthetic-result-storage",
    signature_algorithm: "Ed25519",
    consume_receipt: {
      session_id: "123e4567-e89b-42d3-a456-426614174000",
      used_at: "2026-01-01T00:00:00.000Z",
    },
    device_replay_digest_hex: "0".repeat(64),
  };
  let payloadBytes = Math.max(0, targetBytes - Buffer.byteLength(JSON.stringify(responseTemplate)));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = { ...resultTemplate, battle_data: "x".repeat(payloadBytes) };
    const response = { ...responseTemplate, result };
    const responseBytes = Buffer.from(JSON.stringify(response));
    const difference = targetBytes - responseBytes.byteLength;
    if (difference === 0) {
      return {
        payloadBytes,
        signedResultBytes: Buffer.byteLength(JSON.stringify(result)),
        responseBytes,
      };
    }
    payloadBytes = Math.max(0, payloadBytes + difference);
  }
  throw new Error(`could not construct an exact ${targetBytes}-byte synthetic Result`);
}

async function measureOne(targetBytes, repeat, directory) {
  const constructionStartedAt = performance.now();
  const prepared = syntheticResponseForTarget(targetBytes);
  const constructionMilliseconds = performance.now() - constructionStartedAt;
  const hashStartedAt = performance.now();
  const resultSha256 = createHash("sha256").update(prepared.responseBytes).digest("base64url");
  const resultHashMilliseconds = performance.now() - hashStartedAt;

  const path = resolve(directory, `result-${targetBytes}-${repeat}.json`);
  const persistenceStartedAt = performance.now();
  await writeFile(path, prepared.responseBytes);
  const resultPersistenceMilliseconds = performance.now() - persistenceStartedAt;

  const readStartedAt = performance.now();
  const storedBytes = await readFile(path);
  const statusResultReadMilliseconds = performance.now() - readStartedAt;
  const statusHashStartedAt = performance.now();
  const statusSha256 = createHash("sha256").update(storedBytes).digest("base64url");
  const statusResultHashMilliseconds = performance.now() - statusHashStartedAt;
  const parseStartedAt = performance.now();
  const parsed = JSON.parse(storedBytes.toString("utf8"));
  const statusResultParseMilliseconds = performance.now() - parseStartedAt;
  if (statusSha256 !== resultSha256 || parsed.verified !== true) {
    throw new Error(`synthetic Result integrity check failed for ${targetBytes} bytes`);
  }

  return {
    target_bytes: targetBytes,
    payload_bytes: prepared.payloadBytes,
    signed_result_bytes: prepared.signedResultBytes,
    r2_object_bytes: storedBytes.byteLength,
    client_response_bytes: storedBytes.byteLength,
    result_construction_ms: constructionMilliseconds,
    result_hash_ms: resultHashMilliseconds,
    result_persistence_ms: resultPersistenceMilliseconds,
    status_result_read_ms: statusResultReadMilliseconds,
    status_result_hash_ms: statusResultHashMilliseconds,
    status_result_parse_ms: statusResultParseMilliseconds,
    status_success_path_ms: statusResultReadMilliseconds + statusResultHashMilliseconds + statusResultParseMilliseconds,
  };
}

async function main() {
  const repeats = integerEnvironment("TLSN_RESULT_STORAGE_REPEATS", 3, 1, 20);
  const reportPath = resolve(
    process.env.TLSN_RESULT_STORAGE_REPORT_PATH ?? resolve(packageDirectory, "artifacts/tlsn-result-storage-scaling.json"),
  );
  const directory = await mkdtemp(resolve(tmpdir(), "fusou-tlsn-result-storage-"));
  try {
    const observations = [];
    for (const targetBytes of targetSizes()) {
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        observations.push(await measureOne(targetBytes, repeat, directory));
      }
    }
    const cases = targetSizes().map((targetBytes) => {
      const caseObservations = observations.filter((observation) => observation.target_bytes === targetBytes);
      return {
        target_bytes: targetBytes,
        observations: caseObservations,
        timings_ms: Object.fromEntries([
          "result_construction_ms",
          "result_hash_ms",
          "result_persistence_ms",
          "status_result_read_ms",
          "status_result_hash_ms",
          "status_result_parse_ms",
          "status_success_path_ms",
        ].map((field) => [field, summarize(caseObservations, field)])),
        sizes_bytes: {
          payload: caseObservations[0]?.payload_bytes ?? null,
          signed_result: caseObservations[0]?.signed_result_bytes ?? null,
          r2_object: caseObservations[0]?.r2_object_bytes ?? null,
          client_response: caseObservations[0]?.client_response_bytes ?? null,
        },
      };
    });
    const report = {
      schema_version: 1,
      benchmark: "tlsn-worker-result-storage-scaling-v1",
      generated_at: new Date().toISOString(),
      verification_semantics: "NOT_TESTED",
      storage_backend: "local-filesystem-proxy",
      network_access: false,
      repeats,
      target_sizes_bytes: targetSizes(),
      interpretation: "Synthetic JSON envelope only. This measures byte copying, hashing, local persistence, and status parsing; it does not verify TLSN evidence or measure remote R2.",
      cases,
      report_path: reportPath,
    };
    await mkdir(resolve(reportPath, ".."), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      report_path: reportPath,
      verification_semantics: report.verification_semantics,
      target_sizes_bytes: report.target_sizes_bytes,
      cases: cases.map((item) => ({
        target_bytes: item.target_bytes,
        result_persistence_p50_ms: item.timings_ms.result_persistence_ms.p50_ms,
        status_success_path_p50_ms: item.timings_ms.status_success_path_ms.p50_ms,
      })),
    }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[tlsn-result-storage] ${error instanceof Error ? error.message : "benchmark_failed"}`);
  process.exitCode = 2;
});