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

const SynergyEffectRuleSchema = z
  .object({
    ships: z.unknown().optional(),
    b: z.record(z.string(), z.unknown()).optional(),
    l: z.record(z.string(), z.unknown()).optional(),
    c2: z.record(z.string(), z.unknown()).optional(),
    c3: z.record(z.string(), z.unknown()).optional(),
    items: z.array(z.number()).optional(),
  })
  .passthrough();

const SynergyCrossRuleSchema = z
  .object({
    ships: z.unknown().optional(),
    synergy: z.record(z.string(), z.unknown()).optional(),
    pairs: z.array(z.tuple([z.number(), z.number()])).optional(),
    item_pool: z.array(z.number()).optional(),
    fixed_items: z.array(z.number()).optional(),
    free_pool: z.array(z.number()).optional(),
    free_pool_with_replacement: z.boolean().optional(),
    free_pick_count: z.number().optional(),
    category_pools: z.array(z.array(z.number())).optional(),
    implicants: z.array(z.array(z.array(z.number()))).optional(),
  })
  .passthrough();

export const SynergyPayloadSchema = z
  .object({
    effects: z.record(z.string(), z.unknown()).optional(),
    cross_effects: z.record(z.string(), z.unknown()).optional(),
    effect_rules: z.array(SynergyEffectRuleSchema).optional(),
    cross_rules: z.array(SynergyCrossRuleSchema).optional(),
  })
  .passthrough();

export type SynergyPayload = z.infer<typeof SynergyPayloadSchema>;
