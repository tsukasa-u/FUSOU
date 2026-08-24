import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings, D1Database } from "../../types";

const {
  mockGenerateSignedToken,
  mockGetLatestMasterPeriodTag,
  mockValidateCachedPeriodTag,
  mockValidateDatasetTokenWithConstraints,
  mockVerifySignedToken,
} = vi.hoisted(() => ({
  mockGenerateSignedToken: vi.fn(async () => "signed-upload-token"),
  mockGetLatestMasterPeriodTag: vi.fn(async () => ({
    period_tag: "2026-08-09",
    table_version: "0.5.1",
  })),
  mockValidateCachedPeriodTag: vi.fn(async () => ({ ok: true })),
  mockValidateDatasetTokenWithConstraints: vi.fn(),
  mockVerifySignedToken: vi.fn(),
}));

vi.mock("../../utils", () => ({
  createEnvContext: (context: { env: Record<string, unknown> }) => ({
    runtime: context.env,
  }),
  generateSignedToken: mockGenerateSignedToken,
  getEnv: (context: { runtime: Record<string, unknown> }, key: string) =>
    context.runtime[key],
  parseStrictBoolean: (value: unknown) => value === true || value === "true",
  resolveDatasetToken: (headerToken: string | undefined, bodyToken: unknown) =>
    headerToken || (typeof bodyToken === "string" ? bodyToken : ""),
  resolveDatasetTokenRevocationConfig: vi.fn(() => ({})),
  timingSafeEqual: (left: string, right: string) => left === right,
  validateDatasetTokenSecret: vi.fn(() => ({ ok: true })),
  validateDatasetTokenWithConstraints: mockValidateDatasetTokenWithConstraints,
  validateTokenPayloadWithSchema: (payload: unknown) => ({
    valid: true,
    data: payload,
  }),
  verifySignedToken: mockVerifySignedToken,
  safeWaitUntil: vi.fn(),
}));

vi.mock("../../utils/period-tags", () => ({
  getLatestMasterPeriodTag: mockGetLatestMasterPeriodTag,
  isValidPeriodTagDate: (value: string) => value === "2026-08-09",
  validateCachedPeriodTag: mockValidateCachedPeriodTag,
}));

import sokuSpeedApp from "../soku_speed_observed";

const DATASET_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_DATASET_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "soku-speed-request-1";
const PERIOD_TAG = "2026-08-09";
const TABLE_VERSION = "0.5.1";
const PAYLOAD_HASH = "a".repeat(64);
const DATASET_TOKEN = "dataset-token";

function createDatabaseMock(): D1Database {
  const statement = {
    bind: vi.fn(function () {
      return statement;
    }),
    all: vi.fn(async () => ({ results: [] })),
  };
  return {
    prepare: vi.fn(() => statement),
    batch: vi.fn(async () => []),
  } as unknown as D1Database;
}

function createEnv(): Bindings {
  return {
    SOKU_SPEED_OBSERVED_DB: createDatabaseMock(),
    MASTER_DATA_INDEX_DB: createDatabaseMock(),
    SOKU_SPEED_COLLECTION_ENABLED: "true",
    SOKU_SPEED_SIGNING_SECRET: "soku-speed-signing-secret",
    DATASET_TOKEN_SECRET: "dataset-token-secret",
  } as unknown as Bindings;
}

function createBody(datasetId = DATASET_ID) {
  return {
    dataset_id: datasetId,
    dataset_token: DATASET_TOKEN,
    request_id: REQUEST_ID,
    payload_hash: PAYLOAD_HASH,
    event_type: "snapshot",
    timestamp_ms: 1,
    period_tag: PERIOD_TAG,
    table_version: TABLE_VERSION,
    ships: [
      {
        master_id: 1,
        lv: 1,
        soku_observed: 5,
        slots: [
          { slotitem_id: 1, locked: true, level: 0, alv: 0 },
        ],
        exslot: null,
      },
    ],
  };
}

function createTokenPayload(contentHash: string, declaredSize: number) {
  return {
    user_id: "canonical-user",
    content_hash: contentHash,
    declared_size: declaredSize,
    dataset_id: DATASET_ID,
    request_id: REQUEST_ID,
    period_tag: PERIOD_TAG,
    table_version: TABLE_VERSION,
  };
}

describe("soku-speed ingest authentication and integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateDatasetTokenWithConstraints.mockImplementation(
      async ({ expectedDatasetId }: { expectedDatasetId?: string }) => {
        if (expectedDatasetId !== DATASET_ID) {
          return { ok: false, error: "dataset_id mismatch", status: 403 };
        }
        return {
          ok: true,
          token: {
            dataset_id: DATASET_ID,
            user_id: "canonical-user",
            device_id: "33333333-3333-4333-8333-333333333333",
          },
        };
      },
    );
  });

  it("accepts Stage 1 without a JWT when the dataset token matches", async () => {
    const body = createBody();
    const response = await sokuSpeedApp.request(
      "https://example.test/ingest",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          content_hash: "b".repeat(64),
          file_size: 128,
        }),
      },
      createEnv(),
    );

    expect(response.status).toBe(200);
    expect(mockValidateDatasetTokenWithConstraints).toHaveBeenCalledWith(
      expect.objectContaining({ expectedDatasetId: DATASET_ID }),
    );
    await expect(response.json()).resolves.toMatchObject({
      token: "signed-upload-token",
    });
  });

  it("rejects Stage 1 when the dataset token is for another dataset", async () => {
    const response = await sokuSpeedApp.request(
      "https://example.test/ingest",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...createBody(OTHER_DATASET_ID),
          content_hash: "b".repeat(64),
          file_size: 128,
        }),
      },
      createEnv(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "dataset_id mismatch",
    });
  });

  it("accepts Stage 2 without a JWT after verifying the signed upload token", async () => {
    const data = new TextEncoder().encode(JSON.stringify(createBody()));
    const contentHash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
    )
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    mockVerifySignedToken.mockResolvedValue(
      createTokenPayload(contentHash, data.byteLength),
    );

    const response = await sokuSpeedApp.request(
      "https://example.test/ingest",
      {
        method: "POST",
        headers: {
          "X-Upload-Token": "signed-upload-token",
          "content-hash": contentHash,
        },
        body: data,
      },
      createEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      ingested: 1,
    });
  });

  it("rejects Stage 2 when the body hash differs from the signed token", async () => {
    const data = new TextEncoder().encode(JSON.stringify(createBody()));
    mockVerifySignedToken.mockResolvedValue(
      createTokenPayload("c".repeat(64), data.byteLength),
    );

    const response = await sokuSpeedApp.request(
      "https://example.test/ingest",
      {
        method: "POST",
        headers: { "X-Upload-Token": "signed-upload-token" },
        body: data,
      },
      createEnv(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "content-hash mismatch",
    });
  });
});