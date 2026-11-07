import {
  canonicalJsonBytes,
  RuntimeConfigDomainError,
  runtimeConfigFreshnessWire,
  runtimeConfigManifestAudienceSha256,
  verifyRuntimeConfigFreshnessRequest,
  type FreshnessRequest,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/index.ts";

interface FreshnessSignerBinding {
  fetch(request: Request): Promise<Response>;
}

export interface FreshnessGatewayBindings {
  readonly TLSN_RUNTIME_CONFIG_MANIFEST_URL?: string;
  readonly TLSN_FRESHNESS_SIGNER?: FreshnessSignerBinding;
}

interface FreshnessGatewayExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

type InterruptionReason = "client-disconnect" | "deadline";

export const FRESHNESS_GATEWAY_DEADLINE_MS = 7_000;
export const FRESHNESS_GATEWAY_MAX_IN_FLIGHT = 16;

let activeRequests = 0;

type BodyReadFailure = "empty" | "too-large" | "read-failed";

class BoundedBodyError extends Error {
  readonly reason: BodyReadFailure;

  constructor(reason: BodyReadFailure) {
    super(reason);
    this.name = "BoundedBodyError";
    this.reason = reason;
  }
}

class GatewayInterrupted extends Error {
  constructor() {
    super("Freshness Gateway request was interrupted");
    this.name = "GatewayInterrupted";
  }
}

class RejectedSignerResponse extends Error {
  constructor() {
    super("Freshness signer returned an invalid response");
    this.name = "RejectedSignerResponse";
  }
}

interface RequestLifetime {
  readonly signal: AbortSignal;
  readonly aborted: Promise<InterruptionReason>;
  readonly reason: InterruptionReason | undefined;
  readonly cleanupConfirmed: boolean;
  assertActive(): void;
  markCleanupUnconfirmed(event: string): void;
  dispose(): void;
}

function jsonResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function acquireAdmission(): (() => void) | null {
  if (activeRequests >= FRESHNESS_GATEWAY_MAX_IN_FLIGHT) return null;
  activeRequests += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (activeRequests === 0) {
      logFailure("freshness_gateway_admission_counter_invalid");
      return;
    }
    activeRequests -= 1;
  };
}

function logFailure(event: string): void {
  console.error(JSON.stringify({ event }));
}

function createRequestLifetime(request: Request): RequestLifetime {
  const controller = new AbortController();
  const deadlineAt = performance.now() + FRESHNESS_GATEWAY_DEADLINE_MS;
  let reason: InterruptionReason | undefined;
  let cleanupConfirmed = true;
  let resolveAborted: (reason: InterruptionReason) => void = () => {};
  const aborted = new Promise<InterruptionReason>((resolve) => {
    resolveAborted = resolve;
  });
  const abort = (nextReason: InterruptionReason) => {
    if (controller.signal.aborted) return;
    reason = nextReason;
    logFailure(
      nextReason === "deadline"
        ? "freshness_gateway_deadline_exceeded"
        : "freshness_gateway_client_disconnected",
    );
    controller.abort(new DOMException(nextReason, "AbortError"));
    resolveAborted(nextReason);
  };
  const onClientDisconnect = () => abort("client-disconnect");
  let listeningForClientDisconnect = false;
  if (request.signal.aborted) {
    abort("client-disconnect");
  } else {
    request.signal.addEventListener("abort", onClientDisconnect, { once: true });
    listeningForClientDisconnect = true;
    if (request.signal.aborted) onClientDisconnect();
  }
  const timer = setTimeout(() => abort("deadline"), FRESHNESS_GATEWAY_DEADLINE_MS);

  return {
    signal: controller.signal,
    aborted,
    get reason() {
      return reason;
    },
    get cleanupConfirmed() {
      return cleanupConfirmed;
    },
    assertActive() {
      if (!controller.signal.aborted && performance.now() >= deadlineAt) {
        abort("deadline");
      }
      if (controller.signal.aborted) throw new GatewayInterrupted();
    },
    markCleanupUnconfirmed(event) {
      if (!cleanupConfirmed) return;
      cleanupConfirmed = false;
      logFailure(event);
    },
    dispose() {
      clearTimeout(timer);
      if (listeningForClientDisconnect) {
        request.signal.removeEventListener("abort", onClientDisconnect);
      }
    },
  };
}

function interruptedResponse(reason: InterruptionReason): Response {
  if (reason === "client-disconnect") {
    return new Response(null, {
      status: 499,
      headers: { "cache-control": "no-store" },
    });
  }
  return jsonResponse(504, "freshness_timeout");
}

function readWithSignal<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new GatewayInterrupted());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new GatewayInterrupted());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void pending.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
    if (signal.aborted) onAbort();
  });
}

function contentLengthState(
  value: string | null,
  limit: number,
): "valid" | "invalid" | "too-large" {
  if (value === null) return "valid";
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return "invalid";
  const length = Number(value);
  if (!Number.isSafeInteger(length)) return "invalid";
  return length > limit ? "too-large" : "valid";
}

async function readBoundedBody(
  owner: BoundedBodyOwner,
  limit: number,
): Promise<Uint8Array> {
  return owner.read(limit);
}

class BoundedBodyOwner {
  private state:
    | "owned"
    | "reading"
    | "consumed"
    | "canceling"
    | "cancelled"
    | "unconfirmed" = "owned";
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private cancellation: Promise<boolean> | null = null;
  private readonly body: ReadableStream<Uint8Array> | null;
  private readonly source: "request" | "signer-response";
  private readonly signal: AbortSignal;
  private readonly markCleanupUnconfirmed: (event: string) => void;

  constructor(
    body: ReadableStream<Uint8Array> | null,
    source: "request" | "signer-response",
    signal: AbortSignal,
    markCleanupUnconfirmed: (event: string) => void,
  ) {
    this.body = body;
    this.source = source;
    this.signal = signal;
    this.markCleanupUnconfirmed = markCleanupUnconfirmed;
  }

  async cancel(): Promise<boolean> {
    if (this.cancellation !== null) return this.cancellation;
    if (this.state === "consumed" || this.state === "cancelled") return true;
    if (this.state === "unconfirmed") return false;
    if (this.body === null) {
      this.state = "consumed";
      return true;
    }

    const body = this.body;
    const reader = this.reader;
    this.state = "canceling";
    this.cancellation = (async () => {
      try {
        if (reader === null) {
          await body.cancel(this.signal.reason);
        } else {
          await reader.cancel(this.signal.reason);
        }
        if (this.state !== "unconfirmed") this.state = "cancelled";
        return this.state === "cancelled";
      } catch {
        this.setUnconfirmed(`freshness_${this.source}_body_cancel_unconfirmed`);
        return false;
      }
    })();
    return this.cancellation;
  }

  async read(limit: number): Promise<Uint8Array> {
    const body = this.body;
    if (body === null) {
      this.state = "consumed";
      throw new BoundedBodyError("empty");
    }
    if (this.state !== "owned") {
      throw new Error("Freshness Gateway body ownership is not available for reading");
    }

    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = body.getReader();
    } catch {
      this.setUnconfirmed(`freshness_${this.source}_body_lock_unconfirmed`);
      throw new BoundedBodyError("read-failed");
    }
    this.reader = reader;
    this.state = "reading";
    const chunks: Uint8Array[] = [];
    let length = 0;
    let fullyRead = false;

    try {
      while (true) {
        let next: ReadableStreamReadResult<Uint8Array>;
        try {
          next = await readWithSignal(reader.read(), this.signal);
        } catch (error) {
          if (error instanceof GatewayInterrupted) throw error;
          throw new BoundedBodyError("read-failed");
        }
        if (next.done) {
          fullyRead = true;
          this.state = "consumed";
          break;
        }
        if (length + next.value.byteLength > limit) {
          throw new BoundedBodyError("too-large");
        }
        chunks.push(next.value);
        length += next.value.byteLength;
      }
    } finally {
      if (!fullyRead) {
        await this.cancel();
      }
      try {
        reader.releaseLock();
      } catch {
        this.setUnconfirmed(`freshness_${this.source}_body_unlock_unconfirmed`);
      }
      this.reader = null;
    }

    if (length === 0) throw new BoundedBodyError("empty");
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  private setUnconfirmed(event: string): void {
    if (this.state === "unconfirmed") return;
    this.state = "unconfirmed";
    this.markCleanupUnconfirmed(event);
  }
}

function mediaType(value: string | null): string | null {
  if (value === null) return null;
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function readRequestBody(
  request: Request,
  signal: AbortSignal,
  lifetime: RequestLifetime,
): Promise<Uint8Array> {
  const bodyOwner = new BoundedBodyOwner(
    request.body,
    "request",
    signal,
    lifetime.markCleanupUnconfirmed,
  );
  const declaredLength = request.headers.get("content-length");
  const length = contentLengthState(
    declaredLength,
    runtimeConfigFreshnessWire.maxRequestBytes,
  );
  if (length === "too-large") {
    await bodyOwner.cancel();
    throw new BoundedBodyError("too-large");
  }
  if (length === "invalid") {
    await bodyOwner.cancel();
    throw new BoundedBodyError("read-failed");
  }
  const bytes = await readBoundedBody(bodyOwner, runtimeConfigFreshnessWire.maxRequestBytes);
  if (declaredLength !== null && Number(declaredLength) !== bytes.byteLength) {
    throw new BoundedBodyError("read-failed");
  }
  return bytes;
}

async function readSignerResponse(
  response: Response,
  bodyOwner: BoundedBodyOwner,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  const length = contentLengthState(
    declaredLength,
    runtimeConfigFreshnessWire.maxResponseBytes,
  );
  if (length !== "valid") {
    await bodyOwner.cancel();
    throw new BoundedBodyError(length === "too-large" ? "too-large" : "read-failed");
  }
  const bytes = await readBoundedBody(bodyOwner, runtimeConfigFreshnessWire.maxResponseBytes);
  if (declaredLength !== null && Number(declaredLength) !== bytes.byteLength) {
    throw new BoundedBodyError("read-failed");
  }
  return bytes;
}

async function processFreshnessGatewayRequest(
  request: Request,
  manifestUrl: string,
  signer: FreshnessSignerBinding,
  lifetime: RequestLifetime,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  lifetime.assertActive();
  let audienceManifestUrlSha256: string;
  try {
    audienceManifestUrlSha256 =
      await runtimeConfigManifestAudienceSha256(manifestUrl);
  } catch (error) {
    if (error instanceof RuntimeConfigDomainError) {
      logFailure("freshness_gateway_manifest_url_invalid");
    } else {
      logFailure("freshness_gateway_audience_hash_failed");
    }
    return jsonResponse(503, "freshness_unavailable");
  }
  lifetime.assertActive();

  if (requestUrl.origin !== new URL(manifestUrl).origin) {
    return jsonResponse(404, "not_found");
  }
  if (mediaType(request.headers.get("content-type")) !== "application/json") {
    return jsonResponse(415, "unsupported_media_type");
  }

  let requestBytes: Uint8Array;
  try {
    requestBytes = await readRequestBody(request, lifetime.signal, lifetime);
  } catch (error) {
    if (error instanceof GatewayInterrupted) throw error;
    if (!(error instanceof BoundedBodyError)) throw error;
    return jsonResponse(
      error.reason === "too-large" ? 413 : 400,
      error.reason === "too-large" ? "request_too_large" : "invalid_request",
    );
  }
  lifetime.assertActive();

  let challenge: FreshnessRequest;
  try {
    challenge = await verifyRuntimeConfigFreshnessRequest(requestBytes, {
      environment: "production",
      audienceManifestUrlSha256,
    });
  } catch (error) {
    if (!(error instanceof RuntimeConfigDomainError)) throw error;
    return jsonResponse(400, "invalid_freshness_request");
  }
  lifetime.assertActive();

  const signerRequest = new Request(
    `https://freshness-signer.internal${runtimeConfigFreshnessWire.requestPath}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "cache-control": "no-store",
        "content-type": "application/json",
      },
      body: exactArrayBuffer(canonicalJsonBytes(challenge)),
      redirect: "manual",
      signal: lifetime.signal,
    },
  );

  let signerResponse: Response;
  try {
    signerResponse = await signer.fetch(signerRequest);
  } catch {
    if (lifetime.signal.aborted) throw new GatewayInterrupted();
    logFailure("freshness_signer_request_failed");
    return jsonResponse(503, "freshness_unavailable");
  }
  const signerBodyOwner = new BoundedBodyOwner(
    signerResponse.body,
    "signer-response",
    lifetime.signal,
    lifetime.markCleanupUnconfirmed,
  );
  let responseBytes: Uint8Array;
  try {
    lifetime.assertActive();
    if (
      signerResponse.status !== 200 ||
      signerResponse.redirected ||
      mediaType(signerResponse.headers.get("content-type")) !== "application/json"
    ) {
      throw new RejectedSignerResponse();
    }
    responseBytes = await readSignerResponse(signerResponse, signerBodyOwner);
    lifetime.assertActive();
  } catch (error) {
    await signerBodyOwner.cancel();
    if (error instanceof GatewayInterrupted) throw error;
    if (error instanceof RejectedSignerResponse) {
      logFailure("freshness_signer_response_rejected");
      return jsonResponse(502, "invalid_freshness_response");
    }
    if (!(error instanceof BoundedBodyError)) throw error;
    logFailure(
      error.reason === "too-large"
        ? "freshness_signer_response_too_large"
        : "freshness_signer_response_unreadable",
    );
    return jsonResponse(502, "invalid_freshness_response");
  }

  return new Response(exactArrayBuffer(responseBytes), {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handleFreshnessGatewayRequest(
  request: Request,
  bindings: FreshnessGatewayBindings,
  context: FreshnessGatewayExecutionContext,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (
    requestUrl.pathname !== runtimeConfigFreshnessWire.requestPath ||
    requestUrl.search !== ""
  ) {
    return jsonResponse(404, "not_found");
  }
  if (request.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { allow: "POST", "cache-control": "no-store" },
    });
  }

  const manifestUrl = bindings.TLSN_RUNTIME_CONFIG_MANIFEST_URL;
  const signer = bindings.TLSN_FRESHNESS_SIGNER;
  if (!manifestUrl || !signer) {
    logFailure("freshness_gateway_binding_unavailable");
    return jsonResponse(503, "freshness_unavailable");
  }

  let manifestOrigin: string;
  try {
    manifestOrigin = new URL(manifestUrl).origin;
  } catch {
    logFailure("freshness_gateway_manifest_url_invalid");
    return jsonResponse(503, "freshness_unavailable");
  }
  if (requestUrl.origin !== manifestOrigin) {
    return jsonResponse(404, "not_found");
  }
  if (mediaType(request.headers.get("content-type")) !== "application/json") {
    return jsonResponse(415, "unsupported_media_type");
  }
  if (request.signal.aborted) {
    logFailure("freshness_gateway_client_disconnected");
    return interruptedResponse("client-disconnect");
  }

  const releaseAdmission = acquireAdmission();
  if (releaseAdmission === null) {
    logFailure("freshness_gateway_admission_full");
    return jsonResponse(503, "freshness_unavailable");
  }

  const lifetime = createRequestLifetime(request);
  const operation = processFreshnessGatewayRequest(
    request,
    manifestUrl,
    signer,
    lifetime,
  )
    .then((response) => {
      lifetime.assertActive();
      return response;
    })
    .catch((error: unknown) => {
      if (error instanceof GatewayInterrupted || lifetime.signal.aborted) {
        return interruptedResponse(lifetime.reason ?? "deadline");
      }
      logFailure("freshness_gateway_request_failed");
      return jsonResponse(503, "freshness_unavailable");
    })
    .finally(() => {
      if (lifetime.cleanupConfirmed) {
        releaseAdmission();
      } else {
        logFailure("freshness_gateway_admission_retained_cleanup_unconfirmed");
      }
    });

  try {
    const outcome = await Promise.race([
      operation.then((response) => ({ kind: "completed" as const, response })),
      lifetime.aborted.then((reason) => ({ kind: "interrupted" as const, reason })),
    ]);
    if (outcome.kind === "interrupted") {
      try {
        context.waitUntil(operation.then(() => undefined, () => undefined));
      } catch {
        logFailure("freshness_gateway_cleanup_waituntil_failed");
      }
      return interruptedResponse(outcome.reason);
    }
    return outcome.response;
  } finally {
    lifetime.dispose();
  }
}

export default {
  fetch(
    request: Request,
    bindings: FreshnessGatewayBindings,
    context: FreshnessGatewayExecutionContext,
  ): Promise<Response> {
    return handleFreshnessGatewayRequest(request, bindings, context);
  },
};
