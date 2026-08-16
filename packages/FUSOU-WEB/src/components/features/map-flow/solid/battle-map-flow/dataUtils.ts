import type {
  BattleRecord,
  BattleResultData,
  FrameRect,
  MapFrameMeta,
  MapInfoPayload,
  MapLabelsPayload,
  MapSpot,
  OfficialMapThemeMode,
  RouteSpriteFrame,
} from "./types";

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumberOrNull(value: unknown): number | null {
  if (typeof value !== "number") return null;
  return Number.isFinite(value) ? value : null;
}

export function formatTimestamp(ts: number | null): string {
  if (ts === null) return "-";
  return new Date(ts).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export function parseOfficialMapThemeMode(raw: unknown): OfficialMapThemeMode {
  return raw === "light" || raw === "dark" || raw === "auto" ? raw : "auto";
}

export function mapKeyOf(rec: { maparea_id?: number | null; mapinfo_no?: number | null }): string {
  if (rec.maparea_id === null || rec.maparea_id === undefined) return "unknown";
  if (rec.mapinfo_no === null || rec.mapinfo_no === undefined) return "unknown";
  return `${rec.maparea_id}-${rec.mapinfo_no}`;
}

export function normalizeEpochMs(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

export function compareNullableTimestamps(
  left: number | null | undefined,
  right: number | null | undefined,
  direction: "asc" | "desc" = "asc",
): number {
  if (left === null || left === undefined) {
    return right === null || right === undefined ? 0 : 1;
  }
  if (right === null || right === undefined) return -1;
  return direction === "asc" ? left - right : right - left;
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
  const firstCell = cells[0];
  const firstPort = ports[0];
  if (firstCell === undefined || firstPort === undefined) return cells;
  if (ports.includes(firstCell)) return cells;

  if (ports.length === 1) {
    return [firstPort, ...cells];
  }

  const firstCellSpot = spots.find((spot) => spot.cellId === firstCell);
  if (!firstCellSpot) {
    return [firstPort, ...cells];
  }

  let nearestPort = firstPort;
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
  if (!isJsonRecord(value)) return null;
  const x = Number(value["x"] ?? NaN);
  const y = Number(value["y"] ?? NaN);
  const width = Number(value["w"] ?? NaN);
  const height = Number(value["h"] ?? NaN);
  if (![x, y, width, height].every((num) => Number.isFinite(num))) return null;
  return { x, y, width, height };
}

export function parseMapFrameMeta(payload: unknown): MapFrameMeta | null {
  if (!isJsonRecord(payload)) return null;
  const frames = isJsonRecord(payload["frames"])
    ? payload["frames"]
    : {};
  const frameEntries = Object.entries(frames)
    .map(([key, frameObj]) => ({
      key,
      rect: parseFrameRect(
        isJsonRecord(frameObj) ? frameObj["frame"] : null,
      ),
    }))
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
    const routeIdText = matched?.[1];
    if (routeIdText === undefined) continue;
    const routeId = Number(routeIdText);
    if (!Number.isFinite(routeId)) continue;
    routeFrames[routeId] = { ...entry.rect, routeId };
  }

  const meta = isJsonRecord(payload["meta"]) ? payload["meta"] : null;
  const size = meta && isJsonRecord(meta["size"]) ? meta["size"] : null;
  const sheetW = Number(size?.["w"] ?? NaN);
  const sheetH = Number(size?.["h"] ?? NaN);
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

export function parseMapInfoPayload(value: unknown): MapInfoPayload | null {
  if (!isJsonRecord(value)) return null;
  const rawSpots = value["spots"];
  if (rawSpots === undefined) return { spots: [] };
  if (!Array.isArray(rawSpots)) return null;

  return {
    spots: rawSpots.flatMap((rawSpot) => {
      if (!isJsonRecord(rawSpot)) return [];
      const line = isJsonRecord(rawSpot["line"])
        ? {
            x: finiteNumberOrNull(rawSpot["line"]["x"]),
            y: finiteNumberOrNull(rawSpot["line"]["y"]),
          }
        : null;
      return [
        {
          no: finiteNumberOrNull(rawSpot["no"]),
          x: finiteNumberOrNull(rawSpot["x"]),
          y: finiteNumberOrNull(rawSpot["y"]),
          line,
        },
      ];
    }),
  };
}

export function parseMapLabelsPayload(value: unknown): MapLabelsPayload | null {
  if (!isJsonRecord(value)) return null;
  const labels: MapLabelsPayload = {};
  for (const [key, label] of Object.entries(value)) {
    if (typeof label === "string") labels[key] = label;
  }
  return labels;
}
