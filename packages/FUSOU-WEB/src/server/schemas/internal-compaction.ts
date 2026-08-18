import { z } from "zod";

const CompactionTierSchema = z.enum([
  "hourly",
  "daily",
  "weekly",
  "period",
]);

const NullableNumberSchema = z.number().finite().nullable().optional();

export const ListSourceBlockRowSchema = z
  .object({
    id: z.number().int().positive(),
    dataset_id: z.string().min(1),
    table_name: z.string().min(1),
    table_version: z.string().min(1),
    period_tag: z.string().min(1),
    start_byte: z.number().int().nonnegative(),
    length: z.number().int().positive(),
    record_count: z.number().int().nonnegative(),
    start_timestamp: z.number().finite(),
    end_timestamp: z.number().finite(),
    compaction_tier: CompactionTierSchema,
    window_start_ms: NullableNumberSchema,
    window_end_ms: NullableNumberSchema,
    file_id: z.number().int().positive(),
    file_path: z.string().min(1),
    file_size: z.number().nonnegative(),
  })
  .passthrough();

export const SourceGroupRowSchema = z
  .object({
    period_tag: z.string().min(1),
    table_version: z.string().min(1),
    source_blocks: z.number().int().nonnegative(),
  })
  .passthrough();

export const SourceTableRowSchema = z
  .object({ table_name: z.string().min(1) })
  .passthrough();

export const SourceWindowRangeRowSchema = z
  .object({
    start_ms: NullableNumberSchema,
    end_ms: NullableNumberSchema,
  })
  .passthrough();

export const OutputLockOwnerRowSchema = z
  .object({
    lock_token: z.string().nullable().optional(),
    lock_expires_ms: NullableNumberSchema,
    lock_owner_run_key: z.string().nullable().optional(),
  })
  .passthrough();

export const RegisteredOutputLockRowSchema = z
  .object({
    id: z.number().int().positive(),
    lock_token: z.string().nullable().optional(),
    lock_expires_ms: NullableNumberSchema,
  })
  .passthrough();

export const CleanupOutputRowSchema = z
  .object({
    id: z.number().int().positive(),
    lifecycle_state: z.string().min(1),
    output_verified_at_ms: NullableNumberSchema,
  })
  .passthrough();

export const LinkedSourceRowSchema = z
  .object({
    source_file_id: z.number().int().positive(),
    source_file_path: z.string().min(1),
    archived_source_path: z.string().min(1),
  })
  .passthrough();

export const CleanupSourceRowSchema = z
  .object({
    file_id: z.number().int().positive(),
    file_path: z.string().min(1),
  })
  .passthrough();

export const CompletedCompactionRunRowSchema = z
  .object({ ok: z.number().optional() })
  .passthrough();

export const TableVersionRowSchema = z
  .object({ table_version: z.string().min(1) })
  .passthrough();

export const CompactionDatasetRowSchema = z
  .object({
    id: z.string().min(1),
    user_id: z.string().min(1),
    dataset_name: z.string().min(1),
  })
  .passthrough();

export type CompactionDatasetRow = z.infer<
  typeof CompactionDatasetRowSchema
>;

export const ClosedPeriodTagRowSchema = z
  .object({ period_tag: z.string().min(1).nullable().optional() })
  .passthrough();

const NumericRequestFieldSchema = z.preprocess(
  (value) =>
    value == null || typeof value === "number" || typeof value === "string"
      ? value == null
        ? value
        : Number(value)
      : value,
  z.number().int().nonnegative().safe(),
);

const OptionalNumericRequestFieldSchema = z.preprocess((value) => {
  if (value == null) return undefined;
  if (typeof value !== "number" && typeof value !== "string") return value;
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && numericValue >= 0
    ? numericValue
    : undefined;
}, z.number().int().nonnegative().safe().optional());

const SourceFileIdsRequestFieldSchema = z.preprocess(
  (value) => (Array.isArray(value) ? value : []),
  z.array(
    z.preprocess(
      (value) =>
        value == null || typeof value === "number" || typeof value === "string"
          ? value == null
            ? value
            : Number(value)
          : value,
      z.number().int().positive().safe(),
    ),
  ),
);

const SourceObjectsRequestFieldSchema = z.preprocess(
  (value) => (value == null ? [] : value),
  z.array(
    z.object({
      file_id: z.preprocess(
        (value) =>
          value == null || typeof value === "number" || typeof value === "string"
            ? value == null
              ? value
              : Number(value)
            : value,
        z.number().int().positive().safe(),
      ),
      file_path: z.preprocess(
        (value) => String(value ?? "").trim(),
        z.string().min(1),
      ),
      archived_path: z.preprocess(
        (value) => String(value ?? "").trim(),
        z.string().min(1),
      ),
    }),
  ),
);

const FileSizeRequestFieldSchema = z.preprocess(
  (value) =>
    value == null || typeof value === "number" || typeof value === "string"
      ? value == null
        ? undefined
        : Number(value)
      : value,
  z.number().int().nonnegative().safe().optional(),
);

const TableNameSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z.string(),
);

const BlockStringSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z.string().min(1),
);

const BlockNonNegativeIntegerSchema = z.preprocess(
  (value) =>
    value == null || typeof value === "number" || typeof value === "string"
      ? value == null
        ? value
        : Number(value)
      : value,
  z.number().int().nonnegative().safe(),
);

const BlockPositiveIntegerSchema = z.preprocess(
  (value) =>
    value == null || typeof value === "number" || typeof value === "string"
      ? value == null
        ? value
        : Number(value)
      : value,
  z.number().int().positive().safe(),
);

const BlocksRequestFieldSchema = z.preprocess(
  (value) => (Array.isArray(value) ? value : []),
  z.array(
    z
      .object({
        dataset_id: BlockStringSchema,
        table_name: BlockStringSchema,
        period_tag: BlockStringSchema,
        start_byte: BlockNonNegativeIntegerSchema,
        length: BlockPositiveIntegerSchema,
        record_count: BlockNonNegativeIntegerSchema,
        start_timestamp: BlockNonNegativeIntegerSchema,
        end_timestamp: BlockNonNegativeIntegerSchema,
        source_file_count: z.preprocess(
          (value) =>
            value == null ||
            typeof value === "number" ||
            typeof value === "string"
              ? value == null
                ? value
                : Number(value)
              : value,
          z.number().int().positive().safe(),
        ),
      })
      .passthrough(),
  ),
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
    table_names: z.array(z.string().trim().min(1)).optional(),
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
    length: z.preprocess(
      (value) => (value == null ? value : Number(value)),
      z.number().int().positive().safe().optional(),
    ),
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

export const ListSourceBlocksRequestSchema = z
  .object({
    tier: CompactionTierSchema.optional(),
    table_name: TrimmedStringRequestFieldSchema.optional(),
    period_tag: TrimmedStringRequestFieldSchema.optional(),
    table_version: TrimmedStringRequestFieldSchema.optional(),
    cursor_id: OptionalNumericRequestFieldSchema,
    limit: OptionalNumericRequestFieldSchema,
    window_start_ms: OptionalNumericRequestFieldSchema,
    window_end_ms: OptionalNumericRequestFieldSchema,
  })
  .passthrough();

export type ListSourceBlocksRequest = z.infer<
  typeof ListSourceBlocksRequestSchema
>;

export const CleanupConsumedSourcesRequestSchema = z
  .object({
    output_file_path: TrimmedStringRequestFieldSchema.optional(),
    source_tier: CompactionTierSchema.optional(),
    table_name: TrimmedStringRequestFieldSchema.optional(),
    period_tag: TrimmedStringRequestFieldSchema.optional(),
    table_version: TrimmedStringRequestFieldSchema.optional(),
    window_start_ms: OptionalNumericRequestFieldSchema,
    window_end_ms: OptionalNumericRequestFieldSchema,
    source_file_ids: SourceFileIdsRequestFieldSchema,
    source_objects: SourceObjectsRequestFieldSchema,
  })
  .passthrough();

export type CleanupConsumedSourcesRequest = z.infer<
  typeof CleanupConsumedSourcesRequestSchema
>;

export const RegisterOutputRequestSchema = z
  .preprocess(
    (value) =>
      value && typeof value === "object" && !Array.isArray(value) ? value : {},
    z
      .object({
        file_path: TrimmedStringRequestFieldSchema.optional(),
        lock_token: TrimmedStringRequestFieldSchema.optional(),
        source_objects: SourceObjectsRequestFieldSchema,
        table_version: TrimmedStringRequestFieldSchema.optional(),
        compaction_tier: CompactionTierSchema.optional(),
        source_tier: TrimmedStringRequestFieldSchema.optional(),
        window_start_ms: OptionalNumericRequestFieldSchema,
        window_end_ms: OptionalNumericRequestFieldSchema,
        file_size: FileSizeRequestFieldSchema,
        compression_codec: z
          .preprocess(
            (value) => String(value ?? "deflate").trim(),
            z.string(),
          )
          .default("deflate"),
        blocks: BlocksRequestFieldSchema,
      })
      .passthrough(),
  );

export type RegisterOutputRequest = z.infer<typeof RegisterOutputRequestSchema>;