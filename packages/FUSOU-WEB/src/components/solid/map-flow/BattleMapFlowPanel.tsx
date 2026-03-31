/** @jsxImportSource solid-js */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { type BattleMapTheme, getBattleMapAsset, resolveBattleMapSpriteUrl } from "@/data/battleMapAssets";
import { cachedFetch } from "@/utility/fetchCache";

import type {
  BattleRecord,
  BattleResultData,
  BattleResultRecord,
  CellRecord,
  EnemyDeckRecord,
  EnemyShipRecord,
  EnemySlotItemRecord,
  MapFrameMeta,
  MapImageMetaPayload,
  MapInfoPayload,
  MapLabelsPayload,
  MapSpot,
  MstShipRecord,
  MstSlotItemRecord,
  OfficialMapThemeMode,
  OverlayMarker,
  ResolvedRouteOverlay,
  SelectedCellDetails,
  SelectedCellFilter,
  SortieRoute,
  TransitionOverlay,
  WeaponIconFrame,
  WeaponIconMeta,
} from "./battle-map-flow/types";

import {
  DEFAULT_MAP_VIEWPORT_HEIGHT_PERCENT,
  MAP_FLOW_DISPLAY_SETTINGS_KEY,
  MAX_SORTIE_ROUTES,
  ROUTE_COUNT_BADGE_HEIGHT,
  ROUTE_COUNT_BADGE_WIDTH,
  STEP_BADGE_HEIGHT,
  STEP_BADGE_WIDTH,
} from "./battle-map-flow/constants";

import { computeTransitionBadgePosition, buildSpotRenderPositions } from "./battle-map-flow/geometry";
import { buildAutoLabelLayouts } from "./battle-map-flow/labelLayout";
import { inferRouteOverlays } from "./battle-map-flow/routeInference";
import {
  cellLabel as pureCellLabel,
  cellOverlayLabel as pureCellOverlayLabel,
  formatTimestamp,
  mapKeyOf,
  normalizeEpochMs,
  parseMapFrameMeta,
  parseOfficialMapThemeMode,
  resolveBattleResult,
  resolveRouteCellsWithPort,
} from "./battle-map-flow/dataUtils";
import { buildEnemyDeckResolver, buildEnemyFleetResolver } from "./battle-map-flow/enemyResolver";
import MapSvgCanvas from "./battle-map-flow/MapSvgCanvas";
import CellDetailsPanel from "./battle-map-flow/CellDetailsPanel";
import SortieListPanel from "./battle-map-flow/SortieListPanel";
import DisplaySettingsModal from "./battle-map-flow/DisplaySettingsModal";

export default function BattleMapFlowPanel() {
  // ── UI control signals ──────────────────────────────────────────────────────
  const [periodTag, setPeriodTag] = createSignal("latest");
  const [mapFilter, setMapFilter] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [partialLoadWarnings, setPartialLoadWarnings] = createSignal<string[]>([]);
  const [selectedSortieId, setSelectedSortieId] = createSignal("");
  const [selectedCellFilter, setSelectedCellFilter] = createSignal<SelectedCellFilter | null>(null);
  const [metadataWarnings, setMetadataWarnings] = createSignal<string[]>([]);
  const [showOfficialMapAssets, setShowOfficialMapAssets] = createSignal(true);
  const [officialMapThemeMode, setOfficialMapThemeMode] = createSignal<OfficialMapThemeMode>("auto");
  const [detectedTheme, setDetectedTheme] = createSignal<BattleMapTheme>("light");

  let displaySettingsModalRef!: HTMLDialogElement;

  // ── Data signals ────────────────────────────────────────────────────────────
  const [battleRecords, setBattleRecords] = createSignal<BattleRecord[]>([]);
  const [cellRecords, setCellRecords] = createSignal<CellRecord[]>([]);
  const [enemyDecks, setEnemyDecks] = createSignal<EnemyDeckRecord[]>([]);
  const [enemyShips, setEnemyShips] = createSignal<EnemyShipRecord[]>([]);
  const [enemySlotItems, setEnemySlotItems] = createSignal<EnemySlotItemRecord[]>([]);
  const [mstShips, setMstShips] = createSignal<MstShipRecord[]>([]);
  const [mstSlotItems, setMstSlotItems] = createSignal<MstSlotItemRecord[]>([]);
  const [weaponIconFrames, setWeaponIconFrames] = createSignal<Record<number, WeaponIconFrame>>({});
  const [weaponIconMeta, setWeaponIconMeta] = createSignal<WeaponIconMeta>({ width: 0, height: 0 });
  const [mapSpotsByKey, setMapSpotsByKey] = createSignal<Record<string, MapSpot[]>>({});
  const [mapPortsByKey, setMapPortsByKey] = createSignal<Record<string, number[]>>({});
  const [mapLabelsByKey, setMapLabelsByKey] = createSignal<Record<string, Record<number, string>>>({});
  const [mapFrameMetaByKey, setMapFrameMetaByKey] = createSignal<Record<string, MapFrameMeta>>({});
  const pendingMetadataLoads = new Map<string, Promise<void>>();

  let mapMetadataAbortController: AbortController | null = null;
  let loadDataAbortController: AbortController | null = null;

  // ── Helper closures (depend on signal state) ────────────────────────────────

  function addMetadataWarning(message: string) {
    setMetadataWarnings((prev) => (prev.includes(message) ? prev : [...prev, message]));
  }

  function toggleCellFilter(next: SelectedCellFilter) {
    setSelectedCellFilter((current) => {
      if (current?.key === next.key && current.mapKey === next.mapKey) return null;
      return next;
    });
  }

  /** Returns the display label for a cell (e.g. "港(0)", "D(4)"). */
  function cellLabel(cellId: number, mapKey?: string): string {
    const key = mapKey ?? selectedSortieRoute()?.mapKey;
    return pureCellLabel(cellId, key ? mapLabelsByKey()[key] : undefined);
  }

  /** Returns the short overlay label for a cell (e.g. "港", "D"). */
  function cellOverlayLabel(cellId: number, mapKey: string): string {
    return pureCellOverlayLabel(cellId, mapLabelsByKey()[mapKey]);
  }

  function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
  }

  // ── Map metadata loading ────────────────────────────────────────────────────

  async function ensureMapMetadata(mapKey: string): Promise<void> {
    if (!mapKey || mapSpotsByKey()[mapKey]) return;
    const pending = pendingMetadataLoads.get(mapKey);
    if (pending) return pending;
    const asset = getBattleMapAsset(mapKey);
    if (!asset) return;
    if (!mapMetadataAbortController || mapMetadataAbortController.signal.aborted) {
      mapMetadataAbortController = new AbortController();
    }
    const signal = mapMetadataAbortController.signal;

    const request = (async () => {
      try {
        try {
          const imageMetaResponse = await fetch(asset.imageMetaUrl, { signal });
          if (signal.aborted) return;
          if (imageMetaResponse.ok) {
            const imageMetaPayload = (await imageMetaResponse.json()) as MapImageMetaPayload;
            const parsed = parseMapFrameMeta(imageMetaPayload);
            if (parsed) {
              setMapFrameMetaByKey((prev) => ({ ...prev, [mapKey]: parsed }));
            } else {
              addMetadataWarning(`${mapKey} の画像情報を読み取れませんでした。`);
            }
          } else {
            addMetadataWarning(`${mapKey} の画像情報の読み込みに失敗しました。`);
          }
        } catch (error) {
          if (isAbortError(error)) return;
          addMetadataWarning(`${mapKey} の画像情報の読み込みに失敗しました。`);
        }

        const response = await fetch(asset.infoUrl, { signal });
        if (signal.aborted) return;
        if (!response.ok) {
          addMetadataWarning(`${mapKey} のマップ情報の読み込みに失敗しました。`);
          return;
        }
        const payload = (await response.json()) as MapInfoPayload;
        const spots = (payload.spots || [])
          .map((spot): MapSpot | null => {
            const cellId = Number(spot.no ?? NaN);
            const x = Number(spot.x ?? NaN);
            const y = Number(spot.y ?? NaN);
            if (!Number.isFinite(cellId) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
            const lineOffsetX = Number(spot.line?.x ?? NaN);
            const lineOffsetY = Number(spot.line?.y ?? NaN);
            return {
              cellId,
              x,
              y,
              lineOffsetX: Number.isFinite(lineOffsetX) ? lineOffsetX : undefined,
              lineOffsetY: Number.isFinite(lineOffsetY) ? lineOffsetY : undefined,
            } satisfies MapSpot;
          })
          .filter((spot): spot is MapSpot => spot !== null);

        if (spots.length > 0) {
          setMapSpotsByKey((prev) => ({ ...prev, [mapKey]: spots }));
        }

        const spotPorts = spots.filter((s) => s.cellId === 0).map((s) => s.cellId);
        if (spotPorts.length > 0) {
          setMapPortsByKey((prev) => ({ ...prev, [mapKey]: spotPorts }));
        }

        if (asset.labelsUrl && !mapLabelsByKey()[mapKey]) {
          try {
            const labelsResponse = await fetch(asset.labelsUrl, { signal });
            if (signal.aborted) return;
            if (labelsResponse.ok) {
              const labelsPayload = (await labelsResponse.json()) as MapLabelsPayload;
              const labels: Record<number, string> = {};
              for (const [rawId, label] of Object.entries(labelsPayload)) {
                const id = Number(rawId);
                if (!Number.isFinite(id) || typeof label !== "string" || !label) continue;
                labels[id] = label;
              }
              setMapLabelsByKey((prev) => ({ ...prev, [mapKey]: labels }));

              const labeledPorts = Object.entries(labels)
                .filter(([, label]) => /港/.test(label))
                .map(([id]) => Number(id))
                .filter((id) => Number.isFinite(id));
              if (labeledPorts.length > 0) {
                setMapPortsByKey((prev) => ({ ...prev, [mapKey]: labeledPorts }));
              }
            } else {
              addMetadataWarning(`${mapKey} のセル名データの読み込みに失敗しました。代替ラベルで表示します。`);
            }
          } catch (error) {
            if (isAbortError(error)) return;
            addMetadataWarning(`${mapKey} のセル名データの読み込みに失敗しました。代替ラベルで表示します。`);
          }
        }
      } catch (error) {
        if (isAbortError(error)) return;
        addMetadataWarning(`${mapKey} のマップ情報の読み込みに失敗しました。`);
      } finally {
        pendingMetadataLoads.delete(mapKey);
      }
    })();

    pendingMetadataLoads.set(mapKey, request);
    return request;
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const describeEnemy = createMemo(() =>
    buildEnemyDeckResolver(enemyDecks(), enemyShips(), mstShips()),
  );

  const describeEnemyFleet = createMemo(() =>
    buildEnemyFleetResolver(
      enemyDecks(),
      enemyShips(),
      enemySlotItems(),
      mstShips(),
      mstSlotItems(),
    ),
  );

  const mapOptions = createMemo(() => {
    const values = new Set<string>();
    for (const rec of battleRecords()) {
      const key = mapKeyOf(rec);
      if (key !== "0-0") values.add(key);
    }
    for (const rec of cellRecords()) {
      const key = mapKeyOf(rec);
      if (key !== "0-0") values.add(key);
    }
    return [...values].sort((a, b) => a.localeCompare(b, "ja"));
  });

  createEffect(() => {
    const maps = mapOptions();
    for (const key of maps) {
      void ensureMapMetadata(key);
    }
  });

  const filteredBattles = createMemo(() => {
    const selected = mapFilter();
    return battleRecords()
      .filter((r) => !selected || mapKeyOf(r) === selected)
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  });

  const filteredCellRecords = createMemo(() => {
    const selected = mapFilter();
    return cellRecords().filter((r) => !selected || mapKeyOf(r) === selected);
  });

  const mstShipNameById = createMemo(() => new Map(mstShips().map((ship) => [ship.id, ship.name])));

  const battleGroupsByUuid = createMemo(() => {
    const groups = new Map<string, BattleRecord[]>();
    for (const battle of filteredBattles()) {
      if (!battle.uuid) continue;
      const list = groups.get(battle.uuid);
      if (list) {
        list.push(battle);
      } else {
        groups.set(battle.uuid, [battle]);
      }
    }
    for (const list of groups.values()) {
      list.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    }
    return groups;
  });

  const allSortieRoutes = createMemo(() => {
    const allRoutes = filteredCellRecords()
      .map((cellRecord) => {
        const mapKey = mapKeyOf(cellRecord);
        const cells = (cellRecord.cell_index || [])
          .map((cellId) => Number(cellId ?? NaN))
          .filter((cellId) => Number.isFinite(cellId));
        if (cells.length === 0) return null;

        const ports = mapPortsByKey()[mapKey] || [];
        const spots = mapSpotsByKey()[mapKey] || [];
        const routeCells = resolveRouteCellsWithPort(cells, ports, spots);

        const battles = cellRecord.battles
          ? [...(battleGroupsByUuid().get(cellRecord.battles) || [])]
          : [];
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

        const steps = routeCells.map((cellId, idx) => {
          const matches = battlesByCell.get(cellId) || [];
          const battle = matches.shift();
          return {
            stepNo: idx + 1,
            cellId,
            enemy: battle ? describeEnemy()(battle.e_deck_id) : "通過",
            hasBattle: !!battle,
          };
        });

        const routeTimestamp = Math.max(
          0,
          ...battles
            .map((battle) => Number(battle.timestamp ?? 0))
            .filter((ts) => Number.isFinite(ts)),
        );

        const sortieId =
          cellRecord.uuid ||
          cellRecord.battles ||
          cellRecord.env_uuid ||
          `${mapKey}:${routeCells.join("-")}`;

        return {
          sortieId,
          mapKey,
          route: routeCells.map((cellId) => cellLabel(cellId, mapKey)).join(" → "),
          cells: routeCells,
          steps,
          battleCount: steps.filter((step) => step.hasBattle).length,
          sortTimestamp: routeTimestamp,
        };
      })
      .filter((route): route is NonNullable<typeof route> => !!route);

    // 同じセルパスを持つルートをマージ（最新のタイムスタンプを保持）
    // 帰港（港への帰還）は、ルート末尾の0（港）を無視して比較
    const routeMap = allRoutes.reduce(
      (map, route) => {
        // 末尾が港（0）の場合は除去してキーを生成
        const normalizedCells = route.cells.at(-1) === 0 ? route.cells.slice(0, -1) : route.cells;
        const cellPathKey = `${route.mapKey}:${normalizedCells.join("-")}`;
        const existing = map.get(cellPathKey);
        if (!existing || route.sortTimestamp > existing.sortTimestamp) {
          map.set(cellPathKey, route);
        }
        return map;
      },
      new Map<string, SortieRoute>(),
    );

    return Array.from(routeMap.values()).sort((a, b) => b.sortTimestamp - a.sortTimestamp);
  });

  const filteredRouteCount = createMemo(() => {
    const filter = selectedCellFilter();
    if (!filter) return allSortieRoutes().length;
    const cellIds = new Set(filter.cellIds);
    return allSortieRoutes().filter(
      (route) => route.mapKey === filter.mapKey && route.cells.some((cellId) => cellIds.has(cellId)),
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

  const isRouteListTruncated = createMemo(() => filteredRouteCount() > MAX_SORTIE_ROUTES);

  const analysis = createMemo(() => {
    const transitionMap = new Map<string, { from: number; to: number; count: number }>();
    const statMap = new Map<
      number,
      { cell: number; passCount: number; nextCells: Map<number, number>; battleCount: number; enemyCounts: Map<string, number> }
    >();
    const battleGroups = battleGroupsByUuid();

    for (const route of filteredCellRecords()) {
      const cells = (route.cell_index || [])
        .map((cellId) => Number(cellId ?? NaN))
        .filter((cellId) => Number.isFinite(cellId));
      if (cells.length === 0) continue;

      const mapKey = mapKeyOf(route);
      const ports = mapPortsByKey()[mapKey] || [];
      const spots = mapSpotsByKey()[mapKey] || [];
      const routeCells = resolveRouteCellsWithPort(cells, ports, spots);

      const battles = route.battles ? [...(battleGroups.get(route.battles) || [])] : [];
      const battlesByCell = new Map<number, BattleRecord[]>();
      for (const battle of battles) {
        const list = battlesByCell.get(battle.cell_id);
        if (list) {
          list.push(battle);
        } else {
          battlesByCell.set(battle.cell_id, [battle]);
        }
      }

      for (let i = 0; i < routeCells.length; i++) {
        const currentCell = routeCells[i];
        let stat = statMap.get(currentCell);
        if (!stat) {
          stat = { cell: currentCell, passCount: 0, nextCells: new Map(), battleCount: 0, enemyCounts: new Map() };
          statMap.set(currentCell, stat);
        }

        stat.passCount++;

        const battle = (battlesByCell.get(currentCell) || []).shift();
        if (battle) {
          stat.battleCount++;
          const enemyLabel = describeEnemy()(battle.e_deck_id);
          stat.enemyCounts.set(enemyLabel, (stat.enemyCounts.get(enemyLabel) ?? 0) + 1);
        }

        const nextCell = routeCells[i + 1];
        if (typeof nextCell === "number") {
          const key = `${currentCell}->${nextCell}`;
          const existing = transitionMap.get(key);
          if (existing) {
            existing.count++;
          } else {
            transitionMap.set(key, { from: currentCell, to: nextCell, count: 1 });
          }
          stat.nextCells.set(nextCell, (stat.nextCells.get(nextCell) ?? 0) + 1);
        }
      }
    }

    const transitions = [...transitionMap.values()];
    const stats = [...statMap.values()].sort((a, b) => b.passCount - a.passCount);
    return { transitions, stats };
  });

  const selectedSortieRoute = createMemo(() => {
    const routes = displayedSortieRoutes();
    if (routes.length === 0) return null;
    return routes.find((r) => r.sortieId === selectedSortieId()) || routes[0];
  });

  // Clear stale cell filter when filtered routes no longer include the selected cell.
  createEffect(() => {
    const filter = selectedCellFilter();
    if (!filter) return;
    const exists = allSortieRoutes().some((route) => {
      if (route.mapKey !== filter.mapKey) return false;
      return route.cells.some((cellId) => filter.cellIds.includes(cellId));
    });
    if (!exists) {
      setSelectedCellFilter(null);
    }
  });

  const selectedAsset = createMemo(() => {
    const selected = selectedSortieRoute();
    const key = selected?.mapKey || mapFilter() || null;
    return getBattleMapAsset(key);
  });

  const resolvedOfficialMapTheme = createMemo<BattleMapTheme>(() => {
    const mode = officialMapThemeMode();
    return mode === "auto" ? detectedTheme() : mode;
  });

  // ── Overlay computation ─────────────────────────────────────────────────────

  const selectedRouteOverlay = createMemo((): ResolvedRouteOverlay | null => {
    const asset = selectedAsset();
    const selected = selectedSortieRoute();
    if (!asset || !selected) return null;
    const frameMeta = mapFrameMetaByKey()[asset.mapKey];
    const hasStandaloneThemeSprite = !!asset.spriteUrls;
    const resolvedAsset = {
      ...asset,
      spriteUrl: resolveBattleMapSpriteUrl(asset, resolvedOfficialMapTheme()),
      spriteSheetSize: hasStandaloneThemeSprite ? asset.spriteSheetSize : (frameMeta?.spriteSheetSize ?? asset.spriteSheetSize),
      routeLayoutFrame: hasStandaloneThemeSprite ? asset.routeLayoutFrame : (frameMeta?.routeLayoutFrame ?? asset.routeLayoutFrame),
      seaMapFrame: hasStandaloneThemeSprite ? asset.seaMapFrame : (frameMeta?.seaMapFrame ?? asset.seaMapFrame),
    };
    const spots = mapSpotsByKey()[asset.mapKey] || [];
    if (spots.length === 0) return null;

    const spotByCellId = new Map(spots.map((spot) => [spot.cellId, spot]));
    const spotRenderPositions = buildSpotRenderPositions(spots);
    const seenCount = new Map<number, number>();
    const statByCell = new Map(analysis().stats.map((stat) => [stat.cell, stat]));

    const markers: OverlayMarker[] = selected.steps
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

    const transitions: TransitionOverlay[] = analysis().transitions
      .map((transition) => {
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
    const selectedRouteStateByCellId = new Map<number, { visited: boolean; hasBattle: boolean }>();
    for (const step of selected.steps) {
      const current = selectedRouteStateByCellId.get(step.cellId);
      selectedRouteStateByCellId.set(step.cellId, {
        visited: true,
        hasBattle: (current?.hasBattle ?? false) || step.hasBattle,
      });
    }

    const inferredRoutes = inferRouteOverlays(spots, frameMeta?.routeFrames, analysis().transitions);

    // Group spots by label+position so duplicate-coordinate cells share one circle.
    const groupedSpotStats = new Map<
      string,
      { key: string; label: string; x: number; y: number; cellIds: number[]; passCount: number; battleCount: number }
    >();
    for (const spot of visibleSpots) {
      const label = cellOverlayLabel(spot.cellId, asset.mapKey);
      if (!label || label === "-") continue;
      const key = `${label}:${spot.x}:${spot.y}`;
      const current = groupedSpotStats.get(key);
      if (current) {
        if (!current.cellIds.includes(spot.cellId)) {
          current.cellIds.push(spot.cellId);
        }
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
      currentRouteVisited: spot.cellIds.some((cellId) => selectedRouteStateByCellId.get(cellId)?.visited),
      currentRouteHasBattle: spot.cellIds.some((cellId) => selectedRouteStateByCellId.get(cellId)?.hasBattle),
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
      { width: resolvedAsset.routeLayoutFrame.width, height: resolvedAsset.routeLayoutFrame.height },
      labelObstacles,
    );

    const cellKeyByCellId = new Map<number, string>();
    for (const spot of visibleLabelSpots) {
      for (const cellId of spot.cellIds) {
        cellKeyByCellId.set(cellId, spot.key);
      }
    }

    const maxPassCount = Math.max(1, ...analysis().stats.map((stat) => stat.passCount));
    const viewportHeight =
      resolvedAsset.routeLayoutFrame.height * (DEFAULT_MAP_VIEWPORT_HEIGHT_PERCENT / 100);
    const viewportOffsetY = (resolvedAsset.routeLayoutFrame.height - viewportHeight) / 2;

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
    };
  });

  // ── Selected cell details ───────────────────────────────────────────────────

  const selectedCellDetails = createMemo((): SelectedCellDetails | null => {
    const filter = selectedCellFilter();
    if (!filter) return null;

    const cellIdSet = new Set(filter.cellIds);
    const matchingRoutes = allSortieRoutes().filter(
      (route) => route.mapKey === filter.mapKey && route.cells.some((cellId) => cellIdSet.has(cellId)),
    );
    const matchingBattles = filteredBattles()
      .filter((battle) => mapKeyOf(battle) === filter.mapKey && cellIdSet.has(battle.cell_id))
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

    const enemyFleetCounts = new Map<string, { fleet: ReturnType<ReturnType<typeof describeEnemyFleet>>; count: number }>();
    const resultCounts = new Map<string, number>();
    const dropCounts = new Map<string, number>();
    const outgoingCounts = new Map<string, number>();

    let passCount = 0;
    for (const route of matchingRoutes) {
      route.steps.forEach((step, index) => {
        if (!cellIdSet.has(step.cellId)) return;
        passCount++;
        const next = route.steps[index + 1];
        const nextLabel = next ? cellLabel(next.cellId, route.mapKey) : "到達";
        const transitionLabel = `${cellLabel(step.cellId, route.mapKey)} → ${nextLabel}`;
        outgoingCounts.set(transitionLabel, (outgoingCounts.get(transitionLabel) ?? 0) + 1);
      });
    }

    for (const battle of matchingBattles) {
      const enemyFleet = describeEnemyFleet()(battle.e_deck_id);
      const fleetKey = enemyFleet.signature;
      const existing = enemyFleetCounts.get(fleetKey);
      if (existing) {
        existing.count++;
      } else {
        enemyFleetCounts.set(fleetKey, { fleet: enemyFleet, count: 1 });
      }

      const result = battle.battle_result && typeof battle.battle_result === "object" ? battle.battle_result : null;
      if (result?.win_rank) {
        resultCounts.set(result.win_rank, (resultCounts.get(result.win_rank) ?? 0) + 1);
      }
      if (result?.drop_ship_id) {
        const dropName = mstShipNameById().get(result.drop_ship_id) ?? `艦娘ID:${result.drop_ship_id}`;
        dropCounts.set(dropName, (dropCounts.get(dropName) ?? 0) + 1);
      }
    }

    return {
      ...filter,
      passCount,
      routeCount: matchingRoutes.length,
      battleCount: matchingBattles.length,
      topEnemyFleets: [...enemyFleetCounts.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5)
        .map(([, { fleet, count }]) => ({
          ...fleet,
          count,
        })),
      resultCounts: [...resultCounts.entries()].sort((a, b) => b[1] - a[1]),
      dropCounts: [...dropCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      outgoingCounts: [...outgoingCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
      recentBattles: matchingBattles.slice(0, 8).map((battle) => ({
        uuid: battle.uuid ?? battle.env_uuid ?? `${battle.cell_id}-${battle.timestamp ?? 0}`,
        timestamp: formatTimestamp(battle.timestamp),
        enemy: describeEnemy()(battle.e_deck_id),
        result: battle.battle_result && typeof battle.battle_result === "object" ? battle.battle_result : null,
      })),
    };
  });

  // ── Data fetching ───────────────────────────────────────────────────────────

  async function loadData() {
    loadDataAbortController?.abort();
    const abortController = new AbortController();
    loadDataAbortController = abortController;
    const signal = abortController.signal;
    const requestedPeriodTag = periodTag();

    setLoading(true);
    setError(null);
    setPartialLoadWarnings([]);
    try {
      const parseOptionalJson = async <T,>(
        response: Response,
        fallback: T,
        label: string,
        warnings: Set<string>,
      ): Promise<T> => {
        if (!response.ok) {
          warnings.add(`${label}の読込に失敗`);
          return fallback;
        }
        try {
          return (await response.json()) as T;
        } catch (err) {
          console.warn("[map-flow] Failed to parse optional response", err);
          warnings.add(`${label}の解析に失敗`);
          return fallback;
        }
      };

      const optionalWarnings = new Set<string>();

      const [battleRes, cellsRes, enemyDeckRes, enemyShipRes, enemySlotItemRes, mstShipRes, mstSlotItemRes, battleResultRes, weaponIconFramesRes] =
        await Promise.all([
          cachedFetch(`/api/battle-data/global/records?table=battle&period_tag=${encodeURIComponent(requestedPeriodTag)}&limit_blocks=20&limit_records=12000&include_sortie_key=1`, { signal }),
          cachedFetch(`/api/battle-data/global/records?table=cells&period_tag=${encodeURIComponent(requestedPeriodTag)}&limit_blocks=20&limit_records=12000`, { signal }),
          cachedFetch(`/api/battle-data/global/records?table=enemy_deck&period_tag=${encodeURIComponent(requestedPeriodTag)}&limit_blocks=20&limit_records=8000`, { signal }),
          cachedFetch(`/api/battle-data/global/records?table=enemy_ship&period_tag=${encodeURIComponent(requestedPeriodTag)}&limit_blocks=20&limit_records=20000`, { signal }),
          cachedFetch(`/api/battle-data/global/records?table=enemy_slotitem&period_tag=${encodeURIComponent(requestedPeriodTag)}&limit_blocks=20&limit_records=40000`, { signal }),
          cachedFetch(`/api/master-data/json?table_name=mst_ship`, { signal }),
          cachedFetch(`/api/master-data/json?table_name=mst_slotitem`, { signal }),
          cachedFetch(`/api/battle-data/global/records?table=battle_result&period_tag=${encodeURIComponent(requestedPeriodTag)}&limit_blocks=20&limit_records=12000`, { signal }),
          cachedFetch(`/api/asset-sync/weapon-icon-frames?v=2`, { signal }),
        ]);

      if (signal.aborted) return;

      if (!battleRes.ok) {
        setError("戦闘データの取得に失敗しました。");
        setBattleRecords([]);
        return;
      }

      const battlePayload = (await battleRes.json()) as { records?: BattleRecord[] };
      const cellsPayload = await parseOptionalJson<{ records?: CellRecord[] }>(cellsRes, { records: [] }, "セル履歴", optionalWarnings);
      const deckPayload = await parseOptionalJson<{ records?: EnemyDeckRecord[] }>(enemyDeckRes, { records: [] }, "敵編成", optionalWarnings);
      const shipPayload = await parseOptionalJson<{ records?: EnemyShipRecord[] }>(enemyShipRes, { records: [] }, "敵艦情報", optionalWarnings);
      const slotItemPayload = await parseOptionalJson<{ records?: EnemySlotItemRecord[] }>(enemySlotItemRes, { records: [] }, "敵装備情報", optionalWarnings);
      const mstPayload = await parseOptionalJson<{ records?: MstShipRecord[] }>(mstShipRes, { records: [] }, "艦マスタ", optionalWarnings);
      const mstSlotItemPayload = await parseOptionalJson<{ records?: MstSlotItemRecord[] }>(mstSlotItemRes, { records: [] }, "装備マスタ", optionalWarnings);
      const battleResultPayload = await parseOptionalJson<{ records?: BattleResultRecord[] }>(battleResultRes, { records: [] }, "戦闘結果", optionalWarnings);
      const weaponIconFramesPayload = await parseOptionalJson<{
        frames?: Record<string, { frame?: { x?: number; y?: number; w?: number; h?: number } }>;
        meta?: { size?: { w?: number; h?: number } };
      }>(weaponIconFramesRes, {}, "装備アイコン情報", optionalWarnings);

      if (optionalWarnings.size > 0) {
        setPartialLoadWarnings([...optionalWarnings]);
      }

      const iconFrames: Record<number, WeaponIconFrame> = {};
      for (const [name, entry] of Object.entries(weaponIconFramesPayload.frames || {})) {
        const match = name.match(/_id_(\d+)$/);
        if (!match) continue;
        const iconId = Number.parseInt(match[1], 10);
        const frame = entry?.frame;
        if (!frame) continue;
        const x = Number(frame.x ?? NaN);
        const y = Number(frame.y ?? NaN);
        const w = Number(frame.w ?? NaN);
        const h = Number(frame.h ?? NaN);
        if (!Number.isFinite(iconId) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
          continue;
        }
        iconFrames[iconId] = { x, y, w, h };
      }

      const battleResultByUuid = new Map<string, BattleResultData>();
      for (const rec of battleResultPayload.records || []) {
        if (!rec?.uuid || !rec.win_rank) continue;
        battleResultByUuid.set(rec.uuid, {
          win_rank: rec.win_rank,
          drop_ship_id: rec.drop_ship_id ?? null,
        });
      }

      // Resolve battle results that are referenced by UUID but not in the bulk payload.
      const unresolvedResultUuids = new Set<string>();
      for (const rec of battlePayload.records || []) {
        if (typeof rec?.battle_result === "string" && !battleResultByUuid.has(rec.battle_result)) {
          unresolvedResultUuids.add(rec.battle_result);
        }
      }

      if (unresolvedResultUuids.size > 0) {
        const fillTargets = [...unresolvedResultUuids].slice(0, 100);
        // Batch lookup: send all UUIDs in a single filter_json with array value
        const batchFilterJson = encodeURIComponent(JSON.stringify({ uuid: fillTargets }));
        const batchRes = await cachedFetch(
          `/api/battle-data/global/records?table=battle_result&period_tag=all&limit_blocks=120&limit_records=${fillTargets.length * 2}&filter_json=${batchFilterJson}`,
          { signal },
        );
        if (batchRes.ok) {
          const body = (await batchRes.json().catch(() => ({}))) as { records?: BattleResultRecord[] };
          for (const found of body.records || []) {
            if (found?.uuid && found.win_rank && !battleResultByUuid.has(found.uuid)) {
              battleResultByUuid.set(found.uuid, {
                win_rank: found.win_rank,
                drop_ship_id: found.drop_ship_id ?? null,
              });
            }
          }
        }
      }

      if (signal.aborted || loadDataAbortController !== abortController) return;

      // Build a map from battle-group UUID to map coordinates (some battle records lack map info).
      const mapByBattleUuid = new Map<string, { maparea_id: number; mapinfo_no: number }>();
      for (const cell of cellsPayload.records || []) {
        const battleUuid = cell.battles;
        if (!battleUuid) continue;
        const maparea = Number(cell.maparea_id ?? 0);
        const mapinfo = Number(cell.mapinfo_no ?? 0);
        if (maparea > 0 && mapinfo > 0) {
          mapByBattleUuid.set(battleUuid, { maparea_id: maparea, mapinfo_no: mapinfo });
        }
      }

      const mergedBattles = (battlePayload.records || [])
        .filter((r) => typeof r.cell_id === "number")
        .map((r) => {
          const normalizedTimestamp =
            normalizeEpochMs(r.timestamp) ?? normalizeEpochMs(r.midnight_timestamp) ?? null;
          const normalizedBattleResult = resolveBattleResult(r.battle_result, battleResultByUuid);
          if (r.maparea_id && r.mapinfo_no) {
            return { ...r, timestamp: normalizedTimestamp, battle_result: normalizedBattleResult };
          }
          const resolved = r.uuid ? mapByBattleUuid.get(r.uuid) : undefined;
          return { ...r, ...(resolved || {}), timestamp: normalizedTimestamp, battle_result: normalizedBattleResult };
        });

      setBattleRecords(mergedBattles);
      setCellRecords(cellsPayload.records || []);
      setEnemyDecks(deckPayload.records || []);
      setEnemyShips(shipPayload.records || []);
      setEnemySlotItems(slotItemPayload.records || []);
      setMstShips(mstPayload.records || []);
      setMstSlotItems(mstSlotItemPayload.records || []);
      setWeaponIconFrames(iconFrames);
      setWeaponIconMeta({
        width: Number(weaponIconFramesPayload.meta?.size?.w ?? 0) || 0,
        height: Number(weaponIconFramesPayload.meta?.size?.h ?? 0) || 0,
      });

      const hasMapInPayload =
        mergedBattles.some((r) => mapKeyOf(r) === mapFilter()) ||
        (cellsPayload.records || []).some((r) => mapKeyOf(r) === mapFilter());
      if (mapFilter() && !hasMapInPayload) {
        setMapFilter("");
      }
    } catch (e) {
      if (isAbortError(e)) return;
      setError("読込に失敗しました。しばらくしてから再試行してください。");
      setBattleRecords([]);
      setCellRecords([]);
    } finally {
      if (loadDataAbortController === abortController) {
        setLoading(false);
      }
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  onMount(() => {
    const detectTheme = (): BattleMapTheme => {
      const rootTheme = document.documentElement.getAttribute("data-theme")?.toLowerCase();
      if (rootTheme?.includes("dark")) return "dark";
      if (rootTheme?.includes("light")) return "light";
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    };

    const applyDetectedTheme = () => setDetectedTheme(detectTheme());
    applyDetectedTheme();

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onMediaQueryChange = () => applyDetectedTheme();
    mediaQuery.addEventListener("change", onMediaQueryChange);

    const observer = new MutationObserver(() => applyDetectedTheme());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });

    const saved = window.localStorage.getItem(MAP_FLOW_DISPLAY_SETTINGS_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as {
          showOfficialMapAssets?: boolean;
          officialMapThemeMode?: OfficialMapThemeMode;
        };
        setShowOfficialMapAssets(parsed.showOfficialMapAssets ?? true);
        setOfficialMapThemeMode(parseOfficialMapThemeMode(parsed.officialMapThemeMode));
      } catch {
        window.localStorage.removeItem(MAP_FLOW_DISPLAY_SETTINGS_KEY);
      }
    }

    onCleanup(() => {
      mapMetadataAbortController?.abort();
      loadDataAbortController?.abort();
      pendingMetadataLoads.clear();
      observer.disconnect();
      mediaQuery.removeEventListener("change", onMediaQueryChange);
    });

    void loadData();
  });

  // Persist display settings whenever they change.
  createEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      MAP_FLOW_DISPLAY_SETTINGS_KEY,
      JSON.stringify({
        showOfficialMapAssets: showOfficialMapAssets(),
        officialMapThemeMode: officialMapThemeMode(),
      }),
    );
  });

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Filter / load controls */}
      <div class="card bg-base-100 shadow-sm mb-6">
        <div class="card-body p-4">
          <div class="flex flex-wrap gap-4 items-end">
            <div class="form-control">
              <label class="label"><span class="label-text">マップ</span></label>
              <select
                class="select select-bordered select-sm"
                value={mapFilter()}
                onInput={(e) => setMapFilter(e.currentTarget.value)}
              >
                <option value="">全て</option>
                <For each={mapOptions()}>{(map) => <option value={map}>{map}</option>}</For>
              </select>
            </div>
            <div class="form-control">
              <label class="label"><span class="label-text">期間</span></label>
              <select
                class="select select-bordered select-sm"
                value={periodTag()}
                onInput={(e) => setPeriodTag(e.currentTarget.value)}
              >
                <option value="latest">最新</option>
                <option value="all">全期間</option>
              </select>
            </div>
            <button class="btn btn-primary btn-sm" onClick={() => void loadData()} disabled={loading()}>
              {loading() ? "読込中..." : "読込"}
            </button>
            <button
              class="btn btn-ghost btn-sm gap-1.5"
              type="button"
              onClick={() => displaySettingsModalRef.showModal()}
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317a1 1 0 011.35-.936l.964.429a1 1 0 00.88 0l.964-.429a1 1 0 011.35.936l.093 1.053a1 1 0 00.516.79l.9.52a1 1 0 01.364 1.365l-.53.918a1 1 0 000 .998l.53.918a1 1 0 01-.364 1.365l-.9.52a1 1 0 00-.516.79l-.093 1.053a1 1 0 01-1.35.936l-.964-.429a1 1 0 00-.88 0l-.964.429a1 1 0 01-1.35-.936l-.093-1.053a1 1 0 00-.516-.79l-.9-.52a1 1 0 01-.364-1.365l.53-.918a1 1 0 000-.998l-.53-.918a1 1 0 01.364-1.365l.9-.52a1 1 0 00.516-.79l.093-1.053z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9a3 3 0 100 6 3 3 0 000-6z" />
              </svg>
              表示設定
            </button>
          </div>
          <Show when={error()}>{(msg) => <p class="mt-3 text-sm text-error">{msg()}</p>}</Show>
          <Show when={partialLoadWarnings().length > 0}>
            <div class="mt-3 rounded-box border border-info/30 bg-info/10 p-3 text-sm text-info-content">
              <div class="font-semibold text-info">一部データを取得できませんでした</div>
              <div class="text-xs text-base-content/80">
                表示は継続していますが、結果の一部が欠損している可能性があります。しばらく待って再読込してください。
              </div>
              <div class="text-xs text-base-content/70 mt-1">
                失敗項目: {partialLoadWarnings().join(" / ")}
              </div>
            </div>
          </Show>
          <Show when={metadataWarnings().length > 0}>
            <div class="mt-3 rounded-box border border-warning/30 bg-warning/10 p-3 text-sm text-warning-content">
              <div class="font-semibold text-warning">マップメタデータ警告</div>
              <For each={metadataWarnings()}>
                {(warning) => <div class="text-xs text-base-content/80">{warning}</div>}
              </For>
            </div>
          </Show>
        </div>
      </div>

      {/* Map route visualisation */}
      <div class="card bg-base-100 shadow-sm mb-6">
        <div class="card-body">
          <h3 class="card-title text-lg">海域ルート図</h3>
          <div class="text-xs text-base-content/60 mb-2">
            港からどの順番で進んだかを矢印で表示します。線のそばの数字は、そのルートを通った回数です。セルをクリックすると、そのマスを通った出撃だけを表示できます。
          </div>
          <Show
            when={selectedRouteOverlay()}
            fallback={
              <div class="flex items-center justify-center h-64 text-base-content/40">
                {loading() ? "読込中..." : "マップデータを読み込んでいます"}
              </div>
            }
          >
            {(overlay) => (
              <div class="space-y-4">
                {/* Filter badge */}
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-box bg-base-200 p-3 text-sm">
                  <div class="space-y-1">
                    <div class="font-semibold">操作</div>
                    <div class="text-xs text-base-content/70">セルやラベルをクリックするとそのマスに到達した出撃だけに絞り込みます。</div>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <Show when={selectedCellFilter()}>
                      {(selected) => (
                        <button class="btn btn-secondary btn-xs" onClick={() => setSelectedCellFilter(null)}>
                          フィルター解除: {selected().label}
                        </button>
                      )}
                    </Show>
                  </div>
                </div>

                {/* SVG canvas */}
                <MapSvgCanvas
                  overlay={overlay()}
                  selectedCellFilter={selectedCellFilter}
                  toggleCellFilter={toggleCellFilter}
                  showOfficialMapAssets={showOfficialMapAssets}
                />

                {/* Legend / summary */}
                <div class="grid gap-3 md:grid-cols-3">
                  <div class="rounded-box bg-base-200 p-3 text-sm">
                    <div class="font-bold mb-1">見方</div>
                    <div class="text-xs text-base-content/70">表示設定から海域背景画像の表示を切り替えできます</div>
                    <div class="text-xs text-base-content/70">緑の点線: マップ上の接続ルート</div>
                    <div class="text-xs text-base-content/70">経路上の数字: その遷移を通過した回数</div>
                    <div class="text-xs text-base-content/70">赤の矢印: いま表示中の出撃が進んだ順路</div>
                    <div class="text-xs text-base-content/70">白丸: 通過のみ / 赤丸: 戦闘が発生 / 黄丸: 港 / 黒枠: 選択中セル</div>
                  </div>
                  <Show when={selectedSortieRoute()}>
                    {(selected) => (
                      <>
                        <div class="rounded-box bg-base-200 p-3 text-sm">
                          <div class="font-bold mb-1">この出撃の概要</div>
                          <div class="text-xs text-base-content/70">出発: {cellLabel(selected().steps[0]?.cellId ?? -1, selected().mapKey)}</div>
                          <div class="text-xs text-base-content/70">到達: {cellLabel(selected().steps[selected().steps.length - 1]?.cellId ?? -1, selected().mapKey)}</div>
                          <div class="text-xs text-base-content/70">通過 {selected().steps.length} マス / 戦闘 {selected().battleCount} 回</div>
                        </div>
                        <div class="rounded-box bg-base-200 p-3 text-sm">
                          <div class="font-bold mb-1">使い方</div>
                          <div class="text-xs text-base-content/70">ソーティーを切り替えると、赤い矢印がその出撃の進路に更新されます。</div>
                          <div class="text-xs text-base-content/70">セルかラベルをクリックすると、そのマスに到達した出撃だけに絞り込みます。</div>
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
                      displayedSortieRoutesCount={displayedSortieRoutes().length}
                      mstShipNameById={mstShipNameById()}
                      weaponIconFrames={weaponIconFrames()}
                      weaponIconMeta={weaponIconMeta()}
                      onClear={() => setSelectedCellFilter(null)}
                    />
                  )}
                </Show>
              </div>
            )}
          </Show>
        </div>
      </div>

      {/* Cell stats table */}
      <div class="card bg-base-100 shadow-sm">
        <div class="card-body p-0">
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
                  when={!loading() && analysis().stats.length > 0}
                  fallback={
                    <tr>
                      <td colspan={5} class="text-center py-8 text-base-content/40">
                        {loading() ? "読込中..." : "データ読込後に表示されます"}
                      </td>
                    </tr>
                  }
                >
                  <For each={analysis().stats}>
                    {(s) => {
                      const nexts = [...s.nextCells.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .map(([cell, count]) => `${cellLabel(cell, mapFilter() || undefined)} (${count})`)
                        .join(", ");
                      const topEnemies = [...s.enemyCounts.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 2)
                        .map(([enemy, count]) => `${enemy} (${count})`)
                        .join(" / ");
                      const battleRate =
                        s.passCount > 0 ? ((s.battleCount / s.passCount) * 100).toFixed(0) : "0";
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

      {/* Sortie list panel */}
      <div class="card bg-base-100 shadow-sm mt-6">
        <div class="card-body">
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

      {/* Display settings modal */}
      <DisplaySettingsModal
        ref={(el) => { displaySettingsModalRef = el; }}
        showOfficialMapAssets={showOfficialMapAssets}
        setShowOfficialMapAssets={setShowOfficialMapAssets}
        officialMapThemeMode={officialMapThemeMode}
        setOfficialMapThemeMode={setOfficialMapThemeMode}
        resolvedOfficialMapTheme={resolvedOfficialMapTheme}
      />
    </>
  );
}
