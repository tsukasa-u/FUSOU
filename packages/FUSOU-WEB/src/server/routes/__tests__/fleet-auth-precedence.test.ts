import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../types";

const {
  mockResolveDatasetTokenRevocationConfig,
  mockResolvePublicIdForUser,
  mockValidateDatasetTokenWithConstraints,
  mockValidateJWT,
} = vi.hoisted(() => ({
  mockResolveDatasetTokenRevocationConfig: vi.fn(() => ({})),
  mockResolvePublicIdForUser: vi.fn(),
  mockValidateDatasetTokenWithConstraints: vi.fn(),
  mockValidateJWT: vi.fn(),
}));

vi.mock("../../utils", () => ({
  createEnvContext: (context: { env: Record<string, unknown> }) => ({
    runtime: context.env,
  }),
  extractBearer: (value: string | undefined) =>
    value?.startsWith("Bearer ") ? value.slice(7).trim() : null,
  getEnv: (context: { runtime: Record<string, unknown> }, key: string) =>
    context.runtime[key],
  resolveDatasetTokenRevocationConfig:
    mockResolveDatasetTokenRevocationConfig,
  resolvePublicIdForUser: mockResolvePublicIdForUser,
  resolveSupabaseConfig: vi.fn(() => ({
    url: "https://supabase.example",
    serviceRoleKey: "service-role-key",
  })),
  timingSafeEqual: (left: string, right: string) => left === right,
  validateDatasetTokenWithConstraints: mockValidateDatasetTokenWithConstraints,
  validateJWT: mockValidateJWT,
}));

import fleetApp from "../fleet";

const JWT_DATASET_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN_DATASET_ID = "22222222-2222-4222-8222-222222222222";

function createBucket() {
  const payload = new TextEncoder().encode(
    JSON.stringify({ s3s: [], s8s: [], d8k: [], c11g: 0 }),
  );
  return {
    get: vi.fn(async () => ({
      arrayBuffer: async () =>
        payload.buffer.slice(
          payload.byteOffset,
          payload.byteOffset + payload.byteLength,
        ),
    })),
    list: vi.fn(async () => ({
      truncated: false,
      objects: [
        {
          key: `fleets/${TOKEN_DATASET_ID}/latest/snapshot.json`,
          uploaded: new Date("2026-08-09T00:00:00Z"),
          size: payload.byteLength,
        },
      ],
    })),
    delete: vi.fn(async () => {}),
  };
}

function createEnv(
  bucket: ReturnType<typeof createBucket>,
  overrides: Record<string, unknown> = {},
): Bindings {
  return {
    FLEET_SNAPSHOT_BUCKET: bucket,
    DATASET_TOKEN_SECRET: "dataset-token-secret",
    PUBLIC_SITE_URL: "https://fusou.example",
    PUBLIC_SITE_ALLOWED_HOSTS: "preview.fusou.example",
    ...overrides,
  } as unknown as Bindings;
}

describe("fleet dataset authentication precedence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateJWT.mockResolvedValue({ id: "web-user" });
    mockResolvePublicIdForUser.mockResolvedValue({
      publicId: JWT_DATASET_ID,
      source: "web_mapping",
    });
    mockValidateDatasetTokenWithConstraints.mockResolvedValue({
      ok: true,
      token: {
        dataset_id: TOKEN_DATASET_ID,
        user_id: "canonical-user",
        device_id: "33333333-3333-4333-8333-333333333333",
      },
    });
  });

  it("uses the explicit dataset token when JWT and token select different datasets", async () => {
    const bucket = createBucket();
    const response = await fleetApp.request(
      "https://example.test/snapshot/latest",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer valid-jwt",
          "X-Dataset-Token": "valid-dataset-token",
        },
      },
      createEnv(bucket),
    );

    expect(response.status).toBe(200);
    expect(bucket.list).toHaveBeenCalledWith({
      prefix: `fleets/${TOKEN_DATASET_ID}/latest/`,
      limit: 1000,
    });
    expect(mockValidateJWT).not.toHaveBeenCalled();
  });

  it("does not bypass an invalid explicit dataset token with a valid JWT", async () => {
    mockValidateDatasetTokenWithConstraints.mockResolvedValue({
      ok: false,
      error: "Invalid or expired dataset token",
      status: 401,
    });
    const response = await fleetApp.request(
      "https://example.test/snapshot/latest",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer valid-jwt",
          "X-Dataset-Token": "invalid-dataset-token",
        },
      },
      createEnv(createBucket()),
    );

    expect(response.status).toBe(401);
    expect(mockValidateJWT).not.toHaveBeenCalled();
  });

  it("authenticates GET endpoints using sb-access-token / __Secure-sb-access-token cookies", async () => {
    const bucket = createBucket();
    const listResponse = await fleetApp.request(
      "https://example.test/snapshots/list",
      {
        method: "GET",
        headers: {
          Cookie: "other=1; sb-access-token=cookie-jwt-token",
        },
      },
      createEnv(bucket),
    );

    expect(listResponse.status).toBe(200);
    expect(mockValidateJWT).toHaveBeenCalledWith("cookie-jwt-token");
    expect(bucket.list).toHaveBeenCalledWith({
      prefix: `fleets/${JWT_DATASET_ID}/`,
      limit: 1000,
    });

    mockValidateJWT.mockClear();
    const getResponse = await fleetApp.request(
      "https://example.test/snapshot/latest",
      {
        method: "GET",
        headers: {
          Cookie: "__Secure-sb-access-token=secure%2Dcookie%2Djwt",
        },
      },
      createEnv(bucket),
    );

    expect(getResponse.status).toBe(200);
    expect(mockValidateJWT).toHaveBeenCalledWith("secure-cookie-jwt");
  });

  it("does not silently downgrade an invalid Bearer header to a valid cookie", async () => {
    mockValidateJWT.mockImplementation(async (token: string) =>
      token === "cookie-jwt-token" ? { id: "web-user" } : null,
    );

    const response = await fleetApp.request(
      "https://example.test/snapshots/list",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer invalid-jwt-token",
          Cookie: "sb-access-token=cookie-jwt-token",
        },
      },
      createEnv(createBucket()),
    );

    expect(response.status).toBe(401);
    expect(mockValidateJWT).toHaveBeenCalledTimes(1);
    expect(mockValidateJWT).toHaveBeenCalledWith("invalid-jwt-token");
  });

  it("enforces Origin validation on cookie-authenticated DELETE /snapshot/:tag", async () => {
    const bucket = createBucket();

    const missingOrigin = await fleetApp.request(
      "https://example.test/snapshot/latest",
      {
        method: "DELETE",
        headers: {
          Cookie: "sb-access-token=cookie-jwt-token",
        },
      },
      createEnv(bucket),
    );
    expect(missingOrigin.status).toBe(403);
    expect(bucket.delete).not.toHaveBeenCalled();

    const crossOrigin = await fleetApp.request(
      "https://example.test/snapshot/latest",
      {
        method: "DELETE",
        headers: {
          Cookie: "sb-access-token=cookie-jwt-token",
          Origin: "https://attacker.example",
        },
      },
      createEnv(bucket),
    );
    expect(crossOrigin.status).toBe(403);
    expect(bucket.delete).not.toHaveBeenCalled();

    const missingSiteConfig = await fleetApp.request(
      "https://example.test/snapshot/latest",
      {
        method: "DELETE",
        headers: {
          Cookie: "sb-access-token=cookie-jwt-token",
          Origin: "https://fusou.example",
        },
      },
      createEnv(bucket, { PUBLIC_SITE_URL: "" }),
    );
    expect(missingSiteConfig.status).toBe(403);
    expect(bucket.delete).not.toHaveBeenCalled();

    const validOrigin = await fleetApp.request(
      "https://example.test/snapshot/latest",
      {
        method: "DELETE",
        headers: {
          Cookie: "sb-access-token=cookie-jwt-token",
          Origin: "https://fusou.example",
        },
      },
      createEnv(bucket),
    );
    expect(validOrigin.status).toBe(200);
    expect(bucket.delete).toHaveBeenCalledTimes(1);

    const allowedHostOrigin = await fleetApp.request(
      "https://example.test/snapshot/latest",
      {
        method: "DELETE",
        headers: {
          Cookie: "sb-access-token=cookie-jwt-token",
          Origin: "https://preview.fusou.example",
        },
      },
      createEnv(bucket),
    );
    expect(allowedHostOrigin.status).toBe(200);

    // Bearer-authenticated deletes bypass Origin checks (for non-browser clients).
    const bearerDelete = await fleetApp.request(
      "https://example.test/snapshot/latest",
      {
        method: "DELETE",
        headers: {
          Authorization: "Bearer valid-jwt",
        },
      },
      createEnv(bucket),
    );
    expect(bearerDelete.status).toBe(200);
  });
});