import { z } from "zod";

export const PeriodTagRowSchema = z
  .looseObject({ tag: z.string().nullable() });

export const PeriodTagRowsSchema = PeriodTagRowSchema.array();

export const PeriodTagCacheSchema = z
  .looseObject({
    tags: z.string().array(),
    updated_at: z.number().optional(),
  });

export type PeriodTagRow = z.infer<typeof PeriodTagRowSchema>;

export const LatestMasterPeriodRowSchema = z
  .looseObject({
    period_tag: z.string().min(1),
    table_version: z.string().min(1),
  });