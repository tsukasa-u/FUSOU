import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrivateKey, sign } from "node:crypto";
import { ProofPostgres } from "./tlsn-proof-postgres";
import { issueChallengeNonce } from "../../utils/pepper";
import { tlsnDeviceProofSigningBytes } from "../../../../../FUSOU-TLSN-VERIFICATION-WORKER/src/device-proof-framing";
import {
  authenticateDeviceProof,
  authenticateTlsnDeviceProof,
} from "../../../../../FUSOU-TLSN-VERIFICATION-WORKER/src/device-proof-client";
import app from "../anonymous-sync-v2";

const userId = "11111111-1111-4111-8111-111111111111";
const publicId = "22222222-2222-4222-8222-222222222222";
const deviceId = "33333333-3333-4333-8333-333333333333";
const sessionId = "44444444-4444-4444-8444-444444444444";
const otherUser = "55555555-5555-4555-8555-555555555555";
const publicKey = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
// RFC 8032 test vector, never an application or authority key.
const privateKey = createPrivateKey({
  key: Buffer.from("302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex"),
  format: "der", type: "pkcs8",
});
const db = new ProofPostgres();
const environment = {
  PUBLIC_SUPABASE_URL: "https://proof-db.invalid",
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: "offline-test-only",
  SUPABASE_SECRET_KEY: "offline-test-only",
  CHALLENGE_HMAC_SECRET: "offline-test-only-challenge-material",
};
const literal = (value: unknown): string => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
let authUser = { id: userId, is_anonymous: false };
let unavailable = false;
let beforeConsume: (() => void) | undefined;
let consumeCalls = 0;

function rpcSql(body: Record<string, unknown>): string {
  return `SELECT public.rpc_consume_tlsn_device_proof(
    ${["p_kind", "p_user_id", "p_device_id", "p_expected_key", "p_proof_digest", "p_nonce",
      "p_session_id", "p_binding_sha256", "p_challenge_sha256"].map((key) => literal(body[key])).join(",")}
  )`;
}

async function databaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== environment.PUBLIC_SUPABASE_URL) throw new Error("external network forbidden");
  if (unavailable) throw new TypeError("offline simulated transport failure");
  if (url.pathname === "/auth/v1/user") return Response.json(authUser);
  if (url.pathname === "/rest/v1/user_devices") {
    const id = url.searchParams.get("device_id")?.replace(/^eq\./, "");
    const result = db.sql(`SELECT json_build_object(
      'canonical_user_id', canonical_user_id, 'public_id', public_id,
      'device_pubkey', '\\x' || encode(device_pubkey,'hex'), 'revoked_at', revoked_at
    ) FROM public.user_devices WHERE device_id = ${literal(id)}`);
    return Response.json(result ? JSON.parse(result) : null);
  }
  const body: unknown = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid RPC test transport");
  if (url.pathname === "/rest/v1/rpc/rpc_consume_anon_sync_rate_limit") {
    const args = body as Record<string, unknown>;
    return Response.json(db.sql(`SELECT public.rpc_consume_anon_sync_rate_limit(
      ${literal(args["p_bucket_key"])},${literal(args["p_limit"])},${literal(args["p_window_seconds"])}
    )`) === "t");
  }
  if (url.pathname === "/rest/v1/rpc/rpc_consume_tlsn_device_proof") {
    consumeCalls++;
    beforeConsume?.();
    return Response.json(db.sql(rpcSql(body as Record<string, unknown>)));
  }
  throw new Error(`unexpected local adapter path: ${url.pathname}`);
}

function signature(message: Uint8Array): string {
  return sign(null, message, privateKey).toString("base64url");
}

async function authenticationProof(now?: number) {
  const { nonce } = await issueChallengeNonce(environment.CHALLENGE_HMAC_SECRET, deviceId, now);
  return { device_id: deviceId, nonce, sig: signature(new TextEncoder().encode(nonce)) };
}

function possessionProof() {
  const challenge = Buffer.alloc(32, 7);
  const proof = {
    device_id: deviceId, session_id: sessionId,
    binding_value: "opaque-test-binding", challenge: challenge.toString("base64url"),
  };
  return { ...proof, sig: signature(tlsnDeviceProofSigningBytes(proof, challenge)) };
}

const endpoint = (path: string) => `https://web.invalid/api/auth/anonymous-sync/v2/${path}`;
const handlerFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const route = request.url.replace("https://web.invalid/api/auth", "");
  return app.request(route, request, environment);
};
const subject = { canonicalUserId: userId, accessToken: "offline-test-only" };

function post(path: string, body: unknown, token = "offline-test-only") {
  return app.request(`/anonymous-sync/v2/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }, environment);
}

beforeAll(async () => { await db.start(); }, 30_000);
afterAll(() => { vi.unstubAllGlobals(); db.stop(); });
beforeEach(() => {
  vi.stubGlobal("fetch", databaseFetch);
  authUser = { id: userId, is_anonymous: false };
  unavailable = false;
  beforeConsume = undefined;
  consumeCalls = 0;
  db.sql(`
    TRUNCATE public.user_devices, public.tlsn_device_proof_consumptions,
      public.anon_sync_nonce_consumptions, public.anon_sync_rate_limits CASCADE;
    INSERT INTO auth.users VALUES ('${userId}', false),('${otherUser}',false) ON CONFLICT DO NOTHING;
    INSERT INTO public.member_id_mapping VALUES ('${publicId}') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_devices(device_id,canonical_user_id,public_id,device_pubkey)
      VALUES ('${deviceId}','${userId}','${publicId}',decode('${publicKey}','hex'));
  `);
});

describe("actual owner handlers, signatures, PostgreSQL transactions and Worker clients", () => {
  it("authenticates through the actual Worker consumer and commits exactly once", async () => {
    const proof = await authenticationProof();
    expect(await authenticateDeviceProof(subject, proof, endpoint("device-proof"), handlerFetch))
      .toEqual({ ok: true, canonicalUserId: userId, deviceId });
    expect(db.sql("SELECT count(*) FROM public.tlsn_device_proof_consumptions")).toBe("1");
    expect(await authenticateDeviceProof(subject, proof, endpoint("device-proof"), handlerFetch))
      .toMatchObject({ ok: false, status: 409, error: "device_nonce_replayed" });
  });

  it("verifies the shared possession framing and current digest through the consumer", async () => {
    const proof = possessionProof();
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256",
      new Uint8Array(tlsnDeviceProofSigningBytes(proof, Buffer.from(proof.challenge, "base64url"))))).toString("hex");
    expect(await authenticateTlsnDeviceProof(subject, proof, endpoint("tlsn-device-proof"),
      digest, undefined, handlerFetch)).toEqual({
      ok: true, canonicalUserId: userId, deviceId, replayDigestHex: digest,
    });
    expect(await authenticateTlsnDeviceProof(subject, proof, endpoint("tlsn-device-proof"),
      digest, undefined, handlerFetch)).toMatchObject({
      ok: false, status: 409, error: "device_possession_replayed",
    });
  });

  it.each(["device-proof", "tlsn-device-proof"])("rejects absent bearer at %s", async (path) => {
    expect((await post(path, {}, "")).status).toBe(401);
    expect(consumeCalls).toBe(0);
  });

  it("rejects anonymous and different canonical subjects", async () => {
    authUser.is_anonymous = true;
    expect((await post("device-proof", await authenticationProof())).status).toBe(401);
    authUser = { id: otherUser, is_anonymous: false };
    expect((await post("device-proof", await authenticationProof())).status).toBe(403);
    expect(consumeCalls).toBe(0);
  });

  it("checks revocation before replay and rejects revoked proof retries", async () => {
    const proof = possessionProof();
    expect((await post("tlsn-device-proof", proof)).status).toBe(200);
    db.sql(`UPDATE public.user_devices SET revoked_at=now(),revoked_reason='offline-test'`);
    const response = await post("tlsn-device-proof", proof);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "device_revoked" });
  });

  it.each(["device_id", "session_id", "binding_value", "challenge"])("rejects signed-context mutation: %s", async (field) => {
    const proof = possessionProof();
    const mutated = { ...proof, [field]: field.endsWith("_id") ? otherUser
      : field === "challenge" ? Buffer.alloc(32, 8).toString("base64url") : "different-binding" };
    expect((await post("tlsn-device-proof", mutated)).status).not.toBe(200);
    expect(consumeCalls).toBe(0);
  });

  it("rejects wrong signatures, noncanonical UUIDs and extra fields", async () => {
    const proof = await authenticationProof();
    expect((await post("device-proof", { ...proof, sig: Buffer.alloc(64).toString("base64url") })).status).toBe(401);
    expect((await post("device-proof", { ...proof, canonical_user_id: userId })).status).toBe(400);
    expect((await post("device-proof", { ...proof, device_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" })).status).toBe(400);
    expect(consumeCalls).toBe(0);
  });

  it("rejects expired authentication nonces without consumption", async () => {
    expect((await post("device-proof", await authenticationProof(Math.floor(Date.now() / 1000) - 900))).status).toBe(401);
    expect(consumeCalls).toBe(0);
  });

  it.each(["owner", "key", "revocation"])("atomically rechecks a changed %s snapshot", async (change) => {
    beforeConsume = () => db.sql(change === "owner"
      ? `UPDATE public.user_devices SET canonical_user_id='${otherUser}'`
      : change === "key" ? "UPDATE public.user_devices SET device_pubkey=decode(repeat('00',32),'hex')"
      : "UPDATE public.user_devices SET revoked_at=now(),revoked_reason='offline-test'");
    expect((await post("device-proof", await authenticationProof())).status).not.toBe(200);
    expect(db.sql("SELECT count(*) FROM public.anon_sync_nonce_consumptions")).toBe("0");
    expect(db.sql("SELECT count(*) FROM public.tlsn_device_proof_consumptions")).toBe("0");
  });

  it("fails closed on owner-service transport failure", async () => {
    unavailable = true;
    expect((await post("device-proof", await authenticationProof())).status).toBe(503);
    expect(consumeCalls).toBe(0);
  });

  it("serializes concurrent database claims across separate connections", async () => {
    const query = `SELECT public.rpc_consume_tlsn_device_proof('possession','${userId}',
      '${deviceId}',decode('${publicKey}','hex'),repeat('a',64),NULL,'${sessionId}',repeat('b',64),repeat('c',64))`;
    const results = await Promise.all(Array.from({ length: 8 }, () => db.concurrent(query)));
    expect(results.filter((result) => result === "ok")).toHaveLength(1);
    expect(results.filter((result) => result === "device_proof_replayed")).toHaveLength(7);
    expect(db.sql(`SELECT canonical_user_id::text || ':' || encode(device_pubkey,'hex')
      FROM public.tlsn_device_proof_consumptions`)).toBe(`${userId}:${publicKey}`);
  });

  it("does not accept a differently signed context for an already claimed device/session", () => {
    const call = (digest: string) => `SELECT public.rpc_consume_tlsn_device_proof(
      'possession','${userId}','${deviceId}',decode('${publicKey}','hex'),
      repeat('${digest}',64),NULL,'${sessionId}',repeat('b',64),repeat('c',64))`;
    expect(db.sql(call("a"))).toBe("ok");
    expect(db.sql(call("d"))).toBe("device_proof_replayed");
  });

  it("rolls back both nonce and proof if the transaction aborts", () => {
    const query = `BEGIN; SELECT public.rpc_consume_tlsn_device_proof('authentication',
      '${userId}','${deviceId}',decode('${publicKey}','hex'),repeat('a',64),repeat('b',64),
      NULL,NULL,NULL); SELECT 1/0; COMMIT;`;
    expect(() => db.sql(query)).toThrow();
    expect(db.sql("SELECT count(*) FROM public.anon_sync_nonce_consumptions")).toBe("0");
    expect(db.sql("SELECT count(*) FROM public.tlsn_device_proof_consumptions")).toBe("0");
  });

  it("does not turn a consumed lifecycle nonce into successful device authentication", async () => {
    const proof = await authenticationProof();
    db.sql(`INSERT INTO public.anon_sync_nonce_consumptions VALUES ('${deviceId}','${proof.nonce}',now(),NULL,NULL)`);
    expect((await post("device-proof", proof)).status).toBe(409);
    expect(db.sql("SELECT count(*) FROM public.tlsn_device_proof_consumptions")).toBe("0");
  });

  it("rejects direct calls by unauthenticated database roles", () => {
    expect(db.sql(`SELECT has_function_privilege('anon',
      'public.rpc_consume_tlsn_device_proof(text,uuid,uuid,bytea,text,text,uuid,text,text)','EXECUTE')`)).toBe("f");
    expect(db.sql("SELECT has_table_privilege('authenticated','public.tlsn_device_proof_consumptions','INSERT')")).toBe("f");
  });

  it("preserves one-use possession decisions across database process restart", async () => {
    const proof = possessionProof();
    expect((await post("tlsn-device-proof", proof)).status).toBe(200);
    await db.restart();
    const response = await post("tlsn-device-proof", proof);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "device_proof_replayed" });
    expect(db.sql("SELECT count(*) FROM public.tlsn_device_proof_consumptions")).toBe("1");
  });

  it("serializes revocation against the proof transaction after signature lookup", async () => {
    const revocation = db.concurrent(`BEGIN;
      UPDATE public.user_devices SET revoked_at=now(),revoked_reason='offline-test';
      SELECT pg_sleep(0.5) /* proof-test-revocation */; COMMIT;`);
    let locked = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      locked = db.sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
        WHERE query LIKE '%proof-test-revocation%' AND wait_event='PgSleep')`) === "t";
      if (locked) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(locked).toBe(true);
    const response = await post("device-proof", await authenticationProof());
    await revocation;
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "device_revoked" });
    expect(db.sql("SELECT count(*) FROM public.anon_sync_nonce_consumptions")).toBe("0");
    expect(db.sql("SELECT count(*) FROM public.tlsn_device_proof_consumptions")).toBe("0");
  });

  it("rejects oversized JSON before a proof transaction", async () => {
    expect((await post("device-proof", { padding: "x".repeat(64 * 1024) })).status).toBe(413);
    expect(consumeCalls).toBe(0);
  });
});
