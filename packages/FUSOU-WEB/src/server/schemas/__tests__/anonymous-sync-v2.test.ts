import { describe, expect, it } from "vitest";
import {
  AuthConfigDiagnosticsSchema,
  AuthSettingsDiagnosticsSchema,
  RegisterRequestSchema,
  UserMemberMapRowSchema,
  UserDeviceInsertRowSchema,
  UserDeviceLookupRowSchema,
  UserDeviceListRowSchema,
  UserDeviceRefreshRowSchema,
  UserDeviceRevokeTargetRowSchema,
  SupabaseAccessTokenUserSchema,
} from "../anonymous-sync-v2";

describe("SupabaseAccessTokenUserSchema", () => {
  it("accepts a user id with optional email values", () => {
    expect(
      SupabaseAccessTokenUserSchema.safeParse({
        id: "user-1",
        email: null,
        role: "authenticated",
      }).success,
    ).toBe(true);
    expect(
      SupabaseAccessTokenUserSchema.safeParse({ id: "user-1" }).success,
    ).toBe(true);
  });

  it("rejects missing, empty, and non-string user ids", () => {
    expect(SupabaseAccessTokenUserSchema.safeParse({}).success).toBe(false);
    expect(
      SupabaseAccessTokenUserSchema.safeParse({ id: "" }).success,
    ).toBe(false);
    expect(
      SupabaseAccessTokenUserSchema.safeParse({ id: 1 }).success,
    ).toBe(false);
  });
});

describe("anonymous-sync registration schema", () => {
  it("accepts registration without an attestation proof", () => {
    expect(
      RegisterRequestSchema.safeParse({
        api_member_id: "12345",
        device_pub: "base64-public-key",
      }).success,
    ).toBe(true);
  });

  it("rejects numeric member ids to avoid precision-changing coercion", () => {
    expect(
      RegisterRequestSchema.safeParse({
        api_member_id: 12345,
        device_pub: "base64-public-key",
      }).success,
    ).toBe(false);
  });

  it("rejects the removed attestation field", () => {
    expect(
      RegisterRequestSchema.safeParse({
        api_member_id: "12345",
        device_pub: "base64-public-key",
        attestation: "legacy-proof",
      }).success,
    ).toBe(false);
  });

  it("accepts the proof-of-possession fields for server-reset recovery", () => {
    expect(
      RegisterRequestSchema.safeParse({
        api_member_id: "12345",
        device_pub: "base64-public-key",
        recovery: {
          device_id: "550e8400-e29b-41d4-a716-446655440000",
          nonce: "a".repeat(64),
          sig: "base64-signature",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects unknown fields inside the recovery proof", () => {
    expect(
      RegisterRequestSchema.safeParse({
        api_member_id: "12345",
        device_pub: "base64-public-key",
        recovery: {
          device_id: "550e8400-e29b-41d4-a716-446655440000",
          nonce: "a".repeat(64),
          sig: "base64-signature",
          extra: "rejected",
        },
      }).success,
    ).toBe(false);
  });
});

describe("anonymous-sync diagnostics schemas", () => {
  it("accepts auth config rows and preserves extra fields", () => {
    const result = AuthConfigDiagnosticsSchema.safeParse({
      enable_anonymous_sign_ins: true,
      external_url: "https://example.test",
      extra: "preserved",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data["extra"]).toBe("preserved");
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

  it("accepts UUID v4 member map rows", () => {
    const result = UserMemberMapRowSchema.safeParse({
      user_id: "user-1",
      public_id: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(result.success).toBe(true);
  });

  it("rejects member map rows with invalid required fields", () => {
    expect(
      UserMemberMapRowSchema.safeParse({
        user_id: 42,
        public_id: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("accepts device lookup rows with nullable revocation state", () => {
    expect(
      UserDeviceLookupRowSchema.safeParse({
        device_id: "550e8400-e29b-41d4-a716-446655440000",
        revoked_at: null,
      }).success,
    ).toBe(true);
  });

  it("rejects device insert rows without a device id", () => {
    expect(UserDeviceInsertRowSchema.safeParse({}).success).toBe(false);
  });

  it("accepts device list rows with nullable activity fields", () => {
    expect(
      UserDeviceListRowSchema.safeParse({
        device_id: "550e8400-e29b-41d4-a716-446655440000",
        public_id: "650e8400-e29b-41d4-a716-446655440000",
        created_at: "2026-08-14T00:00:00Z",
        last_seen_at: null,
        revoked_at: null,
        revoked_reason: null,
      }).success,
    ).toBe(true);
  });

  it("rejects device list rows without a public_id", () => {
    expect(
      UserDeviceListRowSchema.safeParse({
        device_id: "550e8400-e29b-41d4-a716-446655440000",
        created_at: "2026-08-14T00:00:00Z",
        last_seen_at: null,
        revoked_at: null,
        revoked_reason: null,
      }).success,
    ).toBe(false);
  });

  it("accepts refresh rows with a bytea public key", () => {
    expect(
      UserDeviceRefreshRowSchema.safeParse({
        canonical_user_id: "user-1",
        public_id: "550e8400-e29b-41d4-a716-446655440000",
        device_pubkey: "\\xabcdef",
        revoked_at: null,
      }).success,
    ).toBe(true);
  });

  it("rejects refresh rows without a public key", () => {
    expect(
      UserDeviceRefreshRowSchema.safeParse({
        canonical_user_id: "user-1",
        public_id: "550e8400-e29b-41d4-a716-446655440000",
        revoked_at: null,
      }).success,
    ).toBe(false);
  });

  it("accepts revoke target rows for ownership checks", () => {
    expect(
      UserDeviceRevokeTargetRowSchema.safeParse({
        canonical_user_id: "user-1",
        revoked_at: null,
      }).success,
    ).toBe(true);
  });

  it("rejects revoke target rows without an owner", () => {
    expect(
      UserDeviceRevokeTargetRowSchema.safeParse({ revoked_at: null }).success,
    ).toBe(false);
  });
});
