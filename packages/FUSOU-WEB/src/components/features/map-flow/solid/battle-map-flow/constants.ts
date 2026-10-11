/**
 * ============================================================================
 * バトルマップ表示・航路スタイリング設定定数
 * マップのセルサイズ、余白、航路（直線・矢印・破線）の幅や間隔などの設定項目
 * ============================================================================
 */

/* ----------------------------------------------------------------------------
 * 1. マップキャンバス & トリミング設定
 * ---------------------------------------------------------------------------- */
export const MAP_BASE_WIDTH = 1200;
export const MAP_BASE_HEIGHT = 720;
/** 上下左右均等トリミング余白 (px) */
export const MAP_TRIM_PADDING = 80;
export const MAP_VIEWBOX_WIDTH = MAP_BASE_WIDTH - MAP_TRIM_PADDING * 2; // 1080
export const MAP_VIEWBOX_HEIGHT = MAP_BASE_HEIGHT - MAP_TRIM_PADDING * 2; // 600

export const DEFAULT_OFFICIAL_MAP_SCALE_PERCENT = 100;
export const DEFAULT_MAP_VIEWPORT_HEIGHT_PERCENT = 90;

/** 海域マップの海エリア背景色 (ライト: 落ち着いたグレー, ダーク: ダークグレー) */
export const MAP_SEA_BG_LIGHT = "#e2e8f0";
export const MAP_SEA_BG_DARK = "#454545";

/* ----------------------------------------------------------------------------
 * 2. セルマーカー（ノード）のサイズと外観設定
 * ---------------------------------------------------------------------------- */
/** 通常セルの半径 (px) */
export const BASE_CELL_MARKER_RADIUS = 14;
/** 選択中セルの半径 (px) */
export const SELECTED_CELL_MARKER_RADIUS = 18;
export const BOSS_CELL_MARKER_RADIUS = BASE_CELL_MARKER_RADIUS;
export const ACTIVE_CELL_RING_RADIUS = SELECTED_CELL_MARKER_RADIUS;
/** セルクリック判定の透明円半径 (px) */
export const CELL_HITBOX_RADIUS = 22;
/** セル通常枠線の太さ (px) */
export const CELL_STROKE_WIDTH = "2";
/** 選択中セルの枠線の太さ (px) */
export const CELL_SELECTED_STROKE_WIDTH = "3.5";

/** ボスマス外側二重丸のオフセット（通常セル半径に追加する距離 px） */
export const BOSS_RING_OUTER_OFFSET = 4; // 外側円半径: 14 + 4 = 18px (選択時 18 + 4 = 22px)
/** ボスマス外側二重丸の線の太さ (px) */
export const BOSS_RING_STROKE_WIDTH = "1.8";

/* ----------------------------------------------------------------------------
 * 3. セル右上バッジ（通過回数・ドロップ件数）設定
 * ---------------------------------------------------------------------------- */
export const CELL_BADGE_SIZE = 16;
export const CELL_BADGE_RADIUS = 8;
export const CELL_BADGE_FONT_SIZE = "9";

/* ----------------------------------------------------------------------------
 * 4. 航路（直線・矢印・破線）とセルの間隔・線幅・ダッシュ設定
 * ---------------------------------------------------------------------------- */
/**
 * セル中心から直線・矢印の端（始点・終点）までの間隔・パディング (px)
 * セル半径(14px)に対して十分なスペースを確保
 */
export const ROUTE_NODE_PADDING = 36;
export const INFERRED_ROUTE_NODE_PADDING = ROUTE_NODE_PADDING; // 下位互換用エイリアス

/**
 * 距離が短いセル間のパディング上限比率（セル同士が非常に近接している場合に線が消失するのを防ぐ）
 */
export const ROUTE_PADDING_MAX_RATIO = 0.35;

/** 候補航路（進行経路の破線）の線幅 (px) */
export const CANDIDATE_ROUTE_STROKE_WIDTH = 3.4;
/** 候補航路のダッシュパターン ("描画px 空白px"：等間隔) */
export const CANDIDATE_ROUTE_DASH_ARRAY = "8 8";
/** 候補航路の不透明度 */
export const CANDIDATE_ROUTE_OPACITY = 0.9;
/** 候補航路の線の色（エメラルドグリーン） */
export const CANDIDATE_ROUTE_COLOR = "#10b981";

/** 出撃航路（進行ルート実線）のメイン線幅 (px) */
export const SORTIE_ROUTE_MAIN_WIDTH = 4.8;
/** 出撃航路の影の線幅 (px) */
export const SORTIE_ROUTE_SHADOW_WIDTH = 6.5;
/** 出撃航路のメイン色（ローズピンク） */
export const SORTIE_ROUTE_MAIN_COLOR = "#f43f5e";
/** 出撃航路のメイン不透明度 */
export const SORTIE_ROUTE_MAIN_OPACITY = 0.95;
/** 出撃航路の影色（深紅） */
export const SORTIE_ROUTE_SHADOW_COLOR = "#881337";
/** 出撃航路の影の不透明度 */
export const SORTIE_ROUTE_SHADOW_OPACITY = 0.3;

/** 矢印マーカーのサイズと基準点 */
export const ROUTE_ARROW_MARKER_WIDTH = 18;
export const ROUTE_ARROW_MARKER_HEIGHT = 16;
export const ROUTE_ARROW_MARKER_REFX = 6;
export const ROUTE_ARROW_MARKER_REFY = 8;

/* ----------------------------------------------------------------------------
 * 5. 航路遷移バッジ・ステップバッジ設定
 * ---------------------------------------------------------------------------- */
export const LABEL_HEIGHT = 22;
export const LABEL_DISTANCE = 28;
export const LABEL_DISTANCE_STEP = 8;
export const NODE_COLLISION_RADIUS = BASE_CELL_MARKER_RADIUS + 6;
export const LABEL_FONT_SIZE = "12";
export const MAX_SORTIE_ROUTES = 50;
export const MAP_FLOW_DISPLAY_SETTINGS_KEY = "fusou.battle-map-flow.display-settings.v1";
export const ROUTE_COUNT_BADGE_WIDTH = 18;
export const ROUTE_COUNT_BADGE_HEIGHT = 13;
export const ROUTE_COUNT_BADGE_RX = 3;
export const ROUTE_COUNT_BADGE_FILL = "#0f172a";
export const ROUTE_COUNT_BADGE_OPACITY = 0.85;
/** 進行経路バッジの文字色 (航空隊のスカイブルー #38bdf8 と混同しないよう白 #f8fafc を採用) */
export const ROUTE_COUNT_BADGE_TEXT_FILL = "#f8fafc";
export const ROUTE_COUNT_BADGE_FONT_SIZE = "8.5";
export const ROUTE_COUNT_BADGE_STROKE = "#334155";
export const ROUTE_COUNT_BADGE_STROKE_WIDTH = "0.8";
export const STEP_BADGE_WIDTH = 30;
export const STEP_BADGE_HEIGHT = 22;

export const WIN_RANK_BADGES: Record<string, string> = {
  S: "badge-success",
  A: "badge-info",
  B: "badge-warning",
  C: "badge-error",
  D: "badge-error",
  E: "badge-error",
};

/* ----------------------------------------------------------------------------
 * 6. セルカラーパレット（FUSOU仕様）
 * ----------------------------------------------------------------------------
 * - 通過していないマス・戦闘がないマス: 灰色 (#f1f5f9 / #94a3b8 / #475569)
 * - 戦闘マス・ボスマス: 赤色 (#fecdd3 / #e11d48 / #9f1239)
 * - 出撃港: 黄色 (#e3c765 / #a16207 / #713f12)
 */
export type CellType =
  | "port"
  | "boss"
  | "battle"
  | "empty"
  | "resource"
  | "maelstrom"      // 渦潮マス (api_color_no: 3)
  | "nothing"        // 何もないマス・気のせい (api_color_no: 6)
  | "air"            // 航空戦・空襲戦 (api_color_no: 7, 10)
  | "night"          // 夜戦マス (api_color_no: 11, 12)
  | "active_branch"  // 能動分岐 (api_color_no: 15)
  | "landing"        // 揚陸・船団護衛 (api_color_no: 8)
  | "recon";         // 航空偵察 (api_color_no: 9)


/** ダークモード時の非戦闘マス（未通過・戦闘なし）カラー設定 */
export const DARK_EMPTY_CELL_FILL = "#27272a";
export const DARK_EMPTY_CELL_STROKE = "#52525b";
export const DARK_EMPTY_CELL_TEXT = "#a1a1aa";

export const CELL_COLOR_THEMES: Record<
  CellType,
  { fill: string; stroke: string; textFill: string; label: string }
> = {
  port: {
    // 出撃港（黄色・アンバー）
    fill: "#e3c765",
    stroke: "#a16207",
    textFill: "#713f12",
    label: "出撃港",
  },
  boss: {
    // ボスマス（戦闘マスと同じ赤色）
    fill: "#fecdd3",
    stroke: "#e11d48",
    textFill: "#9f1239",
    label: "ボスマス",
  },
  battle: {
    // 通常戦闘マス（赤色・ローズ）
    fill: "#fecdd3",
    stroke: "#e11d48",
    textFill: "#9f1239",
    label: "戦闘マス",
  },
  empty: {
    // 通過していないマス・未特定（灰色・スレート）
    fill: "#f1f5f9",
    stroke: "#94a3b8",
    textFill: "#475569",
    label: "非戦闘マス",
  },
  resource: {
    // 資源を取得できるマス（黄緑色・ライム）
    fill: "#ecfccb",
    stroke: "#65a30d",
    textFill: "#3f6212",
    label: "資源・補給マス",
  },
  maelstrom: {
    // 渦潮マス（紫色・パープル）
    fill: "#f3e8ff",
    stroke: "#a855f7",
    textFill: "#7e22ce",
    label: "渦潮マス",
  },
  nothing: {
    // 何もないマス・気のせい（水色・スカイ）
    fill: "#e0f2fe",
    stroke: "#0284c7",
    textFill: "#0369a1",
    label: "気のせい・非戦闘",
  },
  air: {
    // 航空戦・空襲戦マス（橙色・オレンジ）
    fill: "#ffedd5",
    stroke: "#f97316",
    textFill: "#c2410c",
    label: "航空・空襲戦",
  },
  night: {
    // 夜戦マス（濃紫色・バイオレット）
    fill: "#ede9fe",
    stroke: "#8b5cf6",
    textFill: "#6d28d9",
    label: "夜戦マス",
  },
  active_branch: {
    // 能動分岐マス（藍色・インディゴ）
    fill: "#e0e7ff",
    stroke: "#6366f1",
    textFill: "#4338ca",
    label: "能動分岐",
  },
  landing: {
    // 揚陸地点・船団護衛（青緑色・ティール）
    fill: "#ccfbf1",
    stroke: "#0d9488",
    textFill: "#0f766e",
    label: "揚陸地点",
  },
  recon: {
    // 航空偵察マス（黄緑・ライム）
    fill: "#f7fee7",
    stroke: "#84cc16",
    textFill: "#4d7c0f",
    label: "航空偵察",
  },
};

import proxyMapMaster from "@/data/proxy_map_master.json";

/**
 * 基地航空隊データ定義（航空基地座標 & 各セルの必要行動半径）
 */
export type MapAirBaseInfo = {
  /** 航空基地の座標 (x, y) */
  bases: { x: number; y: number; label?: string }[];
  /** 各セルラベルに対する必要行動半径（距離） */
  distances: Record<string, number>;
};

/**
 * 海域ごとのボスマスラベル対応マップ
 * ※ FUSOU-PROXY-DATA から自動抽出されたマスターデータに準拠 (api_color_no == 5)
 */
export const MAP_BOSS_LABELS: Record<string, string[]> = proxyMapMaster.bossLabels;

/**
 * 海域ごとの資源を取得できるマスラベル (黄緑色)
 * ※ FUSOU-PROXY-DATA から自動抽出されたマスターデータに準拠 (api_color_no == 2)
 */
export const MAP_RESOURCE_LABELS: Record<string, string[]> = proxyMapMaster.resourceLabels;

/**
 * 海域ごとの渦潮マスラベル (紫色)
 * ※ FUSOU-PROXY-DATA から自動抽出されたマスターデータに準拠 (api_color_no == 3)
 */
export const MAP_MAELSTROM_LABELS: Record<string, string[]> = proxyMapMaster.maelstromLabels;

/**
 * 海域ごとの何もない・気のせいマスラベル (水色)
 * ※ FUSOU-PROXY-DATA から自動抽出されたマスターデータに準拠 (api_color_no == 6)
 */
export const MAP_NOTHING_LABELS: Record<string, string[]> = proxyMapMaster.nothingLabels;

/**
 * 海域ごとの航空戦・空襲マスラベル (橙色)
 * ※ FUSOU-PROXY-DATA から自動抽出されたマスターデータに準拠 (api_color_no == 7, 10)
 */
export const MAP_AIR_LABELS: Record<string, string[]> = proxyMapMaster.airLabels;

/**
 * 海域ごとの夜戦マスラベル (濃紫色)
 * ※ FUSOU-PROXY-DATA から自動抽出されたマスターデータに準拠 (api_color_no == 11, 12)
 */
export const MAP_NIGHT_LABELS: Record<string, string[]> = proxyMapMaster.nightLabels;

/**
 * 海域ごとの能動分岐マスラベル (藍色)
 * ※ FUSOU-PROXY-DATA から自動抽出されたマスターデータに準拠 (api_color_no == 15)
 */
export const MAP_ACTIVE_BRANCH_LABELS: Record<string, string[]> = proxyMapMaster.activeBranchLabels;

/**
 * 海域ごとの揚陸地点・船団護衛マスラベル (青緑色)
 * ※ FUSOU-PROXY-DATA から自動抽出されたマスターデータに準拠 (api_color_no == 8)
 */
export const MAP_LANDING_LABELS: Record<string, string[]> = proxyMapMaster.landingLabels;

/**
 * 海域ごとの航空偵察マスラベル (黄緑色)
 * ※ FUSOU-PROXY-DATA から自動抽出されたマスターデータに準拠 (api_color_no == 9)
 */
export const MAP_RECON_LABELS: Record<string, string[]> = proxyMapMaster.reconLabels;

/**
 * 基地航空隊データ定義（航空基地座標 & 各セルの必要行動半径）
 * ※ FUSOU-PROXY-DATA (kcs2 resources airbases & api_distance) から自動抽出されたマスターデータに準拠
 */
export const MAP_AIRBASE_DATA: Record<string, MapAirBaseInfo> = proxyMapMaster.airbaseData;
