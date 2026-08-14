import { z } from "zod";

const CompactionTierSchema = z.enum([
  "hourly",
  "daily",
  "weekly",
  "period",
]);

const NumericRequestFieldSchema = z.preprocess(
  (value) => Number(value),
  z.number().finite(),
);

const TableNameSchema = z.preprocess(
  (value) => String(value ?? "").trim(),
  z.string(),
);

export const ListSourceGroupsRequestSchema = z
  .object({
    tier: CompactionTierSchema.optional(),
    table_name: TableNameSchema.optional(),
    window_start_ms: NumericRequestFieldSchema.optional(),
    window_end_ms: NumericRequestFieldSchema.optional(),
  })
  .passthrough();

export type ListSourceGroupsRequest = z.infer<
  typeof ListSourceGroupsRequestSchema
>;