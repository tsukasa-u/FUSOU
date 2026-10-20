import {
  type CellType,
  MAP_BOSS_LABELS,
  MAP_RESOURCE_LABELS,
  MAP_MAELSTROM_LABELS,
  MAP_NOTHING_LABELS,
  MAP_AIR_LABELS,
  MAP_NIGHT_LABELS,
  MAP_ACTIVE_BRANCH_LABELS,
  MAP_LANDING_LABELS,
  MAP_RECON_LABELS,
} from "./constants";
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
  CurvedRouteData,
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

export function mapKeyOf(rec: {
  maparea_id?: number | null;
  mapinfo_no?: number | null;
}): string {
  if (
    rec.maparea_id === null ||
    rec.maparea_id === undefined ||
    !Number.isFinite(rec.maparea_id) ||
    rec.maparea_id <= 0
  ) {
    return "unknown";
  }
  if (
    rec.mapinfo_no === null ||
    rec.mapinfo_no === undefined ||
    !Number.isFinite(rec.mapinfo_no) ||
    rec.mapinfo_no <= 0
  ) {
    return "unknown";
  }
  return `${rec.maparea_id}-${rec.mapinfo_no}`;
}

export function normalizeEpochMs(
  value: number | null | undefined,
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value))
    return null;
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
  routes?: CurvedRouteData[],
): number[] {
  if (cells.length === 0) return cells;
  if (ports.length === 0) return cells;
  const firstCell = cells[0];
  const firstPort = ports[0];
  if (firstCell === undefined || firstPort === undefined) return cells;
  if (ports.includes(firstCell)) return cells;

  // 1. If route connections are known, find port with a direct route to firstCell (ID or coordinate match)
  if (routes && routes.length > 0) {
    const firstCellSpot = spots.find((spot) => spot.cellId === firstCell);
    const directRoute = routes.find((r) => {
      if (!ports.includes(r.from)) return false;
      if (r.to === firstCell) return true;
      if (firstCellSpot) {
        const toSpot = spots.find((spot) => spot.cellId === r.to);
        if (
          toSpot &&
          Math.hypot(toSpot.x - firstCellSpot.x, toSpot.y - firstCellSpot.y) <
            18
        ) {
          return true;
        }
      }
      return false;
    });
    if (directRoute) {
      return [directRoute.from, ...cells];
    }
  }

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
  ports?: number[],
): string {
  if (!Number.isFinite(cellId)) return "-";
  const custom = labels?.[cellId];
  if (custom && !custom.includes("港")) return custom;
  if (cellId === 0 || (ports && ports.includes(cellId))) {
    if (ports && ports.length > 1) {
      const idx = ports.indexOf(cellId);
      return idx >= 0 ? `${idx + 1}` : "1";
    }
    return "1";
  }
  return alphaCellFallbackLabel(cellId);
}

export function cellOverlayLabel(
  cellId: number,
  labels: Record<number, string> | undefined,
  ports?: number[],
): string {
  if (!Number.isFinite(cellId)) return "-";
  const custom = labels?.[cellId];
  if (custom && !custom.includes("港")) return custom;
  if (cellId === 0 || (ports && ports.includes(cellId))) {
    if (ports && ports.length > 1) {
      const idx = ports.indexOf(cellId);
      return idx >= 0 ? `${idx + 1}` : "1";
    }
    return "1";
  }
  return alphaCellFallbackLabel(cellId);
}

export function alphaCellLabel(cellId: number): string {
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

const alphaCellFallbackLabel = alphaCellLabel;

/**
 * Checks whether a timestamp (in epoch ms or s) falls within the specified date range (YYYY-MM-DD in JST).
 */
export function isWithinDateRange(
  timestamp: number | null | undefined,
  startDateStr: string,
  endDateStr: string,
): boolean {
  if (!startDateStr && !endDateStr) return true;
  if (timestamp == null || !Number.isFinite(timestamp)) return false;
  const ms = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  const jstTime = new Date(ms + 9 * 60 * 60 * 1000);
  const yyyy = jstTime.getUTCFullYear();
  const mm = String(jstTime.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jstTime.getUTCDate()).padStart(2, "0");
  const battleDate = `${yyyy}-${mm}-${dd}`;

  if (startDateStr && battleDate < startDateStr) return false;
  if (endDateStr && battleDate > endDateStr) return false;
  return true;
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
  const frames = isJsonRecord(payload["frames"]) ? payload["frames"] : {};
  const frameEntries = Object.entries(frames)
    .map(([key, frameObj]) => ({
      key,
      rect: parseFrameRect(isJsonRecord(frameObj) ? frameObj["frame"] : null),
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
    const matched = /(?:route|root|arrow|sail_(?:arrow|line))_?(\d+)$/i.exec(
      entry.key,
    );
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
          width: Math.max(
            ...frameEntries.map((entry) => entry.rect.x + entry.rect.width),
          ),
          height: Math.max(
            ...frameEntries.map((entry) => entry.rect.y + entry.rect.height),
          ),
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

export function parseMapRoutesPayload(payload: unknown): CurvedRouteData[] {
  if (!Array.isArray(payload)) return [];
  const result: CurvedRouteData[] = [];
  for (const item of payload) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>)["from"] === "number" &&
      typeof (item as Record<string, unknown>)["to"] === "number" &&
      typeof (item as Record<string, unknown>)["startX"] === "number" &&
      typeof (item as Record<string, unknown>)["startY"] === "number" &&
      typeof (item as Record<string, unknown>)["ctrlX"] === "number" &&
      typeof (item as Record<string, unknown>)["ctrlY"] === "number" &&
      typeof (item as Record<string, unknown>)["endX"] === "number" &&
      typeof (item as Record<string, unknown>)["endY"] === "number"
    ) {
      const rec = item as Record<string, unknown>;
      result.push({
        routeId: Number(rec["routeId"] ?? 0),
        from: Number(rec["from"]),
        to: Number(rec["to"]),
        startX: Number(rec["startX"]),
        startY: Number(rec["startY"]),
        ctrlX: Number(rec["ctrlX"]),
        ctrlY: Number(rec["ctrlY"]),
        endX: Number(rec["endX"]),
        endY: Number(rec["endY"]),
        curvature: Number(rec["curvature"] ?? 0),
        isArrow: Boolean(rec["isArrow"]),
      });
    }
  }
  return result;
}

export function parseMapLabelsPayload(value: unknown): MapLabelsPayload | null {
  if (!isJsonRecord(value)) return null;
  const labels: MapLabelsPayload = {};
  for (const [key, label] of Object.entries(value)) {
    if (typeof label === "string") labels[key] = label;
  }
  return labels;
}

export function isBossCell(label: string, mapKey?: string): boolean {
  if (!mapKey) return false;
  const list = MAP_BOSS_LABELS[mapKey.trim()];
  return Boolean(list && list.includes(label.trim()));
}

export function isResourceCell(label: string, mapKey?: string): boolean {
  if (!mapKey) return false;
  const list = MAP_RESOURCE_LABELS[mapKey.trim()];
  return Boolean(list && list.includes(label.trim()));
}

export function isMaelstromCell(label: string, mapKey?: string): boolean {
  if (!mapKey) return false;
  const list = MAP_MAELSTROM_LABELS[mapKey.trim()];
  return Boolean(list && list.includes(label.trim()));
}

export function isNothingCell(label: string, mapKey?: string): boolean {
  if (!mapKey) return false;
  const list = MAP_NOTHING_LABELS[mapKey.trim()];
  return Boolean(list && list.includes(label.trim()));
}

export function isAirCell(label: string, mapKey?: string): boolean {
  if (!mapKey) return false;
  const list = MAP_AIR_LABELS[mapKey.trim()];
  return Boolean(list && list.includes(label.trim()));
}

export function isNightCell(label: string, mapKey?: string): boolean {
  if (!mapKey) return false;
  const list = MAP_NIGHT_LABELS[mapKey.trim()];
  return Boolean(list && list.includes(label.trim()));
}

export function isActiveBranchCell(label: string, mapKey?: string): boolean {
  if (!mapKey) return false;
  const list = MAP_ACTIVE_BRANCH_LABELS[mapKey.trim()];
  return Boolean(list && list.includes(label.trim()));
}

export function isLandingCell(label: string, mapKey?: string): boolean {
  if (!mapKey) return false;
  const list = MAP_LANDING_LABELS[mapKey.trim()];
  return Boolean(list && list.includes(label.trim()));
}

export function isReconCell(label: string, mapKey?: string): boolean {
  if (!mapKey) return false;
  const list = MAP_RECON_LABELS[mapKey.trim()];
  return Boolean(list && list.includes(label.trim()));
}

export function isPortCell(
  label: string,
  cellIds?: number[],
  ports?: number[],
  isPort?: boolean,
): boolean {
  if (isPort) return true;
  const cleanLabel = label.trim();
  if (
    cleanLabel === "港" ||
    cleanLabel.includes("港") ||
    cleanLabel.includes("スタート")
  ) {
    return true;
  }
  if (cellIds) {
    if (cellIds.includes(0)) return true;
    if (ports && cellIds.some((id) => ports.includes(id))) return true;
  }
  return false;
}

export function resolveCellType(
  label: string,
  _mapKey?: string,
  hasBattle?: boolean,
  cellIds?: number[],
  _passCount?: number,
  battleCount?: number,
  ports?: number[],
  isPort?: boolean,
): CellType {
  // 1. 出撃港（黄色）
  if (isPortCell(label, cellIds, ports, isPort)) {
    return "port";
  }

  // 2. 通過した実績のあるマスのうち、戦闘のあるものだけ戦闘色（赤色）
  const didFight =
    typeof battleCount === "number" ? battleCount > 0 : Boolean(hasBattle);
  const didPass =
    typeof _passCount === "number"
      ? _passCount > 0
      : didFight || Boolean(hasBattle);

  if (didPass && didFight) {
    return "battle";
  }

  // 3. 通過していないマス、戦闘のないマスはすべて非戦闘色（灰色）
  return "empty";
}
