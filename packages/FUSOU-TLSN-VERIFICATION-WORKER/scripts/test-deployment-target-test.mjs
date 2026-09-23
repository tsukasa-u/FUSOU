#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertCanonicalTestWorkerName,
  TEST_WORKER_NAME,
} from "./test-deployment-target.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const deployTest = await readFile(resolve(packageDirectory, "scripts/deploy-test.mjs"), "utf8");
const verifierTestWrangler = await readFile(resolve(packageDirectory, "wrangler.verifier-test.toml"), "utf8");

assert.doesNotThrow(() => assertCanonicalTestWorkerName(TEST_WORKER_NAME));
for (const workerName of [
  "fusou-tlsn-verification-production",
  "fusou-tlsn-verification-test-arbitrary",
  "",
]) {
  assert.throws(
    () => assertCanonicalTestWorkerName(workerName),
    /DENIED:.*canonical Test Worker identity/,
  );
}

assert.match(deployTest, /assertCanonicalTestWorkerName\(/);
assert.match(deployTest, /"--env", "test"/);
assert.match(deployTest, /"--name", workerName/);
assert.match(verifierTestWrangler, /name = "fusou-tlsn-verifier-test"/);
assert.match(verifierTestWrangler, /script_name = "fusou-tlsn-verification-test"/);

console.log("[tlsn-test-deployment-target] canonical, denied, and test topology checks PASS");
