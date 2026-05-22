#!/usr/bin/env node
/**
 * audit-anon-sync-v1-usage.mjs
 *
 * Audits legacy v1 anonymous-sync references that must not exist
 * in the current v2-fixed codebase.
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
  join(repoRoot, "packages", "FUSOU-PROXY", "proxy-https", "src"),
  join(repoRoot, "packages", "fusou-upload", "src"),
  join(repoRoot, "packages", "fusou-auth", "src"),
  join(repoRoot, "packages", "configs", "src"),
  join(repoRoot, "packages", "FUSOU-APP", "src-tauri"),
  join(repoRoot, "packages", "fusou-auth"),
  join(repoRoot, "packages", "configs"),
  join(repoRoot, "packages", "kc_api", "crates"),
];

const includeExt = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".rs",
  ".astro",
  ".sql",
  ".toml",
]);
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
    pattern: /(?<=["'])\/anonymous-sync(?=\/(?!v2)|$|[?#"'])/g,
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
    id: "legacy-feature-flag",
    pattern: /legacy-anonymous-sync-v1/g,
    description: "Legacy anonymous-sync feature flag",
    severity: "critical",
  },
  {
    id: "legacy-config-endpoint",
    pattern: /\banonymous_sync_endpoint\b/g,
    description: "Legacy anonymous-sync v1 endpoint config key",
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

  const files = [...new Set(scanRoots.flatMap((d) => walk(d)))];
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

  const allowListed = allHits.filter((f) => f.allowListed);

  const informational = allHits
    .map((f) => ({
      ...f,
      hits: f.hits.filter((h) => h.severity === "info"),
    }))
    .filter((f) => f.hits.length > 0);

  const summary = {
    scannedFiles: files.length,
    filesWithHits: allHits.length,
    allowListedFilesWithHits: allowListed.length,
    actionableFiles: actionable.length,
    informationalFiles: informational.length,
  };

  if (jsonMode) {
    const payload = {
      summary,
      actionable: actionable.map((f) => ({ rel: f.rel, hits: f.hits })),
      informational: informational.map((f) => ({
        rel: f.rel,
        hitCount: f.hits.length,
      })),
      allowListed: allowListed.map((f) => ({
        rel: f.rel,
        hitCount: f.hits.length,
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(actionable.length === 0 ? 0 : 2);
  }

  console.log("=== v1 Anonymous-Sync Usage Audit ===");
  console.log(`Scanned files: ${summary.scannedFiles}`);
  console.log(`Files with hits: ${summary.filesWithHits}`);
  console.log(
    `Allowlisted files with hits: ${summary.allowListedFilesWithHits}`,
  );
  console.log(`Actionable files: ${summary.actionableFiles}`);
  console.log(`Informational files: ${summary.informationalFiles}`);

  if (actionable.length > 0) {
    console.log("\nActionable hits (must be cleaned in v2-fixed mode):");
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
    console.log(
      "\nInformational hits (non-blocking terminology/compat notes):",
    );
    for (const file of informational.slice(0, 20)) {
      console.log(`- ${file.rel}: ${file.hits.length}`);
    }
  }

  console.log("\nNo actionable legacy v1 references found outside allowlist.");
}

main();
