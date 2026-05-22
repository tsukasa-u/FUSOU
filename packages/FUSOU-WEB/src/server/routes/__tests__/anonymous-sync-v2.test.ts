import { describe, expect, it } from "vitest";
import { assertCsrfSafe } from "../anonymous-sync-v2";

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
