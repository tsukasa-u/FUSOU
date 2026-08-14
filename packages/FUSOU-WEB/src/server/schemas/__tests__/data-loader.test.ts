import { describe, expect, it } from "vitest";
import {
  parseTableNames,
  TableNameRowsSchema,
  VerifyDeviceRequestSchema,
  VerifyGoogleRequestSchema,
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
});

describe("TableNameRowsSchema", () => {
  it("accepts table rows and preserves extra fields", () => {
    const result = TableNameRowsSchema.safeParse([
      { table_name: "battles", extra: true },
    ]);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data[0]?.extra).toBe(true);
  });

  it("rejects malformed rows and returns no table names", () => {
    expect(TableNameRowsSchema.safeParse([{ table_name: 123 }]).success).toBe(
      false,
    );
    expect(parseTableNames([{ table_name: 123 }])).toEqual([]);
    expect(parseTableNames(null)).toEqual([]);
  });
});