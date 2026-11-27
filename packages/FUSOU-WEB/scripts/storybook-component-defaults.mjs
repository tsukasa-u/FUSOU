export const storybookAccessorPrefix = "__FUSOU_STORYBOOK_ACCESSOR__";

export function storybookAccessor(value) {
  return `${storybookAccessorPrefix}${JSON.stringify(value)}`;
}

export const storybookFixtureMarkers = {
  battleRepository: "__FUSOU_STORYBOOK_BATTLE_REPOSITORY__",
  battleViewBattle: "__FUSOU_STORYBOOK_BATTLE_VIEW_BATTLE__",
  battleViewFleets: "__FUSOU_STORYBOOK_BATTLE_VIEW_FLEETS__",
  dashboardState: "__FUSOU_STORYBOOK_DASHBOARD_STATE__",
  dialogRef: "__FUSOU_STORYBOOK_DIALOG_REF__",
  enemyFleet: "__FUSOU_STORYBOOK_ENEMY_FLEET__",
  friendlyFleet: "__FUSOU_STORYBOOK_FRIENDLY_FLEET__",
  mapOverlay: "__FUSOU_STORYBOOK_MAP_OVERLAY__",
  pickerRow: "__FUSOU_STORYBOOK_PICKER_ROW__",
  progressiveGridItem: "__FUSOU_STORYBOOK_PROGRESSIVE_GRID_ITEM__",
  samplePeriod: "__FUSOU_STORYBOOK_SAMPLE_PERIOD__",
  sampleShips: "__FUSOU_STORYBOOK_SAMPLE_SHIPS__",
  sampleSortieId: "__FUSOU_STORYBOOK_SAMPLE_SORTIE_ID__",
  shipMap: "__FUSOU_STORYBOOK_SHIP_MAP__",
  simulatorEquip: "__FUSOU_STORYBOOK_SIMULATOR_EQUIP__",
  simulatorSlotItems: "__FUSOU_STORYBOOK_SIMULATOR_SLOT_ITEMS__",
  slotItemMap: "__FUSOU_STORYBOOK_SLOT_ITEM_MAP__",
};

export const storybookFixtureExpressions = {
  [storybookFixtureMarkers.battleRepository]:
    "createStorybookBattleRepository()",
  [storybookFixtureMarkers.battleViewBattle]:
    "createStorybookBattleViewArgs().battle",
  [storybookFixtureMarkers.battleViewFleets]:
    "createStorybookBattleViewArgs().fleets",
  [storybookFixtureMarkers.dashboardState]:
    "createStorybookDashboardState()",
  [storybookFixtureMarkers.dialogRef]: "previewStorybookDialogContents",
  [storybookFixtureMarkers.friendlyFleet]:
    "createStorybookBattleViewArgs().fleets.friendlyShips",
  [storybookFixtureMarkers.enemyFleet]:
    "createStorybookBattleViewArgs().fleets.enemyShips",
  [storybookFixtureMarkers.mapOverlay]:
    "createStorybookResolvedRouteOverlay()",
  [storybookFixtureMarkers.pickerRow]: "renderStorybookPickerRow",
  [storybookFixtureMarkers.progressiveGridItem]:
    "renderStorybookProgressiveGridItem",
  [storybookFixtureMarkers.samplePeriod]: "STORYBOOK_SAMPLE_PERIOD",
  [storybookFixtureMarkers.sampleShips]: "STORYBOOK_SAMPLE_SHIPS",
  [storybookFixtureMarkers.sampleSortieId]: "STORYBOOK_SAMPLE_SORTIE_ID",
  [storybookFixtureMarkers.shipMap]: "createStorybookShipMap()",
  [storybookFixtureMarkers.simulatorEquip]: "createStorybookSimulatorEquip()",
  [storybookFixtureMarkers.simulatorSlotItems]:
    "createStorybookSimulatorSlotItems()",
  [storybookFixtureMarkers.slotItemMap]: "createStorybookSlotItemMap()",
};

export const storybookFixtureExports = {
  [storybookFixtureMarkers.battleRepository]:
    "createStorybookBattleRepository",
  [storybookFixtureMarkers.battleViewBattle]:
    "createStorybookBattleViewArgs",
  [storybookFixtureMarkers.battleViewFleets]:
    "createStorybookBattleViewArgs",
  [storybookFixtureMarkers.dashboardState]:
    "createStorybookDashboardState",
  [storybookFixtureMarkers.dialogRef]: "previewStorybookDialogContents",
  [storybookFixtureMarkers.friendlyFleet]:
    "createStorybookBattleViewArgs",
  [storybookFixtureMarkers.enemyFleet]: "createStorybookBattleViewArgs",
  [storybookFixtureMarkers.mapOverlay]:
    "createStorybookResolvedRouteOverlay",
  [storybookFixtureMarkers.pickerRow]: "renderStorybookPickerRow",
  [storybookFixtureMarkers.progressiveGridItem]:
    "renderStorybookProgressiveGridItem",
  [storybookFixtureMarkers.samplePeriod]: "STORYBOOK_SAMPLE_PERIOD",
  [storybookFixtureMarkers.sampleShips]: "STORYBOOK_SAMPLE_SHIPS",
  [storybookFixtureMarkers.sampleSortieId]: "STORYBOOK_SAMPLE_SORTIE_ID",
  [storybookFixtureMarkers.shipMap]: "createStorybookShipMap",
  [storybookFixtureMarkers.simulatorEquip]: "createStorybookSimulatorEquip",
  [storybookFixtureMarkers.simulatorSlotItems]:
    "createStorybookSimulatorSlotItems",
  [storybookFixtureMarkers.slotItemMap]: "createStorybookSlotItemMap",
};

const storybookFunction = "__FUSOU_STORYBOOK_FN__";

export const componentStorybookDefaults = {
  ActiveFilterChips: {
    items: [
      {
        key: "period",
        label: "期間",
        value: "2026-02-13",
        onRemove: storybookFunction,
      },
      {
        key: "map",
        label: "海域",
        value: "1-1",
        onRemove: storybookFunction,
      },
    ],
  },
  BattleDataSettingsModal: {
    ref: storybookFixtureMarkers.dialogRef,
    localLimits: {
      maxManifestBytes: 2 * 1024 * 1024 * 1024,
      maxQueryRecords: 20_000,
    },
    items: storybookAccessor([
      { name: "艦娘マスターデータ", status: "success" },
      { name: "装備マスターデータ", status: "pending" },
    ]),
    periodLabel: "2026-02-13",
  },
  BattleDetailPanel: {
    battleId: storybookFixtureMarkers.sampleSortieId,
    battleIndex: 0,
    periods: [storybookFixtureMarkers.samplePeriod],
    repository: storybookFixtureMarkers.battleRepository,
  },
  BattleDisplaySettingsModal: {
    ref: storybookFixtureMarkers.dialogRef,
    showPhaseSeparators: storybookAccessor(true),
  },
  BattleDropsPanel: {
    dashboardState: storybookFixtureMarkers.dashboardState,
  },
  BattleFilterSettingsModal: {
    ref: storybookFixtureMarkers.dialogRef,
    periods: storybookAccessor([
      { period_tag: "2026-02-13", table_version: "0.7.0" },
      { period_tag: "2026-01-15", table_version: "0.6.1" },
    ]),
    mapOptions: storybookAccessor(["1-1"]),
    mapFilter: storybookAccessor("1-1"),
    resultFilter: storybookAccessor("S"),
    showMapFilter: true,
    showResultFilter: true,
  },
  BattleMapFlowPanel: {
    dashboardState: storybookFixtureMarkers.dashboardState,
  },
  BattlePhaseView: {
    battle: storybookFixtureMarkers.battleViewBattle,
    fleets: storybookFixtureMarkers.battleViewFleets,
    mstSlotItemById: storybookFixtureMarkers.slotItemMap,
    mstShipById: storybookFixtureMarkers.shipMap,
  },
  BattleSearchFilterBar: {
    searchQuery: storybookAccessor(""),
    activeFilterCount: 0,
  },
  BattleTimelineView: {
    battle: storybookFixtureMarkers.battleViewBattle,
    fleets: storybookFixtureMarkers.battleViewFleets,
    mstSlotItemById: storybookFixtureMarkers.slotItemMap,
    mstShipById: storybookFixtureMarkers.shipMap,
    showPhaseSeparators: false,
  },
  BattlesDashboard: {
    repository: storybookFixtureMarkers.battleRepository,
    source: "r2",
    localStatus: "idle",
    localDirectoryName: storybookAccessor(null),
    permission: storybookAccessor("granted"),
    scanResult: storybookAccessor(null),
    scanProgress: storybookAccessor(null),
    localError: storybookAccessor(null),
    hasStoredHandle: storybookAccessor(false),
    rememberSource: false,
    onSourceChange: storybookFunction,
    onOpenLocalDirectorySettings: storybookFunction,
    onPickLocalDirectory: storybookFunction,
    onRequestLocalPermission: storybookFunction,
    onRescanLocalDirectory: storybookFunction,
    onReleaseLocalAccess: storybookFunction,
    onRefreshDataSource: storybookFunction,
    onRememberSourceChange: storybookFunction,
    localLimits: {
      maxManifestBytes: 2 * 1024 * 1024 * 1024,
      maxQueryRecords: 20_000,
    },
    onLocalLimitsChange: storybookFunction,
  },
  BattlesListPanel: {
    dashboardState: storybookFixtureMarkers.dashboardState,
  },
  CellDetailsPanel: {
    details: {
      key: "1-1:1",
      mapKey: "1-1",
      label: "A",
      cellIds: [1],
      passCount: 1,
      routeCount: 1,
      battleCount: 1,
      topEnemyLabels: [["駆逐イ級 / 駆逐ロ級 / 軽巡ホ級", 1]],
      resultCounts: [["S", 1]],
      dropCounts: [["吹雪", 1]],
      outgoingCounts: [["A → B", 1]],
      recentBattles: [
        {
          uuid: "storybook-battle-001",
          timestamp: "2026-02-13 08:30 UTC",
          enemy: "駆逐イ級 / 駆逐ロ級 / 軽巡ホ級",
          result: {
            win_rank: "S",
            drop_ship_id: 9,
            drop_ship_name: "吹雪",
          },
        },
      ],
    },
    displayedSortieRoutesCount: 1,
  },
  CompatibilityBadges: {
    normalSlots: [0, 1, 2],
    slotCount: 4,
    exslot: { level: 2, alv: 0 },
  },
  DocumentInfo: {
    lastUpdated: "2025-01-15T00:00:00.000Z",
    contributors: [{ data: { github_username: "storybook" } }],
  },
  EquipLevelBadge: { level: 4 },
  ImageFallbackBox: {
    src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 64'%3E%3Crect width='96' height='64' fill='%23cbd5e1'/%3E%3C/svg%3E",
  },
  EquipListRow: {
    equip: storybookFixtureMarkers.simulatorEquip,
    active: false,
    onSelect: storybookFunction,
    showStatLabels: true,
    showStats: true,
  },
  EquipSlotGroup: {
    slotItems: storybookFixtureMarkers.simulatorSlotItems,
    onOpenEquip: storybookFunction,
  },
  EquipmentBadgesFromSlotIds: {
    slotIds: [16],
    mstSlotItemById: storybookFixtureMarkers.slotItemMap,
  },
  FleetSummary: {
    ships: storybookFixtureMarkers.friendlyFleet,
    sideLabel: "自艦隊",
  },
  ItemPickerModal: {
    id: "storybook-item-picker",
    dialogRef: storybookFixtureMarkers.dialogRef,
    title: "艦選択",
    currentSummary: "選択なし",
    category: "all",
    categories: ["駆逐艦", "戦艦", "正規空母"],
    searchId: "storybook-ship-search-input",
    allOptionLabel: "すべての艦種",
    searchAriaLabel: "艦を検索",
    searchPlaceholder: "艦名で検索",
    searchValue: "",
    flatItems: [
      { type: "header", key: "駆逐艦" },
      { type: "ship", data: { id: 9, name: "吹雪", stype: 2 } },
      { type: "header", key: "戦艦" },
      { type: "ship", data: { id: 78, name: "金剛", stype: 8 } },
      { type: "header", key: "正規空母" },
      { type: "ship", data: { id: 83, name: "赤城", stype: 11 } },
    ],
    quickAccessItems: [
      { key: "駆逐艦", label: "駆逐艦" },
      { key: "戦艦", label: "戦艦" },
      { key: "正規空母", label: "正規空母" },
    ],
    renderRow: storybookFixtureMarkers.pickerRow,
  },
  MapAreaGrid: {
    groups: [
      {
        areaId: "1",
        areaName: "鎮守府海域",
        totalAreaDrops: 2,
        maps: [
          { mapKey: "1-1", name: "鎮守府正面海域", drops: 2 },
        ],
      },
    ],
    selectedMapKey: "1-1",
  },
  MapSvgCanvas: {
    overlay: storybookFixtureMarkers.mapOverlay,
    selectedCellFilter: storybookAccessor(null),
    theme: storybookAccessor("light"),
  },
  MasterDataLoadStatusAlert: {
    items: [
      { name: "艦娘", status: "success", detail: "19件" },
      { name: "装備", status: "success", detail: "12件" },
    ],
    title: "マスターデータ読込状況",
    subtitle: "Storybook fixture",
    progress: { value: 2, max: 2, label: "2 / 2" },
    alwaysShow: true,
  },
  MultiEntryDisplay: {
    entry: {
      kind: "combo",
      combo: [storybookFixtureMarkers.simulatorEquip],
      netStats: { houg: 3 },
      suppressed_components: [],
    },
    onOpenEquip: storybookFunction,
  },
  NodeDetailPanel: {
    node: {
      id: "storybook-record",
      type: "default",
      position: { x: 0, y: 0 },
      data: { recordName: "Storybook record", fields: [] },
    },
    mode: "record",
  },
  ProgressiveGrid: {
    data: [{ id: 1, name: "Storybook item" }],
    children: storybookFixtureMarkers.progressiveGridItem,
  },
  ShipGrowthFilterModal: {
    ref: storybookFixtureMarkers.dialogRef,
    periods: storybookAccessor([
      { period_tag: "2026-02-13", table_version: "0.7.0" },
      { period_tag: "2026-01-15", table_version: "0.6.1" },
    ]),
  },
  ShipGrowthSearchFilterBar: {
    searchQuery: storybookAccessor(""),
    activeFilterCount: 0,
  },
  ShipCatalogPicker: {
    ships: storybookFixtureMarkers.sampleShips,
    selectedShipId: 83,
    onSelectShip: storybookFunction,
    children: "選択中: 赤城 (ID 83)",
  },
  ShipListRow: {
    ship: {
      id: 83,
      name: "赤城",
      stype: 11,
      houg: [0, 39],
      raig: [0, 0],
      tyku: [32, 69],
      souk: [28, 54],
    },
    active: false,
    onSelect: storybookFunction,
    showStats: true,
  },
  ShipRows: {
    ships: storybookFixtureMarkers.enemyFleet,
    sideLabel: "敵艦隊",
  },
  SimulatorFilterModal: {
    ref: storybookFixtureMarkers.dialogRef,
    settings: storybookAccessor({
      includeShips: true,
      includeEquips: true,
      includeWorkspaces: false,
      selectedStypes: [],
    }),
  },
  SimulatorSearchFilterBar: {
    settings: storybookAccessor({
      includeShips: true,
      includeEquips: true,
      includeWorkspaces: false,
      selectedStypes: [],
    }),
    searchQuery: storybookAccessor(""),
    activeFilterCount: 1,
  },
  SlotUsageBadges: {
    placements: [{ normal: 2, exslot: 1 }],
  },
  SpecTable: {
    rows: [
      ["火力", 5],
      ["対空", 3],
      ["装甲", 2],
    ],
  },
  SpriteMotionCounts: {
    counts: {
      f_sprite_fly_count: 2,
      e_sprite_fly_count: 1,
      f_sprite_crash_count: 0,
      e_sprite_crash_count: 1,
      f_sprite_damage_count: 0,
      e_sprite_damage_count: 2,
      f_sprite_non_normal_count: 0,
      e_sprite_non_normal_count: 0,
    },
  },
};
