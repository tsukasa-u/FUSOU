#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  loadRealFixture,
  packageDirectory,
  readRealFixtureManifest,
  repositoryDirectory,
} from "./tlsn-benchmark-fixtures.mjs";

const TARGET_BANDS = [
  { label: "4KiB-16KiB", minimum: 4 * 1024, maximum: 16 * 1024 },
  { label: "16KiB-64KiB", minimum: 16 * 1024, maximum: 64 * 1024 },
  { label: "64KiB-256KiB", minimum: 64 * 1024, maximum: 256 * 1024 },
  { label: "256KiB-1MiB", minimum: 256 * 1024, maximum: 1024 * 1024 },
  { label: "1MiB-4MiB", minimum: 1024 * 1024, maximum: 4 * 1024 * 1024 },
  { label: "4MiB-8MiB", minimum: 4 * 1024 * 1024, maximum: 8 * 1024 * 1024 },
];

function optional(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function repositoryRelativePath(value) {
  const absolute = resolve(value);
  return absolute.startsWith(`${repositoryDirectory}/`)
    ? absolute.slice(repositoryDirectory.length + 1)
    : "EXTERNAL_SOURCE_NOT_RECORDED";
}

function bandFor(bytes) {
  return TARGET_BANDS.find((band) => bytes >= band.minimum && bytes < band.maximum)?.label ?? null;
}

function summarize(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return { count: 0, minimum: null, maximum: null };
  return {
    count: sorted.length,
    minimum: sorted[0],
    maximum: sorted.at(-1),
  };
}

async function main() {
  const { manifest, entries } = readRealFixtureManifest();
  const observations = [];
  for (const entry of entries.values()) {
    const fixture = loadRealFixture(entry);
    const presentationBytes = Buffer.from(fixture.sparse_presentation_base64, "base64url").byteLength;
    observations.push({
      case_label: entry.caseLabel,
      source_fixture_body_bytes: entry.sourceFixtureBodyBytes,
      presentation_bytes: presentationBytes,
      presentation_band: bandFor(presentationBytes),
      source_epoch: entry.sourceEpoch,
      source_file: entry.sourceFileName,
    });
  }

  const measuredBands = new Set(observations.map((observation) => observation.presentation_band).filter(Boolean));
  const report = {
    schema_version: 1,
    benchmark: "tlsn-worker-direct-payload-scaling",
    generated_at: new Date().toISOString(),
    execution: {
      remote_latency: "NOT_RUN",
      "remote_latency_requires_explicit_external_access_approval": true,
      synthetic_padding_used: false,
      arbitrary_payload_append_used: false,
    },
    fixture_corpus: {
      manifest: "packages/FUSOU-TLSN-VERIFICATION-WORKER/.cache/sparse-crypto-real-fixtures/manifest.json",
      source_path: repositoryRelativePath(manifest.source.path),
      request_transcript_status: "NOT_ESTABLISHED",
      fixture_semantics: manifest.source.fixtureSemantics,
    },
    payload_definition: {
      measured_bytes: "sparse Presentation bytes sent to the verifier",
      source_response_bytes: "reported for context only; not used as Presentation size",
      limit_bytes: 8 * 1024 * 1024,
    },
    target_bands: TARGET_BANDS.map((band) => ({
      ...band,
      status: measuredBands.has(band.label) ? "MEASURED_CORPUS_COVERAGE" : "NOT_ESTABLISHED",
      cases: observations
        .filter((observation) => observation.presentation_band === band.label)
        .map((observation) => observation.case_label),
    })),
    observed_presentation_bytes: summarize(observations.map((observation) => observation.presentation_bytes)),
    observed_source_response_bytes: summarize(observations.map((observation) => observation.source_fixture_body_bytes)),
    observations,
    interpretation: measuredBands.size === 0
      ? "No available real fixture falls within the requested scaling bands."
      : "Only bands represented by available real TLSN fixtures are measured; absent bands remain NOT_ESTABLISHED.",
    report_path: optional("TLSN_PAYLOAD_SCALING_REPORT_PATH")
      ?? resolve(packageDirectory, "artifacts/tlsn-remote-direct-payload-scaling.json"),
  };
  await mkdir(dirname(report.report_path), { recursive: true });
  await writeFile(report.report_path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    report_path: report.report_path,
    observed_presentation_bytes: report.observed_presentation_bytes,
    measured_bands: [...measuredBands],
    unestablished_band_count: report.target_bands.filter((band) => band.status === "NOT_ESTABLISHED").length,
  }));
}

main().catch((error) => {
  console.error(`[tlsn-payload-scaling] ${error instanceof Error ? error.message : "measurement_failed"}`);
  process.exitCode = 2;
});
