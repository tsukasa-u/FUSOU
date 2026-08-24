import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../types";

const {
  mockCreateClient,
  mockDecodeBase64ToBytes,
  mockDeleteUser,
  mockFrom,
  mockRpc,
  mockSignInAnonymously,
  mockResolvePublicIdsForUser,
  mockValidateDatasetTokenWithConstraints,
  mockVerifyChallengeNonce,
  mockVerifyDeviceSig,
  mockEncodeBytesToBase64,
} = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockRpc = vi.fn();
  const mockDecodeBase64ToBytes = vi.fn();
  const mockSignInAnonymously = vi.fn();
  const mockDeleteUser = vi.fn();
  const mockResolvePublicIdsForUser = vi.fn();
  const mockEncodeBytesToBase64 = vi.fn(() => "A".repeat(44));
  const mockDb = {
    from: mockFrom,
    rpc: mockRpc,
    auth: {
      signInAnonymously: mockSignInAnonymously,
      admin: { deleteUser: mockDeleteUser },
    },
  };
  return {
    mockCreateClient: vi.fn(() => mockDb),
    mockDecodeBase64ToBytes,
    mockDeleteUser,
    mockFrom,
    mockRpc,
    mockSignInAnonymously,
    mockResolvePublicIdsForUser,
    mockValidateDatasetTokenWithConstraints: vi.fn(),
    mockVerifyChallengeNonce: vi.fn(),
    mockVerifyDeviceSig: vi.fn(),
    mockEncodeBytesToBase64,
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

vi.mock("../../utils", () => ({
  createEnvContext: (context: { env: Record<string, unknown> }) => ({
    runtime: context.env,
    buildtime: {},
    isDev: true,
  }),
  getEnv: (
    context: { runtime: Record<string, unknown> },
    key: string,
  ) => context.runtime[key],
  resolveSupabaseConfig: (context: {
    runtime: Record<string, unknown>;
  }) => ({
    url: context.runtime["PUBLIC_SUPABASE_URL"],
    serviceRoleKey: context.runtime["SUPABASE_SECRET_KEY"],
    publishableKey: context.runtime["PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
  }),
  resolvePublicIdsForUser: mockResolvePublicIdsForUser,
  validateDatasetTokenWithConstraints: mockValidateDatasetTokenWithConstraints,
}));

vi.mock("../../utils/pepper", () => ({
  CHALLENGE_BUCKET_SECONDS: 300,
  decodeBase64ToBytes: mockDecodeBase64ToBytes,
  encodeBytesToBase64: mockEncodeBytesToBase64,
  issueChallengeNonce: vi.fn(),
  verifyChallengeNonce: mockVerifyChallengeNonce,
  verifyDeviceSig: mockVerifyDeviceSig,
}));

import anonymousSyncV2App from "../anonymous-sync-v2";

const publicId = "11111111-1111-4111-8111-111111111111";
const syncToken = "22222222-2222-4222-8222-222222222222";
const env = {
  PUBLIC_SUPABASE_URL: "https://supabase.example",
  SUPABASE_SECRET_KEY: "service-role-key",
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  DATASET_TOKEN_SECRET: "a".repeat(32),
  CHALLENGE_HMAC_SECRET: "b".repeat(32),
} as unknown as Bindings;

function updateChain(result: unknown) {
  return {
    update: () => ({
      eq: () => ({
        is: () => ({
          is: () => ({
            gt: () => ({
              select: () => ({ maybeSingle: vi.fn().mockResolvedValue(result) }),
            }),
          }),
        }),
      }),
    }),
  };
}

describe("anonymous-sync v2 endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockVerifyChallengeNonce.mockResolvedValue(true);
    mockVerifyDeviceSig.mockResolvedValue(true);
    mockResolvePublicIdsForUser.mockResolvedValue({
      publicIds: [publicId],
      source: "web_mapping",
    });
    mockValidateDatasetTokenWithConstraints.mockResolvedValue({
      ok: true,
      token: {
        dataset_id: publicId,
        user_id: "canonical-user",
        device_id: "33333333-3333-4333-8333-333333333333",
      },
    });
  });

  it("sets an HttpOnly pending-sync cookie when creating a handoff", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const cleanup = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({
      delete: () => ({ lt: cleanup }),
      insert,
    });

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/pending",
      { method: "POST" },
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "sb-pending-sync-token=",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ token: expect.any(String) }),
    );
  });

  it("deletes the losing anonymous user after a concurrent mapping insert", async () => {
    const anonymousUserId = "55555555-5555-4555-8555-555555555555";
    const deviceId = "33333333-3333-4333-8333-333333333333";
    mockSignInAnonymously.mockResolvedValue({
      data: { user: { id: anonymousUserId } },
      error: null,
    });
    mockDeleteUser.mockResolvedValue({ error: null });
    mockRpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "rpc_register_user_device") return { data: deviceId, error: null };
      if (name === "rpc_register_public_id") return { data: publicId, error: null };
      if ("p_bucket_key" in args) return { data: true, error: null };
      throw new Error(`unexpected RPC: ${name}`);
    });
    mockDecodeBase64ToBytes.mockReturnValue(new Uint8Array(32));
    const mappingWinner = {
      data: { user_id: "winning-user", public_id: publicId },
      error: null,
    };
    const mappingMaybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce(mappingWinner);
    const mappingLookup = {
      select: () => ({
        eq: () => ({
          maybeSingle: mappingMaybeSingle,
        }),
      }),
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === "user_member_map") {
        return {
          ...mappingLookup,
          insert: () => ({
            select: () => ({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { code: "23505", message: "duplicate key" },
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_member_id: "12345",
          device_pub: "A".repeat(44),
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(mockDeleteUser).toHaveBeenCalledWith(anonymousUserId);
  });

  it("completes a pending handoff with a valid dataset token", async () => {
    const updateResult = {
      data: { public_id: publicId, synced_at: new Date().toISOString() },
      error: null,
    };
    mockFrom.mockReturnValue(updateChain(updateResult));

    const response = await anonymousSyncV2App.request(
      `https://fusou.dev/anonymous-sync/v2/pending/${syncToken}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_token: "signed-dataset-token",
          app_instance_id: "app-instance-1",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "completed",
      public_id: publicId,
    });
  });

  it("returns success when the same completion is retried", async () => {
    const fallback = vi.fn().mockResolvedValue({
      data: {
        public_id: publicId,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        synced_at: new Date().toISOString(),
      },
      error: null,
    });
    mockFrom
      .mockReturnValueOnce(updateChain({ data: null, error: null }))
      .mockReturnValueOnce({
        select: () => ({
          eq: () => ({ maybeSingle: fallback }),
        }),
      });

    const response = await anonymousSyncV2App.request(
      `https://fusou.dev/anonymous-sync/v2/pending/${syncToken}/complete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataset_token: "signed-dataset-token",
          app_instance_id: "app-instance-1",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "completed",
      public_id: publicId,
    });
  });

  it("returns the persisted result when a concurrent refresh loses nonce consumption", async () => {
    const deviceId = "33333333-3333-4333-8333-333333333333";
    const nonce = "a".repeat(64);
    const cachedResult = {
      status: "ok",
      device_id: deviceId,
      dataset_token: "cached-dataset-token",
      dataset_token_expires_at: Math.floor(Date.now() / 1000) + 300,
    };
    const databaseResult = vi.fn().mockResolvedValue({
      data: {
        refresh_result_token: cachedResult.dataset_token,
        refresh_result_expires_at: cachedResult.dataset_token_expires_at,
      },
      error: null,
    });
    mockRpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => {
      return "p_bucket_key" in args
        ? { data: true, error: null }
        : { data: publicId, error: null };
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "user_devices") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  device_id: deviceId,
                  canonical_user_id: "canonical-user",
                  public_id: publicId,
                  device_pubkey: "00".repeat(32),
                  revoked_at: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "anon_sync_nonce_consumptions") {
        return {
          insert: vi.fn().mockResolvedValue({
            error: { code: "23505", message: "duplicate key" },
          }),
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: databaseResult }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/refresh",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: deviceId,
          api_member_id: "12345",
          nonce,
          sig: "signature",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(cachedResult);
  });

  it("persists the first refresh result with nonce consumption", async () => {
    const deviceId = "33333333-3333-4333-8333-333333333333";
    const nonce = "b".repeat(64);
    const insert = vi.fn().mockResolvedValue({ error: null });
    const nonceChain = {
      insert,
      delete: vi.fn(() => ({
        lt: vi.fn().mockResolvedValue({ error: null }),
      })),
    };
    mockRpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => {
      return "p_bucket_key" in args
        ? { data: true, error: null }
        : { data: publicId, error: null };
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "user_devices") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  device_id: deviceId,
                  canonical_user_id: "canonical-user",
                  public_id: publicId,
                  device_pubkey: "00".repeat(32),
                  revoked_at: null,
                },
                error: null,
              }),
            }),
          }),
          update: vi.fn(() => ({ eq: vi.fn() })),
        };
      }
      if (table === "anon_sync_nonce_consumptions") return nonceChain;
      throw new Error(`unexpected table: ${table}`);
    });

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/refresh",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: deviceId,
          api_member_id: "12345",
          nonce,
          sig: "signature",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith({
      device_id: deviceId,
      nonce,
      refresh_result_token: expect.any(String),
      refresh_result_expires_at: expect.any(Number),
    });
  });

  it("revokes a same-owner device with a challenge signature", async () => {
    const callerDeviceId = "33333333-3333-4333-8333-333333333333";
    const targetDeviceId = "44444444-4444-4444-8444-444444444444";
    const caller = {
      data: {
        canonical_user_id: "canonical-user",
        public_id: publicId,
        device_pubkey: "00".repeat(32),
        revoked_at: null,
      },
      error: null,
    };
    const target = {
      data: { canonical_user_id: "canonical-user", revoked_at: null },
      error: null,
    };
    const updateRequest = vi.fn().mockResolvedValue({ error: null });
    const updatePayload = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({ is: updateRequest })),
      })),
    }));
    const selectChain = (result: unknown) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(result) })),
      })),
    });
    const nonceChain = {
      insert: vi.fn().mockResolvedValue({ error: null }),
      delete: vi.fn(() => ({
        lt: vi.fn().mockResolvedValue({ error: null }),
      })),
    };
    const userDeviceChains = [
      selectChain(caller),
      selectChain(target),
      { update: updatePayload },
    ];
    mockFrom.mockImplementation((table: string) => {
      if (table === "anon_sync_nonce_consumptions") return nonceChain;
      if (table === "user_devices") {
        const chain = userDeviceChains.shift();
        if (chain) return chain;
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/revoke",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: callerDeviceId,
          target_device_id: targetDeviceId,
          nonce: "a".repeat(64),
          sig: "signature",
          reason: "retired device",
        }),
      },
      env,
    );

    expect(response.status).toBe(204);
    expect(updatePayload).toHaveBeenCalledWith({
      revoked_at: expect.any(String),
      revoked_reason: "retired device",
    });
    expect(mockVerifyDeviceSig).toHaveBeenCalledWith({
      publicKeyB64: "A".repeat(44),
      message: `revoke|${callerDeviceId}|${targetDeviceId}|${"a".repeat(64)}`,
      signatureB64: "signature",
    });
  });

  it("does not revoke a device owned by another canonical user", async () => {
    const callerDeviceId = "33333333-3333-4333-8333-333333333333";
    const targetDeviceId = "44444444-4444-4444-8444-444444444444";
    const updatePayload = vi.fn();
    const caller = {
      data: {
        canonical_user_id: "canonical-user",
        public_id: publicId,
        device_pubkey: "00".repeat(32),
        revoked_at: null,
      },
      error: null,
    };
    const target = {
      data: { canonical_user_id: "other-user", revoked_at: null },
      error: null,
    };
    const selectChain = (result: unknown) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue(result) })),
      })),
    });
    const nonceChain = {
      insert: vi.fn().mockResolvedValue({ error: null }),
      delete: vi.fn(() => ({
        lt: vi.fn().mockResolvedValue({ error: null }),
      })),
    };
    const userDeviceChains = [selectChain(caller), selectChain(target)];
    mockFrom.mockImplementation((table: string) => {
      if (table === "anon_sync_nonce_consumptions") return nonceChain;
      if (table === "user_devices") {
        const chain = userDeviceChains.shift();
        if (chain) return chain;
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/revoke",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: callerDeviceId,
          target_device_id: targetDeviceId,
          nonce: "a".repeat(64),
          sig: "signature",
        }),
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(updatePayload).not.toHaveBeenCalled();
  });

  it("lists mapped Web user's devices and masks public ids", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "web-user", email: null }),
      }),
    );
    const listResult = {
      data: [
        {
          device_id: "33333333-3333-4333-8333-333333333333",
          public_id: publicId,
          created_at: "2026-08-20T00:00:00.000Z",
          last_seen_at: null,
          revoked_at: null,
          revoked_reason: null,
        },
      ],
      error: null,
    };
    const publicIdFilter = vi.fn(() => ({
      order: vi.fn(() => ({
        is: vi.fn().mockResolvedValue(listResult),
      })),
    }));
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({ in: publicIdFilter })),
    });

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/devices",
      {
        headers: { Authorization: "Bearer access-token" },
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      devices: [
        {
          device_id: "33333333-3333-4333-8333-333333333333",
          public_id_masked: "11111111...",
          created_at: "2026-08-20T00:00:00.000Z",
          last_seen_at: null,
          revoked_at: null,
          revoked_reason: null,
        },
      ],
      include_revoked: false,
    });
    expect(mockResolvePublicIdsForUser).toHaveBeenCalledWith({
      supabaseAdmin: expect.anything(),
      userId: "web-user",
    });
    expect(publicIdFilter).toHaveBeenCalledWith("public_id", [publicId]);
    vi.unstubAllGlobals();
  });

  it("returns no devices when the Web user has no mapped public id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "web-user", email: null }),
      }),
    );
    mockResolvePublicIdsForUser.mockResolvedValue({
      publicIds: [],
      source: null,
    });

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/devices",
      {
        headers: { Authorization: "Bearer access-token" },
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      devices: [],
      include_revoked: false,
    });
    expect(mockFrom).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("revokes a device owned through the authenticated user's Web mapping", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: "web-user", email: null }),
      }),
    );
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn(() => ({
          is: vi.fn().mockResolvedValue({ error: null }),
        })),
      })),
    }));
    mockFrom.mockImplementation((table: string) => {
      if (table === "user_devices") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  public_id: publicId,
                  revoked_at: null,
                },
                error: null,
              }),
            })),
          })),
          update,
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/devices/33333333-3333-4333-8333-333333333333",
      {
        method: "DELETE",
        headers: { Authorization: "Bearer access-token" },
      },
      env,
    );

    expect(response.status).toBe(204);
    expect(update).toHaveBeenCalledWith({
      revoked_at: expect.any(String),
      revoked_reason: "user_revoke_from_web",
    });
    expect(mockResolvePublicIdsForUser).toHaveBeenCalledWith({
      supabaseAdmin: expect.anything(),
      userId: "web-user",
    });
    vi.unstubAllGlobals();
  });
});
