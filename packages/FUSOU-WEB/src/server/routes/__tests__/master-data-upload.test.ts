import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings, D1Database, R2BucketBinding } from "../../types";

const {
  mockDecodeAvroOcfToJson,
  mockGenerateSignedToken,
  mockValidateCachedPeriodTag,
  mockValidateDatasetTokenWithConstraints,
  mockVerifySignedToken,
} = vi.hoisted(() => ({
  mockDecodeAvroOcfToJson: vi.fn(() => [{ id: 1 }]),
  mockGenerateSignedToken: vi.fn(async () => "signed-upload-token"),
  mockValidateCachedPeriodTag: vi.fn(async () => ({ ok: true })),
  mockValidateDatasetTokenWithConstraints: vi.fn(async () => ({
    ok: true,
    token: {
      dataset_id: "11111111-1111-4111-8111-111111111111",
      user_id: "canonical-user",
      device_id: "22222222-2222-4222-8222-222222222222",
    },
  })),
  mockVerifySignedToken: vi.fn(),
}));

vi.mock("../../utils", () => ({
  createEnvContext: (context: { env: Record<string, unknown> }) => ({
    runtime: context.env,
  }),
  extractBearer: (value: string | null) =>
    value?.startsWith("Bearer ") ? value.slice(7).trim() : null,
  generateSignedToken: mockGenerateSignedToken,
  getEnv: (context: { runtime: Record<string, unknown> }, key: string) =>
    context.runtime[key],
  safeWaitUntil: vi.fn(),
  timingSafeEqual: (left: string, right: string) => left === right,
  validateDatasetTokenWithConstraints: mockValidateDatasetTokenWithConstraints,
  validateJWT: vi.fn(async () => null),
  validateTokenPayloadWithSchema: (
    payload: unknown,
    schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } },
  ) => {
    const parsed = schema.safeParse(payload);
    return parsed.success
      ? { valid: true, data: parsed.data }
      : { valid: false, error: "invalid token payload" };
  },
  verifySignedToken: mockVerifySignedToken,
  resolveDatasetToken: (
    headerToken: string | null,
    bodyToken: unknown,
  ) => headerToken || (typeof bodyToken === "string" ? bodyToken : ""),
  resolveDatasetTokenRevocationConfig: vi.fn(() => ({})),
}));

vi.mock("../../utils/avro-decoder", () => ({
  decodeAvroOcfToJson: mockDecodeAvroOcfToJson,
}));

vi.mock("../../utils/period-tags", () => ({
  getLatestMasterPeriodTag: vi.fn(),
  validateCachedPeriodTag: mockValidateCachedPeriodTag,
}));

import masterDataApp from "../master_data";

const TABLE_NAMES = [
  "mst_ship",
  "mst_shipgraph",
  "mst_slotitem",
  "mst_slotitem_equiptype",
  "mst_payitem",
  "mst_equip_exslot",
  "mst_equip_exslot_ship",
  "mst_equip_limit_exslot",
  "mst_equip_ship",
  "mst_stype",
  "mst_map_area",
  "mst_map_info",
  "mst_ship_upgrade",
];

function createDatabaseMock() {
  const preparedSql: string[] = [];
  const batch = vi.fn(async (statements: Array<{ sql?: string }>) => {
    if (batch.mock.calls.length > 1) {
      const hasIdempotentChildInsert = statements
        .slice(0, -1)
        .every((statement) => {
          const sql = statement.sql ?? "";
          const valuesIndex = sql.indexOf("VALUES");
          const conflictIndex = sql.indexOf(
            "ON CONFLICT(master_data_id, table_name) DO NOTHING",
          );
          return valuesIndex >= 0 && conflictIndex > valuesIndex;
        });
      if (!hasIdempotentChildInsert) {
        throw new Error("duplicate master_data_tables row");
      }
    }
    return [];
  });

  const db = {
    prepare: vi.fn((sql: string) => {
      preparedSql.push(sql);
      const statement = {
        sql,
        bind: vi.fn(() => statement),
        first: vi.fn(async () => null),
        run: vi.fn(async () => ({ success: true })),
      };
      return statement;
    }),
    batch,
    preparedSql,
  };
  return db as unknown as D1Database & {
    batch: typeof batch;
    preparedSql: string[];
  };
}

function createBucketMock() {
  return {
    delete: vi.fn(async () => undefined),
    put: vi.fn(async () => ({ etag: "etag" })),
  } as unknown as R2BucketBinding & {
    delete: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
  };
}

function createEnv(db: D1Database, bucket: R2BucketBinding): Bindings {
  return {
    MASTER_DATA_BUCKET: bucket,
    MASTER_DATA_INDEX_DB: db,
    MASTER_DATA_SIGNING_SECRET: "master-data-signing-secret",
    DATASET_TOKEN_SECRET: "dataset-token-secret",
  } as unknown as Bindings;
}

function createPreparationBody(overrides: Record<string, unknown> = {}) {
  return {
    kc_period_tag: "2026-08-14",
    table_version: "1.0",
    content_hash: "a".repeat(64),
    file_size: 1,
    table_offsets: JSON.stringify([
      { table_name: "mst_ship", start: 0, end: 1 },
    ]),
    ...overrides,
  };
}

function createBatchData() {
  const data = new Uint8Array(TABLE_NAMES.length);
  const offsets: Array<{ table_name: string; start: number; end: number }> = [];
  TABLE_NAMES.forEach((table_name, index) => {
    offsets.push({ table_name, start: index, end: index + 1 });
  });
  return { data, offsets };
}

function createTokenPayload(contentHash: string, declaredSize: number) {
  return {
    user_id: "canonical-user",
    record_id: 1,
    period_tag: "2026-08-14",
    table_version: "1.0",
    period_revision: 1,
    content_hash: contentHash,
    table_offsets: JSON.stringify(
      TABLE_NAMES.map((table_name, index) => ({
        table_name,
        start: index,
        end: index + 1,
      })),
    ),
    table_count: TABLE_NAMES.length,
    declared_size: declaredSize,
  };
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

describe("master-data upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecodeAvroOcfToJson.mockReturnValue([{ id: 1 }]);
    mockVerifySignedToken.mockReset();
  });

  it("rejects zero-size preparation requests", async () => {
    const response = await masterDataApp.request(
      "https://example.test/upload",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dataset-Token": "dataset-token",
        },
        body: JSON.stringify(createPreparationBody({ file_size: 0 })),
      },
      createEnv(createDatabaseMock(), createBucketMock()),
    );

    expect(response.status).toBe(400);
  });

  it("rejects zero-length table ranges during preparation", async () => {
    const response = await masterDataApp.request(
      "https://example.test/upload",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Dataset-Token": "dataset-token",
        },
        body: JSON.stringify(
          createPreparationBody({
            table_offsets: JSON.stringify([
              { table_name: "mst_ship", start: 0, end: 0 },
            ]),
          }),
        ),
      },
      createEnv(createDatabaseMock(), createBucketMock()),
    );

    expect(response.status).toBe(400);
  });

  it("does not complete the D1 record when Avro decoding fails", async () => {
    const db = createDatabaseMock();
    const bucket = createBucketMock();
    const { data } = createBatchData();
    const contentHash = await sha256Hex(data);
    mockVerifySignedToken.mockResolvedValue(
      createTokenPayload(contentHash, data.byteLength),
    );
    mockDecodeAvroOcfToJson.mockImplementationOnce(() => {
      throw new Error("malformed avro");
    });

    const response = await masterDataApp.request(
      "https://example.test/upload",
      {
        method: "POST",
        headers: { "X-Upload-Token": "signed-upload-token" },
        body: data,
      },
      createEnv(db, bucket),
    );

    expect(response.status).toBe(500);
    expect(bucket.put).not.toHaveBeenCalled();
    expect(db.batch).not.toHaveBeenCalled();
    const failedUpdates = db.preparedSql.filter((sql) =>
      sql.includes("upload_status = 'failed'"),
    );
    expect(failedUpdates.length).toBeGreaterThan(0);
    expect(
      failedUpdates.every((sql) => sql.includes("upload_status = 'pending'")),
    ).toBe(true);
  });

  it("keeps repeated execution of the same token idempotent", async () => {
    const db = createDatabaseMock();
    const bucket = createBucketMock();
    const { data } = createBatchData();
    const contentHash = await sha256Hex(data);
    mockVerifySignedToken.mockResolvedValue(
      createTokenPayload(contentHash, data.byteLength),
    );

    const request = () =>
      masterDataApp.request(
        "https://example.test/upload",
        {
          method: "POST",
          headers: { "X-Upload-Token": "signed-upload-token" },
          body: data,
        },
        createEnv(db, bucket),
      );

    const firstResponse = await request();
    const secondResponse = await request();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(db.batch).toHaveBeenCalledTimes(2);
    expect(bucket.put).toHaveBeenCalledTimes(TABLE_NAMES.length * 2);
  });
});