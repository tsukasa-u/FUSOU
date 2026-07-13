#!/usr/bin/env node
/**
 * sync-period-close-battle-data.mjs
 *
 * Period-close unit uploader/planner for battle Avro data.
 *
 * Why this exists:
 * - Commit data by period-close transaction (not per-file/hourly) for safer rollouts/rollback.
 * - Reuse same period manifest for local restore and future browser drag-and-drop sync flows.
 * - Allow FUSOU-WEB to consume correct local data shape even without R2 sync.
 *
 * Usage:
 *   node scripts/sync-period-close-battle-data.mjs --src /path/to/R2_reconstructed --period latest
 *   node scripts/sync-period-close-battle-data.mjs --src /path/to/R2_reconstructed --period 2026-05-29 --bucket dev-kc-battle-data --apply --remote
 *   node scripts/sync-period-close-battle-data.mjs --src /path/to/R2_reconstructed --period all --bucket dev-kc-battle-data --apply --remote
 *
 * Env overrides:
 *   FUSOU_BATTLE_DATA_SRC or BATTLE_DATA_SRC
 *   BATTLE_DATA_BUCKET_NAME or SEED_BATTLE_BUCKET
 *   FUSOU_WEB_DIR (wrangler execution directory)
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WEB_DIR = path.resolve(SCRIPT_DIR, "..");

function parseArgs(argv) {
  const envSrc = String(process.env.FUSOU_BATTLE_DATA_SRC || process.env.BATTLE_DATA_SRC || "").trim();
  const envBucket = String(process.env.BATTLE_DATA_BUCKET_NAME || process.env.SEED_BATTLE_BUCKET || "").trim();
  const envWebDir = String(process.env.FUSOU_WEB_DIR || "").trim();

  const out = {
    src: envSrc || "",
    sourceTier: "hourly",
    period: "latest",
    bucket: envBucket,
    apply: false,
    remote: false,
    maxPeriods: 0,
    verbose: false,
    webDir: envWebDir || DEFAULT_WEB_DIR,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--src") {
      out.src = String(argv[i + 1] || "").trim() || out.src;
      i += 1;
      continue;
    }
    if (a === "--period") {
      out.period = String(argv[i + 1] || "").trim() || out.period;
      i += 1;
      continue;
    }
    if (a === "--source-tier") {
      const v = String(argv[i + 1] || "").trim().toLowerCase();
      out.sourceTier = v || out.sourceTier;
      i += 1;
      continue;
    }
    if (a === "--bucket") {
      out.bucket = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (a === "--web-dir") {
      out.webDir = String(argv[i + 1] || "").trim() || out.webDir;
      i += 1;
      continue;
    }
    if (a === "--max-periods") {
      const n = Number(argv[i + 1]);
      out.maxPeriods = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
      i += 1;
      continue;
    }
    if (a === "--apply") {
      out.apply = true;
      continue;
    }
    if (a === "--remote") {
      out.remote = true;
      continue;
    }
    if (a === "--verbose") {
      out.verbose = true;
      continue;
    }
  }

  return out;
}

function runNpx(args, cwd = process.cwd()) {
  return execFileSync("npx", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function wranglerPutObject({ bucket, key, filePath, remote, webDir }) {
  const args = ["wrangler", "r2", "object", "put", `${bucket}/${key}`, "--file", filePath];
  if (remote) args.push("--remote");
  runNpx(args, webDir);
}

async function walkAvro(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = await fsp.readdir(cur, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".avro")) {
        out.push(abs);
      }
    }
  }
  return out;
}

function parseR2LikeKey(relPath) {
  const rel = String(relPath || "").split(path.sep).join("/");
  const m = rel.match(/^([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)-(\d{3})\.avro$/);
  if (!m) return null;
  return {
    key: rel,
    tableVersion: m[1],
    periodTag: m[2],
    tier: m[3],
    runKey: m[4],
    tableName: m[5],
    index: Number(m[6]),
  };
}

function isPeriodTag(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
}

function choosePeriods(periodArg, allPeriodTags) {
  const sorted = [...allPeriodTags].sort((a, b) => b.localeCompare(a));
  const mode = String(periodArg || "latest").trim().toLowerCase();

  if (mode === "latest") {
    return sorted.length > 0 ? [sorted[0]] : [];
  }
  if (mode === "all") {
    return sorted;
  }

  const requested = [...new Set(String(periodArg || "").split(",").map((x) => x.trim()).filter(Boolean))];
  const selected = requested.filter((x) => isPeriodTag(x));
  return selected.filter((x) => allPeriodTags.has(x));
}

function keyForPeriodGroup(tableVersion, periodTag) {
  return `${tableVersion}|${periodTag}`;
}

function buildPeriodCloseKey({ tableVersion, periodTag, runKey, tableName, index }) {
  const idx = String(index).padStart(3, "0");
  return `${tableVersion}/${periodTag}/period/${runKey}/${tableName}-${idx}.avro`;
}

function normalizeRunTs(runKey) {
  const v = String(runKey || "").trim();
  if (!v) return 0;
  const n = /^\d{9,}$/.test(v) ? Number(v) : Number(String(v).split("-")[0]);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function buildPeriodCloseRunKey(tableVersion, periodTag, runKeys) {
  const sorted = [...new Set((runKeys || []).map((x) => String(x || "").trim()).filter(Boolean))].sort();
  const ts = sorted.map((x) => normalizeRunTs(x)).filter((x) => x > 0);
  const epoch = ts.length > 0 ? Math.max(...ts) : Math.trunc(Date.now() / 1000);
  const hash = crypto
    .createHash("sha256")
    .update(`${tableVersion}|${periodTag}|${sorted.join(",")}`)
    .digest("hex")
    .slice(0, 12);
  return `${epoch}-${hash}`;
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function buildPlan(srcRoot, selectedPeriods, maxPeriods = 0) {
  const files = await walkAvro(srcRoot);
  const selectedSet = new Set(selectedPeriods);
  const groups = new Map();

  for (const absPath of files) {
    const rel = path.relative(srcRoot, absPath).split(path.sep).join("/");
    const parsed = parseR2LikeKey(rel);
    if (!parsed) continue;
    if (!selectedSet.has(parsed.periodTag)) continue;

    const stat = await fsp.stat(absPath);
    const k = keyForPeriodGroup(parsed.tableVersion, parsed.periodTag);
    if (!groups.has(k)) {
      groups.set(k, {
        tableVersion: parsed.tableVersion,
        periodTag: parsed.periodTag,
        files: [],
        tablesSet: new Set(),
        runKeySet: new Set(),
        totalBytes: 0,
      });
    }

    const g = groups.get(k);
    g.files.push({
      sourcePath: rel,
      runKey: parsed.runKey,
      tableName: parsed.tableName,
      sourceIndex: parsed.index,
      sizeBytes: Number(stat.size || 0),
    });
    g.tablesSet.add(parsed.tableName);
    g.runKeySet.add(parsed.runKey);
    g.totalBytes += Number(stat.size || 0);
  }

  let out = [...groups.values()]
    .map((g) => {
      const runKeys = [...g.runKeySet].sort();
      const periodCloseRunKey = buildPeriodCloseRunKey(g.tableVersion, g.periodTag, runKeys);
      const filesSorted = g.files.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
      const tableCounter = new Map();
      const files = filesSorted.map((f) => {
        const next = Number(tableCounter.get(f.tableName) || 0) + 1;
        tableCounter.set(f.tableName, next);
        return {
          ...f,
          targetPath: buildPeriodCloseKey({
            tableVersion: g.tableVersion,
            periodTag: g.periodTag,
            runKey: periodCloseRunKey,
            tableName: f.tableName,
            index: next,
          }),
        };
      });

      return {
        tableVersion: g.tableVersion,
        periodTag: g.periodTag,
        periodCloseRunKey,
        files,
        tables: [...g.tablesSet].sort(),
        runKeys,
        fileCount: g.files.length,
        tableCount: g.tablesSet.size,
        runKeyCount: g.runKeySet.size,
        totalBytes: g.totalBytes,
      };
    })
    .sort((a, b) => {
      if (a.periodTag !== b.periodTag) return b.periodTag.localeCompare(a.periodTag);
      return a.tableVersion.localeCompare(b.tableVersion);
    });

  if (maxPeriods > 0) {
    const seen = new Set();
    out = out.filter((x) => {
      if (seen.size >= maxPeriods && !seen.has(x.periodTag)) return false;
      seen.add(x.periodTag);
      return true;
    });
  }

  return out;
}

function isAllowedSourceTier(tier, sourceTier) {
  const cur = String(tier || "").trim().toLowerCase();
  const want = String(sourceTier || "hourly").trim().toLowerCase();
  if (!cur) return false;
  if (want === "any" || want === "*") return true;
  return cur === want;
}

function humanBytes(n) {
  const x = Number(n || 0);
  if (x < 1024) return `${x} B`;
  if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KiB`;
  if (x < 1024 * 1024 * 1024) return `${(x / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(x / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.src) {
    throw new Error("Missing source directory. Set --src or FUSOU_BATTLE_DATA_SRC/BATTLE_DATA_SRC");
  }
  const srcRoot = path.resolve(args.src);
  const webDir = path.resolve(args.webDir);

  if (!fs.existsSync(srcRoot)) {
    throw new Error(`Source directory not found: ${srcRoot}`);
  }
  if (!fs.existsSync(path.join(webDir, "wrangler.toml"))) {
    throw new Error(`wrangler.toml not found under --web-dir: ${webDir}`);
  }

  const files = await walkAvro(srcRoot);
  const allPeriods = new Set();
  for (const absPath of files) {
    const rel = path.relative(srcRoot, absPath).split(path.sep).join("/");
    const parsed = parseR2LikeKey(rel);
    if (parsed) allPeriods.add(parsed.periodTag);
  }

  const selectedPeriods = choosePeriods(args.period, allPeriods);
  if (selectedPeriods.length === 0) {
    console.log(JSON.stringify({
      sourceRoot: srcRoot,
      mode: args.apply ? "apply" : "dry-run",
      selectedPeriods: [],
      message: "No period tags selected.",
    }, null, 2));
    return;
  }

  const groups = (await buildPlan(srcRoot, selectedPeriods, args.maxPeriods))
    .map((g) => ({
      ...g,
      files: g.files.filter((f) => isAllowedSourceTier(parseR2LikeKey(f.sourcePath)?.tier, args.sourceTier)),
    }))
    .filter((g) => g.files.length > 0)
    .map((g) => ({
      ...g,
      fileCount: g.files.length,
      runKeys: [...new Set(g.files.map((f) => f.runKey))].sort(),
      runKeyCount: new Set(g.files.map((f) => f.runKey)).size,
      tables: [...new Set(g.files.map((f) => f.tableName))].sort(),
      tableCount: new Set(g.files.map((f) => f.tableName)).size,
      totalBytes: g.files.reduce((acc, f) => acc + Number(f.sizeBytes || 0), 0),
    }));
  const plannedObjects = groups.reduce((acc, g) => acc + g.fileCount, 0);
  const plannedBytes = groups.reduce((acc, g) => acc + g.totalBytes, 0);

  console.log(JSON.stringify({
    sourceRoot: srcRoot,
    webDir,
    sourceTier: args.sourceTier,
    mode: args.apply ? "apply" : "dry-run",
    strictUnit: "period-close",
    selectedPeriods,
    periodGroupCount: groups.length,
    plannedObjects,
    plannedBytes,
    plannedBytesHuman: humanBytes(plannedBytes),
  }, null, 2));

  for (const g of groups) {
    console.log(`- ${g.tableVersion}/${g.periodTag}: files=${g.fileCount}, sourceRunKeys=${g.runKeyCount}, closeRunKey=${g.periodCloseRunKey}, tables=${g.tableCount}, bytes=${humanBytes(g.totalBytes)}`);
  }

  if (!args.apply) {
    console.log("Dry-run only. Use --apply --bucket <name> to upload to R2.");
    return;
  }

  if (!args.bucket) {
    throw new Error("--bucket is required when --apply is set");
  }

  let uploadedObjects = 0;

  for (const g of groups) {
    console.log(`Uploading period-close group: ${g.tableVersion}/${g.periodTag}`);

    for (const file of g.files) {
      const abs = path.join(srcRoot, file.sourcePath);
      wranglerPutObject({
        bucket: args.bucket,
        key: file.targetPath,
        filePath: abs,
        remote: args.remote,
        webDir,
      });
      uploadedObjects += 1;
      if (args.verbose && uploadedObjects % 100 === 0) {
        console.log(`  uploaded objects: ${uploadedObjects}`);
      }
    }
  }

  console.log(JSON.stringify({
    ok: true,
    bucket: args.bucket,
    remote: args.remote,
    uploadedObjects,
    periodGroupCount: groups.length,
    strictUnit: "period-close",
  }, null, 2));
}

main().catch((error) => {
  console.error(String(error?.stack || error?.message || error));
  process.exit(1);
});
