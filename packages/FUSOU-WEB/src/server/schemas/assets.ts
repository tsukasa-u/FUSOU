import { z } from "zod";

export const AssetKeyRowSchema = z
  .object({ key: z.string().min(1) })
  .passthrough();

export type AssetKeyRow = z.infer<typeof AssetKeyRowSchema>;

export const AssetContentHashRowSchema = z
  .object({ content_hash: z.string().nullable().optional() })
  .passthrough();

export const SpriteAtlasSchema = z
  .object({
    frames: z.record(z.unknown()),
    meta: z.record(z.unknown()),
  })
  .passthrough();
