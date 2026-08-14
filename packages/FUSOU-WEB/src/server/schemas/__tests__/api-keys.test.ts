import { describe, expect, it } from "vitest";
import { UpdateApiKeyRequestSchema } from "../api-keys";

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