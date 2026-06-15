/**
 * Shared ship-growth related types and utility functions.
 * Used by both simulator-details-catalog (detail panels) and simulator-renderer (fleet cards).
 */

export type ShipGrowthSummary = {
  ok: boolean;
  periods?: Array<{ period_tag: string; table_version: string }>;
};

export type ShipGrowthCaps = {
  master_id: number;
  kaihi_max?: number;
  taisen_max?: number;
  sakuteki_max?: number;
  kaih_max?: number;
  tais_max?: number;
  saku_max?: number;
};

export type NormalizedShipGrowthCaps = {
  master_id: number;
  kaihi_max: number;
  taisen_max: number;
  sakuteki_max: number;
};

export type ShipGrowthBoundRow = {
  master_id?: number;
  lv: number;
  kaihi_naked: number;
  taisen_naked: number;
  sakuteki_naked: number;
};

export type ShipGrowthBoundsResponse = {
  caps?: ShipGrowthCaps[];
  bounds?: ShipGrowthBoundRow[];
  updated_at?: number;
  updated_at_iso?: string | null;
};

export function normalizeShipGrowthCaps(
  raw: ShipGrowthCaps | null,
): NormalizedShipGrowthCaps | null {
  if (!raw) return null;
  return {
    master_id: raw.master_id,
    kaihi_max: Number(raw.kaihi_max ?? raw.kaih_max ?? 0),
    taisen_max: Number(raw.taisen_max ?? raw.tais_max ?? 0),
    sakuteki_max: Number(raw.sakuteki_max ?? raw.saku_max ?? 0),
  };
}

export function deriveShipGrowthCapsFromBounds(
  masterId: number,
  bounds: ShipGrowthBoundRow[],
): NormalizedShipGrowthCaps | null {
  if (!Array.isArray(bounds) || bounds.length === 0) return null;

  const kaihiMax = Math.max(
    0,
    ...bounds.map((row) => Number(row.kaihi_naked || 0)),
  );
  const taisenMax = Math.max(
    0,
    ...bounds.map((row) => Number(row.taisen_naked || 0)),
  );
  const sakutekiMax = Math.max(
    0,
    ...bounds.map((row) => Number(row.sakuteki_naked || 0)),
  );

  return {
    master_id: masterId,
    kaihi_max: kaihiMax,
    taisen_max: taisenMax,
    sakuteki_max: sakutekiMax,
  };
}

export function mergeShipGrowthCaps(
  primary: NormalizedShipGrowthCaps | null,
  fallback: NormalizedShipGrowthCaps | null,
): NormalizedShipGrowthCaps | null {
  if (!primary && !fallback) return null;
  if (!primary) return fallback;
  if (!fallback) return primary;

  return {
    master_id: primary.master_id,
    kaihi_max: primary.kaihi_max > 0 ? primary.kaihi_max : fallback.kaihi_max,
    taisen_max:
      primary.taisen_max > 0 ? primary.taisen_max : fallback.taisen_max,
    sakuteki_max:
      primary.sakuteki_max > 0 ? primary.sakuteki_max : fallback.sakuteki_max,
  };
}

export function needsStatFallback(value: number[] | null | undefined): boolean {
  if (!Array.isArray(value) || value.length === 0) return true;
  return value.every((v) => !Number.isFinite(v) || v <= 0);
}
