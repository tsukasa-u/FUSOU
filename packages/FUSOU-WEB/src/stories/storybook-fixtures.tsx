/** @jsxImportSource solid-js */
import { createSignal, onMount, Show, type JSX } from "solid-js";
import { ShipListRow } from "../components/common/solid/ship-list-row";
import { getBattleMapAsset } from "../data/battleMapAssets";
import type { SharedDashboardState } from "../components/features/battles/solid/types";
import type {
  BattleDataRepository,
  BattleDetailPayload,
  BattleOverviewPayload,
  BattleDropsPayload,
  RecordResult,
} from "../features/battles/repository/types";
import type { BattleFleets, ShipInfo } from "../features/battles/types";
import type {
  MstShipRecord,
  MstSlotItemRecord,
  MapSpot,
  ResolvedRouteOverlay,
  Transition,
} from "../components/features/map-flow/solid/battle-map-flow/types";
import type { MstSlotItemData } from "../features/simulator/types";
import {
  applyExportedFleet,
} from "../features/simulator/snapshot";
import {
  setAssetBaseUrl,
  setBannerMap,
  setCardMap,
  setFleetSectionVisible,
  setMasterShip,
  setMasterSlotItem,
  setVisibleAirbaseCount,
  setAirbaseSectionVisible,
} from "../features/simulator/simulator-mutations";
import { updateDataStatus } from "../features/simulator/data-loader";
import { renderAll } from "../features/simulator/airbase-renderer";
import { state as simulatorState } from "../features/simulator/state";
import { workspaceStore } from "../features/simulator/viewer-workspace";
import {
  parseBattleRecords,
  parseCellRecords,
  parseEnemyDeckRecords,
  parseEnemyShipRecords,
  parseMasterShipRecords,
  parseMasterSlotItemRecords,
} from "../components/features/map-flow/solid/battle-map-flow/recordParsers";
import {
  getStorybookBattleDetail,
  getStorybookBattleDrops,
  getStorybookBattleOverview,
  getStorybookBattleScenario,
  getStorybookRecords,
  STORYBOOK_SAMPLE_FLEET,
  STORYBOOK_SAMPLE_PERIOD,
  STORYBOOK_SAMPLE_PERIODS,
  STORYBOOK_SAMPLE_BATTLE_SHIPS,
  STORYBOOK_SAMPLE_SHIPS,
  STORYBOOK_SAMPLE_SLOT_ITEMS,
  STORYBOOK_SAMPLE_SORTIE_ID,
  STORYBOOK_SAMPLE_VIEWER_WORKSPACE,
  type StorybookBattleScenario,
} from "./storybook-page-fixtures";
import { inferRouteOverlays } from "../components/features/map-flow/solid/battle-map-flow/routeInference";

export {
  STORYBOOK_SAMPLE_PERIOD,
  STORYBOOK_SAMPLE_SHIPS,
  STORYBOOK_SAMPLE_SORTIE_ID,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseStorybookShipInfo(value: unknown): ShipInfo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item["name"] !== "string") return [];
    const equipments = Array.isArray(item["equipments"])
      ? item["equipments"].flatMap((rawEquipment) => {
          if (!isRecord(rawEquipment) || typeof rawEquipment["name"] !== "string") {
            return [];
          }
          return [{
            name: rawEquipment["name"],
            level: nullableNumber(rawEquipment["level"]),
            iconType: nullableNumber(rawEquipment["iconType"]),
            slotItemId: nullableNumber(rawEquipment["slotItemId"]),
          }];
        })
      : [];
    return [{
      name: item["name"],
      shipId: nullableNumber(item["shipId"]),
      level: nullableNumber(item["level"]),
      nowhp: nullableNumber(item["nowhp"]),
      maxhp: nullableNumber(item["maxhp"]),
      karyoku: nullableNumber(item["karyoku"]),
      raisou: nullableNumber(item["raisou"]),
      taiku: nullableNumber(item["taiku"]),
      soukou: nullableNumber(item["soukou"]),
      bannerUrl: typeof item["bannerUrl"] === "string" ? item["bannerUrl"] : "",
      equipments,
    }];
  });
}

export function createStorybookBattleViewArgs(
  scenario: "route" | StorybookBattleScenario = "route",
): {
  battle: Record<string, unknown>;
  fleets: BattleFleets;
  mstSlotItemById: Map<number, MstSlotItemRecord>;
  mstShipById: Map<number, MstShipRecord>;
} {
  const detail =
    scenario === "route"
      ? getStorybookBattleDetail()
      : getStorybookBattleScenario(scenario);
  if (!detail?.battle) {
    throw new Error("Storybook battle detail fixture could not be resolved.");
  }
  return {
    battle: detail.battle,
    fleets: {
      friendlyShips: parseStorybookShipInfo(detail.derived?.friendly_fleet),
      enemyShips: parseStorybookShipInfo(detail.derived?.enemy_fleet),
    },
    mstSlotItemById: createStorybookSlotItemMap(),
    mstShipById: createStorybookShipMap(),
  };
}

export function createStorybookDashboardState(): SharedDashboardState {
  const overview = getStorybookBattleOverview();
  const periods = STORYBOOK_SAMPLE_PERIODS.map((period) => ({
    period_tag: period.period_tag,
    table_version: period.table_version,
  }));
  const mstShips = parseMasterShipRecords(STORYBOOK_SAMPLE_BATTLE_SHIPS);
  const mstSlotItems = parseMasterSlotItemRecords(STORYBOOK_SAMPLE_SLOT_ITEMS);
  const [activeTab, setActiveTab] =
    createSignal<"list" | "detail" | "map-flow" | "stats" | "drops">("list");
  const [selectedPeriod] = createSignal(periods[0] ?? null);
  const [loadingPeriods] = createSignal(false);
  const [loading] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [startDate, setStartDate] = createSignal("");
  const [endDate, setEndDate] = createSignal("");
  const [mapFilter, setMapFilter] = createSignal("1-1");
  const [resultFilter, setResultFilter] = createSignal("");
  const [selectedDetailId, setSelectedDetailId] =
    createSignal(STORYBOOK_SAMPLE_SORTIE_ID);
  const [selectedDatasetId, setSelectedDatasetId] = createSignal("");
  const [selectedBattleIndex, setSelectedBattleIndex] = createSignal<number | null>(0);

  return {
    activeTab,
    setActiveTab,
    selectedPeriod,
    periods: () => periods,
    loadingPeriods,
    loading,
    error: () => null,
    masterDataStatus: () => [
      { name: "mst_ship", status: "success", detail: `${mstShips.length}件` },
      { name: "mst_slotitem", status: "success", detail: `${mstSlotItems.length}件` },
    ],
    partialLoadWarnings: () => [],
    battleRecords: () => parseBattleRecords(overview.battles),
    cellRecords: () => parseCellRecords(overview.cells),
    enemyDecks: () => parseEnemyDeckRecords(overview.enemy_decks),
    enemyShips: () => parseEnemyShipRecords(overview.enemy_ships),
    enemySlotItems: () => [],
    mstShips: () => mstShips,
    mstSlotItems: () => mstSlotItems,
    weaponIconFrames: () => ({}),
    weaponIconMeta: () => ({ width: 0, height: 0 }),
    searchQuery,
    setSearchQuery,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    mapFilter,
    setMapFilter,
    resultFilter,
    setResultFilter,
    selectedDetailId,
    setSelectedDetailId,
    selectedDatasetId,
    setSelectedDatasetId,
    selectedBattleIndex,
    setSelectedBattleIndex,
  };
}

export function createStorybookBattleRepository(): BattleDataRepository {
  return {
    kind: "r2",
    async listPeriods() {
      return STORYBOOK_SAMPLE_PERIODS.map((period) => ({
        periodTag: period.period_tag,
        tableVersion: period.table_version,
      }));
    },
    async getRecords(query): Promise<RecordResult> {
      const records = getStorybookRecords(query.table);
      return {
        success: true,
        table: query.table,
        period_tag: query.periodTag,
        table_version: query.tableVersion ?? STORYBOOK_SAMPLE_PERIOD.table_version,
        count: records.length,
        records,
      };
    },
    async getOverview(query): Promise<BattleOverviewPayload> {
      return getStorybookBattleOverview(
        query.periodTag,
        query.tableVersion ?? STORYBOOK_SAMPLE_PERIOD.table_version,
      );
    },
    async getDrops(query): Promise<BattleDropsPayload> {
      return getStorybookBattleDrops(
        query.periodTag,
        query.tableVersion ?? STORYBOOK_SAMPLE_PERIOD.table_version,
      );
    },
    async getDetail(query): Promise<BattleDetailPayload> {
      const detail = getStorybookBattleDetail(
        query.envUuid,
        query.battleIndex,
        query.periodTag,
        query.tableVersion ?? STORYBOOK_SAMPLE_PERIOD.table_version,
      );
      if (!detail) {
        throw new Error(
          `No Storybook battle fixture for ${query.envUuid} at index ${query.battleIndex}.`,
        );
      }
      return {
        ...detail,
      };
    },
    async getEnvDetail(query) {
      if (query.envUuid !== STORYBOOK_SAMPLE_SORTIE_ID) {
        throw new Error(`No Storybook sortie fixture for ${query.envUuid}.`);
      }
      const details = [0, 1].flatMap((battleIndex) => {
        const detail = getStorybookBattleDetail(
          query.envUuid,
          battleIndex,
          query.periodTag,
          query.tableVersion ?? STORYBOOK_SAMPLE_PERIOD.table_version,
        );
        return detail ? [[battleIndex, detail] as const] : [];
      });
      if (details.length === 0) {
        throw new Error(`No Storybook battle details for ${query.envUuid}.`);
      }
      return {
        success: true,
        env_uuid: query.envUuid,
        period_tag: STORYBOOK_SAMPLE_PERIOD.period_tag,
        table_version: STORYBOOK_SAMPLE_PERIOD.table_version,
        battles: Object.fromEntries(details),
      };
    },
    async dispose() {},
  };
}

export function createStorybookSlotItemMap(): Map<number, MstSlotItemRecord> {
  return new Map(
    parseMasterSlotItemRecords(STORYBOOK_SAMPLE_SLOT_ITEMS).map((item) => [
      item.id,
      item,
    ]),
  );
}

export function createStorybookShipMap(): Map<number, MstShipRecord> {
  return new Map(
    parseMasterShipRecords(STORYBOOK_SAMPLE_BATTLE_SHIPS).map((ship) => [
      ship.id,
      ship,
    ]),
  );
}

export function createStorybookSimulatorEquip(): MstSlotItemData {
  const slotItem = STORYBOOK_SAMPLE_SLOT_ITEMS[0];
  if (!slotItem) throw new Error("Storybook slot item fixture is empty.");
  return slotItem;
}

export function createStorybookSimulatorSlotItems(): MstSlotItemData[] {
  return STORYBOOK_SAMPLE_SLOT_ITEMS;
}

export type StorybookSimulatorVariant =
  | "combined"
  | "normal"
  | "airbase"
  | "strike";

function getStorybookSimulatorFleet(
  variant: StorybookSimulatorVariant,
): Record<string, unknown> {
  if (variant === "normal") {
    return {
      ...STORYBOOK_SAMPLE_FLEET,
      fleet2: [],
      combinedFleetType: 0,
      fleetFormations: { 1: 1, 2: 0, 3: 0, 4: 0 },
    };
  }
  if (variant === "airbase") {
    return {
      ...STORYBOOK_SAMPLE_FLEET,
      fleet1: [],
      fleet2: [],
      fleet3: [],
      fleet4: [],
      combinedFleetType: 0,
      fleetFormations: { 1: 0, 2: 0, 3: 0, 4: 0 },
    };
  }
  if (variant === "strike") {
    return {
      ...STORYBOOK_SAMPLE_FLEET,
      fleet1: [],
      fleet2: [],
      fleet3: [
        ...STORYBOOK_SAMPLE_FLEET.fleet1,
        ...STORYBOOK_SAMPLE_FLEET.fleet2,
      ].slice(0, 7),
      combinedFleetType: 0,
      fleetFormations: { 1: 0, 2: 0, 3: 6, 4: 0 },
    };
  }
  return STORYBOOK_SAMPLE_FLEET;
}

function getStorybookSimulatorFleetWithInventorySnapshot(
  variant: StorybookSimulatorVariant,
): Record<string, unknown> {
  const fleet = getStorybookSimulatorFleet(variant);
  const snapshotShips: Record<string, unknown> = {};
  const snapshotSlotItems: Record<string, unknown> = {};
  let nextShipInstanceId = 1;
  let nextSlotItemInstanceId = 1;

  for (const fleetName of ["fleet1", "fleet2", "fleet3", "fleet4"]) {
    const slots = fleet[fleetName];
    if (!Array.isArray(slots)) continue;

    for (const rawSlot of slots) {
      if (!isRecord(rawSlot)) continue;
      const shipId = nullableNumber(rawSlot["shipId"]);
      if (shipId === null) continue;

      const masterShip = STORYBOOK_SAMPLE_SHIPS.find((ship) => ship.id === shipId);
      if (!masterShip) {
        throw new Error(
          `Storybook fleet references missing ship master data: ${shipId}.`,
        );
      }

      snapshotShips[String(nextShipInstanceId++)] = {
        shipId,
        level: nullableNumber(rawSlot["shipLevel"]) ?? 1,
        name: masterShip.name,
        stype: masterShip.stype,
      };

      const equipIds = Array.isArray(rawSlot["equipIds"])
        ? rawSlot["equipIds"]
        : [];
      const improvements = Array.isArray(rawSlot["equipImprovement"])
        ? rawSlot["equipImprovement"]
        : [];
      const proficiencies = Array.isArray(rawSlot["equipProficiency"])
        ? rawSlot["equipProficiency"]
        : [];

      for (let index = 0; index < equipIds.length; index++) {
        const slotitemId = nullableNumber(equipIds[index]);
        if (slotitemId === null) continue;
        if (!STORYBOOK_SAMPLE_SLOT_ITEMS.some((item) => item.id === slotitemId)) {
          throw new Error(
            `Storybook fleet references missing equipment master data: ${slotitemId}.`,
          );
        }

        snapshotSlotItems[String(nextSlotItemInstanceId++)] = {
          slotitem_id: slotitemId,
          level: nullableNumber(improvements[index]) ?? 0,
          alv: nullableNumber(proficiencies[index]) ?? 0,
        };
      }

      const exSlotId = nullableNumber(rawSlot["exSlotId"]);
      if (exSlotId !== null) {
        if (!STORYBOOK_SAMPLE_SLOT_ITEMS.some((item) => item.id === exSlotId)) {
          throw new Error(
            `Storybook fleet references missing equipment master data: ${exSlotId}.`,
          );
        }
        snapshotSlotItems[String(nextSlotItemInstanceId++)] = {
          slotitem_id: exSlotId,
          level: nullableNumber(rawSlot["exSlotImprovement"]) ?? 0,
          alv: 0,
        };
      }
    }
  }

  return { ...fleet, snapshotShips, snapshotSlotItems };
}

export async function initializeStorybookSimulator(
  variant: StorybookSimulatorVariant = "combined",
  workspace: "empty" | "sample" = "empty",
  options: { includeInventorySnapshot?: boolean } = {},
): Promise<void> {
  const response = await fetch("/api/asset-sync/ship-banner-map");
  if (!response.ok) {
    throw new Error(
      `Storybook asset-sync request failed (${response.status}).`,
    );
  }
  const responseData: unknown = await response.json();
  if (
    !isRecord(responseData) ||
    typeof responseData["base_url"] !== "string" ||
    !isRecord(responseData["banners"])
  ) {
    throw new Error("Storybook asset-sync returned an invalid ship banner map.");
  }

  const bannerMap: Record<string, string> = {};
  for (const [shipId, path] of Object.entries(responseData["banners"])) {
    if (typeof path === "string" && path.length > 0) {
      bannerMap[shipId] = path;
    }
  }
  const missingBanners = STORYBOOK_SAMPLE_SHIPS
    .filter((ship) => !bannerMap[String(ship.id)])
    .map((ship) => ship.name);
  if (missingBanners.length > 0) {
    throw new Error(
      `Storybook asset-sync has no banners for: ${missingBanners.join(", ")}.`,
    );
  }

  const cardResponse = await fetch("/api/asset-sync/ship-card-map");
  if (!cardResponse.ok) {
    throw new Error(
      `Storybook asset-sync request failed (${cardResponse.status}).`,
    );
  }
  const cardResponseData: unknown = await cardResponse.json();
  if (
    !isRecord(cardResponseData) ||
    typeof cardResponseData["base_url"] !== "string" ||
    !isRecord(cardResponseData["cards"])
  ) {
    throw new Error("Storybook asset-sync returned an invalid ship card map.");
  }

  const cardMap: Record<string, string> = {};
  for (const [shipId, path] of Object.entries(cardResponseData["cards"])) {
    if (typeof path === "string" && path.length > 0) {
      cardMap[shipId] = path;
    }
  }
  const missingCards = STORYBOOK_SAMPLE_SHIPS
    .filter((ship) => !cardMap[String(ship.id)])
    .map((ship) => ship.name);
  if (missingCards.length > 0) {
    throw new Error(
      `Storybook asset-sync has no cards for: ${missingCards.join(", ")}.`,
    );
  }

  simulatorState.mstShips = {};
  simulatorState.mstSlotItems = {};
  for (const ship of STORYBOOK_SAMPLE_SHIPS) setMasterShip(ship);
  for (const item of STORYBOOK_SAMPLE_SLOT_ITEMS) setMasterSlotItem(item);
  updateDataStatus();
  setAssetBaseUrl(responseData["base_url"]);
  setBannerMap(bannerMap);
  setCardMap(cardMap);
  workspaceStore.set(
    workspace === "sample"
      ? STORYBOOK_SAMPLE_VIEWER_WORKSPACE
      : { activeId: null, entries: [] },
  );
  applyExportedFleet(
    options.includeInventorySnapshot
      ? getStorybookSimulatorFleetWithInventorySnapshot(variant)
      : getStorybookSimulatorFleet(variant),
  );

  setFleetSectionVisible(1, variant === "combined" || variant === "normal");
  setFleetSectionVisible(2, variant === "combined");
  setFleetSectionVisible(3, variant === "strike");
  setFleetSectionVisible(4, false);
  setAirbaseSectionVisible(true);
  setVisibleAirbaseCount(3);
  renderAll();
}

export function createStorybookResolvedRouteOverlay(
  destinationCell: 2 | 3 = 2,
): ResolvedRouteOverlay {
  const asset = getBattleMapAsset("1-1");
  if (!asset) {
    throw new Error("Storybook map asset 1-1 is unavailable.");
  }
  const spots: MapSpot[] = [
    { cellId: 0, x: 260, y: 246, isPort: true },
    { cellId: 1, x: 597, y: 328, lineOffsetX: -293, lineOffsetY: -73 },
    { cellId: 2, x: 840, y: 204, lineOffsetX: -217, lineOffsetY: 15 },
    { cellId: 3, x: 858, y: 486, lineOffsetX: -238, lineOffsetY: -147 },
  ];
  const transitions: Transition[] = [
    { from: 0, to: 1, count: 2 },
    { from: 1, to: 2, count: 1 },
    { from: 1, to: 3, count: 1 },
  ];
  const inferredRoutes = inferRouteOverlays(spots, undefined, transitions, [
    { routeId: 0, from: 0, to: 1, startX: 311.6, startY: 259.3, ctrlX: 435.9, ctrlY: 289.5, endX: 560.3, endY: 319.7, curvature: 0 },
    { routeId: 1, from: 1, to: 2, startX: 630.6, startY: 314.3, ctrlX: 715.5, ctrlY: 269.4, endX: 800.4, endY: 224.5, curvature: 0 },
    { routeId: 2, from: 1, to: 3, startX: 627.5, startY: 345, ctrlX: 718.1, ctrlY: 401.8, endX: 808.6, endY: 458.6, curvature: 0 },
  ]);
  const visibleLabelSpots = [
    { cellId: 0, label: "1", passCount: 0, battleCount: 0, currentRouteVisited: true, currentRouteHasBattle: false, isPort: true },
    { cellId: 1, label: "A", passCount: 2, battleCount: 0, currentRouteVisited: true, currentRouteHasBattle: false },
    { cellId: 2, label: "B", passCount: 1, battleCount: 1, currentRouteVisited: destinationCell === 2, currentRouteHasBattle: destinationCell === 2 },
    { cellId: 3, label: "C", passCount: 1, battleCount: 1, currentRouteVisited: destinationCell === 3, currentRouteHasBattle: destinationCell === 3 },
  ].map((spot) => {
    const position = spots.find(({ cellId }) => cellId === spot.cellId);
    if (!position) throw new Error(`Storybook map spot ${spot.cellId} is unavailable.`);
    return {
      ...spot,
      key: `1-1:${spot.cellId}`,
      x: position.x,
      y: position.y,
      cellIds: [spot.cellId],
    };
  });
  const routeCells = [0, 1, destinationCell];
  const markers = routeCells.map((cellId, index) => {
    const position = spots.find((spot) => spot.cellId === cellId);
    const label = visibleLabelSpots.find((spot) => spot.cellIds[0] === cellId);
    if (!position || !label) {
      throw new Error(`Storybook route cell ${cellId} is unavailable.`);
    }
    return {
      stepNo: index + 1,
      cellId,
      enemy:
        cellId === 2
          ? "駆逐イ級 / 駆逐ロ級 / 軽巡ホ級"
          : cellId === 3
            ? "駆逐ロ級 / 軽巡ホ級 / 重巡リ級"
            : "",
      hasBattle: label.battleCount > 0,
      x: position.x,
      y: position.y,
      badgeX: position.x,
      badgeY: position.y - 28,
    };
  });

  return {
    asset,
    ports: [0],
    inferredRoutes,
    markers,
    transitions: transitions.map((transition) => {
      const from = spots.find((spot) => spot.cellId === transition.from);
      const to = spots.find((spot) => spot.cellId === transition.to);
      if (!from || !to) {
        throw new Error(`Storybook transition ${transition.from}-${transition.to} is invalid.`);
      }
      return {
        ...transition,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        badgeX: (from.x + to.x) / 2,
        badgeY: (from.y + to.y) / 2 - 18,
      };
    }),
    visibleLabelSpots,
    labelAnchors: [],
    labelLayouts: new Map(),
    cellKeyByCellId: new Map(spots.map((spot) => [spot.cellId, `1-1:${spot.cellId}`])),
    maxPassCount: 2,
    viewportHeight: asset.routeLayoutFrame.height,
    viewportOffsetY: 0,
  };
}

export function previewStorybookDialogContents(
  element: HTMLDialogElement,
): void {
  if (element.dataset["storybookModalContents"] === "true") return;
  if (element.open) element.close();
  element.dataset["storybookModalContents"] = "true";
  element.setAttribute("role", "none");
  element.setAttribute("open", "");
  element.showModal = () => {};
  element.close = () => {};
  element.addEventListener("click", (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest('form[method="dialog"]')
    ) {
      event.preventDefault();
    }
  }, true);
  element.addEventListener("cancel", (event) => event.preventDefault());
}

export function StorybookModalPreview(props: {
  children: JSX.Element;
  dialog: () => HTMLDialogElement | null;
  setup?: () => void | Promise<void>;
}): JSX.Element {
  const [error, setError] = createSignal("");

  return (
    <>
      {props.children}
      <span
        hidden
        ref={() => {
          queueMicrotask(() => {
            void Promise.resolve()
              .then(() => props.setup?.())
              .then(() => {
                const dialog = props.dialog();
                if (!dialog) {
                  throw new Error("Storybook modal dialog was not rendered.");
                }
                previewStorybookDialogContents(dialog);
              })
              .catch((reason: unknown) => {
                setError(
                  reason instanceof Error ? reason.message : String(reason),
                );
              });
          });
        }}
      />
      <Show when={error()}>
        {(message) => (
          <div role="alert" class="alert alert-error m-4">
            Modal preview failed: {message()}
          </div>
        )}
      </Show>
    </>
  );
}

export function StorybookSimulatorModalPreview(props: {
  children: JSX.Element;
  dialogId: string;
  prepare?: () => void;
  variant?: StorybookSimulatorVariant;
  workspace?: "empty" | "sample";
  includeInventorySnapshot?: boolean;
}): JSX.Element {
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal("");

  onMount(() => {
    void initializeStorybookSimulator(
      props.variant ?? "combined",
      props.workspace ?? "sample",
      { includeInventorySnapshot: props.includeInventorySnapshot ?? false },
    ).then(
      () => {
        props.prepare?.();
        setReady(true);
      },
      (reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
  });

  return (
    <Show
      when={ready()}
      fallback={
        <div
          role={error() ? "alert" : "status"}
          class={error() ? "alert alert-error m-4" : "loading loading-spinner loading-md m-4"}
        >
          {error() || "Loading the simulator fixture..."}
        </div>
      }
    >
      <StorybookModalPreview
        dialog={() => {
          const element = document.getElementById(props.dialogId);
          return element instanceof HTMLDialogElement ? element : null;
        }}
      >
        {props.children}
      </StorybookModalPreview>
    </Show>
  );
}

const [storybookPickerSelectedShipId, setStorybookPickerSelectedShipId] =
  createSignal<number | null>(83);

export function getStorybookPickerSelection(): number | null {
  return storybookPickerSelectedShipId();
}

export function resetStorybookPickerSelection(): void {
  setStorybookPickerSelectedShipId(83);
}

export function renderStorybookPickerRow(item: unknown): JSX.Element {
  if (
    !isRecord(item) ||
    typeof item["id"] !== "number" ||
    typeof item["name"] !== "string"
  ) {
    throw new Error("Storybook ship picker received invalid ship data.");
  }

  const shipId = item["id"];
  const ship = STORYBOOK_SAMPLE_SHIPS.find(
    (candidate) => candidate.id === shipId,
  );
  if (!ship) {
    throw new Error(`Storybook ship picker has no master data for ship ID ${shipId}.`);
  }

  return (
    <ShipListRow
      ship={ship}
      active={storybookPickerSelectedShipId() === shipId}
      onSelect={() => setStorybookPickerSelectedShipId(shipId)}
    />
  );
}

export function renderStorybookProgressiveGridItem(item: unknown): JSX.Element {
  const name =
    item && typeof item === "object" && "name" in item &&
    typeof item.name === "string"
      ? item.name
      : "Storybook item";
  return name;
}
