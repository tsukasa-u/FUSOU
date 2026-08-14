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

export const SpriteAtlasSchema = z
  .object({
    frames: z.record(z.unknown()),
    meta: z.record(z.unknown()),
  })
  .passthrough();

export const CacheClearKeysSchema = z.array(z.string().min(1));
