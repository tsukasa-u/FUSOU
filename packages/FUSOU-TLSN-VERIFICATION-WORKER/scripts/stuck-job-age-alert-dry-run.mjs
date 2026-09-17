#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { packageDirectory } from "./tlsn-benchmark-fixtures.mjs";

const defaultThresholdMs = 5 * 60 * 1_000;
const thresholdMs = parseInteger("TLSN_TEST_STUCK_JOB_AGE_THRESHOLD_MS", defaultThresholdMs, 1, 86_400_000);
const now = Date.parse("2026-09-17T12:00:00.000Z");
const reportPath = process.env.TLSN_STUCK_JOB_ALERT_REPORT_PATH?.trim()
  || resolve(packageDirectory, "artifacts/tlsn-stuck-job-age-alert-dry-run.json");
const ACTIVE_STATES = new Set(["processing", "verifying"]);

function parseInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function classifyStuckJobs(records, observedAt, ageThresholdMs) {
  const stateCounts = {};
  const alerts = [];
  for (const record of records) {
    stateCounts[record.status] = (stateCounts[record.status] ?? 0) + 1;
    if (!ACTIVE_STATES.has(record.status)) continue;
    const createdAt = Date.parse(record.created_at);
    if (!Number.isFinite(createdAt)) continue;
    const ageMs = observedAt - createdAt;
    if (ageMs >= ageThresholdMs) alerts.push({ state: record.status, age_ms: ageMs });
  }
  return {
    observed_at: new Date(observedAt).toISOString(),
    threshold_ms: ageThresholdMs,
    state_counts: stateCounts,
    alert_count: alerts.length,
    alert_state_counts: alerts.reduce((counts, alert) => {
      counts[alert.state] = (counts[alert.state] ?? 0) + 1;
      return counts;
    }, {}),
    alert_age_ms: alerts.map((alert) => alert.age_ms).sort((left, right) => left - right),
  };
}

async function main() {
  const result = classifyStuckJobs([
    { status: "processing", created_at: "2026-09-17T11:59:30.000Z" },
    { status: "verifying", created_at: "2026-09-17T11:50:00.000Z" },
    { status: "failed", created_at: "2026-09-17T11:40:00.000Z" },
    { status: "consumed", created_at: "2026-09-17T11:30:00.000Z" },
  ], now, thresholdMs);
  assert.equal(result.alert_count, 1);
  assert.deepEqual(result.alert_state_counts, { verifying: 1 });
  assert.deepEqual(result.state_counts, { processing: 1, verifying: 1, failed: 1, consumed: 1 });
  assert.deepEqual(result.alert_age_ms, [600_000]);

  const report = {
    schema_version: 1,
    evidence: "tlsn-stuck-job-age-alert-dry-run",
    generated_at: new Date().toISOString(),
    decision: "PASS",
    detector: result,
    test_scope: "pure test-only detector contract; no production job query or alert delivery",
    production_alert_delivery: "NOT_ESTABLISHED",
    formal_slo_decision: "NOT_ESTABLISHED",
    payload_privacy: "bounded counts, states, and ages only; raw IDs and secrets excluded",
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ report_path: reportPath, decision: report.decision, production_alert_delivery: report.production_alert_delivery }));
}

main().catch((error) => {
  console.error(`[tlsn-stuck-job-age-alert] ${error instanceof Error ? error.message : "dry_run_failed"}`);
  process.exitCode = 1;
});
