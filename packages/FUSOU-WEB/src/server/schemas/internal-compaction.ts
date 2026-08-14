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

export const ResolveSourceWindowRangeRequestSchema = z
  .object({
    tier: CompactionTierSchema.optional(),
    table_names: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type ResolveSourceWindowRangeRequest = z.infer<
  typeof ResolveSourceWindowRangeRequestSchema
>;

const TrimmedStringRequestFieldSchema = z.preprocess(
  (value) => String(value ?? "").trim(),
  z.string(),
);

export const FetchBlockOcfRequestSchema = z
  .object({
    file_path: TrimmedStringRequestFieldSchema.optional(),
    start_byte: NumericRequestFieldSchema.optional(),
    length: NumericRequestFieldSchema.optional(),
  })
  .passthrough();

export type FetchBlockOcfRequest = z.infer<typeof FetchBlockOcfRequestSchema>;

export const VerifyOutputVisibleRequestSchema = z
  .object({
    file_path: TrimmedStringRequestFieldSchema.optional(),
  })
  .passthrough();

export type VerifyOutputVisibleRequest = z.infer<
  typeof VerifyOutputVisibleRequestSchema
>;

export const ReleaseOutputLockRequestSchema = z
  .object({
    file_path: TrimmedStringRequestFieldSchema.optional(),
    lock_token: TrimmedStringRequestFieldSchema.optional(),
  })
  .passthrough();

export type ReleaseOutputLockRequest = z.infer<
  typeof ReleaseOutputLockRequestSchema
>;

export const AcquireOutputLockRequestSchema = z
  .object({
    file_path: TrimmedStringRequestFieldSchema.optional(),
    lock_token: TrimmedStringRequestFieldSchema.optional(),
    table_version: TrimmedStringRequestFieldSchema.optional(),
    compaction_tier: CompactionTierSchema.optional(),
    source_tier: TrimmedStringRequestFieldSchema.optional(),
    window_start_ms: NumericRequestFieldSchema.optional(),
    window_end_ms: NumericRequestFieldSchema.optional(),
    run_key: TrimmedStringRequestFieldSchema.optional(),
    lock_ttl_ms: OptionalNumericRequestFieldSchema,
  })
  .passthrough();

export type AcquireOutputLockRequest = z.infer<
  typeof AcquireOutputLockRequestSchema
>;

const DefaultWeeklyTierRequestFieldSchema = z.preprocess(
  (value) => String(value ?? "weekly").trim(),
  z.string(),
);

const DefaultHourlyTierRequestFieldSchema = z.preprocess(
  (value) => String(value ?? "hourly").trim(),
  z.string(),
);

export const PeriodRolloverCheckRequestSchema = z
  .object({
    table_name: TrimmedStringRequestFieldSchema.optional(),
    source_tier: DefaultWeeklyTierRequestFieldSchema,
  })
  .passthrough();

export type PeriodRolloverCheckRequest = z.infer<
  typeof PeriodRolloverCheckRequestSchema
>;

export const ResolveTableVersionRequestSchema = z
  .object({
    table_name: TrimmedStringRequestFieldSchema.optional(),
    period_tag: TrimmedStringRequestFieldSchema.optional(),
    source_tier: DefaultHourlyTierRequestFieldSchema,
  })
  .passthrough();

export type ResolveTableVersionRequest = z.infer<
  typeof ResolveTableVersionRequestSchema
>;