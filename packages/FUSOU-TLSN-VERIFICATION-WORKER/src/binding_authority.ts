import { DurableObject } from "cloudflare:workers";

const BINDING_PREFIX = new TextEncoder().encode("FUSOU-ATTESTATION-BINDING-V1\0");
const BINDING_NONCE_BYTES = 32;
const UUID_BYTES = 16;

export type BindingStatus = "active" | "expired" | "consumed";

export type BindingRecord = {
  binding_id: string;
  session_id: string;
  canonical_user_id: string;
  nonce: string;
  binding_value: string;
  created_at: string;
  expires_at: string;
  status: BindingStatus;
  used_at?: string;
  presentation_id?: string;
};

type BindingOperation = {
  binding_id: string;
  session_id: string;
  canonical_user_id: string;
  binding_value: string;
  nonce: string;
  created_at: string;
  expires_at: string;
};

type ConsumeInput = {
  session_id: string;
  canonical_user_id: string;
  binding_value: string;
  nonce: string;
  presentation_id: string;
  now: number;
};

type AuthorityResponse =
  | { ok: true; record: BindingRecord }
  | { ok: false; error: AuthorityErrorCode };

export type AuthorityErrorCode =
  | "authority_unavailable"
  | "binding_unknown"
  | "binding_expired"
  | "binding_consumed"
  | "session_mismatch"
  | "user_mismatch"
  | "nonce_mismatch"
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

async function hashBindingId(bindingValue: string): Promise<string> {
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
    configuredBindingValue?: string,
  ): Promise<BindingRecord> {
    const sessionId = configuredBindingValue ? parseBindingValue(configuredBindingValue).sessionId : crypto.randomUUID();
    const nonce = configuredBindingValue
      ? parseBindingValue(configuredBindingValue).nonce
      : (() => {
          const bytes = new Uint8Array(BINDING_NONCE_BYTES);
          crypto.getRandomValues(bytes);
          return encodeBase64Url(bytes);
        })();
    const bindingValue = configuredBindingValue ?? createBindingValue(sessionId, nonce);
    const record: BindingOperation = {
      binding_id: await hashBindingId(bindingValue),
      session_id: sessionId,
      canonical_user_id: canonicalUserId,
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
    now: number,
  ): Promise<BindingRecord> {
    const bindingId = await hashBindingId(bindingValue);
    return this.call(bindingId, "/lookup", { session_id: sessionId, canonical_user_id: canonicalUserId, now });
  }

  async consumeBinding(bindingValue: string, input: ConsumeInput): Promise<BindingRecord> {
    const bindingId = await hashBindingId(bindingValue);
    return this.call(bindingId, "/consume", input);
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
    try {
      const body = await request.json<BindingOperation & { session_id: string; now: number }>();
      switch (new URL(request.url).pathname) {
        case "/issue":
          return this.issue(body);
        case "/lookup":
          return this.lookup(body.session_id, body.canonical_user_id, body.now);
        case "/consume":
          return this.consume(body as unknown as ConsumeInput);
        default:
          return Response.json({ ok: false, error: "binding_unknown" }, { status: 404 });
      }
    } catch {
      return Response.json({ ok: false, error: "authority_unavailable" }, { status: 503 });
    }
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.transaction(async (transaction) => {
      const record = await transaction.get<BindingRecord>("binding");
      if (record?.status === "active" && Date.parse(record.expires_at) <= Date.now()) {
        await transaction.put("binding", { ...record, status: "expired" });
      }
    });
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

  private async lookup(sessionId: string, canonicalUserId: string, now: number): Promise<Response> {
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
      if (record.status === "active" && Date.parse(record.expires_at) <= now) {
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
        result = { ok: false, error: "binding_consumed" };
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
      if (record.binding_value !== input.binding_value) {
        result = { ok: false, error: "binding_unknown" };
        return;
      }
      if (record.nonce !== input.nonce) {
        result = { ok: false, error: "nonce_mismatch" };
        return;
      }
      if (record.status === "active" && Date.parse(record.expires_at) <= input.now) {
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
      const consumed: BindingRecord = {
        ...record,
        status: "consumed",
        used_at: new Date(input.now).toISOString(),
        presentation_id: input.presentation_id,
      };
      await transaction.put("binding", consumed);
      result = { ok: true, record: consumed };
    });
    return Response.json(result, { status: result.ok ? 200 : authorityStatus(result.error) });
  }
}

function authorityStatus(error: AuthorityErrorCode): number {
  switch (error) {
    case "binding_expired":
      return 410;
    case "binding_consumed":
    case "binding_conflict":
    case "session_mismatch":
    case "user_mismatch":
    case "nonce_mismatch":
      return 409;
    case "binding_unknown":
      return 404;
    case "authority_unavailable":
      return 503;
  }
}