#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertCanonicalCanaryWorkerName,
  CANARY_BOOTSTRAP_WORKER_NAME,
  CANARY_VERIFIER_WORKER_NAME,
  CANARY_WORKER_NAME,
} from "./canary-deployment-target.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const canaryWrapper = await readFile(resolve(packageDirectory, "scripts/deploy-canary.mjs"), "utf8");
const verifierWrangler = await readFile(resolve(packageDirectory, "wrangler.verifier-canary.toml"), "utf8");

assert.doesNotThrow(() => assertCanonicalCanaryWorkerName(CANARY_WORKER_NAME));
for (const workerName of [
  "fusou-tlsn-verification-production",
  "fusou-tlsn-verification-canary-arbitrary",
  "",
  "fusou-tlsn-verification-canary-2026",
]) {
  assert.throws(
    () => assertCanonicalCanaryWorkerName(workerName),
    /DENIED:.*canonical Canary Worker identity/,
  );
}

assert.match(canaryWrapper, /assertCanonicalCanaryWorkerName\(process\.env\.TLSN_CANARY_WORKER_NAME\?\.trim\(\)\)/);
assert.match(canaryWrapper, /"--name", CANARY_WORKER_NAME/);
assert.match(canaryWrapper, /"--name", CANARY_BOOTSTRAP_WORKER_NAME/);
assert.match(canaryWrapper, /"--name", CANARY_VERIFIER_WORKER_NAME/);
assert.doesNotMatch(canaryWrapper, /--name", workerName/);
assert.doesNotMatch(canaryWrapper, /script_name = "\$\{workerName\}"/);
assert.ok(
  canaryWrapper.indexOf("  assertCanonicalCanaryWorkerName(process.env.TLSN_CANARY_WORKER_NAME?.trim());") < canaryWrapper.indexOf("build:wasm"),
  "canonical target denial must precede build",
);
assert.ok(
  canaryWrapper.indexOf("  assertCanonicalCanaryWorkerName(process.env.TLSN_CANARY_WORKER_NAME?.trim());") < canaryWrapper.indexOf("const secretDirectory = await mkdtemp("),
  "canonical target denial must precede secret directory creation",
);
assert.match(verifierWrangler, /name = "fusou-tlsn-verifier-canary"/);
assert.match(verifierWrangler, /script_name = "fusou-tlsn-verification-canary"/);
assert.equal(CANARY_BOOTSTRAP_WORKER_NAME, "fusou-tlsn-verification-canary-bootstrap");
assert.equal(CANARY_VERIFIER_WORKER_NAME, "fusou-tlsn-verifier-canary");

console.log("[tlsn-canary-deployment-target] canonical, denied, and pre-deploy target checks PASS");