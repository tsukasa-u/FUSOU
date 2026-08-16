import { describe, expect, it } from "vitest";
import {
  ApiKeyValidationRowsSchema,
  ArchivedBlockRowsSchema,
  DataLoaderBlockInfoRowSchema,
  parseArchivedBlockRows,
  MasterDataFileRowsSchema,
  parseMasterDataFileRows,
  parseRateLimitAttempts,
  parseTableNames,
  TableNameRowsSchema,
  TrustedDeviceTrustRowsSchema,
  VerifyDeviceRequestSchema,
  VerifyGoogleRequestSchema,
  VerificationCodeRowsSchema,
} from "../data-loader";

describe("VerifyDeviceRequestSchema", () => {
  it("accepts a verification code", () => {
    expect(
      VerifyDeviceRequestSchema.safeParse({ code: "123456" }).success,
    ).toBe(true);
  });

  it("accepts an omitted code for route-level missing-field handling", () => {
    expect(VerifyDeviceRequestSchema.safeParse({}).success).toBe(true);
  });

  it("rejects a non-string code", () => {
    expect(
      VerifyDeviceRequestSchema.safeParse({ code: 123456 }).success,
    ).toBe(false);
  });
});

describe("VerifyGoogleRequestSchema", () => {
  it("accepts a Google token and ignores the legacy email value", () => {
    expect(
      VerifyGoogleRequestSchema.safeParse({
        email: "legacy@example.com",
        google_token: "token",
      }).success,
    ).toBe(true);
  });

  it("rejects a non-string Google token", () => {
    expect(
      VerifyGoogleRequestSchema.safeParse({ google_token: 123 }).success,
    ).toBe(false);
  });

  it("rejects a non-string legacy email value", () => {
    expect(
      VerifyGoogleRequestSchema.safeParse({ email: 123 }).success,
    ).toBe(false);
  });
});

describe("ApiKeyValidationRowsSchema", () => {
  it("accepts API key lookup rows and extra fields", () => {
    expect(
      ApiKeyValidationRowsSchema.safeParse([
        {
          id: "key-1",
          user_id: "user-1",
          email: "user@example.test",
          extra: true,
        },
      ]).success,
    ).toBe(true);
  });

  it("rejects incomplete or non-array API key responses", () => {
    expect(
      ApiKeyValidationRowsSchema.safeParse([
        { id: "key-1", user_id: "user-1" },
      ]).success,
    ).toBe(false);
    expect(ApiKeyValidationRowsSchema.safeParse(null).success).toBe(false);
  });
});

describe("TrustedDeviceTrustRowsSchema", () => {
  it("accepts trusted device rows and extra fields", () => {
    expect(
      TrustedDeviceTrustRowsSchema.safeParse([
        {
          id: "device-1",
          last_used_at: "2026-08-14T00:00:00Z",
          extra: true,
        },
      ]).success,
    ).toBe(true);
  });

  it("rejects malformed or missing device timestamps", () => {
    expect(
      TrustedDeviceTrustRowsSchema.safeParse([
        { id: "device-1", last_used_at: 123 },
      ]).success,
    ).toBe(false);
    expect(TrustedDeviceTrustRowsSchema.safeParse(null).success).toBe(false);
  });
});

describe("VerificationCodeRowsSchema", () => {
  it("accepts verification code id rows and extra fields", () => {
    expect(
      VerificationCodeRowsSchema.safeParse([
        { id: "verification-1", expires_at: "2026-08-14T00:00:00Z" },
      ]).success,
    ).toBe(true);
  });

  it("rejects missing or invalid verification ids", () => {
    expect(VerificationCodeRowsSchema.safeParse([{ id: "" }]).success).toBe(
      false,
    );
    expect(VerificationCodeRowsSchema.safeParse([{ id: 42 }]).success).toBe(
      false,
    );
    expect(VerificationCodeRowsSchema.safeParse(null).success).toBe(false);
  });
});

describe("TableNameRowsSchema", () => {
  it("accepts table rows and preserves extra fields", () => {
    const result = TableNameRowsSchema.safeParse([
      { table_name: "battles", extra: true },
    ]);

    expect(result.success).toBe(true);
  if (result.success) expect(result.data[0]?.["extra"]).toBe(true);
  });

  it("rejects malformed rows and returns no table names", () => {
    expect(TableNameRowsSchema.safeParse([{ table_name: 123 }]).success).toBe(
      false,
    );
    expect(parseTableNames([{ table_name: 123 }])).toEqual([]);
    expect(parseTableNames(null)).toEqual([]);
  });
});

describe("parseRateLimitAttempts", () => {
  it("accepts finite timestamp arrays", () => {
    expect(parseRateLimitAttempts("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("recovers from malformed or non-numeric KV values", () => {
    expect(parseRateLimitAttempts("not-json")).toEqual([]);
    expect(parseRateLimitAttempts('{"attempts":[]}')).toEqual([]);
    expect(parseRateLimitAttempts("[1, null, \"2\"]")).toEqual([]);
  });
});

describe("MasterDataFileRowsSchema", () => {
  it("accepts nullable master-data metadata", () => {
    const result = MasterDataFileRowsSchema.safeParse([
      {
        id: 1,
        period_tag: "2026-07-08",
        table_version: "0.5",
        period_revision: 2,
        table_name: "mst_ship",
        r2_key: null,
        completed_at: null,
      },
    ]);

    expect(result.success).toBe(true);
  });

  it("rejects malformed rows instead of exposing partial file metadata", () => {
    expect(
      parseMasterDataFileRows([
        {
          id: 1,
          period_tag: "2026-07-08",
          table_version: "0.5",
          period_revision: "2",
          table_name: "mst_ship",
          r2_key: null,
          completed_at: null,
        },
      ]),
    ).toBeNull();
  });
});

describe("ArchivedBlockRowsSchema", () => {
  it("accepts archive rows with nullable time windows", () => {
    const result = ArchivedBlockRowsSchema.safeParse([
      {
        id: 1,
        dataset_id: "dataset-1",
        table_name: "battle",
        table_version: "v1",
        compaction_tier: "hourly",
        size: 100,
        record_count: 10,
        start_timestamp: 1,
        end_timestamp: 2,
        window_start_ms: null,
        window_end_ms: null,
        period_tag: "2026-07-08",
        start_byte: 0,
        file_path: "archive/file.avro",
      },
    ]);

    expect(result.success).toBe(true);
  });

  it("drops malformed archive responses", () => {
    expect(
      parseArchivedBlockRows([{ id: 1, file_path: "archive/file.avro" }]),
    ).toEqual([]);
  });
});

describe("DataLoaderBlockInfoRowSchema", () => {
  it("accepts block metadata used for range downloads", () => {
    expect(
      DataLoaderBlockInfoRowSchema.safeParse({
        id: 1,
        start_byte: 0,
        length: 100,
        dataset_id: "dataset-1",
        file_path: "archive/file.avro",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed block metadata", () => {
    expect(
      DataLoaderBlockInfoRowSchema.safeParse({
        id: 1,
        start_byte: "0",
        length: 100,
        dataset_id: "dataset-1",
        file_path: "archive/file.avro",
      }).success,
    ).toBe(false);
    expect(DataLoaderBlockInfoRowSchema.safeParse(null).success).toBe(false);
  });
});