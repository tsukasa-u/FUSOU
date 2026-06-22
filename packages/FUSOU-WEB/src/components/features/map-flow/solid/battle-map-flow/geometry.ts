import type { LayoutObstacle, MapSpot, SpotRenderPosition } from "./types";
import { ACTIVE_CELL_RING_RADIUS, ROUTE_COUNT_BADGE_WIDTH, ROUTE_COUNT_BADGE_HEIGHT } from "./constants";

export function rectsOverlap(a: LayoutObstacle, b: LayoutObstacle): boolean {
  return !(
    a.rectX + a.width <= b.rectX ||
    b.rectX + b.width <= a.rectX ||
    a.rectY + a.height <= b.rectY ||
    b.rectY + b.height <= a.rectY
  );
}

export function circleIntersectsRect(cx: number, cy: number, radius: number, rect: LayoutObstacle): boolean {
  const nearestX = Math.max(rect.rectX, Math.min(cx, rect.rectX + rect.width));
  const nearestY = Math.max(rect.rectY, Math.min(cy, rect.rectY + rect.height));
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

export function buildBadgeRect(centerX: number, centerY: number, width: number, height: number): LayoutObstacle {
  return {
    rectX: centerX - width / 2,
    rectY: centerY - height / 2,
    width,
    height,
  };
}

export function computeTransitionBadgePosition(
  from: MapSpot,
  to: MapSpot,
  allSpots: MapSpot[],
  bounds: { width: number; height: number },
): { badgeX: number; badgeY: number } {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const normalX = -dy / length;
  const normalY = dx / length;
  const candidateOffsets = [18, 28, 38, 50, 64];
  let best: { badgeX: number; badgeY: number; score: number } | null = null;

  for (const direction of [1, -1]) {
    for (let index = 0; index < candidateOffsets.length; index++) {
      const offset = candidateOffsets[index]! * direction;
      const badgeX = midX + normalX * offset;
      const badgeY = midY + normalY * offset;
      const rect = buildBadgeRect(badgeX, badgeY, ROUTE_COUNT_BADGE_WIDTH, ROUTE_COUNT_BADGE_HEIGHT);
      let score = index * 10;

      if (rect.rectX < 0 || rect.rectY < 0) score += 2000;
      if (rect.rectX + rect.width > bounds.width) score += 2000;
      if (rect.rectY + rect.height > bounds.height) score += 2000;

      for (const spot of allSpots) {
        if (!circleIntersectsRect(spot.x, spot.y, ACTIVE_CELL_RING_RADIUS + 8, rect)) continue;
        score += spot.cellId === from.cellId || spot.cellId === to.cellId ? 7000 : 5500;
      }

      if (!best || score < best.score) {
        best = { badgeX, badgeY, score };
      }
    }
  }

  return best ? { badgeX: best.badgeX, badgeY: best.badgeY } : { badgeX: midX, badgeY: midY };
}

export function buildSpotRenderPositions(spots: MapSpot[]): Map<number, SpotRenderPosition> {
  const positions = new Map<number, SpotRenderPosition>();
  for (const spot of spots) {
    positions.set(spot.cellId, { x: spot.x, y: spot.y });
  }
  return positions;
}
