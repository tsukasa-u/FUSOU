import { describe, expect, it } from "vitest";
import {
  ApiKeyCreateRowsSchema,
  ApiKeyIdRowsSchema,
  ApiKeyListRowsSchema,
  TrustedDeviceListRowsSchema,
  UpdateApiKeyRequestSchema,
} from "../api-keys";

describe("UpdateApiKeyRequestSchema", () => {
  it("accepts a boolean is_active value", () => {
    expect(
      UpdateApiKeyRequestSchema.safeParse({ is_active: true }).success,
    ).toBe(true);
  });

  it("accepts an empty update object for route-level validation", () => {
    expect(UpdateApiKeyRequestSchema.safeParse({}).success).toBe(true);
  });

  it("rejects non-boolean values and non-objects", () => {
    expect(
      UpdateApiKeyRequestSchema.safeParse({ is_active: "true" }).success,
    ).toBe(false);
    expect(UpdateApiKeyRequestSchema.safeParse(null).success).toBe(false);
  });
});

describe("ApiKeyListRowsSchema", () => {
  it("accepts complete API key rows and extra fields", () => {
    expect(
      ApiKeyListRowsSchema.safeParse([
        {
          id: "key-1",
          key: "secret-key",
          email: "user@example.test",
          is_active: true,
          created_at: "2026-08-14T00:00:00Z",
          updated_at: "2026-08-14T00:00:00Z",
          extra: "ignored",
        },
      ]).success,
    ).toBe(true);
  });

  it("rejects rows with a non-boolean active flag", () => {
    expect(
      ApiKeyListRowsSchema.safeParse([
        {
          id: "key-1",
          key: "secret-key",
          email: "user@example.test",
          is_active: "true",
          created_at: "2026-08-14T00:00:00Z",
          updated_at: "2026-08-14T00:00:00Z",
        },
      ]).success,
    ).toBe(false);
  });
});

describe("ApiKeyCreateRowsSchema", () => {
  it("accepts created API key rows and extra fields", () => {
    expect(
      ApiKeyCreateRowsSchema.safeParse([
        {
          id: "key-1",
          key: "secret-key",
          created_at: "2026-08-14T00:00:00Z",
        },
      ]).success,
    ).toBe(true);
  });

  it("rejects missing fields and non-array responses", () => {
    expect(
      ApiKeyCreateRowsSchema.safeParse([{ id: "key-1" }]).success,
    ).toBe(false);
    expect(
      ApiKeyCreateRowsSchema.safeParse({ id: "key-1", key: "secret-key" })
        .success,
    ).toBe(false);
  });
});

describe("ApiKeyIdRowsSchema", () => {
  it("accepts id rows and extra fields", () => {
    expect(
      ApiKeyIdRowsSchema.safeParse([
        { id: "key-1", created_at: "2026-08-14T00:00:00Z" },
      ]).success,
    ).toBe(true);
  });

  it("rejects missing ids and non-array responses", () => {
    expect(ApiKeyIdRowsSchema.safeParse([{ id: "" }]).success).toBe(false);
    expect(ApiKeyIdRowsSchema.safeParse([{ id: 42 }]).success).toBe(false);
    expect(ApiKeyIdRowsSchema.safeParse(null).success).toBe(false);
  });
});

describe("TrustedDeviceListRowsSchema", () => {
  it("accepts nullable device fields and extra fields", () => {
    expect(
      TrustedDeviceListRowsSchema.safeParse([
        {
          id: "device-1",
          client_id: "client-1",
          device_name: null,
          created_at: "2026-08-14T00:00:00Z",
          last_used_at: null,
          extra: "ignored",
        },
      ]).success,
    ).toBe(true);
  });

  it("rejects missing fields and invalid nullable values", () => {
    expect(
      TrustedDeviceListRowsSchema.safeParse([
        {
          id: "device-1",
          client_id: "client-1",
          device_name: 42,
          created_at: "2026-08-14T00:00:00Z",
          last_used_at: null,
        },
      ]).success,
    ).toBe(false);
    expect(TrustedDeviceListRowsSchema.safeParse([{ id: "device-1" }]).success)
      .toBe(false);
  });
});