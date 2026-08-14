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

export type VerifyDeviceRequest = z.infer<typeof VerifyDeviceRequestSchema>;
export type VerifyGoogleRequest = z.infer<typeof VerifyGoogleRequestSchema>;