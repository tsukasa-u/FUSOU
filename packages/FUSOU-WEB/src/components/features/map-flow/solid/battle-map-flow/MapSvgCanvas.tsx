/** @jsxImportSource solid-js */
import { For, Show, createEffect, createSignal } from "solid-js";
import { isSafeImageUrl } from "@/utils/security";
import type { ResolvedRouteOverlay, SelectedCellFilter } from "./types";
import {
  DEFAULT_OFFICIAL_MAP_SCALE_PERCENT,
  ROUTE_COUNT_BADGE_HEIGHT,
  ROUTE_COUNT_BADGE_WIDTH,
} from "./constants";

type Props = {
  overlay: ResolvedRouteOverlay;
  selectedCellFilter: () => SelectedCellFilter | null;
  toggleCellFilter: (filter: SelectedCellFilter) => void;
  showOfficialMapAssets: () => boolean;
};

export default function MapSvgCanvas(props: Props) {
  const o = () => props.overlay;
  const seaFrame = () => o().asset.seaMapFrame;
  const hasOfficialBackgroundImage = () =>
    o().asset.spriteUrl.length > 0 && isSafeImageUrl(o().asset.spriteUrl);
  const [officialImageLoaded, setOfficialImageLoaded] = createSignal(false);
  const [officialImageFailed, setOfficialImageFailed] = createSignal(false);

  createEffect(() => {
    const useOfficialAssets = props.showOfficialMapAssets();
    const spriteUrl = o().asset.spriteUrl;
    if (!useOfficialAssets || !spriteUrl || !hasOfficialBackgroundImage()) {
      setOfficialImageLoaded(false);
      setOfficialImageFailed(false);
      return;
    }
    setOfficialImageLoaded(false);
    setOfficialImageFailed(false);
  });

  const shouldUseOfficialScale = () =>
    props.showOfficialMapAssets() &&
    hasOfficialBackgroundImage() &&
    officialImageLoaded() &&
    !officialImageFailed();

  return (
    <div class="rounded-box overflow-hidden border border-base-300 bg-slate-100 shadow-inner">
      {/* フルサイズ viewBox — ドロップタブと同様 */}
      <svg
        viewBox={`0 0 ${o().asset.routeLayoutFrame.width} ${o().asset.routeLayoutFrame.height}`}
        class="w-full h-auto block"
      >
        <defs>
          <marker
            id="sortie-arrow"
            markerWidth="10"
            markerHeight="10"
            refX="8"
            refY="5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#f43f5e" />
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

        {/* 背景 */}
        <rect
          width="100%"
          height="100%"
          fill="#f8fafc"
        />

        <g
          transform={`translate(${o().asset.routeLayoutFrame.width / 2} ${o().asset.routeLayoutFrame.height / 2}) scale(${shouldUseOfficialScale() ? DEFAULT_OFFICIAL_MAP_SCALE_PERCENT / 100 : 1}) translate(${-o().asset.routeLayoutFrame.width / 2} ${-o().asset.routeLayoutFrame.height / 2})`}
        >
          {/* 公式マップ画像 */}
          <Show
            when={props.showOfficialMapAssets() && hasOfficialBackgroundImage()}
          >
            <g clip-path="url(#map-sea-clip)">
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
                  setOfficialImageFailed(false);
                  (e.currentTarget as SVGImageElement).style.opacity = "0.96";
                }}
                onError={() => {
                  setOfficialImageLoaded(false);
                  setOfficialImageFailed(true);
                }}
              />
            </g>
          </Show>

          <Show when={officialImageFailed()}>
            <g>
              <rect
                x="20"
                y="68"
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
                y="83"
                fill="#1d4ed8"
                font-size="12"
                font-weight="700"
                dominant-baseline="middle"
              >
                海域画像の読込に失敗しました。ルート情報のみ表示しています。
              </text>
            </g>
          </Show>

          {/* 推定経路線（実線） */}
          <For each={o().inferredRoutes}>
            {(route) => (
              <g>
                <line
                  x1={route.renderFromX}
                  y1={route.renderFromY}
                  x2={route.renderToX}
                  y2={route.renderToY}
                  stroke="#052e2b"
                  stroke-width="5"
                  stroke-linecap="round"
                  opacity="0.28"
                />
                <line
                  x1={route.renderFromX}
                  y1={route.renderFromY}
                  x2={route.renderToX}
                  y2={route.renderToY}
                  stroke={route.observedCount > 0 ? "#10b981" : "#34d399"}
                  stroke-width={route.observedCount > 0 ? "3" : "2.5"}
                  stroke-linecap="round"
                  opacity={route.observedCount > 0 ? "0.9" : "0.65"}
                />
              </g>
            )}
          </For>

          {/* 選択セルインジケーター */}
          <Show when={props.selectedCellFilter()}>
            {(selected) => (
              <g>
                <rect
                  x="20"
                  y="20"
                  width="220"
                  height="40"
                  rx="12"
                  fill="#fff7ed"
                  opacity="0.96"
                  stroke="#ea580c"
                  stroke-width="2"
                />
                <text
                  x="36"
                  y="40"
                  fill="#9a3412"
                  font-size="13"
                  font-weight="700"
                  dominant-baseline="middle"
                >
                  選択中セル
                </text>
                <text
                  x="118"
                  y="40"
                  fill="#7c2d12"
                  font-size="18"
                  font-weight="800"
                  dominant-baseline="middle"
                >
                  {selected().label}
                </text>
              </g>
            )}
          </Show>

          {/* 遷移実線（実データ） */}
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

          {/* 出撃ルート矢印（実線） */}
          <For each={o().markers}>
            {(marker, i) => {
              const next = o().markers[i() + 1];
              if (!next) return null;
              return (
                <line
                  x1={marker.x}
                  y1={marker.y}
                  x2={next.x}
                  y2={next.y}
                  stroke="#f43f5e"
                  stroke-width="4"
                  stroke-linecap="round"
                  opacity="0.95"
                  marker-end="url(#sortie-arrow)"
                />
              );
            }}
          </For>

          {/* セル円＋インラインラベル（ドロップタブ式） */}
          <For each={o().visibleLabelSpots}>
            {(spot) => {
              const isHarbor = spot.label === "港" || spot.cellIds.includes(0);
              const hasBattle = spot.battleCount > 0;
              const isSelected = () =>
                props.selectedCellFilter()?.key === spot.key;

              const fill = () => {
                if (isHarbor) return "#e3c765";
                return hasBattle ? "#fecdd3" : "#f1f5f9";
              };
              const stroke = () => {
                if (isHarbor) return "#a16207";
                if (isSelected()) return "#ea580c";
                return hasBattle ? "#e11d48" : "#94a3b8";
              };
              const strokeWidth = () => isSelected() ? "3" : "2";
              const r = () => isSelected() ? 18 : 14;

              const textFill = () => {
                if (isHarbor) return "#713f12";
                return hasBattle ? "#9f1239" : "#475569";
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
                    })
                  }
                >
                  {/* クリック領域拡張 */}
                  <circle cx={spot.x} cy={spot.y} r="22" fill="transparent" />
                  <circle
                    cx={spot.x}
                    cy={spot.y}
                    r={r()}
                    fill={fill()}
                    stroke={stroke()}
                    stroke-width={strokeWidth()}
                    class="transition-all"
                  />
                  <text
                    x={spot.x}
                    y={spot.y + 4}
                    text-anchor="middle"
                    font-size="12"
                    font-weight="bold"
                    fill={textFill()}
                    style={{ "pointer-events": "none" }}
                  >
                    {spot.label}
                  </text>
                  {/* 通過回数バッジ（ドロップタブの件数バッジに相当） */}
                  <Show when={spot.passCount > 0 && !isHarbor}>
                    <g transform={`translate(${spot.x + r() - 4}, ${spot.y - r() + 4})`}>
                      <rect
                        x="-8"
                        y="-8"
                        width="16"
                        height="16"
                        rx="8"
                        fill={hasBattle ? "#e11d48" : "#64748b"}
                      />
                      <text
                        x="0"
                        y="3"
                        text-anchor="middle"
                        font-size="9"
                        font-weight="bold"
                        fill="white"
                      >
                        {spot.passCount}
                      </text>
                    </g>
                  </Show>
                </g>
              );
            }}
          </For>

          {/* 遷移回数バッジ — ライン直上（中点）に配置 */}
          <For each={o().transitions}>
            {(transition) => {
              const midX = (transition.fromX + transition.toX) / 2;
              const midY = (transition.fromY + transition.toY) / 2 - 14;
              return (
                <g>
                  <rect
                    x={midX - ROUTE_COUNT_BADGE_WIDTH / 2}
                    y={midY - ROUTE_COUNT_BADGE_HEIGHT / 2}
                    width={String(ROUTE_COUNT_BADGE_WIDTH)}
                    height={String(ROUTE_COUNT_BADGE_HEIGHT)}
                    rx="11"
                    fill="#fff8e7"
                    opacity="0.98"
                    stroke="#a16207"
                    stroke-width="1.5"
                  />
                  <text
                    x={midX}
                    y={midY}
                    text-anchor="middle"
                    dominant-baseline="middle"
                    fill="#713f12"
                    font-size="12"
                    font-weight="800"
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
