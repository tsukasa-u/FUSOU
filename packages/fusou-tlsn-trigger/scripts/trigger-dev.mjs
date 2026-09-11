#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const projectRef = String(process.env.TRIGGER_PROJECT_REF || "").trim();
const forwardedArgs = process.argv.slice(2);
const normalizedArgs = forwardedArgs[0] === "--" ? forwardedArgs.slice(1) : forwardedArgs;

if (!projectRef) {
  console.error("Missing TRIGGER_PROJECT_REF in environment.");
  process.exit(1);
}

if (projectRef.startsWith("encrypted:")) {
  console.error("TRIGGER_PROJECT_REF is still encrypted. Run this script through dotenvx so the env is decrypted first.");
  process.exit(1);
}

const result = spawnSync(
  "./node_modules/.bin/trigger",
  ["dev", "start", "--project-ref", projectRef, ...normalizedArgs],
  {
    stdio: "inherit",
    env: process.env,
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
