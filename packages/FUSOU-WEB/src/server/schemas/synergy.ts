import { z } from "zod";

export const LatestSynergyPeriodRowSchema = z
  .object({ period_tag: z.string().min(1) })
  .passthrough();

export type LatestSynergyPeriodRow = z.infer<
  typeof LatestSynergyPeriodRowSchema
>;

export const SynergyNextRevisionRowSchema = z
  .object({ next_revision: z.number().int().positive() })
  .passthrough();
