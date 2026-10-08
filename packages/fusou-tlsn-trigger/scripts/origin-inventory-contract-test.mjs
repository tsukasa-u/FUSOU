import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertTaskOriginInventoryDigest,
  assertTaskTargetApprovalDigest,
  assertTriggerInventoryArtifactDigest,
  originInventoryArtifactRawSha256,
} from "../src/trigger/origin-inventory-contract.mjs";

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
const artifactRawSha256 = originInventoryArtifactRawSha256(triggerBytes);

const source = await readFile(resolve(triggerPackageRoot, "src/trigger/tlsn-verification-task.ts"), "utf8");
const triggerConfig = await readFile(resolve(triggerPackageRoot, "trigger.config.ts"), "utf8");
assert.match(source, /const relativePath = "configs\/tlsn-origin-inventory\.json\.txt"/);
assert.match(source, /assertTriggerInventoryArtifactDigest\(/);
assert.match(source, /origin_inventory_artifact_raw_sha256:/);
assert.match(triggerConfig, /\.\.\/configs\/tlsn-origin-inventory\.json\.txt/);
assert.match(triggerConfig, /originInventoryArtifactRawSha256\(/);
assert.match(source, /assertTaskTargetApprovalDigest\(/);
assert.match(source, /parseTargetApproval\(/);
assert.match(source, /resolveApprovedProductionIdentity\(/);
assert.match(triggerConfig, /\.\.\/configs\/tlsn-target-approval\.json/);

const taskDigest = originInventoryArtifactRawSha256(workerBytes);
const triggerRuntimeDigest = originInventoryArtifactRawSha256(triggerBytes);
assert.equal(artifactRawSha256, triggerRuntimeDigest, "deployment artifact metadata must hash the exact raw inventory bytes");
assert.equal(assertTaskOriginInventoryDigest(taskDigest, triggerRuntimeDigest), triggerRuntimeDigest);
assert.equal(assertTriggerInventoryArtifactDigest(triggerRuntimeDigest, triggerRuntimeDigest), triggerRuntimeDigest);
assert.equal(
  originInventoryArtifactRawSha256(Buffer.concat([triggerBytes, Buffer.from("\n")])) === triggerRuntimeDigest,
  false,
  "inventory artifact digest must bind raw bytes, including whitespace",
);

const mutatedTriggerBytes = Buffer.from(triggerBytes);
mutatedTriggerBytes[0] ^= 1;
const mutatedTriggerDigest = originInventoryArtifactRawSha256(mutatedTriggerBytes);
assert.throws(
  () => assertTaskOriginInventoryDigest(taskDigest, mutatedTriggerDigest),
  /does not match Trigger runtime inventory/,
);
assert.throws(
  () => assertTriggerInventoryArtifactDigest(triggerRuntimeDigest, mutatedTriggerDigest),
  /artifact raw SHA-256 does not match runtime inventory bytes/,
);

const approvalBytes = await readFile(resolve(triggerPackageRoot, "../configs/tlsn-target-approval.json"));
const approvalDigest = originInventoryArtifactRawSha256(approvalBytes);
assert.equal(assertTaskTargetApprovalDigest(approvalDigest, approvalDigest), approvalDigest);
assert.throws(
  () => assertTaskTargetApprovalDigest(undefined, approvalDigest),
  /Target Approval digest does not match/,
);
assert.throws(
  () => assertTaskTargetApprovalDigest(approvalDigest, originInventoryArtifactRawSha256(Buffer.concat([approvalBytes, Buffer.from("\n")]))),
  /Target Approval digest does not match/,
);

console.info("Trigger inventory byte parity and task-digest mismatch tests passed");
