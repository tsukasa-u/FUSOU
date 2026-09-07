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
  mockVerifyDeviceSigBytes,
  mockCreateTlsnDeviceProofMessage,
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
    mockVerifyDeviceSigBytes: vi.fn(),
    mockCreateTlsnDeviceProofMessage: vi.fn(),
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
  verifyDeviceSigBytes: mockVerifyDeviceSigBytes,
  createTlsnDeviceProofMessage: mockCreateTlsnDeviceProofMessage,
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

function stubDeviceProof(options: {
  canonicalUserId?: string;
  revokedAt?: string | null;
  nonceError?: unknown;
} = {}) {
  const deviceId = "33333333-3333-4333-8333-333333333333";
  const userId = options.canonicalUserId ?? "55555555-5555-4555-8555-555555555555";
  const nonceInsert = vi.fn().mockResolvedValue({ error: options.nonceError ?? null });
  const update = vi.fn(() => ({
    eq: vi.fn(() => ({
      eq: vi.fn(() => ({
        is: vi.fn().mockResolvedValue({ error: null }),
      })),
    })),
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: userId, is_anonymous: false }),
    }),
  );
  mockFrom.mockImplementation((table: string) => {
    if (table === "anon_sync_nonce_consumptions") {
      return {
        insert: nonceInsert,
        delete: vi.fn(() => ({
          lt: vi.fn().mockResolvedValue({ error: null }),
        })),
      };
    }
    if (table === "user_devices") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                canonical_user_id: userId,
                device_pubkey: "00".repeat(32),
                revoked_at: options.revokedAt ?? null,
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
  return { deviceId, nonceInsert, update };
}

const tlsnSessionId = "44444444-4444-4444-8444-444444444444";
const tlsnChallenge = "A".repeat(43);
const tlsnBindingValue = "RlVTT1UtQklORElORy1WMQ";

function tlsnProofBody(overrides: Record<string, unknown> = {}) {
  return {
    device_id: "33333333-3333-4333-8333-333333333333",
    session_id: tlsnSessionId,
    binding_value: tlsnBindingValue,
    challenge: tlsnChallenge,
    sig: "A".repeat(88),
    ...overrides,
  };
}

function stubTlsnDeviceProof(options: Parameters<typeof stubDeviceProof>[0] = {}) {
  const result = stubDeviceProof(options);
  mockDecodeBase64ToBytes.mockImplementation((value: string) => {
    try {
      return new Uint8Array(Buffer.from(value, "base64url"));
    } catch {
      return null;
    }
  });
  return result;
}

describe("anonymous-sync v2 endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockVerifyChallengeNonce.mockResolvedValue(true);
    mockVerifyDeviceSig.mockResolvedValue(true);
    mockVerifyDeviceSigBytes.mockResolvedValue(true);
    mockCreateTlsnDeviceProofMessage.mockReturnValue(new Uint8Array([1, 2, 3]));
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

  it("verifies an owned device proof with the existing challenge signature", async () => {
    const deviceId = "33333333-3333-4333-8333-333333333333";
    const userId = "55555555-5555-4555-8555-555555555555";
    const nonce = "a".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: userId, is_anonymous: false }),
      }),
    );
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn().mockResolvedValue({ error: null }),
        })),
      })),
    }));
    const nonceChain = {
      insert: vi.fn().mockResolvedValue({ error: null }),
      delete: vi.fn(() => ({
        lt: vi.fn().mockResolvedValue({ error: null }),
      })),
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === "anon_sync_nonce_consumptions") return nonceChain;
      if (table === "user_devices") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  canonical_user_id: userId,
                  device_pubkey: "00".repeat(32),
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
      "https://fusou.dev/anonymous-sync/v2/device-proof",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify({ device_id: deviceId, nonce, sig: "signature" }),
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      canonical_user_id: userId,
      device_id: deviceId,
    });
    expect(mockVerifyDeviceSig).toHaveBeenCalledWith({
      publicKeyB64: "A".repeat(44),
      message: nonce,
      signatureB64: "signature",
    });
    expect(nonceChain.insert).toHaveBeenCalledWith({
      device_id: deviceId,
      nonce,
    });
    vi.unstubAllGlobals();
  });

  it("rejects a valid device signature when the device belongs to another user", async () => {
    const deviceId = "33333333-3333-4333-8333-333333333333";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "55555555-5555-4555-8555-555555555555",
          is_anonymous: false,
        }),
      }),
    );
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              canonical_user_id: "66666666-6666-4666-8666-666666666666",
              device_pubkey: "00".repeat(32),
              revoked_at: null,
            },
            error: null,
          }),
        })),
      })),
    });

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/device-proof",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify({
          device_id: deviceId,
          nonce: "a".repeat(64),
          sig: "signature",
        }),
      },
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "device_owner_mismatch",
    });
    expect(mockVerifyDeviceSig).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects an anonymous bearer user before looking up the device", async () => {
    const deviceId = "33333333-3333-4333-8333-333333333333";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "55555555-5555-4555-8555-555555555555",
          is_anonymous: true,
        }),
      }),
    );

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/device-proof",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify({
          device_id: deviceId,
          nonce: "a".repeat(64),
          sig: "signature",
        }),
      },
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "invalid_token" });
    expect(mockFrom).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects a stale device challenge before looking up the device", async () => {
    const deviceId = "33333333-3333-4333-8333-333333333333";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "55555555-5555-4555-8555-555555555555",
          is_anonymous: false,
        }),
      }),
    );
    mockVerifyChallengeNonce.mockResolvedValue(false);

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/device-proof",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify({
          device_id: deviceId,
          nonce: "a".repeat(64),
          sig: "signature",
        }),
      },
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "nonce_invalid_or_expired" });
    expect(mockFrom).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects cookie authentication for device proof", async () => {
    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/device-proof",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "sb-access-token=access-token",
        },
        body: JSON.stringify({
          device_id: "33333333-3333-4333-8333-333333333333",
          nonce: "a".repeat(64),
          sig: "signature",
        }),
      },
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects an unknown device without accepting client identity", async () => {
    const deviceId = "33333333-3333-4333-8333-333333333333";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "55555555-5555-4555-8555-555555555555",
          is_anonymous: false,
        }),
      }),
    );
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    });

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/device-proof",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify({ device_id: deviceId, nonce: "a".repeat(64), sig: "signature" }),
      },
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "device_unknown_or_revoked" });
    expect(mockVerifyDeviceSig).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("fails closed when the device row is malformed", async () => {
    const deviceId = "33333333-3333-4333-8333-333333333333";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "55555555-5555-4555-8555-555555555555",
          is_anonymous: false,
        }),
      }),
    );
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { canonical_user_id: "55555555-5555-4555-8555-555555555555" },
            error: null,
          }),
        })),
      })),
    });

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/device-proof",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify({ device_id: deviceId, nonce: "a".repeat(64), sig: "signature" }),
      },
      env,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Database error" });
    expect(mockVerifyDeviceSig).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects a revoked device before verifying its signature", async () => {
    const { deviceId } = stubDeviceProof({ revokedAt: "2026-08-20T00:00:00.000Z" });
    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/device-proof",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify({
          device_id: deviceId,
          nonce: "a".repeat(64),
          sig: "signature",
        }),
      },
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "device_revoked" });
    expect(mockVerifyDeviceSig).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects an invalid device signature without consuming the nonce", async () => {
    const { deviceId, nonceInsert } = stubDeviceProof();
    mockVerifyDeviceSig.mockResolvedValue(false);
    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/device-proof",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify({
          device_id: deviceId,
          nonce: "a".repeat(64),
          sig: "signature",
        }),
      },
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "signature_invalid" });
    expect(nonceInsert).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects a replayed device-proof nonce atomically", async () => {
    const { deviceId, nonceInsert } = stubDeviceProof({
      nonceError: { code: "23505" },
    });
    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/device-proof",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify({
          device_id: deviceId,
          nonce: "a".repeat(64),
          sig: "signature",
        }),
      },
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "nonce_already_used" });
    expect(nonceInsert).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("verifies TLSN possession against the canonical session and binding context", async () => {
    const { deviceId, nonceInsert } = stubTlsnDeviceProof();
    const proof = tlsnProofBody();

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/tlsn-device-proof",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify(proof),
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      canonical_user_id: "55555555-5555-4555-8555-555555555555",
      device_id: deviceId,
    });
    expect(mockCreateTlsnDeviceProofMessage).toHaveBeenCalledWith({
      deviceId,
      sessionId: tlsnSessionId,
      bindingValue: tlsnBindingValue,
      challenge: expect.any(Uint8Array),
    });
    expect(mockVerifyDeviceSigBytes).toHaveBeenCalledWith({
      publicKeyB64: "A".repeat(44),
      messageBytes: new Uint8Array([1, 2, 3]),
      signatureB64: proof.sig,
    });
    expect(nonceInsert).toHaveBeenCalledWith({
      device_id: deviceId,
      nonce: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    vi.unstubAllGlobals();
  });

  it("rejects malformed TLSN proof context before authenticating the device", async () => {
    stubTlsnDeviceProof();

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/tlsn-device-proof",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify(tlsnProofBody({ challenge: "A".repeat(42) })),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockVerifyDeviceSigBytes).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects TLSN possession when the device owner does not match the bearer user", async () => {
    stubTlsnDeviceProof({
      canonicalUserId: "66666666-6666-4666-8666-666666666666",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "55555555-5555-4555-8555-555555555555",
          is_anonymous: false,
        }),
      }),
    );

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/tlsn-device-proof",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify(tlsnProofBody()),
      },
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "device_owner_mismatch",
    });
    expect(mockVerifyDeviceSigBytes).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects revoked TLSN devices before verifying their proof", async () => {
    stubTlsnDeviceProof({ revokedAt: "2026-08-20T00:00:00.000Z" });

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/tlsn-device-proof",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify(tlsnProofBody()),
      },
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "device_revoked" });
    expect(mockVerifyDeviceSigBytes).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects an invalid TLSN device signature without consuming proof replay state", async () => {
    const { nonceInsert } = stubTlsnDeviceProof();
    mockVerifyDeviceSigBytes.mockResolvedValue(false);

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/tlsn-device-proof",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify(tlsnProofBody()),
      },
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "signature_invalid" });
    expect(nonceInsert).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("rejects a replayed TLSN device proof atomically", async () => {
    const { nonceInsert } = stubTlsnDeviceProof({
      nonceError: { code: "23505" },
    });

    const response = await anonymousSyncV2App.request(
      "https://fusou.dev/anonymous-sync/v2/tlsn-device-proof",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token",
        },
        body: JSON.stringify(tlsnProofBody()),
      },
      env,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "device_proof_replayed",
    });
    expect(nonceInsert).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
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
        json: async () => ({ id: "web-user", email: null, is_anonymous: false }),
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
        json: async () => ({ id: "web-user", email: null, is_anonymous: false }),
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
        json: async () => ({ id: "web-user", email: null, is_anonymous: false }),
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
