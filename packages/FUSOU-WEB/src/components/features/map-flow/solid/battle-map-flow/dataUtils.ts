import { type CellType } from "./constants";
import type {
  MapLabelsPayload,
  MapSpot,
  OfficialMapThemeMode,
  CurvedRouteData,
} from "./types";

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeEpochMs(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= 0) {
      return n < 1_000_000_000_000 ? n * 1000 : n;
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n < 1_000_000_000_000 ? n * 1000 : n;
}

export function formatTimestamp(ts: number | string | null | undefined): string {
  const ms = normalizeEpochMs(ts);
  if (ms === null) return "-";
  return new Date(ms).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

export function parseOfficialMapThemeMode(raw: unknown): OfficialMapThemeMode {
  return raw === "light" || raw === "dark" || raw === "auto" ? raw : "auto";
}

export function mapKeyOf(rec?: Record<string, unknown> | {
  maparea_id?: number | string | null;
  mapinfo_no?: number | string | null;
  mapAreaId?: number | string | null;
  mapInfoNo?: number | string | null;
  map_area_id?: number | string | null;
  map_info_no?: number | string | null;
} | null): string {
  if (!rec) return "unknown";
  const raw = rec as Record<string, unknown>;
  const explicitKey = raw["mapKey"] ?? raw["map_key"] ?? raw["map"];
  if (typeof explicitKey === "string" && /^\d+-\d+$/.test(explicitKey.trim())) {
    return explicitKey.trim();
  }
  const area = Number(raw["maparea_id"] ?? raw["mapAreaId"] ?? raw["map_area_id"]);
  const info = Number(raw["mapinfo_no"] ?? raw["mapInfoNo"] ?? raw["map_info_no"]);
  if (!Number.isFinite(area) || area <= 0) return "unknown";
  if (!Number.isFinite(info) || info <= 0) return "unknown";
  return `${area}-${info}`;
}

export function compareNullableTimestamps(
  left: number | string | null | undefined,
  right: number | string | null | undefined,
  direction: "asc" | "desc" = "asc",
): number {
  const leftMs = normalizeEpochMs(left);
  const rightMs = normalizeEpochMs(right);
  const leftValid = leftMs !== null;
  const rightValid = rightMs !== null;
  if (!leftValid) {
    return !rightValid ? 0 : 1;
  }
  if (!rightValid) return -1;
  return direction === "asc" ? leftMs - rightMs : rightMs - leftMs;
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
  if (!Array.isArray(cells) || cells.length === 0) return [];
  const normalizedCells = cells.map(Number).filter(Number.isFinite);
  if (normalizedCells.length === 0) return [];
  if (!Array.isArray(ports) || ports.length === 0) return normalizedCells;
  const normalizedPorts = ports.map(Number).filter(Number.isFinite);
  if (normalizedPorts.length === 0) return normalizedCells;

  const firstCell = normalizedCells[0]!;
  const firstPort = normalizedPorts[0]!;
  const firstCellSpot = spots.find((spot) => Number(spot.cellId) === firstCell);
  // If first cell is already a port or cell 0, do not prepend another port
  if (firstCell === 0 || normalizedPorts.includes(firstCell) || firstCellSpot?.isPort) return normalizedCells;

  // 1. If route connections are known, find port with a direct route to/from firstCell (ID or coordinate match)
  if (routes && routes.length > 0) {
    for (const r of routes) {
      const rFrom = Number(r.from);
      const rTo = Number(r.to);
      if (!Number.isFinite(rFrom) || !Number.isFinite(rTo)) continue;
      // Forward direction: from port to firstCell
      if (normalizedPorts.includes(rFrom)) {
        if (rTo === firstCell) return [rFrom, ...normalizedCells];
        if (firstCellSpot) {
          const toSpot = spots.find((spot) => Number(spot.cellId) === rTo);
          if (toSpot && Math.hypot(toSpot.x - firstCellSpot.x, toSpot.y - firstCellSpot.y) < 18) {
            return [rFrom, ...normalizedCells];
          }
        }
      }
      // Reverse direction: from firstCell to port (data inverted)
      if (normalizedPorts.includes(rTo)) {
        if (rFrom === firstCell) return [rTo, ...normalizedCells];
        if (firstCellSpot) {
          const fromSpot = spots.find((spot) => Number(spot.cellId) === rFrom);
          if (fromSpot && Math.hypot(fromSpot.x - firstCellSpot.x, fromSpot.y - firstCellSpot.y) < 18) {
            return [rTo, ...normalizedCells];
          }
        }
      }
    }
  }

  if (normalizedPorts.length === 1) {
    return [firstPort, ...normalizedCells];
  }
  if (!firstCellSpot) {
    return [firstPort, ...normalizedCells];
  }

  let nearestPort = firstPort;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const portCellId of normalizedPorts) {
    const portSpot = spots.find((spot) => Number(spot.cellId) === portCellId);
    if (!portSpot) continue;
    const dx = firstCellSpot.x - portSpot.x;
    const dy = firstCellSpot.y - portSpot.y;
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPort = portCellId;
    }
  }

  return [nearestPort, ...normalizedCells];
}

export function cellLabel(
  cellId: number | string,
  labels: Record<number | string, string> | undefined,
  ports?: number[],
): string {
  const id = Number(cellId);
  if (!Number.isFinite(id)) return "-";
  const normalizedPorts = ports?.map(Number).filter(Number.isFinite) ?? [];

  // 1. 出撃地点（ポート）は数値（id === 0 または ports 配列に含まれる）で一意に決定
  if (id === 0 || normalizedPorts.includes(id)) {
    if (normalizedPorts.length > 1 && normalizedPorts.includes(id)) {
      const idx = normalizedPorts.indexOf(id);
      return idx >= 0 ? `${idx + 1}` : "1";
    }
    return "1";
  }

  // 2. 公式ラベル（例: "A", "B", "J" 等）を返す
  const custom = labels?.[id] ?? labels?.[String(id)];
  if (custom) return custom;

  // 3. 未定義の場合はアルファベットにフォールバック
  return alphaCellFallbackLabel(id);
}

export function cellOverlayLabel(
  cellId: number | string,
  labels: Record<number | string, string> | undefined,
  ports?: number[],
): string {
  return cellLabel(cellId, labels, ports);
}

export function alphaCellLabel(cellId: number | string): string {
  const id = Number(cellId);
  if (!Number.isFinite(id) || id <= 0) return "-";
  let n = Math.floor(id);
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
function normalizeDateString(dateStr: string): string {
  const trimmed = dateStr.trim().replace(/\//g, "-");
  if (!trimmed) return "";
  const dateOnly = trimmed.split(/[T\s]/)[0] ?? trimmed;
  const parts = dateOnly.split("-");
  if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
    const y = parts[0].padStart(4, "0");
    const m = parts[1].padStart(2, "0");
    const d = parts[2].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return dateOnly;
}

export function isWithinDateRange(
  timestamp: number | string | null | undefined,
  startDateStr: string,
  endDateStr: string,
): boolean {
  const start = normalizeDateString(startDateStr);
  const end = normalizeDateString(endDateStr);
  if (!start && !end) return true;
  const ms = normalizeEpochMs(timestamp);
  if (ms === null) return false;

  const jstTime = new Date(ms + 9 * 60 * 60 * 1000);
  const yyyy = jstTime.getUTCFullYear();
  const mm = String(jstTime.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jstTime.getUTCDate()).padStart(2, "0");
  const battleDate = `${yyyy}-${mm}-${dd}`;

  if (start && battleDate < start) return false;
  if (end && battleDate > end) return false;
  return true;
}

export function parseMapRoutesPayload(payload: unknown): CurvedRouteData[] {
  if (!Array.isArray(payload)) return [];
  const result: CurvedRouteData[] = [];
  for (const item of payload) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const from = Number(rec["from"]);
    const to = Number(rec["to"]);
    const startX = Number(rec["startX"]);
    const startY = Number(rec["startY"]);
    const ctrlX = Number(rec["ctrlX"]);
    const ctrlY = Number(rec["ctrlY"]);
    const endX = Number(rec["endX"]);
    const endY = Number(rec["endY"]);

    if (
      Number.isFinite(from) &&
      Number.isFinite(to) &&
      Number.isFinite(startX) &&
      Number.isFinite(startY) &&
      Number.isFinite(ctrlX) &&
      Number.isFinite(ctrlY) &&
      Number.isFinite(endX) &&
      Number.isFinite(endY)
    ) {
      result.push({
        routeId: Number(rec["routeId"] ?? 0),
        from,
        to,
        startX,
        startY,
        ctrlX,
        ctrlY,
        endX,
        endY,
        curvature: Number(rec["curvature"] ?? 0),
        isArrow: Boolean(rec["isArrow"]),
      });
    }
  }
  return result;
}

export function parseMapLabelsPayload(value: unknown): MapLabelsPayload | null {
  if (!isJsonRecord(value)) return null;
  const target = isJsonRecord(value["labels"]) ? (value["labels"] as Record<string, unknown>) : value;
  const labels: MapLabelsPayload = {};
  for (const [key, label] of Object.entries(target)) {
    if (typeof label === "string") labels[key] = label;
  }
  return labels;
}

export function isPortCell(
  label?: string | null,
  cellIds?: number[],
  ports?: number[],
  isPort?: boolean,
): boolean {
  // 1. スポットデータのフラグによる直接判定（データ側で isPort === true の場合）
  if (isPort) return true;

  // 2. セルIDによる厳密な数値判定（cellId が 0、または海域の ports 配列に合致）
  if (cellIds && Array.isArray(cellIds)) {
    const normCellIds = cellIds.map(Number).filter(Number.isFinite);
    if (normCellIds.includes(0)) return true;
    if (ports && Array.isArray(ports)) {
      const normPorts = ports.map(Number).filter(Number.isFinite);
      if (normCellIds.some((id) => normPorts.includes(id))) return true;
    }
  }

  // 3. 出撃地点番号（純粋数字 "1", "2" 等）による判定
  // 通常セルはアルファベット（A〜Z）であり、純粋数字ラベルになるのは出撃地点のみ
  const cleanLabel = (label ?? "").trim();
  if (/^\d+$/.test(cleanLabel)) {
    return true;
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

  // 2. 戦闘実績のあるセルは赤色表示（ユーザー指定の絶対仕様）
  const didFight =
    typeof battleCount === "number" ? battleCount > 0 : Boolean(hasBattle);

  if (didFight) {
    return "battle";
  }

  // 3. 通過されていないマス、戦闘のないマスはすべて非戦闘色（灰色）
  return "empty";
}

export function buildAliasCellMap(
  spots: Array<{ cellId: number; x: number; y: number }>,
): Map<number, number[]> {
  const coordMap = new Map<string, number[]>();
  for (const spot of spots) {
    const key = `${spot.x}:${spot.y}`;
    const list = coordMap.get(key) || [];
    list.push(spot.cellId);
    coordMap.set(key, list);
  }
  const aliasMap = new Map<number, number[]>();
  for (const list of coordMap.values()) {
    if (list.length > 1) {
      for (const id of list) {
        aliasMap.set(id, list);
      }
    }
  }
  return aliasMap;
}

export function findBattleForCell<T>(
  cellId: number,
  battlesByCell: Map<number, T[]>,
  aliasMap?: Map<number, number[]>,
): T | undefined {
  const direct = battlesByCell.get(cellId);
  if (direct && direct.length > 0) {
    return direct.shift();
  }
  if (aliasMap) {
    const aliases = aliasMap.get(cellId);
    if (aliases) {
      for (const aliasId of aliases) {
        if (aliasId === cellId) continue;
        const aliasList = battlesByCell.get(aliasId);
        if (aliasList && aliasList.length > 0) {
          return aliasList.shift();
        }
      }
    }
  }
  return undefined;
}
