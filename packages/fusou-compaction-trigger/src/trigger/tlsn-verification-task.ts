import { task } from "@trigger.dev/sdk/v3";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  initSync,
  verify_require_info_presentation,
  verify_require_info_presentation_with_trust_anchor,
} from "../../../FUSOU-TLSN-VERIFICATION-WORKER/src/wasm/fusou_tlsn_verifier.js";

const MAX_PRESENTATION_BYTES = 8 * 1024 * 1024;
const MAX_RESULT_JSON_BYTES = 25_165_824;
const verificationTaskPayloadSchema = z.object({
  job_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  binding_id: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  session_id: z.string().uuid(),
  canonical_user_id: z.string().uuid(),
  device_id: z.string().uuid(),
  device_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  verification_input_key: z.string().regex(/^tlsn-verification\/[0-9a-f-]+\/presentation\.bin$/),
  verification_result_key: z.string().regex(/^tlsn-verification\/[0-9a-f-]+\/result\.json$/),
}).strict();
type VerificationTaskPayload = z.infer<typeof verificationTaskPayloadSchema>;
const preparedResultSchema = z.object({
  unsigned_result: z.string().min(1).max(MAX_RESULT_JSON_BYTES),
  signing_bytes: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

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

function initializeVerifier(): void {
  initSync(readFileSync(wasmPath()));
}

function verifierConfig(): {
  serverIdentity: string;
  profileSha256: Uint8Array;
  verifierKeyId: string;
  notaryKeyId: string;
  notaryKey: Uint8Array;
  trustRoot?: Uint8Array;
} {
  const trustRootValue = process.env["TLSN_TRIGGER_TRUST_ROOT_CERTIFICATE_DER"]?.trim();
  const notaryRegistry = z.record(z.string(), z.string()).parse(
    JSON.parse(requiredEnv("TLSN_TRIGGER_NOTARY_REGISTRY")) as unknown,
  );
  const notaryKeyValue = notaryRegistry[requiredEnv("TLSN_TRIGGER_NOTARY_KEY_ID")];
  if (!notaryKeyValue) throw new Error("TLSN_TRIGGER_NOTARY_KEY_ID is absent from the notary registry");
  return {
    serverIdentity: requiredEnv("TLSN_TRIGGER_SERVER_IDENTITY"),
    profileSha256: decodeBase64Url(requiredEnv("TLSN_TRIGGER_PROFILE_SHA256"), 32),
    verifierKeyId: requiredEnv("TLSN_TRIGGER_VERIFIER_KEY_ID"),
    notaryKeyId: requiredEnv("TLSN_TRIGGER_NOTARY_KEY_ID"),
    notaryKey: decodeBase64Url(notaryKeyValue, 4096),
    ...(trustRootValue ? { trustRoot: decodeBase64Url(trustRootValue, 4096) } : {}),
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

async function postCompletion(payload: VerificationTaskPayload, presentationId: string, preparedResult: unknown): Promise<void> {
  const body = JSON.stringify({
    job_id: payload.job_id,
    binding_id: payload.binding_id,
    session_id: payload.session_id,
    canonical_user_id: payload.canonical_user_id,
    device_id: payload.device_id,
    presentation_id: presentationId,
    prepared_result: preparedResult,
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
    const payload = verificationTaskPayloadSchema.parse(input);
    const presentation = await fetchPresentation(payload);
    const presentationId = createHash("sha256").update(presentation).digest("base64url");
    initializeVerifier();

    const config = verifierConfig();
    const deviceChallenge = decodeBase64Url(payload.device_challenge, 32);
    const preparedResultJson = config.trustRoot
      ? verify_require_info_presentation_with_trust_anchor(
          presentation,
          config.serverIdentity,
          config.profileSha256,
          config.verifierKeyId,
          config.notaryKeyId,
          payload.canonical_user_id,
          payload.device_id,
          deviceChallenge,
          config.trustRoot,
          config.notaryKey,
        )
      : verify_require_info_presentation(
          presentation,
          config.serverIdentity,
          config.profileSha256,
          config.verifierKeyId,
          config.notaryKeyId,
          payload.canonical_user_id,
          payload.device_id,
          deviceChallenge,
          config.notaryKey,
        );
    const preparedResult = preparedResultSchema.parse(JSON.parse(preparedResultJson) as unknown);
    await postCompletion(payload, presentationId, preparedResult);
    return { accepted: true, presentation_id: presentationId };
  },
});
