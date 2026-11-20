import { z } from "zod";

export const AssetKeyRowSchema = z
  .looseObject({ key: z.string().min(1) });

export type AssetKeyRow = z.infer<typeof AssetKeyRowSchema>;

export function parseAssetKeyRows(value: unknown): AssetKeyRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    const parsed = AssetKeyRowSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export const AssetContentHashRowSchema = z
  .looseObject({ content_hash: z.string().nullable().optional() });

export const AssetHashLookupRowSchema = z
  .looseObject({
    key: z.string().min(1),
    size: z.number().nonnegative(),
    uploaded_at: z.number(),
  });

const SpriteAtlasNumberSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : value,
  z.number(),
);

const SpriteAtlasFrameSchema = z
  .looseObject({
    frame: z
      .looseObject({
        x: SpriteAtlasNumberSchema,
        y: SpriteAtlasNumberSchema,
        w: SpriteAtlasNumberSchema,
        h: SpriteAtlasNumberSchema,
      }),
  });

export const SpriteAtlasSchema = z
  .looseObject({
    frames: z.record(z.string(), SpriteAtlasFrameSchema),
    meta: z
      .looseObject({
        size: z
          .looseObject({
            w: SpriteAtlasNumberSchema,
            h: SpriteAtlasNumberSchema,
          }),
      }),
  });

export const CacheClearKeysSchema = z.array(z.string().min(1));

export const ShipBannerMapCacheSchema = z
  .looseObject({ banners: z.record(z.string(), z.string()) });

export const ShipCardMapCacheSchema = z
  .looseObject({ cards: z.record(z.string(), z.string()) });

export const ShipIconMapCacheSchema = z
  .looseObject({ icons: z.record(z.string(), z.string()) });

export const EquipImageMapCacheSchema = z
  .looseObject({
    card: z.record(z.string(), z.string()),
    item_on: z.record(z.string(), z.string()),
    item_up: z.record(z.string(), z.string()),
  });
