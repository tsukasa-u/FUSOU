import { describe, expect, it } from "vitest";
import {
  AuthConfigDiagnosticsSchema,
  AuthSettingsDiagnosticsSchema,
  UserIdentityAnchorRowSchema,
  UserMemberMapRowSchema,
  UserDeviceInsertRowSchema,
  UserDeviceLookupRowSchema,
  UserDeviceListRowSchema,
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

  it("normalizes legacy member map rows without recovery fields", () => {
    const result = UserMemberMapRowSchema.safeParse({
      user_id: "user-1",
      member_id_hash: "pid-1",
      salt_version: null,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recovery_id_hash).toBeNull();
      expect(result.data.recovery_version).toBeNull();
    }
  });

  it("rejects member map rows with invalid required fields", () => {
    expect(
      UserMemberMapRowSchema.safeParse({
        user_id: 42,
        member_id_hash: "pid-1",
        salt_version: null,
      }).success,
    ).toBe(false);
  });

  it("accepts identity anchor rows with nullable recovery version", () => {
    expect(
      UserIdentityAnchorRowSchema.safeParse({
        canonical_user_id: "user-1",
        recovery_id_hash: "rid-1",
        recovery_version: null,
      }).success,
    ).toBe(true);
  });

  it("rejects identity anchor rows without a canonical user", () => {
    expect(
      UserIdentityAnchorRowSchema.safeParse({
        recovery_id_hash: "rid-1",
        recovery_version: null,
      }).success,
    ).toBe(false);
  });

  it("accepts device lookup rows with nullable revocation state", () => {
    expect(
      UserDeviceLookupRowSchema.safeParse({
        device_id: "device-1",
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
        device_id: "device-1",
        pid: "pid-1",
        created_at: "2026-08-14T00:00:00Z",
        last_seen_at: null,
        revoked_at: null,
        revoked_reason: null,
      }).success,
    ).toBe(true);
  });

  it("rejects device list rows without a pid", () => {
    expect(
      UserDeviceListRowSchema.safeParse({
        device_id: "device-1",
        created_at: "2026-08-14T00:00:00Z",
        last_seen_at: null,
        revoked_at: null,
        revoked_reason: null,
      }).success,
    ).toBe(false);
  });
});
