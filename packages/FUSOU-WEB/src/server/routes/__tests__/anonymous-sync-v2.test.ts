import { describe, expect, it } from "vitest";
import {
  assertCsrfSafe,
  isSupabaseUserNotFoundError,
  readRequestBodyWithinLimit,
} from "../anonymous-sync-v2";
import { validateDatasetTokenWithConstraints } from "../../utils";

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

describe("readRequestBodyWithinLimit", () => {
  it("rejects oversized chunked bodies without Content-Length", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(64 * 1024));
          controller.enqueue(new Uint8Array(1));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);

    await expect(readRequestBodyWithinLimit(request)).resolves.toEqual({
      kind: "too_large",
    });
  });
});

describe("validateDatasetTokenWithConstraints", () => {
  it("rejects an invalid signed token without contacting the revocation store", async () => {
    await expect(
      validateDatasetTokenWithConstraints({
        token: "token-not-used",
        secret: "secret-not-used",
        revocation: null,
      }),
    ).resolves.toEqual({
      ok: false,
      status: 401,
      error: "Invalid or expired dataset_token",
    });
  });
});
