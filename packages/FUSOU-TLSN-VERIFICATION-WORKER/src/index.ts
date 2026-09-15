import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  BindingAuthorityError,
  DurableObjectBindingAuthority,
  TlsnBindingAuthorityDurableObject,
  encodeBase64Url,
  hashBindingId,
  type BindingRecord,
} from "./binding_authority.js";
import {
  attestationConsumeReceiptSigningBytes,
  attestationSessionReceiptSigningBytes,
} from "./attestation_receipts.js";
import {
  verificationCallbackSchema,
  verificationFinalResponseSchema,
  verificationInputRequestSchema,
  verificationObjectKey,
  verificationStatusRequestSchema,
  verificationTaskPayloadSchema,
  type VerificationTaskPayload,
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

type Bindings = {
  TLSN_ENVIRONMENT: string;
  TLSN_BINDINGS: DurableObjectNamespace;
  TLSN_PRESENTATIONS: R2Bucket;
  TLSN_BINDING_TTL_SECONDS: string;
  TLSN_EXECUTION_MODE?: string;
  TLSN_TRIGGER_API_URL?: string;
  TLSN_TRIGGER_TASK_ID?: string;
  TLSN_TRIGGER_SECRET_KEY?: string;
  TLSN_TRIGGER_CALLBACK_SECRET?: string;
  TLSN_TEST_COMPLETION_DELAY_MS?: string;
  TLSN_TEST_COMPLETION_DELAY_ONCE?: string;
  TLSN_TEST_VERIFICATION_LEASE_MS?: string;
  TLSN_TEST_POST_RESULT_DELAY_MS?: string;
  TLSN_TEST_POST_RESULT_DELAY_ONCE?: string;
  TLSN_CANARY_TRIGGER_API_URL?: string;
  TLSN_CANARY_TRIGGER_TASK_ID?: string;
  TLSN_CANARY_TRIGGER_SECRET_KEY?: string;
  TLSN_CANARY_TRIGGER_CALLBACK_SECRET?: string;
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
const MAX_INTERNAL_CALLBACK_JSON_BYTES = 64 * 1024;
const VERIFICATION_LEASE_MS = 10 * 60 * 1000;

type BenchmarkTimingStage =
  | "t0_accepted"
  | "t1_presentation_persisted"
  | "t1_202_response_sent"
  | "t2_trigger_submitted"
  | "t2_trigger_task_accepted"
  | "t3_callback_accepted"
  | "t3_trigger_execution_started"
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
  | "t11_status_verified";

type BenchmarkTimingRecord = {
  timestamps: Partial<Record<BenchmarkTimingStage, number>>;
  r2_operations: Record<string, number>;
  max_verifier_concurrency: number;
};

const benchmarkTimingRecords = new Map<string, BenchmarkTimingRecord>();
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

function benchmarkEnabled(env: Bindings): boolean {
  return env.TLSN_BENCHMARK_TIMINGS === "true" && (
    env.TLSN_ENVIRONMENT === "test" ||
    (env.TLSN_ENVIRONMENT === "production" && env.TLSN_DEPLOYMENT_ROLE === "canary")
  );
}

function benchmarkRecord(env: Bindings, jobId: string, stage: BenchmarkTimingStage, timestamp = Date.now()): void {
  if (!benchmarkEnabled(env)) return;
  const record = benchmarkTimingRecords.get(jobId) ?? {
    timestamps: {},
    r2_operations: {},
    max_verifier_concurrency: benchmarkMaxVerifierConcurrency,
  };
  record.timestamps[stage] = timestamp;
  record.max_verifier_concurrency = benchmarkMaxVerifierConcurrency;
  benchmarkTimingRecords.set(jobId, record);
}

function benchmarkR2Operation(env: Bindings, jobId: string, operation: string): void {
  if (!benchmarkEnabled(env)) return;
  const record = benchmarkTimingRecords.get(jobId) ?? {
    timestamps: {},
    r2_operations: {},
    max_verifier_concurrency: benchmarkMaxVerifierConcurrency,
  };
  record.r2_operations[operation] = (record.r2_operations[operation] ?? 0) + 1;
  record.max_verifier_concurrency = benchmarkMaxVerifierConcurrency;
  benchmarkTimingRecords.set(jobId, record);
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

function attachBenchmarkTimingHeader(c: Context<{ Bindings: Bindings }>, env: Bindings, jobId: string): void {
  if (!benchmarkEnabled(env)) return;
  const record = benchmarkTimingRecords.get(jobId);
  if (!record) return;
  c.header(
    "X-FUSOU-TLSN-Benchmark-Timing",
    encodeBase64Url(new TextEncoder().encode(JSON.stringify({
      ...record,
      max_verifier_concurrency: benchmarkMaxVerifierConcurrency,
    }))),
  );
}

function testBindingValueForRequest(env: Bindings, request: Request): string | undefined {
  if (env.TLSN_ENVIRONMENT !== "test") return undefined;
  if (env.TLSN_TEST_BINDING_VALUES === undefined) return env.TLSN_TEST_BINDING_VALUE?.trim() || undefined;
  const requested = request.headers.get("X-FUSOU-TLSN-Test-Binding")?.trim();
  const allowed = env.TLSN_TEST_BINDING_VALUES.split(",").map((value) => value.trim()).filter(Boolean);
  return requested && allowed.includes(requested) ? requested : undefined;
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
  if (env.TLSN_ENVIRONMENT !== "test" || env.TLSN_TEST_VERIFICATION_LEASE_MS === undefined) {
    return VERIFICATION_LEASE_MS;
  }
  const leaseMs = Number(env.TLSN_TEST_VERIFICATION_LEASE_MS);
  return Number.isInteger(leaseMs) && leaseMs > 0 && leaseMs <= VERIFICATION_LEASE_MS
    ? leaseMs
    : VERIFICATION_LEASE_MS;
}

async function delayAfterResultPersistence(env: Bindings): Promise<void> {
  if (env.TLSN_ENVIRONMENT !== "test" || env.TLSN_TEST_POST_RESULT_DELAY_MS === undefined) return;
  const delayMs = Number(env.TLSN_TEST_POST_RESULT_DELAY_MS);
  if (!Number.isInteger(delayMs) || delayMs <= 0 || delayMs > 5_000) return;
  if (env.TLSN_TEST_POST_RESULT_DELAY_ONCE === "true") {
    if (testPostResultDelayUsed) return;
    testPostResultDelayUsed = true;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function decodeBase64Url(value: string, maximumBytes: number): Uint8Array {
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

function isSha256Base64Url(value: string | undefined): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function isPublicKeyBase64Url(value: string | undefined): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]{59}$/.test(value);
}

async function privateKeyMatchesPublicKey(privateKeyBytes: Uint8Array, publicKeySpki: string): Promise<boolean> {
  try {
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      privateKeyBytes,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const publicKey = await crypto.subtle.importKey(
      "spki",
      decodeBase64Url(publicKeySpki, 4096),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const probe = new TextEncoder().encode("FUSOU-TLSN-AUTHORITY-KEY-CHECK-V1");
    const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, probe);
    return await crypto.subtle.verify({ name: "Ed25519" }, publicKey, signature, probe);
  } catch {
    return false;
  }
}

async function readConfig(env: Bindings): Promise<VerifierConfig | null> {
  const production = env.TLSN_ENVIRONMENT === "production";
  const role = env.TLSN_DEPLOYMENT_ROLE;
  const canary = production && role === "canary";
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
    : undefined;
  const resultSignerKeyId = production
    ? canary ? env.TLSN_CANARY_RESULT_SIGNER_KEY_ID : env.TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID
    : undefined;
  const resultSigningKeyRegistry = production
    ? canary ? env.TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY : env.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY
    : undefined;
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
      production &&
      (!isSafeDeploymentId(canary ? env.TLSN_CANARY_DEPLOYMENT_ID : env.TLSN_PRODUCTION_DEPLOYMENT_ID) ||
        !isSha256Base64Url(env.TLSN_SECURITY_REGISTRY_SET_SHA256) ||
        containsTestFixtureMarker(parsed.data.verifierKeyId) ||
        containsTestFixtureMarker(parsed.data.notaryKeyId) ||
        containsTestFixtureMarker(parsed.data.serverIdentity))
    ) {
      return null;
    }
    if (production && !parsed.data.trustRootCertificateDer) {
      return null;
    }
    if (production && !isPublicKeyBase64Url(parsed.data.resultPublicKeySpki)) {
      return null;
    }
    if (production && (!parsed.data.resultSignerKeyId || !parsed.data.resultSigningKeyRegistry)) {
      return null;
    }
    if (production) {
      const resultRegistry = resultSigningKeyRegistrySchema.safeParse(JSON.parse(parsed.data.resultSigningKeyRegistry ?? ""));
      if (!resultRegistry.success) return null;
      const currentResultKey = resultRegistry.data.keys.find((key) => key.key_id === parsed.data.resultSignerKeyId);
      const now = Date.now();
      if (
        !currentResultKey ||
        currentResultKey.public_key_spki !== parsed.data.resultPublicKeySpki ||
        currentResultKey.status !== "ACTIVE" ||
        Date.parse(currentResultKey.not_before) > now ||
        (currentResultKey.not_after !== null && Date.parse(currentResultKey.not_after) < now)
      ) return null;
    }
    const sessionRegistry = authorityKeyRegistrySchema.safeParse(JSON.parse(parsed.data.sessionAuthorityKeyRegistry));
    const bindingRegistry = authorityKeyRegistrySchema.safeParse(JSON.parse(parsed.data.bindingAuthorityKeyRegistry));
    const now = Date.now();
    const currentSessionKey = sessionRegistry.success
      ? sessionRegistry.data.keys.find((key) => key.key_id === parsed.data.sessionAuthorityKeyId)
      : null;
    const currentBindingKey = bindingRegistry.success
      ? bindingRegistry.data.keys.find((key) => key.key_id === parsed.data.bindingAuthorityKeyId)
      : null;
    if (
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
    ) return null;
    if (
      parsed.data.sessionAuthorityPublicKeySpki === parsed.data.bindingAuthorityPublicKeySpki ||
      (production && (
        parsed.data.resultPublicKeySpki === parsed.data.sessionAuthorityPublicKeySpki ||
        parsed.data.resultPublicKeySpki === parsed.data.bindingAuthorityPublicKeySpki
      ))
    ) return null;
    if (production) {
      const deviceAuthAllowedHosts = parseHostnameAllowlist(parsed.data.deviceAuthAllowedHosts);
      const supabaseAllowedHosts = parseHostnameAllowlist(env.TLSN_CANDIDATE_SUPABASE_ALLOWED_HOSTS);
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
    const notaryRegistry = notaryRegistrySchema.safeParse(JSON.parse(parsed.data.notaryRegistry));
    if (!notaryRegistry.success) {
      return null;
    }
    const notaryKeyValue = notaryRegistry.data[parsed.data.notaryKeyId];
    if (!notaryKeyValue) {
      return null;
    }
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
    if (
      !await privateKeyMatchesPublicKey(sessionAuthoritySigningPrivateKeyBytes, parsed.data.sessionAuthorityPublicKeySpki) ||
      !await privateKeyMatchesPublicKey(bindingAuthoritySigningPrivateKeyBytes, parsed.data.bindingAuthorityPublicKeySpki) ||
      (production && !await privateKeyMatchesPublicKey(resultSigningPrivateKeyBytes, parsed.data.resultPublicKeySpki ?? ""))
    ) {
      return null;
    }
    const trustRootCertificateDerBytes = parsed.data.trustRootCertificateDer
      ? decodeBase64Url(parsed.data.trustRootCertificateDer, 4096)
      : undefined;
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

async function readRawBody(request: Request, maximumBytes: number): Promise<string> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null && Number(contentLength) > maximumBytes) {
    throw new Error("request body is too large");
  }
  const raw = await request.text();
  if (raw.length > maximumBytes) {
    throw new Error("request body is too large");
  }
  return raw;
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
  if (env.TLSN_ENVIRONMENT === "test" && env.TLSN_TEST_AUTH_USERS) {
    try {
      const users = testAuthUsersSchema.parse(JSON.parse(env.TLSN_TEST_AUTH_USERS));
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
  return env.TLSN_ENVIRONMENT === "test" &&
    Boolean(env.TLSN_TEST_DEVICE_ID?.trim()) &&
    Boolean(env.TLSN_TEST_DEVICE_PUBLIC_KEY?.trim());
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

async function authenticateTestDeviceProof(
  subject: AuthenticatedSubject,
  proof: z.infer<typeof deviceProofRequestSchema>,
  env: Bindings,
): Promise<DeviceAuthenticationResult> {
  if (!testDeviceAuthenticationEnabled(env) || proof.device_id !== env.TLSN_TEST_DEVICE_ID) {
    return { ok: false, status: 503, error: "device_auth_unconfigured" };
  }
  const valid = await verifyTestDeviceSignature(
    env.TLSN_TEST_DEVICE_PUBLIC_KEY!,
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
): Promise<DevicePossessionAuthenticationResult> {
  if (!testDeviceAuthenticationEnabled(env) || proof.device_id !== env.TLSN_TEST_DEVICE_ID) {
    return { ok: false, status: 503, error: "device_possession_unavailable" };
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
  const valid = await verifyTestDeviceSignature(env.TLSN_TEST_DEVICE_PUBLIC_KEY!, message, proof.sig);
  if (!valid) return { ok: false, status: 401, error: "device_possession_unauthorized" };
  if (!rememberTestDeviceValue(testDeviceProofDigests, `${subject.canonicalUserId}\0${replayDigestHex}`)) {
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
): Promise<DevicePossessionAuthenticationResult> {
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
  return { apiUrl, taskId, secretKey, callbackSecret };
}

function shouldUseTriggerExecution(env: Bindings): boolean {
  return env.TLSN_ENVIRONMENT === "production" || env.TLSN_EXECUTION_MODE === "trigger";
}

function triggerCallbackSecret(env: Bindings): string | undefined {
  if (env.TLSN_ENVIRONMENT !== "production") return env.TLSN_TRIGGER_CALLBACK_SECRET;
  return env.TLSN_DEPLOYMENT_ROLE === "canary"
    ? env.TLSN_CANARY_TRIGGER_CALLBACK_SECRET
    : env.TLSN_PRODUCTION_TRIGGER_CALLBACK_SECRET;
}

async function enqueueTriggerVerification(
  config: TriggerExecutionConfig,
  payload: VerificationTaskPayload,
): Promise<void> {
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
          maxAttempts: 3,
          maxDuration: 600,
        },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Trigger enqueue failed with status ${response.status}`);
  }
}

app.post("/internal/tlsn/verification-input", async (c) => {
  const rawBody = await readRawBody(c.req.raw, 64 * 1024).catch(() => null);
  const jobId = c.req.header("X-FUSOU-TLSN-Job-Id") ?? "";
  const signature = c.req.header("X-FUSOU-TLSN-Signature") ?? null;
  const callbackSecret = triggerCallbackSecret(c.env);
  if (
    rawBody === null ||
    !callbackSecret ||
    !await verifyInternalRequest(callbackSecret, jobId, rawBody, signature)
  ) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const parsed = verificationInputRequestSchema.safeParse(JSON.parse(rawBody) as unknown);
  if (!parsed.success || parsed.data.job_id !== jobId) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const authority = new DurableObjectBindingAuthority(c.env.TLSN_BINDINGS);
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
    record.verification_input_key !== parsed.data.verification_input_key
  ) {
    return c.json({ error: "job_unavailable" }, 409);
  }

  const object = await c.env.TLSN_PRESENTATIONS.get(record.verification_input_key);
  benchmarkR2Operation(c.env, parsed.data.job_id, "trigger_input_get");
  if (!object || object.size > MAX_PRESENTATION_BYTES) {
    return c.json({ error: "verification_input_unavailable" }, 503);
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Length": String(object.size),
    },
  });
});

app.post("/internal/tlsn/verification-complete", async (c) => {
  const rawBody = await readRawBody(c.req.raw, MAX_INTERNAL_CALLBACK_JSON_BYTES).catch(() => null);
  const jobId = c.req.header("X-FUSOU-TLSN-Job-Id") ?? "";
  const signature = c.req.header("X-FUSOU-TLSN-Signature") ?? null;
  const callbackSecret = triggerCallbackSecret(c.env);
  if (
    rawBody === null ||
    !callbackSecret ||
    !await verifyInternalRequest(callbackSecret, jobId, rawBody, signature)
  ) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let callback;
  try {
    callback = verificationCallbackSchema.parse(JSON.parse(rawBody) as unknown);
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  if (callback.job_id !== jobId) {
    return c.json({ error: "invalid_request" }, 400);
  }
  benchmarkRecord(c.env, callback.job_id, "t3_callback_accepted");
  benchmarkRecord(c.env, callback.job_id, "t4_callback_accepted");
  if (callback.trigger_execution_started_at !== undefined) {
    benchmarkRecord(c.env, callback.job_id, "t3_trigger_execution_started", callback.trigger_execution_started_at);
  }

  const config = await readConfig(c.env);
  if (!config) {
    return c.json({ error: "verifier_unconfigured" }, 503);
  }
  const authority = new DurableObjectBindingAuthority(c.env.TLSN_BINDINGS);
  let record;
  try {
    record = await authority.lookupVerificationJob(callback.binding_id, {
      session_id: callback.session_id,
      canonical_user_id: callback.canonical_user_id,
      device_id: callback.device_id,
      verification_job_id: callback.job_id,
      now: Date.now(),
    });
  } catch (error) {
    return c.json({ error: error instanceof BindingAuthorityError ? error.code : "job_unavailable" }, 409);
  }
  if (
    record.presentation_id !== callback.presentation_id ||
    record.verification_input_key === undefined ||
    record.verification_result_key === undefined ||
    record.device_replay_digest_hex === undefined
  ) {
    return c.json({ error: "verification_result_mismatch" }, 422);
  }

  const expectedProfile = record.verification_profile ?? "complete";
  if (
    callback.profile !== expectedProfile ||
    callback.disclosure_mode !== (expectedProfile === "sparse" ? "sparse" : "full")
  ) {
    return c.json({ error: "verification_profile_mismatch" }, 422);
  }

  const readConsumedResult = async (resultRecord: BindingRecord): Promise<Response> => {
    if (!resultRecord.result_sha256) {
      return c.json({ error: "verification_result_unavailable" }, 503);
    }
    const resultObjectKey = resultRecord.result_object_key;
    if (!resultObjectKey) {
      return c.json({ error: "verification_result_unavailable" }, 503);
    }
    const existing = await c.env.TLSN_PRESENTATIONS.get(resultObjectKey);
    if (!existing || existing.size > MAX_INTERNAL_CALLBACK_JSON_BYTES) {
      return c.json({ error: "verification_result_unavailable" }, 503);
    }
    const resultBody = await existing.text();
    const resultSha256 = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(resultBody))),
    );
    if (resultSha256 !== resultRecord.result_sha256) {
      return c.json({ error: "verification_result_unavailable" }, 503);
    }
    try {
      verificationFinalResponseSchema.parse(JSON.parse(resultBody) as unknown);
      return c.json({ accepted: true });
    } catch {
      return c.json({ error: "verification_result_unavailable" }, 503);
    }
  };

  if (record.status === "consumed") {
    return readConsumedResult(record);
  }
  if (record.status !== "processing" && record.status !== "verifying") {
    return c.json({ error: "job_unavailable" }, 409);
  }

  const verificationAttemptId = crypto.randomUUID();
  const attemptResultKey = verificationObjectKey(verificationAttemptId, "result");
  let verificationRecord;
  try {
    verificationRecord = await authority.acquireVerification(callback.binding_id, {
      session_id: record.session_id,
      canonical_user_id: record.canonical_user_id,
      device_id: record.device_id,
      verification_job_id: callback.job_id,
      presentation_id: callback.presentation_id,
      verification_attempt_id: verificationAttemptId,
      verification_lease_expires_at: new Date(Date.now() + verificationLeaseMs(c.env)).toISOString(),
      result_object_key: attemptResultKey,
      now: Date.now(),
    });
  } catch (error) {
    return c.json({ error: error instanceof BindingAuthorityError ? error.code : "job_unavailable" }, 409);
  }
  if (verificationRecord.status === "consumed") {
    return readConsumedResult(verificationRecord);
  }
  if (
    verificationRecord.status !== "verifying" ||
    verificationRecord.verification_attempt_id !== verificationAttemptId
  ) {
    return c.json({ accepted: false, status: "processing" }, 202);
  }
  if (
    verificationRecord.verification_input_key === undefined ||
    verificationRecord.verification_result_key === undefined ||
    verificationRecord.device_replay_digest_hex === undefined
  ) {
    return c.json({ error: "verification_result_mismatch" }, 422);
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
  let resultPersisted = false;
  let preserveAttemptResult = false;
  let benchmarkVerifierStarted = true;
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
  try {
    const presentationObject = await c.env.TLSN_PRESENTATIONS.get(completionRecord.verification_input_key);
    if (!presentationObject || presentationObject.size > MAX_PRESENTATION_BYTES) {
      await releaseVerificationLease();
      return c.json({ error: "verification_input_unavailable" }, 503);
    }
    storedPresentation = new Uint8Array(await presentationObject.arrayBuffer());
    benchmarkR2Operation(c.env, callback.job_id, "worker_presentation_get");
    benchmarkRecord(c.env, callback.job_id, "t5_presentation_read");
    benchmarkRecord(c.env, callback.job_id, "t6_presentation_read");
    storedPresentationId = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", storedPresentation)),
    );
  } catch {
    await releaseVerificationLease();
    return c.json({ error: "verification_input_unavailable" }, 503);
  }
  if (storedPresentationId !== completionRecord.presentation_id || storedPresentationId !== callback.presentation_id) {
    await releaseVerificationLease();
    return c.json({ error: "verification_result_mismatch" }, 422);
  }

  try {
    const sparseProfile = expectedProfile === "sparse";
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
      return c.json({ error: "binding_mismatch" }, 422);
    }

    const signingBytes = decodeBase64Url(prepared.signing_bytes, MAX_RESULT_JSON_BYTES);
    const derivedSigningBytes = sparseProfile
      ? derive_sparse_verifier_result_signing_bytes(prepared.unsigned_result)
      : derive_verifier_result_signing_bytes(prepared.unsigned_result);
    if (!hasSameBytes(derivedSigningBytes, signingBytes)) {
      return c.json({ error: "signing_bytes_mismatch" }, 422);
    }
    const signatureBytes = await (sparseProfile
      ? signSparseResult(config, signingBytes)
      : signResult(config, signingBytes));
    if (signatureBytes.length !== 64) {
      return c.json({ error: "verifier_unavailable" }, 503);
    }
    const signedResult = JSON.parse(
      sparseProfile
        ? attach_sparse_verifier_result_signature(prepared.unsigned_result, signatureBytes)
        : attach_verifier_result_signature(prepared.unsigned_result, signatureBytes),
    ) as Record<string, unknown>;
    const usedAt = completionRecord.status === "consumed"
      ? completionRecord.used_at
      : new Date(Date.now()).toISOString();
    if (!usedAt) {
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
    const finalResponseBody = JSON.stringify(finalResponse);
    const resultSha256 = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(finalResponseBody))),
    );
    await c.env.TLSN_PRESENTATIONS.put(
      attemptResultKey,
      finalResponseBody,
      { httpMetadata: { contentType: "application/json" } },
    );
    resultPersisted = true;
    benchmarkR2Operation(c.env, callback.job_id, "result_put");
    benchmarkRecord(c.env, callback.job_id, "t8_result_persisted");
    benchmarkRecord(c.env, callback.job_id, "t9_result_persisted");
    await delayAfterResultPersistence(c.env);
    let consumedBinding: BindingRecord;
    try {
      consumedBinding = await authority.consumeBinding(completionRecord.binding_value, {
        session_id: completionRecord.session_id,
        canonical_user_id: completionRecord.canonical_user_id,
        device_id: completionRecord.device_id,
        binding_value: completionRecord.binding_value,
        nonce: completionRecord.nonce,
        presentation_id: storedPresentationId,
        verification_attempt_id: verificationAttemptId,
        verification_job_id: callback.job_id,
        result_sha256: resultSha256,
        result_object_key: attemptResultKey,
        used_at: usedAt,
        now: Date.now(),
      });
    } catch (error) {
      preserveAttemptResult = !(error instanceof BindingAuthorityError) || error.code === "authority_unavailable";
      throw error;
    }
    if (consumedBinding.used_at !== usedAt || consumedBinding.result_sha256 !== resultSha256) {
      preserveAttemptResult = consumedBinding.status === "consumed";
      return c.json({ error: "verification_result_unavailable" }, 503);
    }
    completionConsumed = true;
    benchmarkRecord(c.env, callback.job_id, "t9_consume_completed");
    benchmarkRecord(c.env, callback.job_id, "t10_consume_completed");
    if (completionRecord.verification_input_key) {
      await c.env.TLSN_PRESENTATIONS.delete(completionRecord.verification_input_key).catch(() => undefined);
    }
    return c.json({ accepted: true });
  } catch {
    return c.json({ error: "verification_failed" }, 422);
  } finally {
    await releaseVerificationLease();
    if (benchmarkVerifierStarted) {
      benchmarkVerifierEnd(c.env, callback.job_id);
      benchmarkVerifierStarted = false;
    }
    if (resultPersisted && !completionConsumed && !preserveAttemptResult) {
      await c.env.TLSN_PRESENTATIONS.delete(attemptResultKey).catch(() => undefined);
    }
  }
});

app.get("/health", async (c) => {
  const production = c.env.TLSN_ENVIRONMENT === "production";
  const role = c.env.TLSN_DEPLOYMENT_ROLE ?? (production ? "production" : "synthetic-test");
  const canary = production && role === "canary";
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
    : null;
  const resultSignerKeyId = production
    ? canary ? c.env.TLSN_CANARY_RESULT_SIGNER_KEY_ID : c.env.TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID
    : null;
  const resultSigningKeyRegistry = production
    ? canary ? c.env.TLSN_CANARY_RESULT_SIGNING_KEY_REGISTRY : c.env.TLSN_PRODUCTION_RESULT_SIGNING_KEY_REGISTRY
    : null;
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
    : null;
  const bindingMode = production && canary && c.env.TLSN_CANARY_BINDING_VALUE
    ? "fixed_canary"
    : c.env.TLSN_TEST_BINDING_VALUE
      ? "fixed_test"
      : "random";
  return c.json({
    schema_version: 2,
    ok: true,
    verifier: "tlsn-alpha15-wasm",
    environment: c.env.TLSN_ENVIRONMENT,
    auth_mode: c.env.TLSN_ENVIRONMENT === "test" && c.env.TLSN_TEST_AUTH_USERS
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
    binding_mode: bindingMode,
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
        : null,
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
  const config = await readConfig(c.env);
  if (!config) {
    return c.json({ error: "verifier_unconfigured" }, 503);
  }
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
    const authority = new DurableObjectBindingAuthority(c.env.TLSN_BINDINGS);
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
    const sessionReceipt = await signSessionReceipt(config, record);
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
    attachBenchmarkTimingHeader(c, c.env, requestBody.job_id);
    return c.json({ verified: false, status: "processing", job_id: requestBody.job_id }, 202);
  }
  const resultObjectKey = record.result_object_key;
  if (record.status !== "consumed" || !resultObjectKey) {
    return c.json({ verified: false, error: "verification_unavailable" }, 503);
  }
  if (!record.result_sha256) {
    return c.json({ verified: false, error: "verification_result_unavailable" }, 503);
  }

  const object = await c.env.TLSN_PRESENTATIONS.get(resultObjectKey);
  benchmarkR2Operation(c.env, requestBody.job_id, "status_result_get");
  if (!object || object.size > MAX_INTERNAL_CALLBACK_JSON_BYTES) {
    return c.json({ verified: false, error: "verification_result_unavailable" }, 503);
  }
  try {
    const resultBody = await object.text();
    const resultSha256 = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(resultBody))),
    );
    if (resultSha256 !== record.result_sha256) {
      return c.json({ verified: false, error: "verification_result_unavailable" }, 503);
    }
    const finalResponse = verificationFinalResponseSchema.parse(JSON.parse(resultBody) as unknown);
    benchmarkRecord(c.env, requestBody.job_id, "t10_status_verified");
    benchmarkRecord(c.env, requestBody.job_id, "t11_status_verified");
    attachBenchmarkTimingHeader(c, c.env, requestBody.job_id);
    c.header("Cache-Control", "no-store");
    return c.json(finalResponse);
  } catch {
    return c.json({ verified: false, error: "verification_result_unavailable" }, 503);
  }
});

app.post("/verify/tlsn/retry", async (c) => {
  const authentication = requireAuthentication(await authenticateRequest(c.req.raw, c.env));
  if (authentication instanceof Response) {
    return authentication;
  }
  const trigger = triggerExecutionConfig(c.env);
  if (!trigger) {
    return c.json({ verified: false, error: "trigger_unconfigured" }, 503);
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
  if (
    (record.status !== "processing" && record.status !== "verifying" && record.status !== "consumed") ||
    !record.verification_input_key ||
    !record.verification_result_key
  ) {
    return c.json({ verified: false, error: "verification_unavailable" }, 409);
  }

  const storedProfile = record.verification_profile ?? "complete";
  if (requestBody.profile !== undefined && requestBody.profile !== storedProfile) {
    return c.json({ verified: false, error: "verification_profile_mismatch" }, 409);
  }

  if (record.status === "verifying") {
    c.header("Cache-Control", "no-store");
    return c.json({ verified: false, status: "processing", job_id: requestBody.job_id }, 202);
  }

  if (record.status === "consumed") {
    const resultObjectKey = record.result_object_key;
    const existing = resultObjectKey
      ? await c.env.TLSN_PRESENTATIONS.get(resultObjectKey)
      : null;
    if (existing && record.result_sha256) {
      try {
        const resultBody = await existing.text();
        const resultSha256 = encodeBase64Url(
          new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(resultBody))),
        );
        if (resultSha256 !== record.result_sha256) throw new Error("result hash mismatch");
        verificationFinalResponseSchema.parse(JSON.parse(resultBody) as unknown);
        return c.json({ verified: true, status: "completed", job_id: requestBody.job_id });
      } catch {
        return c.json({ verified: false, error: "verification_result_unavailable" }, 503);
      }
    }
    return c.json({ verified: false, error: "verification_result_unavailable" }, 503);
  }

  let payload: VerificationTaskPayload;
  try {
    payload = verificationTaskPayloadSchema.parse({
      job_id: requestBody.job_id,
      binding_id: requestBody.binding_id,
      session_id: record.session_id,
      canonical_user_id: record.canonical_user_id,
      device_id: record.device_id,
      device_challenge: record.tlsn_device_challenge,
      verification_input_key: record.verification_input_key,
      verification_result_key: record.verification_result_key,
      profile: storedProfile,
      disclosure_mode: storedProfile === "sparse" ? "sparse" : "full",
    });
    await enqueueTriggerVerification(trigger, payload);
  } catch {
    return c.json({ verified: false, error: "trigger_unavailable", job_id: requestBody.job_id }, 503);
  }
  c.header("Cache-Control", "no-store");
  return c.json({ verified: false, status: "queued", job_id: requestBody.job_id }, 202);
});

const handleTlsnVerification = async (c: Context<{ Bindings: Bindings }>) => {
  const config = await readConfig(c.env);
  if (!config) {
    return c.json({ error: "verifier_unconfigured" }, 503);
  }
  const sparseProfile = c.req.path === "/verify/tlsn/sparse";
  if (sparseProfile && !config.sparseProfileSha256Bytes) {
    return c.json({ error: "sparse_verifier_unconfigured" }, 503);
  }
  const authentication = requireAuthentication(await authenticateRequest(c.req.raw, c.env));
  if (authentication instanceof Response) {
    return authentication;
  }

  let requestBody: z.infer<typeof requestSchema>;
  try {
    requestBody = requestSchema.parse(await readJsonBody(c.req.raw));
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }

  let presentationBytes: Uint8Array;
  try {
    presentationBytes = decodeBase64Url(requestBody.presentation_base64, MAX_PRESENTATION_BYTES);
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }

  if (shouldUseTriggerExecution(c.env)) {
    const trigger = triggerExecutionConfig(c.env);
    if (!trigger) {
      return c.json({ verified: false, error: "trigger_unconfigured" }, 503);
    }

    const authority = new DurableObjectBindingAuthority(c.env.TLSN_BINDINGS);
    let issuedBinding;
    try {
      issuedBinding = await authority.lookupBinding(
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
    if (requestBody.device_proof.challenge !== issuedBinding.tlsn_device_challenge) {
      return c.json({ verified: false, error: "device_challenge_mismatch" }, 409);
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
      device_id: issuedBinding.device_id,
      session_id: issuedBinding.session_id,
      binding_value: issuedBinding.binding_value,
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
      devicePossession.deviceId !== issuedBinding.device_id ||
      devicePossession.deviceId !== requestBody.device_id
    ) {
      return c.json({ verified: false, error: "device_possession_owner_mismatch" }, 403);
    }

    const presentationId = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", presentationBytes)),
    );
    const jobId = crypto.randomUUID();
    benchmarkRecord(c.env, jobId, "t0_accepted");
    const verificationInputKey = verificationObjectKey(jobId, "presentation");
    const verificationResultKey = verificationObjectKey(jobId, "result");
    const bindingId = await hashBindingId(requestBody.binding);
    const payload = verificationTaskPayloadSchema.parse({
      job_id: jobId,
      binding_id: bindingId,
      session_id: issuedBinding.session_id,
      canonical_user_id: authentication.canonicalUserId,
      device_id: issuedBinding.device_id,
      device_challenge: requestBody.device_proof.challenge,
      verification_input_key: verificationInputKey,
      verification_result_key: verificationResultKey,
      profile: sparseProfile ? "sparse" : "complete",
      disclosure_mode: sparseProfile ? "sparse" : "full",
    });

    try {
      await c.env.TLSN_PRESENTATIONS.put(verificationInputKey, presentationBytes, {
        httpMetadata: { contentType: "application/octet-stream" },
      });
      benchmarkR2Operation(c.env, jobId, "input_put");
      benchmarkRecord(c.env, jobId, "t1_presentation_persisted");
      await authority.claimBinding(requestBody.binding, {
        session_id: issuedBinding.session_id,
        canonical_user_id: authentication.canonicalUserId,
        device_id: issuedBinding.device_id,
        binding_value: issuedBinding.binding_value,
        nonce: issuedBinding.nonce,
        presentation_id: presentationId,
        verification_job_id: jobId,
        verification_input_key: verificationInputKey,
        verification_result_key: verificationResultKey,
        verification_profile: sparseProfile ? "sparse" : "complete",
        device_replay_digest_hex: devicePossession.replayDigestHex,
        now: Date.now(),
      });
    } catch {
      await c.env.TLSN_PRESENTATIONS.delete(verificationInputKey).catch(() => undefined);
      return c.json({ verified: false, error: "trigger_unavailable", job_id: jobId }, 503);
    }
    try {
      await enqueueTriggerVerification(trigger, payload);
      benchmarkRecord(c.env, jobId, "t2_trigger_submitted");
      benchmarkRecord(c.env, jobId, "t2_trigger_task_accepted");
    } catch {
      return c.json({ verified: false, error: "trigger_unavailable", job_id: jobId }, 503);
    }

    c.header("Cache-Control", "no-store");
  benchmarkRecord(c.env, jobId, "t1_202_response_sent");
    return c.json({ verified: false, status: "queued", job_id: jobId }, 202);
  }

  const authority = new DurableObjectBindingAuthority(c.env.TLSN_BINDINGS);
  let issuedBinding;
  try {
    issuedBinding = await authority.lookupBinding(
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

  if (requestBody.device_proof.challenge !== issuedBinding.tlsn_device_challenge) {
    return c.json({ verified: false, error: "device_challenge_mismatch" }, 409);
  }
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
      authenticatedResult.attestation_session_id !== issuedBinding.session_id ||
      authenticatedResult.attestation_session_id !== requestBody.session_id ||
      authenticatedResult.canonical_user_id !== authentication.canonicalUserId ||
      authenticatedResult.device_id !== requestBody.device_id ||
      authenticatedResult.device_challenge !== requestBody.device_proof.challenge ||
      authenticatedResult.binding_nonce !== issuedBinding.nonce ||
      authenticatedResult.binding_value !== issuedBinding.binding_value ||
      authenticatedResult.binding_value !== requestBody.binding
    ) {
      return c.json({ verified: false, error: "binding_mismatch" }, 422);
    }
    const devicePossession = await authenticateTlsnDeviceProof(
      authentication,
      {
        device_id: issuedBinding.device_id,
        session_id: issuedBinding.session_id,
        binding_value: issuedBinding.binding_value,
        challenge: requestBody.device_proof.challenge,
        sig: requestBody.device_proof.sig,
      },
      config.devicePossessionAuthUrl,
    );
    if (!devicePossession.ok) {
      return c.json({ verified: false, error: devicePossession.error }, devicePossession.status);
    }
    if (
      devicePossession.canonicalUserId !== authentication.canonicalUserId ||
      devicePossession.deviceId !== issuedBinding.device_id ||
      devicePossession.deviceId !== requestBody.device_id
    ) {
      return c.json({ verified: false, error: "device_possession_owner_mismatch" }, 403);
    }
    const presentationId = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", presentationBytes)),
    );
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
    let consumedBinding;
    try {
      consumedBinding = await authority.consumeBinding(requestBody.binding, {
        session_id: requestBody.session_id,
        canonical_user_id: authentication.canonicalUserId,
        device_id: requestBody.device_id,
        binding_value: requestBody.binding,
        nonce: authenticatedResult.binding_nonce,
        presentation_id: presentationId,
        now: Date.now(),
      });
    } catch (error) {
      const message = error instanceof BindingAuthorityError ? error.code : "binding_unknown";
      return c.json({ verified: false, error: message }, bindingAuthorityStatus(error));
    }
    const consumeReceipt = await signConsumeReceipt(config, consumedBinding);
    const signedResultJson = sparseProfile
      ? attach_sparse_verifier_result_signature(prepared.unsigned_result, signature)
      : attach_verifier_result_signature(prepared.unsigned_result, signature);
    const signedResult = JSON.parse(signedResultJson) as Record<string, unknown>;
    c.header("Cache-Control", "no-store");
    return c.json({
      verified: true,
      result: signedResult,
      signer_key_id: config.resultSignerKeyId ?? config.verifierKeyId,
      signature_algorithm: "Ed25519",
      consume_receipt: consumeReceipt,
      device_replay_digest_hex: devicePossession.replayDigestHex,
    });
  } catch {
    return c.json({ verified: false, error: "verification_failed" }, 422);
  }
};

app.post("/verify/tlsn", handleTlsnVerification);
app.post("/verify/tlsn/sparse", handleTlsnVerification);

export { app, TlsnBindingAuthorityDurableObject };
export default app;