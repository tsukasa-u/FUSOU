import { z } from "zod";
import { PublicIdSchema } from "./public-id";

export const VerifyDeviceRequestSchema = z
  .looseObject({
    code: z.string().optional(),
  });

export const VerifyGoogleRequestSchema = z
  .looseObject({
    email: z.string().optional(),
    google_token: z.string().optional(),
  });

export const ApiKeyValidationRowsSchema = z.array(
  z
    .looseObject({
      id: z.string().min(1),
      user_id: z.string().min(1),
      email: z.string().min(1),
    }),
);

export const TrustedDeviceTrustRowsSchema = z.array(
  z
    .looseObject({
      id: z.string().min(1),
      last_used_at: z.string().min(1),
    }),
);

export const VerificationCodeRowsSchema = z.array(
  z
    .looseObject({
      id: z.string().min(1),
    }),
);

export const TableNameRowsSchema = z.array(
  z
    .looseObject({
      table_name: z.string(),
    }),
);

export function parseTableNames(value: unknown): string[] {
  const result = TableNameRowsSchema.safeParse(value);
  return result.success ? result.data.map((row) => row.table_name) : [];
}

const RateLimitAttemptsSchema = z.array(z.number());

export function parseRateLimitAttempts(value: string | null): number[] | null {
  if (!value) return [];
  try {
    const result = RateLimitAttemptsSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export const MasterDataFileRowsSchema = z.array(
  z
    .looseObject({
      id: z.number().int(),
      period_tag: z.string(),
      table_version: z.string(),
      period_revision: z.number().int(),
      table_name: z.string(),
      r2_key: z.string().nullable(),
      completed_at: z.number().int().nullable(),
    }),
);

export const MasterDataR2KeyRowSchema = z
  .looseObject({ r2_key: z.string().min(1) });

export type MasterDataFileRow = z.infer<
  typeof MasterDataFileRowsSchema
>[number];

export function parseMasterDataFileRows(
  value: unknown,
): MasterDataFileRow[] | null {
  const result = MasterDataFileRowsSchema.safeParse(value);
  return result.success ? result.data : null;
}

export const ArchivedBlockRowsSchema = z.array(
  z
    .looseObject({
      id: z.number().int(),
      dataset_id: PublicIdSchema,
      table_name: z.string(),
      table_version: z.string(),
      compaction_tier: z.string(),
      size: z.number().int(),
      record_count: z.number().int(),
      start_timestamp: z.number().int(),
      end_timestamp: z.number().int(),
      window_start_ms: z.number().int().nullable(),
      window_end_ms: z.number().int().nullable(),
      period_tag: z.string(),
      start_byte: z.number().int(),
      file_path: z.string(),
    }),
);

export const DataLoaderBlockInfoRowSchema = z
  .looseObject({
    id: z.number().int(),
    start_byte: z.number().int(),
    length: z.number().int(),
    dataset_id: PublicIdSchema,
    file_path: z.string().min(1),
  });

export type ArchivedBlockRow = z.infer<
  typeof ArchivedBlockRowsSchema
>[number];

export function parseArchivedBlockRows(value: unknown): ArchivedBlockRow[] {
  const result = ArchivedBlockRowsSchema.safeParse(value);
  return result.success ? result.data : [];
}

export type VerifyDeviceRequest = z.infer<typeof VerifyDeviceRequestSchema>;
export type VerifyGoogleRequest = z.infer<typeof VerifyGoogleRequestSchema>;