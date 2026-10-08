import { createHash } from "node:crypto";

export const TRIGGER_ORIGIN_INVENTORY_ARTIFACT_RAW_SHA256_ENV = "TLSN_TRIGGER_ORIGIN_INVENTORY_ARTIFACT_RAW_SHA256";

export function originInventoryArtifactRawSha256(rawBytes) {
  return createHash("sha256").update(rawBytes).digest("base64url");
}

export function assertTriggerInventoryArtifactDigest(artifactDigest, runtimeDigest) {
  if (artifactDigest !== runtimeDigest) {
    throw new Error("Trigger Origin inventory artifact raw SHA-256 does not match runtime inventory bytes");
  }
  return runtimeDigest;
}

export function assertTaskOriginInventoryDigest(taskDigest, runtimeDigest) {
  if (taskDigest !== runtimeDigest) {
    throw new Error("Worker task Origin inventory digest does not match Trigger runtime inventory");
  }
  return runtimeDigest;
}

export function assertTaskTargetApprovalDigest(taskDigest, runtimeDigest) {
  if (taskDigest !== runtimeDigest) {
    throw new Error("Worker task Target Approval digest does not match Trigger runtime approval artifact");
  }
  return runtimeDigest;
}