import { DurableObject } from "cloudflare:workers";

const BINDING_PREFIX = new TextEncoder().encode("FUSOU-ATTESTATION-BINDING-V1\0");
const BINDING_NONCE_BYTES = 32;
const TLSN_DEVICE_CHALLENGE_BYTES = 32;
const UUID_BYTES = 16;
const BENCHMARK_TIMING_KEY = "benchmark-timing";
const ACQUIRE_VERIFICATION_TIMING_HEADER = "X-FUSOU-TLSN-Acquire-Timing";
export const VERIFICATION_RESULT_STORAGE_KEY = "verification-result";
const MAX_VERIFICATION_RESULT_BYTES = 2 * 1024 * 1024 - new TextEncoder().encode(VERIFICATION_RESULT_STORAGE_KEY).byteLength;

export type BindingStatus = "active" | "processing" | "verifying" | "failed" | "expired" | "consumed";
export type VerificationProfile = "complete" | "sparse";
export type VerificationInputSource = "r2" | "direct";
export type VerificationFailureCode =
  | "service_binding_failed"
  | "verifier_failed"
  | "presentation_read_failed"
  | "presentation_hash_mismatch"
  | "result_persistence_failed"
  | "authority_error"
  | "lease_expired"
  | "worker_exception"
  | "callback_failed";

export type BindingRecord = {
  binding_id: string;
  session_id: string;
  canonical_user_id: string;
  device_id: string;
  device_auth_nonce: string;
  nonce: string;
  tlsn_device_challenge: string;
  binding_value: string;
  created_at: string;
  expires_at: string;
  status: BindingStatus;
  verification_job_id?: string;
  verification_input_source?: VerificationInputSource;
  verification_input_key?: string;
  verification_result_key?: string;
  verification_profile?: VerificationProfile;
  device_replay_digest_hex?: string;
  verification_attempt_id?: string;
  verification_lease_expires_at?: string;
  benchmark_lease_started_at?: string;
  benchmark_lease_expires_at?: string;
  benchmark_persistence_started_at?: string;
  benchmark_persistence_remaining_ms?: number;
  benchmark_server_completion_at?: string;
  benchmark_terminal_failure_at?: string;
  benchmark_terminal_failure_remaining_ms?: number;
  verification_failure_code?: VerificationFailureCode;
  result_sha256?: string;
  result_object_key?: string;
  used_at?: string;
  presentation_id?: string;
};

export type BenchmarkTimingRecord = {
  schema_version: 1;
  trace_id: string;
  job_id: string;
  execution_mode?: "trigger" | "queue" | "direct";
  timestamps: Record<string, number>;
  durations: Record<string, number>;
  r2_operations: Record<string, number>;
  do_operations: Record<string, number>;
  diagnostics?: Record<string, boolean | number | string>;
  max_verifier_concurrency: number;
  updated_at: number;
};

export type BenchmarkTimingMergeInput = {
  trace_id: string;
  job_id: string;
  execution_mode?: "trigger" | "queue" | "direct";
  timestamps: Record<string, number>;
  durations: Record<string, number>;
  r2_operations: Record<string, number>;
  do_operations: Record<string, number>;
  diagnostics?: Record<string, boolean | number | string>;
  max_verifier_concurrency: number;
  updated_at: number;
};

type AcquireVerificationTimingName =
  | "acquire_verification_rpc"
  | "acquire_verification_transaction"
  | "acquire_verification_storage_get"
  | "acquire_verification_validation"
  | "acquire_verification_storage_put"
  | "acquire_verification_set_alarm";

type AcquireVerificationTiming = Partial<Record<AcquireVerificationTimingName, number>>;

type AcquireVerificationOptions = {
  benchmarkTiming?: boolean;
  onBenchmarkTiming?: (timing: Readonly<AcquireVerificationTiming>) => void;
};

type BindingOperation = {
  binding_id: string;
  session_id: string;
  canonical_user_id: string;
  device_id: string;
  device_auth_nonce: string;
  tlsn_device_challenge: string;
  binding_value: string;
  nonce: string;
  created_at: string;
  expires_at: string;
};

type ConsumeInput = {
  session_id: string;
  canonical_user_id: string;
  device_id: string;
  binding_value: string;
  nonce: string;
  presentation_id: string;
  verification_attempt_id?: string;
  result_sha256?: string;
  result_object_key?: string;
  verification_job_id?: string;
  used_at?: string;
  now: number;
};

export type CommitVerifiedResultInput = {
  session_id: string;
  canonical_user_id: string;
  device_id: string;
  binding_value: string;
  nonce: string;
  presentation_id: string;
  verification_attempt_id: string;
  verification_job_id: string;
  verification_profile: VerificationProfile;
  verification_result_key: string;
  result_sha256: string;
  result_object_key: string;
  result_bytes: Uint8Array;
  used_at: string;
  now: number;
  benchmark_timing?: boolean;
  benchmark_persistence_started_at?: string;
  benchmark_persistence_remaining_ms?: number;
};

export type VerificationResultLookupInput = JobLookupInput & {
  result_sha256?: string;
  result_object_key?: string;
};

export type ConsumedVerificationReplayInput = {
  session_id: string;
  canonical_user_id: string;
  device_id: string;
  binding_value: string;
  tlsn_device_challenge: string;
  presentation_id: string;
  verification_profile: VerificationProfile;
  device_replay_digest_hex: string;
  now: number;
};

export type ConsumedVerificationResult = {
  record: BindingRecord;
  bytes: Uint8Array;
};

type VerificationResultResponse =
  | { ok: true; result: ConsumedVerificationResult }
  | { ok: false; error: AuthorityErrorCode };

type TestResultFaultInput = VerificationResultLookupInput & {
  fault: "result_missing" | "result_corrupt";
};

type RpcAuthorityStub = {
  commitVerifiedResult(input: CommitVerifiedResultInput): Promise<AuthorityResponse>;
  getConsumedVerificationResult(input: VerificationResultLookupInput): Promise<VerificationResultResponse>;
  getConsumedVerificationResultForReplay(input: ConsumedVerificationReplayInput): Promise<VerificationResultResponse>;
  applyTestResultFault(input: TestResultFaultInput): Promise<AuthorityResponse>;
};

type ClaimInput = {
  session_id: string;
  canonical_user_id: string;
  device_id: string;
  binding_value: string;
  nonce: string;
  tlsn_device_challenge: string;
  presentation_id: string;
  verification_job_id: string;
  verification_input_key?: string;
  verification_input_source: VerificationInputSource;
  verification_result_key: string;
  verification_profile: VerificationProfile;
  device_replay_digest_hex: string;
  verification_attempt_id?: string;
  now: number;
};

type JobLookupInput = {
  session_id: string;
  canonical_user_id: string;
  device_id: string;
  verification_job_id: string;
  now: number;
};

type BindingLookupOptions = {
  allow_consumed?: boolean;
};

type AcquireVerificationInput = JobLookupInput & {
  presentation_id: string;
  verification_profile: VerificationProfile;
  verification_attempt_id: string;
  verification_lease_expires_at: string;
  result_object_key: string;
  benchmark_timing?: boolean;
};

type ReleaseVerificationInput = JobLookupInput & {
  verification_attempt_id: string;
};

type FailVerificationInput = JobLookupInput & {
  verification_attempt_id?: string;
  failure_code: VerificationFailureCode;
  benchmark_timing?: boolean;
  benchmark_persistence_started_at?: string;
  benchmark_persistence_remaining_ms?: number;
};

type AuthorityResponse =
  | { ok: true; record: BindingRecord }
  | { ok: false; error: AuthorityErrorCode };

export type AuthorityErrorCode =
  | "authority_unavailable"
  | "binding_unknown"
  | "binding_expired"
  | "binding_consumed"
  | "verification_failed"
  | "session_mismatch"
  | "user_mismatch"
  | "device_mismatch"
  | "nonce_mismatch"
  | "verification_result_mismatch"
  | "verification_profile_mismatch"
  | "verification_result_unavailable"
  | "result_too_large"
  | "binding_conflict";

export class BindingAuthorityError extends Error {
  constructor(public readonly code: AuthorityErrorCode) {
    super(code);
  }
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("invalid base64url");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) {
    throw new Error("non-canonical base64url");
  }
  return bytes;
}

function uuidToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("session ID must be UUIDv4");
  }
  return Uint8Array.from(value.replaceAll("-", "").match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.length !== UUID_BYTES) {
    throw new Error("session ID must be 16 bytes");
  }
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export function parseBindingValue(bindingValue: string): { sessionId: string; nonce: string } {
  const bytes = decodeBase64Url(bindingValue);
  const expectedLength = BINDING_PREFIX.length + 2 + UUID_BYTES + 2 + BINDING_NONCE_BYTES;
  if (bytes.length !== expectedLength || !bytes.slice(0, BINDING_PREFIX.length).every((byte, index) => byte === BINDING_PREFIX[index])) {
    throw new Error("binding has invalid framing");
  }
  let cursor = BINDING_PREFIX.length;
  const sessionLength = ((bytes[cursor] ?? 0) << 8) | (bytes[cursor + 1] ?? 0);
  cursor += 2;
  if (sessionLength !== UUID_BYTES) {
    throw new Error("session ID length is invalid");
  }
  const sessionId = bytesToUuid(bytes.slice(cursor, cursor + UUID_BYTES));
  cursor += UUID_BYTES;
  const nonceLength = ((bytes[cursor] ?? 0) << 8) | (bytes[cursor + 1] ?? 0);
  cursor += 2;
  if (nonceLength !== BINDING_NONCE_BYTES) {
    throw new Error("nonce length is invalid");
  }
  return {
    sessionId,
    nonce: encodeBase64Url(bytes.slice(cursor, cursor + BINDING_NONCE_BYTES)),
  };
}

export async function hashBindingId(bindingValue: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bindingValue));
  return encodeBase64Url(new Uint8Array(digest));
}

function responseError(response: Response): Promise<never> {
  return response.json<AuthorityResponse>().then((body) => {
    if (body.ok) {
      throw new BindingAuthorityError("authority_unavailable");
    }
    throw new BindingAuthorityError(body.error);
  }).catch((error: unknown) => {
    if (error instanceof BindingAuthorityError) {
      throw error;
    }
    throw new BindingAuthorityError("authority_unavailable");
  });
}

export class DurableObjectBindingAuthority {
  constructor(private readonly namespace: DurableObjectNamespace) {}

  async issueBinding(
    now: number,
    ttlSeconds: number,
    canonicalUserId: string,
    deviceId: string,
    deviceAuthNonce: string,
    configuredBindingValue?: string,
  ): Promise<BindingRecord> {
    const configuredBinding = configuredBindingValue?.trim() || undefined;
    const sessionId = configuredBinding ? parseBindingValue(configuredBinding).sessionId : crypto.randomUUID();
    const nonce = configuredBinding
      ? parseBindingValue(configuredBinding).nonce
      : randomBase64Url(BINDING_NONCE_BYTES);
    const bindingValue = configuredBinding ?? createBindingValue(sessionId, nonce);
    const record: BindingOperation = {
      binding_id: await hashBindingId(bindingValue),
      session_id: sessionId,
      canonical_user_id: canonicalUserId,
      device_id: deviceId,
      device_auth_nonce: deviceAuthNonce,
      tlsn_device_challenge: randomBase64Url(TLSN_DEVICE_CHALLENGE_BYTES),
      nonce,
      binding_value: bindingValue,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + ttlSeconds * 1000).toISOString(),
    };
    return this.call(record.binding_id, "/issue", record);
  }

  async lookupBinding(
    sessionId: string,
    bindingValue: string,
    canonicalUserId: string,
    deviceId: string,
    now: number,
    options: BindingLookupOptions = {},
  ): Promise<BindingRecord> {
    const bindingId = await hashBindingId(bindingValue);
    return this.call(bindingId, "/lookup", {
      session_id: sessionId,
      canonical_user_id: canonicalUserId,
      device_id: deviceId,
      now,
      allow_consumed: options.allow_consumed === true,
    });
  }

  async consumeBinding(bindingValue: string, input: ConsumeInput): Promise<BindingRecord> {
    const bindingId = await hashBindingId(bindingValue);
    return this.call(bindingId, "/consume", input);
  }

  async commitVerifiedResult(bindingId: string, input: CommitVerifiedResultInput): Promise<BindingRecord> {
    let response: AuthorityResponse;
    try {
      const stub = this.namespace.getByName(bindingId) as unknown as RpcAuthorityStub;
      response = await stub.commitVerifiedResult(input);
    } catch {
      throw new BindingAuthorityError("authority_unavailable");
    }
    if (!response.ok) throw new BindingAuthorityError(response.error);
    return response.record;
  }

  async getConsumedVerificationResult(
    bindingId: string,
    input: VerificationResultLookupInput,
  ): Promise<ConsumedVerificationResult | null> {
    let response: VerificationResultResponse;
    try {
      const stub = this.namespace.getByName(bindingId) as unknown as RpcAuthorityStub;
      response = await stub.getConsumedVerificationResult(input);
    } catch {
      throw new BindingAuthorityError("authority_unavailable");
    }
    if (!response.ok) throw new BindingAuthorityError(response.error);
    return response.result;
  }

  async getConsumedVerificationResultForReplay(
    bindingValue: string,
    input: ConsumedVerificationReplayInput,
  ): Promise<ConsumedVerificationResult | null> {
    let response: VerificationResultResponse;
    try {
      const stub = this.namespace.getByName(await hashBindingId(bindingValue)) as unknown as RpcAuthorityStub;
      response = await stub.getConsumedVerificationResultForReplay(input);
    } catch {
      throw new BindingAuthorityError("authority_unavailable");
    }
    if (!response.ok) throw new BindingAuthorityError(response.error);
    return response.result;
  }

  async applyTestResultFault(bindingId: string, input: TestResultFaultInput): Promise<void> {
    let response: AuthorityResponse;
    try {
      const stub = this.namespace.getByName(bindingId) as unknown as RpcAuthorityStub;
      response = await stub.applyTestResultFault(input);
    } catch {
      throw new BindingAuthorityError("authority_unavailable");
    }
    if (!response.ok) throw new BindingAuthorityError(response.error);
  }

  async claimBinding(bindingValue: string, input: ClaimInput): Promise<BindingRecord> {
    return this.startVerification(bindingValue, input);
  }

  async startVerification(bindingValue: string, input: ClaimInput): Promise<BindingRecord> {
    if (input.verification_input_source === "direct" && input.verification_attempt_id === undefined) {
      throw new BindingAuthorityError("verification_result_mismatch");
    }
    const bindingId = await hashBindingId(bindingValue);
    return this.call(bindingId, "/start", input);
  }

  async lookupVerificationJob(bindingId: string, input: JobLookupInput): Promise<BindingRecord> {
    return this.call(bindingId, "/job", input);
  }

  async acquireVerification(
    bindingId: string,
    input: AcquireVerificationInput,
    options: AcquireVerificationOptions = {},
  ): Promise<BindingRecord> {
    let response: Response;
    try {
      const headers = new Headers({ "Content-Type": "application/json" });
      if (options.benchmarkTiming) {
        headers.set(ACQUIRE_VERIFICATION_TIMING_HEADER, "true");
      }
      const stub = this.namespace.getByName(bindingId);
      response = await stub.fetch("https://binding.internal/acquire", {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      });
    } catch {
      throw new BindingAuthorityError("authority_unavailable");
    }
    if (!response.ok) {
      return responseError(response);
    }
    const bodyResponse = await response.json<AuthorityResponse>();
    if (!bodyResponse.ok) {
      throw new BindingAuthorityError(bodyResponse.error);
    }
    if (options.onBenchmarkTiming) {
      const encodedTiming = response.headers.get(ACQUIRE_VERIFICATION_TIMING_HEADER);
      if (encodedTiming) {
        try {
          const parsed = JSON.parse(
            new TextDecoder().decode(decodeBase64Url(encodedTiming)),
          ) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const timing: AcquireVerificationTiming = {};
            for (const [name, value] of Object.entries(parsed)) {
              if (
                (name === "acquire_verification_rpc" ||
                  name === "acquire_verification_transaction" ||
                  name === "acquire_verification_storage_get" ||
                  name === "acquire_verification_validation" ||
                  name === "acquire_verification_storage_put" ||
                  name === "acquire_verification_set_alarm") &&
                typeof value === "number" &&
                Number.isFinite(value) &&
                value >= 0
              ) {
                timing[name] = value;
              }
            }
            options.onBenchmarkTiming(timing);
          }
        } catch {
        }
      }
    }
    return bodyResponse.record;
  }

  async releaseVerification(bindingId: string, input: ReleaseVerificationInput): Promise<BindingRecord> {
    return this.call(bindingId, "/release", input);
  }

  async failVerification(bindingId: string, input: FailVerificationInput): Promise<BindingRecord> {
    return this.call(bindingId, "/fail", input);
  }

  async mergeBenchmarkTiming(bindingId: string, input: BenchmarkTimingMergeInput): Promise<void> {
    let response: Response;
    try {
      const stub = this.namespace.getByName(bindingId);
      response = await stub.fetch("https://binding.internal/benchmark-timing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    } catch {
      throw new BindingAuthorityError("authority_unavailable");
    }
    if (!response.ok) throw new BindingAuthorityError("authority_unavailable");
  }

  async getBenchmarkTiming(bindingId: string, traceId: string): Promise<BenchmarkTimingRecord | null> {
    let response: Response;
    try {
      const stub = this.namespace.getByName(bindingId);
      response = await stub.fetch("https://binding.internal/benchmark-timing/get", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trace_id: traceId }),
      });
    } catch {
      throw new BindingAuthorityError("authority_unavailable");
    }
    if (!response.ok) throw new BindingAuthorityError("authority_unavailable");
    const body = await response.json<{ ok: true; record: BenchmarkTimingRecord | null }>();
    return body.record;
  }

  async getBenchmarkTimingByJobId(bindingId: string, jobId: string): Promise<BenchmarkTimingRecord | null> {
    let response: Response;
    try {
      const stub = this.namespace.getByName(bindingId);
      response = await stub.fetch("https://binding.internal/benchmark-timing/by-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId }),
      });
    } catch {
      throw new BindingAuthorityError("authority_unavailable");
    }
    if (!response.ok) throw new BindingAuthorityError("authority_unavailable");
    const body = await response.json<{ ok: true; record: BenchmarkTimingRecord | null }>();
    return body.record;
  }

  private async call<T extends object>(bindingId: string, path: string, body: T): Promise<BindingRecord> {
    let response: Response;
    try {
      const stub = this.namespace.getByName(bindingId);
      response = await stub.fetch(`https://binding.internal${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new BindingAuthorityError("authority_unavailable");
    }
    if (!response.ok) {
      return responseError(response);
    }
    const bodyResponse = await response.json<AuthorityResponse>();
    if (!bodyResponse.ok) {
      throw new BindingAuthorityError(bodyResponse.error);
    }
    return bodyResponse.record;
  }
}

function createBindingValue(sessionId: string, nonce: string): string {
  const sessionBytes = uuidToBytes(sessionId);
  const nonceBytes = decodeBase64Url(nonce);
  if (nonceBytes.length !== BINDING_NONCE_BYTES) {
    throw new Error("nonce must be 32 bytes");
  }
  const bytes = new Uint8Array(BINDING_PREFIX.length + 2 + UUID_BYTES + 2 + BINDING_NONCE_BYTES);
  bytes.set(BINDING_PREFIX);
  let cursor = BINDING_PREFIX.length;
  bytes[cursor++] = 0;
  bytes[cursor++] = UUID_BYTES;
  bytes.set(sessionBytes, cursor);
  cursor += UUID_BYTES;
  bytes[cursor++] = 0;
  bytes[cursor++] = BINDING_NONCE_BYTES;
  bytes.set(nonceBytes, cursor);
  return encodeBase64Url(bytes);
}

export class TlsnBindingAuthorityDurableObject extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json({ ok: false, error: "binding_unknown" }, { status: 405 });
    }
    const path = new URL(request.url).pathname;
    const acquireRpcStartedAt = path === "/acquire" && request.headers.get(ACQUIRE_VERIFICATION_TIMING_HEADER) === "true"
      ? performance.now()
      : undefined;
    try {
      const body = await request.json<BindingOperation & {
        session_id: string;
        now: number;
        allow_consumed?: boolean;
      }>();
      switch (path) {
        case "/issue":
          return this.issue(body);
        case "/lookup":
          return this.lookup(
            body.session_id,
            body.canonical_user_id,
            body.device_id,
            body.now,
            body.allow_consumed === true,
          );
        case "/claim":
          return this.claim(body as unknown as ClaimInput);
        case "/start":
          return this.claim(body as unknown as ClaimInput);
        case "/acquire":
          return this.acquireVerification(body as unknown as AcquireVerificationInput, acquireRpcStartedAt);
        case "/release":
          return this.releaseVerification(body as unknown as ReleaseVerificationInput);
        case "/fail":
          return this.failVerification(body as unknown as FailVerificationInput);
        case "/job":
          return this.lookupJob(body as unknown as JobLookupInput);
        case "/consume":
          return this.consume(body as unknown as ConsumeInput);
        case "/benchmark-timing":
          return this.mergeBenchmarkTiming(body as unknown as BenchmarkTimingMergeInput);
        case "/benchmark-timing/get":
          return this.getBenchmarkTiming(body as unknown as { trace_id: string });
        case "/benchmark-timing/by-job":
          return this.getBenchmarkTimingByJobId(body as unknown as { job_id: string });
        default:
          return Response.json({ ok: false, error: "binding_unknown" }, { status: 404 });
      }
    } catch {
      return Response.json({ ok: false, error: "authority_unavailable" }, { status: 503 });
    }
  }

  async alarm(): Promise<void> {
    let nextAlarm: number | undefined;
    await this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<BindingRecord>("binding");
      if (!record) {
        return;
      }
      const now = Date.now();
      const bindingExpiry = Date.parse(record.expires_at);
      if (Number.isFinite(bindingExpiry) && bindingExpiry <= now) {
        await transaction.delete(BENCHMARK_TIMING_KEY);
        if (record.status === "active" || record.status === "processing" || record.status === "verifying") {
          await transaction.put("binding", { ...record, status: "expired" });
        }
        return;
      }
      if (
        record.status === "verifying" &&
        record.verification_lease_expires_at &&
        Date.parse(record.verification_lease_expires_at) <= now
      ) {
        await transaction.put("binding", failedRecord(record, "lease_expired", now));
        if (Number.isFinite(bindingExpiry) && bindingExpiry > now) nextAlarm = bindingExpiry;
        return;
      }
      const leaseExpiry = record.verification_lease_expires_at
        ? Date.parse(record.verification_lease_expires_at)
        : Number.POSITIVE_INFINITY;
      const next = Math.min(bindingExpiry, leaseExpiry);
      if (Number.isFinite(next) && next > now) nextAlarm = next;
    });
    if (nextAlarm !== undefined) await this.ctx.storage.setAlarm(nextAlarm);
  }

  private async issue(operation: BindingOperation): Promise<Response> {
    let conflict = false;
    await this.ctx.storage.transaction(async (transaction) => {
      if (await transaction.get<BindingRecord>("binding")) {
        conflict = true;
        return;
      }
      await transaction.put("binding", { ...operation, status: "active" });
    });
    if (conflict) {
      return Response.json({ ok: false, error: "binding_conflict" }, { status: 409 });
    }
    await this.ctx.storage.setAlarm(Date.parse(operation.expires_at));
    return Response.json({ ok: true, record: { ...operation, status: "active" } });
  }

  private async lookup(
    sessionId: string,
    canonicalUserId: string,
    deviceId: string,
    now: number,
    allowConsumed: boolean,
  ): Promise<Response> {
    let result: AuthorityResponse = { ok: false, error: "binding_unknown" };
    await this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<BindingRecord>("binding");
      if (!record) {
        return;
      }
      if (record.session_id !== sessionId) {
        result = { ok: false, error: "session_mismatch" };
        return;
      }
      if (record.canonical_user_id !== canonicalUserId) {
        result = { ok: false, error: "user_mismatch" };
        return;
      }
      if (record.device_id !== deviceId) {
        result = { ok: false, error: "device_mismatch" };
        return;
      }
      if (
        (record.status === "active" || record.status === "processing" || record.status === "verifying") &&
        Date.parse(record.expires_at) <= now
      ) {
        const expired = { ...record, status: "expired" as const };
        await transaction.put("binding", expired);
        result = { ok: false, error: "binding_expired" };
        return;
      }
      if (record.status === "expired") {
        result = { ok: false, error: "binding_expired" };
        return;
      }
      if (record.status === "consumed") {
        result = allowConsumed
          ? { ok: true, record }
          : { ok: false, error: "binding_consumed" };
        return;
      }
      if (record.status === "failed") {
        result = { ok: false, error: "verification_failed" };
        return;
      }
      result = { ok: true, record };
    });
    return Response.json(result, { status: result.ok ? 200 : authorityStatus(result.error) });
  }

  private async consume(input: ConsumeInput): Promise<Response> {
    let result: AuthorityResponse = { ok: false, error: "binding_unknown" };
    await this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<BindingRecord>("binding");
      if (!record) {
        return;
      }
      if (record.session_id !== input.session_id) {
        result = { ok: false, error: "session_mismatch" };
        return;
      }
      if (record.canonical_user_id !== input.canonical_user_id) {
        result = { ok: false, error: "user_mismatch" };
        return;
      }
      if (record.device_id !== input.device_id) {
        result = { ok: false, error: "device_mismatch" };
        return;
      }
      if (record.binding_value !== input.binding_value) {
        result = { ok: false, error: "binding_unknown" };
        return;
      }
      if (record.nonce !== input.nonce) {
        result = { ok: false, error: "nonce_mismatch" };
        return;
      }
      if (
        (record.status === "active" || record.status === "processing" || record.status === "verifying") &&
        Date.parse(record.expires_at) <= input.now
      ) {
        await transaction.put("binding", { ...record, status: "expired" });
        result = { ok: false, error: "binding_expired" };
        return;
      }
      if (record.status === "expired") {
        result = { ok: false, error: "binding_expired" };
        return;
      }
      if (record.status === "consumed") {
        if (
          input.verification_job_id !== undefined &&
          record.verification_job_id === input.verification_job_id &&
          record.presentation_id === input.presentation_id &&
          (input.result_sha256 === undefined || record.result_sha256 === input.result_sha256) &&
          (input.result_object_key === undefined || record.result_object_key === input.result_object_key)
        ) {
          result = { ok: true, record };
          return;
        }
        result = { ok: false, error: "binding_consumed" };
        return;
      }
      if (record.status === "failed") {
        result = { ok: false, error: "verification_failed" };
        return;
      }
      if (record.status === "verifying") {
        if (
          input.verification_job_id === undefined ||
          input.verification_attempt_id === undefined ||
          input.result_sha256 === undefined ||
          input.result_object_key === undefined ||
          record.verification_job_id !== input.verification_job_id ||
          record.verification_attempt_id !== input.verification_attempt_id ||
          record.result_object_key !== input.result_object_key ||
          !record.verification_lease_expires_at ||
          Date.parse(record.verification_lease_expires_at) <= input.now
        ) {
          result = { ok: false, error: "binding_conflict" };
          return;
        }
      }
      if (
        record.status === "processing" && input.verification_attempt_id !== undefined
      ) {
        result = { ok: false, error: "binding_conflict" };
        return;
      }
      if (
        (record.status === "processing" && record.verification_job_id !== input.verification_job_id) ||
        (record.status !== "verifying" && record.status !== "processing" && record.status !== "active")
      ) {
        result = { ok: false, error: "binding_conflict" };
        return;
      }
      const consumed: BindingRecord = {
        ...record,
        status: "consumed",
        used_at: input.used_at ?? new Date(input.now).toISOString(),
        presentation_id: input.presentation_id,
        ...(input.result_sha256 ? { result_sha256: input.result_sha256 } : {}),
        ...(input.result_object_key ? { result_object_key: input.result_object_key } : {}),
      };
      await transaction.put("binding", consumed);
      result = { ok: true, record: consumed };
    });
    return Response.json(result, { status: result.ok ? 200 : authorityStatus(result.error) });
  }

  async commitVerifiedResult(input: CommitVerifiedResultInput): Promise<AuthorityResponse> {
    if (!(input.result_bytes instanceof Uint8Array)) {
      return { ok: false, error: "verification_result_mismatch" };
    }
    if (input.result_bytes.byteLength > MAX_VERIFICATION_RESULT_BYTES) {
      return { ok: false, error: "result_too_large" };
    }
    const resultSha256 = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", input.result_bytes)),
    );
    if (resultSha256 !== input.result_sha256) {
      return { ok: false, error: "verification_result_mismatch" };
    }

    let result: AuthorityResponse = { ok: false, error: "binding_unknown" };
    await this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<BindingRecord>("binding");
      if (!record) return;
      if (record.session_id !== input.session_id) {
        result = { ok: false, error: "session_mismatch" };
        return;
      }
      if (record.canonical_user_id !== input.canonical_user_id) {
        result = { ok: false, error: "user_mismatch" };
        return;
      }
      if (record.device_id !== input.device_id) {
        result = { ok: false, error: "device_mismatch" };
        return;
      }
      if (record.binding_value !== input.binding_value || record.nonce !== input.nonce) {
        result = { ok: false, error: "nonce_mismatch" };
        return;
      }
      if (record.status === "consumed") {
        const storedBytes = await transaction.get<Uint8Array>(VERIFICATION_RESULT_STORAGE_KEY);
        if (
          record.verification_job_id === input.verification_job_id &&
          record.verification_attempt_id === input.verification_attempt_id &&
          record.presentation_id === input.presentation_id &&
          record.verification_profile === input.verification_profile &&
          record.verification_result_key === input.verification_result_key &&
          record.result_sha256 === input.result_sha256 &&
          record.result_object_key === input.result_object_key &&
          storedBytes instanceof Uint8Array
        ) {
          result = { ok: true, record };
          return;
        }
        result = { ok: false, error: "binding_consumed" };
        return;
      }
      if (record.status === "expired") {
        result = { ok: false, error: "binding_expired" };
        return;
      }
      if (record.status === "failed") {
        result = { ok: false, error: "verification_failed" };
        return;
      }
      if (
        record.status !== "verifying" ||
        record.verification_job_id !== input.verification_job_id ||
        record.verification_attempt_id !== input.verification_attempt_id ||
        record.presentation_id !== input.presentation_id ||
        record.verification_profile !== input.verification_profile ||
        record.verification_result_key !== input.verification_result_key ||
        record.result_object_key !== input.result_object_key ||
        !record.verification_lease_expires_at ||
        Date.parse(record.verification_lease_expires_at) <= input.now
      ) {
        result = { ok: false, error: "binding_conflict" };
        return;
      }
      const consumed: BindingRecord = {
        ...record,
        status: "consumed",
        used_at: input.used_at,
        result_sha256: input.result_sha256,
        result_object_key: input.result_object_key,
        ...(input.benchmark_timing
          ? {
            ...(input.benchmark_persistence_started_at
              ? { benchmark_persistence_started_at: input.benchmark_persistence_started_at }
              : {}),
            ...(input.benchmark_persistence_remaining_ms !== undefined
              ? { benchmark_persistence_remaining_ms: input.benchmark_persistence_remaining_ms }
              : {}),
            benchmark_server_completion_at: new Date(Date.now()).toISOString(),
          }
          : {}),
      };
      await transaction.put(VERIFICATION_RESULT_STORAGE_KEY, input.result_bytes);
      await transaction.put("binding", consumed);
      result = { ok: true, record: consumed };
    });
    return result;
  }

  async getConsumedVerificationResult(
    input: VerificationResultLookupInput,
  ): Promise<VerificationResultResponse> {
    let candidate: ConsumedVerificationResult | null = null;
    await this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<BindingRecord>("binding");
      if (
        !record ||
        record.status !== "consumed" ||
        record.session_id !== input.session_id ||
        record.canonical_user_id !== input.canonical_user_id ||
        record.device_id !== input.device_id ||
        record.verification_job_id !== input.verification_job_id ||
        (input.result_sha256 !== undefined && record.result_sha256 !== input.result_sha256) ||
        (input.result_object_key !== undefined && record.result_object_key !== input.result_object_key) ||
        !record.result_sha256
      ) {
        return;
      }
      const bytes = await transaction.get<Uint8Array>(VERIFICATION_RESULT_STORAGE_KEY);
      if (bytes instanceof Uint8Array) candidate = { record, bytes };
    });
    const resolvedCandidate = candidate as ConsumedVerificationResult | null;
    if (!resolvedCandidate) return { ok: false, error: "verification_result_unavailable" };
    const sha256 = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", resolvedCandidate.bytes)),
    );
    return sha256 === resolvedCandidate.record.result_sha256
      ? { ok: true, result: resolvedCandidate }
      : { ok: false, error: "verification_result_unavailable" };
  }

  async getConsumedVerificationResultForReplay(
    input: ConsumedVerificationReplayInput,
  ): Promise<VerificationResultResponse> {
    let candidate: ConsumedVerificationResult | null = null;
    let metadataMismatch = false;
    await this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<BindingRecord>("binding");
      if (
        !record ||
        record.status !== "consumed" ||
        record.session_id !== input.session_id ||
        record.canonical_user_id !== input.canonical_user_id ||
        record.device_id !== input.device_id ||
        record.binding_value !== input.binding_value ||
        !record.result_sha256 ||
        !record.result_object_key
      ) {
        return;
      }
      if (
        record.tlsn_device_challenge !== input.tlsn_device_challenge ||
        record.presentation_id !== input.presentation_id ||
        (record.verification_profile ?? "complete") !== input.verification_profile ||
        record.device_replay_digest_hex !== input.device_replay_digest_hex
      ) {
        metadataMismatch = true;
        return;
      }
      const bytes = await transaction.get<Uint8Array>(VERIFICATION_RESULT_STORAGE_KEY);
      if (bytes instanceof Uint8Array) candidate = { record, bytes };
    });
    const resolvedCandidate = candidate as ConsumedVerificationResult | null;
    if (metadataMismatch) return { ok: false, error: "verification_result_mismatch" };
    if (!resolvedCandidate) return { ok: false, error: "verification_result_unavailable" };
    const sha256 = encodeBase64Url(
      new Uint8Array(await crypto.subtle.digest("SHA-256", resolvedCandidate.bytes)),
    );
    return sha256 === resolvedCandidate.record.result_sha256
      ? { ok: true, result: resolvedCandidate }
      : { ok: false, error: "verification_result_unavailable" };
  }

  async applyTestResultFault(input: TestResultFaultInput): Promise<AuthorityResponse> {
    let result: AuthorityResponse = { ok: false, error: "binding_unknown" };
    await this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<BindingRecord>("binding");
      if (
        !record ||
        record.status !== "consumed" ||
        record.session_id !== input.session_id ||
        record.canonical_user_id !== input.canonical_user_id ||
        record.device_id !== input.device_id ||
        record.verification_job_id !== input.verification_job_id
      ) {
        result = { ok: false, error: "verification_result_unavailable" };
        return;
      }
      if (input.fault === "result_missing") {
        await transaction.delete(VERIFICATION_RESULT_STORAGE_KEY);
      } else {
        const bytes = await transaction.get<Uint8Array>(VERIFICATION_RESULT_STORAGE_KEY);
        if (!(bytes instanceof Uint8Array)) {
          result = { ok: false, error: "verification_result_unavailable" };
          return;
        }
        const corrupted = new Uint8Array(bytes);
        if (corrupted.length > 0) corrupted[0] = (corrupted[0] ?? 0) ^ 0x01;
        await transaction.put(VERIFICATION_RESULT_STORAGE_KEY, corrupted);
      }
      result = { ok: true, record };
    });
    return result;
  }

  private async acquireVerification(input: AcquireVerificationInput, acquireRpcStartedAt?: number): Promise<Response> {
    let result: AuthorityResponse = { ok: false, error: "binding_unknown" };
    let acquiredLeaseExpiresAt: string | undefined;
    const acquireTiming: AcquireVerificationTiming | undefined = acquireRpcStartedAt === undefined ? undefined : {};
    const transactionStartedAt = acquireTiming ? performance.now() : undefined;
    await this.ctx.storage.transaction(async (transaction) => {
      const storageGetStartedAt = acquireTiming ? performance.now() : undefined;
      const record = await transaction.get<BindingRecord>("binding");
      if (acquireTiming && storageGetStartedAt !== undefined) {
        acquireTiming.acquire_verification_storage_get = performance.now() - storageGetStartedAt;
      }
      if (!record) {
        return;
      }
      const validationStartedAt = acquireTiming ? performance.now() : undefined;
      if (record.session_id !== input.session_id) {
        result = { ok: false, error: "session_mismatch" };
        return;
      }
      if (record.canonical_user_id !== input.canonical_user_id) {
        result = { ok: false, error: "user_mismatch" };
        return;
      }
      if (record.device_id !== input.device_id) {
        result = { ok: false, error: "device_mismatch" };
        return;
      }
      if (record.verification_job_id !== input.verification_job_id) {
        result = { ok: false, error: "binding_unknown" };
        return;
      }
      if (record.presentation_id !== input.presentation_id) {
        result = { ok: false, error: "verification_result_mismatch" };
        return;
      }
      const verificationInputSource = record.verification_input_source ?? "r2";
      if (
        record.verification_result_key === undefined ||
        record.device_replay_digest_hex === undefined ||
        (verificationInputSource === "r2" && record.verification_input_key === undefined)
      ) {
        result = { ok: false, error: "verification_result_mismatch" };
        return;
      }
      if ((record.verification_profile ?? "complete") !== input.verification_profile) {
        result = { ok: false, error: "verification_profile_mismatch" };
        return;
      }
      if (
        (record.status === "active" || record.status === "processing" || record.status === "verifying") &&
        Date.parse(record.expires_at) <= input.now
      ) {
        await transaction.put("binding", { ...record, status: "expired" });
        result = { ok: false, error: "binding_expired" };
        return;
      }
      if (record.status === "expired") {
        result = { ok: false, error: "binding_expired" };
        return;
      }
      if (record.status === "consumed") {
        result = { ok: true, record };
        return;
      }
      if (record.status === "failed") {
        result = { ok: false, error: "verification_failed" };
        return;
      }
      if (
        record.status === "verifying" &&
        record.verification_lease_expires_at !== undefined &&
        Date.parse(record.verification_lease_expires_at) > input.now
      ) {
        if (
          (record.verification_input_source ?? "r2") === "direct" &&
          record.verification_attempt_id !== input.verification_attempt_id
        ) {
          result = { ok: false, error: "binding_conflict" };
          return;
        }
        result = { ok: true, record };
        return;
      }
      if (record.status !== "processing" && record.status !== "verifying") {
        result = { ok: false, error: "binding_conflict" };
        return;
      }
      if (
        (record.verification_input_source ?? "r2") === "direct" &&
        record.verification_attempt_id !== undefined &&
        record.verification_attempt_id !== input.verification_attempt_id
      ) {
        result = { ok: false, error: "binding_conflict" };
        return;
      }
      const requestedLease = Date.parse(input.verification_lease_expires_at);
      const bindingExpiry = Date.parse(record.expires_at);
      if (!Number.isFinite(requestedLease) || !Number.isFinite(bindingExpiry)) {
        result = { ok: false, error: "binding_conflict" };
        return;
      }
      const leaseExpiresAt = new Date(Math.min(requestedLease, bindingExpiry)).toISOString();
      if (Date.parse(leaseExpiresAt) <= input.now) {
        result = { ok: false, error: "binding_expired" };
        return;
      }
      const verifying: BindingRecord = {
        ...record,
        status: "verifying",
        verification_attempt_id: input.verification_attempt_id,
        verification_lease_expires_at: leaseExpiresAt,
        result_object_key: input.result_object_key,
        ...(input.benchmark_timing
          ? {
            benchmark_lease_started_at: new Date(input.now).toISOString(),
            benchmark_lease_expires_at: leaseExpiresAt,
          }
          : {}),
      };
      if (acquireTiming && validationStartedAt !== undefined) {
        acquireTiming.acquire_verification_validation = performance.now() - validationStartedAt;
      }
      const storagePutStartedAt = acquireTiming ? performance.now() : undefined;
      await transaction.put("binding", verifying);
      if (acquireTiming && storagePutStartedAt !== undefined) {
        acquireTiming.acquire_verification_storage_put = performance.now() - storagePutStartedAt;
      }
      acquiredLeaseExpiresAt = leaseExpiresAt;
      result = { ok: true, record: verifying };
    });
    if (acquireTiming && transactionStartedAt !== undefined) {
      acquireTiming.acquire_verification_transaction = performance.now() - transactionStartedAt;
    }
    if (acquiredLeaseExpiresAt) {
      const setAlarmStartedAt = acquireTiming ? performance.now() : undefined;
      await this.ctx.storage.setAlarm(Date.parse(acquiredLeaseExpiresAt));
      if (acquireTiming && setAlarmStartedAt !== undefined) {
        acquireTiming.acquire_verification_set_alarm = performance.now() - setAlarmStartedAt;
      }
    }
    const response = Response.json(result, { status: result.ok ? 200 : authorityStatus(result.error) });
    if (acquireTiming && acquireRpcStartedAt !== undefined) {
      acquireTiming.acquire_verification_rpc = performance.now() - acquireRpcStartedAt;
      response.headers.set(
        ACQUIRE_VERIFICATION_TIMING_HEADER,
        encodeBase64Url(new TextEncoder().encode(JSON.stringify(acquireTiming))),
      );
    }
    return response;
  }

  private async releaseVerification(input: ReleaseVerificationInput): Promise<Response> {
    let result: AuthorityResponse = { ok: false, error: "binding_unknown" };
    await this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<BindingRecord>("binding");
      if (!record) {
        return;
      }
      if (record.session_id !== input.session_id) {
        result = { ok: false, error: "session_mismatch" };
        return;
      }
      if (record.canonical_user_id !== input.canonical_user_id) {
        result = { ok: false, error: "user_mismatch" };
        return;
      }
      if (record.device_id !== input.device_id) {
        result = { ok: false, error: "device_mismatch" };
        return;
      }
      if (record.verification_job_id !== input.verification_job_id) {
        result = { ok: false, error: "binding_unknown" };
        return;
      }
      if (record.status === "consumed") {
        result = { ok: true, record };
        return;
      }
      if (record.status === "failed") {
        result = { ok: true, record };
        return;
      }
      if (
        record.status !== "verifying" ||
        record.verification_attempt_id !== input.verification_attempt_id
      ) {
        result = { ok: false, error: "binding_conflict" };
        return;
      }
      const {
        verification_attempt_id: _verificationAttemptId,
        verification_lease_expires_at: _verificationLeaseExpiresAt,
        result_object_key: _resultObjectKey,
        ...processingRecord
      } = record;
      const processing: BindingRecord = { ...processingRecord, status: "processing" };
      await transaction.put("binding", processing);
      result = { ok: true, record: processing };
    });
    return Response.json(result, { status: result.ok ? 200 : authorityStatus(result.error) });
  }

  private async failVerification(input: FailVerificationInput): Promise<Response> {
    let result: AuthorityResponse = { ok: false, error: "binding_unknown" };
    await this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<BindingRecord>("binding");
      if (!record) {
        return;
      }
      if (record.session_id !== input.session_id) {
        result = { ok: false, error: "session_mismatch" };
        return;
      }
      if (record.canonical_user_id !== input.canonical_user_id) {
        result = { ok: false, error: "user_mismatch" };
        return;
      }
      if (record.device_id !== input.device_id) {
        result = { ok: false, error: "device_mismatch" };
        return;
      }
      if (record.verification_job_id !== input.verification_job_id) {
        result = { ok: false, error: "binding_unknown" };
        return;
      }
      if (record.status === "consumed" || record.status === "failed") {
        result = { ok: true, record };
        return;
      }
      if (record.status === "expired") {
        result = { ok: false, error: "binding_expired" };
        return;
      }
      if (
        record.status === "verifying" &&
        (!input.verification_attempt_id || record.verification_attempt_id !== input.verification_attempt_id)
      ) {
        result = { ok: false, error: "binding_conflict" };
        return;
      }
      if (record.status !== "processing" && record.status !== "verifying") {
        result = { ok: false, error: "binding_conflict" };
        return;
      }
      const failed = failedRecord(
        record,
        input.failure_code,
        input.now,
        input.benchmark_timing === true,
        {
          ...(input.benchmark_persistence_started_at
            ? { persistenceStartedAt: input.benchmark_persistence_started_at }
            : {}),
          ...(input.benchmark_persistence_remaining_ms !== undefined
            ? { persistenceRemainingMilliseconds: input.benchmark_persistence_remaining_ms }
            : {}),
        },
      );
      await transaction.put("binding", failed);
      result = { ok: true, record: failed };
    });
    return Response.json(result, { status: result.ok ? 200 : authorityStatus(result.error) });
  }

  private async mergeBenchmarkTiming(input: BenchmarkTimingMergeInput): Promise<Response> {
    await this.ctx.storage.transaction(async (transaction) => {
      const existing = await transaction.get<BenchmarkTimingRecord>(BENCHMARK_TIMING_KEY);
      const timestamps = {
        ...(existing?.trace_id === input.trace_id ? existing.timestamps : {}),
        ...input.timestamps,
      };
      const durations = {
        ...(existing?.trace_id === input.trace_id ? existing.durations : {}),
        ...input.durations,
      };
      const r2Operations = { ...(existing?.trace_id === input.trace_id ? existing.r2_operations : {}) };
      for (const [operation, count] of Object.entries(input.r2_operations)) {
        r2Operations[operation] = Math.max(r2Operations[operation] ?? 0, count);
      }
      const doOperations = { ...(existing?.trace_id === input.trace_id ? existing.do_operations : {}) };
      for (const [operation, count] of Object.entries(input.do_operations)) {
        doOperations[operation] = Math.max(doOperations[operation] ?? 0, count);
      }
      const diagnostics = {
        ...(existing?.trace_id === input.trace_id ? existing.diagnostics : {}),
        ...(input.diagnostics ?? {}),
      };
      await transaction.put(BENCHMARK_TIMING_KEY, {
        schema_version: 1,
        trace_id: input.trace_id,
        job_id: input.job_id,
        execution_mode: input.execution_mode ?? existing?.execution_mode ?? "trigger",
        timestamps,
        durations,
        r2_operations: r2Operations,
        do_operations: doOperations,
        diagnostics,
        max_verifier_concurrency: Math.max(existing?.max_verifier_concurrency ?? 0, input.max_verifier_concurrency),
        updated_at: input.updated_at,
      } satisfies BenchmarkTimingRecord);
    });
    return Response.json({ ok: true });
  }

  private async getBenchmarkTiming(input: { trace_id: string }): Promise<Response> {
    const record = await this.ctx.storage.get<BenchmarkTimingRecord>(BENCHMARK_TIMING_KEY);
    return Response.json({
      ok: true,
      record: record?.trace_id === input.trace_id ? record : null,
    });
  }

  private async getBenchmarkTimingByJobId(input: { job_id: string }): Promise<Response> {
    const record = await this.ctx.storage.get<BenchmarkTimingRecord>(BENCHMARK_TIMING_KEY);
    return Response.json({
      ok: true,
      record: record?.job_id === input.job_id ? record : null,
    });
  }

  private async claim(input: ClaimInput): Promise<Response> {
    let result: AuthorityResponse = { ok: false, error: "binding_unknown" };
    await this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<BindingRecord>("binding");
      if (!record) {
        return;
      }
      if (record.session_id !== input.session_id) {
        result = { ok: false, error: "session_mismatch" };
        return;
      }
      if (record.canonical_user_id !== input.canonical_user_id) {
        result = { ok: false, error: "user_mismatch" };
        return;
      }
      if (record.device_id !== input.device_id) {
        result = { ok: false, error: "device_mismatch" };
        return;
      }
      if (record.tlsn_device_challenge !== input.tlsn_device_challenge) {
        result = { ok: false, error: "verification_result_mismatch" };
        return;
      }
      if (record.binding_value !== input.binding_value || record.nonce !== input.nonce) {
        result = { ok: false, error: "nonce_mismatch" };
        return;
      }
      if (
        (record.status === "active" || record.status === "processing" || record.status === "verifying") &&
        Date.parse(record.expires_at) <= input.now
      ) {
        await transaction.put("binding", { ...record, status: "expired" });
        result = { ok: false, error: "binding_expired" };
        return;
      }
      if (record.status === "expired") {
        result = { ok: false, error: "binding_expired" };
        return;
      }
      if (record.status === "consumed") {
        result = { ok: false, error: "binding_consumed" };
        return;
      }
      if (record.status === "failed") {
        result = { ok: false, error: "verification_failed" };
        return;
      }
      if (record.status === "processing") {
        result = record.verification_job_id === input.verification_job_id
          ? { ok: true, record }
          : { ok: false, error: "binding_conflict" };
        return;
      }
      if (record.status === "verifying") {
        result = { ok: false, error: "binding_conflict" };
        return;
      }
      if (
        (input.verification_input_source === "r2" && input.verification_input_key === undefined) ||
        (input.verification_input_source === "direct" && input.verification_input_key !== undefined)
      ) {
        result = { ok: false, error: "verification_result_mismatch" };
        return;
      }
      const processing: BindingRecord = {
        ...record,
        status: "processing",
        verification_job_id: input.verification_job_id,
        ...(input.verification_input_key ? { verification_input_key: input.verification_input_key } : {}),
        verification_input_source: input.verification_input_source,
        verification_result_key: input.verification_result_key,
        verification_profile: input.verification_profile,
        device_replay_digest_hex: input.device_replay_digest_hex,
        presentation_id: input.presentation_id,
        ...(input.verification_attempt_id ? { verification_attempt_id: input.verification_attempt_id } : {}),
      };
      await transaction.put("binding", processing);
      result = { ok: true, record: processing };
    });
    return Response.json(result, { status: result.ok ? 200 : authorityStatus(result.error) });
  }

  private async lookupJob(input: JobLookupInput): Promise<Response> {
    let result: AuthorityResponse = { ok: false, error: "binding_unknown" };
    await this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<BindingRecord>("binding");
      if (!record) {
        return;
      }
      if (record.session_id !== input.session_id) {
        result = { ok: false, error: "session_mismatch" };
        return;
      }
      if (record.canonical_user_id !== input.canonical_user_id) {
        result = { ok: false, error: "user_mismatch" };
        return;
      }
      if (record.device_id !== input.device_id) {
        result = { ok: false, error: "device_mismatch" };
        return;
      }
      if (record.verification_job_id !== input.verification_job_id) {
        result = { ok: false, error: "binding_unknown" };
        return;
      }
      if (
        (record.status === "active" || record.status === "processing" || record.status === "verifying") &&
        Date.parse(record.expires_at) <= input.now
      ) {
        const expired = { ...record, status: "expired" as const };
        await transaction.put("binding", expired);
        result = { ok: false, error: "binding_expired" };
        return;
      }
      if (record.status === "expired") {
        result = { ok: false, error: "binding_expired" };
        return;
      }
      if (
        record.status === "verifying" &&
        (!record.verification_lease_expires_at || Date.parse(record.verification_lease_expires_at) <= input.now)
      ) {
        const failed = failedRecord(record, "lease_expired", input.now);
        await transaction.put("binding", failed);
        result = { ok: true, record: failed };
        return;
      }
      result = { ok: true, record };
    });
    return Response.json(result, { status: result.ok ? 200 : authorityStatus(result.error) });
  }
}

function authorityStatus(error: AuthorityErrorCode): number {
  switch (error) {
    case "binding_expired":
      return 410;
    case "binding_consumed":
    case "verification_failed":
    case "binding_conflict":
    case "verification_result_mismatch":
    case "verification_profile_mismatch":
    case "session_mismatch":
    case "user_mismatch":
    case "device_mismatch":
    case "nonce_mismatch":
      return 409;
    case "binding_unknown":
      return 404;
    case "verification_result_unavailable":
      return 503;
    case "result_too_large":
      return 413;
    case "authority_unavailable":
      return 503;
  }
}

function failedRecord(
  record: BindingRecord,
  failureCode: VerificationFailureCode,
  completedAt = Date.now(),
  benchmarkTiming = true,
  benchmarkPersistence: {
    persistenceStartedAt?: string;
    persistenceRemainingMilliseconds?: number;
  } = {},
): BindingRecord {
  const {
    verification_attempt_id: _verificationAttemptId,
    verification_lease_expires_at: _verificationLeaseExpiresAt,
    result_sha256: _resultSha256,
    result_object_key: _resultObjectKey,
    used_at: _usedAt,
    ...withoutAttemptAuthority
  } = record;
  return {
    ...withoutAttemptAuthority,
    status: "failed",
    verification_failure_code: failureCode,
    ...(benchmarkTiming && record.benchmark_lease_started_at
      ? {
        ...(benchmarkPersistence.persistenceStartedAt
          ? { benchmark_persistence_started_at: benchmarkPersistence.persistenceStartedAt }
          : {}),
        ...(benchmarkPersistence.persistenceRemainingMilliseconds !== undefined
          ? { benchmark_persistence_remaining_ms: benchmarkPersistence.persistenceRemainingMilliseconds }
          : {}),
        benchmark_server_completion_at: new Date(completedAt).toISOString(),
        benchmark_terminal_failure_at: new Date(completedAt).toISOString(),
        benchmark_terminal_failure_remaining_ms: Math.max(
          0,
          Date.parse(record.benchmark_lease_expires_at ?? record.verification_lease_expires_at ?? "") - completedAt,
        ),
      }
      : {}),
  };
}