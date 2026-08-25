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

export const MasterDataDownloadRowSchema = z
  .object({
    period_revision: z.number().int().positive(),
    r2_key: z.string().min(1),
  })
  .passthrough();

export const MasterDataMetadataRowSchema = z
  .object({
    id: z.number().int().positive(),
    period_tag: z.string().min(1),
    table_version: z.string().min(1),
    period_revision: z.number().int().positive(),
    table_count: z.number().int().nonnegative().nullable(),
    table_offsets: z.string().nullable(),
    upload_status: z.string().min(1),
    created_at: z.number().finite(),
    completed_at: z.number().finite().nullable(),
  })
  .passthrough();

export const MasterDataTableOffsetSchema = z.object({
  table_name: z.string().min(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

export type MasterDataTableOffset = z.infer<typeof MasterDataTableOffsetSchema>;

export function parseMasterDataTableOffsets(
  value: string | null,
): MasterDataTableOffset[] {
  if (!value) return [];
  try {
    const result = z.array(MasterDataTableOffsetSchema).safeParse(
      JSON.parse(value),
    );
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

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

export function parseMasterDataJsonRecordsText(
  value: string,
): Array<Record<string, unknown>> | null {
  try {
    return parseMasterDataJsonRecords(JSON.parse(value));
  } catch {
    return null;
  }
}
