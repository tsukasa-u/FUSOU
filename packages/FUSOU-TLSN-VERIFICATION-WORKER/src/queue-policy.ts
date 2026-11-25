import type { BindingRecord } from "./binding_authority.js";
import type { VerificationQueueMessage } from "./verification_jobs.js";

export type QueueRuntimeTrust = {
  environment: string;
  deploymentRole?: string | undefined;
  originInventorySha256?: string | undefined;
  targetApprovalArtifactSha256?: string | undefined;
  securityRegistrySetSha256?: string | undefined;
};

export function queueMessageMatchesRuntimeTrust(
  message: VerificationQueueMessage,
  runtime: QueueRuntimeTrust,
): boolean {
  if (runtime.environment === "production" && runtime.deploymentRole === "production") {
    return message.deployment_role === "production"
      && message.origin_policy === "inventory"
      && message.origin_inventory_sha256 === runtime.originInventorySha256
      && message.target_approval_artifact_sha256 === runtime.targetApprovalArtifactSha256
      && message.security_registry_set_sha256 === runtime.securityRegistrySetSha256;
  }
  if (runtime.environment === "test") {
    return message.deployment_role === "test"
      && message.origin_policy === "fixed"
      && message.origin_inventory_sha256 === undefined
      && message.target_approval_artifact_sha256 === undefined
      && message.security_registry_set_sha256 === undefined;
  }
  return false;
}

export function queueMessageMatchesBindingRecord(
  message: VerificationQueueMessage,
  record: BindingRecord,
): boolean {
  return record.binding_id === message.binding_id
    && record.verification_job_id === message.job_id
    && record.session_id === message.session_id
    && record.canonical_user_id === message.canonical_user_id
    && record.device_id === message.device_id
    && record.tlsn_device_challenge === message.device_challenge
    && record.presentation_id === message.presentation_id
    && (record.verification_input_source ?? "r2") === "r2"
    && record.verification_input_key === message.verification_input_key
    && record.verification_result_key === message.verification_result_key
    && (record.verification_profile ?? "complete") === message.profile;
}

export type QueuePreflightDisposition = "process" | "confirm_result" | "ack" | "retry" | "reject";

export function queuePreflightDisposition(
  record: BindingRecord,
  messageAttempts: number,
): QueuePreflightDisposition {
  if (record.status === "consumed") return "confirm_result";
  if (record.status === "failed" || record.status === "expired") return "ack";
  if (record.status === "processing") return "process";
  if (record.status === "verifying") return messageAttempts > 1 ? "retry" : "ack";
  return "reject";
}

export function queueMessagePreflightDisposition(
  message: VerificationQueueMessage,
  record: BindingRecord,
  currentRuntimeTrustMatches: boolean,
  messageAttempts: number,
): QueuePreflightDisposition {
  if (!currentRuntimeTrustMatches || !queueMessageMatchesBindingRecord(message, record)) {
    return "reject";
  }
  return queuePreflightDisposition(record, messageAttempts);
}

export type QueuePostflightDisposition = "confirm_result" | "ack" | "retry";

export function queuePostflightDisposition(
  record: BindingRecord,
  responseStatus: number,
): QueuePostflightDisposition {
  if (record.status === "consumed") return "confirm_result";
  if (record.status === "failed" || record.status === "expired") return "ack";
  if (record.status === "verifying" && responseStatus === 202) return "ack";
  if (record.status === "processing" || record.status === "verifying") return "retry";
  return "ack";
}
