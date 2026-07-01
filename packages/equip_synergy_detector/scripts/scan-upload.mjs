#!/usr/bin/env node
/**
 * Orchestrator: scan → upload
 *
 * Usage:
 *   pnpm scan:upload -- --period-tag 2026-04-07
 *   pnpm scan:upload:dry -- --period-tag 2026-04-07
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import {
  copyFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// pnpm forwards "--" as an argv separator; ignore it so users can pass extra flags normally.
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const knownFlags = new Set(["--period-tag", "--env", "--dry-run", "--force"]);

function readFlagValue(flag) {
  const idx = args.lastIndexOf(flag);
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
  if (arg !== "--dry-run" && arg !== "--force") i += 1;
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

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function readTextFileOrNull(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8").trim();
  } catch {
    return null;
  }
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

  // 3) Deobfuscate when output is missing or main.js content has changed.
  const deobfuscatedPath = join(root, "output", "deobfuscated.js");
  const deobfuscatedMainHashPath = join(
    root,
    "output",
    "deobfuscated.source-main.sha256",
  );
  const currentMainHash = sha256File(targetMain);
  const previousMainHash = readTextFileOrNull(deobfuscatedMainHashPath);
  const needDeobfuscate =
    !existsSync(deobfuscatedPath) ||
    previousMainHash !== currentMainHash;

  let scanWithMain = false;

  if (needDeobfuscate) {
    console.log("[prep] Running deobfuscate (output missing/input changed)...");
    const deobfResult = runNodeScript(join(__dirname, "deobfuscate.js"));
    if (deobfResult.error) {
      console.warn(
        `[prep] Deobfuscate launch error (${deobfResult.error.message}); fallback to main.js for scan.`,
      );
      scanWithMain = true;
    } else if (deobfResult.status !== 0) {
      const reason =
        deobfResult.status != null
          ? `exit=${deobfResult.status}`
          : deobfResult.signal
            ? `signal=${deobfResult.signal}`
            : "unknown";
      console.warn(
        `[prep] Deobfuscate failed (${reason}); fallback to main.js for scan.`,
      );
      scanWithMain = true;
    } else {
      mkdirSync(join(root, "output"), { recursive: true });
      writeFileSync(deobfuscatedMainHashPath, `${currentMainHash}\n`, "utf-8");
    }
  } else {
    console.log(
      "[prep] deobfuscated.js is up-to-date for current main.js hash; skip deobfuscate.",
    );
  }

  if (scanWithMain) {
    console.warn("[prep] scan.js will run with --main for this period.");
  }

  return {
    scanWithMain,
  };
}

console.log(`[prep] Resolving inputs for period-tag=${periodTag}...`);
const prep = prepareInputsFromProxyData(periodTag);

// Step 1: scan
console.log(`[1/2] Scanning with period-tag=${periodTag}...`);
const scanArgs = [
  "--volatile-generated",
  "--period-tag",
  periodTag,
];
if (prep.scanWithMain) scanArgs.unshift("--main");
const scanResult = runNodeScript(join(__dirname, "scan.js"), scanArgs);
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
if (args.includes("--force")) uploadArgs.push("--force");

const uploadResult = spawnSync(process.execPath, uploadArgs, {
  stdio: "inherit",
  cwd: join(root, "..", "FUSOU-WEB"),
});
process.exit(uploadResult.status ?? 0);
