/** @jsxImportSource solid-js */
import { EmptyState } from "@/components/common/solid/EmptyState";
import { LoadingState } from "@/components/common/solid/LoadingState";
import { MapAreaGrid } from "@/components/common/solid/MapAreaGrid";
import { createSignal, createMemo, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import type { SharedDashboardState } from "../../battles/solid/types";
import { getBattleMapAsset, resolveBattleMapSpriteUrl } from "@/data/battleMapAssets";
import { mapKeyOf, cellLabel as pureCellLabel, parseMapRoutesPayload, resolveCellType, isWithinDateRange } from "../../map-flow/solid/battle-map-flow/dataUtils";
import { inferRouteOverlays } from "../../map-flow/solid/battle-map-flow/routeInference";
import { ensureMapLabelsFor, resolveMapCellLabel } from "../../map-flow/solid/battle-map-flow/mapLabelCache";
import {
  MAP_TRIM_PADDING,
  MAP_VIEWBOX_WIDTH,
  MAP_VIEWBOX_HEIGHT,
  CANDIDATE_ROUTE_STROKE_WIDTH,
  CANDIDATE_ROUTE_DASH_ARRAY,
  CANDIDATE_ROUTE_OPACITY,
  CANDIDATE_ROUTE_COLOR,
  BASE_CELL_MARKER_RADIUS,
  SELECTED_CELL_MARKER_RADIUS,
  CELL_HITBOX_RADIUS,
  CELL_STROKE_WIDTH,
  CELL_SELECTED_STROKE_WIDTH,
  CELL_BADGE_SIZE,
  CELL_BADGE_RADIUS,
  CELL_BADGE_FONT_SIZE,
  LABEL_FONT_SIZE,
  CELL_COLOR_THEMES,
  DARK_EMPTY_CELL_FILL,
  DARK_EMPTY_CELL_STROKE,
  DARK_EMPTY_CELL_TEXT,
  MAP_SEA_BG_LIGHT,
  MAP_SEA_BG_DARK,
  MAP_AIRBASE_DATA,
} from "../../map-flow/solid/battle-map-flow/constants";
import { battleResultOf } from "../../map-flow/solid/battle-map-flow/recordParsers";
import type {
  InferredRouteOverlay,
  CurvedRouteData,
  BattleRecord,
} from "../../map-flow/solid/battle-map-flow/types";

import { STYPE_NAMES } from "@/features/simulator/constants";
import {
  resolveMapAreaName,
  resolveMapInfoName,
} from "@/features/battles/map-labels";

type MapSpot = { cellId: number; x: number; y: number; isPort?: boolean; lineOffsetX?: number; lineOffsetY?: number };
type JsonRecord = Record<string, unknown>;
type MapAreaRecord = { id: string | number; name: string };
type MapInfoRecord = { maparea_id: string | number; no: string | number; name: string };

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMapAreaRecord(value: unknown): value is MapAreaRecord {
  if (!isJsonRecord(value)) return false;
  return (
    (typeof value["id"] === "string" || typeof value["id"] === "number") &&
    typeof value["name"] === "string"
  );
}

function isMapInfoRecord(value: unknown): value is MapInfoRecord {
  if (!isJsonRecord(value)) return false;
  return (
    (typeof value["maparea_id"] === "string" || typeof value["maparea_id"] === "number") &&
    (typeof value["no"] === "string" || typeof value["no"] === "number") &&
    typeof value["name"] === "string"
  );
}

function recordsMatching<T>(payload: unknown, predicate: (value: unknown) => value is T): T[] {
  if (!isJsonRecord(payload) || !Array.isArray(payload["records"])) return [];
  return payload["records"].filter(predicate);
}



import { ShipDropCard } from "./ShipDropCard";


export default function BattleDropsPanel(props: { dashboardState: SharedDashboardState }) {
  const d = props.dashboardState;

  const getDocTheme = (): "light" | "dark" => {
    if (typeof document === "undefined") return "light";
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark") return "dark";
    if (attr === "light") return "light";
    if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  };
  const [currentTheme, setCurrentTheme] = createSignal<"light" | "dark">(getDocTheme());

  onMount(() => {
    setCurrentTheme(getDocTheme());
    const observer = new MutationObserver(() => {
      setCurrentTheme(getDocTheme());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    onCleanup(() => observer.disconnect());
  });

  const isDark = () => currentTheme() === "dark";

  const [mapSpots, setMapSpots] = createSignal<MapSpot[]>([]);
  const [mapLabels, setMapLabels] = createSignal<Record<number, string>>({});
  const [mapRoutes, setMapRoutes] = createSignal<CurvedRouteData[]>([]);
  const [mapPorts, setMapPorts] = createSignal<number[]>([]);
  const [selectedCellId, setSelectedCellId] = createSignal<number | null>(null);
  const [mapDataLoading, setMapDataLoading] = createSignal<boolean>(false);
  const [mapDataFailed, setMapDataFailed] = createSignal<boolean>(false);
  const [imageLoaded, setImageLoaded] = createSignal<boolean>(false);
  const [imageFailed, setImageFailed] = createSignal<boolean>(false);

  const [mstMapareas, setMstMapareas] = createSignal<MapAreaRecord[]>([]);
  const [mstMapinfos, setMstMapinfos] = createSignal<MapInfoRecord[]>([]);

  createEffect(() => {
    fetch("/api/master-data/json?table_name=mst_map_area")
      .then(res => res.json())
      .then((payload: unknown) => setMstMapareas(recordsMatching(payload, isMapAreaRecord)))
      .catch(() => {});
    fetch("/api/master-data/json?table_name=mst_map_info")
      .then(res => res.json())
      .then((payload: unknown) => setMstMapinfos(recordsMatching(payload, isMapInfoRecord)))
      .catch(() => {});
  });

  const getAreaName = (areaIdStr: string) => {
    const fromApi = mstMapareas().find(m => String(m.id) === areaIdStr);
    if (fromApi?.name) return fromApi.name;
    const areaId = Number(areaIdStr);
    return Number.isFinite(areaId) && areaId > 0
      ? resolveMapAreaName(areaId)
      : `第${areaIdStr}海域`;
  };

  const getMapInfoName = (mapKey: string) => {
    const [area, no] = mapKey.split("-");
    if (area === undefined || no === undefined) return resolveMapInfoName(mapKey);
    const fromApi = mstMapinfos().find(m => String(m.maparea_id) === area && String(m.no) === no);
    if (fromApi?.name) return fromApi.name;
    return resolveMapInfoName(mapKey);
  };

  createEffect(() => {
    // Reset selection and image states when map changes
    setSelectedCellId(null);
    setImageLoaded(false);
    setImageFailed(false);
    const mapKey = d.mapFilter();
    if (!mapKey) {
      setMapSpots([]);
      setMapLabels({});
            setMapRoutes([]);
      setMapPorts([]);
      setMapDataLoading(false);
      setMapDataFailed(false);
      return;
    }
    const asset = getBattleMapAsset(mapKey);
    if (!asset) {
      setMapSpots([]);
      setMapLabels({});
            setMapRoutes([]);
      setMapPorts([]);
      setMapDataLoading(false);
      setMapDataFailed(true);
      return;
    }

    setMapDataLoading(true);
    setMapDataFailed(false);

    const targetUrl = asset.dataUrl || asset.infoUrl;
    if (!targetUrl) {
      setMapDataLoading(false);
      return;
    }
    fetch(targetUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((payload: unknown) => {
        if (d.mapFilter() !== mapKey) return;
        const data = isJsonRecord(payload) ? payload : {};
        const rawSpots = Array.isArray(data["spots"]) ? data["spots"] : [];
        const spots: MapSpot[] = rawSpots
          .map((value: unknown): MapSpot | null => {
            const s = isJsonRecord(value) ? value : null;
            if (!s) return null;
            const line = isJsonRecord(s["line"]) ? s["line"] : {};
            const cellId = Number(s["no"]);
            const x = Number(s["x"]);
            const y = Number(s["y"]);
            if (!Number.isFinite(cellId) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
            const lineOffsetX = Number(line["x"] ?? NaN);
            const lineOffsetY = Number(line["y"] ?? NaN);
            const spot: MapSpot = {
              cellId,
              x,
              y,
              ...(s["isPort"] === true ? { isPort: true } : {}),
              ...(Number.isFinite(lineOffsetX) ? { lineOffsetX } : {}),
              ...(Number.isFinite(lineOffsetY) ? { lineOffsetY } : {}),
            };
            return spot;
          })
          .filter((s): s is MapSpot => s !== null);

        const labels: Record<number, string> = {};
        if (isJsonRecord(data["labels"])) {
          for (const [k, v] of Object.entries(data["labels"])) {
            labels[Number(k)] = String(v);
          }
        }

        const rawPorts = Array.isArray(data["ports"])
          ? (data["ports"] as unknown[]).map((p) => Number(p)).filter(Number.isFinite)
          : [];
        const detectedPorts = rawPorts.length > 0
          ? rawPorts
          : spots.filter((s) => s.isPort || s.cellId === 0 || typeof s.lineOffsetX !== "number").map((s) => s.cellId);
        setMapPorts(Array.from(new Set(detectedPorts.length > 0 ? detectedPorts : [0])));

        if (Array.isArray(data["routes"])) {
          setMapRoutes(parseMapRoutesPayload(data["routes"]));
        } else {
          setMapRoutes([]);
        }

        setMapSpots(spots);
                setMapLabels(labels);
        setMapDataFailed(spots.length === 0);
      })
      .catch(() => {
        if (d.mapFilter() !== mapKey) return;
        setMapSpots([]);
        setMapLabels({});
        setMapRoutes([]);
        setMapPorts([]);
        setMapDataFailed(true);
      })
      .finally(() => {
        if (d.mapFilter() === mapKey) {
          setMapDataLoading(false);
        }
      });
  });

  const getCellLabel = (cellId: number) => {
    return pureCellLabel(cellId, mapLabels(), mapPorts());
  };
  const groupedMapSpots = createMemo(() => {
    const spots = mapSpots();
    const ports = mapPorts();
    const map = new Map<string, { key: string; cellId: number; cellIds: number[]; x: number; y: number; label: string; isPort?: boolean }>();
    for (const spot of spots) {
      const label = getCellLabel(spot.cellId);
      const coordKey = `${spot.x}:${spot.y}`;
      const isPort = Boolean(spot.isPort) || ports.includes(spot.cellId) || spot.cellId === 0;
      const existing = map.get(coordKey);
      if (existing) {
        if (!existing.cellIds.includes(spot.cellId)) {
          existing.cellIds.push(spot.cellId);
        }
        if (isPort) existing.isPort = true;
      } else {
        map.set(coordKey, {
          key: coordKey,
          cellId: spot.cellId,
          cellIds: [spot.cellId],
          x: spot.x,
          y: spot.y,
          label,
          isPort,
        });
      }
    }
    return [...map.values()];
  });


  const mstShipInfoById = createMemo(() => {
    return new Map(d.mstShips().map((ship) => [ship.id, { name: String(ship.name || ""), stype: Number(ship.stype || 0), backs: Number(ship.backs || 1) }]));
  });

  // 戦闘レコードに海域IDが無い場合の補完用（cellRecords は非同期で届くため必ず memo として参照する）
  const mapKeyLookup = createMemo(() => {
    const b2m = new Map<string, string>();
    const e2m = new Map<string, string>();
    for (const c of d.cellRecords()) {
      const mk = mapKeyOf(c);
      if (mk === "unknown" || mk === "-") continue;
      if (c.env_uuid) {
        e2m.set(c.env_uuid, mk);
      }
      if (c.battles) {
        if (Array.isArray(c.battles)) {
          c.battles.forEach((u: string) => b2m.set(u, mk));
        } else if (typeof c.battles === "string") {
          b2m.set(c.battles, mk);
        }
      }
    }
    return { battleToMap: b2m, envToMap: e2m };
  });

  const resolveMapKeyForBattle = (b: BattleRecord): string => {
    const direct = mapKeyOf(b);
    if (direct !== "unknown" && direct !== "-") return direct;
    const { battleToMap, envToMap } = mapKeyLookup();
    const byBattle = b.uuid ? battleToMap.get(b.uuid) : undefined;
    if (byBattle) return byBattle;
    const byEnv = b.env_uuid ? envToMap.get(b.env_uuid) : undefined;
    if (byEnv) return byEnv;
    return "unknown";
  };

  const allDrops = createMemo(() => {
    return d.battleRecords()
      .map((r) => ({ record: r, result: battleResultOf(r) }))
      .filter((entry) => {
        if (!entry.result?.drop_ship_id) return false;
        if (d.resultFilter() && entry.result.win_rank !== d.resultFilter()) return false;
        const start = d.startDate().trim();
        const end = d.endDate().trim();
        if ((start || end) && !isWithinDateRange(entry.record.timestamp, start, end)) return false;
        return true;
      })
      .map((r) => {
        const shipId = r.result!.drop_ship_id!;
        const info = mstShipInfoById().get(shipId);
        const name = info?.name || `艦#${shipId}`;
        const stype = info?.stype || 0;
        const backs = info?.backs || 1;
        const mapKey = resolveMapKeyForBattle(r.record);
        const winRank = r.result!.win_rank || "不明";
        return {
          id: r.record.uuid || `${r.record.timestamp}-${shipId}`,
          shipId,
          stype,
          backs,
          shipName: name,
          mapKey,
          cellId: Number(r.record.cell_id ?? NaN),
          timestamp: r.record.timestamp,
          winRank,
        };
      })
      .filter((drop) => {
        const query = d.searchQuery().trim().toLowerCase();
        if (!query) return true;
        const name = drop.shipName.toLowerCase();
        const map = drop.mapKey.toLowerCase();
        return name.includes(query) || map.includes(query);
      })
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  });

  const totalBattlesPerMapCell = createMemo(() => {
    const counts = new Map<string, number>();
    const start = d.startDate().trim();
    const end = d.endDate().trim();
    const resultF = d.resultFilter();
    for (const b of d.battleRecords()) {
      if (resultF && battleResultOf(b)?.win_rank !== resultF) continue;
      if ((start || end) && !isWithinDateRange(b.timestamp, start, end)) continue;
      const mk = resolveMapKeyForBattle(b);
      const cellId = Number(b.cell_id ?? NaN);
      if (mk !== "-" && Number.isFinite(cellId)) {
        const key = `${mk}:${cellId}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return counts;
  });

  const dropsInSelectedMap = createMemo(() => {
    const filter = d.mapFilter();
    if (!filter) return [];
    return allDrops().filter((d) => d.mapKey === filter);
  });

  const mapDropsByCell = createMemo(() => {
    const grouped = new Map<number, { shipId: number; shipName: string; count: number }[]>();
    for (const drop of dropsInSelectedMap()) {
      let list = grouped.get(drop.cellId);
      if (!list) {
        list = [];
        grouped.set(drop.cellId, list);
      }
      const existing = list.find((i) => i.shipId === drop.shipId);
      if (existing) existing.count++;
      else list.push({ shipId: drop.shipId, shipName: drop.shipName, count: 1 });
    }
    // Sort descending by count
    for (const list of grouped.values()) {
      list.sort((a, b) => b.count - a.count);
    }
    return grouped;
  });

  const mapAsset = createMemo(() => getBattleMapAsset(d.mapFilter()));

  const inferredRoutes = createMemo((): InferredRouteOverlay[] => {
    const spots = mapSpots();
    const routes = mapRoutes();
    if (spots.length === 0) return [];
    return inferRouteOverlays(spots, undefined, [], routes);
  });
  const resolvedSpriteUrl = createMemo(() => {
    const asset = mapAsset();
    if (!asset) return null;
    return resolveBattleMapSpriteUrl(asset, "light"); // Simplified theme logic
  });

  const selectedSpot = createMemo(() => {
    const cid = selectedCellId();
    if (cid === null) return null;
    return groupedMapSpots().find((s) => s.cellIds.includes(cid)) ?? null;
  });

  const selectedCellIds = createMemo((): Set<number> => {
    const spot = selectedSpot();
    if (!spot) return new Set();
    return new Set(spot.cellIds);
  });

  const selectedCellDrops = createMemo(() => {
    const spot = selectedSpot();
    if (!spot) return dropsInSelectedMap();
    const ids = selectedCellIds();
    return dropsInSelectedMap().filter((d) => ids.has(d.cellId));
  });

  const totalBattlesInMapScope = createMemo(() => {
    const mapFilter = d.mapFilter();
    if (!mapFilter) return 1;
    const ids = selectedCellIds();
    const hasCellFilter = ids.size > 0;
    const start = d.startDate().trim();
    const end = d.endDate().trim();
    const resultF = d.resultFilter();
    return Math.max(1, d.battleRecords().filter(r => {
      if (resolveMapKeyForBattle(r) !== mapFilter) return false;
      if (hasCellFilter && !ids.has(Number(r.cell_id ?? NaN))) return false;
      if (resultF && battleResultOf(r)?.win_rank !== resultF) return false;
      if ((start || end) && !isWithinDateRange(r.timestamp, start, end)) return false;
      return true;
    }).length);
  });

  const mapDropsGroupedByStype = createMemo(() => {
    const drops = selectedCellDrops();
    const groupedByStype = new Map<number, typeof drops>();
    for (const drop of drops) {
      let list = groupedByStype.get(drop.stype);
      if (!list) {
        list = [];
        groupedByStype.set(drop.stype, list);
      }
      list.push(drop);
    }
    const result = [...groupedByStype.entries()].map(([stype, stypeDrops]) => {
      const uniqueShips = [...new Map(stypeDrops.map(d => [d.shipId, d])).values()].sort((a,b) => a.shipName.localeCompare(b.shipName, "ja"));
      return {
        stype,
        stypeName: STYPE_NAMES[stype] || `艦種 ${stype}`,
        uniqueShips,
      };
    });
    return result.sort((a, b) => a.stype - b.stype);
  });

  const allMapDropsOverview = createMemo(() => {
    const drops = allDrops();
    const mapStats = new Map<string, { totalDrops: number }>();
    for (const drop of drops) {
      if (!mapStats.has(drop.mapKey)) {
        mapStats.set(drop.mapKey, { totalDrops: 0 });
      }
      mapStats.get(drop.mapKey)!.totalDrops++;
    }
    
    const grouped = new Map<string, { areaId: string; maps: { mapKey: string; drops: number }[]; totalAreaDrops: number }>();
    for (const [mapKey, stats] of mapStats.entries()) {
      if (mapKey === "-" || mapKey === "unknown") continue;
      const areaId = mapKey.split("-")[0];
      if (areaId === undefined) continue;
      if (!grouped.has(areaId)) {
        grouped.set(areaId, { areaId, maps: [], totalAreaDrops: 0 });
      }
      const g = grouped.get(areaId)!;
      g.maps.push({ mapKey, drops: stats.totalDrops });
      g.totalAreaDrops += stats.totalDrops;
    }
    
    const result = [...grouped.values()].sort((a, b) => {
      return Number(a.areaId) - Number(b.areaId);
    });
    for (const area of result) {
      area.maps.sort((a, b) => {
        const [, aNum] = a.mapKey.split("-").map(Number);
        const [, bNum] = b.mapKey.split("-").map(Number);
        return (aNum || 0) - (bNum || 0);
      });
    }
    return result;
  });

  const filteredOverallBattles = createMemo(() => {
    const start = d.startDate().trim();
    const end = d.endDate().trim();
    const resultF = d.resultFilter();
    if (!start && !end && !resultF) return Math.max(1, d.battleRecords().length);
    return Math.max(1, d.battleRecords().filter(r => {
      if (resultF && battleResultOf(r)?.win_rank !== resultF) return false;
      if ((start || end) && !isWithinDateRange(r.timestamp, start, end)) return false;
      return true;
    }).length);
  });

  const [viewMode, setViewMode] = createSignal<"map" | "ship">("map");

  // 艦別表示では海域ごとの公式マス名が必要（エイリアス cell_id を同一マスに統合するため）
  createEffect(() => {
    if (viewMode() !== "ship") return;
    ensureMapLabelsFor(allDrops().map((drop) => drop.mapKey));
  });

  /** 海域+公式マス名ごとの戦闘数（エイリアス cell_id を合算） */
  const totalBattlesPerMapLabel = createMemo(() => {
    const counts = new Map<string, number>();
    for (const [key, count] of totalBattlesPerMapCell()) {
      const sep = key.lastIndexOf(":");
      const mk = key.slice(0, sep);
      const cid = Number(key.slice(sep + 1));
      const labelKey = `${mk}:${resolveMapCellLabel(mk, cid)}`;
      counts.set(labelKey, (counts.get(labelKey) || 0) + count);
    }
    return counts;
  });

  // Global grouping for when NO map is selected
  const dropsGroupedByStype = createMemo(() => {
    const groupedByStype = new Map<number, { shipId: number; shipName: string; backs: number; drops: { mapKey: string; label: string; count: number; winRanks: Record<string, number> }[] }[]>();
    for (const drop of allDrops()) {
      let stypeList = groupedByStype.get(drop.stype);
      if (!stypeList) {
        stypeList = [];
        groupedByStype.set(drop.stype, stypeList);
      }
      let info = stypeList.find(s => s.shipId === drop.shipId);
      if (!info) {
        info = { shipId: drop.shipId, shipName: drop.shipName, backs: drop.backs, drops: [] };
        stypeList.push(info);
      }
      const label = resolveMapCellLabel(drop.mapKey, drop.cellId);
      const loc = info.drops.find((l) => l.mapKey === drop.mapKey && l.label === label);
      if (loc) {
        loc.count++;
        loc.winRanks[drop.winRank] = (loc.winRanks[drop.winRank] || 0) + 1;
      } else {
        info.drops.push({ mapKey: drop.mapKey, label, count: 1, winRanks: { [drop.winRank]: 1 } });
      }
    }
    const result = [...groupedByStype.entries()].map(([stype, ships]) => {
      return {
        stype,
        stypeName: STYPE_NAMES[stype] || `艦種 ${stype}`,
        ships: ships.sort((a, b) => a.shipId - b.shipId)
      };
    });
    return result.sort((a, b) => a.stype - b.stype);
  });


  const panelTitle = createMemo(() => {
    if (viewMode() === "ship") return "全ドロップ履歴 (艦別)";
    return d.mapFilter() ? "ドロップマップ" : "海域を選択";
  });

  
  const panelSubtitle = createMemo(() => {
    if (viewMode() === "ship") return "ドロップ歴のあるすべての艦を一覧表示しています。";
    return d.mapFilter()
      ? "セルをクリックすると、そのマスでドロップした艦に絞り込みます。赤いセルは戦闘実績があるマスです。"
      : "ドロップ履歴のある海域一覧です。クリックして詳細なドロップ情報を確認できます。";
  });

  return (
    <div class="space-y-6">
      <div class="fusou-card">
        <div class="fusou-card-body">
          <div class="flex items-start justify-between mb-4">
            <div>
              <h3 class="card-title text-lg">{panelTitle()}</h3>
              <div class="text-xs text-base-content/60 mt-1">
                {panelSubtitle()}
              </div>
            </div>
            <div 
              class="relative flex items-center bg-base-200 rounded-md p-1 cursor-pointer select-none w-64 shadow-inner"
              onClick={() => setViewMode(viewMode() === "map" ? "ship" : "map")}
            >
              <div 
                class="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-primary rounded-md transition-transform duration-300 ease-in-out"
                style={{ transform: viewMode() === "map" ? "translateX(0)" : "translateX(100%)" }}
              />
              <div class={`relative z-10 flex-1 text-center text-sm px-2 py-1.5 transition-colors duration-300 ${viewMode() === "map" ? "font-bold text-primary-content" : "text-base-content/60 hover:text-primary-content"}`}>
                海域から探す
              </div>
              <div class={`relative z-10 flex-1 text-center text-sm px-2 py-1.5 transition-colors duration-300 ${viewMode() === "ship" ? "font-bold text-primary-content" : "text-base-content/60 hover:text-primary-content"}`}>
                艦から探す
              </div>
            </div>
          </div>

          <Show when={viewMode() === "ship"}>
            <div class="space-y-6">
              <For each={dropsGroupedByStype()}>
                {(group) => (
                  <div>
                    <h4 class="font-bold text-sm text-base-content/80 mb-2 border-b border-base-200 pb-1">
                      {group.stypeName}
                    </h4>
                    <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                      <For each={group.ships}>
                        {(ship) => {
                          const maxCount = Math.max(...ship.drops.map(d => d.count));
                          const shipTotalDrops = ship.drops.reduce((sum, d) => sum + d.count, 0);
                          const overallRate = ((shipTotalDrops / filteredOverallBattles()) * 100).toFixed(2) + "%";

                          const dropLocs = [...ship.drops].sort((a, b) => b.count - a.count).map(loc => {
                            const pct = Math.max(2, (loc.count / maxCount) * 100);
                            const totalAtLoc = totalBattlesPerMapLabel().get(`${loc.mapKey}:${loc.label}`) || 0;
                            const dropRate = totalAtLoc > 0 ? ((loc.count / totalAtLoc) * 100).toFixed(1) + "%" : "-";
                            const ranksStr = Object.entries(loc.winRanks).map(([r, c]) => `${r}:${c}`).join(" ");
                            return {
                              label: `${loc.mapKey}-${loc.label}`,
                              dropRateStr: dropRate,
                              ranksStr,
                              count: loc.count,
                              pct
                            };
                          });

                          return (
                            <ShipDropCard
                              shipId={ship.shipId}
                              shipName={ship.shipName}
                              backs={ship.backs}
                              overallRateLabel="全体ドロップ率"
                              overallRateStr={overallRate}
                              overallCount={shipTotalDrops}
                              dropLocs={dropLocs}
                            />
                          );
                        }}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={viewMode() === "map"}>
            <Show when={d.mapFilter()} fallback={
              <div class="space-y-6">
                <Show when={allMapDropsOverview().length > 0} fallback={<EmptyState size="compact" message="ドロップ履歴がありません" />}>
                  <MapAreaGrid
                    groups={allMapDropsOverview()}
                    onSelect={(mapKey: string) => d.setMapFilter(mapKey)}
                    getAreaName={getAreaName}
                    getMapName={getMapInfoName}
                  />
                </Show>
              </div>
            }>

              <Show
                when={!mapDataLoading() && (!d.loading() || mapDataFailed())}
                fallback={<LoadingState message="マップデータを読み込んでいます..." minHeight="h-64" />}
              >
                <Show
                  when={!mapDataFailed() && mapAsset() && mapSpots().length > 0 ? mapAsset() : null}
                  fallback={
                    <EmptyState
                      message="マップデータを読み込めませんでした"
                      description="この海域のマップデータが見つからないか、読み込みに失敗しました。"
                      minHeight="h-64"
                    />
                  }
                >
                  {(asset) => (
                  <div class="space-y-4">
                    <div class="flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-200 p-3 text-sm">
                      <div class="flex items-center gap-2">
                        
                      </div>
                    </div>

                    <div
                      class={`rounded-box overflow-hidden border border-base-300 ${isDark() ? "bg-[#18181b]" : "bg-[#f1f5f9]"} shadow-inner`}
                      style={`aspect-ratio: ${MAP_VIEWBOX_WIDTH} / ${MAP_VIEWBOX_HEIGHT}; width: 100%;`}
                    >
                      <svg
                        viewBox={`${MAP_TRIM_PADDING} ${MAP_TRIM_PADDING} ${MAP_VIEWBOX_WIDTH} ${MAP_VIEWBOX_HEIGHT}`}
                        class="w-full h-auto block"
                      >
                        <defs>
                          <marker
                            id="drops-route-arrow"
                            markerWidth="18"
                            markerHeight="16"
                            refX="6"
                            refY="8"
                            orient="auto"
                            markerUnits="userSpaceOnUse"
                          >
                            <path d="M 2 2 L 16 8 L 2 14 L 6 8 Z" fill="#10b981" />
                          </marker>
                        </defs>
                        {/* 海の背景（マップ進行と完全に色調を統一） */}
                        <rect
                          x="0"
                          y="0"
                          width={asset().routeLayoutFrame.width}
                          height={asset().routeLayoutFrame.height}
                          fill={isDark() ? MAP_SEA_BG_DARK : MAP_SEA_BG_LIGHT}
                        />
                        <Show when={resolvedSpriteUrl()}>
                          <image
                            href={resolvedSpriteUrl()!}
                            x={-asset().seaMapFrame.x}
                            y={-asset().seaMapFrame.y}
                            width={asset().spriteSheetSize.width}
                            height={asset().spriteSheetSize.height}
                            preserveAspectRatio="none"
                            style={{
                              opacity: imageLoaded() ? "0.96" : "0",
                              transition: "opacity 0.3s ease-in",
                            }}
                            onLoad={() => {
                              setImageLoaded(true);
                              setImageFailed(false);
                            }}
                            onError={() => {
                              setImageLoaded(false);
                              setImageFailed(true);
                            }}
                          />
                        </Show>

                        <Show when={imageFailed()}>
                          <g>
                            <rect
                              x="20"
                              y="20"
                              width="348"
                              height="30"
                              rx="8"
                              fill="#eff6ff"
                              opacity="0.95"
                              stroke="#93c5fd"
                              stroke-width="1.5"
                            />
                            <text
                              x="32"
                              y="35"
                              fill="#1d4ed8"
                              font-size="12"
                              font-weight="700"
                              dominant-baseline="middle"
                            >
                              海域画像を読み込めませんでした。
                            </text>
                          </g>
                        </Show>

                        {/* 公式準拠の破線矢印による進行経路候補（曲線パス対応） */}
                        <For each={inferredRoutes()}>
                          {(route) => {
                            const d = () => route.pathD || `M ${route.renderFromX} ${route.renderFromY} L ${route.renderToX} ${route.renderToY}`;
                            return (
                              <g>
                                <path
                                  d={d()}
                                  stroke={CANDIDATE_ROUTE_COLOR}
                                  stroke-width={CANDIDATE_ROUTE_STROKE_WIDTH}
                                  stroke-dasharray={CANDIDATE_ROUTE_DASH_ARRAY}
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  fill="none"
                                  opacity={CANDIDATE_ROUTE_OPACITY}
                                  marker-end={route.isArrow ? "url(#drops-route-arrow)" : undefined}
                                />
                              </g>
                            );
                          }}
                        </For>

                        {/* セル円＋インラインラベル（ボスマス外側二重丸・港文字非表示） */}
                        <For each={groupedMapSpots()}>
                          {(spot) => {
                            const isSelected = () => spot.cellIds.includes(selectedCellId() ?? -999);
                            const battleCount = () =>
                              spot.cellIds.reduce(
                                (sum, cid) =>
                                  sum + (totalBattlesPerMapCell().get(`${d.mapFilter()}:${cid}`) || 0),
                                0,
                              );
                            const hasBattle = () => battleCount() > 0;
                            const cellType = () =>
                              resolveCellType(
                                spot.label,
                                d.mapFilter(),
                                hasBattle(),
                                spot.cellIds,
                                battleCount(),
                                battleCount(),
                                mapPorts(),
                                spot.isPort,
                              );
                            const theme = () => CELL_COLOR_THEMES[cellType()];
                            const r = () => (isSelected() ? SELECTED_CELL_MARKER_RADIUS : BASE_CELL_MARKER_RADIUS);

                            const isDarkEmpty = () => isDark() && cellType() === "empty";
                            const fill = () => (isDarkEmpty() ? DARK_EMPTY_CELL_FILL : theme().fill);
                            const stroke = () => {
                              if (isSelected()) return "#ea580c";
                              if (isDarkEmpty()) return DARK_EMPTY_CELL_STROKE;
                              return theme().stroke;
                            };
                            const strokeWidth = () => (isSelected() ? CELL_SELECTED_STROKE_WIDTH : CELL_STROKE_WIDTH);
                            const textFill = () => {
                              if (isSelected()) return "#9a3412";
                              if (isDarkEmpty()) return DARK_EMPTY_CELL_TEXT;
                              return theme().textFill;
                            };

                            return (
                              <g
                                class="cursor-pointer"
                                onClick={() => setSelectedCellId(isSelected() ? null : spot.cellId)}
                              >
                                <title>{`${spot.label}: ${theme().label}`}</title>
                                  {/* クリック領域拡張 */}
                                <circle cx={spot.x} cy={spot.y} r={CELL_HITBOX_RADIUS} fill="transparent" />
                                {/* セル円（ボスマスも通常の戦闘マスと同じ単一円） */}
                                <circle
                                  cx={spot.x}
                                  cy={spot.y}
                                  r={r()}
                                  fill={fill()}
                                  stroke={stroke()}
                                  stroke-width={strokeWidth()}
                                  class="transition-all"
                                />
                                {/* セルラベル（港マスも含めて表示し、複数港も識別可能に） */}
{(() => {
                                  const displayLabel = () => {
                                    const lbl = getCellLabel(spot.cellId);
                                    if (cellType() === "port" || spot.isPort) {
                                      return lbl || "1";
                                    }
                                    return lbl || "-";
                                  };
                                  return (
                                    <text
                                      x={spot.x}
                                      y={spot.y + 4}
                                      text-anchor="middle"
                                      font-size={displayLabel().length > 2 ? "10" : LABEL_FONT_SIZE}
                                      font-weight="bold"
                                      fill={textFill()}
                                      style={{ "pointer-events": "none" }}
                                    >
                                      {displayLabel()}
                                    </text>
                                  );
                                })()}
                              </g>
                            );
                          }}
                        </For>

                        {/* ドロップ件数バッジ（最前面レイヤー：以前のドロップ画面のシンプルで美しい円形バッジに統一） */}
                        <For each={groupedMapSpots()}>
                          {(spot) => {
                            const drops = () => spot.cellIds.flatMap((cid) => mapDropsByCell().get(cid) || []);
                            const totalCount = () => drops().reduce((sum, d) => sum + d.count, 0);
                            const isSelected = () => spot.cellIds.includes(selectedCellId() ?? -999);
                            const battleCount = () =>
                              spot.cellIds.reduce(
                                (sum, cid) =>
                                  sum + (totalBattlesPerMapCell().get(`${d.mapFilter()}:${cid}`) || 0),
                                0,
                              );
                            const hasBattle = () => battleCount() > 0;
                            const cellType = () =>
                              resolveCellType(
                                spot.label,
                                d.mapFilter(),
                                hasBattle(),
                                spot.cellIds,
                                battleCount(),
                                battleCount(),
                                mapPorts(),
                                spot.isPort,
                              );
                            const r = () => (isSelected() ? SELECTED_CELL_MARKER_RADIUS : BASE_CELL_MARKER_RADIUS);

                            return (
                              <Show when={totalCount() > 0 && cellType() !== "port"}>
                                <g
                                  transform={`translate(${spot.x + r() - 4}, ${spot.y - r() + 4})`}
                                  style={{ "pointer-events": "none" }}
                                >
                                  <rect
                                    x={-CELL_BADGE_RADIUS}
                                    y={-CELL_BADGE_RADIUS}
                                    width={CELL_BADGE_SIZE}
                                    height={CELL_BADGE_SIZE}
                                    rx={CELL_BADGE_RADIUS}
                                    fill="#e11d48"
                                  />
                                  <text
                                    x="0"
                                    y="3"
                                    text-anchor="middle"
                                    font-size={CELL_BADGE_FONT_SIZE}
                                    font-weight="bold"
                                    fill="white"
                                  >
                                    {totalCount()}
                                  </text>
                                </g>
                              </Show>
                            );
                          }}
                        </For>
                        {/* 基地航空隊：航空基地マーカー（✕印） */}
                        <Show when={MAP_AIRBASE_DATA[d.mapFilter()]}>
                          <For each={MAP_AIRBASE_DATA[d.mapFilter()]!.bases}>
                            {(base) => (
                              <g
                                transform={`translate(${base.x}, ${base.y})`}
                                style={{ "pointer-events": "none" }}
                              >
                                {/* 公式表記 "AB"（丸で囲わない） */}
                                <text
                                  x="0"
                                  y="-2"
                                  text-anchor="middle"
                                  font-size="13"
                                  font-weight="900"
                                  fill={isDark() ? "#f8fafc" : "#0f172a"}
                                  stroke={isDark() ? "#18181b" : "#ffffff"}
                                  stroke-width="2.5"
                                  paint-order="stroke"
                                  letter-spacing="0.5"
                                >
                                  AB
                                </text>
                                {/* その下の灰色のバツ印（✕） */}
                                <g stroke="#94a3b8" stroke-width="2.4" stroke-linecap="round">
                                  <line x1="-5.5" y1="4" x2="5.5" y2="15" />
                                  <line x1="-5.5" y1="15" x2="5.5" y2="4" />
                                </g>
                              </g>
                            )}
                          </For>
                        </Show>

                        {/* 各セルの右下：航空基地の届く距離（戦闘行動半径） */}
                        <Show when={MAP_AIRBASE_DATA[d.mapFilter()]}>
                          <For each={groupedMapSpots()}>
                            {(spot) => {
                              const distance = () =>
                                MAP_AIRBASE_DATA[d.mapFilter()]?.distances[spot.label];
                              const isSelected = () => spot.cellIds.includes(selectedCellId() ?? -999);
                              const r = () => (isSelected() ? SELECTED_CELL_MARKER_RADIUS : BASE_CELL_MARKER_RADIUS);

                              return (
                                <Show when={distance() !== undefined}>
                                  <g
                                    transform={`translate(${spot.x + r() - 3}, ${spot.y + r() - 1})`}
                                    style={{ "pointer-events": "none" }}
                                  >
                                    <rect
                                      x="-7"
                                      y="-6"
                                      width="14"
                                      height="12"
                                      rx="3"
                                      fill="#0f172a"
                                      opacity="0.85"
                                    />
                                    <text
                                      x="0"
                                      y="3"
                                      text-anchor="middle"
                                      font-size="8.5"
                                      font-weight="bold"
                                      fill="#38bdf8"
                                    >
                                      {distance()}
                                    </text>
                                  </g>
                                </Show>
                              );
                            }}
                          </For>
                        </Show>
                      </svg>
                    </div>
                  </div>
                )}
                </Show>
              </Show>

              <div class="mt-6 border-t border-base-200 pt-6">
                <h3 class="font-bold text-base mb-3">
                  {selectedSpot() ? `${selectedSpot()!.label}マスのドロップ` : '海域全体のドロップ'}
                </h3>
                <div class="space-y-6 mt-3">
                  <Show when={mapDropsGroupedByStype().length > 0} fallback={<EmptyState size="compact" message="ドロップ履歴がありません" />}>
                    <For each={mapDropsGroupedByStype()}>
                      {(group) => (
                        <div>
                          <h4 class="font-bold text-sm text-base-content/80 mb-2 border-b border-base-200 pb-1">
                            {group.stypeName}
                          </h4>
                          <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            <For each={group.uniqueShips}>
                              {(uniqueDrop) => {
                                const dropsForShip = selectedCellDrops().filter(x => x.shipId === uniqueDrop.shipId);
                                const count = dropsForShip.length;
                                const overallRate = ((count / totalBattlesInMapScope()) * 100).toFixed(2) + "%";
                                
                                const spotByCid = new Map<number, { label: string; cellIds: number[] }>();
                                for (const s of groupedMapSpots()) {
                                  for (const cid of s.cellIds) {
                                    spotByCid.set(cid, { label: s.label, cellIds: s.cellIds });
                                  }
                                }

                                const groupedBySpot = new Map<string, { label: string; cellIds: number[]; count: number; winRanks: Record<string, number> }>();
                                for (const d of dropsForShip) {
                                  const spotInfo = spotByCid.get(d.cellId);
                                  const key = spotInfo ? spotInfo.label : String(d.cellId);
                                  const label = spotInfo ? spotInfo.label : getCellLabel(d.cellId);
                                  const cellIds = spotInfo ? spotInfo.cellIds : [d.cellId];
                                  if (!groupedBySpot.has(key)) {
                                    groupedBySpot.set(key, { label, cellIds, count: 0, winRanks: {} });
                                  }
                                  const g = groupedBySpot.get(key)!;
                                  g.count++;
                                  g.winRanks[d.winRank] = (g.winRanks[d.winRank] || 0) + 1;
                                }

                                const dropLocs = [...groupedBySpot.values()]
                                  .map(loc => {
                                    const pct = Math.max(2, (loc.count / count) * 100);
                                    const totalAtLoc = loc.cellIds.reduce((sum, cid) => sum + (totalBattlesPerMapCell().get(`${d.mapFilter()}:${cid}`) || 0), 0);
                                    const dropRate = totalAtLoc > 0 ? ((loc.count / totalAtLoc) * 100).toFixed(1) + "%" : "-";
                                    const ranksStr = Object.entries(loc.winRanks).map(([r, c]) => `${r}:${c}`).join(" ");
                                    return {
                                      label: `${loc.label}マス`,
                                      dropRateStr: dropRate,
                                      ranksStr,
                                      count: loc.count,
                                      pct
                                    };
                                  })
                                  .sort((a, b) => b.count - a.count);

                                return (
                                  <ShipDropCard
                                    shipId={uniqueDrop.shipId}
                                    shipName={uniqueDrop.shipName}
                                    backs={uniqueDrop.backs}
                                    overallRateLabel={selectedCellId() !== null ? "マスドロップ率" : "海域ドロップ率"}
                                    overallRateStr={overallRate}
                                    overallCount={count}
                                    dropLocs={dropLocs}
                                  />
                                );
                              }}
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
}