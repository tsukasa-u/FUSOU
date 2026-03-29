/** @jsxImportSource solid-js */
import { For, Show } from "solid-js";
import { isSafeImageUrl } from "@/utility/security";
import type { ResolvedRouteOverlay, SelectedCellFilter } from "./types";
import {
  BASE_CELL_MARKER_RADIUS,
  DEFAULT_OFFICIAL_MAP_SCALE_PERCENT,
  LABEL_FONT_SIZE,
  ROUTE_COUNT_BADGE_HEIGHT,
  ROUTE_COUNT_BADGE_WIDTH,
  STEP_BADGE_HEIGHT,
  STEP_BADGE_WIDTH,
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

  return (
    <div class="rounded-box overflow-hidden border border-base-300 bg-slate-100 shadow-inner">
      <svg
        viewBox={`0 ${o().viewportOffsetY} ${o().asset.routeLayoutFrame.width} ${o().viewportHeight}`}
        class="w-full h-auto block"
      >
        <defs>
          <pattern id="map-flow-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#cbd5e1" stroke-width="1" opacity="0.55" />
          </pattern>
          <marker id="sortie-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse">
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
        <rect x="0" y="0" width={o().asset.routeLayoutFrame.width} height={o().asset.routeLayoutFrame.height} fill="#f8fafc" />
        <rect
          x="0"
          y="0"
          width={o().asset.routeLayoutFrame.width}
          height={o().asset.routeLayoutFrame.height}
          fill="url(#map-flow-grid)"
          opacity={props.showOfficialMapAssets() && hasOfficialBackgroundImage() ? "0.22" : "0.7"}
        />
        <g
          transform={`translate(${o().asset.routeLayoutFrame.width / 2} ${o().asset.routeLayoutFrame.height / 2}) scale(${props.showOfficialMapAssets() && hasOfficialBackgroundImage() ? DEFAULT_OFFICIAL_MAP_SCALE_PERCENT / 100 : 1}) translate(${-o().asset.routeLayoutFrame.width / 2} ${-o().asset.routeLayoutFrame.height / 2})`}
        >
          <Show when={props.showOfficialMapAssets() && hasOfficialBackgroundImage()}>
            <g clip-path="url(#map-sea-clip)">
              <image
                href={o().asset.spriteUrl}
                x={-seaFrame().x}
                y={-seaFrame().y}
                width={o().asset.spriteSheetSize.width}
                height={o().asset.spriteSheetSize.height}
                preserveAspectRatio="none"
                style={{ filter: "brightness(1.04) saturate(0.98) contrast(1.01)", opacity: "0", transition: "opacity 0.3s ease-in" }}
                onLoad={(e) => {
                  (e.currentTarget as SVGImageElement).style.opacity = "0.96";
                }}
              />
            </g>
          </Show>

          {/* Inferred route lines */}
          <For each={o().inferredRoutes}>
            {(route) => (
              <g>
                <line
                  x1={route.renderFromX} y1={route.renderFromY}
                  x2={route.renderToX} y2={route.renderToY}
                  stroke="#052e2b"
                  stroke-width={route.observedCount > 0 ? "6" : "5"}
                  stroke-dasharray={route.observedCount > 0 ? "10 7" : "6 8"}
                  stroke-linecap="round"
                  opacity={route.observedCount > 0 ? "0.5" : "0.34"}
                />
                <line
                  x1={route.renderFromX} y1={route.renderFromY}
                  x2={route.renderToX} y2={route.renderToY}
                  stroke={route.observedCount > 0 ? "#10b981" : "#34d399"}
                  stroke-width={route.observedCount > 0 ? "3.5" : "3"}
                  stroke-dasharray={route.observedCount > 0 ? "10 7" : "6 8"}
                  stroke-linecap="round"
                  opacity={route.observedCount > 0 ? "0.95" : "0.8"}
                />
              </g>
            )}
          </For>

          {/* Selected cell indicator */}
          <Show when={props.selectedCellFilter()}>
            {(selected) => (
              <g>
                <rect x="20" y="20" width="220" height="40" rx="12" fill="#fff7ed" opacity="0.96" stroke="#ea580c" stroke-width="2" />
                <text x="36" y="40" fill="#9a3412" font-size="13" font-weight="700" dominant-baseline="middle">
                  選択中セル
                </text>
                <text x="118" y="40" fill="#7c2d12" font-size="18" font-weight="800" dominant-baseline="middle">
                  {selected().label}
                </text>
              </g>
            )}
          </Show>

          {/* Transition base lines */}
          <For each={o().transitions}>
            {(transition) => (
              <line
                x1={transition.fromX} y1={transition.fromY}
                x2={transition.toX} y2={transition.toY}
                stroke="#1e293b"
                stroke-width="2.5"
                stroke-linecap="round"
                opacity="0.34"
              />
            )}
          </For>

          {/* Sortie route arrow lines */}
          <For each={o().markers}>
            {(marker, i) => {
              const next = o().markers[i() + 1];
              if (!next) return null;
              return (
                <line
                  x1={marker.x} y1={marker.y}
                  x2={next.x} y2={next.y}
                  stroke="#f43f5e"
                  stroke-width="4"
                  stroke-linecap="round"
                  stroke-dasharray="12 6"
                  opacity="0.95"
                  marker-end="url(#sortie-arrow)"
                />
              );
            }}
          </For>

          {/* Cell circles */}
          <For each={o().visibleLabelSpots}>
            {(spot) => {
              const isHarborCell = spot.label === "港" || spot.cellIds.includes(0);
              const isSelected = () => props.selectedCellFilter()?.key === spot.key;
              const fill = () => {
                if (isHarborCell) return "#e3c765";
                if (spot.currentRouteVisited) {
                  return spot.currentRouteHasBattle ? "#f43f5e" : "#ffffff";
                }
                return spot.battleCount > 0 ? "#f43f5e" : "#e2e8f0";
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
                  <circle cx={spot.x} cy={spot.y} r="24" fill="transparent" />
                  <circle
                    cx={spot.x}
                    cy={spot.y}
                    r={BASE_CELL_MARKER_RADIUS}
                    fill={fill()}
                    opacity="1"
                    stroke={isSelected() ? "#0b1220" : "#0f172a"}
                    stroke-width={isSelected() ? "4.5" : "3"}
                    filter={isSelected() ? "drop-shadow(0 0 1.2px rgba(248,250,252,0.95)) drop-shadow(0 0 2.2px rgba(15,23,42,0.7))" : undefined}
                  />
                </g>
              );
            }}
          </For>

          {/* Sortie step badges on cells */}
          <For each={o().markers}>
            {(marker) => {
              const spotKey = o().cellKeyByCellId.get(marker.cellId);
              const target = o().visibleLabelSpots.find((spot) => spot.key === spotKey);
              const isSelected = () => !!target && props.selectedCellFilter()?.key === target.key;
              return (
                <g
                  class={target ? "cursor-pointer" : undefined}
                  onClick={() => {
                    if (!target) return;
                    props.toggleCellFilter({
                      key: target.key,
                      mapKey: props.overlay.asset.mapKey,
                      label: target.label,
                      cellIds: target.cellIds,
                    });
                  }}
                >
                  <circle cx={marker.x} cy={marker.y} r="18" fill="transparent" />
                  <rect
                    x={marker.badgeX + 10}
                    y={marker.badgeY - STEP_BADGE_HEIGHT / 2}
                    width={String(STEP_BADGE_WIDTH)}
                    height={String(STEP_BADGE_HEIGHT)}
                    rx="11"
                    fill={isSelected() ? "#9a3412" : "#0f172a"}
                    opacity="0.94"
                  />
                  <text
                    x={marker.badgeX + 10 + STEP_BADGE_WIDTH / 2}
                    y={marker.badgeY + 0.5}
                    text-anchor="middle"
                    dominant-baseline="middle"
                    fill="#ffffff"
                    font-size="12"
                    font-weight="bold"
                  >
                    {marker.stepNo}
                  </text>
                </g>
              );
            }}
          </For>

          {/* Transition count badges */}
          <For each={o().transitions}>
            {(transition) => (
              <g>
                <line
                  x1={transition.badgeX - 10} y1={transition.badgeY}
                  x2={transition.badgeX + 10} y2={transition.badgeY}
                  stroke="#fffef8"
                  stroke-width="12"
                  stroke-linecap="round"
                  opacity="0.98"
                />
                <rect
                  x={transition.badgeX - ROUTE_COUNT_BADGE_WIDTH / 2}
                  y={transition.badgeY - ROUTE_COUNT_BADGE_HEIGHT / 2}
                  width={String(ROUTE_COUNT_BADGE_WIDTH)}
                  height={String(ROUTE_COUNT_BADGE_HEIGHT)}
                  rx="11"
                  fill="#fff8e7"
                  opacity="0.98"
                  stroke="#a16207"
                  stroke-width="1.5"
                />
                <text
                  x={transition.badgeX}
                  y={transition.badgeY}
                  text-anchor="middle"
                  dominant-baseline="middle"
                  fill="#713f12"
                  font-size="12"
                  font-weight="800"
                >
                  {transition.count}
                </text>
              </g>
            )}
          </For>

          {/* Cell labels */}
          <For each={o().labelAnchors}>
            {(anchor) => {
              const labelLayout = o().labelLayouts.get(anchor.key);
              if (!labelLayout) return null;
              const isSelected = props.selectedCellFilter()?.key === anchor.key;
              return (
                <g
                  class="cursor-pointer"
                  onClick={() =>
                    props.toggleCellFilter({
                      key: anchor.key,
                      mapKey: props.overlay.asset.mapKey,
                      label: anchor.label,
                      cellIds: anchor.cellIds,
                    })
                  }
                >
                  <line
                    x1={anchor.x} y1={anchor.y}
                    x2={labelLayout.textX}
                    y2={labelLayout.rectY + labelLayout.height / 2}
                    stroke={isSelected ? "#ea580c" : "#94a3b8"}
                    stroke-width={isSelected ? "3" : "1.5"}
                    opacity={isSelected ? "0.95" : "0.7"}
                  />
                  <rect
                    x={labelLayout.rectX}
                    y={labelLayout.rectY}
                    width={labelLayout.width}
                    height={labelLayout.height}
                    rx="8"
                    fill={isSelected ? "#fff7ed" : "#fffef8"}
                    opacity="0.985"
                    stroke={isSelected ? "#ea580c" : "#334155"}
                    stroke-width={isSelected ? "2.5" : "1.5"}
                  />
                  <text
                    x={labelLayout.textX}
                    y={labelLayout.rectY + labelLayout.height / 2}
                    text-anchor={labelLayout.textAnchor}
                    dominant-baseline="middle"
                    fill={isSelected ? "#7c2d12" : "#0f172a"}
                    font-size={String(LABEL_FONT_SIZE)}
                    font-weight="bold"
                    stroke={isSelected ? "#ffedd5" : "#ffffff"}
                    stroke-width="2"
                    paint-order="stroke"
                  >
                    {anchor.label}
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
