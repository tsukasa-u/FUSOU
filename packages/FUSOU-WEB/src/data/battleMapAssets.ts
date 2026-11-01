export type BattleMapAsset = {
  mapKey: string;
  dataUrl: string;
  routeLayoutFrame: {
    x: number;
    y: number;
    width: number;
    height: number;
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

function buildConventionAsset(mapKey: string): BattleMapAsset | null {
  if (!parseMapKey(mapKey)) return null;

  const basePath = `/battle-maps/${mapKey}`;

  return {
    mapKey,
    dataUrl: `${basePath}/data.json`,
    routeLayoutFrame: {
      x: 0,
      y: 0,
      width: 1200,
      height: 720,
    },
  };
}

export function getBattleMapAsset(mapKey: string | null | undefined): BattleMapAsset | null {
  if (!mapKey) return null;
  const asset = battleMapAssets[mapKey] ?? buildConventionAsset(mapKey);
  return asset;
}
