import { z } from "zod";

export const MasterDataNextRevisionRowSchema = z
  .object({ next_revision: z.number().nullable().optional() })
  .passthrough();

export type MasterDataNextRevisionRow = z.infer<
  typeof MasterDataNextRevisionRowSchema
>;

export const MasterDataDedupeRowSchema = z
  .object({
    id: z.number().int().positive(),
    period_revision: z.number().int().positive(),
    upload_status: z.string().min(1),
  })
  .passthrough();

export const MasterDataInsertedRevisionRowSchema = z
  .object({
    id: z.number().int().positive(),
    period_revision: z.number().int().positive(),
  })
  .passthrough();

export const MasterDataJsonLookupRowSchema = z
  .object({
    period_tag: z.string().min(1),
    table_version: z.string().min(1),
    period_revision: z.number().int().positive(),
    r2_key: z.string().min(1),
  })
  .passthrough();

export const MasterDataJsonRecordSchema = z.record(
  z.string(),
  z.unknown(),
);

export function parseMasterDataJsonRecords(
  value: unknown,
): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null;
  const records: Array<Record<string, unknown>> = [];
  for (const row of value) {
    const parsed = MasterDataJsonRecordSchema.safeParse(row);
    if (!parsed.success) return null;
    records.push(parsed.data);
  }
  return records;
}
