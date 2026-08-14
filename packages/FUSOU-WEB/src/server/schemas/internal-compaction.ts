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

const OptionalNumericRequestFieldSchema = z.preprocess((value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : undefined;
}, z.number().finite().optional());

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

export const ListSourceTablesRequestSchema = z
  .object({
    tier: CompactionTierSchema.optional(),
    window_start_ms: OptionalNumericRequestFieldSchema,
    window_end_ms: OptionalNumericRequestFieldSchema,
  })
  .passthrough();

export type ListSourceTablesRequest = z.infer<
  typeof ListSourceTablesRequestSchema
>;