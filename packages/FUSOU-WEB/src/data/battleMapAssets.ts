export type BattleMapAsset = {
  mapKey: string;
  spriteUrl: string;
  spriteUrls?: {
    light?: string;
    dark?: string;
  };
  infoUrl: string;
  imageMetaUrl: string;
  labelsUrl?: string;
  spriteSheetSize: {
    width: number;
    height: number;
  };
  routeLayoutFrame: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  seaMapFrame: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

const battleMapAssets: Record<string, BattleMapAsset> = {};

type ImportedImageModule = string | { src: string };

const mapOutputLightEntries = import.meta.glob(
  "/src/assets/map/output/*_light.png",
  {
    eager: true,
    import: "default",
  },
) as Record<string, ImportedImageModule>;

const mapOutputDarkEntries = import.meta.glob(
  "/src/assets/map/output/*_dark.png",
  {
    eager: true,
    import: "default",
  },
) as Record<string, ImportedImageModule>;

const mapOutputSpriteEntries: Record<string, string> = {};

for (const [path, mod] of Object.entries({
  ...mapOutputLightEntries,
  ...mapOutputDarkEntries,
})) {
  const resolvedUrl = typeof mod === "string" ? mod : mod?.src;
  if (!resolvedUrl) continue;
  mapOutputSpriteEntries[path] = resolvedUrl;
}

const mapOutputSpritesByMapKey = new Map<
  string,
  {
    light?: string;
    dark?: string;
  }
>();

for (const [path, url] of Object.entries(mapOutputSpriteEntries)) {
  const matched = /\/([0-9]+-[0-9]+)_(light|dark)\.png$/.exec(path);
  if (!matched) continue;
  const mapKey = matched[1];
  const mode = matched[2] as "light" | "dark";
  const current = mapOutputSpritesByMapKey.get(mapKey) ?? {};
  current[mode] = url;
  mapOutputSpritesByMapKey.set(mapKey, current);
}

function parseMapKey(
  mapKey: string,
): { mapAreaId: number; mapInfoNo: number } | null {
  const matched = /^([1-9]\d*)-([1-9]\d*)$/.exec(mapKey);
  if (!matched) return null;
  const mapAreaId = Number(matched[1]);
  const mapInfoNo = Number(matched[2]);
  if (!Number.isFinite(mapAreaId) || !Number.isFinite(mapInfoNo)) return null;
  return { mapAreaId, mapInfoNo };
}

function buildConventionAsset(mapKey: string): BattleMapAsset | null {
  const parsed = parseMapKey(mapKey);
  if (!parsed) return null;

  const suffix = String(parsed.mapInfoNo).padStart(2, "0");
  const basePath = `/battle-maps/${mapKey}`;
  const outputSprites = mapOutputSpritesByMapKey.get(mapKey);
  const publicSprites = {
    light: `${basePath}/${mapKey}_light.png`,
    dark: `${basePath}/${mapKey}_dark.png`,
  };
  const resolvedSpriteUrl =
    outputSprites?.light ?? outputSprites?.dark ?? publicSprites.light;

  // Frame values are replaced at runtime when image metadata is loaded.
  return {
    mapKey,
    spriteUrl: resolvedSpriteUrl,
    spriteUrls: {
      light: outputSprites?.light ?? publicSprites.light,
      dark: outputSprites?.dark ?? publicSprites.dark,
    },
    infoUrl: `${basePath}/${suffix}_info.json`,
    imageMetaUrl: `${basePath}/${suffix}_image.json`,
    labelsUrl: `${basePath}/cell_labels.json`,
    spriteSheetSize: {
      width: 1200,
      height: 720,
    },
    routeLayoutFrame: {
      x: 0,
      y: 0,
      width: 1200,
      height: 720,
    },
    seaMapFrame: {
      x: 0,
      y: 0,
      width: 1200,
      height: 720,
    },
  };
}

export function getBattleMapAsset(
  mapKey: string | null | undefined,
): BattleMapAsset | null {
  if (!mapKey) return null;
  return battleMapAssets[mapKey] ?? buildConventionAsset(mapKey);
}

export type BattleMapTheme = "light" | "dark";

export function resolveBattleMapSpriteUrl(
  asset: BattleMapAsset,
  theme: BattleMapTheme,
): string {
  if (theme === "dark") {
    return asset.spriteUrls?.dark ?? asset.spriteUrls?.light ?? asset.spriteUrl;
  }
  return asset.spriteUrls?.light ?? asset.spriteUrls?.dark ?? asset.spriteUrl;
}
