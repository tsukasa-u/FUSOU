import { z } from "zod";

export const AssetKeyRowSchema = z
  .object({ key: z.string().min(1) })
  .passthrough();

export type AssetKeyRow = z.infer<typeof AssetKeyRowSchema>;

export function parseAssetKeyRows(value: unknown): AssetKeyRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const parsed = AssetKeyRowSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export const AssetContentHashRowSchema = z
  .object({ content_hash: z.string().nullable().optional() })
  .passthrough();

export const AssetHashLookupRowSchema = z
  .object({
    key: z.string().min(1),
    size: z.number().nonnegative(),
    uploaded_at: z.number().finite(),
  })
  .passthrough();

const SpriteAtlasNumberSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : value,
  z.number().finite(),
);

const SpriteAtlasFrameSchema = z
  .object({
    frame: z
      .object({
        x: SpriteAtlasNumberSchema,
        y: SpriteAtlasNumberSchema,
        w: SpriteAtlasNumberSchema,
        h: SpriteAtlasNumberSchema,
      })
      .passthrough(),
  })
  .passthrough();

export const SpriteAtlasSchema = z
  .object({
    frames: z.record(SpriteAtlasFrameSchema),
    meta: z
      .object({
        size: z
          .object({
            w: SpriteAtlasNumberSchema,
            h: SpriteAtlasNumberSchema,
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export const CacheClearKeysSchema = z.array(z.string().min(1));

export const ShipBannerMapCacheSchema = z
  .object({ banners: z.record(z.string(), z.string()) })
  .passthrough();

export const ShipCardMapCacheSchema = z
  .object({ cards: z.record(z.string(), z.string()) })
  .passthrough();

export const ShipIconMapCacheSchema = z
  .object({ icons: z.record(z.string(), z.string()) })
  .passthrough();

export const EquipImageMapCacheSchema = z
  .object({
    card: z.record(z.string(), z.string()),
    item_on: z.record(z.string(), z.string()),
    item_up: z.record(z.string(), z.string()),
  })
  .passthrough();
