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

export type VerifyDeviceRequest = z.infer<typeof VerifyDeviceRequestSchema>;
export type VerifyGoogleRequest = z.infer<typeof VerifyGoogleRequestSchema>;