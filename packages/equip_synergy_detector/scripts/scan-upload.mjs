#!/usr/bin/env node
/**
 * Orchestrator: scan → upload
 *
 * Usage:
 *   pnpm scan:upload -- --period-tag 2026-04-07
 *   pnpm scan:upload:dry -- --period-tag 2026-04-07
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import {
  copyFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const args = process.argv.slice(2);
const knownFlags = new Set(["--period-tag", "--env", "--dry-run"]);

function readFlagValue(flag) {
  const idx = args.indexOf(flag);
  if (idx < 0) return null;
  const value = args[idx + 1];
  if (!value || value.startsWith("--")) {
    console.error(`Error: ${flag} requires a value.`);
    process.exit(1);
  }
  return value;
}

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (!arg.startsWith("--")) {
    console.error(`Error: unexpected argument: ${arg}`);
    process.exit(1);
  }
  if (!knownFlags.has(arg)) {
    console.error(`Error: unknown option: ${arg}`);
    process.exit(1);
  }
  if (arg !== "--dry-run") i += 1;
}

const periodTag = readFlagValue("--period-tag");
const isDryRun = args.includes("--dry-run");
const env = readFlagValue("--env") ?? "production";

if (!periodTag) {
  console.error("Error: --period-tag YYYY-MM-DD is required.");
  console.error("  e.g. pnpm scan:upload -- --period-tag 2026-04-07");
  process.exit(1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(periodTag)) {
  console.error(`Error: --period-tag must be YYYY-MM-DD, got: ${periodTag}`);
  process.exit(1);
}

if (env !== "production" && env !== "development") {
  console.error(
    `Error: --env must be one of: production, development. got: ${env}`,
  );
  process.exit(1);
}

function runNodeScript(scriptPath, scriptArgs = []) {
  return spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    stdio: "inherit",
    cwd: root,
  });
}

function findLatestApiStart2GetData(kcsapiDir) {
  const files = readdirSync(kcsapiDir)
    .flatMap((name) => {
      if (!name.includes("@api_start2@getData")) return [];
      const fullPath = join(kcsapiDir, name);
      try {
        const stat = statSync(fullPath);
        if (!stat.isFile()) return [];
        return [
          {
            name,
            fullPath,
            mtimeMs: stat.mtimeMs,
          },
        ];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.length > 0 ? files[0].fullPath : null;
}

function prepareInputsFromProxyData(periodTagValue) {
  const periodDir = join(root, "..", "FUSOU-PROXY-DATA", periodTagValue);
  if (!existsSync(periodDir)) {
    console.error(`Error: period directory not found: ${periodDir}`);
    console.error(
      "  Confirm --period-tag and that proxy data has been captured for that period.",
    );
    process.exit(1);
  }

  // 1) main.js: always sync from proxy capture for the selected period.
  const sourceMain = join(periodDir, "kcs2", "js", "main.js");
  const targetMain = join(root, "main.js");
  if (!existsSync(sourceMain)) {
    console.error(`Error: main.js not found in proxy data: ${sourceMain}`);
    process.exit(1);
  }
  copyFileSync(sourceMain, targetMain);
  console.log(`[prep] main.js synced: ${sourceMain}`);

  // 2) api_start2@getData: copy latest file into master_data/ for scan.js.
  const kcsapiDir = join(periodDir, "kcsapi");
  if (!existsSync(kcsapiDir)) {
    console.error(`Error: kcsapi directory not found: ${kcsapiDir}`);
    process.exit(1);
  }
  const latestApiStart2 = findLatestApiStart2GetData(kcsapiDir);
  if (!latestApiStart2) {
    console.error(
      `Error: no *@api_start2@getData* file found under: ${kcsapiDir}`,
    );
    process.exit(1);
  }
  const masterDataDir = join(root, "master_data");
  mkdirSync(masterDataDir, { recursive: true });

  // Remove stale api_start2 files so scan.js always reads the intended period input.
  for (const name of readdirSync(masterDataDir)) {
    if (!name.includes("api_start2")) continue;
    const stalePath = join(masterDataDir, name);
    try {
      if (!statSync(stalePath).isFile()) continue;
      unlinkSync(stalePath);
    } catch (err) {
      if (err?.code === "ENOENT") continue;
      console.error(
        `Error: failed to remove stale master_data file ${name}: ${err?.message || err}`,
      );
      process.exit(1);
    }
  }

  const targetApiStart2 = join(masterDataDir, basename(latestApiStart2));
  copyFileSync(latestApiStart2, targetApiStart2);
  console.log(`[prep] master_data synced: ${latestApiStart2}`);

  // 3) Deobfuscate only when needed (missing or older than main.js).
  const deobfuscatedPath = join(root, "output", "deobfuscated.js");
  const needDeobfuscate =
    !existsSync(deobfuscatedPath) ||
    statSync(sourceMain).mtimeMs > statSync(deobfuscatedPath).mtimeMs;

  if (needDeobfuscate) {
    console.log("[prep] Running deobfuscate (output missing/stale)...");
    const deobfResult = runNodeScript(join(__dirname, "deobfuscate.js"));
    if (deobfResult.status !== 0) process.exit(deobfResult.status ?? 1);
  } else {
    console.log("[prep] deobfuscated.js is up-to-date; skip deobfuscate.");
  }
}

console.log(`[prep] Resolving inputs for period-tag=${periodTag}...`);
prepareInputsFromProxyData(periodTag);

// Step 1: scan
console.log(`[1/2] Scanning with period-tag=${periodTag}...`);
const scanResult = runNodeScript(join(__dirname, "scan.js"), [
  "--volatile-generated",
  "--period-tag",
  periodTag,
]);
if (scanResult.status !== 0) process.exit(scanResult.status ?? 1);

// Step 2: upload
console.log(`[2/2] Uploading (env=${env}${isDryRun ? ", dry-run" : ""})...`);
const uploadArgs = [
  join(root, "..", "FUSOU-WEB", "scripts", "upload-synergy.mjs"),
  "--env",
  env,
  "--period-tag",
  periodTag,
];
if (isDryRun) uploadArgs.push("--dry-run");

const uploadResult = runNodeScript(uploadArgs[0], uploadArgs.slice(1));
process.exit(uploadResult.status ?? 0);
