import { z } from "zod";

const ApiMemberIdSchema = z.union([
  z.number().int().positive(),
  z.string().regex(/^\d+$/),
]);

const NonEmptyStringSchema = z.string().min(1);

export const UserMemberMapRowSchema = z
  .object({
    user_id: NonEmptyStringSchema,
    member_id_hash: NonEmptyStringSchema,
    salt_version: z.string().nullable().default(null),
    recovery_id_hash: z.string().nullable().default(null),
    recovery_version: z.string().nullable().default(null),
  })
  .passthrough();

export type UserMemberMapRow = z.infer<typeof UserMemberMapRowSchema>;

export const UserIdentityAnchorRowSchema = z
  .object({
    canonical_user_id: NonEmptyStringSchema,
    recovery_id_hash: NonEmptyStringSchema,
    recovery_version: z.string().nullable(),
  })
  .passthrough();

export type UserIdentityAnchorRow = z.infer<
  typeof UserIdentityAnchorRowSchema
>;

export const UserDeviceLookupRowSchema = z
  .object({
    device_id: NonEmptyStringSchema,
    revoked_at: z.string().nullable(),
  })
  .passthrough();

export const UserDeviceInsertRowSchema = z
  .object({ device_id: NonEmptyStringSchema })
  .passthrough();

export type UserDeviceLookupRow = z.infer<typeof UserDeviceLookupRowSchema>;

export const UserDeviceListRowSchema = z
  .object({
    device_id: NonEmptyStringSchema,
    pid: NonEmptyStringSchema,
    created_at: NonEmptyStringSchema,
    last_seen_at: z.string().nullable(),
    revoked_at: z.string().nullable(),
    revoked_reason: z.string().nullable(),
  })
  .passthrough();

export type UserDeviceListRow = z.infer<typeof UserDeviceListRowSchema>;

export const UserDeviceRefreshRowSchema = z
  .object({
    canonical_user_id: NonEmptyStringSchema,
    pid: NonEmptyStringSchema,
    device_pubkey: NonEmptyStringSchema,
    revoked_at: z.string().nullable(),
  })
  .passthrough();

export type UserDeviceRefreshRow = z.infer<
  typeof UserDeviceRefreshRowSchema
>;

export const UserDeviceRevokeTargetRowSchema = z
  .object({
    canonical_user_id: NonEmptyStringSchema,
    revoked_at: z.string().nullable(),
  })
  .passthrough();

export const RegisterRequestSchema = z
  .object({
    api_member_id: ApiMemberIdSchema,
    device_pub: NonEmptyStringSchema,
    attestation: NonEmptyStringSchema,
  })
  .passthrough();

export const RefreshRequestSchema = z
  .object({
    device_id: NonEmptyStringSchema,
    api_member_id: ApiMemberIdSchema,
    nonce: NonEmptyStringSchema,
    sig: NonEmptyStringSchema,
  })
  .passthrough();

export const RevokeRequestSchema = z
  .object({
    device_id: NonEmptyStringSchema,
    target_device_id: NonEmptyStringSchema,
    nonce: NonEmptyStringSchema,
    sig: NonEmptyStringSchema,
    reason: z.string().nullable().optional(),
  })
  .passthrough();

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;
export type RevokeRequest = z.infer<typeof RevokeRequestSchema>;

export const AuthConfigDiagnosticsSchema = z
  .object({
    enable_anonymous_sign_ins: z.boolean().optional(),
    external_url: z.string().optional(),
  })
  .passthrough();

export const AuthSettingsDiagnosticsSchema = z
  .record(z.string(), z.unknown());

export type AuthConfigDiagnostics = z.infer<
  typeof AuthConfigDiagnosticsSchema
>;
export type AuthSettingsDiagnostics = z.infer<
  typeof AuthSettingsDiagnosticsSchema
>;

export const SupabaseAccessTokenUserSchema = z
  .object({
    id: NonEmptyStringSchema,
    email: z.string().nullable().optional(),
  })
  .passthrough();

export type SupabaseAccessTokenUser = z.infer<
  typeof SupabaseAccessTokenUserSchema
>;

export function firstSchemaError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid request body";
}