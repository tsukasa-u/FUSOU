/** @jsxImportSource solid-js */
import { AlertMessage } from "@/components/common/solid/AlertMessage";
import { MapAreaGrid } from "@/components/common/solid/MapAreaGrid";
import { EmptyState } from "@/components/common/solid/EmptyState";
import { LoadingState } from "@/components/common/solid/LoadingState";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import {
  type BattleMapTheme,
  getBattleMapAsset,
  resolveBattleMapSpriteUrl,
} from "@/data/battleMapAssets";
import type { SharedDashboardState } from "../../battles/solid/types";

import type {
  CurvedRouteData,
  BattleRecord,
  MapFrameMeta,
  MapSpot,
  OfficialMapThemeMode,
  OverlayMarker,
  ResolvedRouteOverlay,
  SelectedCellDetails,
  SelectedCellFilter,
  SortieRoute,
  TransitionOverlay,
} from "./battle-map-flow/types";

import {
  DEFAULT_MAP_VIEWPORT_HEIGHT_PERCENT,
  MAP_VIEWBOX_WIDTH,
  MAP_VIEWBOX_HEIGHT,
  MAX_SORTIE_ROUTES,
  ROUTE_COUNT_BADGE_HEIGHT,
  ROUTE_COUNT_BADGE_WIDTH,
  STEP_BADGE_HEIGHT,
  STEP_BADGE_WIDTH,
} from "./battle-map-flow/constants";

import {
  computeTransitionBadgePosition,
  buildSpotRenderPositions,
} from "./battle-map-flow/geometry";
import { buildAutoLabelLayouts } from "./battle-map-flow/labelLayout";
import { inferRouteOverlays } from "./battle-map-flow/routeInference";
import { buildEnemyDeckResolver } from "./battle-map-flow/enemyResolver";
import { battleResultOf as battleResultOfRecord } from "./battle-map-flow/recordParsers";
import {
  cellLabel as pureCellLabel,
  cellOverlayLabel as pureCellOverlayLabel,
  compareNullableTimestamps,
  formatTimestamp,
  mapKeyOf,
  parseMapLabelsPayload,
  parseMapRoutesPayload,
  resolveRouteCellsWithPort,
  isWithinDateRange,
  buildAliasCellMap,
  findBattleForCell,
} from "./battle-map-flow/dataUtils";
import MapSvgCanvas from "./battle-map-flow/MapSvgCanvas";
import CellDetailsPanel from "./battle-map-flow/CellDetailsPanel";
import SortieListPanel from "./battle-map-flow/SortieListPanel";
import DisplaySettingsModal from "./battle-map-flow/DisplaySettingsModal";
import {
  resolveMapAreaName,
  resolveMapInfoName,
} from "@/features/battles/map-labels";

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



export default function BattleMapFlowPanel(props: { dashboardState: SharedDashboardState }) {
  const d = props.dashboardState;
  // ── UI control signals ──────────────────────────────────────────────────────
  const [selectedSortieId, setSelectedSortieId] = createSignal("");
  const [selectedCellFilter, setSelectedCellFilter] =
    createSignal<SelectedCellFilter | null>(null);
  const [metadataWarnings, setMetadataWarnings] = createSignal<string[]>([]);
  const [showWarnings, setShowWarnings] = createSignal(false);
  const [showOfficialMapAssets, setShowOfficialMapAssets] = createSignal(true);
  const [officialMapThemeMode, setOfficialMapThemeMode] =
    createSignal<OfficialMapThemeMode>("auto");
  const getDocTheme = (): BattleMapTheme => {
    if (typeof document === "undefined") return "light";
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark") return "dark";
    if (attr === "light") return "light";
    if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  };
  const [detectedTheme, setDetectedTheme] = createSignal<BattleMapTheme>(getDocTheme());

  onMount(() => {
    setDetectedTheme(getDocTheme());
    const observer = new MutationObserver(() => {
      setDetectedTheme(getDocTheme());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    onCleanup(() => observer.disconnect());
  });

  let displaySettingsModalRef!: HTMLDialogElement;

  // ── Data signals ────────────────────────────────────────────────────────────
  const [mapSpotsByKey, setMapSpotsByKey] = createSignal<
    Record<string, MapSpot[]>
  >({});
  const [mapPortsByKey, setMapPortsByKey] = createSignal<
    Record<string, number[]>
  >({});
    const [mapRoutesByKey, setMapRoutesByKey] = createSignal<
    Record<string, CurvedRouteData[]>
  >({});
  const [mapLabelsByKey, setMapLabelsByKey] = createSignal<
    Record<string, Record<number, string>>
  >({});
  const [mapFrameMetaByKey, setMapFrameMetaByKey] = createSignal<
    Record<string, MapFrameMeta>
  >({});
  const [mapMetadataLoadingKey, setMapMetadataLoadingKey] = createSignal<string | null>(null);
  const [mapMetadataFailedKey, setMapMetadataFailedKey] = createSignal<string | null>(null);
  const pendingMetadataLoads = new Map<string, Promise<void>>();

  let mapMetadataAbortController: AbortController | null = null;

  // ── Master data for area/map names ─────────────────────────────────────────
  const [mstMapareas, setMstMapareas] = createSignal<MapAreaRecord[]>([]);
  const [mstMapinfos, setMstMapinfos] = createSignal<MapInfoRecord[]>([]);

  onMount(() => {
    fetch("/api/master-data/json?table_name=mst_map_area")
      .then((res) => res.json())
      .then((payload: unknown) => setMstMapareas(recordsMatching(payload, isMapAreaRecord)))
      .catch(() => {});
    fetch("/api/master-data/json?table_name=mst_map_info")
      .then((res) => res.json())
      .then((payload: unknown) => setMstMapinfos(recordsMatching(payload, isMapInfoRecord)))
      .catch(() => {});

    const openSettings = () => displaySettingsModalRef.showModal();
    window.addEventListener("map-flow-open-display-settings", openSettings);
    onCleanup(() => window.removeEventListener("map-flow-open-display-settings", openSettings));
  });

  // ── Helper closures (depend on signal state) ────────────────────────────────

  function addMetadataWarning(message: string) {
    setMetadataWarnings((prev) =>
      prev.includes(message) ? prev : [...prev, message],
    );
  }

  function toggleCellFilter(next: SelectedCellFilter) {
    setSelectedCellFilter((current) => {
      if (current?.key === next.key && current.mapKey === next.mapKey)
        return null;
      return next;
    });
  }

  /** Returns the display label for a cell (e.g. "1", "D"). */
  function cellLabel(cellId: number, mapKey?: string): string {
    const key = mapKey ?? selectedSortieRoute()?.mapKey;
    return pureCellLabel(
      cellId,
      key ? mapLabelsByKey()[key] : undefined,
      key ? mapPortsByKey()[key] : undefined,
    );
  }

  /** Returns the short overlay label for a cell (e.g. "1", "D"). */
  function cellOverlayLabel(cellId: number, mapKey: string): string {
    return pureCellOverlayLabel(
      cellId,
      mapLabelsByKey()[mapKey],
      mapPortsByKey()[mapKey],
    );
  }

  function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
  }

  // ── Map metadata loading ────────────────────────────────────────────────────

  async function ensureMapMetadata(mapKey: string): Promise<void> {
    if (!mapKey) return;
    const asset = getBattleMapAsset(mapKey);
    if (!asset) {
      setMapMetadataFailedKey(mapKey);
      setMapMetadataLoadingKey(null);
      return;
    }
    if (mapSpotsByKey()[mapKey] && (!asset.routesUrl || mapRoutesByKey()[mapKey])) {
      setMapMetadataFailedKey(null);
      setMapMetadataLoadingKey(null);
      return;
    }
    const pending = pendingMetadataLoads.get(mapKey);
    if (pending) return pending;

    setMapMetadataLoadingKey(mapKey);
    setMapMetadataFailedKey(null);
    if (
      !mapMetadataAbortController ||
      mapMetadataAbortController.signal.aborted
    ) {
      mapMetadataAbortController = new AbortController();
    }
    const signal = mapMetadataAbortController.signal;

    const request = (async () => {
      try {
        const targetUrl = asset.dataUrl || asset.infoUrl;
        if (!targetUrl) return;
        const response = await fetch(targetUrl, { signal });
        if (signal.aborted) return;
        if (!response.ok) {
          addMetadataWarning(`${mapKey} のマップ情報の読み込みに失敗しました。`);
          setMapMetadataFailedKey(mapKey);
          return;
        }

        const rawData = await response.json();
        const data = isJsonRecord(rawData) ? rawData : {};

        // 1. Frame metadata
        setMapFrameMetaByKey((prev) => ({
          ...prev,
          [mapKey]: {
            spriteSheetSize: { width: 1200, height: 720 },
            routeLayoutFrame: { x: 0, y: 0, width: 1200, height: 720 },
            seaMapFrame: { x: 0, y: 0, width: 1200, height: 720 },
            routeFrames: {},
          },
        }));

        // 2. Spots
        const rawSpots = Array.isArray(data["spots"]) ? data["spots"] : [];
        const spots = rawSpots
          .map((spot): MapSpot | null => {
            if (!isJsonRecord(spot)) return null;
            const cellId = Number(spot["no"] ?? NaN);
            const x = Number(spot["x"] ?? NaN);
            const y = Number(spot["y"] ?? NaN);
            if (!Number.isFinite(cellId) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
            const line = isJsonRecord(spot["line"]) ? spot["line"] : null;
            const lineOffsetX = Number(line?.["x"] ?? NaN);
            const lineOffsetY = Number(line?.["y"] ?? NaN);
            const isPort = Boolean(spot["isPort"]);
            return {
              cellId,
              x,
              y,
              ...(isPort ? { isPort: true } : {}),
              ...(Number.isFinite(lineOffsetX) ? { lineOffsetX } : {}),
              ...(Number.isFinite(lineOffsetY) ? { lineOffsetY } : {}),
            } satisfies MapSpot;
          })
          .filter((spot): spot is MapSpot => spot !== null);

        if (spots.length > 0) {
          setMapSpotsByKey((prev) => ({ ...prev, [mapKey]: spots }));
          setMapMetadataFailedKey(null);
        } else {
          setMapMetadataFailedKey(mapKey);
          return;
        }

        const rawPorts = Array.isArray(data["ports"])
          ? (data["ports"] as unknown[]).map((p) => Number(p)).filter(Number.isFinite)
          : [];
        const detectedPorts = rawPorts.length > 0
          ? rawPorts
          : spots.filter((s) => s.isPort || s.cellId === 0 || typeof s.lineOffsetX !== "number").map((s) => s.cellId);
        const finalPorts = Array.from(new Set(detectedPorts.length > 0 ? detectedPorts : [0]));
        setMapPortsByKey((prev) => ({ ...prev, [mapKey]: finalPorts }));

        // 3. Routes
        if (Array.isArray(data["routes"])) {
          const routesPayload = parseMapRoutesPayload(data["routes"]);
          setMapRoutesByKey((prev) => ({ ...prev, [mapKey]: routesPayload }));
        }

        // 4. Labels
        if (isJsonRecord(data["labels"])) {
          const labelsPayload = parseMapLabelsPayload(data["labels"]);
          if (labelsPayload) {
            const labels: Record<number, string> = {};
            for (const [rawId, label] of Object.entries(labelsPayload)) {
              const id = Number(rawId);
              if (!Number.isFinite(id) || typeof label !== "string" || !label) continue;
              labels[id] = label;
            }
            setMapLabelsByKey((prev) => ({ ...prev, [mapKey]: labels }));
          }
        }
      } catch (error) {
        if (isAbortError(error)) return;
        addMetadataWarning(`${mapKey} のマップ情報の読み込みに失敗しました。`);
        setMapMetadataFailedKey(mapKey);
      } finally {
        pendingMetadataLoads.delete(mapKey);
        if (mapMetadataLoadingKey() === mapKey) {
          setMapMetadataLoadingKey(null);
        }
      }
    })();

    pendingMetadataLoads.set(mapKey, request);
    return request;
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const enemyDeckResolver = createMemo(() =>
    buildEnemyDeckResolver(d.enemyDecks(), d.enemyShips(), d.mstShips()),
  );

  const describeEnemy = (battle: Record<string, unknown>): string => {
    const summary = battle["enemy_summary"];
    if (
      typeof summary === "string" &&
      summary &&
      summary !== "-" &&
      !summary.match(/^[0-9a-f]{8}/i) &&
      !summary.startsWith("敵艦隊 01") &&
      !summary.startsWith("敵艦隊 0c")
    ) {
      return summary;
    }
    const deckId =
      typeof battle["e_deck_id"] === "string" ? battle["e_deck_id"] : "";
    if (!deckId) return "-";
    const resolved = enemyDeckResolver()(deckId);
    if (
      resolved &&
      resolved !== "-" &&
      resolved !== "敵艦隊" &&
      !resolved.match(/^敵艦隊 [0-9a-fA-F]/)
    ) {
      return resolved;
    }
    if (typeof summary === "string" && summary && summary !== "-") {
      return summary;
    }
    return `敵艦隊 (${deckId.slice(0, 6)})`;
  };

  const mapOptions = createMemo(() => {
    const values = new Set<string>();
    for (const rec of d.battleRecords()) {
      const key = mapKeyOf(rec);
      if (key !== "unknown" && key !== "-") values.add(key);
    }
    for (const rec of d.cellRecords()) {
      const key = mapKeyOf(rec);
      if (key !== "unknown" && key !== "-") values.add(key);
    }
    return [...values].sort((a, b) => {
      const [aArea, aNo] = a.split("-").map(Number);
      const [bArea, bNo] = b.split("-").map(Number);
      if (aArea !== bArea) return (aArea || 0) - (bArea || 0);
      return (aNo || 0) - (bNo || 0);
    });
  });

  function getAreaName(areaIdStr: string): string {
    const fromApi = mstMapareas().find((m) => String(m.id) === areaIdStr);
    if (fromApi?.name) return fromApi.name;
    const areaId = Number(areaIdStr);
    return Number.isFinite(areaId) && areaId > 0
      ? resolveMapAreaName(areaId)
      : `第${areaIdStr}海域`;
  }

  function getMapInfoName(mapKey: string): string {
    const parts = mapKey.split("-");
    const area = parts[0] ?? "";
    const no = parts[1] ?? "";
    const fromApi = mstMapinfos().find(
      (m) => String(m.maparea_id) === area && String(m.no) === no,
    );
    if (fromApi?.name) return fromApi.name;
    return resolveMapInfoName(mapKey);
  }

  /** mapOptions を海域ごとにグループ化したリスト */
  const mapAreaGroups = createMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const mapKey of mapOptions()) {
      const areaId = mapKey.split("-")[0] ?? "";
      if (!grouped.has(areaId)) grouped.set(areaId, []);
      grouped.get(areaId)!.push(mapKey);
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([areaId, maps]) => ({ areaId, maps }));
  });

  createEffect(() => {
    const maps = mapOptions();
    for (const key of maps) {
      void ensureMapMetadata(key);
    }
  });

  createEffect(() => {
    const filter = d.mapFilter();
    // 海域フィルターが切り替わったら、前の海域の選択状態（セル・出撃）を確実にリセット
    setSelectedCellFilter(null);
    setSelectedSortieId("");
    if (filter) {
      void ensureMapMetadata(filter);
    }
  });

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

  const resolveBattleMapKey = (b: BattleRecord): string => {
    const direct = mapKeyOf(b);
    if (direct !== "unknown" && direct !== "-") return direct;
    const { battleToMap, envToMap } = mapKeyLookup();
    const byBattle = b.uuid ? battleToMap.get(b.uuid) : undefined;
    if (byBattle) return byBattle;
    const byEnv = b.env_uuid ? envToMap.get(b.env_uuid) : undefined;
    if (byEnv) return byEnv;
    return "unknown";
  };

  const filteredBattles = createMemo(() => {
    const selected = d.mapFilter();
    const start = d.startDate().trim();
    const end = d.endDate().trim();
    const resultF = d.resultFilter();
    return d.battleRecords()
      .filter((r) => {
        if (selected && resolveBattleMapKey(r) !== selected) return false;
        if (resultF && battleResultOfRecord(r)?.win_rank !== resultF) return false;
        if ((start || end) && !isWithinDateRange(r.timestamp, start, end)) return false;
        return true;
      })
      .sort((a, b) => compareNullableTimestamps(a.timestamp, b.timestamp));
  });

  // 全戦闘データ（フィルタ前）からの出撃紐付けルックアップ
  // 出撃（cellRecord）のタイムスタンプ特定に使用
  const allBattleGroups = createMemo(() => {
    const byUuid = new Map<string, BattleRecord[]>();
    const byEnv = new Map<string, BattleRecord[]>();
    for (const battle of d.battleRecords()) {
      if (battle.uuid) {
        let list = byUuid.get(battle.uuid);
        if (!list) {
          list = [];
          byUuid.set(battle.uuid, list);
        }
        list.push(battle);
      }
      const env = battle.env_uuid || battle.__sortie_id;
      if (env) {
        let list = byEnv.get(env);
        if (!list) {
          list = [];
          byEnv.set(env, list);
        }
        list.push(battle);
      }
    }
    for (const list of byUuid.values()) {
      list.sort((a, b) => compareNullableTimestamps(a.timestamp, b.timestamp));
    }
    for (const list of byEnv.values()) {
      list.sort((a, b) => compareNullableTimestamps(a.timestamp, b.timestamp));
    }
    return {
      get: (ref: unknown): BattleRecord[] => {
        if (!ref) return [];
        if (Array.isArray(ref)) {
          const res: BattleRecord[] = [];
          const seen = new Set<string>();
          for (const item of ref) {
            if (typeof item === "string" && item && !seen.has(item)) {
              seen.add(item);
              res.push(...(byUuid.get(item) || []));
            }
          }
          return res;
        }
        if (typeof ref === "string") {
          return byUuid.get(ref) || [];
        }
        return [];
      },
      getByEnv: (env?: string | null): BattleRecord[] => {
        if (!env) return [];
        return byEnv.get(env) || [];
      },
    };
  });

  const getCellRecordTimestamp = (cellRecord: Record<string, unknown>): number | null => {
    const raw = cellRecord["timestamp"];
    if (raw != null) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
    let battles = cellRecord["battles"]
      ? allBattleGroups().get(cellRecord["battles"])
      : [];
    if (battles.length === 0 && cellRecord["env_uuid"]) {
      battles = allBattleGroups().getByEnv(cellRecord["env_uuid"] as string);
    }
    const timestamps = battles
      .map((b) => Number(b.timestamp ?? NaN))
      .filter((t) => Number.isFinite(t) && t > 0);
    return timestamps.length > 0 ? Math.max(...timestamps) : null;
  };

  const filteredCellRecords = createMemo(() => {
    const selected = d.mapFilter();
    const start = d.startDate().trim();
    const end = d.endDate().trim();
    return d.cellRecords().filter((r) => {
      if (selected && mapKeyOf(r) !== selected) return false;
      if (start || end) {
        const ts = getCellRecordTimestamp(r as Record<string, unknown>);
        if (ts === null) return false;
        if (!isWithinDateRange(ts, start, end)) return false;
      }
      return true;
    });
  });

  const battleGroups = createMemo(() => {
    const byUuid = new Map<string, BattleRecord[]>();
    const byEnv = new Map<string, BattleRecord[]>();
    for (const battle of filteredBattles()) {
      if (battle.uuid) {
        let list = byUuid.get(battle.uuid);
        if (!list) {
          list = [];
          byUuid.set(battle.uuid, list);
        }
        list.push(battle);
      }
      const env = battle.env_uuid || battle.__sortie_id;
      if (env) {
        let list = byEnv.get(env);
        if (!list) {
          list = [];
          byEnv.set(env, list);
        }
        list.push(battle);
      }
    }
    for (const list of byUuid.values()) {
      list.sort((a, b) => compareNullableTimestamps(a.timestamp, b.timestamp));
    }
    for (const list of byEnv.values()) {
      list.sort((a, b) => compareNullableTimestamps(a.timestamp, b.timestamp));
    }
    return {
      get: (ref: unknown): BattleRecord[] => {
        if (!ref) return [];
        if (Array.isArray(ref)) {
          const res: BattleRecord[] = [];
          const seen = new Set<string>();
          for (const item of ref) {
            if (typeof item === "string" && item && !seen.has(item)) {
              seen.add(item);
              res.push(...(byUuid.get(item) || []));
            }
          }
          return res;
        }
        if (typeof ref === "string") {
          return byUuid.get(ref) || [];
        }
        return [];
      },
      getByEnv: (env?: string | null): BattleRecord[] => {
        if (!env) return [];
        return byEnv.get(env) || [];
      },
    };
  });

  const aliasCellIdsByMapKey = createMemo(() => {
    const allSpots = mapSpotsByKey();
    const res: Record<string, Map<number, number[]>> = {};
    for (const [mapKey, spots] of Object.entries(allSpots)) {
      res[mapKey] = buildAliasCellMap(spots);
    }
    return res;
  });

  const rawSortieRoutes = createMemo(() => {
    const aliasMapByKey = aliasCellIdsByMapKey();
    const portsByKey = mapPortsByKey();
    const spotsByKey = mapSpotsByKey();
    const routesByKey = mapRoutesByKey();

    return filteredCellRecords()
      .map((cellRecord) => {
        const mapKey = mapKeyOf(cellRecord);
        const cells = (cellRecord.cell_index || [])
          .map((cellId: unknown) => Number(cellId ?? NaN))
          .filter((cellId: number) => Number.isFinite(cellId));
        if (cells.length === 0) return null;

        const ports = portsByKey[mapKey] || [];
        const spots = spotsByKey[mapKey] || [];
        const routes = routesByKey[mapKey] || [];
        const routeCells = resolveRouteCellsWithPort(cells, ports, spots, routes);

        let battles = cellRecord.battles
          ? [...battleGroups().get(cellRecord.battles)]
          : [];
        if (battles.length === 0 && cellRecord.env_uuid) {
          battles = [...battleGroups().getByEnv(cellRecord.env_uuid)];
        }
        const battlesByCell = new Map<number, BattleRecord[]>();
        for (const battle of battles) {
          const cellId = Number(battle.cell_id ?? NaN);
          if (!Number.isFinite(cellId)) continue;
          const list = battlesByCell.get(cellId);
          if (list) {
            list.push(battle);
          } else {
            battlesByCell.set(cellId, [battle]);
          }
        }

        const aliasMap = aliasMapByKey[mapKey];
        const steps = routeCells.map((cellId, idx) => {
          const battle = findBattleForCell(cellId, battlesByCell, aliasMap);
          return {
            stepNo: idx + 1,
            cellId,
            enemy: battle ? describeEnemy(battle) : "通過",
            hasBattle: !!battle,
          };
        });

        const ts = getCellRecordTimestamp(cellRecord as Record<string, unknown>);
        const routeTimestamp = ts !== null ? ts : Number.MIN_SAFE_INTEGER;

        const battleKey = Array.isArray(cellRecord.battles) && cellRecord.battles.length > 0
          ? cellRecord.battles.join(",")
          : typeof cellRecord.battles === "string" && cellRecord.battles
            ? cellRecord.battles
            : "";

        const sortieId =
          cellRecord.uuid ||
          cellRecord.env_uuid ||
          battleKey ||
          `${mapKey}:${routeCells.join("-")}:${cellRecord["timestamp"] ?? Math.random().toString(36).slice(2, 8)}`;

        return {
          sortieId,
          mapKey,
          route: routeCells
            .map((cellId) => cellLabel(cellId, mapKey))
            .join(" → "),
          cells: routeCells,
          steps,
          battleCount: steps.filter((step) => step.hasBattle).length,
          sortTimestamp: routeTimestamp,
        } satisfies SortieRoute;
      })
      .filter((route): route is SortieRoute => route !== null);
  });

  const allSortieRoutes = createMemo(() => {
    // 同じセルパスを持つルートをマージ（最新のタイムスタンプを保持）
    // 帰港（港への帰還）は、ルート末尾の0（港）を無視して比較
    const routeMap = rawSortieRoutes().reduce((map, route) => {
      // 末尾が港（0）の場合は除去してキーを生成
      const normalizedCells =
        route.cells.at(-1) === 0 ? route.cells.slice(0, -1) : route.cells;
      const cellPathKey = `${route.mapKey}:${normalizedCells.join("-")}`;
      const existing = map.get(cellPathKey);
      if (!existing || route.sortTimestamp > existing.sortTimestamp) {
        map.set(cellPathKey, route);
      }
      return map;
    }, new Map<string, SortieRoute>());

    return Array.from(routeMap.values()).sort(
      (a, b) => b.sortTimestamp - a.sortTimestamp,
    );
  });

  const filteredRouteCount = createMemo(() => {
    const filter = selectedCellFilter();
    if (!filter) return allSortieRoutes().length;
    const cellIds = new Set(filter.cellIds);
    return allSortieRoutes().filter(
      (route) =>
        route.mapKey === filter.mapKey &&
        route.cells.some((cellId) => cellIds.has(cellId)),
    ).length;
  });

  const displayedSortieRoutes = createMemo(() => {
    const filter = selectedCellFilter();
    const routes = !filter
      ? allSortieRoutes()
      : allSortieRoutes().filter((route) => {
          if (route.mapKey !== filter.mapKey) return false;
          const cellIds = new Set(filter.cellIds);
          return route.cells.some((cellId) => cellIds.has(cellId));
        });
    return routes.slice(0, MAX_SORTIE_ROUTES);
  });

  const isRouteListTruncated = createMemo(
    () => filteredRouteCount() > MAX_SORTIE_ROUTES,
  );

  const analysis = createMemo(() => {
    const transitionMap = new Map<
      string,
      { from: number; to: number; count: number }
    >();
    const statMap = new Map<
      number,
      {
        cell: number;
        passCount: number;
        nextCells: Map<number, number>;
        battleCount: number;
        enemyCounts: Map<string, number>;
      }
    >();

    // フィルタ適用済みの全出撃（rawSortieRoutes）から集計することで、
    // マップ上の通過・分岐回数が日付・海域フィルタと100%整合し、重複計算も解消
    for (const sortie of rawSortieRoutes()) {
      const routeCells = sortie.cells;
      for (let i = 0; i < routeCells.length; i++) {
        const currentCell = routeCells[i];
        if (currentCell === undefined) continue;
        let stat = statMap.get(currentCell);
        if (!stat) {
          stat = {
            cell: currentCell,
            passCount: 0,
            nextCells: new Map(),
            battleCount: 0,
            enemyCounts: new Map(),
          };
          statMap.set(currentCell, stat);
        }

        stat.passCount++;

        const step = sortie.steps[i];
        if (step && step.hasBattle) {
          stat.battleCount++;
          stat.enemyCounts.set(
            step.enemy,
            (stat.enemyCounts.get(step.enemy) ?? 0) + 1,
          );
        }

        const nextCell = routeCells[i + 1];
        if (typeof nextCell === "number") {
          const key = `${currentCell}->${nextCell}`;
          const existing = transitionMap.get(key);
          if (existing) {
            existing.count++;
          } else {
            transitionMap.set(key, {
              from: currentCell,
              to: nextCell,
              count: 1,
            });
          }
          stat.nextCells.set(nextCell, (stat.nextCells.get(nextCell) ?? 0) + 1);
        }
      }
    }

    const transitions = [...transitionMap.values()];
    const stats = [...statMap.values()].sort(
      (a, b) => b.passCount - a.passCount,
    );
    return { transitions, stats };
  });

  const selectedSortieRoute = createMemo(() => {
    const routes = displayedSortieRoutes();
    if (routes.length === 0) return null;
    return routes.find((r) => r.sortieId === selectedSortieId()) || routes[0];
  });

  // NOTE: フィルター選択されたマスのデータがゼロの場合でも filter を null にしない。
  // データなしのマスをクリックした際にマップが消えたり古いデータが残る問題を防ぐ。

  const selectedAsset = createMemo(() => {
    // 海域フィルターが指定されている場合はそれを最優先にし、海域切替時に正しくマップを切り替える
    const filterKey = d.mapFilter() || null;
    const selected = selectedSortieRoute();
    const key = filterKey || selected?.mapKey || selectedCellFilter()?.mapKey || null;
    return getBattleMapAsset(key);
  });

  const resolvedOfficialMapTheme = createMemo<BattleMapTheme>(() => {
    const mode = officialMapThemeMode();
    return mode === "auto" ? detectedTheme() : mode;
  });

  // ── Overlay computation ─────────────────────────────────────────────────────

  const selectedRouteOverlay = createMemo((): ResolvedRouteOverlay | null => {
    const asset = selectedAsset();
    if (!asset) return null;
    // selected が null のケース(データなしマスを選択中)ではマップを表示継続し markers を空にする
    const selected = selectedSortieRoute();
    const frameMeta = mapFrameMetaByKey()[asset.mapKey];
    const hasStandaloneThemeSprite = !!asset.spriteUrls;
    const resolvedAsset = {
      ...asset,
      spriteUrl: resolveBattleMapSpriteUrl(asset, resolvedOfficialMapTheme()),
      spriteSheetSize: hasStandaloneThemeSprite
        ? asset.spriteSheetSize
        : (frameMeta?.spriteSheetSize ?? asset.spriteSheetSize),
      routeLayoutFrame: hasStandaloneThemeSprite
        ? asset.routeLayoutFrame
        : (frameMeta?.routeLayoutFrame ?? asset.routeLayoutFrame),
      seaMapFrame: hasStandaloneThemeSprite
        ? asset.seaMapFrame
        : (frameMeta?.seaMapFrame ?? asset.seaMapFrame),
    };
    const spots = mapSpotsByKey()[asset.mapKey] || [];
    if (spots.length === 0) return null;

    const spotByCellId = new Map(spots.map((spot) => [spot.cellId, spot]));
    const spotRenderPositions = buildSpotRenderPositions(spots);
    const seenCount = new Map<number, number>();
    const statByCell = new Map(
      analysis().stats.map((stat) => [stat.cell, stat]),
    );

    const markers: OverlayMarker[] = (selected?.steps ?? [])
      .map((step) => {
        const spot = spotByCellId.get(step.cellId);
        if (!spot) return null;
        const seen = (seenCount.get(step.cellId) ?? 0) + 1;
        seenCount.set(step.cellId, seen);
        return {
          ...step,
          x: spot.x,
          y: spot.y,
          badgeX: spot.x + (seen > 1 ? (seen - 1) * 12 : 0),
          badgeY: spot.y - 27 - (seen > 1 ? (seen - 1) * 16 : 0),
        };
      })
      .filter((m): m is NonNullable<typeof m> => !!m);

    const transitions: TransitionOverlay[] = analysis()
      .transitions.map((transition) => {
        const from = spotByCellId.get(transition.from);
        const to = spotByCellId.get(transition.to);
        if (!from || !to) return null;
        const badgePosition = computeTransitionBadgePosition(from, to, spots, {
          width: resolvedAsset.routeLayoutFrame.width,
          height: resolvedAsset.routeLayoutFrame.height,
        });
        return {
          ...transition,
          fromX: from.x,
          fromY: from.y,
          toX: to.x,
          toY: to.y,
          badgeX: badgePosition.badgeX,
          badgeY: badgePosition.badgeY,
        } satisfies TransitionOverlay;
      })
      .filter((t): t is TransitionOverlay => !!t);

    const visibleSpots = spots.map((spot) => ({
      ...spot,
      renderX: spotRenderPositions.get(spot.cellId)?.x ?? spot.x,
      renderY: spotRenderPositions.get(spot.cellId)?.y ?? spot.y,
      stat: statByCell.get(spot.cellId) || null,
    }));

    // Track which cells were visited on the current route and whether a battle occurred.
    const selectedRouteStateByCellId = new Map<
      number,
      { visited: boolean; hasBattle: boolean }
    >();
    for (const step of (selected?.steps ?? [])) {
      const current = selectedRouteStateByCellId.get(step.cellId);
      selectedRouteStateByCellId.set(step.cellId, {
        visited: true,
        hasBattle: (current?.hasBattle ?? false) || step.hasBattle,
      });
    }

    const inferredRoutes = inferRouteOverlays(
      spots,
      frameMeta?.routeFrames,
      analysis().transitions,
      mapRoutesByKey()[asset.mapKey],
    );

    const ports = mapPortsByKey()[asset.mapKey] || [];
    // Group spots by label+position so duplicate-coordinate cells share one circle.
    const groupedSpotStats = new Map<
      string,
      {
        key: string;
        label: string;
        x: number;
        y: number;
        cellIds: number[];
        passCount: number;
        battleCount: number;
        isPort?: boolean;
      }
    >();
    for (const spot of visibleSpots) {
      const label = cellOverlayLabel(spot.cellId, asset.mapKey);
      if (!label || label === "-") continue;
      const key = `${label}:${spot.x}:${spot.y}`;
      const isPort = Boolean(spot.isPort) || ports.includes(spot.cellId) || spot.cellId === 0;
      const current = groupedSpotStats.get(key);
      if (current) {
        if (!current.cellIds.includes(spot.cellId)) {
          current.cellIds.push(spot.cellId);
        }
        if (isPort) current.isPort = true;
        current.passCount += spot.stat?.passCount ?? 0;
        current.battleCount += spot.stat?.battleCount ?? 0;
      } else {
        groupedSpotStats.set(key, {
          key,
          label,
          x: spot.x,
          y: spot.y,
          cellIds: [spot.cellId],
          passCount: spot.stat?.passCount ?? 0,
          battleCount: spot.stat?.battleCount ?? 0,
          isPort,
        });
      }
    }

    const visibleLabelSpots = [...groupedSpotStats.values()].map((spot) => ({
      key: spot.key,
      label: spot.label,
      x: spot.x,
      y: spot.y,
      cellIds: [...spot.cellIds].sort((a, b) => a - b),
      passCount: spot.passCount,
      battleCount: spot.battleCount,
      currentRouteVisited: spot.cellIds.some(
        (cellId) => selectedRouteStateByCellId.get(cellId)?.visited,
      ),
      currentRouteHasBattle: spot.cellIds.some(
        (cellId) => selectedRouteStateByCellId.get(cellId)?.hasBattle,
      ),
      ...(spot.isPort ? { isPort: true } : {}),
    }));

    const labelAnchors = visibleLabelSpots.map((spot) => ({
      key: spot.key,
      label: spot.label,
      x: spot.x,
      y: spot.y,
      cellIds: spot.cellIds,
    }));

    const labelObstacles = [
      ...transitions.map((t) => ({
        rectX: t.badgeX - ROUTE_COUNT_BADGE_WIDTH / 2,
        rectY: t.badgeY - ROUTE_COUNT_BADGE_HEIGHT / 2,
        width: ROUTE_COUNT_BADGE_WIDTH,
        height: ROUTE_COUNT_BADGE_HEIGHT,
      })),
      ...markers.map((m) => ({
        rectX: m.badgeX + 10,
        rectY: m.badgeY - STEP_BADGE_HEIGHT / 2,
        width: STEP_BADGE_WIDTH,
        height: STEP_BADGE_HEIGHT,
      })),
    ];

    const labelLayouts = buildAutoLabelLayouts(
      labelAnchors,
      new Map(labelAnchors.map((anchor) => [anchor.key, anchor.label])),
      {
        width: resolvedAsset.routeLayoutFrame.width,
        height: resolvedAsset.routeLayoutFrame.height,
      },
      labelObstacles,
    );

    const cellKeyByCellId = new Map<number, string>();
    for (const spot of visibleLabelSpots) {
      for (const cellId of spot.cellIds) {
        cellKeyByCellId.set(cellId, spot.key);
      }
    }

    const maxPassCount = Math.max(
      1,
      ...analysis().stats.map((stat) => stat.passCount),
    );
    const viewportHeight =
      resolvedAsset.routeLayoutFrame.height *
      (DEFAULT_MAP_VIEWPORT_HEIGHT_PERCENT / 100);
    const viewportOffsetY =
      (resolvedAsset.routeLayoutFrame.height - viewportHeight) / 2;

    return {
      asset: resolvedAsset,
      inferredRoutes,
      markers,
      transitions,
      visibleLabelSpots,
      labelAnchors,
      labelLayouts,
      cellKeyByCellId,
      maxPassCount,
      viewportHeight,
      viewportOffsetY,
      ports,
    };
  });

  // ── Selected cell details ───────────────────────────────────────────────────

  const selectedCellDetails = createMemo((): SelectedCellDetails | null => {
    const filter = selectedCellFilter();
    if (!filter) return null;

    const cellIdSet = new Set(filter.cellIds);
    // 実際の全出撃（rawSortieRoutes）から該当セルを通った出撃を抽出
    const matchingSorties = rawSortieRoutes().filter(
      (route) =>
        route.mapKey === filter.mapKey &&
        route.cells.some((cellId) => cellIdSet.has(cellId)),
    );
    const matchingBattles = filteredBattles()
      .filter(
        (battle) =>
          resolveBattleMapKey(battle) === filter.mapKey &&
          cellIdSet.has(Number(battle.cell_id ?? NaN)),
      )
      .sort((a, b) =>
        compareNullableTimestamps(a.timestamp, b.timestamp, "desc"),
      );

    const enemyLabelCounts = new Map<string, number>();
    const resultCounts = new Map<string, number>();
    const dropCounts = new Map<string, number>();
    const outgoingCounts = new Map<string, number>();

    let passCount = 0;
    for (const route of matchingSorties) {
      route.steps.forEach((step, index) => {
        if (!cellIdSet.has(step.cellId)) return;
        passCount++;
        const next = route.steps[index + 1];
        const nextLabel = next ? cellLabel(next.cellId, route.mapKey) : "到達";
        const transitionLabel = `${cellLabel(step.cellId, route.mapKey)} → ${nextLabel}`;
        outgoingCounts.set(
          transitionLabel,
          (outgoingCounts.get(transitionLabel) ?? 0) + 1,
        );
      });
    }

    for (const battle of matchingBattles) {
      const enemyLabel = describeEnemy(battle);
      enemyLabelCounts.set(enemyLabel, (enemyLabelCounts.get(enemyLabel) ?? 0) + 1);

      const result =
        battle.battle_result && typeof battle.battle_result === "object"
          ? battle.battle_result
          : null;
      if (result?.win_rank) {
        resultCounts.set(
          result.win_rank,
          (resultCounts.get(result.win_rank) ?? 0) + 1,
        );
      }
      if (result?.drop_ship_id) {
        const sid = Number(result.drop_ship_id);
        const mstName = d.mstShips().find((s) => s.id === sid)?.name;
        const dropName = result.drop_ship_name ?? mstName ?? `艦ID:${result.drop_ship_id}`;
        dropCounts.set(dropName, (dropCounts.get(dropName) ?? 0) + 1);
      }
    }

    return {
      ...filter,
      passCount,
      routeCount: matchingSorties.length,
      battleCount: matchingBattles.length,
      topEnemyLabels: [...enemyLabelCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
      resultCounts: [...resultCounts.entries()].sort((a, b) => b[1] - a[1]),
      dropCounts: [...dropCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
      outgoingCounts: [...outgoingCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
      recentBattles: matchingBattles.slice(0, 8).map((battle) => ({
        uuid:
          battle.uuid ??
          battle.env_uuid ??
          `${battle.cell_id}-${battle.index ?? "unknown"}-${battle.timestamp ?? "unknown"}`,
        timestamp: formatTimestamp(battle.timestamp),
        enemy: describeEnemy(battle),
        result:
          battle.battle_result && typeof battle.battle_result === "object"
            ? battle.battle_result
            : null,
      })),
    };
  });

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <Show when={metadataWarnings().length > 0}>
        <div class="mb-6 text-sm">
          <AlertMessage type="warning">
            <div class="flex flex-col gap-2 w-full">
              <div class="flex items-center justify-between gap-2">
                <span class="font-semibold text-warning">
                  マップメタデータ警告 ({metadataWarnings().length}件)
                </span>
                <button
                  class="fusou-btn-xs-ghost"
                  type="button"
                  onClick={() => setShowWarnings((prev) => !prev)}
                >
                  {showWarnings() ? "詳細を隠す" : "詳細を表示"}
                </button>
              </div>
            <Show when={showWarnings()}>
              <div class="flex flex-col gap-1 mt-1">
                <For each={metadataWarnings()}>
                  {(warning) => (
                    <div class="text-xs text-base-content/80">{warning}</div>
                  )}
                </For>
              </div>
            </Show>
            </div>
          </AlertMessage>
        </div>
      </Show>

      {/* Map route visualisation */}
      <div class="fusou-card mb-6">
        <div class="fusou-card-body">
          <h3 class="card-title text-lg">海域ルート図</h3>
          <div class="text-xs text-base-content/60 mb-2">
            港からどの順番で進んだかを矢印で表示します。線のそばの数字は、そのルートを通った回数です。セルをクリックすると、そのマスを通った出撃だけを表示できます。
          </div>

          {/* 海域未選択時: ドロップページと同様の海域選択グリッドを表示 */}
          <Show when={!d.mapFilter()}>
            <Show
              when={mapAreaGroups().length > 0}
              fallback={
                <Show when={d.loading()} fallback={<EmptyState size="compact" message="データがありません" />}>
                  <LoadingState message="海域データを読込中..." minHeight="h-32" />
                </Show>
              }
            >
              <MapAreaGrid
                groups={mapAreaGroups()}
                onSelect={(mapKey: string) => d.setMapFilter(mapKey)}
                getAreaName={getAreaName}
                getMapName={getMapInfoName}
              />
            </Show>
          </Show>

          {/* 海域選択済み: ルート図を表示 */}
          <Show when={d.mapFilter()}>
            <Show
              when={selectedRouteOverlay()}
              fallback={
                <Show
                  when={mapMetadataLoadingKey() === d.mapFilter() || (d.loading() && mapMetadataFailedKey() !== d.mapFilter())}
                  fallback={
                    <EmptyState
                      message="マップデータを読み込めませんでした"
                      description="この海域のマップデータが見つからないか、読み込みに失敗しました。"
                      minHeight="h-64"
                    />
                  }
                >
                  <LoadingState message="マップデータを読み込んでいます..." minHeight="h-64" />
                </Show>
              }
            >
            {(overlay) => (
              <div class="space-y-4">
                {/* Filter badge */}
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-200 p-3 text-sm">
                  <div class="space-y-1">
                    <div class="font-semibold">操作</div>
                    <div class="text-xs text-base-content/70">
                      セルやラベルをクリックするとそのマスに到達した出撃だけに絞り込みます。
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    
                  </div>
                </div>

                {/* SVG canvas — 固定アスペクト比コンテナでサイズ安定化 */}
                <div style={`aspect-ratio: ${MAP_VIEWBOX_WIDTH} / ${MAP_VIEWBOX_HEIGHT}; width: 100%;`}>
                  <MapSvgCanvas
                    overlay={overlay()}
                    selectedCellFilter={selectedCellFilter}
                    toggleCellFilter={toggleCellFilter}
                    showOfficialMapAssets={showOfficialMapAssets}
                    theme={resolvedOfficialMapTheme}
                  />
                </div>

                {/* Legend / summary */}
                <div class="grid gap-3 md:grid-cols-3">
                  <div class="rounded-box bg-base-200 p-3 text-sm">
                    <div class="font-bold mb-1">見方</div>
                    <div class="text-xs text-base-content/70">
                      表示設定から海域背景画像の表示を切り替えできます
                    </div>
                    <div class="text-xs text-base-content/70">
                      緑の点線: マップ上の接続ルート
                    </div>
                    <div class="text-xs text-base-content/70">
                      経路上の数字: その遷移を通過した回数
                    </div>
                    <div class="text-xs text-base-content/70">
                      赤の矢印: いま表示中の出撃が進んだ順路
                    </div>
                    <div class="text-xs text-base-content/70">
                      赤丸: 戦闘マス（戦闘実績あり） / 灰丸: 非戦闘マス / 黄丸: 出撃港 / 黒枠: 選択中セル
                    </div>
                    <div class="text-xs text-base-content/70">
                      AB ✕: 基地航空隊（右下数値: 必要行動半径）
                    </div>
                  </div>
                  <Show when={selectedSortieRoute()}>
                    {(selected) => (
                      <>
                        <div class="rounded-box bg-base-200 p-3 text-sm">
                          <div class="font-bold mb-1">この出撃の概要</div>
                          <div class="text-xs text-base-content/70">
                            出発:{" "}
                            {cellLabel(
                              selected().steps[0]?.cellId ?? -1,
                              selected().mapKey,
                            )}
                          </div>
                          <div class="text-xs text-base-content/70">
                            到達:{" "}
                            {cellLabel(
                              selected().steps[selected().steps.length - 1]
                                ?.cellId ?? -1,
                              selected().mapKey,
                            )}
                          </div>
                          <div class="text-xs text-base-content/70">
                            通過 {selected().steps.length} マス / 戦闘{" "}
                            {selected().battleCount} 回
                          </div>
                        </div>
                        <div class="rounded-box bg-base-200 p-3 text-sm">
                          <div class="font-bold mb-1">使い方</div>
                          <div class="text-xs text-base-content/70">
                            ソーティーを切り替えると、赤い矢印がその出撃の進路に更新されます。
                          </div>
                          <div class="text-xs text-base-content/70">
                            セルかラベルをクリックすると、そのマスに到達した出撃だけに絞り込みます。
                          </div>
                        </div>
                      </>
                    )}
                  </Show>
                </div>

                {/* Cell details panel (shown when a cell is selected) */}
                <Show when={selectedCellDetails()}>
                  {(details) => (
                    <CellDetailsPanel
                      details={details()}
                      displayedSortieRoutesCount={
                        displayedSortieRoutes().length
                      }
                      onClear={() => setSelectedCellFilter(null)}
                    />
                  )}
                </Show>
              </div>
            )}
          </Show>
          </Show>
        </div>
      </div>

      {/* Cell stats table */}
      <Show when={d.mapFilter()}>
      <div class="fusou-card">
        <div class="p-0">
          <div class="overflow-x-auto">
            <table class="table table-zebra table-sm">
              <thead>
                <tr>
                  <th>セル</th>
                  <th>通過回数</th>
                  <th>遷移先</th>
                  <th>戦闘率</th>
                  <th>よく遭遇する敵</th>
                </tr>
              </thead>
              <tbody>
                <Show
                  when={!d.loading() && analysis().stats.length > 0}
                  fallback={
                    <tr>
                      <td
                        colspan={5}
                        class="text-center py-8 text-base-content/40"
                      >
                        {d.loading() ? "読込中..." : "データ読込後に表示されます"}
                      </td>
                    </tr>
                  }
                >
                  <For each={analysis().stats}>
                    {(s) => {
                      const nexts = [...s.nextCells.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .map(
                          ([cell, count]) =>
                            `${cellLabel(cell, d.mapFilter() || undefined)} (${count})`,
                        )
                        .join(", ");
                      const topEnemies = [...s.enemyCounts.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 2)
                        .map(([enemy, count]) => `${enemy} (${count})`)
                        .join(" / ");
                      const battleRate =
                        s.passCount > 0
                          ? ((s.battleCount / s.passCount) * 100).toFixed(0)
                          : "0";
                      return (
                        <tr>
                          <td>{cellLabel(s.cell)}</td>
                          <td>{s.passCount}</td>
                          <td class="text-xs">{nexts || "-"}</td>
                          <td>{battleRate}%</td>
                          <td class="text-xs">{topEnemies || "-"}</td>
                        </tr>
                      );
                    }}
                  </For>
                </Show>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      </Show>

      {/* Sortie list panel */}
      <Show when={d.mapFilter()}>
      <div class="fusou-card mt-6">
        <div class="fusou-card-body">
          <h3 class="card-title text-lg">進軍ルート一覧（出撃ごと）</h3>
          <div class="text-xs text-base-content/60 mb-3">
            出撃ごとの進み方を順番で確認できます。戦闘がなかった通過マスも表示します。
          </div>
          <SortieListPanel
            routes={displayedSortieRoutes()}
            selectedRoute={selectedSortieRoute()}
            selectedCellFilter={selectedCellFilter}
            onSelectById={setSelectedSortieId}
            isRouteListTruncated={isRouteListTruncated}
            filteredRouteCount={filteredRouteCount}
            cellLabel={cellLabel}
          />
        </div>
      </div>
      </Show>

      {/* Display settings modal */}
      <DisplaySettingsModal
        ref={(el) => {
          displaySettingsModalRef = el;
        }}
        showOfficialMapAssets={showOfficialMapAssets}
        setShowOfficialMapAssets={setShowOfficialMapAssets}
        officialMapThemeMode={officialMapThemeMode}
        setOfficialMapThemeMode={setOfficialMapThemeMode}
        resolvedOfficialMapTheme={resolvedOfficialMapTheme}
      />
    </>
  );
}
