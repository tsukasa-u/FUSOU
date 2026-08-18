import { describe, expect, it } from "vitest";
import { GoogleTokenResponseSchema } from "../auth";

describe("GoogleTokenResponseSchema", () => {
  it("accepts a valid token response and extra fields", () => {
    const result = GoogleTokenResponseSchema.safeParse({
      access_token: "access-token",
      expires_in: 3600,
      refresh_token: "refresh-token",
      token_type: "Bearer",
    });

    expect(result.success).toBe(true);
  });

  it("rejects missing or malformed token fields", () => {
    expect(
      GoogleTokenResponseSchema.safeParse({
        access_token: "access-token",
        expires_in: "3600",
      }).success,
    ).toBe(false);
    expect(
      GoogleTokenResponseSchema.safeParse({
        access_token: "",
        expires_in: 3600,
      }).success,
    ).toBe(false);
    expect(GoogleTokenResponseSchema.safeParse(null).success).toBe(false);
  });
});