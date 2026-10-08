import { task } from "@trigger.dev/sdk/v3";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  canonicalJson,
  parseOriginInventory,
  parseTargetApproval,
  PROFILE_CONTRACT_SPEC,
  productionSecurityRegistrySetPayload,
  resolveApprovedProductionIdentity,
  securityRegistrySetPayload,
  sha256Base64Url,
} from "../../../FUSOU-TLSN-VERIFICATION-WORKER/src/origin-trust-contract.mjs";
import {
  initSync,
  inspect_alpha15_server_identity,
  verify_require_info_presentation,
  verify_sparse_require_info_presentation,
} from "../../../FUSOU-TLSN-VERIFICATION-WORKER/src/wasm/fusou_tlsn_verifier.js";
import { canonicalProfileBytes, type OriginPolicy } from "./origin-profile.js";
import {
  assertTaskOriginInventoryDigest,
  assertTaskTargetApprovalDigest,
  assertTriggerInventoryArtifactDigest,
  originInventoryArtifactRawSha256,
  TRIGGER_ORIGIN_INVENTORY_ARTIFACT_RAW_SHA256_ENV,
} from "./origin-inventory-contract.mjs";
import { verificationTaskPayloadSchema } from "./verification-task-contract.mjs";

const MAX_PRESENTATION_BYTES = 8 * 1024 * 1024;
type VerificationTaskPayload = z.infer<typeof verificationTaskPayloadSchema>;

const benchmarkTimingSchema = z.object({
  input_fetch_started_at: z.number().positive(),
  input_fetch_completed_at: z.number().positive(),
  verifier_initialization_started_at: z.number().positive(),
  verifier_initialization_completed_at: z.number().positive(),
  verifier_started_at: z.number().positive(),
  verifier_completed_at: z.number().positive(),
  callback_request_started_at: z.number().positive(),
}).strict();

function wallClockNow(): number {
  return performance.timeOrigin + performance.now();
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function decodeBase64Url(value: string, maximumBytes: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("invalid base64url configuration");
  }
  const bytes = new Uint8Array(Buffer.from(value, "base64url"));
  if (bytes.length === 0 || bytes.length > maximumBytes || Buffer.from(bytes).toString("base64url") !== value) {
    throw new Error("non-canonical base64url configuration");
  }
  return bytes;
}

function workerBaseUrl(): string {
  const value = requiredEnv("TLSN_WORKER_INTERNAL_URL").replace(/\/$/, "");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("TLSN_WORKER_INTERNAL_URL must be an HTTPS origin URL");
  }
  return value;
}

function internalSignature(secret: string, jobId: string, body: string): string {
  const bodyDigest = createHash("sha256").update(body).digest("base64url");
  return createHmac("sha256", secret)
    .update(`FUSOU-TLSN-INTERNAL-V1\0${jobId}\0${bodyDigest}`)
    .digest("base64url");
}

function jobIdHash(jobId: string): string {
  return createHash("sha256").update(jobId).digest("hex").slice(0, 16);
}

function errorClass(error: unknown): string {
  return error instanceof Error && error.name ? error.name : typeof error;
}

function logPhase(
  payload: VerificationTaskPayload,
  phase: string,
  startedAt: number,
  details: Record<string, unknown> = {},
): void {
  console.info("[tlsn-verification]", {
    job_id_hash: jobIdHash(payload.job_id),
    phase,
    elapsed_ms: wallClockNow() - startedAt,
    ...details,
  });
}

function wasmPath(): string {
  const relativePath = "FUSOU-TLSN-VERIFICATION-WORKER/src/wasm/fusou_tlsn_verifier_bg.wasm";
  const candidates = [
    resolve(process.cwd(), "..", relativePath),
    resolve(process.cwd(), relativePath),
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", relativePath),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("TLSN verifier WASM artifact is not available");
  return found;
}

function originTrustArtifactPath(relativePath: string, label: string): string {
  const candidates = [
    resolve(process.cwd(), "..", relativePath),
    resolve(process.cwd(), relativePath),
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", relativePath),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`${label} artifact is not available`);
  return found;
}

function originInventoryPath(): string {
  const relativePath = "configs/tlsn-origin-inventory.json.txt";
  return originTrustArtifactPath(relativePath, "TLSN Origin inventory");
}

function readOriginInventory(): { rawBytes: Buffer; inventory: ReturnType<typeof parseOriginInventory> } {
  const rawBytes = readFileSync(originInventoryPath());
  return { rawBytes, inventory: parseOriginInventory(rawBytes.toString("utf8")) };
}

function initializeVerifier(): void {
  initSync(readFileSync(wasmPath()));
}

async function verifierConfig(payload: VerificationTaskPayload): Promise<{
  verifierKeyId: string;
  notaryKeyId: string;
  notaryKey: Uint8Array;
  originInventorySha256: Uint8Array;
  targetApprovalArtifactSha256: Uint8Array;
  approvedTargetIdentities: string[];
  inventory: ReturnType<typeof parseOriginInventory>;
  serverIdentity?: string;
  profileSha256?: Uint8Array;
}> {
  const role = requiredEnv("TLSN_TRIGGER_DEPLOYMENT_ROLE").toLowerCase();
  if (role !== payload.deployment_role) throw new Error("Trigger deployment role does not match Worker task payload");
  if (role !== "production" && role !== "canary") throw new Error("Trigger runtime deployment role must be Production or Canary");
  if (process.env["TLSN_TRIGGER_TRUST_ROOT_CERTIFICATE_DER"] !== undefined) {
    throw new Error("custom Origin trust roots are unavailable to the Production Trigger");
  }
  const { rawBytes, inventory } = readOriginInventory();
  const runtimeInventoryRawSha256 = originInventoryArtifactRawSha256(rawBytes);
  assertTriggerInventoryArtifactDigest(
    requiredEnv(TRIGGER_ORIGIN_INVENTORY_ARTIFACT_RAW_SHA256_ENV),
    runtimeInventoryRawSha256,
  );
  const notaryRegistry = z.record(z.string(), z.string()).parse(
    JSON.parse(requiredEnv("TLSN_TRIGGER_NOTARY_REGISTRY")) as unknown,
  );
  const notaryKeyValue = notaryRegistry[requiredEnv("TLSN_TRIGGER_NOTARY_KEY_ID")];
  if (!notaryKeyValue) throw new Error("TLSN_TRIGGER_NOTARY_KEY_ID is absent from the notary registry");
  const config = {
    verifierKeyId: requiredEnv("TLSN_TRIGGER_VERIFIER_KEY_ID"),
    notaryKeyId: requiredEnv("TLSN_TRIGGER_NOTARY_KEY_ID"),
    notaryKey: decodeBase64Url(notaryKeyValue, 4096),
    originInventorySha256: new Uint8Array(),
    targetApprovalArtifactSha256: new Uint8Array(),
    approvedTargetIdentities: [],
    inventory,
  };
  if (payload.origin_policy === "fixed") {
    if (role !== "canary") throw new Error("fixed Origin policy is only valid for Canary Trigger deployments");
    const serverIdentity = requiredEnv("TLSN_TRIGGER_SERVER_IDENTITY");
    const profileInput = payload.profile === "sparse" ? "TLSN_TRIGGER_SPARSE_PROFILE_SHA256" : "TLSN_TRIGGER_PROFILE_SHA256";
    const completeHash = decodeBase64Url(requiredEnv("TLSN_TRIGGER_PROFILE_SHA256"), 32);
    const sparseHash = decodeBase64Url(requiredEnv("TLSN_TRIGGER_SPARSE_PROFILE_SHA256"), 32);
    if (role === "canary" && inventory.targets.some((target) => target.server_identity === serverIdentity)) {
      throw new Error("Canary fixed Origin identity must remain separate from the Production inventory");
    }
    const expectedComplete = new Uint8Array(createHash("sha256").update(canonicalProfileBytes("complete", serverIdentity)).digest());
    const expectedSparse = new Uint8Array(createHash("sha256").update(canonicalProfileBytes("sparse", serverIdentity)).digest());
    if (!Buffer.from(completeHash).equals(Buffer.from(expectedComplete)) || !Buffer.from(sparseHash).equals(Buffer.from(expectedSparse))) {
      throw new Error("Canary fixed profile hashes do not match the canonical profile contract");
    }
    const canaryTrustPayload = securityRegistrySetPayload({
      notaryKeyId: config.notaryKeyId,
      notaryRegistryRaw: requiredEnv("TLSN_TRIGGER_NOTARY_REGISTRY"),
      profileSha256: requiredEnv("TLSN_TRIGGER_PROFILE_SHA256"),
      serverIdentity,
      sparseProfileSha256: requiredEnv("TLSN_TRIGGER_SPARSE_PROFILE_SHA256"),
    });
    const expectedCanarySecuritySetSha256 = createHash("sha256")
      .update(canonicalJson(canaryTrustPayload), "utf8")
      .digest("base64url");
    if (process.env["TLSN_SECURITY_REGISTRY_SET_SHA256"] !== expectedCanarySecuritySetSha256 ||
      payload.security_registry_set_sha256 !== expectedCanarySecuritySetSha256) {
      throw new Error("Canary Trigger security registry set does not match Worker task and runtime inputs");
    }
    return {
      ...config,
      serverIdentity,
      profileSha256: decodeBase64Url(requiredEnv(profileInput), 32),
    };
  }
  if (process.env["TLSN_TRIGGER_SERVER_IDENTITY"] !== undefined ||
    process.env["TLSN_TRIGGER_PROFILE_SHA256"] !== undefined ||
    process.env["TLSN_TRIGGER_SPARSE_PROFILE_SHA256"] !== undefined) {
    throw new Error("Production inventory Trigger cannot use a static Origin identity or profile digest");
  }
  const originInventorySha256 = runtimeInventoryRawSha256;
  assertTaskOriginInventoryDigest(payload.origin_inventory_sha256, originInventorySha256);
  if (role !== "production") throw new Error("inventory Origin policy is only valid for Production Trigger deployments");
  const targetApprovalRawBytes = readFileSync(
    originTrustArtifactPath("configs/tlsn-target-approval.json", "TLSN Target Approval"),
  );
  const targetApprovalArtifactSha256 = await sha256Base64Url(new Uint8Array(targetApprovalRawBytes));
  assertTaskTargetApprovalDigest(payload.target_approval_artifact_sha256, targetApprovalArtifactSha256);
  const targetApproval = parseTargetApproval(targetApprovalRawBytes.toString("utf8"), inventory, originInventorySha256);
  const profilePolicySha256 = await sha256Base64Url(new TextEncoder().encode(canonicalJson(PROFILE_CONTRACT_SPEC)));
  const expectedTrustPayload = productionSecurityRegistrySetPayload({
    notaryKeyId: config.notaryKeyId,
    notaryRegistryRaw: canonicalJson(notaryRegistry),
    originInventorySha256,
    targetApprovalArtifactSha256,
    profilePolicySha256,
  });
  const expectedSecurityRegistrySetSha256 = await sha256Base64Url(
    new TextEncoder().encode(canonicalJson(expectedTrustPayload)),
  );
  if (process.env["TLSN_SECURITY_REGISTRY_SET_SHA256"] !== expectedSecurityRegistrySetSha256) {
    throw new Error("Trigger Production security registry set does not match runtime inputs");
  }
  if (payload.security_registry_set_sha256 !== expectedSecurityRegistrySetSha256) {
    throw new Error("Worker task security registry set does not match Trigger Production runtime inputs");
  }
  return {
    ...config,
    originInventorySha256: decodeBase64Url(originInventorySha256, 32),
    targetApprovalArtifactSha256: decodeBase64Url(targetApprovalArtifactSha256, 32),
    approvedTargetIdentities: targetApproval.targets,
  };
}

async function fetchPresentation(payload: VerificationTaskPayload): Promise<Uint8Array> {
  const body = JSON.stringify({
    job_id: payload.job_id,
    binding_id: payload.binding_id,
    session_id: payload.session_id,
    canonical_user_id: payload.canonical_user_id,
    device_id: payload.device_id,
    verification_input_key: payload.verification_input_key,
    ...(payload.benchmark_trace_id ? { benchmark_trace_id: payload.benchmark_trace_id } : {}),
  });
  const response = await fetch(`${workerBaseUrl()}/internal/tlsn/verification-input`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-FUSOU-TLSN-Job-Id": payload.job_id,
      "X-FUSOU-TLSN-Signature": internalSignature(requiredEnv("TLSN_TRIGGER_CALLBACK_SECRET"), payload.job_id, body),
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`TLSN verification input fetch failed with status ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_PRESENTATION_BYTES) {
    throw new Error("TLSN verification input exceeds the configured limit");
  }
  return bytes;
}

async function postCompletion(
  payload: VerificationTaskPayload,
  presentationId: string,
  triggerExecutionStartedAt: number,
  benchmarkTiming: z.infer<typeof benchmarkTimingSchema> | undefined,
  moduleEvaluationCompletedAt: number,
): Promise<void> {
  const callbackRequestStartedAt = wallClockNow();
  const body = JSON.stringify({
    job_id: payload.job_id,
    binding_id: payload.binding_id,
    session_id: payload.session_id,
    canonical_user_id: payload.canonical_user_id,
    device_id: payload.device_id,
    presentation_id: presentationId,
    verification_status: "verified",
    trigger_execution_started_at: triggerExecutionStartedAt,
    ...(payload.benchmark_trace_id ? { benchmark_trace_id: payload.benchmark_trace_id } : {}),
    ...(payload.benchmark_trace_id && benchmarkTiming
      ? {
          benchmark_timing: {
            ...benchmarkTiming,
            callback_request_started_at: callbackRequestStartedAt,
          },
        }
      : {}),
    ...(payload.benchmark_trace_id
      ? { benchmark_module_timing: { module_evaluation_completed_at: moduleEvaluationCompletedAt } }
      : {}),
    profile: payload.profile,
    disclosure_mode: payload.disclosure_mode,
  });
  const response = await fetch(`${workerBaseUrl()}/internal/tlsn/verification-complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-FUSOU-TLSN-Job-Id": payload.job_id,
      "X-FUSOU-TLSN-Signature": internalSignature(requiredEnv("TLSN_TRIGGER_CALLBACK_SECRET"), payload.job_id, body),
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`TLSN verification completion failed with status ${response.status}`);
  }
}

const moduleEvaluationCompletedAt = wallClockNow();

export const verifyTlsnPresentation = task({
  id: "tlsn-verify-presentation",
  queue: {
    name: "tlsn-verification",
    concurrencyLimit: 2,
  },
  machine: "medium-1x",
  retry: { maxAttempts: 3 },
  maxDuration: 600,
  run: async (input: VerificationTaskPayload) => {
    const triggerExecutionStartedAt = wallClockNow();
    const payload = verificationTaskPayloadSchema.parse(input);
    logPhase(payload, "started", triggerExecutionStartedAt, {
      origin_inventory_artifact_raw_sha256: process.env[TRIGGER_ORIGIN_INVENTORY_ARTIFACT_RAW_SHA256_ENV] ?? null,
    });
    const inputFetchStartedAt = wallClockNow();
    logPhase(payload, "input_fetch_start", triggerExecutionStartedAt);
    let presentation: Uint8Array;
    try {
      presentation = await fetchPresentation(payload);
    } catch (error) {
      logPhase(payload, "input_fetch_error", triggerExecutionStartedAt, { error_class: errorClass(error) });
      throw error;
    }
    const inputFetchCompletedAt = wallClockNow();
    logPhase(payload, "input_fetch_ok", triggerExecutionStartedAt, { byte_length: presentation.byteLength });
    const presentationId = createHash("sha256").update(presentation).digest("base64url");
    const verifierStartedAt = wallClockNow();
    logPhase(payload, "verifier_start", triggerExecutionStartedAt, { profile: payload.profile });
    const verifierInitializationStartedAt = wallClockNow();
    let verifierInitializationCompletedAt = verifierInitializationStartedAt;
    try {
      initializeVerifier();
      verifierInitializationCompletedAt = wallClockNow();

      const config = await verifierConfig(payload);
      let serverIdentity = config.serverIdentity;
      let profileSha256 = config.profileSha256;
      if (payload.origin_policy === "inventory") {
        const observedIdentity = inspect_alpha15_server_identity(presentation, config.notaryKey);
        serverIdentity = resolveApprovedProductionIdentity(
          observedIdentity,
          config.inventory,
          config.approvedTargetIdentities,
        );
        profileSha256 = new Uint8Array(createHash("sha256").update(
          canonicalProfileBytes(payload.profile, serverIdentity),
        ).digest());
      }
      if (!serverIdentity || !profileSha256) throw new Error("Trigger Origin identity or profile digest is not configured");
      const deviceChallenge = decodeBase64Url(payload.device_challenge, 32);
      const preparedResultJson = payload.profile === "sparse"
        ? verify_sparse_require_info_presentation(
          presentation,
          serverIdentity,
          profileSha256,
          config.verifierKeyId,
          config.notaryKeyId,
          payload.canonical_user_id,
          payload.device_id,
          deviceChallenge,
          config.originInventorySha256,
          config.targetApprovalArtifactSha256,
          config.notaryKey,
        )
        : verify_require_info_presentation(
          presentation,
          serverIdentity,
          profileSha256,
          config.verifierKeyId,
          config.notaryKeyId,
          payload.canonical_user_id,
          payload.device_id,
          deviceChallenge,
          config.originInventorySha256,
          config.targetApprovalArtifactSha256,
          config.notaryKey,
        );
      JSON.parse(preparedResultJson);
    } catch (error) {
      logPhase(payload, "verifier_error", triggerExecutionStartedAt, { error_class: errorClass(error) });
      throw error;
    }
    const verifierCompletedAt = wallClockNow();
    logPhase(payload, "verifier_ok", triggerExecutionStartedAt);
    logPhase(payload, "callback_start", triggerExecutionStartedAt);
    try {
      await postCompletion(
        payload,
        presentationId,
        triggerExecutionStartedAt,
        payload.benchmark_trace_id
          ? benchmarkTimingSchema.parse({
              input_fetch_started_at: inputFetchStartedAt,
              input_fetch_completed_at: inputFetchCompletedAt,
              verifier_initialization_started_at: verifierInitializationStartedAt,
              verifier_initialization_completed_at: verifierInitializationCompletedAt,
              verifier_started_at: verifierStartedAt,
              verifier_completed_at: verifierCompletedAt,
              callback_request_started_at: wallClockNow(),
            })
          : undefined,
        moduleEvaluationCompletedAt,
      );
    } catch (error) {
      logPhase(payload, "callback_error", triggerExecutionStartedAt, { error_class: errorClass(error) });
      throw error;
    }
    logPhase(payload, "callback_ok", triggerExecutionStartedAt);
    return { accepted: true, presentation_id: presentationId };
  },
});
