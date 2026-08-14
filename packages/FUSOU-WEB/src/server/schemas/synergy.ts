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

export const CompletedSynergyManifestRowSchema = z
  .object({
    period_tag: z.string().min(1),
    period_revision: z.number().int().positive(),
    content_hash: z.string().min(1),
    sp_effect_sha256: z.string().min(1),
    completed_at: z.number().int().nullable().optional(),
  })
  .passthrough();

export type CompletedSynergyManifestRow = z.infer<
  typeof CompletedSynergyManifestRowSchema
>;

export const CompletedSynergyManifestRowsSchema = z.array(
  CompletedSynergyManifestRowSchema,
);
