import { describe, expect, it } from "vitest";
import {
  assertCsrfSafe,
  decideRefreshAttestationPolicy,
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

describe("decideRefreshAttestationPolicy", () => {
  it("rejects malformed attestation reports", () => {
    const result = decideRefreshAttestationPolicy({
      parsedAttestationMalformed: true,
      hasAttestationReport: true,
      trustInput: null,
    });

    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.status).toBe(400);
      expect(result.error).toBe("attestation_report_malformed");
    }
  });

  it("allows no-attestation refresh with unverified trust", () => {
    const result = decideRefreshAttestationPolicy({
      parsedAttestationMalformed: false,
      hasAttestationReport: false,
      trustInput: null,
    });

    expect(result.allow).toBe(true);
    if (result.allow) {
      expect(result.trustTag).toBe("unverified");
    }
  });

  it("rejects structurally invalid attestation payload", () => {
    const result = decideRefreshAttestationPolicy({
      parsedAttestationMalformed: false,
      hasAttestationReport: true,
      trustInput: {
        attestation_level: "software_fingerprint",
        attestation_valid: false,
        schema_fingerprint_valid: false,
        environment_flags: {
          emulator_detected: false,
          debugger_detected: false,
          hook_detected: false,
        },
      },
    });

    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.status).toBe(400);
      expect(result.error).toBe("attestation_report_invalid");
    }
  });

  it("rejects hardware attestation verification failures", () => {
    const result = decideRefreshAttestationPolicy({
      parsedAttestationMalformed: false,
      hasAttestationReport: true,
      trustInput: {
        attestation_level: "tpm",
        attestation_valid: false,
        schema_fingerprint_valid: true,
        environment_flags: {
          emulator_detected: false,
          debugger_detected: false,
          hook_detected: false,
        },
      },
    });

    expect(result.allow).toBe(false);
    if (!result.allow) {
      expect(result.status).toBe(401);
      expect(result.error).toBe("attestation_verification_failed");
    }
  });

  it("allows valid software attestation when hardware is not required", () => {
    const result = decideRefreshAttestationPolicy({
      parsedAttestationMalformed: false,
      hasAttestationReport: true,
      trustInput: {
        attestation_level: "software_fingerprint",
        attestation_valid: true,
        schema_fingerprint_valid: true,
        environment_flags: {
          emulator_detected: false,
          debugger_detected: false,
          hook_detected: false,
        },
      },
    });

    expect(result.allow).toBe(true);
    if (result.allow) {
      expect(result.trustTag).toBe("sw_verified");
    }
  });

  it("allows valid hardware attestation with hw_verified trust", () => {
    const result = decideRefreshAttestationPolicy({
      parsedAttestationMalformed: false,
      hasAttestationReport: true,
      trustInput: {
        attestation_level: "tpm",
        attestation_valid: true,
        schema_fingerprint_valid: true,
        environment_flags: {
          emulator_detected: false,
          debugger_detected: false,
          hook_detected: false,
        },
      },
    });

    expect(result.allow).toBe(true);
    if (result.allow) {
      expect(result.trustTag).toBe("hw_verified");
    }
  });
});
