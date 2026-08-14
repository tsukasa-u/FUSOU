#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TARGET_PREFIX = "packages/FUSOU-WEB/src/";
const FORBIDDEN = /\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(|dangerouslySetInnerHTML\s*=/;
const ALLOW_MARKER = "safe-innerhtml";
const DIFF_RANGE =
  process.env.SECURITY_DOM_DIFF_RANGE ?? process.argv[2] ?? "HEAD~1..HEAD";

function getDiffText() {
  try {
    const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const targetPath = relative(repoRoot, resolve(PACKAGE_ROOT, "src"));
    return execFileSync(
      "git",
      ["diff", "--unified=0", "--no-color", DIFF_RANGE, "--", targetPath],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const output = String(error?.stdout ?? "");
    if (output) return output;

    console.warn(
      "[check-security-dom] Unable to read git diff (shallow or no git metadata). Skipping incremental DOM security check.",
    );
    return "";
  }
}

const diff = getDiffText();
if (!diff) {
  process.exit(0);
}

let currentFile = "";
const violations = [];
const lines = diff.split("\n");

for (const line of lines) {
  if (line.startsWith("+++ b/")) {
    const next = line.slice(6).trim();
    currentFile = next;
    continue;
  }

  if (!currentFile || !currentFile.startsWith(TARGET_PREFIX)) {
    continue;
  }

  if (!line.startsWith("+") || line.startsWith("+++")) {
    continue;
  }

  const added = line.slice(1);
  if (!FORBIDDEN.test(added)) {
    continue;
  }

  if (added.includes(ALLOW_MARKER)) {
    continue;
  }

  violations.push({ file: currentFile, line: added.trim() });
}

if (violations.length > 0) {
  console.error("[check-security-dom] New unsafe DOM HTML sink detected in added lines.");
  console.error(
    "Use textContent/createElement or sanitize and annotate with 'safe-innerhtml' when unavoidable.",
  );
  for (const v of violations) {
    console.error(`- ${v.file}: ${v.line}`);
  }
  process.exit(1);
}

console.log("[check-security-dom] OK: no new unsafe innerHTML assignment in added lines.");
