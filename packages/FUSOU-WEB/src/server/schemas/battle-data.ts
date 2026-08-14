import { z } from "zod";

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