import { z } from "zod";

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_KEY_PATTERN = /^tlsn-verification\/[0-9a-f-]+\/(?:presentation|result)\.(?:bin|json)$/;
const BENCHMARK_TRACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERIFICATION_PROFILE_SCHEMA = z.enum(["complete", "sparse"]);
const DISCLOSURE_MODE_SCHEMA = z.enum(["full", "sparse"]);

const verificationProfileFields = {
  profile: VERIFICATION_PROFILE_SCHEMA,
  disclosure_mode: DISCLOSURE_MODE_SCHEMA,
};

function assertVerificationProfile(payload: { profile: "complete" | "sparse"; disclosure_mode: "full" | "sparse" }, context: z.RefinementCtx): void {
  const expectedDisclosureMode = payload.profile === "sparse" ? "sparse" : "full";
  if (payload.disclosure_mode !== expectedDisclosureMode) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["disclosure_mode"],
      message: "disclosure_mode does not match profile",
    });
  }
}

const verificationTaskPayloadObject = z.object({
  job_id: z.string().regex(JOB_ID_PATTERN),
  binding_id: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  session_id: z.string().uuid(),
  canonical_user_id: z.string().uuid(),
  device_id: z.string().uuid(),
  device_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  verification_input_key: z.string().regex(OBJECT_KEY_PATTERN),
  verification_result_key: z.string().regex(OBJECT_KEY_PATTERN),
  benchmark_trace_id: z.string().regex(BENCHMARK_TRACE_ID_PATTERN).optional(),
  ...verificationProfileFields,
}).strict();

export const verificationTaskPayloadSchema = verificationTaskPayloadObject.superRefine(assertVerificationProfile);

export const verificationInputRequestSchema = verificationTaskPayloadObject.pick({
  job_id: true,
  binding_id: true,
  session_id: true,
  canonical_user_id: true,
  device_id: true,
  verification_input_key: true,
  benchmark_trace_id: true,
});

export const verificationCallbackSchema = z.object({
  job_id: z.string().regex(JOB_ID_PATTERN),
  binding_id: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  session_id: z.string().uuid(),
  canonical_user_id: z.string().uuid(),
  device_id: z.string().uuid(),
  presentation_id: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  verification_status: z.literal("verified"),
  trigger_execution_started_at: z.number().int().positive().optional(),
  benchmark_timing: z.object({
    input_fetch_started_at: z.number().int().positive(),
    input_fetch_completed_at: z.number().int().positive(),
    verifier_started_at: z.number().int().positive(),
    verifier_completed_at: z.number().int().positive(),
    callback_request_started_at: z.number().int().positive(),
  }).strict().optional(),
  benchmark_trace_id: z.string().regex(BENCHMARK_TRACE_ID_PATTERN).optional(),
  ...verificationProfileFields,
}).strict().superRefine(assertVerificationProfile);

export const verificationStatusRequestSchema = verificationTaskPayloadObject.pick({
  job_id: true,
  session_id: true,
  binding_id: true,
  canonical_user_id: true,
  device_id: true,
}).extend({
  profile: VERIFICATION_PROFILE_SCHEMA.optional(),
  benchmark_trace_id: z.string().regex(BENCHMARK_TRACE_ID_PATTERN).optional(),
});

export const verificationFinalResponseSchema = z.object({
  verified: z.literal(true),
  result: z.record(z.string(), z.unknown()),
  signer_key_id: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
  signature_algorithm: z.literal("Ed25519"),
  consume_receipt: z.record(z.string(), z.unknown()),
  device_replay_digest_hex: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type VerificationTaskPayload = z.infer<typeof verificationTaskPayloadSchema>;
export type VerificationCallback = z.infer<typeof verificationCallbackSchema>;

export function verificationObjectKey(jobId: string, kind: "presentation" | "result"): string {
  return `tlsn-verification/${jobId}/${kind}.${kind === "presentation" ? "bin" : "json"}`;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function hmacBytes(secret: string, message: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
}

export async function internalRequestSignature(
  secret: string,
  jobId: string,
  body: string,
): Promise<string> {
  const bodyDigest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  ));
  const message = new TextEncoder().encode(
    `FUSOU-TLSN-INTERNAL-V1\0${jobId}\0${encodeBase64Url(bodyDigest)}`,
  );
  return encodeBase64Url(await hmacBytes(secret, message));
}

export async function verifyInternalRequest(
  secret: string,
  jobId: string,
  body: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  const expected = await internalRequestSignature(secret, jobId, body);
  return expected === signature;
}
