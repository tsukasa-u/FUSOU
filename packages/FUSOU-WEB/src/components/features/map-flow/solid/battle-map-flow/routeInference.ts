import type { CurvedRouteData, InferredRouteOverlay, MapSpot, RouteSpriteFrame, Transition } from "./types";
import { ROUTE_NODE_PADDING, ROUTE_PADDING_MAX_RATIO } from "./constants";

export function inferRouteOverlays(
  spots: MapSpot[],
  routeFrames: Record<number, RouteSpriteFrame> | undefined,
  transitions: Transition[],
  curvedRoutes?: CurvedRouteData[],
): InferredRouteOverlay[] {
  if (spots.length === 0) return [];

  const observedCounts = new Map<string, number>();
  for (const transition of transitions) {
    const key = [transition.from, transition.to].sort((a, b) => a - b).join("-");
    observedCounts.set(key, (observedCounts.get(key) ?? 0) + transition.count);
  }

  // 1. If pre-calculated curved route data exists, use it directly (highest fidelity & accurate curves/arrows)
  if (curvedRoutes && curvedRoutes.length > 0) {
    const spotByNo = new Map<number, MapSpot>(spots.map((s) => [s.cellId, s]));
    return curvedRoutes.map((cr) => {
      const key = `cr-${cr.routeId}-${cr.from}-${cr.to}`;
      const observedCount =
        observedCounts.get([cr.from, cr.to].sort((a, b) => a - b).join("-")) ?? 0;
      const fromSpot = spotByNo.get(cr.from);
      const toSpot = spotByNo.get(cr.to);
      const { startX, startY, ctrlX, ctrlY, endX, endY } = cr;
      const isCurved =
        Math.hypot(ctrlX - (startX + endX) / 2, ctrlY - (startY + endY) / 2) >
        1;
      const pathD = isCurved
        ? `M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`
        : `M ${startX} ${startY} L ${endX} ${endY}`;

      return {
        key,
        fromCellId: cr.from,
        toCellId: cr.to,
        fromX: fromSpot?.x ?? startX,
        fromY: fromSpot?.y ?? startY,
        toX: toSpot?.x ?? endX,
        toY: toSpot?.y ?? endY,
        renderFromX: startX,
        renderFromY: startY,
        renderToX: endX,
        renderToY: endY,
        ctrlX,
        ctrlY,
        curvature: cr.curvature,
        isArrow: cr.isArrow ?? false,
        pathD,
        observedCount,
        score: 0,
      } satisfies InferredRouteOverlay;
    });
  }

  // 2. Fallback to heuristic inference if route frames exist
  if (!routeFrames) return [];

  const inferredByKey = new Map<string, InferredRouteOverlay>();

  for (const spot of spots) {
    if (typeof spot.lineOffsetX !== "number" || typeof spot.lineOffsetY !== "number") continue;
    const frame = routeFrames[spot.cellId];
    if (!frame) continue;

    const routeCenterX = spot.x + spot.lineOffsetX + frame.width / 2;
    const routeCenterY = spot.y + spot.lineOffsetY + frame.height / 2;
    const directionX = routeCenterX - spot.x;
    const directionY = routeCenterY - spot.y;
    const directionLength = Math.hypot(directionX, directionY);
    if (directionLength < 4) continue;

    const expectedTargetX = spot.x + directionX * 2;
    const expectedTargetY = spot.y + directionY * 2;
    let bestCandidate: { spot: MapSpot; score: number } | null = null;

    for (const candidate of spots) {
      if (candidate.cellId === spot.cellId) continue;
      const candidateVectorX = candidate.x - spot.x;
      const candidateVectorY = candidate.y - spot.y;
      const candidateDistance = Math.hypot(candidateVectorX, candidateVectorY);
      if (candidateDistance < 8) continue;

      const projection = (candidateVectorX * directionX + candidateVectorY * directionY) / directionLength;
      if (projection <= 0) continue;

      const expectedDistance = directionLength * 2;
      const distanceFromExpected = Math.hypot(candidate.x - expectedTargetX, candidate.y - expectedTargetY);
      const perpendicularDistance = Math.abs(candidateVectorX * directionY - candidateVectorY * directionX) / directionLength;
      const distancePenalty = Math.abs(candidateDistance - expectedDistance);
      const score = distanceFromExpected + perpendicularDistance * 1.35 + distancePenalty * 0.35;

      if (!bestCandidate || score < bestCandidate.score) {
        bestCandidate = { spot: candidate, score };
      }
    }

    if (!bestCandidate || bestCandidate.score > 150) continue;

    const fromCellId = spot.cellId;
    const toCellId = bestCandidate.spot.cellId;
    const key = [fromCellId, toCellId].sort((a, b) => a - b).join("-");
    const overlay: InferredRouteOverlay = {
      key,
      fromCellId,
      toCellId,
      fromX: spot.x,
      fromY: spot.y,
      toX: bestCandidate.spot.x,
      toY: bestCandidate.spot.y,
      renderFromX: spot.x,
      renderFromY: spot.y,
      renderToX: bestCandidate.spot.x,
      renderToY: bestCandidate.spot.y,
      observedCount: observedCounts.get(key) ?? 0,
      score: bestCandidate.score,
    };

    const existing = inferredByKey.get(key);
    if (!existing || overlay.score < existing.score) {
      inferredByKey.set(key, overlay);
    }
  }

  return [...inferredByKey.values()]
    .map((overlay) => {
      const dx = overlay.toX - overlay.fromX;
      const dy = overlay.toY - overlay.fromY;
      const distance = Math.hypot(dx, dy) || 1;
      const unitX = dx / distance;
      const unitY = dy / distance;
      const padding = Math.min(ROUTE_NODE_PADDING, distance * ROUTE_PADDING_MAX_RATIO);
      const renderFromX = overlay.fromX + unitX * padding;
      const renderFromY = overlay.fromY + unitY * padding;
      const renderToX = overlay.toX - unitX * padding;
      const renderToY = overlay.toY - unitY * padding;
      return {
        ...overlay,
        renderFromX,
        renderFromY,
        renderToX,
        renderToY,
        pathD: `M ${renderFromX} ${renderFromY} L ${renderToX} ${renderToY}`,
      } satisfies InferredRouteOverlay;
    })
    .sort((a, b) => a.score - b.score);
}
