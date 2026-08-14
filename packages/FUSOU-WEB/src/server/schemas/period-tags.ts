import { z } from "zod";

export const PeriodTagRowSchema = z
  .object({ tag: z.string().nullable() })
  .passthrough();

export const PeriodTagRowsSchema = PeriodTagRowSchema.array();

export type PeriodTagRow = z.infer<typeof PeriodTagRowSchema>;