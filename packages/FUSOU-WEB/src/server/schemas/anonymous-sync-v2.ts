import { z } from "zod";

const ApiMemberIdSchema = z.string().regex(/^[0-9]{1,16}$/);

const NonEmptyStringSchema = z.string().min(1);
const UuidV4Schema = z.string().uuid().refine(
  (value) => {
    const normalized = value.toLowerCase();
    return normalized[14] === "4" && /^[89ab]$/.test(normalized[19] ?? "");
  },
  "expected a UUID v4",
);

export const UserMemberMapRowSchema = z
  .object({
    user_id: NonEmptyStringSchema,
    public_id: UuidV4Schema,
  })
  .passthrough();

export type UserMemberMapRow = z.infer<typeof UserMemberMapRowSchema>;

export const UserDeviceLookupRowSchema = z
  .object({
    device_id: UuidV4Schema,
    revoked_at: z.string().nullable(),
  })
  .passthrough();

export const UserDeviceInsertRowSchema = z
  .object({ device_id: UuidV4Schema })
  .passthrough();

export type UserDeviceLookupRow = z.infer<typeof UserDeviceLookupRowSchema>;

export const UserDeviceListRowSchema = z
  .object({
    device_id: UuidV4Schema,
    public_id: UuidV4Schema,
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
    public_id: UuidV4Schema,
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

export const UserDeviceWebRevokeTargetRowSchema = z
  .object({
    public_id: UuidV4Schema,
    revoked_at: z.string().nullable(),
  })
  .passthrough();

export const RegisterRequestSchema = z
  .object({
    api_member_id: ApiMemberIdSchema,
    device_pub: NonEmptyStringSchema,
    recovery: z
      .object({
        device_id: NonEmptyStringSchema,
        nonce: NonEmptyStringSchema,
        sig: NonEmptyStringSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

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

export const PendingSyncCompleteRequestSchema = z
  .object({
    dataset_token: z.string().min(1).max(4096),
    app_instance_id: z.string().min(1).max(128),
  })
  .strict();

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