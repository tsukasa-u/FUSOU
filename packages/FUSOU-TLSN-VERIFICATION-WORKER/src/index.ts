import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  BindingAuthorityError,
  type CommitVerifiedResultInput,
  type ConsumedVerificationReplayInput,
  DurableObjectBindingAuthority,
  TlsnBindingAuthorityDurableObject,
  encodeBase64Url,
  hashBindingId,
  parseBindingValue,
  type BindingRecord,
  type BenchmarkTimingRecord as DurableBenchmarkTimingRecord,
  type VerificationFailureCode,
  type VerificationResultLookupInput,
} from "./binding_authority.js";
import {
  attestationConsumeReceiptSigningBytes,
  attestationSessionReceiptSigningBytes,
} from "./attestation_receipts.js";
import {
  PrivateKeyValidationCache,
  type PrivateKeyValidationObservation,
} from "./private_key_validation_cache.js";
import {
  verificationCallbackSchema,
  verificationFinalResponseSchema,
  verificationInputRequestSchema,
  verificationObjectKey,
  verificationStatusRequestSchema,
  verificationTaskPayloadSchema,
  verificationQueueMessageSchema,
  type VerificationTaskPayload,
  type VerificationQueueMessage,
  verifyInternalRequest,
  internalRequestSignature,
} from "./verification_jobs.js";
import initVerifier, {
  attach_verifier_result_signature,
  attach_sparse_verifier_result_signature,
  derive_verifier_result_signing_bytes,
  derive_sparse_verifier_result_signing_bytes,
  verify_require_info_presentation,
  verify_require_info_presentation_with_trust_anchor,
  verify_sparse_require_info_presentation,
  verify_sparse_require_info_presentation_with_trust_anchor,
} from "./wasm/fusou_tlsn_verifier.js";
import wasmModule from "./wasm/fusou_tlsn_verifier_bg.wasm";
export type Bindings = {
  TLSN_ENVIRONMENT: string;
  CF_VERSION_METADATA?: {
    id: string;
    tag: string;
    timestamp: string;
  };
  TLSN_BINDINGS: DurableObjectNamespace;
  TLSN_PRESENTATIONS: R2Bucket;
  TLSN_BINDING_TTL_SECONDS: string;
  TLSN_EXECUTION_MODE?: string;
  TLSN_TRIGGER_API_URL?: string;
  TLSN_TRIGGER_TASK_ID?: string;
  TLSN_TRIGGER_SECRET_KEY?: string;
  TLSN_TRIGGER_CALLBACK_SECRET?: string;
  TLSN_QUEUE_CALLBACK_SECRET?: string;
  TLSN_DIRECT_CALLBACK_SECRET?: string;
  TLSN_DIRECT_VERIFIER?: Fetcher;
  TLSN_VERIFICATION_QUEUE?: Queue<VerificationQueueMessage>;
  TLSN_TEST_COMPLETION_DELAY_MS?: string;
  TLSN_TEST_COMPLETION_DELAY_ONCE?: string;
  TLSN_TEST_VERIFICATION_LEASE_MS?: string;
  TLSN_TEST_POST_RESULT_DELAY_MS?: string;
  TLSN_TEST_POST_RESULT_DELAY_ONCE?: string;
  TLSN_TEST_DIRECT_INVOCATION_TIMEOUT_MS?: string;
  TLSN_TEST_DIRECT_VERIFIER_MODE?: string;
  TLSN_TEST_DIRECT_VERIFIER_DELAY_MS?: string;
  TLSN_TEST_DIRECT_SYNCHRONOUS_CANDIDATE?: string;
  TLSN_REPLAY_TEST_VERIFICATION_LEASE_MS?: string;
  TLSN_REPLAY_TEST_POST_RESULT_DELAY_MS?: string;
  TLSN_REPLAY_TEST_POST_RESULT_DELAY_ONCE?: string;
  TLSN_REPLAY_DEPLOYMENT_ID?: string;
  TLSN_REPLAY_WORKER_NAME?: string;
  TLSN_REPLAY_AUTH_USERS?: string;
  TLSN_REPLAY_DEVICE_ID?: string;
  TLSN_REPLAY_DEVICE_PUBLIC_KEY?: string;
  TLSN_CANARY_TRIGGER_API_URL?: string;
  TLSN_CANARY_TRIGGER_TASK_ID?: string;
  TLSN_CANARY_TRIGGER_SECRET_KEY?: string;
  TLSN_CANARY_TRIGGER_CALLBACK_SECRET?: string;
  TLSN_CANARY_DIRECT_CALLBACK_SECRET?: string;
  TLSN_CANARY_SYNCHRONOUS_RESPONSE_ENABLED?: string;
  TLSN_CANARY_FIXTURE_ONLY?: string;
  TLSN_CANARY_WORKER_INTERNAL_URL?: string;
  TLSN_PRODUCTION_TRIGGER_API_URL?: string;
  TLSN_PRODUCTION_TRIGGER_TASK_ID?: string;
  TLSN_PRODUCTION_TRIGGER_SECRET_KEY?: string;
  TLSN_PRODUCTION_TRIGGER_CALLBACK_SECRET?: string;
  TLSN_PRODUCTION_WORKER_INTERNAL_URL?: string;
  TLSN_SERVER_IDENTITY: string;
  TLSN_PROFILE_SHA256: string;
  TLSN_SPARSE_PROFILE_SHA256?: string;
  TLSN_VERIFIER_KEY_ID: string;
  TLSN_NOTARY_KEY_ID: string;
  TLSN_NOTARY_REGISTRY: string;
  TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8: string;
  TLSN_RESULT_PUBLIC_KEY_SPKI?: string;
  TLSN_RESULT_SIGNER_KEY_ID?: string;
  TLSN_RESULT_SIGNING_KEY_REGISTRY?: string;
  TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: string;
  TLSN_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: string;
  TLSN_SESSION_AUTHORITY_KEY_ID: string;
  TLSN_SESSION_AUTHORITY_KEY_REGISTRY: string;
  TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8: string;
  TLSN_BINDING_AUTHORITY_PUBLIC_KEY_SPKI: string;
  TLSN_BINDING_AUTHORITY_KEY_ID: string;
  TLSN_BINDING_AUTHORITY_KEY_REGISTRY: string;
  TLSN_TRUST_ROOT_CERTIFICATE_DER?: string;
  TLSN_TEST_BINDING_VALUE?: string;
  TLSN_TEST_BINDING_VALUES?: string;
  TLSN_TEST_DEVICE_ID?: string;
  TLSN_TEST_DEVICE_PUBLIC_KEY?: string;
  TLSN_TEST_WORKER_NAME?: string;
  TLSN_BENCHMARK_TIMINGS?: string;
  TLSN_CANDIDATE_SERVER_IDENTITY?: string;
  TLSN_CANDIDATE_PROFILE_SHA256?: string;
  TLSN_CANDIDATE_SPARSE_PROFILE_SHA256?: string;
  TLSN_CANDIDATE_VERIFIER_KEY_ID?: string;
  TLSN_CANDIDATE_NOTARY_KEY_ID?: string;
  TLSN_PRODUCTION_NOTARY_REGISTRY?: string;
  TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS?: string;
  TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS?: string;
  TLSN_CANDIDATE_SUPABASE_URL?: string;
  TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY?: string;
  TLSN_CANDIDATE_DEVICE_AUTH_URL?: string;
  TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL?: string;
  TLSN_SUPABASE_URL?: string;
  TLSN_SUPABASE_PUBLISHABLE_KEY?: string;
  TLSN_CANARY_DEPLOYMENT_ID?: string;
  TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8?: string;
  TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER?: string;
  TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI?: string;
  TLSN_CANARY_RESULT_SIGNER_KEY_ID?: string;
  TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY?: string;
  TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE?: string;
  TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID?: string;
  TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI?: string;
  TLSN_CANARY_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8?: string;
  TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI?: string;
  TLSN_CANARY_SESSION_AUTHORITY_KEY_ID?: string;
  TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY?: string;
  TLSN_CANARY_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8?: string;
  TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI?: string;
  TLSN_CANARY_BINDING_AUTHORITY_KEY_ID?: string;
  TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY?: string;
  TLSN_CANARY_WORKER_NAME?: string;
  TLSN_PRODUCTION_DEPLOYMENT_ID?: string;
  TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8?: string;
  TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER?: string;
  TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI?: string;
  TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID?: string;
  TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY?: string;
  TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE?: string;
  TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID?: string;
  TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI?: string;
  TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8?: string;
  TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI?: string;
  TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID?: string;
  TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY?: string;
  TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8?: string;
  TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI?: string;
  TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID?: string;
  TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY?: string;
  TLSN_PRODUCTION_WORKER_NAME?: string;
  TLSN_DEPLOYMENT_ROLE?: string;
  TLSN_GIT_COMMIT_SHA?: string;
  TLSN_CANARY_BINDING_VALUE?: string;
  TLSN_SECURITY_REGISTRY_SET_SHA256?: string;
  TLSN_DEVICE_AUTH_URL?: string;
  TLSN_DEVICE_POSSESSION_AUTH_URL?: string;
  TLSN_TEST_AUTH_USERS?: string;
};

const MAX_PRESENTATION_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_JSON_BYTES = 12 * 1024 * 1024;
const MAX_PRESENTATION_BASE64_LENGTH = Math.ceil(MAX_PRESENTATION_BYTES * 4 / 3) + 4;
const MAX_RESULT_JSON_BYTES = 25_165_824;
const MAX_RESULT_OBJECT_BYTES = MAX_RESULT_JSON_BYTES + 256 * 1024;
const MAX_INTERNAL_CALLBACK_JSON_BYTES = 64 * 1024;
const VERIFICATION_LEASE_MS = 10 * 60 * 1000;
const DIRECT_CALLBACK_PROCESSING_HEADER = "X-FUSOU-TLSN-Benchmark-Direct-Callback-Processing-Ms";
const SERVER_COMPLETION_EPOCH_HEADER = "X-FUSOU-TLSN-Benchmark-Server-Completion-Epoch-Ms";
const REPLAY_VERIFICATION_ATTEMPT_HEADER = "X-FUSOU-TLSN-Test-Verification-Attempt-Id";

type BenchmarkTimingStage =
  | "t0_accepted"
  | "t1_presentation_persisted"
  | "t1_202_response_sent"
  | "t2_trigger_submitted"
  | "t2_trigger_task_accepted"
  | "t2_queue_submitted"
  | "t2_queue_message_accepted"
  | "t3_callback_accepted"
  | "t3_trigger_execution_started"
  | "t3_trigger_module_initialized"
  | "t3_trigger_verifier_initialization_started"
  | "t3_trigger_verifier_initialization_completed"
  | "t3_queue_execution_started"
  | "t3_queue_verifier_started"
  | "t3_queue_verifier_completed"
  | "t3_queue_callback_dispatch_started"
  | "t3_queue_callback_response_received"
  | "t4_lease_acquired"
  | "t4_callback_accepted"
  | "t5_presentation_read"
  | "t5_lease_acquired"
  | "t6_wasm_verification_completed"
  | "t6_presentation_read"
  | "t7_result_signing_completed"
  | "t7_wasm_verification_completed"
  | "t8_result_persisted"
  | "t8_result_signing_completed"
  | "t9_consume_completed"
  | "t9_result_persisted"
  | "t10_status_verified"
  | "t10_consume_completed"
  | "t11_status_verified"
  | "t3_trigger_input_fetch_started"
  | "t3_trigger_input_fetch_completed"
  | "t3_trigger_verifier_started"
  | "t3_trigger_verifier_completed"
  | "t3_trigger_callback_request_started"
  | "queue_send_start"
  | "queue_send_completed"
  | "queue_message_accepted"
  | "queue_consumer_scheduled"
  | "queue_consumer_started"
  | "queue_handler_entered"
  | "queue_verifier_started"
  | "t10_callback_response_ready"
  | "t1_200_response_sent"
  | "queue_callback_authentication_started"
  | "queue_callback_authentication_completed"
  | "queue_callback_schema_validated"
  | "queue_completion_entered"
  | "queue_binding_lookup_and_lease_started"
  | "queue_binding_lookup_and_lease_completed"
  | "queue_binding_lookup_started"
  | "queue_binding_lookup_completed"
  | "queue_lease_acquire_started"
  | "queue_lease_acquire_completed"
  | "queue_presentation_read_started"
  | "queue_presentation_read_completed"
  | "queue_presentation_hash_completed"
  | "queue_wasm_verification_started"
  | "queue_wasm_verification_completed"
  | "queue_result_signing_started"
  | "queue_result_signing_completed"
  | "queue_result_persistence_started"
  | "queue_result_persistence_completed"
  | "queue_consume_started"
  | "queue_consume_completed"
  | "queue_completion_response_ready"
  | "direct_dispatch_started"
  | "t1_direct_input_bound"
  | "direct_invocation_started"
  | "direct_invocation_completed"
  | "t3_direct_execution_started"
  | "direct_presentation_read_started"
  | "direct_presentation_read_completed"
  | "direct_presentation_received"
  | "direct_synchronous_response_started"
  | "direct_synchronous_response_completed"
  | "result_canonicalization_started"
  | "result_canonicalization_completed"
  | "result_signing_started"
  | "result_signing_completed"
  | "result_construction_started"
  | "result_construction_completed"
  | "result_serialization_started"
  | "result_serialization_completed"
  | "result_hash_started"
  | "result_hash_completed"
  | "result_persistence_started"
  | "result_persistence_completed"
  | "input_cleanup_started"
  | "input_cleanup_completed"
  | "status_result_read_started"
  | "status_result_read_completed"
  | "status_result_hash_started"
  | "status_result_hash_completed"
  | "status_result_parse_started"
  | "status_result_parse_completed"
  | "t5_presentation_hash_started"
  | "t5_presentation_hash_completed"
  | "benchmark_server_completion";

type ExecutionMode = "trigger" | "queue" | "direct";
export type TestDirectFault =
  | "failure"
  | "timeout"
  | "late_success"
  | "pause_before_result_commit"
  | "pause_after_result_commit";

type DirectPresentationTiming = {
  readStartedAt: number;
  readCompletedAt: number;
  readDurationMilliseconds: number;
};

type BenchmarkPersistence = {
  authority: DurableObjectBindingAuthority;
  bindingId: string;
  traceId: string;
  executionMode: ExecutionMode;
};

const benchmarkTimingRecords = new Map<string, DurableBenchmarkTimingRecord>();
const benchmarkPersistences = new Map<string, BenchmarkPersistence>();
const testDeviceAuthNonces = new Set<string>();
const testDeviceProofDigests = new Set<string>();
let benchmarkActiveVerifierCount = 0;
let benchmarkMaxVerifierConcurrency = 0;

const requestSchema = z
  .object({
    presentation_base64: z
      .string()
      .min(1)
      .max(MAX_PRESENTATION_BASE64_LENGTH)
      .regex(/^[A-Za-z0-9_-]+$/),
    session_id: z.string().uuid(),
    binding: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/),
    device_id: z.string().uuid(),
    device_proof: z.object({
      challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      sig: z.string().min(1).max(256).regex(/^[A-Za-z0-9+/_=-]+$/),
    }).strict(),
  })
  .strict();

const deviceProofRequestSchema = z
  .object({
    device_id: z.string().uuid(),
    nonce: z.string().regex(/^[a-f0-9]{64}$/),
    sig: z.string().min(1).max(256).regex(/^[A-Za-z0-9+/_=-]+$/),
  })
  .strict();

const authenticatedResultSchema = z.object({
  attestation_session_id: z.string().uuid(),
  canonical_user_id: z.string().uuid(),
  device_id: z.string().uuid(),
  device_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  binding_nonce: z.string().regex(/^[A-Za-z0-9_-]+$/),
  binding_value: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/),
  tlsn_attestation_id: z.string().regex(/^[A-Za-z0-9_-]+$/),
});

const preparedResultSchema = z
  .object({
    unsigned_result: z.string().min(1).max(MAX_RESULT_JSON_BYTES),
    signing_bytes: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

const configSchema = z.object({
  environment: z.enum(["test", "production"]),
  serverIdentity: z.string().min(1).max(253),
  profileSha256: z.string().regex(/^[A-Za-z0-9_-]+$/),
  sparseProfileSha256: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
  verifierKeyId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  notaryKeyId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  deviceAuthUrl: z.string().url(),
  devicePossessionAuthUrl: z.string().url(),
  deviceAuthAllowedHosts: z.string().optional(),
  notaryRegistry: z.string().min(1).max(65_536),
  resultSigningPrivateKeyPkcs8: z.string().regex(/^[A-Za-z0-9_-]+$/),
  sessionAuthoritySigningPrivateKeyPkcs8: z.string().regex(/^[A-Za-z0-9_-]+$/),
  sessionAuthorityPublicKeySpki: z.string().regex(/^[A-Za-z0-9_-]{59}$/),
  sessionAuthorityKeyId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
  sessionAuthorityKeyRegistry: z.string().min(1),
  bindingAuthoritySigningPrivateKeyPkcs8: z.string().regex(/^[A-Za-z0-9_-]+$/),
  bindingAuthorityPublicKeySpki: z.string().regex(/^[A-Za-z0-9_-]{59}$/),
  bindingAuthorityKeyId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
  bindingAuthorityKeyRegistry: z.string().min(1),
  trustRootCertificateDer: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
  resultPublicKeySpki: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
  resultSignerKeyId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/).optional(),
  resultSigningKeyRegistry: z.string().min(1).optional(),
});

const resultSigningKeyEntrySchema = z.object({
  key_id: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
  public_key_spki: z.string().regex(/^[A-Za-z0-9_-]{59}$/),
  status: z.enum(["ACTIVE", "VERIFY_ONLY", "RETIRED", "REVOKED"]),
  not_before: z.string(),
  not_after: z.string().nullable(),
}).strict();

const resultSigningKeyRegistrySchema = z.object({
  schema_version: z.literal(1),
  scope: z.literal("tlsn-result-signing-key-registry"),
  keys: z.array(resultSigningKeyEntrySchema).min(1),
}).strict().superRefine((registry, context) => {
  const seenKeyIds = new Set<string>();
  registry.keys.forEach((key, index) => {
    if (seenKeyIds.has(key.key_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keys", index, "key_id"],
        message: "result signing key IDs must be unique",
      });
    }
    seenKeyIds.add(key.key_id);
    const notBefore = Date.parse(key.not_before);
    if (!Number.isFinite(notBefore)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keys", index, "not_before"],
        message: "not_before must be an ISO timestamp",
      });
    }
    if (key.not_after !== null) {
      const notAfter = Date.parse(key.not_after);
      if (!Number.isFinite(notAfter)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["keys", index, "not_after"],
          message: "not_after must be an ISO timestamp or null",
        });
      } else if (Number.isFinite(notBefore) && notAfter <= notBefore) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["keys", index, "not_after"],
          message: "not_after must be after not_before",
        });
      }
    }
  });
});

const authorityKeyRegistrySchema = z.object({
  schema_version: z.literal(1),
  scope: z.enum(["tlsn-session-authority-key-registry", "tlsn-binding-authority-key-registry"]),
  keys: z.array(resultSigningKeyEntrySchema).min(1),
}).strict().superRefine((registry, context) => {
  const seenKeyIds = new Set<string>();
  registry.keys.forEach((key, index) => {
    if (seenKeyIds.has(key.key_id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["keys", index, "key_id"], message: "authority key IDs must be unique" });
    }
    seenKeyIds.add(key.key_id);
    const notBefore = Date.parse(key.not_before);
    const notAfter = key.not_after === null ? null : Date.parse(key.not_after);
    if (!Number.isFinite(notBefore) || (notAfter !== null && (!Number.isFinite(notAfter) || notAfter <= notBefore))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["keys", index], message: "authority key validity window is invalid" });
    }
  });
});

const authUserSchema = z.object({
  id: z.string().uuid(),
  is_anonymous: z.boolean(),
}).passthrough();

const testAuthUsersSchema = z.record(z.string().min(1), authUserSchema);

type AuthenticatedSubject = {
  canonicalUserId: string;
  accessToken: string;
};

type AuthenticationResult =
  | { ok: true; subject: AuthenticatedSubject }
  | { ok: false; status: 401 | 503; error: "unauthorized" | "auth_unconfigured" };

const notaryRegistrySchema = z.record(
  z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  z.string().regex(/^[A-Za-z0-9_-]+$/),
);

type VerifierConfig = z.infer<typeof configSchema> & {
  profileSha256Bytes: Uint8Array;
  sparseProfileSha256Bytes: Uint8Array | undefined;
  notaryKeyBytes: Uint8Array;
  resultSigningPrivateKeyBytes: Uint8Array;
  sessionAuthoritySigningPrivateKeyBytes: Uint8Array;
  bindingAuthoritySigningPrivateKeyBytes: Uint8Array;
  trustRootCertificateDerBytes: Uint8Array | undefined;
  bindingTtlSeconds: number;
};

const app = new Hono<{ Bindings: Bindings }>();
let wasmInitialization: Promise<void> | undefined;
let testCompletionDelayUsed = false;
let testPostResultDelayUsed = false;

export function benchmarkEnabled(env: Bindings): boolean {
  return env.TLSN_BENCHMARK_TIMINGS === "true" && (
    env.TLSN_ENVIRONMENT === "test" ||
    (env.TLSN_ENVIRONMENT === "production" && env.TLSN_DEPLOYMENT_ROLE === "canary")
  );
}

function benchmarkRegister(
  env: Bindings,
  jobId: string,
  authority: DurableObjectBindingAuthority,
  bindingId: string,
  traceId: string | undefined,
  executionMode: ExecutionMode = "trigger",
): void {
  if (!benchmarkEnabled(env) || !traceId) return;
  benchmarkPersistences.set(jobId, { authority, bindingId, traceId, executionMode });
  if (!benchmarkTimingRecords.has(jobId)) {
    benchmarkTimingRecords.set(jobId, {
      schema_version: 1,
      trace_id: traceId,
      job_id: jobId,
      execution_mode: executionMode,
      timestamps: {},
      durations: {},
      r2_operations: {},
      do_operations: {},
      max_verifier_concurrency: benchmarkMaxVerifierConcurrency,
      updated_at: Date.now(),
    });
  }
}

async function benchmarkRegisterFromCallback(
  env: Bindings,
  jobId: string,
  authority: DurableObjectBindingAuthority,
  bindingId: string,
  traceId: string | undefined,
  executionMode: ExecutionMode = "trigger",
): Promise<void> {
  if (!benchmarkEnabled(env)) return;
  if (traceId) {
    benchmarkRegister(env, jobId, authority, bindingId, traceId, executionMode);
    return;
  }
  const existing = await authority.getBenchmarkTimingByJobId(bindingId, jobId).catch(() => null);
  benchmarkRegister(env, jobId, authority, bindingId, existing?.trace_id, executionMode);
}

function benchmarkRecord(env: Bindings, jobId: string, stage: BenchmarkTimingStage, timestamp = Date.now()): void {
  if (!benchmarkEnabled(env)) return;
  const persistence = benchmarkPersistences.get(jobId);
  if (!persistence) return;
  const record = benchmarkTimingRecords.get(jobId);
  if (!record) return;
  record.timestamps[stage] = timestamp;
  record.max_verifier_concurrency = benchmarkMaxVerifierConcurrency;
  record.updated_at = Date.now();
}

export function benchmarkDuration(env: Bindings, jobId: string, name: string, milliseconds: number): void {
  if (!benchmarkEnabled(env) || !Number.isFinite(milliseconds) || milliseconds < 0) return;
  const persistence = benchmarkPersistences.get(jobId);
  if (!persistence) return;
  const record = benchmarkTimingRecords.get(jobId);
  if (!record) return;
  record.durations[name] = milliseconds;
  record.max_verifier_concurrency = benchmarkMaxVerifierConcurrency;
  record.updated_at = Date.now();
}

function benchmarkDurationHeader(
  c: Context<{ Bindings: Bindings }>,
  env: Bindings,
  name: string,
  milliseconds: number | undefined,
): void {
  if (!benchmarkEnabled(env) || milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) return;
  c.header(`X-FUSOU-TLSN-Benchmark-${name}-Ms`, String(milliseconds));
}

function benchmarkResponseDurationHeader(
  response: Response,
  env: Bindings,
  headerName: string,
  milliseconds: number | undefined,
): void {
  if (!benchmarkEnabled(env) || milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) return;
  response.headers.set(headerName, String(milliseconds));
}

function readBenchmarkResponseDurationHeader(response: Response, headerName: string): number | undefined {
  const raw = response.headers.get(headerName);
  if (raw === null || raw.trim() === "") return undefined;
  const milliseconds = Number(raw);
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : undefined;
}

function benchmarkDiagnostic(env: Bindings, jobId: string, name: string, value: boolean | number | string): void {
  if (!benchmarkEnabled(env)) return;
  const persistence = benchmarkPersistences.get(jobId);
  if (!persistence) return;
  const record = benchmarkTimingRecords.get(jobId);
  if (!record) return;
  record.diagnostics ??= {};
  record.diagnostics[name] = value;
  record.max_verifier_concurrency = benchmarkMaxVerifierConcurrency;
  record.updated_at = Date.now();
}

function benchmarkAuthorityLeaseMetadata(env: Bindings, jobId: string, record: BindingRecord): void {
  if (!benchmarkEnabled(env)) return;
  const leaseStartedAt = Date.parse(record.benchmark_lease_started_at ?? "");
  const leaseExpiresAt = Date.parse(record.benchmark_lease_expires_at ?? record.verification_lease_expires_at ?? "");
  const persistenceStartedAt = Date.parse(record.benchmark_persistence_started_at ?? "");
  const terminalFailureAt = Date.parse(record.benchmark_terminal_failure_at ?? "");
  const persistenceRemainingMilliseconds = record.benchmark_persistence_remaining_ms;
  const terminalFailureRemainingMilliseconds = record.benchmark_terminal_failure_remaining_ms;
  if (Number.isFinite(leaseStartedAt)) benchmarkDiagnostic(env, jobId, "lease_started_epoch_ms", leaseStartedAt);
  if (Number.isFinite(leaseExpiresAt)) benchmarkDiagnostic(env, jobId, "lease_expires_epoch_ms", leaseExpiresAt);
  if (Number.isFinite(persistenceStartedAt)) benchmarkDiagnostic(env, jobId, "persistence_started_epoch_ms", persistenceStartedAt);
  if (typeof persistenceRemainingMilliseconds === "number" && Number.isFinite(persistenceRemainingMilliseconds)) {
    benchmarkDiagnostic(env, jobId, "lease_remaining_at_persistence_start_ms", persistenceRemainingMilliseconds);
  }
  if (Number.isFinite(terminalFailureAt)) benchmarkDiagnostic(env, jobId, "terminal_failure_epoch_ms", terminalFailureAt);
  if (typeof terminalFailureRemainingMilliseconds === "number" && Number.isFinite(terminalFailureRemainingMilliseconds)) {
    benchmarkDiagnostic(env, jobId, "lease_remaining_at_terminal_failure_ms", terminalFailureRemainingMilliseconds);
  }
  const serverCompletionAt = Date.parse(record.benchmark_server_completion_at ?? "");
  if (Number.isFinite(serverCompletionAt)) {
    benchmarkDiagnostic(env, jobId, "server_completion_epoch_ms", serverCompletionAt);
    benchmarkRecord(env, jobId, "benchmark_server_completion", serverCompletionAt);
  }
}

function benchmarkServerCompletionHeader(
  c: Context<{ Bindings: Bindings }>,
  env: Bindings,
  record: BindingRecord,
): void {
  if (!benchmarkEnabled(env)) return;
  const completionAt = Date.parse(record.benchmark_server_completion_at ?? "");
  if (Number.isFinite(completionAt)) c.header(SERVER_COMPLETION_EPOCH_HEADER, String(completionAt));
}

function replayVerificationAttemptHeader(
  headers: Headers,
  env: Bindings,
  verificationAttemptId: string | undefined,
): void {
  if (
    env.TLSN_ENVIRONMENT === "test"
    && env.TLSN_DEPLOYMENT_ROLE === "replay"
    && verificationAttemptId !== undefined
  ) {
    headers.set(REPLAY_VERIFICATION_ATTEMPT_HEADER, verificationAttemptId);
  }
}

function benchmarkIncrementDiagnostic(env: Bindings, jobId: string, name: string): void {
  if (!benchmarkEnabled(env)) return;
  const persistence = benchmarkPersistences.get(jobId);
  if (!persistence) return;
  const record = benchmarkTimingRecords.get(jobId);
  if (!record) return;
  record.diagnostics ??= {};
  const current = record.diagnostics[name];
  record.diagnostics[name] = typeof current === "number" ? current + 1 : 1;
  record.max_verifier_concurrency = benchmarkMaxVerifierConcurrency;
  record.updated_at = Date.now();
}

type ConfigValidationComponent =
  | "schema_validation"
  | "registry_parsing"
  | "registry_lookup"
  | "base64_decoding"
  | "hostname_allowlist";

const CONFIG_VALIDATION_COMPONENTS: ConfigValidationComponent[] = [
  "schema_validation",
  "registry_parsing",
  "registry_lookup",
  "base64_decoding",
  "hostname_allowlist",
];

type ConfigValidationTimings = Partial<Record<ConfigValidationComponent, number>>;

function addConfigValidationTiming(
  timings: ConfigValidationTimings,
  component: ConfigValidationComponent,
  milliseconds: number,
): void {
  timings[component] = (timings[component] ?? 0) + milliseconds;
}

function benchmarkConfigValidation(
  env: Bindings,
  jobId: string,
  observations: ReadonlyArray<PrivateKeyValidationObservation>,
  source: "request" | "callback",
  totalMilliseconds: number,
  timings: ConfigValidationTimings,
): void {
  benchmarkDuration(
    env,
    jobId,
    `config_validation_${source}`,
    totalMilliseconds,
  );
  const privateKeyMilliseconds = observations.reduce(
    (total, observation) => total + observation.elapsedMilliseconds,
    0,
  );
  benchmarkDuration(env, jobId, `config_validation_${source}_private_key`, privateKeyMilliseconds);
  benchmarkDuration(
    env,
    jobId,
    `config_validation_${source}_fingerprint`,
    observations.reduce((total, observation) => total + observation.fingerprintElapsedMilliseconds, 0),
  );
  benchmarkDuration(
    env,
    jobId,
    `config_validation_${source}_crypto`,
    observations.reduce((total, observation) => total + observation.cryptoElapsedMilliseconds, 0),
  );
  benchmarkDuration(
    env,
    jobId,
    `config_validation_${source}_cache_hit`,
    observations
      .filter((observation) => observation.cacheHit)
      .reduce((total, observation) => total + observation.elapsedMilliseconds, 0),
  );
  benchmarkDuration(
    env,
    jobId,
    `config_validation_${source}_full_miss`,
    observations
      .filter((observation) => !observation.cacheHit && !observation.concurrentDeduplication)
      .reduce((total, observation) => total + observation.elapsedMilliseconds, 0),
  );
  benchmarkDuration(
    env,
    jobId,
    `config_validation_${source}_concurrent_dedup`,
    observations
      .filter((observation) => observation.concurrentDeduplication)
      .reduce((total, observation) => total + observation.elapsedMilliseconds, 0),
  );
  for (const component of CONFIG_VALIDATION_COMPONENTS) {
    benchmarkDuration(
      env,
      jobId,
      `config_validation_${source}_${component}`,
      timings[component] ?? 0,
    );
  }
  const measuredComponents = Object.values(timings).reduce(
    (total, milliseconds) => total + (milliseconds ?? 0),
    0,
  );
  benchmarkDuration(
    env,
    jobId,
    `config_validation_${source}_other`,
    Math.max(0, totalMilliseconds - privateKeyMilliseconds - measuredComponents),
  );
  for (const observation of observations) {
    benchmarkIncrementDiagnostic(env, jobId, `config_validation_${source}_count`);
    benchmarkIncrementDiagnostic(
      env,
      jobId,
      observation.cacheHit
        ? `config_validation_${source}_cache_hit_count`
        : `config_validation_${source}_cache_miss_count`,
    );
    if (observation.concurrentDeduplication) {
      benchmarkIncrementDiagnostic(env, jobId, `config_validation_${source}_concurrent_dedup_count`);
    } else if (!observation.cacheHit) {
      benchmarkIncrementDiagnostic(env, jobId, `config_validation_${source}_full_miss_count`);
    }
  }
}

function benchmarkR2Operation(env: Bindings, jobId: string, operation: string): void {
  if (!benchmarkEnabled(env)) return;
  const persistence = benchmarkPersistences.get(jobId);
  if (!persistence) return;
  const record = benchmarkTimingRecords.get(jobId);
  if (!record) return;
  record.r2_operations[operation] = (record.r2_operations[operation] ?? 0) + 1;
  record.max_verifier_concurrency = benchmarkMaxVerifierConcurrency;
  record.updated_at = Date.now();
}

function benchmarkDOOperation(env: Bindings, jobId: string, operation: string): void {
  if (!benchmarkEnabled(env)) return;
  const persistence = benchmarkPersistences.get(jobId);
  if (!persistence) return;
  const record = benchmarkTimingRecords.get(jobId);
  if (!record) return;
  record.do_operations[operation] = (record.do_operations[operation] ?? 0) + 1;
  record.max_verifier_concurrency = benchmarkMaxVerifierConcurrency;
  record.updated_at = Date.now();
}

function benchmarkAcquireVerificationOptions(
  env: Bindings,
  jobId: string,
): { benchmarkTiming: true; onBenchmarkTiming: (timing: Readonly<Record<string, number>>) => void } | undefined {
  if (!benchmarkEnabled(env)) return undefined;
  return {
    benchmarkTiming: true,
    onBenchmarkTiming: (timing) => {
      for (const [name, milliseconds] of Object.entries(timing)) {
        benchmarkDuration(env, jobId, name, milliseconds);
      }
    },
  };
}

function benchmarkVerifierStart(env: Bindings, jobId: string): void {
  if (!benchmarkEnabled(env)) return;
  benchmarkActiveVerifierCount += 1;
  benchmarkMaxVerifierConcurrency = Math.max(benchmarkMaxVerifierConcurrency, benchmarkActiveVerifierCount);
  benchmarkRecord(env, jobId, "t4_lease_acquired");
}

function benchmarkVerifierEnd(env: Bindings, jobId: string): void {
  if (!benchmarkEnabled(env)) return;
  benchmarkActiveVerifierCount = Math.max(0, benchmarkActiveVerifierCount - 1);
}

async function benchmarkFlush(env: Bindings, jobId: string): Promise<void> {
  if (!benchmarkEnabled(env)) return;
  const persistence = benchmarkPersistences.get(jobId);
  const local = benchmarkTimingRecords.get(jobId);
  if (!persistence || !local) return;
  const durable = await persistence.authority.getBenchmarkTiming(
    persistence.bindingId,
    persistence.traceId,
  ).catch(() => null);
  const record: DurableBenchmarkTimingRecord = {
    schema_version: 1,
    trace_id: persistence.traceId,
    job_id: jobId,
    execution_mode: persistence.executionMode,
    timestamps: {
      ...(durable?.timestamps ?? {}),
      ...local.timestamps,
    },
    durations: {
      ...(durable?.durations ?? {}),
      ...local.durations,
    },
    r2_operations: {
      ...(durable?.r2_operations ?? {}),
      ...local.r2_operations,
    },
    do_operations: {
      ...(durable?.do_operations ?? {}),
      ...local.do_operations,
    },
    diagnostics: {
      ...(durable?.diagnostics ?? {}),
      ...(local.diagnostics ?? {}),
    },
    max_verifier_concurrency: Math.max(
      durable?.max_verifier_concurrency ?? 0,
      local.max_verifier_concurrency,
    ),
    updated_at: Date.now(),
  };
  benchmarkTimingRecords.set(jobId, record);
  await persistence.authority.mergeBenchmarkTiming(persistence.bindingId, record).catch(() => undefined);
}

function deferBenchmarkFlush(c: { env: Bindings; executionCtx: ExecutionContext }, jobId: string): void {
  if (!benchmarkEnabled(c.env)) return;
  c.executionCtx.waitUntil(benchmarkFlush(c.env, jobId));
}

async function benchmarkTimingHeaderValue(env: Bindings, jobId: string): Promise<string | undefined> {
  if (!benchmarkEnabled(env)) return;
  const persistence = benchmarkPersistences.get(jobId);
  const local = benchmarkTimingRecords.get(jobId);
  const durable = persistence
    ? await persistence.authority.getBenchmarkTiming(persistence.bindingId, persistence.traceId).catch(() => null)
    : null;
  const record = local || durable
    ? {
        ...(durable ?? local),
        timestamps: { ...(durable?.timestamps ?? {}), ...(local?.timestamps ?? {}) },
        durations: { ...(durable?.durations ?? {}), ...(local?.durations ?? {}) },
        r2_operations: { ...(durable?.r2_operations ?? {}), ...(local?.r2_operations ?? {}) },
        do_operations: { ...(durable?.do_operations ?? {}), ...(local?.do_operations ?? {}) },
        diagnostics: { ...(durable?.diagnostics ?? {}), ...(local?.diagnostics ?? {}) },
        max_verifier_concurrency: Math.max(
          durable?.max_verifier_concurrency ?? 0,
          local?.max_verifier_concurrency ?? 0,
        ),
      }
    : null;
  if (!record) return;
  const [jobIdSha256, traceIdSha256] = await Promise.all(
    [record.job_id, record.trace_id].map(async (value) => encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    )),
  );
  const { job_id: _jobId, trace_id: _traceId, ...sanitizedRecord } = record;
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify({
    ...sanitizedRecord,
    job_id_sha256: jobIdSha256,
    trace_id_sha256: traceIdSha256,
  })));
}

async function attachBenchmarkTimingHeader(c: Context<{ Bindings: Bindings }>, env: Bindings, jobId: string): Promise<void> {
  const value = await benchmarkTimingHeaderValue(env, jobId);
  if (value) c.header("X-FUSOU-TLSN-Benchmark-Timing", value);
}

type AuthoritativeVerificationResult = {
  bytes: Uint8Array;
  value: z.infer<typeof verificationFinalResponseSchema>;
};

function parseAuthoritativeVerificationResultBytes(bytes: Uint8Array): AuthoritativeVerificationResult | null {
  if (bytes.byteLength > MAX_RESULT_OBJECT_BYTES) return null;
  try {
    const body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return {
      bytes,
      value: verificationFinalResponseSchema.parse(JSON.parse(body) as unknown),
    };
  } catch {
    return null;
  }
}

async function readAuthoritativeVerificationResult(
  authority: DurableObjectBindingAuthority,
  bindingId: string,
  input: VerificationResultLookupInput,
): Promise<AuthoritativeVerificationResult | null> {
  const storedResult = await authority.getConsumedVerificationResult(bindingId, input);
  return storedResult ? parseAuthoritativeVerificationResultBytes(storedResult.bytes) : null;
}

function testBindingValueForRequest(env: Bindings, request: Request): string | undefined {
  if (env.TLSN_ENVIRONMENT !== "test") return undefined;
  if (env.TLSN_TEST_BINDING_VALUES === undefined) return env.TLSN_TEST_BINDING_VALUE?.trim() || undefined;
  const requested = request.headers.get("X-FUSOU-TLSN-Test-Binding")?.trim();
  const allowed = env.TLSN_TEST_BINDING_VALUES.split(",").map((value) => value.trim()).filter(Boolean);
  return requested && allowed.includes(requested) ? requested : undefined;
}

function testDirectFaultForRequest(
  env: Bindings,
  request: Request,
): TestDirectFault | undefined {
  if (env.TLSN_ENVIRONMENT !== "test") return undefined;
  const requested = request.headers.get("X-FUSOU-TLSN-Test-Fault")?.trim();
  return requested === "failure" || requested === "timeout" || requested === "late_success" || requested === "pause_before_result_commit" || requested === "pause_after_result_commit"
    ? requested
    : undefined;
}

type TestReplayResultFault = "result_missing" | "result_corrupt";

function testReplayResultFaultForRequest(
  env: Bindings,
  request: Request,
): TestReplayResultFault | undefined {
  if (env.TLSN_ENVIRONMENT !== "test") return undefined;
  const requested = request.headers.get("X-FUSOU-TLSN-Test-Replay-Fault")?.trim();
  return requested === "result_missing" || requested === "result_corrupt" ? requested : undefined;
}

async function applyTestReplayResultFault(
  authority: DurableObjectBindingAuthority,
  bindingId: string,
  record: BindingRecord,
  fault: TestReplayResultFault,
): Promise<void> {
  if (!record.verification_job_id) return;
  await authority.applyTestResultFault(bindingId, {
    session_id: record.session_id,
    canonical_user_id: record.canonical_user_id,
    device_id: record.device_id,
    verification_job_id: record.verification_job_id,
    ...(record.result_sha256 ? { result_sha256: record.result_sha256 } : {}),
    ...(record.result_object_key ? { result_object_key: record.result_object_key } : {}),
    fault,
    now: Date.now(),
  });
}

async function replayConsumedVerificationResult(
  c: Context<{ Bindings: Bindings }>,
  authority: DurableObjectBindingAuthority,
  bindingValue: string,
  input: ConsumedVerificationReplayInput,
  replayFault: TestReplayResultFault | undefined,
): Promise<Response | null> {
  let storedResult;
  try {
    storedResult = await authority.getConsumedVerificationResultForReplay(bindingValue, input);
  } catch (error) {
    if (error instanceof BindingAuthorityError && error.code === "verification_result_mismatch") {
      return c.json({ verified: false, error: error.code }, 422);
    }
    if (!replayFault) return null;
    return c.json({ verified: false, error: "verification_result_unavailable" }, 503);
  }
  if (!storedResult || !storedResult.record.verification_job_id) return null;

  const replayJobId = storedResult.record.verification_job_id;
  if (benchmarkEnabled(c.env)) {
    await benchmarkRegisterFromCallback(
      c.env,
      replayJobId,
      authority,
      storedResult.record.binding_id,
      undefined,
      "direct",
    );
    benchmarkIncrementDiagnostic(c.env, replayJobId, "synchronous_replay_count");
    benchmarkDiagnostic(c.env, replayJobId, "synchronous_replay_path", "established");
    benchmarkDOOperation(c.env, replayJobId, "replay_result_read");
  }

  let authoritativeResult = parseAuthoritativeVerificationResultBytes(storedResult.bytes);
  if (replayFault) {
    await applyTestReplayResultFault(
      authority,
      storedResult.record.binding_id,
      storedResult.record,
      replayFault,
    );
    authoritativeResult = await readAuthoritativeVerificationResult(authority, storedResult.record.binding_id, {
      session_id: input.session_id,
      canonical_user_id: input.canonical_user_id,
      device_id: input.device_id,
      verification_job_id: replayJobId,
      ...(storedResult.record.result_sha256 ? { result_sha256: storedResult.record.result_sha256 } : {}),
      ...(storedResult.record.result_object_key ? { result_object_key: storedResult.record.result_object_key } : {}),
      now: Date.now(),
    }).catch(() => null);
  }
  if (!authoritativeResult) {
    if (!replayFault) return null;
    return c.json({ verified: false, error: "verification_result_unavailable" }, 503);
  }
  if (benchmarkEnabled(c.env)) {
    await benchmarkFlush(c.env, replayJobId);
  }
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  });
  if (benchmarkEnabled(c.env)) {
    const timingHeader = await benchmarkTimingHeaderValue(c.env, replayJobId);
    if (timingHeader) headers.set("X-FUSOU-TLSN-Benchmark-Timing", timingHeader);
    headers.set("X-FUSOU-TLSN-Test-Job-Id", replayJobId);
    const replayPersistence = benchmarkPersistences.get(replayJobId);
    if (replayPersistence) headers.set("X-FUSOU-TLSN-Test-Benchmark-Trace-Id", replayPersistence.traceId);
  }
  return new Response(authoritativeResult.bytes, { status: 200, headers });
}

async function delayTestCompletion(env: Bindings): Promise<void> {
  if (env.TLSN_ENVIRONMENT !== "test" || env.TLSN_TEST_COMPLETION_DELAY_MS === undefined) return;
  const delayMs = Number(env.TLSN_TEST_COMPLETION_DELAY_MS);
  if (!Number.isInteger(delayMs) || delayMs <= 0 || delayMs > 5_000) return;
  if (env.TLSN_TEST_COMPLETION_DELAY_ONCE === "true") {
    if (testCompletionDelayUsed) return;
    testCompletionDelayUsed = true;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function verificationLeaseMs(env: Bindings): number {
  const configuredLease = env.TLSN_TEST_VERIFICATION_LEASE_MS ?? env.TLSN_REPLAY_TEST_VERIFICATION_LEASE_MS;
  if (env.TLSN_ENVIRONMENT !== "test" || configuredLease === undefined) {
    return VERIFICATION_LEASE_MS;
  }
  const leaseMs = Number(configuredLease);
  return Number.isInteger(leaseMs) && leaseMs > 0 && leaseMs <= VERIFICATION_LEASE_MS
    ? leaseMs
    : VERIFICATION_LEASE_MS;
}

function directInvocationTimeoutMs(env: Bindings): number {
  const configured = env.TLSN_ENVIRONMENT === "test"
    ? Number(env.TLSN_TEST_DIRECT_INVOCATION_TIMEOUT_MS)
    : Number.NaN;
  return Number.isInteger(configured) && configured > 0 && configured <= VERIFICATION_LEASE_MS
    ? configured
    : VERIFICATION_LEASE_MS;
}

async function delayAtResultCommit(env: Bindings, testFault: TestDirectFault | undefined, expectedFault: TestDirectFault): Promise<void> {
  const configuredDelay = env.TLSN_TEST_POST_RESULT_DELAY_MS ?? env.TLSN_REPLAY_TEST_POST_RESULT_DELAY_MS;
  if (env.TLSN_ENVIRONMENT !== "test" || configuredDelay === undefined) return;
  if (testFault !== expectedFault) return;
  const delayMs = Number(configuredDelay);
  if (!Number.isInteger(delayMs) || delayMs <= 0 || delayMs > 120_000) return;
  const delayOnce = env.TLSN_TEST_POST_RESULT_DELAY_ONCE ?? env.TLSN_REPLAY_TEST_POST_RESULT_DELAY_ONCE;
  if (delayOnce === "true") {
    if (testPostResultDelayUsed) return;
    testPostResultDelayUsed = true;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

async function delayBeforeResultCommit(env: Bindings, testFault?: TestDirectFault): Promise<void> {
  await delayAtResultCommit(env, testFault, "pause_before_result_commit");
}

async function delayAfterResultCommit(env: Bindings, testFault?: TestDirectFault): Promise<void> {
  await delayAtResultCommit(env, testFault, "pause_after_result_commit");
}

export function decodeBase64Url(value: string, maximumBytes: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("invalid base64url");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  if (binary.length === 0 || binary.length > maximumBytes) {
    throw new Error("base64url value exceeds the configured limit");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) {
    throw new Error("non-canonical base64url");
  }
  return bytes;
}

function hasSameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

const DNS_HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function parseHostnameAllowlist(value: string | undefined): Set<string> | null {
  if (!value) return null;
  const hosts = value
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
  if (hosts.length === 0 || hosts.some((host) => !DNS_HOSTNAME_PATTERN.test(host))) {
    return null;
  }
  return new Set(hosts);
}

function isAllowedProductionHttpsUrl(
  value: string,
  pathname: string,
  allowedHosts: Set<string>,
): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.search === "" &&
      url.hash === "" &&
      allowedHosts.has(url.hostname.toLowerCase()) &&
      url.pathname === pathname
    );
  } catch {
    return false;
  }
}

function containsTestFixtureMarker(value: string): boolean {
  return /(?:^|[._-])(test|synthetic|fixture|local|staging)(?:$|[._-])/i.test(value);
}

function isSafeDeploymentId(value: string | undefined): boolean {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value);
}

function isSafeWorkerName(value: string | undefined): boolean {
  return typeof value === "string" && /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(value);
}

function isSha256Base64Url(value: string | undefined): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function isPublicKeyBase64Url(value: string | undefined): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]{59}$/.test(value);
}

const privateKeyMatchCache = new PrivateKeyValidationCache();

type ConfigValidationObserver = (observation: PrivateKeyValidationObservation) => void;
type ConfigValidationTimingObserver = (component: ConfigValidationComponent, milliseconds: number) => void;

async function readConfig(
  env: Bindings,
  onValidation?: ConfigValidationObserver,
  onTiming?: ConfigValidationTimingObserver,
): Promise<VerifierConfig | null> {
  const production = env.TLSN_ENVIRONMENT === "production";
  const role = env.TLSN_DEPLOYMENT_ROLE;
  const canary = production && role === "canary";
  const replay = !production && role === "replay";
  const configScope = `${env.TLSN_ENVIRONMENT}:${role ?? "default"}`;
  const signingPrivateKey = production
    ? canary ? env.TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8 : env.TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8
    : env.TLSN_RESULT_SIGNING_PRIVATE_KEY_PKCS8;
  const sessionAuthoritySigningPrivateKey = production
    ? canary ? env.TLSN_CANARY_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8 : env.TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8
    : env.TLSN_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8;
  const sessionAuthorityPublicKeySpki = production
    ? canary ? env.TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI : env.TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI
    : env.TLSN_SESSION_AUTHORITY_PUBLIC_KEY_SPKI;
  const sessionAuthorityKeyId = production
    ? canary ? env.TLSN_CANARY_SESSION_AUTHORITY_KEY_ID : env.TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID
    : env.TLSN_SESSION_AUTHORITY_KEY_ID;
  const sessionAuthorityKeyRegistry = production
    ? canary ? env.TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY : env.TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY
    : env.TLSN_SESSION_AUTHORITY_KEY_REGISTRY;
  const bindingAuthoritySigningPrivateKey = production
    ? canary ? env.TLSN_CANARY_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8 : env.TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8
    : env.TLSN_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8;
  const bindingAuthorityPublicKeySpki = production
    ? canary ? env.TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI : env.TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI
    : env.TLSN_BINDING_AUTHORITY_PUBLIC_KEY_SPKI;
  const bindingAuthorityKeyId = production
    ? canary ? env.TLSN_CANARY_BINDING_AUTHORITY_KEY_ID : env.TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID
    : env.TLSN_BINDING_AUTHORITY_KEY_ID;
  const bindingAuthorityKeyRegistry = production
    ? canary ? env.TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY : env.TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY
    : env.TLSN_BINDING_AUTHORITY_KEY_REGISTRY;
  const trustRootCertificateDer = production
    ? canary ? env.TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER : env.TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER
    : env.TLSN_TRUST_ROOT_CERTIFICATE_DER;
  const resultPublicKeySpki = production
    ? canary ? env.TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI : env.TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI
    : env.TLSN_RESULT_PUBLIC_KEY_SPKI;
  const resultSignerKeyId = production
    ? canary ? env.TLSN_CANARY_RESULT_SIGNER_KEY_ID : env.TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID
    : env.TLSN_RESULT_SIGNER_KEY_ID;
  const resultSigningKeyRegistry = production
    ? canary ? env.TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY : env.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY
    : env.TLSN_RESULT_SIGNING_KEY_REGISTRY;
  const schemaValidationStartedAt = onTiming ? performance.now() : undefined;
  const parsed = configSchema.safeParse({
    environment: env.TLSN_ENVIRONMENT,
    serverIdentity: production ? env.TLSN_CANDIDATE_SERVER_IDENTITY : env.TLSN_SERVER_IDENTITY,
    profileSha256: production ? env.TLSN_CANDIDATE_PROFILE_SHA256 : env.TLSN_PROFILE_SHA256,
    sparseProfileSha256: production
      ? env.TLSN_CANDIDATE_SPARSE_PROFILE_SHA256
      : env.TLSN_SPARSE_PROFILE_SHA256,
    verifierKeyId: production ? env.TLSN_CANDIDATE_VERIFIER_KEY_ID : env.TLSN_VERIFIER_KEY_ID,
    notaryKeyId: production ? env.TLSN_CANDIDATE_NOTARY_KEY_ID : env.TLSN_NOTARY_KEY_ID,
    deviceAuthUrl: production ? env.TLSN_CANDIDATE_DEVICE_AUTH_URL : env.TLSN_DEVICE_AUTH_URL,
    devicePossessionAuthUrl: production
      ? env.TLSN_CANDIDATE_DEVICE_POSSESSION_AUTH_URL
      : env.TLSN_DEVICE_POSSESSION_AUTH_URL,
    deviceAuthAllowedHosts: production ? env.TLSN_CANDIDATE_DEVICE_AUTH_ALLOWED_HOSTS : undefined,
    notaryRegistry: production ? env.TLSN_PRODUCTION_NOTARY_REGISTRY : env.TLSN_NOTARY_REGISTRY,
    resultSigningPrivateKeyPkcs8: signingPrivateKey,
    sessionAuthoritySigningPrivateKeyPkcs8: sessionAuthoritySigningPrivateKey,
    sessionAuthorityPublicKeySpki,
    sessionAuthorityKeyId,
    sessionAuthorityKeyRegistry,
    bindingAuthoritySigningPrivateKeyPkcs8: bindingAuthoritySigningPrivateKey,
    bindingAuthorityPublicKeySpki,
    bindingAuthorityKeyId,
    bindingAuthorityKeyRegistry,
    trustRootCertificateDer,
    resultPublicKeySpki,
    resultSignerKeyId,
    resultSigningKeyRegistry,
  });
  if (schemaValidationStartedAt !== undefined) {
    onTiming?.("schema_validation", performance.now() - schemaValidationStartedAt);
  }
  if (!parsed.success) {
    return null;
  }
  try {
    if (!env.TLSN_BINDINGS || !/^[1-9][0-9]{0,3}$/.test(env.TLSN_BINDING_TTL_SECONDS)) {
      return null;
    }
    const bindingTtlSeconds = Number(env.TLSN_BINDING_TTL_SECONDS);
    if (bindingTtlSeconds < 1 || bindingTtlSeconds > 3600) {
      return null;
    }
    if (production && (!canary && role !== "production")) {
      return null;
    }
    if (production && env.TLSN_TEST_BINDING_VALUE) {
      return null;
    }
    if (
      production &&
      !/^[0-9a-f]{40}$/i.test(env.TLSN_GIT_COMMIT_SHA ?? "")
    ) {
      return null;
    }
    if (canary && !/^[A-Za-z0-9_-]{1,512}$/.test(env.TLSN_CANARY_BINDING_VALUE ?? "")) {
      return null;
    }
    if (role === "production" && env.TLSN_CANARY_BINDING_VALUE) {
      return null;
    }
    const forbiddenRoleFields = canary
      ? [env.TLSN_PRODUCTION_RESULT_SIGNING_PRIVATE_KEY_PKCS8, env.TLSN_PRODUCTION_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8, env.TLSN_PRODUCTION_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8, env.TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER, env.TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI, env.TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID, env.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY, env.TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI, env.TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID, env.TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY, env.TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI, env.TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID, env.TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY, env.TLSN_PRODUCTION_DEPLOYMENT_ID, env.TLSN_PRODUCTION_WORKER_NAME]
      : [env.TLSN_CANARY_RESULT_SIGNING_PRIVATE_KEY_PKCS8, env.TLSN_CANARY_SESSION_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8, env.TLSN_CANARY_BINDING_AUTHORITY_SIGNING_PRIVATE_KEY_PKCS8, env.TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER, env.TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI, env.TLSN_CANARY_RESULT_SIGNER_KEY_ID, env.TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY, env.TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI, env.TLSN_CANARY_SESSION_AUTHORITY_KEY_ID, env.TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY, env.TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI, env.TLSN_CANARY_BINDING_AUTHORITY_KEY_ID, env.TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY, env.TLSN_CANARY_DEPLOYMENT_ID, env.TLSN_CANARY_WORKER_NAME];
    if (production && forbiddenRoleFields.some((field) => field !== undefined)) {
      return null;
    }
    if (production && env.TLSN_TEST_AUTH_USERS) {
      return null;
    }
    if (production && (env.TLSN_TEST_DEVICE_ID || env.TLSN_TEST_DEVICE_PUBLIC_KEY)) {
      return null;
    }
    if (
      replay &&
      (!isSafeDeploymentId(env.TLSN_REPLAY_DEPLOYMENT_ID) ||
        !isSafeWorkerName(env.TLSN_REPLAY_WORKER_NAME) ||
        !env.TLSN_TEST_BINDING_VALUE ||
        !env.TLSN_REPLAY_AUTH_USERS ||
        !env.TLSN_REPLAY_DEVICE_ID ||
        !env.TLSN_REPLAY_DEVICE_PUBLIC_KEY ||
        env.TLSN_TEST_AUTH_USERS ||
        env.TLSN_TEST_DEVICE_ID ||
        env.TLSN_TEST_DEVICE_PUBLIC_KEY)
    ) {
      return null;
    }
    const fixtureOnlyCanary = canary && env.TLSN_CANARY_FIXTURE_ONLY === "true";
    if (fixtureOnlyCanary && parsed.data.serverIdentity !== "game.example.test") {
      return null;
    }
    if (
      production &&
      (!isSafeDeploymentId(canary ? env.TLSN_CANARY_DEPLOYMENT_ID : env.TLSN_PRODUCTION_DEPLOYMENT_ID) ||
        !isSha256Base64Url(env.TLSN_SECURITY_REGISTRY_SET_SHA256) ||
        (!fixtureOnlyCanary && (
          containsTestFixtureMarker(parsed.data.verifierKeyId) ||
          containsTestFixtureMarker(parsed.data.notaryKeyId) ||
          containsTestFixtureMarker(parsed.data.serverIdentity)
        )))
    ) {
      return null;
    }
    if (production && !parsed.data.trustRootCertificateDer) {
      return null;
    }
    const resultIdentityConfigured = Boolean(
      parsed.data.resultPublicKeySpki || parsed.data.resultSignerKeyId || parsed.data.resultSigningKeyRegistry,
    );
    if (resultIdentityConfigured) {
      if (!isPublicKeyBase64Url(parsed.data.resultPublicKeySpki) || !parsed.data.resultSignerKeyId || !parsed.data.resultSigningKeyRegistry) {
        return null;
      }
      const resultRegistryParsingStartedAt = onTiming ? performance.now() : undefined;
      const resultRegistry = resultSigningKeyRegistrySchema.safeParse(JSON.parse(parsed.data.resultSigningKeyRegistry ?? ""));
      if (resultRegistryParsingStartedAt !== undefined) {
        onTiming?.("registry_parsing", performance.now() - resultRegistryParsingStartedAt);
      }
      if (!resultRegistry.success) return null;
      const resultRegistryLookupStartedAt = onTiming ? performance.now() : undefined;
      const currentResultKey = resultRegistry.data.keys.find((key) => key.key_id === parsed.data.resultSignerKeyId);
      const now = Date.now();
      const resultRegistryInvalid = Boolean(
        !currentResultKey ||
        currentResultKey.public_key_spki !== parsed.data.resultPublicKeySpki ||
        currentResultKey.status !== "ACTIVE" ||
        Date.parse(currentResultKey.not_before) > now ||
        (currentResultKey.not_after !== null && Date.parse(currentResultKey.not_after) < now)
      );
      if (resultRegistryLookupStartedAt !== undefined) {
        onTiming?.("registry_lookup", performance.now() - resultRegistryLookupStartedAt);
      }
      if (resultRegistryInvalid) return null;
    }
    const authorityRegistryParsingStartedAt = onTiming ? performance.now() : undefined;
    const sessionRegistry = authorityKeyRegistrySchema.safeParse(JSON.parse(parsed.data.sessionAuthorityKeyRegistry));
    const bindingRegistry = authorityKeyRegistrySchema.safeParse(JSON.parse(parsed.data.bindingAuthorityKeyRegistry));
    if (authorityRegistryParsingStartedAt !== undefined) {
      onTiming?.("registry_parsing", performance.now() - authorityRegistryParsingStartedAt);
    }
    const now = Date.now();
    const authorityRegistryLookupStartedAt = onTiming ? performance.now() : undefined;
    const currentSessionKey = sessionRegistry.success
      ? sessionRegistry.data.keys.find((key) => key.key_id === parsed.data.sessionAuthorityKeyId)
      : null;
    const currentBindingKey = bindingRegistry.success
      ? bindingRegistry.data.keys.find((key) => key.key_id === parsed.data.bindingAuthorityKeyId)
      : null;
    const authorityRegistryInvalid = (
      !sessionRegistry.success ||
      sessionRegistry.data.scope !== "tlsn-session-authority-key-registry" ||
      !currentSessionKey ||
      currentSessionKey.public_key_spki !== parsed.data.sessionAuthorityPublicKeySpki ||
      currentSessionKey.status !== "ACTIVE" ||
      Date.parse(currentSessionKey.not_before) > now ||
      (currentSessionKey.not_after !== null && Date.parse(currentSessionKey.not_after) < now) ||
      !bindingRegistry.success ||
      bindingRegistry.data.scope !== "tlsn-binding-authority-key-registry" ||
      !currentBindingKey ||
      currentBindingKey.public_key_spki !== parsed.data.bindingAuthorityPublicKeySpki ||
      currentBindingKey.status !== "ACTIVE" ||
      Date.parse(currentBindingKey.not_before) > now ||
      (currentBindingKey.not_after !== null && Date.parse(currentBindingKey.not_after) < now)
    );
    if (authorityRegistryLookupStartedAt !== undefined) {
      onTiming?.("registry_lookup", performance.now() - authorityRegistryLookupStartedAt);
    }
    if (authorityRegistryInvalid) return null;
    if (
      parsed.data.sessionAuthorityPublicKeySpki === parsed.data.bindingAuthorityPublicKeySpki ||
      (resultIdentityConfigured && (
        parsed.data.resultPublicKeySpki === parsed.data.sessionAuthorityPublicKeySpki ||
        parsed.data.resultPublicKeySpki === parsed.data.bindingAuthorityPublicKeySpki
      ))
    ) return null;
    if (production) {
      const hostnameAllowlistStartedAt = onTiming ? performance.now() : undefined;
      const deviceAuthAllowedHosts = parseHostnameAllowlist(parsed.data.deviceAuthAllowedHosts);
      const supabaseAllowedHosts = parseHostnameAllowlist(env.TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS);
      if (hostnameAllowlistStartedAt !== undefined) {
        onTiming?.("hostname_allowlist", performance.now() - hostnameAllowlistStartedAt);
      }
      if (
        !deviceAuthAllowedHosts ||
        !supabaseAllowedHosts ||
        !isAllowedProductionHttpsUrl(
          parsed.data.deviceAuthUrl,
          "/api/auth/anonymous-sync/v2/device-proof",
          deviceAuthAllowedHosts,
        ) ||
        !isAllowedProductionHttpsUrl(
          parsed.data.devicePossessionAuthUrl,
          "/api/auth/anonymous-sync/v2/tlsn-device-proof",
          deviceAuthAllowedHosts,
        ) ||
        !isAllowedProductionHttpsUrl(
          env.TLSN_CANDIDATE_SUPABASE_URL ?? "",
          "/",
          supabaseAllowedHosts,
        )
      ) {
        return null;
      }
    }
    const notaryRegistryParsingStartedAt = onTiming ? performance.now() : undefined;
    const notaryRegistry = notaryRegistrySchema.safeParse(JSON.parse(parsed.data.notaryRegistry));
    if (notaryRegistryParsingStartedAt !== undefined) {
      onTiming?.("registry_parsing", performance.now() - notaryRegistryParsingStartedAt);
    }
    if (!notaryRegistry.success) {
      return null;
    }
    const notaryRegistryLookupStartedAt = onTiming ? performance.now() : undefined;
    const notaryKeyValue = notaryRegistry.data[parsed.data.notaryKeyId];
    if (notaryRegistryLookupStartedAt !== undefined) {
      onTiming?.("registry_lookup", performance.now() - notaryRegistryLookupStartedAt);
    }
    if (!notaryKeyValue) {
      return null;
    }
    const base64DecodingStartedAt = onTiming ? performance.now() : undefined;
    const profileSha256Bytes = decodeBase64Url(parsed.data.profileSha256, 32);
    if (profileSha256Bytes.length !== 32) {
      return null;
    }
    const sparseProfileSha256Bytes = parsed.data.sparseProfileSha256
      ? decodeBase64Url(parsed.data.sparseProfileSha256, 32)
      : undefined;
    if (sparseProfileSha256Bytes && sparseProfileSha256Bytes.length !== 32) {
      return null;
    }
    const notaryKeyBytes = decodeBase64Url(notaryKeyValue, 4096);
    const resultSigningPrivateKeyBytes = decodeBase64Url(parsed.data.resultSigningPrivateKeyPkcs8, 4096);
    const sessionAuthoritySigningPrivateKeyBytes = decodeBase64Url(parsed.data.sessionAuthoritySigningPrivateKeyPkcs8, 4096);
    const bindingAuthoritySigningPrivateKeyBytes = decodeBase64Url(parsed.data.bindingAuthoritySigningPrivateKeyPkcs8, 4096);
    if (base64DecodingStartedAt !== undefined) {
      onTiming?.("base64_decoding", performance.now() - base64DecodingStartedAt);
    }
    const validateKeyPair = async (
      privateKeyBytes: Uint8Array,
      publicKeySpki: string,
      authorityScope: string,
    ): Promise<boolean> => {
      const observation = await privateKeyMatchCache.validate(
        privateKeyBytes,
        publicKeySpki,
        `${configScope}:${authorityScope}`,
      );
      onValidation?.(observation);
      return observation.valid;
    };
    if (
      !await validateKeyPair(sessionAuthoritySigningPrivateKeyBytes, parsed.data.sessionAuthorityPublicKeySpki, "session-authority") ||
      !await validateKeyPair(bindingAuthoritySigningPrivateKeyBytes, parsed.data.bindingAuthorityPublicKeySpki, "binding-authority") ||
      (resultIdentityConfigured && !await validateKeyPair(resultSigningPrivateKeyBytes, parsed.data.resultPublicKeySpki ?? "", "result-signer"))
    ) {
      return null;
    }
    const trustRootDecodingStartedAt = onTiming && parsed.data.trustRootCertificateDer
      ? performance.now()
      : undefined;
    const trustRootCertificateDerBytes = parsed.data.trustRootCertificateDer
      ? decodeBase64Url(parsed.data.trustRootCertificateDer, 4096)
      : undefined;
    if (trustRootDecodingStartedAt !== undefined) {
      onTiming?.("base64_decoding", performance.now() - trustRootDecodingStartedAt);
    }
    return {
      ...parsed.data,
      profileSha256Bytes,
      sparseProfileSha256Bytes,
      notaryKeyBytes,
      resultSigningPrivateKeyBytes,
      sessionAuthoritySigningPrivateKeyBytes,
      bindingAuthoritySigningPrivateKeyBytes,
      trustRootCertificateDerBytes,
      bindingTtlSeconds,
    };
  } catch {
    return null;
  }
}

async function ensureWasmInitialized(): Promise<void> {
  wasmInitialization ??= initVerifier({ module_or_path: wasmModule }).then(() => undefined);
  return wasmInitialization;
}

type VerificationProfile = "complete" | "sparse";

function verifyPresentationToPreparedResult(
  config: VerifierConfig,
  profile: VerificationProfile,
  presentationBytes: Uint8Array,
  canonicalUserId: string,
  deviceId: string,
  deviceChallengeBytes: Uint8Array,
): z.infer<typeof preparedResultSchema> {
  const preparedJson = profile === "sparse"
    ? config.sparseProfileSha256Bytes
      ? config.trustRootCertificateDerBytes
        ? verify_sparse_require_info_presentation_with_trust_anchor(
            presentationBytes,
            config.serverIdentity,
            config.sparseProfileSha256Bytes,
            config.verifierKeyId,
            config.notaryKeyId,
            canonicalUserId,
            deviceId,
            deviceChallengeBytes,
            config.trustRootCertificateDerBytes,
            config.notaryKeyBytes,
          )
        : verify_sparse_require_info_presentation(
            presentationBytes,
            config.serverIdentity,
            config.sparseProfileSha256Bytes,
            config.verifierKeyId,
            config.notaryKeyId,
            canonicalUserId,
            deviceId,
            deviceChallengeBytes,
            config.notaryKeyBytes,
          )
      : (() => {
          throw new Error("sparse verifier is unconfigured");
        })()
    : config.trustRootCertificateDerBytes
      ? verify_require_info_presentation_with_trust_anchor(
          presentationBytes,
          config.serverIdentity,
          config.profileSha256Bytes,
          config.verifierKeyId,
          config.notaryKeyId,
          canonicalUserId,
          deviceId,
          deviceChallengeBytes,
          config.trustRootCertificateDerBytes,
          config.notaryKeyBytes,
        )
      : verify_require_info_presentation(
          presentationBytes,
          config.serverIdentity,
          config.profileSha256Bytes,
          config.verifierKeyId,
          config.notaryKeyId,
          canonicalUserId,
          deviceId,
          deviceChallengeBytes,
          config.notaryKeyBytes,
        );
  return preparedResultSchema.parse(JSON.parse(preparedJson) as unknown);
}

async function signSigningBytes(
  signingBytes: Uint8Array,
  privateKeyBytes: Uint8Array,
): Promise<Uint8Array> {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    signingBytes,
  );
  return new Uint8Array(signature);
}

function hasPrefix(bytes: Uint8Array, prefix: string): boolean {
  const encoded = new TextEncoder().encode(prefix);
  return encoded.every((value, index) => bytes[index] === value);
}

async function signSessionAuthorityReceipt(config: VerifierConfig, signingBytes: Uint8Array): Promise<Uint8Array> {
  if (!hasPrefix(signingBytes, "FUSOU-ATTESTATION-SESSION-V1\0")) {
    throw new Error("Session Authority received a non-session receipt payload");
  }
  return signSigningBytes(signingBytes, config.sessionAuthoritySigningPrivateKeyBytes);
}

async function signBindingAuthorityReceipt(config: VerifierConfig, signingBytes: Uint8Array): Promise<Uint8Array> {
  if (!hasPrefix(signingBytes, "FUSOU-ATTESTATION-CONSUME-V1\0")) {
    throw new Error("Binding Authority received a non-consume receipt payload");
  }
  return signSigningBytes(signingBytes, config.bindingAuthoritySigningPrivateKeyBytes);
}

async function signResult(config: VerifierConfig, signingBytes: Uint8Array): Promise<Uint8Array> {
  if (!hasPrefix(signingBytes, "FUSOU-VERIFIER-RESULT-V1\0")) {
    throw new Error("Result Signer received a non-Result payload");
  }
  return signSigningBytes(signingBytes, config.resultSigningPrivateKeyBytes);
}

async function signSparseResult(config: VerifierConfig, signingBytes: Uint8Array): Promise<Uint8Array> {
  if (!hasPrefix(signingBytes, "FUSOU-VERIFIER-SPARSE-RESULT-V1\0")) {
    throw new Error("Result Signer received a non-sparse Result payload");
  }
  return signSigningBytes(signingBytes, config.resultSigningPrivateKeyBytes);
}

async function signSessionReceipt(
  config: VerifierConfig,
  record: {
    session_id: string;
    canonical_user_id: string;
    device_id: string;
    device_auth_nonce: string;
    nonce: string;
    tlsn_device_challenge: string;
    binding_value: string;
    created_at: string;
    expires_at: string;
  },
): Promise<Record<string, string | number>> {
  const signerKeyId = config.sessionAuthorityKeyId;
  const signature = await signSessionAuthorityReceipt(
    config,
    attestationSessionReceiptSigningBytes({
      signerKeyId,
      sessionId: record.session_id,
      canonicalUserId: record.canonical_user_id,
      deviceId: record.device_id,
      deviceAuthNonce: record.device_auth_nonce,
      nonce: record.nonce,
      deviceChallenge: record.tlsn_device_challenge,
      bindingValue: record.binding_value,
      createdAt: record.created_at,
      expiresAt: record.expires_at,
    }),
  );
  return {
    schema_version: 1,
    type: "attestation-session-issued",
    signer_key_id: signerKeyId,
    signature_algorithm: "Ed25519",
    session_id: record.session_id,
    canonical_user_id: record.canonical_user_id,
    device_id: record.device_id,
    device_auth_nonce: record.device_auth_nonce,
    nonce: record.nonce,
    device_challenge: record.tlsn_device_challenge,
    binding_value: record.binding_value,
    created_at: record.created_at,
    expires_at: record.expires_at,
    signature: encodeBase64Url(signature),
  };
}

async function signConsumeReceipt(
  config: VerifierConfig,
  record: {
    session_id: string;
    canonical_user_id: string;
    device_id: string;
    nonce: string;
    binding_value: string;
    presentation_id?: string;
    used_at?: string;
  },
): Promise<Record<string, string | number>> {
  if (!record.presentation_id || !record.used_at) {
    throw new Error("consumed binding is missing receipt fields");
  }
  const signerKeyId = config.bindingAuthorityKeyId;
  const signature = await signBindingAuthorityReceipt(
    config,
    attestationConsumeReceiptSigningBytes({
      signerKeyId,
      sessionId: record.session_id,
      canonicalUserId: record.canonical_user_id,
      deviceId: record.device_id,
      nonce: record.nonce,
      bindingValue: record.binding_value,
      presentationId: record.presentation_id,
      usedAt: record.used_at,
    }),
  );
  return {
    schema_version: 1,
    type: "attestation-binding-consumed",
    signer_key_id: signerKeyId,
    signature_algorithm: "Ed25519",
    session_id: record.session_id,
    canonical_user_id: record.canonical_user_id,
    device_id: record.device_id,
    nonce: record.nonce,
    binding_value: record.binding_value,
    presentation_id: record.presentation_id,
    used_at: record.used_at,
    signature: encodeBase64Url(signature),
  };
}

export async function readRawBytes(request: Request, maximumBytes: number): Promise<Uint8Array> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null && Number(contentLength) > maximumBytes) {
    throw new Error("request body is too large");
  }
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.length === 0 || raw.length > maximumBytes) {
    throw new Error("request body is too large");
  }
  return raw;
}

export async function readRawBody(request: Request, maximumBytes: number): Promise<string> {
  const raw = await readRawBytes(request, maximumBytes);
  const body = new TextDecoder().decode(raw);
  if (new TextEncoder().encode(body).byteLength !== raw.byteLength) {
    throw new Error("request body is not valid UTF-8");
  }
  return body;
}

async function readJsonBody(request: Request): Promise<unknown> {
  const raw = await readRawBody(request, MAX_REQUEST_JSON_BYTES);
  return JSON.parse(raw) as unknown;
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization")?.trim();
  const match = header ? /^Bearer ([^\s]+)$/.exec(header) : null;
  return match?.[1] ?? null;
}

function authenticationFailure(
  error: "unauthorized" | "auth_unconfigured",
): AuthenticationResult {
  return { ok: false, status: error === "unauthorized" ? 401 : 503, error };
}

async function authenticateRequest(
  request: Request,
  env: Bindings,
): Promise<AuthenticationResult> {
  const token = extractBearerToken(request);
  const syntheticAuthUsers = env.TLSN_DEPLOYMENT_ROLE === "replay"
    ? env.TLSN_REPLAY_AUTH_USERS
    : env.TLSN_TEST_AUTH_USERS;
  if (env.TLSN_ENVIRONMENT === "test" && syntheticAuthUsers) {
    try {
      const users = testAuthUsersSchema.parse(JSON.parse(syntheticAuthUsers));
      const user = token ? users[token] : undefined;
      if (!token || !user || user.is_anonymous === true) {
        return authenticationFailure("unauthorized");
      }
      return { ok: true, subject: { canonicalUserId: user.id, accessToken: token } };
    } catch {
      return authenticationFailure("auth_unconfigured");
    }
  }

  const supabaseUrl = (env.TLSN_ENVIRONMENT === "production"
    ? env.TLSN_CANDIDATE_SUPABASE_URL
    : env.TLSN_SUPABASE_URL)?.replace(/\/$/, "");
  const publishableKey = env.TLSN_ENVIRONMENT === "production"
    ? env.TLSN_CANDIDATE_SUPABASE_PUBLISHABLE_KEY
    : env.TLSN_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) {
    return authenticationFailure("auth_unconfigured");
  }
  if (!token) {
    return authenticationFailure("unauthorized");
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      redirect: "manual",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      return authenticationFailure("unauthorized");
    }
    const user = authUserSchema.parse(await response.json());
    if (user.is_anonymous === true) {
      return authenticationFailure("unauthorized");
    }
    return { ok: true, subject: { canonicalUserId: user.id, accessToken: token } };
  } catch {
    return authenticationFailure("unauthorized");
  }
}

type DeviceAuthenticationResult =
  | { ok: true; canonicalUserId: string; deviceId: string }
  | {
      ok: false;
      status: 401 | 403 | 409 | 503;
      error:
        | "device_auth_unconfigured"
        | "device_unauthorized"
        | "device_owner_mismatch"
        | "device_revoked"
        | "device_nonce_invalid"
        | "device_nonce_replayed"
        | "device_auth_unavailable";
    };

type DevicePossessionAuthenticationResult =
  | { ok: true; canonicalUserId: string; deviceId: string; replayDigestHex: string }
  | {
      ok: false;
      status: 401 | 403 | 409 | 503;
      error:
        | "device_possession_unauthorized"
        | "device_possession_owner_mismatch"
        | "device_possession_revoked"
        | "device_possession_replayed"
        | "device_possession_unavailable";
    };

const deviceProofResponseSchema = z
  .object({
    authenticated: z.literal(true),
    canonical_user_id: z.string().uuid(),
    device_id: z.string().uuid(),
  })
  .strict();

const tlsnDeviceProofResponseSchema = deviceProofResponseSchema.extend({
  replay_digest_hex: z.string().regex(/^[a-f0-9]{64}$/),
});

async function authenticateDeviceProof(
  subject: AuthenticatedSubject,
  proof: z.infer<typeof deviceProofRequestSchema>,
  endpoint: string,
): Promise<DeviceAuthenticationResult> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${subject.accessToken}`,
      },
      body: JSON.stringify(proof),
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: 503, error: "device_auth_unavailable" };
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(payload).data?.error;
      if (response.status === 403) {
        return { ok: false, status: 403, error: "device_owner_mismatch" };
      }
      if (response.status === 409 && error === "device_revoked") {
        return { ok: false, status: 409, error: "device_revoked" };
      }
      if (response.status === 409 && error === "nonce_already_used") {
        return { ok: false, status: 409, error: "device_nonce_replayed" };
      }
      if (response.status === 401 && error === "nonce_invalid_or_expired") {
        return { ok: false, status: 401, error: "device_nonce_invalid" };
      }
      if (response.status >= 500) {
        return { ok: false, status: 503, error: "device_auth_unavailable" };
      }
      return { ok: false, status: 401, error: "device_unauthorized" };
    }
    const parsed = deviceProofResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.canonical_user_id !== subject.canonicalUserId) {
      return { ok: false, status: 403, error: "device_owner_mismatch" };
    }
    if (parsed.data.device_id !== proof.device_id) {
      return { ok: false, status: 403, error: "device_owner_mismatch" };
    }
    return {
      ok: true,
      canonicalUserId: parsed.data.canonical_user_id,
      deviceId: parsed.data.device_id,
    };
  } catch {
    return { ok: false, status: 503, error: "device_auth_unavailable" };
  }
}

function testDeviceAuthenticationEnabled(env: Bindings): boolean {
  const device = configuredTestDevice(env);
  return env.TLSN_ENVIRONMENT === "test" &&
    Boolean(device?.id) &&
    Boolean(device?.publicKey);
}

function configuredTestDevice(env: Bindings): { id: string; publicKey: string } | null {
  const id = env.TLSN_DEPLOYMENT_ROLE === "replay"
    ? env.TLSN_REPLAY_DEVICE_ID?.trim()
    : env.TLSN_TEST_DEVICE_ID?.trim();
  const publicKey = env.TLSN_DEPLOYMENT_ROLE === "replay"
    ? env.TLSN_REPLAY_DEVICE_PUBLIC_KEY?.trim()
    : env.TLSN_TEST_DEVICE_PUBLIC_KEY?.trim();
  return id && publicKey ? { id, publicKey } : null;
}

function rememberTestDeviceValue(values: Set<string>, value: string): boolean {
  if (values.has(value)) return false;
  values.add(value);
  if (values.size > 4096) {
    const oldest = values.values().next().value;
    if (typeof oldest === "string") values.delete(oldest);
  }
  return true;
}

async function verifyTestDeviceSignature(
  publicKey: string,
  message: Uint8Array,
  signature: string,
): Promise<boolean> {
  try {
    const publicKeyBytes = decodeBase64Url(publicKey, 32);
    const signatureBytes = decodeBase64Url(signature, 64);
    if (publicKeyBytes.length !== 32 || signatureBytes.length !== 64) return false;
    const key = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signatureBytes,
      message,
    );
  } catch {
    return false;
  }
}

function testTlsnDeviceProofMessage(proof: {
  device_id: string;
  session_id: string;
  binding_value: string;
  challenge: string;
}): Uint8Array {
  const encoder = new TextEncoder();
  const chunks = [encoder.encode("FUSOU-TLSN-DEVICE-PROOF-V1\0")];
  for (const value of [
    encoder.encode(proof.device_id),
    encoder.encode(proof.session_id),
    encoder.encode(proof.binding_value),
    decodeBase64Url(proof.challenge, 32),
  ]) {
    const length = new Uint8Array([value.length >> 8, value.length & 0xff]);
    chunks.push(length, value);
  }
  const message = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    message.set(chunk, offset);
    offset += chunk.length;
  }
  return message;
}

async function deviceProofReplayDigestHex(proof: {
  device_id: string;
  session_id: string;
  binding_value: string;
  challenge: string;
}): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", testTlsnDeviceProofMessage(proof));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function authenticateTestDeviceProof(
  subject: AuthenticatedSubject,
  proof: z.infer<typeof deviceProofRequestSchema>,
  env: Bindings,
): Promise<DeviceAuthenticationResult> {
  const device = configuredTestDevice(env);
  if (!testDeviceAuthenticationEnabled(env) || !device || proof.device_id !== device.id) {
    return { ok: false, status: 503, error: "device_auth_unconfigured" };
  }
  const valid = await verifyTestDeviceSignature(
    device.publicKey,
    new TextEncoder().encode(proof.nonce),
    proof.sig,
  );
  if (!valid) return { ok: false, status: 401, error: "device_unauthorized" };
  if (!rememberTestDeviceValue(testDeviceAuthNonces, `${subject.canonicalUserId}\0${proof.nonce}`)) {
    return { ok: false, status: 409, error: "device_nonce_replayed" };
  }
  return {
    ok: true,
    canonicalUserId: subject.canonicalUserId,
    deviceId: proof.device_id,
  };
}

async function authenticateTestTlsnDeviceProof(
  subject: AuthenticatedSubject,
  proof: {
    device_id: string;
    session_id: string;
    binding_value: string;
    challenge: string;
    sig: string;
  },
  env: Bindings,
  expectedReplayDigestHex?: string,
): Promise<DevicePossessionAuthenticationResult> {
  const device = configuredTestDevice(env);
  if (!testDeviceAuthenticationEnabled(env) || !device) {
    return { ok: false, status: 503, error: "device_possession_unavailable" };
  }
  if (proof.device_id !== device.id) {
    return { ok: false, status: 403, error: "device_possession_owner_mismatch" };
  }
  let message: Uint8Array;
  try {
    message = testTlsnDeviceProofMessage(proof);
  } catch {
    return { ok: false, status: 401, error: "device_possession_unauthorized" };
  }
  const replayDigestHex = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", message)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const valid = await verifyTestDeviceSignature(device.publicKey, message, proof.sig);
  if (!valid) return { ok: false, status: 401, error: "device_possession_unauthorized" };
  const firstUse = rememberTestDeviceValue(testDeviceProofDigests, `${subject.canonicalUserId}\0${replayDigestHex}`);
  if (!firstUse && replayDigestHex !== expectedReplayDigestHex) {
    return { ok: false, status: 409, error: "device_possession_replayed" };
  }
  return {
    ok: true,
    canonicalUserId: subject.canonicalUserId,
    deviceId: proof.device_id,
    replayDigestHex,
  };
}

async function authenticateTlsnDeviceProof(
  subject: AuthenticatedSubject,
  proof: {
    device_id: string;
    session_id: string;
    binding_value: string;
    challenge: string;
    sig: string;
  },
  endpoint: string,
  expectedReplayDigestHex?: string,
): Promise<DevicePossessionAuthenticationResult> {
  let replayDigestHex: string | undefined;
  if (expectedReplayDigestHex) {
    try {
      const message = testTlsnDeviceProofMessage(proof);
      replayDigestHex = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", message)))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      return { ok: false, status: 401, error: "device_possession_unauthorized" };
    }
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${subject.accessToken}`,
      },
      body: JSON.stringify(proof),
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: 503, error: "device_possession_unavailable" };
    }
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(payload).data?.error;
      if (response.status === 403) {
        return { ok: false, status: 403, error: "device_possession_owner_mismatch" };
      }
      if (response.status === 409 && error === "device_revoked") {
        return { ok: false, status: 409, error: "device_possession_revoked" };
      }
      if (response.status === 409 && error === "device_proof_replayed") {
        if (replayDigestHex && replayDigestHex === expectedReplayDigestHex) {
          return {
            ok: true,
            canonicalUserId: subject.canonicalUserId,
            deviceId: proof.device_id,
            replayDigestHex,
          };
        }
        return { ok: false, status: 409, error: "device_possession_replayed" };
      }
      if (response.status >= 500) {
        return { ok: false, status: 503, error: "device_possession_unavailable" };
      }
      return { ok: false, status: 401, error: "device_possession_unauthorized" };
    }
    const parsed = tlsnDeviceProofResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.canonical_user_id !== subject.canonicalUserId) {
      return { ok: false, status: 403, error: "device_possession_owner_mismatch" };
    }
    if (parsed.data.device_id !== proof.device_id) {
      return { ok: false, status: 403, error: "device_possession_owner_mismatch" };
    }
    return {
      ok: true,
      canonicalUserId: parsed.data.canonical_user_id,
      deviceId: parsed.data.device_id,
      replayDigestHex: parsed.data.replay_digest_hex,
    };
  } catch {
    return { ok: false, status: 503, error: "device_possession_unavailable" };
  }
}

function requireAuthentication(
  result: AuthenticationResult,
): Response | AuthenticatedSubject {
  return result.ok ? result.subject : Response.json({ error: result.error }, { status: result.status });
}

type BindingAuthorityHttpStatus = 409 | 410 | 422 | 503;

function bindingAuthorityStatus(error: unknown): BindingAuthorityHttpStatus {
  if (!(error instanceof BindingAuthorityError)) {
    return 422;
  }
  switch (error.code) {
    case "authority_unavailable":
      return 503;
    case "binding_expired":
      return 410;
    case "binding_consumed":
    case "binding_conflict":
    case "session_mismatch":
    case "user_mismatch":
    case "device_mismatch":
    case "nonce_mismatch":
      return 409;
    default:
      return 422;
  }
}

type TriggerExecutionConfig = {
  apiUrl: string;
  taskId: string;
  secretKey: string;
  callbackSecret: string;
  maxAttempts: number;
};

function triggerExecutionConfig(env: Bindings): TriggerExecutionConfig | null {
  const production = env.TLSN_ENVIRONMENT === "production";
  const canary = env.TLSN_DEPLOYMENT_ROLE === "canary";
  const apiUrl = (production
    ? canary ? env.TLSN_CANARY_TRIGGER_API_URL : env.TLSN_PRODUCTION_TRIGGER_API_URL
    : env.TLSN_TRIGGER_API_URL)?.replace(/\/$/, "");
  const taskId = (production
    ? canary ? env.TLSN_CANARY_TRIGGER_TASK_ID : env.TLSN_PRODUCTION_TRIGGER_TASK_ID
    : env.TLSN_TRIGGER_TASK_ID)?.trim();
  const secretKey = (production
    ? canary ? env.TLSN_CANARY_TRIGGER_SECRET_KEY : env.TLSN_PRODUCTION_TRIGGER_SECRET_KEY
    : env.TLSN_TRIGGER_SECRET_KEY)?.trim();
  const callbackSecret = (production
    ? canary ? env.TLSN_CANARY_TRIGGER_CALLBACK_SECRET : env.TLSN_PRODUCTION_TRIGGER_CALLBACK_SECRET
    : env.TLSN_TRIGGER_CALLBACK_SECRET)?.trim();
  const localTestApi = env.TLSN_ENVIRONMENT === "test" && typeof apiUrl === "string" && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?$/.test(apiUrl);
  if (
    !apiUrl ||
    !taskId ||
    !secretKey ||
    !callbackSecret ||
    (!/^https:\/\//.test(apiUrl) && !localTestApi) ||
    !/^[A-Za-z0-9._:-]{1,256}$/.test(taskId)
  ) {
    return null;
  }
  return {
    apiUrl,
    taskId,
    secretKey,
    callbackSecret,
    maxAttempts: env.TLSN_ENVIRONMENT === "test" ? 1 : 3,
  };
}

function shouldUseTriggerExecution(env: Bindings): boolean {
  return env.TLSN_ENVIRONMENT === "production" || env.TLSN_EXECUTION_MODE === "trigger";
}

function shouldUseQueueExecution(env: Bindings): boolean {
  return env.TLSN_ENVIRONMENT === "test" && env.TLSN_EXECUTION_MODE === "queue";
}

function shouldUseDirectExecution(env: Bindings): boolean {
  return env.TLSN_ENVIRONMENT === "test" && env.TLSN_EXECUTION_MODE === "direct";
}

function shouldUseSynchronousDirectResponse(env: Bindings): boolean {
  return shouldUseDirectExecution(env) && env.TLSN_TEST_DIRECT_SYNCHRONOUS_CANDIDATE === "true";
}

function triggerCallbackSecret(env: Bindings): string | undefined {
  if (env.TLSN_ENVIRONMENT !== "production") return env.TLSN_TRIGGER_CALLBACK_SECRET;
  return env.TLSN_DEPLOYMENT_ROLE === "canary"
    ? env.TLSN_CANARY_TRIGGER_CALLBACK_SECRET
    : env.TLSN_PRODUCTION_TRIGGER_CALLBACK_SECRET;
}

function queueCallbackSecret(env: Bindings): string | undefined {
  return env.TLSN_ENVIRONMENT === "test" ? env.TLSN_QUEUE_CALLBACK_SECRET : undefined;
}

export function canarySynchronousResponseEnabled(env: Bindings): boolean {
  return env.TLSN_ENVIRONMENT === "production"
    && env.TLSN_DEPLOYMENT_ROLE === "canary"
    && env.TLSN_CANARY_SYNCHRONOUS_RESPONSE_ENABLED === "true";
}

function directCallbackSecret(env: Bindings): string | undefined {
  if (env.TLSN_ENVIRONMENT === "test") return env.TLSN_DIRECT_CALLBACK_SECRET;
  return env.TLSN_ENVIRONMENT === "production" && env.TLSN_DEPLOYMENT_ROLE === "canary"
    ? env.TLSN_CANARY_DIRECT_CALLBACK_SECRET
    : undefined;
}

function internalRequestAuthFailure(
  c: Context<{ Bindings: Bindings }>,
  reason: "callback_secret_unconfigured" | "signature_invalid" | "signature_mismatch",
): Response {
  if (c.env.TLSN_ENVIRONMENT === "test" && c.req.header("X-FUSOU-TLSN-Diagnostic") === "hmac") {
    return c.json({ error: reason }, 401);
  }
  return c.json({ error: "unauthorized" }, 401);
}

async function enqueueTriggerVerification(
  config: TriggerExecutionConfig,
  payload: VerificationTaskPayload,
): Promise<unknown> {
  const response = await fetch(
    `${config.apiUrl}/api/v1/tasks/${encodeURIComponent(config.taskId)}/trigger`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.secretKey}`,
      },
      body: JSON.stringify({
        payload,
        options: {
          idempotencyKey: payload.job_id,
          queue: { name: "tlsn-verification", concurrencyLimit: 2 },
          machine: "medium-1x",
          maxAttempts: config.maxAttempts,
          maxDuration: 600,
        },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Trigger enqueue failed with status ${response.status}`);
  }
  return response.json().catch(() => null);
}

async function enqueueQueueVerification(
  queue: Queue<VerificationQueueMessage>,
  message: VerificationQueueMessage,
): Promise<void> {
  await queue.send(message);
}

async function finalizeVerificationFailure(
  env: Bindings,
  input: {
    bindingId: string;
    sessionId: string;
    canonicalUserId: string;
    deviceId: string;
    jobId: string;
    verificationAttemptId?: string;
    failureCode: VerificationFailureCode;
    benchmarkPersistenceStartedAt?: string;
    benchmarkPersistenceRemainingMilliseconds?: number;
  },
): Promise<boolean> {
  const authority = new DurableObjectBindingAuthority(env.TLSN_BINDINGS);
  try {
    const record = await authority.failVerification(input.bindingId, {
      session_id: input.sessionId,
      canonical_user_id: input.canonicalUserId,
      device_id: input.deviceId,
      verification_job_id: input.jobId,
      ...(input.verificationAttemptId ? { verification_attempt_id: input.verificationAttemptId } : {}),
      failure_code: input.failureCode,
      now: Date.now(),
      benchmark_timing: benchmarkEnabled(env),
      ...(input.benchmarkPersistenceStartedAt
        ? { benchmark_persistence_started_at: input.benchmarkPersistenceStartedAt }
        : {}),
      ...(input.benchmarkPersistenceRemainingMilliseconds !== undefined
        ? { benchmark_persistence_remaining_ms: input.benchmarkPersistenceRemainingMilliseconds }
        : {}),
    });
    benchmarkAuthorityLeaseMetadata(env, input.jobId, record);
    return true;
  } catch {
    return false;
  }
}

async function dispatchDirectVerification(
  env: Bindings,
  jobId: string,
  payload: VerificationTaskPayload,
  presentationId: string,
  verificationAttemptId: string,
  presentationBytes: Uint8Array,
  requestDirectDispatchStartedAt: number | undefined,
  testFault: TestDirectFault | undefined,
  synchronousCandidate = false,
): Promise<Response> {
  const verifier = env.TLSN_DIRECT_VERIFIER;
  const callbackSecret = directCallbackSecret(env);
  if (!verifier || !callbackSecret) {
    throw new Error("direct verifier is unconfigured");
  }
  const callbackBody = JSON.stringify({
    job_id: payload.job_id,
    binding_id: payload.binding_id,
    session_id: payload.session_id,
    canonical_user_id: payload.canonical_user_id,
    device_id: payload.device_id,
    presentation_id: presentationId,
    execution_mode: "direct",
    verification_input_source: "direct",
    verification_attempt_id: verificationAttemptId,
    verification_status: "verified",
    profile: payload.profile,
    disclosure_mode: payload.disclosure_mode,
    ...(payload.benchmark_trace_id ? { benchmark_trace_id: payload.benchmark_trace_id } : {}),
  });
  const signature = await internalRequestSignature(callbackSecret, jobId, callbackBody);
  const metadataHeader = encodeBase64Url(new TextEncoder().encode(callbackBody));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), directInvocationTimeoutMs(env));
  let response: Response;
  let directServiceBindingRoundTripMilliseconds: number | undefined;
  const invocationStartedAt = benchmarkEnabled(env) ? performance.now() : undefined;
  try {
    benchmarkRecord(env, jobId, "direct_invocation_started");
    benchmarkIncrementDiagnostic(env, jobId, "direct_invocation_count");
    const requestConstructionStartedAt = benchmarkEnabled(env) ? performance.now() : undefined;
    const directRequest = new Request("https://tlsn-direct-verifier/internal/tlsn/verification-complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-FUSOU-TLSN-Job-Id": jobId,
        "X-FUSOU-TLSN-Signature": signature,
        "X-FUSOU-TLSN-Execution-Mode": "direct",
        "X-FUSOU-TLSN-Direct-Metadata": metadataHeader,
        ...(synchronousCandidate ? { "X-FUSOU-TLSN-Synchronous-Response": "true" } : {}),
        ...(synchronousCandidate && env.TLSN_ENVIRONMENT === "test"
          ? { "X-FUSOU-TLSN-Synchronous-Candidate": "true" }
          : {}),
        ...(testFault ? { "X-FUSOU-TLSN-Test-Fault": testFault } : {}),
      },
      body: presentationBytes,
      signal: controller.signal,
    });
    benchmarkDuration(
      env,
      jobId,
      "direct_request_construction",
      requestConstructionStartedAt === undefined ? Number.NaN : performance.now() - requestConstructionStartedAt,
    );
    const fetchWaitStartedAt = benchmarkEnabled(env) ? performance.now() : undefined;
    response = await verifier.fetch(directRequest);
    benchmarkDuration(
      env,
      jobId,
      "direct_service_binding_fetch_wait",
      fetchWaitStartedAt === undefined ? Number.NaN : performance.now() - fetchWaitStartedAt,
    );
  } finally {
    clearTimeout(timeout);
    directServiceBindingRoundTripMilliseconds = invocationStartedAt === undefined
      ? undefined
      : performance.now() - invocationStartedAt;
    benchmarkDuration(
      env,
      jobId,
      "direct_service_binding_round_trip",
      directServiceBindingRoundTripMilliseconds ?? Number.NaN,
    );
  }
  if (!response.ok) {
    throw new Error(`direct verifier failed with status ${response.status}`);
  }
  if (synchronousCandidate) {
    if (response.status !== 200) {
      throw new Error(`direct verifier returned unexpected synchronous status ${response.status}`);
    }
    let synchronousResult: unknown;
    try {
      synchronousResult = JSON.parse(await response.clone().text()) as unknown;
    } catch {
      throw new Error("direct verifier returned malformed synchronous response");
    }
    if (!verificationFinalResponseSchema.safeParse(synchronousResult).success) {
      throw new Error("direct verifier returned invalid synchronous result");
    }
  }
  const callbackProcessingMilliseconds = benchmarkEnabled(env)
    ? readBenchmarkResponseDurationHeader(response, DIRECT_CALLBACK_PROCESSING_HEADER)
    : undefined;
  if (callbackProcessingMilliseconds !== undefined) {
    benchmarkDuration(env, jobId, "direct_callback_processing", callbackProcessingMilliseconds);
    if (directServiceBindingRoundTripMilliseconds !== undefined) {
      const rawResidual = directServiceBindingRoundTripMilliseconds - callbackProcessingMilliseconds;
      benchmarkDuration(env, jobId, "transport_residual", Math.max(0, rawResidual));
      benchmarkDiagnostic(env, jobId, "transport_residual_negative_count", rawResidual < 0 ? 1 : 0);
    }
  }
  if (benchmarkEnabled(env)) {
    const responseBodyConsumptionStartedAt = performance.now();
    const responseBodyBytes = new Uint8Array(await response.clone().arrayBuffer());
    benchmarkDuration(
      env,
      jobId,
      "direct_response_body_consumption",
      performance.now() - responseBodyConsumptionStartedAt,
    );
    const responseDecodeStartedAt = performance.now();
    new TextDecoder().decode(responseBodyBytes);
    benchmarkDuration(
      env,
      jobId,
      "direct_response_decode",
      performance.now() - responseDecodeStartedAt,
    );
    response = new Response(responseBodyBytes, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
  }
  benchmarkRecord(env, jobId, "direct_invocation_completed");
  benchmarkDuration(
    env,
    jobId,
    "request_direct_dispatch",
    requestDirectDispatchStartedAt === undefined
      ? Number.NaN
      : performance.now() - requestDirectDispatchStartedAt,
  );
  await benchmarkFlush(env, jobId);
  return response;
}

type DirectControlMeasurement = {
  requestConstructionMilliseconds: number;
  fetchWaitMilliseconds: number;
  serviceBindingRoundTripMilliseconds: number;
  responseBodyConsumptionMilliseconds: number;
  responseDecodeMilliseconds: number;
};

async function dispatchDirectControlVerification(
  env: Bindings,
  presentationBytes: Uint8Array,
): Promise<DirectControlMeasurement> {
  const verifier = env.TLSN_DIRECT_VERIFIER;
  const callbackSecret = directCallbackSecret(env);
  if (!verifier || !callbackSecret) {
    throw new Error("direct verifier is unconfigured");
  }
  const controlJobId = crypto.randomUUID();
  const controlMetadata = JSON.stringify({ schema_version: 1, control: "direct-service-binding" });
  const signature = await internalRequestSignature(callbackSecret, controlJobId, controlMetadata);
  const metadataHeader = encodeBase64Url(new TextEncoder().encode(controlMetadata));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), directInvocationTimeoutMs(env));
  const benchmarkStartedAt = performance.now();
  let response: Response;
  let responseBodyConsumptionMilliseconds: number;
  let responseDecodeMilliseconds: number;
  let requestConstructionMilliseconds: number;
  let fetchWaitMilliseconds: number;
  try {
    const requestConstructionStartedAt = performance.now();
    const controlRequest = new Request("https://tlsn-direct-verifier/internal/tlsn/direct-control", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-FUSOU-TLSN-Job-Id": controlJobId,
        "X-FUSOU-TLSN-Signature": signature,
        "X-FUSOU-TLSN-Execution-Mode": "direct",
        "X-FUSOU-TLSN-Direct-Metadata": metadataHeader,
        "X-FUSOU-TLSN-Benchmark-Control": "direct-service-binding-v1",
      },
      body: presentationBytes,
      signal: controller.signal,
    });
    const fetchWaitStartedAt = performance.now();
    response = await verifier.fetch(controlRequest);
    requestConstructionMilliseconds = fetchWaitStartedAt - requestConstructionStartedAt;
    fetchWaitMilliseconds = performance.now() - fetchWaitStartedAt;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`direct control verifier failed with status ${response.status}`);
  }
  const responseBodyConsumptionStartedAt = performance.now();
  const responseBodyBytes = new Uint8Array(await response.arrayBuffer());
  responseBodyConsumptionMilliseconds = performance.now() - responseBodyConsumptionStartedAt;
  const responseDecodeStartedAt = performance.now();
  new TextDecoder().decode(responseBodyBytes);
  responseDecodeMilliseconds = performance.now() - responseDecodeStartedAt;
  return {
    serviceBindingRoundTripMilliseconds: performance.now() - benchmarkStartedAt,
    requestConstructionMilliseconds,
    fetchWaitMilliseconds,
    responseBodyConsumptionMilliseconds,
    responseDecodeMilliseconds,
  };
}

export type VerificationCompletionContext = {
  env: Bindings;
  executionCtx: ExecutionContext;
  json: (body: unknown, status?: number) => Response;
  body: (body: string, status?: number) => Response;
  header: (name: string, value: string) => void;
};

export function verificationCompletionContextFromHono(c: Context<{ Bindings: Bindings }>): VerificationCompletionContext {
  return {
    env: c.env,
    executionCtx: c.executionCtx,
    json: (body, status) => c.json(body as never, status as never),
    body: (body, status) => c.body(body, status as never),
    header: (name, value) => c.header(name, value),
  };
}

function directVerificationCompletionContext(
  env: Bindings,
  executionCtx: ExecutionContext,
): VerificationCompletionContext {
  const headers = new Headers();
  return {
    env,
    executionCtx,
    json: (body, status) => Response.json(body, { ...(status === undefined ? {} : { status }), headers }),
    body: (body, status) => new Response(body, { ...(status === undefined ? {} : { status }), headers }),
    header: (name, value) => headers.set(name, value),
  };
}

function completionAuthFailure(
  c: VerificationCompletionContext,
  reason: "callback_secret_unconfigured" | "signature_invalid" | "signature_mismatch",
  diagnosticHmac: boolean,
): Response {
  if (c.env.TLSN_ENVIRONMENT === "test" && diagnosticHmac) {
    return c.json({ error: reason }, 401);
  }
  return c.json({ error: "unauthorized" }, 401);
}

export async function processVerificationCompletion(
  c: VerificationCompletionContext,
  rawBody: string,
  jobId: string,
  signature: string | null,
  executionMode: ExecutionMode,
  diagnosticHmac: boolean,
  executionStartedAt?: number,
  testFault?: TestDirectFault,
  directPresentationBytes?: Uint8Array,
  directPresentationTiming?: DirectPresentationTiming,
  directCallbackEntryStartedAt?: number,
  synchronousCandidate = false,
): Promise<Response> {
  const callbackAuthenticationStartedAt = executionMode === "queue" ? performance.now() : null;
  if (executionMode === "queue") benchmarkRecord(c.env, jobId, "queue_callback_authentication_started");
  const callbackSecret = executionMode === "queue"
    ? queueCallbackSecret(c.env)
    : executionMode === "direct"
      ? directCallbackSecret(c.env)
      : triggerCallbackSecret(c.env);
  if (!callbackSecret) return completionAuthFailure(c, "callback_secret_unconfigured", diagnosticHmac);
  if (!signature || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    return completionAuthFailure(c, "signature_invalid", diagnosticHmac);
  }
  if (!await verifyInternalRequest(callbackSecret, jobId, rawBody, signature)) {
    return completionAuthFailure(c, "signature_mismatch", diagnosticHmac);
  }
  if (executionMode === "queue") {
    benchmarkRecord(c.env, jobId, "queue_callback_authentication_completed");
    benchmarkDuration(c.env, jobId, "queue_callback_authentication", performance.now() - (callbackAuthenticationStartedAt ?? performance.now()));
  }

  const callbackSchemaStartedAt = executionMode === "queue" ? performance.now() : null;
  let callback;
  try {
    callback = verificationCallbackSchema.parse(JSON.parse(rawBody) as unknown);
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  if (callback.job_id !== jobId) {
    return c.json({ error: "invalid_request" }, 400);
  }
  if (executionMode === "queue") {
    benchmarkRecord(c.env, jobId, "queue_callback_schema_validated");
    benchmarkDuration(c.env, jobId, "queue_callback_schema", performance.now() - (callbackSchemaStartedAt ?? performance.now()));
  }
  const response = await completeVerification(
    c,
    callback,
    executionMode,
    executionStartedAt,
    testFault,
    directPresentationBytes,
    directPresentationTiming,
    directCallbackEntryStartedAt,
    synchronousCandidate,
  );
  if (executionMode === "direct" && directCallbackEntryStartedAt !== undefined) {
    const callbackProcessingMilliseconds = performance.now() - directCallbackEntryStartedAt;
    benchmarkDuration(c.env, jobId, "direct_callback_processing", callbackProcessingMilliseconds);
    benchmarkResponseDurationHeader(
      response,
      c.env,
      DIRECT_CALLBACK_PROCESSING_HEADER,
      callbackProcessingMilliseconds,
    );
    deferBenchmarkFlush(c, jobId);
  }
  return response;
}

app.post("/internal/tlsn/direct-control", async (c) => {
  if (!benchmarkEnabled(c.env) || !shouldUseDirectExecution(c.env)) {
    return c.json({ error: "not_found" }, 404);
  }
  const authentication = requireAuthentication(await authenticateRequest(c.req.raw, c.env));
  if (authentication instanceof Response) return authentication;
  const presentationBytes = await readRawBytes(c.req.raw, MAX_PRESENTATION_BYTES).catch(() => undefined);
  if (!presentationBytes) return c.json({ error: "invalid_request" }, 400);
  try {
    const measurement = await dispatchDirectControlVerification(c.env, presentationBytes);
    return c.json({
      schema_version: 1,
      control: "direct-service-binding-v1",
      presentation_bytes: presentationBytes.byteLength,
      request_construction_ms: measurement.requestConstructionMilliseconds,
      service_binding_fetch_wait_ms: measurement.fetchWaitMilliseconds,
      service_binding_round_trip_ms: measurement.serviceBindingRoundTripMilliseconds,
      response_body_consumption_ms: measurement.responseBodyConsumptionMilliseconds,
      response_decode_ms: measurement.responseDecodeMilliseconds,
    });
  } catch {
    return c.json({ error: "direct_control_unavailable" }, 503);
  }
});

app.post("/internal/tlsn/verification-input", async (c) => {
  const rawBody = await readRawBody(c.req.raw, 64 * 1024).catch(() => null);
  const jobId = c.req.header("X-FUSOU-TLSN-Job-Id") ?? "";
  const signature = c.req.header("X-FUSOU-TLSN-Signature") ?? null;
  const callbackSecret = triggerCallbackSecret(c.env);
  if (rawBody === null) return internalRequestAuthFailure(c, "signature_invalid");
  if (!callbackSecret) return internalRequestAuthFailure(c, "callback_secret_unconfigured");
  if (!signature || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    return internalRequestAuthFailure(c, "signature_invalid");
  }
  if (!await verifyInternalRequest(callbackSecret, jobId, rawBody, signature)) {
    return internalRequestAuthFailure(c, "signature_mismatch");
  }

  const parsed = verificationInputRequestSchema.safeParse(JSON.parse(rawBody) as unknown);
  if (!parsed.success || parsed.data.job_id !== jobId) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const authority = new DurableObjectBindingAuthority(c.env.TLSN_BINDINGS);
  benchmarkRegister(c.env, parsed.data.job_id, authority, parsed.data.binding_id, parsed.data.benchmark_trace_id);
  let record: BindingRecord;
  try {
    record = await authority.lookupVerificationJob(parsed.data.binding_id, {
      session_id: parsed.data.session_id,
      canonical_user_id: parsed.data.canonical_user_id,
      device_id: parsed.data.device_id,
      verification_job_id: parsed.data.job_id,
      now: Date.now(),
    });
  } catch {
    return c.json({ error: "job_unavailable" }, 409);
  }
  if (
    (record.status !== "processing" && record.status !== "verifying") ||
    (record.verification_input_source ?? "r2") !== "r2" ||
    record.verification_input_key !== parsed.data.verification_input_key
  ) {
    return c.json({ error: "job_unavailable" }, 409);
  }

  const object = await c.env.TLSN_PRESENTATIONS.get(record.verification_input_key);
  benchmarkR2Operation(c.env, parsed.data.job_id, "trigger_input_get");
  if (!object || object.size > MAX_PRESENTATION_BYTES) {
    return c.json({ error: "verification_input_unavailable" }, 503);
  }
  deferBenchmarkFlush(c, parsed.data.job_id);
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Length": String(object.size),
    },
  });
});

app.post("/internal/tlsn/verification-complete", async (c) => {
  const callbackEntryStartedAt = performance.now();
  const requestedTestFault = c.req.header("X-FUSOU-TLSN-Test-Fault")?.trim();
  const testFault: TestDirectFault | undefined = requestedTestFault === "failure"
    || requestedTestFault === "timeout"
    || requestedTestFault === "late_success"
    || requestedTestFault === "pause_before_result_commit"
    || requestedTestFault === "pause_after_result_commit"
    ? requestedTestFault
    : undefined;
  const jobId = c.req.header("X-FUSOU-TLSN-Job-Id") ?? "";
  const signature = c.req.header("X-FUSOU-TLSN-Signature") ?? null;
  const executionHeader = c.req.header("X-FUSOU-TLSN-Execution-Mode");
  const executionMode = c.env.TLSN_ENVIRONMENT === "test"
    ? executionHeader === "queue"
      ? "queue"
      : executionHeader === "direct"
        ? "direct"
        : "trigger"
    : "trigger";
  const encodedMetadata = c.req.header("X-FUSOU-TLSN-Direct-Metadata");
  const synchronousCandidate = c.env.TLSN_ENVIRONMENT === "test"
    && c.req.header("X-FUSOU-TLSN-Synchronous-Candidate") === "true";
  let rawBody: string | null = null;
  let directPresentationBytes: Uint8Array | undefined;
  let directPresentationTiming: DirectPresentationTiming | undefined;
  if (encodedMetadata && executionMode === "direct") {
    const presentationReadStartedAt = performance.now();
    const presentationReadStartedWallClock = Date.now();
    directPresentationBytes = await readRawBytes(c.req.raw, MAX_PRESENTATION_BYTES).catch(() => undefined);
    const presentationReadCompletedAt = performance.now();
    const presentationReadCompletedWallClock = Date.now();
    try {
      rawBody = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        decodeBase64Url(encodedMetadata, MAX_INTERNAL_CALLBACK_JSON_BYTES),
      );
      directPresentationTiming = {
        readStartedAt: presentationReadStartedWallClock,
        readCompletedAt: presentationReadCompletedWallClock,
        readDurationMilliseconds: presentationReadCompletedAt - presentationReadStartedAt,
      };
    } catch {
      rawBody = null;
    }
  } else {
    rawBody = await readRawBody(c.req.raw, MAX_INTERNAL_CALLBACK_JSON_BYTES).catch(() => null);
  }
  if (rawBody === null) return internalRequestAuthFailure(c, "signature_invalid");
  const response = await processVerificationCompletion(
    verificationCompletionContextFromHono(c),
    rawBody,
    jobId,
    signature,
    executionMode,
    c.env.TLSN_ENVIRONMENT === "test" && c.req.header("X-FUSOU-TLSN-Diagnostic") === "hmac",
    undefined,
    testFault,
    directPresentationBytes,
    directPresentationTiming,
    executionMode === "direct" ? callbackEntryStartedAt : undefined,
    synchronousCandidate,
  );
  return response;
});

async function completeVerification(
  c: VerificationCompletionContext,
  callback: z.infer<typeof verificationCallbackSchema>,
  executionMode: ExecutionMode,
  executionStartedAt?: number,
  testFault?: TestDirectFault,
  directPresentationBytes?: Uint8Array,
  directPresentationTiming?: DirectPresentationTiming,
  directCallbackEntryStartedAt?: number,
  synchronousCandidate = false,
): Promise<Response> {
  const directCallbackEntryToLeaseStartedAt = executionMode === "direct" && benchmarkEnabled(c.env)
    ? directCallbackEntryStartedAt ?? performance.now()
    : null;
  const configValidationObservations: PrivateKeyValidationObservation[] = [];
  const configValidationTimings: ConfigValidationTimings = {};
  const configValidationStartedAt = benchmarkEnabled(c.env) ? performance.now() : undefined;
  const config = await readConfig(
    c.env,
    (observation) => configValidationObservations.push(observation),
    benchmarkEnabled(c.env)
      ? (component, milliseconds) => addConfigValidationTiming(configValidationTimings, component, milliseconds)
      : undefined,
  );
  const configValidationMilliseconds = configValidationStartedAt === undefined
    ? Number.NaN
    : performance.now() - configValidationStartedAt;
  if (!config) {
    return c.json({ error: "verifier_unconfigured" }, 503);
  }
  const authority = new DurableObjectBindingAuthority(c.env.TLSN_BINDINGS);
  const directCallbackBenchmarkRegistrationStartedAt = executionMode === "direct" && benchmarkEnabled(c.env)
    ? performance.now()
    : null;
  await benchmarkRegisterFromCallback(
    c.env,
    callback.job_id,
    authority,
    callback.binding_id,
    callback.benchmark_trace_id,
    executionMode,
  );
  if (directCallbackBenchmarkRegistrationStartedAt !== null) {
    benchmarkDuration(
      c.env,
      callback.job_id,
      "direct_callback_benchmark_registration",
      performance.now() - directCallbackBenchmarkRegistrationStartedAt,
    );
  }
  benchmarkConfigValidation(
    c.env,
    callback.job_id,
    configValidationObservations,
    "callback",
    configValidationMilliseconds,
    configValidationTimings,
  );
  if (executionMode === "direct") {
    benchmarkDuration(c.env, callback.job_id, "direct_callback_config_validation", configValidationMilliseconds);
  }
  if (executionMode === "queue") benchmarkRecord(c.env, callback.job_id, "queue_completion_entered");
  if (executionMode === "direct" && executionStartedAt !== undefined) {
    benchmarkRecord(c.env, callback.job_id, "t3_direct_execution_started", executionStartedAt);
  }
  if (executionMode === "direct" && directPresentationTiming) {
    benchmarkRecord(c.env, callback.job_id, "direct_presentation_read_started", directPresentationTiming.readStartedAt);
    benchmarkRecord(c.env, callback.job_id, "direct_presentation_read_completed", directPresentationTiming.readCompletedAt);
    benchmarkDuration(
      c.env,
      callback.job_id,
      "direct_presentation_transfer",
      directPresentationTiming.readDurationMilliseconds,
    );
  }
  benchmarkRecord(c.env, callback.job_id, "t3_callback_accepted");
  benchmarkRecord(c.env, callback.job_id, "t4_callback_accepted");
  if (executionMode !== "queue" && callback.trigger_execution_started_at !== undefined) {
    benchmarkRecord(c.env, callback.job_id, "t3_trigger_execution_started", callback.trigger_execution_started_at);
  }
  if (callback.benchmark_module_timing) {
    benchmarkRecord(
      c.env,
      callback.job_id,
      "t3_trigger_module_initialized",
      callback.benchmark_module_timing.module_evaluation_completed_at,
    );
  }
  if (callback.benchmark_timing) {
    benchmarkRecord(c.env, callback.job_id, "t3_trigger_input_fetch_started", callback.benchmark_timing.input_fetch_started_at);
    benchmarkRecord(c.env, callback.job_id, "t3_trigger_input_fetch_completed", callback.benchmark_timing.input_fetch_completed_at);
    benchmarkRecord(c.env, callback.job_id, "t3_trigger_verifier_initialization_started", callback.benchmark_timing.verifier_initialization_started_at);
    benchmarkRecord(c.env, callback.job_id, "t3_trigger_verifier_initialization_completed", callback.benchmark_timing.verifier_initialization_completed_at);
    benchmarkRecord(c.env, callback.job_id, "t3_trigger_verifier_started", callback.benchmark_timing.verifier_started_at);
    benchmarkRecord(c.env, callback.job_id, "t3_trigger_verifier_completed", callback.benchmark_timing.verifier_completed_at);
    benchmarkRecord(c.env, callback.job_id, "t3_trigger_callback_request_started", callback.benchmark_timing.callback_request_started_at);
  }
  const readConsumedResult = async (resultRecord: BindingRecord): Promise<Response> => {
    const authoritativeResult = await readAuthoritativeVerificationResult(authority, callback.binding_id, {
      session_id: callback.session_id,
      canonical_user_id: callback.canonical_user_id,
      device_id: callback.device_id,
      verification_job_id: callback.job_id,
      ...(resultRecord.result_sha256 ? { result_sha256: resultRecord.result_sha256 } : {}),
      ...(resultRecord.result_object_key ? { result_object_key: resultRecord.result_object_key } : {}),
      now: Date.now(),
    })
      .catch(() => null);
    return authoritativeResult
      ? c.json({ accepted: true })
      : c.json({ error: "verification_result_unavailable" }, 503);
  };

  const verificationAttemptId = callback.verification_attempt_id ?? crypto.randomUUID();
  const attemptResultKey = verificationObjectKey(verificationAttemptId, "result");
  let verificationRecord;
  const bindingLookupAndLeaseStartedAt = executionMode === "queue" ? performance.now() : null;
  if (executionMode === "queue") benchmarkRecord(c.env, callback.job_id, "queue_binding_lookup_and_lease_started");
  const directAcquireStartedAt = executionMode === "direct" && benchmarkEnabled(c.env)
    ? performance.now()
    : null;
  benchmarkDOOperation(c.env, callback.job_id, "acquire_verification");
  try {
    verificationRecord = await authority.acquireVerification(callback.binding_id, {
      session_id: callback.session_id,
      canonical_user_id: callback.canonical_user_id,
      device_id: callback.device_id,
      verification_job_id: callback.job_id,
      presentation_id: callback.presentation_id,
      verification_profile: callback.profile,
      verification_attempt_id: verificationAttemptId,
      verification_lease_expires_at: new Date(Date.now() + verificationLeaseMs(c.env)).toISOString(),
      result_object_key: attemptResultKey,
      now: Date.now(),
      benchmark_timing: benchmarkEnabled(c.env),
      }, benchmarkAcquireVerificationOptions(c.env, callback.job_id));
    if (directAcquireStartedAt !== null) {
      benchmarkDuration(
        c.env,
        callback.job_id,
        "direct_acquire_verification",
        performance.now() - directAcquireStartedAt,
      );
    }
    if (executionMode === "direct") {
      benchmarkDuration(
        c.env,
        callback.job_id,
        "direct_callback_entry_to_lease",
        directCallbackEntryToLeaseStartedAt === null
          ? Number.NaN
          : performance.now() - directCallbackEntryToLeaseStartedAt,
      );
    }
  } catch (error) {
    if (
      error instanceof BindingAuthorityError &&
      (error.code === "verification_result_mismatch" || error.code === "verification_profile_mismatch")
    ) {
      return c.json({ error: error.code }, 422);
    }
    return c.json({ error: error instanceof BindingAuthorityError ? error.code : "job_unavailable" }, 409);
  }
  if (executionMode === "queue") {
    benchmarkRecord(c.env, callback.job_id, "queue_binding_lookup_and_lease_completed");
    benchmarkDuration(
      c.env,
      callback.job_id,
      "queue_binding_lookup_and_lease",
      performance.now() - (bindingLookupAndLeaseStartedAt ?? performance.now()),
    );
  }
  const expectedProfile = callback.profile;
  if (verificationRecord.status === "consumed") {
    benchmarkIncrementDiagnostic(c.env, callback.job_id, "late_callback_count");
    deferBenchmarkFlush(c, callback.job_id);
    return readConsumedResult(verificationRecord);
  }
  if (
    verificationRecord.status !== "verifying" ||
    verificationRecord.verification_attempt_id !== verificationAttemptId
  ) {
    return c.json({ accepted: false, status: "processing" }, 202);
  }
  const verificationInputSource = verificationRecord.verification_input_source ?? "r2";
  if (
    verificationRecord.verification_result_key === undefined ||
    verificationRecord.device_replay_digest_hex === undefined ||
    (verificationInputSource === "r2" && verificationRecord.verification_input_key === undefined)
  ) {
    await finalizeVerificationFailure(c.env, {
      bindingId: callback.binding_id,
      sessionId: callback.session_id,
      canonicalUserId: callback.canonical_user_id,
      deviceId: callback.device_id,
      jobId: callback.job_id,
      verificationAttemptId,
      failureCode: "authority_error",
    });
    return c.json({ error: "verification_result_mismatch" }, 422);
  }
  if (executionMode === "queue") {
    benchmarkRecord(c.env, callback.job_id, "t3_queue_verifier_started");
  }
  benchmarkVerifierStart(c.env, callback.job_id);
  benchmarkRecord(c.env, callback.job_id, "t5_lease_acquired");
  const verificationInputKey = verificationRecord.verification_input_key;
  const verificationResultKey = verificationRecord.verification_result_key;
  const deviceReplayDigestHex = verificationRecord.device_replay_digest_hex;
  const completionRecord = {
    ...verificationRecord,
    verification_input_key: verificationInputKey,
    verification_result_key: verificationResultKey,
    device_replay_digest_hex: deviceReplayDigestHex,
  };
  let completionConsumed = false;
  let failurePathEntered = false;
  let resultCommitted = false;
  let benchmarkPersistenceStartedAt: string | undefined;
  let benchmarkPersistenceRemainingMilliseconds: number | undefined;
  let attemptFailureCode: VerificationFailureCode = "verifier_failed";
  let benchmarkVerifierStarted = true;
  const finalizeAttemptFailure = async (failureCode: VerificationFailureCode): Promise<void> => {
    failurePathEntered = true;
    benchmarkDiagnostic(c.env, callback.job_id, "completion_failure_code", failureCode);
    await finalizeVerificationFailure(c.env, {
      bindingId: completionRecord.binding_id,
      sessionId: completionRecord.session_id,
      canonicalUserId: completionRecord.canonical_user_id,
      deviceId: completionRecord.device_id,
      jobId: callback.job_id,
      verificationAttemptId: verificationAttemptId,
      failureCode,
      ...(benchmarkPersistenceStartedAt ? { benchmarkPersistenceStartedAt } : {}),
      ...(benchmarkPersistenceRemainingMilliseconds !== undefined
        ? { benchmarkPersistenceRemainingMilliseconds }
        : {}),
    });
  };
  if (
    executionMode === "direct" &&
    (
      verificationInputSource !== "direct" ||
      callback.execution_mode !== "direct" ||
      callback.verification_input_source !== "direct" ||
      callback.verification_attempt_id !== verificationAttemptId
    )
  ) {
    await finalizeAttemptFailure("verifier_failed");
    return c.json({ error: "verification_result_mismatch" }, 422);
  }
  const releaseVerificationLease = async (): Promise<void> => {
    await authority.releaseVerification(callback.binding_id, {
      session_id: completionRecord.session_id,
      canonical_user_id: completionRecord.canonical_user_id,
      device_id: completionRecord.device_id,
      verification_job_id: callback.job_id,
      verification_attempt_id: verificationAttemptId,
      now: Date.now(),
    }).catch(() => undefined);
  };
  await delayTestCompletion(c.env);

  let storedPresentation: Uint8Array;
  let storedPresentationId: string;
  const presentationReadStartedAt = executionMode === "queue" ? performance.now() : null;
  if (executionMode === "queue") benchmarkRecord(c.env, callback.job_id, "queue_presentation_read_started");
  try {
    if (executionMode === "direct") {
      if (verificationInputSource !== "direct" || !directPresentationBytes) {
        await finalizeAttemptFailure("presentation_read_failed");
        return c.json({ error: "verification_input_unavailable" }, 503);
      }
      storedPresentation = directPresentationBytes;
      benchmarkRecord(c.env, callback.job_id, "direct_presentation_received");
      benchmarkDiagnostic(c.env, callback.job_id, "presentation_transfer_bytes", storedPresentation.byteLength);
    } else {
      if (verificationInputSource !== "r2" || !completionRecord.verification_input_key) {
        await finalizeAttemptFailure("presentation_read_failed");
        return c.json({ error: "verification_input_unavailable" }, 503);
      }
      const presentationObject = await c.env.TLSN_PRESENTATIONS.get(completionRecord.verification_input_key);
      if (!presentationObject || presentationObject.size > MAX_PRESENTATION_BYTES) {
        await finalizeAttemptFailure("presentation_read_failed");
        return c.json({ error: "verification_input_unavailable" }, 503);
      }
      storedPresentation = new Uint8Array(await presentationObject.arrayBuffer());
      benchmarkR2Operation(c.env, callback.job_id, "worker_presentation_get");
    }
    benchmarkDiagnostic(c.env, callback.job_id, "presentation_bytes", storedPresentation.byteLength);
    benchmarkDiagnostic(c.env, callback.job_id, "payload_bytes", storedPresentation.byteLength);
    benchmarkRecord(c.env, callback.job_id, "t5_presentation_read");
    if (executionMode === "queue") {
      benchmarkRecord(c.env, callback.job_id, "queue_presentation_read_completed");
      benchmarkDuration(c.env, callback.job_id, "queue_presentation_read", performance.now() - (presentationReadStartedAt ?? performance.now()));
    }
    benchmarkRecord(c.env, callback.job_id, "t5_presentation_hash_started");
    const presentationHashStartedAt = benchmarkEnabled(c.env) ? performance.now() : null;
    storedPresentationId = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", storedPresentation)),
    );
    benchmarkRecord(c.env, callback.job_id, "t5_presentation_hash_completed");
    benchmarkRecord(c.env, callback.job_id, "t6_presentation_read");
    if (executionMode === "queue") {
      benchmarkRecord(c.env, callback.job_id, "queue_presentation_hash_completed");
      benchmarkDuration(c.env, callback.job_id, "queue_presentation_hash", performance.now() - (presentationHashStartedAt ?? performance.now()));
    } else if (executionMode === "direct") {
      benchmarkDuration(c.env, callback.job_id, "direct_presentation_hash", performance.now() - (presentationHashStartedAt ?? performance.now()));
    }
  } catch {
    await finalizeAttemptFailure("presentation_read_failed");
    return c.json({ error: "verification_input_unavailable" }, 503);
  }
  if (storedPresentationId !== completionRecord.presentation_id || storedPresentationId !== callback.presentation_id) {
    await finalizeAttemptFailure("presentation_hash_mismatch");
    return c.json({ error: "verification_result_mismatch" }, 422);
  }

  try {
    const sparseProfile = expectedProfile === "sparse";
    const wasmVerificationStartedAt = benchmarkEnabled(c.env) ? performance.now() : null;
    if (executionMode === "queue") benchmarkRecord(c.env, callback.job_id, "queue_wasm_verification_started");
    await ensureWasmInitialized();
    const prepared = verifyPresentationToPreparedResult(
      config,
      expectedProfile,
      storedPresentation,
      completionRecord.canonical_user_id,
      completionRecord.device_id,
      decodeBase64Url(completionRecord.tlsn_device_challenge, 32),
    );
    benchmarkRecord(c.env, callback.job_id, "t6_wasm_verification_completed");
    benchmarkRecord(c.env, callback.job_id, "t7_wasm_verification_completed");
    if (executionMode === "queue") {
      benchmarkRecord(c.env, callback.job_id, "t3_queue_verifier_completed");
      benchmarkRecord(c.env, callback.job_id, "queue_wasm_verification_completed");
      benchmarkDuration(c.env, callback.job_id, "queue_wasm_verification", performance.now() - (wasmVerificationStartedAt ?? performance.now()));
    } else if (executionMode === "direct") {
      benchmarkDuration(c.env, callback.job_id, "direct_wasm_verification", performance.now() - (wasmVerificationStartedAt ?? performance.now()));
    }
    const preparedUnsignedResult = JSON.parse(prepared.unsigned_result) as Record<string, unknown>;
    const expectedProfileId = sparseProfile ? "fusou-require-info-v2-sparse" : "fusou-require-info-v1";
    const expectedVersion = sparseProfile ? 2 : 1;
    const expectedProfileSha256 = sparseProfile ? config.sparseProfileSha256 : config.profileSha256;
    if (
      preparedUnsignedResult["version"] !== expectedVersion ||
      preparedUnsignedResult["profile_id"] !== expectedProfileId ||
      preparedUnsignedResult["profile_sha256"] !== expectedProfileSha256 ||
      (sparseProfile
        ? preparedUnsignedResult["disclosure_mode"] !== "sparse" ||
          Object.hasOwn(preparedUnsignedResult, "request_transcript_sha256") ||
          Object.hasOwn(preparedUnsignedResult, "response_transcript_sha256")
        : Object.hasOwn(preparedUnsignedResult, "disclosure_mode"))
    ) {
      await finalizeAttemptFailure("verifier_failed");
      return c.json({ error: "verification_profile_mismatch" }, 422);
    }
    const authenticatedResult = authenticatedResultSchema.parse(
      preparedUnsignedResult,
    );
    if (
      authenticatedResult.attestation_session_id !== completionRecord.session_id ||
      authenticatedResult.canonical_user_id !== completionRecord.canonical_user_id ||
      authenticatedResult.device_id !== completionRecord.device_id ||
      authenticatedResult.device_challenge !== completionRecord.tlsn_device_challenge ||
      authenticatedResult.binding_nonce !== completionRecord.nonce ||
      authenticatedResult.binding_value !== completionRecord.binding_value
    ) {
      await finalizeAttemptFailure("verifier_failed");
      return c.json({ error: "binding_mismatch" }, 422);
    }

    const resultCanonicalizationStartedAt = performance.now();
    benchmarkRecord(c.env, callback.job_id, "result_canonicalization_started");
    const signingBytes = decodeBase64Url(prepared.signing_bytes, MAX_RESULT_JSON_BYTES);
    const derivedSigningBytes = sparseProfile
      ? derive_sparse_verifier_result_signing_bytes(prepared.unsigned_result)
      : derive_verifier_result_signing_bytes(prepared.unsigned_result);
    if (!hasSameBytes(derivedSigningBytes, signingBytes)) {
      await finalizeAttemptFailure("verifier_failed");
      return c.json({ error: "signing_bytes_mismatch" }, 422);
    }
    benchmarkRecord(c.env, callback.job_id, "result_canonicalization_completed");
    benchmarkDuration(
      c.env,
      callback.job_id,
      "result_canonicalization",
      performance.now() - resultCanonicalizationStartedAt,
    );
    const resultSigningStartedAt = performance.now();
    benchmarkRecord(c.env, callback.job_id, "result_signing_started");
    if (executionMode === "queue") benchmarkRecord(c.env, callback.job_id, "queue_result_signing_started");
    const signatureBytes = await (sparseProfile
      ? signSparseResult(config, signingBytes)
      : signResult(config, signingBytes));
    if (signatureBytes.length !== 64) {
      await finalizeAttemptFailure("verifier_failed");
      return c.json({ error: "verifier_unavailable" }, 503);
    }
    const signedResultBody = sparseProfile
      ? attach_sparse_verifier_result_signature(prepared.unsigned_result, signatureBytes)
      : attach_verifier_result_signature(prepared.unsigned_result, signatureBytes);
    const signedResult = JSON.parse(signedResultBody) as Record<string, unknown>;
    if (benchmarkEnabled(c.env)) {
      benchmarkDiagnostic(c.env, callback.job_id, "signed_result_bytes", new TextEncoder().encode(signedResultBody).byteLength);
    }
    const usedAt = completionRecord.status === "consumed"
      ? completionRecord.used_at
      : new Date(Date.now()).toISOString();
    if (!usedAt) {
      await finalizeAttemptFailure("authority_error");
      return c.json({ error: "verification_result_unavailable" }, 503);
    }
    const consumeReceipt = await signConsumeReceipt(config, {
      session_id: completionRecord.session_id,
      canonical_user_id: completionRecord.canonical_user_id,
      device_id: completionRecord.device_id,
      nonce: completionRecord.nonce,
      binding_value: completionRecord.binding_value,
      presentation_id: storedPresentationId,
      used_at: usedAt,
    });
    benchmarkRecord(c.env, callback.job_id, "result_signing_completed");
    benchmarkDuration(c.env, callback.job_id, "result_signing", performance.now() - resultSigningStartedAt);
    if (executionMode === "queue") {
      benchmarkRecord(c.env, callback.job_id, "queue_result_signing_completed");
      benchmarkDuration(c.env, callback.job_id, "queue_result_signing", performance.now() - resultSigningStartedAt);
    }
    const resultConstructionStartedAt = performance.now();
    benchmarkRecord(c.env, callback.job_id, "result_construction_started");
    const finalResponse = verificationFinalResponseSchema.parse({
      verified: true,
      result: signedResult,
      signer_key_id: config.resultSignerKeyId ?? config.verifierKeyId,
      signature_algorithm: "Ed25519",
      consume_receipt: consumeReceipt,
      device_replay_digest_hex: completionRecord.device_replay_digest_hex,
    });
    benchmarkRecord(c.env, callback.job_id, "t7_result_signing_completed");
    benchmarkRecord(c.env, callback.job_id, "t8_result_signing_completed");
    benchmarkRecord(c.env, callback.job_id, "result_construction_completed");
    benchmarkDuration(c.env, callback.job_id, "result_construction", performance.now() - resultConstructionStartedAt);
    const resultSerializationStartedAt = performance.now();
    benchmarkRecord(c.env, callback.job_id, "result_serialization_started");
    const finalResponseBody = JSON.stringify(finalResponse);
    const finalResponseBytes = new TextEncoder().encode(finalResponseBody);
    benchmarkRecord(c.env, callback.job_id, "result_serialization_completed");
    benchmarkDuration(c.env, callback.job_id, "result_serialization", performance.now() - resultSerializationStartedAt);
    benchmarkDiagnostic(c.env, callback.job_id, "result_bytes", finalResponseBytes.byteLength);
    benchmarkDiagnostic(c.env, callback.job_id, "result_authority_bytes", finalResponseBytes.byteLength);
    const resultHashStartedAt = performance.now();
    benchmarkRecord(c.env, callback.job_id, "result_hash_started");
    const resultSha256 = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", finalResponseBytes)),
    );
    benchmarkRecord(c.env, callback.job_id, "result_hash_completed");
    benchmarkDuration(c.env, callback.job_id, "result_hash", performance.now() - resultHashStartedAt);
    benchmarkDiagnostic(c.env, callback.job_id, "result_sha256_present", true);
    benchmarkDiagnostic(c.env, callback.job_id, "result_sha256", resultSha256);
    const resultPersistenceStartedAt = performance.now();
    benchmarkPersistenceStartedAt = new Date().toISOString();
    benchmarkPersistenceRemainingMilliseconds = Math.max(
      0,
      Date.parse(completionRecord.benchmark_lease_expires_at ?? completionRecord.verification_lease_expires_at ?? "") - Date.now(),
    );
    benchmarkRecord(c.env, callback.job_id, "result_persistence_started");
    if (executionMode === "queue") benchmarkRecord(c.env, callback.job_id, "queue_result_persistence_started");
    attemptFailureCode = "result_persistence_failed";
    let committedBinding: BindingRecord;
    const commitInput: CommitVerifiedResultInput = {
      session_id: completionRecord.session_id,
      canonical_user_id: completionRecord.canonical_user_id,
      device_id: completionRecord.device_id,
      binding_value: completionRecord.binding_value,
      nonce: completionRecord.nonce,
      presentation_id: storedPresentationId,
      verification_attempt_id: verificationAttemptId,
      verification_job_id: callback.job_id,
      verification_profile: expectedProfile,
      verification_result_key: completionRecord.verification_result_key,
      result_sha256: resultSha256,
      result_object_key: attemptResultKey,
      result_bytes: finalResponseBytes,
      used_at: usedAt,
      now: Date.now(),
      benchmark_timing: benchmarkEnabled(c.env),
      benchmark_persistence_started_at: benchmarkPersistenceStartedAt,
      benchmark_persistence_remaining_ms: benchmarkPersistenceRemainingMilliseconds,
    };
    await delayBeforeResultCommit(c.env, testFault);
    const doCommitStartedAt = performance.now();
    benchmarkDOOperation(c.env, callback.job_id, "commit_verified_result");
    committedBinding = await authority.commitVerifiedResult(callback.binding_id, commitInput);
    benchmarkAuthorityLeaseMetadata(c.env, callback.job_id, committedBinding);
    const doCommitCompletedAt = performance.now();
    resultCommitted = true;
    completionConsumed = true;
    if (committedBinding.used_at !== usedAt || committedBinding.result_sha256 !== resultSha256) {
      await finalizeAttemptFailure("authority_error");
      return c.json({ error: "verification_result_unavailable" }, 503);
    }
    c.executionCtx.waitUntil((async () => {
      benchmarkR2Operation(c.env, callback.job_id, "result_archive_put");
      await c.env.TLSN_PRESENTATIONS.put(
        attemptResultKey,
        finalResponseBytes,
        { httpMetadata: { contentType: "application/json" } },
      ).catch(() => undefined);
    })());
    const resultPersistenceCompletedAt = performance.now();
    benchmarkRecord(c.env, callback.job_id, "result_persistence_completed");
    benchmarkDuration(c.env, callback.job_id, "result_persistence", resultPersistenceCompletedAt - resultPersistenceStartedAt);
    benchmarkDuration(c.env, callback.job_id, "result_persistence_preparation", doCommitStartedAt - resultPersistenceStartedAt);
    benchmarkDuration(c.env, callback.job_id, "do_commit_verified_result", doCommitCompletedAt - doCommitStartedAt);
    benchmarkDuration(c.env, callback.job_id, "result_persistence_post_commit", resultPersistenceCompletedAt - doCommitCompletedAt);
    benchmarkRecord(c.env, callback.job_id, "t8_result_persisted");
    benchmarkRecord(c.env, callback.job_id, "t9_result_persisted");
    if (executionMode === "queue") {
      benchmarkRecord(c.env, callback.job_id, "queue_result_persistence_completed");
      benchmarkDuration(c.env, callback.job_id, "queue_result_persistence", performance.now() - resultPersistenceStartedAt);
    }
    await delayAfterResultCommit(c.env, testFault);
    benchmarkDiagnostic(c.env, callback.job_id, "consume_outcome", "consumed");
    benchmarkIncrementDiagnostic(c.env, callback.job_id, "do_commit_verified_result_count");
    benchmarkRecord(c.env, callback.job_id, "t9_consume_completed");
    benchmarkRecord(c.env, callback.job_id, "t10_consume_completed");
    if (executionMode === "queue") {
      benchmarkRecord(c.env, callback.job_id, "queue_consume_completed");
      benchmarkDuration(c.env, callback.job_id, "queue_consume", performance.now() - doCommitStartedAt);
    }
    const completionResponseStartedAt = executionMode === "queue" ? performance.now() : null;
    benchmarkRecord(c.env, callback.job_id, "t10_callback_response_ready");
    if (executionMode === "queue") {
      benchmarkRecord(c.env, callback.job_id, "queue_completion_response_ready");
      benchmarkDuration(c.env, callback.job_id, "queue_completion_response", performance.now() - (completionResponseStartedAt ?? performance.now()));
    }
    const cleanupInput = async (): Promise<void> => {
      if (verificationInputSource !== "r2" || !completionRecord.verification_input_key) return;
      benchmarkRecord(c.env, callback.job_id, "input_cleanup_started");
      benchmarkR2Operation(c.env, callback.job_id, "input_delete");
      await c.env.TLSN_PRESENTATIONS.delete(completionRecord.verification_input_key).catch(() => undefined);
      benchmarkRecord(c.env, callback.job_id, "input_cleanup_completed");
      await benchmarkFlush(c.env, callback.job_id);
    };
    const synchronousResponseStartedAt = synchronousCandidate && benchmarkEnabled(c.env)
      ? performance.now()
      : null;
    if (synchronousCandidate) {
      benchmarkRecord(c.env, callback.job_id, "direct_synchronous_response_started");
    }
    if (executionMode === "direct") {
      c.executionCtx.waitUntil(cleanupInput());
    } else {
      await cleanupInput();
    }
    deferBenchmarkFlush(c, callback.job_id);
    if (synchronousCandidate) {
      benchmarkRecord(c.env, callback.job_id, "t1_200_response_sent");
      benchmarkRecord(c.env, callback.job_id, "direct_synchronous_response_completed");
      benchmarkDuration(
        c.env,
        callback.job_id,
        "direct_synchronous_response",
        synchronousResponseStartedAt === null ? Number.NaN : performance.now() - synchronousResponseStartedAt,
      );
      benchmarkDiagnostic(c.env, callback.job_id, "synchronous_success_path", "established");
      benchmarkDiagnostic(c.env, callback.job_id, "terminal_outcome", "verified");
      if (benchmarkEnabled(c.env)) {
        const benchmarkPersistence = benchmarkPersistences.get(callback.job_id);
        c.header("X-FUSOU-TLSN-Test-Job-Id", callback.job_id);
        if (benchmarkPersistence) {
          c.header("X-FUSOU-TLSN-Test-Benchmark-Trace-Id", benchmarkPersistence.traceId);
        }
      }
      c.header("Cache-Control", "no-store");
      c.header("Content-Type", "application/json");
      return c.body(finalResponseBody, 200);
    }
    return c.json({ accepted: true });
  } catch (error) {
    failurePathEntered = true;
    benchmarkDiagnostic(c.env, callback.job_id, "consume_outcome", resultCommitted ? "committed" : "not_attempted");
    if (error instanceof BindingAuthorityError && (error.code === "verification_failed" || error.code === "binding_expired" || error.code === "binding_conflict")) {
      benchmarkIncrementDiagnostic(c.env, callback.job_id, "late_callback_count");
      benchmarkDiagnostic(c.env, callback.job_id, "stale_attempt_rejected", true);
    }
    await finalizeAttemptFailure(attemptFailureCode);
    return c.json({ error: "verification_failed" }, 422);
  } finally {
    if (!completionConsumed && !failurePathEntered) {
      await releaseVerificationLease();
    }
    if (benchmarkVerifierStarted) {
      benchmarkVerifierEnd(c.env, callback.job_id);
      benchmarkVerifierStarted = false;
    }
    deferBenchmarkFlush(c, callback.job_id);
  }
}

app.get("/health", async (c) => {
  const production = c.env.TLSN_ENVIRONMENT === "production";
  const role = c.env.TLSN_DEPLOYMENT_ROLE ?? (production ? "production" : "synthetic-test");
  const canary = production && role === "canary";
  const replay = !production && role === "replay";
  const verifierKeyId = production
    ? c.env.TLSN_CANDIDATE_VERIFIER_KEY_ID
    : c.env.TLSN_VERIFIER_KEY_ID;
  const notaryKeyId = production
    ? c.env.TLSN_CANDIDATE_NOTARY_KEY_ID
    : c.env.TLSN_NOTARY_KEY_ID;
  const profileSha256 = production
    ? c.env.TLSN_CANDIDATE_PROFILE_SHA256
    : c.env.TLSN_PROFILE_SHA256;
  const sparseProfileSha256 = production
    ? c.env.TLSN_CANDIDATE_SPARSE_PROFILE_SHA256
    : c.env.TLSN_SPARSE_PROFILE_SHA256;
  const notaryRegistry = production
    ? c.env.TLSN_PRODUCTION_NOTARY_REGISTRY
    : c.env.TLSN_NOTARY_REGISTRY;
  const notaryRegistrySha256 = notaryRegistry
    ? encodeBase64Url(new Uint8Array(await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(notaryRegistry),
      )))
    : null;
  const trustRoot = production
    ? canary ? c.env.TLSN_CANARY_TRUST_ROOT_CERTIFICATE_DER : c.env.TLSN_PRODUCTION_TRUST_ROOT_CERTIFICATE_DER
    : c.env.TLSN_TRUST_ROOT_CERTIFICATE_DER;
  const trustRootCertificateSha256 = trustRoot
    ? encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", decodeBase64Url(trustRoot, 4096))))
    : null;
  const resultPublicKeySpki = production
    ? canary ? c.env.TLSN_CANARY_RESULT_PUBLIC_KEY_SPKI : c.env.TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI
    : c.env.TLSN_RESULT_PUBLIC_KEY_SPKI ?? null;
  const resultSignerKeyId = production
    ? canary ? c.env.TLSN_CANARY_RESULT_SIGNER_KEY_ID : c.env.TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID
    : c.env.TLSN_RESULT_SIGNER_KEY_ID ?? null;
  const resultSigningKeyRegistry = production
    ? canary ? c.env.TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY : c.env.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY
    : c.env.TLSN_RESULT_SIGNING_KEY_REGISTRY ?? null;
  const resultSigningKeyRegistryEnvelope = production
    ? canary ? c.env.TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE : c.env.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY_ENVELOPE
    : null;
  const resultRegistryRootKeyId = production
    ? canary ? c.env.TLSN_CANARY_RESULT_REGISTRY_ROOT_KEY_ID : c.env.TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_KEY_ID
    : null;
  const resultRegistryRootPublicKeySpki = production
    ? canary ? c.env.TLSN_CANARY_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI : c.env.TLSN_PRODUCTION_RESULT_REGISTRY_ROOT_PUBLIC_KEY_SPKI
    : null;
  const resultKeyRegistrySha256 = resultSigningKeyRegistry
    ? encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(resultSigningKeyRegistry))))
    : null;
  const resultKeyRegistryEnvelopeSha256 = resultSigningKeyRegistryEnvelope
    ? encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(resultSigningKeyRegistryEnvelope))))
    : null;
  const sessionAuthorityPublicKeySpki = production
    ? canary ? c.env.TLSN_CANARY_SESSION_AUTHORITY_PUBLIC_KEY_SPKI : c.env.TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI
    : c.env.TLSN_SESSION_AUTHORITY_PUBLIC_KEY_SPKI;
  const sessionAuthorityKeyId = production
    ? canary ? c.env.TLSN_CANARY_SESSION_AUTHORITY_KEY_ID : c.env.TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID
    : c.env.TLSN_SESSION_AUTHORITY_KEY_ID;
  const sessionAuthorityKeyRegistry = production
    ? canary ? c.env.TLSN_CANARY_SESSION_AUTHORITY_KEY_REGISTRY : c.env.TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_REGISTRY
    : c.env.TLSN_SESSION_AUTHORITY_KEY_REGISTRY;
  const bindingAuthorityPublicKeySpki = production
    ? canary ? c.env.TLSN_CANARY_BINDING_AUTHORITY_PUBLIC_KEY_SPKI : c.env.TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI
    : c.env.TLSN_BINDING_AUTHORITY_PUBLIC_KEY_SPKI;
  const bindingAuthorityKeyId = production
    ? canary ? c.env.TLSN_CANARY_BINDING_AUTHORITY_KEY_ID : c.env.TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID
    : c.env.TLSN_BINDING_AUTHORITY_KEY_ID;
  const bindingAuthorityKeyRegistry = production
    ? canary ? c.env.TLSN_CANARY_BINDING_AUTHORITY_KEY_REGISTRY : c.env.TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_REGISTRY
    : c.env.TLSN_BINDING_AUTHORITY_KEY_REGISTRY;
  const authorityRegistrySha256 = async (registry: string | undefined) => registry
    ? encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(registry))))
    : null;
  const sessionAuthorityKeyRegistrySha256 = await authorityRegistrySha256(sessionAuthorityKeyRegistry);
  const bindingAuthorityKeyRegistrySha256 = await authorityRegistrySha256(bindingAuthorityKeyRegistry);
  const deploymentId = production
    ? canary ? c.env.TLSN_CANARY_DEPLOYMENT_ID : c.env.TLSN_PRODUCTION_DEPLOYMENT_ID
    : replay ? c.env.TLSN_REPLAY_DEPLOYMENT_ID : null;
  const runtimeVersion = c.env.CF_VERSION_METADATA
    ? {
        version_id: c.env.CF_VERSION_METADATA.id,
        version_tag: c.env.CF_VERSION_METADATA.tag,
        version_timestamp: c.env.CF_VERSION_METADATA.timestamp,
      }
    : null;
  const bindingMode = production && canary && c.env.TLSN_CANARY_BINDING_VALUE
    ? "fixed_canary"
    : replay && c.env.TLSN_TEST_BINDING_VALUE
      ? "fixed"
    : c.env.TLSN_TEST_BINDING_VALUE
      ? "fixed_test"
      : "random";
  const executionMode = shouldUseTriggerExecution(c.env)
    ? "trigger"
    : shouldUseQueueExecution(c.env)
      ? "queue"
      : shouldUseDirectExecution(c.env)
        ? "direct"
        : "sync";
  return c.json({
    schema_version: 2,
    ok: true,
    verifier: "tlsn-alpha15-wasm",
    environment: c.env.TLSN_ENVIRONMENT,
    auth_mode: c.env.TLSN_ENVIRONMENT === "test" && (replay
      ? c.env.TLSN_REPLAY_AUTH_USERS
      : c.env.TLSN_TEST_AUTH_USERS)
      ? "test-token"
      : "supabase",
    device_auth_mode: testDeviceAuthenticationEnabled(c.env)
      ? "test-ed25519"
      : "external-endpoint",
    deployment_role: role,
    git_commit_sha: c.env.TLSN_GIT_COMMIT_SHA ?? null,
    verifier_key_id: verifierKeyId ?? null,
    notary_key_id: notaryKeyId ?? null,
    profile_sha256: profileSha256 ?? null,
    sparse_profile_sha256: sparseProfileSha256 ?? null,
    deployment_id: deploymentId,
    security_registry_set_sha256: c.env.TLSN_SECURITY_REGISTRY_SET_SHA256 ?? null,
    notary_registry_sha256: notaryRegistrySha256,
    result_public_key_spki: resultPublicKeySpki,
    runtime_version: runtimeVersion,
    binding_mode: bindingMode,
    execution_mode: executionMode,
    security_identity: {
      git_commit_sha: c.env.TLSN_GIT_COMMIT_SHA ?? null,
      server_identity: production ? c.env.TLSN_CANDIDATE_SERVER_IDENTITY ?? null : c.env.TLSN_SERVER_IDENTITY,
      profile_sha256: profileSha256 ?? null,
      sparse_profile_sha256: sparseProfileSha256 ?? null,
      verifier_key_id: verifierKeyId ?? null,
      notary_key_id: notaryKeyId ?? null,
      security_registry_set_sha256: c.env.TLSN_SECURITY_REGISTRY_SET_SHA256 ?? null,
      notary_registry_sha256: notaryRegistrySha256,
      binding_authority: "durable-single-use",
      session_authority_key_id: sessionAuthorityKeyId ?? null,
      session_authority_key_registry_sha256: sessionAuthorityKeyRegistrySha256,
      binding_authority_key_id: bindingAuthorityKeyId ?? null,
      binding_authority_key_registry_sha256: bindingAuthorityKeyRegistrySha256,
    },
    deployment_identity: {
      deployment_id: deploymentId,
      deployment_role: role,
      binding_mode: bindingMode,
      trust_root_certificate_sha256: trustRootCertificateSha256,
      worker_name: production
        ? canary ? c.env.TLSN_CANARY_WORKER_NAME ?? null : c.env.TLSN_PRODUCTION_WORKER_NAME ?? null
        : replay ? c.env.TLSN_REPLAY_WORKER_NAME ?? null : c.env.TLSN_TEST_WORKER_NAME ?? null,
    },
    result_identity: {
      result_public_key_spki: resultPublicKeySpki,
      result_public_key_spki_sha256: resultPublicKeySpki
        ? encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", decodeBase64Url(resultPublicKeySpki, 4096))))
        : null,
      ...(resultSignerKeyId && resultKeyRegistrySha256
        ? {
            result_signer_key_id: resultSignerKeyId,
            result_key_registry_sha256: resultKeyRegistrySha256,
            result_key_registry_envelope_sha256: resultKeyRegistryEnvelopeSha256,
            result_registry_root_key_id: resultRegistryRootKeyId,
            result_registry_root_public_key_spki: resultRegistryRootPublicKeySpki,
          }
        : {}),
    },
    authority_identity: {
      session_authority: {
        authority: "fusou-tlsn-session-authority",
        key_id: sessionAuthorityKeyId ?? null,
        public_key_spki: sessionAuthorityPublicKeySpki ?? null,
        key_registry_sha256: sessionAuthorityKeyRegistrySha256,
      },
      binding_authority: {
        authority: "fusou-tlsn-binding-authority",
        key_id: bindingAuthorityKeyId ?? null,
        public_key_spki: bindingAuthorityPublicKeySpki ?? null,
        key_registry_sha256: bindingAuthorityKeyRegistrySha256,
      },
      result_signer: {
        authority: "fusou-tlsn-result-signer",
        key_id: resultSignerKeyId,
        public_key_spki: resultPublicKeySpki,
        key_registry_sha256: resultKeyRegistrySha256,
      },
      execution_boundary: {
        cryptographic_separation: true,
        operational_isolation: "co-located-worker-execution-environment",
        operational_isolation_status: "NOT_PROVIDED",
      },
    },
  });
});

app.post("/attestation/session", async (c) => {
  const sessionBenchmarkEnabled = benchmarkEnabled(c.env);
  const sessionStartedAt = sessionBenchmarkEnabled ? performance.now() : undefined;
  const config = await readConfig(c.env);
  if (!config) {
    return c.json({ error: "verifier_unconfigured" }, 503);
  }
  const sessionConfigMilliseconds = sessionStartedAt === undefined
    ? undefined
    : performance.now() - sessionStartedAt;
  const authentication = requireAuthentication(await authenticateRequest(c.req.raw, c.env));
  if (authentication instanceof Response) {
    return authentication;
  }
  let requestBody: z.infer<typeof deviceProofRequestSchema>;
  try {
    requestBody = deviceProofRequestSchema.parse(await readJsonBody(c.req.raw));
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const sessionAuthorityStartedAt = sessionBenchmarkEnabled ? performance.now() : undefined;
  try {
    const deviceAuthentication = testDeviceAuthenticationEnabled(c.env)
      ? await authenticateTestDeviceProof(authentication, requestBody, c.env)
      : await authenticateDeviceProof(authentication, requestBody, config.deviceAuthUrl);
    if (!deviceAuthentication.ok) {
      return c.json({ error: deviceAuthentication.error }, deviceAuthentication.status);
    }
    if (deviceAuthentication.canonicalUserId !== authentication.canonicalUserId) {
      return c.json({ error: "device_owner_mismatch" }, 403);
    }
    const sessionAuthorityMilliseconds = sessionAuthorityStartedAt === undefined
      ? undefined
      : performance.now() - sessionAuthorityStartedAt;
    const authority = new DurableObjectBindingAuthority(c.env.TLSN_BINDINGS);
    const sessionBindingStartedAt = sessionBenchmarkEnabled ? performance.now() : undefined;
    const record = await authority.issueBinding(
      Date.now(),
      config.bindingTtlSeconds,
      authentication.canonicalUserId,
      deviceAuthentication.deviceId,
      requestBody.nonce,
      c.env.TLSN_ENVIRONMENT === "test"
        ? testBindingValueForRequest(c.env, c.req.raw)
        : c.env.TLSN_DEPLOYMENT_ROLE === "canary"
          ? c.env.TLSN_CANARY_BINDING_VALUE
          : undefined,
    );
    const sessionBindingMilliseconds = sessionBindingStartedAt === undefined
      ? undefined
      : performance.now() - sessionBindingStartedAt;
    const sessionReceiptStartedAt = sessionBenchmarkEnabled ? performance.now() : undefined;
    const sessionReceipt = await signSessionReceipt(config, record);
    const sessionReceiptMilliseconds = sessionReceiptStartedAt === undefined
      ? undefined
      : performance.now() - sessionReceiptStartedAt;
    benchmarkDurationHeader(c, c.env, "Session-Config", sessionConfigMilliseconds);
    benchmarkDurationHeader(c, c.env, "Session-Authority", sessionAuthorityMilliseconds);
    benchmarkDurationHeader(c, c.env, "Session-Binding", sessionBindingMilliseconds);
    benchmarkDurationHeader(c, c.env, "Session-Receipt", sessionReceiptMilliseconds);
    c.header("Cache-Control", "no-store");
    return c.json({
      session_id: record.session_id,
      challenge: record.nonce,
      binding: record.binding_value,
      device_id: record.device_id,
      device_challenge: record.tlsn_device_challenge,
      expires_at: record.expires_at,
      session_receipt: sessionReceipt,
    }, 201);
  } catch {
    return c.json({ error: "authority_unavailable" }, 503);
  }
});

app.post("/verify/tlsn/status", async (c) => {
  const authentication = requireAuthentication(await authenticateRequest(c.req.raw, c.env));
  if (authentication instanceof Response) {
    return authentication;
  }

  let requestBody: z.infer<typeof verificationStatusRequestSchema>;
  try {
    requestBody = verificationStatusRequestSchema.parse(await readJsonBody(c.req.raw));
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  if (requestBody.canonical_user_id !== authentication.canonicalUserId) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const authority = new DurableObjectBindingAuthority(c.env.TLSN_BINDINGS);
  benchmarkRegister(
    c.env,
    requestBody.job_id,
    authority,
    requestBody.binding_id,
    requestBody.benchmark_trace_id,
    shouldUseQueueExecution(c.env) ? "queue" : shouldUseDirectExecution(c.env) ? "direct" : "trigger",
  );
  let record;
  try {
    record = await authority.lookupVerificationJob(requestBody.binding_id, {
      session_id: requestBody.session_id,
      canonical_user_id: authentication.canonicalUserId,
      device_id: requestBody.device_id,
      verification_job_id: requestBody.job_id,
      now: Date.now(),
    });
  } catch (error) {
    const message = error instanceof BindingAuthorityError ? error.code : "binding_unknown";
    return c.json({ verified: false, error: message }, bindingAuthorityStatus(error));
  }

  if (record.status === "processing" || record.status === "verifying") {
    c.header("Cache-Control", "no-store");
    await attachBenchmarkTimingHeader(c, c.env, requestBody.job_id);
    return c.json({ verified: false, status: "processing", job_id: requestBody.job_id }, 202);
  }
  if (record.status === "failed") {
    benchmarkAuthorityLeaseMetadata(c.env, requestBody.job_id, record);
    benchmarkDiagnostic(c.env, requestBody.job_id, "terminal_outcome", "not_verified");
    if (record.verification_failure_code) {
      benchmarkDiagnostic(c.env, requestBody.job_id, "terminal_failure_code", record.verification_failure_code);
    }
    c.header("Cache-Control", "no-store");
    benchmarkServerCompletionHeader(c, c.env, record);
    await attachBenchmarkTimingHeader(c, c.env, requestBody.job_id);
    return c.json({ verified: false, status: "not_verified", job_id: requestBody.job_id }, 200);
  }
  if (record.status !== "consumed" || !record.result_object_key) {
    return c.json({ verified: false, error: "verification_unavailable" }, 503);
  }
  if (!record.result_sha256) {
    return c.json({ verified: false, error: "verification_result_unavailable" }, 503);
  }

  const resultGetStartedAt = performance.now();
  benchmarkRecord(c.env, requestBody.job_id, "status_result_read_started");
  benchmarkDOOperation(c.env, requestBody.job_id, "result_read");
  const authoritativeResult = await readAuthoritativeVerificationResult(authority, requestBody.binding_id, {
    session_id: requestBody.session_id,
    canonical_user_id: authentication.canonicalUserId,
    device_id: requestBody.device_id,
    verification_job_id: requestBody.job_id,
    result_sha256: record.result_sha256,
    result_object_key: record.result_object_key,
    now: Date.now(),
  }).catch(() => null);
  benchmarkRecord(c.env, requestBody.job_id, "status_result_read_completed");
  benchmarkDuration(c.env, requestBody.job_id, "status_result_read", performance.now() - resultGetStartedAt);
  if (!authoritativeResult) {
    return c.json({ verified: false, error: "verification_result_unavailable" }, 503);
  }
  benchmarkDiagnostic(c.env, requestBody.job_id, "status_result_bytes", authoritativeResult.bytes.byteLength);
  benchmarkRecord(c.env, requestBody.job_id, "t10_status_verified");
  benchmarkRecord(c.env, requestBody.job_id, "t11_status_verified");
  benchmarkDiagnostic(c.env, requestBody.job_id, "terminal_outcome", "verified");
  benchmarkAuthorityLeaseMetadata(c.env, requestBody.job_id, record);
  deferBenchmarkFlush(c, requestBody.job_id);
  benchmarkServerCompletionHeader(c, c.env, record);
  await attachBenchmarkTimingHeader(c, c.env, requestBody.job_id);
  c.header("Cache-Control", "no-store");
  c.header("Content-Type", "application/json");
  return new Response(authoritativeResult.bytes, { status: 200, headers: c.res.headers });
});

app.post("/verify/tlsn/retry", async (c) => {
  const authentication = requireAuthentication(await authenticateRequest(c.req.raw, c.env));
  if (authentication instanceof Response) {
    return authentication;
  }
  c.header("Cache-Control", "no-store");
  return c.json({ verified: false, status: "not_verified", error: "verification_retry_disabled" }, 409);
});

const handleTlsnVerification = async (c: Context<{ Bindings: Bindings }>) => {
  const requestBenchmarkEnabled = benchmarkEnabled(c.env);
  const configValidationObservations: PrivateKeyValidationObservation[] = [];
  const configValidationTimings: ConfigValidationTimings = {};
  const configValidationStartedAt = requestBenchmarkEnabled ? performance.now() : undefined;
  const config = await readConfig(
    c.env,
    (observation) => configValidationObservations.push(observation),
    requestBenchmarkEnabled
      ? (component, milliseconds) => addConfigValidationTiming(configValidationTimings, component, milliseconds)
      : undefined,
  );
  const configValidationMilliseconds = configValidationStartedAt === undefined
    ? Number.NaN
    : performance.now() - configValidationStartedAt;
  if (!config) {
    return c.json({ error: "verifier_unconfigured" }, 503);
  }
  const sparseProfile = c.req.path === "/verify/tlsn/sparse";
  if (sparseProfile && !config.sparseProfileSha256Bytes) {
    return c.json({ error: "sparse_verifier_unconfigured" }, 503);
  }
  const requestAuthenticationStartedAt = requestBenchmarkEnabled ? performance.now() : undefined;
  const authentication = requireAuthentication(await authenticateRequest(c.req.raw, c.env));
  const requestAuthenticationMilliseconds = requestAuthenticationStartedAt === undefined
    ? undefined
    : performance.now() - requestAuthenticationStartedAt;
  if (authentication instanceof Response) {
    return authentication;
  }

  let requestBody: z.infer<typeof requestSchema>;
  let requestBodyReadMilliseconds: number | undefined;
  let requestBodyParseMilliseconds: number | undefined;
  try {
    const requestBodyReadStartedAt = requestBenchmarkEnabled ? performance.now() : undefined;
    const rawRequestBody = await readRawBody(c.req.raw, MAX_REQUEST_JSON_BYTES);
    requestBodyReadMilliseconds = requestBodyReadStartedAt === undefined
      ? undefined
      : performance.now() - requestBodyReadStartedAt;
    const requestBodyParseStartedAt = requestBenchmarkEnabled ? performance.now() : undefined;
    requestBody = requestSchema.parse(JSON.parse(rawRequestBody) as unknown);
    requestBodyParseMilliseconds = requestBodyParseStartedAt === undefined
      ? undefined
      : performance.now() - requestBodyParseStartedAt;
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }

  let presentationBytes: Uint8Array;
  let presentationDecodeMilliseconds: number | undefined;
  try {
    const presentationDecodeStartedAt = requestBenchmarkEnabled ? performance.now() : undefined;
    presentationBytes = decodeBase64Url(requestBody.presentation_base64, MAX_PRESENTATION_BYTES);
    presentationDecodeMilliseconds = presentationDecodeStartedAt === undefined
      ? undefined
      : performance.now() - presentationDecodeStartedAt;
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }

  const requestedResponseMode = c.req.header("X-FUSOU-TLSN-Response-Mode")?.trim() || "async";
  if (requestedResponseMode !== "async" && requestedResponseMode !== "sync") {
    return c.json({ verified: false, error: "invalid_response_mode" }, 400);
  }
  const synchronousResponseRequested = requestedResponseMode === "sync";
  const synchronousDirect = synchronousResponseRequested
    && canarySynchronousResponseEnabled(c.env)
    && c.env.TLSN_DIRECT_VERIFIER !== undefined
    && directCallbackSecret(c.env) !== undefined;
  if (synchronousResponseRequested && !synchronousDirect && c.env.TLSN_ENVIRONMENT !== "test") {
    return c.json({ verified: false, error: "sync_unavailable" }, 503);
  }
  const useDirectExecution = synchronousDirect || shouldUseDirectExecution(c.env);
  const useTriggerExecution = !synchronousDirect && shouldUseTriggerExecution(c.env);

  if (
    useTriggerExecution ||
    shouldUseQueueExecution(c.env) ||
    useDirectExecution
  ) {
    const trigger = useTriggerExecution ? triggerExecutionConfig(c.env) : null;
    const queue = shouldUseQueueExecution(c.env) ? c.env.TLSN_VERIFICATION_QUEUE : undefined;
    const direct = useDirectExecution ? c.env.TLSN_DIRECT_VERIFIER : undefined;
    const testSynchronousCandidate = shouldUseSynchronousDirectResponse(c.env);
    const testDirectFault = testDirectFaultForRequest(c.env, c.req.raw);
    const effectiveSynchronousResponse = synchronousDirect
      || (testSynchronousCandidate && testDirectFault !== "pause_before_result_commit");
    if (!trigger && !queue && !direct) {
      return c.json({
        verified: false,
        error: shouldUseQueueExecution(c.env)
          ? "queue_unconfigured"
          : shouldUseDirectExecution(c.env)
            ? "direct_unconfigured"
            : "trigger_unconfigured",
      }, 503);
    }

    const authority = new DurableObjectBindingAuthority(c.env.TLSN_BINDINGS);
    let bindingParts: ReturnType<typeof parseBindingValue>;
    try {
      bindingParts = parseBindingValue(requestBody.binding);
    } catch {
      return c.json({ verified: false, error: "binding_mismatch" }, 422);
    }

    let deviceChallengeBytes: Uint8Array;
    try {
      deviceChallengeBytes = decodeBase64Url(requestBody.device_proof.challenge, 32);
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    if (deviceChallengeBytes.length !== 32) {
      return c.json({ error: "invalid_request" }, 400);
    }

    const devicePossessionProof = {
      device_id: requestBody.device_id,
      session_id: requestBody.session_id,
      binding_value: requestBody.binding,
      challenge: requestBody.device_proof.challenge,
      sig: requestBody.device_proof.sig,
    };
    const devicePossessionStartedAt = requestBenchmarkEnabled ? performance.now() : undefined;
    const devicePossession = testDeviceAuthenticationEnabled(c.env)
      ? await authenticateTestTlsnDeviceProof(authentication, devicePossessionProof, c.env)
      : await authenticateTlsnDeviceProof(authentication, devicePossessionProof, config.devicePossessionAuthUrl);
    const devicePossessionMilliseconds = devicePossessionStartedAt === undefined
      ? undefined
      : performance.now() - devicePossessionStartedAt;
    if (!devicePossession.ok) {
      if (effectiveSynchronousResponse && c.env.TLSN_DEPLOYMENT_ROLE !== "replay" && devicePossession.error === "device_possession_replayed") {
        const replayPresentationId = encodeBase64Url(
          new Uint8Array(await crypto.subtle.digest("SHA-256", presentationBytes)),
        );
        const replayDigestHex = await deviceProofReplayDigestHex(devicePossessionProof).catch(() => null);
        if (replayDigestHex) {
          const replayResponse = await replayConsumedVerificationResult(c, authority, requestBody.binding, {
            session_id: requestBody.session_id,
            canonical_user_id: authentication.canonicalUserId,
            device_id: requestBody.device_id,
            binding_value: requestBody.binding,
            tlsn_device_challenge: requestBody.device_proof.challenge,
            presentation_id: replayPresentationId,
            verification_profile: sparseProfile ? "sparse" : "complete",
            device_replay_digest_hex: replayDigestHex,
            now: Date.now(),
          }, testReplayResultFaultForRequest(c.env, c.req.raw));
          if (replayResponse) return replayResponse;
        }
      }
      if (devicePossession.error === "device_possession_replayed") {
        try {
          const replayBinding = await authority.lookupBinding(
            requestBody.session_id,
            requestBody.binding,
            authentication.canonicalUserId,
            requestBody.device_id,
            Date.now(),
            { allow_consumed: true },
          );
          if (!synchronousDirect && replayBinding.status === "consumed") {
            return c.json({ verified: false, error: "binding_consumed" }, 409);
          }
        } catch (error) {
          if (error instanceof BindingAuthorityError && error.code === "verification_failed") {
            return c.json({ verified: false, error: "verification_failed" }, 422);
          }
        }
      }
      return c.json({ verified: false, error: devicePossession.error }, devicePossession.status);
    }
    if (
      devicePossession.canonicalUserId !== authentication.canonicalUserId ||
      devicePossession.deviceId !== requestBody.device_id
    ) {
      return c.json({ verified: false, error: "device_possession_owner_mismatch" }, 403);
    }

    const presentationHashStartedAt = requestBenchmarkEnabled ? performance.now() : undefined;
    const presentationId = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", presentationBytes)),
    );
    const requestPresentationHashMilliseconds = presentationHashStartedAt === undefined
      ? undefined
      : performance.now() - presentationHashStartedAt;
    const jobId = crypto.randomUUID();
    const directVerificationAttemptId = direct ? crypto.randomUUID() : undefined;
    const benchmarkTraceId = benchmarkEnabled(c.env) ? crypto.randomUUID() : undefined;
    const verificationInputKey = direct ? undefined : verificationObjectKey(jobId, "presentation");
    const verificationResultKey = verificationObjectKey(jobId, "result");
    const bindingId = await hashBindingId(requestBody.binding);
    benchmarkRegister(
      c.env,
      jobId,
      authority,
      bindingId,
      benchmarkTraceId,
      queue ? "queue" : direct ? "direct" : "trigger",
    );
    benchmarkConfigValidation(
      c.env,
      jobId,
      configValidationObservations,
      "request",
      configValidationMilliseconds,
      configValidationTimings,
    );
    benchmarkDiagnostic(c.env, jobId, "profile", sparseProfile ? "sparse" : "complete");
    benchmarkDiagnostic(c.env, jobId, "input_source", direct ? "direct" : "r2");
    benchmarkDuration(c.env, jobId, "request_authentication", requestAuthenticationMilliseconds ?? Number.NaN);
    benchmarkDuration(c.env, jobId, "request_body_read", requestBodyReadMilliseconds ?? Number.NaN);
    benchmarkDuration(c.env, jobId, "request_body_parse", requestBodyParseMilliseconds ?? Number.NaN);
    benchmarkDuration(c.env, jobId, "request_presentation_decode", presentationDecodeMilliseconds ?? Number.NaN);
    benchmarkDuration(c.env, jobId, "request_device_possession", devicePossessionMilliseconds ?? Number.NaN);
    benchmarkDuration(c.env, jobId, "request_presentation_hash", requestPresentationHashMilliseconds ?? Number.NaN);
    benchmarkRecord(c.env, jobId, "t0_accepted");
    const payload = verificationTaskPayloadSchema.parse({
      job_id: jobId,
      binding_id: bindingId,
      session_id: requestBody.session_id,
      canonical_user_id: authentication.canonicalUserId,
      device_id: requestBody.device_id,
      device_challenge: requestBody.device_proof.challenge,
      verification_input_source: direct ? "direct" : "r2",
      ...(verificationInputKey ? { verification_input_key: verificationInputKey } : {}),
      verification_result_key: verificationResultKey,
      ...(benchmarkTraceId ? { benchmark_trace_id: benchmarkTraceId } : {}),
      profile: sparseProfile ? "sparse" : "complete",
      disclosure_mode: sparseProfile ? "sparse" : "full",
    });
    try {
      if (verificationInputKey) {
        await c.env.TLSN_PRESENTATIONS.put(verificationInputKey, presentationBytes, {
          httpMetadata: { contentType: "application/octet-stream" },
        });
        benchmarkR2Operation(c.env, jobId, "input_put");
        benchmarkRecord(c.env, jobId, "t1_presentation_persisted");
      }
      const startVerificationStartedAt = requestBenchmarkEnabled ? performance.now() : undefined;
      await authority.startVerification(requestBody.binding, {
        session_id: requestBody.session_id,
        canonical_user_id: authentication.canonicalUserId,
        device_id: requestBody.device_id,
        binding_value: requestBody.binding,
        nonce: bindingParts.nonce,
        tlsn_device_challenge: requestBody.device_proof.challenge,
        presentation_id: presentationId,
        verification_job_id: jobId,
        verification_input_source: direct ? "direct" : "r2",
        ...(verificationInputKey ? { verification_input_key: verificationInputKey } : {}),
        verification_result_key: verificationResultKey,
        verification_profile: sparseProfile ? "sparse" : "complete",
        device_replay_digest_hex: devicePossession.replayDigestHex,
        ...(directVerificationAttemptId ? { verification_attempt_id: directVerificationAttemptId } : {}),
        now: Date.now(),
      });
      benchmarkDOOperation(c.env, jobId, "start_verification");
      benchmarkDuration(
        c.env,
        jobId,
        "request_start_verification",
        startVerificationStartedAt === undefined ? Number.NaN : performance.now() - startVerificationStartedAt,
      );
      if (direct) benchmarkRecord(c.env, jobId, "t1_direct_input_bound");
    } catch (error) {
      if (verificationInputKey) {
        await c.env.TLSN_PRESENTATIONS.delete(verificationInputKey).catch(() => undefined);
      }
      if (error instanceof BindingAuthorityError) {
        const replayConflict = direct && c.env.TLSN_DEPLOYMENT_ROLE === "replay" && error.code === "binding_conflict";
        return c.json({ verified: false, error: replayConflict ? "binding_consumed" : error.code, job_id: jobId }, bindingAuthorityStatus(error));
      }
      return c.json({ verified: false, error: "trigger_unavailable", job_id: jobId }, 503);
    }
    try {
      if (queue) {
        const queueMessage = verificationQueueMessageSchema.parse({
          ...payload,
          message_type: "tlsn-verification-v1",
          presentation_id: presentationId,
        });
        const queueSendStartedAt = performance.now();
        benchmarkRecord(c.env, jobId, "queue_send_start");
        await enqueueQueueVerification(queue, queueMessage);
        benchmarkDuration(c.env, jobId, "queue_send", performance.now() - queueSendStartedAt);
        benchmarkRecord(c.env, jobId, "queue_send_completed");
        benchmarkRecord(c.env, jobId, "queue_message_accepted");
        benchmarkRecord(c.env, jobId, "t2_queue_submitted");
        benchmarkRecord(c.env, jobId, "t2_queue_message_accepted");
      } else if (trigger) {
        await enqueueTriggerVerification(trigger, payload);
        benchmarkRecord(c.env, jobId, "t2_trigger_submitted");
        benchmarkRecord(c.env, jobId, "t2_trigger_task_accepted");
      } else if (direct) {
        benchmarkRecord(c.env, jobId, "direct_dispatch_started");
        const directDispatchStartedAt = requestBenchmarkEnabled ? performance.now() : undefined;
        const directDispatch = dispatchDirectVerification(
          c.env,
          jobId,
          payload,
          presentationId,
          directVerificationAttemptId ?? "",
          presentationBytes,
          directDispatchStartedAt,
          testDirectFault,
          effectiveSynchronousResponse,
        );
        if (effectiveSynchronousResponse) {
          try {
            const directResponse = await directDispatch;
            if (!directResponse.ok) throw new Error(`direct verifier failed with status ${directResponse.status}`);
            const timingHeader = await benchmarkTimingHeaderValue(c.env, jobId);
            const headers = new Headers(directResponse.headers);
            headers.set("Cache-Control", "no-store");
            if (timingHeader) headers.set("X-FUSOU-TLSN-Benchmark-Timing", timingHeader);
            replayVerificationAttemptHeader(headers, c.env, directVerificationAttemptId);
            return new Response(directResponse.body, {
              status: directResponse.status,
              statusText: directResponse.statusText,
              headers,
            });
          } catch {
            await finalizeVerificationFailure(c.env, {
              bindingId: payload.binding_id,
              sessionId: payload.session_id,
              canonicalUserId: payload.canonical_user_id,
              deviceId: payload.device_id,
              jobId,
              failureCode: "service_binding_failed",
            });
            return c.json({ verified: false, error: "direct_unavailable", job_id: jobId }, 503);
          }
        }
        c.executionCtx.waitUntil(directDispatch.catch(async () => {
          await finalizeVerificationFailure(c.env, {
            bindingId: payload.binding_id,
            sessionId: payload.session_id,
            canonicalUserId: payload.canonical_user_id,
            deviceId: payload.device_id,
            jobId,
            failureCode: "service_binding_failed",
          });
        }));
      }
    } catch {
      await finalizeVerificationFailure(c.env, {
        bindingId: payload.binding_id,
        sessionId: payload.session_id,
        canonicalUserId: payload.canonical_user_id,
        deviceId: payload.device_id,
        jobId,
        failureCode: "callback_failed",
      });
      return c.json({
        verified: false,
        error: queue ? "queue_unavailable" : direct ? "direct_unavailable" : "trigger_unavailable",
        job_id: jobId,
      }, 503);
    }

    c.header("Cache-Control", "no-store");
    if (directVerificationAttemptId !== undefined) {
      c.header(REPLAY_VERIFICATION_ATTEMPT_HEADER, directVerificationAttemptId);
    }
    benchmarkRecord(c.env, jobId, "t1_202_response_sent");
    deferBenchmarkFlush(c, jobId);
    return c.json({
      verified: false,
      status: "queued",
      job_id: jobId,
      ...(benchmarkTraceId ? { benchmark_trace_id: benchmarkTraceId } : {}),
    }, 202);
  }

  const authority = new DurableObjectBindingAuthority(c.env.TLSN_BINDINGS);
  let fallbackBinding: BindingRecord;
  try {
    fallbackBinding = await authority.lookupBinding(
      requestBody.session_id,
      requestBody.binding,
      authentication.canonicalUserId,
      requestBody.device_id,
      Date.now(),
    );
  } catch (error) {
    const message = error instanceof BindingAuthorityError ? error.code : "binding_unknown";
    return c.json({ verified: false, error: message }, bindingAuthorityStatus(error));
  }
  if (requestBody.device_proof.challenge !== fallbackBinding.tlsn_device_challenge) {
    return c.json({ verified: false, error: "device_challenge_mismatch" }, 409);
  }
  let bindingParts: ReturnType<typeof parseBindingValue>;
  try {
    bindingParts = parseBindingValue(requestBody.binding);
  } catch {
    return c.json({ verified: false, error: "binding_mismatch" }, 422);
  }

  const synchronousJobId = crypto.randomUUID();
  const synchronousAttemptId = crypto.randomUUID();
  const synchronousResultKey = verificationObjectKey(synchronousJobId, "result");
  const synchronousBindingId = await hashBindingId(requestBody.binding);

  let deviceChallengeBytes: Uint8Array;
  try {
    deviceChallengeBytes = decodeBase64Url(requestBody.device_proof.challenge, 32);
  } catch {
    return c.json({ verified: false, error: "invalid_request" }, 400);
  }
  if (deviceChallengeBytes.length !== 32) {
    return c.json({ verified: false, error: "invalid_request" }, 400);
  }

  try {
    await ensureWasmInitialized();
  } catch {
    return c.json({ error: "verifier_unavailable" }, 503);
  }

  try {
    const prepared = verifyPresentationToPreparedResult(
      config,
      sparseProfile ? "sparse" : "complete",
      presentationBytes,
      authentication.canonicalUserId,
      requestBody.device_id,
      deviceChallengeBytes,
    );
    const authenticatedResult = authenticatedResultSchema.parse(
      JSON.parse(prepared.unsigned_result) as unknown,
    );
    if (
      authenticatedResult.attestation_session_id !== requestBody.session_id ||
      authenticatedResult.canonical_user_id !== authentication.canonicalUserId ||
      authenticatedResult.device_id !== requestBody.device_id ||
      authenticatedResult.device_challenge !== requestBody.device_proof.challenge ||
      authenticatedResult.binding_nonce !== bindingParts.nonce ||
      authenticatedResult.binding_value !== requestBody.binding
    ) {
      return c.json({ verified: false, error: "binding_mismatch" }, 422);
    }
    const devicePossessionProof = {
      device_id: requestBody.device_id,
      session_id: requestBody.session_id,
      binding_value: requestBody.binding,
      challenge: requestBody.device_proof.challenge,
      sig: requestBody.device_proof.sig,
    };
    const devicePossession = testDeviceAuthenticationEnabled(c.env)
      ? await authenticateTestTlsnDeviceProof(authentication, devicePossessionProof, c.env)
      : await authenticateTlsnDeviceProof(authentication, devicePossessionProof, config.devicePossessionAuthUrl);
    if (!devicePossession.ok) {
      return c.json({ verified: false, error: devicePossession.error }, devicePossession.status);
    }
    if (
      devicePossession.canonicalUserId !== authentication.canonicalUserId ||
      devicePossession.deviceId !== requestBody.device_id
    ) {
      return c.json({ verified: false, error: "device_possession_owner_mismatch" }, 403);
    }
    const presentationId = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", presentationBytes)),
    );
    benchmarkDOOperation(c.env, synchronousJobId, "start_verification");
    await authority.startVerification(requestBody.binding, {
      session_id: requestBody.session_id,
      canonical_user_id: authentication.canonicalUserId,
      device_id: requestBody.device_id,
      binding_value: requestBody.binding,
      nonce: bindingParts.nonce,
      tlsn_device_challenge: requestBody.device_proof.challenge,
      presentation_id: presentationId,
      verification_job_id: synchronousJobId,
      verification_input_source: "direct",
      verification_result_key: synchronousResultKey,
      verification_profile: sparseProfile ? "sparse" : "complete",
      device_replay_digest_hex: devicePossession.replayDigestHex,
      verification_attempt_id: synchronousAttemptId,
      now: Date.now(),
    });
    benchmarkDOOperation(c.env, synchronousJobId, "acquire_verification");
    await authority.acquireVerification(synchronousBindingId, {
      session_id: requestBody.session_id,
      canonical_user_id: authentication.canonicalUserId,
      device_id: requestBody.device_id,
      verification_job_id: synchronousJobId,
      presentation_id: presentationId,
      verification_profile: sparseProfile ? "sparse" : "complete",
      verification_attempt_id: synchronousAttemptId,
      verification_lease_expires_at: new Date(Date.now() + verificationLeaseMs(c.env)).toISOString(),
      result_object_key: synchronousResultKey,
      now: Date.now(),
      benchmark_timing: benchmarkEnabled(c.env),
    }, benchmarkAcquireVerificationOptions(c.env, synchronousJobId));
    const signingBytes = decodeBase64Url(prepared.signing_bytes, MAX_RESULT_JSON_BYTES);
    const derivedSigningBytes = sparseProfile
      ? derive_sparse_verifier_result_signing_bytes(prepared.unsigned_result)
      : derive_verifier_result_signing_bytes(prepared.unsigned_result);
    if (!hasSameBytes(derivedSigningBytes, signingBytes)) {
      return c.json({ verified: false, error: "signing_bytes_mismatch" }, 422);
    }
    const signature = await (sparseProfile ? signSparseResult(config, signingBytes) : signResult(config, signingBytes));
    if (signature.length !== 64) {
      return c.json({ error: "verifier_unavailable" }, 503);
    }
    const signedResultJson = sparseProfile
      ? attach_sparse_verifier_result_signature(prepared.unsigned_result, signature)
      : attach_verifier_result_signature(prepared.unsigned_result, signature);
    const signedResult = JSON.parse(signedResultJson) as Record<string, unknown>;
    const usedAt = new Date().toISOString();
    const consumeReceipt = await signConsumeReceipt(config, {
      session_id: requestBody.session_id,
      canonical_user_id: authentication.canonicalUserId,
      device_id: requestBody.device_id,
      nonce: bindingParts.nonce,
      binding_value: requestBody.binding,
      presentation_id: presentationId,
      used_at: usedAt,
    });
    const finalResponse = verificationFinalResponseSchema.parse({
      verified: true,
      result: signedResult,
      signer_key_id: config.resultSignerKeyId ?? config.verifierKeyId,
      signature_algorithm: "Ed25519",
      consume_receipt: consumeReceipt,
      device_replay_digest_hex: devicePossession.replayDigestHex,
    });
    const finalResponseBody = JSON.stringify(finalResponse);
    const finalResponseBytes = new TextEncoder().encode(finalResponseBody);
    const resultSha256 = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", finalResponseBytes)),
    );
    benchmarkDOOperation(c.env, synchronousJobId, "commit_verified_result");
    const committedBinding = await authority.commitVerifiedResult(synchronousBindingId, {
      session_id: requestBody.session_id,
      canonical_user_id: authentication.canonicalUserId,
      device_id: requestBody.device_id,
      binding_value: requestBody.binding,
      nonce: bindingParts.nonce,
      presentation_id: presentationId,
      verification_attempt_id: synchronousAttemptId,
      verification_job_id: synchronousJobId,
      verification_profile: sparseProfile ? "sparse" : "complete",
      verification_result_key: synchronousResultKey,
      result_sha256: resultSha256,
      result_object_key: synchronousResultKey,
      result_bytes: finalResponseBytes,
      used_at: usedAt,
      now: Date.now(),
      benchmark_timing: benchmarkEnabled(c.env),
      benchmark_persistence_started_at: new Date().toISOString(),
    });
    benchmarkAuthorityLeaseMetadata(c.env, synchronousJobId, committedBinding);
    const completionEpoch = Date.parse(committedBinding.benchmark_server_completion_at ?? "");
    if (Number.isFinite(completionEpoch)) c.header(SERVER_COMPLETION_EPOCH_HEADER, String(completionEpoch));
    c.executionCtx.waitUntil(c.env.TLSN_PRESENTATIONS.put(
      synchronousResultKey,
      finalResponseBytes,
      { httpMetadata: { contentType: "application/json" } },
    ).catch(() => undefined));
    c.header("Cache-Control", "no-store");
    c.header("Content-Type", "application/json");
    if (c.env.TLSN_ENVIRONMENT === "test" && c.env.TLSN_DEPLOYMENT_ROLE === "replay") {
      c.header(REPLAY_VERIFICATION_ATTEMPT_HEADER, synchronousAttemptId);
    }
    return c.body(finalResponseBody, 200);
  } catch {
    await finalizeVerificationFailure(c.env, {
      bindingId: synchronousBindingId,
      sessionId: requestBody.session_id,
      canonicalUserId: authentication.canonicalUserId,
      deviceId: requestBody.device_id,
      jobId: synchronousJobId,
      verificationAttemptId: synchronousAttemptId,
      failureCode: "verifier_failed",
    });
    return c.json({ verified: false, error: "verification_failed" }, 422);
  }
};

app.post("/verify/tlsn", handleTlsnVerification);
app.post("/verify/tlsn/sparse", handleTlsnVerification);

async function finalizeQueuedVerificationFailure(
  env: Bindings,
  message: z.infer<typeof verificationQueueMessageSchema>,
  failureCode: VerificationFailureCode,
): Promise<void> {
  const authority = new DurableObjectBindingAuthority(env.TLSN_BINDINGS);
  let record: BindingRecord;
  try {
    record = await authority.lookupVerificationJob(message.binding_id, {
      session_id: message.session_id,
      canonical_user_id: message.canonical_user_id,
      device_id: message.device_id,
      verification_job_id: message.job_id,
      now: Date.now(),
    });
  } catch {
    return;
  }
  await finalizeVerificationFailure(env, {
    bindingId: message.binding_id,
    sessionId: message.session_id,
    canonicalUserId: message.canonical_user_id,
    deviceId: message.device_id,
    jobId: message.job_id,
    ...(record.verification_attempt_id ? { verificationAttemptId: record.verification_attempt_id } : {}),
    failureCode,
  });
}

async function handleVerificationQueue(
  batch: MessageBatch<VerificationQueueMessage>,
  env: Bindings,
  ctx: ExecutionContext,
): Promise<void> {
  const consumerStartedAt = Date.now();
  const consumerStartedPerformanceAt = performance.now();
  const callbackSecret = queueCallbackSecret(env);
  if (!callbackSecret) {
    for (const message of batch.messages) {
      const parsed = verificationQueueMessageSchema.safeParse(message.body);
      if (parsed.success) {
        await finalizeQueuedVerificationFailure(env, parsed.data, "callback_failed");
      }
      message.ack();
    }
    return;
  }

  for (const message of batch.messages) {
    const parsed = verificationQueueMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      message.ack();
      continue;
    }
    const queueMessage = parsed.data;
    const authority = new DurableObjectBindingAuthority(env.TLSN_BINDINGS);
    benchmarkRegister(
      env,
      queueMessage.job_id,
      authority,
      queueMessage.binding_id,
      queueMessage.benchmark_trace_id,
      "queue",
    );
    benchmarkRecord(env, queueMessage.job_id, "queue_consumer_scheduled", message.timestamp.getTime());
    benchmarkRecord(env, queueMessage.job_id, "queue_consumer_started", consumerStartedAt);
    benchmarkRecord(env, queueMessage.job_id, "queue_handler_entered");
    benchmarkDuration(
      env,
      queueMessage.job_id,
      "queue_batch_to_handler",
      performance.now() - consumerStartedPerformanceAt,
    );
    benchmarkDiagnostic(env, queueMessage.job_id, "queue_message_id_present", typeof message.id === "string");
    benchmarkDiagnostic(env, queueMessage.job_id, "queue_message_timestamp_ms", message.timestamp.getTime());
    benchmarkDiagnostic(env, queueMessage.job_id, "queue_message_attempts", message.attempts);
    benchmarkRecord(env, queueMessage.job_id, "t3_queue_execution_started");
    const callbackBody = JSON.stringify({
      job_id: queueMessage.job_id,
      binding_id: queueMessage.binding_id,
      session_id: queueMessage.session_id,
      canonical_user_id: queueMessage.canonical_user_id,
      device_id: queueMessage.device_id,
      presentation_id: queueMessage.presentation_id,
      verification_status: "verified",
      profile: queueMessage.profile,
      disclosure_mode: queueMessage.disclosure_mode,
      ...(queueMessage.benchmark_trace_id
        ? { benchmark_trace_id: queueMessage.benchmark_trace_id }
        : {}),
    });
    try {
      const signature = await internalRequestSignature(callbackSecret, queueMessage.job_id, callbackBody);
      benchmarkRecord(env, queueMessage.job_id, "t3_queue_callback_dispatch_started");
      const response = await processVerificationCompletion(
        directVerificationCompletionContext(env, ctx),
        callbackBody,
        queueMessage.job_id,
        signature,
        "queue",
        false,
      );
      benchmarkRecord(env, queueMessage.job_id, "t3_queue_callback_response_received");
      ctx.waitUntil(benchmarkFlush(env, queueMessage.job_id));
      if (response.status >= 500) {
        await finalizeQueuedVerificationFailure(env, queueMessage, "callback_failed");
      }
      message.ack();
    } catch {
      await finalizeQueuedVerificationFailure(env, queueMessage, "callback_failed");
      message.ack();
    }
  }
}

export { app, TlsnBindingAuthorityDurableObject };
export default {
  fetch: app.fetch,
  queue: handleVerificationQueue,
};