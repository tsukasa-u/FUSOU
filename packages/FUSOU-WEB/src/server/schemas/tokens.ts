import { z } from "zod";
import { MAX_QUEST_TREE_UPLOAD_BYTES } from "../constants";
import { PublicIdSchema } from "./public-id";

const SignedTokenBaseSchema = z
  .object({
    user_id: z.string().min(1),
  })
  .passthrough();

const parseNumericClaim = (value: unknown): unknown => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim().length > 0) {
    return Number(value);
  }
  return value;
};

const PositiveIntegerClaimSchema = z.preprocess(
  parseNumericClaim,
  z.number().int().positive().safe(),
);

const QuestTreeDeclaredSizeClaimSchema = z.preprocess(
  parseNumericClaim,
  z
    .number()
    .int()
    .positive()
    .safe()
    .max(MAX_QUEST_TREE_UPLOAD_BYTES),
);

const IntegerClaimSchema = z.preprocess(
  parseNumericClaim,
  z.number().int().safe(),
);

export const UploadTokenPayloadSchema = SignedTokenBaseSchema.extend({
  content_hash: z.string().min(1),
  declared_size: PositiveIntegerClaimSchema,
  dataset_id: PublicIdSchema,
  request_id: z.string().min(1),
  event_type: z.string().min(1),
  schema_version: IntegerClaimSchema,
});

export const QuestTreeUploadTokenPayloadSchema =
  SignedTokenBaseSchema.extend({
    content_hash: z.string().min(1),
    declared_size: QuestTreeDeclaredSizeClaimSchema,
    dataset_id: PublicIdSchema,
    request_id: z.string().min(1),
    event_type: z.string().min(1),
  });

export const MasterDataTokenPayloadSchema = SignedTokenBaseSchema.extend({
  record_id: PositiveIntegerClaimSchema,
  period_tag: z.string().min(1),
  table_version: z.string().min(1),
  period_revision: PositiveIntegerClaimSchema,
  content_hash: z.string().min(1),
  table_offsets: z.string().min(1),
  table_count: PositiveIntegerClaimSchema,
  declared_size: PositiveIntegerClaimSchema,
});

export const AssetUploadTokenPayloadSchema = SignedTokenBaseSchema.extend({
  key: z.string().min(1),
  relative_path: z.string().min(1),
  declared_size: PositiveIntegerClaimSchema,
  file_name: z.string().nullable(),
  content_hash: z.string().min(1),
  caches_to_clear: z.string(),
});

export const FleetSnapshotTokenPayloadSchema = SignedTokenBaseSchema.extend({
  tag: z.string().min(1),
  dataset_id: PublicIdSchema,
  content_hash: z.string().min(1),
});

export const SokuSpeedTokenPayloadSchema = SignedTokenBaseSchema.extend({
  content_hash: z.string().min(1),
  declared_size: PositiveIntegerClaimSchema,
  request_id: z.string().optional(),
  dataset_id: PublicIdSchema.optional(),
  period_tag: z.string().optional(),
  table_version: z.string().optional(),
});

export const BattleDataTokenPayloadSchema = SignedTokenBaseSchema.extend({
  dataset_id: PublicIdSchema,
  table: z.string().min(1),
  period_tag: z.string().min(1),
  declared_size: PositiveIntegerClaimSchema,
  table_offsets: z.string().nullable(),
  content_hash: z.string().min(1),
  path_tag: z.string().min(1),
  table_version: z.string().min(1),
});

export type UploadTokenPayload = z.infer<typeof UploadTokenPayloadSchema>;
export type QuestTreeUploadTokenPayload = z.infer<
  typeof QuestTreeUploadTokenPayloadSchema
>;
export type MasterDataTokenPayload = z.infer<
  typeof MasterDataTokenPayloadSchema
>;
export type AssetUploadTokenPayload = z.infer<
  typeof AssetUploadTokenPayloadSchema
>;
export type FleetSnapshotTokenPayload = z.infer<
  typeof FleetSnapshotTokenPayloadSchema
>;
export type SokuSpeedTokenPayload = z.infer<
  typeof SokuSpeedTokenPayloadSchema
>;
export type BattleDataTokenPayload = z.infer<
  typeof BattleDataTokenPayloadSchema
>;