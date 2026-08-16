import { z } from "zod";

export const PeriodTagRowSchema = z
  .object({ tag: z.string().nullable() })
  .passthrough();

export const PeriodTagRowsSchema = PeriodTagRowSchema.array();

export const PeriodTagCacheSchema = z
  .object({
    tags: z.string().array(),
    updated_at: z.number().finite().optional(),
  })
  .passthrough();

export type PeriodTagRow = z.infer<typeof PeriodTagRowSchema>;

export const LatestMasterPeriodRowSchema = z
  .object({
    period_tag: z.string().min(1),
    table_version: z.string().min(1),
  })
  .passthrough();