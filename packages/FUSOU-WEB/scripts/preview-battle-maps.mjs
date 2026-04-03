#!/usr/bin/env node

import { spawnSync } from "child_process";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const syncScript = resolve(__dirname, "sync-battle-maps.mjs");

const result = spawnSync(
  process.execPath,
  [syncScript, "--preview-only", ...process.argv.slice(2)],
  {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
