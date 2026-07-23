import type { BattleMapAsset, BattleMapTheme } from "@/data/battleMapAssets";

export type { BattleMapAsset, BattleMapTheme };

export type WinRank = "S" | "A" | "B" | "C" | "D" | "E" | string;

export type BattleResultData = {
  win_rank: WinRank;
  drop_ship_id: number | null;
};

export type BattleRecord = {
  uuid?: string;
  env_uuid?: string;
  index?: number | null;
  timestamp: number | null;
  midnight_timestamp?: number | null;
  maparea_id?: number | null;
  mapinfo_no?: number | null;
  cell_id: number;
  battle_result?: BattleResultData | string | null;
  e_deck_id?: string | null;
  __sortie_id?: string;
};

export type BattleResultRecord = {
  uuid?: string;
  win_rank?: WinRank | null;
  drop_ship_id?: number | null;
};

export type CellRecord = {
  uuid?: string;
  env_uuid?: string;
  battles?: string | null;
  maparea_id?: number | null;
  mapinfo_no?: number | null;
  cell_index?: Array<number | null> | null;
  battle_index?: Array<number | null> | null;
};

export type EnemyDeckRecord = {
  uuid: string;
  ship_ids?: Array<string | null> | string | null;
};

export type EnemyShipRecord = {
  uuid: string;
  index?: number | null;
  mst_ship_id?: number | null;
  slot?: string | null;
  karyoku?: number | null;
  raisou?: number | null;
  taiku?: number | null;
  soukou?: number | null;
};

export type EnemySlotItemRecord = {
  uuid: string;
  index?: number | null;
  mst_slotitem_id?: number | null;
};

export type MstShipRecord = {
  id: number;
  name: string;
};

export type MstSlotItemRecord = {
  id: number;
  name: string;
  type?: Array<number | null> | null;
};

export type Transition = {
  from: number;
  to: number;
  count: number;
};

export type CellStat = {
  cell: number;
  passCount: number;
  nextCells: Map<number, number>;
  battleCount: number;
  enemyCounts: Map<string, number>;
};

export type RouteStep = {
  stepNo: number;
  cellId: number;
  enemy: string;
  hasBattle: boolean;
};

export type SortieRoute = {
  sortieId: string;
  mapKey: string;
  route: string;
  cells: number[];
  steps: RouteStep[];
  battleCount: number;
  sortTimestamp: number;
};

export type MapSpot = {
  cellId: number;
  x: number;
  y: number;
  lineOffsetX?: number;
  lineOffsetY?: number;
};

export type FrameRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RouteSpriteFrame = FrameRect & {
  routeId: number;
};

export type InferredRouteOverlay = {
  key: string;
  fromCellId: number;
  toCellId: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  renderFromX: number;
  renderFromY: number;
  renderToX: number;
  renderToY: number;
  observedCount: number;
  score: number;
};

export type LabelAnchor = {
  key: string;
  label: string;
  x: number;
  y: number;
  cellIds: number[];
};

export type SpotRenderPosition = {
  x: number;
  y: number;
};

export type TransitionOverlay = Transition & {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  badgeX: number;
  badgeY: number;
};

export type LabelLayout = {
  rectX: number;
  rectY: number;
  textX: number;
  textY: number;
  textAnchor: "start" | "middle" | "end";
  width: number;
  height: number;
};

export type LayoutObstacle = {
  rectX: number;
  rectY: number;
  width: number;
  height: number;
};

export type SelectedCellFilter = {
  key: string;
  mapKey: string;
  label: string;
  cellIds: number[];
};

export type MapInfoPayload = {
  spots?: Array<{
    no?: number | null;
    x?: number | null;
    y?: number | null;
    line?: {
      x?: number | null;
      y?: number | null;
    } | null;
  }>;
};

export type MapLabelsPayload = Record<string, string>;

export type MapFrameMeta = {
  spriteSheetSize: { width: number; height: number };
  routeLayoutFrame: FrameRect;
  seaMapFrame: FrameRect;
  routeFrames: Record<number, RouteSpriteFrame>;
};

export type MapImageMetaPayload = {
  frames?: Record<
    string,
    {
      frame?: {
        x?: number;
        y?: number;
        w?: number;
        h?: number;
      };
    }
  >;
  meta?: {
    size?: {
      w?: number;
      h?: number;
    };
  };
};

export type OfficialMapThemeMode = "auto" | BattleMapTheme;

// Overlay marker: a route step with screen coordinates and badge position.
export type OverlayMarker = RouteStep & {
  x: number;
  y: number;
  badgeX: number;
  badgeY: number;
};

// A cell group visible on the SVG with aggregated stats.
export type VisibleLabelSpot = {
  key: string;
  label: string;
  x: number;
  y: number;
  cellIds: number[];
  passCount: number;
  battleCount: number;
  currentRouteVisited: boolean;
  currentRouteHasBattle: boolean;
};

// Everything the SVG canvas needs to render the overlay.
export type ResolvedRouteOverlay = {
  asset: BattleMapAsset;
  inferredRoutes: InferredRouteOverlay[];
  markers: OverlayMarker[];
  transitions: TransitionOverlay[];
  visibleLabelSpots: VisibleLabelSpot[];
  labelAnchors: LabelAnchor[];
  labelLayouts: Map<string, LabelLayout>;
  cellKeyByCellId: Map<number, string>;
  maxPassCount: number;
  viewportHeight: number;
  viewportOffsetY: number;
};

// Enemy ship stats (parameters).
export type EnemyEquipment = {
  mstSlotitemId: number | null;
  name: string;
  iconType: number | null;
};

export type EnemyShipDetails = {
  mstShipId: number | null;
  name: string;
  bannerUrl: string;
  karyoku: number | null;
  raisou: number | null;
  taiku: number | null;
  soukou: number | null;
  equipments: EnemyEquipment[];
};

export type EnemyFleetDetails = {
  signature: string;
  ships: EnemyShipDetails[];
  count: number;
};

export type WeaponIconFrame = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type WeaponIconMeta = {
  width: number;
  height: number;
};

// Battle info shown in the recent-battles list inside CellDetailsPanel.
export type RecentBattle = {
  uuid: string;
  timestamp: string;
  enemy: string;
  result: BattleResultData | null;
};

// Data returned by the selected-cell details computation.
export type SelectedCellDetails = SelectedCellFilter & {
  passCount: number;
  routeCount: number;
  battleCount: number;
  topEnemyFleets: EnemyFleetDetails[];
  resultCounts: [string, number][];
  dropCounts: [string, number][];
  outgoingCounts: [string, number][];
  recentBattles: RecentBattle[];
};
