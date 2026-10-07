#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertTargetApprovalProvenance,
  evaluateTargetApproval,
  serializeTargetApprovalRecord,
} from "./target-approval-contract.mjs";

const packageDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const inventoryBytes = readFileSync(resolve(packageDirectory, "../configs/tlsn-origin-inventory.json"));
const approvalBytes = readFileSync(resolve(packageDirectory, "../configs/tlsn-target-approval.json"));
const inventory = JSON.parse(inventoryBytes.toString("utf8"));
const approval = JSON.parse(approvalBytes.toString("utf8"));
const candidateIdentity = inventory.targets[0].server_identity;
const inventoryDigest = (bytes) => createHash("sha256").update(bytes).digest("base64url");
const approvalFor = ({
  targets = approval.targets,
  status = "APPROVED",
  environment = "production",
  inventoryHash = inventoryDigest(inventoryBytes),
  approvedAt = approval.approved_at,
} = {}) => Buffer.from(serializeTargetApprovalRecord({
  ...approval,
  status,
  environment,
  inventory_sha256: inventoryHash,
  targets,
  approved_at: approvedAt,
}), "utf8");
const verify = (identity, options = {}) => evaluateTargetApproval({
  candidateIdentity: identity,
  environment: "production",
  requireCandidate: true,
  inventoryBytes,
  approvalBytes,
  ...options,
});

assert.equal(verify(candidateIdentity).status, "APPROVED");
assert.equal(verify(candidateIdentity).record_status, "APPROVED");

const mutatedInventoryBytes = Buffer.concat([inventoryBytes, Buffer.from("\n")]);
assert.equal(verify(candidateIdentity, { inventoryBytes: mutatedInventoryBytes }).status, "INVALID");
assert.match(verify(candidateIdentity, { inventoryBytes: mutatedInventoryBytes }).reason, /inventory SHA-256/);

const removedInventory = {
  ...inventory,
  targets: inventory.targets.map((target, index) => index === 0
    ? { ...target, server_identity: "replacement.kancolle-server.com" }
    : target),
};
const removedInventoryBytes = Buffer.from(`${JSON.stringify(removedInventory, null, 2)}\n`);
const approvalWithRemovedTarget = approvalFor({ inventoryHash: inventoryDigest(removedInventoryBytes) });
assert.equal(verify(candidateIdentity, { inventoryBytes: removedInventoryBytes, approvalBytes: approvalWithRemovedTarget }).status, "INVALID");
assert.match(verify(candidateIdentity, { inventoryBytes: removedInventoryBytes, approvalBytes: approvalWithRemovedTarget }).reason, /absent from the current/);

const partialApproval = approvalFor({ targets: [candidateIdentity] });
const secondInventoryIdentity = inventory.targets[1].server_identity;
assert.equal(verify(secondInventoryIdentity, { approvalBytes: partialApproval }).status, "IN_INVENTORY_NOT_APPROVED");
assert.equal(verify("unlisted.kancolle-server.com").status, "NOT_IN_INVENTORY");
assert.equal(verify("game.example.test").status, "FIXTURE_OR_SYNTHETIC");
assert.equal(verify("synthetic.kancolle-server.com").status, "FIXTURE_OR_SYNTHETIC");

const revokedApproval = approvalFor({ status: "REVOKED" });
assert.equal(verify(candidateIdentity, { approvalBytes: revokedApproval }).status, "INVALID");
assert.match(verify(candidateIdentity, { approvalBytes: revokedApproval }).reason, /status is not APPROVED/);

const canaryEnvironmentApproval = approvalFor({ environment: "canary" });
assert.equal(verify(candidateIdentity, { approvalBytes: canaryEnvironmentApproval }).status, "INVALID");
assert.match(verify(candidateIdentity, { approvalBytes: canaryEnvironmentApproval }).reason, /environment does not match/);

const duplicateApproval = approvalFor({ targets: [candidateIdentity, candidateIdentity] });
assert.equal(verify(candidateIdentity, { approvalBytes: duplicateApproval }).status, "INVALID");
assert.match(verify(candidateIdentity, { approvalBytes: duplicateApproval }).reason, /duplicates/);

for (const malformed of ["https://server.example.com", "UPPER.kancolle-server.com", "server.example.com:443", "127.0.0.1"]) {
  assert.equal(verify(malformed).status, "INVALID", malformed);
}
assert.equal(verify(undefined).status, "MISSING");
assert.equal(verify(undefined, { requireCandidate: false }).status, "APPROVED");

const approvalArtifactSha256 = createHash("sha256").update(approvalBytes).digest("base64url");
const approvalProvenance = {
  authority_model: approval.authority_model,
  status: approval.status,
  environment: approval.environment,
  inventory_sha256: approval.inventory_sha256,
  approval_artifact_sha256: approvalArtifactSha256,
  approved_target_identity: null,
  approved_target_identities: approval.targets,
};
assert.equal(assertTargetApprovalProvenance(approvalProvenance, { role: "production" }), true);
const changedApprovalBytes = approvalFor({ approvedAt: "2026-10-07T04:48:08Z" });
const changedApprovalDecision = evaluateTargetApproval({
  candidateIdentity,
  environment: "production",
  requireCandidate: true,
  inventoryBytes,
  approvalBytes: changedApprovalBytes,
  expectedApprovalArtifactSha256: approvalArtifactSha256,
});
assert.equal(changedApprovalDecision.status, "INVALID");
assert.match(changedApprovalDecision.reason, /artifact SHA-256/);

const certificateFreeApproval = verify(candidateIdentity);
assert.equal(certificateFreeApproval.status, "APPROVED");
assert.equal(Object.hasOwn(approval, "certificate"), false);
assert.equal(Object.hasOwn(approval, "ca"), false);

console.info("Target Approval canonical schema, inventory binding, target membership, revocation, provenance hash, and certificate independence PASS");