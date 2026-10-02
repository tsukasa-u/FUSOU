import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertTaskOriginInventoryDigest } from "../src/trigger/origin-inventory-contract.mjs";

const triggerPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerPackageRoot = resolve(triggerPackageRoot, "../FUSOU-TLSN-VERIFICATION-WORKER");
const canonicalInventoryPath = resolve(triggerPackageRoot, "../configs/tlsn-origin-inventory.json");
const workerInventoryPath = resolve(workerPackageRoot, "../configs/tlsn-origin-inventory.json.txt");
const triggerInventoryPath = resolve(triggerPackageRoot, "../configs/tlsn-origin-inventory.json.txt");
const [canonicalBytes, workerBytes, triggerBytes] = await Promise.all([
  readFile(canonicalInventoryPath),
  readFile(workerInventoryPath),
  readFile(triggerInventoryPath),
]);

assert.deepEqual(workerBytes, canonicalBytes, "Worker text-module inventory must match canonical inventory bytes");
assert.deepEqual(triggerBytes, canonicalBytes, "Trigger runtime inventory must match canonical inventory bytes");

const source = await readFile(resolve(triggerPackageRoot, "src/trigger/tlsn-verification-task.ts"), "utf8");
const triggerConfig = await readFile(resolve(triggerPackageRoot, "trigger.config.ts"), "utf8");
assert.match(source, /const relativePath = "configs\/tlsn-origin-inventory\.json\.txt"/);
assert.match(triggerConfig, /\.\.\/configs\/tlsn-origin-inventory\.json\.txt/);

const taskDigest = createHash("sha256").update(workerBytes).digest("base64url");
const triggerRuntimeDigest = createHash("sha256").update(triggerBytes).digest("base64url");
assert.equal(assertTaskOriginInventoryDigest(taskDigest, triggerRuntimeDigest), triggerRuntimeDigest);

const mutatedTriggerBytes = Buffer.from(triggerBytes);
mutatedTriggerBytes[0] ^= 1;
const mutatedTriggerDigest = createHash("sha256").update(mutatedTriggerBytes).digest("base64url");
assert.throws(
  () => assertTaskOriginInventoryDigest(taskDigest, mutatedTriggerDigest),
  /does not match Trigger runtime inventory/,
);

console.info("Trigger inventory byte parity and task-digest mismatch tests passed");