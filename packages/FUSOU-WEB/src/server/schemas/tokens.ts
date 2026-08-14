import { z } from "zod";

const SignedTokenBaseSchema = z
  .object({
    user_id: z.string().min(1),
  })
  .passthrough();

export const UploadTokenPayloadSchema = SignedTokenBaseSchema.extend({
  content_hash: z.string().min(1),
  declared_size: z.coerce.number().int().positive(),
  dataset_id: z.string().min(1),
  request_id: z.string().min(1),
  event_type: z.string().min(1),
  schema_version: z.coerce.number().int(),
});

export const MasterDataTokenPayloadSchema = SignedTokenBaseSchema.extend({
  record_id: z.coerce.number().int().positive(),
  period_tag: z.string().min(1),
  table_version: z.string().min(1),
  period_revision: z.coerce.number().int().positive(),
  content_hash: z.string().min(1),
  table_offsets: z.string().min(1),
  table_count: z.coerce.number().int().positive(),
  declared_size: z.coerce.number().int().positive(),
});

export const SokuSpeedTokenPayloadSchema = SignedTokenBaseSchema.extend({
  content_hash: z.string().min(1),
  declared_size: z.coerce.number().int().positive(),
  request_id: z.string().optional(),
  dataset_id: z.string().optional(),
  period_tag: z.string().optional(),
  table_version: z.string().optional(),
});

export const BattleDataTokenPayloadSchema = SignedTokenBaseSchema.extend({
  dataset_id: z.string().min(1),
  table: z.string().min(1),
  period_tag: z.string().min(1),
  declared_size: z.coerce.number().int().positive(),
  table_offsets: z.string().nullable(),
  content_hash: z.string().min(1),
  path_tag: z.string().min(1),
  table_version: z.string().min(1),
});

export type UploadTokenPayload = z.infer<typeof UploadTokenPayloadSchema>;
export type MasterDataTokenPayload = z.infer<
  typeof MasterDataTokenPayloadSchema
>;
export type SokuSpeedTokenPayload = z.infer<
  typeof SokuSpeedTokenPayloadSchema
>;
export type BattleDataTokenPayload = z.infer<
  typeof BattleDataTokenPayloadSchema
>;