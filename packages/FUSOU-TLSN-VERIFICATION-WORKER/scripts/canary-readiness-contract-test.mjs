#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { CANARY_TLSN_ARCHITECTURE } from "./canary-external-input-intake.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const readinessPath = resolve(packageDirectory, "scripts/canary-readiness-test.mjs");
const result = spawnSync(process.execPath, [readinessPath], {
  cwd: packageDirectory,
  encoding: "utf8",
  env: {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
  },
});

assert.equal(result.status, 0, result.stderr);
const report = JSON.parse(result.stdout);
assert.equal(report.network_access, "NOT_USED");
assert.equal(report.deployment_executed, false);
assert.equal(report.inputs.remote_validation.status, "POST_DEPLOYMENT_ONLY");
assert.ok(Object.values(report.inputs.remote_validation.fields).every((status) => status.endsWith("POST_DEPLOYMENT")));
assert.ok(!report.missing_inputs.some((name) => name.startsWith("TLSN_REMOTE_")));
assert.ok(report.input_diagnostics
  .filter((entry) => entry.phase === "REMOTE_VALIDATION_ONLY")
  .every((entry) => entry.status.endsWith("POST_DEPLOYMENT")));
assert.equal(CANARY_TLSN_ARCHITECTURE.live_verifier.status, "NOT_IMPLEMENTED");
assert.equal(CANARY_TLSN_ARCHITECTURE.delegated_notary.current_presentation_path, "REQUIRED");

console.log("[tlsn-canary-readiness-contract] remote validation boundary and live-verifier status PASS");