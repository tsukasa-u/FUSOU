import { z } from "zod";

export const MasterDataR2KeyRowSchema = z
  .object({ r2_key: z.string().min(1).nullable().optional() })
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
    dataset_id: z.unknown().optional(),
    dataset_token: z.unknown().optional(),
    request_id: z.unknown().optional(),
    payload_hash: z.unknown().optional(),
    event_type: z.unknown().optional(),
    schema_version: z.unknown().optional(),
    timestamp_ms: z.unknown().optional(),
    period_tag: z.unknown().optional(),
    table_version: z.unknown().optional(),
    ships: z.unknown().optional(),
    content_hash: z.unknown().optional(),
    file_size: z.unknown().optional(),
  })
  .passthrough();

export type ShipGrowthIngestBody = z.infer<
  typeof ShipGrowthIngestBodySchema
>;
