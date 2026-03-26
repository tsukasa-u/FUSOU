import type {
  BattleRecord,
  BattleResultData,
  FrameRect,
  MapFrameMeta,
  MapImageMetaPayload,
  MapSpot,
  OfficialMapThemeMode,
  RouteSpriteFrame,
} from "./types";

export function formatTimestamp(ts: number | null): string {
  if (!ts) return "-";
  return new Date(ts).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export function parseOfficialMapThemeMode(raw: unknown): OfficialMapThemeMode {
  return raw === "light" || raw === "dark" || raw === "auto" ? raw : "auto";
}

export function mapKeyOf(rec: { maparea_id?: number | null; mapinfo_no?: number | null }): string {
  if (!rec.maparea_id || !rec.mapinfo_no) return "0-0";
  return `${rec.maparea_id}-${rec.mapinfo_no}`;
}

export function normalizeEpochMs(value: number | null | undefined): number | null {
  if (!value || !Number.isFinite(value)) return null;
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

export function resolveBattleResult(
  raw: BattleRecord["battle_result"],
  battleResultByUuid: Map<string, BattleResultData>,
): BattleResultData | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    return battleResultByUuid.get(raw) ?? null;
  }
  if (typeof raw === "object" && raw.win_rank) {
    return { win_rank: raw.win_rank, drop_ship_id: raw.drop_ship_id ?? null };
  }
  return null;
}

/**
 * Prepends the nearest port cell to `cells` if not already present.
 * Pure function — callers must pass the relevant port/spot arrays from signal state.
 */
export function resolveRouteCellsWithPort(
  cells: number[],
  ports: number[],
  spots: MapSpot[],
): number[] {
  if (cells.length === 0) return cells;
  if (ports.length === 0) return cells;
  if (ports.includes(cells[0])) return cells;

  if (ports.length === 1) {
    return [ports[0], ...cells];
  }

  const firstCellSpot = spots.find((spot) => spot.cellId === cells[0]);
  if (!firstCellSpot) {
    return [ports[0], ...cells];
  }

  let nearestPort = ports[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const portCellId of ports) {
    const portSpot = spots.find((spot) => spot.cellId === portCellId);
    if (!portSpot) continue;
    const dx = firstCellSpot.x - portSpot.x;
    const dy = firstCellSpot.y - portSpot.y;
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPort = portCellId;
    }
  }

  return [nearestPort, ...cells];
}

export function cellLabel(
  cellId: number,
  labels: Record<number, string> | undefined,
): string {
  if (!Number.isFinite(cellId)) return "-";
  const custom = labels?.[cellId];
  if (custom) return custom;
  if (cellId === 0) return "港";
  return alphaCellFallbackLabel(cellId);
}

export function cellOverlayLabel(
  cellId: number,
  labels: Record<number, string> | undefined,
): string {
  if (!Number.isFinite(cellId)) return "-";
  const custom = labels?.[cellId];
  if (custom) return custom;
  if (cellId === 0) return "港";
  return alphaCellFallbackLabel(cellId);
}

function alphaCellFallbackLabel(cellId: number): string {
  if (!Number.isFinite(cellId) || cellId <= 0) return "-";
  let n = Math.floor(cellId);
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

export function parseFrameRect(value: unknown): FrameRect | null {
  if (!value || typeof value !== "object") return null;
  const frame = value as { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
  const x = Number(frame.x ?? NaN);
  const y = Number(frame.y ?? NaN);
  const width = Number(frame.w ?? NaN);
  const height = Number(frame.h ?? NaN);
  if (![x, y, width, height].every((num) => Number.isFinite(num))) return null;
  return { x, y, width, height };
}

export function parseMapFrameMeta(payload: MapImageMetaPayload): MapFrameMeta | null {
  const frames = payload.frames || {};
  const frameEntries = Object.entries(frames)
    .map(([key, frameObj]) => ({ key, rect: parseFrameRect(frameObj.frame) }))
    .filter((entry): entry is { key: string; rect: FrameRect } => !!entry.rect);

  if (frameEntries.length === 0) return null;

  const routeCandidate =
    frameEntries.find((entry) => /_point$/i.test(entry.key)) ||
    frameEntries.find((entry) => /point/i.test(entry.key));
  const seaCandidate =
    frameEntries.find((entry) => /_map\d+-\d+$/i.test(entry.key)) ||
    frameEntries.find((entry) => /_map(?!.*point)/i.test(entry.key));

  if (!routeCandidate || !seaCandidate) return null;

  const routeFrames: Record<number, RouteSpriteFrame> = {};
  for (const entry of frameEntries) {
    const matched = /_route_(\d+)$/i.exec(entry.key);
    if (!matched) continue;
    const routeId = Number(matched[1]);
    if (!Number.isFinite(routeId)) continue;
    routeFrames[routeId] = { ...entry.rect, routeId };
  }

  const sheetW = Number(payload.meta?.size?.w ?? NaN);
  const sheetH = Number(payload.meta?.size?.h ?? NaN);
  const spriteSheetSize =
    Number.isFinite(sheetW) && Number.isFinite(sheetH)
      ? { width: sheetW, height: sheetH }
      : {
          width: Math.max(...frameEntries.map((entry) => entry.rect.x + entry.rect.width)),
          height: Math.max(...frameEntries.map((entry) => entry.rect.y + entry.rect.height)),
        };

  return {
    spriteSheetSize,
    routeLayoutFrame: routeCandidate.rect,
    seaMapFrame: seaCandidate.rect,
    routeFrames,
  };
}
