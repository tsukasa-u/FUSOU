import type { LabelAnchor, LabelLayout, LayoutObstacle } from "./types";
import { LABEL_HEIGHT, LABEL_DISTANCE, LABEL_DISTANCE_STEP, NODE_COLLISION_RADIUS } from "./constants";
import { rectsOverlap, circleIntersectsRect } from "./geometry";

export function estimateLabelWidth(label: string): number {
  return Math.max(40, label.length * 8 + 18);
}

export function buildAutoLabelLayouts(
  anchors: LabelAnchor[],
  labels: Map<string, string>,
  bounds: { width: number; height: number },
  obstacles: LayoutObstacle[] = [],
): Map<string, LabelLayout> {
  const placements = new Map<string, LabelLayout>();
  const placedRects: LabelLayout[] = [];
  const duplicateIndexByKey = new Map<string, number>();
  const duplicatesByCoord = new Map<string, LabelAnchor[]>();

  for (const anchor of anchors) {
    const key = `${anchor.x},${anchor.y}`;
    const group = duplicatesByCoord.get(key);
    if (group) {
      group.push(anchor);
    } else {
      duplicatesByCoord.set(key, [anchor]);
    }
  }

  for (const group of duplicatesByCoord.values()) {
    group
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key, "ja"))
      .forEach((anchor, index) => {
        duplicateIndexByKey.set(anchor.key, index);
      });
  }

  const angles = [-60, -30, 30, 60, -120, 120, 0, 180];
  const orderedAnchors = [...anchors].sort((a, b) => {
    const duplicateDelta =
      (duplicatesByCoord.get(`${b.x},${b.y}`)?.length ?? 1) -
      (duplicatesByCoord.get(`${a.x},${a.y}`)?.length ?? 1);
    if (duplicateDelta !== 0) return duplicateDelta;
    return a.key.localeCompare(b.key, "ja");
  });

  for (const anchor of orderedAnchors) {
    const label = labels.get(anchor.key) ?? anchor.key;
    const width = estimateLabelWidth(label);
    const duplicateIndex = duplicateIndexByKey.get(anchor.key) ?? 0;
    const rotatedAngles = angles.map((_, index) => angles[(index + duplicateIndex) % angles.length]);
    let bestLayout: LabelLayout | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let ring = 0; ring < 3; ring++) {
      const distance = LABEL_DISTANCE + duplicateIndex * 6 + ring * LABEL_DISTANCE_STEP;
      for (const angle of rotatedAngles) {
        const rad = (angle * Math.PI) / 180;
        const centerX = anchor.x + Math.cos(rad) * distance;
        const centerY = anchor.y + Math.sin(rad) * distance;
        const layout: LabelLayout = {
          rectX: centerX - width / 2,
          rectY: centerY - LABEL_HEIGHT / 2,
          textX: centerX,
          textY: centerY,
          textAnchor: "middle",
          width,
          height: LABEL_HEIGHT,
        };

        let score = ring * 60 + Math.abs(angle) * 0.2;

        if (layout.rectX < 0 || layout.rectY < 0) score += 400;
        if (layout.rectX + layout.width > bounds.width) score += 400;
        if (layout.rectY + layout.height > bounds.height) score += 400;

        for (const placed of placedRects) {
          if (rectsOverlap(layout, placed)) score += 1000;
        }

        for (const obstacle of obstacles) {
          if (rectsOverlap(layout, obstacle)) score += 1200;
        }

        for (const other of anchors) {
          if (other.key === anchor.key) continue;
          if (circleIntersectsRect(other.x, other.y, NODE_COLLISION_RADIUS, layout)) {
            score += 700;
          }
        }

        if (circleIntersectsRect(anchor.x, anchor.y, NODE_COLLISION_RADIUS, layout)) {
          score += 1400;
        }

        if (score < bestScore) {
          bestScore = score;
          bestLayout = layout;
        }
      }
    }

    if (bestLayout) {
      placements.set(anchor.key, bestLayout);
      placedRects.push(bestLayout);
    }
  }

  return placements;
}
