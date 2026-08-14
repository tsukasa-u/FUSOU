import { z } from "zod";

export const BattleMasterDataRowSchema = z
  .object({
    period_tag: z.string().min(1),
    table_version: z.string().min(1),
    period_revision: z.number().int().positive(),
    r2_key: z.string().min(1),
  })
  .passthrough();

export const BattleChunkRowsSchema = z.array(
  z
    .object({
      id: z.number().int(),
      table_name: z.string(),
      size: z.number().int(),
      table_version: z.string(),
      file_path: z.string(),
      start_timestamp: z.number().int(),
      record_count: z.number().int(),
    })
    .passthrough(),
);

export type BattleChunkRow = z.infer<typeof BattleChunkRowsSchema>[number];

export function parseBattleChunkRows(
  value: unknown,
): BattleChunkRow[] | null {
  const result = BattleChunkRowsSchema.safeParse(value);
  return result.success ? result.data : null;
}

export const BattleBlockRowsSchema = z.array(
  z
    .object({
      id: z.number().int(),
      dataset_id: z.string(),
      start_byte: z.number().int(),
      length: z.number().int(),
      start_timestamp: z.number().int().nullable(),
      end_timestamp: z.number().int().nullable(),
      period_tag: z.string().nullable(),
      window_start_ms: z.number().int().nullable(),
      window_end_ms: z.number().int().nullable(),
      compaction_tier: z.string().nullable(),
      file_path: z.string(),
    })
    .passthrough(),
);

export type BattleBlockRow = z.infer<typeof BattleBlockRowsSchema>[number];

export function parseBattleBlockRows(
  value: unknown,
): BattleBlockRow[] | null {
  const result = BattleBlockRowsSchema.safeParse(value);
  return result.success ? result.data : null;
}

export const BattleJsonRecordSchema = z.record(z.string(), z.unknown());

export function parseBattleJsonRecords(
  value: unknown,
): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null;
  const records: Array<Record<string, unknown>> = [];
  for (const row of value) {
    const parsed = BattleJsonRecordSchema.safeParse(row);
    if (!parsed.success) return null;
    records.push(parsed.data);
  }
  return records;
}