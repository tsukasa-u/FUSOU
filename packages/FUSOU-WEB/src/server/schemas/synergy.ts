import { z } from "zod";

const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, "expected a 64-character SHA-256 hex string");

const PeriodTagSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const GeneratorVersionSchema = z
  .string()
  .regex(/^v\d+\.\d+\.\d+$/, "expected format vX.Y.Z");

export const SynergyManifestRequestSchema = z
  .object({
    period_tag: PeriodTagSchema,
    sp_effect_sha256: Sha256Schema,
    api_start2_batch_hash: Sha256Schema,
    generator_version: GeneratorVersionSchema,
    generated_at: z
      .string()
      .min(1, "generated_at is required")
      .refine((value) => !Number.isNaN(new Date(value).getTime()), {
        message: "generated_at must be a valid ISO8601 date string",
      }),
    allow_duplicate_content: z.boolean().optional(),
  })
  .passthrough();

export type SynergyManifestRequest = z.infer<
  typeof SynergyManifestRequestSchema
>;

export const SynergyManifestRowSchema = z
  .object({
    id: z.number().int().positive(),
    period_tag: z.string().min(1),
    period_revision: z.number().int().positive(),
    content_hash: z.string().min(1),
    sp_effect_sha256: z.string().min(1),
    api_start2_batch_hash: z.string().min(1),
    generator_version: z.string().min(1),
    upload_status: z.enum(["pending", "completed", "superseded", "failed"]),
    completed_at: z.number().int().nullable().optional(),
  })
  .passthrough();

export const SynergyExistingManifestRowSchema = z
  .object({
    id: z.number().int().positive(),
    period_revision: z.number().int().positive(),
  })
  .passthrough();

export const SynergyPendingManifestRowSchema = z
  .object({
    id: z.number().int().positive(),
    content_hash: z.string().min(1),
    sp_effect_sha256: z.string().min(1),
  })
  .passthrough();

export const SynergyInsertedManifestRowSchema = z
  .object({
    id: z.number().int().positive(),
    period_tag: z.string().min(1),
    period_revision: z.number().int().positive(),
    content_hash: z.string().min(1),
  })
  .passthrough();

export const SynergyUpdatedManifestRowSchema = z
  .object({
    id: z.number().int().positive(),
    period_tag: z.string().min(1),
    period_revision: z.number().int().positive(),
    upload_status: z.enum(["completed", "superseded", "failed"]),
    completed_at: z.number().int().nullable().optional(),
  })
  .passthrough();

export const SynergyValidationManifestRowSchema = z
  .object({
    period_tag: z.string().min(1),
    period_revision: z.number().int().positive(),
    sp_effect_sha256: z.string().min(1),
    api_start2_batch_hash: z.string().min(1),
    generator_version: z.string().min(1),
    completed_at: z.number().int().nullable().optional(),
  })
  .passthrough();

export const MasterDataHashRowSchema = z
  .object({
    content_hash: z.string().min(1),
    period_revision: z.number().int().positive(),
  })
  .passthrough();

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

export const SynergyDatasetManifestRowSchema = z
  .object({
    period_tag: z.string().min(1),
    period_revision: z.number().int().positive(),
    content_hash: z.string().min(1),
    sp_effect_sha256: z.string().min(1),
  })
  .passthrough();

export const SynergyStatBonusSchema = z
  .object({
    kaih: z.number().finite().optional(),
    houk: z.number().finite().optional(),
    kaihi: z.number().finite().optional(),
    tais: z.number().finite().optional(),
    taisen: z.number().finite().optional(),
    saku: z.number().finite().optional(),
    sakuteki: z.number().finite().optional(),
    luck: z.number().finite().optional(),
    luk: z.number().finite().optional(),
    lucky: z.number().finite().optional(),
  })
  .strip();

export type SynergyStatBonus = z.infer<typeof SynergyStatBonusSchema>;

export const SynergyShipIdsSchema = z.array(z.number().int().positive());

export function parseSynergyStatBonus(
  value: unknown,
): SynergyStatBonus | undefined {
  if (value == null) return undefined;
  const result = SynergyStatBonusSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

export function parseSynergyShipIds(value: unknown): number[] {
  const result = SynergyShipIdsSchema.safeParse(value);
  return result.success ? result.data : [];
}

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
