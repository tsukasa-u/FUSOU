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
  };
}

function createEnv(bucket: ReturnType<typeof createBucket>): Bindings {
  return {
    FLEET_SNAPSHOT_BUCKET: bucket,
    DATASET_TOKEN_SECRET: "dataset-token-secret",
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
});