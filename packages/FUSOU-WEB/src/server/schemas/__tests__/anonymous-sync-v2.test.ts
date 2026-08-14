import { describe, expect, it } from "vitest";
import {
  AuthConfigDiagnosticsSchema,
  AuthSettingsDiagnosticsSchema,
} from "../anonymous-sync-v2";

describe("anonymous-sync diagnostics schemas", () => {
  it("accepts auth config rows and preserves extra fields", () => {
    const result = AuthConfigDiagnosticsSchema.safeParse({
      enable_anonymous_sign_ins: true,
      external_url: "https://example.test",
      extra: "preserved",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.extra).toBe("preserved");
  });

  it("rejects malformed auth config rows", () => {
    expect(
      AuthConfigDiagnosticsSchema.safeParse({
        enable_anonymous_sign_ins: "true",
      }).success,
    ).toBe(false);
  });

  it("accepts only object-shaped GoTrue settings", () => {
    expect(
      AuthSettingsDiagnosticsSchema.safeParse({
        external: { google: true },
      }).success,
    ).toBe(true);
    expect(AuthSettingsDiagnosticsSchema.safeParse([]).success).toBe(false);
  });
});
