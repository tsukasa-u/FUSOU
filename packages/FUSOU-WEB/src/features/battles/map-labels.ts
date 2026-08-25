export const MAP_AREA_NAMES: Record<string, string> = {
  "1": "鎮守府海域",
  "2": "南西諸島海域",
  "3": "北方海域",
  "4": "西方海域",
  "5": "南方海域",
  "6": "中部海域",
  "7": "南西海域",
};

export const MAP_NAMES: Record<string, string> = {
  "1-1": "鎮守府正面海域",
  "1-2": "南西諸島沖",
  "1-3": "製油所地帯沿岸",
  "1-4": "南西諸島防衛線",
  "1-5": "鎮守府近海",
  "1-6": "鎮守府近海航路",
  "2-1": "南西諸島近海",
  "2-2": "バシー海峡",
  "2-3": "東部オリョール海",
  "2-4": "沖ノ島海域",
  "2-5": "沖ノ島沖",
  "3-1": "モーレイ海",
  "3-2": "キス島沖",
  "3-3": "アルフォンシーノ方面",
  "3-4": "北方海域全域",
  "3-5": "北方AL海域",
  "4-1": "ジャム島攻略作戦",
  "4-2": "カレー洋制圧戦",
  "4-3": "リランカ島空襲",
  "4-4": "カスガダマ沖海戦",
  "4-5": "カレー洋リランカ島沖",
  "5-1": "南方海域前面",
  "5-2": "珊瑚諸島沖",
  "5-3": "サブ島沖海域",
  "5-4": "サーモン海域",
  "5-5": "サーモン海域北方",
  "6-1": "中部海域哨戒線",
  "6-2": "MS諸島沖",
  "6-3": "グアノ環礁沖海域",
  "6-4": "中部北太平洋海域",
  "6-5": "KW環礁沖海域",
  "7-1": "ブルネイ泊地沖",
  "7-2": "タウイタウイ泊地沖",
  "7-3": "ペナン島沖",
  "7-4": "昭南本土航路",
};

export function resolveMapAreaName(areaId: number): string {
  return MAP_AREA_NAMES[String(areaId)] ?? `第${areaId}海域`;
}

export function resolveMapInfoName(mapKey: string): string {
  return MAP_NAMES[mapKey] ?? "";
}

export function formatMapTextByIds(mapAreaId: number, mapInfoNo: number): string {
  const mapKey = `${mapAreaId}-${mapInfoNo}`;
  const areaName = resolveMapAreaName(mapAreaId);
  const mapName = resolveMapInfoName(mapKey);
  return mapName ? `${mapKey} (${areaName} / ${mapName})` : `${mapKey} (${areaName})`;
}
