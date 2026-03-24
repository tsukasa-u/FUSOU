#!/usr/bin/env node

import { execSync } from "node:child_process";

const TARGET_PREFIX = "src/";
const FORBIDDEN = /\.innerHTML\s*=/;
const ALLOW_MARKER = "safe-innerhtml";

function getDiffText() {
  try {
    return execSync(
      "git diff --unified=0 --no-color HEAD~1 HEAD -- src",
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    const output = String(error?.stdout || "");
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
  console.error("[check-security-dom] New innerHTML assignment detected in added lines.");
  console.error(
    "Use textContent/createElement or sanitize and annotate with 'safe-innerhtml' when unavoidable.",
  );
  for (const v of violations) {
    console.error(`- ${v.file}: ${v.line}`);
  }
  process.exit(1);
}

console.log("[check-security-dom] OK: no new unsafe innerHTML assignment in added lines.");
