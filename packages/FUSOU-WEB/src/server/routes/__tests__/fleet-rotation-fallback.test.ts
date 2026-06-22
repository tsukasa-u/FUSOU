import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateEnvContext,
  mockGetEnv,
  mockValidateJWT,
  mockResolveLinkedMemberIdHashForUser,
  mockResolveSupabaseConfig,
  mockValidateDatasetTokenWithConstraints,
  mockCreateClient,
} = vi.hoisted(() => ({
  mockCreateEnvContext: vi.fn(),
  mockGetEnv: vi.fn(),
  mockValidateJWT: vi.fn(),
  mockResolveLinkedMemberIdHashForUser: vi.fn(),
  mockResolveSupabaseConfig: vi.fn(),
  mockValidateDatasetTokenWithConstraints: vi.fn(),
  mockCreateClient: vi.fn(),
}));

vi.mock("../../utils", () => ({
  createEnvContext: mockCreateEnvContext,
  getEnv: mockGetEnv,
  extractBearer: (header?: string) => {
    if (!header?.startsWith("Bearer ")) return null;
    return header.slice(7).trim();
  },
  resolveLinkedMemberIdHashForUser: mockResolveLinkedMemberIdHashForUser,
  validateJWT: mockValidateJWT,
  resolveSupabaseConfig: mockResolveSupabaseConfig,
  validateDatasetTokenWithConstraints: mockValidateDatasetTokenWithConstraints,
  timingSafeEqual: (a: string, b: string) => a === b,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

import fleetApp from "../fleet";

type ListPage = {
  objects: Array<{ key: string; uploaded: Date; size: number }>;
  truncated?: boolean;
  cursor?: string;
};

function createBucketMock(options: {
  pagesByPrefix: Record<string, ListPage[]>;
  payloadByKey?: Record<string, unknown>;
}) {
  const queues = new Map<string, ListPage[]>();
  for (const [prefix, pages] of Object.entries(options.pagesByPrefix)) {
    queues.set(prefix, [...pages]);
  }

  const encoder = new TextEncoder();

  return {
    list: vi.fn(async ({ prefix }: { prefix?: string }) => {
      const key = prefix ?? "";
      const queue = queues.get(key) ?? [];
      if (queue.length === 0) {
        return { objects: [], truncated: false };
      }
      return queue.shift()!;
    }),
    get: vi.fn(async (key: string) => {
      if (!options.payloadByKey || !(key in options.payloadByKey)) {
        return null;
      }
      const payload = options.payloadByKey[key];
      const text =
        typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
      return {
        arrayBuffer: async () => encoder.encode(text).buffer,
      };
    }),
    put: vi.fn(),
    head: vi.fn(),
    delete: vi.fn(),
  };
}

function createSupabaseAdminMock(options: {
  canonicalDatasetId: string | null;
  rotationsData?: Array<{ pid_from: string; pid_to: string }>;
  rotationsPages?: Array<Array<{ pid_from: string; pid_to: string }>>;
  rotationsError?: { code?: string; message?: string } | null;
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === "user_member_map") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: options.canonicalDatasetId
                  ? { member_id_hash: options.canonicalDatasetId }
                  : null,
                error: null,
              })),
            })),
          })),
        };
      }

      if (table === "member_id_hash_rotations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              or: vi.fn(() => ({
                range: vi.fn(async (from: number, to: number) => {
                  if (options.rotationsError) {
                    return {
                      data: null,
                      error: options.rotationsError,
                    };
                  }

                  if (options.rotationsPages) {
                    const pageSize = Math.max(1, to - from + 1);
                    const pageIndex = Math.floor(from / pageSize);
                    return {
                      data: options.rotationsPages[pageIndex] ?? [],
                      error: null,
                    };
                  }

                  return {
                    data: from === 0 ? (options.rotationsData ?? []) : [],
                    error: null,
                  };
                }),
              })),
            })),
          })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe("fleet route rotation fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockCreateEnvContext.mockImplementation((c: any) => ({
      runtime: c?.env ?? {},
      buildtime: {},
      isDev: false,
    }));
    mockGetEnv.mockImplementation(
      (ctx: any, key: string) => ctx.runtime?.[key],
    );

    mockResolveSupabaseConfig.mockImplementation((ctx: any) => ({
      url: ctx.runtime?.PUBLIC_SUPABASE_URL ?? null,
      serviceRoleKey: ctx.runtime?.SUPABASE_SECRET_KEY ?? null,
      publishableKey: ctx.runtime?.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? null,
    }));

    mockValidateJWT.mockResolvedValue(null);
    mockResolveLinkedMemberIdHashForUser.mockResolvedValue({
      memberIdHash: null,
      source: null,
    });
    mockValidateDatasetTokenWithConstraints.mockResolvedValue({
      ok: false,
      status: 401,
      error: "Invalid or expired dataset_token",
    });

    mockCreateClient.mockImplementation(() =>
      createSupabaseAdminMock({ canonicalDatasetId: null }),
    );
  });

  it("uses dataset token fallback when Authorization JWT is invalid", async () => {
    const datasetId = "a".repeat(64);
    const key = `fleets/${datasetId}/latest/123.json.gz`;

    mockValidateDatasetTokenWithConstraints.mockResolvedValue({
      ok: true,
      token: { dataset_id: datasetId, user_id: "user-1" },
    });

    const bucket = createBucketMock({
      pagesByPrefix: {
        [`fleets/${datasetId}/latest/`]: [
          {
            objects: [
              { key, uploaded: new Date("2026-05-24T00:00:00Z"), size: 10 },
            ],
            truncated: false,
          },
        ],
      },
      payloadByKey: {
        [key]: { source: "dataset-token-fallback" },
      },
    });

    const res = await fleetApp.request(
      "http://localhost/snapshot/latest",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer invalid-token",
          "X-Dataset-Token": "dataset-token",
        },
      },
      {
        FLEET_SNAPSHOT_BUCKET: bucket,
        DATASET_TOKEN_SECRET: "x".repeat(32),
      } as any,
    );

    const body = (await res.json()) as {
      ok: boolean;
      snapshot: { source?: string };
    };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.snapshot.source).toBe("dataset-token-fallback");
  });

  it("reads historical snapshot via rotations and paginated R2 listing", async () => {
    const currentDatasetId = "b".repeat(64);
    const oldDatasetId = "c".repeat(64);
    const oldPrefix = `fleets/${oldDatasetId}/latest-fleet/`;
    const currentPrefix = `fleets/${currentDatasetId}/latest-fleet/`;

    const oldKey1 = `${oldPrefix}100-old.json.gz`;
    const oldKey2 = `${oldPrefix}200-new.json.gz`;

    mockValidateDatasetTokenWithConstraints.mockResolvedValue({
      ok: true,
      token: { dataset_id: currentDatasetId, user_id: "user-rotation" },
    });

    mockCreateClient.mockImplementation(() =>
      createSupabaseAdminMock({
        canonicalDatasetId: currentDatasetId,
        rotationsData: [
          {
            pid_from: oldDatasetId,
            pid_to: currentDatasetId,
          },
        ],
      }),
    );

    const bucket = createBucketMock({
      pagesByPrefix: {
        [currentPrefix]: [{ objects: [], truncated: false }],
        [oldPrefix]: [
          {
            objects: [
              {
                key: oldKey1,
                uploaded: new Date("2026-05-24T00:00:01Z"),
                size: 11,
              },
            ],
            truncated: true,
            cursor: "next",
          },
          {
            objects: [
              {
                key: oldKey2,
                uploaded: new Date("2026-05-24T00:00:02Z"),
                size: 12,
              },
            ],
            truncated: false,
          },
        ],
      },
      payloadByKey: {
        [oldKey2]: { source: "historical-latest" },
      },
    });

    const res = await fleetApp.request(
      "http://localhost/snapshot/Latest%20Fleet",
      {
        method: "GET",
        headers: {
          "X-Dataset-Token": "dataset-token",
        },
      },
      {
        FLEET_SNAPSHOT_BUCKET: bucket,
        DATASET_TOKEN_SECRET: "x".repeat(32),
        PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "service-role",
        PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon-key",
      } as any,
    );

    const body = (await res.json()) as {
      snapshot: { source?: string };
    };
    expect(res.status).toBe(200);
    expect(body.snapshot.source).toBe("historical-latest");
    expect(bucket.list).toHaveBeenCalledTimes(3);
  });

  it("falls back to current dataset when rotations table is unavailable", async () => {
    const currentDatasetId = "d".repeat(64);
    const prefix = `fleets/${currentDatasetId}/latest/`;
    const key = `${prefix}1.json.gz`;

    mockValidateDatasetTokenWithConstraints.mockResolvedValue({
      ok: true,
      token: { dataset_id: currentDatasetId, user_id: "user-fallback" },
    });

    mockCreateClient.mockImplementation(() =>
      createSupabaseAdminMock({
        canonicalDatasetId: currentDatasetId,
        rotationsError: {
          code: "42P01",
          message: 'relation "member_id_hash_rotations" does not exist',
        },
      }),
    );

    const bucket = createBucketMock({
      pagesByPrefix: {
        [prefix]: [
          {
            objects: [
              { key, uploaded: new Date("2026-05-24T00:00:00Z"), size: 8 },
            ],
            truncated: false,
          },
        ],
      },
      payloadByKey: {
        [key]: { source: "current-only" },
      },
    });

    const res = await fleetApp.request(
      "http://localhost/snapshot/latest",
      {
        method: "GET",
        headers: {
          "X-Dataset-Token": "dataset-token",
        },
      },
      {
        FLEET_SNAPSHOT_BUCKET: bucket,
        DATASET_TOKEN_SECRET: "x".repeat(32),
        PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "service-role",
        PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon-key",
      } as any,
    );

    expect(res.status).toBe(200);
  });

  it("discovers historical candidate from second rotations page", async () => {
    const currentDatasetId = "7".repeat(64);
    const oldDatasetId = "8".repeat(64);
    const oldPrefix = `fleets/${oldDatasetId}/latest/`;
    const oldKey = `${oldPrefix}history.json.gz`;

    mockValidateDatasetTokenWithConstraints.mockResolvedValue({
      ok: true,
      token: { dataset_id: currentDatasetId, user_id: "user-paged" },
    });

    const firstPage = Array.from({ length: 128 }, () => ({
      pid_from: currentDatasetId,
      pid_to: currentDatasetId,
    }));

    mockCreateClient.mockImplementation(() =>
      createSupabaseAdminMock({
        canonicalDatasetId: currentDatasetId,
        rotationsPages: [
          firstPage,
          [
            {
              pid_from: oldDatasetId,
              pid_to: currentDatasetId,
            },
          ],
        ],
      }),
    );

    const bucket = createBucketMock({
      pagesByPrefix: {
        [`fleets/${currentDatasetId}/latest/`]: [
          {
            objects: [],
            truncated: false,
          },
        ],
        [oldPrefix]: [
          {
            objects: [
              {
                key: oldKey,
                uploaded: new Date("2026-05-24T00:00:00Z"),
                size: 13,
              },
            ],
            truncated: false,
          },
        ],
      },
      payloadByKey: {
        [oldKey]: { source: "paged-rotation" },
      },
    });

    const res = await fleetApp.request(
      "http://localhost/snapshot/latest",
      {
        method: "GET",
        headers: {
          "X-Dataset-Token": "dataset-token",
        },
      },
      {
        FLEET_SNAPSHOT_BUCKET: bucket,
        DATASET_TOKEN_SECRET: "x".repeat(32),
        PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "service-role",
        PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon-key",
      } as any,
    );

    const body = (await res.json()) as {
      snapshot: { source?: string };
    };
    expect(res.status).toBe(200);
    expect(body.snapshot.source).toBe("paged-rotation");
  });

  it("list endpoint keeps deterministic entry when uploaded timestamps tie", async () => {
    const currentDatasetId = "f".repeat(64);
    const historicalDatasetId = "0".repeat(64);

    mockValidateDatasetTokenWithConstraints.mockResolvedValue({
      ok: true,
      token: { dataset_id: currentDatasetId, user_id: "user-list" },
    });

    mockCreateClient.mockImplementation(() =>
      createSupabaseAdminMock({
        canonicalDatasetId: currentDatasetId,
        rotationsData: [
          {
            pid_from: historicalDatasetId,
            pid_to: currentDatasetId,
          },
        ],
      }),
    );

    const tied = new Date("2026-05-24T00:00:00Z");
    const bucket = createBucketMock({
      pagesByPrefix: {
        [`fleets/${currentDatasetId}/`]: [
          {
            objects: [
              {
                key: `fleets/${currentDatasetId}/latest/zz.json.gz`,
                uploaded: tied,
                size: 10,
              },
            ],
            truncated: false,
          },
        ],
        [`fleets/${historicalDatasetId}/`]: [
          {
            objects: [
              {
                key: `fleets/${historicalDatasetId}/latest/aa.json.gz`,
                uploaded: tied,
                size: 20,
              },
            ],
            truncated: false,
          },
        ],
      },
    });

    const res = await fleetApp.request(
      "http://localhost/snapshots/list",
      {
        method: "GET",
        headers: {
          "X-Dataset-Token": "dataset-token",
        },
      },
      {
        FLEET_SNAPSHOT_BUCKET: bucket,
        DATASET_TOKEN_SECRET: "x".repeat(32),
        PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "service-role",
        PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon-key",
      } as any,
    );

    const body = (await res.json()) as {
      count: number;
      tags: Array<{ tag: string; size: number }>;
    };
    expect(res.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.tags[0].tag).toBe("latest");
    expect(body.tags[0].size).toBe(20);
  });

  it("delete endpoint removes snapshots across rotation candidates", async () => {
    const currentDatasetId = "1".repeat(64);
    const historicalDatasetId = "2".repeat(64);
    const safeTag = "latest-fleet";

    const keyCurrent1 = `fleets/${currentDatasetId}/${safeTag}/100-a.json.gz`;
    const keyCurrent2 = `fleets/${currentDatasetId}/${safeTag}/200-b.json.gz`;
    const keyHistorical = `fleets/${historicalDatasetId}/${safeTag}/150-c.json.gz`;

    mockValidateDatasetTokenWithConstraints.mockResolvedValue({
      ok: true,
      token: { dataset_id: currentDatasetId, user_id: "user-delete" },
    });

    mockCreateClient.mockImplementation(() =>
      createSupabaseAdminMock({
        canonicalDatasetId: currentDatasetId,
        rotationsData: [
          {
            pid_from: historicalDatasetId,
            pid_to: currentDatasetId,
          },
        ],
      }),
    );

    const bucket = createBucketMock({
      pagesByPrefix: {
        [`fleets/${currentDatasetId}/${safeTag}/`]: [
          {
            objects: [
              {
                key: keyCurrent1,
                uploaded: new Date("2026-05-24T00:00:00Z"),
                size: 10,
              },
              {
                key: keyCurrent2,
                uploaded: new Date("2026-05-24T00:00:01Z"),
                size: 11,
              },
            ],
            truncated: false,
          },
        ],
        [`fleets/${historicalDatasetId}/${safeTag}/`]: [
          {
            objects: [
              {
                key: keyHistorical,
                uploaded: new Date("2026-05-24T00:00:02Z"),
                size: 12,
              },
            ],
            truncated: false,
          },
        ],
      },
    });

    const res = await fleetApp.request(
      "http://localhost/snapshot/Latest%20Fleet",
      {
        method: "DELETE",
        headers: {
          "X-Dataset-Token": "dataset-token",
        },
      },
      {
        FLEET_SNAPSHOT_BUCKET: bucket,
        DATASET_TOKEN_SECRET: "x".repeat(32),
        PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "service-role",
        PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon-key",
      } as any,
    );

    const body = (await res.json()) as {
      ok: boolean;
      deleted: number;
      tag: string;
    };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(3);
    expect(bucket.delete).toHaveBeenCalledTimes(3);

    const deletedKeys = new Set(
      (bucket.delete as ReturnType<typeof vi.fn>).mock.calls.map(
        (args: [string]) => args[0],
      ),
    );
    expect(deletedKeys).toEqual(
      new Set([keyCurrent1, keyCurrent2, keyHistorical]),
    );
  });

  it("delete endpoint returns deleted=0 when no snapshots are found", async () => {
    const currentDatasetId = "3".repeat(64);
    const historicalDatasetId = "4".repeat(64);
    const safeTag = "latest";

    mockValidateDatasetTokenWithConstraints.mockResolvedValue({
      ok: true,
      token: { dataset_id: currentDatasetId, user_id: "user-delete-empty" },
    });

    mockCreateClient.mockImplementation(() =>
      createSupabaseAdminMock({
        canonicalDatasetId: currentDatasetId,
        rotationsData: [
          {
            pid_from: historicalDatasetId,
            pid_to: currentDatasetId,
          },
        ],
      }),
    );

    const bucket = createBucketMock({
      pagesByPrefix: {
        [`fleets/${currentDatasetId}/${safeTag}/`]: [
          {
            objects: [],
            truncated: false,
          },
        ],
        [`fleets/${historicalDatasetId}/${safeTag}/`]: [
          {
            objects: [],
            truncated: false,
          },
        ],
      },
    });

    const res = await fleetApp.request(
      "http://localhost/snapshot/latest",
      {
        method: "DELETE",
        headers: {
          "X-Dataset-Token": "dataset-token",
        },
      },
      {
        FLEET_SNAPSHOT_BUCKET: bucket,
        DATASET_TOKEN_SECRET: "x".repeat(32),
        PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "service-role",
        PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon-key",
      } as any,
    );

    const body = (await res.json()) as {
      ok: boolean;
      deleted: number;
      tag: string;
    };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.deleted).toBe(0);
    expect(bucket.delete).not.toHaveBeenCalled();
  });
});
