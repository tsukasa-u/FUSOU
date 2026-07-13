#!/usr/bin/env node

import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { mergeAvroOCFWithBoundaries } from "@fusou/compaction-core";

const DEFAULT_BASE_DIR = "/home/ogu-h/Desktop/FUSOU-PROXY-DATA-LOCAL/R2";
const DEFAULT_OUT_DIR = "/home/ogu-h/Desktop/FUSOU-PROXY-DATA-LOCAL/R2-period-close-check";

function parseArgs(argv) {
  const out = {
    baseDir: DEFAULT_BASE_DIR,
    outDir: DEFAULT_OUT_DIR,
    clean: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") {
      out.baseDir = String(argv[i + 1] || "").trim() || out.baseDir;
      i += 1;
      continue;
    }
    if (arg === "--out") {
      out.outDir = String(argv[i + 1] || "").trim() || out.outDir;
      i += 1;
      continue;
    }
    if (arg === "--clean") {
      out.clean = true;
      continue;
    }
  }

  return out;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeFileAtomic(targetPath, data) {
  const dir = path.dirname(targetPath);
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, targetPath);
}

async function walk(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    const ents = await fs.readdir(cur, { withFileTypes: true });
    for (const ent of ents) {
      const abs = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(abs);
      else if (ent.isFile()) out.push(abs);
    }
  }
  return out;
}

function parseHourlyKey(rel) {
  const m = rel.match(/^([^/]+)\/([^/]+)\/hourly\/([^/]+)\/([^/]+)-(\d+)\.avro$/);
  if (!m) return null;
  const runKey = String(m[3] || "");
  const numericRunTs = /^\d{9,}$/.test(runKey)
    ? Number(runKey)
    : Number(String(runKey).split("-")[0]);
  return {
    tableVersion: m[1],
    periodTag: m[2],
    runTs: Number.isFinite(numericRunTs) && numericRunTs > 0 ? numericRunTs : 0,
    tableName: m[4],
    index: Number(m[5]),
  };
}

function digest(input) {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function keyFor(entry) {
  return `${entry.tableVersion}|${entry.periodTag}|${entry.tableName}`;
}

function scopeKeyFor(entry) {
  return `${entry.tableVersion}|${entry.periodTag}`;
}

function buildOutputGroupMap(sourceEntries, targetTier) {
  const scopeMap = new Map();
  for (const e of sourceEntries) {
    const scopeKey = scopeKeyFor(e);
    if (!scopeMap.has(scopeKey)) scopeMap.set(scopeKey, []);
    scopeMap.get(scopeKey).push(e);
  }

  const out = new Map();
  for (const [scopeKey, entries] of scopeMap.entries()) {
    const runTsValues = entries
      .map((e) => Number(e.runTs || 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    const epochSec = runTsValues.length > 0
      ? Math.max(...runTsValues)
      : Math.trunc(Date.now() / 1000);
    const hash = digest(`${targetTier}:${scopeKey}:${epochSec}`).slice(0, 12);
    out.set(scopeKey, `${epochSec}-${hash}`);
  }
  return out;
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.runTs !== b.runTs) return a.runTs - b.runTs;
    if (a.index !== b.index) return a.index - b.index;
    return a.path.localeCompare(b.path);
  });
}

async function compactTier({ sourceEntries, targetTier, outDir }) {
  const grouped = new Map();
  const outputGroupMap = buildOutputGroupMap(sourceEntries, targetTier);
  for (const e of sourceEntries) {
    const k = keyFor(e);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(e);
  }

  const nextEntries = [];
  const failures = [];
  let mergedInputFiles = 0;

  for (const [k, entries] of grouped.entries()) {
    const ordered = sortEntries(entries);
    const buffers = [];
    for (const e of ordered) {
      try {
        const buf = await fs.readFile(e.path);
        buffers.push(new Uint8Array(buf));
      } catch (error) {
        failures.push({
          group: k,
          path: e.path,
          error: String(error?.message || error),
        });
      }
    }

    if (buffers.length === 0) continue;

    try {
      const merged = mergeAvroOCFWithBoundaries(buffers);
      const first = ordered[0];
      const scopeKey = scopeKeyFor(first);
      const outputGroupKey = outputGroupMap.get(scopeKey) || `${Math.trunc(Date.now() / 1000)}-${digest(`${targetTier}:${scopeKey}`).slice(0, 12)}`;
      const rel = `${first.tableVersion}/${first.periodTag}/${targetTier}/${outputGroupKey}/${first.tableName}-001.avro`;
      const abs = path.join(outDir, rel);
      await ensureDir(path.dirname(abs));
      await writeFileAtomic(abs, merged.merged);
      const nextRunTs = Number(String(outputGroupKey).split("-")[0]);
      nextEntries.push({
        path: abs,
        tableVersion: first.tableVersion,
        periodTag: first.periodTag,
        tableName: first.tableName,
        runTs: Number.isFinite(nextRunTs) && nextRunTs > 0 ? nextRunTs : 0,
        index: 1,
        tier: targetTier,
      });
      mergedInputFiles += buffers.length;
    } catch (error) {
      failures.push({
        group: k,
        error: String(error?.message || error),
      });
    }
  }

  return {
    groups: grouped.size,
    outputs: nextEntries.length,
    mergedInputFiles,
    failures,
    entries: nextEntries,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const baseDir = path.resolve(args.baseDir);
  const outDir = path.resolve(args.outDir);

  if (args.clean) {
    await fs.rm(outDir, { recursive: true, force: true });
  }
  await ensureDir(outDir);

  const files = await walk(baseDir);
  const hourlyEntries = [];
  for (const abs of files) {
    if (!abs.endsWith(".avro")) continue;
    const rel = path.relative(baseDir, abs).split(path.sep).join("/");
    const parsed = parseHourlyKey(rel);
    if (!parsed) continue;
    hourlyEntries.push({
      path: abs,
      tableVersion: parsed.tableVersion,
      periodTag: parsed.periodTag,
      tableName: parsed.tableName,
      runTs: parsed.runTs,
      index: parsed.index,
      tier: "hourly",
    });
  }

  const daily = await compactTier({ sourceEntries: hourlyEntries, targetTier: "daily", outDir });
  const weekly = await compactTier({ sourceEntries: daily.entries, targetTier: "weekly", outDir });
  const period = await compactTier({ sourceEntries: weekly.entries, targetTier: "period", outDir });
  const periodClose = await compactTier({ sourceEntries: period.entries, targetTier: "period", outDir });

  const finalGrouped = new Map();
  for (const e of periodClose.entries) {
    const k = keyFor(e);
    finalGrouped.set(k, (finalGrouped.get(k) || 0) + 1);
  }
  const nonSingleFinal = [...finalGrouped.entries()].filter(([, n]) => n !== 1);

  const report = {
    baseDir,
    outDir,
    sourceHourlyFiles: hourlyEntries.length,
    tiers: {
      daily: {
        groups: daily.groups,
        outputs: daily.outputs,
        mergedInputFiles: daily.mergedInputFiles,
        failures: daily.failures.length,
      },
      weekly: {
        groups: weekly.groups,
        outputs: weekly.outputs,
        mergedInputFiles: weekly.mergedInputFiles,
        failures: weekly.failures.length,
      },
      period: {
        groups: period.groups,
        outputs: period.outputs,
        mergedInputFiles: period.mergedInputFiles,
        failures: period.failures.length,
      },
      periodClose: {
        groups: periodClose.groups,
        outputs: periodClose.outputs,
        mergedInputFiles: periodClose.mergedInputFiles,
        failures: periodClose.failures.length,
      },
    },
    finalGroups: finalGrouped.size,
    nonSingleFinalGroups: nonSingleFinal.length,
    failureSamples: {
      daily: daily.failures.slice(0, 5),
      weekly: weekly.failures.slice(0, 5),
      period: period.failures.slice(0, 5),
      periodClose: periodClose.failures.slice(0, 5),
    },
    ok:
      daily.failures.length === 0 &&
      weekly.failures.length === 0 &&
      period.failures.length === 0 &&
      periodClose.failures.length === 0 &&
      nonSingleFinal.length === 0,
  };

  const reportPath = path.join(outDir, "_period_close_verify_report.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
