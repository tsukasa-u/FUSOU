import { describe, expect, it } from "vitest";
import {
  assertCsrfSafe,
  isSupabaseUserNotFoundError,
} from "../anonymous-sync-v2";

describe("assertCsrfSafe", () => {
  it("should allow requests with valid origin", () => {
    const mockRequest = {
      header: (name: string) => {
        if (name === "Origin") return "https://valid-origin.com";
        return undefined;
      },
    };
    const mockEnv = { PUBLIC_SITE_URL: "https://valid-origin.com" };
    const result = assertCsrfSafe({ req: mockRequest, env: mockEnv }, true);
    expect(result).toBe(true);
  });

  it("should reject requests with invalid origin", () => {
    const mockRequest = {
      header: (name: string) => {
        if (name === "Origin") return "https://invalid-origin.com";
        return undefined;
      },
    };
    const mockEnv = { PUBLIC_SITE_URL: "https://valid-origin.com" };
    const result = assertCsrfSafe({ req: mockRequest, env: mockEnv }, true);
    expect(result).toBe(false);
  });

  it("should allow requests without cookie-based auth", () => {
    const mockRequest = {
      header: () => undefined,
    };
    const mockEnv = {};
    const result = assertCsrfSafe({ req: mockRequest, env: mockEnv }, false);
    expect(result).toBe(true);
  });
});

describe("isSupabaseUserNotFoundError", () => {
  it("returns true for 404 status", () => {
    expect(isSupabaseUserNotFoundError({ status: 404 })).toBe(true);
  });

  it("returns true for known not found codes", () => {
    expect(isSupabaseUserNotFoundError({ code: "user_not_found" })).toBe(true);
    expect(isSupabaseUserNotFoundError({ code: "not_found" })).toBe(true);
  });

  it("returns false for transient errors", () => {
    expect(
      isSupabaseUserNotFoundError({
        status: 500,
        code: "internal_error",
        message: "temporary outage",
      }),
    ).toBe(false);
  });
});
