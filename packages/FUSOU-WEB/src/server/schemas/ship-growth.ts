import { z } from "zod";

const IntegerSchema = z.number().int();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

const ShipGrowthSlotSchema = z
  .object({
    slotitem_id: IntegerSchema,
    locked: z.boolean(),
    level: IntegerSchema,
    alv: IntegerSchema,
  })
  .passthrough();

const ShipGrowthEntrySchema = z
  .object({
    master_id: IntegerSchema,
    lv: IntegerSchema,
    exp_current: IntegerSchema,
    exp_to_next: IntegerSchema.nullable(),
    kyouka: z.array(IntegerSchema),
    sp_effect_items_json: z.string().nullable(),
    kaihi_observed: IntegerSchema,
    taisen_observed: IntegerSchema,
    sakuteki_observed: IntegerSchema,
    lucky_observed: IntegerSchema,
    kaihi_naked: IntegerSchema,
    taisen_naked: IntegerSchema,
    sakuteki_naked: IntegerSchema,
    lucky_naked: IntegerSchema,
    kaihi_max: IntegerSchema,
    taisen_max: IntegerSchema,
    sakuteki_max: IntegerSchema,
    slots: z.array(ShipGrowthSlotSchema),
    exslot: ShipGrowthSlotSchema.nullable(),
  })
  .passthrough();

export const MasterDataR2KeyRowSchema = z
  .object({ r2_key: z.string().min(1).nullable().optional() })
  .passthrough();

export const ShipGrowthExpRowSchema = z
  .object({
    lv: IntegerSchema,
    exp_current: IntegerSchema,
  })
  .passthrough();

export const ShipGrowthExpUpdatedRowSchema = ShipGrowthExpRowSchema.extend({
  updated_at: z.number().finite(),
});

export const ShipGrowthPeriodRowSchema = z
  .object({
    period_tag: z.string().min(1),
    table_version: z.string().min(1),
  })
  .passthrough();

const ShipGrowthStatSchema = z.number().finite();

export const ShipGrowthCountRowSchema = z
  .object({ c: z.number().int().nonnegative() })
  .passthrough();

export const ShipGrowthBoundsRowSchema = z
  .object({
    master_id: IntegerSchema.positive(),
    lv: IntegerSchema.positive(),
    kaihi_naked: ShipGrowthStatSchema,
    taisen_naked: ShipGrowthStatSchema,
    sakuteki_naked: ShipGrowthStatSchema,
    lucky_naked: ShipGrowthStatSchema,
  })
  .passthrough();

export const ShipGrowthLegacyBoundsRowSchema = z
  .object({
    master_id: IntegerSchema.positive(),
    lv: IntegerSchema.positive(),
    kaihi_naked: ShipGrowthStatSchema,
    taisen_naked: ShipGrowthStatSchema,
    sakuteki_naked: ShipGrowthStatSchema,
  })
  .passthrough();

export const ShipGrowthBoundsUpdatedRowSchema = ShipGrowthBoundsRowSchema.extend(
  { updated_at: z.number().finite() },
);

export const ShipGrowthCapsRowSchema = z
  .object({
    master_id: IntegerSchema.positive(),
    kaihi_max: ShipGrowthStatSchema,
    taisen_max: ShipGrowthStatSchema,
    sakuteki_max: ShipGrowthStatSchema,
  })
  .passthrough();

export const ShipGrowthCapsUpdatedRowSchema = ShipGrowthCapsRowSchema.extend({
  updated_at: z.number().finite(),
});

export const ShipGrowthArchiveBoundsRowSchema = z
  .object({
    row_id: IntegerSchema.positive(),
    period_tag: z.string().min(1),
    table_version: z.string().min(1),
    master_id: IntegerSchema.positive(),
    lv: IntegerSchema.positive(),
    kaihi_naked: ShipGrowthStatSchema,
    taisen_naked: ShipGrowthStatSchema,
    sakuteki_naked: ShipGrowthStatSchema,
    lucky_naked: ShipGrowthStatSchema,
  })
  .passthrough();

export const ShipGrowthArchiveCapsRowSchema = z
  .object({
    row_id: IntegerSchema.positive(),
    period_tag: z.string().min(1),
    table_version: z.string().min(1),
    master_id: IntegerSchema.positive(),
    kaihi_max: ShipGrowthStatSchema,
    taisen_max: ShipGrowthStatSchema,
    sakuteki_max: ShipGrowthStatSchema,
  })
  .passthrough();

export const SpEffectItemSchema = z
  .object({
    api_kind: z.number().nullable().optional(),
    api_houg: z.number().nullable().optional(),
    api_kaih: z.number().nullable().optional(),
    api_raig: z.number().nullable().optional(),
    api_souk: z.number().nullable().optional(),
  })
  .passthrough();

export type SpEffectItem = z.infer<typeof SpEffectItemSchema>;

export const ShipGrowthIngestBodySchema = z
  .object({
    dataset_id: Sha256Schema,
    dataset_token: z.string().optional(),
    request_id: z.string().min(1),
    payload_hash: Sha256Schema,
    event_type: z.literal("snapshot"),
    schema_version: z.preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.literal(1),
    ),
    timestamp_ms: IntegerSchema.optional(),
    period_tag: z.string().min(1),
    table_version: z.string().min(1),
    ships: z.array(ShipGrowthEntrySchema).min(1),
    content_hash: z.string().optional(),
    file_size: z.preprocess(
      (value) => {
        if (typeof value === "number") return value;
        if (typeof value === "string" && value.trim()) return Number(value);
        return undefined;
      },
      z.number().finite().positive().optional(),
    ),
  })
  .passthrough();

export type ShipGrowthIngestBody = z.infer<
  typeof ShipGrowthIngestBodySchema
>;
