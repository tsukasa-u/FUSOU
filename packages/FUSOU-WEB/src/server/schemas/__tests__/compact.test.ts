import { describe, expect, it } from "vitest";
import { SanitizeStateRequestSchema } from "../compact";

describe("SanitizeStateRequestSchema", () => {
  it("accepts a string dataset id", () => {
    expect(
      SanitizeStateRequestSchema.safeParse({ datasetId: "dataset-1" }).success,
    ).toBe(true);
  });

  it("accepts an omitted dataset id for route-level required-field handling", () => {
    expect(SanitizeStateRequestSchema.safeParse({}).success).toBe(true);
  });

  it("rejects non-string dataset ids", () => {
    expect(
      SanitizeStateRequestSchema.safeParse({ datasetId: 123 }).success,
    ).toBe(false);
  });
});