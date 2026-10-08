import { readFile } from "node:fs/promises";
import {
  assertCandidateServerIdentity,
  parseOriginInventory,
  parseTargetApproval,
  resolveApprovedProductionIdentity,
} from "../src/origin-trust-contract.mjs";
import { canonicalJson, sha256Base64Url } from "./deployment-attestation.mjs";
import { profilesForServerIdentity } from "./profile-canonical-contract.mjs";

export async function readProductionOriginReference(environment = process.env) {
  const names = [
    "TLSN_PRODUCTION_ORIGIN_INVENTORY_REFERENCE_PATH",
    "TLSN_PRODUCTION_TARGET_APPROVAL_REFERENCE_PATH",
  ];
  const paths = names.map((name) => {
    const path = environment[name]?.trim();
    if (!path) throw new Error(`missing required environment variable: ${name}`);
    return path;
  });
  const [inventoryBytes, approvalBytes] = await Promise.all(paths.map((path) => readFile(path)));
  return { inventoryBytes, approvalBytes };
}

function assertBytes(bytes, label) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error(`${label} raw bytes are required`);
}

export function deriveProductionOriginFromInspection({
  presentationBytes,
  inspection,
  inventoryBytes,
  approvalBytes,
  referenceInventoryBytes,
  referenceApprovalBytes,
}) {
  assertBytes(presentationBytes, "Presentation");
  if (
    inspection?.source !== "verified-alpha15-presentation" ||
    inspection.presentation_sha256 !== sha256Base64Url(presentationBytes)
  ) throw new Error("Production identity requires cryptographic inspection of the exact Presentation");
  for (const [bytes, label] of [
    [inventoryBytes, "captured Origin Inventory"],
    [approvalBytes, "captured Target Approval"],
    [referenceInventoryBytes, "reference Origin Inventory"],
    [referenceApprovalBytes, "reference Target Approval"],
  ]) assertBytes(bytes, label);
  if (!inventoryBytes.equals(referenceInventoryBytes)) {
    throw new Error("captured Origin Inventory does not match the independently supplied Production reference");
  }
  if (!approvalBytes.equals(referenceApprovalBytes)) {
    throw new Error("captured Target Approval does not match the independently supplied Production reference");
  }
  const inventorySha256 = sha256Base64Url(inventoryBytes);
  const approvalSha256 = sha256Base64Url(approvalBytes);
  const inventory = parseOriginInventory(inventoryBytes.toString("utf8"));
  if (Object.keys(inventory).sort().join(",") !== "schema_version,source,targets") {
    throw new Error("Production Origin Inventory has non-canonical fields");
  }
  for (const target of inventory.targets) assertCandidateServerIdentity(target.server_identity);
  const approval = parseTargetApproval(approvalBytes.toString("utf8"), inventory, inventorySha256);
  const observedIdentity = inspection.verified_presentation?.server_identity;
  assertCandidateServerIdentity(observedIdentity);
  const serverIdentity = resolveApprovedProductionIdentity(observedIdentity, inventory, approval.targets);
  const profiles = profilesForServerIdentity(serverIdentity);
  return {
    serverIdentity,
    inventorySha256,
    approvalSha256,
    profiles,
  };
}

export function assertProductionOriginConsistency(identity, origin, label) {
  for (const [field, expected] of Object.entries({
    origin_inventory_sha256: origin.inventorySha256,
    target_approval_artifact_sha256: origin.approvalSha256,
  })) {
    if (identity?.[field] !== expected) throw new Error(`${label} mismatch: ${field}`);
  }
  for (const [field, expected] of Object.entries({
    server_identity: origin.serverIdentity,
    profile_sha256: origin.profiles.complete.sha256,
    sparse_profile_sha256: origin.profiles.sparse.sha256,
  })) {
    if (Object.hasOwn(identity, field) && identity[field] !== expected) {
      throw new Error(`${label} Presentation-derived identity mismatch: ${field}`);
    }
  }
}

export function assertExactProductionResultResponse({
  bytes,
  result,
  consumeReceipt,
  replayDigestHex,
  verification,
}) {
  assertBytes(bytes, "exact outer Worker Result response");
  let response;
  try {
    response = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("exact outer Worker Result response is not valid UTF-8 JSON");
  }
  if (
    response?.verified !== true ||
    !response.result ||
    !response.consume_receipt ||
    !/^[a-f0-9]{64}$/.test(response.device_replay_digest_hex ?? "")
  ) throw new Error("exact outer Worker Result response is incomplete");
  if (canonicalJson(response.result) !== canonicalJson(result)) {
    throw new Error("exact outer response differs from the inner signed Result");
  }
  if (canonicalJson(response.consume_receipt) !== canonicalJson(consumeReceipt)) {
    throw new Error("exact outer response differs from the consume receipt");
  }
  if (response.device_replay_digest_hex !== replayDigestHex) {
    throw new Error("exact outer response differs from the replay digest");
  }
  if (verification !== undefined && canonicalJson(response) !== canonicalJson(verification)) {
    throw new Error("exact outer response differs from parsed Worker verification");
  }
  return response;
}
