import { z } from "zod";

export const VerifyDeviceRequestSchema = z
  .object({
    code: z.string().optional(),
  })
  .passthrough();

export const VerifyGoogleRequestSchema = z
  .object({
    email: z.unknown().optional(),
    google_token: z.string().optional(),
  })
  .passthrough();

export const TrustedDeviceTrustRowsSchema = z.array(
  z
    .object({
      id: z.string().min(1),
      last_used_at: z.string().min(1),
    })
    .passthrough(),
);

export const TableNameRowsSchema = z.array(
  z
    .object({
      table_name: z.string(),
    })
    .passthrough(),
);

export function parseTableNames(value: unknown): string[] {
  const result = TableNameRowsSchema.safeParse(value);
  return result.success ? result.data.map((row) => row.table_name) : [];
}

export const MasterDataFileRowsSchema = z.array(
  z
    .object({
      id: z.number().int(),
      period_tag: z.string(),
      table_version: z.string(),
      period_revision: z.number().int(),
      table_name: z.string(),
      r2_key: z.string().nullable(),
      completed_at: z.number().int().nullable(),
    })
    .passthrough(),
);

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
    .object({
      id: z.number().int(),
      dataset_id: z.string(),
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
    })
    .passthrough(),
);

export type ArchivedBlockRow = z.infer<
  typeof ArchivedBlockRowsSchema
>[number];

export function parseArchivedBlockRows(value: unknown): ArchivedBlockRow[] {
  const result = ArchivedBlockRowsSchema.safeParse(value);
  return result.success ? result.data : [];
}

export type VerifyDeviceRequest = z.infer<typeof VerifyDeviceRequestSchema>;
export type VerifyGoogleRequest = z.infer<typeof VerifyGoogleRequestSchema>;