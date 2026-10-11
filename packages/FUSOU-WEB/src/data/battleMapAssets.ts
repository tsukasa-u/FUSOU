export type BattleMapAsset = {
  mapKey: string;
  mapUrl: string;
  dataUrl: string;
  spriteUrl: string;
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
  // Backward compatibility optional properties
  origUrl?: string;
  infoUrl?: string;
  imageMetaUrl?: string;
  labelsUrl?: string;
  routesUrl?: string;
  spriteUrls?: {
    light?: string;
    dark?: string;
  };
};

const battleMapAssets: Record<string, BattleMapAsset> = {};

function parseMapKey(mapKey: string): { mapAreaId: number; mapInfoNo: number } | null {
  const matched = /^([1-9]\d*)-([1-9]\d*)$/.exec(mapKey);
  if (!matched) return null;
  const mapAreaId = Number(matched[1]);
  const mapInfoNo = Number(matched[2]);
  if (!Number.isFinite(mapAreaId) || !Number.isFinite(mapInfoNo)) return null;
  return { mapAreaId, mapInfoNo };
}

/**
 * Maps that do not provide background landmass/island image assets
 * (e.g., 3-5 where the red sea gradient makes land extraction noisy).
 * Cell spots, labels, routes, and radii are still fully supported via data.json.
 */
const MAPS_WITHOUT_IMAGE = new Set<string>(["3-5", "6-3", "6-4"]);

function buildConventionAsset(mapKey: string): BattleMapAsset | null {
  const parsed = parseMapKey(mapKey);
  if (!parsed) return null;

  const basePath = `/battle-maps/${mapKey}`;
  const hasImage = !MAPS_WITHOUT_IMAGE.has(mapKey);
  const mapUrl = hasImage ? `${basePath}/${mapKey}_map.png` : "";
  const dataUrl = `${basePath}/data.json`;

  return {
    mapKey,
    mapUrl,
    dataUrl,
    spriteUrl: mapUrl,
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
    infoUrl: dataUrl,
    imageMetaUrl: dataUrl,
    labelsUrl: dataUrl,
    routesUrl: dataUrl,
    spriteUrls: {
      light: mapUrl,
      dark: mapUrl,
    },
  };
}

export function getBattleMapAsset(mapKey: string | null | undefined): BattleMapAsset | null {
  if (!mapKey) return null;
  const asset = battleMapAssets[mapKey] ?? buildConventionAsset(mapKey);
  return asset;
}

export type BattleMapTheme = "light" | "dark";

export function resolveBattleMapSpriteUrl(
  asset: BattleMapAsset,
  _theme?: BattleMapTheme,
): string {
  return asset.mapUrl || asset.spriteUrl;
}
