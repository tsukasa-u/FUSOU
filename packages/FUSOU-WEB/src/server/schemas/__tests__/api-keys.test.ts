import { describe, expect, it } from "vitest";
import { ApiKeyListRowsSchema, UpdateApiKeyRequestSchema } from "../api-keys";

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