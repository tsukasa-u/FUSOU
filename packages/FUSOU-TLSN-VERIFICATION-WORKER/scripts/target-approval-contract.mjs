import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCanonicalServerIdentity,
  isFixtureOrSyntheticServerIdentity,
  parseOriginInventory,
} from "../src/origin-trust-contract.mjs";

const packageDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const inventoryPath = resolve(packageDirectory, "../configs/tlsn-origin-inventory.json");
const workerInventoryPath = resolve(packageDirectory, "../configs/tlsn-origin-inventory.json.txt");
const approvalPath = resolve(packageDirectory, "../configs/tlsn-target-approval.json");
const APPROVAL_FIELDS = [
  "schema_version",
  "authority_model",
  "environment",
  "status",
  "inventory_sha256",
  "targets",
  "approved_at",
];
const DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const TARGET_APPROVAL_AUTHORITY = Object.freeze({
  status: "RESOLVED",
  authority_model: "FUSOU_DEPLOYMENT_OPERATOR",
  owner: "FUSOU_DEPLOYMENT_OPERATOR",
  evidence_contract: "TLSN_TARGET_APPROVAL_JSON_V1",
  environment: "production",
  next_action: "A candidate must be a canonical inventory member present in the current Production Target Approval record.",
});

export function serializeTargetApprovalRecord(record) {
  const orderedRecord = Object.fromEntries(APPROVAL_FIELDS.map((field) => [field, record[field]]));
  return JSON.stringify(orderedRecord, null, 2);
}

function digest(rawBytes) {
  return createHash("sha256").update(rawBytes).digest("base64url");
}

function readDefaultInputs() {
  const inventoryBytes = readFileSync(inventoryPath);
  const workerInventoryBytes = readFileSync(workerInventoryPath);
  if (!inventoryBytes.equals(workerInventoryBytes)) {
    throw new Error("canonical Origin inventory and Worker text inventory bytes do not match");
  }
  return {
    inventoryBytes,
    approvalBytes: readFileSync(approvalPath),
  };
}

function validateRecord(approvalBytes, inventoryBytes, environment, expectedApprovalArtifactSha256) {
  const approvalArtifactSha256 = digest(approvalBytes);
  if (expectedApprovalArtifactSha256 && approvalArtifactSha256 !== expectedApprovalArtifactSha256) {
    throw new Error("Target Approval artifact SHA-256 does not match the bound provenance digest");
  }
  const inventorySha256 = digest(inventoryBytes);
  const inventory = parseOriginInventory(inventoryBytes.toString("utf8"));
  const record = JSON.parse(approvalBytes.toString("utf8"));
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Target Approval record must be a JSON object");
  }
  if (Object.keys(record).join("\0") !== APPROVAL_FIELDS.join("\0")) {
    throw new Error("Target Approval record has missing, extra, or non-canonical fields");
  }
  if (!approvalBytes.equals(Buffer.from(serializeTargetApprovalRecord(record), "utf8"))) {
    throw new Error("Target Approval record is not in canonical serialization");
  }
  if (record.schema_version !== 1) throw new Error("unsupported Target Approval schema_version");
  if (record.authority_model !== TARGET_APPROVAL_AUTHORITY.authority_model) {
    throw new Error("Target Approval authority_model is not recognized");
  }
  if (record.environment !== environment) throw new Error("Target Approval environment does not match the requested target scope");
  if (record.status !== "APPROVED") throw new Error("Target Approval status is not APPROVED");
  if (typeof record.inventory_sha256 !== "string" || !DIGEST_PATTERN.test(record.inventory_sha256)) {
    throw new Error("Target Approval inventory_sha256 must be a SHA-256 base64url digest");
  }
  if (record.inventory_sha256 !== inventorySha256) {
    throw new Error("Target Approval inventory SHA-256 does not match the current canonical inventory");
  }
  if (typeof record.approved_at !== "string" || !RFC3339_PATTERN.test(record.approved_at) || !Number.isFinite(Date.parse(record.approved_at))) {
    throw new Error("Target Approval approved_at must be a valid RFC3339 timestamp");
  }
  if (!Array.isArray(record.targets) || record.targets.length === 0) {
    throw new Error("Target Approval targets must be a non-empty array");
  }
  const inventoryPositions = new Map(inventory.targets.map((target, index) => [target.server_identity, { ...target, index }]));
  const seenTargets = new Set();
  let previousInventoryPosition = -1;
  for (const target of record.targets) {
    assertCanonicalServerIdentity(target);
    if (isFixtureOrSyntheticServerIdentity(target)) throw new Error("Target Approval cannot include fixture or synthetic identities");
    if (seenTargets.has(target)) throw new Error("Target Approval targets must not contain duplicates");
    seenTargets.add(target);
    const inventoryTarget = inventoryPositions.get(target);
    if (!inventoryTarget || inventoryTarget.port !== 443) {
      throw new Error("Target Approval contains a target absent from the current HTTPS Origin inventory");
    }
    if (inventoryTarget.index <= previousInventoryPosition) {
      throw new Error("Target Approval targets must follow canonical inventory order");
    }
    previousInventoryPosition = inventoryTarget.index;
  }
  return {
    record,
    inventory,
    inventory_sha256: inventorySha256,
    approval_artifact_sha256: approvalArtifactSha256,
  };
}

export function evaluateTargetApproval({
  candidateIdentity,
  environment = TARGET_APPROVAL_AUTHORITY.environment,
  requireCandidate = false,
  inventoryBytes: suppliedInventoryBytes,
  approvalBytes: suppliedApprovalBytes,
  expectedApprovalArtifactSha256,
} = {}) {
  let inventoryBytes = suppliedInventoryBytes;
  let approvalBytes = suppliedApprovalBytes;
  let verified;
  let validationError;
  try {
    if (!inventoryBytes || !approvalBytes) {
      const defaults = readDefaultInputs();
      inventoryBytes ??= defaults.inventoryBytes;
      approvalBytes ??= defaults.approvalBytes;
    }
    verified = validateRecord(approvalBytes, inventoryBytes, environment, expectedApprovalArtifactSha256);
  } catch (error) {
    validationError = error instanceof Error ? error.message : "Target Approval validation failed";
  }

  const base = {
    authority_model: TARGET_APPROVAL_AUTHORITY.authority_model,
    authority_status: TARGET_APPROVAL_AUTHORITY.status,
    record_status: verified?.record.status ?? "INVALID",
    environment,
    inventory_sha256: verified?.inventory_sha256 ?? (inventoryBytes ? digest(inventoryBytes) : null),
    approval_artifact_sha256: approvalBytes ? digest(approvalBytes) : null,
    approved_target_identities: verified?.record.targets ?? [],
  };
  const candidateMissing = candidateIdentity === undefined || candidateIdentity === null || candidateIdentity === "";
  if (candidateMissing) {
    return {
      ...base,
      status: requireCandidate ? "MISSING" : verified ? "APPROVED" : "INVALID",
      approved_target_identity: null,
      reason: requireCandidate ? "TLSN_CANDIDATE_SERVER_IDENTITY is missing" : validationError ?? null,
    };
  }
  try {
    assertCanonicalServerIdentity(candidateIdentity);
  } catch {
    return { ...base, status: "INVALID", approved_target_identity: candidateIdentity, reason: "candidate identity is not a canonical lowercase DNS hostname" };
  }
  if (isFixtureOrSyntheticServerIdentity(candidateIdentity)) {
    return { ...base, status: "FIXTURE_OR_SYNTHETIC", approved_target_identity: candidateIdentity, reason: "fixture or synthetic target identities cannot be approved" };
  }
  if (!verified) {
    return { ...base, status: "INVALID", approved_target_identity: candidateIdentity, reason: validationError };
  }
  if (!verified.inventory.targets.some((target) => target.server_identity === candidateIdentity && target.port === 443)) {
    return { ...base, status: "NOT_IN_INVENTORY", approved_target_identity: candidateIdentity, reason: "candidate identity is absent from the current HTTPS Origin inventory" };
  }
  if (!verified.record.targets.includes(candidateIdentity)) {
    return { ...base, status: "IN_INVENTORY_NOT_APPROVED", approved_target_identity: candidateIdentity, reason: "candidate is in the inventory but not in the human-approved target set" };
  }
  return { ...base, status: "APPROVED", approved_target_identity: candidateIdentity, reason: null };
}

export function assertTargetApprovalResolved(options = {}) {
  const decision = evaluateTargetApproval(options);
  if (decision.status !== "APPROVED") {
    throw new Error(`Target Approval ${decision.status}: ${decision.reason ?? "approval record is invalid"}`);
  }
  return decision;
}

export function assertTargetApprovalProvenance(targetApproval, { role, candidateIdentity } = {}) {
  if (role !== "production" && role !== "canary") throw new Error("Target Approval provenance role is invalid");
  const current = assertTargetApprovalResolved({
    candidateIdentity,
    requireCandidate: role === "canary",
  });
  const expected = {
    authority_model: current.authority_model,
    status: current.record_status,
    environment: current.environment,
    inventory_sha256: current.inventory_sha256,
    approval_artifact_sha256: current.approval_artifact_sha256,
    approved_target_identity: role === "canary" ? candidateIdentity : null,
    approved_target_identities: current.approved_target_identities,
  };
  if (JSON.stringify(targetApproval) !== JSON.stringify(expected)) {
    throw new Error("Target Approval provenance does not match the current approved target, inventory, and artifact bytes");
  }
  return true;
}
