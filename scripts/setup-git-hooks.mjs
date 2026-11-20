#!/usr/bin/env node

import { chmodSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

if (process.env.CI || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_PAGES) {
  process.exit(0);
}

if (!existsSync(resolve(REPO_ROOT, ".git"))) {
  process.exit(0);
}

const preCommitHook = resolve(REPO_ROOT, ".githooks/pre-commit");
if (existsSync(preCommitHook) && process.platform !== "win32") {
  try {
    chmodSync(preCommitHook, 0o755);
  } catch {
    // ignore permission errors
  }
}

const result = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
  cwd: REPO_ROOT,
  stdio: "inherit",
});

if (result.error || (typeof result.status === "number" && result.status !== 0)) {
  console.warn("[setup-git-hooks] Could not configure core.hooksPath (.githooks).");
}
