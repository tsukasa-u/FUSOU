/** @jsxImportSource solid-js */
import { For, Show, createEffect, createSignal } from "solid-js";
import { isSafeImageUrl } from "@/utils/security";
import type { ResolvedRouteOverlay, SelectedCellFilter } from "./types";
import {
  MAP_TRIM_PADDING,
  MAP_VIEWBOX_WIDTH,
  MAP_VIEWBOX_HEIGHT,
  ROUTE_COUNT_BADGE_HEIGHT,
  ROUTE_COUNT_BADGE_WIDTH,
  ROUTE_NODE_PADDING,
  ROUTE_PADDING_MAX_RATIO,
  CANDIDATE_ROUTE_STROKE_WIDTH,
  CANDIDATE_ROUTE_DASH_ARRAY,
  CANDIDATE_ROUTE_OPACITY,
  CANDIDATE_ROUTE_COLOR,
  SORTIE_ROUTE_MAIN_WIDTH,
  SORTIE_ROUTE_MAIN_COLOR,
  SORTIE_ROUTE_MAIN_OPACITY,
  SORTIE_ROUTE_SHADOW_WIDTH,
  SORTIE_ROUTE_SHADOW_COLOR,
  SORTIE_ROUTE_SHADOW_OPACITY,
  ROUTE_ARROW_MARKER_WIDTH,
  ROUTE_ARROW_MARKER_HEIGHT,
  ROUTE_ARROW_MARKER_REFX,
  ROUTE_ARROW_MARKER_REFY,
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
  MAP_AIRBASE_DATA,
  MAP_SEA_BG_LIGHT,
  MAP_SEA_BG_DARK,
  ROUTE_COUNT_BADGE_RX,
  ROUTE_COUNT_BADGE_FILL,
  ROUTE_COUNT_BADGE_OPACITY,
  ROUTE_COUNT_BADGE_TEXT_FILL,
  ROUTE_COUNT_BADGE_FONT_SIZE,
  ROUTE_COUNT_BADGE_STROKE,
  ROUTE_COUNT_BADGE_STROKE_WIDTH,
} from "./constants";
import { resolveCellType } from "./dataUtils";

type Props = {
  overlay: ResolvedRouteOverlay;
  selectedCellFilter: () => SelectedCellFilter | null;
  toggleCellFilter: (filter: SelectedCellFilter) => void;
  showOfficialMapAssets: () => boolean;
  theme?: () => "dark" | "light";
};

export default function MapSvgCanvas(props: Props) {
  const o = () => props.overlay;
  const isDark = () => (props.theme ? props.theme() === "dark" : false);
  const seaFrame = () => o().asset.seaMapFrame;
  const hasOfficialBackgroundImage = () =>
    o().asset.spriteUrl.length > 0 && isSafeImageUrl(o().asset.spriteUrl);
  const [, setOfficialImageLoaded] = createSignal(false);

  let prevSpriteUrl = "";
  createEffect(() => {
    const useOfficialAssets = props.showOfficialMapAssets();
    const spriteUrl = o().asset.spriteUrl;
    if (spriteUrl === prevSpriteUrl) return;
    prevSpriteUrl = spriteUrl;
    if (!useOfficialAssets || !spriteUrl || !hasOfficialBackgroundImage()) {
      setOfficialImageLoaded(false);
      return;
    }
    setOfficialImageLoaded(false);
  });

  return (
    <div
      class={`rounded-box overflow-hidden border border-base-300 ${isDark() ? "bg-[#18181b]" : "bg-[#f1f5f9]"} shadow-inner`}
      style={`aspect-ratio: ${MAP_VIEWBOX_WIDTH} / ${MAP_VIEWBOX_HEIGHT}; width: 100%;`}
    >
      {/* 左右上下で均等に40pxトリミングした固定ビューポート */}
      <svg
        viewBox={`${MAP_TRIM_PADDING} ${MAP_TRIM_PADDING} ${MAP_VIEWBOX_WIDTH} ${MAP_VIEWBOX_HEIGHT}`}
        class="w-full h-auto block"
      >
        <defs>
          <marker
            id="sortie-arrow"
            markerWidth={ROUTE_ARROW_MARKER_WIDTH}
            markerHeight={ROUTE_ARROW_MARKER_HEIGHT}
            refX={ROUTE_ARROW_MARKER_REFX}
            refY={ROUTE_ARROW_MARKER_REFY}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 2 2 L 16 8 L 2 14 L 6 8 Z" fill={SORTIE_ROUTE_MAIN_COLOR} />
          </marker>
          <marker
            id="route-arrow"
            markerWidth={ROUTE_ARROW_MARKER_WIDTH}
            markerHeight={ROUTE_ARROW_MARKER_HEIGHT}
            refX={ROUTE_ARROW_MARKER_REFX}
            refY={ROUTE_ARROW_MARKER_REFY}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 2 2 L 16 8 L 2 14 L 6 8 Z" fill={CANDIDATE_ROUTE_COLOR} />
          </marker>
          <clipPath id="map-sea-clip">
            <rect
              x="0"
              y="0"
              width={o().asset.routeLayoutFrame.width}
              height={o().asset.routeLayoutFrame.height}
            />
          </clipPath>
        </defs>

        {/* 背景（海の本来の表示を活かすため透明化） */}

        <g>
          {/* 海域キャンバス背景 (海のベース色: 画像の有無にかかわらず常に下地に敷く) */}
          <g clip-path="url(#map-sea-clip)">
            <rect
              x="0"
              y="0"
              width={o().asset.routeLayoutFrame.width}
              height={o().asset.routeLayoutFrame.height}
              fill={isDark() ? MAP_SEA_BG_DARK : MAP_SEA_BG_LIGHT}
            />
            {/* マップ画像 (陸地・島等: 画像が存在する場合のみ下地の上に表示) */}
            <Show
              when={props.showOfficialMapAssets() && hasOfficialBackgroundImage()}
            >
              <image
                href={o().asset.spriteUrl}
                x={-seaFrame().x}
                y={-seaFrame().y}
                width={o().asset.spriteSheetSize.width}
                height={o().asset.spriteSheetSize.height}
                preserveAspectRatio="none"
                style={{
                  filter: "brightness(1.04) saturate(0.98) contrast(1.01)",
                  opacity: "0",
                  transition: "opacity 0.3s ease-in",
                }}
                onLoad={(e) => {
                  setOfficialImageLoaded(true);
                  (e.currentTarget as SVGImageElement).style.opacity = "0.96";
                }}
                onError={() => {
                  setOfficialImageLoaded(false);
                }}
              />
            </Show>
          </g>

          {/* 経路線（曲率付きベジェ曲線パス & 進行方向矢印：被り線・濁り影を排除したクリアな描画） */}
          <For each={o().inferredRoutes}>
            {(route) => {
              const d = () => route.pathD || `M ${route.renderFromX} ${route.renderFromY} L ${route.renderToX} ${route.renderToY}`;

              return (
                <g>
                  {/* 航路破線（全線分で統一した太さ・色・濃さで描画） */}
                  <path
                    d={d()}
                    stroke={CANDIDATE_ROUTE_COLOR}
                    stroke-width={CANDIDATE_ROUTE_STROKE_WIDTH}
                    stroke-dasharray={CANDIDATE_ROUTE_DASH_ARRAY}
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    fill="none"
                    opacity={CANDIDATE_ROUTE_OPACITY}
                    marker-end={route.isArrow ? "url(#route-arrow)" : undefined}
                  />
                </g>
              );
            }}
          </For>

          

          {/* 遷移実線（実データ：推測・曲線ルートが存在しない場合のみフォールバック描画） */}
          <Show when={o().inferredRoutes.length === 0}>
            <For each={o().transitions}>
              {(transition) => (
                <line
                  x1={transition.fromX}
                  y1={transition.fromY}
                  x2={transition.toX}
                  y2={transition.toY}
                  stroke="#1e293b"
                  stroke-width="2"
                  stroke-linecap="round"
                  opacity="0.3"
                />
              )}
            </For>
          </Show>

          {/* 出撃ルート矢印（曲率付きベジェ曲線パス & 進行方向矢印） */}
          <For each={o().markers}>
            {(marker, i) => {
              const next = o().markers[i() + 1];
              if (!next) return null;

              // セルIDまたは座標（許容誤差18px以内：エイリアスセル対応）で候補ルートを完全一致検索
              const matchedRoute = o().inferredRoutes.find((r) => {
                const idMatch =
                  (r.fromCellId === marker.cellId && r.toCellId === next.cellId) ||
                  (r.fromCellId === next.cellId && r.toCellId === marker.cellId);
                if (idMatch) return true;

                const coordForward =
                  Math.hypot(r.fromX - marker.x, r.fromY - marker.y) < 18 &&
                  Math.hypot(r.toX - next.x, r.toY - next.y) < 18;
                if (coordForward) return true;

                const coordReverse =
                  Math.hypot(r.fromX - next.x, r.fromY - next.y) < 18 &&
                  Math.hypot(r.toX - marker.x, r.toY - marker.y) < 18;
                return coordReverse;
              });

              // 進行方向（順方向 marker -> next か 逆方向か）の座標距離判定
              const isForward = () => {
                if (!matchedRoute) return true;
                if (matchedRoute.fromCellId === marker.cellId && matchedRoute.toCellId === next.cellId) {
                  return true;
                }
                const distForward =
                  Math.hypot(matchedRoute.fromX - marker.x, matchedRoute.fromY - marker.y) +
                  Math.hypot(matchedRoute.toX - next.x, matchedRoute.toY - next.y);
                const distReverse =
                  Math.hypot(matchedRoute.fromX - next.x, matchedRoute.fromY - next.y) +
                  Math.hypot(matchedRoute.toX - marker.x, matchedRoute.toY - marker.y);
                return distForward <= distReverse;
              };

              const sortieD = () => {
                if (matchedRoute) {
                  if (isForward()) {
                    // 順方向：緑の進行経路候補と完全に同一のパス文字列を使用
                    return (
                      matchedRoute.pathD ||
                      `M ${matchedRoute.renderFromX} ${matchedRoute.renderFromY} L ${matchedRoute.renderToX} ${matchedRoute.renderToY}`
                    );
                  } else {
                    // 逆方向：幾何学的に同一のベジェ曲線/直線を終点から始点へ反転
                    const isCurved =
                      matchedRoute.ctrlX !== undefined &&
                      matchedRoute.ctrlY !== undefined &&
                      Math.hypot(
                        matchedRoute.ctrlX - (matchedRoute.renderFromX + matchedRoute.renderToX) / 2,
                        matchedRoute.ctrlY - (matchedRoute.renderFromY + matchedRoute.renderToY) / 2
                      ) > 1.0;

                    if (isCurved) {
                      return `M ${matchedRoute.renderToX} ${matchedRoute.renderToY} Q ${matchedRoute.ctrlX} ${matchedRoute.ctrlY} ${matchedRoute.renderFromX} ${matchedRoute.renderFromY}`;
                    }
                    return `M ${matchedRoute.renderToX} ${matchedRoute.renderToY} L ${matchedRoute.renderFromX} ${matchedRoute.renderFromY}`;
                  }
                }
                // フォールバック：セル間直線（ノードとの干渉を防ぐ一定余白26pxを確保）
                const dx = next.x - marker.x;
                const dy = next.y - marker.y;
                const dist = Math.hypot(dx, dy) || 1;
                const ux = dx / dist;
                const uy = dy / dist;
                const padding = Math.min(ROUTE_NODE_PADDING, dist * ROUTE_PADDING_MAX_RATIO);
                return `M ${marker.x + ux * padding} ${marker.y + uy * padding} L ${next.x - ux * padding} ${next.y - uy * padding}`;
              };

              return (
                <g>
                  {/* 赤色出撃ルート影 */}
                  <path
                    d={sortieD()}
                    stroke={SORTIE_ROUTE_SHADOW_COLOR}
                    stroke-width={SORTIE_ROUTE_SHADOW_WIDTH}
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    fill="none"
                    opacity={SORTIE_ROUTE_SHADOW_OPACITY}
                  />
                  {/* メイン出撃ライン & 矢印 */}
                  <path
                    d={sortieD()}
                    stroke={SORTIE_ROUTE_MAIN_COLOR}
                    stroke-width={SORTIE_ROUTE_MAIN_WIDTH}
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    fill="none"
                    opacity={SORTIE_ROUTE_MAIN_OPACITY}
                    marker-end="url(#sortie-arrow)"
                  />
                </g>
              );
            }}
          </For>

          {/* セル円＋インラインラベル（ボスマス外側二重丸・港文字非表示） */}
          <For each={o().visibleLabelSpots}>
            {(spot) => {
              const cellType = () =>
                resolveCellType(
                  spot.label,
                  props.overlay.asset.mapKey,
                  spot.battleCount > 0,
                  spot.cellIds,
                  spot.passCount,
                  spot.battleCount,
                  props.overlay.ports,
                  spot.isPort,
                );
              const theme = () => CELL_COLOR_THEMES[cellType()];
              const isSelected = () =>
                props.selectedCellFilter()?.key === spot.key;
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
                  onClick={() =>
                    props.toggleCellFilter({
                      key: spot.key,
                      mapKey: props.overlay.asset.mapKey,
                      label: spot.label,
                      cellIds: spot.cellIds,
                      isPort: spot.isPort,
                    })
                  }
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
                  {/* セルラベル（「港」テキストは不格好のため完全排除し、識別用番号のみ表示） */}
                  {(() => {
                    const displayLabel = () => {
                      const lbl = spot.label;
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

          {/* セル通過回数バッジ（最前面レイヤー：以前のドロップ画面のシンプルで美しい円形バッジに統一） */}
          <For each={o().visibleLabelSpots}>
            {(spot) => {
              const cellType = () =>
                resolveCellType(
                  spot.label,
                  props.overlay.asset.mapKey,
                  spot.battleCount > 0,
                  spot.cellIds,
                  undefined,
                  undefined,
                  props.overlay.ports,
                  spot.isPort,
                );
              const isSelected = () => props.selectedCellFilter()?.key === spot.key;
              const r = () => (isSelected() ? SELECTED_CELL_MARKER_RADIUS : BASE_CELL_MARKER_RADIUS);

              return (
                <Show when={spot.passCount > 0 && cellType() !== "port"}>
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
                      fill={spot.battleCount > 0 ? "#e11d48" : "#64748b"}
                    />
                    <text
                      x="0"
                      y="3"
                      text-anchor="middle"
                      font-size={CELL_BADGE_FONT_SIZE}
                      font-weight="bold"
                      fill="white"
                    >
                      {spot.passCount}
                    </text>
                  </g>
                </Show>
              );
            }}
          </For>

          {/* 基地航空隊：航空基地マーカー（✕印） */}
          <Show when={MAP_AIRBASE_DATA[props.overlay.asset.mapKey]}>
            <For each={MAP_AIRBASE_DATA[props.overlay.asset.mapKey]!.bases}>
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

          {/* 各セルの右下：航空基地の届く距離（戦闘行動半径：ステップ数と混同しないよう 'R' を前置） */}
          <Show when={MAP_AIRBASE_DATA[props.overlay.asset.mapKey]}>
            <For each={o().visibleLabelSpots}>
              {(spot) => {
                const distance = () =>
                  MAP_AIRBASE_DATA[props.overlay.asset.mapKey]?.distances[spot.label];
                const isSelected = () => props.selectedCellFilter()?.key === spot.key;
                const r = () => (isSelected() ? SELECTED_CELL_MARKER_RADIUS : BASE_CELL_MARKER_RADIUS);

                return (
                  <Show when={distance() !== undefined}>
                    {(() => {
                      const text = () => `R${distance()}`;
                      const badgeWidth = () => (text().length > 2 ? 20 : 17);
                      return (
                        <g
                          transform={`translate(${spot.x + r() - 2}, ${spot.y + r() + 2})`}
                          style={{ "pointer-events": "none" }}
                        >
                          <rect
                            x={-badgeWidth() / 2}
                            y="-6"
                            width={badgeWidth()}
                            height="12"
                            rx="3"
                            fill="#0f172a"
                            opacity="0.85"
                          />
                          <text
                            x="0"
                            y="3"
                            text-anchor="middle"
                            font-size="8"
                            font-weight="bold"
                            fill="#38bdf8"
                          >
                            {text()}
                          </text>
                        </g>
                      );
                    })()}
                  </Show>
                );
              }}
            </For>
          </Show>

          {/* 遷移回数バッジ — ライン直上（中点）に配置（航空隊距離表示と同様のHUD風デザイン） */}
          <For each={o().transitions}>
            {(transition) => {
              const midX = (transition.fromX + transition.toX) / 2;
              const midY = (transition.fromY + transition.toY) / 2 - 10;
              const countStr = String(transition.count);
              const badgeW = Math.max(ROUTE_COUNT_BADGE_WIDTH, countStr.length * 6 + 7);
              return (
                <g style={{ "pointer-events": "none" }}>
                  <rect
                    x={midX - badgeW / 2}
                    y={midY - ROUTE_COUNT_BADGE_HEIGHT / 2}
                    width={badgeW}
                    height={ROUTE_COUNT_BADGE_HEIGHT}
                    rx={ROUTE_COUNT_BADGE_RX}
                    fill={ROUTE_COUNT_BADGE_FILL}
                    opacity={ROUTE_COUNT_BADGE_OPACITY}
                    stroke={ROUTE_COUNT_BADGE_STROKE}
                    stroke-width={ROUTE_COUNT_BADGE_STROKE_WIDTH}
                  />
                  <text
                    x={midX}
                    y={midY + 3.5}
                    text-anchor="middle"
                    font-size={ROUTE_COUNT_BADGE_FONT_SIZE}
                    font-weight="bold"
                    fill={ROUTE_COUNT_BADGE_TEXT_FILL}
                  >
                    {transition.count}
                  </text>
                </g>
              );
            }}
          </For>
        </g>
      </svg>
    </div>
  );
}
