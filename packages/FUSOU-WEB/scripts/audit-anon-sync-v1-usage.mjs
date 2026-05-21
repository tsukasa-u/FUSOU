#!/usr/bin/env node
/**
 * audit-anon-sync-v1-usage.mjs
 *
 * Audits legacy v1 anonymous-sync references that must be removed in P7.
 * This script is read-only and does not modify files.
 *
 * Usage:
 *   node scripts/audit-anon-sync-v1-usage.mjs
 *   node scripts/audit-anon-sync-v1-usage.mjs --json
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { extname, join, relative, resolve } from "path";

const repoRoot = resolve(process.cwd(), "../..");

const scanRoots = [
  join(repoRoot, "packages", "FUSOU-WEB", "src"),
  join(repoRoot, "packages", "FUSOU-APP", "src-tauri", "src"),
  join(repoRoot, "packages", "fusou-auth", "src"),
  join(repoRoot, "packages", "kc_api", "crates"),
];

const includeExt = new Set([".ts", ".tsx", ".js", ".mjs", ".rs", ".astro", ".sql"]);
const ignorePathPart = [
  "node_modules",
  "target",
  "dist",
  ".astro",
  ".wrangler",
  "storybook-static",
  "__pycache__",
];

const checks = [
  {
    id: "v1-route-path",
    pattern: /\/anonymous-sync(?=\/(?!v2)|$|[?#"'])/g,
    description: "Legacy v1 endpoint path",
    severity: "critical",
  },
  {
    id: "v1-method-get-or-refresh",
    pattern: /get_or_refresh_anonymous_session\s*\(/g,
    description: "Legacy fusou-auth v1 API call",
    severity: "critical",
  },
  {
    id: "v1-method-ensure-valid",
    pattern: /ensure_dataset_token_valid\s*\(/g,
    description: "Legacy fusou-auth v1 API call",
    severity: "critical",
  },
  {
    id: "legacy-member-id-hash-name",
    pattern: /member_id_hash/g,
    description: "Legacy naming; confirm context is still needed",
    severity: "info",
  },
];

const allowByPath = [
  /packages\\FUSOU-WEB\\src\\server\\routes\\anonymous-sync\.ts$/,
  /packages\\fusou-auth\\src\\manager\.rs$/,
  /packages\\FUSOU-WEB\\src\\server\\routes\\anonymous-sync-v2\.ts$/,
  /packages\\FUSOU-WEB\\src\\pages\\auth\\local\\signin\.astro$/,
  /packages\\FUSOU-WEB\\src\\pages\\api\\local_auth\\signin\.ts$/,
  /packages\\FUSOU-WEB\\src\\pages\\api\\local_auth\\callback\.ts$/,
  /packages\\FUSOU-WEB\\src\\pages\\auth\\local\\callback\.astro$/,
  /packages\\FUSOU-WEB\\src\\pages\\account\\conflict\.astro$/,
  /packages\\FUSOU-WEB\\src\\server\\utils\.ts$/,
  /packages\\FUSOU-WEB\\src\\server\\routes\\member-lookup\.ts$/,
  /packages\\FUSOU-WEB\\src\\server\\routes\\user\.ts$/,
  /packages\\FUSOU-WEB\\src\\server\\routes\\fleet\.ts$/,
  /packages\\FUSOU-WEB\\src\\server\\routes\\data_loader\.ts$/,
  /packages\\FUSOU-WEB\\src\\server\\utils\\supabase-rest\.ts$/,
  /packages\\FUSOU-WEB\\src\\lib\\realtime-sync\.ts$/,
  /packages\\FUSOU-WEB\\src\\components\\solid\\MemberIdSyncButton\.tsx$/,
  /packages\\FUSOU-APP\\src-tauri\\src\\auth\\member_id_cache\.rs$/,
  /packages\\FUSOU-APP\\src-tauri\\src\\auth\\auth_server\.rs$/,
  /packages\\FUSOU-APP\\src-tauri\\src\\builder_setup\\single_instance\.rs$/,
  /packages\\FUSOU-WEB\\src\\server\\app\.ts$/,
];

function shouldIgnore(path) {
  return ignorePathPart.some((part) => path.includes(part));
}

function walk(dir, out = []) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    if (shouldIgnore(full)) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (includeExt.has(extname(full))) {
      out.push(full);
    }
  }
  return out;
}

function lineNumberFromIndex(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function isAllowListed(absPath) {
  return allowByPath.some((re) => re.test(absPath));
}

function findHits(path) {
  const text = readFileSync(path, "utf8");
  const hits = [];

  for (const check of checks) {
    check.pattern.lastIndex = 0;
    let m;
    while ((m = check.pattern.exec(text)) !== null) {
      const line = lineNumberFromIndex(text, m.index);
      const lines = text.split("\n");
      const snippet = (lines[line - 1] || "").trim();
      hits.push({
        checkId: check.id,
        description: check.description,
        severity: check.severity,
        line,
        snippet,
      });
    }
  }

  return hits;
}

function main() {
  const jsonMode = process.argv.includes("--json");

  const files = scanRoots.flatMap((d) => walk(d));
  const allHits = [];

  for (const file of files) {
    const hits = findHits(file);
    if (hits.length === 0) continue;
    const rel = relative(repoRoot, file).replaceAll("\\", "/");
    allHits.push({
      file,
      rel,
      allowListed: isAllowListed(file),
      hits,
    });
  }

  const actionable = allHits
    .filter((h) => !h.allowListed)
    .map((f) => ({
      ...f,
      hits: f.hits.filter((h) => h.severity === "critical"),
    }))
    .filter((f) => f.hits.length > 0);

  const informational = allHits
    .map((f) => ({
      ...f,
      hits: f.hits.filter((h) => h.severity === "info"),
    }))
    .filter((f) => f.hits.length > 0);

  const summary = {
    scannedFiles: files.length,
    filesWithHits: allHits.length,
    allowListedFilesWithHits: allHits.length - actionable.length,
    actionableFiles: actionable.length,
    informationalFiles: informational.length,
  };

  if (jsonMode) {
    const payload = {
      summary,
      actionable: actionable.map((f) => ({ rel: f.rel, hits: f.hits })),
      informational: informational.map((f) => ({ rel: f.rel, hitCount: f.hits.length })),
      allowListed: allHits
        .filter((f) => f.allowListed)
        .map((f) => ({ rel: f.rel, hitCount: f.hits.length })),
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(actionable.length === 0 ? 0 : 2);
  }

  console.log("=== v1 Anonymous-Sync Usage Audit ===");
  console.log(`Scanned files: ${summary.scannedFiles}`);
  console.log(`Files with hits: ${summary.filesWithHits}`);
  console.log(`Allowlisted files with hits: ${summary.allowListedFilesWithHits}`);
  console.log(`Actionable files: ${summary.actionableFiles}`);
  console.log(`Informational files: ${summary.informationalFiles}`);

  if (actionable.length > 0) {
    console.log("\nActionable hits (needs cleanup before P7):");
    for (const file of actionable) {
      console.log(`\n- ${file.rel}`);
      for (const hit of file.hits.slice(0, 10)) {
        console.log(`  [${hit.checkId}] L${hit.line}: ${hit.snippet}`);
      }
      if (file.hits.length > 10) {
        console.log(`  ... and ${file.hits.length - 10} more`);
      }
    }
    process.exit(2);
  }

  if (informational.length > 0) {
    console.log("\nInformational hits (non-blocking terminology/compat notes):");
    for (const file of informational.slice(0, 20)) {
      console.log(`- ${file.rel}: ${file.hits.length}`);
    }
  }

  console.log("\nNo actionable v1 references found outside allowlist.");
}

main();
