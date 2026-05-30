import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import synergyApp from "../synergy";
import { getSynergyManifestR2Keys } from "../../types/synergy";
import { sha256Hex } from "../../utils/synergy-payload";

const { mockCreateEnvContext, mockVerifyAdminToken } = vi.hoisted(() => ({
  mockCreateEnvContext: vi.fn(),
  mockVerifyAdminToken: vi.fn(),
}));

vi.mock("../../utils", () => ({
  createEnvContext: mockCreateEnvContext,
  verifyAdminToken: mockVerifyAdminToken,
}));

type ManifestRow = {
  period_tag: string;
  period_revision: number;
  content_hash: string;
  sp_effect_sha256: string;
  completed_at?: number | null;
};

function createDbMock(options: {
  latestMasterDataPeriodTag?: string | null;
  latestSynergyPeriodTag?: string | null;
  manifests: ManifestRow[];
}) {
  const resolveFirst = (sql: string, params: unknown[]) => {
    if (
      sql.includes("SELECT period_tag") &&
      sql.includes("FROM master_data_index")
    ) {
      return options.latestMasterDataPeriodTag
        ? { period_tag: options.latestMasterDataPeriodTag }
        : null;
    }

    if (
      sql.includes("SELECT period_tag FROM synergy_manifest") &&
      sql.includes("LIMIT 1")
    ) {
      return options.latestSynergyPeriodTag
        ? { period_tag: options.latestSynergyPeriodTag }
        : null;
    }

    if (sql.includes("FROM synergy_manifest") && sql.includes("LIMIT 1")) {
      let rows = [...options.manifests];
      if (sql.includes("AND period_tag = ?")) {
        rows = rows.filter((row) => row.period_tag === params[0]);
      }
      return rows[0] ?? null;
    }

    throw new Error(`Unhandled first() SQL in test: ${sql}`);
  };

  const resolveAll = (sql: string) => {
    if (sql.includes("FROM synergy_manifest") && sql.includes("LIMIT 20")) {
      return { results: options.manifests };
    }
    throw new Error(`Unhandled all() SQL in test: ${sql}`);
  };

  return {
    prepare: vi.fn((rawSql: string) => {
      const sql = rawSql.replace(/\s+/g, " ").trim();
      return {
        bind: (...params: unknown[]) => ({
          first: async () => resolveFirst(sql, params),
          all: async () => resolveAll(sql),
        }),
        first: async () => resolveFirst(sql, []),
        all: async () => resolveAll(sql),
      };
    }),
  };
}

function createBucketMock(
  payloadByKey: Record<string, Uint8Array | null | Error>,
) {
  return {
    get: vi.fn(async (key: string) => {
      const payload = payloadByKey[key];
      if (!payload) {
        return null;
      }
      return {
        arrayBuffer: async () => {
          if (payload instanceof Error) {
            throw payload;
          }
          return payload.buffer.slice(
            payload.byteOffset,
            payload.byteOffset + payload.byteLength,
          );
        },
      };
    }),
  };
}

describe("synergy-data route resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateEnvContext.mockImplementation((ctx: any) => ({
      runtime: ctx?.env ?? {},
      buildtime: {},
      isDev: false,
    }));
    mockVerifyAdminToken.mockReturnValue({ ok: true });
  });

  it("returns 404 when requested period payload object is missing", async () => {
    const manifest: ManifestRow = {
      period_tag: "2026-05-30",
      period_revision: 2,
      content_hash: "a".repeat(64),
      sp_effect_sha256: "b".repeat(64),
      completed_at: 200,
    };
    const db = createDbMock({ manifests: [manifest] });
    const bucket = createBucketMock({});

    const response = await synergyApp.request(
      "http://localhost/synergy-data?period_tag=2026-05-30",
      { method: "GET" },
      {
        MASTER_DATA_INDEX_DB: db,
        MASTER_DATA_BUCKET: bucket,
      } as any,
    );

    const body = (await response.json()) as { error: string };
    expect(response.status).toBe(404);
    expect(body.error).toBe("No valid completed synergy payload found");
  });

  it("falls back to older valid manifest when latest payload is invalid", async () => {
    const validPayload = {
      effect_rules: [],
      cross_rules: [],
      _meta: { generated_at: "2026-05-30T00:00:00.000Z" },
    };
    const rawValidBytes = new TextEncoder().encode(
      JSON.stringify(validPayload),
    );
    const validSha = await sha256Hex(rawValidBytes);
    const validCompressed = new Uint8Array(gzipSync(rawValidBytes));

    const latestInvalid: ManifestRow = {
      period_tag: "2026-05-30",
      period_revision: 2,
      content_hash: "1".repeat(64),
      sp_effect_sha256: "2".repeat(64),
      completed_at: 200,
    };
    const olderValid: ManifestRow = {
      period_tag: "2026-05-29",
      period_revision: 1,
      content_hash: "3".repeat(64),
      sp_effect_sha256: validSha,
      completed_at: 100,
    };

    const latestKey = getSynergyManifestR2Keys(
      latestInvalid.period_tag,
      latestInvalid.period_revision,
      latestInvalid.content_hash,
    ).sp_effect_json;
    const olderKey = getSynergyManifestR2Keys(
      olderValid.period_tag,
      olderValid.period_revision,
      olderValid.content_hash,
    ).sp_effect_json;

    const db = createDbMock({
      latestMasterDataPeriodTag: latestInvalid.period_tag,
      manifests: [latestInvalid, olderValid],
    });
    const bucket = createBucketMock({
      [latestKey]: new Uint8Array([0xff, 0x00, 0x01]),
      [olderKey]: validCompressed,
    });

    const response = await synergyApp.request(
      "http://localhost/synergy-data",
      { method: "GET" },
      {
        MASTER_DATA_INDEX_DB: db,
        MASTER_DATA_BUCKET: bucket,
      } as any,
    );

    const body = (await response.json()) as typeof validPayload;
    expect(response.status).toBe(200);
    expect(body).toEqual(validPayload);
    expect(response.headers.get("X-FUSOU-Synergy-Period-Tag")).toBe(
      olderValid.period_tag,
    );
    expect(response.headers.get("X-FUSOU-Synergy-Period-Revision")).toBe(
      olderValid.period_revision.toString(),
    );
  });

  it("returns 500 when requested period payload read fails", async () => {
    const manifest: ManifestRow = {
      period_tag: "2026-05-30",
      period_revision: 2,
      content_hash: "d".repeat(64),
      sp_effect_sha256: "e".repeat(64),
      completed_at: 200,
    };
    const key = getSynergyManifestR2Keys(
      manifest.period_tag,
      manifest.period_revision,
      manifest.content_hash,
    ).sp_effect_json;

    const db = createDbMock({ manifests: [manifest] });
    const bucket = createBucketMock({
      [key]: new Error("simulated arrayBuffer failure"),
    });

    const response = await synergyApp.request(
      "http://localhost/synergy-data?period_tag=2026-05-30",
      { method: "GET" },
      {
        MASTER_DATA_INDEX_DB: db,
        MASTER_DATA_BUCKET: bucket,
      } as any,
    );

    const body = (await response.json()) as { error: string; detail: string };
    expect(response.status).toBe(500);
    expect(body.error).toBe("Failed to load synergy payload from R2");
    expect(body.detail).toContain("simulated arrayBuffer failure");
  });
});
