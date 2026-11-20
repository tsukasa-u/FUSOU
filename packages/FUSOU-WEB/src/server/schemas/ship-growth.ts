import { z } from "zod";
import { PublicIdSchema } from "./public-id";

const IntegerSchema = z.int();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

const ShipGrowthSlotSchema = z
  .looseObject({
    slotitem_id: IntegerSchema,
    locked: z.boolean(),
    level: IntegerSchema,
    alv: IntegerSchema,
  });

const ShipGrowthEntrySchema = z
  .looseObject({
    master_id: IntegerSchema.positive(),
    lv: IntegerSchema.positive(),
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
  });

export const MasterDataR2KeyRowSchema = z
  .looseObject({ r2_key: z.string().min(1).nullable().optional() });

export const ShipGrowthExpRowSchema = z
  .looseObject({
    lv: IntegerSchema,
    exp_current: IntegerSchema,
  });

export const ShipGrowthExpUpdatedRowSchema = ShipGrowthExpRowSchema.extend({
  updated_at: z.number(),
});

export const ShipGrowthPeriodRowSchema = z
  .looseObject({
    period_tag: z.string().min(1),
    table_version: z.string().min(1),
  });

const ShipGrowthStatSchema = z.number();

export const ShipGrowthCountRowSchema = z
  .looseObject({ c: z.number().int().nonnegative() });

export const ShipGrowthBoundsRowSchema = z
  .looseObject({
    master_id: IntegerSchema.positive(),
    lv: IntegerSchema.positive(),
    kaihi_naked: ShipGrowthStatSchema,
    taisen_naked: ShipGrowthStatSchema,
    sakuteki_naked: ShipGrowthStatSchema,
    lucky_naked: ShipGrowthStatSchema,
  });

export const ShipGrowthLegacyBoundsRowSchema = z
  .looseObject({
    master_id: IntegerSchema.positive(),
    lv: IntegerSchema.positive(),
    kaihi_naked: ShipGrowthStatSchema,
    taisen_naked: ShipGrowthStatSchema,
    sakuteki_naked: ShipGrowthStatSchema,
  });

export const ShipGrowthBoundsUpdatedRowSchema = ShipGrowthBoundsRowSchema.extend(
  { updated_at: z.number() },
);

export const ShipGrowthCapsRowSchema = z
  .looseObject({
    master_id: IntegerSchema.positive(),
    kaihi_max: ShipGrowthStatSchema,
    taisen_max: ShipGrowthStatSchema,
    sakuteki_max: ShipGrowthStatSchema,
  });

export const ShipGrowthCapsUpdatedRowSchema = ShipGrowthCapsRowSchema.extend({
  updated_at: z.number(),
});

export const ShipGrowthArchiveBoundsRowSchema = z
  .looseObject({
    row_id: IntegerSchema.positive().optional().default(1),
    period_tag: z.string().min(1),
    table_version: z.string().min(1),
    master_id: IntegerSchema.positive(),
    lv: IntegerSchema.positive(),
    kaihi_naked: ShipGrowthStatSchema,
    taisen_naked: ShipGrowthStatSchema,
    sakuteki_naked: ShipGrowthStatSchema,
    lucky_naked: ShipGrowthStatSchema.optional().default(0),
  });

export const ShipGrowthArchiveCapsRowSchema = z
  .looseObject({
    row_id: IntegerSchema.positive().optional().default(1),
    period_tag: z.string().min(1),
    table_version: z.string().min(1),
    master_id: IntegerSchema.positive(),
    kaihi_max: ShipGrowthStatSchema,
    taisen_max: ShipGrowthStatSchema,
    sakuteki_max: ShipGrowthStatSchema,
  });

export const SpEffectItemSchema = z
  .looseObject({
    api_kind: z.number().nullable().optional(),
    api_houg: z.number().nullable().optional(),
    api_kaih: z.number().nullable().optional(),
    api_raig: z.number().nullable().optional(),
    api_souk: z.number().nullable().optional(),
  });

export type SpEffectItem = z.infer<typeof SpEffectItemSchema>;

export const ShipGrowthIngestBodySchema = z
  .looseObject({
    dataset_id: PublicIdSchema,
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
      z.number().positive().optional(),
    ),
  });

export type ShipGrowthIngestBody = z.infer<
  typeof ShipGrowthIngestBodySchema
>;
